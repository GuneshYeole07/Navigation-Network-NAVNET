"""
Machine-learned arrival time for the group.

The fixed estimate ("remaining distance ÷ planned speed") ignores traffic at that hour,
slow ghat sections, how fast this group actually rides and the stops still to come.
This model learns those from finished trips: for every 2 minutes of every past ride it
records the situation (features) and how long the group really took from there (target).
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.model_selection import GroupKFold

from .ride import Ride, prepare_pings

log = logging.getLogger("navnet.analytics")

TICK = "2min"
ARRIVE_M = 150
VEHICLES = ["BIKE", "CAR", "BICYCLE", "BUS", "WALKING", "MIXED"]
FEATURES = [
    "remaining_km",
    "progress_frac",
    "elapsed_min",
    "recent_kmh",
    "avg_kmh_so_far",
    "planned_kmh",
    "hour",
    "weekend",
    "riders",
    "stops_so_far",
    "stopped_now",
    *[f"vehicle_{v.lower()}" for v in VEHICLES],
]


def group_progress(ride: Ride, pings: pd.DataFrame | None = None) -> pd.Series:
    """Median rider's distance along the route, on a regular 1-minute clock."""
    pings = prepare_pings(ride) if pings is None else pings
    if pings.empty:
        return pd.Series(dtype=float)
    # Progress only moves forward (GPS jitter can snap a point slightly backwards).
    best = pings.groupby("user_id")["along_m"].cummax()
    per_min = pings.assign(best=best, minute=pings["recorded_at"].dt.floor("min")).groupby(["minute", "user_id"])["best"].max().unstack()
    full = pd.date_range(per_min.index.min(), per_min.index.max(), freq="min")
    return per_min.reindex(full).ffill().median(axis=1).cummax()


def timeline_features(ride: Ride, progress: pd.Series) -> pd.DataFrame:
    """Features at every TICK of the ride (only using what was known at that moment)."""
    if progress.empty:
        return pd.DataFrame(columns=FEATURES + ["at"])
    total = ride.total_m
    start = progress.index[0]
    ticks = progress.resample(TICK).last().dropna()
    ten_ago = progress.reindex(ticks.index - pd.Timedelta(minutes=10), method="ffill").to_numpy()
    two_ago = progress.reindex(ticks.index - pd.Timedelta(minutes=2), method="ffill").to_numpy()
    ten_ago = np.where(np.isnan(ten_ago), progress.iloc[0], ten_ago)
    two_ago = np.where(np.isnan(two_ago), progress.iloc[0], two_ago)

    # Group stops so far: runs of >= 3 minutes where the median rider moved < 40 m/min.
    still = (progress.diff().fillna(0) < 40).astype(int)
    run_start = (still.diff().fillna(still.iloc[0]) == 1).cumsum() * still
    run_len = still.groupby(run_start).cumcount() + 1
    stop_started = ((run_len == 3) & (still == 1)).cumsum()

    elapsed = (ticks.index - start).total_seconds() / 60
    df = pd.DataFrame(
        {
            "at": ticks.index,
            "remaining_km": np.maximum(0, total - ticks.to_numpy()) / 1000,
            "progress_frac": np.clip(ticks.to_numpy() / total, 0, 1) if total else 0,
            "elapsed_min": elapsed,
            "recent_kmh": (ticks.to_numpy() - ten_ago) / 1000 / (10 / 60),
            "avg_kmh_so_far": np.where(elapsed > 0, ticks.to_numpy() / 1000 / np.maximum(elapsed, 1e-6) * 60, 0),
            "planned_kmh": ride.planned_kmh,
            "hour": ticks.index.tz_convert("Asia/Kolkata").hour if ticks.index.tz is not None else ticks.index.hour,
            "weekend": (ticks.index.day_of_week >= 5).astype(int),
            "riders": int(ride.pings["user_id"].nunique()) if not ride.pings.empty else 1,
            "stops_so_far": stop_started.reindex(ticks.index, method="ffill").fillna(0).to_numpy(),
            "stopped_now": ((ticks.to_numpy() - two_ago) < 100).astype(int),
        }
    )
    for v in VEHICLES:
        df[f"vehicle_{v.lower()}"] = int(ride.vehicle_type == v)
    return df


def training_samples(ride: Ride) -> pd.DataFrame:
    """Features + the real minutes left to arrival, for one finished ride."""
    progress = group_progress(ride)
    if progress.empty:
        return pd.DataFrame()
    done = progress[progress >= ride.total_m - ARRIVE_M]
    if done.empty:  # the group never finished this route
        return pd.DataFrame()
    arrival = done.index[0]
    feats = timeline_features(ride, progress)
    feats = feats[(feats["at"] < arrival) & (feats["remaining_km"] > 0.5)].copy()
    feats["minutes_left"] = (arrival - feats["at"]).dt.total_seconds() / 60
    feats["trip_id"] = ride.trip_id
    return feats


def baseline_minutes(features: pd.DataFrame) -> np.ndarray:
    """What NavNet did before: remaining distance at the planned speed."""
    return features["remaining_km"].to_numpy() / np.maximum(features["planned_kmh"].to_numpy(), 1) * 60


@dataclass
class EtaModel:
    model: HistGradientBoostingRegressor | None = None
    metrics: dict | None = None

    @property
    def ready(self) -> bool:
        return self.model is not None

    @staticmethod
    def _new(seed: int) -> HistGradientBoostingRegressor:
        return HistGradientBoostingRegressor(max_iter=400, learning_rate=0.05, max_leaf_nodes=31, l2_regularization=1.0, random_state=seed)

    def fit(self, rides: list[Ride], seed: int = 7) -> dict:
        samples = pd.concat([s for s in (training_samples(r) for r in rides) if not s.empty], ignore_index=True)
        if samples.empty or samples["trip_id"].nunique() < 5:
            raise ValueError("Need at least 5 finished trips with GPS history to train")
        X, y, groups = samples[FEATURES], samples["minutes_left"], samples["trip_id"]

        # Evaluate on trips the model has never seen: k-fold split by trip, not by row
        # (rows from the same ride are near-duplicates and would flatter the score).
        folds = min(5, groups.nunique())
        errs_model, errs_base = [], []
        for train_idx, test_idx in GroupKFold(n_splits=folds).split(X, y, groups):
            m = self._new(seed).fit(X.iloc[train_idx], y.iloc[train_idx])
            truth = y.iloc[test_idx].to_numpy()
            errs_model.append(np.abs(m.predict(X.iloc[test_idx]) - truth))
            errs_base.append(np.abs(baseline_minutes(X.iloc[test_idx]) - truth))
        mae_model = float(np.mean(np.concatenate(errs_model)))
        mae_base = float(np.mean(np.concatenate(errs_base)))

        # Final model uses every trip.
        self.model = self._new(seed).fit(X, y)
        self.metrics = {
            "trained_at": datetime.now(timezone.utc).isoformat(),
            "trips": int(groups.nunique()),
            "samples": int(len(samples)),
            "cv_folds": folds,
            "mae_minutes": round(mae_model, 2),
            "baseline_mae_minutes": round(mae_base, 2),
            "improvement_pct": round((1 - mae_model / mae_base) * 100, 1) if mae_base else 0.0,
        }
        return self.metrics

    def predict_minutes(self, features: pd.DataFrame) -> np.ndarray:
        if not self.ready:
            return baseline_minutes(features)
        return np.maximum(0, self.model.predict(features[FEATURES]))

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump({"model": self.model, "metrics": self.metrics, "features": FEATURES}, path)

    @classmethod
    def load(cls, path: Path) -> "EtaModel":
        if not path.exists():
            return cls()
        try:
            data = joblib.load(path)
        except Exception as e:  # corrupt file or saved by another scikit-learn/NumPy version
            log.warning("Ignoring saved ETA model %s (%s); it will be retrained", path, e)
            return cls()
        if not isinstance(data, dict) or data.get("features") != FEATURES:  # older feature set
            return cls()
        return cls(model=data["model"], metrics=data["metrics"])


def live_eta(ride: Ride, model: EtaModel, now: datetime | None = None) -> dict:
    """Arrival estimate for a trip in progress, from its GPS history so far."""
    progress = group_progress(ride)
    if progress.empty:
        return {"available": False, "reason": "No GPS data yet"}
    feats = timeline_features(ride, progress).tail(1)
    remaining_km = float(feats["remaining_km"].iloc[0])
    if remaining_km * 1000 <= ARRIVE_M:
        return {"available": True, "minutes_left": 0, "remaining_km": 0.0, "source": "arrived"}
    minutes = float(model.predict_minutes(feats)[0])
    base = float(baseline_minutes(feats)[0])
    as_of = feats["at"].iloc[0].to_pydatetime()
    now = now or datetime.now(timezone.utc)
    stale_min = (now - as_of).total_seconds() / 60
    if stale_min > 30:
        return {"available": False, "reason": f"No GPS from the group for {round(stale_min)} min"}
    # The last GPS tick may be a little old: count that time as already spent.
    minutes = max(0.0, minutes - max(0.0, (now - as_of).total_seconds() / 60))
    return {
        "available": True,
        "source": "model" if model.ready else "baseline",
        "minutes_left": round(minutes, 1),
        "baseline_minutes_left": round(base, 1),
        "arrival_at": (now + pd.Timedelta(minutes=minutes)).isoformat(),
        "remaining_km": round(remaining_km, 2),
        "typical_error_minutes": (model.metrics or {}).get("mae_minutes"),
    }
