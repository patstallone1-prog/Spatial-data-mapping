#!/usr/bin/env python3
"""Per-cell point stores and the street objects in them, for one region.

Two of the inputs the geometry compiler needs (``docs/25-geometry-compiler.md``, "what the
photogrammetry pipeline has to provide next"):

1. **Points per cell**, so an object can pull its own (``smc.reconstruction.object_cloud``).
   Every 120 m cell of the region's box is read from the USGS 3DEP lidar once and kept:
   the street-furniture zone (to 6 m above ground) at full density, facades and canopies to
   15 m thinned to 0.25 m, the ground and everything above thinned to 0.5 m. Stored as
   ``data/regions/<name>/points/<cell>.npz``: int16 centimetres about the cell's centre, the classification, and a source index so photogrammetric points can be fused into
   the same cells later (today every point is lidar, source 0).
2. **Street objects with positions** (``smc.lidar.objects``): poles, trees, short posts,
   bench-shaped clusters -- shapes, not names -- in ``points/objects.jsonl``.

Journal: ``points/cells.jsonl``, one line per cell; a network failure is marked to be retried,
never counted as an empty cell. ``SMC_POINTS_ROOT`` moves the stores (the external drive).

    nohup .venv/bin/python scripts/build_point_cells.py oakland-downtown > build/points-oakland.log &
"""

from __future__ import annotations

import argparse
import concurrent.futures as futures
import json
import math
import os
import shutil
import sys
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "scripts"))

import numpy as np  # noqa: E402
from measure_region_lidar import CELL_BACKOFF_S, CELL_TRIES, transient  # noqa: E402

from smc.imagery.region import get_region  # noqa: E402
from smc.lidar.ept import SF_DATASET, EptReader  # noqa: E402
from smc.lidar.objects import (  # noqa: E402
    CLASS_GROUND,
    detect,
    ground_heights,
    height_above_ground,
    points_in_polygons,
)
from smc.net import use_certifi  # noqa: E402
from smc.regions.paths import region_paths  # noqa: E402

use_certifi()

CELL_M = 120.0
OVERLAP_M = 3.0
RESOLUTION_M = 0.15
#: Street furniture lives in the first six metres above the ground: kept at full density.
#: Facades and canopies to fifteen metres are thinned to a quarter-metre voxel; the ground and
#: everything higher (roofs, towers -- heights are not capped) to half a metre.
KEEP_FULL_BELOW_M = 6.0
KEEP_THINNED_BELOW_M = 15.0
MID_THIN_M = 0.25
THIN_M = 0.5
SOURCES = ["usgs_3dep_lidar"]


def dataset_for(region: str) -> str | None:
    caps = ROOT / "data" / "regions" / region / "capabilities.json"
    collections = []
    if caps.exists():
        collections = [c["dataset"] for c in json.loads(caps.read_text()).get("lidar", {})
                       .get("collections", []) if c.get("coverage", 0) >= 0.5]
    if not collections and region.startswith("sf-"):
        # The corridor's lidar was read by its own pipeline (smc.lidar.curb) from the city's
        # collection, and its capability record never listed it.
        collections = [SF_DATASET]
    return collections[0] if collections else None


#: Stop -- cleanly, journaled, resumable -- before the disk is full.
MIN_FREE_GB = 10.0


def disk_ok(path: Path) -> bool:
    return shutil.disk_usage(path).free / 1024 ** 3 >= MIN_FREE_GB


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
    root = Path(os.environ.get("SMC_POINTS_ROOT", ROOT / "data" / "regions")) / region.name / "points"
    root.mkdir(parents=True, exist_ok=True)
    journal = root / "cells.jsonl"
    objects_path = root / "objects.jsonl"
    done = set()
    if journal.exists():
        for line in journal.read_text().splitlines():
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not row.get("retry") and not row.get("error"):
                done.add(row["cell"])
    lat0, lon0 = region.bbox.centre
    kx = 111_320.0 * math.cos(math.radians(lat0))
    ky = 111_320.0
    b = region.bbox
    cx0, cx1 = math.floor((b.west - lon0) * kx / CELL_M), math.floor((b.east - lon0) * kx / CELL_M)
    cy0, cy1 = math.floor((b.south - lat0) * ky / CELL_M), math.floor((b.north - lat0) * ky / CELL_M)
    cells = [(cx, cy) for cx in range(cx0, cx1 + 1) for cy in range(cy0, cy1 + 1)
             if f"{cx}:{cy}" not in done]
    if args.limit_cells:
        cells = cells[:args.limit_cells]
    paths = region_paths(region.name)
    buildings = []
    ways_file = paths.page if paths.page.exists() else \
        ROOT / "data" / "regions" / region.name / "osm_ways.json"
    if ways_file.exists():
        data = json.loads(ways_file.read_text())
        for way in (data.get("ways", []) if isinstance(data, dict) else data):
            if way.get("kind") == "building" and way.get("points"):
                buildings.append(np.asarray(way["points"], dtype=np.float64))
    if not buildings:
        # Without footprints every wall is an "object": refuse rather than fill the list.
        print(f"{region.name}: no building footprints (no page and no osm_ways.json)",
              file=sys.stderr)
        return 1
    print(f"{region.name}: lidar {dataset}; {len(cells)} cells to read, {len(done)} done; "
          f"{len(buildings)} footprints to keep out of the objects", flush=True)
    lock = threading.Lock()
    cache_root = ROOT / "build" / "regions" / region.name / "points-cache"

    def run(cell: tuple[int, int]) -> dict:
        cx, cy = cell
        key = f"{cx}:{cy}"
        if not disk_ok(root):
            return {"cell": key, "error": f"less than {MIN_FREE_GB} GB free", "retry": True}
        centre_lon = lon0 + (cx + 0.5) * CELL_M / kx
        centre_lat = lat0 + (cy + 0.5) * CELL_M / ky
        cloud, failure = None, ""
        for attempt in range(CELL_TRIES):
            try:
                reader = EptReader(dataset, cache_dir=cache_root / key)
                cloud = reader.around(centre_lat, centre_lon, CELL_M / 2 + OVERLAP_M,
                                      resolution_m=RESOLUTION_M)
                failure = ""
                break
            except Exception as exc:  # a cell the service will not serve is a gap, not a halt
                failure = str(exc)
                if not transient(failure) or attempt == CELL_TRIES - 1:
                    break
                time.sleep(CELL_BACKOFF_S[min(attempt, len(CELL_BACKOFF_S) - 1)])
            finally:
                shutil.rmtree(cache_root / key, ignore_errors=True)
        if failure:
            return {"cell": key, "error": failure, **({"retry": True} if transient(failure) else {})}
        xyz = cloud.xyz
        classes = cloud.classification.astype(np.uint8)
        # Footprints into the cell's metres.
        local_rings = []
        for ring in buildings:
            e = (ring[:, 0] - centre_lon) * kx
            n = (ring[:, 1] - centre_lat) * ky
            if e.max() < -CELL_M or e.min() > CELL_M or n.max() < -CELL_M or n.min() > CELL_M:
                continue
            local_rings.append(np.column_stack([e, n]))
        standing = classes != CLASS_GROUND
        inside = np.zeros(len(xyz), dtype=bool)
        if local_rings and standing.any():
            inside[standing] = points_in_polygons(xyz[standing, :2], local_rings)
        objects = detect(xyz, classes, inside) if len(xyz) else []
        # Store: full density up to 15 m above ground, the rest thinned.
        stored = 0
        if len(xyz):
            grid, origin, gcell = ground_heights(xyz, classes)
            hag = height_above_ground(xyz, grid, origin, gcell)
            standing_up = classes != CLASS_GROUND
            full = standing_up & (hag < KEEP_FULL_BELOW_M)
            keep = np.zeros(len(xyz), dtype=bool)
            keep[full] = True
            for band, size in (((standing_up & (hag >= KEEP_FULL_BELOW_M)
                                 & (hag < KEEP_THINNED_BELOW_M)), MID_THIN_M),
                               (~standing_up | (hag >= KEEP_THINNED_BELOW_M), THIN_M)):
                rows = np.flatnonzero(band)
                if not rows.size:
                    continue
                keys = np.floor(xyz[rows] / size).astype(np.int64)
                _, first = np.unique(np.column_stack([keys, classes[rows]]), axis=0,
                                     return_index=True)
                keep[rows[first]] = True
            half = CELL_M / 2 + OVERLAP_M
            keep &= (np.abs(xyz[:, 0]) <= half) & (np.abs(xyz[:, 1]) <= half)
            stored = int(keep.sum())
            kept = xyz[keep]
            base_z = float(kept[:, 2].min()) if stored else 0.0
            cm = np.round((kept - [0.0, 0.0, base_z]) * 100).astype(np.int16)
            # Sorted along a coarse grid, neighbours sit together and compress far better.
            order = np.lexsort((cm[:, 2], cm[:, 0] // 200, cm[:, 1] // 200))
            np.savez_compressed(
                root / f"{key}.npz",
                xyz_cm=cm[order], classification=classes[keep][order],
                source=np.zeros(stored, dtype=np.uint8),
                meta=np.frombuffer(json.dumps({
                    "cell": key, "origin_lon": centre_lon, "origin_lat": centre_lat,
                    "frame": "local east/north/up centimetres about origin; up above base_z_m "
                             "(lidar datum)", "base_z_m": base_z,
                    "dataset": dataset, "sources": SOURCES, "license": "public-domain (USGS 3DEP)",
                    "kept": f"full density to {KEEP_FULL_BELOW_M} m above ground; to "
                            f"{KEEP_THINNED_BELOW_M} m one per {MID_THIN_M} m voxel; ground and "
                            f"everything higher one per {THIN_M} m voxel, per class"}
                                         ).encode(), dtype=np.uint8))
        lines = []
        for obj in objects:
            if abs(obj.east) > CELL_M / 2 or abs(obj.north) > CELL_M / 2:
                continue  # in the overlap: the neighbouring cell owns it
            row = obj.to_json()
            row.update({"cell": key, "lon": round(centre_lon + obj.east / kx, 8),
                        "lat": round(centre_lat + obj.north / ky, 8), "source": SOURCES[0]})
            lines.append(json.dumps(row, separators=(",", ":")))
        if lines:
            with lock, objects_path.open("a") as fh:
                fh.write("\n".join(lines) + "\n")
        return {"cell": key, "points_read": len(xyz), "points_stored": stored,
                "objects": len(lines), "dataset": dataset}

    started = time.time()
    counts: dict[str, int] = {}
    with journal.open("a") as out, futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        for n, row in enumerate(pool.map(run, cells), start=1):
            with lock:
                out.write(json.dumps(row) + "\n")
                out.flush()
            state = "retry" if row.get("retry") else "error" if row.get("error") else "done"
            counts[state] = counts.get(state, 0) + 1
            if n % 25 == 0 or n == len(cells):
                print(f"  {n}/{len(cells)} cells, {counts}, {time.time() - started:.0f} s",
                      flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
