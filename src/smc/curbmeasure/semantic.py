"""Kerbs measured from photographs: segmentation, pose and the ground plane.

The plane-sweep stereo in :mod:`smc.curbmeasure.stereo` paired no kerb with the lidar: the
road beside a camera is grey and featureless, so dense matching has nothing to hold on to at
the five to ten metres where a kerb is. This does not match anything. It reads one photograph
at a time with three things the photograph already comes with:

* **What each pixel is.** Mapillary segments every image it holds (its Vistas classes), and
  ``construction--barrier--curb`` is one of the classes: the kerb face as a band of pixels with
  road below it and footway above it.
* **Where the camera is pointing.** ``computed_rotation`` is the structure-from-motion
  orientation, levelled to gravity, so every pixel is a ray in the world.
* **How high the camera is.** ``computed_altitude`` is solved against the ground: less the
  lidar's ground under the camera, it is the camera's height above the road -- noisy from one
  frame to the next, steady over a drive, so a sequence's median is what is used.

The foot of the kerb face is on the road. Its ray, met with the road plane a camera height
below, places the kerb in plan. The top of the face is straight above the foot: its ray's
depression at that horizontal distance gives the kerb's height. A face whose segmentation
takes in the stone's top as well puts the top edge a little behind the face, and that reads
as a kerb a little too tall by ``width x tan(depression)``; it shrinks with distance, so with
views from several distances it can be solved out (``fit_face``).
"""

from __future__ import annotations

import json
import math
import os
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path

import certifi
import numpy as np
from PIL import Image as PILImage
from PIL import ImageDraw

from smc.curbmeasure.geometry import rodrigues
from smc.imagery.mvt import polygons

API = "https://graph.mapillary.com"
CLASSES = {
    "construction--flat--road": 1,
    "construction--flat--service-lane": 1,
    "construction--flat--bike-lane": 1,
    "construction--flat--parking": 1,
    "construction--flat--crosswalk-plain": 1,
    "marking--discrete--crosswalk-zebra": 1,
    "construction--barrier--curb": 2,
    "construction--flat--sidewalk": 3,
    "construction--flat--curb-cut": 4,
    "construction--flat--driveway": 4,
    "construction--flat--pedestrian-area": 3,
    "construction--structure--building": 5,
}
ROAD, CURB, WALK, CUT = 1, 2, 3, 4
BACK_WALL = 5
#: Drawn in this order: a kerb band is narrow and must not be painted over by the road beside it.
DRAW_ORDER = (ROAD, WALK, CUT, BACK_WALL, CURB)
FIELDS = (
    "id,sequence,merge_cc,camera_type,camera_parameters,width,height,computed_geometry,"
    "computed_altitude,computed_rotation,captured_at,make,model,"
    "detections.value,detections.geometry"
)
#: The working raster: wide enough that a 15 cm face ten metres off spans pixels, not a pixel.
SPHERICAL_SIZE = (4096, 2048)
PERSPECTIVE_LONG_SIDE = 2048
#: The kerb face nearer than this is under the camera's own bonnet or mount; further than this
#: and a pixel is too many centimetres for a height.
NEAR_M, FAR_M = 2.5, 14.0
#: A band thinner than this is a painted line or a segmentation sliver, not a face.
MIN_BAND_PX = 2


def metres_per_degree(lat: float) -> tuple[float, float]:
    """WGS84 local east/north scale, shared by projection and validation."""
    phi = math.radians(lat)
    e2 = 6.69437999014e-3
    d = 1 - e2 * math.sin(phi) ** 2
    return (
        math.pi / 180 * 6378137 / math.sqrt(d) * math.cos(phi),
        math.pi / 180 * 6378137 * (1 - e2) / d**1.5,
    )


def _token() -> str:
    value = os.environ.get("MAPILLARY_TOKEN") or os.environ.get("MAPILLARY_ACCESS_TOKEN")
    if not value:
        raise RuntimeError("MAPILLARY_TOKEN is not set (source .env.local)")
    return value


def _get(path: str, **query) -> dict:
    query["access_token"] = _token()
    url = f"{API}/{path}?{urllib.parse.urlencode(query)}"
    context = ssl.create_default_context(cafile=certifi.where())
    last: Exception | None = None
    for attempt in range(5):
        try:
            with urllib.request.urlopen(url, timeout=90, context=context) as response:
                return json.loads(response.read())
        except urllib.error.HTTPError as error:
            if error.code < 500 and error.code != 429:
                raise
            last = error
        except OSError as error:
            last = error
        time.sleep(2**attempt)
    raise RuntimeError(f"Mapillary request failed: {last}")


def fetch(image_id: str, cache: Path) -> dict | None:
    """An image's pose and its kerb-relevant segmentation, fetched once."""
    path = cache / f"{image_id}.json"
    if path.exists():
        return json.loads(path.read_text()) or None
    try:
        doc = _get(str(image_id), fields=FIELDS)
    except (urllib.error.HTTPError, RuntimeError):
        return None
    detections = [
        d
        for d in (doc.pop("detections", {}) or {}).get("data", [])
        if d.get("value") in CLASSES and d.get("geometry")
    ]
    doc["detections"] = detections
    cache.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc, separators=(",", ":")))
    return doc


@dataclass
class View:
    """One posed photograph, as rays."""

    id: str
    sequence: str
    camera_type: str
    lon: float
    lat: float
    altitude: float
    rotation: np.ndarray  # world (ENU) -> camera
    focal: float
    k1: float
    k2: float
    width: int
    height: int
    raster: tuple[int, int]  # working (w, h)

    @classmethod
    def from_doc(cls, doc: dict) -> View | None:
        geometry = doc.get("computed_geometry")
        rotation = doc.get("computed_rotation")
        if not geometry or rotation is None or doc.get("computed_altitude") is None:
            return None
        kind = doc.get("camera_type") or "perspective"
        width, height = int(doc.get("width") or 0), int(doc.get("height") or 0)
        if not width or not height:
            return None
        if kind in ("spherical", "equirectangular"):
            raster = SPHERICAL_SIZE
            kind = "spherical"
        elif kind == "perspective":
            scale = PERSPECTIVE_LONG_SIDE / max(width, height)
            raster = (round(width * scale), round(height * scale))
        else:
            return None
        params = [*(doc.get("camera_parameters") or []), 0.0, 0.0, 0.0]
        if kind == "perspective" and (not np.isfinite(params[0]) or params[0] <= 0):
            return None
        if (
            len(rotation) != 3
            or not np.isfinite(rotation).all()
            or not np.isfinite(doc["computed_altitude"])
        ):
            return None
        lon, lat = geometry["coordinates"][:2]
        return cls(
            str(doc["id"]),
            str(doc.get("sequence") or ""),
            kind,
            float(lon),
            float(lat),
            float(doc["computed_altitude"]),
            rodrigues(rotation),
            float(params[0] or 0.0),
            float(params[1] or 0.0),
            float(params[2] or 0.0),
            width,
            height,
            raster,
        )

    def rays(self, u: np.ndarray, v: np.ndarray) -> np.ndarray:
        """World (east, north, up) unit rays for working-raster pixel centres."""
        w, h = self.raster
        if self.camera_type == "spherical":
            lon = ((u + 0.5) / w - 0.5) * 2 * math.pi
            lat = -((v + 0.5) / h - 0.5) * math.pi
            cam = np.column_stack(
                [np.cos(lat) * np.sin(lon), -np.sin(lat), np.cos(lat) * np.cos(lon)]
            )
        else:
            # Mapillary normalises by the larger side about the image centre.
            big = max(w, h)
            xn = ((u + 0.5) - w / 2) / big / self.focal
            yn = ((v + 0.5) - h / 2) / big / self.focal
            x, y = xn.copy(), yn.copy()
            for _ in range(6):
                r2 = x * x + y * y
                d = 1 + self.k1 * r2 + self.k2 * r2 * r2
                x, y = xn / d, yn / d
            cam = np.column_stack([x, y, np.ones_like(x)])
            cam /= np.linalg.norm(cam, axis=1, keepdims=True)
        return cam @ self.rotation  # R^T on the right: camera -> world


def label_raster(doc: dict, size: tuple[int, int]) -> np.ndarray:
    image = PILImage.new("L", size, 0)
    draw = ImageDraw.Draw(image)
    by_class: dict[int, list] = {}
    for detection in doc.get("detections", []):
        by_class.setdefault(CLASSES[detection["value"]], []).extend(polygons(detection["geometry"]))
    w, h = size
    for label in DRAW_ORDER:
        for ring in by_class.get(label, []):
            if len(ring) >= 3:
                draw.polygon([(x * w, y * h) for x, y in ring], fill=label, outline=label)
    return np.asarray(image)


def kerb_columns(labels: np.ndarray, step: int = 2) -> list[tuple[int, int, int]]:
    """``(column, top row, bottom row)`` of every kerb band with footway above and road below.

    Read down a column: footway (or a dropped kerb's apron), then the kerb band, then road. The
    band's last row is the foot of the face, on the road; its first row is the top.
    """
    out = []
    h = labels.shape[0]
    for u in range(0, labels.shape[1], step):
        col = labels[:, u]
        rows = np.flatnonzero(col == CURB)
        if not len(rows):
            continue
        breaks = np.flatnonzero(np.diff(rows) > 1)
        starts = np.concatenate([[rows[0]], rows[breaks + 1]])
        ends = np.concatenate([rows[breaks], [rows[-1]]])
        for top, bottom in zip(starts, ends, strict=True):
            if bottom - top + 1 < MIN_BAND_PX or top < 3 or bottom > h - 4:
                continue
            above = col[max(0, top - 3) : top]
            below = col[bottom + 1 : bottom + 4]
            if (above == WALK).sum() + (above == CUT).sum() < 2 or (below == ROAD).sum() < 2:
                continue
            out.append((u, int(top), int(bottom)))
    return out


@dataclass
class KerbObservation:
    image: str
    sequence: str
    lon: float
    lat: float
    distance_m: float  # horizontal, camera to the foot of the face
    tan_top: float  # depression of the top edge's ray
    height_m: float  # as read, before any stone-top correction
    camera_height_m: float
    bearing_deg: float  # from the camera to the foot

    def to_json(self) -> dict:
        return {
            "image": self.image,
            "sequence": self.sequence,
            "lon": round(self.lon, 8),
            "lat": round(self.lat, 8),
            "d": round(self.distance_m, 3),
            "tan_top": round(self.tan_top, 5),
            "h": round(self.height_m, 4),
            "H": round(self.camera_height_m, 3),
            "bearing": round(self.bearing_deg, 1),
        }


def measure(
    view: View,
    labels: np.ndarray,
    camera_height_m: float,
    *,
    grade_e_n: tuple[float, float] = (0.0, 0.0),
) -> list[KerbObservation]:
    """Every kerb column in one photograph, placed and heighted."""
    if not math.isfinite(camera_height_m) or camera_height_m <= 0:
        raise ValueError("positive finite camera height required")
    if labels.shape != (view.raster[1], view.raster[0]):
        raise ValueError("segmentation must use the view's raster")
    grade = np.asarray(grade_e_n, dtype=float)
    if grade.shape != (2,) or not np.isfinite(grade).all():
        raise ValueError("finite east/north road grade required")
    columns = kerb_columns(labels)
    if not columns:
        return []
    cols = np.array(columns, dtype=float)
    foot = view.rays(cols[:, 0], cols[:, 2] + 0.5)  # the face's foot: the band's last row
    top = view.rays(cols[:, 0], cols[:, 1] - 0.5)  # its top: the band's first row
    down_f = foot[:, :2] @ grade - foot[:, 2]
    keep = down_f > 0.02
    horizontal_f = np.hypot(foot[:, 0], foot[:, 1])
    distance = np.where(keep, camera_height_m * horizontal_f / np.maximum(down_f, 1e-9), np.inf)
    keep &= (distance >= NEAR_M) & (distance <= FAR_M)
    horizontal_t = np.hypot(top[:, 0], top[:, 1])
    tan_top = -top[:, 2] / np.maximum(horizontal_t, 1e-9)
    unit_horizontal = foot[:, :2] / np.maximum(horizontal_f[:, None], 1e-9)
    height = camera_height_m - distance * (tan_top + unit_horizontal @ grade)
    kx, ky = metres_per_degree(view.lat)
    out = []
    for i in np.flatnonzero(keep):
        east = foot[i, 0] / horizontal_f[i] * distance[i]
        north = foot[i, 1] / horizontal_f[i] * distance[i]
        out.append(
            KerbObservation(
                view.id,
                view.sequence,
                view.lon + east / kx,
                view.lat + north / ky,
                float(distance[i]),
                float(tan_top[i]),
                float(height[i]),
                camera_height_m,
                float(math.degrees(math.atan2(east, north)) % 360),
            )
        )
    return out


def fit_face(heights: np.ndarray, tan_top: np.ndarray) -> tuple[float, float]:
    """A face's height and its stone-top bias, from views at several distances.

    Each reading is ``h + w * tan(depression)``: the height plus the stone's top width seen at
    that angle. A robust line through the readings against the tangent gives both; with too
    narrow a spread of angles the slope is not identified and the median is returned instead.
    """
    if len(heights) < 6 or np.ptp(tan_top) < 0.08:
        return float(np.median(heights)), float("nan")
    x, y = tan_top, heights
    best = (float(np.median(y)), 0.0)
    best_err = np.inf
    rng = np.random.default_rng(0)
    for _ in range(200):
        i, j = rng.choice(len(x), 2, replace=False)
        if abs(x[i] - x[j]) < 0.03:
            continue
        slope = (y[i] - y[j]) / (x[i] - x[j])
        if not 0.0 <= slope <= 0.35:
            continue
        intercept = y[i] - slope * x[i]
        err = np.median(np.abs(y - (intercept + slope * x)))
        if err < best_err:
            best, best_err = (float(intercept), float(slope)), err
    return best
