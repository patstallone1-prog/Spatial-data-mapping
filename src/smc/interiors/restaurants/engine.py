"""Constraint search for one restaurant tenant envelope, in metres.

No venue-specific geometry rules. Kitchen/WC/service precede capacity; a dining seat
is accepted only while every existing approach remains in one clear route component.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, replace
from itertools import combinations, pairwise

from shapely import affinity
from shapely.errors import GEOSException
from shapely.geometry import LineString, Point, Polygon, box, shape
from shapely.ops import unary_union

from smc.interiors.inference.catalog import Catalog
from smc.interiors.inference.engine import opening
from smc.interiors.inference.furnish import (
    RoomFurnisher,
    inward_point,
    obstacle_free_space,
    oriented_box,
)
from smc.interiors.inference.memo import geometry_cached, inference_session
from smc.interiors.inference.model import geo, polygon, stamp_inference
from smc.interiors.inference.partition import lines, polygons, shared, width
from smc.interiors.inference.style import door_finish, house_style, room_materials
from smc.interiors.restaurants.seating import (
    assembly,
    back_edge,
    frame_angles,
    solid_backing,
    wall_backed,
)

ROUTE_RADIUS = 0.475  # 0.95m clear customer route; design heuristic, not certification.
KITCHEN_ROLES = {
    "commercial_range",
    "prep_table",
    "commercial_fridge",
    "warewash_sink",
    "handwash_sink",
    "dry_storage",
    "commercial_hood",
    "dishwasher",
}


@dataclass(frozen=True)
class RestaurantInput:
    id: str
    footprint: Polygon
    height_m: float = 3.2
    entrance: tuple[float, float] | None = None
    average_spend_per_person: float | None = None
    currency: str = "USD"
    service_mode: str = "auto"
    bar: bool = False
    source: str = "caller supplied tenant envelope"
    economics_source: str = "unspecified"
    geometry_evidence: dict | None = None
    price_evidence: dict | None = None

    @classmethod
    def from_json(cls, row):
        if row.get("units", "metres") != "metres":
            raise ValueError("restaurant coordinates must be local metres")
        return cls(
            str(row["id"]),
            polygon(row["footprint"]),
            float(row.get("height_m", 3.2)),
            tuple(row["entrance"]) if row.get("entrance") else None,
            row.get("average_spend_per_person"),
            row.get("currency", "USD"),
            row.get("service_mode", "auto"),
            bool(row.get("bar", False)),
            row.get("source", "caller supplied tenant envelope"),
            row.get("economics_source", "unspecified"),
            row.get("geometry_evidence"),
            row.get("price_evidence"),
        )

    def __post_init__(self):
        polygon(self.footprint)
        if not self.id or not 28 <= self.footprint.area <= 1000:
            raise ValueError("restaurant pilot accepts a 28-1000 m² connected tenant envelope")
        if not math.isfinite(self.height_m) or not 2.5 <= self.height_m <= 6:
            raise ValueError("restaurant height must be 2.5-6m")
        if self.average_spend_per_person is not None and (
            not math.isfinite(self.average_spend_per_person) or self.average_spend_per_person <= 0
        ):
            raise ValueError("average spend must be positive and finite")
        if self.currency != "USD":
            raise ValueError(
                "supply USD spend or an explicit converted USD amount; no guessed exchange rates"
            )
        if self.service_mode not in {"auto", "pickup", "counter", "table", "bar"}:
            raise ValueError("unknown restaurant service mode")
        if self.entrance and self.footprint.boundary.distance(Point(self.entrance)) > 0.3:
            raise ValueError("entrance must be on the tenant outline")


def restaurant_style(spec):
    spend = spec.average_spend_per_person
    tier = (
        "economy"
        if spend is not None and spend < 22
        else "premium"
        if spend is not None and spend >= 55
        else "standard"
    )
    s = house_style(spec.id, spec.footprint.area, None)
    s.update(
        usage="restaurant",
        tier=tier,
        average_spend_per_person=spend,
        currency=spec.currency,
        economic_evidence=spec.economics_source,
        price_evidence=spec.price_evidence,
        furnishing_finish={
            "economy": "powder-coated metal & laminate",
            "standard": "timber & upholstered seating",
            "premium": "solid timber, leather & stone",
        }[tier],
        style="contemporary",
        booth_design=("channel", "tufted", "timber")[int(s["seed"]) % 3],
        furnishing_budget_usd=round(
            spec.footprint.area * {"economy": 120, "standard": 220, "premium": 380}[tier]
        ),
    )
    s.pop("neighborhood_price_per_sqft", None)
    if tier == "economy":
        s.update(wood="#c5bbaa", fabric="#b75640", metal="#777d80", stone="#d5d2c9")
    elif tier == "premium":
        s.update(wood="#624232", fabric="#586951", metal="#9e8963", stone="#ded5c7")
    return s


def _room(key, kind, p, style, index):
    return {
        "id": key,
        "kind": kind,
        "shape": p,
        "materials": room_materials(
            style, "kitchen" if kind == "professional_kitchen" else kind, index
        ),
    }


def _frame(spec, angle):
    inside = spec.footprint.buffer(-0.15, join_style=2)
    if inside.geom_type != "Polygon":
        raise ValueError("wall inset disconnects tenant envelope")
    local = affinity.rotate(inside, -angle, origin=(0, 0))
    return inside, local


def _parts(spec, style, angle, kitchen_fraction, side):
    inside, p = _frame(spec, angle)
    x0, y0, x1, y1 = p.bounds
    # All cuts happen in a footprint-derived frame and are transformed back exactly.
    kitchen = p.intersection(box(x0 - 1, y1 - (y1 - y0) * kitchen_fraction, x1 + 1, y1 + 1))
    front = p.intersection(box(x0 - 1, y0 - 1, x1 + 1, y1 - (y1 - y0) * kitchen_fraction))
    if (
        kitchen.geom_type != "Polygon"
        or front.geom_type != "Polygon"
        or kitchen.area < 11.5
        or width(kitchen) < 2.5
    ):
        raise ValueError("no workable back-of-house band")
    # WC at the back of the customer zone, adjacent to the service plumbing band.
    _, _, _, fy = front.bounds
    wx = x0 if side == 0 else x1 - 2.2
    toilet = front.intersection(box(wx, fy - 2.35, wx + 2.2, fy))
    dining = front.difference(toilet)
    if (
        toilet.geom_type != "Polygon"
        or dining.geom_type != "Polygon"
        or toilet.area < 4.4
        or width(toilet) < 1.9
    ):
        raise ValueError("no usable WC and continuous customer area")
    parts = [("dining", dining), ("professional_kitchen", kitchen), ("toilet", toilet)]
    if spec.bar or spec.service_mode == "bar":
        options = []
        # Search the customer polygon instead of assuming a rectangular corner is free.
        for bx in (x0, x1 - 3.6, (x0 + x1) / 2 - 1.8):
            for by in (y0 + 0.15, y0 + 0.9, max(y0 + 0.15, fy - 5.35)):
                candidate = dining.intersection(box(bx, by, bx + 3.6, min(by + 5.2, fy - 0.15)))
                remainder = dining.difference(candidate)
                if (
                    candidate.geom_type == "Polygon"
                    and remainder.geom_type == "Polygon"
                    and candidate.is_valid
                    and remainder.is_valid
                    and candidate.area >= 14
                    and width(candidate) >= 3.3
                    and shared(candidate, remainder).length >= 1.3
                ):
                    options.append((abs(candidate.area - 17), candidate, remainder))
        if not options:
            raise ValueError("bar does not fit with staff/customer circulation")
        _, bar, rest = min(options, key=lambda row: row[0])
        parts[0] = ("dining", rest)
        parts.append(("bar", bar))
    rooms = [
        _room(f"{spec.id}:L0:{i}", kind, affinity.rotate(q, angle, origin=(0, 0)), style, i)
        for i, (kind, q) in enumerate(parts)
    ]
    if any(not r["shape"].is_valid or r["shape"].area < 3 for r in rooms):
        raise ValueError("invalid or sliver room after cut")
    return inside, rooms


def _openings(spec, inside, rooms):
    dining = rooms[0]
    opens = []
    for room in rooms[1:]:
        edges = [e for e in lines(shared(room["shape"], dining["shape"])) if e.length >= 1.15]
        if not edges:
            raise ValueError("room has no customer/service access")
        line = max(edges, key=lambda q: q.length)
        kind = (
            "single_door"
            if room["kind"] == "toilet"
            else "doorway"
            if room["kind"] == "professional_kitchen"
            else "full_access"
        )
        opens.append(
            opening(
                room,
                dining,
                line,
                kind,
                len(opens),
                1.0 if kind == "single_door" else 1.3 if kind == "doorway" else None,
            )
        )
    edges = lines(dining["shape"].boundary.intersection(inside.boundary.buffer(0.002)))
    edges = [e for e in edges if e.length >= 1.3]
    if not edges:
        raise ValueError("no customer entrance frontage")
    if spec.entrance:
        line = min(edges, key=lambda e: e.distance(Point(spec.entrance)))
        if line.distance(Point(spec.entrance)) > 0.4:
            raise ValueError("input entrance is not in customer area")
        c = line.interpolate(line.project(Point(spec.entrance)))
        a, b = line.coords[0], line.coords[-1]
        t = max(0.6, min(line.length - 0.6, line.project(c)))
        c = line.interpolate(t)
        ux, uy = (b[0] - a[0]) / line.length, (b[1] - a[1]) / line.length
        line = LineString([(c.x - ux * 0.56, c.y - uy * 0.56), (c.x + ux * 0.56, c.y + uy * 0.56)])
    else:
        line = max(edges, key=lambda e: e.length)
    door = opening(dining, None, line, "single_door", len(opens), 1.1)
    door["entrance"] = True
    opens.append(door)
    return opens


def _furnisher(room, style, catalog, opens, radius=0.45):
    portals = [shape(o["segment"]) for o in opens if room["id"] in o["rooms"]]
    zones = [shape(o["clearance"]) for o in opens if room["id"] in o["rooms"]]
    return RoomFurnisher(room, style, catalog, portals, 0, portal_zones=zones, walk_radius=radius)


def _kitchen(room, style, catalog, opens):
    stations = (
        ("commercial_range", [(1.2, 0.8, 0.9), (0.9, 0.75, 0.9)]),
        ("warewash_sink", [(1.8, 0.7, 0.9), (1.5, 0.65, 0.9)]),
        ("prep_table", [(1.5, 0.7, 0.9), (1.1, 0.65, 0.9)]),
        ("commercial_fridge", [(0.9, 0.8, 2), (0.7, 0.75, 2)]),
        ("handwash_sink", [(0.45, 0.4, 0.85)]),
        ("dishwasher", [(0.6, 0.65, 0.85)]),
        ("dry_storage", [(0.8, 0.45, 1.8)]),
    )
    # Greedy wall packing can strand the last station. Compare deterministic orders
    # and compact equipment first before rejecting a small pickup kitchen.
    last_error = None
    for order in (stations, tuple(stations[i] for i in (1, 5, 0, 3, 2, 4, 6)), stations[::-1]):
        for compact in (False, True):
            f = _furnisher(room, style, catalog, opens)
            try:
                for role, sizes in order:
                    f.wall(role, sizes[::-1] if compact else sizes, required=True)
                break
            except ValueError as exc:
                last_error = exc
        else:
            continue
        break
    else:
        raise last_error
    f.wall("waste_bin", [(0.4, 0.4, 0.65)], required=False)
    _prep_island(f)
    cooker = next(o for o in f.items if o["role"] == "commercial_range")
    x, _, y = cooker["position_m"]
    w, _, d = cooker["size_m"]
    hood = f.put(
        "commercial_hood",
        x,
        y,
        w,
        d,
        0.45,
        cooker["rotation_deg"],
        supported_by=cooker,
        base_y=2.0,
        solid=False,
    )
    hood["support"] = {"kind": "wall", "id": room["id"], "surface_y_m": 2.0}
    hood["mount"] = "exhaust routing requires evidence"
    return f.items, [
        {"room_id": room["id"], "point": [q.x, q.y], "kind": "staff_workstation"} for q in f.targets
    ]


def _prep_island(f):
    """Fill a usable kitchen centre, preserving a 0.95m aisle on all four sides."""
    if f.p.area < 22:
        return
    centre = f.p.representative_point()
    for angle in frame_angles(f.p):
        radians = math.radians(angle)
        nx, ny = -math.sin(radians), math.cos(radians)
        for length in (2.4, 2.0, 1.6):
            for dx, dy in ((0, 0), (0.6, 0), (-0.6, 0), (0, 0.6), (0, -0.6)):
                x, y = centre.x + dx, centre.y + dy
                footprint = oriented_box(x, y, length, 0.8, angle)
                aisle = footprint.buffer(0.95, join_style=2)
                if not f.p.covers(aisle) or any(aisle.intersects(o) for o in f.obstacles):
                    continue
                targets = [Point(x + nx * sign * 0.925, y + ny * sign * 0.925) for sign in (-1, 1)]
                if not f.fits(footprint, targets[0]):
                    continue
                if (
                    _component(f.p, [*f.obstacles, footprint], f.starts + f.targets + targets, 0.45)
                    is None
                ):
                    continue
                item = f.put("prep_table", x, y, length, 0.8, 0.9, angle, target=targets[0])
                if item:
                    item.update(
                        placement="central_prep_island",
                        finish="stainless_steel",
                        work_aisle_m=0.95,
                        work_aisle=geo(aisle.difference(footprint)),
                        work_points_m=[[q.x, q.y] for q in targets],
                    )
                    f.targets.append(targets[1])
                    f.on_top(item, "cutting_board", (0.55, 0.35, 0.025))
                    return


@geometry_cached
def _route_inside(p, radius):
    return p.buffer(-radius, join_style=2)


def _component(p, obstacles, targets, radius=ROUTE_RADIUS):
    free = _route_inside(p, radius)
    free = obstacle_free_space(free, tuple(obstacles), radius)
    return next(
        (
            q
            for q in polygons(free)
            if all(expanded.covers(t) for expanded in [q.buffer(0.02)] for t in targets)
        ),
        None,
    )


def _seating(room, style, catalog, opens, mode):
    f = _furnisher(room, style, catalog, opens, ROUTE_RADIUS)
    counter = f.wall("service_counter", [(1.8, 0.65, 0.9), (1.2, 0.6, 0.9)], required=True)
    f.on_top(counter, "payment_terminal", (0.18, 0.14, 0.20))
    staff_targets = [
        {"room_id": room["id"], "point": [q.x, q.y], "kind": "service"} for q in f.targets
    ]
    obstacles = list(f.obstacles)
    starts = list(f.starts) + list(f.targets)
    queue_point = f.targets[-1]
    queue = queue_point.buffer(0.475).intersection(room["shape"])
    reservations = []
    occupied = []
    groups = []
    accessible = []
    if mode == "pickup":
        f.wall("pickup_shelf", [(0.9, 0.35, 1.15), (0.6, 0.35, 1.15)], required=False)
        return f.items, [], staff_targets, queue, []
    backing = solid_backing(room, opens)
    x0, y0, x1, y1 = room["shape"].bounds
    spots = [
        (x, y) for x in _steps(x0 + 0.7, x1 - 0.7, 0.55) for y in _steps(y0 + 0.7, y1 - 0.7, 0.55)
    ]
    spots.sort(key=lambda p: room["shape"].boundary.distance(Point(p)))

    candidate_positions = {}
    geometries = {}
    blocked = set()
    safe = room["shape"].buffer(-0.065)
    accessible_inside = room["shape"].buffer(-0.07)
    door_zones = [shape(o["clearance"]) for o in opens if room["id"] in o["rooms"]]
    angles = frame_angles(room["shape"])

    def place(seats, booth):
        n = seats // 2
        position_key = (seats, booth)
        if position_key in candidate_positions:
            candidates = candidate_positions[position_key]
        elif booth:
            candidates = []
            for bx, by, angle, _target, nx, ny in f.wall_spots(n * 0.72, 0.58):
                # The bench is already wall-backed; move the table in front of it.
                x, y = bx + nx * (0.29 + 0.12 + 0.39), by + ny * (0.29 + 0.12 + 0.39)
                candidates.append((x, y, angle))
        else:
            candidates = [(x, y, angle) for angle in angles for x, y in spots]
        candidate_positions[position_key] = candidates
        for x, y, angle in candidates:
            key = (seats, booth, x, y, angle)
            if key in blocked:
                continue
            if key not in geometries:
                defs, targets = assembly(x, y, angle, seats, booth)
                if booth:
                    bench = next(row for row in defs if row[0] == "booth")
                    if not wall_backed(
                        back_edge(bench[1], bench[2], bench[3], bench[4], bench[6]), backing
                    ):
                        blocked.add(key)
                        continue
                footprints = [oriented_box(a, b, c, d, rot) for _, a, b, c, d, _, rot in defs]
                seated = [
                    oriented_box(a, b, 0.55, 0.78, rot)
                    for role, a, b, _, _, _, rot in defs
                    if role == "dining_chair"
                ]
                occupied_shape = unary_union(footprints + seated)
                if (
                    not safe.covers(occupied_shape)
                    or occupied_shape.intersects(queue)
                    or any(occupied_shape.intersects(zone) for zone in door_zones)
                ):
                    blocked.add(key)
                    continue
                geometries[key] = (
                    defs,
                    targets,
                    footprints,
                    occupied_shape,
                    occupied_shape.buffer(0.08),
                )
            defs, targets, footprints, occupied_shape, padded = geometries[key]
            if any(padded.intersects(p) for p in obstacles + reservations):
                # Accepted furniture and reservations only grow. A footprint blocked
                # now cannot become available later in this same seating search.
                blocked.add(key)
                del geometries[key]
                continue
            for target in targets:
                acc = None
                if not accessible:
                    # Reserve a clear approach at this joined table's short end.
                    theta = math.radians(angle)
                    sign = (
                        1
                        if (target.x - x) * math.cos(theta) + (target.y - y) * math.sin(theta) > 0
                        else -1
                    )
                    acc = oriented_box(
                        x + sign * math.cos(theta) * (n * 0.72 / 2 + 0.63),
                        y + sign * math.sin(theta) * (n * 0.72 / 2 + 0.63),
                        1.22,
                        0.80,
                        angle,
                    )
                    if not accessible_inside.covers(acc) or any(
                        acc.intersects(p) for p in obstacles + reservations + [queue]
                    ):
                        continue
                if (
                    _component(
                        room["shape"], obstacles + occupied + [occupied_shape], [*starts, target]
                    )
                    is None
                ):
                    continue
                gid = f"{room['id']}:seating:{len(groups)}"
                items = []
                for role, a, b, c, d, h, rot in defs:
                    item = _item(f, role, a, b, c, d, h, rot)
                    item["seating_group"] = gid
                    if role == "booth":
                        item["seat_capacity"] = n
                        item["backing_segment"] = geo(back_edge(a, b, c, d, rot))
                    items.append(item)
                tables = [o for o in items if o["role"] == "dining_table"]
                for table in tables:
                    f.on_top(table, "table_item", (0.18, 0.12, 0.18))
                groups.append(
                    {
                        "id": gid,
                        "table_id": tables[0]["id"],
                        "table_ids": [o["id"] for o in tables],
                        "joined_modules": n,
                        "seat_count": seats,
                        "booth": booth,
                        "occupied_envelope": geo(occupied_shape),
                        "approach": [target.x, target.y],
                    }
                )
                obstacles.extend(footprints)
                reservations.append(occupied_shape)
                occupied.append(occupied_shape)
                starts.append(target)
                if acc is not None:
                    accessible.append(
                        {
                            "table_id": tables[0]["id"],
                            "clear_floor": geo(acc),
                            "approach": [target.x, target.y],
                        }
                    )
                    reservations.append(acc)
                return True
        return False

    # Reserve different party sizes before filling spare capacity. Booths never
    # consume every wall position before freestanding four/six-tops get a chance.
    for seats in (6, 4, 2):
        if seats > 2 and style["tier"] != "economy" and place(seats, True):
            continue
        place(seats, False)
    for index in range(60):
        placed = False
        for seats in (4, 2, 6) if index % 2 == 0 else (2, 4, 6):
            if place(seats, False):
                placed = True
                break
        if not placed:
            break
    if not groups:
        raise ValueError("no seating assembly with connected 0.95m routes")
    return (
        f.items,
        groups,
        staff_targets
        + [{"room_id": room["id"], "point": g["approach"], "kind": "dining"} for g in groups],
        queue,
        accessible,
    )


def _steps(a, b, step):
    while a <= b:
        yield a
        a += step


def _item(f, role, x, y, w, d, h, angle=0):
    # A complete seating assembly has already passed the physical/navigation check.
    item = {
        "id": f"{f.room['id']}:item:{len(f.items)}",
        "role": role,
        "position_m": [x, 0, y],
        "size_m": [w, h, d],
        "rotation_deg": angle,
        "footprint": geo(oriented_box(x, y, w, d, angle)),
        "room_id": f.room["id"],
        "support": {"kind": "floor", "id": f.room["id"], "surface_y_m": 0},
        "asset": f.catalog.choose(role, f.style, (w, h, d), f"{f.room['id']}:{len(f.items)}"),
        "materials": f.room["materials"],
        "grade": "inferred",
        "required": True,
    }
    f.items.append(item)
    return item


def _bar(room, style, catalog, opens):
    f = _furnisher(room, style, catalog, opens)
    counter = None
    for x, y, angle, _target, nx, ny in f.wall_spots(2.2, 0.6):
        x += nx * 1.05
        y += ny * 1.05
        rear = oriented_box(x - nx * 0.83, y - ny * 0.83, 2.2, 1.0, angle)
        if not room["shape"].buffer(-0.06).covers(rear):
            continue
        front = Point(x + nx * 0.85, y + ny * 0.85)
        back = Point(x - nx * 0.83, y - ny * 0.83)
        if not f.reachable(oriented_box(x, y, 2.2, 0.6, angle), back):
            continue
        counter = f.put("bar_counter", x, y, 2.2, 0.6, 1.05, angle, target=front, required=True)
        if counter:
            f.targets.append(back)
            f.reservations.append(rear)
            counter["staff_aisle"] = geo(rear)
            theta = math.radians(angle)
            for along in (-0.7, 0, 0.7):
                sx = x + math.cos(theta) * along + nx * 0.78
                sy = y + math.sin(theta) * along + ny * 0.78
                f.put(
                    "bar_stool",
                    sx,
                    sy,
                    0.42,
                    0.42,
                    0.8,
                    angle + 180,
                    target=Point(sx + nx * 0.65, sy + ny * 0.65),
                )
            break
    if counter is None:
        raise ValueError("no bar counter with staff aisle fits")
    return f.items, [{"room_id": room["id"], "point": [p.x, p.y], "kind": "bar"} for p in f.targets]


def _build(spec, style, inside, rooms, opens, catalog):
    mode = (
        spec.service_mode
        if spec.service_mode != "auto"
        else "pickup"
        if inside.area < 60
        else "table"
    )
    for o in opens:
        if o["leaf_count"]:
            room = next(r for r in rooms if r["id"] == o["rooms"][0])
            o["appearance"] = door_finish(style, room["kind"], o["id"], o.get("entrance", False))
    objects = []
    targets = []
    groups = []
    accessible = []
    queue = None
    for r in rooms:
        if r["kind"] == "professional_kitchen":
            items, ts = _kitchen(r, style, catalog, opens)
        elif r["kind"] == "toilet":
            f = _furnisher(r, style, catalog, opens)
            f.wall("toilet", [(0.65, 0.75, 0.8)], required=True)
            f.wall("bath_sink", [(0.5, 0.42, 0.85)], required=True)
            items = f.items
            ts = [{"room_id": r["id"], "point": [p.x, p.y], "kind": "restroom"} for p in f.targets]
        elif r["kind"] == "bar":
            items, ts = _bar(r, style, catalog, opens)
        else:
            items, groups, ts, queue, accessible = _seating(r, style, catalog, opens, mode)
        objects += items
        targets += ts
    walls = []
    for a, b in combinations(rooms, 2):
        if {a["kind"], b["kind"]} == {"dining", "bar"}:
            continue
        boundary = shared(a["shape"], b["shape"])
        for o in opens:
            if set(o["rooms"]) == {a["id"], b["id"]}:
                boundary = boundary.difference(shape(o["segment"]).buffer(0.001))
        for line in lines(boundary):
            walls.append(
                {
                    "segment": geo(line),
                    "height_m": spec.height_m - 0.12,
                    "thickness_m": 0.1,
                    "materials": [a["materials"]["wall"], b["materials"]["wall"]],
                    "side_materials": (
                        [a["materials"]["wall"], b["materials"]["wall"]]
                        if a["shape"].covers(
                            Point(
                                line.centroid.x
                                - (line.coords[-1][1] - line.coords[0][1]) / line.length * 0.1,
                                line.centroid.y
                                + (line.coords[-1][0] - line.coords[0][0]) / line.length * 0.1,
                            )
                        )
                        else [b["materials"]["wall"], a["materials"]["wall"]]
                    ),
                    "rooms": [a["id"], b["id"]],
                }
            )
    ring = list(spec.footprint.exterior.coords)
    door = next(o for o in opens if o.get("entrance"))
    centre = shape(door["segment"]).centroid
    edge = min(range(len(ring) - 1), key=lambda i: LineString(ring[i : i + 2]).distance(centre))
    a, b = ring[edge], ring[edge + 1]
    length = math.dist(a, b)
    door_u = LineString([a, b]).project(centre)
    windows = []
    for i, (lo, hi) in enumerate(((0.25, door_u - 0.75), (door_u + 0.75, length - 0.25))):
        if hi - lo > 0.5:
            windows.append(
                {
                    "id": spec.id + ":storefront:" + str(i),
                    "kind": "window",
                    "edge": edge,
                    "a": a,
                    "b": b,
                    "u": lo,
                    "w": hi - lo,
                    "v": 0.18,
                    "h": min(2.3, spec.height_m - 0.5),
                    "grade": "procedural_tenant_frontage_not_measured",
                }
            )
    return {
        "schema": "kerbside.inferred_restaurant/1",
        "fixture_revision": "flat-prep-board-v1",
        "id": spec.id,
        "grade": "inferred",
        "confidence": 0.2,
        "measured": False,
        "provenance": {
            "footprint": spec.source,
            "tenant_boundary": "supplied or assumed; not measured",
            "economics": spec.economics_source,
            "geometry": spec.geometry_evidence,
            "price_evidence": spec.price_evidence,
            "freshness": None,
            "corroboration_count": 0,
        },
        "envelope": {"windows": windows, "balconies": [], "measured": False},
        "units": "metres",
        "style": style,
        "service_mode": mode,
        "total_height_m": spec.height_m,
        "footprint_area_m2": spec.footprint.area,
        "footprint_area_sqft": spec.footprint.area * 10.7639104167,
        "stairs": [],
        "seating": groups,
        "accessible_dining": accessible,
        "interaction_targets": targets,
        "queue_zone": geo(queue) if queue is not None else None,
        "storeys": [
            {
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
                "walls": walls,
                "openings": opens,
                "objects": objects,
            }
        ],
    }


def space_audit(h):
    """Unreachable walkable pockets are waste; active aisles and seated space are useful."""
    f = h["storeys"][0]
    stranded = 0.0
    for room in f["rooms"]:
        p = shape(room["polygon"])
        obstacles = [
            shape(o["footprint"])
            for o in f["objects"]
            if o["room_id"] == room["id"] and o["support"]["kind"] == "floor"
        ]
        if room["kind"] == "dining":
            obstacles += [shape(g["occupied_envelope"]) for g in h["seating"]]
        radius = ROUTE_RADIUS if room["kind"] == "dining" else 0.45
        free = p.buffer(-radius, join_style=2)
        if obstacles:
            free = free.difference(unary_union(obstacles).buffer(radius, join_style=2))
        approaches = [
            inward_point(p, shape(o["segment"])) for o in f["openings"] if room["id"] in o["rooms"]
        ]
        for part in polygons(free):
            if part.area >= 0.5 and not any(part.buffer(0.02).covers(q) for q in approaches):
                stranded += part.area
    return {
        "isolated_clear_floor_m2": stranded,
        "usable_area_m2": shape(f["inside"]).area,
        "objective": "connected service routes, low isolated floor area, then seated capacity",
    }


def validate_restaurant(h):
    errors = []
    f = h["storeys"][0]
    rooms = {r["id"]: shape(r["polygon"]) for r in f["rooms"]}
    inside = shape(f["inside"])
    objects = f["objects"]
    ps = {o["id"]: shape(o["footprint"]) for o in objects}
    coverage = unary_union(list(rooms.values())).intersection(inside).area / inside.area
    if coverage < 0.9999:
        errors.append("unassigned usable floor area")
    for a, b in combinations(rooms, 2):
        if rooms[a].intersection(rooms[b]).area > 0.001:
            errors.append("overlapping rooms")
    for o in objects:
        if not rooms[o["room_id"]].buffer(0.002).covers(ps[o["id"]]):
            errors.append("object outside its room: " + o["id"])
        if o["support"]["kind"] == "floor":
            if abs(o["position_m"][1]) > 0.001:
                errors.append("floating floor object")
            for door in f["openings"]:
                if o["room_id"] in door["rooms"] and ps[o["id"]].intersects(
                    shape(door["clearance"])
                ):
                    errors.append("blocked opening")
        if o["support"]["kind"] == "object":
            parent = next((q for q in objects if q["id"] == o["support"]["id"]), None)
            if (
                parent is None
                or abs(o["position_m"][1] - parent["position_m"][1] - parent["size_m"][1]) > 0.001
            ):
                errors.append("floating table prop")
            elif (
                math.dist(
                    [o["position_m"][0], o["position_m"][2]],
                    [parent["position_m"][0], parent["position_m"][2]],
                )
                > 0.001
            ):
                errors.append("uncentred table prop")
    for prop in objects:
        if prop["support"]["kind"] == "object":
            parent = next((o for o in objects if o["id"] == prop["support"]["id"]), None)
            if parent and not ps[parent["id"]].buffer(0.001).covers(ps[prop["id"]]):
                errors.append("table prop overhang")
    for group in h["seating"]:
        members = [o for o in objects if o.get("seating_group") == group["id"]]
        seats = sum(
            o.get("seat_capacity", 2)
            if o["role"] == "booth"
            else 1
            if o["role"] == "dining_chair"
            else 0
            for o in members
        )
        if seats != group["seat_count"]:
            errors.append("seating capacity does not match furniture")
        if any(
            not shape(group["occupied_envelope"]).buffer(0.001).covers(ps[o["id"]]) for o in members
        ):
            errors.append("seated clearance omits furniture")
    chairs = {o["asset"]["id"] for o in objects if o["role"] == "dining_chair"}
    booths = {o["asset"]["id"] for o in objects if o["role"] == "booth"}
    if len(chairs) > 1 or len(booths) > 1:
        errors.append("inconsistent seating design within restaurant")
    for booth in (o for o in objects if o["role"] == "booth"):
        r = next(r for r in f["rooms"] if r["id"] == booth["room_id"])
        backing = solid_backing({**r, "shape": rooms[r["id"]]}, f["openings"])
        x, _, y = booth["position_m"]
        w, _, d = booth["size_m"]
        if not wall_backed(back_edge(x, y, w, d, booth["rotation_deg"]), backing):
            errors.append("booth back is not against a solid wall")
    for group in h["seating"]:
        table_ids = group.get("table_ids", [group["table_id"]])
        if group["seat_count"] not in {2, 4, 6} or len(table_ids) * 2 != group["seat_count"]:
            errors.append("invalid modular table capacity")
        tables = [o for o in objects if o["id"] in table_ids]
        if len(tables) != len(table_ids) or any(o["role"] != "dining_table" for o in tables):
            errors.append("missing joined table module")
        elif (
            len(tables) > 1
            and unary_union([ps[o["id"]].buffer(0.003) for o in tables]).geom_type != "Polygon"
        ):
            errors.append("joined table modules are separated")
    for counter in objects:
        if counter.get("placement") == "central_prep_island":
            aisle = ps[counter["id"]].buffer(0.95, join_style=2).difference(ps[counter["id"]])
            if counter["role"] != "prep_table" or not rooms[counter["room_id"]].covers(aisle):
                errors.append("invalid prep island clearance")
            if any(
                aisle.intersection(ps[o["id"]]).area > 0.001
                for o in objects
                if o["id"] != counter["id"] and o["support"]["kind"] == "floor"
            ):
                errors.append("prep island working aisle blocked")
        if counter.get("staff_aisle"):
            aisle = shape(counter["staff_aisle"])
            if any(
                aisle.intersection(ps[o["id"]]).area > 0.001
                for o in objects
                if o["support"]["kind"] == "floor"
            ):
                errors.append("bar staff aisle blocked")
    for a, b in combinations(objects, 2):
        if (
            min(a["position_m"][1] + a["size_m"][1], b["position_m"][1] + b["size_m"][1])
            - max(a["position_m"][1], b["position_m"][1])
            > 0.002
            and ps[a["id"]].intersection(ps[b["id"]]).area > 0.001
        ):
            errors.append("colliding objects")
    roles = {o["role"] for o in objects}
    if not roles >= KITCHEN_ROLES:
        errors.append("missing professional kitchen station")
    if not {"toilet", "bath_sink", "service_counter", "payment_terminal"} <= roles:
        errors.append("missing service or sanitary inventory")
    edges = [set(o["rooms"]) for o in f["openings"]]
    seen = {"outside"}
    while True:
        before = len(seen)
        for e in edges:
            if e & seen:
                seen |= e
        if len(seen) == before:
            break
    if not set(rooms) <= seen:
        errors.append("disconnected room")
    for room_id, p in rooms.items():
        starts = [
            inward_point(p, shape(o["segment"])) for o in f["openings"] if room_id in o["rooms"]
        ]
        targets = [Point(t["point"]) for t in h["interaction_targets"] if t["room_id"] == room_id]
        obstacles = [
            ps[o["id"]]
            for o in objects
            if o["room_id"] == room_id and o["support"]["kind"] == "floor"
        ]
        is_dining = next(r for r in f["rooms"] if r["id"] == room_id)["kind"] == "dining"
        if is_dining:
            obstacles += [shape(g["occupied_envelope"]) for g in h["seating"]]
        if _component(p, obstacles, starts + targets, ROUTE_RADIUS if is_dining else 0.45) is None:
            errors.append("unreachable workstation/seat: " + room_id)
    if h["service_mode"] != "pickup" and not h["seating"]:
        errors.append("no usable dining capacity")
    for a in h["accessible_dining"]:
        clear = shape(a["clear_floor"])
        if not inside.covers(clear) or any(
            clear.intersection(ps[o["id"]]).area > 0.001
            for o in objects
            if o["support"]["kind"] == "floor"
        ):
            errors.append("blocked accessible dining approach")
    return {
        "passed": not errors,
        "errors": sorted(set(errors)),
        "metrics": {
            "coverage_min": coverage,
            "room_count": len(rooms),
            "objects": len(objects),
            "seats": sum(g["seat_count"] for g in h["seating"]),
            "tables": len(h["seating"]),
            "table_sizes": {
                str(n): sum(g["seat_count"] == n for g in h["seating"]) for n in (2, 4, 6)
            },
            "table_modules": sum(len(g.get("table_ids", [g["table_id"]])) for g in h["seating"]),
            "booths": sum(g["booth"] for g in h["seating"]),
            "prep_islands": sum(o.get("placement") == "central_prep_island" for o in objects),
            "customer_route_width_m": 0.95,
            "staff_route_width_m": 0.9,
            "downloaded_assets_used": sum(not o["asset"]["procedural"] for o in objects),
        },
    }


@inference_session
def infer_restaurant(spec: RestaurantInput, catalog=None):
    catalog = catalog or Catalog()
    style = restaurant_style(spec)
    rect = list(spec.footprint.minimum_rotated_rectangle.exterior.coords)
    a, b = max(pairwise(rect), key=lambda ab: math.dist(*ab))
    base = math.degrees(math.atan2(b[1] - a[1], b[0] - a[0]))
    failures = []
    solutions = []
    for rotation in (0, 90, 180, 270):
        for fraction in (
            (0.35, 0.42, 0.50, 0.30, 0.55, 0.60)
            if spec.service_mode == "pickup"
            else (0.35, 0.42, 0.50, 0.30)
        ):
            for side in (0, 1):
                try:
                    inside, rooms = _parts(spec, style, base + rotation, fraction, side)
                    opens = _openings(spec, inside, rooms)
                    result = _build(spec, style, inside, rooms, opens, catalog)
                    stamp_inference(result, 0.2)
                    result["validation"] = validate_restaurant(result)
                    if not result["validation"]["passed"]:
                        raise ValueError("; ".join(result["validation"]["errors"]))
                    result["space_efficiency"] = space_audit(result)
                    result["validation"]["metrics"].update(
                        isolated_clear_floor_m2=result["space_efficiency"][
                            "isolated_clear_floor_m2"
                        ]
                    )
                    score = (
                        sum(g["seat_count"] for g in result["seating"])
                        + len({g["seat_count"] for g in result["seating"]}) * 2
                        + sum(g["booth"] for g in result["seating"]) * 0.2
                        - result["space_efficiency"]["isolated_clear_floor_m2"] * 5
                    )
                    solutions.append((score, result))
                    # Evaluate multiple orientations without tuning to the first successful venue.
                    if len(solutions) >= 4:
                        break
                except (ValueError, GEOSException) as exc:
                    failures.append(str(exc))
            if len(solutions) >= 4:
                break
        if len(solutions) >= 4:
            break
    if not solutions and spec.bar and spec.service_mode != "bar":
        # Optional amenity: never remove required kitchen/WC/circulation to force it in.
        result = infer_restaurant(replace(spec, bar=False), catalog)
        result["omitted_optional_features"] = ["bar: no feasible counter and staff aisle"]
        result["optional_feature_rejections"] = list(dict.fromkeys(failures))
        return result
    if not solutions:
        raise ValueError("no feasible restaurant: " + "; ".join(dict.fromkeys(failures))[:1400])
    _, result = max(solutions, key=lambda x: x[0])
    result["search"] = {
        "candidates_tried": len(failures) + len(solutions),
        "valid_candidates": len(solutions),
        "rejections": list(dict.fromkeys(failures)),
        "address_specific_rules": False,
    }
    return result
