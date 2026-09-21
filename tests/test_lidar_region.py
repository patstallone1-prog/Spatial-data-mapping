"""A region's kerbs and roofs, read from the lidar with no city record behind them."""

from __future__ import annotations

import numpy as np

from smc.lidar.ept import LocalCloud
from smc.lidar.region import building_height, street_kerbs


def synthetic_street(half_road=6.0, kerb=0.15, walk=3.0, length=60.0, seed=1) -> LocalCloud:
    """Ground returns over a street running east: road, a kerb each side, pavements."""
    rng = np.random.default_rng(seed)
    n = 60_000
    east = rng.uniform(-5, length + 5, n)
    north = rng.uniform(-(half_road + walk + 6), half_road + walk + 6, n)
    up = np.zeros(n) + 0.005 * rng.standard_normal(n)
    up[np.abs(north) > half_road] += kerb            # the pavements stand a kerb higher
    up[np.abs(north) > half_road + walk] += 2.5      # a garden wall beyond the pavement
    classification = np.full(n, 2, dtype=np.int32)
    return LocalCloud(east, north, up, classification, 37.8, -122.27)


def test_kerbs_are_found_each_side_at_their_offset_and_height():
    cloud = synthetic_street()
    lon0, lat0 = -122.27, 37.8
    # A street way along the x axis, in lon/lat about the cloud's origin.
    m_per_deg_lon = 111_320.0 * np.cos(np.radians(lat0))
    way = [[lon0, lat0], [lon0 + 60.0 / m_per_deg_lon, lat0]]
    stations = street_kerbs(cloud, way)
    assert len(stations) >= 12, len(stations)
    lefts = [s.left_m for s in stations if s.left_m is not None]
    rights = [s.right_m for s in stations if s.right_m is not None]
    assert lefts and rights
    assert abs(np.median(lefts) - 6.0) < 0.35 and abs(np.median(rights) - 6.0) < 0.35, (np.median(lefts), np.median(rights))
    heights = [s.left_height_m for s in stations if s.left_height_m is not None]
    assert heights and abs(np.median(heights) - 0.15) < 0.04


def test_a_flat_field_has_no_kerb():
    cloud = synthetic_street(kerb=0.0, walk=0.0)
    cloud.up[:] = 0.005 * np.random.default_rng(2).standard_normal(cloud.up.size)
    lon0, lat0 = -122.27, 37.8
    way = [[lon0, lat0], [lon0 + 60.0 / (111_320.0 * np.cos(np.radians(lat0))), lat0]]
    assert street_kerbs(cloud, way) == []


def test_a_roof_is_measured_over_the_ground_at_its_foot():
    rng = np.random.default_rng(3)
    n = 20_000
    east = rng.uniform(-10, 30, n)
    north = rng.uniform(-10, 30, n)
    up = 12.0 + 0.02 * rng.standard_normal(n)
    inside = (east > 0) & (east < 20) & (north > 0) & (north < 20)
    classification = np.where(inside, 6, 2).astype(np.int32)
    up[~inside] = 0.02 * rng.standard_normal((~inside).sum())     # ground at zero outside
    up[inside] = 12.0 + 0.3 * rng.standard_normal(inside.sum())    # a 12 m roof
    cloud = LocalCloud(east, north, up, classification, 37.8, -122.27)
    m_lon = 111_320.0 * np.cos(np.radians(37.8))
    ring = [[-122.27 + x / m_lon, 37.8 + y / 111_320.0] for x, y in ((0, 0), (20, 0), (20, 20), (0, 20))]
    found = building_height(cloud, ring)
    assert found is not None and abs(found["height_m"] - 12.0) < 0.6 and found["roof_points"] > 1000, found
    assert building_height(cloud, ring[:2]) is None


def test_a_kerb_reading_that_leaves_its_neighbours_is_dropped_not_moved():
    """The first riser is sometimes a median island or the far kerb; along a way the kerb line
    is smooth, so a reading over KERB_OUTLIER_M from its neighbours' median goes, and the kept
    readings are exactly what the sensor said."""
    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
    from measure_region_lidar import KERB_OUTLIER_M, reject_outliers

    samples = [{"s": 4.0 * i, "l": 5.4 + 0.02 * (i % 3), "r": 5.5, "lh": 0.12, "rh": 0.12, "n": 100} for i in range(8)]
    samples[3]["l"] = 5.4 + KERB_OUTLIER_M + 1.0     # the far kerb, read on the near side
    samples[5]["r"] = None                            # already nothing there
    dropped = reject_outliers(samples)
    assert dropped == 1
    assert samples[3]["l"] is None and samples[3]["lh"] is None
    assert samples[2]["l"] == 5.4 + 0.02 * 2 and samples[4]["r"] == 5.5
