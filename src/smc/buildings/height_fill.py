"""Heights, and roof shapes, for the buildings nobody measured: City3D, then 3dfier, then the atlas.

A building reaches the payload with a height from the region's lidar (smc.buildings.lidar_heights),
the city's records, or a mapper. Some reach it with none: ``inferred_default`` (a flat 10.5 m),
a regional median, or nothing. Those -- and only those -- are filled here, from the first of three
sources, in this order:

1. **City3D** (Huang, Stoter, Peters, Nan 2022; github.com/tudelft3d/City3D). An LoD2 model
   reconstructed from the 3DEP lidar returns inside the footprint: roof planes found, the
   building's faces chosen by an integer programme. Its height is the model's top over the
   ground it stands on; its roof faces also give the roof's shape.
2. **3dfier** (Ledoux et al. 2021; github.com/tudelft3d/3dfier). An LoD1.2 block lifted from the
   same returns: the roof's 90th percentile over the ground's 10th. No roof shape, but the spread
   of the roof's percentiles says flat or pitched.
3. **GlobalBuildingAtlas** (Zhu et al. 2025; github.com/zhu-xlab/GlobalBuildingAtlas). LoD1 heights
   estimated from 3 m satellite images (1.5-8.9 m RMSE by continent): the last resort, used only
   where neither lidar model has a reading. Its heights are CC BY-NC 4.0, so a building filled
   from it says so (``height_licence``).

The two lidar models are measurements; the atlas is an estimate. A height that does not pass
``plausible`` (2-330 m, and no more than ``MAX_SLENDERNESS`` times the footprint's width) is not
used, and the next source is tried.
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Mapping
from typing import Any

#: The heights that are guesses, and so may be replaced. A stated height, a storey count, the
#: region's lidar, the city's records and Overture's heights are all kept.
FILLABLE = {None, "", "missing", "inferred_default", "regional_median_estimate"}
#: The order the sources are tried in.
RANK = ("city3d", "3dfier", "gba")
SOURCE = {"city3d": "city3d_lod2", "3dfier": "3dfier_lod12", "gba": "gba_lod1"}
LICENCE = {"gba": "CC BY-NC 4.0 (GlobalBuildingAtlas heights)"}
MIN_H, MAX_H = 2.0, 330.0
#: The Salesforce Tower is ~6.5 times as tall as its footprint is wide; a reading far past that
#: on a small footprint is a tree, a crane or the tower next door.
MAX_SLENDERNESS = 8.0
#: Roof faces steeper than this are pitched; flatter, flat.
FLAT_DEG = 6.0
#: A roof is pitched when at least this share of its area is pitched faces; else flat (a flat roof
#: with a stair head or a skylight is still flat).
PITCHED_SHARE = 0.2
#: Planes this close in direction are one roof side.
SIDE_DEG = 25.0
#: 3dfier: a roof whose 25th-to-99th percentile spread is under this is flat; over PITCHED_M,
#: pitched.
FLAT_SPREAD_M, PITCHED_SPREAD_M = 0.6, 1.5
#: Where trees and roofs share a lidar class (San Francisco's and Alameda's surveys), a crown over
#: a small building spreads its "roof" over many metres. A roof rises at most about half the
#: building's height: a spread past that, and past CANOPY_SPREAD_M, is canopy, not a reading.
CANOPY_SPREAD_M = 3.0
M_PER_DEG = 111_320.0


# ---- footprints ---------------------------------------------------------------------------------

def local_ring(points: Iterable[Iterable[float]], lon0: float | None = None, lat0: float | None = None) -> list[tuple[float, float]]:
    """A lon/lat outline in metres east and north of (lon0, lat0) -- its first point by default."""
    pts = [(float(p[0]), float(p[1])) for p in points]
    if not pts:
        return []
    lon0 = pts[0][0] if lon0 is None else lon0
    lat0 = pts[0][1] if lat0 is None else lat0
    kx = M_PER_DEG * math.cos(math.radians(lat0))
    return [((lon - lon0) * kx, (lat - lat0) * M_PER_DEG) for lon, lat in pts]


def ring_area(ring: list[tuple[float, float]]) -> float:
    return abs(sum(ring[i][0] * ring[i - 1][1] - ring[i - 1][0] * ring[i][1] for i in range(len(ring)))) / 2.0


def plausible(height: float | None, area_m2: float | None = None) -> bool:
    """A height a building could have on this footprint."""
    if height is None or not math.isfinite(height) or not MIN_H <= height <= MAX_H:
        return False
    return not (area_m2 and area_m2 > 0 and height > MAX_SLENDERNESS * math.sqrt(area_m2))


# ---- City3D: an OBJ model -------------------------------------------------------------------------

def read_obj(text: str) -> tuple[list[tuple[float, float, float]], list[list[int]]]:
    """Vertices and faces (0-based) of a Wavefront OBJ."""
    verts: list[tuple[float, float, float]] = []
    faces: list[list[int]] = []
    for line in text.splitlines():
        if line.startswith("v "):
            x, y, z = (float(v) for v in line.split()[1:4])
            verts.append((x, y, z))
        elif line.startswith("f "):
            idx = []
            for tok in line.split()[1:]:
                i = int(tok.split("/")[0])
                idx.append(i - 1 if i > 0 else len(verts) + i)
            if len(idx) >= 3:
                faces.append(idx)
    return verts, faces


def _face_normal_area(pts: list[tuple[float, float, float]]) -> tuple[tuple[float, float, float], float]:
    """Newell's normal of a planar polygon, and its area."""
    nx = ny = nz = 0.0
    for i, (x1, y1, z1) in enumerate(pts):
        x2, y2, z2 = pts[(i + 1) % len(pts)]
        nx += (y1 - y2) * (z1 + z2)
        ny += (z1 - z2) * (x1 + x2)
        nz += (x1 - x2) * (y1 + y2)
    norm = math.sqrt(nx * nx + ny * ny + nz * nz)
    if norm == 0:
        return (0.0, 0.0, 0.0), 0.0
    return (nx / norm, ny / norm, nz / norm), norm / 2.0


def city3d_reading(obj_text: str, ground_z: float | None = None) -> dict[str, Any] | None:
    """Height and roof of one City3D model: its top over ``ground_z`` (the model's lowest point
    when not given), and its roof faces -- the faces looking up -- read as flat, skillion
    (one pitched side), gabled (two opposite sides), hipped (sides in four directions) or
    complex."""
    verts, faces = read_obj(obj_text)
    if not verts or not faces:
        return None
    zs = [v[2] for v in verts]
    base = min(zs) if ground_z is None else ground_z
    top = max(zs)
    sides: list[dict[str, float]] = []   # pitched roof faces: azimuth, slope, area
    flat_area = pitched_area = 0.0
    eave = math.inf
    for f in faces:
        pts = [verts[i] for i in f]
        (nx, ny, nz), area = _face_normal_area(pts)
        if area <= 1e-6 or nz <= 0.17:          # walls (|nz| ~ 0) and the floor (nz < 0)
            continue
        slope = math.degrees(math.acos(max(-1.0, min(1.0, nz))))
        if slope < FLAT_DEG:
            flat_area += area
            continue
        pitched_area += area
        eave = min(eave, min(p[2] for p in pts))
        sides.append({"az": math.degrees(math.atan2(nx, ny)) % 360.0, "slope": slope, "area": area})
    roof_area = flat_area + pitched_area
    if roof_area <= 0:
        return None
    reading: dict[str, Any] = {"height_m": round(top - base, 2), "roof_area_m2": round(roof_area, 1),
                               "pitched_share": round(pitched_area / roof_area, 3)}
    if pitched_area / roof_area < PITCHED_SHARE:
        reading["roof"] = "flat"
        return reading
    groups = _sides(sides)
    big = [g for g in groups if g["area"] >= 0.08 * pitched_area]
    pitch = sum(s["slope"] * s["area"] for s in sides) / pitched_area
    reading["pitch_deg"] = round(pitch, 1)
    reading["roof_height_m"] = round(max(0.0, top - eave), 2) if math.isfinite(eave) else None
    reading["sides"] = len(big)
    if len(big) == 1:
        reading["roof"] = "skillion"
    elif len(big) == 2 and _opposite(big[0]["az"], big[1]["az"]):
        reading["roof"] = "gabled"
    elif len(big) == 4 and _two_pairs([g["az"] for g in big]):
        reading["roof"] = "hipped"
    else:
        reading["roof"] = "complex"
    return reading


def _angle(a: float, b: float) -> float:
    d = abs(a - b) % 360.0
    return min(d, 360.0 - d)


def _sides(faces: list[dict[str, float]]) -> list[dict[str, float]]:
    """Pitched faces gathered into roof sides by the way they face."""
    groups: list[dict[str, float]] = []
    for f in sorted(faces, key=lambda f: -f["area"]):
        for g in groups:
            if _angle(g["az"], f["az"]) <= SIDE_DEG:
                g["area"] += f["area"]
                break
        else:
            groups.append({"az": f["az"], "area": f["area"]})
    return sorted(groups, key=lambda g: -g["area"])


def _opposite(a: float, b: float) -> bool:
    return _angle(a, b) >= 180.0 - SIDE_DEG


def _two_pairs(azimuths: list[float]) -> bool:
    a = sorted(azimuths)
    pairs = [(i, j) for i in range(4) for j in range(i + 1, 4) if _opposite(a[i], a[j])]
    for i, j in pairs:
        rest = [k for k in range(4) if k not in (i, j)]
        if _opposite(a[rest[0]], a[rest[1]]) and 90.0 - SIDE_DEG <= _angle(a[i], a[rest[0]]) <= 90.0 + SIDE_DEG:
            return True
    return False


# ---- 3dfier: percentiles ------------------------------------------------------------------------

def tdf_reading(row: Mapping[str, Any]) -> dict[str, Any] | None:
    """Height and a flat/pitched verdict from one 3dfier row.

    ``row`` carries the ground's height and the roof's percentiles, as 3dfier's
    CSV-BUILDINGS-MULTIPLE output does: ``ground`` (the ground's 10th percentile) and ``roof-0.10``,
    ``roof-0.25``, ``roof-0.90``, ``roof-0.99`` (metres, one frame)."""
    try:
        ground = float(row["ground"])
        p90 = float(row["roof-0.90"])
    except (KeyError, TypeError, ValueError):
        return None
    if not (math.isfinite(ground) and math.isfinite(p90)):
        return None
    reading: dict[str, Any] = {"height_m": round(p90 - ground, 2)}
    try:
        spread = float(row["roof-0.99"]) - float(row["roof-0.25"])
    except (KeyError, TypeError, ValueError):
        return reading
    reading["roof_spread_m"] = round(spread, 2)
    if spread > max(CANOPY_SPREAD_M, 0.6 * reading["height_m"]):
        return {"rejected": "canopy", "roof_spread_m": round(spread, 2), "p90_m": reading["height_m"]}
    if spread < FLAT_SPREAD_M:
        reading["roof"] = "flat"
    elif spread > PITCHED_SPREAD_M:
        reading["roof"] = "pitched"
        # eave to ridge: the roof's lowest tenth to its top
        try:
            rise = float(row["roof-0.99"]) - float(row["roof-0.10"])
        except (KeyError, TypeError, ValueError):
            rise = spread
        reading["roof_height_m"] = round(rise, 2)
    return reading


# ---- the atlas --------------------------------------------------------------------------------

class GbaIndex:
    """GlobalBuildingAtlas buildings near the regions (scripts/fetch_gba_heights.py): found by the
    OpenStreetMap way they were drawn from, else by the outline that overlaps the footprint most."""

    CELL = 0.002   # degrees, ~200 m

    def __init__(self, rows: Iterable[Mapping[str, Any]], min_overlap: float = 0.5):
        self.by_osm: dict[str, Mapping[str, Any]] = {}
        self.grid: dict[tuple[int, int], list[Mapping[str, Any]]] = {}
        self.min_overlap = min_overlap
        for r in rows:
            if r.get("h") is None:
                continue
            if r.get("src") == "osm":
                self.by_osm[str(r.get("id"))] = r
            p = r.get("p") or []
            if p:
                lon = sum(q[0] for q in p) / len(p)
                lat = sum(q[1] for q in p) / len(p)
                self.grid.setdefault((int(lon // self.CELL), int(lat // self.CELL)), []).append(r)

    def __len__(self) -> int:
        return sum(len(v) for v in self.grid.values())

    def find(self, way: Mapping[str, Any]) -> dict[str, Any] | None:
        osm = way.get("osm_id")
        if osm is not None and str(osm) in self.by_osm:
            r = self.by_osm[str(osm)]
            return {"height_m": round(float(r["h"]), 2), "var": r.get("var"), "match": "osm_id", "key": r.get("k")}
        pts = way.get("points") or []
        if len(pts) < 3:
            return None
        lon = sum(p[0] for p in pts) / len(pts)
        lat = sum(p[1] for p in pts) / len(pts)
        ci, cj = int(lon // self.CELL), int(lat // self.CELL)
        mine = local_ring(pts, lon, lat)
        best, best_iou = None, 0.0
        for i in (ci - 1, ci, ci + 1):
            for j in (cj - 1, cj, cj + 1):
                for r in self.grid.get((i, j), ()):
                    iou = overlap(mine, local_ring(r["p"], lon, lat))
                    if iou > best_iou:
                        best, best_iou = r, iou
        if best is None or best_iou < self.min_overlap:
            return None
        return {"height_m": round(float(best["h"]), 2), "var": best.get("var"), "match": "outline",
                "overlap": round(best_iou, 3), "key": best.get("k")}


def overlap(a: list[tuple[float, float]], b: list[tuple[float, float]], step: float = 0.5) -> float:
    """Intersection over union of two outlines in metres, by sampling a grid over the smaller box."""
    if len(a) < 3 or len(b) < 3:
        return 0.0
    ax0, ax1 = min(p[0] for p in a), max(p[0] for p in a)
    ay0, ay1 = min(p[1] for p in a), max(p[1] for p in a)
    bx0, bx1 = min(p[0] for p in b), max(p[0] for p in b)
    by0, by1 = min(p[1] for p in b), max(p[1] for p in b)
    x0, x1, y0, y1 = max(ax0, bx0), min(ax1, bx1), max(ay0, by0), min(ay1, by1)
    if x0 >= x1 or y0 >= y1:
        return 0.0
    span = max(x1 - x0, y1 - y0)
    step = max(step, span / 60.0)
    inter = 0
    y = y0 + step / 2
    while y < y1:
        x = x0 + step / 2
        while x < x1:
            if _inside(a, x, y) and _inside(b, x, y):
                inter += 1
            x += step
        y += step
    inter_area = inter * step * step
    union = ring_area(a) + ring_area(b) - inter_area
    return inter_area / union if union > 0 else 0.0


def _inside(ring: list[tuple[float, float]], x: float, y: float) -> bool:
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-12) + xi:
            inside = not inside
        j = i
    return inside


# ---- filling ------------------------------------------------------------------------------------

def fillable(way: Mapping[str, Any]) -> bool:
    return way.get("kind") == "building" and (way.get("height_source") in FILLABLE or way.get("height_m") in (None, 0))


def fill_height(way: dict[str, Any], readings: Mapping[str, Mapping[str, Any]], gba: GbaIndex | None = None) -> str | None:
    """Give ``way`` the first plausible height in RANK order; say which source, or None."""
    if not fillable(way):
        return None
    key = str(way.get("osm_id"))
    area = ring_area(local_ring(way.get("points") or []))
    for name in RANK:
        found = gba.find(way) if (name == "gba" and gba is not None) else (readings.get(name) or {}).get(key)
        if not found or found.get("height_m") is None:
            continue
        h = float(found["height_m"])
        if not plausible(h, area):
            continue
        way["height_m"] = round(h, 2)
        way["height_source"] = SOURCE[name]
        if name in LICENCE:
            way["height_licence"] = LICENCE[name]
        return name
    return None


def fill_heights(ways: Iterable[dict[str, Any]], readings: Mapping[str, Mapping[str, Any]], gba: GbaIndex | None = None) -> dict[str, int]:
    """Fill every fillable building; count what each source gave and what was left."""
    counts = {"city3d": 0, "3dfier": 0, "gba": 0, "unfilled": 0}
    for way in ways:
        if not fillable(way):
            continue
        got = fill_height(way, readings, gba)
        counts[got or "unfilled"] += 1
    return counts


#: Roof names as OpenStreetMap writes them, for the page (roof:shape).
OSM_ROOF = {"flat": "flat", "skillion": "skillion", "gabled": "gabled", "hipped": "hipped"}


def roof_entry(name: str, reading: Mapping[str, Any], height_m: float | None) -> dict[str, Any] | None:
    """A roof the page can draw from one source's reading, or None. City3D's pitched shapes are
    drawn as read; a 3dfier "pitched" is drawn hipped -- the shape measure_roof_shapes.py found
    closest to pitched roofs it could not tell apart -- and flat roofs are not published (the page
    draws flat already)."""
    roof = reading.get("roof")
    if name == "3dfier" and roof == "pitched":
        roof = "hipped"
    if roof not in ("skillion", "gabled", "hipped"):
        return None
    rh = float(reading.get("roof_height_m") or 0)
    if height_m:
        rh = min(rh, 0.5 * float(height_m))
    if rh < 0.8:
        return None
    out = {"roof": OSM_ROOF[roof], "roof_height_m": round(rh, 2), "source": SOURCE[name]}
    if reading.get("pitch_deg") is not None:
        out["pitch_deg"] = reading["pitch_deg"]
    return out
