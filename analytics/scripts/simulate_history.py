"""
Fill the database with simulated finished rides so the ETA model has history to learn from.

    python -m scripts.simulate_history --trips 60          # add 60 rides
    python -m scripts.simulate_history --remove            # delete all simulated rides

Simulated trips are clearly marked ("[Sim]" in the name, admin sim-admin@navnet.dev) and
can be removed at any time. Once enough real trips are finished, retrain without them.
"""
from __future__ import annotations

import argparse
import io
import json
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import numpy as np
from sqlalchemy import text

from app.db import get_engine
from app.simulate import random_ride

SIM_ADMIN_EMAIL = "sim-admin@navnet.dev"
# bcrypt hash of a random string: these accounts can't be logged into.
NO_LOGIN_HASH = "$2a$10$7EqJtq98hPqEX7fNZaFWoOhi5BWX4Z1sEzVxxYi6gqh8G2qGzD6fK"


def upsert_user(c, email: str, name: str, role: str = "USER") -> str:
    row = c.execute(text('SELECT id FROM "User" WHERE email = :e'), {"e": email}).first()
    if row:
        return row[0]
    uid = str(uuid.uuid4())
    c.execute(
        text('INSERT INTO "User" (id, name, email, "passwordHash", role, "createdAt", "updatedAt") VALUES (:id, :n, :e, :h, CAST(:r AS "Role"), now(), now())'),
        {"id": uid, "n": name, "e": email, "h": NO_LOGIN_HASH, "r": role},
    )
    return uid


def insert(trips: int, seed: int) -> None:
    rng = np.random.default_rng(seed)
    engine = get_engine()
    with engine.begin() as c:
        admin = upsert_user(c, SIM_ADMIN_EMAIL, "Simulation", "ADMIN")
        for n in range(trips):
            ride = random_ride(rng)
            # Real accounts for the simulated riders (reused across rides, like a real club).
            ids = {}
            for i, (uid, name) in enumerate(zip(ride.members["user_id"], ride.members["name"])):
                ids[uid] = upsert_user(c, f"sim-{str(name).lower()}@navnet.dev", f"{name} (sim)")
            route = ride.route.round(6).tolist()
            dep = ride.started_at.to_pydatetime()
            c.execute(
                text(
                    'INSERT INTO "Trip" (id, "groupCode", "passwordHash", name, description, "adminId", "startName", "startLat", "startLng", '
                    '"destName", "destLat", "destLng", "routeGeometry", "routeDistance", "routeDuration", "routeProvider", "vehicleType", '
                    '"departureTime", "expectedArrival", status, "startedAt", "endedAt", "createdAt", "updatedAt") VALUES '
                    '(:id, :code, :pw, :name, :desc, :admin, :sn, :slat, :slng, :dn, :dlat, :dlng, CAST(:geom AS jsonb), :dist, :dur, \'sim\', '
                    'CAST(:veh AS "VehicleType"), :dep, :eta, \'COMPLETED\', :dep, :end, :dep, now())'
                ),
                {
                    "id": ride.trip_id, "code": f"SIM{secrets.token_hex(3).upper()}", "pw": NO_LOGIN_HASH,
                    "name": f"[Sim] {ride.name}", "desc": "Simulated ride history for the ETA model", "admin": admin,
                    "sn": "Simulated start", "slat": route[0][0], "slng": route[0][1],
                    "dn": "Simulated destination", "dlat": route[-1][0], "dlng": route[-1][1],
                    "geom": json.dumps(route), "dist": ride.planned_distance_m, "dur": ride.planned_duration_s,
                    "veh": ride.vehicle_type, "dep": dep, "eta": dep + timedelta(seconds=ride.planned_duration_s),
                    "end": ride.ended_at.to_pydatetime(),
                },
            )
            for m in ride.members.itertuples():
                c.execute(
                    text('INSERT INTO "TripMember" (id, "tripId", "userId", "joinedAt", "progressMeters", "maxProgressMeters", "arrivedAt") VALUES (:id, :t, :u, :j, :p, :p, :a)'),
                    {"id": str(uuid.uuid4()), "t": ride.trip_id, "u": ids[m.user_id], "j": dep, "p": float(m.progress_m), "a": m.arrived_at},
                )
            # Bulk-load the GPS pings with COPY (tens of thousands of rows).
            buf = io.StringIO()
            for p in ride.pings.itertuples():
                speed = "" if p.speed_kmh is None or np.isnan(p.speed_kmh) else f"{p.speed_kmh:.2f}"
                buf.write(f"{ride.trip_id}\t{ids[p.user_id]}\t{p.lat:.7f}\t{p.lng:.7f}\t{speed or chr(92) + 'N'}\t{p.recorded_at.isoformat()}\n")
            raw = c.connection.driver_connection
            with raw.cursor().copy('COPY "LocationPing" ("tripId", "userId", lat, lng, speed, "recordedAt") FROM STDIN') as cp:
                cp.write(buf.getvalue())
            print(f"  {n + 1}/{trips}  {ride.name}: {len(ride.pings)} GPS points")
    print(f"Added {trips} simulated rides. Train the model: POST /model/train (or restart the service).")


def remove() -> None:
    with get_engine().begin() as c:
        n = c.execute(text('DELETE FROM "Trip" WHERE "adminId" IN (SELECT id FROM "User" WHERE email = :e)'), {"e": SIM_ADMIN_EMAIL}).rowcount
        c.execute(text('DELETE FROM "User" WHERE email LIKE \'sim-%@navnet.dev\''))
    print(f"Removed {n} simulated rides.")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--trips", type=int, default=60)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--remove", action="store_true")
    a = ap.parse_args()
    remove() if a.remove else insert(a.trips, a.seed)
