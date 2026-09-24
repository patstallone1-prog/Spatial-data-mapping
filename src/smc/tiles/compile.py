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
          kinds: tuple[str, ...], major_only: bool = False,
          width_m: float | None = None) -> list[list[int]]:
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
        width = width_m if width_m is not None else float(way.get("road_m") or way.get("track_m") or 8.0)
        row = [round(width * 100)]
        for lon, lat in kept:
            x, y = to_cm(lon, lat)
            row.extend((x, y))
        out.append(row)
    return out


def crossing_lines(ways: Iterable[dict[str, Any]], box: Frame,
                   error_m: float) -> dict[str, list[list[int]]]:
    """Crossing centrelines separated by the marking the source resolved.

    The near-region renderer already resolves unknown arms once per physical intersection.
    Keeping that field in the tile layers prevents the distant renderer from turning every
    crossing into one solid band (or independently choosing a style for each arm).
    """
    styled: dict[str, list[list[int]]] = {"continental": [], "parallel": []}
    to_cm = _metres(box)
    for way in ways:
        if way.get("kind") != "crossing":
            continue
        resolved = str(way.get("resolved_crossing_marking") or "").strip().lower()
        markings = str(way.get("crossing_markings") or "").strip().lower()
        crossing = str(way.get("crossing_type") or "").strip().lower()
        if resolved == "unmarked" or markings in {"no", "none", "unmarked"} \
                or crossing in {"no", "unmarked"}:
            continue
        if resolved in styled:
            style = resolved
        elif way.get("continental") or markings in {"zebra", "ladder", "continental"} \
                or crossing == "zebra":
            style = "continental"
        elif markings in {"lines", "parallel", "transverse", "crossing_edges"}:
            style = "parallel"
        else:
            # Region builds normally resolve this before the tree is compiled.  A legacy payload
            # without that plumbing still gets one conservative, consistent default.
            style = "continental"
        points = way.get("points") or []
        if len(points) < 2 or not way_in_box(way, box):
            continue
        kept = simplify(points, error_m / 2.0, box)
        if len(kept) < 2:
            continue
        row = [round(float(way.get("crossing_m") or 3.6) * 100)]
        for lon, lat in kept:
            row.extend(to_cm(lon, lat))
        styled[style].append(row)
    return styled


#: A street with one of the map's own footways this close beside it already has its pavement.
FOOTWAY_NEAR_M = 6.0
#: How far past a crossing's own width the footway over it is taken out, so the paint is not
#: met by a hard edge of concrete at the exact pixel the crossing ends.
CROSSING_CUT_MARGIN_M = 0.6
#: A footway the map does not have is drawn beside the street at the width the model gave it.
#: Offsetting is in metres in the tile's own frame, which is flat over three hundred metres.
def footways(ways: Iterable[dict[str, Any]], box: Frame, error_m: float) -> list[list[int]]:
    """The pavements: the map's own footways, and a ribbon either side of every street that
    has a width for one and no footway mapped along it."""
    to_cm = _metres(box)
    kx, ky = box.metres_per_lon, box.metres_per_lat
    out: list[list[int]] = []

    def emit(points: list[list[float]], width: float) -> None:
        kept = simplify(points, error_m / 2.0, box)
        if len(kept) < 2:
            return
        row = [round(width * 100)]
        for lon, lat in kept:
            x, y = to_cm(lon, lat)
            row.extend((x, y))
        out.append(row)

    # The map's own footways, and where they are: a six-metre cell hash, so asking whether a
    # street already has one beside it is a lookup rather than a walk over every vertex in the
    # tile (which on the corridor was a hundred and sixty million comparisons a tile).
    near = FOOTWAY_NEAR_M
    mapped: set[tuple[int, int]] = set()
    for way in ways:
        if way.get("kind") not in ("sidewalk", "path"):
            continue
        points = way.get("points") or []
        if len(points) >= 2 and way_in_box(way, box):
            emit(points, float(way.get("walk_m") or 2.4))
            for lon, lat in points:
                mapped.add((int(lon * kx // near), int(lat * ky // near)))

    def is_mapped(lon: float, lat: float) -> bool:
        """Is one of the map's own footways already within a cell of here?"""
        cx, cy = int(lon * kx // near), int(lat * ky // near)
        return any((cx + dx, cy + dy) in mapped for dx in (-1, 0, 1) for dy in (-1, 0, 1))

    for way in ways:
        if way.get("kind") != "street" or not way_in_box(way, box):
            continue
        points = way.get("points") or []
        walk = float(way.get("walk_m") or way.get("walk_fallback_m") or 0.0)
        road = float(way.get("road_m") or 0.0)
        if len(points) < 2 or walk < 0.8 or road < 2.0:
            continue
        sides = way.get("walk_sides")
        for side in (sides if isinstance(sides, list) and sides else (1, -1)):
            offset = (road / 2.0 + walk / 2.0) * (1 if side > 0 else -1)
            shifted: list[list[float]] = []
            for i, (lon, lat) in enumerate(points):
                a = points[max(0, i - 1)]
                b = points[min(len(points) - 1, i + 1)]
                dx = (b[0] - a[0]) * kx
                dy = (b[1] - a[1]) * ky
                n = math.hypot(dx, dy)
                if n < 1e-6:
                    continue
                shifted.append([lon + (-dy / n) * offset / kx, lat + (dx / n) * offset / ky])
            if len(shifted) >= 2 and not is_mapped(*shifted[len(shifted) // 2]):
                emit(shifted, walk)
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
            # What kind of building it is, for the ones no photograph reached: the page gives
            # those the same invented colour it gives an unsampled building in San Francisco.
            row.append(archetype_index(way))
        for lon, lat in kept:
            x, y = to_cm(lon, lat)
            row.extend((x, y))
        out.append(row)
    return out


#: The archetypes a tile can name, as an index into this list, so a building costs one small
#: integer rather than a word repeated fifteen thousand times. The page turns the index back
#: into the archetype and colours the building the way it colours any building nobody
#: photographed: from that archetype's own palette.
ARCHETYPES = ("residential", "office", "hotel", "retail", "restaurant", "civic", "school",
              "industrial", "parking", "park", "generic")


def archetype_index(way: dict[str, Any]) -> int:
    name = str(way.get("archetype") or "generic")
    return ARCHETYPES.index(name) if name in ARCHETYPES else ARCHETYPES.index("generic")


def measured_edges(way: dict[str, Any], box: Frame) -> tuple[list[list[float]], list[list[float]]] | None:
    """A street's two kerb lines, where the region measured them.

    ``xs`` is the street's cross-sections: a station along the way, the left kerb's offset and
    the right kerb's offset, in metres from the centreline. That is the measurement -- the
    city's curb geometry in San Francisco, the lidar's profile elsewhere -- and it is not
    symmetric: Broadway in Oakland is 3.3 m to the left kerb and 6.7 m to the right. Drawn at
    one width either side the carriageway was a ribbon of the right area in the wrong place.

    Returns the left and right edges as lon/lat polylines, or None where the way has no
    cross-sections to speak of.
    """
    points = way.get("points") or []
    sections = way.get("xs") or []
    if len(points) < 2 or len(sections) < 2:
        return None
    kx, ky = box.metres_per_lon, box.metres_per_lat
    # Where each vertex falls along the way, in metres: the same station the sections use.
    along = [0.0]
    for (lon1, lat1), (lon2, lat2) in itertools.pairwise(points):
        along.append(along[-1] + math.hypot((lon2 - lon1) * kx, (lat2 - lat1) * ky))
    stations = [(float(row[0]), float(row[1]), float(row[2])) for row in sections
                if isinstance(row, list) and len(row) >= 3
                and all(isinstance(v, (int, float)) for v in row[:3])]
    if len(stations) < 2:
        return None

    def offsets_at(s: float) -> tuple[float, float]:
        """The two kerb offsets at station ``s``, between the sections either side of it."""
        if s <= stations[0][0]:
            return stations[0][1], stations[0][2]
        if s >= stations[-1][0]:
            return stations[-1][1], stations[-1][2]
        for (s0, l0, r0), (s1, l1, r1) in itertools.pairwise(stations):
            if s0 <= s <= s1:
                t = 0.0 if s1 == s0 else (s - s0) / (s1 - s0)
                return l0 + (l1 - l0) * t, r0 + (r1 - r0) * t
        return stations[-1][1], stations[-1][2]

    left: list[list[float]] = []
    right: list[list[float]] = []
    for i, (lon, lat) in enumerate(points):
        a = points[max(0, i - 1)]
        b = points[min(len(points) - 1, i + 1)]
        dx = (b[0] - a[0]) * kx
        dy = (b[1] - a[1]) * ky
        n = math.hypot(dx, dy)
        if n < 1e-9:
            continue
        # Left of travel, as the cross-sections measure it.
        nx, ny = -dy / n, dx / n
        l_off, r_off = offsets_at(along[i])
        left.append([lon + nx * l_off / kx, lat + ny * l_off / ky])
        right.append([lon + nx * r_off / kx, lat + ny * r_off / ky])
    return (left, right) if len(left) >= 2 else None


def carriageways(ways: Iterable[dict[str, Any]], box: Frame, error_m: float) -> list[list[int]]:
    """The carriageway as a strip between its two measured kerb lines:
    ``[0, lx0, ly0, rx0, ry0, lx1, ly1, ...]`` -- a leading zero where the kerbs were measured,
    and the plain ``[width_cm, x, y, ...]`` polyline of :func:`lines` where they were not."""
    to_cm = _metres(box)
    out: list[list[int]] = []
    for way in ways:
        if way.get("kind") != "street" or not way_in_box(way, box):
            continue
        points = way.get("points") or []
        if len(points) < 2:
            continue
        edges = measured_edges(way, box)
        if edges is None:
            width = float(way.get("road_m") or 0.0)
            if width < 1.0:
                continue
            kept = simplify(points, error_m / 2.0, box)
            if len(kept) < 2:
                continue
            row = [round(width * 100)]
            for lon, lat in kept:
                x, y = to_cm(lon, lat)
                row.extend((x, y))
            out.append(row)
            continue
        left, right = edges
        row = [0]
        for (llon, llat), (rlon, rlat) in zip(left, right, strict=True):
            lx, ly = to_cm(llon, llat)
            rx, ry = to_cm(rlon, rlat)
            row.extend((lx, ly, rx, ry))
        out.append(row)
    return out


def cut_at_crossings(pavements: list[list[int]], crossings: list[list[int]],
                     box: Frame) -> list[list[int]]:
    """The footways, with the part of each that a crossing runs over taken out.

    A crossing is drawn on the carriageway and a footway beside it, and where the map runs its
    crossing way right up onto the kerb the two overlap -- with the footway on top, so the
    paint disappeared under it at every corner outside San Francisco. The paint is the thing
    that has to be seen, so the footway is cut: a run of it inside a crossing's own rectangle
    is dropped and the footway carries on the other side.
    """
    if not pavements or not crossings:
        return pavements
    boxes: list[tuple[float, float, float, float, float]] = []
    for row in crossings:
        half = max(1.0, row[0] / 100.0 / 2.0) + CROSSING_CUT_MARGIN_M
        for i in range(1, len(row) - 3, 2):
            ax, ay = row[i] / 100.0, row[i + 1] / 100.0
            bx, by = row[i + 2] / 100.0, row[i + 3] / 100.0
            boxes.append((ax, ay, bx, by, half))
    if not boxes:
        return pavements

    def distance2_to_crossing(x: float, y: float,
                              crossing: tuple[float, float, float, float, float]) -> float:
        ax, ay, bx, by, _ = crossing
        ex, ey = bx - ax, by - ay
        length2 = ex * ex + ey * ey
        if length2 < 1e-9:
            return (x - ax) ** 2 + (y - ay) ** 2
        t = max(0.0, min(1.0, ((x - ax) * ex + (y - ay) * ey) / length2))
        px, py = ax + ex * t, ay + ey * t
        return (x - px) ** 2 + (y - py) ** 2

    def blocked_interval(px: float, py: float, qx: float, qy: float,
                         crossing: tuple[float, float, float, float, float]
                         ) -> tuple[float, float] | None:
        """The parameter interval of PQ inside one crossing's swept-width capsule."""
        half = crossing[4]

        def distance2(t: float) -> float:
            return distance2_to_crossing(px + (qx - px) * t, py + (qy - py) * t, crossing)

        # Squared distance to a convex segment is convex along PQ.  Ternary search finds its
        # minimum even when both pavement vertices are outside the crossing -- the case that the
        # old vertex-only cut missed after tile simplification made a block one long segment.
        lo, hi = 0.0, 1.0
        for _ in range(36):
            one = lo + (hi - lo) / 3.0
            two = hi - (hi - lo) / 3.0
            if distance2(one) <= distance2(two):
                hi = two
            else:
                lo = one
        at = (lo + hi) / 2.0
        limit = half * half
        if distance2(at) > limit:
            return None

        if distance2(0.0) <= limit:
            enter = 0.0
        else:
            outside, inside = 0.0, at
            for _ in range(36):
                middle = (outside + inside) / 2.0
                if distance2(middle) <= limit:
                    inside = middle
                else:
                    outside = middle
            enter = inside
        if distance2(1.0) <= limit:
            leave = 1.0
        else:
            inside, outside = at, 1.0
            for _ in range(36):
                middle = (inside + outside) / 2.0
                if distance2(middle) <= limit:
                    inside = middle
                else:
                    outside = middle
            leave = inside
        return enter, leave

    def intervals_for(px: float, py: float, qx: float, qy: float) -> list[tuple[float, float]]:
        intervals = [span for crossing in boxes
                     if (span := blocked_interval(px, py, qx, qy, crossing)) is not None]
        if not intervals:
            return []
        intervals.sort()
        merged = [intervals[0]]
        for start, end in intervals[1:]:
            if start <= merged[-1][1] + 1e-7:
                merged[-1] = (merged[-1][0], max(merged[-1][1], end))
            else:
                merged.append((start, end))
        return merged

    def cut_row(row: list[int]) -> list[list[int]]:
        pieces: list[list[int]] = []
        width = row[0]
        points = [(row[i] / 100.0, row[i + 1] / 100.0)
                  for i in range(1, len(row) - 1, 2)]
        if len(points) < 2:
            return pieces
        piece: list[tuple[int, int]] = []

        def point_at(a: tuple[float, float], b: tuple[float, float], t: float) -> tuple[int, int]:
            return (round((a[0] + (b[0] - a[0]) * t) * 100),
                    round((a[1] + (b[1] - a[1]) * t) * 100))

        def append(point: tuple[int, int]) -> None:
            if not piece or piece[-1] != point:
                piece.append(point)

        def finish() -> None:
            nonlocal piece
            if len(piece) >= 2 and piece[0] != piece[-1]:
                pieces.append([width, *(value for point in piece for value in point)])
            piece = []

        for a, b in itertools.pairwise(points):
            cursor = 0.0
            for start, end in intervals_for(*a, *b):
                if start > cursor + 1e-7:
                    append(point_at(a, b, cursor))
                    append(point_at(a, b, start))
                    finish()
                else:
                    finish()
                cursor = max(cursor, end)
            if cursor < 1.0 - 1e-7:
                append(point_at(a, b, cursor))
                append(point_at(a, b, 1.0))
            elif cursor >= 1.0 - 1e-7:
                finish()
        finish()
        return pieces

    out: list[list[int]] = []
    for row in pavements:
        out.extend(cut_row(row))
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
    if depth >= 7:
        # The street as a street. The carriageway runs between the kerb lines the region
        # measured -- the city's curb geometry here, the lidar's profile elsewhere -- and only
        # falls back to a width where nothing measured it. The footways are the ways the map
        # has and the width each street was given either side of it, which is where a pavement
        # is when nobody mapped one; where a crossing runs over one, the footway gives way.
        out["carriageway"] = carriageways(ways, box, error)
        pavement = footways(ways, box, error)
        crossing_styles = crossing_lines(ways, box, error)
        crossings = crossing_styles["continental"] + crossing_styles["parallel"]
        out["pavement"] = cut_at_crossings(pavement, crossings, box)
        if depth >= 8:
            out["crossings_continental"] = crossing_styles["continental"]
            out["crossings_parallel"] = crossing_styles["parallel"]
    elif depth >= 4:
        out["roads"] = lines(ways, box, error, kinds=("street", "cycleway"))
    elif depth >= 2:
        out["roads_major"] = lines(ways, box, error, kinds=("street",), major_only=True)
    return {name: rows for name, rows in out.items() if rows}
