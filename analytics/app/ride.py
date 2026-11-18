"""In-memory shape of one trip, shared by the insights, the ETA model and the tests."""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from .geo import cumulative, haversine, project

PING_COLUMNS = ["user_id", "lat", "lng", "speed_kmh", "recorded_at"]
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


def prepare_pings(ride: Ride) -> pd.DataFrame:
    """
    Sorted pings with `along_m` (position on the route), `offset_m` and a cleaned
    `kmh`: the device speed when reported, otherwise worked out from consecutive fixes.
    """
    df = ride.pings.copy()
    if df.empty:
        return df.assign(along_m=[], offset_m=[], kmh=[])
    df["recorded_at"] = pd.to_datetime(df["recorded_at"], utc=True)
    df = df.sort_values(["user_id", "recorded_at"]).reset_index(drop=True)
    along, offset = project(df[["lat", "lng"]].to_numpy(), ride.route)
    df["along_m"] = along
    df["offset_m"] = offset

    g = df.groupby("user_id", sort=False)
    dt = g["recorded_at"].diff().dt.total_seconds()
    dist = haversine(g["lat"].shift(), g["lng"].shift(), df["lat"], df["lng"])
    derived = pd.Series(np.where(dt > 0, dist / dt * 3.6, np.nan), index=df.index)
    reported = pd.to_numeric(df["speed_kmh"], errors="coerce")
    df["kmh"] = reported.fillna(derived).fillna(0.0).clip(lower=0, upper=250)
    return df
