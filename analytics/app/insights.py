"""
Ride insights computed from GPS history:
- where the group was slow (speed along the route, km by km),
- where it stopped and for how long,
- how steady each rider was and how far they usually trailed the leader.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .ride import STOPPED_KMH, Ride, prepare_pings

MIN_STOP_MINUTES = 3
STOP_RADIUS_M = 150
GROUP_STOP_GAP_M = 400
GAP_ALERT_M = 1500


def speed_profile(pings: pd.DataFrame, total_m: float, bucket_m: float = 1000) -> pd.DataFrame:
    """Median moving speed of the group for each km of the route."""
    moving = pings[pings["kmh"] >= STOPPED_KMH]
    n = max(1, int(np.ceil(total_m / bucket_m)))
    if moving.empty:
        return pd.DataFrame({"km": np.arange(n), "kmh": np.nan})
    bucket = np.clip((moving["along_m"] // bucket_m).astype(int), 0, n - 1)
    med = moving.groupby(bucket)["kmh"].median()
    return pd.DataFrame({"km": np.arange(n), "kmh": med.reindex(np.arange(n)).to_numpy()})


def slowest_stretches(profile: pd.DataFrame, top: int = 3, min_len_km: int = 2, threshold: float = 0.75) -> list[dict]:
    """
    Continuous stretches where the group rode well below its usual speed
    (median km speed < `threshold` × the ride's typical speed), longest-and-slowest first.
    """
    p = profile["kmh"]
    if p.dropna().size < min_len_km:
        return []
    typical = float(p.median())
    slow = (p < typical * threshold).fillna(False).to_numpy().astype(int)
    edges = np.flatnonzero(np.diff(np.concatenate([[0], slow, [0]])))
    runs = []
    for s, e in zip(edges[::2], edges[1::2]):
        if e - s < min_len_km:
            continue
        kmh = float(p.iloc[s:e].mean())
        runs.append({"from_km": int(s), "to_km": int(e), "kmh": round(kmh, 1), "vs_typical_pct": round((1 - kmh / typical) * 100), "_lost": (e - s) * (typical - kmh)})
    runs = sorted(runs, key=lambda r: -r["_lost"])[:top]  # most time lost first
    return sorted(({k: v for k, v in r.items() if k != "_lost"} for r in runs), key=lambda r: r["from_km"])


def rider_stops(pings: pd.DataFrame) -> pd.DataFrame:
    """Each rider's stops: consecutive slow fixes lasting at least MIN_STOP_MINUTES."""
    rows = []
    for uid, g in pings.groupby("user_id", sort=False):
        slow = (g["kmh"] < STOPPED_KMH).to_numpy().copy()
        # A single noisy "moving" fix in the middle of a stop (GPS jump) shouldn't split it.
        along = g["along_m"].to_numpy()
        for i in range(1, len(slow) - 1):
            if not slow[i] and slow[i - 1] and slow[i + 1] and abs(along[i + 1] - along[i - 1]) < STOP_RADIUS_M:
                slow[i] = True
        # Run-length encode the slow / moving sequence.
        change = np.flatnonzero(np.diff(np.concatenate([[0], slow.astype(int), [0]])))
        for s, e in zip(change[::2], change[1::2]):
            seg = g.iloc[s:e]
            minutes = (seg["recorded_at"].iloc[-1] - seg["recorded_at"].iloc[0]).total_seconds() / 60
            if minutes < MIN_STOP_MINUTES:
                continue
            rows.append(
                {
                    "user_id": uid,
                    "start": seg["recorded_at"].iloc[0],
                    "end": seg["recorded_at"].iloc[-1],
                    "minutes": minutes,
                    "along_m": float(seg["along_m"].median()),
                    "lat": float(seg["lat"].median()),
                    "lng": float(seg["lng"].median()),
                }
            )
    return pd.DataFrame(rows, columns=["user_id", "start", "end", "minutes", "along_m", "lat", "lng"])


def group_stops(stops: pd.DataFrame, riders: int, join_gap_min: float = 5) -> list[dict]:
    """
    Merge riders' stops into group stops: same place on the route (within GROUP_STOP_GAP_M)
    and overlapping in time (or within `join_gap_min` minutes of each other).
    """
    if stops.empty:
        return []
    gap = pd.Timedelta(minutes=join_gap_min)
    clusters: list[dict] = []
    for s in stops.sort_values("start").itertuples():
        for c in clusters:
            if abs(c["along"] - s.along_m) <= GROUP_STOP_GAP_M and s.start <= c["end"] + gap:
                c["rows"].append(s)
                c["end"] = max(c["end"], s.end)
                break
        else:
            clusters.append({"along": s.along_m, "end": s.end, "rows": [s]})
    out = []
    for c in clusters:
        part = pd.DataFrame(c["rows"])
        n = int(part["user_id"].nunique())
        out.append(
            {
                "km": round(float(part["along_m"].median()) / 1000, 1),
                "lat": round(float(part["lat"].median()), 6),
                "lng": round(float(part["lng"].median()), 6),
                "start": part["start"].min().isoformat(),
                "minutes": int(round((part["end"].max() - part["start"].min()).total_seconds() / 60)),
                "riders": n,
                "whole_group": bool(n >= max(2, riders * 0.6)),
            }
        )
    return sorted(out, key=lambda s: s["km"])


def rider_stats(pings: pd.DataFrame, members: pd.DataFrame) -> list[dict]:
    """Per rider: moving speed, steadiness, top speed and how far behind the leader they rode."""
    if pings.empty:
        return []
    # Everyone's progress on a shared 1-minute clock, to compare with the leader.
    pings = pings.assign(minute=pings["recorded_at"].dt.floor("min"))
    grid = pings.groupby(["minute", "user_id"])["along_m"].max().unstack().sort_index().ffill()
    gap = grid.max(axis=1).to_numpy()[:, None] - grid.to_numpy()

    names = dict(zip(members["user_id"], members["name"])) if not members.empty else {}
    out = []
    for j, uid in enumerate(grid.columns):
        g = pings[pings["user_id"] == uid]
        moving = g.loc[g["kmh"] >= STOPPED_KMH, "kmh"]
        mean = float(moving.mean()) if len(moving) else 0.0
        cv = float(moving.std() / mean) if len(moving) > 2 and mean > 0 else 0.0
        col = gap[:, j][~np.isnan(gap[:, j])]
        acc = pd.to_numeric(g["accuracy"], errors="coerce") if "accuracy" in g else pd.Series(dtype=float)
        out.append(
            {
                "gps_median_accuracy_m": None if acc.dropna().empty else int(round(float(acc.median()))),
                "gps_rejected_pct": round(float((~g["gps_used"].astype(bool)).mean() * 100), 1) if "gps_used" in g else 0.0,
                "user_id": str(uid),
                "name": str(names.get(uid, "Rider")),
                "avg_moving_kmh": round(mean, 1),
                "max_kmh": round(float(g["kmh"].quantile(0.98)) if len(g) else 0.0, 1),
                # 100 = perfectly steady pace; drops as speed varies more (coefficient of variation).
                "steadiness": int(np.clip(round(100 - cv * 100), 0, 100)),
                "avg_gap_m": int(round(float(col.mean()))) if len(col) else 0,
                "time_far_behind_pct": int(round(float((col > GAP_ALERT_M).mean() * 100))) if len(col) else 0,
            }
        )
    return sorted(out, key=lambda r: r["avg_gap_m"])


def ride_insights(ride: Ride) -> dict:
    pings = prepare_pings(ride)
    total_m = ride.total_m
    if pings.empty:
        return {"trip_id": ride.trip_id, "has_data": False}

    t0, t1 = pings["recorded_at"].min(), pings["recorded_at"].max()
    dt = pings.groupby("user_id")["recorded_at"].diff().dt.total_seconds().clip(upper=120).fillna(0)
    riders = int(pings["user_id"].nunique())
    moving_s = float(dt[pings["kmh"] >= STOPPED_KMH].sum()) / riders
    stopped_s = float(dt[pings["kmh"] < STOPPED_KMH].sum()) / riders
    profile = speed_profile(pings, total_m)
    moving = pings.loc[pings["kmh"] >= STOPPED_KMH, "kmh"]

    return {
        "trip_id": ride.trip_id,
        "has_data": True,
        "summary": {
            "riders": riders,
            "distance_km": round(total_m / 1000, 1),
            "duration_min": round((t1 - t0).total_seconds() / 60),
            "moving_min": round(moving_s / 60),
            "stopped_min": round(stopped_s / 60),
            "avg_moving_kmh": round(float(moving.median()), 1) if len(moving) else 0,
            "planned_kmh": round(ride.planned_kmh, 1),
        },
        "speed_profile": [{"km": int(r.km), "kmh": None if np.isnan(r.kmh) else round(float(r.kmh), 1)} for r in profile.itertuples()],
        "slowest_stretches": slowest_stretches(profile),
        "stops": group_stops(rider_stops(pings), riders),
        "riders": rider_stats(pings, ride.members),
    }
