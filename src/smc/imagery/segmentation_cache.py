"""Mapillary's own per-image segmentation, kept as a small label map with the image's pose.

Mapillary publishes a semantic segmentation for each image (its Vistas classes). Two questions
in this project need only that, never the pixels: is there an overhead conductor where a span
between two poles would be seen (``object--wire-group`` vs open ``nature--sky``), and what is
the ground under a walker's feet (road/sidewalk vs terrain vs sand). Each image is reduced to a
coarse label raster plus its computed pose, so a cache of thousands of images stays a few tens
of megabytes and no photograph is stored.
"""

from __future__ import annotations

import base64
import json
import os
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
import zlib
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import certifi
import numpy as np
from PIL import Image, ImageDraw

from smc.imagery.mvt import polygons

API = "https://graph.mapillary.com"
LABELS = {
    "nature--sky": 1,
    "nature--vegetation": 7,
    "nature--water": 8,
    "nature--terrain": 5,
    "nature--sand": 6,
    "construction--flat--road": 3,
    "construction--flat--service-lane": 3,
    "construction--flat--bike-lane": 3,
    "construction--flat--parking": 3,
    "construction--flat--driveway": 4,
    "construction--flat--sidewalk": 4,
    "construction--flat--pedestrian-area": 4,
    "construction--flat--curb-cut": 4,
    "construction--barrier--curb": 4,
    "object--support--utility-pole": 9,
    "object--support--pole": 9,
    "object--wire-group": 2,
}
#: Drawn in this order, so a wire across the sky is a wire and a pole in front of a road a pole.
DRAW_ORDER = (1, 7, 8, 5, 6, 3, 4, 9, 2)
NAMES = {0: "other", 1: "sky", 2: "wire", 3: "road", 4: "sidewalk", 5: "terrain", 6: "sand",
         7: "vegetation", 8: "water", 9: "pole"}
FIELDS = ("camera_type,camera_parameters,computed_compass_angle,compass_angle,computed_geometry,"
          "geometry,width,height,sequence,captured_at,detections.value,detections.geometry")


def _token() -> str:
    token = os.environ.get("MAPILLARY_TOKEN") or os.environ.get("MAPILLARY_ACCESS_TOKEN")
    if not token:
        raise RuntimeError("MAPILLARY_TOKEN is not set (source .env.local)")
    return token


def _get(path: str, **query) -> dict:
    query["access_token"] = _token()
    url = f"{API}/{path}?{urllib.parse.urlencode(query)}"
    context = ssl.create_default_context(cafile=certifi.where())
    last = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=60, context=context) as response:
                return json.loads(response.read())
        except urllib.error.HTTPError as error:
            if error.code < 500 and error.code != 429:
                raise
            last = error
        except OSError as error:
            last = error
        time.sleep(2 ** attempt)
    raise RuntimeError(f"Mapillary request failed: {last}")


def raster_size(camera_type: str) -> tuple[int, int]:
    return (512, 256) if camera_type in {"spherical", "equirectangular"} else (384, 288)


def rasterize(detections: list[dict], size: tuple[int, int]) -> np.ndarray:
    width, height = size
    image = Image.new("L", size, 0)
    draw = ImageDraw.Draw(image)
    by_label: dict[int, list] = {}
    for detection in detections:
        label = LABELS.get(detection.get("value"))
        if label and detection.get("geometry"):
            by_label.setdefault(label, []).extend(polygons(detection["geometry"]))
    for label in DRAW_ORDER:
        for ring in by_label.get(label, []):
            if len(ring) >= 3:
                draw.polygon([(x * width, y * height) for x, y in ring], fill=label,
                             outline=label)
    return np.asarray(image)


def encode(labels: np.ndarray) -> str:
    return base64.b64encode(zlib.compress(labels.tobytes(), 9)).decode()


def decode(record: dict) -> np.ndarray:
    width, height = record["size"]
    return np.frombuffer(zlib.decompress(base64.b64decode(record["labels"])),
                         dtype=np.uint8).reshape(height, width)


def fetch_one(image_id: str) -> dict | None:
    try:
        doc = _get(str(image_id), fields=FIELDS)
    except urllib.error.HTTPError as error:
        return {"id": str(image_id), "error": f"http_{error.code}"}
    camera = doc.get("camera_type") or "perspective"
    if camera not in {"spherical", "equirectangular", "perspective"}:
        return {"id": str(image_id), "error": f"unsupported_camera_{camera}"}
    geometry = doc.get("computed_geometry") or doc.get("geometry")
    compass = doc.get("computed_compass_angle", doc.get("compass_angle"))
    if not geometry or compass is None:
        return {"id": str(image_id), "error": "no_pose"}
    size = raster_size(camera)
    labels = rasterize(doc.get("detections", {}).get("data", []), size)
    params = doc.get("camera_parameters") or []
    return {
        "id": str(image_id),
        "camera": "spherical" if camera != "perspective" else "perspective",
        "focal": params[0] if params else None,
        "width": doc.get("width"),
        "height": doc.get("height"),
        "lonlat": geometry["coordinates"][:2],
        "compass": compass,
        "sequence": doc.get("sequence"),
        "captured_at": doc.get("captured_at"),
        "pose_basis": "computed" if doc.get("computed_geometry") else "gps",
        "size": list(size),
        "labels": encode(labels),
        "license": "CC-BY-SA-4.0",
    }


class SegmentationCache:
    """An append-only JSONL of reduced images; fetched once, reused by every consumer."""

    def __init__(self, path: Path):
        self.path = path
        self.records: dict[str, dict] = {}
        if path.exists():
            for line in path.read_text().splitlines():
                if line.strip():
                    record = json.loads(line)
                    self.records[record["id"]] = record

    def ensure(self, image_ids: list[str], workers: int = 8, progress=None) -> None:
        missing = [str(i) for i in dict.fromkeys(image_ids) if str(i) not in self.records]
        if not missing:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open("a") as out, ThreadPoolExecutor(workers) as pool:
            for n, record in enumerate(pool.map(fetch_one, missing), 1):
                if record:
                    self.records[record["id"]] = record
                    out.write(json.dumps(record, separators=(",", ":")) + "\n")
                if progress and n % 250 == 0:
                    progress(n, len(missing))

    def get(self, image_id: str) -> dict | None:
        record = self.records.get(str(image_id))
        return record if record and "error" not in record else None


def images_in_box(west: float, south: float, east: float, north: float, depth: int = 0) -> list[dict]:
    """Image positions in a small box, for regions without a local metadata sweep.

    A dense box can make the API fail outright (HTTP 500); it is asked again as four
    quarters, twice over, and a box that still fails is left uncovered rather than fatal.
    """
    try:
        doc = _get("images", bbox=f"{west},{south},{east},{north}", limit=2000,
                   fields="id,computed_geometry,geometry,compass_angle,sequence,captured_at,camera_type")
    except (RuntimeError, urllib.error.HTTPError):
        if depth >= 2:
            return []
        mx, my = (west + east) / 2, (south + north) / 2
        return [item for box in ((west, south, mx, my), (mx, south, east, my),
                                 (west, my, mx, north), (mx, my, east, north))
                for item in images_in_box(*box, depth=depth + 1)]
    out = []
    for item in doc.get("data", []):
        geometry = item.get("computed_geometry") or item.get("geometry")
        if not geometry:
            continue
        out.append({"id": str(item["id"]), "lon": geometry["coordinates"][0],
                    "lat": geometry["coordinates"][1], "heading": item.get("compass_angle"),
                    "sequence": item.get("sequence"), "captured_at": item.get("captured_at"),
                    "camera": "spherical" if item.get("camera_type") in
                    {"spherical", "equirectangular"} else "perspective"})
    return out
