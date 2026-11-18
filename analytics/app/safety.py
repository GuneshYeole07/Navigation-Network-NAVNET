"""
Live safety monitor: watches every rider's positions as they arrive and raises alerts the
fixed rules on the API can't express.

* POSSIBLE_CRASH - a hard stop from speed (deceleration well beyond normal braking),
  then no movement for 75 s, away from any planned place and with no other rider of the
  group beside them. If the phone goes silent right after the hard stop, that's treated
  the same way.
* WEAK_GPS - the rider's phone has reported poor accuracy (median > 60 m) for two
  minutes, so their dot on the map shouldn't be trusted to the metre.
* UNUSUAL_MOVEMENT - an IsolationForest (scikit-learn) plus a per-feature envelope, both
  trained on simulated normal riding, score each rider's last minute of movement (speed,
  its variation, hardest acceleration, how fast the heading changes, time stopped). Three
  unusual minutes in a row raise the alert: circling, erratic stop-go, etc.

These are prompts for the captain to check on someone, never conclusions; the message says
what was seen. The monitor is fed by Postgres NOTIFY (see safety_stream.py) and is pure
Python here so it can be tested without a database.
"""
from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from .geo import haversine

# Crash
CRASH_FROM_KMH = 25.0  # only stops from at least this speed
CRASH_DECEL_MS2 = 3.0  # m/s², measured between pings ~3 s apart: ordinary stops are ~1-2
CRASH_STILL_S = 75.0  # ...and then no movement for longer than a long red light
CRASH_MOVED_M = 40.0  # moving more than this cancels it
# Weak GPS
WEAK_GPS_M = 60.0
WEAK_GPS_WINDOW_S = 120.0
# Unusual movement
WINDOW_S = 60.0
ANOMALY_EVERY_S = 20.0
ANOMALY_RUN = 3
COOLDOWN_S = {"POSSIBLE_CRASH": 600, "WEAK_GPS": 900, "UNUSUAL_MOVEMENT": 900}

FEATURES = ["mean_kmh", "std_kmh", "max_accel", "turn_rate", "stopped_frac", "range_kmh"]


@dataclass
class Alert:
    type: str
    trip_id: str
    user_id: str
    message: str
    data: dict = field(default_factory=dict)

    def payload(self) -> dict:
        return {"tripId": self.trip_id, "userId": self.user_id, "type": self.type, "message": self.message, "data": self.data}


@dataclass
class _Rider:
    name: str
    pings: deque = field(default_factory=lambda: deque(maxlen=400))
    crash: dict | None = None
    anomaly_run: int = 0
    last_scored: float = 0.0
    last_alert: dict = field(default_factory=dict)
    last_seen: float = 0.0


def window_features(pings: list[dict]) -> dict | None:
    """Movement features over a window of pings (dicts with t [s], speed [km/h], heading)."""
    if len(pings) < 6:
        return None
    t = np.array([p["t"] for p in pings], float)
    if t[-1] - t[0] < WINDOW_S * 0.6:
        return None
    v = np.array([p.get("speed") if p.get("speed") is not None else np.nan for p in pings], float)
    if np.isnan(v).mean() > 0.5:
        return None
    v = np.where(np.isnan(v), np.nanmean(v), v)
    dt = np.diff(t)
    ok = dt > 0.5
    accel = np.abs(np.diff(v / 3.6))[ok] / dt[ok] if ok.any() else np.array([0.0])
    h = np.array([p.get("heading") if p.get("heading") is not None else np.nan for p in pings], float)
    dh = np.abs((np.diff(h) + 180) % 360 - 180)
    moving = (v[1:] > 8) & ~np.isnan(dh) & ok
    turn = float(np.sum(dh[moving]) / np.sum(dt[moving])) if moving.sum() >= 3 else 0.0
    return {
        "mean_kmh": float(np.mean(v)),
        "std_kmh": float(np.std(v)),
        "max_accel": float(np.percentile(accel, 90)) if len(accel) else 0.0,
        "turn_rate": turn,
        "stopped_frac": float(np.mean(v < 3)),
        "range_kmh": float(np.max(v) - np.min(v)),
    }


def train_anomaly_model(rides: int = 40, seed: int = 0):
    """IsolationForest on one-minute windows of simulated normal group rides."""
    from sklearn.ensemble import IsolationForest

    from .simulate import simulate_ride

    rng = np.random.default_rng(seed)
    rows = []
    for _ in range(rides):
        vehicle = rng.choice(["BIKE", "CAR", "BUS", "BICYCLE"])
        ride, _ = simulate_ride(rng, vehicle=vehicle, km=float(rng.uniform(8, 25)), riders=3, ping_every_s=3, gps_noise_m=8)
        p = ride.pings.sort_values("recorded_at")
        for _, g in p.groupby("user_id"):
            t = (g.recorded_at - g.recorded_at.iloc[0]).dt.total_seconds().to_numpy()
            recs = [{"t": a, "speed": None if np.isnan(b) else b, "heading": None if np.isnan(c) else c} for a, b, c in zip(t, g.speed_kmh.to_numpy(float), g.heading.to_numpy(float))]
            for start in np.arange(0, t[-1] - WINDOW_S, ANOMALY_EVERY_S):
                w = [r for r in recs if start <= r["t"] < start + WINDOW_S]
                f = window_features(w)
                if f:
                    rows.append([f[k] for k in FEATURES])
    X = np.array(rows)
    return AnomalyModel(IsolationForest(n_estimators=200, contamination=0.005, random_state=seed).fit(X), X)


class AnomalyModel:
    """IsolationForest for unusual *combinations*, plus a per-feature envelope for a single
    feature far outside anything seen in normal riding (forests isolate those less reliably
    when only one of six features is off, e.g. constant circling at steady speed)."""

    def __init__(self, forest, X: np.ndarray):
        self.forest = forest
        lo, hi = np.percentile(X, 0.1, axis=0), np.percentile(X, 99.9, axis=0)
        span = np.maximum(hi - lo, 1e-6)
        self.lo, self.hi = lo - span, hi + span
        self.n_train = len(X)

    def predict(self, X: np.ndarray) -> np.ndarray:
        out = self.forest.predict(X)
        outside = ((X < self.lo) | (X > self.hi)).any(axis=1)
        return np.where(outside, -1, out)


class SafetyMonitor:
    def __init__(self, anomaly_model=None):
        self.model = anomaly_model
        self.riders: dict[tuple[str, str], _Rider] = {}
        self.stats = {"pings": 0, "alerts": 0}

    # ── public ──
    def feed(self, p: dict) -> list[Alert]:
        """One position (the NOTIFY payload: tripId, userId, name, t [ms], lat, lng, speed
        [km/h], heading, accuracy, nearPlace)."""
        self.stats["pings"] += 1
        key = (p["tripId"], p["userId"])
        r = self.riders.setdefault(key, _Rider(name=p.get("name") or "A rider"))
        ping = {**p, "t": float(p["t"]) / 1000.0}
        if r.pings and ping["t"] <= r.pings[-1]["t"]:
            return []  # late / duplicate
        r.pings.append(ping)
        r.last_seen = ping["t"]
        while r.pings and ping["t"] - r.pings[0]["t"] > 180:
            r.pings.popleft()
        out = []
        out += self._crash(key, r, ping)
        out += self._weak_gps(key, r, ping)
        out += self._unusual(key, r, ping)
        return out

    def sweep(self, now_s: float) -> list[Alert]:
        """Call every few seconds: catches a phone that went silent right after a hard stop."""
        out = []
        for key, r in self.riders.items():
            c = r.crash
            if c and not c.get("raised") and now_s - c["at"] >= CRASH_STILL_S and now_s - r.last_seen >= CRASH_STILL_S * 0.5 and not self._buddy_near(key, r.pings[-1]):
                c["raised"] = True
                out += self._raise(key, r, "POSSIBLE_CRASH", now_s, f"{r.name} stopped suddenly from {c['from_kmh']:.0f} km/h and their phone went silent. Call them now.", {"fromKmh": round(c["from_kmh"]), "lat": c["lat"], "lng": c["lng"], "silent": True})
        # Forget riders not heard from for an hour.
        for key in [k for k, r in self.riders.items() if now_s - r.last_seen > 3600]:
            del self.riders[key]
        return out

    def _buddy_near(self, key, p: dict) -> bool:
        """Another rider of the same trip is right there (and so can help / it's a group stop)."""
        for (trip, user), o in self.riders.items():
            if trip == key[0] and user != key[1] and o.pings:
                q = o.pings[-1]
                if abs(q["t"] - p["t"]) <= 30 and haversine(q["lat"], q["lng"], p["lat"], p["lng"]) <= 150:
                    return True
        return False

    # ── rules ──
    def _crash(self, key, r: _Rider, p: dict) -> list[Alert]:
        v = p.get("speed")
        if v is None:
            return []
        c = r.crash
        if c:
            moved = haversine(c["lat"], c["lng"], p["lat"], p["lng"])
            if v > 8 or moved > CRASH_MOVED_M:
                r.crash = None  # they rode on
                return []
            if not c.get("raised") and p["t"] - c["at"] >= CRASH_STILL_S and not self._buddy_near(key, p):
                c["raised"] = True
                still = p["t"] - c["at"]
                return self._raise(key, r, "POSSIBLE_CRASH", p["t"], f"{r.name} stopped suddenly from {c['from_kmh']:.0f} km/h and hasn't moved for {still:.0f} s. Check on them.", {"fromKmh": round(c["from_kmh"]), "stillS": round(still), "lat": c["lat"], "lng": c["lng"]})
            return []
        if v >= 5 or p.get("nearPlace"):
            return []
        # Fastest recent ping in the last 10 s, and how hard the speed dropped from it.
        recent = [q for q in list(r.pings)[:-1] if p["t"] - q["t"] <= 10 and q.get("speed") is not None]
        if not recent:
            return []
        # Hardest deceleration from any recent ping at speed to now.
        best = max(
            ((((q["speed"] - v) / 3.6) / (p["t"] - q["t"]), q) for q in recent if q["speed"] >= CRASH_FROM_KMH and p["t"] > q["t"]),
            key=lambda d: d[0],
            default=None,
        )
        if best and best[0] >= CRASH_DECEL_MS2:
            r.crash = {"at": p["t"], "from_kmh": best[1]["speed"], "decel": best[0], "lat": p["lat"], "lng": p["lng"]}
        return []

    def _weak_gps(self, key, r: _Rider, p: dict) -> list[Alert]:
        w = [q["accuracy"] for q in r.pings if p["t"] - q["t"] <= WEAK_GPS_WINDOW_S and q.get("accuracy")]
        span = p["t"] - next((q["t"] for q in r.pings if p["t"] - q["t"] <= WEAK_GPS_WINDOW_S), p["t"])
        if len(w) >= 5 and span >= WEAK_GPS_WINDOW_S * 0.75 and np.median(w) > WEAK_GPS_M:
            med = float(np.median(w))
            return self._raise(key, r, "WEAK_GPS", p["t"], f"{r.name}'s GPS has been weak for 2 min (±{med:.0f} m). Their position may be off.", {"medianAccuracyM": round(med)})
        return []

    def _unusual(self, key, r: _Rider, p: dict) -> list[Alert]:
        if self.model is None or p["t"] - r.last_scored < ANOMALY_EVERY_S:
            return []
        w = [q for q in r.pings if p["t"] - q["t"] <= WINDOW_S]
        f = window_features(w)
        if f is None:
            return []
        r.last_scored = p["t"]
        x = np.array([[f[k] for k in FEATURES]])
        unusual = self.model.predict(x)[0] == -1
        r.anomaly_run = r.anomaly_run + 1 if unusual else 0
        if r.anomaly_run >= ANOMALY_RUN:
            r.anomaly_run = 0
            what = describe(f)
            return self._raise(key, r, "UNUSUAL_MOVEMENT", p["t"], f"{r.name} has been moving unusually for the last minute ({what}). Worth a check.", {k: round(v, 2) for k, v in f.items()})
        return []

    def _raise(self, key, r: _Rider, type_: str, t: float, message: str, data: dict) -> list[Alert]:
        last = r.last_alert.get(type_)
        if last is not None and t - last < COOLDOWN_S[type_]:
            return []
        r.last_alert[type_] = t
        self.stats["alerts"] += 1
        return [Alert(type_, key[0], key[1], message, data)]


def describe(f: dict) -> str:
    """Plain words for what made a window unusual."""
    if f["turn_rate"] > 20:
        return "turning constantly, like circling"
    if f["std_kmh"] > 15 or f["range_kmh"] > 45:
        return "speeding up and braking hard, over and over"
    if f["max_accel"] > 3:
        return "very hard acceleration"
    return "speed and direction unlike normal riding"


def load_or_train(path: Path):
    import joblib

    if path.exists():
        try:
            return joblib.load(path)
        except Exception as e:  # noqa: BLE001 - a corrupt/old file: retrain
            import logging

            logging.getLogger("navnet.safety").warning("retraining safety model: %s", e)
    model = train_anomaly_model()
    path.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, path)
    return model
