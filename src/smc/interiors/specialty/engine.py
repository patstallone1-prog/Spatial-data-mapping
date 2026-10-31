"""Shared aperture ledger, functional shop fixtures and conservative working clearances."""

from __future__ import annotations

import hashlib
import json
import math
from itertools import combinations, product

from shapely import affinity, set_precision, union_all
from shapely.geometry import LineString, Point, box, mapping, shape
from shapely.ops import unary_union

from smc.exteriors import ExteriorInput, infer_exterior
from smc.exteriors.interiors import interior_envelope
from smc.exteriors.library import category
from smc.exteriors.validate import validate_exterior
from smc.interiors.inference.catalog import Catalog
from smc.interiors.inference.engine import opening
from smc.interiors.inference.furnish import RoomFurnisher, inward_point, oriented_box
from smc.interiors.inference.partition import lines, polygons, shared
from smc.interiors.inference.style import door_finish, house_style, room_materials
from smc.interiors.stores.engine import _entrances, _walls
from smc.interiors.stores.model import StoreInput


def _style(spec, kind, exterior):
    s = house_style(spec.id, spec.footprint.area, None)
    f = exterior["facades"][0]
    s["tier"] = {"budget": "economy", "luxury": "premium"}.get(
        f["economics"]["tier"], f["economics"]["tier"]
    )
    palettes = {
        "jewelry": dict(
            walls=["#e7e0d2", "#c8d1c6", "#f1ede3"],
            wood="#72533f",
            fabric="#355c51",
            accent="#947642",
            metal="#b49a66",
            stone="#e1d9c9",
        ),
        "barber": dict(
            walls=["#e0d9cb", "#8c9b94", "#e8e4da"],
            wood="#704a34",
            fabric="#693b39",
            accent="#3a5550",
            metal="#b5b9b8",
            stone="#c7c8c0",
        ),
        "salon": dict(
            walls=["#e5dfd3", "#acb9a8", "#ece6dc"],
            wood="#a3825d",
            fabric="#464d48",
            accent="#839078",
            metal="#aaa59c",
            stone="#ddd2be",
        ),
        "laundry": dict(
            walls=["#e2e8e4", "#82aaa8", "#eef1e9"],
            wood="#a78d68",
            fabric="#4b6976",
            accent="#287f87",
            metal="#b8c2c5",
            stone="#c9ceca",
        ),
    }
    s.update(palettes[kind])
    s["walls"] = s["walls"] + [s["walls"][0]]
    s.update(
        id=kind + "-" + s["id"],
        name=kind.replace("_", " ").title() + " · " + s["name"],
        usage="specialty",
        economic_evidence=f["economics"],
    )
    return s


def _room(id, kind, p, style, index):
    mats = room_materials(style, "kitchen" if kind == "utility" else kind, index)
    mats.update(
        wall=style["walls"][index % len(style["walls"])],
        floor=style["stone"] if index else "#c9c2b2",
        floor_finish="tile",
        trim="#ded8ca",
        accent_wall=style["walls"][1] if index == 0 else style["walls"][index],
    )
    return dict(id=id, kind=kind, shape=p, materials=mats, grade="inferred")


def _target(f, item):
    if not item:
        return
    x, _, y = item["position_m"]
    a = math.radians(item["rotation_deg"])
    for sign in [1, -1]:
        p = Point(
            x - math.sin(a) * sign * (item["size_m"][2] / 2 + 0.5),
            y + math.cos(a) * sign * (item["size_m"][2] / 2 + 0.5),
        )
        if f.reachable(target=p):
            f.targets.append(p)
            item["interaction_point_m"] = [p.x, p.y]
            return
    raise ValueError("fixture has no connected customer approach")


def _parts(item):
    """Physical parts inside a service assembly; the larger envelope reserves working space."""
    x, _, y = item["position_m"]
    w, _h, d = item["size_m"]
    a = math.radians(item["rotation_deg"])

    def part(u, v, pw, pd):
        return mapping(
            oriented_box(
                x + u * math.cos(a) - v * math.sin(a),
                y + u * math.sin(a) + v * math.cos(a),
                pw,
                pd,
                item["rotation_deg"],
            )
        )

    if item["role"] == "styling_station":
        return [part(0, -d / 2 + 0.25, w - 0.12, 0.5), part(0, 0.15, 0.78, 1.05)]
    if item["role"] == "shampoo_station":
        return [part(0, 0.42, 0.72, 1.15), part(0, -0.37, 0.75, 0.68)]
    return [item["footprint"]]


def _door_candidates(door, rooms):
    a, b = shape(door["segment"]).coords
    options = []
    for hinge_end in [False, True]:
        start, end = (b, a) if hinge_end else (a, b)
        dx, dy = end[0] - start[0], end[1] - start[1]
        for sign in [-1, 1]:
            tip = (start[0] - sign * dy, start[1] + sign * dx)
            leaf = LineString([start, tip])
            into = next(
                (
                    r
                    for r in rooms
                    if r["id"] in door["rooms"] and r["shape"].buffer(0.003).covers(leaf)
                ),
                None,
            )
            if into:
                options.append(
                    dict(
                        hinge_end=hinge_end,
                        open_angle_deg=sign * 90,
                        open_leaf_segment=mapping(leaf),
                        open_leaf_polygon=mapping(leaf.buffer(0.024, cap_style=2)),
                        swing_into=into["id"],
                    )
                )
    return sorted(options, key=lambda o: o["swing_into"] != door["rooms"][0])


def _furnish_main(room, style, catalog, opens, windows, kind):
    portals = [shape(o["segment"]) for o in opens if room["id"] in o["rooms"]]
    f = RoomFurnisher(
        room,
        style,
        catalog,
        portals,
        0,
        portal_zones=[shape(o["clearance"]) for o in opens if room["id"] in o["rooms"]],
        windows=windows,
        walk_radius=0.4,
    )
    if kind == "laundry":
        table = f.centre(
            "folding_table", [(1.6, 0.8, 0.91), (1.2, 0.7, 0.91)], required=True, surround=0.85
        )
        _target(f, table)
        f.wall("laundry_payment", [(0.65, 0.32, 1.65)], required=True)
        for i in range(max(2, min(12, int(room["shape"].area / 8)))):
            f.wall("commercial_washer", [(0.85, 1.0, 1.25), (0.74, 0.86, 1.12)], required=i < 2)
        for i in range(max(1, min(8, int(room["shape"].area / 15)))):
            f.wall("stacked_dryer", [(0.88, 1.05, 2.12), (0.79, 0.93, 2.04)], required=i < 1)
        f.wall("detergent_vending", [(0.7, 0.4, 1.7)])
        f.centre("laundry_cart", [(0.65, 0.48, 0.85)], surround=0.2)
        f.wall("waiting_bench", [(1.3, 0.48, 0.72), (0.85, 0.45, 0.72)])
        for _ in range(max(0, min(3, int(room["shape"].area / 38)) - 1)):
            table = f.centre("folding_table", [(1.6, 0.8, 0.91)], surround=0.85)
            _target(f, table)
    elif kind in {"barber", "salon"}:
        f.wall("styling_station", [(1.8, 2.7, 2.1), (1.55, 2.4, 2.05)], required=True)
        f.wall("shampoo_station", [(1.45, 2.8, 1.25), (1.3, 2.65, 1.2)], required=True)
        f.wall("reception_desk", [(1.15, 0.65, 1.05), (0.85, 0.55, 1.05)], required=True)
        f.wall("waiting_bench", [(1.4, 0.52, 0.8), (0.85, 0.48, 0.8)], required=True)
        for _ in range(max(0, min(9, int(room["shape"].area / 10)) - 1)):
            f.wall("styling_station", [(1.8, 2.7, 2.1), (1.55, 2.4, 2.05)])
        f.wall("product_cabinet", [(0.85, 0.4, 1.8), (0.6, 0.35, 1.65)])
    else:
        case = f.centre(
            "jewelry_island", [(1.6, 0.75, 1.12), (1.2, 0.65, 1.08)], required=True, surround=0.85
        )
        _target(f, case)
        f.wall("jewelry_wall_case", [(1.6, 0.48, 1.95), (1.1, 0.45, 1.9)], required=True)
        f.wall("reception_desk", [(1.4, 0.7, 1.05), (0.95, 0.6, 1.05)], required=True)
        for _ in range(max(0, min(9, int(room["shape"].area / 12)) - 1)):
            f.wall("jewelry_wall_case", [(1.6, 0.48, 1.95), (1.1, 0.45, 1.9)])
        f.wall("consultation_set", [(1.6, 1.8, 1.0)])
        f.wall("waiting_bench", [(1.3, 0.5, 0.8), (0.8, 0.48, 0.8)])
        for _ in range(max(0, min(4, int(room["shape"].area / 32)) - 1)):
            case = f.centre("jewelry_island", [(1.6, 0.75, 1.12)], surround=0.85)
            _target(f, case)
    for item in f.items:
        item["collision_polygons"] = _parts(item)
        item["evidence"] = dict(
            measured=False, inferred=True, confidence=0.25, freshness=None, corroboration_count=0
        )
    return f


def _build(spec, exterior, kind, angle):
    envelope = interior_envelope(exterior)
    ss = StoreInput(
        spec.id,
        spec.footprint,
        "corner_store",
        min(f["band_height_m"] for f in exterior["facades"]),
        tuple(envelope["exterior_entrances"]),
        envelope,
    )
    style = _style(spec, kind, exterior)
    inside = ss.footprint.buffer(-0.15, join_style=2)
    if inside.geom_type != "Polygon":
        raise ValueError("wall inset disconnects shop")
    local = set_precision(affinity.rotate(inside, -angle, origin=(0, 0)), 1e-7)
    x0, y0, x1, y1 = local.bounds
    depth = min(3.5, max(2.55, (y1 - y0) * 0.16))
    band = local.intersection(box(x0 - 1, y1 - depth, x1 + 1, y1 + 1))
    wc = band.intersection(box(x0 - 1, y1 - depth, x0 + 2.05, y1 + 1))
    staff = band.difference(wc)
    public = local.difference(band)
    if any(p.geom_type != "Polygon" or p.area < 3.5 for p in [public, staff, wc]):
        raise ValueError("public floor, staff area and WC do not fit")
    parts = [affinity.rotate(p, angle, origin=(0, 0)) for p in [public, staff, wc]]
    inside = set_precision(inside, 1e-7)
    parts = [set_precision(p, 1e-7) for p in parts]
    rooms = [
        _room(spec.id + ":public", kind, parts[0], style, 0),
        _room(spec.id + ":staff", "utility", parts[1], style, 1),
        _room(spec.id + ":wc", "toilet", parts[2], style, 2),
    ]
    opens = _entrances(ss, rooms, angle)
    # Retain the shared source entry operation, including hinged pairs for laundry carts.
    entries = [
        o
        for f in exterior["facades"]
        for o in f["openings"]
        if o["component_kind"] == "door" and o["v"] < f["band_height_m"]
    ]
    for o, entry in zip(opens, entries, strict=True):
        o.update(
            type="automatic_sliding"
            if entry.get("operation") == "automatic_sliding"
            else "double_door"
            if entry.get("leaf_count", 1) == 2
            else "single_door",
            leaf_count=entry.get("leaf_count", 1),
        )
    for i, r in enumerate(rooms[1:]):
        parent = rooms[0]
        candidates = lines(shared(r["shape"], parent["shape"]))
        if not candidates:
            parent = rooms[1]
            candidates = lines(shared(r["shape"], parent["shape"]))
        edge = max(candidates, key=lambda q: q.length)
        o = opening(r, parent, edge, "single_door", 100 + i, width_m=0.9)
        o["appearance"] = door_finish(style, r["kind"], o["id"])
        opens.append(o)
    main = _furnish_main(rooms[0], style, Catalog(), opens, envelope["windows"], kind)
    items = list(main.items)
    targets = [dict(room_id=rooms[0]["id"], point=[p.x, p.y]) for p in main.targets]
    for r in rooms[1:]:
        portals = [shape(o["segment"]) for o in opens if r["id"] in o["rooms"]]
        f = RoomFurnisher(
            r,
            style,
            Catalog(),
            portals,
            0,
            portal_zones=[shape(o["clearance"]) for o in opens if r["id"] in o["rooms"]],
            walk_radius=0.32,
        )
        if r["kind"] == "toilet":
            f.wall("toilet", [(0.6, 0.72, 0.8)], required=True)
            f.wall("bath_sink", [(0.5, 0.42, 0.86)], required=True)
        elif kind == "jewelry":
            f.wall("jewelry_safe", [(0.75, 0.65, 1.4), (0.55, 0.5, 1.1)], required=True)
            f.wall("jeweler_bench", [(1.0, 0.6, 0.9), (0.75, 0.5, 0.9)])
        else:
            f.wall("utility_sink", [(0.65, 0.55, 0.9), (0.5, 0.45, 0.9)], required=True)
            f.wall("towel_storage", [(0.8, 0.4, 1.8), (0.55, 0.35, 1.7)])
        items += f.items
        targets += [dict(room_id=r["id"], point=[p.x, p.y]) for p in f.targets]
    for item in items:
        item.setdefault("collision_polygons", _parts(item))
        item.setdefault(
            "evidence",
            dict(
                measured=False,
                inferred=True,
                confidence=0.25,
                freshness=None,
                corroboration_count=0,
            ),
        )
    floor = dict(
        level=0,
        elevation_m=0,
        height_m=ss.height_m,
        footprint=mapping(spec.footprint),
        inside=mapping(inside),
        slab_holes=[],
        rooms=[
            {k: v for k, v in r.items() if k != "shape"}
            | dict(polygon=mapping(r["shape"]), area_m2=r["shape"].area)
            for r in rooms
        ],
        walls=_walls(rooms, opens, ss.height_m),
        openings=opens,
        objects=items,
    )
    plan = dict(
        schema="kerbside.inferred_specialty_shop/1",
        id=spec.id,
        kind=kind,
        units="metres",
        style=style,
        exterior=exterior,
        envelope=envelope,
        storeys=[floor],
        stairs=[],
        ramps=[],
        interaction_targets=targets,
        source_geometry_sha256=exterior["geometry_sha256"],
        canonical_geometry_modified=False,
        grade="inferred",
        measured=False,
        confidence=0.25,
        freshness=None,
        corroboration_count=0,
        references=exterior["references"],
    )
    doors = [o for o in opens if not o.get("entrance")]
    candidates = [_door_candidates(o, rooms) for o in doors]
    for swings in product(*candidates):
        for door, swing in zip(doors, swings, strict=True):
            door.update(swing)
        plan["validation"] = validate_specialty_shop(plan)
        if plan["validation"]["passed"]:
            break
    if "validation" not in plan:
        raise ValueError("no door swing fits the connected rooms")
    plan["content_sha256"] = hashlib.sha256(
        json.dumps(plan, sort_keys=True, allow_nan=False).encode()
    ).hexdigest()
    return plan


def infer_specialty_shop(row):
    """Input uses ExteriorInput geometry; kind selects the specialty interior program."""
    kind = category(row.get("kind"))
    if kind not in {"jewelry", "barber", "salon", "laundry"}:
        raise ValueError("choose jewelry, barber, salon or laundry")
    spec = ExteriorInput.from_json(row)
    if len(spec.tenants) != 1:
        raise ValueError("specialty layout needs a supplied single-tenant boundary")
    tenant = spec.tenants[0]
    if category(tenant.get("category"), tenant.get("tags")) != kind:
        raise ValueError("interior program conflicts with tenant category")
    exterior = infer_exterior(spec)
    if not exterior["validation"]["passed"]:
        raise ValueError(
            "invalid exterior aperture ledger: " + str(exterior["validation"]["errors"])
        )
    face = next(f for f in exterior["facades"] if f["role"] == "public")
    a, b = face["a"], face["b"]
    theta = math.degrees(math.atan2(b[1] - a[1], b[0] - a[0]))
    failures = []
    for angle in [theta, theta + 180, theta + 90, theta - 90]:
        try:
            p = _build(spec, exterior, kind, angle)
            if p["validation"]["passed"]:
                return p
            failures += p["validation"]["errors"]
        except ValueError as exc:
            failures.append(str(exc))
    raise ValueError("no valid specialty layout: " + "; ".join(dict.fromkeys(failures))[:1200])


def validate_specialty_shop(plan):
    errors = []
    floor = plan["storeys"][0]
    inside = shape(floor["inside"])
    rooms = floor["rooms"]
    items = floor["objects"]
    exterior = plan["exterior"]
    if not validate_exterior(exterior)["passed"]:
        errors.append("exterior failed")
    digest = hashlib.sha256(
        json.dumps(
            {k: v for k, v in exterior.items() if k != "content_sha256"},
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        ).encode()
    ).hexdigest()
    if digest != exterior["content_sha256"]:
        errors.append("stale exterior content digest")
    if plan["envelope"] != interior_envelope(exterior):
        errors.append("shared openings differ from exterior")
    if not shape(floor["footprint"]).equals_exact(shape(exterior["footprint"]), 0):
        errors.append("interior changed source footprint")
    coverage = union_all([shape(r["polygon"]) for r in rooms], grid_size=1e-6)
    if coverage.symmetric_difference(inside).area > 0.001:
        errors.append("rooms do not cover actual inside footprint")
    byroom = {r["id"]: r for r in rooms}
    for a, b in combinations(items, 2):
        if shape(a["footprint"]).intersection(shape(b["footprint"])).area > 0.001:
            errors.append("fixture envelopes overlap")
    for o in items:
        if not shape(byroom[o["room_id"]]["polygon"]).buffer(0.001).covers(shape(o["footprint"])):
            errors.append("fixture outside its room")
        if (
            o["position_m"][1] < -0.001
            or o["position_m"][1] + o["size_m"][1] > floor["height_m"] + 0.001
        ):
            errors.append("fixture exceeds floor height")
        if any(
            shape(o["footprint"]).intersects(shape(d["clearance"]))
            for d in floor["openings"]
            if o["room_id"] in d["rooms"]
        ):
            errors.append("fixture blocks door clearance")
        if any(
            not shape(o["footprint"]).buffer(0.001).covers(shape(p))
            for p in o["collision_polygons"]
        ):
            errors.append("physical fixture escapes its assembly envelope")
    for r in rooms:
        rr = 0.4 if r is rooms[0] else 0.32
        obstacles = [
            shape(p) for o in items if o["room_id"] == r["id"] for p in o["collision_polygons"]
        ]
        leaves = [
            shape(o["open_leaf_polygon"])
            for o in floor["openings"]
            if not o.get("entrance") and r["id"] in o["rooms"]
        ]
        if any(
            leaf.intersection(obstacle).area > 0.001 for leaf in leaves for obstacle in obstacles
        ):
            errors.append("open door leaf intersects a fixture")
        obstacles += leaves
        free = (
            shape(r["polygon"])
            .buffer(-rr)
            .difference(unary_union(obstacles).buffer(rr, join_style=2))
        )
        starts = [
            inward_point(shape(r["polygon"]), shape(o["segment"]), 0.6)
            for o in floor["openings"]
            if r["id"] in o["rooms"]
        ]
        targets = [
            Point(t["point"]) for t in plan["interaction_targets"] if t["room_id"] == r["id"]
        ]
        if not any(
            all(part.buffer(0.02).covers(p) for p in starts + targets) for part in polygons(free)
        ):
            errors.append("unreachable work point or room portal")
    # One shared source-entry/window ledger is consumed by both render layers.
    if plan["envelope"]["exterior_plan_sha256"] != plan["exterior"]["content_sha256"]:
        errors.append("stale shared envelope")
    return dict(
        passed=not errors,
        errors=list(dict.fromkeys(errors)),
        metrics=dict(
            rooms=len(rooms), objects=len(items), coverage_m2=coverage.area, dead_hallway_m2=0
        ),
    )
