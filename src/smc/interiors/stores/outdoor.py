"""Surface parking is rendered only with a supplied walk connection to a store entry."""

from __future__ import annotations

import math

from shapely import affinity
from shapely.geometry import Point, box, shape

from smc.interiors.inference.furnish import RoomFurnisher
from smc.interiors.inference.model import geo, polygon
from smc.interiors.inference.partition import lines


def add_surface_parking(h, spec, catalog):
    parking = spec.parking or {}
    if not parking.get("external_footprint"):
        return
    lot = polygon(parking["external_footprint"])
    if lot.intersection(spec.footprint).area > 0.01:
        raise ValueError("surface parking overlaps store shell")
    if not parking.get("pedestrian_path"):
        h["parking"]["surface_status"] = "source lot present; pedestrian connection unresolved"
        return
    path = polygon(parking["pedestrian_path"])
    f = h["storeys"][-1]
    entry = next(
        (
            o
            for o in f["openings"]
            if o.get("entrance")
            and not o.get("garage_entrance")
            and path.buffer(0.05).covers(shape(o["segment"]).centroid)
        ),
        None,
    )
    if (
        entry is None
        or path.intersection(lot).area < 0.1
        or path.intersection(shape(f["inside"])).area < 0.1
    ):
        raise ValueError("parking path must connect the lot to a store entry")
    room = {
        "id": spec.id + ":surface-parking",
        "kind": "surface_parking",
        "shape": lot,
        "materials": {"wall": "#bec8b9", "floor": "#8f9992", "floor_finish": "concrete"},
    }
    edge = max(lines(lot.boundary.intersection(path)), key=lambda e: e.length)
    furniture = RoomFurnisher(room, h["style"], catalog, [edge], f["elevation_m"], walk_radius=0.5)
    furniture.reservations = [path]
    coords = list(lot.minimum_rotated_rectangle.exterior.coords)
    a, b = coords[:2]
    angle = math.degrees(math.atan2(b[1] - a[1], b[0] - a[0]))
    local = affinity.rotate(lot, -angle, origin=(0, 0))
    x0, y0, x1, y1 = local.bounds
    bays = []
    y = y0 + 3.1
    while y < y1 - 2.8:
        x = x0 + 1.55
        while x < x1 - 1.4:
            p = affinity.rotate(Point(x, y), angle, origin=(0, 0))
            q = affinity.rotate(Point(x, y + 3.35), angle, origin=(0, 0))
            bay = affinity.rotate(box(x - 1.35, y - 2.7, x + 1.35, y + 2.7), angle, origin=(0, 0))
            if lot.covers(bay) and not bay.intersects(path):
                car = furniture.put("parked_car", p.x, p.y, 1.85, 4.8, 1.5, angle, target=q)
                if car:
                    bays.append(
                        {"car_id": car["id"], "footprint": geo(bay), "approach_m": [q.x, q.y]}
                    )
            x += 2.8
        y += 11.6
    if not bays:
        raise ValueError("no surface parking spaces fit while preserving the walking path")
    f["outdoor_areas"] = [
        {"kind": "surface_parking", "polygon": geo(lot)},
        {"kind": "pedestrian_path", "polygon": geo(path)},
    ]
    f["rooms"].append(
        {k: v for k, v in room.items() if k != "shape"} | {"polygon": geo(lot), "area_m2": lot.area}
    )
    f["objects"] += furniture.items
    f.setdefault("parking_bays", []).extend(bays)
    h["interaction_targets"] += [
        {"room_id": room["id"], "point": [q.x, q.y], "kind": "parking"} for q in furniture.targets
    ]
    h["parking"].update(
        surface_status="source lot and supplied pedestrian path", surface_spaces=len(bays)
    )
