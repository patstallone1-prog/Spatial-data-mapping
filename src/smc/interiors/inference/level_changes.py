"""Short internal flights connect lower garage slabs without changing mapped storey heights."""

from __future__ import annotations

import math

from shapely.geometry import Point, Polygon, shape

from smc.interiors.inference.model import geo


def garage_transition(plan, portal):
    low = plan["elevation_m"]
    if abs(low) < 0.06:
        return None
    if low > 0:
        raise ValueError("garage slab is above this storey; resolve its actual floor program")
    line = shape(portal["segment"])
    a, b = line.coords
    c = line.centroid
    ux, uy = (b[0] - a[0]) / line.length, (b[1] - a[1]) / line.length
    nx, ny = -uy, ux
    if not plan["shape"].covers(Point(c.x + nx * 0.2, c.y + ny * 0.2)):
        nx, ny = -nx, -ny
    count = math.ceil(-low / 0.18)
    run = count * 0.26

    def rect(v0, v1):
        return Polygon(
            [
                (c.x + ux * u + nx * v, c.y + uy * u + ny * v)
                for u, v in (
                    (-line.length / 2, v0),
                    (line.length / 2, v0),
                    (line.length / 2, v1),
                    (-line.length / 2, v1),
                )
            ]
        )

    footprint = rect(0, run)
    if not plan["shape"].buffer(0.002).covers(footprint):
        raise ValueError("garage threshold steps leave the garage envelope")
    return dict(
        id=plan["id"] + ":threshold-stair",
        from_room=portal["rooms"][0],
        to_room=plan["id"],
        from_elevation_m=0,
        to_elevation_m=low,
        base_y_m=low,
        footprint=geo(footprint),
        riser_count=count,
        rise_m=-low / count,
        tread_m=0.26,
        flight_width_m=line.length,
        steps=[
            dict(footprint=geo(rect(i * 0.26, (i + 1) * 0.26)), top_m=low * i / count)
            for i in range(count)
        ],
        grade="inferred",
        measured=False,
        confidence=0.2,
        freshness=None,
        corroboration_count=0,
    )
