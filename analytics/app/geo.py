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


def project(points: np.ndarray, route: np.ndarray, cum: np.ndarray | None = None, chunk: int = 512):
    """
    Snap GPS points onto the route.

    Returns (along, offset): metres along the route of the closest point, and how far
    off the route each point is. Uses a local flat-earth projection, accurate to well
    under 1% at city-to-state scales, and processes points in chunks to bound memory.
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

    along = np.empty(len(points))
    offset = np.empty(len(points))
    p_all = to_xy(points)
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
