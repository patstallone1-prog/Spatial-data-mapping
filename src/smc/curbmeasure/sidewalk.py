"""Experimental image-derived sidewalk widths with explicit visible-boundary support.

No width across unknown pixels, parked cars, grass or a disappearing sidewalk is a
measurement. A continuous walk band must reach an observed building foot. Project
both endpoints to the sidewalk plane, then measure NORMAL to the local curb tangent,
not along the viewing ray. Absolute scale and road-plane assumptions remain explicit.
"""

from __future__ import annotations

import numpy as np

from smc.curbmeasure.semantic import BACK_WALL, WALK, View, kerb_columns


def plane_hits(
    rays: np.ndarray, camera_height_m: float, grade_e_n: tuple[float, float] = (0.0, 0.0)
) -> np.ndarray:
    """Camera-relative east/north hits of z=-H+grade.x; rays must point below plane."""
    if not np.isfinite(camera_height_m) or camera_height_m <= 0:
        raise ValueError("positive finite height above the plane required")
    rays = np.asarray(rays, float)
    grade = np.asarray(grade_e_n, float)
    if rays.ndim != 2 or rays.shape[1] != 3 or grade.shape != (2,):
        raise ValueError("(n,3) rays and two-component grade required")
    if not np.isfinite(rays).all() or not np.isfinite(grade).all():
        raise ValueError("nonfinite ray or grade")
    denominator = rays[:, :2] @ grade - rays[:, 2]
    out = np.full((len(rays), 2), np.nan)
    valid = denominator > 0.02
    out[valid] = rays[valid, :2] * (camera_height_m / denominator[valid, None])
    return out


def widths(
    view: View,
    labels: np.ndarray,
    camera_height_m: float,
    *,
    curb_height_m: float | None = None,
    grade_e_n: tuple[float, float] = (0.0, 0.0),
) -> list[dict]:
    """Diagnostic widths only; caller must supply an independently supported curb height.

    Do not borrow the lidar width being tested. A visible back-wall band is required,
    so legacy caches without building masks correctly yield no width, not an invention.
    """
    if curb_height_m is None:
        return []
    if not np.isfinite(curb_height_m) or not 0 <= curb_height_m < camera_height_m:
        raise ValueError("curb height must be finite, nonnegative and below camera")
    if labels.shape != (view.raster[1], view.raster[0]):
        raise ValueError("segmentation must use the view's raster")
    columns = kerb_columns(labels)
    if len(columns) < 5:
        return []
    cols = np.array(columns, float)
    # Top of face is on the sidewalk, not the road plane.
    foot = plane_hits(
        view.rays(cols[:, 0], cols[:, 1] - 0.5), camera_height_m - curb_height_m, grade_e_n
    )
    out = []
    for i in range(2, len(columns) - 2):
        u, top, _ = columns[i]
        row = top - 1
        while row >= 0 and labels[row, u] == WALK:
            row -= 1
        if row < 2 or top - row < 4 or not np.all(labels[row - 2 : row + 1, u] == BACK_WALL):
            continue
        # Nearby column support must belong to this continuous curb, not a second curb.
        if columns[i + 2][0] - columns[i - 2][0] > 12:
            continue
        tangent = foot[i + 2] - foot[i - 2]
        length = np.linalg.norm(tangent)
        if not np.isfinite(length) or not 0.05 < length < 3:
            continue
        normal = np.array([-tangent[1], tangent[0]]) / length
        back = plane_hits(
            view.rays(np.array([u]), np.array([row + 0.5])),
            camera_height_m - curb_height_m,
            grade_e_n,
        )[0]
        width = abs(float((back - foot[i]) @ normal))
        if not np.isfinite(width) or not 0.3 <= width <= 12:
            continue
        out.append(
            {
                "image": view.id,
                "sequence": view.sequence,
                "column": u,
                "width_m": width,
                "curb_top_relative_en_m": foot[i].tolist(),
                "back_edge_relative_en_m": back.tolist(),
                "basis": "photo_plane_projection_diagnostic",
                "publishable": False,
                "camera_height_m": camera_height_m,
                "curb_height_m": curb_height_m,
                "road_grade_e_n": list(grade_e_n),
                "back_edge_support": "continuous_sidewalk_to_building_mask",
            }
        )
    return out
