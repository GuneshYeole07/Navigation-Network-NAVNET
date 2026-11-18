import numpy as np

from app.geo import cumulative, haversine, project


def test_haversine_pune_to_mumbai():
    # Shaniwar Wada → Gateway of India is ~120 km as the crow flies.
    assert 115_000 < haversine(18.5195, 73.8553, 18.9220, 72.8347) < 125_000


def test_project_snaps_points_to_the_route():
    route = np.array([[18.50, 73.80], [18.50, 73.90], [18.60, 73.90]])  # east, then north
    cum = cumulative(route)
    along, offset = project(np.array([[18.501, 73.85], [18.55, 73.899]]), route, cum)
    assert abs(along[0] - cum[1] / 2) < 50  # halfway along the first leg
    assert 100 < offset[0] < 120  # ~111 m north of the road
    assert abs(along[1] - (cum[1] + (cum[2] - cum[1]) / 2)) < 50


def test_tracking_follows_an_out_and_back_route():
    # 10 km east and back along the same road: the way back must count as progress.
    out = np.stack([np.full(41, 18.5), np.linspace(73.80, 73.80 + 10_000 / 105_600, 41)], axis=1)
    route = np.concatenate([out, out[::-1][1:]])
    cum = cumulative(route)
    rng = np.random.default_rng(0)
    fixes = route + rng.normal(0, 0.00005, route.shape)  # ~5 m GPS noise
    global_along, _ = project(fixes, route, cum)
    tracked, offset = project(fixes, route, cum, track=True)
    assert global_along[-5:].max() < 1_000  # nearest-point snapping thinks the rider is back at the start
    assert np.all(np.diff(tracked) > -100)  # tracked progress keeps going forward
    assert abs(tracked[-1] - cum[-1]) < 100 and offset.max() < 30
