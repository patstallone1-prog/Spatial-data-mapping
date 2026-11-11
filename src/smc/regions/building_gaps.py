"""Buildings OpenStreetMap does not have, from San Francisco's own footprints.

The map's buildings are OpenStreetMap's. Where OSM has no outline for a building that stands
there (in the Marina: the 1,585 m2 building between Moulton and Greenwich at Webster, and two
beside it at Buchanan), the block showed a hole. DataSF's lidar building footprints
(``ynuv-fyni``, PDDL) cover every building in the city; a footprint that no OSM building
overlaps is one OSM is missing, and is added as a building of its own -- its outline and its
measured median height, tagged with where it came from.

A footprint counts as covered when a fair share of points spread over it fall inside some OSM
building (outlines differ by a metre or so between the two, and a footprint split in two in
one is whole in the other). Small ones (sheds, stair towers, a roof overhang drawn apart) are
left out, as are ones too low to be a building.
"""

from __future__ import annotations

import json
import math
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Iterable

DATASET = "ynuv-fyni"
ENDPOINT = f"https://data.sf.gov/resource/{DATASET}.json"
#: Smallest footprint added (m2): a garage or a small house, not a shed or a stair tower.
MIN_AREA_M2 = 40.0
#: Lowest building added (m): a storey and a roof (lower is a canopy, a wall, a shed).
MIN_HEIGHT_M = 3.0
#: Share of the footprint's sample points inside OSM buildings above which it is covered.
COVERED_SHARE = 0.3
#: The id range for added buildings: negative, so no OSM way id is ever met.
ID_BASE = -9_000_000_000


def _ring_area_m2(ring: list[list[float]]) -> float:
    lat0 = sum(p[1] for p in ring) / len(ring)
    mx, mz = 111_320.0 * math.cos(math.radians(lat0)), 110_540.0
    s = 0.0
    for a, b in zip(ring, ring[1:] + ring[:1]):
        s += a[0] * mx * b[1] * mz - b[0] * mx * a[1] * mz
    return abs(s) / 2


def _inside(x: float, y: float, ring: list[list[float]]) -> bool:
    c = False
    for a, b in zip(ring, ring[1:] + ring[:1]):
        if (a[1] > y) != (b[1] > y) and x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]:
            c = not c
    return c


def _samples(ring: list[list[float]]) -> list[tuple[float, float]]:
    """The middle and points three quarters of the way out to the corners."""
    cx = sum(p[0] for p in ring) / len(ring)
    cy = sum(p[1] for p in ring) / len(ring)
    step = max(1, len(ring) // 8)
    return [(cx, cy)] + [((p[0] * 3 + cx) / 4, (p[1] * 3 + cy) / 4) for p in ring[::step]]


class _Grid:
    """OSM building outlines by ~110 m cell, for the point tests."""

    def __init__(self, outlines: Iterable[list[list[float]]], cell: float = 0.001):
        self.cell, self.cells = cell, {}
        for ring in outlines:
            xs, ys = [p[0] for p in ring], [p[1] for p in ring]
            for i in range(int(min(xs) // cell), int(max(xs) // cell) + 1):
                for j in range(int(min(ys) // cell), int(max(ys) // cell) + 1):
                    self.cells.setdefault((i, j), []).append(ring)

    def covers(self, x: float, y: float) -> bool:
        return any(_inside(x, y, r) for r in self.cells.get((int(x // self.cell), int(y // self.cell)), ()))


def footprint_rings(row: dict[str, Any]) -> list[list[list[float]]]:
    shape = row.get("shape") or row.get("geometry") or {}
    if shape.get("type") == "Polygon":
        polys = [shape["coordinates"]]
    elif shape.get("type") == "MultiPolygon":
        polys = shape["coordinates"]
    else:
        return []
    out = []
    for poly in polys:
        ring = [list(map(float, p[:2])) for p in poly[0]]
        if len(ring) > 3 and ring[0] == ring[-1]:
            ring = ring[:-1]
        if len(ring) >= 3:
            out.append(ring)
    return out


def _height_m(row: dict[str, Any]) -> float | None:
    for key in ("hgt_median_m", "hgt_mediancm"):
        try:
            value = float(row[key])
        except (KeyError, TypeError, ValueError):
            continue
        return value / 100 if key.endswith("cm") else value
    return None


#: Areas drawn as something other than a building: a footprint whose middle is in one is left
#: out (the pavement drawn as an area, the water, a pier) -- the map says it is open there.
OPEN_KINDS = {"sidewalk", "street", "water", "pier", "beach", "parking_aisle"}


def missing_buildings(ways: list[dict[str, Any]], footprints: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The footprints no OSM building in ``ways`` covers, as building ways."""
    grid = _Grid(w["points"] for w in ways if w.get("kind") == "building" and len(w.get("points") or []) >= 3)
    open_ = _Grid(w["points"] for w in ways if w.get("kind") in OPEN_KINDS and len(w.get("points") or []) >= 4
                  and w["points"][0] == w["points"][-1])
    out: list[dict[str, Any]] = []
    for row in footprints:
        height = _height_m(row)
        if height is None or height < MIN_HEIGHT_M:
            continue
        for k, ring in enumerate(footprint_rings(row)):
            area = _ring_area_m2(ring)
            if area < MIN_AREA_M2:
                continue
            pts = _samples(ring)
            if sum(grid.covers(x, y) for x, y in pts) / len(pts) >= COVERED_SHARE:
                continue
            if open_.covers(*pts[0]):
                continue
            key = str(row.get("sf16_bldgid") or row.get("area_id") or f"{ring[0][0]:.6f},{ring[0][1]:.6f}")
            digits = "".join(ch for ch in key if ch.isdigit())[-9:] or "0"
            out.append({
                "kind": "building", "name": None, "height_m": round(height, 2),
                "height_source": "datasf_lidar_median_height",
                "centroid": [round(sum(p[0] for p in ring) / len(ring), 7), round(sum(p[1] for p in ring) / len(ring), 7)],
                "points": [[round(p[0], 7), round(p[1], 7)] for p in ring] + [[round(ring[0][0], 7), round(ring[0][1], 7)]],
                "osm_id": ID_BASE - int(digits) * 10 - k,
                "tags": {"building": "yes", "source": f"datasf:{DATASET}"},
                "covered": True, "archetype": "generic", "source": f"datasf:{DATASET}",
                "footprint_area_m2": round(area, 1),
            })
    return out


def fill_building_gaps(ways: list[dict[str, Any]], footprints: list[dict[str, Any]]) -> int:
    """Append the missing buildings to ``ways`` (in place; idempotent). How many were added."""
    have = {w.get("osm_id") for w in ways if w.get("kind") == "building"}
    added = [w for w in missing_buildings(ways, footprints) if w["osm_id"] not in have]
    ways.extend(added)
    return len(added)


def fetch_footprints(bbox: tuple[float, float, float, float], cache: Path, *, user_agent: str = "smc-building-gaps/1") -> list[dict[str, Any]]:
    """DataSF's footprints in ``bbox`` (south, west, north, east), cached at ``cache``."""
    if cache.exists():
        return json.loads(cache.read_text(encoding="utf-8"))["rows"]
    south, west, north, east = bbox
    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        params = urllib.parse.urlencode({
            "$select": "sf16_bldgid,area_id,hgt_median_m,shape",
            "$where": f"within_box(shape,{north},{west},{south},{east})",
            "$limit": 5000, "$offset": offset,
        })
        request = urllib.request.Request(f"{ENDPOINT}?{params}", headers={"User-Agent": user_agent})
        with urllib.request.urlopen(request, timeout=120) as response:
            chunk = json.loads(response.read().decode("utf-8"))
        rows.extend(chunk)
        if len(chunk) < 5000:
            break
        offset += 5000
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps({"source": f"datasf:{DATASET}", "bbox": list(bbox), "rows": rows}, separators=(",", ":")) + "\n", encoding="utf-8")
    return rows
