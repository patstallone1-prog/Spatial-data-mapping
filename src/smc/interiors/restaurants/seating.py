"""Physical wall backing and modular dining assemblies in a footprint's own frame."""

from __future__ import annotations

import math
from itertools import pairwise

from shapely.geometry import LineString, Point, shape
from shapely.ops import unary_union


def solid_backing(room, openings):
    edges = [LineString([a, b]) for a, b in pairwise(room["shape"].exterior.coords)]
    entrance = next((shape(o["segment"]).centroid for o in openings if o.get("entrance")), None)
    # The entrance frontage is glazed in the tenant envelope, not a banquette wall.
    if entrance is not None:
        glazed = min(edges, key=lambda e: e.distance(entrance))
        edges = [e for e in edges if e is not glazed]
    wall = unary_union(edges)
    for o in openings:
        if room["id"] in o["rooms"]:
            wall = wall.difference(shape(o["segment"]).buffer(0.015))
    return wall


def back_edge(x, y, w, d, angle):
    t = math.radians(angle)
    ux, uy = math.cos(t), math.sin(t)
    nx, ny = -uy, ux
    return LineString(
        [
            (x - ux * w / 2 - nx * d / 2, y - uy * w / 2 - ny * d / 2),
            (x + ux * w / 2 - nx * d / 2, y + uy * w / 2 - ny * d / 2),
        ]
    )


def wall_backed(back, wall):
    return wall.buffer(0.12, cap_style=2).covers(back)


def frame_angles(p):
    rect = list(p.minimum_rotated_rectangle.exterior.coords)
    a, b = max(pairwise(rect), key=lambda ab: math.dist(*ab))
    angle = math.degrees(math.atan2(b[1] - a[1], b[0] - a[0]))
    return [angle, angle + 90]


def assembly(x, y, angle, seats, booth):
    """Each 0.72m module is a two-top; joined modules share one seating group."""
    n = seats // 2
    w = n * 0.72
    d = 0.78
    t = math.radians(angle)
    ux, uy = math.cos(t), math.sin(t)
    nx, ny = -uy, ux
    defs = []
    for i in range(n):
        u = (i - (n - 1) / 2) * 0.72
        defs.append(("dining_table", x + ux * u, y + uy * u, 0.718, d, 0.75, angle))
    if booth:
        defs.append(
            (
                "booth",
                x - nx * (d / 2 + 0.12 + 0.29),
                y - ny * (d / 2 + 0.12 + 0.29),
                w,
                0.58,
                1.05,
                angle,
            )
        )
    for i in range(n):
        u = (i - (n - 1) / 2) * 0.72
        for side in (1,) if booth else (-1, 1):
            defs.append(
                (
                    "dining_chair",
                    x + ux * u + side * nx * (d / 2 + 0.32),
                    y + uy * u + side * ny * (d / 2 + 0.32),
                    0.45,
                    0.45,
                    0.85,
                    angle + (180 if side == 1 else 0),
                )
            )
    targets = [
        Point(x + side * ux * (w / 2 + 0.58), y + side * uy * (w / 2 + 0.58)) for side in (1, -1)
    ]
    return defs, targets
