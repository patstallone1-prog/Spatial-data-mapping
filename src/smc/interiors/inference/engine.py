"""Compose partition, openings, multi-floor stairs, materials, furniture and validation."""

from __future__ import annotations

import copy
import math
from itertools import combinations, pairwise

from shapely.geometry import LineString, Point, Polygon, box, shape
from shapely.ops import nearest_points, unary_union

from smc.interiors.inference.catalog import Catalog
from smc.interiors.inference.furnish import RoomFurnisher
from smc.interiors.inference.model import HouseInput, geo, stamp_inference
from smc.interiors.inference.partition import lines, partition_candidates, shared, width
from smc.interiors.inference.style import house_style, room_materials

PRIVATE = {"bedroom", "primary_bedroom", "full_bathroom", "toilet", "office"}
PUBLIC = {"living", "kitchen", "dining", "hallway"}
OPENING_TYPES = ("full_access", "partial_cabinet", "single_door", "double_door", "doorway")


def closet_split(room: dict) -> list[dict]:
    if "bedroom" not in room["kind"] or room["shape"].area < 13:
        return [room]
    p = room["shape"]
    x0, y0, x1, y1 = p.bounds
    # In the room's own dominant frame, try a built-in storage bay at each end.
    from shapely import affinity

    rect = list(p.minimum_rotated_rectangle.exterior.coords)
    a, b = max(pairwise(rect), key=lambda ab: math.dist(*ab))
    angle = math.degrees(math.atan2(b[1] - a[1], b[0] - a[0]))
    origin = p.centroid.coords[0]
    local = affinity.rotate(p, -angle, origin=origin)
    x0, y0, x1, y1 = local.bounds
    for cut in (
        box(x0 - 1, y0 - 1, x0 + 0.95, y1 + 1),
        box(x1 - 0.95, y0 - 1, x1 + 1, y1 + 1),
        box(x0 - 1, y0 - 1, x1 + 1, y0 + 0.95),
        box(x0 - 1, y1 - 0.95, x1 + 1, y1 + 1),
    ):
        storage, bed = local.intersection(cut), local.difference(cut)
        if (
            storage.geom_type != "Polygon"
            or bed.geom_type != "Polygon"
            or bed.area < 11.5
            or width(bed) < 2.9
            or not 1.5 <= storage.area <= 5
        ):
            continue
        storage = affinity.rotate(storage, angle, origin=origin)
        bed = affinity.rotate(bed, angle, origin=origin)
        # Do not take away the bedroom's access to circulation.
        if shared(bed, room["hall"]).length < 0.9:
            continue
        return [
            {**room, "shape": bed},
            {
                "id": room["id"] + ":closet",
                "kind": "closet",
                "shape": storage,
                "parent_room": room["id"],
            },
        ]
    return [room]


def trim_wet_room(room: dict) -> list[dict]:
    """Use excess bathroom area for storage/laundry instead of oversized WC chambers."""
    if room["kind"] not in {"toilet", "full_bathroom"}:
        return [room]
    p = room["shape"]
    target = 5.2 if room["kind"] == "toilet" else 8.0
    if p.area < target + 4:
        return [room]
    from shapely import affinity

    rect = list(p.minimum_rotated_rectangle.exterior.coords)
    a, b = max(pairwise(rect), key=lambda ab: math.dist(*ab))
    angle = math.degrees(math.atan2(b[1] - a[1], b[0] - a[0]))
    origin = p.centroid.coords[0]
    local = affinity.rotate(p, -angle, origin=origin)
    x0, y0, x1, y1 = local.bounds
    candidates = []
    for f in (target / p.area, 1 - target / p.area):
        for cut in (
            box(x0 - 1, y0 - 1, x0 + (x1 - x0) * f, y1 + 1),
            box(x0 - 1, y0 - 1, x1 + 1, y0 + (y1 - y0) * f),
        ):
            parts = [local.intersection(cut), local.difference(cut)]
            parts.sort(key=lambda q: abs(q.area - target))
            wet, surplus = parts
            if (
                wet.geom_type != "Polygon"
                or surplus.geom_type != "Polygon"
                or wet.area < target * 0.85
                or surplus.area < 2
                or width(wet) < 1.8
            ):
                continue
            wet, surplus = (affinity.rotate(q, angle, origin=origin) for q in parts)
            if shared(wet, room["hall"]).length < 0.96:
                continue
            candidates.append((abs(wet.area - target), wet, surplus))
    if not candidates:
        return [room]
    _, wet, surplus = min(candidates, key=lambda c: c[0])
    extra = {"id": room["id"] + ":storage", "shape": surplus}
    if shared(surplus, room["hall"]).length >= 1.05:
        extra["kind"] = "utility"
    else:
        extra |= {"kind": "closet", "parent_room": room["id"]}
    return [{**room, "shape": wet}, extra]


def opening(
    a: dict, b: dict | None, line: LineString, kind: str, index: int, width_m: float | None = None
) -> dict:
    c = line.interpolate(0.5, normalized=True)
    x, y = next(iter(line.coords)), list(line.coords)[-1]
    length = math.dist(x, y)
    use = min(length - 0.08, width_m) if width_m is not None else length
    ux, uy = (y[0] - x[0]) / length, (y[1] - x[1]) / length
    segment = LineString(
        [(c.x - ux * use / 2, c.y - uy * use / 2), (c.x + ux * use / 2, c.y + uy * use / 2)]
    )
    leaf = kind in {"single_door", "double_door"}
    return {
        "id": f"{a['id']}:opening:{index}",
        "rooms": [a["id"], b["id"] if b else "outside"],
        "type": kind,
        "segment": geo(segment),
        "width_m": use,
        "height_m": 2.1,
        "leaf_count": (2 if kind == "double_door" else 1) if leaf else 0,
        "material": "painted_timber" if leaf else None,
        "swing_into": a["id"] if leaf else None,
        "clearance": geo(
            segment.buffer(0.72, cap_style=2)
            if leaf
            else segment.interpolate(0.5, normalized=True).buffer(0.30)
        ),
        "grade": "inferred",
    }


def connect(rooms: list[dict], footprint, entrance, level: int, stair_access=None) -> list[dict]:
    connections = []
    hall = next(r for r in rooms if r["kind"] == "hallway")
    for room in rooms:
        if room is hall:
            continue
        if room["kind"] in PRIVATE | {"utility", "stair"}:
            edges = lines(shared(room["shape"], hall["shape"]))
            edges = [e for e in edges if e.length >= 0.96]
            if not edges:
                raise ValueError(f"{room['id']}: no doorway from hallway")
            line = (
                stair_access
                if room["kind"] == "stair" and stair_access is not None
                else max(edges, key=lambda e: e.length)
            )
            kind = (
                "full_access"
                if room["kind"] == "stair"
                else "single_door"
                if room["kind"] in PRIVATE
                else "doorway"
            )
            connections.append(
                opening(
                    room,
                    hall,
                    line,
                    kind,
                    len(connections),
                    None if room["kind"] == "stair" else 0.88 if kind == "single_door" else 1.05,
                )
            )
        elif room["kind"] == "closet":
            parent = next(r for r in rooms if r["id"] == room["parent_room"])
            line = max(lines(shared(room["shape"], parent["shape"])), key=lambda e: e.length)
            connections.append(opening(room, parent, line, "full_access", len(connections), 1.2))
    for a, b in combinations([r for r in rooms if r["kind"] in PUBLIC], 2):
        for line in lines(shared(a["shape"], b["shape"])):
            if line.length > 0.9:
                connections.append(opening(a, b, line, "full_access", len(connections)))
    if level == 0:
        candidates = [r for r in rooms if r["kind"] in PUBLIC]
        if entrance is not None:
            room = min(candidates, key=lambda r: r["shape"].distance(Point(entrance)))
            if room["shape"].distance(Point(entrance)) > 0.35:
                raise ValueError("entrance would open into a private room")
            # Door is cut on the inset wall; it stays aligned with the supplied exterior point.
            boundary = room["shape"].boundary
            near = nearest_points(boundary, Point(entrance))[0]
            edges = [
                LineString([a, b])
                for a, b in zip(
                    list(room["shape"].exterior.coords)[:-1],
                    list(room["shape"].exterior.coords)[1:],
                    strict=True,
                )
            ]
            edge = min(edges, key=lambda e: e.distance(near))
            t = max(0.55, min(edge.length - 0.55, edge.project(near)))
            line = LineString([edge.interpolate(t - 0.52), edge.interpolate(t + 0.52)])
        else:
            choices = [
                (line.length, r, line)
                for r in candidates
                for line in lines(shared(r["shape"], footprint))
                if line.length > 1.3
            ]
            if not choices:
                raise ValueError("no exterior entrance for public space")
            _, room, line = max(choices, key=lambda row: row[0])
        door = opening(room, None, line, "single_door", len(connections), 1.0)
        door["entrance"] = True
        connections.append(door)
    return connections


def stairs(
    core: Polygon, hall, elevation: float, height: float, level: int, access_line=None
) -> dict:
    line = (
        access_line
        if access_line is not None
        else max(lines(shared(core, hall)), key=lambda e: e.length)
    )
    a, b = next(iter(line.coords)), list(line.coords)[-1]
    c = line.interpolate(0.5, normalized=True)
    ux, uy = (b[0] - a[0]) / line.length, (b[1] - a[1]) / line.length
    nx, ny = -uy, ux
    if not core.covers(Point(c.x + nx * 0.2, c.y + ny * 0.2)):
        nx, ny = -nx, -ny

    def rect(u0, v0, u1, v1):
        return Polygon(
            [
                (c.x + ux * u + nx * v, c.y + uy * u + ny * v)
                for u, v in ((u0, v0), (u1, v0), (u1, v1), (u0, v1))
            ]
        )

    depth = core.area / line.length
    count = math.ceil(height / 0.18)
    first = math.ceil(count / 2)
    second = count - first
    run = depth - 1.12
    steps = []
    for i in range(first):
        steps.append(
            {
                "footprint": geo(rect(-1.10, i * run / first, -0.06, (i + 1) * run / first)),
                "top_m": elevation + height / count * (i + 1),
            }
        )
    steps.append(
        {
            "footprint": geo(rect(-1.10, run, 1.10, depth)),
            "top_m": elevation + height / count * first,
        }
    )
    for i in range(second):
        steps.append(
            {
                "footprint": geo(
                    rect(0.06, run - (i + 1) * run / second, 1.10, run - i * run / second)
                ),
                "top_m": elevation + height / count * (first + i + 1),
            }
        )
    return {
        "id": f"stair:{level}:{level + 1}",
        "from_level": level,
        "to_level": level + 1,
        "footprint": geo(core),
        "slab_opening": geo(core),
        "steps": steps,
        "rise_m": height / count,
        "riser_count": count,
        "access_segment": geo(line),
        "flight_width_m": 1.04,
        "tread_m": min(run / first, run / second),
        "landing_depth_m": 1.12,
        "headroom_m": height - 0.15,
        "grade": "inferred",
        "guard_segment": geo(LineString([(c.x, c.y), (c.x + nx * run, c.y + ny * run)])),
    }


def _build(
    spec: HouseInput,
    partition,
    catalog: Catalog,
    style: dict,
    *,
    closets: bool = True,
    trim_wet: bool = True,
) -> dict:
    output = []
    stairways = []
    elevation = 0.0
    stair_access = None
    if partition.stair is not None:
        common_hall = partition.floors[0]["hall"]
        for floor in partition.floors[1:]:
            common_hall = common_hall.intersection(floor["hall"].buffer(1e-7))
        access = [
            line for line in lines(shared(partition.stair, common_hall)) if line.length >= 2.20
        ]
        if not access:
            raise ValueError("no shared stair approach on every floor")
        stair_access = min(access, key=lambda line: abs(line.length - 2.24))
    for level, floor in enumerate(partition.floors):
        rooms = []
        for i, (kind, geometry) in enumerate(floor["rooms"]):
            room = {
                "id": f"{spec.id}:L{level}:R{i}",
                "kind": kind,
                "shape": geometry,
                "hall": floor["hall"],
            }
            if trim_wet and kind in {"toilet", "full_bathroom"}:
                rooms.extend(trim_wet_room(room))
            else:
                rooms.extend(closet_split(room) if closets else [room])
        rooms.append({"id": f"{spec.id}:L{level}:hall", "kind": "hallway", "shape": floor["hall"]})
        if partition.stair is not None:
            rooms.append(
                {"id": f"{spec.id}:L{level}:stair", "kind": "stair", "shape": partition.stair}
            )
        for i, r in enumerate(rooms):
            r["materials"] = room_materials(style, r["kind"], i)
        openings = connect(rooms, floor["inside"], spec.entrance, level, stair_access)
        objects = []
        for r in rooms:
            portals = [
                LineString(o["segment"]["coordinates"]) for o in openings if r["id"] in o["rooms"]
            ]
            if r["kind"] not in {"hallway", "stair"}:
                zones = [shape(o["clearance"]) for o in openings if r["id"] in o["rooms"]]
                objects.extend(
                    RoomFurnisher(
                        r,
                        style,
                        catalog,
                        portals,
                        elevation,
                        portal_zones=zones,
                        windows=(spec.envelope or {}).get("windows", []),
                    ).furnish()
                )
        # Record a cabinet divider only when it physically narrows an open transition.
        # A broad open connection has no door leaf; the remaining clear span is explicit.
        for o in openings:
            if o["type"] != "full_access":
                continue
            line = shape(o["segment"])
            dividers = [
                item
                for item in objects
                if item["role"] in {"counter", "sink_counter"}
                and item["room_id"] in o["rooms"]
                and line.intersection(shape(item["footprint"]).buffer(0.28)).length > 0.2
            ]
            if dividers:
                clear = line.difference(
                    unary_union([shape(item["footprint"]).buffer(0.28) for item in dividers])
                )
                spans = lines(clear)
                if spans and max(s.length for s in spans) >= 0.9:
                    o |= {
                        "type": "partial_cabinet",
                        "blocked_by": [i["id"] for i in dividers],
                        "clear_width_m": max(s.length for s in spans),
                        "passable_segments": [geo(s) for s in spans if s.length >= 0.9],
                    }
        walls = []
        accented = set()
        for a, b in combinations(rooms, 2):
            if a["kind"] in PUBLIC and b["kind"] in PUBLIC:
                continue
            boundary = shared(a["shape"], b["shape"])
            for o in openings:
                if set(o["rooms"]) == {a["id"], b["id"]}:
                    boundary = boundary.difference(
                        LineString(o["segment"]["coordinates"]).buffer(0.001)
                    )
            for line in lines(boundary):
                colors = []
                for room in (a, b):
                    accent = (
                        room["kind"] in {"bedroom", "primary_bedroom", "office"}
                        and room["id"] not in accented
                    )
                    colors.append(room["materials"]["accent_wall" if accent else "wall"])
                    accented.add(room["id"])
                p, q = next(iter(line.coords)), list(line.coords)[-1]
                mid = line.interpolate(0.5, normalized=True)
                left = Point(
                    mid.x - (q[1] - p[1]) / line.length * 0.1,
                    mid.y + (q[0] - p[0]) / line.length * 0.1,
                )
                side_colors = colors if a["shape"].covers(left) else colors[::-1]
                walls.append(
                    {
                        "segment": geo(line),
                        "thickness_m": 0.10,
                        "height_m": spec.storeys[level].height_m - 0.15,
                        "materials": colors,
                        "side_materials": side_colors,
                        "rooms": [a["id"], b["id"]],
                    }
                )
        if partition.stair is not None and level < len(spec.storeys) - 1:
            stairways.append(
                stairs(
                    partition.stair,
                    floor["hall"],
                    elevation,
                    spec.storeys[level].height_m,
                    level,
                    stair_access,
                )
            )
        output.append(
            {
                "level": level,
                "elevation_m": elevation,
                "height_m": spec.storeys[level].height_m,
                "footprint": geo(
                    spec.storeys[level].footprint
                    if spec.storeys[level].footprint is not None
                    else spec.footprint
                ),
                "inside": geo(floor["inside"]),
                "slab_holes": [geo(partition.stair)]
                if partition.stair is not None and level > 0
                else [],
                "rooms": [
                    {k: v for k, v in r.items() if k not in {"shape", "hall"}}
                    | {"polygon": geo(r["shape"]), "area_m2": r["shape"].area, "grade": "inferred"}
                    for r in rooms
                ],
                "openings": openings,
                "walls": walls,
                "objects": objects,
            }
        )
        elevation += spec.storeys[level].height_m
    return {
        "schema": "kerbside.inferred_house/1",
        "id": spec.id,
        "units": "metres",
        "coordinates": "local XY floor plane; object position is [x, elevation, y]",
        "grade": "inferred",
        "confidence": 0.25,
        "measured": False,
        "provenance": {
            "footprint": spec.source,
            "layout": "constraint-generated hypothesis",
            "freshness": None,
            "corroboration_count": 0,
            "engine": "kerbside-polygon-v1",
            "not_an_as_built_survey": True,
        },
        "envelope": copy.deepcopy(spec.envelope),
        "style": style,
        "storeys": output,
        "stairs": stairways,
        "total_height_m": elevation,
        "partition_score": partition.cost,
        "estimated_furniture_cost_usd": sum(
            o["asset"]["estimated_cost_usd"] for f in output for o in f["objects"]
        ),
        "opening_types": list(OPENING_TYPES),
    }


def refresh_assets(house: dict, catalog: Catalog | None = None) -> dict:
    """Refresh the object-library layer without re-solving a validated floor plan."""
    from smc.interiors.inference.validate import validate_house

    catalog = catalog or Catalog()
    for floor in house["storeys"]:
        for item in floor["objects"]:
            room_id, index = item["id"].rsplit(":item:", 1)
            item["asset"] = catalog.choose(
                item["role"], house["style"], tuple(item["size_m"]), f"{room_id}:{index}"
            )
    house["estimated_furniture_cost_usd"] = sum(
        item["asset"]["estimated_cost_usd"] for f in house["storeys"] for item in f["objects"]
    )
    house["validation"] = validate_house(house)
    return house


def infer_house(spec: HouseInput, catalog: Catalog | None = None) -> dict:
    """Return a validated hypothesis, or fail explicitly with candidate diagnostics.

    The same seed/program/search is used for every address; no house-specific tuning.
    """
    from smc.interiors.inference.validate import validate_house

    catalog = catalog or Catalog()
    area = sum(
        (s.footprint if s.footprint is not None else spec.footprint).area for s in spec.storeys
    )
    style = house_style(spec.id, area, spec.neighborhood_price_per_sqft)
    failures = []
    candidates = partition_candidates(spec)
    attempt = 0
    for candidate in candidates:
        for include_closets, trim_wet in (
            (True, True),
            (False, True),
            (True, False),
            (False, False),
        ):
            attempt += 1
            try:
                result = _build(
                    spec, candidate, catalog, style, closets=include_closets, trim_wet=trim_wet
                )
                stamp_inference(result, 0.25)
                result["validation"] = validate_house(result)
                if not result["validation"]["passed"]:
                    raise ValueError("; ".join(result["validation"]["errors"][:4]))
                result["search"] = {
                    "candidates_tried": attempt,
                    "rejected": failures,
                    "built_in_closets": include_closets,
                }
                return result
            except ValueError as exc:
                failures.append(str(exc))
    raise ValueError("all layout candidates failed: " + "; ".join(dict.fromkeys(failures)))
