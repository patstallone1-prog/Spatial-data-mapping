#!/usr/bin/env python3
"""A first photogrammetric reconstruction from the street frames already on this machine.

The facade survey keeps the frames it fetched in ``build/facade-cache/<provider>/<id>.jpg``.
This takes the corridor cells where those frames are densest -- houses, kerbs, a block of
frontage seen from several passes -- and runs COLMAP's structure from motion over each:
SIFT features, exhaustive matching, incremental mapping. What comes back is a sparse model: the
cameras posed against each other and the points they agree on, exported as PLY.

It is a pilot and is labelled one. COLMAP's dense stereo needs CUDA, which this Mac does not
have, so the dense mesh (docs/photogrammetry-audit-2026-09.md) is still to be run on a GPU
machine; the sparse models say which cells have the overlap a dense run needs. Nothing here
feeds the published map. Panoramas are left out: COLMAP's pinhole models do not fit them.

Journal: build/photo-mesh/journal.jsonl (one line per cell, appended as each finishes); a
restart skips cells already in it.

    nohup .venv/bin/python scripts/run_photo_mesh_pilot.py --cells 6 > build/photo-mesh.log 2>&1 &
"""

from __future__ import annotations

import argparse
import json
import math
import shutil
import subprocess
import sys
import time
from collections import defaultdict
from pathlib import Path

import pyarrow.parquet as pq

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "build" / "facade-cache"
sys.path.insert(0, str(ROOT / "src"))
from smc.regions.paths import region_paths  # noqa: E402

WORK = ROOT / "build" / "photo-mesh"
CELL_M = 60.0
MIN_FRAMES = 25
MAX_FRAMES = 120


def cached_frames(catalog: Path) -> list[dict]:
    rows = pq.read_table(catalog, columns=["provider", "provider_image_id", "latitude", "longitude",
                                           "projection_type", "license_id"]).to_pydict()
    have = {(p.name, f.stem) for p in CACHE.iterdir() if p.is_dir() for f in p.glob("*.jpg")}
    frames = []
    for i in range(len(rows["provider"])):
        key = (str(rows["provider"][i]), str(rows["provider_image_id"][i]))
        if key not in have or rows["projection_type"][i] == "spherical":
            continue
        frames.append({"provider": key[0], "id": key[1], "lat": rows["latitude"][i],
                       "lon": rows["longitude"][i], "license": rows["license_id"][i],
                       "path": CACHE / key[0] / f"{key[1]}.jpg"})
    return frames


def cells_by_density(frames: list[dict]) -> list[tuple[str, list[dict]]]:
    k = 111320.0 * math.cos(math.radians(37.79))
    cells: dict[str, list[dict]] = defaultdict(list)
    for f in frames:
        cells[f"{int(f['lon'] * k // CELL_M)}_{int(f['lat'] * 111320.0 // CELL_M)}"].append(f)
    ranked = sorted(cells.items(), key=lambda kv: -len(kv[1]))
    return [(key, rows[:MAX_FRAMES]) for key, rows in ranked if len(rows) >= MIN_FRAMES]


def colmap(*args: str, log) -> None:
    subprocess.run(["colmap", *args], check=True, stdout=log, stderr=subprocess.STDOUT)


def reconstruct(key: str, rows: list[dict]) -> dict:
    cell = WORK / key
    images = cell / "images"
    if cell.exists():
        shutil.rmtree(cell)
    images.mkdir(parents=True)
    for f in rows:
        (images / f"{f['provider']}-{f['id']}.jpg").symlink_to(f["path"])
    started = time.time()
    with (cell / "colmap.log").open("w") as log:
        colmap("feature_extractor", "--database_path", str(cell / "db.db"), "--image_path", str(images),
               "--ImageReader.camera_model", "SIMPLE_RADIAL", "--FeatureExtraction.use_gpu", "0", log=log)
        colmap("exhaustive_matcher", "--database_path", str(cell / "db.db"),
               "--FeatureMatching.use_gpu", "0", log=log)
        (cell / "sparse").mkdir()
        colmap("mapper", "--database_path", str(cell / "db.db"), "--image_path", str(images),
               "--output_path", str(cell / "sparse"), log=log)
    models = sorted((cell / "sparse").iterdir())
    best = None
    for model in models:
        with (cell / "colmap.log").open("a") as log:
            colmap("model_converter", "--input_path", str(model), "--output_path",
                   str(model / "points.ply"), "--output_type", "PLY", log=log)
            colmap("model_converter", "--input_path", str(model), "--output_path", str(model),
                   "--output_type", "TXT", log=log)
        registered = sum(1 for line in (model / "images.txt").read_text().splitlines()
                         if line and not line.startswith("#")) // 2
        points = sum(1 for line in (model / "points3D.txt").read_text().splitlines()
                     if line and not line.startswith("#"))
        if best is None or registered > best["registered"]:
            best = {"model": str(model.relative_to(ROOT)), "registered": registered, "points": points}
    return {"cell": key, "frames": len(rows), "models": len(models), "best": best,
            "licenses": sorted({str(f["license"]) for f in rows}),
            "seconds": round(time.time() - started, 1),
            "grade": "sparse_sfm_pilot_not_published"}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--cells", type=int, default=6)
    ap.add_argument("--region", default="sf-corridor",
                    help="whose catalogue the cached frames are looked up in (the cache holds "
                         "whichever region the facade survey fetched last)")
    args = ap.parse_args()
    if not shutil.which("colmap"):
        raise SystemExit("colmap is not installed (brew install colmap)")
    WORK.mkdir(parents=True, exist_ok=True)
    journal = WORK / "journal.jsonl"
    done = {json.loads(line)["cell"] for line in journal.read_text().splitlines()} if journal.exists() else set()
    catalog = region_paths(args.region).observations
    cells = cells_by_density(cached_frames(catalog))
    print(f"{len(cells)} cells with at least {MIN_FRAMES} cached pinhole frames", flush=True)
    for key, rows in cells[: args.cells]:
        key = f"{args.region}-{key}"
        if key in done:
            continue
        print(f"{key}: {len(rows)} frames", flush=True)
        try:
            result = reconstruct(key, rows)
        except subprocess.CalledProcessError as error:
            result = {"cell": key, "frames": len(rows), "failed": str(error)}
        with journal.open("a") as handle:
            handle.write(json.dumps(result) + "\n")
        print(json.dumps(result), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
