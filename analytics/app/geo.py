"""Distances and route projection, vectorised with NumPy."""
from __future__ import annotations

import numpy as np

EARTH_RADIUS_M = 6_371_008.8
_DEG = np.pi / 180


def haversine(lat1, lng1, lat2, lng2):
    """Great-circle distance in metres. Accepts scalars or NumPy arrays."""
    lat1, lng1, lat2, lng2 = (np.asarray(v, dtype=float) * _DEG for v in (lat1, lng1, lat2, lng2))
    a = np.sin((lat2 - lat1) / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin((lng2 - lng1) / 2) ** 2
    return 2 * EARTH_RADIUS_M * np.arcsin(np.sqrt(np.clip(a, 0, 1)))


def cumulative(route: np.ndarray) -> np.ndarray:
    """Distance along the route (metres) at each vertex. `route` is (N, 2) [lat, lng]."""
    route = np.asarray(route, dtype=float)
    if len(route) < 2:
        return np.zeros(len(route))
    seg = haversine(route[:-1, 0], route[:-1, 1], route[1:, 0], route[1:, 1])
    return np.concatenate([[0.0], np.cumsum(seg)])


def project(
    points: np.ndarray,
    route: np.ndarray,
    cum: np.ndarray | None = None,
    chunk: int = 512,
    track: bool = False,
    back_m: float = 3000,
    ahead_m: float = 15000,
    off_route_m: float = 300,
):
    """
    Snap GPS points onto the route.

    Returns (along, offset): metres along the route of the closest point, and how far
    off the route each point is. Uses a local flat-earth projection, accurate to well
    under 1% at city-to-state scales, and processes points in chunks to bound memory.

    With `track=True` the points are one rider's fixes in time order: each is snapped near
    the previous one (from `back_m` behind to `ahead_m` ahead), like the API does, so on
    round trips and out-and-back routes the return leg isn't mistaken for the way out.
    If nothing in that window is within `off_route_m`, the closest point overall is used.
    """
    points = np.asarray(points, dtype=float).reshape(-1, 2)
    route = np.asarray(route, dtype=float)
    cum = cumulative(route) if cum is None else cum
    if len(points) == 0:
        return np.zeros(0), np.zeros(0)
    if len(route) < 2:
        d = haversine(points[:, 0], points[:, 1], route[0, 0], route[0, 1])
        return np.zeros(len(points)), d

    lat0 = np.mean(route[:, 0]) * _DEG
    k = _DEG * EARTH_RADIUS_M
    to_xy = lambda a: np.stack([a[..., 1] * np.cos(lat0) * k, a[..., 0] * k], axis=-1)  # noqa: E731
    r = to_xy(route)
    a, b = r[:-1], r[1:]
    ab = b - a
    ab_len2 = np.maximum((ab**2).sum(axis=1), 1e-9)
    seg_len = cum[1:] - cum[:-1]

    p_all = to_xy(points)
    if track:
        return _track(p_all, a, ab, ab_len2, cum, seg_len, back_m, ahead_m, off_route_m)

    along = np.empty(len(points))
    offset = np.empty(len(points))
    for s in range(0, len(points), chunk):
        p = p_all[s : s + chunk, None, :]  # (m, 1, 2)
        t = np.clip(((p - a) * ab).sum(axis=2) / ab_len2, 0, 1)  # (m, segments)
        closest = a + t[..., None] * ab
        d2 = ((p - closest) ** 2).sum(axis=2)
        i = d2.argmin(axis=1)
        rows = np.arange(len(i))
        along[s : s + chunk] = cum[i] + t[rows, i] * seg_len[i]
        offset[s : s + chunk] = np.sqrt(d2[rows, i])
    return along, offset


def _track(p_all, a, ab, ab_len2, cum, seg_len, back_m, ahead_m, off_route_m):
    """Sequential snapping for one rider (see `project`): only nearby segments are searched."""
    def nearest(p, lo, hi):
        t = np.clip(((p - a[lo:hi]) * ab[lo:hi]).sum(axis=1) / ab_len2[lo:hi], 0, 1)
        d = np.sqrt(((p - (a[lo:hi] + t[:, None] * ab[lo:hi])) ** 2).sum(axis=1))
        return t, d

    n_seg = len(seg_len)
    along = np.empty(len(p_all))
    offset = np.empty(len(p_all))
    prev = None
    for k, p in enumerate(p_all):
        best = None
        if prev is not None:
            lo = max(0, int(np.searchsorted(cum, prev - back_m, side="right")) - 1)
            hi = min(n_seg, int(np.searchsorted(cum, prev + ahead_m, side="left")) + 1)
            t, d = nearest(p, lo, hi)
            pos = cum[lo:hi] + t * seg_len[lo:hi]
            # Where the road overlaps itself (out-and-back), prefer moving on:
            # going backwards counts like being that far off the road.
            j = int((d + np.maximum(0, prev - pos)).argmin())
            if d[j] <= off_route_m:
                best = (pos[j], d[j])
        if best is None:  # first fix, or far from where the rider was: closest point overall
            t, d = nearest(p, 0, n_seg)
            j = int(d.argmin())
            best = (cum[j] + t[j] * seg_len[j], d[j])
        along[k], offset[k] = best
        prev = best[0]
    return along, offset
