"""Compile continuous visual floor colours and conservative distant-plant clearance.

NLCD is a classification, not a set of square material tiles. Gaussian mixtures
are appearance only; no source classification, DEM or city tree is changed.
The full-extent 8 m clearance mask keeps overview vegetation off mapped paths,
courts and buildings before the detailed path tiles have been requested.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import math
import re
from itertools import pairwise
from pathlib import Path

import numpy as np
from rasterio.features import rasterize
from rasterio.transform import Affine
from scipy.ndimage import gaussian_filter, maximum_filter

from smc.terrain.nature import write_array

ROOT = Path(__file__).resolve().parents[1]
PALETTE = {
    0: (0.53, 0.49, 0.42),
    11: (44 / 255, 97 / 255, 135 / 255),
    12: (0.83, 0.85, 0.84),
    21: (0.52, 0.51, 0.34),  # Developed OPEN space is mostly vegetation, not paving.
    22: (0.43, 0.43, 0.38),
    23: (0.43, 0.43, 0.38),
    24: (0.43, 0.43, 0.38),
    31: (0.53, 0.49, 0.42),
    41: (0.34, 0.28, 0.19),
    42: (0.30, 0.23, 0.17),
    43: (0.32, 0.25, 0.18),
    52: (0.48, 0.42, 0.29),
    71: (0.57, 0.52, 0.32),
    81: (0.55, 0.51, 0.31),
    82: (0.49, 0.43, 0.28),
    90: (0.35, 0.32, 0.22),
    95: (0.35, 0.37, 0.23),
}


NATURAL = (31, 41, 42, 43, 52, 71, 81, 82, 90, 95)


def vegetated_cover(cover: np.ndarray, canopy: np.ndarray) -> np.ndarray:
    """The classes plants grow on (docs/nature-ecology.mjs vegetatedCover, which this matches).

    A developed cell (21-23) whose neighbours are mostly natural is a trail or road strip through
    them and takes their commonest class (the lowest on a tie); a low- or medium-intensity one
    under 25% or more measured canopy beside open land is open space under trees, 21.
    """
    rows, cols = cover.shape
    padded = np.pad(cover, 1, constant_values=0)
    neighbours = [padded[1 + dr : 1 + dr + rows, 1 + dc : 1 + dc + cols]
                  for dr in (-1, 0, 1) for dc in (-1, 0, 1) if dr or dc]
    natural = sum(np.isin(n, NATURAL).astype(np.int32) for n in neighbours)
    open_ = np.zeros(cover.shape, dtype=bool)
    for n in neighbours:
        open_ |= np.isin(n, (21, *NATURAL))
    best = np.zeros(cover.shape, dtype=np.uint8)
    best_n = np.zeros(cover.shape, dtype=np.int32)
    for kind in sorted(NATURAL):
        count = sum((n == kind).astype(np.int32) for n in neighbours)
        better = count > best_n
        best[better], best_n[better] = kind, count[better]
    out = cover.copy()
    developed = (cover >= 21) & (cover <= 23)
    strip = developed & (natural >= np.where(cover == 23, 6, 5))
    out[strip] = best[strip]
    wooded = developed & ~strip & (cover != 21) & open_ & (canopy != 255) & (canopy >= 25)
    out[wooded] = 21
    return out


def floor_pixels(cover: np.ndarray, canopy: np.ndarray | None = None) -> np.ndarray:
    if canopy is not None:
        cover = vegetated_cover(cover, canopy)
    valid = (cover != 11).astype(np.float32)
    weight = gaussian_filter(valid, 0.8, mode="nearest")
    output = np.zeros((*cover.shape, 4), dtype=np.uint8)
    for channel in range(3):
        raw = np.full(cover.shape, PALETTE[0][channel], dtype=np.float32)
        for kind, rgb in PALETTE.items():
            raw[cover == kind] = rgb[channel]
        if canopy is not None:
            # NLCD 21 includes wooded parks. Canopy can support litter beneath
            # those trees without changing the source's land-use classification.
            wooded = np.clip((canopy.astype(np.float32) - 20) / 55, 0, 1)
            wooded[~np.isin(cover, [21, 52, 71, 81, 82]) | (canopy == 255)] = 0
            raw = raw * (1 - wooded) + PALETTE[41][channel] * wooded
        mixed = gaussian_filter(raw * valid, 0.8, mode="nearest") / np.maximum(weight, 1e-5)
        mixed[cover == 11] = PALETTE[11][channel]
        output[:, :, channel] = np.round(np.clip(mixed, 0, 1) * 255).astype(np.uint8)
    output[:, :, 3] = (cover == 11) * 255
    return output


def main() -> None:
    directory = ROOT / "docs/nature"
    manifest = json.loads((directory / "manifest.json").read_text())
    f = manifest["frame"]
    cover = np.frombuffer(
        gzip.decompress((directory / manifest["arrays"]["cover"]["file"]).read_bytes()), np.uint8
    ).reshape(f["rows"], f["cols"])
    record = json.loads((directory / "ecology.json").read_text())
    canopy = np.frombuffer(
        gzip.decompress((directory / manifest["arrays"]["canopy"]["file"]).read_bytes()), np.uint8
    ).reshape(cover.shape)
    record["floor"] = write_array(directory / "floor-colour-40m.bin", floor_pixels(cover, canopy))
    record["floor"].update(
        channels=4, colour_space="srgb", alpha="source water classification", smoothing_sigma_m=32
    )
    paths_bytes = (directory / "paths.json").read_bytes()
    paths = json.loads(paths_bytes)
    step = 8
    cols, rows = math.ceil((f["cols"] - 1) * 40 / step), math.ceil((f["rows"] - 1) * 40 / step)
    mask = np.zeros((rows, cols), np.uint8)
    natural_floor = np.zeros(cover.shape, np.uint8)
    for key, source in paths["tiles"].items():
        match = re.fullmatch(r"(-?\d+)-(-?\d+)", key)
        if not match:
            raise ValueError(f"Invalid path tile: {key}")
        tc, tr = map(int, match.groups())
        c0, r0 = max(0, tc * 500), max(0, tr * 500)
        c1, r1 = min(cols, (tc + 1) * 500), min(rows, (tr + 1) * 500)
        if c1 <= c0 or r1 <= r0:
            continue
        data = json.loads(gzip.decompress((directory / source["file"]).read_bytes()))
        shapes = []
        natural_shapes = []

        def local(p):
            return [
                (p[0] - f["mid_lon"]) * f["metres_per_lon"] - f["x0"],
                (p[1] - f["mid_lat"]) * f["metres_per_lat"] - f["y0"],
            ]

        for way in data["ways"]:
            points = [local(p) for p in way["points"]]
            if way.get("natural"):
                kind = way["natural"]
                if way.get("area") and kind in {"beach", "bare_rock", "scree", "shingle"}:
                    rings = [points, *[[local(p) for p in ring] for ring in way.get("holes", [])]]
                    natural_shapes.append(
                        ({"type": "Polygon", "coordinates": rings}, 1 if kind == "beach" else 2)
                    )
                continue
            if way.get("area"):
                shapes.append(({"type": "Polygon", "coordinates": [points]}, 1))
            else:
                half = way["width_m"] / 2
                for a, b in pairwise(points):
                    dx, dy = b[0] - a[0], b[1] - a[1]
                    length = math.hypot(dx, dy)
                    if length < 0.001:
                        continue
                    nx, ny = -dy / length * half, dx / length * half
                    ring = [
                        [a[0] - nx, a[1] - ny],
                        [b[0] - nx, b[1] - ny],
                        [b[0] + nx, b[1] + ny],
                        [a[0] + nx, a[1] + ny],
                        [a[0] - nx, a[1] - ny],
                    ]
                    shapes.append(({"type": "Polygon", "coordinates": [ring]}, 1))
        if shapes:
            mask[r0:r1, c0:c1] = rasterize(
                shapes,
                out_shape=(r1 - r0, c1 - c0),
                transform=Affine(step, 0, c0 * step, 0, step, r0 * step),
                all_touched=True,
                dtype="uint8",
            )
        if natural_shapes:
            cc, rr = c0 // 5, r0 // 5
            cc1, rr1 = min(f["cols"], c1 // 5 + 1), min(f["rows"], r1 // 5 + 1)
            mapped = rasterize(
                natural_shapes,
                out_shape=(rr1 - rr, cc1 - cc),
                transform=Affine(40, 0, cc * 40 - 20, 0, 40, rr * 40 - 20),
                dtype="uint8",
            )
            natural_floor[rr:rr1, cc:cc1] = np.maximum(natural_floor[rr:rr1, cc:cc1], mapped)
    floor = floor_pixels(cover, canopy)
    for kind, rgb in [(1, (0.72, 0.65, 0.50)), (2, (0.48, 0.47, 0.43))]:
        selected = (natural_floor == kind) & (cover != 11)
        floor[selected, :3] = np.round(np.array(rgb) * 255).astype(np.uint8)
    record["floor"].update(write_array(directory / "floor-colour-40m.bin", floor))
    record["floor"].update(
        paths_manifest_sha256=hashlib.sha256(paths_bytes).hexdigest(),
        attribution="NLCD / USFS plus OpenStreetMap natural surface polygons, ODbL",
    )
    # A 16 m buffer plus touched raster cells exceeds the 12 m overview crown.
    mask = maximum_filter(mask, size=5, mode="constant")
    record["clearance"] = write_array(
        directory / "vegetation-clearance-8m.bin", np.packbits(mask, bitorder="little")
    )
    record["clearance"].update(
        cols=cols,
        rows=rows,
        step_m=step,
        buffer_m=16,
        packing="one bit per cell; little bit order",
        paths_manifest_sha256=hashlib.sha256(paths_bytes).hexdigest(),
        attribution="OpenStreetMap contributors, ODbL; conservative visual exclusion only",
    )
    record["source_cover_sha256"] = manifest["arrays"]["cover"]["sha256"]
    record["source_canopy_sha256"] = manifest["arrays"]["canopy"]["sha256"]
    (directory / "ecology.json").write_text(json.dumps(record, indent=2) + "\n")
    print(
        json.dumps(
            {
                "floor_bytes": record["floor"]["bytes"],
                "clearance_bytes": record["clearance"]["bytes"],
                "blocked_cells": int(mask.sum()),
            }
        )
    )


if __name__ == "__main__":
    main()
