"""Independent acceptance checks on the serialized house, not solver-internal claims."""

from __future__ import annotations

import math
from itertools import combinations

from shapely.geometry import Point, shape
from shapely.ops import unary_union

from smc.interiors.inference.efficiency import blind_corridor_ends
from smc.interiors.inference.partition import polygons


def validate_house(house: dict) -> dict:
    errors, warnings = [], []
    metrics = {
        "room_count": 0,
        "objects": 0,
        "coverage_min": 1.0,
        "hallway_area_fraction_max": 0.0,
        "downloaded_assets_used": 0,
    }
    nodes, edges = set(), []
    elevations = 0.0
    all_objects = {}
    for floor in house["storeys"]:
        level = floor["level"]
        inside = shape(floor["inside"])
        rooms = {r["id"]: r for r in floor["rooms"]}
        shapes = {key: shape(r["polygon"]) for key, r in rooms.items()}
        metrics["room_count"] += len(rooms)
        nodes.update(rooms)
        union = unary_union(list(shapes.values()))
        coverage = union.intersection(inside).area / inside.area
        metrics["coverage_min"] = min(metrics["coverage_min"], coverage)
        if coverage < 0.9999 or union.difference(inside.buffer(0.002)).area > 0.002:
            errors.append(f"L{level}: rooms do not cover the interior exactly")
        for (a, p), (b, q) in combinations(shapes.items(), 2):
            if p.intersection(q).area > 0.002:
                errors.append(f"overlapping rooms {a}, {b}")
        for key, p in shapes.items():
            if not p.is_valid or p.geom_type != "Polygon":
                errors.append(f"invalid/disconnected room {key}")
            if not shape(floor["footprint"]).buffer(0.002).covers(p):
                errors.append(f"room outside footprint {key}")
        hall_area = sum(shapes[k].area for k, r in rooms.items() if r["kind"] == "hallway")
        metrics["hallway_area_fraction_max"] = max(
            metrics["hallway_area_fraction_max"], hall_area / inside.area
        )
        if hall_area / inside.area > 0.32:
            warnings.append(f"L{level}: circulation consumes over 32% of usable area")
        if abs(floor["elevation_m"] - elevations) > 0.001:
            errors.append("non-contiguous storey elevations")
        elevations += floor["height_m"]
        for o in floor["openings"]:
            a, b = o["rooms"]
            edges.append((a, b))
            line = shape(o["segment"])
            if o["width_m"] < 0.78:
                errors.append(f"narrow opening {o['id']}")
            if abs(line.length - o["width_m"]) > 0.002:
                errors.append(f"opening length mismatch {o['id']}")
            for key in (a, b):
                if key == "outside":
                    continue
                if line.difference(shapes[key].boundary.buffer(0.003)).length > 0.003:
                    errors.append(f"opening off room boundary {o['id']}")
            if (
                o["leaf_count"]
                and not o.get("entrance")
                and not o.get("unit_entrance")
                and not o.get("garage_access")
                and not any(
                    rooms.get(key, {}).get("kind")
                    in {"bedroom", "primary_bedroom", "full_bathroom", "toilet", "office"}
                    for key in (a, b)
                )
            ):
                errors.append("unnecessary internal door leaf")
        for key, room in rooms.items():
            if room["kind"] == "hallway":
                portals = [shape(o["segment"]) for o in floor["openings"] if key in o["rooms"]]
                if blind_corridor_ends(shapes[key], portals):
                    errors.append(f"{key}: corridor ends without a destination")
            maximum = {"toilet": 5.5, "full_bathroom": 8.5}.get(room["kind"])
            if maximum and shapes[key].area > maximum + 0.001:
                errors.append(f"{key}: oversized wet room wastes usable area")
        objects = floor["objects"]
        metrics["objects"] += len(objects)
        metrics["downloaded_assets_used"] += sum(not o["asset"]["procedural"] for o in objects)
        item_shapes = {o["id"]: shape(o["footprint"]) for o in objects}
        for o in objects:
            all_objects[o["id"]] = o
            p = item_shapes[o["id"]]
            if not shapes[o["room_id"]].buffer(0.002).covers(p):
                errors.append(f"object outside room {o['id']}")
            if o["support"]["kind"] == "floor":
                room_y = rooms[o["room_id"]].get("elevation_m", floor["elevation_m"])
                if abs(o["position_m"][1] - room_y) > 0.001:
                    errors.append(f"floating floor object {o['id']}")
                for portal in floor["openings"]:
                    if o["room_id"] in portal["rooms"] and p.intersects(shape(portal["clearance"])):
                        errors.append(f"blocked door approach {o['id']}")
            if o["role"] == "bed":
                room = shapes[o["room_id"]]
                if p.distance(room.boundary) > 0.09:
                    errors.append(f"bed has no wall backing {o['id']}")
                for key in ("reserved_clearance", "side_clearance"):
                    if key not in o or not room.buffer(0.002).covers(shape(o[key])):
                        errors.append(f"bed lacks foot/side access {o['id']}")
                    elif any(
                        item_shapes[q["id"]].intersection(shape(o[key])).area > 0.001
                        for q in objects
                        if q["id"] != o["id"] and q["support"]["kind"] == "floor"
                    ):
                        errors.append(f"bed aisle blocked {o['id']}")
        for a, b in combinations(objects, 2):
            ay, by = a["position_m"][1], b["position_m"][1]
            overlap_y = min(ay + a["size_m"][1], by + b["size_m"][1]) - max(ay, by)
            if (
                overlap_y > 0.002
                and item_shapes[a["id"]].intersection(item_shapes[b["id"]]).area > 0.001
            ):
                errors.append(f"colliding objects {a['id']}, {b['id']}")
        for key, room in rooms.items():
            contents = [o for o in objects if o["room_id"] == key]
            roles = [o["role"] for o in contents]
            required = {
                "living": {"sofa"},
                "closet": {"closet_rail"},
                "utility": {"washing_machine"},
                "kitchen": {"sink_counter", "cooker", "refrigerator"},
                "dining": {"dining_table", "dining_chair"},
                "office": {"desk", "office_chair"},
                "bedroom": {"bed"},
                "primary_bedroom": {"bed"},
                "toilet": {"toilet", "bath_sink"},
                "full_bathroom": {"toilet", "bath_sink", "bath_shower"},
            }.get(room["kind"], set())
            if room.get("laundry_stack"):
                required = required | {"washing_machine", "clothes_dryer"}
                washer = next((o for o in contents if o["role"] == "washing_machine"), None)
                dryer = next((o for o in contents if o["role"] == "clothes_dryer"), None)
                if washer and dryer:
                    from shapely.geometry import LineString

                    x, _, y = washer["position_m"]
                    w, _, d = washer["size_m"]
                    angle = math.radians(washer["rotation_deg"])
                    ux, uy = math.cos(angle), math.sin(angle)
                    nx, ny = -uy, ux
                    back = LineString(
                        [
                            (x - ux * w / 2 - nx * d / 2, y - uy * w / 2 - ny * d / 2),
                            (x + ux * w / 2 - nx * d / 2, y + uy * w / 2 - ny * d / 2),
                        ]
                    )
                    if not shapes[key].boundary.buffer(0.11).covers(back):
                        errors.append(f"{key}: laundry stack is not wall-backed")
                    if dryer["support"].get("id") != washer["id"]:
                        errors.append(f"{key}: dryer is not supported by washer")
            if not required.issubset(roles):
                errors.append(f"{key}: missing required furniture {required - set(roles)}")
            if room["kind"] == "dining" and roles.count("dining_chair") < 2:
                errors.append(f"{key}: dining table needs two accessible chairs")
            if not contents:
                continue
            # Recompute physical navigation independently from serialized footprints.
            obstacles = [item_shapes[o["id"]] for o in contents if o["support"]["kind"] == "floor"]
            free = (
                shapes[key]
                .buffer(-0.28, join_style=2)
                .difference(unary_union(obstacles).buffer(0.28, join_style=2))
            )
            portals = [shape(o["segment"]) for o in floor["openings"] if key in o["rooms"]]
            from smc.interiors.inference.furnish import inward_point

            points = [inward_point(shapes[key], p) for p in portals]
            points += [
                Point(o["interaction_point_m"]) for o in contents if "interaction_point_m" in o
            ]
            if points and not any(
                all(p.buffer(0.015).covers(q) for q in points) for p in polygons(free)
            ):
                errors.append(f"{key}: door-to-furniture navigation disconnected")
    for o in all_objects.values():
        if o["support"]["kind"] != "object":
            continue
        parent = all_objects.get(o["support"]["id"])
        if parent is None:
            errors.append(f"missing physical support {o['id']}")
            continue
        top = parent["position_m"][1] + parent["size_m"][1]
        if abs(top - o["position_m"][1]) > 0.001:
            errors.append(f"floating/intersecting tabletop object {o['id']}")
        if not shape(parent["footprint"]).covers(shape(o["footprint"])):
            errors.append(f"unsupported overhang {o['id']}")
        if math.dist(o["position_m"][::2], parent["position_m"][::2]) > 0.001:
            errors.append(f"uncentred tabletop object {o['id']}")
    for stair in house["stairs"]:
        lo, hi = stair["from_level"], stair["to_level"]
        lower, upper = house["storeys"][lo], house["storeys"][hi]
        core = shape(stair["footprint"])
        from_room = stair.get("from_room", f"{house['id']}:L{lo}:stair")
        to_room = stair.get("to_room", f"{house['id']}:L{hi}:stair")
        edges.append((from_room, to_room))
        if stair.get("access_segment"):
            access = shape(stair["access_segment"])
            for floor, room_id in ((lower, from_room), (upper, to_room)):
                portals = [shape(o["segment"]) for o in floor["openings"] if room_id in o["rooms"]]
                if not any(line.buffer(0.003).covers(access) for line in portals):
                    errors.append("stair flight exit is walled off")
                if any(
                    shape(w["segment"]).intersection(access.buffer(0.02)).length > 0.05
                    for w in floor["walls"]
                ):
                    errors.append("wall blocks stair flight exit")
        if not any(
            shape(hole).symmetric_difference(core).area < 0.002 for hole in upper["slab_holes"]
        ):
            errors.append("upper slab has no aligned stair opening")
        if not shape(lower["inside"]).buffer(0.002).covers(core) or not shape(
            upper["inside"]
        ).buffer(0.002).covers(core):
            errors.append("stairs outside common floor footprint")
        if (
            stair["rise_m"] > 0.18 + 1e-6
            or stair["tread_m"] < 0.25
            or stair["flight_width_m"] < 0.9
        ):
            errors.append("stairs exceed configured geometric limits")
        if abs(stair["steps"][-1]["top_m"] - upper["elevation_m"]) > 0.001:
            errors.append("stairs do not meet upper floor elevation")
    required = len(house["storeys"]) - 1
    count = len(house["stairs"])
    if count < required or (
        house.get("schema") != "kerbside.inferred_residential/1" and count != required
    ):
        errors.append("storeys are missing stair connections")
    reached = {"outside"}
    while True:
        more = {b for a, b in edges if a in reached} | {a for a, b in edges if b in reached}
        if more <= reached:
            break
        reached.update(more)
    if not nodes <= reached:
        errors.append(
            "rooms disconnected from exterior entrance: " + ", ".join(sorted(nodes - reached))
        )
    metrics["connected_rooms"] = len(nodes & reached)
    return {
        "passed": not errors,
        "errors": errors,
        "warnings": warnings,
        "metrics": metrics,
        "scope": "geometric/plausibility checks; not a building-code or as-built certification",
    }
