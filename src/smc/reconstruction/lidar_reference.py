"""Independent sensor references selected in image space, never by fitted 3D error.

For a *known calibrated* camera, intersect a fixed pixel ray with a locally
supported lidar plane. Do not find the nearest lidar point to the reconstructed
point: that would make a poor estimate select its own purported truth. Plane
support/visibility tests depend on the sensor observations alone.
"""

from __future__ import annotations

import cv2
import numpy as np
from scipy.spatial import cKDTree

from smc.curbmeasure.geometry import Camera

# PandaSet's published semantic IDs; no vegetation, vehicles or pedestrians.
STATIC = {6, 7, 8, 9, 10, 11, 12, 34, 35, 36, 41, 42}
SURFACES = {6, 7, 8, 9, 10, 11, 12, 41}


class LidarReference:
    def __init__(self, camera: Camera, xyz: np.ndarray, labels: np.ndarray):
        if xyz.shape != (len(labels), 3) or not np.isfinite(xyz).all():
            raise ValueError("finite coordinates and one semantic label per lidar return required")
        self.camera = camera
        uv = camera.project(xyz)
        z = ((xyz - camera.centre) @ camera.rotation.T)[:, 2]
        valid = (
            np.isfinite(uv).all(axis=1)
            & (z > 1)
            & (uv[:, 0] >= 0)
            & (uv[:, 0] < camera.width)
            & (uv[:, 1] >= 0)
            & (uv[:, 1] < camera.height)
        )
        self.uv, self.xyz, self.labels, self.z = uv[valid], xyz[valid], labels[valid], z[valid]
        self.tree = cKDTree(self.uv)

    def exclusion_mask(self) -> np.ndarray:
        """Nearest-return semantics, conservative dynamic dilation; no completed depth."""
        h, w = self.camera.height, self.camera.width
        low = np.zeros(((h + 3) // 4, (w + 3) // 4), np.uint8)
        u, v = (self.uv / 4).astype(int).T
        # Explicit deterministic nearest-return assignment (advanced assignment with
        # duplicate indices is not a guaranteed z-buffer).
        cell = v * low.shape[1] + u
        order = np.lexsort((self.z, cell))
        _, first = np.unique(cell[order], return_index=True)
        keep = order[first]
        low[v[keep], u[keep]] = np.where(np.isin(self.labels[keep], list(STATIC)), 1, 2)
        static = cv2.dilate((low == 1).astype(np.uint8), np.ones((7, 7), np.uint8))
        dynamic = cv2.dilate((low == 2).astype(np.uint8), np.ones((11, 11), np.uint8))
        allowed = (static != 0) & (dynamic == 0)
        return ~cv2.resize(
            allowed.astype(np.uint8), (w, h), interpolation=cv2.INTER_NEAREST
        ).astype(bool)

    def at_pixel(self, pixel: np.ndarray) -> dict | None:
        ids = self.tree.query_ball_point(np.asarray(pixel, float), 16)
        if len(ids) < 8:
            return None
        ids = np.array(ids)
        order = np.argsort(np.linalg.norm(self.uv[ids] - pixel, axis=1))
        ids = ids[order[:64]]
        # The closest image-space return defines the surface, not an optimized point.
        nearest = ids[0]
        if (
            np.linalg.norm(self.uv[nearest] - pixel) > 8
            or int(self.labels[nearest]) not in SURFACES
            or not 3 <= self.z[nearest] <= 20
        ):
            return None
        ids = ids[
            (np.abs(self.z[ids] - self.z[nearest]) < 0.35)
            & (self.labels[ids] == self.labels[nearest])
        ]
        if len(ids) < 8:
            return None
        pts = self.xyz[ids]
        centre = pts.mean(axis=0)
        _, singular, vt = np.linalg.svd(pts - centre, full_matrices=False)
        rms = float(singular[-1] / np.sqrt(len(pts)))
        if rms > 0.015 or singular[1] / np.sqrt(len(pts)) < 0.025:
            return None
        normal = vt[-1]
        ray = self.camera.ray(pixel)[0]
        denominator = float(normal @ ray)
        if abs(denominator) < 0.2:
            return None
        distance = float(normal @ (centre - self.camera.centre) / denominator)
        point = self.camera.centre + distance * ray
        if distance <= 0 or np.min(np.linalg.norm(pts - point, axis=1)) > 0.2:
            return None
        return {
            "xyz": point.tolist(),
            "plane_rms_m": rms,
            "returns": len(ids),
            "semantic_class": int(self.labels[nearest]),
            "range_m": distance,
            "correspondence": "calibrated_pixel_ray_lidar_surface",
        }
