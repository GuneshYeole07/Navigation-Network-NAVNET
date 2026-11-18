"""
Write the fixtures the phone-side filter is tested against (client/src/utils/__fixtures__/):
the same fixes run through the Python filter, so the two implementations must agree.

    python -m scripts.export_gps_fixture
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from app.gps import kalman_track
from app.simulate import simulate_ride
from scripts.gps_benchmark import manoeuvre_track

OUT = Path(__file__).resolve().parents[2] / "client" / "src" / "utils" / "__fixtures__"


def rows(t_s, lat, lng, acc, kmh, hdg, tlat, tlng):
    res = kalman_track(t_s, lat, lng, acc, kmh, hdg, smooth=False)
    nn = lambda v: None if v is None or not np.isfinite(v) else float(v)  # noqa: E731
    return [
        {
            "t": float(t_s[i] * 1000), "lat": float(lat[i]), "lng": float(lng[i]), "accuracy": float(acc[i]),
            "speed": nn(kmh[i]) if kmh is not None else None, "heading": nn(hdg[i]) if hdg is not None else None,
            "true_lat": float(tlat[i]), "true_lng": float(tlng[i]),
            "py_lat": float(res["lat"][i]), "py_lng": float(res["lng"][i]), "py_used": bool(res["used"][i]),
        }
        for i in range(len(t_s))
    ]


def main():
    ride, _ = simulate_ride(np.random.default_rng(7), km=8, riders=1, ping_every_s=3, stops=[], slow=[], gps_noise_m=10, outlier_rate=0.03)
    p = ride.pings.sort_values("recorded_at")
    t = (p.recorded_at - p.recorded_at.iloc[0]).dt.total_seconds().to_numpy()
    track = rows(t, p.lat.to_numpy(), p.lng.to_numpy(), p.accuracy.to_numpy(float), p.speed_kmh.to_numpy(float), p.heading.to_numpy(float), p.true_lat.to_numpy(), p.true_lng.to_numpy())
    (OUT / "gps-track.json").write_text(json.dumps(track))

    ts, la, ln, acc, tla, tln, _, _ = manoeuvre_track(np.random.default_rng(3))
    (OUT / "gps-turns.json").write_text(json.dumps(rows(ts, la, ln, acc, None, None, tla, tln)))
    ts, la, ln, acc, tla, tln, kmh, hdg = manoeuvre_track(np.random.default_rng(3), doppler=True)
    (OUT / "gps-turns-doppler.json").write_text(json.dumps(rows(ts, la, ln, acc, kmh, hdg, tla, tln)))
    print("wrote", len(track), "+", len(ts), "fixes")


if __name__ == "__main__":
    main()
