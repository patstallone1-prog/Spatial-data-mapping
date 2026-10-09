"""Shared terrain differences and outward wall orientation for photo priors.

No GNSS/DEM absolute datum mixing: only differences within one recorded grid.
The camera's height above ground remains an explicit estimated prior.
"""

from __future__ import annotations

import json
import math
from dataclasses import replace
from pathlib import Path

import numpy as np

from smc.facades.geometry import Camera, LocalFrame, Wall


def street_readable_wall(wall: Wall) -> Wall:
    dx, dy = wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]
    return (
        replace(wall, a=wall.b, b=wall.a) if dy * wall.normal[0] - dx * wall.normal[1] < 0 else wall
    )


class TerrainReference:
    def __init__(self, metadata: Path):
        self.metadata_path = metadata
        self.meta = json.loads(metadata.read_text())
        self.frame = self.meta["frame"]
        if self.frame.get("dtype") != "int16-le-cm":
            raise ValueError("unsupported terrain units")
        self.data = np.fromfile(metadata.with_suffix(".bin"), dtype="<i2").reshape(
            self.frame["rows"], self.frame["cols"]
        )

    def sample(self, lon: float, lat: float) -> float | None:
        f = self.frame
        x = ((lon - f["mid_lon"]) * f["metres_per_lon"] - f["x0"]) / f["step_m"] - 0.5
        y = ((lat - f["mid_lat"]) * f["metres_per_lat"] - f["y0"]) / f["step_m"] - 0.5
        if not 0 <= x < f["cols"] - 1 or not 0 <= y < f["rows"] - 1:
            return None
        col, row = math.floor(x), math.floor(y)
        patch = self.data[row : row + 2, col : col + 2]
        if (patch == f["nodata"]).any():
            return None
        tx, ty = x - col, y - row
        cm = (
            patch[0, 0] * (1 - tx) * (1 - ty)
            + patch[0, 1] * tx * (1 - ty)
            + patch[1, 0] * (1 - tx) * ty
            + patch[1, 1] * tx * ty
        )
        return float(f["base_m"] + cm / 100)

    def ground_camera(self, camera: Camera, wall: Wall, local: LocalFrame) -> tuple[Camera, dict]:
        road = self.sample(*local.to_lonlat(camera.x, camera.y))
        facade = self.sample(*local.to_lonlat(*wall.midpoint))
        if road is None or facade is None:
            return camera, {"status": "unknown", "reason": "terrain_no_data"}
        delta = road - facade
        return replace(camera, z=camera.z + delta), {
            "frame": "relative_to_facade_foot",
            "source": str(self.metadata_path.name),
            "road_ground_m": road,
            "facade_ground_m": facade,
            "relative_ground_delta_m": delta,
            "camera_height_above_ground_m": camera.z,
            "camera_height_grade": "estimated_prior_not_measured",
            "terrain_method": self.meta.get("method"),
            "grid_step_m": self.frame["step_m"],
        }
