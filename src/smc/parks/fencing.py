"""Which properties have a fence on their line, which are open, and which are only a building.

A property line is not a fence. Whether one stands on it depends on what the property is:

* a school (and a nursery) is fenced round its yard -- the open ground of a campus is closed to
  the street even where no building stands on it;
* a reservoir, a pump station, a corporation or transit yard is fenced, and higher;
* a park is open unless a fence was surveyed on it: the Recreation and Parks Department records
  its fences and gates as lines (DataSF rny7-88gk) and OpenStreetMap maps others, so a park has a
  fence on exactly the sides one was recorded on (Moscone has one along Chestnut and none on
  Laguna) and no side is guessed;
* a car park is decided lot by lot: a mapped fence is drawn as mapped; with none, a lot that is
  private, permit-only or closed to the public is fenced and one for customers or the public is
  open;
* a fire station, a library, a police station, housing: the building is the barrier and its
  line has no fence (``building_only``).

``classify`` returns the verdict and what it rests on; ``assemble`` joins the evidence lines and
gates to the properties. Nothing here places an inferred gate: that is done where the fence is
drawn (docs/property-fences.mjs), against the buildings and streets actually standing there.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass

from shapely.geometry import LineString, MultiPolygon, Point, Polygon, shape
from shapely.ops import unary_union
from shapely.strtree import STRtree

#: Local metres about San Francisco (the tree survey's frame: tools/build_sf_tree_survey.py).
LON0, LAT0 = -122.45, 37.76
KX, KY = 111320 * math.cos(math.radians(LAT0)), 111320.0

FENCED, EVIDENCE, OPEN, BUILDING_ONLY = "fenced", "evidence", "open", "building_only"

#: Heights (m) and what the fence is made of, by kind. A school's is the six-foot chain link (or
#: bars) of an SFUSD yard; a utility's is eight foot.
STYLE = {
    "school": ("chain_link", 1.83),
    "nursery": ("picket", 1.22),
    "utility": ("chain_link", 2.44),
    "yard": ("chain_link", 2.44),
    "parking": ("chain_link", 1.83),
    "park": ("rail", 1.07),
    "cemetery": ("bars", 1.83),
}
#: What an evidence line is drawn as, from its recorded type.
EVIDENCE_STYLE = {
    "chain link": "chain_link", "chain_link": "chain_link", "chain_link:barber_wire": "chain_link",
    "metal": "bars", "bars": "bars", "metal_bars": "bars", "railing": "rail", "split rail": "split_rail",
    "post_and_rail": "split_rail", "pole": "split_rail", "wooden": "board", "wood": "board",
    "greenscreen": "chain_link", "wall": "wall", "hedge": "hedge",
}
EVIDENCE_HEIGHT = {"chain_link": 1.83, "bars": 1.5, "rail": 1.07, "split_rail": 1.0, "board": 1.8, "wall": 1.2, "hedge": 1.2}

_SCHOOL = re.compile(r"\b(SCHOOL|ELEMENTARY|ACADEMY|HIGH|MIDDLE|K-8|CHILD|CDC|PRE-?K|EARLY ED|E\.?E\.?S|H\.?S\.?|M\.?S\.?|E\.?S\.?)\b", re.I)
_UTILITY = re.compile(r"\b(RESERVOIR|PUMP|SUBSTATION|TANK|TREATMENT|PLANT|WELL|VALVE)\b", re.I)
_YARD = re.compile(r"\b(YARD|CORPORATION|DIVISION|DEPOT|BARN|SHOPS?|MAINTENANCE|TOW|IMPOUND|STORAGE)\b", re.I)
_LOT = re.compile(r"\b(PARKING|LOT|GARAGE)\b", re.I)
#: City departments whose land is its building: nothing on the line.
_BUILDINGS = {"Fire", "Police", "Public Library", "Health", "Public Health", "SFHA", "Real Estate", "Mayor", "OCII - Former SFRA"}


@dataclass(frozen=True)
class Verdict:
    kind: str
    verdict: str
    basis: str
    style: str | None = None
    height_m: float | None = None


def _styled(kind: str, verdict: str, basis: str) -> Verdict:
    style, height = STYLE.get(kind, (None, None))
    return Verdict(kind, verdict, basis, style if verdict == FENCED else None, height if verdict == FENCED else None)


def classify(source: str, *, category: str = "", name: str = "", tags: dict | None = None) -> Verdict:
    """The verdict for one property.

    ``source`` is where the property comes from: ``city_land`` (DataSF City Lands, with its
    ``category`` and ``name``), ``school`` (a school's own parcel), ``osm`` (with its ``tags``),
    ``land_use_parking`` (the Planning land-use parcels flagged as a car park).
    """
    tags = tags or {}
    if source == "school":
        return _styled("school", FENCED, "school_campus")
    if source == "land_use_parking":
        return _styled("parking", OPEN, "car_park_unrecorded_access")
    if source == "osm":
        amenity = tags.get("amenity")
        if amenity == "school":
            return _styled("school", FENCED, "school_campus")
        if amenity in {"kindergarten", "childcare"}:
            return _styled("nursery", FENCED, "nursery_yard")
        if amenity == "parking":
            if tags.get("parking") in {"multi-storey", "underground", "rooftop", "street_side", "lane", "layby", "carports", "garage_boxes"}:
                return Verdict("parking", BUILDING_ONLY, "not_a_surface_lot")
            access = tags.get("access")
            if access in {"private", "permit", "no", "residents", "employees"}:
                return _styled("parking", FENCED, f"car_park_access_{access}")
            return _styled("parking", OPEN, f"car_park_access_{access or 'unrecorded'}")
        if tags.get("landuse") == "cemetery":
            return _styled("cemetery", FENCED, "cemetery")
        return Verdict("other", OPEN, "unclassified")
    if source == "city_land":
        if category == "Unified School District":
            # (The district's offices and warehouses are buildings, not yards.)
            return _styled("school", FENCED, "sfusd_campus") if _SCHOOL.search(name) else Verdict("civic", BUILDING_ONLY, "sfusd_non_campus")
        if category == "Recreation & Park":
            return Verdict("park", EVIDENCE, "park_fenced_only_where_surveyed")
        if category.startswith("PUC"):
            return _styled("utility", FENCED, "utility_site") if _UTILITY.search(name) else Verdict("utility", OPEN, "utility_land_unnamed_use")
        if category in {"MTA", "Public Works"}:
            if _YARD.search(name):
                return _styled("yard", FENCED, "works_or_transit_yard")
            if _LOT.search(name):
                return _styled("parking", OPEN, "public_car_park")
            return Verdict("civic", OPEN if category == "Public Works" else BUILDING_ONLY, "city_land_no_yard_named")
        if category == "Port":
            return Verdict("port", OPEN, "port_land")
        if category in _BUILDINGS:
            return Verdict("civic", BUILDING_ONLY, "public_building")
        return Verdict("civic", OPEN, "city_land_other")
    raise ValueError(f"unknown source {source!r}")


def to_xy(p) -> tuple[float, float]:
    return ((p[0] - LON0) * KX, (p[1] - LAT0) * KY)


def to_lonlat(x: float, y: float) -> list[float]:
    return [round(LON0 + x / KX, 7), round(LAT0 + y / KY, 7)]


def polygon_xy(geometry: dict) -> Polygon | None:
    """The largest polygon of a GeoJSON geometry, in local metres (None if it has none)."""
    try:
        g = shape(geometry)
    except Exception:  # noqa: BLE001 - a malformed record is skipped, not fatal
        return None
    parts = list(g.geoms) if isinstance(g, MultiPolygon) else [g] if isinstance(g, Polygon) else []
    best = None
    for part in parts:
        local = Polygon([to_xy(p) for p in part.exterior.coords])
        if not local.is_valid:
            local = local.buffer(0)
            if isinstance(local, MultiPolygon):
                local = max(local.geoms, key=lambda q: q.area)
        if local.is_empty or local.area < 30:
            continue
        if best is None or local.area > best.area:
            best = local
    return best


def lines_xy(geometry: dict) -> list[LineString]:
    kind, coords = geometry.get("type"), geometry.get("coordinates") or []
    parts = [coords] if kind == "LineString" else coords if kind == "MultiLineString" else []
    out = []
    for part in parts:
        pts = [to_xy(p) for p in part]
        if len(pts) >= 2 and LineString(pts).length > 0.3:
            out.append(LineString(pts))
    return out


#: An evidence line this near a property's own line is that property's fence (m).
ON_LINE_M = 3.0
#: A gate this near a fence (the property's line or an evidence line) belongs to it (m).
GATE_NEAR_M = 4.0
#: Of a car park's line, how much a mapped fence must follow for the lot to be drawn as mapped.
LOT_EVIDENCE_SHARE = 0.25


def assemble(properties: list[dict], fences: list[dict], gates: list[dict]) -> list[dict]:
    """Join evidence to properties.

    ``properties``: ``{"id", "name", "verdict": Verdict, "polygon": Polygon, "source"}``.
    ``fences``: ``{"line": LineString, "style", "height_m", "src"}``; ``gates``: ``{"point":
    Point, "width_m", "src"}``. Returns the records the page reads (lon/lat), largest first so a
    campus is settled before a car park inside it.
    """
    lines = [f["line"] for f in fences]
    line_tree = STRtree(lines) if lines else None
    gate_tree = STRtree([g["point"] for g in gates]) if gates else None
    out, taken, used = [], [], set()
    for prop in sorted(properties, key=lambda p: -p["polygon"].area):
        poly, v = prop["polygon"], prop["verdict"]
        # (A car park or a nursery inside a campus already settled is part of it.)
        if any(t.contains(poly.representative_point()) and t.area > poly.area for t in taken) and v.kind in {"parking", "nursery", "other", "civic"}:
            continue
        # (A fence between two properties is drawn once, with the first -- the larger -- of them.)
        near = [fences[i] for i in (line_tree.query(poly.buffer(ON_LINE_M)) if line_tree is not None else [])
                if fences[i]["src"] not in used and fences[i]["line"].intersection(poly.buffer(ON_LINE_M)).length > max(1.0, 0.5 * fences[i]["line"].length)]
        boundary = poly.exterior
        on_line = [f for f in near if f["line"].interpolate(0.5, normalized=True).distance(boundary) <= ON_LINE_M]
        inside = [f for f in near if f not in on_line]
        verdict, basis, style, height = v.verdict, v.basis, v.style, v.height_m
        runs = []
        if v.kind == "parking" and verdict != BUILDING_ONLY:
            covered = sum(f["line"].length for f in on_line)
            if covered >= LOT_EVIDENCE_SHARE * boundary.length:
                verdict, basis = EVIDENCE, "car_park_fence_as_mapped"
        if verdict == EVIDENCE:
            runs = near
        elif verdict == FENCED:
            # The line itself is drawn; a recorded fence on it only says what it is made of.
            typed = [f for f in on_line if f.get("style")]
            if typed:
                best = max(typed, key=lambda f: f["line"].length)
                style, height = best["style"], best.get("height_m") or height
                basis += "+recorded_fence_type"
            runs = inside
        if verdict == EVIDENCE and not runs:
            verdict = OPEN
        record = {
            "id": prop["id"], "name": prop.get("name") or "", "kind": v.kind, "verdict": verdict, "basis": basis, "source": prop["source"],
            "ring": [to_lonlat(x, y) for x, y in poly.exterior.simplify(0.3).coords],
        }
        if style:
            record["fence"] = {"style": style, "height_m": height}
        used.update(f["src"] for f in runs)
        if runs:
            record["runs"] = [{"p": [to_lonlat(x, y) for x, y in f["line"].simplify(0.2).coords], "style": f.get("style") or "chain_link",
                               "height_m": f.get("height_m") or EVIDENCE_HEIGHT.get(f.get("style") or "chain_link", 1.5), "src": f["src"]} for f in runs]
        if verdict in {FENCED, EVIDENCE} and gate_tree is not None:
            reach = unary_union([boundary] + [f["line"] for f in runs]) if verdict == FENCED else unary_union([f["line"] for f in runs])
            found = [gates[i] for i in gate_tree.query(reach.buffer(GATE_NEAR_M)) if gates[i]["point"].distance(reach) <= GATE_NEAR_M]
            if found:
                record["gates"] = [{"p": to_lonlat(g["point"].x, g["point"].y), "width_m": round(g.get("width_m") or 1.2, 2), "src": g["src"]} for g in found]
        if verdict in {FENCED, EVIDENCE}:
            taken.append(poly)
        out.append(record)
    return out


def evidence_style(*names: str | None) -> str | None:
    for name in names:
        style = EVIDENCE_STYLE.get((name or "").strip().lower())
        if style:
            return style
    return None


def point_xy(lon: float, lat: float) -> Point:
    return Point(*to_xy((lon, lat)))
