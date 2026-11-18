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
