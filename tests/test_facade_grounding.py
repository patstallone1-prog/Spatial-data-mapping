import json

import numpy as np
import pytest

from smc.facades.geometry import Camera, LocalFrame, Wall
from smc.facades.grounding import TerrainReference, street_readable_wall


def test_street_wall_endpoints_are_readable_for_either_polygon_winding():
    left = Wall(1, 4, (0, 0), (10, 0), (0, -1), 9)
    reverse = Wall(1, 4, (10, 0), (0, 0), (0, -1), 9)
    assert street_readable_wall(left) == street_readable_wall(reverse) == left
    assert street_readable_wall(reverse).wall_index == 4


def test_camera_uses_only_relative_heights_in_one_grid(tmp_path):
    path = tmp_path / "terrain.json"
    path.write_text(
        json.dumps(
            {
                "frame": {
                    "dtype": "int16-le-cm",
                    "rows": 3,
                    "cols": 3,
                    "nodata": -32768,
                    "mid_lon": 0,
                    "mid_lat": 0,
                    "metres_per_lon": 1,
                    "metres_per_lat": 1,
                    "x0": 0,
                    "y0": 0,
                    "step_m": 1,
                    "base_m": 100,
                }
            }
        )
    )
    path.with_suffix(".bin").write_bytes(np.array([[0, 100, 200]] * 3, dtype="<i2").tobytes())
    terrain = TerrainReference(path)
    assert terrain.sample(1, 1) == pytest.approx(100.5)
    assert terrain.sample(-2, 1) is None

    class Metres:
        def to_lonlat(self, x, y):
            return x, y

    wall = Wall(0, 0, (1.25, 1), (1.75, 1), (0, -1), 9)
    camera = Camera(0.5, 1, 2.4, 0, 100, 100, True)
    updated, evidence = terrain.ground_camera(camera, wall, Metres())
    assert updated.z == pytest.approx(1.4)
    assert evidence["frame"] == "relative_to_facade_foot"
    assert evidence["camera_height_grade"] == "estimated_prior_not_measured"
    assert LocalFrame(0, 0).to_lonlat(0, 0) == (0, 0)
