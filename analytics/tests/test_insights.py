from app.insights import ride_insights
from app.ride import Ride
import numpy as np


def test_finds_the_group_stops(known_ride):
    ride, scenario = known_ride
    stops = [s for s in ride_insights(ride)["stops"] if s["whole_group"]]
    assert [round(s["km"]) for s in stops] == [20, 45]
    for found, (_, planned_min) in zip(stops, scenario.stops):
        # Includes waiting for the last rider to arrive, so a bit longer than the rest itself.
        assert planned_min <= found["minutes"] <= planned_min + 15
        assert found["riders"] == 5


def test_finds_the_slow_ghat_section(known_ride):
    ride, _ = known_ride
    stretches = ride_insights(ride)["slowest_stretches"]
    assert len(stretches) >= 1
    s = stretches[0]
    assert 29 <= s["from_km"] <= 31 and 37 <= s["to_km"] <= 39
    assert s["vs_typical_pct"] >= 30


def test_summary_and_rider_stats(known_ride):
    ride, _ = known_ride
    result = ride_insights(ride)
    summary = result["summary"]
    assert summary["riders"] == 5
    assert abs(summary["distance_km"] - 60) < 1
    assert 25 <= summary["stopped_min"] <= 45  # 30 min of stops + waiting
    assert len(result["speed_profile"]) == 60
    riders = result["riders"]
    assert len(riders) == 5
    assert all(0 <= r["steadiness"] <= 100 for r in riders)
    assert riders[0]["avg_gap_m"] <= riders[-1]["avg_gap_m"]  # sorted: closest to the leader first


def test_no_gps_data():
    ride = Ride(trip_id="t", name="Empty", vehicle_type="BIKE", route=np.array([[18.5, 73.8], [18.6, 73.9]]), planned_distance_m=15_000, planned_duration_s=1200)
    assert ride_insights(ride) == {"trip_id": "t", "has_data": False}


def test_round_trip_stops_and_arrival(monkeypatch):
    import app.simulate as sim
    from app.eta_model import group_progress, training_samples

    make = sim.make_route
    monkeypatch.setattr(sim, "make_route", lambda rng, km, **k: (lambda r: np.concatenate([r, r[::-1][1:]]))(make(rng, km / 2, **k)))
    ride, _ = sim.simulate_ride(np.random.default_rng(3), km=40, stops=[(10_000, 15), (30_000, 15)], slow=[])
    assert group_progress(ride).iloc[-1] > ride.total_m - 200  # the group got home
    assert not training_samples(ride).empty  # so the ride counts for the ETA model
    stops = [s for s in ride_insights(ride)["stops"] if s["whole_group"]]
    assert [round(s["km"]) for s in stops] == [10, 30]  # the second stop is on the way back
