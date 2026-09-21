"""The country round a region: land or water, five miles out in every direction, and the
bridges that leave it.

A region's page used to end at its box. Past the edge was a green plate and a blue disc
that met in a straight seam somewhere out in the bay, and nothing said where the shore
really ran, so the Bay Bridge stopped at the edge of the box and Oakland was a rectangle
of ocean. This classifies a coarse grid (PERIMETER_CELL_M) over the region's box widened by
PERIMETER_M, from the map:

* the coastline ways are walls;
* the water is flooded from what the region's own ground grid already knows is water (the
  cells at the water surface, smc.terrain.waterline) -- so the bay, the estuary and the
  ocean through the Golden Gate are one body, and an island ringed by coastline is land;
* the map's closed water polygons (lakes, lagoons) are water outright;
* everything the flood does not reach is land.

The bridges are the map's bridge ways -- whole, not cut at the box, so a span that leaves
the region reaches the other shore -- with which of their vertices stand over water. The
result is one small file the page draws as grass, sea and decks. Nothing here is measured:
it is the map, and says so.
"""

from __future__ import annotations

import itertools
import json
import math
from pathlib import Path
from typing import Any

import numpy as np

#: Five miles, in metres.
PERIMETER_M = 8047.0
PERIMETER_CELL_M = 40.0
BRIDGE_HIGHWAYS = ("motorway", "trunk", "primary", "secondary", "motorway_link", "trunk_link")


def perimeter_query(south: float, west: float, north: float, east: float) -> str:
    area = f"{south},{west},{north},{east}"
    return (
        "[out:json][timeout:120];("
        f'way["natural"="coastline"]({area});'
        f'way["natural"="water"]({area});'
        f'relation["natural"="water"]({area});'
        # The bay itself, as the map has it: the flood's seed for a region whose own ground
        # grid holds no water -- downtown Oakland is a mile from the estuary.
        f'relation["natural"~"^(bay|strait)$"]({area});'
        f'way["bridge"]["highway"~"^({"|".join(BRIDGE_HIGHWAYS)})$"]({area});'
        ");out geom;"
    )


def frame_for(bbox: dict, region_frame: dict, wide: dict | None = None) -> dict:
    """A cell frame over the widened box, in the region grid's own metre frame. ``wide`` is
    a lon/lat box to cover instead of the five-mile one -- the five-mile box grown to take in
    a bridge that leaves it."""
    kx, ky = region_frame["metres_per_lon"], region_frame["metres_per_lat"]
    box = wide or {"south": bbox["south"] - PERIMETER_M / ky, "west": bbox["west"] - PERIMETER_M / kx,
                   "north": bbox["north"] + PERIMETER_M / ky, "east": bbox["east"] + PERIMETER_M / kx}
    west = (box["west"] - region_frame["mid_lon"]) * kx
    east = (box["east"] - region_frame["mid_lon"]) * kx
    south = (box["south"] - region_frame["mid_lat"]) * ky
    north = (box["north"] - region_frame["mid_lat"]) * ky
    cols = math.ceil((east - west) / PERIMETER_CELL_M)
    rows = math.ceil((north - south) / PERIMETER_CELL_M)
    return {"mid_lon": region_frame["mid_lon"], "mid_lat": region_frame["mid_lat"],
            "metres_per_lon": kx, "metres_per_lat": ky, "x0": west, "y0": south,
            "step_m": PERIMETER_CELL_M, "cols": cols, "rows": rows, "bbox": dict(box)}


def _cell(frame: dict, lon: float, lat: float) -> tuple[int, int]:
    x = (lon - frame["mid_lon"]) * frame["metres_per_lon"]
    y = (lat - frame["mid_lat"]) * frame["metres_per_lat"]
    return int((y - frame["y0"]) // frame["step_m"]), int((x - frame["x0"]) // frame["step_m"])


def rasterise_lines(lines: list[list[list[float]]], frame: dict) -> np.ndarray:
    """The cells a set of polylines pass through, 8-connected, so a 4-connected flood cannot
    slip between two cells of a wall."""
    rows, cols = frame["rows"], frame["cols"]
    wall = np.zeros((rows, cols), dtype=bool)
    for line in lines:
        for (lon1, lat1), (lon2, lat2) in itertools.pairwise(line):
            r1, c1 = _cell(frame, lon1, lat1)
            r2, c2 = _cell(frame, lon2, lat2)
            n = max(abs(r2 - r1), abs(c2 - c1), 1)
            for i in range(n + 1):
                r = r1 + round((r2 - r1) * i / n)
                c = c1 + round((c2 - c1) * i / n)
                if 0 <= r < rows and 0 <= c < cols:
                    wall[r, c] = True
    return wall


def chain_rings(chains: list[list[list[float]]]) -> list[list[list[float]]]:
    """A multipolygon's outer members strung end to end into closed rings. The bay is one
    relation whose outers are a few hundred coastline ways, none of them closed on its own."""
    pending = [c for c in chains if len(c) >= 2]
    rings: list[list[list[float]]] = []
    while pending:
        current = pending.pop(0)
        grew = True
        while grew and current[0] != current[-1]:
            grew = False
            for i, chain in enumerate(pending):
                if current[-1] == chain[0]:
                    current = current + chain[1:]
                elif current[-1] == chain[-1]:
                    current = current + chain[::-1][1:]
                elif current[0] == chain[-1]:
                    current = chain + current[1:]
                elif current[0] == chain[0]:
                    current = chain[::-1] + current[1:]
                else:
                    continue
                pending.pop(i)
                grew = True
                break
        if len(current) >= 4 and current[0] == current[-1]:
            rings.append(current)
    return rings


def rasterise_rings(rings: list[list[list[float]]], frame: dict) -> np.ndarray:
    from smc.terrain.waterline import rasterise
    return rasterise(rings, frame)


def flood(seeds: np.ndarray, wall: np.ndarray) -> np.ndarray:
    """Every cell reachable from a seed without crossing a wall, 4-connected."""
    return components(seeds, wall) > 0


def components(seeds: np.ndarray, wall: np.ndarray) -> np.ndarray:
    """The flood, labelled: each connected body of water reached from the seeds gets its own
    number, 0 for dry. So that a body can be judged on its own."""
    rows, cols = wall.shape
    label = np.zeros(wall.shape, dtype=np.int32)
    n = 0
    for r0, c0 in zip(*np.nonzero(seeds & ~wall), strict=True):
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


#: A body of water with this many of the region's buildings standing in it is not water: it
#: is the land the flood leaked into. The Palace of Fine Arts lagoon, water in the ground grid
#: but ringed by no coastline, flooded the whole peninsula this way.
MAX_BUILDINGS_IN_WATER = 40


def region_water_seeds(frame: dict, grid_path: Path) -> np.ndarray:
    """The perimeter cells whose centre lies on a region grid cell at the water surface."""
    meta = json.loads(grid_path.with_suffix(".json").read_text())
    g = meta["frame"]
    surface = (meta.get("waterline") or {}).get("surface_m")
    seeds = np.zeros((frame["rows"], frame["cols"]), dtype=bool)
    if surface is None:
        return seeds
    cm = np.frombuffer(grid_path.read_bytes(), dtype=np.int16).reshape(g["rows"], g["cols"])
    height = np.where(cm == g["nodata"], np.nan, g["base_m"] + cm / 100.0)
    wet = np.isfinite(height) & (height < surface + 0.45)
    # Both frames share an origin; only the cell size differs.
    for r in range(frame["rows"]):
        y = frame["y0"] + (r + 0.5) * frame["step_m"]
        gr = int((y - g["y0"]) // g["step_m"])
        if not 0 <= gr < g["rows"]:
            continue
        for c in range(frame["cols"]):
            x = frame["x0"] + (c + 0.5) * frame["step_m"]
            gc = int((x - g["x0"]) // g["step_m"])
            if 0 <= gc < g["cols"] and wet[gr, gc]:
                seeds[r, c] = True
    return seeds


def classify(elements: list[dict[str, Any]], frame: dict, seeds: np.ndarray,
             buildings: list[list[float]] | None = None) -> tuple[np.ndarray, dict]:
    """``buildings`` are the region's building centroids (lon, lat): what tells a leak from a bay."""
    coastlines: list[list[list[float]]] = []
    rings: list[list[list[float]]] = []
    bays: list[list[list[float]]] = []
    for element in elements:
        tags = element.get("tags") or {}
        geometry = element.get("geometry") or []
        points = [[p["lon"], p["lat"]] for p in geometry if "lon" in p and "lat" in p]
        if element.get("type") == "way" and tags.get("natural") == "coastline" and len(points) >= 2:
            coastlines.append(points)
        elif element.get("type") == "relation" and tags.get("natural") in ("bay", "strait"):
            for member in element.get("members") or []:
                if member.get("role") in ("outer", "", None):
                    ring = [[p["lon"], p["lat"]] for p in (member.get("geometry") or []) if "lon" in p]
                    # A member of two points is still a link in the chain; dropped, the ring
                    # never closed and the bay seeded nothing.
                    if len(ring) >= 2:
                        bays.append(ring)
        elif tags.get("natural") == "water":
            if element.get("type") == "way" and len(points) >= 4 and points[0] == points[-1]:
                rings.append(points)
            elif element.get("type") == "relation":
                for member in element.get("members") or []:
                    if member.get("role") in ("outer", "", None):
                        ring = [[p["lon"], p["lat"]] for p in (member.get("geometry") or []) if "lon" in p]
                        if len(ring) >= 4 and ring[0] == ring[-1]:
                            rings.append(ring)
    # The coastlines are walls, and so are the water polygons' rings: a lagoon's seed floods
    # the lagoon and nothing past its bank.
    wall = rasterise_lines(coastlines + [ring for ring in rings], frame)
    # The bay's own outline seeds the flood where the region's grid cannot. Its members are
    # coastline ways strung together, so a member that is not itself closed still marks the
    # water along its inside; the flood then fills the rest.
    if bays:
        closed = chain_rings(bays)
        if closed:
            seeds = seeds | (rasterise_rings(closed, frame) & ~wall)
    label = components(seeds, wall)
    # A body with the region's buildings in it is land the flood leaked into.
    rejected = 0
    if buildings and label.max():
        counts = np.zeros(label.max() + 1, dtype=np.int64)
        for lon, lat in buildings:
            r, c = _cell(frame, lon, lat)
            if 0 <= r < frame["rows"] and 0 <= c < frame["cols"] and label[r, c]:
                counts[label[r, c]] += 1
        for body in range(1, label.max() + 1):
            if counts[body] > MAX_BUILDINGS_IN_WATER:
                label[label == body] = 0
                rejected += 1
    water = label > 0
    lakes = rasterise_rings(rings, frame) if rings else np.zeros_like(water)
    water |= lakes
    return water, {"coastline_ways": len(coastlines), "water_polygons": len(rings), "bay_members": len(bays),
                   "bay_rings_closed": len(chain_rings(bays)) if bays else 0,
                   "cells_water": int(water.sum()), "cells": int(water.size),
                   "seeds": int(seeds.sum()), "bodies": int(label.max()), "bodies_rejected_as_land": rejected}


def bridges(elements: list[dict[str, Any]], frame: dict, water: np.ndarray) -> list[dict]:
    out = []
    for element in elements:
        tags = element.get("tags") or {}
        if element.get("type") != "way" or not tags.get("bridge") or tags.get("highway") not in BRIDGE_HIGHWAYS:
            continue
        raw = [[p["lon"], p["lat"]] for p in (element.get("geometry") or []) if "lon" in p]
        if len(raw) < 2:
            continue
        # A vertex every cell along the way: the Bay Bridge's west span is a way of three
        # points with both ends on land, and judged at its vertices it was never over water.
        points: list[list[float]] = [[round(raw[0][0], 6), round(raw[0][1], 6)]]
        for (lon1, lat1), (lon2, lat2) in itertools.pairwise(raw):
            length = math.hypot((lon2 - lon1) * frame["metres_per_lon"], (lat2 - lat1) * frame["metres_per_lat"])
            steps = max(1, math.ceil(length / frame["step_m"]))
            for i in range(1, steps + 1):
                points.append([round(lon1 + (lon2 - lon1) * i / steps, 6), round(lat1 + (lat2 - lat1) * i / steps, 6)])
        over = []
        for lon, lat in points:
            r, c = _cell(frame, lon, lat)
            over.append(bool(0 <= r < frame["rows"] and 0 <= c < frame["cols"] and water[r, c]))
        try:
            lanes = int(str(tags.get("lanes", "")).split(";")[0])
        except ValueError:
            lanes = 0
        out.append({"osm_id": element.get("id"), "name": tags.get("name"), "highway": tags.get("highway"),
                    "lanes": lanes or None, "layer": tags.get("layer"), "points": points, "over_water": over})
    return out


def write_perimeter(out: Path, frame: dict, water: np.ndarray, spans: list[dict], counts: dict, source: str) -> None:
    rows = ["".join("1" if v else "0" for v in water[r]) for r in range(frame["rows"])]
    out.write_text(json.dumps({
        "source": source,
        "note": ("land or water, from OpenStreetMap's coastline flooded from the region's own water and "
                 "its closed water polygons; the bridges are the map's bridge ways whole, with which vertices "
                 "stand over water. Not measured: the map."),
        "frame": frame, "counts": counts, "cells": rows, "bridges": spans,
    }, separators=(",", ":")))
