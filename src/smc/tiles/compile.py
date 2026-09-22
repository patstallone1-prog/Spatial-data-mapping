"""What goes in a tile at each depth: the region's ways, generalised to the tile's error.

Every layer here is made from the same payload the street renderer draws, so nothing in the
distance is invented -- it is the same buildings and the same streets, with the detail the
distance cannot resolve taken out. What is taken out is decided by the tile's geometric
error (smc.tiles.tree): a vertex that would move less than the error is dropped, and a
building smaller than the error's own footprint is not drawn at all.

Coordinates are written as centimetres east and north of the tile's south-west corner, as
integers. A tile is at most 78 km across at the root and 300 m at the leaf, so the numbers
stay small, the file is a third the size of lon/lat floats, and the page adds one corner.
"""

from __future__ import annotations

import itertools
import math
from collections.abc import Iterable
from typing import Any

from smc.tiles.tree import Frame, error_at

#: A building whose footprint is smaller than this many times the error squared is not in the
#: tile: at 25 m of error a garage is a smudge, and ten thousand smudges are what made the far
#: city expensive without making it look like anything.
MASSING_AREA_FACTOR = 2.0
#: A building this much taller than the error is kept whatever its footprint: a tower on a
#: small lot is the skyline.
MASSING_HEIGHT_FACTOR = 1.2
#: What counts as a major road at the depths that draw only those. Not the map's class: the
#: published payload keeps the width the model drew and not the highway tag, and width is the
#: better test anyway -- what you can see from ten kilometres up is the wide roads. Sixteen
#: metres is about a four-lane arterial; it keeps 491 of the corridor's 2,854 streets.
MAJOR_ROAD_M = 16.0


def _metres(box: Frame):
    kx, ky = box.metres_per_lon, box.metres_per_lat
    west, south = box.west, box.south
    def to_cm(lon: float, lat: float) -> tuple[int, int]:
        return (round((lon - west) * kx * 100.0), round((lat - south) * ky * 100.0))
    return to_cm


def simplify(points: list[list[float]], tolerance_m: float, box: Frame) -> list[list[float]]:
    """Douglas-Peucker in metres: the vertices a viewer at this error could tell apart."""
    if tolerance_m <= 0 or len(points) < 3:
        return points
    kx, ky = box.metres_per_lon, box.metres_per_lat
    pts = [((p[0] - box.west) * kx, (p[1] - box.south) * ky) for p in points]
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        if b <= a + 1:
            continue
        ax, ay = pts[a]
        bx, by = pts[b]
        ex, ey = bx - ax, by - ay
        length = math.hypot(ex, ey)
        worst, at = -1.0, -1
        for i in range(a + 1, b):
            px, py = pts[i]
            if length < 1e-9:
                d = math.hypot(px - ax, py - ay)
            else:
                d = abs((px - ax) * ey - (py - ay) * ex) / length
            if d > worst:
                worst, at = d, i
        if worst > tolerance_m and at > 0:
            keep[at] = True
            stack.append((a, at))
            stack.append((at, b))
    return [points[i] for i in range(len(points)) if keep[i]]


def ring_area_m2(points: list[list[float]], box: Frame) -> float:
    kx, ky = box.metres_per_lon, box.metres_per_lat
    pts = [((p[0] - box.west) * kx, (p[1] - box.south) * ky) for p in points]
    total = sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1]
                for i in range(len(pts)))
    return abs(total) / 2.0


def oriented_box(points: list[list[float]], box: Frame) -> tuple[float, float, float, float, float] | None:
    """A building's footprint as the rectangle that fits it: centre, half sizes, bearing.

    The smallest-area rectangle over the hull's edge directions, so a block on a street grid
    turned thirty degrees off north comes out turned thirty degrees off north rather than as
    an axis-aligned box half again too big.
    """
    kx, ky = box.metres_per_lon, box.metres_per_lat
    pts = [((p[0] - box.west) * kx, (p[1] - box.south) * ky) for p in points]
    if len(pts) < 3:
        return None
    best = None
    for i in range(len(pts)):
        ax, ay = pts[i]
        bx, by = pts[(i + 1) % len(pts)]
        ex, ey = bx - ax, by - ay
        n = math.hypot(ex, ey)
        if n < 0.5:
            continue
        ux, uy = ex / n, ey / n
        us = [p[0] * ux + p[1] * uy for p in pts]
        vs = [-p[0] * uy + p[1] * ux for p in pts]
        area = (max(us) - min(us)) * (max(vs) - min(vs))
        if best is None or area < best[0]:
            u0, u1 = (min(us) + max(us)) / 2, (max(us) - min(us)) / 2
            v0, v1 = (min(vs) + max(vs)) / 2, (max(vs) - min(vs)) / 2
            best = (area, u0 * ux - v0 * uy, u0 * uy + v0 * ux, u1, v1, math.atan2(uy, ux))
    if best is None:
        return None
    return best[1], best[2], best[3], best[4], best[5]


def _inside(box: Frame, lon: float, lat: float) -> bool:
    return box.west <= lon <= box.east and box.south <= lat <= box.north


def way_in_box(way: dict[str, Any], box: Frame) -> bool:
    """A way belongs to a tile when any of it is in the tile's square."""
    points = way.get("points") or []
    if any(_inside(box, p[0], p[1]) for p in points):
        return True
    # A long way may cross the tile without a vertex in it.
    for (x1, y1), (x2, y2) in itertools.pairwise(points):
        if (min(x1, x2) <= box.east and max(x1, x2) >= box.west
                and min(y1, y2) <= box.north and max(y1, y2) >= box.south):
            return True
    return False


def massing(ways: Iterable[dict[str, Any]], box: Frame, error_m: float) -> list[list[int]]:
    """The buildings big enough to see at this error, each as one oriented box.

    ``[cx, cy, half_along, half_across, bearing_centideg, height_cm]`` in centimetres from the
    tile's corner. A box, not a footprint: at nine metres of error the difference between a
    bay window and a flat wall is a tenth of a pixel, and the box is four corners instead of
    forty.
    """
    floor = MASSING_AREA_FACTOR * error_m * error_m
    tall = MASSING_HEIGHT_FACTOR * error_m
    out: list[list[int]] = []
    for way in ways:
        if way.get("kind") != "building" or way.get("underground"):
            continue
        points = way.get("points") or []
        if len(points) < 4 or not way_in_box(way, box):
            continue
        height = float(way.get("height_m") or 0.0)
        area = ring_area_m2(points, box)
        if area < floor and height < tall:
            continue
        fitted = oriented_box(points, box)
        if fitted is None:
            continue
        cx, cy, half_a, half_b, bearing = fitted
        out.append([round(cx * 100), round(cy * 100), round(half_a * 100), round(half_b * 100),
                    round(math.degrees(bearing) * 100), round(max(height, 3.0) * 100)])
    return out


def lines(ways: Iterable[dict[str, Any]], box: Frame, error_m: float, *,
          kinds: tuple[str, ...], major_only: bool = False) -> list[list[int]]:
    """Polylines for a layer: ``[width_cm, x0, y0, x1, y1, ...]`` in centimetres."""
    to_cm = _metres(box)
    out: list[list[int]] = []
    for way in ways:
        if way.get("kind") not in kinds:
            continue
        if major_only and float(way.get("road_m") or 0.0) < MAJOR_ROAD_M:
            continue
        points = way.get("points") or []
        if len(points) < 2 or not way_in_box(way, box):
            continue
        kept = simplify(points, error_m / 2.0, box)
        if len(kept) < 2:
            continue
        width = float(way.get("road_m") or way.get("track_m") or 8.0)
        row = [round(width * 100)]
        for lon, lat in kept:
            x, y = to_cm(lon, lat)
            row.extend((x, y))
        out.append(row)
    return out


def rings(ways: Iterable[dict[str, Any]], box: Frame, error_m: float, *,
          kinds: tuple[str, ...], with_height: bool = False,
          min_area_m2: float = 0.0) -> list[list[int]]:
    """Closed rings for a layer: ``[height_cm, colour, x0, y0, ...]`` when heights are wanted,
    ``[x0, y0, ...]`` when they are not."""
    to_cm = _metres(box)
    out: list[list[int]] = []
    for way in ways:
        if way.get("kind") not in kinds or way.get("underground"):
            continue
        points = way.get("points") or []
        if len(points) < 4 or not way_in_box(way, box):
            continue
        if min_area_m2 and ring_area_m2(points, box) < min_area_m2:
            continue
        kept = simplify(points, error_m / 3.0, box)
        if len(kept) < 4:
            continue
        row: list[int] = []
        if with_height:
            colour = str(way.get("colour") or "")
            row.append(round(float(way.get("height_m") or 6.0) * 100))
            row.append(int(colour[1:7], 16) if len(colour) >= 7 and colour[0] == "#" else -1)
        for lon, lat in kept:
            x, y = to_cm(lon, lat)
            row.extend((x, y))
        out.append(row)
    return out


def assets_for(ways: list[dict[str, Any]], box: Frame, depth: int) -> dict[str, list]:
    """Every layer a tile of this depth carries, at its own error.

    A tile is a *complete* picture of its square at its error, not a row of extra detail on
    top of its parent: showing a tile's children hides the tile, so a child that carried only
    the new things would drop the roads its parent was drawing. What changes with depth is
    how much is left out -- which buildings are worth a box, how far a vertex may move, and
    at depth 6 that a building is its own footprint rather than a box.
    """
    error = error_at(depth)
    out: dict[str, list] = {}
    if depth <= 0:
        return out                                   # the root is the atlas: land, water, bridges
    if depth >= 6:
        out["buildings"] = rings(ways, box, error, kinds=("building",), with_height=True)
    else:
        out["massing"] = massing(ways, box, error)
    if depth >= 4:
        out["roads"] = lines(ways, box, error, kinds=("street", "cycleway"))
    elif depth >= 2:
        out["roads_major"] = lines(ways, box, error, kinds=("street",), major_only=True)
    return {name: rows for name, rows in out.items() if rows}
