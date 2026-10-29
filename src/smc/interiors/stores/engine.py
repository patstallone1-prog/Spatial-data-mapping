"""Geometry-driven shelves, cold banks, checkouts and staff space, with chain priors."""

from __future__ import annotations

import copy
import math
from itertools import combinations, pairwise

from shapely import affinity
from shapely.geometry import LineString, Point, box, shape
from shapely.ops import unary_union

from smc.interiors.inference.catalog import Catalog
from smc.interiors.inference.engine import opening
from smc.interiors.inference.furnish import RoomFurnisher, inward_point
from smc.interiors.inference.model import geo, stamp_inference
from smc.interiors.inference.partition import lines, shared
from smc.interiors.inference.style import door_finish, house_style, room_materials

from .model import StoreInput

CHAIN_PRIORS = {
    "safeway": {
        "label": "Supermarket",
        "accent": "#ac3834",
        "wood": "#aa8867",
        "produce_share": 0.18,
        "self_checkout_share": 0.45,
    },
    "whole_foods": {
        "label": "Fresh market",
        "accent": "#32664d",
        "wood": "#916c48",
        "produce_share": 0.25,
        "self_checkout_share": 0.5,
    },
    "trader_joes": {
        "label": "Neighbourhood market",
        "accent": "#b44737",
        "wood": "#ba956b",
        "produce_share": 0.16,
        "self_checkout_share": 0,
    },
    "independent": {
        "label": "Local market",
        "accent": "#52766b",
        "wood": "#a78660",
        "produce_share": 0.18,
        "self_checkout_share": 0.25,
    },
}


def store_style(spec):
    s = house_style(spec.id, spec.footprint.area, None)
    prior = CHAIN_PRIORS.get(spec.chain, CHAIN_PRIORS["independent"])
    s.update(prior)
    s.update(
        usage="retail",
        chain=spec.chain,
        tier="standard",
        fabric="#708778",
        walls=["#e9e6dc", "#d4dfd2", "#e5d8c5", "#d9e1e3"],
        economic_evidence="retail fixture allowance; no observed revenue estimate",
        chain_prior="department/finish heuristic; not a chain floor-plan template",
    )
    return s


def _room(key, kind, p, style, index):
    materials = room_materials(style, "kitchen" if kind == "stockroom" else kind, index)
    materials.update(
        floor_finish="tile" if kind == "toilet" else "concrete",
        floor="#bdbeb2" if kind == "sales_floor" else "#cbd0c4",
    )
    return {"id": key, "kind": kind, "shape": p, "materials": materials}


def _partitions(spec, angle):
    inside = spec.footprint.buffer(-0.15, join_style=2)
    if inside.geom_type != "Polygon":
        raise ValueError("wall inset disconnects store")
    local = affinity.rotate(inside, -angle, origin=(0, 0))
    x0, y0, x1, y1 = local.bounds
    depth = min(4.5, max(2.55, (y1 - y0) * 0.14))
    # A stock room, staff WC and a connected selling polygon retain the exact shell.
    band = local.intersection(box(x0 - 1, y1 - depth, x1 + 1, y1 + 1))
    wc = band.intersection(box(x0 - 1, y1 - 2.4, x0 + 2.25, y1 + 1))
    stock = band.difference(wc)
    sales = local.difference(band)
    if any(p.geom_type != "Polygon" or p.area < 3.5 for p in (wc, stock, sales)):
        raise ValueError("staff WC and stockroom cannot fit")
    return inside, [affinity.rotate(p, angle, origin=(0, 0)) for p in (sales, stock, wc)]


def _entrances(spec, rooms, angle):
    sales = rooms[0]
    source = list(spec.entrances)
    if not source:
        local = affinity.rotate(spec.footprint, -angle, origin=(0, 0))
        edge = min(
            (LineString([a, b]) for a, b in pairwise(local.exterior.coords)),
            key=lambda e: e.centroid.y,
        )
        line = affinity.rotate(edge, angle, origin=(0, 0))
        source = [
            {
                "point": next(iter(line.interpolate(0.4, normalized=True).coords)),
                "basis": "inferred frontage entry, not measured",
            }
        ]
    result = []
    for i, e in enumerate(source):
        if e.get("segment"):
            src = shape(e["segment"])
            line = src
        else:
            p = Point(e["point"])
            edge = min(
                (LineString([a, b]) for a, b in pairwise(spec.footprint.exterior.coords)),
                key=lambda q: q.distance(p),
            )
            w = float(e.get("width_m", 1.2 if spec.kind == "corner_store" else 2.4))
            t = edge.project(p)
            if t < w / 2 + 0.03 or t + w / 2 > edge.length - 0.03:
                raise ValueError("source entry width does not fit its facade; cannot shift it")
            a, b = edge.interpolate(t - w / 2), edge.interpolate(t + w / 2)
            line = LineString([a, b])
            src = line
        # Project to the inside wall, retaining source centre/width rather than widening it.
        c = line.centroid
        target = inward_point(spec.footprint, line, 0.15)
        line = affinity.translate(line, target.x - c.x, target.y - c.y)
        if not sales["shape"].buffer(0.025).covers(line):
            raise ValueError("source entry meets staff/core zone; try another layout frame")
        o = opening(sales, None, line, "double_door", i)
        o.update(
            entrance=True,
            source_opening=copy.deepcopy(e),
            source_segment=geo(src),
            width_m=line.length,
            height_m=float(e.get("height_m", 2.3)),
            type="automatic_sliding" if line.length >= 1.6 else "single_door",
            leaf_count=2 if line.length >= 1.6 else 1,
            appearance=door_finish(store_style(spec), "living", o["id"], True),
        )
        o["segment"] = geo(line)
        o["clearance"] = geo(line.buffer(1.1, cap_style=2))
        result.append(o)
    return result


def _furniture(room, style, catalog, opens, elevation, windows=(), radius=0.55):
    portals = [shape(o["segment"]) for o in opens if room["id"] in o["rooms"]]
    return RoomFurnisher(
        room,
        style,
        catalog,
        portals,
        elevation,
        portal_zones=[shape(o["clearance"]) for o in opens if room["id"] in o["rooms"]],
        windows=windows,
        walk_radius=radius,
    )


def _sales(spec, room, style, catalog, opens, angle, elevation, reserves, core=None):
    f = _furniture(
        room,
        style,
        catalog,
        opens,
        elevation,
        (spec.envelope or {}).get("windows", []),
        0.48 if spec.kind == "corner_store" else 0.6,
    )
    f.reservations += reserves
    if core:
        f.starts.append(inward_point(f.p.difference(core["core"]), core["access"], 0.8))
    local = affinity.rotate(room["shape"], -angle, origin=(0, 0))
    x0, y0, x1, y1 = local.bounds

    def point(x, y):
        return affinity.rotate(Point(x, y), angle, origin=(0, 0))

    def place(role, x, y, w, d, h, section, side=1):
        p = point(x, y)
        shelf = role in {"gondola_shelf", "produce_bin", "bakery_display"}
        target = (
            point(x + side * (w / 2 + f.walk_radius + 0.1), y)
            if shelf
            else point(x, y + side * (d / 2 + f.walk_radius + 0.1))
        )
        other = point(x - side * (w / 2 + f.walk_radius + 0.1), y) if shelf else None
        if other is not None:
            from smc.interiors.inference.furnish import oriented_box

            if not f.reachable(oriented_box(p.x, p.y, w, d, angle), other):
                return None
        item = f.put(role, p.x, p.y, w, d, h, angle, target=target)
        if item and other is not None:
            f.targets.append(other)
        if item:
            item.update(section=section, stock_seed=len(f.items) % 7)
        return item

    # A front zone contains the cashier and queue, with a cross aisle behind it.
    corner = spec.kind == "corner_store"
    count = 1 if corner else max(2, min(12, math.floor((x1 - x0 - 3) / 3.0)))
    checkouts = []
    for i in range(count):
        xs = [x1 - 1.1 - i * 2.6, x0 + 1.1 + i * 2.6]
        self_service = not corner and i > 0 and i / count <= style["self_checkout_share"]
        for x in xs:
            role = "self_checkout" if self_service else "checkout_lane"
            d = 1.0 if self_service else 2.2
            for y in [y0 + 2.0, y0 + 3.2, y0 + 4.3]:
                item = place(role, x, y, 0.85, d, 1.05, "checkout")
                if item:
                    q = affinity.rotate(
                        box(x - 0.65, y - d / 2 - 1.8, x + 0.65, y - d / 2 - 0.1),
                        angle,
                        origin=(0, 0),
                    )
                    if not f.p.covers(q) or any(
                        q.intersects(z) for z in f.obstacles[:-1] + f.door_zones + f.reservations
                    ):
                        f.items.pop()
                        f.obstacles.pop()
                        f.targets.pop()
                        continue
                    f.reservations.append(q)
                    item["queue_zone"] = geo(q)
                    checkouts.append(item)
                    break
            else:
                continue
            break
    if not checkouts:
        raise ValueError("checkout and queue do not fit without blocking doors")
    # Cold departments share long banks against opaque walls. The same bank is stocked
    # with several product forms; it never becomes an isolated refrigerator in each aisle.
    cold_roles = (
        [("drink_cooler", "drinks")]
        if corner
        else [
            ("refrigerated_case", "dairy"),
            ("refrigerated_case", "meat_and_deli"),
            ("freezer_case", "frozen"),
        ]
    )
    for role, section in cold_roles:
        for bank in range(1 if corner else max(1, min(6, math.ceil(f.p.area / 1000)))):
            item = f.wall(
                role,
                [(min(4.8, (x1 - x0) * 0.3), 0.82, 2.05), (2.4, 0.82, 2.05), (1.2, 0.72, 1.9)],
                required=bank == 0,
            )
            if item:
                item.update(section=section, stock_seed=len(f.items) % 7)
    # Shelves terminate before cross aisles. An explicit middle cross aisle breaks
    # long runs; both shelf faces have connected customer approaches.
    pitch = 2.35 if corner else 3.15
    shelf_w = 0.72 if corner else 0.95
    available_y0 = y0 + (5 if not corner else 4.0)
    available_y1 = y1 - 1.6
    centre_y = (available_y0 + available_y1) / 2
    sections = (
        ["snacks", "pantry", "household"]
        if corner
        else ["produce", "bakery", "pantry", "cereal_and_snacks", "household", "beverages"]
    )
    placed = []
    module = 6.0 if f.p.area > 1800 else 3.6 if f.p.area > 600 else 2.5
    xi = 0
    x = x0 + 1.5 + shelf_w / 2
    while x + shelf_w / 2 < x1 - 1.5 and len(f.items) < 260:
        bands = [(available_y0, available_y1)]
        if available_y1 - available_y0 > 13:
            bands = [(available_y0, centre_y - 0.9), (centre_y + 0.9, available_y1)]
        for lo, hi in bands:
            y = lo + module / 2
            while y + module / 2 <= hi and len(f.items) < 260:
                columns = max(1, math.floor((x1 - x0 - 3) / pitch))
                produce_columns = max(1, round(columns * style["produce_share"]))
                section = (
                    sections[xi % len(sections)]
                    if corner
                    else "produce"
                    if xi < produce_columns
                    else "bakery"
                    if xi == produce_columns
                    else sections[2 + (xi - produce_columns - 1) % 4]
                )
                role = (
                    "produce_bin"
                    if section == "produce"
                    else "bakery_display"
                    if section == "bakery"
                    else "gondola_shelf"
                )
                item = place(
                    role, x, y, shelf_w, module, 1.15 if role == "produce_bin" else 1.65, section
                )
                if item:
                    placed.append(item)
                y += module + 0.12
        x += pitch
        xi += 1
    # For tiny shops, add wall-backed impulse shelves instead of an empty customer zone.
    if not placed:
        item = f.wall("gondola_shelf", [(1.2, 0.45, 1.65), (0.8, 0.4, 1.6)], required=True)
        item.update(section="snacks", stock_seed=0)
        placed.append(item)
    return f, checkouts


def _walls(rooms, opens, height):
    result = []
    for a, b in combinations(rooms, 2):
        boundary = shared(a["shape"], b["shape"])
        for o in opens:
            if set(o["rooms"]) == {a["id"], b["id"]}:
                boundary = boundary.difference(shape(o["segment"]).buffer(0.002))
        for line in lines(boundary):
            result.append(
                {
                    "segment": geo(line),
                    "height_m": height - 0.12,
                    "thickness_m": 0.1,
                    "rooms": [a["id"], b["id"]],
                    "materials": [a["materials"]["wall"], b["materials"]["wall"]],
                }
            )
    return result


def _build(spec, angle, catalog):
    from .parking import add_parking, parking_core

    style = store_style(spec)
    inside, parts = _partitions(spec, angle)
    rooms = [
        _room(f"{spec.id}:sales", "sales_floor", parts[0], style, 0),
        _room(f"{spec.id}:stock", "stockroom", parts[1], style, 1),
        _room(f"{spec.id}:wc", "toilet", parts[2], style, 2),
    ]
    opens = _entrances(spec, rooms, angle)
    for i, r in enumerate(rooms[1:]):
        candidates = lines(shared(r["shape"], rooms[0]["shape"]))
        if not candidates:
            # WC may sit wholly behind stockroom, with staff access through it.
            parent = rooms[1]
            candidates = lines(shared(r["shape"], parent["shape"]))
        else:
            parent = rooms[0]
        edge = max(candidates, key=lambda q: q.length)
        o = opening(r, parent, edge, "single_door", 100 + i, width_m=0.95)
        o["appearance"] = door_finish(style, r["kind"], o["id"])
        opens.append(o)
    core = parking_core(spec, rooms[0], angle)
    reserves = [core["reservation"], core["ramp_reservation"]] if core else []
    if core:
        for room in rooms:
            cuts = [core["upper_vehicle_zone"]]
            if room is rooms[0]:
                cuts.append(core["core"])
            room["shape"] = room["shape"].difference(unary_union(cuts))
            if room["shape"].geom_type != "Polygon" or room["shape"].area < 3.5:
                raise ValueError("vehicle access disconnects or removes a required store room")
    sales, checkouts = _sales(spec, rooms[0], style, catalog, opens, angle, 0, reserves, core)
    objects = list(sales.items)
    for o in objects:
        if o["role"] in {
            "gondola_shelf",
            "refrigerated_case",
            "freezer_case",
            "drink_cooler",
            "produce_bin",
            "bakery_display",
        }:
            o["stock"] = [
                {
                    "form": "bottles"
                    if o.get("section") in {"drinks", "beverages"}
                    else "produce"
                    if o.get("section") == "produce"
                    else "packages",
                    "bottom_m": round(y, 3),
                    "height_m": 0.18,
                    "support": "fixture shelf",
                    "measured": False,
                }
                for y in [0.24, 0.64, 1.04, 1.44]
                if y + 0.18 <= o["size_m"][1]
            ]
    targets = [
        {"room_id": rooms[0]["id"], "point": [p.x, p.y], "kind": "shopping"} for p in sales.targets
    ]
    for r in rooms[1:]:
        f = _furniture(r, style, catalog, opens, 0, radius=0.4)
        if r["kind"] == "toilet":
            f.wall("toilet", [(0.65, 0.75, 0.8)], required=True)
            f.wall("bath_sink", [(0.5, 0.42, 0.85)], required=True)
        else:
            f.wall("dry_storage", [(1.8, 0.55, 1.9), (0.9, 0.45, 1.8)], required=True)
            f.wall("prep_table", [(1.4, 0.65, 0.9), (0.9, 0.55, 0.9)])
        objects += f.items
        targets += [{"room_id": r["id"], "point": [p.x, p.y], "kind": "staff"} for p in f.targets]
    if core:
        rooms.append(
            _room(
                spec.id + ":vehicle", "vehicle_ramp_landing", core["upper_vehicle_zone"], style, 3
            )
        )
    floor = {
        "level": 0,
        "elevation_m": 0,
        "height_m": spec.height_m,
        "footprint": geo(spec.footprint),
        "inside": geo(inside),
        "slab_holes": [],
        "rooms": [
            {k: v for k, v in r.items() if k != "shape"}
            | {"polygon": geo(r["shape"]), "area_m2": r["shape"].area}
            for r in rooms
        ],
        "walls": _walls(rooms, opens, spec.height_m),
        "openings": opens,
        "objects": objects,
    }
    h = {
        "schema": "kerbside.inferred_store/1",
        "id": spec.id,
        "kind": spec.kind,
        "style": style,
        "units": "metres",
        "grade": "inferred",
        "measured": False,
        "confidence": 0.2,
        "freshness": None,
        "corroboration_count": 0,
        "provenance": {
            "footprint": spec.source,
            "geometry": spec.geometry_evidence,
            "tenant_boundary": "supplied or assumed; not measured",
        },
        "footprint_area_m2": spec.footprint.area,
        "footprint_area_sqft": spec.footprint.area * 10.7639104167,
        "total_height_m": spec.height_m,
        "envelope": copy.deepcopy(spec.envelope or {"windows": [], "balconies": []}),
        "storeys": [floor],
        "stairs": [],
        "ramps": [],
        "interaction_targets": targets,
        "sections": [
            {"id": s, "fixture_ids": [o["id"] for o in sales.items if o.get("section") == s]}
            for s in dict.fromkeys(o.get("section") for o in sales.items)
        ],
        "checkouts": [
            {"id": o["id"], "kind": o["role"], "queue_zone": o["queue_zone"]} for o in checkouts
        ],
        "parking": copy.deepcopy(spec.parking or {"kind": "unknown", "levels": None}),
    }
    add_parking(h, spec, core, catalog)
    from .outdoor import add_surface_parking

    add_surface_parking(h, spec, catalog)
    stamp_inference(h, 0.2)
    return h


def infer_store(spec: StoreInput, catalog=None):
    from .validate import validate_store

    catalog = catalog or Catalog()
    coords = list(spec.footprint.minimum_rotated_rectangle.exterior.coords)
    a, b = max(pairwise(coords), key=lambda ab: math.dist(*ab))
    angle = math.degrees(math.atan2(b[1] - a[1], b[0] - a[0]))
    if spec.entrances:
        e = spec.entrances[0]
        p = shape(e["segment"]).centroid if e.get("segment") else Point(e["point"])
        edge = min(
            (LineString([a, b]) for a, b in pairwise(spec.footprint.exterior.coords)),
            key=lambda e: e.distance(p),
        )
        a, b = list(edge.coords)
        angle = math.degrees(math.atan2(b[1] - a[1], b[0] - a[0]))
    failures = []
    for theta in dict.fromkeys([angle, angle + 180, angle + 90, angle - 90]):
        try:
            h = _build(spec, theta, catalog)
            h["validation"] = validate_store(h)
            if h["validation"]["passed"]:
                return h
            failures += h["validation"]["errors"][:3]
        except (ValueError, IndexError) as exc:
            failures.append(str(exc))
    raise ValueError("no plausible store layout: " + "; ".join(dict.fromkeys(failures))[:900])
