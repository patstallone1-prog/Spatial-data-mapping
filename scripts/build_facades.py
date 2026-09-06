#!/usr/bin/env python3
"""Dress one chunk of the city in the photographs we already hold.

Two modes. ``--survey`` walks the whole mapped region, cuts it into chunks, and reports which
of them have enough imagery, standing in the right places, to photograph their buildings; it
writes a chunk layer the map can draw. ``--chunk KEY`` then takes one of them and does the
work: for every wall of every building, find the frame that looks at it most squarely, fetch
that frame, rectify the wall out of it, and write a texture with the licence and the
photographer recorded beside it.

Nothing here invents pixels. A wall with no camera in front of it keeps the procedural facade
it has now, and the manifest says which walls are photographs and which are not.
"""

from __future__ import annotations

import argparse
import concurrent.futures as futures
import json
import math
import os
import sys
import time
import urllib.request
from collections import Counter
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

import pyarrow.parquet as pq  # noqa: E402

from smc.facades.chunks import Chunk, ChunkIndex, chunk_grid  # noqa: E402
from smc.facades.geometry import (  # noqa: E402
    DEFAULT_CAMERA_HEIGHT_M,
    MAX_STANDOFF_M,
    Camera,
    LocalFrame,
    score_view,
    walls_of,
)
from smc.facades.rectify import compose, fill_gaps, rectify_wall  # noqa: E402

MAP_JSON = ROOT / "docs" / "sf-corridor-3d.json"
CATALOG = ROOT / "data" / "sf_corridor" / "observations" / "external-000.parquet"
CHUNK_LAYER = ROOT / "docs" / "sf-corridor-chunks.json"
TEXTURE_ROOT = ROOT / "docs" / "facades"
CACHE = ROOT / "build" / "facade-cache"

USER_AGENT = "spatial-mapping-crowdsource/facades (+non-commercial research)"

#: A wall the cameras saw less than this much of is not worth a texture -- what comes back is
#: mostly the flat wash, and a procedural facade is a better guess than a smear.
MIN_COVERAGE = 0.35
#: Same idea in metres: one storey of real building, or leave it procedural. A car-mounted
#: camera across a nine-metre street sees about that much of the frontage opposite, so asking
#: for more would refuse most of the city.
MIN_VISIBLE_M = 3.2
#: How many frames may be merged into one wall. Three is the fewest that lets a median outvote
#: a parked van; past eight the extra views are oblique and add blur rather than wall.
VIEWS_PER_WALL = 8
#: A wall built from fewer views than this cannot be checked against anything, and an unchecked
#: facade is as likely to be a picture of the road as of the building.
MIN_VIEWS = 3
#: How closely those views must agree before we believe we found the wall. Tuned against a
#: hand-inspected sheet: real facades land at 0.75 and up, roadway smears below 0.6.
MIN_AGREEMENT = 0.75
#: Panoramas are stitched gravity-aligned, so their pitch is known to be zero. Nothing else is:
#: the catalogue carries a pitch for 1,215 frames out of 273,277, and a dashcam angled down at
#: the road is indistinguishable from one held level until its rectification disagrees with
#: everyone else's. Perspective frames are still used -- they carry three times the resolution
#: on a facade -- but a panorama wins any tie.
PERSPECTIVE_TRUST = 0.35
#: Ninety metres of wall in one texture is a warehouse; beyond this the 1024 px cap makes the
#: rectification coarser than the procedural facade it replaces.
MAX_WALL_M = 90.0
#: Perspective frames without a stated field of view. Most street-level rigs land near here,
#: and being ten degrees out shifts a facade by about a metre at twenty -- visible, but the
#: alternative is discarding two thirds of KartaView.
ASSUMED_HFOV_DEG = 70.0


# ---- catalogue ------------------------------------------------------------------------------


def load_observations() -> dict:
    columns = [
        "observation_uid", "provider", "provider_instance", "provider_sequence_id",
        "provider_image_id", "latitude", "longitude", "heading_deg", "horizontal_fov",
        "projection_type", "original_width", "original_height", "estimated_camera_height",
        "eligible", "license_id", "attribution", "contributor_identifier",
    ]
    return pq.read_table(CATALOG, columns=columns).to_pydict()


def camera_for(rows: dict, i: int, frame: LocalFrame) -> Camera | None:
    heading = rows["heading_deg"][i]
    width = rows["original_width"][i]
    height = rows["original_height"][i]
    if heading is None or not width or not height:
        return None
    spherical = rows["projection_type"][i] == "spherical"
    hfov = rows["horizontal_fov"][i]
    if not spherical:
        if hfov and 20.0 < hfov < 160.0:
            hfov_rad = math.radians(hfov)
        else:
            hfov_rad = math.radians(ASSUMED_HFOV_DEG)
    else:
        hfov_rad = None
    x, y = frame.to_xy(rows["longitude"][i], rows["latitude"][i])
    z = rows["estimated_camera_height"][i] or DEFAULT_CAMERA_HEIGHT_M
    return Camera(x=x, y=y, z=float(z), yaw_rad=math.radians(float(heading)),
                  width=int(width), height=int(height), spherical=spherical, hfov_rad=hfov_rad)


# ---- survey ---------------------------------------------------------------------------------


def survey(size_m: float) -> tuple[dict, dict[str, Chunk]]:
    payload = json.loads(MAP_JSON.read_text())
    bbox = payload["bbox"]
    chunks = chunk_grid(bbox, size_m=size_m)
    index = ChunkIndex(chunks)

    buildings = [w for w in payload["ways"] if w.get("kind") == "building" and w.get("covered")]
    for n, building in enumerate(buildings):
        lon, lat = building["centroid"]
        chunk = index.find(lon, lat)
        if chunk is not None:
            chunk.buildings.append(n)

    rows = load_observations()
    for i in range(len(rows["latitude"])):
        if not rows["eligible"][i] or rows["heading_deg"][i] is None:
            continue
        chunk = index.find(rows["longitude"][i], rows["latitude"][i])
        if chunk is not None:
            chunk.observations += 1

    ranked = sorted(
        (c for c in chunks.values() if c.buildings),
        key=lambda c: readiness(c), reverse=True,
    )
    return {"payload": payload, "buildings": buildings, "rows": rows,
            "ranked": ranked, "size_m": size_m}, chunks


def readiness(chunk: Chunk) -> float:
    """How well a chunk could be photographed: buildings, and cameras per building.

    Cameras alone favour a chunk that is one busy intersection; buildings alone favour a chunk
    nobody has driven. The product of the two, with the camera term flattened, prefers a block
    that is both built up and driven through.
    """
    if not chunk.buildings:
        return 0.0
    per_building = chunk.observations / len(chunk.buildings)
    return len(chunk.buildings) * math.log1p(min(per_building, 60.0))


# ---- extraction -----------------------------------------------------------------------------


def fetch_image(provider_name: str, sequence_id: str, image_id: str) -> np.ndarray | None:
    """Resolve a locator through the provider's own API and download the pixels.

    Cached on disk. The catalogue deliberately stores no URLs -- provider CDN links expire --
    so every frame costs one metadata call the first time it is wanted and nothing thereafter.
    """
    cache_path = CACHE / provider_name / f"{image_id}.jpg"
    if cache_path.exists():
        data = np.frombuffer(cache_path.read_bytes(), dtype=np.uint8)
        image = cv2.imdecode(data, cv2.IMREAD_COLOR)
        return image
    url = resolve_url(provider_name, sequence_id, image_id)
    if not url:
        return None
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            blob = response.read()
    except Exception:
        return None
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_bytes(blob)
    return cv2.imdecode(np.frombuffer(blob, dtype=np.uint8), cv2.IMREAD_COLOR)


_PROVIDERS: dict = {}


def resolve_url(provider_name: str, sequence_id: str, image_id: str) -> str | None:
    from smc.imagery.schema import Observation

    if provider_name not in _PROVIDERS:
        if provider_name == "mapillary":
            from smc.imagery.mapillary import MapillaryProvider
            _PROVIDERS[provider_name] = MapillaryProvider()
        elif provider_name == "kartaview":
            from smc.imagery.kartaview import KartaViewProvider
            _PROVIDERS[provider_name] = KartaViewProvider()
        elif provider_name == "panoramax":
            from smc.imagery.panoramax import PanoramaxProvider
            _PROVIDERS[provider_name] = PanoramaxProvider()
        else:
            _PROVIDERS[provider_name] = None
    provider = _PROVIDERS[provider_name]
    if provider is None:
        return None
    stub = Observation(
        observation_uid="", provider=provider_name, provider_instance="",
        provider_image_id=image_id, provider_sequence_id=sequence_id,
        sequence_uid="", provider_sequence_index=0, captured_at=None,
        latitude=0.0, longitude=0.0,
    )
    try:
        return provider.resolve_image(stub).url
    except Exception:
        return None


def candidates_for(rows: dict, frame: LocalFrame, chunk: Chunk) -> list[int]:
    """Observation rows standing near enough to this chunk to see into it."""
    pad_lat = MAX_STANDOFF_M / 111_320.0
    pad_lon = pad_lat / math.cos(math.radians((chunk.south + chunk.north) / 2.0))
    picked = []
    for i in range(len(rows["latitude"])):
        if not rows["eligible"][i] or rows["heading_deg"][i] is None:
            continue
        lon, lat = rows["longitude"][i], rows["latitude"][i]
        if (chunk.west - pad_lon <= lon <= chunk.east + pad_lon
                and chunk.south - pad_lat <= lat <= chunk.north + pad_lat):
            picked.append(i)
    return picked


def extract(chunk: Chunk, state: dict, *, limit: int | None, workers: int,
            progress) -> dict:
    payload, buildings, rows = state["payload"], state["buildings"], state["rows"]
    bbox = payload["bbox"]
    frame = LocalFrame((bbox["south"] + bbox["north"]) / 2.0,
                       (bbox["west"] + bbox["east"]) / 2.0)

    pool = candidates_for(rows, frame, chunk)
    progress(f"{chunk.key}: {len(chunk.buildings)} buildings, {len(pool)} frames within reach")
    cameras = {i: camera_for(rows, i, frame) for i in pool}
    cameras = {i: c for i, c in cameras.items() if c is not None}

    # -- pair every wall with the frames that look at it most squarely -------------------
    jobs: list[dict] = []
    skipped = Counter()
    for building_index in chunk.buildings:
        building = buildings[building_index]
        ring = [frame.to_xy(lon, lat) for lon, lat in building["points"]]
        height = float(building.get("height_m") or 10.5)
        for wall in walls_of(ring, height, building_index):
            if wall.length_m > MAX_WALL_M:
                skipped["wall too long"] += 1
                continue
            scored = []
            for i, camera in cameras.items():
                score = score_view(wall, camera)
                if score is not None:
                    scored.append((score * (1.0 if camera.spherical else PERSPECTIVE_TRUST), i))
            if not scored:
                skipped["no camera in front of it"] += 1
                continue
            scored.sort(reverse=True)
            jobs.append({"wall": wall, "views": scored[:VIEWS_PER_WALL]})

    if limit:
        jobs = sorted(jobs, key=lambda j: -j["views"][0][0])[:limit]
    progress(f"{chunk.key}: {len(jobs)} walls have a camera; {dict(skipped)} skipped")

    out_dir = TEXTURE_ROOT / chunk.key
    out_dir.mkdir(parents=True, exist_ok=True)
    # A rerun with a tighter gate leaves the textures it no longer believes in on disk, and the
    # directory stops matching its own manifest.
    for stale in out_dir.glob("*.jpg"):
        stale.unlink()

    walls_out: list[dict] = []
    failures = Counter()
    done = 0

    def run(job: dict) -> dict:
        wall = job["wall"]
        views = []
        used = []
        for score, row_index in job["views"]:
            image = fetch_image(rows["provider"][row_index],
                                rows["provider_sequence_id"][row_index],
                                rows["provider_image_id"][row_index])
            if image is None:
                continue
            camera = cameras[row_index]
            # The catalogue records the frame's own dimensions; the file we get may be a
            # resized rendition. The projection is in pixels, so it has to follow the pixels we
            # actually hold rather than the ones the metadata promised.
            actual_h, actual_w = image.shape[:2]
            if (actual_w, actual_h) != (camera.width, camera.height):
                camera = Camera(camera.x, camera.y, camera.z, camera.yaw_rad,
                                actual_w, actual_h, camera.spherical, camera.hfov_rad)
            view = rectify_wall(image, camera, wall, weight=score)
            if view is None or view.coverage < 0.02:
                continue
            views.append(view)
            used.append(row_index)
        if not views:
            return {"error": "no frame held any of the wall"}
        composite = compose(views, wall)
        if composite is None:
            return {"error": "no frame held any of the wall"}
        if composite.views < MIN_VIEWS:
            return {"error": "too few views to check against each other"}
        if composite.agreement < MIN_AGREEMENT:
            return {"error": "the views disagree -- a pose is wrong"}
        if composite.coverage < MIN_COVERAGE or composite.visible_height_m < min(
            MIN_VISIBLE_M, wall.height_m
        ):
            return {"error": "too little of the wall was in shot"}

        name = f"{wall.building_index}-{wall.wall_index}.jpg"
        cv2.imwrite(str(out_dir / name), fill_gaps(composite, wall),
                    [cv2.IMWRITE_JPEG_QUALITY, 80])
        a_lon, a_lat = frame.to_lonlat(*wall.a)
        b_lon, b_lat = frame.to_lonlat(*wall.b)
        return {
            "texture": name,
            "building": wall.building_index,
            "wall": wall.wall_index,
            "a": [round(a_lon, 7), round(a_lat, 7)],
            "b": [round(b_lon, 7), round(b_lat, 7)],
            # Which way the wall faces, as a compass bearing. The order of a and b does not
            # settle this on its own -- a clockwise footprint runs the other way round -- and a
            # panel hung back to front shows the map its own reverse side.
            "normal_deg": round(math.degrees(math.atan2(wall.normal[0], wall.normal[1])) % 360, 1),
            "height_m": round(wall.height_m, 2),
            "photo_height_m": round(composite.visible_height_m, 2),
            "coverage": round(composite.coverage, 3),
            "agreement": round(composite.agreement, 3),
            "views": composite.views,
            "rejected_views": composite.rejected,
            "providers": sorted({rows["provider"][i] for i in used}),
            "observations": [rows["observation_uid"][i] for i in used],
            "licenses": sorted({rows["license_id"][i] for i in used if rows["license_id"][i]}),
            "attribution": sorted({
                rows["attribution"][i] or rows["contributor_identifier"][i] or ""
                for i in used
            } - {""}),
        }

    with futures.ThreadPoolExecutor(max_workers=workers) as pool_exec:
        for result in pool_exec.map(run, jobs):
            if "error" in result:
                failures[result["error"]] += 1
            else:
                walls_out.append(result)
            done += 1
            if done % 50 == 0:
                progress(f"{chunk.key}: {done}/{len(jobs)} walls, {len(walls_out)} textured")

    licenses = Counter()
    for wall_out in walls_out:
        for name in wall_out["licenses"]:
            licenses[name] += 1
    manifest = {
        "chunk": chunk.key,
        "bbox": {"west": chunk.west, "south": chunk.south,
                 "east": chunk.east, "north": chunk.north},
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "buildings_in_chunk": len(chunk.buildings),
        "walls_attempted": len(jobs),
        "walls_textured": len(walls_out),
        "failures": dict(failures),
        "min_agreement": MIN_AGREEMENT,
        "spherical_convention": "equirectangular centre column on the reported compass heading",
        "licenses": dict(licenses),
        "walls": sorted(walls_out, key=lambda w: (w["building"], w["wall"])),
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=1))
    return manifest


# ---- entry ----------------------------------------------------------------------------------


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--survey", action="store_true", help="rank every chunk and stop")
    ap.add_argument("--chunk", help="chunk key to texture, or 'best'")
    ap.add_argument("--size-m", type=float, default=250.0)
    ap.add_argument("--limit", type=int, default=None, help="cap walls, for a quick look")
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--top", type=int, default=12)
    args = ap.parse_args()

    def progress(message: str) -> None:
        print(message, flush=True)

    CACHE.mkdir(parents=True, exist_ok=True)
    state, chunks = survey(args.size_m)
    ranked = state["ranked"]

    layer = {
        "size_m": args.size_m,
        "chunks": [
            {"key": c.key, "west": round(c.west, 6), "south": round(c.south, 6),
             "east": round(c.east, 6), "north": round(c.north, 6),
             "buildings": len(c.buildings), "observations": c.observations,
             "readiness": round(readiness(c), 1)}
            for c in chunks.values() if c.buildings or c.observations
        ],
    }
    CHUNK_LAYER.write_text(json.dumps(layer, separators=(",", ":")))
    progress(f"{len(layer['chunks'])} chunks with anything in them "
             f"(of {len(chunks)} over the region); wrote {CHUNK_LAYER.name}")
    for chunk in ranked[: args.top]:
        progress(f"  {chunk.key}: {len(chunk.buildings):4d} buildings  "
                 f"{chunk.observations:6d} frames  readiness {readiness(chunk):7.1f}")

    if args.survey or not args.chunk:
        return 0

    chosen = ranked[0] if args.chunk == "best" else chunks.get(args.chunk)
    if chosen is None:
        progress(f"no such chunk: {args.chunk}")
        return 2
    manifest = extract(chosen, state, limit=args.limit, workers=args.workers,
                       progress=progress)
    progress(f"{chosen.key}: {manifest['walls_textured']} of {manifest['walls_attempted']} "
             f"walls textured; failures {manifest['failures']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
