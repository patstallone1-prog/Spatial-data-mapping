#!/usr/bin/env python3
"""Take each building's colour from photographs of it rather than from a distribution.

Every building in this model that is not one of the 220 photographed walls is painted from a
table of San Francisco's building stock: stucco forty per cent, concrete eighteen, brick
fourteen, with a palette drawn at random from a seed. That makes a street look inhabited and it
describes no particular building. The house on the corner is whatever colour the dice said.

Rectifying a whole facade needs several views that agree closely, and only a third of walls
have them. Sampling a colour needs far less: one frame that sees the wall at all, and a median
over its pixels. So the colour can be recovered for most of the corridor even where the texture
cannot, and a street of real colours with procedural detail is much closer to the place than a
street of invented ones.

The sky, the road and anything that is not the wall are excluded by rectifying the wall itself
-- the same projection the facade extractor uses, at sixty-four pixels instead of six hundred.
"""

from __future__ import annotations

import argparse
import concurrent.futures as futures
import json
import math
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "scripts"))

import numpy as np  # noqa: E402
import pyarrow.parquet as pq  # noqa: E402

import build_facades as facades  # noqa: E402
from smc.facades.geometry import DEFAULT_CAMERA_HEIGHT_M, Camera, score_view, walls_of  # noqa: E402
from smc.facades.geometry import LocalFrame  # noqa: E402
from smc.facades.rectify import rectify_wall  # noqa: E402

MAP_JSON = ROOT / "docs" / "sf-corridor-3d.json"
CATALOG = ROOT / "data" / "sf_corridor" / "observations" / "external-000.parquet"
OUT = ROOT / "data" / "sf_public_works" / "building_colours.json"
PARTS = ROOT / "build" / "building-colours"

#: Frames fetched per building. Two is enough for a median colour and a disagreement between
#: them; a third buys very little and costs a third more of the only expensive step.
FRAMES_PER_BUILDING = 3
#: A wall sampled from fewer pixels than this is a smear of whatever is beside it.
MIN_WALL_PIXELS = 400
#: How far apart samples of one building may be before they are not describing one building at
#: all. This used to be 46, which threw away two thirds of them -- because the two best views
#: of a building are often of *different walls*, and a painted shopfront beside a plain flank
#: differs by far more than that while both are perfectly correct. The spread is kept as a
#: confidence now and only a genuinely wild disagreement is refused.
MAX_SAMPLE_SPREAD = 96.0


def dominant_colour(patch: np.ndarray, mask: np.ndarray) -> tuple[float, float, float] | None:
    """The wall's colour: a median over the pixels that are the wall.

    Median, not mean. A facade with two dark windows and a bright sign averages to a colour
    that is on none of it, while the median lands on the render -- which is what the wall
    between the windows is made of and what the building reads as from across the street.
    """
    if mask.sum() < MIN_WALL_PIXELS:
        return None
    pixels = patch[mask]
    if not pixels.size:
        return None
    return tuple(float(v) for v in np.median(pixels.reshape(-1, 3), axis=0))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--limit", type=int, default=None, help="cap the buildings attempted")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--checkpoint", type=int, default=250)
    args = ap.parse_args()

    def progress(message: str) -> None:
        print(message, flush=True)

    payload = json.loads(MAP_JSON.read_text())
    bbox = payload["bbox"]
    frame = LocalFrame((bbox["south"] + bbox["north"]) / 2.0,
                       (bbox["west"] + bbox["east"]) / 2.0)
    buildings = [w for w in payload["ways"] if w.get("kind") == "building" and w.get("covered")]
    progress(f"{len(buildings)} covered buildings")

    rows = pq.read_table(CATALOG, columns=[
        "observation_uid", "provider", "provider_sequence_id", "provider_image_id",
        "latitude", "longitude", "heading_deg", "horizontal_fov", "projection_type",
        "original_width", "original_height", "eligible",
        "estimated_camera_height"]).to_pydict()

    # Cameras go into a coarse grid so each building looks at the handful that could see it
    # rather than at all 386,624.
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

    PARTS.mkdir(parents=True, exist_ok=True)
    done: dict[str, dict] = {}
    for part in sorted(PARTS.glob("*.json")):
        try:
            done.update(json.loads(part.read_text()))
        except json.JSONDecodeError:
            part.unlink()
    if done:
        progress(f"resuming: {len(done)} buildings already sampled")

    jobs = []
    for index, building in enumerate(buildings):
        key = str(index)
        if key in done:
            continue
        ring = [frame.to_xy(lon, lat) for lon, lat in building["points"]]
        height = float(building.get("height_m") or 10.5)
        walls = walls_of(ring, height, index)
        if not walls:
            continue
        best: list[tuple[float, int, object]] = []
        centre = walls[0].midpoint
        cell = (int(centre[0] // 40), int(centre[1] // 40))
        nearby: set[int] = set()
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                nearby.update(grid.get((cell[0] + dx, cell[1] + dy), ()))
        for wall in walls:
            for i in nearby:
                score = score_view(wall, cameras[i])
                if score is not None:
                    best.append((score, i, wall))
        if not best:
            continue
        best.sort(key=lambda item: -item[0])
        # The best view of each of a few different walls, rather than the two best views
        # overall. Taking the two best overall usually took two looks at the same prominent
        # frontage, and where it did not it took one of the front and one of the side and then
        # called the building inconsistent.
        chosen: list[tuple[int, object]] = []
        seen_frames: set[int] = set()
        seen_walls: set[int] = set()
        for _score, i, wall in best:
            if i in seen_frames or wall.wall_index in seen_walls:
                continue
            seen_frames.add(i)
            seen_walls.add(wall.wall_index)
            chosen.append((i, wall))
            if len(chosen) >= FRAMES_PER_BUILDING:
                break
        jobs.append((index, chosen))
        if args.limit and len(jobs) >= args.limit:
            break
    progress(f"{len(jobs)} buildings have a view")

    results: dict[str, dict] = {}
    part_number = len(list(PARTS.glob("*.json")))
    counters = Counter()

    def sample(job) -> tuple[str, dict | None]:
        index, chosen = job
        samples = []
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
            view = rectify_wall(image, camera, wall, pixels_per_m=6.0)
            if view is None:
                continue
            colour = dominant_colour(view.image, view.mask)
            if colour is not None:
                samples.append(colour)
        if not samples:
            return str(index), None
        stack = np.array(samples)
        median = np.median(stack, axis=0)
        spread = float(np.abs(stack - median).mean()) if len(samples) > 1 else None
        return str(index), {
            # Stored as the hex the renderer wants, from BGR as OpenCV reads it.
            "c": "#%02x%02x%02x" % tuple(int(max(0, min(255, v))) for v in median[::-1]),
            "n": len(samples),
            "spread": round(spread, 1) if spread is not None else None,
        }

    with futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        for n, (key, found) in enumerate(pool.map(sample, jobs), start=1):
            if found is None:
                counters["no colour"] += 1
            elif found["spread"] is not None and found["spread"] > MAX_SAMPLE_SPREAD:
                # Two views of one building that disagree this much are not both of the
                # building. Keeping neither is better than keeping whichever came first.
                counters["views disagreed"] += 1
            else:
                results[key] = found
                counters["sampled"] += 1
            if len(results) >= args.checkpoint:
                (PARTS / f"part-{part_number:05d}.json").write_text(json.dumps(results))
                part_number += 1
                done.update(results)
                results.clear()
            if n % 500 == 0:
                progress(f"  {n}/{len(jobs)} buildings, {dict(counters)}")

    if results:
        (PARTS / f"part-{part_number:05d}.json").write_text(json.dumps(results))
        done.update(results)

    OUT.write_text(json.dumps(done, separators=(",", ":")))
    progress(f"wrote {OUT.name}: {len(done)} buildings with a sampled colour, {dict(counters)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
