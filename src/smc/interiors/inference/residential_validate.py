"""Independent unit privacy, common egress, garage and structural plausibility checks."""

from __future__ import annotations

from shapely.geometry import Point, shape
from shapely.ops import unary_union

from smc.interiors.inference.furnish import inward_point
from smc.interiors.inference.partition import polygons
from smc.interiors.inference.validate import validate_house


def validate_residential(h):
    result = validate_house(h)
    errors = result["errors"]
    rooms = {r["id"]: r for f in h["storeys"] for r in f["rooms"]}
    objects = {o["id"]: o for f in h["storeys"] for o in f["objects"]}
    portals = {o["id"]: o for f in h["storeys"] for o in f["openings"]}
    units = h.get("residential_units", [])
    if len(units) != h.get("households") or len({u["id"] for u in units}) != len(units):
        errors.append("household count does not match independent residential units")
    known = {u["id"] for u in units}
    for room in rooms.values():
        if room.get("unit_id") is not None and room["unit_id"] not in known:
            errors.append("room belongs to an unknown household")
    for unit in units:
        own = {k: r for k, r in rooms.items() if r.get("unit_id") == unit["id"]}
        if set(unit["room_ids"]) != set(own):
            errors.append("unit room ownership ledger disagrees")
        levels = sorted(
            {f["level"] for f in h["storeys"] for r in f["rooms"] if r.get("unit_id") == unit["id"]}
        )
        if unit.get("levels") != levels:
            errors.append("unit floor ownership ledger disagrees")
        kinds = {r["kind"] for r in own.values()}
        if not {"kitchen", "living", "dining", "full_bathroom"} <= kinds or not kinds & {
            "bedroom",
            "primary_bedroom",
        }:
            errors.append(
                "unit lacks its own kitchen, living/dining, full bathroom or bedroom: " + unit["id"]
            )
        entrances = [
            o
            for o in portals.values()
            if (o.get("unit_entrance") or o.get("entrance")) and set(o["rooms"]) & set(own)
        ]
        if not entrances:
            errors.append("unit has no independent entrance: " + unit["id"])
        if any(
            o.get("unit_entrance") and (o["leaf_count"] != 1 or o["width_m"] < 0.85)
            for o in entrances
        ):
            errors.append("apartment entrance lacks a private door")
    program = h.get("apartment_program", {})
    for level, labels in enumerate(program.get("units_by_floor") or []):
        expected = {f"{h['id']}:unit:{label}" for label in labels}
        actual = {r["unit_id"] for r in h["storeys"][level]["rooms"] if r.get("unit_id")}
        if actual != expected:
            errors.append("apartment program disagrees with floor ownership")
    common_edges = []
    for o in portals.values():
        a, b = o["rooms"]
        ua = rooms.get(a, {}).get("unit_id")
        ub = rooms.get(b, {}).get("unit_id")
        if ua and ub and ua != ub:
            errors.append("door connects separate families directly")
        if (
            bool(ua) != bool(ub)
            and a != "outside"
            and b != "outside"
            and not (o.get("unit_entrance") or o.get("garage_access"))
        ):
            errors.append("private apartment is open to communal space")
        if not ua and not ub and not o.get("garage_entrance"):
            common_edges.append((a, b))
    for st in h["stairs"]:
        a = st.get("from_room", f"{h['id']}:L{st['from_level']}:stair")
        b = st.get("to_room", f"{h['id']}:L{st['to_level']}:stair")
        if rooms.get(a, {}).get("unit_id") is None and rooms.get(b, {}).get("unit_id") is None:
            common_edges.append((a, b))
    reached = {"outside"}
    while True:
        more = {b for a, b in common_edges if a in reached} | {
            a for a, b in common_edges if b in reached
        }
        if more <= reached:
            break
        reached |= more
    for o in portals.values():
        if o.get("unit_entrance"):
            common = [k for k in o["rooms"] if not rooms.get(k, {}).get("unit_id")]
            if not common or not set(common) <= reached:
                errors.append("apartment exit requires crossing another private unit")
    for g in h.get("garages", []):
        room = rooms.get(g["room_id"])
        if not room or room["kind"] != "garage":
            errors.append("garage room is missing")
            continue
        doors = [
            o for o in portals.values() if o.get("garage_entrance") and g["room_id"] in o["rooms"]
        ]
        source = shape(g["source_segment"])
        if (
            len(doors) != 1
            or abs(doors[0]["width_m"] - source.length) > 0.002
            or shape(doors[0]["segment"]).hausdorff_distance(source) > 0.17
        ):
            errors.append("garage door does not align with its recorded opening")
        if doors:
            source_height = g["source_opening"].get("h", 2.4)
            if (
                abs(doors[0]["height_m"] - source_height) > 0.002
                or abs(doors[0].get("threshold_m", 0) - g["source_opening"].get("v", 0)) > 0.002
            ):
                errors.append("garage door height/threshold disagrees with its source")
            projection = sorted(
                source.project(shape(doors[0]["segment"]).interpolate(t, normalized=True))
                for t in (0, 1)
            )
            if abs(projection[0]) > 0.002 or abs(projection[1] - source.length) > 0.002:
                errors.append("garage opening moved along its facade")
        access = [
            o for o in portals.values() if o.get("garage_access") and g["room_id"] in o["rooms"]
        ]
        if not access or any(o["leaf_count"] != 1 for o in access):
            errors.append("garage lacks separated pedestrian access")
        cars = [
            o
            for o in objects.values()
            if o["room_id"] == g["room_id"] and o["role"] == "parked_car"
        ]
        if len(cars) != g["capacity"] or len(g["parking_bays"]) != g["capacity"]:
            errors.append("garage capacity disagrees with physical parking")
        for bay in g["parking_bays"]:
            car = objects.get(bay["car_id"])
            p = shape(bay["footprint"])
            if (
                not car
                or not p.buffer(0.002).covers(shape(car["footprint"]))
                or not shape(room["polygon"]).buffer(0.002).covers(p)
            ):
                errors.append("garage parking bay does not contain its car")
            for o in objects.values():
                if (
                    o["role"] == "structural_column"
                    and p.intersection(shape(o["footprint"])).area > 0.002
                ):
                    errors.append("structural support occupies a parking bay")
        for support_id in g["structure"]["support_ids"]:
            post = objects.get(support_id)
            if not post or post["role"] != "structural_column":
                errors.append("garage support proposal has no column")
    for item in objects.values():
        if item["role"] == "structural_beam":
            supports = [objects.get(k) for k in item["support"].get("ids", [])]
            if len(supports) < 2 or any(s is None for s in supports):
                errors.append("garage beam has no load-path supports")
            else:
                for s in supports:
                    if abs(
                        s["position_m"][1] + s["size_m"][1] - item["position_m"][1]
                    ) > 0.002 or not shape(item["footprint"]).intersects(shape(s["footprint"])):
                        errors.append("garage beam floats above/beside its supports")
            if item["position_m"][1] - rooms[item["room_id"]].get("elevation_m", 0) < 2.1:
                errors.append("garage beam obstructs headroom")
    for floor in h["storeys"]:
        for room in floor["rooms"]:
            p = shape(room["polygon"])
            obstacles = [
                shape(o["footprint"])
                for o in floor["objects"]
                if o["room_id"] == room["id"] and o["support"]["kind"] == "floor"
            ]
            free = p.buffer(-0.28, join_style=2)
            if obstacles:
                free = free.difference(unary_union(obstacles).buffer(0.28, join_style=2))
            approaches = [
                [inward_point(p, shape(o["segment"]), d) for d in (0.35, 0.45, 0.55, 0.65)]
                for o in floor["openings"]
                if room["id"] in o["rooms"]
            ]
            approaches += [
                [Point(o["interaction_point_m"])]
                for o in floor["objects"]
                if o["room_id"] == room["id"] and "interaction_point_m" in o
            ]
            if approaches and not any(
                all(
                    any(component.buffer(0.015).covers(q) for q in choices)
                    for choices in approaches
                )
                for component in polygons(free)
            ):
                errors.append("room has no continuous pedestrian route: " + room["id"])
        changes = floor.get("level_changes", [])
        for room in (r for r in floor["rooms"] if r["kind"] == "garage"):
            elevation = room.get("elevation_m", floor["elevation_m"])
            patches = [p for p in floor.get("surface_patches", []) if p["room_id"] == room["id"]]
            if (
                len(patches) != 1
                or abs(patches[0]["elevation_m"] - elevation) > 0.002
                or shape(patches[0]["polygon"]).symmetric_difference(shape(room["polygon"])).area
                > 0.002
            ):
                errors.append("garage slab does not match its navigable surface")
            if abs(elevation - floor["elevation_m"]) >= 0.06 and not any(
                c["to_room"] == room["id"] for c in changes
            ):
                errors.append("lower garage slab is missing pedestrian threshold steps")
        for change in changes:
            steps = change.get("steps", [])
            count = change["riser_count"]
            if (
                count != len(steps)
                or change["rise_m"] > 0.18 + 1e-6
                or change["tread_m"] < 0.25
                or change["flight_width_m"] < 0.85
            ):
                errors.append("garage threshold stairs violate walking limits")
            if (
                not steps
                or abs(steps[0]["top_m"] - change["from_elevation_m"]) > 0.002
                or abs(steps[-1]["top_m"] - change["to_elevation_m"] - change["rise_m"]) > 0.002
            ):
                errors.append("garage threshold steps do not meet both slabs")
            footprint = unary_union([shape(s["footprint"]) for s in steps])
            if footprint.geom_type != "Polygon" or not shape(
                rooms[change["to_room"]]["polygon"]
            ).buffer(0.002).covers(footprint):
                errors.append("disconnected garage threshold steps")
            if any(
                footprint.intersection(shape(o["footprint"])).area > 0.001
                for o in floor["objects"]
                if o["support"]["kind"] == "floor"
            ):
                errors.append("garage stairs blocked by parking or supports")
    result["passed"] = not errors
    result["errors"] = sorted(set(errors))
    result["metrics"].update(
        households=len(units),
        garage_cars=sum(g["capacity"] for g in h.get("garages", [])),
        private_kitchens=sum(r["kind"] == "kitchen" for r in rooms.values()),
        private_full_bathrooms=sum(r["kind"] == "full_bathroom" for r in rooms.values()),
        common_rooms=sum(r.get("unit_id") is None for r in rooms.values()),
    )
    return result
