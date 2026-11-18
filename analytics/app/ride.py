"""In-memory shape of one trip, shared by the insights, the ETA model and the tests."""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from .geo import cumulative, haversine, project

PING_COLUMNS = ["user_id", "lat", "lng", "speed_kmh", "recorded_at", "accuracy", "heading"]
MEMBER_COLUMNS = ["user_id", "name", "arrived_at", "progress_m"]
STOPPED_KMH = 3.0


@dataclass
class Ride:
    trip_id: str
    name: str
    vehicle_type: str
    route: np.ndarray  # (N, 2) [lat, lng]
    planned_distance_m: float
    planned_duration_s: float
    status: str = "COMPLETED"
    started_at: pd.Timestamp | None = None
    ended_at: pd.Timestamp | None = None
    pings: pd.DataFrame = field(default_factory=lambda: pd.DataFrame(columns=PING_COLUMNS))
    members: pd.DataFrame = field(default_factory=lambda: pd.DataFrame(columns=MEMBER_COLUMNS))

    @property
    def planned_kmh(self) -> float:
        if self.planned_duration_s > 0:
            return self.planned_distance_m / self.planned_duration_s * 3.6
        return 40.0

    @property
    def total_m(self) -> float:
        return float(cumulative(self.route)[-1]) if len(self.route) > 1 else self.planned_distance_m


def prepare_pings(ride: Ride, clean: bool = True) -> pd.DataFrame:
    """
    Sorted pings with `along_m` (position on the route), `offset_m` and a cleaned `kmh`.

    With `clean` (default) every rider's track first goes through the Kalman filter +
    smoother in gps.py: outliers are dropped and positions de-noised before anything is
    measured. Raw positions stay in `raw_lat` / `raw_lng`.
    """
    from .gps import clean_pings  # local import: gps imports geo only, avoids a cycle

    df = ride.pings.copy()
    if df.empty:
        return df.assign(along_m=[], offset_m=[], kmh=[], raw_lat=[], raw_lng=[], gps_used=[])
    df["recorded_at"] = pd.to_datetime(df["recorded_at"], utc=True)
    df = df.sort_values(["user_id", "recorded_at"]).reset_index(drop=True)
    df["raw_lat"], df["raw_lng"] = df["lat"], df["lng"]
    reported = pd.to_numeric(df["speed_kmh"], errors="coerce")
    if clean:
        c = clean_pings(df)
        df["lat"], df["lng"], df["gps_used"], df["gps_sigma_m"] = c["clean_lat"], c["clean_lng"], c["gps_used"], c["gps_sigma_m"]
        filtered_kmh = c["clean_kmh"]
    else:
        df["gps_used"] = True
        filtered_kmh = None
    along, offset = project(df[["lat", "lng"]].to_numpy(), ride.route)
    df["along_m"] = along
    df["offset_m"] = offset

    g = df.groupby("user_id", sort=False)
    dt = g["recorded_at"].diff().dt.total_seconds()
    dist = haversine(g["lat"].shift(), g["lng"].shift(), df["lat"], df["lng"])
    derived = pd.Series(np.where(dt > 0, dist / dt * 3.6, np.nan), index=df.index)
    # The phone's own (Doppler) speed is the most accurate; then the filter's; then distance/time.
    best = reported.fillna(filtered_kmh) if filtered_kmh is not None else reported
    df["kmh"] = best.fillna(derived).fillna(0.0).clip(lower=0, upper=250)
    return df
