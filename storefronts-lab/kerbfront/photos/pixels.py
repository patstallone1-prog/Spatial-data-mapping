"""Stage 2 photo filter: look at the pixels of the frames stage 1 kept.

For each (frame, face) the face's angular window is computed from the camera pose and the
footprint edge. Inside that window:

* **occlusion** -- share of the storefront band covered by Mapillary's segmentation of cars,
  trucks, buses, people, trees, poles, fences or the capture vehicle itself;
* **consistency** -- share covered by ``construction--structure--building``; a face window
  that segmentation calls sky or road means the pose or footprint is wrong for this frame;
* **sign visibility** -- store/advertisement sign and banner pixels in the sign band
  (2.4-5 m above grade), with an edge-density fallback when a frame has no detections;
* **sharpness** -- variance of the Laplacian on a perspective crop of the face;
* **exposure** -- clipped highlights/shadows and mean level on the same crop.

Spherical frames are re-projected to a perspective crop aimed at the face. Mapillary
equirectangular images put the camera's compass heading at the centre column.
"""

from __future__ import annotations

import math
from pathlib import Path

import cv2
import numpy as np
from shapely.geometry import Point, Polygon
from shapely.ops import unary_union
from shapely.prepared import prep

from ..faces import Face
from ..geo import ang_diff, bearing
from .geometry import CAMERA_HEIGHT_M, STOREFRONT_BAND

OCCLUDERS = ("object--vehicle", "human--", "nature--vegetation", "object--support",
             "construction--barrier--fence", "construction--barrier--wall", "void--car-mount",
             "void--ego-vehicle", "object--trash-can", "construction--structure--tunnel")
SIGNS = ("object--sign--store", "object--sign--advertisement", "object--banner")
BUILDING = ("construction--structure--building",)
SKY_ROAD = ("nature--sky", "construction--flat--road")
SIGN_BAND = (2.4, 5.0)


def group_of(value: str) -> str | None:
    if value.startswith(BUILDING):
        return "building"
    if value.startswith(SIGNS):
        return "sign"
    if value.startswith(OCCLUDERS):
        return "occluder"
    if value.startswith(SKY_ROAD):
        return "sky_road"
    return None


def _spherical(frame: dict) -> bool:
    return frame.get("camera_type") in ("spherical", "equirectangular") or frame.get("hfov", 0) >= 359


def _f_px(frame: dict, width: float) -> float:
    return (width / 2) / math.tan(math.radians(frame.get("hfov") or 70.0) / 2)


def to_angles(frame: dict, x: float, y: float) -> tuple[float, float]:
    """Normalized image point -> (yaw relative to heading, pitch) in degrees (level camera)."""
    if _spherical(frame):
        return (x - 0.5) * 360.0, (0.5 - y) * 180.0
    W, H = frame.get("width") or 4000, frame.get("height") or 3000
    f = _f_px(frame, W)
    xp, yp = (x - 0.5) * W, (0.5 - y) * H
    return math.degrees(math.atan2(xp, f)), math.degrees(math.atan2(yp, math.hypot(f, xp)))


def face_window(frame: dict, face: Face, cam: tuple[float, float],
                building_h: float | None) -> dict:
    heading = float(frame["heading"])
    y0 = ang_diff(bearing(face.p0[0] - cam[0], face.p0[1] - cam[1]), heading)
    y1 = ang_diff(bearing(face.p1[0] - cam[0], face.p1[1] - cam[1]), heading)
    mx, my = face.mid
    d = max(1.0, math.hypot(mx - cam[0], my - cam[1]))
    top = min(max(building_h or 9.0, 4.5), 14.0)

    def pitch(h: float) -> float:
        return math.degrees(math.atan2(h - CAMERA_HEIGHT_M, d))

    return {"yaw": (min(y0, y1), max(y0, y1)), "full": (pitch(0.0), pitch(top)),
            "store": (pitch(STOREFRONT_BAND[0]), pitch(STOREFRONT_BAND[1])),
            "sign": (pitch(SIGN_BAND[0]), pitch(SIGN_BAND[1])), "dist": d}


def coverage(dets: list[dict], frame: dict, yaw: tuple[float, float],
             pitch: tuple[float, float], nx: int = 32, ny: int = 12) -> dict[str, float]:
    groups: dict[str, list[Polygon]] = {}
    for det in dets:
        g = group_of(det["value"])
        if not g:
            continue
        for ring in det["rings"]:
            if len(ring) < 3:
                continue
            pts = [to_angles(frame, x, y) for x, y in ring]
            # a region crossing the panorama seam jumps ~360 deg between neighbours: unwrap it,
            # then add copies a turn either way so every window cell can be tested directly
            un = [pts[0]]
            for yw, pt in pts[1:]:
                while yw - un[-1][0] > 180:
                    yw -= 360
                while yw - un[-1][0] < -180:
                    yw += 360
                un.append((yw, pt))
            poly = Polygon(un)
            if not poly.is_valid:
                poly = poly.buffer(0)
            if poly.is_empty:
                continue
            groups.setdefault(g, []).append(poly)
            if _spherical(frame):
                from shapely.affinity import translate
                groups[g] += [translate(poly, 360), translate(poly, -360)]
    out = {}
    merged = {g: prep(unary_union(ps)) for g, ps in groups.items()}
    cells = [(yaw[0] + (yaw[1] - yaw[0]) * (i + 0.5) / nx,
              pitch[0] + (pitch[1] - pitch[0]) * (j + 0.5) / ny)
             for i in range(nx) for j in range(ny)]
    for g in ("building", "sign", "occluder", "sky_road"):
        if g not in merged:
            out[g] = 0.0
            continue
        out[g] = sum(merged[g].contains(Point(c)) for c in cells) / len(cells)
    return out


def equirect_view(img: np.ndarray, yaw_rel: float, pitch: float, hfov: float,
                  out_w: int = 960, out_h: int = 720) -> np.ndarray:
    H, W = img.shape[:2]
    f = (out_w / 2) / math.tan(math.radians(hfov) / 2)
    u, v = np.meshgrid(np.arange(out_w) - out_w / 2 + 0.5, np.arange(out_h) - out_h / 2 + 0.5)
    x, y, z = u / f, -v / f, np.ones_like(u)
    p = math.radians(pitch)
    y2 = y * math.cos(p) + z * math.sin(p)
    z2 = -y * math.sin(p) + z * math.cos(p)
    yw = math.radians(yaw_rel)
    x3 = x * math.cos(yw) + z2 * math.sin(yw)
    z3 = -x * math.sin(yw) + z2 * math.cos(yw)
    lon = np.arctan2(x3, z3)
    lat = np.arctan2(y2, np.hypot(x3, z3))
    mx = ((lon / (2 * math.pi) + 0.5) * W).astype(np.float32)
    my = ((0.5 - lat / math.pi) * H).astype(np.float32)
    return cv2.remap(img, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP)


def face_crop(img: np.ndarray, frame: dict, win: dict) -> np.ndarray:
    yaw_c = (win["yaw"][0] + win["yaw"][1]) / 2
    span = win["yaw"][1] - win["yaw"][0]
    pc = (win["full"][0] + win["full"][1]) / 2
    if _spherical(frame):
        return equirect_view(img, yaw_c, pc, min(100.0, max(40.0, span + 12.0)))
    H, W = img.shape[:2]
    f = _f_px(frame, W)
    x0 = int(W / 2 + f * math.tan(math.radians(max(-80.0, win["yaw"][0] - 4))))
    x1 = int(W / 2 + f * math.tan(math.radians(min(80.0, win["yaw"][1] + 4))))
    x0, x1 = max(0, x0), min(W, x1)
    return img[:, x0:x1] if x1 - x0 > 16 else img


def sharpness(gray: np.ndarray) -> float:
    g = gray
    if g.shape[1] > 800:
        g = cv2.resize(g, (800, int(g.shape[0] * 800 / g.shape[1])), interpolation=cv2.INTER_AREA)
    return float(cv2.Laplacian(g, cv2.CV_64F).var())


def exposure(gray: np.ndarray) -> dict:
    hi = float((gray >= 248).mean())
    lo = float((gray <= 8).mean())
    mean = float(gray.mean())
    p5, p95 = np.percentile(gray, [5, 95])
    score = 1.0 - 2.5 * max(0.0, hi - 0.04) - 2.5 * max(0.0, lo - 0.08)
    if mean < 55:
        score -= (55 - mean) / 80
    if mean > 205:
        score -= (mean - 205) / 60
    return {"mean": mean, "clip_hi": hi, "clip_lo": lo, "contrast": float(p95 - p5) / 255,
            "score": max(0.0, min(1.0, score))}


def edge_text_likeness(gray: np.ndarray) -> float:
    """Fallback sign cue: dense short vertical strokes in the upper half of the band crop."""
    band = gray[: max(1, gray.shape[0] // 2)]
    gx = cv2.Sobel(band, cv2.CV_32F, 1, 0, ksize=3)
    strong = (np.abs(gx) > 60).mean()
    return float(min(1.0, strong / 0.12))


def assess_pixels(frame: dict, face: Face, cam: tuple[float, float], building_h: float | None,
                  img_path: Path | None, dets: list[dict] | None,
                  crop_out: Path | None = None) -> dict:
    win = face_window(frame, face, cam, building_h)
    res: dict = {"frame_id": frame["id"], "face_id": face.id, "rejects": [], "metrics": {}}
    m = res["metrics"]
    if dets:
        full = coverage(dets, frame, win["yaw"], win["full"])
        store = coverage(dets, frame, win["yaw"], win["store"])
        sign = coverage(dets, frame, win["yaw"], win["sign"])
        m.update(building_share=full["building"], sky_road_share=full["sky_road"],
                 occluded_storefront=store["occluder"], sign_cover=sign["sign"])
        if full["building"] < 0.25 and full["sky_road"] > 0.35:
            res["rejects"].append("misaligned")
        if store["occluder"] > 0.6:
            res["rejects"].append("street_occluded")
        consistency = min(1.0, full["building"] / 0.5)
        occl = store["occluder"]
        sign_s = min(1.0, sign["sign"] / 0.04)
    else:
        consistency, occl, sign_s = 1.0, 0.0, None
        res["flags"] = ["no_detections"]
    if img_path is not None and Path(img_path).exists():
        img = cv2.imread(str(img_path))
        crop = face_crop(img, frame, win)
        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
        lap = sharpness(gray)
        exp = exposure(gray)
        s_sharp = max(0.0, min(1.0, (math.log(max(lap, 1.0)) - math.log(15)) / (math.log(400) - math.log(15))))
        m.update(laplacian_var=lap, exposure=exp["score"], mean_level=exp["mean"],
                 clip_hi=exp["clip_hi"], clip_lo=exp["clip_lo"], sharpness=s_sharp)
        if s_sharp < 0.15:
            res["rejects"].append("blurry")
        if exp["score"] < 0.3:
            res["rejects"].append("bad_exposure")
        if sign_s is None:
            sign_s = 0.5 * edge_text_likeness(gray)
        if crop_out is not None:
            crop_out.parent.mkdir(parents=True, exist_ok=True)
            cv2.imwrite(str(crop_out), crop, [cv2.IMWRITE_JPEG_QUALITY, 85])
            res["crop"] = str(crop_out)
    else:
        s_sharp, exp = 0.6, {"score": 0.7}
        res.setdefault("flags", []).append("no_pixels")
    m["sign_visibility"] = sign_s
    base = (s_sharp ** 0.3) * (exp["score"] ** 0.3) * (1 - occl) * consistency
    res["score"] = 0.0 if res["rejects"] else round(base, 4)
    res["score_sign"] = 0.0 if res["rejects"] else round(base * (0.4 + 0.6 * sign_s), 4)
    return res
