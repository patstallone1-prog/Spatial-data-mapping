"""A photograph re-projected onto one wall of a model: a measured elevation.

    python -m kerbfront rectify tacolicious --wall 3 --photos 0 1 2

For every point (u along the wall, v up) at ``px_per_m`` the photo is sampled through the
photo's camera (its Mapillary pose plus the alignment saved by the studio's photo-match tool),
so the output is the facade seen square-on, in metres, with a 1 m grid and labels. Features
that stand off the wall plane (awnings, blade signs, parklets) smear outward, which is itself
a measure of their projection. Panoramas are sampled from the full equirectangular image;
perspective frames through a pinhole of the frame's field of view (lens distortion ignored).
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import cv2
import numpy as np

from ..config import CACHE, LAB, OUT
from ..sources import mapillary


def _image(frame_id: str, spherical: bool) -> np.ndarray:
    for size in ("original", 2048):
        p = CACHE / "thumbs" / f"{frame_id}_{size}.jpg"
        if p.exists():
            return cv2.imread(str(p))
    return cv2.imread(str(mapillary.thumbnail(frame_id, "original" if spherical else 2048)))


def wall_frame(model: dict, edge: int):
    ring = model["footprint"]
    a, b = np.array(ring[edge], float), np.array(ring[(edge + 1) % len(ring)], float)
    L = float(np.linalg.norm(b - a))
    t = (b - a) / L
    return a, t, np.array([t[1], -t[0]]), L


def project(model: dict, photo: dict, pts: np.ndarray, img_shape) -> tuple[np.ndarray, np.ndarray]:
    """World points (N,3: x east, y north, z up) to pixel coordinates in the photo."""
    al = photo.get("align") or {}
    c = np.array([photo["x"] + al.get("dx", 0), photo["y"] + al.get("dy", 0),
                  (photo.get("z") or 2.0) + al.get("dz", 0)])
    d = pts - c
    H, W = img_shape[:2]
    if photo["camera_type"] == "spherical":
        yaw = np.degrees(np.arctan2(d[:, 0], d[:, 1]))
        rel = (yaw - (photo["heading"] + al.get("dyaw", 0)) + 540) % 360 - 180
        lat = np.degrees(np.arctan2(d[:, 2], np.hypot(d[:, 0], d[:, 1]))) - al.get("dpitch", 0)
        return (rel / 360 + 0.5) * W, (0.5 - lat / 180) * H
    yaw = math.radians(photo["heading"] + al.get("dyaw", 0))
    p = math.radians(al.get("dpitch", 0))
    fwd = np.array([math.sin(yaw) * math.cos(p), math.cos(yaw) * math.cos(p), math.sin(p)])
    right = np.array([math.cos(yaw), -math.sin(yaw), 0.0])
    up = np.cross(right, fwd)
    xc, yc, zc = d @ right, d @ up, d @ fwd
    f = (W / 2) / math.tan(math.radians(photo["hfov"] + al.get("dfov", 0)) / 2)
    zc = np.where(zc > 0.1, zc, np.nan)
    return W / 2 + f * xc / zc, H / 2 - f * yc / zc


def rectify(model: dict, photo: dict, edge: int, px_per_m: int = 40, margin: float = 2.0,
            top: float | None = None, plane_offset: float = 0.0,
            urange: tuple[float, float] | None = None) -> np.ndarray:
    a, t, n, L = wall_frame(model, edge)
    top = top if top is not None else model["height_m"] + 1.0
    lo, hi = urange if urange else (-margin, L + margin)
    margin = -lo
    us = np.arange(lo, hi, 1 / px_per_m)
    vs = np.arange(top, -0.6, -1 / px_per_m)
    U, V = np.meshgrid(us, vs)
    xy = a[None, None, :] + U[..., None] * t[None, None, :] + plane_offset * n[None, None, :]
    pts = np.stack([xy[..., 0].ravel(), xy[..., 1].ravel(), V.ravel()], axis=1)
    img = _image(photo["frame_id"], photo["camera_type"] == "spherical")
    mx, my = project(model, photo, pts, img.shape)
    # only the side of the wall the camera stands on is visible
    al = photo.get("align") or {}
    cam = np.array([photo["x"] + al.get("dx", 0), photo["y"] + al.get("dy", 0)])
    facing = float(np.dot(cam - a, n)) > 0
    mx = np.nan_to_num(mx.reshape(U.shape), nan=-1).astype(np.float32)
    my = np.nan_to_num(my.reshape(U.shape), nan=-1).astype(np.float32)
    out = cv2.remap(img, mx, my, cv2.INTER_LINEAR,
                    borderMode=cv2.BORDER_WRAP if photo["camera_type"] == "spherical" else cv2.BORDER_CONSTANT)
    if not facing:
        out[:] = (out * 0.25).astype(out.dtype)
    # grid
    for u in range(math.ceil(lo), int(min(L, hi)) + 1):
        x = int((u + margin) * px_per_m)
        cv2.line(out, (x, 0), (x, out.shape[0] - 1), (0, 255, 255) if u % 5 == 0 else (0, 200, 200), 1)
        cv2.putText(out, str(u), (x + 2, out.shape[0] - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 255, 255), 1)
    for v in range(0, int(top) + 1):
        y = int((top - v) * px_per_m)
        cv2.line(out, (0, y), (out.shape[1] - 1, y), (0, 200, 200), 1)
        cv2.putText(out, f"{v}m", (2, y - 2), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 255, 255), 1)
    for u in (0, L):
        x = int((u + margin) * px_per_m)
        cv2.line(out, (x, 0), (x, out.shape[0] - 1), (0, 0, 255), 2)
    for sf in model["storefronts"]:
        if sf["edge"] == edge:
            for u in (sf["u0"], sf["u1"]):
                x = int((u + margin) * px_per_m)
                cv2.line(out, (x, int((top - sf["band_h"]) * px_per_m)), (x, out.shape[0] - 1), (255, 0, 255), 2)
    return out


def run(model_id: str, edge: int | None = None, photos: list[int] | None = None,
        px_per_m: int = 40, plane_offset: float = 0.0,
        urange: tuple[float, float] | None = None) -> list[str]:
    model = json.loads((LAB / "models" / f"{model_id}.json").read_text())
    edge = model["storefronts"][0]["edge"] if edge is None else edge
    dest = OUT / "rectified"
    dest.mkdir(parents=True, exist_ok=True)
    out = []
    for i in photos if photos is not None else range(len(model["photos"])):
        p = model["photos"][i]
        img = rectify(model, p, edge, px_per_m, plane_offset=plane_offset, urange=urange)
        f = dest / f"{model_id}-w{edge}-p{i}.jpg"
        cv2.putText(img, f"{model_id} wall {edge} photo {i} {p['frame_id']} {p.get('captured_at', '')[:10]} {p['camera_type']}",
                    (6, 16), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1)
        cv2.imwrite(str(f), img, [cv2.IMWRITE_JPEG_QUALITY, 85])
        out.append(str(f))
    return out


def set_align(model_id: str, photo: int, du: float = 0.0, dn: float = 0.0, edge: int | None = None,
              **extra: float) -> dict:
    """Move a photo's camera ``du`` along and ``dn`` out from a wall (metres, added to what is
    saved), and set any of dyaw/dpitch/dfov/dz outright. Saved into the model's photo."""
    path = LAB / "models" / f"{model_id}.json"
    model = json.loads(path.read_text())
    edge = model["storefronts"][0]["edge"] if edge is None else edge
    _, t, n, _ = wall_frame(model, edge)
    p = model["photos"][photo]
    al = dict(p.get("align") or {})
    al["dx"] = round(al.get("dx", 0) + du * t[0] + dn * n[0], 3)
    al["dy"] = round(al.get("dy", 0) + du * t[1] + dn * n[1], 3)
    for k, v in extra.items():
        if v is not None:
            al[k] = v
    p["align"] = al
    path.write_text(json.dumps(model, indent=1))
    return al
