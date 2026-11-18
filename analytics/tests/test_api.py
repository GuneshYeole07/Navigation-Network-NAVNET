import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.db import get_repository
from app.main import State, app
from app.simulate import simulate_ride

KEY = {"X-Analytics-Key": "test-key"}


class FakeRepo:
    def __init__(self, rides):
        self.rides = {r.trip_id: r for r in rides}

    def load_ride(self, trip_id):
        return self.rides.get(trip_id)

    def finished_rides(self, limit=1000):
        return [r for r in self.rides.values() if r.status == "COMPLETED"]


@pytest.fixture
def client(known_ride, history, tmp_path):
    ride, _ = known_ride
    live, _ = simulate_ride(np.random.default_rng(9), km=40, stops=[], slow=[], trip_id="live-trip")
    live.status = "ACTIVE"
    live.pings = live.pings.iloc[: len(live.pings) // 3].copy()
    # Pretend these fixes were just received.
    live.pings["recorded_at"] += pd.Timestamp.now(tz="UTC") - live.pings["recorded_at"].max() - pd.Timedelta(minutes=1)
    repo = FakeRepo([ride, live, *history])
    get_settings.cache_clear()
    settings = get_settings()
    settings.model_path = tmp_path / "eta.joblib"
    app.dependency_overrides[get_repository] = lambda: repo
    app.dependency_overrides[get_settings] = lambda: settings
    State.insights_cache.clear()
    with TestClient(app) as c:
        yield c, ride
    app.dependency_overrides.clear()


def test_health_is_public(client):
    c, _ = client
    assert c.get("/health").json()["status"] == "ok"


def test_key_is_required(client):
    c, ride = client
    assert c.get(f"/trips/{ride.trip_id}/insights").status_code == 401
    assert c.get(f"/trips/{ride.trip_id}/insights", headers={"X-Analytics-Key": "wrong"}).status_code == 401


def test_insights(client):
    c, ride = client
    r = c.get(f"/trips/{ride.trip_id}/insights", headers=KEY)
    assert r.status_code == 200
    body = r.json()
    assert body["has_data"] and body["summary"]["riders"] == 5
    assert c.get("/trips/nope/insights", headers=KEY).status_code == 404


def test_train_then_live_eta(client):
    c, _ = client
    metrics = c.post("/model/train", headers=KEY).json()
    assert metrics["trips"] >= 40 and metrics["improvement_pct"] > 0
    assert c.get("/model", headers=KEY).json()["ready"] is True
    eta = c.get("/trips/live-trip/eta", headers=KEY).json()
    assert eta["available"] and eta["source"] == "model" and eta["minutes_left"] > 0


def test_eta_only_for_running_trips(client):
    c, ride = client
    assert c.get(f"/trips/{ride.trip_id}/eta", headers=KEY).json()["available"] is False


def test_tracks_are_cleaned(client):
    c, ride = client
    body = c.get(f"/trips/{ride.trip_id}/tracks?every_s=60", headers=KEY).json()
    assert len(body["riders"]) == 5
    r = body["riders"][0]
    assert r["fixes"] > 50 and len(r["points"]) > 10
    assert len(r["points"][0]) == 4
