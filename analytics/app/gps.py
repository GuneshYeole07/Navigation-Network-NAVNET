"""
GPS cleaning: turn a phone's raw fixes into an accurate track.

Phones report a position every few seconds with an estimated accuracy. Raw fixes wobble
by 5-15 m, drift, and now and then jump 100+ m (signal bouncing off buildings, flyovers,
tunnels). This module:

1. Drops fixes that are useless (reported accuracy worse than `MAX_ACCURACY_M`).
2. Runs a **Kalman filter** (constant-velocity model, in metres) that blends each fix with
   where the rider should be given their speed, weighting every fix by its accuracy and
   using the phone's speed + heading when it reports them.
3. Tells **glitches** from **manoeuvres**. A fix far from the prediction (Mahalanobis gate,
   chi-square 99.9%) is held back for one fix. A glitch is followed by a normal fix again
   and is dropped. A real U-turn, sharp bend at speed or exit from a tunnel is followed by
   another surprising fix that agrees with it (no faster than 200 km/h between them): the
   filter restarts there, with the velocity those two fixes imply. It never ignores the
   phone for more than a few fixes in a row.
4. For finished trips, runs a **Rauch-Tung-Striebel smoother** backwards over the track,
   so every point also benefits from the fixes that came after it.

The same filter (forward pass only) runs on the rider's phone in the app, see
client/src/utils/gpsFilter.js.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from .geo import EARTH_RADIUS_M, haversine

MAX_ACCURACY_M = 100.0  # fixes worse than this are thrown away
DEFAULT_ACCURACY_M = 15.0  # when the phone doesn't say
ACCEL_SIGMA = 1.5  # m/s², how hard riders realistically speed up / brake / turn
SPEED_SIGMA = 1.2  # m/s, trust in the phone's own speed reading
HEADING_SIGMA_DEG = 12.0
GATE_CHI2 = 13.82  # chi-square, 2 degrees of freedom, 99.9%
MAX_REJECTED = 4  # never ignore the phone for longer than this many fixes in a row
MAX_SPEED_MS = 55.0  # ~200 km/h: anything implying more is a glitch, not the rider
HOLD_TIMEOUT_S = 8.0  # a held-back fix nobody contradicts within this long is accepted
COAST_S = 5.0  # with no usable fix, carry the rider forward at most this long
WARMUP_FIXES = 1  # no outlier gate on the 2nd fix of a ride (the 1st one may be the bad one)
_DEG = np.pi / 180


@dataclass
class _Frame:
    """Local flat-earth frame (metres east / north) around a reference point."""

    lat0: float
    lng0: float

    def to_xy(self, lat, lng):
        k = _DEG * EARTH_RADIUS_M
        return (np.asarray(lng) - self.lng0) * np.cos(self.lat0 * _DEG) * k, (np.asarray(lat) - self.lat0) * k

    def to_latlng(self, x, y):
        k = _DEG * EARTH_RADIUS_M
        return self.lat0 + np.asarray(y) / k, self.lng0 + np.asarray(x) / (np.cos(self.lat0 * _DEG) * k)


def _inv2(m):
    """Inverse of a 2x2 matrix (much faster than np.linalg.inv for tiny matrices)."""
    a, b, c, d = m[0, 0], m[0, 1], m[1, 0], m[1, 1]
    det = a * d - b * c
    return np.array([[d, -b], [-c, a]]) / det


def _transition(dt: float, accel_sigma: float = ACCEL_SIGMA):
    F = np.array([[1, 0, dt, 0], [0, 1, 0, dt], [0, 0, 1, 0], [0, 0, 0, 1]], dtype=float)
    q = accel_sigma**2
    dt2, dt3, dt4 = dt * dt, dt**3, dt**4
    Q = q * np.array(
        [[dt4 / 4, 0, dt3 / 2, 0], [0, dt4 / 4, 0, dt3 / 2], [dt3 / 2, 0, dt2, 0], [0, dt3 / 2, 0, dt2]],
        dtype=float,
    )
    return F, Q


def kalman_track(
    t_s: np.ndarray,
    lat: np.ndarray,
    lng: np.ndarray,
    accuracy: np.ndarray | None = None,
    speed_kmh: np.ndarray | None = None,
    heading_deg: np.ndarray | None = None,
    smooth: bool = True,
) -> pd.DataFrame:
    """
    Clean one rider's track. Inputs are arrays in time order (`t_s` in seconds).
    `smooth=False` gives exactly what the phone shows live (same as gpsFilter.js);
    `smooth=True` uses later fixes too, for finished trips.
    Returns per input fix: filtered lat/lng, speed (km/h), whether the fix was used,
    and the filter's own 1-sigma position uncertainty in metres.
    """
    n = len(t_s)
    used_mask = np.zeros(n, bool)
    if n == 0:
        return pd.DataFrame({"lat": [], "lng": [], "kmh": [], "used": [], "sigma_m": []})
    acc = np.where(np.isfinite(accuracy), accuracy, DEFAULT_ACCURACY_M) if accuracy is not None else np.full(n, DEFAULT_ACCURACY_M)
    spd = np.asarray(speed_kmh, dtype=float) / 3.6 if speed_kmh is not None else np.full(n, np.nan)
    hdg = np.asarray(heading_deg, dtype=float) if heading_deg is not None else np.full(n, np.nan)

    frame = _Frame(float(lat[0]), float(lng[0]))
    xs, ys = frame.to_xy(lat, lng)

    H_pos = np.array([[1, 0, 0, 0], [0, 1, 0, 0]], dtype=float)
    x = None
    P = None
    last_t = None
    rejected_run: list[int] = []
    since_reset = 0
    last_used = -1  # index of the newest fix the filter accepted

    # For the smoother: filtered and predicted states at every step.
    xf = np.full((n, 4), np.nan)
    Pf = np.full((n, 4, 4), np.nan)
    xp = np.full((n, 4), np.nan)
    Pp = np.full((n, 4, 4), np.nan)
    Fs = np.full((n, 4, 4), np.nan)
    coast = np.full((n, 4), np.nan)  # live output for fixes that weren't used

    def implied_speed(i, j):
        """Slowest speed that could explain moving from fix j to fix i (m/s)."""
        dt_ij = t_s[i] - t_s[j]
        if dt_ij <= 0:
            return np.inf
        gap = haversine(lat[i], lng[i], lat[j], lng[j]) - 2 * (max(acc[i], 3.0) + max(acc[j], 3.0))
        return max(0.0, gap) / dt_ij

    def speed_limit(i, j):
        """Fastest believable speed between two fixes. The phone's own (Doppler) speed is
        hardly affected by the reflections that cause position jumps, so use it when known:
        a rider the phone says is standing still can't have moved 200 m."""
        known = [v for v in (spd[i], spd[j]) if np.isfinite(v)]
        return min(MAX_SPEED_MS, 1.5 * max(known) + 10.0) if known else MAX_SPEED_MS

    def reset(i, prev=None):
        nonlocal x, P
        v = np.zeros(2)
        if np.isfinite(spd[i]) and np.isfinite(hdg[i]):
            v = spd[i] * np.array([np.sin(hdg[i] * _DEG), np.cos(hdg[i] * _DEG)])
        elif prev is not None and t_s[i] - t_s[prev] >= 1.0:
            # Velocity from the two fixes that agreed with each other.
            v = np.array([xs[i] - xs[prev], ys[i] - ys[prev]]) / (t_s[i] - t_s[prev])
        if np.hypot(*v) > MAX_SPEED_MS:
            v = v * MAX_SPEED_MS / np.hypot(*v)
        x = np.array([xs[i], ys[i], v[0], v[1]])
        # A single fix can itself be a bad one: start with a wide uncertainty so the next
        # few fixes can pull the track to where the rider really is.
        p0 = max(acc[i], 30.0) ** 2
        P = np.diag([p0, p0, 100.0, 100.0])

    for i in range(n):
        if acc[i] > MAX_ACCURACY_M or not (np.isfinite(xs[i]) and np.isfinite(ys[i])):
            if x is not None:  # what a phone shows meanwhile: coast briefly on the last velocity
                coast[i] = np.r_[x[:2] + x[2:] * min(COAST_S, t_s[i] - last_t), x[2:]]
            continue
        if x is None:
            reset(i)
            since_reset = 0
            last_t = t_s[i]
            xf[i], Pf[i], xp[i], Pp[i], Fs[i] = x, P, x, P, np.eye(4)
            used_mask[i] = True
            last_used = i
            rejected_run = []
            continue
        if rejected_run and t_s[i] - t_s[rejected_run[-1]] > HOLD_TIMEOUT_S:
            # A held-back fix that nothing contradicted for a while was real: a rider who
            # turned into a car park and stopped sends no more fixes to confirm it.
            j = rejected_run[-1]
            reset(j, prev=rejected_run[-2] if len(rejected_run) > 1 else None)
            since_reset = WARMUP_FIXES
            last_t = t_s[j]
            last_used = j
            rejected_run = []
        if t_s[i] <= last_t:  # same moment again / older than what we have: nothing new
            coast[i] = np.r_[x[:2], x[2:]]
            continue

        dt = float(t_s[i] - last_t)
        F, Q = _transition(dt)
        x_pred = F @ x
        P_pred = F @ P @ F.T + Q

        # Position measurement, weighted by the phone's reported accuracy.
        R = np.eye(2) * max(acc[i], 3.0) ** 2
        innov = np.array([xs[i], ys[i]]) - H_pos @ x_pred
        S = H_pos @ P_pred @ H_pos.T + R
        d2 = float(innov @ _inv2(S) @ innov)

        since_reset += 1
        # Faster than the rider could possibly have gone since the last good fix: always
        # suspicious, even while the filter is still settling.
        impossible = implied_speed(i, last_used) > speed_limit(i, last_used)
        if (d2 > GATE_CHI2 and since_reset > WARMUP_FIXES) or impossible:
            # Surprising fix. A glitch (multipath) is followed by a normal fix again; a real
            # manoeuvre (U-turn, sharp bend at speed) is followed by another surprising fix
            # that agrees with this one. So hold it for one fix before deciding.
            # The phone's own Doppler velocity says it turned / braked hard (multipath moves
            # the position, not the Doppler speed): a real manoeuvre, follow it right away.
            if np.isfinite(spd[i]) and np.isfinite(hdg[i]) and spd[i] > 3.0:
                v_phone = spd[i] * np.array([np.sin(hdg[i] * _DEG), np.cos(hdg[i] * _DEG)])
                v_pred = x_pred[2:]
                turned = np.hypot(*(v_phone - v_pred)) > max(5.0, 0.35 * np.hypot(*v_pred))
                # ...and the fix is where that turn could put the rider: somewhere between
                # "kept the old velocity" and "had the new one all along". A glitch during a
                # turn still gets held back.
                a_end = x[:2] + x[2:] * dt
                b_end = x[:2] + v_phone * dt
                ab = b_end - a_end
                u = 0.0 if not ab.any() else float(np.clip(np.dot([xs[i], ys[i]] - a_end, ab) / np.dot(ab, ab), 0, 1))
                near = a_end + u * ab
                miss = np.hypot(xs[i] - near[0], ys[i] - near[1])
                fits = miss <= 3 * max(acc[i], 3.0) + 0.1 * np.hypot(*v_phone) * dt + 10.0
                if turned and fits:
                    reset(i)
                    since_reset = WARMUP_FIXES
                    last_t = t_s[i]
                    xf[i], Pf[i], xp[i], Pp[i], Fs[i] = x, P, x, P, np.eye(4)
                    used_mask[i] = True
                    last_used = i
                    rejected_run = []
                    continue
            prev = rejected_run[-1] if rejected_run else None
            # "Agree": the rider could have driven last good fix → held fix → this fix.
            agrees = (
                prev is not None
                and implied_speed(prev, last_used) <= speed_limit(prev, last_used)
                and implied_speed(i, prev) <= speed_limit(i, prev)
            )
            if agrees or len(rejected_run) + 1 > MAX_REJECTED:
                reset(i, prev=prev)
                # Restarted from two fixes that agree: position and velocity are known, so keep
                # filtering glitches straight away (a glitch right after a turn is common).
                since_reset = WARMUP_FIXES
                last_t = t_s[i]
                xf[i], Pf[i], xp[i], Pp[i], Fs[i] = x, P, x, P, np.eye(4)
                used_mask[i] = True
                last_used = i
                rejected_run = []
            else:
                rejected_run.append(i)
                coast[i] = np.r_[x[:2] + x[2:] * min(COAST_S, dt), x[2:]]
            continue
        rejected_run = []

        K = P_pred[:, :2] @ _inv2(S)
        x_new = x_pred + K @ innov
        P_new = (np.eye(4) - K @ H_pos) @ P_pred

        # Velocity measurement from the phone's own speed + heading (Doppler), if given.
        if np.isfinite(spd[i]) and np.isfinite(hdg[i]) and spd[i] > 1.0:
            z = spd[i] * np.array([np.sin(hdg[i] * _DEG), np.cos(hdg[i] * _DEG)])
            Hv = np.array([[0, 0, 1, 0], [0, 0, 0, 1]], dtype=float)
            # Heading error matters more at speed: convert it to a sideways velocity error.
            side = spd[i] * HEADING_SIGMA_DEG * _DEG
            Rv = np.eye(2) * (SPEED_SIGMA**2 + side**2)
            Sv = Hv @ P_new @ Hv.T + Rv
            Kv = P_new[:, 2:] @ _inv2(Sv)
            x_new = x_new + Kv @ (z - Hv @ x_new)
            P_new = (np.eye(4) - Kv @ Hv) @ P_new
        elif np.isfinite(spd[i]) and spd[i] <= 1.0:
            # Phone says "standing still": pull velocity towards zero.
            Hv = np.array([[0, 0, 1, 0], [0, 0, 0, 1]], dtype=float)
            Sv = Hv @ P_new @ Hv.T + np.eye(2) * SPEED_SIGMA**2
            Kv = P_new[:, 2:] @ _inv2(Sv)
            x_new = x_new + Kv @ (np.zeros(2) - Hv @ x_new)
            P_new = (np.eye(4) - Kv @ Hv) @ P_new

        v_abs = np.hypot(x_new[2], x_new[3])
        if v_abs > MAX_SPEED_MS:  # physically impossible velocity: cap it
            x_new[2:] *= MAX_SPEED_MS / v_abs
        x, P, last_t = x_new, P_new, t_s[i]
        xf[i], Pf[i], xp[i], Pp[i], Fs[i] = x, P, x_pred, P_pred, F
        used_mask[i] = True
        last_used = i

    used = np.flatnonzero(used_mask)
    states = xf.copy()
    if smooth and len(used) > 1:
        # Rauch-Tung-Striebel backward pass over the fixes the filter accepted.
        xs_s = xf.copy()
        Ps_s = Pf.copy()
        for k in range(len(used) - 2, -1, -1):
            i, j = used[k], used[k + 1]
            if np.allclose(Fs[j], np.eye(4)):  # j was a reset: don't smooth across it
                continue
            C = Pf[i] @ Fs[j].T @ np.linalg.inv(Pp[j])
            xs_s[i] = xf[i] + C @ (xs_s[j] - xp[j])
            Ps_s[i] = Pf[i] + C @ (Ps_s[j] - Pp[j]) @ C.T
        states, Pf = xs_s, Ps_s

    # Live (no smoothing): exactly what the phone shows, i.e. a held-back fix shows the
    # prediction. Smoothed: rejected / useless fixes get the track position at that moment.
    if not smooth:
        live = np.isfinite(coast[:, 0])
        states[live] = coast[live]
    for c in range(4):
        col = states[:, c]
        ok = np.isfinite(col)
        if ok.sum() >= 2:
            states[~ok, c] = np.interp(t_s[~ok], t_s[ok], col[ok])
        elif ok.sum() == 1:
            states[~ok, c] = col[ok][0]
    la, ln = frame.to_latlng(states[:, 0], states[:, 1])
    return pd.DataFrame(
        {
            "lat": la,
            "lng": ln,
            "kmh": np.hypot(states[:, 2], states[:, 3]) * 3.6,
            "used": used_mask,
            "sigma_m": np.sqrt(np.maximum(0, (Pf[:, 0, 0] + Pf[:, 1, 1]) / 2)),
        }
    )


def clean_pings(pings: pd.DataFrame, smooth: bool = True) -> pd.DataFrame:
    """
    Clean every rider's track in a pings table (user_id, lat, lng, recorded_at, and
    optionally accuracy, speed_kmh, heading). Adds `clean_lat`, `clean_lng`, `clean_kmh`,
    `gps_used` (False = rejected as an outlier/useless) and `gps_sigma_m`.
    """
    df = pings.copy()
    for col in ("clean_lat", "clean_lng", "clean_kmh", "gps_sigma_m"):
        df[col] = np.nan
    df["gps_used"] = False
    if df.empty:
        return df
    df["recorded_at"] = pd.to_datetime(df["recorded_at"], utc=True)
    df = df.sort_values(["user_id", "recorded_at"])
    for idx in df.groupby("user_id", sort=False).groups.values():
        g = df.loc[idx]
        t = (g["recorded_at"] - g["recorded_at"].iloc[0]).dt.total_seconds().to_numpy()
        res = kalman_track(
            t,
            g["lat"].to_numpy(float),
            g["lng"].to_numpy(float),
            pd.to_numeric(g.get("accuracy"), errors="coerce").to_numpy(float) if "accuracy" in g else None,
            pd.to_numeric(g.get("speed_kmh"), errors="coerce").to_numpy(float) if "speed_kmh" in g else None,
            pd.to_numeric(g.get("heading"), errors="coerce").to_numpy(float) if "heading" in g else None,
            smooth=smooth,
        )
        df.loc[idx, "clean_lat"] = res["lat"].to_numpy()
        df.loc[idx, "clean_lng"] = res["lng"].to_numpy()
        df.loc[idx, "clean_kmh"] = res["kmh"].to_numpy()
        df.loc[idx, "gps_used"] = res["used"].to_numpy()
        df.loc[idx, "gps_sigma_m"] = res["sigma_m"].to_numpy()
    return df.sort_index()


def track_error(df: pd.DataFrame, lat_col: str, lng_col: str) -> dict:
    """Error vs the true position (needs true_lat / true_lng, i.e. simulated rides)."""
    ok = df[[lat_col, lng_col, "true_lat", "true_lng"]].dropna()
    e = haversine(ok[lat_col], ok[lng_col], ok["true_lat"], ok["true_lng"])
    return {
        "median_m": round(float(np.median(e)), 1),
        "p95_m": round(float(np.percentile(e, 95)), 1),
        "max_m": round(float(np.max(e)), 1),
        "rmse_m": round(float(np.sqrt(np.mean(e**2))), 1),
    }
