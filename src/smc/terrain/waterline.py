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

#: The water surface is the median of cells this far under the lowest quay: the returns off
#: the water. Where there are too few, there is no water in the grid to speak of.
LOW_CELL_M = 1.0
MIN_LOW_CELLS = 2000
#: Enough cells inside the map's water to take the surface from them rather than from every
#: low cell.
MIN_MAPPED_WATER_CELLS = 500
#: The map's water counts as the sea only within this of the low cells' level.
MAPPED_SURFACE_TOLERANCE_M = 1.5


def water_surface_m(height: np.ndarray, inside: np.ndarray | None = None) -> float | None:
    """The water's surface: the median of the returns off the water.

    Where the map says which cells are water (``inside``, the closed water polygons), the
    median is taken over those and nothing else. Over every low cell instead, downtown
    Oakland's came out at 0.85 m: the quays along the estuary stand under a metre and
    outnumber the returns off it, so the "surface" was the quay, and the quay was the sea.
    """
    finite = np.isfinite(height)
    low = height[finite & (height < LOW_CELL_M)]
    if low.size < MIN_LOW_CELLS:
        # No sea in the grid to speak of. The map's water may still be there -- a pond on a
        # campus sixty metres up -- and is not the sea: below its level is not water.
        return None
    rough = float(np.median(low))
    if inside is not None and int((inside & finite).sum()) >= MIN_MAPPED_WATER_CELLS:
        mapped = float(np.median(height[inside & finite]))
        # The map's water is the sea's surface only where it stands at about the sea's level:
        # a cove, an estuary, a harbour -- not a lake up a hill.
        if abs(mapped - rough) < MAPPED_SURFACE_TOLERANCE_M:
            return mapped
    return rough


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


def coastline_mask(coastlines: list[list[list[float]]], frame: dict, height: np.ndarray, surface: float,
                   buildings: list[list[float]] | None = None,
                   walls: list[list[list[float]]] | None = None) -> np.ndarray:
    """The cells on the seaward side of the map's coastlines.

    The coastline cells themselves are a wall (8-connected, so a 4-connected flood cannot slip
    between two of them), and so are the closed water polygons' outlines (``walls``). The flood
    starts from the cells that are plainly water -- the lidar's returns off the water, at the
    surface, and the cells with no returns at all -- and from a cell and a half to the wet side
    of each coastline segment, the wet side being the side that flood reaches more of (and
    where it reaches neither, the map's convention: water to port). It
    spreads through every cell that is not a wall, whatever its height: inside the coastline
    the coastline is right. A quay's fill, three metres up for a hundred metres out over the
    bay, is water because the map says the bay is there; a pier deck the coastline goes round
    is land because the map went round it. Heights used to stop the flood, and the fill stopped
    it a cell out from every quay, leaving the bay a grey slab beyond every pier.

    What guards against a leak is the map's own evidence: a body the flood reaches that has
    more than MAX_BUILDINGS_IN_WATER of the region's ``buildings`` (centroids, lon/lat) in it
    is land the flood got into. There the map has failed, and the lidar decides instead: that
    body is flooded again from the plain water, stopped by ground more than LAND_M over the
    surface -- a seawall's top, a quay -- which keeps the bay and loses the town.
    """
    rows, cols = frame["rows"], frame["cols"]
    kx, ky, step = frame["metres_per_lon"], frame["metres_per_lat"], frame["step_m"]
    def to_cell(lon: float, lat: float) -> tuple[int, int]:
        return (int(((lat - frame["mid_lat"]) * ky - frame["y0"]) // step),
                int(((lon - frame["mid_lon"]) * kx - frame["x0"]) // step))
    at_surface = np.isfinite(height) & (np.abs(height - surface) < SURFACE_BAND_M)
    open_water = ~np.isfinite(height)
    wall = np.zeros((rows, cols), dtype=bool)
    def draw(r1: int, c1: int, r2: int, c2: int) -> None:
        n = max(abs(r2 - r1), abs(c2 - c1), 1)
        for i in range(n + 1):
            r = r1 + round((r2 - r1) * i / n)
            c = c1 + round((c2 - c1) * i / n)
            if 0 <= r < rows and 0 <= c < cols:
                wall[r, c] = True
    for line in coastlines + list(walls or []):
        for (lon1, lat1), (lon2, lat2) in itertools.pairwise(line):
            draw(*to_cell(lon1, lat1), *to_cell(lon2, lat2))
    # A coastline way that ends inside the grid with no other way carrying on from it is the
    # last way the box's query caught: the shore goes on past the box in a way the query did
    # not. Left open, the flood walks round the end of it into the town. So a loose end is
    # walled straight out to the nearest edge of the grid.
    ends = [to_cell(*line[0]) for line in coastlines] + [to_cell(*line[-1]) for line in coastlines]
    for r, c in ends:
        if not (0 <= r < rows and 0 <= c < cols) or sum(abs(r - rr) <= 1 and abs(c - cc) <= 1 for rr, cc in ends) > 1:
            continue
        nearest = min((r, 0, c), (rows - 1 - r, rows - 1, c), (c, r, 0), (cols - 1 - c, r, cols - 1))
        draw(r, c, nearest[1], nearest[2])
    # The flood from the plain water first: what it reaches is what decides a coastline's wet
    # side, since the returns off the water may lie a hundred metres of fill away from the quay.
    reached = _components((at_surface | open_water) & ~wall, wall) > 0
    # The seeds proper: the cells with no returns, and the coastlines' wet sides. Not every
    # cell at the surface -- a sunken yard in the town is at the surface too, and would flood
    # the town from inside; inside the walls the flood reaches the returns anyway.
    seeds = open_water.copy()
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
                r = r1 + round((r2 - r1) * i / n)
                c = c1 + round((c2 - c1) * i / n)
                sides[1].append((r + lr, c + lc))
                sides[-1].append((r - lr, c - lc))
        def wetness(cells: list[tuple[int, int]]) -> float:
            hits = [(r, c) for r, c in cells if 0 <= r < rows and 0 <= c < cols]
            if not hits:
                return 0.0
            return sum(1 for r, c in hits if reached[r, c] or at_surface[r, c] or open_water[r, c]) / len(hits)
        # Where neither side shows any water, the map's convention: water to port of travel.
        wet = 1 if wetness(sides[1]) >= wetness(sides[-1]) else -1
        for r, c in sides[wet]:
            if 0 <= r < rows and 0 <= c < cols:
                seeds[r, c] = True
    label = _components(seeds & ~wall, wall)
    if buildings and label.max():
        counts = np.zeros(label.max() + 1, dtype=np.int64)
        for lon, lat in buildings:
            r, c = to_cell(lon, lat)
            if 0 <= r < rows and 0 <= c < cols and label[r, c]:
                counts[label[r, c]] += 1
        for body in range(1, label.max() + 1):
            if counts[body] > MAX_BUILDINGS_IN_WATER:
                # The map leaked here -- a coastline that stops short, a gap at the box's
                # edge -- so within this body the lidar decides instead: the flood is run
                # again from the plain water, stopped by ground plainly over the surface.
                leaked = label == body
                label[leaked] = 0
                land = np.isfinite(height) & (height > surface + LAND_M)
                again = _components(seeds & leaked & ~land, wall | land | ~leaked) > 0
                label[again] = body
    return label > 0


def _components(seeds: np.ndarray, wall: np.ndarray) -> np.ndarray:
    """The 4-connected flood from the seeds, labelled by body; 0 is dry."""
    rows, cols = wall.shape
    label = np.zeros(wall.shape, dtype=np.int32)
    n = 0
    for r0, c0 in zip(*np.nonzero(seeds), strict=True):
        if label[r0, c0]:
            continue
        n += 1
        label[r0, c0] = n
        stack = [(r0, c0)]
        while stack:
            r, c = stack.pop()
            for rr, cc in ((r - 1, c), (r + 1, c), (r, c - 1), (r, c + 1)):
                if 0 <= rr < rows and 0 <= cc < cols and not label[rr, cc] and not wall[rr, cc]:
                    label[rr, cc] = n
                    stack.append((rr, cc))
    return label


#: A body of water the flood reached with this many of the region's buildings standing in it
#: is land the flood leaked into. Houseboats and pier sheds are fewer.
MAX_BUILDINGS_IN_WATER = 40
#: Where the map leaked, ground this far over the water surface stops the flood: a seawall's
#: top, a quay.
LAND_M = 1.2
#: A cell this close to the water surface is a return off the water: what decides a
#: coastline's wet side.
SURFACE_BAND_M = 0.35


def apply_waterline(grid_path: Path, rings: list[list[list[float]]],
                    coastlines: list[list[list[float]]] | None = None,
                    buildings: list[list[float]] | None = None) -> dict:
    """Set the grid's water cells to the water surface and record what was done. Idempotent.

    ``rings`` are closed water polygons (lagoons, coves, the bay where a relation closed);
    ``coastlines`` are the map's coastline ways, flooded from their seaward side; ``buildings``
    are the region's building centroids, which tell a flooded bay from a flooded town.
    """
    meta_path = grid_path.with_suffix(".json")
    meta = json.loads(meta_path.read_text())
    frame = meta["frame"]
    cm = np.frombuffer(grid_path.read_bytes(), dtype=np.int16).reshape(frame["rows"], frame["cols"]).copy()
    nodata = cm == frame["nodata"]
    height = np.where(nodata, np.nan, frame["base_m"] + cm / 100.0)
    mapped = rasterise(rings, frame) if rings else None
    surface = water_surface_m(height, mapped)
    coastlines = coastlines or []
    record: dict = {"polygons": len(rings), "coastlines": len(coastlines),
                    "surface_m": None if surface is None else round(surface, 3),
                    "cells_set_to_water": 0, "cells_open_water": int(nodata.sum())}
    if surface is None or not (rings or coastlines):
        record["note"] = "no water surface in the grid" if surface is None else "no water in the map"
        meta["waterline"] = record
        meta_path.write_text(json.dumps(meta, indent=1) + "\n")
        return record
    inside = mapped if mapped is not None else np.zeros(cm.shape, dtype=bool)
    if coastlines:
        inside |= coastline_mask(coastlines, frame, height, surface, buildings, walls=rings)
    # Water, at the surface the lidar saw.
    to_water = inside & ~nodata & (np.abs(height - surface) > 0.005)
    cm[to_water] = np.round((surface - frame["base_m"]) * 100.0).astype(np.int16)
    grid_path.write_bytes(cm.tobytes(order="C"))
    record["cells_set_to_water"] = int(to_water.sum())
    record["cells_water"] = int(inside.sum())
    record["note"] = ("cells inside the map's closed water polygons, and on the seaward side of its "
                      "coastlines, were set to the water surface the lidar measured whatever the grid's "
                      "fill had them at; the renderer draws the sea at and under that surface")
    meta["waterline"] = record
    meta_path.write_text(json.dumps(meta, indent=1) + "\n")
    return record
