"""Reviewed image-space rectification, separate from metric camera calibration."""

from __future__ import annotations

import math

import cv2
import numpy as np


def register_front(
    image: np.ndarray,
    width: float,
    height: float,
    control: dict,
    digest: str,
    derived_sha256: str | None = None,
):
    if (
        control.get("image_sha256") != digest
        or not control.get("reviewer")
        or not control.get("full_front_visible")
    ):
        raise ValueError("image-bound full-front registration review required")
    if control.get("derived_input_sha256") and control["derived_input_sha256"] != derived_sha256:
        raise ValueError("reviewed derived image changed; registration must be reviewed again")
    quad = np.asarray(control.get("quad_normalized", []), dtype=np.float32)
    if quad.shape != (4, 2) or not np.isfinite(quad).all() or (quad < 0).any() or (quad > 1).any():
        raise ValueError("four in-image corners required")
    if not all(math.isfinite(v) and v > 0 for v in (width, height)):
        raise ValueError("positive canonical dimensions required")
    h, w = image.shape[:2]
    quad *= np.array([w - 1, h - 1], np.float32)
    if not cv2.isContourConvex(quad) or abs(cv2.contourArea(quad)) < 100:
        raise ValueError("nondegenerate convex front required")
    ppm = min(
        (np.linalg.norm(quad[1] - quad[0]) + np.linalg.norm(quad[2] - quad[3])) / (2 * width),
        (np.linalg.norm(quad[3] - quad[0]) + np.linalg.norm(quad[2] - quad[1])) / (2 * height),
        1400 / max(width, height),
    )
    rw, rh = max(2, round(width * ppm)), max(2, round(height * ppm))
    target = np.array([[0, 0], [rw - 1, 0], [rw - 1, rh - 1], [0, rh - 1]], np.float32)
    transform = cv2.getPerspectiveTransform(quad, target)
    registered = cv2.warpPerspective(image, transform, (rw, rh))
    return registered, {
        "method": "reviewed_front_quad_on_canonical_dimensions",
        "image_sha256": digest,
        "reviewer": control["reviewer"],
        "quad_normalized": control["quad_normalized"],
        "source_pixel_density_cap": float(ppm),
        "transform": transform.tolist(),
        "metric_pose_solved": False,
        "canonical_geometry_modified": False,
    }
