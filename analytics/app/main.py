"""
NavNet analytics API (FastAPI).

GET  /health                    service + model status (no key needed)
GET  /trips/{trip_id}/insights  slow stretches, group stops, rider stats for a trip
GET  /trips/{trip_id}/eta       machine-learned arrival time for a trip in progress
GET  /model                     ETA model accuracy vs the old fixed-speed estimate
POST /model/train               retrain the ETA model on finished trips

The NavNet API calls this service server-to-server (after checking the user may see the
trip) and sends the shared secret in the X-Analytics-Key header.
"""
from __future__ import annotations

import logging
import secrets
import threading
from collections import OrderedDict
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.concurrency import run_in_threadpool

from .config import Settings, get_settings
from .db import Repository, get_repository
from .eta_model import EtaModel, live_eta
from .insights import ride_insights

log = logging.getLogger("navnet.analytics")


class State:
    model = EtaModel()
    training = threading.Lock()
    insights_cache: "OrderedDict[str, dict]" = OrderedDict()


def train_model(repo: Repository, settings: Settings) -> dict:
    with State.training:
        rides = repo.finished_rides()
        if len(rides) < settings.train_min_trips:
            raise ValueError(f"Need at least {settings.train_min_trips} finished trips with GPS history (have {len(rides)})")
        model = EtaModel()
        metrics = model.fit(rides)
        model.save(settings.model_path)
        State.model = model
        log.info("ETA model trained: %s", metrics)
        return metrics


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    State.model = EtaModel.load(settings.model_path)
    if not State.model.ready and settings.auto_train:
        def background():
            try:
                train_model(get_repository(), settings)
            except Exception as e:  # no data yet, DB down…: keep serving with the fallback estimate
                log.warning("ETA model not trained yet: %s", e)
        threading.Thread(target=background, daemon=True).start()
    yield


app = FastAPI(title="NavNet Analytics", version="1.0.0", lifespan=lifespan)


def require_key(x_analytics_key: str | None = Header(default=None), settings: Settings = Depends(get_settings)):
    if settings.analytics_key and not secrets.compare_digest(x_analytics_key or "", settings.analytics_key):
        raise HTTPException(status_code=401, detail="Missing or wrong X-Analytics-Key")


@app.get("/health")
def health():
    return {"status": "ok", "model_ready": State.model.ready, "model": State.model.metrics}


@app.get("/trips/{trip_id}/insights", dependencies=[Depends(require_key)])
async def trip_insights(trip_id: str, repo: Repository = Depends(get_repository)):
    if trip_id in State.insights_cache:
        return State.insights_cache[trip_id]
    ride = await run_in_threadpool(repo.load_ride, trip_id)
    if ride is None:
        raise HTTPException(status_code=404, detail="Trip not found")
    result = await run_in_threadpool(ride_insights, ride)
    if ride.status in ("COMPLETED", "CANCELLED"):  # finished trips never change: cache them
        State.insights_cache[trip_id] = result
        while len(State.insights_cache) > 200:
            State.insights_cache.popitem(last=False)
    return result


@app.get("/trips/{trip_id}/eta", dependencies=[Depends(require_key)])
async def trip_eta(trip_id: str, repo: Repository = Depends(get_repository)):
    ride = await run_in_threadpool(repo.load_ride, trip_id)
    if ride is None:
        raise HTTPException(status_code=404, detail="Trip not found")
    if ride.status not in ("ACTIVE", "PAUSED"):
        return {"available": False, "reason": f"Trip is {ride.status.lower()}"}
    return await run_in_threadpool(live_eta, ride, State.model)


@app.get("/model", dependencies=[Depends(require_key)])
def model_info():
    return {"ready": State.model.ready, "metrics": State.model.metrics}


@app.post("/model/train", dependencies=[Depends(require_key)])
async def retrain(repo: Repository = Depends(get_repository), settings: Settings = Depends(get_settings)):
    if State.training.locked():
        raise HTTPException(status_code=409, detail="Training already in progress")
    try:
        return await run_in_threadpool(train_model, repo, settings)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
