"""
Realistic synthetic ride histories.

Used to (1) bootstrap the ETA model before enough real trips are finished and
(2) give the tests rides with known stops and slow stretches. Every simulated ride has:
traffic that depends on the hour, slow ghat sections, whole-group stops where riders
wait for each other, rider-to-rider pace differences and GPS noise.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

from .geo import cumulative
from .ride import Ride

IST = ZoneInfo("Asia/Kolkata")
BASE_KMH = {"BIKE": 48, "CAR": 58, "BICYCLE": 18, "BUS": 42}
NAMES = ["Aarav", "Diya", "Kabir", "Meera", "Rohan", "Isha", "Vihaan", "Anaya", "Arjun", "Sara", "Neel", "Tara"]


def traffic_factor(hour: int) -> float:
    if 7 <= hour < 10:
        return 0.72
    if 17 <= hour < 20:
        return 0.68
    if hour >= 22 or hour < 5:
        return 1.08
    return 1.0


def make_route(rng: np.random.Generator, km: float, start=(18.52, 73.85), step_m: float = 250) -> np.ndarray:
    """A winding road: steps of `step_m` with gently changing heading."""
    n = max(2, int(km * 1000 / step_m) + 1)
    heading = rng.uniform(0, 2 * np.pi) + np.cumsum(rng.normal(0, 0.12, n))
    dlat = np.cos(heading) * step_m / 111_320
    dlng = np.sin(heading) * step_m / (111_320 * np.cos(np.radians(start[0])))
    lat = start[0] + np.concatenate([[0], np.cumsum(dlat[:-1])])
    lng = start[1] + np.concatenate([[0], np.cumsum(dlng[:-1])])
    return np.stack([lat, lng], axis=1)


@dataclass
class Scenario:
    """What actually happened on a simulated ride (so tests can check the insights)."""
    stops: list[tuple[float, float]]  # (along_m, minutes)
    slow: list[tuple[float, float, float]]  # (from_m, to_m, factor)


def simulate_ride(
    rng: np.random.Generator,
    *,
    vehicle: str = "BIKE",
    riders: int = 5,
    km: float = 60,
    depart: datetime | None = None,
    stops: list[tuple[float, float]] | None = None,
    slow: list[tuple[float, float, float]] | None = None,
    ping_every_s: int = 30,
    trip_id: str | None = None,
    gps_noise_m: float = 6.0,
    outlier_rate: float = 0.0,
) -> tuple[Ride, Scenario]:
    """
    GPS model: each phone's error drifts slowly (AR(1) with a ~20 s memory, like real
    GNSS), the phone reports an accuracy close to its real error, and with `outlier_rate`
    a fix jumps 80-400 m (multipath near buildings / under flyovers) - half of those
    jumps come with an honest, large accuracy, half pretend to be accurate.
    The true position is kept in `true_lat` / `true_lng` so accuracy can be measured.
    """
    depart = depart or datetime(2026, 10, 4, 6, 30, tzinfo=timezone.utc)
    route = make_route(rng, km)
    cum = cumulative(route)
    total = float(cum[-1])
    base = BASE_KMH[vehicle]

    if slow is None:
        slow = []
        for _ in range(rng.integers(0, 3)):
            a = rng.uniform(0.1, 0.8) * total
            slow.append((a, min(total, a + rng.uniform(3000, 9000)), rng.uniform(0.45, 0.7)))
    if stops is None:
        stops = sorted((rng.uniform(0.15, 0.85) * total, float(rng.uniform(8, 35))) for _ in range(rng.integers(0, 4)))

    pace = np.clip(rng.normal(1.0, 0.08, riders), 0.8, 1.2)
    pace[0] = max(pace)  # the leader sets the pace
    user_ids = [str(uuid.uuid4()) for _ in range(riders)]
    names = list(rng.choice(NAMES, riders, replace=False))

    along = np.zeros(riders)
    start_lag = np.concatenate([[0], rng.uniform(0, 90, riders - 1)])  # seconds
    stop_idx = np.zeros(riders, dtype=int)  # next stop each rider is heading to
    at_stop_since: dict[int, dict[int, float]] = {}  # stop -> {rider: seconds}
    leave_at: dict[int, float] = {}
    arrived = np.full(riders, np.nan)

    rows = []
    t = 0.0
    rho = float(np.exp(-ping_every_s / 20))
    err = rng.normal(0, gps_noise_m, (riders, 2))  # metres north, east
    while np.isnan(arrived).any() and t < 24 * 3600:
        hour = (depart + timedelta(seconds=t)).astimezone(IST).hour  # traffic follows local time
        for r in range(riders):
            if not np.isnan(arrived[r]) or t < start_lag[r]:
                continue
            k = stop_idx[r]
            waiting = k < len(stops) and r in at_stop_since.get(k, {})
            if waiting:
                if k in leave_at and t >= leave_at[k]:
                    stop_idx[r] += 1
                    waiting = False
                else:
                    kmh = 0.0
            if not waiting:
                factor = traffic_factor(hour) * pace[r] * float(np.clip(rng.normal(1, 0.12), 0.6, 1.4))
                for a, b, f in slow:
                    if a <= along[r] < b:
                        factor *= f
                kmh = base * factor
                along[r] += kmh / 3.6 * ping_every_s
                k = stop_idx[r]
                if k < len(stops) and along[r] >= stops[k][0]:
                    along[r] = stops[k][0]
                    at_stop_since.setdefault(k, {})[r] = t
                    if len(at_stop_since[k]) == riders:  # everyone's here: rest, then go together
                        leave_at[k] = t + stops[k][1] * 60
                if along[r] >= total:
                    along[r] = total
                    arrived[r] = t
            pos = np.interp(along[r], cum, np.arange(len(route)))
            i = min(int(pos), len(route) - 2)
            frac = pos - i
            true_lat, true_lng = route[i] + (route[i + 1] - route[i]) * frac
            err[r] = rho * err[r] + np.sqrt(1 - rho**2) * rng.normal(0, gps_noise_m, 2)
            north, east = err[r]
            accuracy = max(3.0, float(np.hypot(north, east) * rng.uniform(0.8, 1.6) + rng.uniform(2, 5)))
            if rng.random() < outlier_rate:
                ang, jump = rng.uniform(0, 2 * np.pi), rng.uniform(80, 400)
                north, east = north + jump * np.cos(ang), east + jump * np.sin(ang)
                if rng.random() < 0.5:
                    accuracy = jump * rng.uniform(0.6, 1.2)
            lat = true_lat + north / 111_320
            lng = true_lng + east / (111_320 * np.cos(np.radians(true_lat)))
            d = route[i + 1] - route[i]
            bearing = float(np.degrees(np.arctan2(d[1] * np.cos(np.radians(true_lat)), d[0])) % 360)
            reported = None if rng.random() < 0.1 else max(0.0, kmh + rng.normal(0, 1.5))
            heading = None if reported is None or kmh < 3 else float((bearing + rng.normal(0, 5)) % 360)
            rows.append((user_ids[r], lat, lng, reported, depart + timedelta(seconds=t), accuracy, heading, true_lat, true_lng))
        t += ping_every_s

    pings = pd.DataFrame(rows, columns=["user_id", "lat", "lng", "speed_kmh", "recorded_at", "accuracy", "heading", "true_lat", "true_lng"])
    pings["recorded_at"] = pd.to_datetime(pings["recorded_at"], utc=True)
    members = pd.DataFrame(
        {
            "user_id": user_ids,
            "name": names,
            "arrived_at": [depart + timedelta(seconds=float(a)) for a in arrived],
            "progress_m": along,
        }
    )
    ride = Ride(
        trip_id=trip_id or str(uuid.uuid4()),
        name=f"Simulated {vehicle.lower()} ride ({km:.0f} km)",
        vehicle_type=vehicle,
        route=route,
        planned_distance_m=total,
        planned_duration_s=total / (base / 3.6),
        status="COMPLETED",
        started_at=pd.Timestamp(depart),
        ended_at=pd.Timestamp(depart + timedelta(seconds=float(np.nanmax(arrived)))),
        pings=pings,
        members=members,
    )
    return ride, Scenario(stops=stops, slow=slow)


def random_ride(rng: np.random.Generator) -> Ride:
    vehicle = rng.choice(["BIKE", "BIKE", "CAR", "BICYCLE", "BUS"])
    km = {"BICYCLE": rng.uniform(15, 45)}.get(vehicle, rng.uniform(25, 140))
    day = datetime(2026, 1, 1, tzinfo=IST) + timedelta(days=int(rng.integers(0, 300)))
    depart = day.replace(hour=int(rng.integers(5, 19)), minute=int(rng.integers(0, 60))).astimezone(timezone.utc)
    ride, _ = simulate_ride(rng, vehicle=str(vehicle), riders=int(rng.integers(3, 8)), km=float(km), depart=depart, ping_every_s=30)
    return ride
