"""The photographs a block is built from: found, thinned, fetched at full size and recorded.

Only openly licensed street frames (Mapillary, CC BY-SA) are used; Street View, Waymo and
PandaSet never are. Each frame is fetched at its original resolution -- the most a
reconstruction can know -- and stored under ``images/<sequence>/<id>.jpg`` (one folder per
sequence: one camera per folder in the solver), with its SHA-256, its licence and its creator,
so the textures that come from it can be attributed and taken down.

Thinning is the only thing that drops a frame, and it drops nothing a reconstruction uses: a
frame closer than ``MIN_STEP_M`` to the last kept one in the same sequence (a car waiting at a
light records the same view dozens of times) adds matching time and no new viewpoint. 360
frames are kept out until the solver is given a spherical camera.
"""

from __future__ import annotations

import concurrent.futures
import hashlib
import json
import math
import time
import urllib.request
from dataclasses import asdict, dataclass
from pathlib import Path

from smc.imagery.mapillary import LICENSE, MapillaryProvider
from smc.imagery.region import BBox
from smc.worldmesh.block import Block

MIN_STEP_M = 1.0
#: A sequence with fewer usable frames than this in the halo cannot be matched to itself.
MIN_SEQUENCE_FRAMES = 3
FETCH_THREADS = 8


@dataclass
class Frame:
    id: str
    sequence: str
    lon: float
    lat: float
    altitude_m: float | None
    heading_deg: float | None
    captured_at: int | None
    width: int | None
    height: int | None
    camera_type: str
    focal: float | None          # Mapillary's, as a fraction of the larger side
    k1: float | None
    k2: float | None
    make: str | None
    model: str | None
    creator: str | None
    position_source: str
    url: str | None = None
    path: str | None = None
    sha256: str | None = None
    bytes: int | None = None
    licence: str = LICENSE.identifier
    attribution: str = LICENSE.attribution


def _point(geometry: dict | None) -> tuple[float, float] | None:
    if not geometry or geometry.get("type") != "Point":
        return None
    lon, lat = geometry["coordinates"][:2]
    return float(lon), float(lat)


def frame_from_row(row: dict) -> Frame | None:
    computed = _point(row.get("computed_geometry"))
    raw = _point(row.get("geometry"))
    where = computed or raw
    if where is None:
        return None
    params = row.get("camera_parameters") or []
    return Frame(
        id=str(row["id"]), sequence=str(row.get("sequence") or "unknown"),
        lon=where[0], lat=where[1],
        altitude_m=row.get("computed_altitude", row.get("altitude")),
        heading_deg=row.get("computed_compass_angle", row.get("compass_angle")),
        captured_at=row.get("captured_at"), width=row.get("width"), height=row.get("height"),
        camera_type=str(row.get("camera_type") or "perspective"),
        focal=float(params[0]) if len(params) > 0 else None,
        k1=float(params[1]) if len(params) > 1 else None,
        k2=float(params[2]) if len(params) > 2 else None,
        make=row.get("make"), model=row.get("model"),
        creator=(row.get("creator") or {}).get("username") or (row.get("creator") or {}).get("id"),
        position_source="mapillary_sfm" if computed else "gps",
        url=row.get("thumb_original_url"))


def _metres(a: Frame, b: Frame) -> float:
    dy = (a.lat - b.lat) * 111_320.0
    dx = (a.lon - b.lon) * 111_320.0 * math.cos(math.radians(a.lat))
    return math.hypot(dx, dy)


def thin(frames: list[Frame], min_step_m: float = MIN_STEP_M) -> list[Frame]:
    """Perspective frames, near-repeats along a sequence dropped, short sequences left out."""
    by_sequence: dict[str, list[Frame]] = {}
    for f in frames:
        if f.camera_type in ("perspective", "fisheye", "brown") and f.url:
            by_sequence.setdefault(f.sequence, []).append(f)
    kept: list[Frame] = []
    for run in by_sequence.values():
        run.sort(key=lambda f: (f.captured_at or 0, f.id))
        mine: list[Frame] = []
        for f in run:
            if not mine or _metres(f, mine[-1]) >= min_step_m:
                mine.append(f)
        if len(mine) >= MIN_SEQUENCE_FRAMES:
            kept.extend(mine)
    return kept


#: The image search answers the same box differently from one call to the next -- 833 frames,
#: then 359, for one halo, with no error either time (2026-10-30). So the halo is asked as a
#: grid of small boxes, again and again, until a whole pass finds nothing new.
SEARCH_GRID = 4
MAX_SEARCH_PASSES = 5


def find_frames(block: Block, provider: MapillaryProvider | None = None) -> list[Frame]:
    provider = provider or MapillaryProvider()
    west, south, east, north = block.halo_bbox()
    found: dict[str, Frame] = {}
    for _ in range(MAX_SEARCH_PASSES):
        before = len(found)
        for i in range(SEARCH_GRID):
            for j in range(SEARCH_GRID):
                box = BBox(south=south + (north - south) * j / SEARCH_GRID,
                           west=west + (east - west) * i / SEARCH_GRID,
                           north=south + (north - south) * (j + 1) / SEARCH_GRID,
                           east=west + (east - west) * (i + 1) / SEARCH_GRID)
                for row in provider.region_rows(box):
                    frame = frame_from_row(row)
                    if frame and frame.id not in found and west <= frame.lon <= east and south <= frame.lat <= north:
                        found[frame.id] = frame
        if before and len(found) == before:
            break
    return list(found.values())


def _download(url: str, attempts: int = 4) -> bytes:
    for attempt in range(attempts):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "kerbside-worldmesh/1"})
            with urllib.request.urlopen(request, timeout=60) as response:
                return response.read()
        except OSError:
            if attempt == attempts - 1:
                raise
            time.sleep(2 ** attempt)
    raise AssertionError("unreachable")


def fetch(frames: list[Frame], work: Path) -> list[Frame]:
    """Every frame's original picture under ``work/images``; a frame already there is kept."""
    images = work / "images"

    def one(frame: Frame) -> Frame | None:
        target = images / frame.sequence / f"{frame.id}.jpg"
        if not target.exists():
            try:
                blob = _download(frame.url)
            except OSError:
                return None
            if blob[:2] != b"\xff\xd8":
                return None
            target.parent.mkdir(parents=True, exist_ok=True)
            tmp = target.with_suffix(".part")
            tmp.write_bytes(blob)
            tmp.replace(target)
        blob = target.read_bytes()
        frame.path = str(target.relative_to(images))
        frame.sha256 = hashlib.sha256(blob).hexdigest()
        frame.bytes = len(blob)
        return frame

    with concurrent.futures.ThreadPoolExecutor(FETCH_THREADS) as pool:
        got = [f for f in pool.map(one, frames) if f is not None]
    return got


def write_manifest(frames: list[Frame], block: Block, work: Path) -> Path:
    path = work / "frames.json"
    rows = [{k: v for k, v in asdict(f).items() if k != "url"} for f in frames]  # signed, expiring
    path.write_text(json.dumps({"block": block.to_json(), "licence": LICENSE.identifier,
                                "frames": rows}, indent=1))
    return path


def read_manifest(work: Path) -> list[Frame]:
    data = json.loads((work / "frames.json").read_text())
    return [Frame(**row) for row in data["frames"]]
