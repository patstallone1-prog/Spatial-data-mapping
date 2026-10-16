"""A conservative local plane from the published lidar terrain, for an ablation only.

This conditions the photo estimate on lidar, so it is NOT a camera-only result or
independent lidar validation. Reject rough/missing terrain rather than hiding it.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from smc.curbmeasure.semantic import metres_per_degree


class TerrainGrade:
    def __init__(self, metadata: Path):
        self.frame = json.loads(metadata.read_text())["frame"]
        f = self.frame
        raw = np.frombuffer(metadata.with_suffix(".bin").read_bytes(), dtype="<i2")
        if raw.size != f["rows"] * f["cols"]:
            raise ValueError("terrain grid length mismatch")
        self.z = raw.reshape(f["rows"], f["cols"]).astype(float) / 100 + f["base_m"]
        self.z[raw.reshape(self.z.shape) == f["nodata"]] = np.nan

    def at(self, lon: float, lat: float) -> dict | None:
        f = self.frame
        x = (lon - f["mid_lon"]) * f["metres_per_lon"]
        y = (lat - f["mid_lat"]) * f["metres_per_lat"]
        col = round((x - f["x0"]) / f["step_m"])
        row = round((y - f["y0"]) / f["step_m"])
        if not 3 <= col < f["cols"] - 3 or not 3 <= row < f["rows"] - 3:
            return None
        z = self.z[row - 3 : row + 4, col - 3 : col + 4].ravel()
        # Convert the grid's historical approximate metre scale into our ENU derivatives.
        kx, ky = metres_per_degree(lat)
        dx, dy = np.meshgrid(
            np.arange(-3, 4) * f["step_m"] * kx / f["metres_per_lon"],
            np.arange(-3, 4) * f["step_m"] * ky / f["metres_per_lat"],
        )
        a = np.column_stack((dx.ravel(), dy.ravel(), np.ones(49)))
        valid = np.isfinite(z)
        if valid.sum() < 40:
            return None
        coeff = np.linalg.lstsq(a[valid], z[valid], rcond=None)[0]
        residual = z[valid] - a[valid] @ coeff
        rms = float(np.sqrt(np.mean(residual**2)))
        if rms > 0.05 or np.linalg.norm(coeff[:2]) > 0.25:
            return None
        return {
            "grade_e_n": coeff[:2].tolist(),
            "plane_rmse_m": rms,
            "basis": "lidar_terrain_conditioned_ablation_not_camera_only",
        }
