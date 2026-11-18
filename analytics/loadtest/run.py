"""
NavNet load + failure test: many riders at once, with dead zones and dropped connections.

    python -m loadtest.run --riders 100 --minutes 3

What it does
  1. Creates an admin, a trip and N riders through the real API (start the API with
     RATE_LIMIT_DISABLED=1 so 100+ sign-ups aren't blocked; ignored in production).
  2. Every rider opens its own Socket.IO connection and rides the route at 30-60 km/h,
     sending a GPS fix every 3 s, exactly like the app.
  3. Failures, on purpose:
       * dead zones: riders lose signal for 20-60 s; their fixes are saved and uploaded
         in one `location:batch` when they're back (like the app's offline buffer);
       * dropped connections: sockets are killed and reconnect 3-10 s later.
  4. An admin socket watches the live map. Optional: one rider "crashes" (hard stop, then
     still) to time the Python safety monitor's alert.

What it measures
  * live delivery: % of rider fixes the admin's map received, and how late (p50/p95/p99);
  * ack latency: how long the server takes to accept a fix;
  * track completeness: largest gap in each rider's stored track (dead zones included);
  * errors, by message.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import math
import os
import random
import statistics
import string
import time
from collections import Counter
from dataclasses import dataclass, field

import httpx
import socketio

START = (18.5308, 73.8475)
END = (18.5308, 74.0475)  # ~21 km due east


def lerp(a, b, f):
    return (a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f)


def dist_m(a, b):
    k = math.pi / 180
    x = (b[1] - a[1]) * k * math.cos((a[0] + b[0]) / 2 * k)
    y = (b[0] - a[0]) * k
    return 6371000 * math.hypot(x, y)


def pct(xs, p):
    if not xs:
        return None
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(round(p / 100 * (len(xs) - 1))))]


@dataclass
class Stats:
    sent_live: int = 0
    acked_live: int = 0
    ignored_live: Counter = field(default_factory=Counter)
    ack_ms: list = field(default_factory=list)
    sent_ids: set = field(default_factory=set)  # (user, fixAt) of accepted live fixes
    seen_at: dict = field(default_factory=dict)  # (user, fixAt) -> when the admin's map got it
    batches: int = 0
    batch_points: int = 0
    batch_stored: int = 0
    dead_zones: int = 0
    disconnects: int = 0
    reconnects: int = 0
    errors: Counter = field(default_factory=Counter)
    crash_sent_at: float | None = None
    crash_alert_at: float | None = None


class Api:
    def __init__(self, base: str):
        self.base = base.rstrip("/")
        self.http = httpx.AsyncClient(timeout=30)

    async def call(self, method, path, token=None, **kw):
        h = {"Authorization": f"Bearer {token}"} if token else {}
        r = await self.http.request(method, self.base + "/api" + path, headers=h, **kw)
        body = r.json()
        if r.status_code >= 400 or body.get("success") is False:
            raise RuntimeError(f"{method} {path} → {r.status_code}: {json.dumps(body)[:200]}")
        return body["data"]


async def connect(base: str, token: str) -> socketio.AsyncClient:
    s = socketio.AsyncClient(reconnection=False)
    await s.connect(base, auth={"token": token}, transports=["websocket"], wait_timeout=15)
    return s


class Rider:
    def __init__(self, i, user, token, trip_id, base, stats: Stats, args, rng: random.Random):
        self.i, self.user, self.token, self.trip_id, self.base = i, user, token, trip_id, base
        self.stats, self.args, self.rng = stats, args, rng
        self.kmh = rng.uniform(30, 60)
        self.along = rng.uniform(0, 300)  # metres from the start
        self.total = dist_m(START, END)
        self.buffer: list[dict] = []
        self.sock: socketio.AsyncClient | None = None
        self.crash = False

    def fix(self, now_ms, speed=None):
        lat, lng = lerp(START, END, min(1.0, self.along / self.total))
        # ±5 m of honest GPS noise
        lat += self.rng.gauss(0, 5) / 111_320
        lng += self.rng.gauss(0, 5) / (111_320 * math.cos(math.radians(lat)))
        return {"lat": lat, "lng": lng, "speed": round(self.kmh if speed is None else speed, 1), "heading": 90, "accuracy": 8, "battery": 80, "recordedAt": now_ms}

    async def open(self):
        self.sock = await connect(self.base, self.token)
        await self.sock.call("trip:join", {"tripId": self.trip_id}, timeout=15)

    async def flush(self):
        while self.buffer:
            chunk, self.buffer = self.buffer[:200], self.buffer[200:]
            try:
                ack = await self.sock.call("location:batch", {"tripId": self.trip_id, "points": chunk}, timeout=20)
                if not ack.get("ok"):
                    self.stats.errors[f"batch: {ack.get('error')}"] += 1
                    self.buffer = chunk + self.buffer
                    return
                self.stats.batches += 1
                self.stats.batch_points += len(chunk)
                self.stats.batch_stored += ack["data"]["stored"]
            except Exception as e:  # noqa: BLE001
                self.stats.errors[f"batch: {type(e).__name__}"] += 1
                self.buffer = chunk + self.buffer
                return

    async def run(self, until: float):
        args, rng = self.args, self.rng
        await self.open()
        offline_until = 0.0
        await asyncio.sleep(rng.uniform(0, 3))
        while time.time() < until:
            tick = time.time()
            if not self.crash:
                self.along += self.kmh / 3.6 * 3
            now_ms = int(tick * 1000)
            f = self.fix(now_ms, speed=0 if self.crash else None)

            # Failures: dead zone or a dropped connection.
            if tick >= offline_until and rng.random() < args.dead_zone_rate:
                offline_until = tick + rng.uniform(20, 60)
                self.stats.dead_zones += 1
            if self.sock and tick >= offline_until and rng.random() < args.drop_rate:
                self.stats.disconnects += 1
                await self.sock.disconnect()
                self.sock = None
                offline_until = tick + rng.uniform(3, 10)

            if tick < offline_until:
                self.buffer.append(f)  # no signal: keep it for later
            else:
                if self.sock is None:
                    try:
                        await self.open()
                        self.stats.reconnects += 1
                    except Exception as e:  # noqa: BLE001
                        self.stats.errors[f"reconnect: {type(e).__name__}"] += 1
                        self.buffer.append(f)
                        await asyncio.sleep(3)
                        continue
                if self.buffer:
                    await self.flush()
                self.stats.sent_live += 1
                t0 = time.perf_counter()
                try:
                    ack = await self.sock.call("location:update", {"tripId": self.trip_id, **f}, timeout=10)
                    self.stats.ack_ms.append((time.perf_counter() - t0) * 1000)
                    if ack.get("ok"):
                        ign = (ack.get("data") or {}).get("ignored") or (ack.get("data") or {}).get("throttled")
                        if ign:
                            self.stats.ignored_live[str(ign)] += 1
                        else:
                            self.stats.acked_live += 1
                            self.stats.sent_ids.add((self.user["id"], now_ms))
                    else:
                        self.stats.errors[f"update: {ack.get('error')}"] += 1
                except Exception as e:  # noqa: BLE001
                    self.stats.errors[f"update: {type(e).__name__}"] += 1
                    self.buffer.append(f)
                    try:
                        await self.sock.disconnect()
                    except Exception as e:  # noqa: BLE001 - already gone
                        self.stats.errors[f"disconnect: {type(e).__name__}"] += 1
                    self.sock = None
            await asyncio.sleep(max(0.0, 3 - (time.time() - tick)))
        if self.sock:
            if self.buffer:
                await self.flush()
            await self.sock.disconnect()


async def register(api: Api, run: str, i: int, admin_code: str | None = None):
    body = {"name": f"Load Rider {i}", "email": f"lt{run}-{i}@load.test", "password": "LoadTest2026"}
    if admin_code:
        body.update(name="Load Admin", role="ADMIN", adminCode=admin_code)
    return await api.call("POST", "/auth/register", json=body)


async def main(args):
    run = "".join(random.choices(string.ascii_lowercase + string.digits, k=6))  # unique per run
    api = Api(args.api)
    stats = Stats()
    t_setup = time.time()

    admin = await register(api, run, 0, admin_code=args.admin_code)
    trip = await api.call("POST", "/trips", admin["token"], json={
        "name": f"Load test {run}", "description": "load test",
        "start": {"name": "Start", "lat": START[0], "lng": START[1]},
        "destination": {"name": "End", "lat": END[0], "lng": END[1]},
        "waypoints": [], "checkpoints": [], "groupCode": f"LOAD-{run}".upper(), "groupPassword": "load123",
        "maxMembers": min(500, args.riders + 5), "vehicleType": "BIKE", "speedLimitKmh": 120,
        "departureTime": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + 3600)),
        "expectedArrival": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + 7200)),
    })
    trip_id = trip["id"]

    sem = asyncio.Semaphore(20)

    async def make(i):
        async with sem:
            u = await register(api, run, i)
            await api.call("POST", "/trips/join", u["token"], json={"groupCode": f"LOAD-{run}".upper(), "password": "load123"})
            return u

    users = await asyncio.gather(*(make(i) for i in range(1, args.riders + 1)))
    await api.call("PATCH", f"/trips/{trip_id}/status", admin["token"], json={"action": "start"})
    print(f"setup: {args.riders} riders registered + joined in {time.time() - t_setup:.1f}s")

    # The admin's live map.
    watcher = await connect(args.api, admin["token"])

    @watcher.on("member:location")
    async def on_loc(m):
        key = (m["userId"], m.get("lastFixAt"))
        if key not in stats.seen_at:
            stats.seen_at[key] = time.time() * 1000

    @watcher.on("alert:new")
    async def on_alert(a):
        if a.get("type") == "POSSIBLE_CRASH" and stats.crash_alert_at is None:
            stats.crash_alert_at = time.time()

    await watcher.call("trip:join", {"tripId": trip_id}, timeout=15)

    riders = [Rider(i, u["user"], u["token"], trip_id, args.api, stats, args, random.Random(args.seed * 1000 + i)) for i, u in enumerate(users)]
    until = time.time() + args.minutes * 60
    if args.crash:
        crasher = riders[0]
        crasher.kmh = 55
        crasher.args = argparse.Namespace(**{**vars(args), "dead_zone_rate": 0, "drop_rate": 0})

        async def crash_later():
            await asyncio.sleep(min(40, args.minutes * 60 / 3))
            crasher.crash = True
            stats.crash_sent_at = time.time()

        asyncio.create_task(crash_later())
    t0 = time.time()
    await asyncio.gather(*(r.run(until) for r in riders))
    await asyncio.sleep(3)  # last broadcasts
    elapsed = time.time() - t0 - 3
    if args.crash and stats.crash_alert_at is None:
        deadline = time.time() + 120
        print("waiting up to 2 min for the crash alert…")
        while time.time() < deadline and stats.crash_alert_at is None:
            await asyncio.sleep(1)
    await watcher.disconnect()

    # Stored-track completeness straight from the database (largest gap per rider).
    gaps = await stored_gaps(args.database_url, trip_id) if args.database_url else {}
    await api.http.aclose()
    report(args, stats, elapsed, gaps)


async def stored_gaps(database_url: str, trip_id: str) -> dict:
    import psycopg

    async with await psycopg.AsyncConnection.connect(database_url.split("?")[0]) as conn:
        cur = await conn.execute(
            'SELECT "userId", MAX(gap), COUNT(*) FROM (SELECT "userId", EXTRACT(EPOCH FROM "recordedAt" - LAG("recordedAt") OVER (PARTITION BY "userId" ORDER BY "recordedAt")) AS gap FROM "LocationPing" WHERE "tripId" = %s) g GROUP BY "userId"',
            (trip_id,),
        )
        return {u: (float(g or 0), n) for u, g, n in await cur.fetchall()}


def report(args, s: Stats, elapsed: float, gaps: dict):
    live = [k for k in s.sent_ids if k in s.seen_at]
    delivered = len(live)
    # Only fixes sent live (offline uploads are late by design): fix time → on the admin's map.
    s.deliver_ms = [s.seen_at[k] - k[1] for k in live]
    out = {
        "riders": args.riders,
        "minutes": round(elapsed / 60, 1),
        "live_fixes_sent": s.sent_live,
        "live_fixes_accepted": s.acked_live,
        "live_fixes_rejected_by_guard": dict(s.ignored_live),
        "throughput_fixes_per_s": round(s.sent_live / elapsed, 1),
        "admin_map_delivery_pct": round(100 * delivered / max(1, len(s.sent_ids)), 2),
        "delivery_ms_p50": round(pct(s.deliver_ms, 50) or 0), "delivery_ms_p95": round(pct(s.deliver_ms, 95) or 0), "delivery_ms_p99": round(pct(s.deliver_ms, 99) or 0),
        "ack_ms_p50": round(pct(s.ack_ms, 50) or 0, 1), "ack_ms_p95": round(pct(s.ack_ms, 95) or 0, 1), "ack_ms_p99": round(pct(s.ack_ms, 99) or 0, 1),
        "dead_zones": s.dead_zones, "dropped_connections": s.disconnects, "reconnects": s.reconnects,
        "offline_points_uploaded": s.batch_points, "offline_points_stored": s.batch_stored,
        "errors": dict(s.errors),
    }
    if gaps:
        g = [v[0] for v in gaps.values()]
        out["stored_track_max_gap_s_p50"] = round(statistics.median(g), 1)
        out["stored_track_max_gap_s_worst"] = round(max(g), 1)
        out["riders_with_no_gap_over_15s_pct"] = round(100 * sum(x <= 15 for x in g) / len(g), 1)
    if args.crash:
        out["crash_alert_after_s"] = round(s.crash_alert_at - s.crash_sent_at, 1) if s.crash_alert_at and s.crash_sent_at else None
    print(json.dumps(out, indent=2))
    if args.out:
        with open(args.out, "w") as fh:
            json.dump(out, fh, indent=2)


def cli():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--api", default=os.environ.get("NAVNET_API", "http://localhost:5000"))
    p.add_argument("--riders", type=int, default=100)
    p.add_argument("--minutes", type=float, default=3)
    p.add_argument("--dead-zone-rate", type=float, default=0.01, help="chance per fix of entering a 20-60 s dead zone")
    p.add_argument("--drop-rate", type=float, default=0.005, help="chance per fix of the socket being killed")
    p.add_argument("--crash", action="store_true", help="one rider crashes; times the safety monitor's alert")
    p.add_argument("--admin-code", default=os.environ.get("ADMIN_SIGNUP_CODE", "NAVNET-ADMIN-2026"))
    p.add_argument("--database-url", default=os.environ.get("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/navnet"))
    p.add_argument("--seed", type=int, default=7)
    p.add_argument("--out", help="also write the report to this JSON file")
    asyncio.run(main(p.parse_args()))


if __name__ == "__main__":
    cli()
