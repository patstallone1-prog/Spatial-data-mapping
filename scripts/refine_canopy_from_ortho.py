#!/usr/bin/env python3
"""The landscape's tree cover, measured where there are aerial photographs.

The nature atlas's canopy (``docs/nature/canopy-40m.bin``) is the USFS's modelled tree canopy
percentage, a 30 m satellite product: right across a forest, smeared across a street of
gardens. Where a region has aerial photographs (src/smc/imagery/ortho.py, 0.25-0.6 m), each 40 m
cell's cover is counted from them instead: leaves (near-infrared over red) that are trees and not
lawn -- a crown is rough and shaded, turf is smooth and bright.

Rewrites the canopy layer in place, notes the photographs among the atlas's sources, and leaves
every cell no photograph covers as it was.
"""

from __future__ import annotations

import gzip
import json
import math
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from smc.imagery import ortho
from smc.terrain.nature import write_array, write_manifest

ROOT = Path(__file__).resolve().parents[1]
NATURE = ROOT / "docs" / "nature"
LEAF_INDEX = 0.2
#: A crown's brightness varies this much across a metre and a quarter; a lawn's does not.
CROWN_TEXTURE = 10.0
CROWN_SHADE_LUM = 85
#: Leaves stay bright in near-infrared even in shade; below this the index is the noise of two
#: small numbers (a tower's shadow, dark water).
LEAF_MIN_NIR = 45


def tree_share(pix: dict) -> float:
    import cv2

    rgb = pix["rgb"].astype(np.float32)
    lum = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]
    leaves = ortho.vegetation_index(pix["rgb"], pix["nir"]) > LEAF_INDEX
    if pix["nir"] is not None:
        leaves &= pix["nir"] >= LEAF_MIN_NIR
    k = max(3, round(1.25 / pix["pixel_m"]) | 1)
    mean = cv2.blur(lum, (k, k))
    texture = np.sqrt(np.maximum(cv2.blur(lum * lum, (k, k)) - mean * mean, 0))
    trees = leaves & ((texture > CROWN_TEXTURE) | (lum < CROWN_SHADE_LUM))
    valid = pix["valid"]
    return float(trees[valid].mean()) if valid.any() else float("nan")


def main() -> int:
    manifest = json.loads((NATURE / "manifest.json").read_text())
    frame, entry = manifest["frame"], manifest["arrays"]["canopy"]
    # The manifest's frame counts nodes (the atlas exported one per perimeter vertex).
    cols, rows = frame["cols"], frame["rows"]
    canopy = np.frombuffer(gzip.decompress((NATURE / entry["file"]).read_bytes()), np.uint8).reshape(rows, cols).copy()
    step = frame["step_m"]
    lon0 = frame["mid_lon"] + frame["x0"] / frame["metres_per_lon"]
    lat0 = frame["mid_lat"] + frame["y0"] / frame["metres_per_lat"]
    dx, dy = step / frame["metres_per_lon"], step / frame["metres_per_lat"]
    refined, regions = 0, []
    for folder in sorted(p for p in ortho.OUT.iterdir() if (p / "manifest.json").exists()):
        cache = ortho.SquareCache(folder.name)
        rows_ok = cache.ortho.rows
        if not rows_ok:
            continue
        regions.append(folder.name)
        squares = np.array(list(rows_ok))
        west, south = squares.min(0) * ortho.GRID_M
        east, north = (squares.max(0) + 1) * ortho.GRID_M
        from rasterio.warp import transform_bounds

        w, s, e, n = transform_bounds(ortho.CRS, "EPSG:4326", west, south, east, north)
        c0, c1 = max(0, math.floor((w - lon0) / dx)), min(cols - 1, math.ceil((e - lon0) / dx))
        r_lat0, r_lat1 = math.floor((s - lat0) / dy), math.ceil((n - lat0) / dy)
        for j in range(max(0, r_lat0), min(rows - 1, r_lat1) + 1):
            lat = lat0 + j * dy
            r = j  # row 0 is the south edge
            lons = lon0 + np.arange(c0, c1 + 1) * dx
            xs, ys = ortho.to_utm(lons, np.full(lons.shape, lat))
            for c, x, y in zip(range(c0, c1 + 1), xs, ys, strict=True):
                box = (x - step / 2, y - step / 2, x + step / 2, y + step / 2)
                if not all(rows_ok.get((math.floor(px / ortho.GRID_M), math.floor(py / ortho.GRID_M)))
                           for px in (box[0], box[2] - 1e-6) for py in (box[1], box[3] - 1e-6)):
                    continue
                pix = cache.read(box)
                if pix is None or not pix["valid"].all():
                    continue
                share = tree_share(pix)
                if math.isfinite(share):
                    canopy[r, c] = round(100 * share)
                    refined += 1
    manifest["arrays"]["canopy"] = write_array(NATURE / entry["file"], canopy)
    note = {"id": "aerial-orthophotos", "role": "measured tree cover where photographed",
            "description": "Tree cover counted at 0.25-0.6 m from aerial photographs (NOAA NGS 2025, USDA NAIP 2022, "
                           "OpenAerialMap) in " + ", ".join(regions) + " (scripts/refine_canopy_from_ortho.py)",
            "cells": refined}
    manifest["sources"] = [s for s in manifest["sources"] if s.get("id") != note["id"]] + [note]
    write_manifest(NATURE / "manifest.json", manifest)
    print({"refined_cells": refined, "regions": regions})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
