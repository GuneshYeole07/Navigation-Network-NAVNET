import math

import numpy as np
import pytest

from app.safety import SafetyMonitor, train_anomaly_model
from app.simulate import simulate_ride


@pytest.fixture(scope="module")
def model():
    return train_anomaly_model(rides=15, seed=1)


def ping(t, lat=18.5, lng=73.8, speed=40.0, heading=90.0, accuracy=8.0, near=False, user="u1"):
    return {"tripId": "trip", "userId": user, "name": "Asha", "t": t * 1000, "lat": lat, "lng": lng,
            "speed": speed, "heading": heading, "accuracy": accuracy, "nearPlace": near}


def ride_east(mon, t0, t1, kmh=45, lat=18.5, every=3):
    out, lng = [], 73.8
    for t in np.arange(t0, t1, every):
        lng += kmh / 3.6 * every / (111_320 * math.cos(math.radians(lat)))
        out += mon.feed(ping(t, lat=lat, lng=lng, speed=kmh))
    return out, lng


def test_normal_simulated_rides_raise_nothing(model):
    mon = SafetyMonitor(model)
    alerts = []
    for seed in range(4):
        # No planned stops: those happen at checkpoints (nearPlace), tested separately below.
        ride, _ = simulate_ride(np.random.default_rng(500 + seed), vehicle="BIKE", km=15, riders=3, ping_every_s=3, gps_noise_m=8, stops=[])
        p = ride.pings.sort_values("recorded_at")
        for r in p.itertuples():
            alerts += mon.feed({"tripId": f"t{seed}", "userId": r.user_id, "name": "R", "t": r.recorded_at.timestamp() * 1000,
                                "lat": r.lat, "lng": r.lng, "speed": None if np.isnan(r.speed_kmh) else r.speed_kmh,
                                "heading": None if np.isnan(r.heading) else r.heading, "accuracy": r.accuracy, "nearPlace": False})
    crashes = [a for a in alerts if a.type == "POSSIBLE_CRASH"]
    assert crashes == []
    assert len([a for a in alerts if a.type == "UNUSUAL_MOVEMENT"]) <= 1  # ~12 rider-hours of riding


def test_hard_stop_then_still_is_a_possible_crash(model):
    mon = SafetyMonitor(model)
    alerts, lng = ride_east(mon, 0, 60, kmh=50)
    alerts += mon.feed(ping(60, lng=lng, speed=2))  # 50 → 2 km/h between two pings 3 s apart
    for t in range(65, 150, 5):
        alerts += mon.feed(ping(t, lng=lng, speed=0))
    crash = [a for a in alerts if a.type == "POSSIBLE_CRASH"]
    assert len(crash) == 1
    assert "50 km/h" in crash[0].message and crash[0].data["fromKmh"] == 50


def test_normal_braking_or_stopping_at_a_checkpoint_is_not(model):
    mon = SafetyMonitor(model)
    alerts, lng = ride_east(mon, 0, 60, kmh=50)
    for t, v in ((63, 35), (66, 20), (69, 8), (72, 0)):  # ~1.6 m/s²: ordinary braking
        alerts += mon.feed(ping(t, lng=lng, speed=v))
    for t in range(75, 200, 5):
        alerts += mon.feed(ping(t, lng=lng, speed=0))
    alerts2, lng = ride_east(mon2 := SafetyMonitor(model), 0, 60, kmh=50)
    alerts2 += mon2.feed(ping(60, lng=lng, speed=0, near=True))  # hard stop, but at the fuel stop
    for t in range(65, 200, 5):
        alerts2 += mon2.feed(ping(t, lng=lng, speed=0, near=True))
    assert not [a for a in alerts + alerts2 if a.type == "POSSIBLE_CRASH"]


def test_no_crash_alert_when_a_friend_is_with_them(model):
    mon = SafetyMonitor(model)
    _, lng = ride_east(mon, 0, 60, kmh=50)
    alerts = mon.feed(ping(60, lng=lng, speed=0))
    for t in range(65, 200, 5):
        alerts += mon.feed(ping(t, lng=lng, speed=0))
        alerts += mon.feed(ping(t, lng=lng + 0.0003, speed=0, user="u2"))  # ~30 m away
    assert not [a for a in alerts if a.type == "POSSIBLE_CRASH" and a.user_id == "u1"]


def test_phone_silent_after_hard_stop(model):
    mon = SafetyMonitor(model)
    _, lng = ride_east(mon, 0, 60, kmh=60)
    mon.feed(ping(60, lng=lng, speed=0))
    assert mon.sweep(110) == []
    alerts = mon.sweep(140)
    assert len(alerts) == 1 and alerts[0].data["silent"] is True


def test_weak_gps(model):
    mon = SafetyMonitor(model)
    alerts = []
    for t in range(0, 150, 5):
        alerts += mon.feed(ping(t, lng=73.8 + t * 1e-5, speed=30, accuracy=85))
    weak = [a for a in alerts if a.type == "WEAK_GPS"]
    assert len(weak) == 1 and weak[0].data["medianAccuracyM"] == 85


def test_circling_is_unusual(model):
    mon = SafetyMonitor(model)
    alerts, _ = ride_east(mon, 0, 120, kmh=45)
    assert not [a for a in alerts if a.type == "UNUSUAL_MOVEMENT"]
    for t in range(120, 360, 3):  # tight circles at 30 km/h: heading turns 40°/s
        alerts += mon.feed(ping(t, lng=73.81 + 0.0003 * math.sin(t / 2), lat=18.5 + 0.0003 * math.cos(t / 2), speed=30, heading=(t * 40) % 360))
    assert [a for a in alerts if a.type == "UNUSUAL_MOVEMENT"]
