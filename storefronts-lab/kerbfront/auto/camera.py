"""Cameras from Mapillary's solved poses (OpenSfM convention), projecting world points to pixels.

``computed_rotation`` is an angle-axis vector, world-to-camera, in a local east-north-up frame;
the camera looks along +z with +x right and +y down. Panoramas are equirectangular around that
frame; perspective frames use OpenSfM's normalised focal (fraction of the larger side) and
radial k1, k2. With the full rotation the camera's pitch and roll are known, so the only pose
errors left are its position: along the wall, out from it and up -- which on the wall plane are
pure shifts and a scale, and are solved by registration (``register``).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

from ..sources import mapillary
from ..sources.http import get_json

FIELDS = "id,computed_rotation,camera_type,camera_parameters,width,height,computed_altitude,altitude"


def rodrigues(r) -> np.ndarray:
    r = np.asarray(r, float)
    th = float(np.linalg.norm(r))
    if th < 1e-12:
        return np.eye(3)
    k = r / th
    K = np.array([[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]])
    return np.eye(3) + math.sin(th) * K + (1 - math.cos(th)) * (K @ K)


def heading_rotation(heading_deg: float, pitch_deg: float = 0.0) -> np.ndarray:
    """World-to-camera for a level camera looking at a compass heading (fallback when Mapillary
    has no solved rotation)."""
    h, p = math.radians(heading_deg), math.radians(pitch_deg)
    fwd = np.array([math.sin(h) * math.cos(p), math.cos(h) * math.cos(p), math.sin(p)])
    right = np.array([math.cos(h), -math.sin(h), 0.0])
    down = np.cross(fwd, right)
    return np.stack([right, down, fwd])


@dataclass
class Camera:
    frame_id: str
    spherical: bool
    R: np.ndarray                      # world (ENU) to camera
    centre: np.ndarray                 # metres in the model frame (x east, y north, z up)
    focal: float | None = None         # perspective: fraction of the larger side
    k1: float = 0.0
    k2: float = 0.0
    solved: bool = True
    meta: dict = field(default_factory=dict)

    def moved(self, d) -> Camera:
        return Camera(self.frame_id, self.spherical, self.R, self.centre + np.asarray(d, float), self.focal,
                      self.k1, self.k2, self.solved, self.meta)

    def project(self, pts: np.ndarray, W: int, H: int) -> tuple[np.ndarray, np.ndarray]:
        """World points (N, 3) to pixel x, y (NaN behind a perspective camera)."""
        d = (pts - self.centre) @ self.R.T
        x, y, z = d[:, 0], d[:, 1], d[:, 2]
        if self.spherical:
            lon = np.arctan2(x, z)
            lat = np.arctan2(-y, np.hypot(x, z))
            return (0.5 + lon / (2 * math.pi)) * W, (0.5 - lat / math.pi) * H
        zz = np.where(z > 0.05, z, np.nan)
        xn, yn = x / zz, y / zz
        r2 = xn * xn + yn * yn
        dist = 1 + self.k1 * r2 + self.k2 * r2 * r2
        s = max(W, H) * (self.focal or 0.8)
        return W / 2 + s * dist * xn, H / 2 + s * dist * yn


def solved(frame_id: str) -> dict:
    rec = get_json("mapillary-pose", f"{mapillary.API}/{frame_id}", {"access_token": mapillary._token(), "fields": FIELDS})
    return rec["body"]


def camera_for(photo: dict, height_m: float = 2.0) -> Camera:
    """A camera for a model photo record (its x, y in the model frame), with the solved rotation
    when Mapillary has one, else a level camera on the photo's heading."""
    row = {}
    try:
        row = solved(photo["frame_id"])
    except Exception:  # noqa: BLE001 - offline or no solution: fall back to the heading
        row = {}
    sph = (row.get("camera_type") or photo.get("camera_type")) in ("spherical", "equirectangular")
    params = row.get("camera_parameters") or []
    centre = np.array([photo["x"], photo["y"], height_m], float)
    if row.get("computed_rotation"):
        return Camera(photo["frame_id"], sph, rodrigues(row["computed_rotation"]), centre,
                      None if sph else (float(params[0]) if params else None),
                      float(params[1]) if len(params) > 1 else 0.0, float(params[2]) if len(params) > 2 else 0.0,
                      True, row)
    return Camera(photo["frame_id"], sph, heading_rotation(photo["heading"]), centre,
                  None if sph else (0.5 / math.tan(math.radians(photo.get("hfov", 70)) / 2)), 0.0, 0.0, False, row)
