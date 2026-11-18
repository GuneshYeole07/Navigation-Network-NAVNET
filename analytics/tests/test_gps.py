import numpy as np

from app.geo import haversine
from app.gps import clean_pings, kalman_track, track_error
from app.simulate import simulate_ride


def noisy_ride(seed=11, noise=10, outliers=0.03):
    ride, _ = simulate_ride(np.random.default_rng(seed), km=15, riders=3, ping_every_s=3, stops=[(6000, 4)], slow=[], gps_noise_m=noise, outlier_rate=outliers)
    return ride.pings


def test_cleaning_removes_jumps_and_noise():
    p = noisy_ride()
    raw = track_error(p, "lat", "lng")
    live = track_error(clean_pings(p, smooth=False), "clean_lat", "clean_lng")
    smooth = track_error(clean_pings(p), "clean_lat", "clean_lng")
    assert raw["max_m"] > 200  # the simulation does include big multipath jumps
    assert live["rmse_m"] < raw["rmse_m"] * 0.5
    assert smooth["rmse_m"] <= live["rmse_m"]
    assert smooth["p95_m"] < raw["p95_m"]
    assert smooth["max_m"] < 150


def test_outliers_are_flagged_not_used():
    p = noisy_ride(outliers=0.05)
    c = clean_pings(p)
    rejected = c[~c["gps_used"]]
    assert 0 < len(rejected) < len(c) * 0.15
    # Every point still gets a (cleaned) position, so the track has no holes.
    assert c["clean_lat"].notna().all()


def test_useless_fixes_are_ignored():
    t = np.arange(0, 30, 3.0)
    lat = 18.5 + np.arange(len(t)) * 0.0002
    lng = np.full(len(t), 73.8)
    acc = np.full(len(t), 8.0)
    acc[4] = 500  # "accuracy 500 m" fix
    lat = lat.copy()
    lat[4] += 0.01  # ~1 km off
    out = kalman_track(t, lat, lng, acc)
    assert not out["used"][4]
    assert abs(out["lat"][4] - (18.5 + 4 * 0.0002)) < 0.0002  # filled in from the track


def test_stationary_rider_does_not_drift():
    t = np.arange(0, 300, 3.0)
    rng = np.random.default_rng(0)
    lat = 18.5 + rng.normal(0, 8 / 111_320, len(t))
    lng = 73.8 + rng.normal(0, 8 / 111_320, len(t))
    out = kalman_track(t, lat, lng, np.full(len(t), 10.0), speed_kmh=np.zeros(len(t)))
    spread = np.hypot((out["lat"] - 18.5) * 111_320, (out["lng"] - 73.8) * 105_000)
    assert np.percentile(spread, 95) < 6
    assert out["kmh"].iloc[20:].max() < 3


def test_follows_real_turns_but_not_glitches():
    from scripts.gps_benchmark import manoeuvre_track

    errs = []
    for seed in range(5):
        ts, la, ln, acc, tla, tln, kmh, hdg = manoeuvre_track(np.random.default_rng(seed), doppler=True)
        live = kalman_track(ts, la, ln, acc, kmh, hdg, smooth=False)
        errs.append(haversine(live["lat"].to_numpy(), live["lng"].to_numpy(), tla, tln))
    e = np.concatenate(errs)
    assert np.sqrt(np.mean(e**2)) < 20  # raw is ~44 m
    assert e.max() < 80


def test_parked_rider_does_not_follow_two_jumps():
    # Standing still (phone says 0 km/h); two multipath fixes 250 m away in a row.
    t = np.arange(0, 60, 3.0)
    lat = np.full(len(t), 18.5)
    lng = np.full(len(t), 73.8)
    lat[10], lat[11] = 18.5022, 18.5021
    res = kalman_track(t, lat, lng, np.full(len(t), 10.0), np.zeros(len(t)), np.full(len(t), np.nan), smooth=False)
    moved = haversine(res["lat"].to_numpy(), res["lng"].to_numpy(), 18.5, 73.8)
    assert moved.max() < 30
