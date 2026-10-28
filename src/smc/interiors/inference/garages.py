"""Evidence-aligned garage envelopes, parking and proposed structural load paths."""

from __future__ import annotations

import math

from shapely import affinity
from shapely.geometry import LineString, Point, Polygon, shape

from smc.interiors.inference.engine import opening
from smc.interiors.inference.furnish import RoomFurnisher, oriented_box
from smc.interiors.inference.model import geo
from smc.interiors.inference.style import room_materials


def garage_plans(spec):
    """Never move or widen a recorded door to make a parking hypothesis fit."""
    inside = spec.footprint.buffer(-0.15, join_style=2)
    plans = []
    for index, evidence in enumerate(spec.garages):
        if evidence.get("level", 0) != 0:
            raise ValueError(
                "garage openings must identify the ground floor of the supplied program"
            )
        if not -2.4 < evidence.get("v", 0) <= 0.2:
            raise ValueError(
                "garage threshold differs from ground floor; supply its lower-floor program"
            )
        if "segment" in evidence:
            source = shape(evidence["segment"])
        else:
            a, b = evidence["a"], evidence["b"]
            L = math.dist(a, b)
            u, w = float(evidence["u"]), float(evidence["w"])
            source = LineString(
                [(a[0] + (b[0] - a[0]) * t / L, a[1] + (b[1] - a[1]) * t / L) for t in (u, u + w)]
            )
        if (
            source.geom_type != "LineString"
            or len(source.coords) != 2
            or not 2.1 <= source.length <= 14
        ):
            raise ValueError("garage door must be a straight recorded 2.1-14m opening")
        if source.difference(spec.footprint.boundary.buffer(0.06)).length > 0.01:
            raise ValueError("recorded garage opening is off the house outline")
        a, b = source.coords
        L = source.length
        ux, uy = (b[0] - a[0]) / L, (b[1] - a[1]) / L
        c = source.centroid
        nx, ny = -uy, ux
        if not inside.covers(Point(c.x + nx * 0.3, c.y + ny * 0.3)):
            nx, ny = -nx, -ny
        height = float(evidence.get("h", 2.4))
        if (
            not math.isfinite(height)
            or not 1.9 <= height <= spec.storeys[0].height_m - evidence.get("v", 0) - 0.1
        ):
            raise ValueError("recorded garage height conflicts with supplied floor height")
        lanes = max(1, min(4, int((L - 1.9) / 2.7) + 1))
        cars = evidence.get("cars", spec.garage_cars if len(spec.garages) == 1 else None) or lanes
        if spec.garage_cars and len(spec.garages) > 1 and "cars" not in evidence:
            free = [i for i, g in enumerate(spec.garages) if "cars" not in g]
            budget = spec.garage_cars - sum(g.get("cars", 0) for g in spec.garages)
            q, r = divmod(budget, len(free))
            cars = q + (free.index(index) < r)
        if type(cars) is not int or not 1 <= cars <= 4:
            raise ValueError("garage capacity must be one to four cars")
        lanes = min(lanes, cars)
        rows = math.ceil(cars / lanes)
        if rows > 2:
            raise ValueError(
                "garage door cannot serve requested capacity without excessive tandem parking"
            )
        width = max(L + 0.9, lanes * 2.7 + 1.1)
        depth = rows * 5.6 + 1.8 + max(0, math.ceil(abs(evidence.get("v", 0)) / 0.18) * 0.26 - 1.0)

        def rect(u0, v0, u1, v1, c=c, ux=ux, uy=uy, nx=nx, ny=ny):
            return Polygon(
                [
                    (c.x + ux * u + nx * v, c.y + uy * u + ny * v)
                    for u, v in ((u0, v0), (u1, v0), (u1, v1), (u0, v1))
                ]
            )

        for lateral_shift in (0, 0.3, -0.3, 0.6, -0.6, 0.9, -0.9):
            p = rect(-width / 2 + lateral_shift, 0.15, width / 2 + lateral_shift, depth + 0.15)
            if inside.buffer(0.002).covers(p):
                break
        else:
            raise ValueError("garage parking and pedestrian aisle do not fit behind recorded door")
        if any(p.intersection(q["shape"]).area > 0.002 for q in plans):
            raise ValueError("recorded garages need overlapping parking envelopes")
        angle = math.degrees(math.atan2(uy, ux))
        plans.append(
            dict(
                id=f"{spec.id}:garage:{index}",
                kind="garage",
                shape=p,
                source_segment=geo(source),
                evidence=dict(evidence),
                capacity=cars,
                lanes=lanes,
                rows=rows,
                width=width,
                lateral_shift=lateral_shift,
                depth=depth,
                angle=angle,
                centre=[c.x, c.y],
                normal=[nx, ny],
                tangent=[ux, uy],
                door_height=height,
                elevation_m=float(evidence.get("v", 0)),
            )
        )
    if spec.garage_cars and sum(p["capacity"] for p in plans) != spec.garage_cars:
        raise ValueError("garage_cars conflicts with the capacity of recorded openings")
    if sum(p["capacity"] for p in plans) > 4:
        raise ValueError("this residential pass supports at most four garage spaces in total")
    return plans


def furnish_garage(
    plan, style, catalog, opens, height, *, occupied_above, windows=(), transition=None
):
    room = {**plan, "materials": room_materials(style, "garage", 0)}
    portals = [shape(o["segment"]) for o in opens if plan["id"] in o["rooms"]]
    zones = [shape(o["clearance"]) for o in opens if plan["id"] in o["rooms"]]
    f = RoomFurnisher(
        room, style, catalog, portals, plan["elevation_m"], portal_zones=zones, windows=windows
    )
    if transition:
        f.door_zones.append(shape(transition["footprint"]))
    cx, cy = plan["centre"]
    ux, uy = plan["tangent"]
    nx, ny = plan["normal"]
    bays = []
    for i in range(plan["capacity"]):
        lane, row = i % plan["lanes"], i // plan["lanes"]
        u = (lane - (plan["lanes"] - 1) / 2) * 2.7
        v = 3.65 + row * 5.6
        x, y = cx + ux * u + nx * v, cy + uy * u + ny * v
        targets = [Point(x + ux * side * 1.27, y + uy * side * 1.27) for side in (-1, 1)]
        car = next(
            (
                item
                for t in targets
                if (item := f.put("parked_car", x, y, 1.85, 4.8, 1.5, plan["angle"], target=t))
            ),
            None,
        )
        if car is None:
            raise ValueError("parked car blocks garage pedestrian access")
        car.update(parking_space=i + 1, unit_id=None)
        bay_u = max(
            -plan["width"] / 2 + plan["lateral_shift"] + 1.35,
            min(plan["width"] / 2 + plan["lateral_shift"] - 1.35, u),
        )
        bays.append(
            dict(
                id=f"{plan['id']}:bay:{i}",
                footprint=geo(
                    oriented_box(
                        cx + ux * bay_u + nx * v, cy + uy * bay_u + ny * v, 2.7, 5.4, plan["angle"]
                    )
                ),
                car_id=car["id"],
                tandem_row=row,
                entry_order=row + 1,
            )
        )
    supports = []
    if plan["width"] > 5:
        beam_base = height - 0.5
        if beam_base < 2.1:
            raise ValueError("garage support proposal would leave insufficient headroom")
        saved_items, saved_obstacles = list(f.items), list(f.obstacles)
        for fraction in (0.25, 0.78, 0.52, 0.95):
            f.items, f.obstacles = list(saved_items), list(saved_obstacles)
            supports = []
            v = plan["depth"] * fraction
            for side in (-1, 1):
                u = plan["lateral_shift"] + side * (plan["width"] / 2 - 0.23)
                post = f.put(
                    "structural_column",
                    cx + ux * u + nx * v,
                    cy + uy * u + ny * v,
                    0.3,
                    0.3,
                    beam_base,
                    plan["angle"],
                )
                if not post:
                    break
                post.update(structural_proposal=True, requires_structural_review=True)
                supports.append(post["id"])
            if len(supports) == 2:
                beam_footprint = oriented_box(
                    cx + ux * plan["lateral_shift"] + nx * v,
                    cy + uy * plan["lateral_shift"] + ny * v,
                    plan["width"] - 0.16,
                    0.3,
                    plan["angle"],
                )
                if transition and any(
                    shape(s["footprint"]).intersects(beam_footprint)
                    and plan["elevation_m"] + beam_base - s["top_m"] < 2.1
                    for s in transition["steps"]
                ):
                    continue
                break
        else:
            raise ValueError("required support columns block garage circulation")
        beam = f.put(
            "structural_beam",
            cx + ux * plan["lateral_shift"] + nx * v,
            cy + uy * plan["lateral_shift"] + ny * v,
            plan["width"] - 0.16,
            0.3,
            0.35,
            plan["angle"],
            supported_by=f.items[-1],
            base_y=plan["elevation_m"] + beam_base,
            solid=False,
        )
        beam["support"] = {
            "kind": "structure",
            "ids": supports,
            "surface_y_m": plan["elevation_m"] + beam_base,
        }
        beam.update(structural_proposal=True, requires_structural_review=True)
    return (
        f.items,
        bays,
        {
            "basis": "perimeter load-bearing walls plus proposed posts/beam where wide",
            "load": "upper floor" if occupied_above else "roof",
            "support_ids": supports,
            "requires_structural_review": True,
            "measured": False,
            "confidence": 0.15,
            "freshness": None,
            "corroboration_count": 0,
        },
    )


def garage_door(plan, index):
    source = shape(plan["source_segment"])
    nx, ny = plan["normal"]
    line = affinity.translate(source, nx * 0.15, ny * 0.15)
    portal = opening(plan, None, line, "single_door", index, line.length + 0.08)
    # The evidence width must survive exactly, including the source-to-inner-wall offset.
    portal.update(
        type="garage_door",
        segment=geo(line),
        width_m=line.length,
        height_m=plan["door_height"],
        threshold_m=plan["elevation_m"],
        entrance=True,
        garage_entrance=True,
        source_opening=plan["evidence"],
        appearance={
            "design": "sectional_garage",
            "wood_colour": "#9a978d",
            "trim_colour": "#d3cec0",
        },
    )
    return portal
