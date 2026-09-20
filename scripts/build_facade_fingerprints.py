#!/usr/bin/env python3
"""Read each building's facade off the photographs of it: its colour, and its fingerprint.

This is the background job behind two files:

* ``data/sf_public_works/building_colours.json`` -- the wall colour, sampled as a median over
  the rectified wall (scripts/build_building_colours.py did this for 14,490 buildings; that
  work is kept and only buildings with no colour yet are sampled here);
* ``data/sf_public_works/facade_fingerprints.json`` -- what the wall looks like beyond its
  colour (smc.facades.fingerprint): glazing share, texture, lightness spread, storey and bay
  rhythm. The page's build matches each fingerprint to the closest render it has
  (smc.facades.match), and the fingerprint outlives the catalogue: a render added later is
  matched against every building already read without another photograph being fetched.

Both files are keyed by OpenStreetMap id. The job is resumable -- every ``--checkpoint``
buildings a part is written under build/facade-fingerprints/ and a restart picks up from the
parts -- and it reads images through the same cache the facade extractor filled, so a building
whose frames are already on disk costs no download.

Run in the background::

    nohup .venv/bin/python scripts/build_facade_fingerprints.py --workers 4 \\
        > build/facade-fingerprints.log 2>&1 &
"""

from __future__ import annotations

import argparse
import concurrent.futures as futures
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "scripts"))

import build_facades as facades  # noqa: E402
import numpy as np  # noqa: E402
import pyarrow.parquet as pq  # noqa: E402
from build_building_colours import (  # noqa: E402
    FRAMES_PER_BUILDING,
    MAX_SAMPLE_SPREAD,
    dominant_colour,
)

from smc.facades.fingerprint import combine, fingerprint_patch, view_quality  # noqa: E402
from smc.facades.geometry import Camera, LocalFrame, score_view, walls_of  # noqa: E402
from smc.facades.rectify import rectify_wall  # noqa: E402

MAP_JSON = ROOT / "docs" / "sf-corridor-3d.json"
CATALOG = ROOT / "data" / "sf_corridor" / "observations" / "external-000.parquet"
COLOURS = ROOT / "data" / "sf_public_works" / "building_colours.json"
FINGERPRINTS = ROOT / "data" / "sf_public_works" / "facade_fingerprints.json"
PARTS = ROOT / "build" / "facade-fingerprints"
#: Finer than the colour sampler's 6 px/m: a storey rhythm needs the window rows resolved.
PIXELS_PER_M = 8.0


def load_keyed(path: Path) -> dict[str, dict]:
    if not path.exists():
        return {}
    data = json.loads(path.read_text())
    if data.get("keyed_by") != "osm_id":
        raise SystemExit(f"{path} is not keyed by osm_id")
    return data.get("buildings", {})


def write_keyed(path: Path, buildings: dict[str, dict], note: str) -> None:
    path.write_text(json.dumps({"keyed_by": "osm_id", "note": note, "buildings": buildings},
                               separators=(",", ":")))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--limit", type=int, default=None, help="cap the buildings attempted")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--checkpoint", type=int, default=100)
    ap.add_argument("--redo", action="store_true", help="fingerprint buildings already done")
    args = ap.parse_args()

    def progress(message: str) -> None:
        print(message, flush=True)

    payload = json.loads(MAP_JSON.read_text())
    bbox = payload["bbox"]
    frame = LocalFrame((bbox["south"] + bbox["north"]) / 2.0, (bbox["west"] + bbox["east"]) / 2.0)
    buildings = [w for w in payload["ways"]
                 if w.get("kind") == "building" and w.get("covered") and w.get("osm_id") is not None]
    progress(f"{len(buildings)} covered buildings with an id")

    colours = load_keyed(COLOURS)
    fingerprints = load_keyed(FINGERPRINTS)
    PARTS.mkdir(parents=True, exist_ok=True)
    for part in sorted(PARTS.glob("*.json")):
        try:
            for key, row in json.loads(part.read_text()).items():
                if row.get("fp"):
                    fingerprints.setdefault(key, row["fp"])
                if row.get("colour") and key not in colours:
                    colours[key] = row["colour"]
        except json.JSONDecodeError:
            part.unlink()
    progress(f"{len(colours)} colours and {len(fingerprints)} fingerprints already on record")

    rows = pq.read_table(CATALOG, columns=[
        "observation_uid", "provider", "provider_sequence_id", "provider_image_id",
        "latitude", "longitude", "heading_deg", "horizontal_fov", "projection_type",
        "original_width", "original_height", "eligible", "estimated_camera_height"]).to_pydict()
    cameras: dict[int, Camera] = {}
    grid: dict[tuple[int, int], list[int]] = defaultdict(list)
    for i in range(len(rows["observation_uid"])):
        if not rows["eligible"][i] or rows["heading_deg"][i] is None:
            continue
        camera = facades.camera_for(rows, i, frame)
        if camera is None:
            continue
        cameras[i] = camera
        grid[(int(camera.x // 40), int(camera.y // 40))].append(i)
    progress(f"{len(cameras)} usable cameras")

    jobs = []
    for index, building in enumerate(buildings):
        key = str(building["osm_id"])
        if key in fingerprints and not args.redo:
            continue
        ring = [frame.to_xy(lon, lat) for lon, lat in building["points"]]
        walls = walls_of(ring, float(building.get("height_m") or 10.5), index)
        if not walls:
            continue
        centre = walls[0].midpoint
        cell = (int(centre[0] // 40), int(centre[1] // 40))
        nearby: set[int] = set()
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                nearby.update(grid.get((cell[0] + dx, cell[1] + dy), ()))
        best = []
        for wall in walls:
            for i in nearby:
                score = score_view(wall, cameras[i])
                if score is not None:
                    best.append((score, i, wall))
        if not best:
            continue
        best.sort(key=lambda item: -item[0])
        chosen, seen_frames, seen_walls = [], set(), set()
        for _score, i, wall in best:
            if i in seen_frames or wall.wall_index in seen_walls:
                continue
            seen_frames.add(i)
            seen_walls.add(wall.wall_index)
            chosen.append((i, wall))
            if len(chosen) >= FRAMES_PER_BUILDING:
                break
        jobs.append((key, chosen, key not in colours))
        if args.limit and len(jobs) >= args.limit:
            break
    progress(f"{len(jobs)} buildings to read")

    counters: Counter[str] = Counter()

    def read(job) -> tuple[str, dict]:
        key, chosen, need_colour = job
        views, samples, frames = [], [], []
        rejected_views = [0]
        for i, wall in chosen:
            image = facades.fetch_image(rows["provider"][i], rows["provider_sequence_id"][i],
                                        rows["provider_image_id"][i])
            if image is None:
                continue
            camera = cameras[i]
            actual_h, actual_w = image.shape[:2]
            if (actual_w, actual_h) != (camera.width, camera.height):
                camera = Camera(camera.x, camera.y, camera.z, camera.yaw_rad,
                                actual_w, actual_h, camera.spherical, camera.hfov_rad)
            view = rectify_wall(image, camera, wall, pixels_per_m=PIXELS_PER_M)
            if view is None:
                continue
            quality = view_quality(view.image, view.mask)
            rejected_views[0] += not quality["usable"]
            if not quality["usable"]:
                continue
            fp = fingerprint_patch(view.image, view.mask, PIXELS_PER_M)
            if fp is not None:
                views.append(fp)
                frames.append({"p": rows["provider"][i], "i": str(rows["provider_image_id"][i]),
                               "w": wall.wall_index, "wall_share": quality["wall_share"],
                               "sky_share": quality["sky_share"]})
            if need_colour:
                colour = dominant_colour(view.image, view.mask)
                if colour is not None:
                    samples.append(colour)
        out: dict = {"views_rejected": rejected_views[0]}
        combined = combine(views)
        if combined is not None:
            out["fp"] = {**combined.to_json(), "frames": frames,
                         "wall_share": round(min(f["wall_share"] for f in frames), 3)}
        if need_colour and samples:
            stack = np.array(samples)
            median = np.median(stack, axis=0)
            spread = float(np.abs(stack - median).mean()) if len(samples) > 1 else None
            if spread is None or spread <= MAX_SAMPLE_SPREAD:
                out["colour"] = {
                    "c": "#{:02x}{:02x}{:02x}".format(*tuple(int(max(0, min(255, v))) for v in median[::-1])),
                    "n": len(samples), "spread": round(spread, 1) if spread is not None else None}
        return key, out

    part_number = len(list(PARTS.glob("*.json")))
    pending: dict[str, dict] = {}
    with futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        for n, (key, found) in enumerate(pool.map(read, jobs), start=1):
            counters["views rejected: too little wall or sky in it"] += found.get("views_rejected", 0)
            if found.get("fp"):
                fingerprints[key] = found["fp"]
                counters["fingerprinted"] += 1
            else:
                counters["no usable view"] += 1
            if found.get("colour"):
                colours[key] = found["colour"]
                counters["colour sampled"] += 1
            if found.get("fp") or found.get("colour"):
                pending[key] = found
            if len(pending) >= args.checkpoint:
                (PARTS / f"part-{part_number:05d}.json").write_text(json.dumps(pending))
                part_number += 1
                pending.clear()
                write_keyed(FINGERPRINTS, fingerprints, FINGERPRINT_NOTE)
                write_keyed(COLOURS, colours, COLOUR_NOTE)
            if n % 200 == 0:
                progress(f"  {n}/{len(jobs)} buildings, {dict(counters)}")
    if pending:
        (PARTS / f"part-{part_number:05d}.json").write_text(json.dumps(pending))
    write_keyed(FINGERPRINTS, fingerprints, FINGERPRINT_NOTE)
    write_keyed(COLOURS, colours, COLOUR_NOTE)
    progress(f"wrote {FINGERPRINTS.name}: {len(fingerprints)} fingerprints; "
             f"{COLOURS.name}: {len(colours)} colours; {dict(counters)}")
    return 0


FINGERPRINT_NOTE = ("Facade fingerprints read off photographs of each building "
                    "(scripts/build_facade_fingerprints.py, smc.facades.fingerprint): l/s/h the "
                    "wall's median colour as lightness, saturation, hue; g the glazing share; t the "
                    "texture; sd the lightness spread; rows/cols the storey and bay rhythm per "
                    "metre; n views; frames the photographs used. Matched to the page's renders by "
                    "smc.facades.match at build time.")
COLOUR_NOTE = ("Colour sampled off photographs of each building: c = median wall colour, n = "
               "views, spread = disagreement between views. Keyed by osm_id; nothing sampled is "
               "ever discarded, only buildings with no colour are sampled again.")


if __name__ == "__main__":
    raise SystemExit(main())
