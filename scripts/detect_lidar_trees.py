#!/usr/bin/env python3
"""The trees in a region's stored lidar cells (``smc.lidar.canopy``), as positions.

Reads ``data/regions/<name>/points/<cell>.npz`` -- written by ``build_point_cells.py``, so
nothing is fetched -- keeps the region's footprints out, and writes
``data/regions/<name>/points/trees.jsonl``: one tree a line, with its position, height and
crown spread. The ground cover plants them where the city publishes no tree positions, and
beside the city's own where it does (``build_ground_cover.py``).

    .venv/bin/python scripts/detect_lidar_trees.py berkeley-downtown
"""

from __future__ import annotations

import argparse
import concurrent.futures as futures
import json
import math
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

import numpy as np  # noqa: E402

from smc.lidar.canopy import detect_trees  # noqa: E402
from smc.regions.paths import region_paths  # noqa: E402

CELL_M = 120.0
OVERLAP_M = 3.0


def footprints(region: str) -> list[np.ndarray]:
    paths = region_paths(region)
    ways_file = paths.page if paths.page.exists() else \
        ROOT / "data" / "regions" / region / "osm_ways.json"
    data = json.loads(ways_file.read_text())
    return [np.asarray(w["points"], dtype=np.float64)
            for w in (data.get("ways", []) if isinstance(data, dict) else data)
            if w.get("kind") == "building" and w.get("points")]


def read_cell(path: Path) -> tuple[np.ndarray, np.ndarray, dict]:
    with np.load(path) as d:
        meta = json.loads(bytes(d["meta"]).decode())
        xyz = d["xyz_cm"].astype(np.float64) / 100.0
        xyz[:, 2] += meta["base_z_m"]
        return xyz, d["classification"].astype(np.uint8), meta


def cell_trees(path: Path, rings: list[np.ndarray], boxes: np.ndarray) -> list[dict]:
    return trees_in(*read_cell(path), rings, boxes)


def trees_in(xyz: np.ndarray, classes: np.ndarray, meta: dict, rings: list[np.ndarray],
             boxes: np.ndarray) -> list[dict]:
    """One cell's trees, as rows: its points in the cell's local metres, ``meta`` its store's."""
    lon0, lat0 = meta["origin_lon"], meta["origin_lat"]
    kx = 111_320.0 * math.cos(math.radians(lat0))
    ky = 111_320.0
    reach = CELL_M / 2 + OVERLAP_M + 5
    lo = np.array([lon0 - reach / kx, lat0 - reach / ky])
    hi = np.array([lon0 + reach / kx, lat0 + reach / ky])
    near = np.flatnonzero((boxes[:, 2] >= lo[0]) & (boxes[:, 0] <= hi[0]) &
                          (boxes[:, 3] >= lo[1]) & (boxes[:, 1] <= hi[1]))
    local = [np.column_stack([(rings[i][:, 0] - lon0) * kx, (rings[i][:, 1] - lat0) * ky])
             for i in near]
    out = []
    for tree in detect_trees(xyz, classes, local, half_extent_m=CELL_M / 2):
        row = tree.to_json()
        row.update({"cell": meta["cell"], "lon": round(lon0 + tree.east / kx, 8),
                    "lat": round(lat0 + tree.north / ky, 8), "source": "usgs_3dep_lidar",
                    "dataset": meta.get("dataset")})
        out.append(row)
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("region")
    ap.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 4) - 2))
    ap.add_argument("--limit-cells", type=int, default=0)
    args = ap.parse_args()
    root = Path(os.environ.get("SMC_POINTS_ROOT", ROOT / "data" / "regions")) / args.region / "points"
    cells = sorted(root.glob("*.npz"))
    if args.limit_cells:
        cells = cells[:args.limit_cells]
    if not cells:
        print(f"{args.region}: no stored lidar cells; run build_point_cells.py first", file=sys.stderr)
        return 1
    rings = footprints(args.region)
    boxes = np.array([[r[:, 0].min(), r[:, 1].min(), r[:, 0].max(), r[:, 1].max()] for r in rings])
    trees: list[dict] = []
    with futures.ProcessPoolExecutor(max_workers=args.workers) as pool:
        for found in pool.map(cell_trees, cells, [rings] * len(cells), [boxes] * len(cells),
                              chunksize=4):
            trees.extend(found)
    out = root / "trees.jsonl"
    out.write_text("".join(json.dumps(t, separators=(",", ":")) + "\n" for t in trees))
    print(f"{args.region}: {len(trees)} trees in {len(cells)} cells -> {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
