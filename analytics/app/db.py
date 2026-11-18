"""Read-only access to NavNet's PostgreSQL database (the API owns the schema via Prisma)."""
from __future__ import annotations

from functools import lru_cache

import numpy as np
import pandas as pd
from sqlalchemy import Engine, create_engine, text

from .config import get_settings
from .ride import MEMBER_COLUMNS, PING_COLUMNS, Ride

TRIP_SQL = text(
    'SELECT id, name, "vehicleType" AS vehicle_type, "routeGeometry" AS route, "routeDistance" AS distance, '
    '"routeDuration" AS duration, status, "startedAt" AS started_at, "endedAt" AS ended_at FROM "Trip" WHERE id = :id'
)
PINGS_SQL = text(
    'SELECT "userId" AS user_id, lat, lng, speed AS speed_kmh, "recordedAt" AS recorded_at '
    'FROM "LocationPing" WHERE "tripId" = :id ORDER BY "recordedAt"'
)
MEMBERS_SQL = text(
    'SELECT m."userId" AS user_id, u.name, m."arrivedAt" AS arrived_at, m."progressMeters" AS progress_m '
    'FROM "TripMember" m JOIN "User" u ON u.id = m."userId" WHERE m."tripId" = :id'
)
FINISHED_SQL = text(
    'SELECT t.id FROM "Trip" t WHERE t.status = \'COMPLETED\' '
    'AND (SELECT count(*) FROM "LocationPing" p WHERE p."tripId" = t.id) >= 20 '
    'ORDER BY t."endedAt" DESC NULLS LAST LIMIT :limit'
)


class Repository:
    def __init__(self, engine: Engine):
        self.engine = engine

    def load_ride(self, trip_id: str) -> Ride | None:
        with self.engine.connect() as c:
            trip = c.execute(TRIP_SQL, {"id": trip_id}).mappings().first()
            if trip is None:
                return None
            pings = pd.read_sql(PINGS_SQL, c, params={"id": trip_id})
            members = pd.read_sql(MEMBERS_SQL, c, params={"id": trip_id})
        return Ride(
            trip_id=trip["id"],
            name=trip["name"],
            vehicle_type=str(trip["vehicle_type"]),
            route=np.asarray(trip["route"] or [], dtype=float).reshape(-1, 2),
            planned_distance_m=float(trip["distance"] or 0),
            planned_duration_s=float(trip["duration"] or 0),
            status=str(trip["status"]),
            started_at=pd.Timestamp(trip["started_at"]) if trip["started_at"] else None,
            ended_at=pd.Timestamp(trip["ended_at"]) if trip["ended_at"] else None,
            pings=pings.reindex(columns=PING_COLUMNS),
            members=members.reindex(columns=MEMBER_COLUMNS),
        )

    def finished_trip_ids(self, limit: int = 1000) -> list[str]:
        with self.engine.connect() as c:
            return [r[0] for r in c.execute(FINISHED_SQL, {"limit": limit})]

    def finished_rides(self, limit: int = 1000) -> list[Ride]:
        return [r for r in (self.load_ride(i) for i in self.finished_trip_ids(limit)) if r is not None]


@lru_cache
def get_engine() -> Engine:
    return create_engine(get_settings().sqlalchemy_url, pool_pre_ping=True, pool_size=5)


def get_repository() -> Repository:
    return Repository(get_engine())
