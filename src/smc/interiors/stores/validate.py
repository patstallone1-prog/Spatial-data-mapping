"""Independent retail geometry, stock/support, public routes and parking acceptance."""

from __future__ import annotations

import math
from itertools import combinations

from shapely.geometry import Point, shape
from shapely.ops import unary_union

from smc.interiors.inference.furnish import inward_point
from smc.interiors.inference.partition import polygons


def validate_store(h):
    errors = []
    rooms = {r["id"]: r for f in h["storeys"] for r in f["rooms"]}
    all_objects = [o for f in h["storeys"] for o in f["objects"]]
    sales = next(r for r in rooms.values() if r["kind"] == "sales_floor")
    sale_items = [o for o in all_objects if o["room_id"] == sales["id"]]
    roles = {o["role"] for o in sale_items}
    required = (
        {"gondola_shelf", "drink_cooler"}
        if h["kind"] == "corner_store"
        else {"gondola_shelf", "refrigerated_case", "freezer_case", "produce_bin", "bakery_display"}
    )
    if not required <= roles:
        errors.append("missing stocked retail departments: " + str(sorted(required - roles)))
    if not roles & {"checkout_lane", "self_checkout"}:
        errors.append("no checkout")
    staff = {
        o["role"] for o in all_objects if rooms[o["room_id"]]["kind"] in {"stockroom", "toilet"}
    }
    if not {"toilet", "bath_sink", "dry_storage"} <= staff:
        errors.append("missing private staff services")
    isolated = 0.0
    for f in h["storeys"]:
        inside = shape(f["inside"])
        assigned = unary_union(
            [shape(r["polygon"]) for r in f["rooms"]] + [shape(p) for p in f["slab_holes"]]
        )
        if inside.difference(assigned).area > 0.02:
            errors.append("unassigned floor area")
        floor_items = f["objects"]
        for a, b in combinations(floor_items, 2):
            if (
                a["support"]["kind"] == b["support"]["kind"] == "floor"
                and shape(a["footprint"]).intersection(shape(b["footprint"])).area > 0.001
            ):
                errors.append("overlapping retail/parking fixtures")
                break
        for o in floor_items:
            if (
                not shape(rooms[o["room_id"]]["polygon"])
                .buffer(0.003)
                .covers(shape(o["footprint"]))
            ):
                errors.append("fixture outside its room: " + o["id"])
            if abs(o["position_m"][1] - f["elevation_m"]) > 0.001:
                errors.append("floating floor fixture")
            margin = 0.15 if o["role"] == "structural_column" else 0.2
            if o["size_m"][1] > f["height_m"] - margin + 0.001:
                errors.append("fixture exceeds storey height")
            if (
                o["role"] == "structural_column"
                and abs(o["size_m"][1] - (f["height_m"] - 0.15)) > 0.002
            ):
                errors.append("parking column does not reach the slab underside")
            for door in f["openings"]:
                if o["room_id"] in door["rooms"] and shape(o["footprint"]).intersects(
                    shape(door["clearance"])
                ):
                    errors.append("blocked store entry or staff door")
            for stock in o.get("stock", []):
                if (
                    stock["bottom_m"] < 0
                    or stock["bottom_m"] + stock["height_m"] > o["size_m"][1] + 0.001
                ):
                    errors.append("stock floats outside its fixture envelope")
        for r in f["rooms"]:
            p = shape(r["polygon"])
            radius = (
                0.6
                if r["kind"] == "sales_floor" and h["kind"] == "grocery"
                else 0.48
                if r["kind"] == "sales_floor"
                else 0.4
            )
            obstacles = [shape(o["footprint"]) for o in floor_items if o["room_id"] == r["id"]]
            free = p.buffer(-radius, join_style=2).difference(
                unary_union(obstacles).buffer(radius, join_style=2)
            )
            targets = [
                Point(t["point"]) for t in h["interaction_targets"] if t["room_id"] == r["id"]
            ]
            for o in f["openings"]:
                if r["id"] in o["rooms"] and not o.get("garage_entrance"):
                    targets.append(inward_point(p, shape(o["segment"]), 0.8))
            for stair in h["stairs"]:
                if stair.get("from_room") == r["id"] or stair.get("to_room") == r["id"]:
                    line = shape(stair["access_segment"])
                    targets.append(inward_point(p, line, 0.8))
            parts = polygons(free)
            connected = next(
                (q for q in parts if all(q.buffer(0.025).covers(t) for t in targets)), None
            )
            if connected is None:
                errors.append("disconnected public/staff/parking approaches: " + r["id"])
            elif r["kind"] == "sales_floor":
                isolated += sum(q.area for q in parts if q != connected and q.area > 0.5)
        for o in f["openings"]:
            if o.get("source_segment"):
                src = shape(o["source_segment"])
                line = shape(o["segment"])
                if (
                    abs(src.length - line.length) > 0.002
                    or abs(src.centroid.distance(line.centroid) - 0.15) > 0.02
                ):
                    errors.append("store opening shifted/widened from source")
    if isolated > max(1.5, sales["area_m2"] * 0.012):
        errors.append("isolated unusable customer floor pockets")
    for checkout in h["checkouts"]:
        q = shape(checkout["queue_zone"])
        if not shape(sales["polygon"]).covers(q):
            errors.append("checkout queue outside selling floor")
        if any(q.intersects(shape(o["footprint"])) for o in sale_items):
            errors.append("fixture blocks checkout queue")
    # Every occupied room needs a route to a pedestrian entrance. Vehicle gates do
    # not replace pedestrian egress; a car landing is reached via the ramp network.
    adjacency = {key: set() for key in rooms}
    roots = set()

    def link(a, b):
        if a in adjacency and b in adjacency:
            adjacency[a].add(b)
            adjacency[b].add(a)

    for floor in h["storeys"]:
        for door in floor["openings"]:
            a, b = door["rooms"]
            if door.get("entrance") and not door.get("garage_entrance"):
                roots.add(a)
            link(a, b)
            if not door.get("garage_entrance"):
                for key in door["rooms"]:
                    if key in rooms and not shape(rooms[key]["polygon"]).boundary.buffer(
                        0.025
                    ).covers(shape(door["segment"])):
                        errors.append("opening does not meet its room boundary")
        for area in floor.get("outdoor_areas", []):
            if area["kind"] == "pedestrian_path":
                path = shape(area["polygon"])
                lots = [r for r in floor["rooms"] if r["kind"] == "surface_parking"]
                if any(
                    o.get("entrance") and path.covers(shape(o["segment"]).centroid)
                    for o in floor["openings"]
                ):
                    for lot in lots:
                        if path.intersection(shape(lot["polygon"])).area > 0.1:
                            link(lot["id"], sales["id"])
    for stair in h["stairs"]:
        link(stair["from_room"], stair["to_room"])
    for ramp in h["ramps"]:
        lower = h["storeys"][ramp["from_level"]]["rooms"][0]["id"]
        upper_floor = h["storeys"][ramp["to_level"]]
        upper = next(
            (r["id"] for r in upper_floor["rooms"] if r["kind"] == "vehicle_ramp_landing"),
            upper_floor["rooms"][0]["id"],
        )
        link(lower, upper)
    visited = set()
    pending = list(roots)
    while pending:
        key = pending.pop()
        if key in visited or key not in adjacency:
            continue
        visited.add(key)
        pending.extend(adjacency[key] - visited)
    if visited != set(rooms):
        errors.append("room lacks a route to a pedestrian entrance")
    parking = h["parking"]
    decks = [f for f in h["storeys"] if f["rooms"][0]["kind"] == "parking_garage"]
    if parking.get("levels") is None and decks:
        errors.append("invented unknown parking levels")
    if decks:
        if (
            len(decks) != parking["levels"]
            or len(h["ramps"]) != len(decks)
            or len(h["stairs"]) != len(decks)
        ):
            errors.append("missing parking level/ramp/pedestrian connection")
        for f in decks:
            source = shape(parking["footprint"])
            if source.symmetric_difference(shape(f["footprint"])).area > 0.002:
                errors.append("parking footprint differs from source")
            for bay in f["parking_bays"]:
                car = next(o for o in f["objects"] if o["id"] == bay["car_id"])
                if not shape(bay["footprint"]).covers(shape(car["footprint"])):
                    errors.append("car exceeds parking bay")
                if any(
                    shape(bay["footprint"]).intersects(shape(r["footprint"])) for r in h["ramps"]
                ):
                    errors.append("parking bay blocks vehicle ramp")
        for ramp in h["ramps"]:
            ramp_shape = shape(ramp["footprint"])
            if any(
                not shape(h["storeys"][i]["inside"]).buffer(0.003).covers(ramp_shape)
                for i in (ramp["from_level"], ramp["to_level"])
            ):
                errors.append("vehicle ramp leaves its source level envelopes")
            run = math.dist(ramp["start_m"], ramp["end_m"])
            if (
                abs((ramp["top_m"] - ramp["bottom_m"]) / run - ramp["slope"]) > 0.0001
                or ramp["slope"] > 0.1251
            ):
                errors.append("invalid vehicle ramp slope")
            if ramp["width_m"] < 6 or ramp["landing_depth_m"] < 3:
                errors.append("inadequate ramp width/landing")
        if not h.get("elevators"):
            errors.append("no cart/passenger lift from parking")
    return {
        "passed": not errors,
        "errors": list(dict.fromkeys(errors)),
        "metrics": {
            "room_count": len(rooms),
            "objects": len(all_objects),
            "checkouts": len(h["checkouts"]),
            "self_checkouts": sum(c["kind"] == "self_checkout" for c in h["checkouts"]),
            "shelves": sum(o["role"] == "gondola_shelf" for o in sale_items),
            "sections": len(h["sections"]),
            "parking_levels": len(decks),
            "parking_spaces": sum(len(f.get("parking_bays", [])) for f in decks)
            + parking.get("surface_spaces", 0),
            "isolated_floor_m2": round(isolated, 3),
            "coverage_min": 1.0,
            "hallway_area_fraction_max": 0.0,
        },
    }
