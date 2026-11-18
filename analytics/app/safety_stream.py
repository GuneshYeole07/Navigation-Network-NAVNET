"""
Runs the safety monitor live: LISTEN on Postgres channel `navnet_ping` (the API publishes
every processed position there when SAFETY_MONITOR=1), feed the monitor, and send its
alerts to the API (POST /api/internal/alerts), which delivers them like any other alert.

Reconnects by itself if the database restarts; a monitor that is down never affects riding.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time

import httpx
import psycopg

from .config import Settings
from .safety import Alert, SafetyMonitor, load_or_train

log = logging.getLogger("navnet.safety")


class SafetyStream:
    def __init__(self, settings: Settings, monitor: SafetyMonitor | None = None):
        self.settings = settings
        self.monitor = monitor
        self.connected = False
        self.sent = 0
        self.failed = 0
        self._task: asyncio.Task | None = None

    def status(self) -> dict:
        return {
            "running": self._task is not None and not self._task.done(),
            "connected": self.connected,
            "pings": self.monitor.stats["pings"] if self.monitor else 0,
            "alerts_raised": self.monitor.stats["alerts"] if self.monitor else 0,
            "alerts_sent": self.sent,
            "alerts_failed": self.failed,
            "riders_tracked": len(self.monitor.riders) if self.monitor else 0,
        }

    def start(self):
        self._task = asyncio.create_task(self._run())

    async def stop(self):
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    async def _run(self):
        if self.monitor is None:
            model = await asyncio.to_thread(load_or_train, self.settings.safety_model_path)
            self.monitor = SafetyMonitor(model)
        backoff = 1
        async with httpx.AsyncClient(timeout=5) as http:
            while True:
                try:
                    await self._listen(http)
                    backoff = 1
                except asyncio.CancelledError:
                    raise
                except Exception as e:  # noqa: BLE001 - DB restart, network blip: retry
                    self.connected = False
                    log.warning("safety stream: %s (retrying in %ss)", e, backoff)
                    await asyncio.sleep(backoff)
                    backoff = min(backoff * 2, 30)

    async def _listen(self, http: httpx.AsyncClient):
        url = self.settings.database_url.split("?")[0]
        async with await psycopg.AsyncConnection.connect(url, autocommit=True) as conn:
            await conn.execute("LISTEN navnet_ping")
            self.connected = True
            log.info("safety monitor listening")
            while True:
                async for n in conn.notifies(timeout=5.0):
                    try:
                        alerts = self.monitor.feed(json.loads(n.payload))
                    except (ValueError, KeyError, TypeError) as e:
                        log.warning("bad ping: %s", e)
                        continue
                    for a in alerts:
                        await self._send(http, a)
                for a in self.monitor.sweep(time.time()):
                    await self._send(http, a)

    async def _send(self, http: httpx.AsyncClient, a: Alert):
        try:
            r = await http.post(
                f"{self.settings.api_url.rstrip('/')}/api/internal/alerts",
                json=a.payload(),
                headers={"X-Analytics-Key": self.settings.analytics_key},
            )
            r.raise_for_status()
            self.sent += 1
            log.info("alert %s for %s sent", a.type, a.user_id)
        except Exception as e:  # noqa: BLE001
            self.failed += 1
            log.warning("could not send %s alert: %s", a.type, e)
