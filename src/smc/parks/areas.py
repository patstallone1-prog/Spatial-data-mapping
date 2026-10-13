"""Recreation areas inside parks, ready to be furnished: playgrounds, dog areas, picnic, gardens.

RPD's Facilities and Functional Areas say *that* a playground (or dog area, picnic area,
community garden, fitness area, skatepark) exists and give its polygon. OpenStreetMap adds
playgrounds outside RPD's inventory, mapped equipment, gates and picnic tables. Each area
records which claims are evidence and which are visual priors: the equipment layout inside an
RPD playground is a fill, not a survey, unless OpenStreetMap mapped the pieces.

The gate is placed where people actually reach the area: a mapped gate on the boundary, else
where a pedestrian way crosses or meets the boundary, else the boundary point nearest a path.
"""

from __future__ import annotations

import hashlib
import math
from itertools import pairwise

from smc.geo import Origin
from smc.parks.enrichment import box, coverage, inside, overlaps, rings

AREA_KINDS = {
    "Children's Play Area": "playground",
    "Childrens Play Area": "playground",
    "Dog Play Area": "dog_area",
    "Picnic Area": "picnic",
    "Table Seating Area": "picnic",
    "Community Garden": "garden",
    "Adult Fitness Area": "fitness",
    "Adult Fitness Court/Course": "fitness",
    "Skatepark": "skatepark",
}
OSM_KINDS = {"playground": "playground", "dog_park": "dog_area"}
#: Fenced unless evidence says otherwise: SF playgrounds and community gardens are enclosed
#: (a fence is how a playground keeps toddlers in). Dog areas, picnic and fitness areas are not
#: assumed fenced.
FENCED = {"playground": 1.2, "garden": 1.5}
AGE = {"Pre-School 2 - 5 years": "2-5", "Youth 5 - 12 years": "5-12"}
EQUIPMENT = {
    "slide": "slide", "swing": "swing", "basketswing": "swing", "climbingframe": "climber",
    "structure": "structure", "springy": "spring_rider", "seesaw": "seesaw", "sandpit": "sandpit",
    "roundabout": "spinner", "climbingwall": "climber", "playhouse": "playhouse",
    "zipwire": "zipline", "balancebeam": "balance", "rope_traverse": "climber",
}


def _frame(points: list) -> tuple[Origin, callable, callable]:
    origin = Origin(points[0][1], points[0][0])

    def to(p):
        return ((p[0] - origin.lon) * origin.metres_per_degree_lon,
                (p[1] - origin.lat) * origin.metres_per_degree_lat)

    def back(x, y):
        return [round(origin.lon + x / origin.metres_per_degree_lon, 7),
                round(origin.lat + y / origin.metres_per_degree_lat, 7)]

    return origin, to, back


def _closest_on_ring(ring_xy: list, p) -> tuple[float, tuple, int]:
    best = (math.inf, None, -1)
    for i, (a, b) in enumerate(pairwise(ring_xy)):
        dx, dy = b[0] - a[0], b[1] - a[1]
        l2 = dx * dx + dy * dy or 1e-9
        t = max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2))
        q = (a[0] + t * dx, a[1] + t * dy)
        d = math.hypot(p[0] - q[0], p[1] - q[1])
        if d < best[0]:
            best = (d, q, i)
    return best


def _cross(a, b, c, d):
    """Where segment ab crosses segment cd, or None."""
    r = (b[0] - a[0], b[1] - a[1])
    s = (d[0] - c[0], d[1] - c[1])
    den = r[0] * s[1] - r[1] * s[0]
    if abs(den) < 1e-9:
        return None
    t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den
    u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den
    if 0 <= t <= 1 and 0 <= u <= 1:
        return (a[0] + t * r[0], a[1] + t * r[1])
    return None


def place_gates(ring: list, pedestrian: list[list], gates: list[list], *, limit: int = 2,
                reach_m: float = 30.0) -> list[dict]:
    """Entrances on the boundary, from the strongest evidence available."""
    _, to, back = _frame(ring)
    ring_xy = [to(p) for p in ring]
    if ring_xy[0] != ring_xy[-1]:
        ring_xy.append(ring_xy[0])
    found: list[dict] = []

    def add(q, basis, confidence):
        if q is None or any(math.hypot(q[0] - g["_xy"][0], q[1] - g["_xy"][1]) < 8 for g in found):
            return
        found.append({"_xy": q, "p": back(*q), "basis": basis, "confidence": confidence,
                      "width_m": 1.2})

    for gate in gates:
        d, q, _ = _closest_on_ring(ring_xy, to(gate))
        if d <= 3.0:
            add(q, "osm_gate_node", 0.85)
    if not found:
        for way in pedestrian:
            way_xy = [to(p) for p in way]
            for a, b in pairwise(way_xy):
                for c, e in pairwise(ring_xy):
                    add(_cross(a, b, c, e), "pedestrian_way_crosses_boundary", 0.6)
    if not found:
        best = (math.inf, None)
        for way in pedestrian:
            for p in way:
                xy = to(p)
                if inside(xy, ring_xy):
                    continue
                d, q, _ = _closest_on_ring(ring_xy, xy)
                if d < best[0]:
                    best = (d, q)
        if best[0] <= reach_m:
            add(best[1], "nearest_pedestrian_approach", 0.4)
    for gate in found:
        _, _, edge = _closest_on_ring(ring_xy, gate["_xy"])
        a, b = ring_xy[edge], ring_xy[edge + 1]
        gate["edge"] = edge
        gate["yaw_basis"] = "boundary_edge"
        gate["along"] = [round(b[0] - a[0], 3), round(b[1] - a[1], 3)]
        del gate["_xy"]
    return found[:limit]


def _seed(identity: str) -> int:
    return int(hashlib.sha256(identity.encode()).hexdigest()[:8], 16)


def _outer_rings(geometry) -> list[list]:
    return [polygon for polygon in rings(geometry) if polygon and len(polygon[0]) >= 4]


def build_areas(inventory: dict, world: dict, osm: dict, pages: dict | None = None) -> list[dict]:
    bbox = world["bbox"]
    bounds = tuple(bbox[k] for k in ("west", "south", "east", "north"))
    pedestrian = [w["points"] for w in world["ways"]
                  if w.get("kind") in {"path", "sidewalk", "crossing"} and len(w.get("points", [])) > 1]
    ped_boxes = [(box(p), p) for p in pedestrian]
    features = osm.get("features", [])
    gates = [f["p"] for f in features if f["tags"].get("barrier") in {"gate", "entrance", "kissing_gate"}
             and isinstance(f["p"][0], float)]
    equipment = [f for f in features if f["tags"].get("playground")]
    tables = [f["p"] for f in features if f["tags"].get("leisure") == "picnic_table"
              and isinstance(f["p"][0], float)]
    areas: list[dict] = []

    rpd = []
    for obj in inventory["objects"]:
        kind = AREA_KINDS.get(obj["kind"])
        if not kind or obj.get("semantic_confidence", 0) == 0:
            continue
        for part in obj["parts"]:
            for polygon in _outer_rings(part["geometry"]):
                if overlaps(box(polygon[0]), bounds):
                    rpd.append((kind, obj, part, polygon))
    # A facility polygon is the whole playground; functional areas inside it are its age zones.
    facilities = [r for r in rpd if r[1]["id"].startswith("rpd:facility:")]
    functional = [r for r in rpd if r[1]["id"].startswith("rpd:functional_area:")]
    for kind, obj, part, polygon in facilities:
        zones = [f for f in functional if f[0] == kind and coverage(f[3][0], polygon[0]) >= 0.5]
        areas.append(_area(kind, obj, part, polygon, zones, "sf_rpd_facilities", pages))
    for kind, obj, part, polygon in functional:
        if any(f[0] == kind and coverage(polygon[0], f[3][0]) >= 0.5 for f in facilities):
            continue
        areas.append(_area(kind, obj, part, polygon, [], "sf_rpd_functional_areas", pages))

    for context in osm.get("contexts", []):
        kind = OSM_KINDS.get(context.get("tags", {}).get("leisure"))
        geometry = [[g["lon"], g["lat"]] for g in context.get("geometry", [])]
        if not kind or len(geometry) < 4 or geometry[0] != geometry[-1]:
            continue
        if any(a["kind"] == kind and (coverage(geometry, a["p"]) >= 0.3 or coverage(a["p"], geometry) >= 0.3)
               for a in areas):
            continue
        identity = f"osm:way:{context['id']}"
        tags = context.get("tags", {})
        areas.append({
            "id": identity, "kind": kind, "name": tags.get("name"), "park_id": None,
            "p": geometry, "holes": [], "source": "openstreetmap", "license": "ODbL",
            "semantic_confidence": 0.85, "geometry_confidence": 0.75, "zones": [],
            "surface": {"material": tags.get("surface") or "unknown",
                        "basis": "osm_surface" if tags.get("surface") else "visual_prior"},
            "fence": ({"height_m": FENCED.get(kind, 1.5), "basis": "osm_barrier_tag"}
                      if tags.get("barrier") == "fence" else
                      {"height_m": FENCED[kind], "basis": "visual_prior_enclosed_playground"}
                      if kind in FENCED else None),
        })

    for area in areas:
        ring = area["p"]
        b = box(ring)
        pad = 0.0004
        near = [p for bb, p in ped_boxes if overlaps(bb, (b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad))]
        on = [g for g in gates if b[0] - pad <= g[0] <= b[2] + pad and b[1] - pad <= g[1] <= b[3] + pad]
        area["gates"] = place_gates(ring, near, on) if area.get("fence") else []
        _, to, _ = _frame(ring)
        ring_xy = [to(p) for p in ring]
        area["equipment"] = [
            {"kind": EQUIPMENT.get(f["tags"]["playground"], "structure"), "id": f["id"],
             "p": f["p"], "basis": "osm_playground_feature"}
            for f in equipment
            if isinstance(f["p"][0], float) and inside(to(f["p"]), ring_xy)
        ] if area["kind"] == "playground" else []
        area["tables"] = [p for p in tables if inside(to(p), ring_xy)] if area["kind"] == "picnic" else []
        area["seed"] = _seed(area["id"])
        area["area_m2"] = round(abs(sum(a[0] * c[1] - c[0] * a[1] for a, c in pairwise(ring_xy))) / 2, 1)
    return [a for a in areas if a["area_m2"] >= 12]


def _area(kind, obj, part, polygon, zones, source, pages) -> dict:
    page = (pages or {}).get(obj["park_id"], {})
    features = set(page.get("features", []))
    sand = kind == "playground" and "wet_sand_play_sculpture" in features
    return {
        "id": f"{obj['id']}:part:{part['id']}",
        "kind": kind,
        "name": obj.get("name"),
        "park_id": obj.get("park_id"),
        "p": polygon[0],
        "holes": polygon[1:],
        "source": source,
        "license": "PDDL",
        "semantic_confidence": obj["semantic_confidence"],
        "geometry_confidence": obj["geometry_confidence"],
        "age": AGE.get(obj.get("subtype") or ""),
        "zones": [{"p": z[3][0], "age": AGE.get(z[1].get("subtype") or "")} for z in zones],
        "surface": {"material": "unknown", "basis": "visual_prior"},
        # The official page names a sand play area; it says nothing about where in the park.
        "sand_play": {"basis": "official_facility_page", "source_url": page.get("source_url")} if sand else None,
        "fence": {"height_m": FENCED[kind], "basis": "visual_prior_enclosed_" + kind} if kind in FENCED else None,
        "provenance": part["provenance"],
    }
