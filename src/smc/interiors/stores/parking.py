"""Optional source-bounded parking decks, continuous ramps and pedestrian cores."""

from __future__ import annotations

import copy
import math

from shapely import affinity
from shapely.geometry import LineString, Point, box, shape
from shapely.ops import unary_union

from smc.interiors.inference.engine import opening, stairs
from smc.interiors.inference.furnish import RoomFurnisher, inward_point
from smc.interiors.inference.model import geo, polygon


def parking_core(spec, sales, angle):
    parking = spec.parking or {}
    if parking.get("kind") not in {"garage", "mixed"} or parking.get("levels") is None:
        return None
    gp = polygon(parking["footprint"]).buffer(-0.15, join_style=2)
    if gp.geom_type != "Polygon":
        raise ValueError("wall inset disconnects garage footprint")
    common = gp.intersection(sales["shape"]).buffer(-0.15, join_style=2)
    local = affinity.rotate(common, -angle, origin=(0, 0))
    x0, y0, x1, y1 = local.bounds
    height = float(parking.get("storey_height_m", 3.2))
    if not 2.7 <= height <= 4:
        raise ValueError("parking storey height must be 2.7-4m")
    ramp_program = _ramp(spec, gp, angle, height)
    ramp_world, reserve_world = ramp_program["ramp"], ramp_program["ramp_reservation"]
    ramp_reserve = affinity.rotate(reserve_world, -angle, origin=(0, 0))
    if not spec.footprint.buffer(0.003).covers(ramp_world):
        raise ValueError("upper ramp needs a supplied street/store landing envelope")
    for x in [x0 + 0.05, x1 - 5.35]:
        for y in [y0 + 1.6, y1 - 6.1, (y0 + y1) / 2 - 3]:
            core = box(x, y, x + 2.4, y + 5.8)
            lift = box(x + 2.6, y + 2.8, x + 5.2, y + 5.8)
            landing = box(x - 0.1, y - 1.5, x + 5.3, y)
            reserve = unary_union([core, lift, landing]).convex_hull
            if local.covers(reserve) and not reserve.intersects(ramp_reserve):

                def transform(p):
                    return affinity.rotate(p, angle, origin=(0, 0))

                access = transform(LineString([(x, y), (x + 2.4, y)]))
                return {
                    "core": transform(core),
                    "lift": transform(lift),
                    "landing": transform(landing),
                    "access": access,
                    "reservation": transform(reserve),
                    **ramp_program,
                    "height": height,
                }
    raise ValueError("no shared store/garage stair-and-lift core fits source footprints")


def _ramp(spec, inside, angle, height):
    """A supplied vehicle opening determines the ramp frame, centre and street end."""
    parking = spec.parking
    source = parking.get("vehicle_entrance")
    source_line = None
    if source:
        if not source.get("segment"):
            raise ValueError("vehicle entrance requires its source facade segment")
        source_line = shape(source["segment"])
        if (
            source_line.geom_type != "LineString"
            or len(source_line.coords) != 2
            or not polygon(parking["footprint"]).boundary.buffer(0.06).covers(source_line)
        ):
            raise ValueError("vehicle entrance is off the source garage outline")
        if not 6 <= source_line.length <= 12:
            raise ValueError("current two-way grocery ramp needs a 6-12m source opening")
        a, b = source_line.coords
        angle = math.degrees(math.atan2(b[1] - a[1], b[0] - a[0]))
        local = affinity.rotate(inside, -angle, origin=(0, 0))
        gate_local = affinity.rotate(source_line, -angle, origin=(0, 0))
        if local.representative_point().y > gate_local.centroid.y:
            angle += 180
        target = inward_point(polygon(parking["footprint"]), source_line, 0.15)
        c = source_line.centroid
        gate = affinity.translate(source_line, target.x - c.x, target.y - c.y)
        gate_local = affinity.rotate(gate, -angle, origin=(0, 0))
        cx, gy = gate_local.centroid.x, gate_local.centroid.y
    else:
        local = affinity.rotate(inside, -angle, origin=(0, 0))
        _x0, _y0, x1, y1 = local.bounds
        cx, gy = x1 - 3.25, y1
        gate_local = LineString([(cx - 3, gy), (cx + 3, gy)])
        gate = affinity.rotate(gate_local, angle, origin=(0, 0))
    if spec.footprint.boundary.distance(gate.centroid) > 0.21:
        raise ValueError("street ramp access needs an exterior landing on the store shell")
    run = height / 0.125
    ramp = box(cx - 3, gy - 3 - run, cx + 3, gy - 3)
    reserve = box(cx - 3.75, gy - 6 - run, cx + 3.25, gy)

    def world(p):
        return affinity.rotate(p, angle, origin=(0, 0))

    if not inside.buffer(0.003).covers(world(reserve)):
        raise ValueError("source garage outline cannot contain ramp and landings")
    lx0, _ly0, lx1, _ly1 = affinity.rotate(inside, -angle, origin=(0, 0)).bounds
    lo, hi = cx - max(3.75, gate.length / 2), cx + max(3.25, gate.length / 2)
    # Absorb strips too narrow for a grocery aisle into the vehicle enclosure.
    if lo - lx0 < 1.5:
        lo = lx0
    if lx1 - hi < 1.5:
        hi = lx1
    upper = world(box(lo, gy - 3 - run, hi, gy)).intersection(inside)
    if upper.geom_type != "Polygon":
        raise ValueError("vehicle landing is disconnected by the source shell")
    return {
        "upper_vehicle_zone": upper,
        "ramp": world(ramp),
        "ramp_reservation": world(reserve),
        "angle": angle,
        "start": next(iter(world(Point(cx, gy - 3 - run)).coords)),
        "end": next(iter(world(Point(cx, gy - 3)).coords)),
        "gate": gate,
        "gate_source": copy.deepcopy(source),
        "gate_source_segment": geo(source_line) if source_line is not None else None,
    }


def add_parking(h, spec, core, catalog):
    parking = spec.parking or {}
    h["parking"].setdefault("levels", None)
    if not core:
        if parking.get("kind") in {"garage", "mixed"}:
            h["parking"]["render_status"] = "unresolved level count; no basement invented"
        else:
            h["parking"]["render_status"] = "external/unknown parking retained as evidence"
        return
    count = parking["levels"]
    height = core["height"]
    style = h["style"]
    store = h["storeys"][0]
    store["level"] = count
    # Upper slab openings expose the ramp and stair rather than a solid floor cap.
    holes = [core["core"], core["ramp"]]
    for room in store["rooms"]:
        p = shape(room["polygon"])
        q = p.difference(unary_union(holes))
        if q.geom_type != "Polygon":
            raise ValueError("parking void disconnects store selling/staff area")
        room.update(polygon=geo(q), area_m2=q.area)
    store["slab_holes"] = [geo(p) for p in holes]
    h["elevators"] = [
        {
            "id": spec.id + ":lift",
            "footprint": geo(core["lift"]),
            "levels": list(range(count + 1)),
            "kind": "passenger_and_carts",
            "door_segment": geo(LineString(list(core["lift"].exterior.coords)[:2])),
            "grade": "inferred",
            "measured": False,
        }
    ]
    decks = []
    p = polygon(parking["footprint"])
    inside = p.buffer(-0.15, join_style=2)
    local = affinity.rotate(inside, -core["angle"], origin=(0, 0))
    x0, y0, x1, y1 = local.bounds
    for level in range(count):
        elevation = -(count - level) * height
        room = {
            "id": f"{spec.id}:parking:{level}",
            "kind": "parking_garage",
            "shape": inside,
            "materials": {"wall": "#d8d9d1", "floor": "#9caaa7", "floor_finish": "concrete"},
        }
        f = RoomFurnisher(
            room,
            style,
            catalog,
            [core["access"]],
            elevation,
            portal_zones=[core["reservation"]],
            walk_radius=0.5,
        )
        f.reservations = [core["ramp_reservation"]]
        bays = []
        # Double-loaded 6m drive aisles remain continuous around the fixed core.
        rows = []
        y = y0 + 3.2
        row_index = 0
        while y < y1 - 3:
            rows.append((y, 1 if row_index % 2 == 0 else -1))
            y += 11.6 if row_index % 2 == 0 else 5.6
            row_index += 1
        for y, side in rows:
            for x in _range(x0 + 1.7, x1 - 8.5, 2.8):
                point = affinity.rotate(Point(x, y), core["angle"], origin=(0, 0))
                target = affinity.rotate(Point(x, y + side * 3.35), core["angle"], origin=(0, 0))
                bay = affinity.rotate(
                    box(x - 1.35, y - 2.7, x + 1.35, y + 2.7), core["angle"], origin=(0, 0)
                )
                if not inside.covers(bay) or any(
                    bay.intersects(z) for z in [core["reservation"], core["ramp_reservation"]]
                ):
                    continue
                car = f.put(
                    "parked_car", point.x, point.y, 1.85, 4.8, 1.5, core["angle"], target=target
                )
                if car:
                    bays.append(
                        {
                            "car_id": car["id"],
                            "footprint": geo(bay),
                            "approach_m": [target.x, target.y],
                            "kind": "standard",
                        }
                    )
        if len(bays) < 2:
            raise ValueError("garage has no usable parking with pedestrian circulation")
        # A conceptual support grid: columns avoid bays, ramps, stairs and their routes.
        for x in _range(x0 + 7.5, x1 - 7, 7.5):
            for y in _range(y0 + 8, y1 - 3, 8):
                point = affinity.rotate(Point(x, y), core["angle"], origin=(0, 0))
                footprint = point.buffer(0.45, cap_style=3)
                if any(footprint.intersects(shape(b["footprint"])) for b in bays):
                    continue
                f.put("structural_column", point.x, point.y, 0.4, 0.4, height - 0.15, core["angle"])
        stair = stairs(core["core"], inside, elevation, height, level, core["access"])
        stair.update(
            from_room=room["id"],
            to_room=f"{spec.id}:parking:{level + 1}" if level < count - 1 else spec.id + ":sales",
        )
        h["stairs"].append(stair)
        ramp = {
            "id": f"{spec.id}:ramp:{level}",
            "from_level": level,
            "to_level": level + 1,
            "footprint": geo(core["ramp"]),
            "start_m": list(core["start"]),
            "end_m": list(core["end"]),
            "bottom_m": elevation,
            "top_m": elevation + height,
            "width_m": 6.0,
            "slope": 0.125,
            "two_way": True,
            "landing_depth_m": 3.0,
            "street_access": level == count - 1,
            "grade": "inferred",
            "measured": False,
        }
        h["ramps"].append(ramp)
        holes = [geo(core["core"])] if level else []
        if level:
            holes.append(geo(core["ramp"]))
        deck = {
            "level": level,
            "elevation_m": elevation,
            "height_m": height,
            "footprint": geo(p),
            "inside": geo(inside),
            "slab_holes": holes,
            "rooms": [
                {k: v for k, v in room.items() if k != "shape"}
                | {
                    "polygon": geo(inside.difference(unary_union([shape(q) for q in holes]))),
                    "area_m2": inside.area - unary_union([shape(q) for q in holes]).area,
                }
            ],
            "objects": f.items,
            "walls": [],
            "openings": [],
            "parking_bays": bays,
        }
        decks.append(deck)
        h["interaction_targets"] += [
            {"room_id": room["id"], "point": [q.x, q.y], "kind": "parking"} for q in f.targets
        ]
    gate_height = float((core.get("gate_source") or {}).get("height_m", 2.5))
    if not 2.1 <= gate_height <= min(height, spec.height_m) - 0.15:
        raise ValueError("vehicle opening height conflicts with parking/store headroom")
    gate = opening({"id": spec.id + ":vehicle"}, None, core["gate"], "garage_door", 999)
    gate.update(
        entrance=True,
        garage_entrance=True,
        type="garage_door",
        leaf_count=1,
        height_m=gate_height,
        source_opening=core.get("gate_source") or {"basis": "inferred ramp street access"},
    )
    if core.get("gate_source_segment"):
        gate["source_segment"] = core["gate_source_segment"]
    store["openings"].append(gate)
    h["storeys"] = [*decks, store]
    for floor in h["storeys"]:
        ring = list(core["lift"].exterior.coords)
        for i in range(1, len(ring) - 1):
            floor["walls"].append(
                {
                    "segment": geo(LineString(ring[i : i + 2])),
                    "height_m": floor["height_m"] - 0.15,
                    "thickness_m": 0.08,
                    "materials": ["#a0b2ad", "#a0b2ad"],
                    "rooms": [floor["rooms"][0]["id"]],
                }
            )
    h["total_height_m"] = count * height + spec.height_m
    h["parking"].update(
        render_status="inferred decks on supplied footprint",
        parking_bays=sum(len(f["parking_bays"]) for f in decks),
        structural_status="conceptual column grid; structural review required",
    )


def _range(a, b, step):
    while a < b:
        yield a
        a += step
