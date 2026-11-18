from datetime import timedelta

import numpy as np
import pytest

from app.eta_model import EtaModel, live_eta, training_samples
from app.simulate import simulate_ride


@pytest.fixture(scope="module")
def trained(history):
    model = EtaModel()
    metrics = model.fit(history)
    return model, metrics


def test_training_samples_have_real_minutes_left(known_ride):
    ride, _ = known_ride
    s = training_samples(ride)
    assert len(s) > 50
    assert (s["minutes_left"] > 0).all()
    assert s["minutes_left"].is_monotonic_decreasing


def test_model_beats_the_fixed_speed_estimate(trained):
    _, metrics = trained
    assert metrics["trips"] == 40
    assert metrics["mae_minutes"] < metrics["baseline_mae_minutes"]
    assert metrics["improvement_pct"] > 15


def test_live_eta_mid_ride(trained):
    model, _ = trained
    ride, _ = simulate_ride(np.random.default_rng(5), km=50, stops=[(15_000, 15)], slow=[])
    cut = ride.pings["recorded_at"].min() + timedelta(minutes=40)
    ride.pings = ride.pings[ride.pings["recorded_at"] <= cut]
    ride.status = "ACTIVE"
    eta = live_eta(ride, model, now=cut.to_pydatetime())
    assert eta["available"] and eta["source"] == "model"
    assert 0 < eta["remaining_km"] < 50
    assert eta["minutes_left"] > 0


def test_untrained_model_falls_back_to_planned_speed(known_ride):
    ride, _ = known_ride
    part = ride.pings[ride.pings["recorded_at"] <= ride.pings["recorded_at"].min() + timedelta(minutes=30)]
    live = type(ride)(**{**ride.__dict__, "pings": part, "status": "ACTIVE"})
    eta = live_eta(live, EtaModel(), now=part["recorded_at"].max().to_pydatetime())
    assert eta["available"] and eta["source"] == "baseline"
    assert eta["minutes_left"] == eta["baseline_minutes_left"]


def test_stale_gps_gives_no_estimate(trained, known_ride):
    ride, _ = known_ride
    later = ride.pings["recorded_at"].max().to_pydatetime() + timedelta(hours=2)
    part = ride.pings[ride.pings["recorded_at"] <= ride.pings["recorded_at"].min() + timedelta(minutes=30)]
    live = type(ride)(**{**ride.__dict__, "pings": part})
    assert live_eta(live, trained[0], now=later)["available"] is False


def test_needs_enough_trips(history):
    with pytest.raises(ValueError):
        EtaModel().fit(history[:3])


def test_save_and_load(trained, tmp_path):
    model, metrics = trained
    path = tmp_path / "eta.joblib"
    model.save(path)
    loaded = EtaModel.load(path)
    assert loaded.ready and loaded.metrics == metrics
