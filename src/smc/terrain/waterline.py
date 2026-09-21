"""Where the ground grid is water, and how high the water stands.

The lidar's ground class holds two things near the shore that are not ground. Returns off the
water itself -- a flat sheet at the tide the day it flew, a decimetre either side of one
height -- and, from the grid builder, cells filled inward from the nearest ground where there
were no returns at all, which along a quay grows a hundred metres of dry land out into the
bay. Drawn as terrain both are wrong: the first speckles the shoreline where a water plane
drawn at a fixed height pokes through them, the second is a grey slab over the water.

The map knows where the water is: OpenStreetMap's coastline and water polygons. This reads
the grid, finds the height of the water's surface from the returns off it (the median of the
low cells, measured, not assumed), and sets every cell inside a water polygon to that surface
height -- the coastline goes round the piers, which stay land, as does a seawall. The
renderer then treats any cell at or under the surface (plus a margin) as water, draws the sea
there, and stands nothing on it. What was done, and the heights it was done with, go into
the grid's metadata.
"""

from __future__ import annotations

import itertools
import json
from pathlib import Path

import numpy as np

#: Inside the coastline the coastline is right: a pier stands outside it, mapped as land, and a
#: quay's fill three metres up cannot be told from a deck by its height, so nothing inside is
#: kept for being high.
#: The water surface is the median of cells this far under the lowest quay: the returns off
#: the water. Where there are too few, there is no water in the grid to speak of.
LOW_CELL_M = 1.0
MIN_LOW_CELLS = 2000


def water_surface_m(height: np.ndarray) -> float | None:
    low = height[np.isfinite(height) & (height < LOW_CELL_M)]
    if low.size < MIN_LOW_CELLS:
        return None
    return float(np.median(low))


def rasterise(rings: list[list[list[float]]], frame: dict) -> np.ndarray:
    """A boolean grid of the cells whose centres lie inside any of the rings (even-odd rule)."""
    rows, cols = frame["rows"], frame["cols"]
    mask = np.zeros((rows, cols), dtype=bool)
    kx = frame["metres_per_lon"]
    ky = frame["metres_per_lat"]
    step = frame["step_m"]
    # Cell centres in the grid's metre frame.
    xs = frame["x0"] + (np.arange(cols) + 0.5) * step
    for ring in rings:
        if len(ring) < 3:
            continue
        pts = np.array([[(lon - frame["mid_lon"]) * kx, (lat - frame["mid_lat"]) * ky] for lon, lat in ring])
        if not np.allclose(pts[0], pts[-1]):
            pts = np.vstack([pts, pts[:1]])
        ymin, ymax = pts[:, 1].min(), pts[:, 1].max()
        r_lo = max(0, int((ymin - frame["y0"]) / step - 0.5))
        r_hi = min(rows - 1, int((ymax - frame["y0"]) / step - 0.5) + 1)
        for r in range(r_lo, r_hi + 1):
            y = frame["y0"] + (r + 0.5) * step
            a, b = pts[:-1], pts[1:]
            crosses = (a[:, 1] > y) != (b[:, 1] > y)
            if not crosses.any():
                continue
            ax, ay, bx, by = a[crosses, 0], a[crosses, 1], b[crosses, 0], b[crosses, 1]
            x_at = ax + (y - ay) * (bx - ax) / (by - ay)
            inside = np.zeros(cols, dtype=bool)
            for x in x_at:
                inside ^= xs > x
            mask[r] |= inside
    return mask


def coastline_mask(coastlines: list[list[list[float]]], frame: dict, height: np.ndarray, surface: float) -> np.ndarray:
    """The cells on the seaward side of the map's coastlines.

    OpenStreetMap draws a coastline with the land on its right and the water on its left -- by
    convention; six of this corridor's seven coastline ways run the other way. So the wet side
    is not assumed but read: the side of the way with the more cells at the water's surface
    (the lidar's returns off the water) is the wet side. The coastline cells themselves are a
    wall; the flood starts a cell and a half to the wet side of each segment and spreads
    through every cell whose ground is not plainly land (under the surface plus LAND_M) -- so
    a seawall, a quay or a pier deck stops it, and so does the coastline. The result is the
    water as the map draws its edge and the lidar confirms it, not a band guessed from either.
    """
    rows, cols = frame["rows"], frame["cols"]
    kx, ky, step = frame["metres_per_lon"], frame["metres_per_lat"], frame["step_m"]
    def to_cell(lon: float, lat: float) -> tuple[int, int]:
        return (int(((lat - frame["mid_lat"]) * ky - frame["y0"]) / step),
                int(((lon - frame["mid_lon"]) * kx - frame["x0"]) / step))
    wall = np.zeros((rows, cols), dtype=bool)
    at_surface = np.isfinite(height) & (np.abs(height - surface) < SURFACE_BAND_M)
    open_water = ~np.isfinite(height)
    seeds: list[tuple[int, int]] = []
    for line in coastlines:
        sides: dict[int, list[tuple[int, int]]] = {1: [], -1: []}
        for (lon1, lat1), (lon2, lat2) in itertools.pairwise(line):
            r1, c1 = to_cell(lon1, lat1)
            r2, c2 = to_cell(lon2, lat2)
            n = max(abs(r2 - r1), abs(c2 - c1), 1)
            dx = (lon2 - lon1) * kx
            dy = (lat2 - lat1) * ky
            length = (dx * dx + dy * dy) ** 0.5 or 1.0
            # Left of travel, one cell and a half out; right is its mirror.
            lr = round(dx / length * 1.5)
            lc = round(-dy / length * 1.5)
            for i in range(n + 1):
                r = r1 + (r2 - r1) * i // n
                c = c1 + (c2 - c1) * i // n
                if 0 <= r < rows and 0 <= c < cols:
                    wall[r, c] = True
                    sides[1].append((r + lr, c + lc))
                    sides[-1].append((r - lr, c - lc))
        def wetness(cells: list[tuple[int, int]]) -> float:
            hits = [(r, c) for r, c in cells if 0 <= r < rows and 0 <= c < cols]
            if not hits:
                return 0.0
            return sum(1 for r, c in hits if at_surface[r, c] or open_water[r, c]) / len(hits)
        wet = 1 if wetness(sides[1]) >= wetness(sides[-1]) else -1
        seeds.extend(sides[wet])
    land = np.isfinite(height) & (height > surface + LAND_M)
    blocked = wall | land
    water = np.zeros((rows, cols), dtype=bool)
    stack = [(r, c) for r, c in seeds if 0 <= r < rows and 0 <= c < cols and not blocked[r, c]]
    for r, c in stack:
        water[r, c] = True
    while stack:
        r, c = stack.pop()
        for rr, cc in ((r - 1, c), (r + 1, c), (r, c - 1), (r, c + 1)):
            if 0 <= rr < rows and 0 <= cc < cols and not water[rr, cc] and not blocked[rr, cc]:
                water[rr, cc] = True
                stack.append((rr, cc))
    return water


#: Ground this far over the water surface is land whatever side of a coastline it lies: a
#: seawall's top, a quay, a pier's deck. It stops the flood.
LAND_M = 1.2
#: A cell this close to the water surface is a return off the water: what decides a
#: coastline's wet side.
SURFACE_BAND_M = 0.35


def apply_waterline(grid_path: Path, rings: list[list[list[float]]],
                    coastlines: list[list[list[float]]] | None = None) -> dict:
    """Set the grid's water cells to the water surface and record what was done. Idempotent.

    ``rings`` are closed water polygons (lagoons, coves, the bay where a relation closed);
    ``coastlines`` are the map's coastline ways, flooded from their seaward side.
    """
    meta_path = grid_path.with_suffix(".json")
    meta = json.loads(meta_path.read_text())
    frame = meta["frame"]
    cm = np.frombuffer(grid_path.read_bytes(), dtype=np.int16).reshape(frame["rows"], frame["cols"]).copy()
    nodata = cm == frame["nodata"]
    height = np.where(nodata, np.nan, frame["base_m"] + cm / 100.0)
    surface = water_surface_m(height)
    coastlines = coastlines or []
    record: dict = {"polygons": len(rings), "coastlines": len(coastlines),
                    "surface_m": None if surface is None else round(surface, 3),
                    "cells_set_to_water": 0, "cells_open_water": int(nodata.sum())}
    if surface is None or not (rings or coastlines):
        record["note"] = "no water surface in the grid" if surface is None else "no water in the map"
        meta["waterline"] = record
        meta_path.write_text(json.dumps(meta, indent=1) + "\n")
        return record
    inside = rasterise(rings, frame) if rings else np.zeros(cm.shape, dtype=bool)
    if coastlines:
        inside |= coastline_mask(coastlines, frame, height, surface)
    # Water, at the surface the lidar saw.
    to_water = inside & ~nodata & (np.abs(height - surface) > 0.005)
    cm[to_water] = np.round((surface - frame["base_m"]) * 100.0).astype(np.int16)
    grid_path.write_bytes(cm.tobytes(order="C"))
    record["cells_set_to_water"] = int(to_water.sum())
    record["cells_water"] = int(inside.sum())
    record["land_m"] = LAND_M
    record["note"] = ("cells inside the map's closed water polygons, and on the seaward side of its "
                      "coastlines out to ground more than LAND_M over the water, were set to the water "
                      "surface the lidar measured; the renderer draws the sea at and under that surface")
    meta["waterline"] = record
    meta_path.write_text(json.dumps(meta, indent=1) + "\n")
    return record
