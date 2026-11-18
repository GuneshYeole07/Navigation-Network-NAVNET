"""
How much more accurate is the cleaned track than raw phone GPS?

    python -m scripts.gps_benchmark

Simulates rides (3-second fixes, correlated GPS drift, multipath jumps) where the true
position is known, and reports the error of: the raw fixes, the live filter (what the
phone does while riding) and the smoothed track (what the analytics use afterwards).
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from app.geo import haversine
from app.gps import clean_pings, kalman_track, track_error
from app.simulate import simulate_ride

SCENARIOS = [
    ("Open highway", 6, 0.00),
    ("Typical (towns, trees)", 10, 0.03),
    ("Hard (city centre, ghats)", 18, 0.08),
]


def run(rides_per_scenario: int = 6) -> pd.DataFrame:
    rows = []
    for name, noise, outliers in SCENARIOS:
        agg = []
        for seed in range(rides_per_scenario):
            rng = np.random.default_rng(1000 + seed)
            ride, _ = simulate_ride(rng, km=20, riders=4, ping_every_s=3, stops=[(8000, 5)], slow=[(12000, 15000, 0.5)], gps_noise_m=noise, outlier_rate=outliers)
            p = ride.pings
            live, smooth = clean_pings(p, smooth=False), clean_pings(p)
            agg.append(
                {
                    "raw_rmse": track_error(p, "lat", "lng")["rmse_m"],
                    "raw_p95": track_error(p, "lat", "lng")["p95_m"],
                    "raw_max": track_error(p, "lat", "lng")["max_m"],
                    "live_rmse": track_error(live, "clean_lat", "clean_lng")["rmse_m"],
                    "live_p95": track_error(live, "clean_lat", "clean_lng")["p95_m"],
                    "live_max": track_error(live, "clean_lat", "clean_lng")["max_m"],
                    "smooth_rmse": track_error(smooth, "clean_lat", "clean_lng")["rmse_m"],
                    "smooth_p95": track_error(smooth, "clean_lat", "clean_lng")["p95_m"],
                    "smooth_max": track_error(smooth, "clean_lat", "clean_lng")["max_m"],
                }
            )
        m = pd.DataFrame(agg).mean()
        rows.append({"scenario": name, "gps_noise_m": noise, "jumps_pct": outliers * 100, **m.round(1).to_dict(), "rmse_cut_pct": round((1 - m.smooth_rmse / m.raw_rmse) * 100)})
    return pd.DataFrame(rows)


def manoeuvre_track(rng: np.random.Generator, kmh: float = 90, every_s: float = 3, noise_m: float = 8, outliers: float = 0.03, doppler: bool = False):
    """A fast zig-zag: 90° turns every ~600 m and a U-turn, which a 'cruising' filter gets wrong."""
    v = kmh / 3.6
    # (heading in degrees, seconds) legs; a U-turn is a 180° change.
    legs = [(90, 25), (0, 20), (90, 20), (180, 25), (0, 30), (270, 20), (0, 25), (90, 30)]
    t, x, y, tx, ty = 0.0, 0.0, 0.0, [], []
    ts, th = [], []
    for hdg, dur in legs:
        for _ in range(int(dur / every_s)):
            x += v * every_s * np.sin(np.radians(hdg))
            y += v * every_s * np.cos(np.radians(hdg))
            t += every_s
            ts.append(t)
            th.append(hdg)
            tx.append(x)
            ty.append(y)
    tx, ty, ts = np.array(tx), np.array(ty), np.array(ts)
    n = len(ts)
    ex, ey = np.zeros(n), np.zeros(n)
    a = np.exp(-every_s / 20)
    for i in range(1, n):
        ex[i] = a * ex[i - 1] + rng.normal(0, noise_m * np.sqrt(1 - a * a))
        ey[i] = a * ey[i - 1] + rng.normal(0, noise_m * np.sqrt(1 - a * a))
    jump = rng.random(n) < outliers
    ang = rng.uniform(0, 2 * np.pi, n)
    dist = rng.uniform(80, 400, n)
    rx = tx + ex + np.where(jump, dist * np.cos(ang), 0)
    ry = ty + ey + np.where(jump, dist * np.sin(ang), 0)
    acc = np.full(n, float(noise_m))
    k = 111_320.0
    lat0, lng0 = 18.5, 73.8
    to_ll = lambda X, Y: (lat0 + Y / k, lng0 + X / (k * np.cos(np.radians(lat0))))  # noqa: E731
    rlat, rlng = to_ll(rx, ry)
    tlat, tlng = to_ll(tx, ty)
    if doppler:  # phones report speed (±0.5 m/s) and course (±5°) from Doppler
        kmh_r = (v + rng.normal(0, 0.5, n)) * 3.6
        hdg_r = (np.array(th) + rng.normal(0, 5, n)) % 360
        return ts, rlat, rlng, acc, tlat, tlng, kmh_r, hdg_r
    return ts, rlat, rlng, acc, tlat, tlng, None, None


def run_manoeuvres(n: int = 20, doppler: bool = False) -> dict:
    out = []
    for seed in range(n):
        ts, la, ln, acc, tla, tln, kmh, hdg = manoeuvre_track(np.random.default_rng(seed), doppler=doppler)
        live = kalman_track(ts, la, ln, acc, kmh, hdg, smooth=False)
        e_raw = haversine(la, ln, tla, tln)
        e_live = haversine(live["lat"].to_numpy(), live["lng"].to_numpy(), tla, tln)
        out.append((np.sqrt(np.mean(e_raw**2)), np.max(e_raw), np.sqrt(np.mean(e_live**2)), np.max(e_live)))
    o = np.mean(out, axis=0)
    label = "Sharp turns + U-turn, 90 km/h" + (" (phone speed+heading)" if doppler else " (position only)")
    return {"scenario": label, "raw_rmse": round(o[0], 1), "raw_max": round(o[1], 1), "live_rmse": round(o[2], 1), "live_max": round(o[3], 1)}


if __name__ == "__main__":
    df = run()
    print(df.to_string(index=False))
    print()
    print(pd.DataFrame([run_manoeuvres(), run_manoeuvres(doppler=True)]).to_string(index=False))
