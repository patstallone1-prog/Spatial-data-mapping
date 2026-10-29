#!/usr/bin/env python3
"""A region's lidar trees straight from the USGS tiles, without storing its point cells.

The trees stage only wants ``points/trees.jsonl``. It used to get it by building the full
street-object store (``build_point_cells.py``: every cell's points compressed to disk, and its
poles, posts and benches found) and reading that store back (``detect_lidar_trees.py``), then
deleting it. This reads each cell, keeps exactly the points the store would have kept
(``build_point_cells.stored_points``, centimetres and all) and finds the crowns in them there and
then (``detect_lidar_trees.trees_in``): the same trees, in the same order, without the store,
the objects or the second read. Cells run in processes, so the crown search is not queued
behind one interpreter lock.

    .venv/bin/python scripts/find_lidar_trees.py berkeley-downtown

Exit 3: no cell had a lidar point (nothing to find trees in), as ``detect_lidar_trees.py``'s
"no stored lidar cells".
"""

from __future__ import annotations

import argparse
import concurrent.futures as futures
import json
import multiprocessing
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "scripts"))

import numpy as np  # noqa: E402
from build_point_cells import (  # noqa: E402
    CELL_M,
    OVERLAP_M,
    RESOLUTION_M,
    dataset_for,
    region_cells,
    stored_points,
)
from detect_lidar_trees import footprints, trees_in  # noqa: E402
from measure_region_lidar import CELL_BACKOFF_S, CELL_TRIES, transient  # noqa: E402

from smc.imagery.region import get_region  # noqa: E402
from smc.lidar.ept import EptReader  # noqa: E402
from smc.net import use_certifi  # noqa: E402

use_certifi()

NO_POINTS = 3

_job: dict = {}


def _init(job: dict) -> None:
    _job.update(job)


def cell(key_xy: tuple[int, int]) -> dict:
    """One cell's trees, or why it has none: {"cell", "trees" | "error", "points"}."""
    cx, cy = key_xy
    key = f"{cx}:{cy}"
    j = _job
    centre_lon = j["lon0"] + (cx + 0.5) * CELL_M / j["kx"]
    centre_lat = j["lat0"] + (cy + 0.5) * CELL_M / j["ky"]
    cloud, failure = None, ""
    for attempt in range(CELL_TRIES):
        try:
            # Not cached on disk: a cell's tiles are its own (neighbours share under 5% of them).
            reader = EptReader(j["dataset"], cache=False)
            cloud = reader.around(centre_lat, centre_lon, CELL_M / 2 + OVERLAP_M,
                                  resolution_m=RESOLUTION_M)
            failure = ""
            break
        except Exception as exc:  # a cell the service will not serve is a gap, not a halt
            failure = str(exc)
            if not transient(failure) or attempt == CELL_TRIES - 1:
                break
            time.sleep(CELL_BACKOFF_S[min(attempt, len(CELL_BACKOFF_S) - 1)])
    if failure:
        return {"cell": key, "error": failure}
    xyz, classes = cloud.xyz, cloud.classification.astype(np.uint8)
    if not len(xyz):
        return {"cell": key, "points": 0, "trees": []}
    cm, kept_classes, base_z = stored_points(xyz, classes)
    # As the store is read back: centimetres to metres, then the base height.
    kept = cm.astype(np.float64) / 100.0
    kept[:, 2] += base_z
    meta = {"cell": key, "origin_lon": centre_lon, "origin_lat": centre_lat,
            "dataset": j["dataset"]}
    return {"cell": key, "points": len(xyz),
            "trees": trees_in(kept, kept_classes, meta, j["rings"], j["boxes"])}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("region")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--limit-cells", type=int, default=0)
    args = ap.parse_args()
    region = get_region(args.region)
    dataset = dataset_for(region.name)
    if dataset is None:
        print(f"{region.name}: no lidar collection covers it", file=sys.stderr)
        return 1
    try:
        rings = footprints(region.name)
    except FileNotFoundError:
        rings = []
    if not rings:
        # Without footprints every wall is a crown's neighbour: refuse rather than guess.
        print(f"{region.name}: no building footprints (no page and no osm_ways.json)", file=sys.stderr)
        return 1
    boxes = np.array([[r[:, 0].min(), r[:, 1].min(), r[:, 0].max(), r[:, 1].max()] for r in rings])
    lat0, lon0, kx, ky, cells = region_cells(region)
    if args.limit_cells:
        cells = cells[:args.limit_cells]
    root = Path(os.environ.get("SMC_POINTS_ROOT", ROOT / "data" / "regions")) / region.name / "points"
    root.mkdir(parents=True, exist_ok=True)
    job = {"dataset": dataset, "rings": rings, "boxes": boxes, "lat0": lat0, "lon0": lon0,
           "kx": kx, "ky": ky}
    print(f"{region.name}: lidar {dataset}; {len(cells)} cells, {len(rings)} footprints kept out",
          flush=True)
    started = time.time()
    found: dict[str, list[dict]] = {}
    errors = with_points = 0
    context = multiprocessing.get_context("fork" if sys.platform.startswith("linux") else "spawn")
    with futures.ProcessPoolExecutor(args.workers, mp_context=context, initializer=_init,
                                     initargs=(job,)) as pool:
        for n, row in enumerate(pool.map(cell, cells, chunksize=2), start=1):
            if "error" in row:
                errors += 1
            else:
                with_points += row["points"] > 0
                found[row["cell"]] = row["trees"]
            if n % 50 == 0 or n == len(cells):
                print(f"  {n}/{len(cells)} cells, {sum(map(len, found.values()))} trees, {errors} "
                      f"unread, {time.time() - started:.0f} s", flush=True)
    if not with_points:
        print(f"{region.name}: no lidar points in any cell", file=sys.stderr)
        return NO_POINTS
    # In the order detect_lidar_trees.py read the stored cells: by file name.
    trees = [t for key in sorted(found, key=lambda k: f"{k}.npz") for t in found[key]]
    out = root / "trees.jsonl"
    out.write_text("".join(json.dumps(t, separators=(",", ":")) + "\n" for t in trees))
    print(f"{region.name}: {len(trees)} trees in {with_points} cells ({errors} unread) -> {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
