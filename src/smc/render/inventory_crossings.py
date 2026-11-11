"""Crosswalks the city has painted where OpenStreetMap maps none.

SFMTA's inventory of continental (high-visibility) crosswalks records a point per junction it
has restriped (``data/sf_public_works/crosswalks.json``). The page draws a crosswalk only where
OpenStreetMap maps a crossing way, and 229 of the corridor's 238 junctions with no crossing at
all are in that inventory: the paint is on the street, and the model showed a bare junction.

For each such junction, a crossing is laid across every leg, as SFMTA paints them: a band about
twelve feet wide, its middle just past the cross street's kerb line. The junction's position
and its streets' widths are measured (the city's point, the centreline, the carriageway); where
on the leg the band lies is the city's standard, not a survey, and each crossing says so.

A divided street (two carriageways a median apart, each its own way: Lombard at Fillmore) is met
at one of its halves. Its crossings go over both halves on one line -- a band on each, the
island between them bare -- and the cross street's band on the far side stands past the far
half's kerb, not out in the gap between the two (2026-11-10).

A junction with any mapped crossing near it is left alone: its mapped legs are the evidence,
and a leg left unmapped there may well be unmarked. Nothing is drawn where the city records no
paint -- a junction missing from both stays bare rather than being guessed.
"""

from __future__ import annotations

import math
from collections import defaultdict
from typing import Any

#: The inventory's point is the junction's middle: a street vertex this close is the junction.
JUNCTION_MATCH_M = 12.0
#: A mapped crossing within this distance of the junction means OpenStreetMap maps it.
MAPPED_NEAR_M = 25.0
#: San Francisco's crosswalk band, twelve feet.
BAND_M = 3.66
#: The band's middle stands this far past the cross street's kerb line (half the band, and the
#: few feet the city leaves for the kerb return).
BAND_SETBACK_M = BAND_M / 2 + 0.5
#: Two legs within this angle are one (a divided street's two carriageways).
SAME_LEG_DEG = 25.0
DEFAULT_ROAD_M = 10.0
#: The other half of a divided street lies this far (m) from the half the junction is on.
TWIN_MIN_M, TWIN_MAX_M = 4.0, 30.0
LON_M, LAT_M = 88_000.0, 111_320.0
PRECISION = 6


def _xy(p: list[float]) -> tuple[float, float]:
    return p[0] * LON_M, p[1] * LAT_M


def _lonlat(x: float, y: float) -> list[float]:
    return [round(x / LON_M, PRECISION), round(y / LAT_M, PRECISION)]


def _seg_point(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    L2 = dx * dx + dy * dy
    t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / L2))
    return ax + dx * t, ay + dy * t


def _twin(streets_by_name, leg, jx, jy):
    """The divided street's other half: (offset vector from the junction across to its line,
    its road width), or None. A way of the leg's name, parallel to it, a median's width off."""
    name = leg["way"].get("name")
    if not name:
        return None
    best = None
    for way in streets_by_name.get(name, ()):
        if way is leg["way"]:
            continue
        pts = [_xy(p) for p in way["points"]]
        for (ax, ay), (bx, by) in zip(pts, pts[1:]):
            L = math.hypot(bx - ax, by - ay)
            if L < 1 or abs((bx - ax) / L * leg["ux"] + (by - ay) / L * leg["uy"]) < math.cos(math.radians(SAME_LEG_DEG)):
                continue
            qx, qy = _seg_point(jx, jy, ax, ay, bx, by)
            # Across the street from the junction, not along it.
            ox, oy = qx - jx, qy - jy
            along = ox * leg["ux"] + oy * leg["uy"]
            tx, ty = ox - along * leg["ux"], oy - along * leg["uy"]
            d = math.hypot(tx, ty)
            if TWIN_MIN_M <= d <= TWIN_MAX_M and abs(along) < TWIN_MAX_M and (best is None or d < best[0]):
                best = (d, tx, ty, float(way.get("road_m") or DEFAULT_ROAD_M))
    return None if best is None else ((best[1], best[2]), best[3])


def _run_on(streets, way, end) -> float:
    """How far the street runs on past ``end`` (a point of ``way``), by a way of its name that
    starts or ends there."""
    ex, ey = end
    for other in streets:
        if other is way or other.get("name") != way.get("name") or not way.get("name"):
            continue
        pts = [_xy(p) for p in other["points"]]
        if math.hypot(pts[0][0] - ex, pts[0][1] - ey) < 1.0 or math.hypot(pts[-1][0] - ex, pts[-1][1] - ey) < 1.0:
            return sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(pts, pts[1:]))
    return 0.0


def inventory_crossings(ways: list[dict[str, Any]], inventory: list[dict[str, Any]],
                        bbox: dict[str, float] | None = None) -> list[dict[str, Any]]:
    streets = [w for w in ways if w.get("kind") == "street" and len(w.get("points") or []) >= 2
               and w.get("service") not in ("alley", "parking_aisle", "driveway")
               and not w.get("tunnel") and not w.get("bridge")]
    vertices: dict[tuple[int, int], list[tuple[dict, int]]] = defaultdict(list)
    for way in streets:
        for i, p in enumerate(way["points"]):
            x, y = _xy(p)
            vertices[(int(x // 20), int(y // 20))].append((way, i))
    streets_by_name: dict[str, list[dict]] = defaultdict(list)
    for way in streets:
        if way.get("name"):
            streets_by_name[way["name"]].append(way)
    crossings: dict[tuple[int, int], list[list[float]]] = defaultdict(list)
    for way in ways:
        if way.get("kind") == "crossing":
            for p in way.get("points") or []:
                x, y = _xy(p)
                crossings[(int(x // 20), int(y // 20))].append([x, y])

    def near(grid, x, y):
        # Everything within about forty metres, for the caller to measure.
        cx, cy = int(x // 20), int(y // 20)
        for dx in (-1, 0, 1, 2, -2):
            for dy in (-1, 0, 1, 2, -2):
                yield from grid.get((cx + dx, cy + dy), ())

    out: list[dict[str, Any]] = []
    done: set[tuple[int, int]] = set()
    for record in inventory:
        lon, lat = record["p"]
        if bbox and not (bbox["west"] <= lon <= bbox["east"] and bbox["south"] <= lat <= bbox["north"]):
            continue
        px, py = _xy(record["p"])
        best = None
        for way, i in near(vertices, px, py):
            vx, vy = _xy(way["points"][i])
            d = math.hypot(vx - px, vy - py)
            if d <= JUNCTION_MATCH_M and (best is None or d < best[0]):
                best = (d, vx, vy)
        if best is None:
            continue
        _, jx, jy = best
        key = (round(jx), round(jy))
        if key in done:
            continue
        done.add(key)
        if any(math.hypot(x - jx, y - jy) <= MAPPED_NEAR_M for x, y in near(crossings, jx, jy)):
            continue
        # Its legs: from the junction along every street that passes through it or ends there.
        legs: list[dict[str, Any]] = []
        for way, i in near(vertices, jx, jy):
            vx, vy = _xy(way["points"][i])
            if math.hypot(vx - jx, vy - jy) > 3.0:
                continue
            for j in (i - 1, i + 1):
                if not 0 <= j < len(way["points"]):
                    continue
                # The leg's direction, from far enough along it to be the street's, not a kink.
                k, (ox, oy) = j, _xy(way["points"][j])
                while math.hypot(ox - jx, oy - jy) < 8 and 0 < k < len(way["points"]) - 1:
                    k += 1 if j > i else -1
                    ox, oy = _xy(way["points"][k])
                reach = math.hypot(ox - jx, oy - jy)
                if reach < 4:
                    continue
                # How far the street runs on from the junction: the band must fit on it.
                step = 1 if j > i else -1
                along, prev, m = 0.0, (jx, jy), i + step
                while 0 <= m < len(way["points"]):
                    q = _xy(way["points"][m])
                    along += math.hypot(q[0] - prev[0], q[1] - prev[1])
                    prev, m = q, m + step
                along += _run_on(streets, way, prev)
                legs.append({"way": way, "ux": (ox - jx) / reach, "uy": (oy - jy) / reach,
                             "length": along, "road": float(way.get("road_m") or DEFAULT_ROAD_M)})
        merged: list[dict[str, Any]] = []
        for leg in sorted(legs, key=lambda leg: -leg["road"]):
            if any(math.degrees(math.acos(max(-1.0, min(1.0, leg["ux"] * m["ux"] + leg["uy"] * m["uy"]))))
                   < SAME_LEG_DEG for m in merged):
                continue
            merged.append(leg)
        if len(merged) < 3:
            continue  # a bend or a dead end, not a junction with crossings
        # A divided street through the junction: where its other half is, and how wide.
        twins = {}
        for leg in merged:
            name = leg["way"].get("name")
            if name and name not in twins:
                twins[name] = _twin(streets_by_name, leg, jx, jy)
        for leg in merged:
            # The widest street crossing this leg sets where its kerb line is.
            across = max((m["road"] for m in merged
                          if abs(m["ux"] * leg["ux"] + m["uy"] * leg["uy"]) < math.cos(math.radians(45))),
                         default=DEFAULT_ROAD_M)
            setback = across / 2 + BAND_SETBACK_M
            # Toward a divided street's far half: past that half's kerb line.
            for m in merged:
                tw = twins.get(m["way"].get("name")) if abs(m["ux"] * leg["ux"] + m["uy"] * leg["uy"]) < math.cos(math.radians(45)) else None
                if tw:
                    (tx, ty), troad = tw
                    t = math.hypot(tx, ty)
                    toward = (tx * leg["ux"] + ty * leg["uy"]) / t
                    if toward > math.cos(math.radians(45)):
                        setback = max(setback, t / toward + troad / 2 + BAND_SETBACK_M)
            if setback > leg["length"] - 2:
                continue
            cx, cy = jx + leg["ux"] * setback, jy + leg["uy"] * setback
            nx, ny = -leg["uy"], leg["ux"]
            half = leg["road"] / 2 + 0.3
            way = leg["way"]
            bands = [(cx - nx * half, cy - ny * half, cx + nx * half, cy + ny * half, leg["road"])]
            # Across a divided street: a band on its other half too, on the same line.
            tw = twins.get(way.get("name"))
            if tw:
                (tx, ty), troad = tw
                t = math.hypot(tx, ty)
                if abs(tx * nx + ty * ny) / t > math.cos(math.radians(SAME_LEG_DEG)):
                    sx, sy = cx + tx, cy + ty
                    th = troad / 2 + 0.3
                    bands.append((sx - nx * th, sy - ny * th, sx + nx * th, sy + ny * th, troad))
            for ax, ay, bx, by, road in bands:
                out.append(_crossing(way, record, jx, jy, (ax, ay), (bx, by), road))
    return out


def _crossing(way, record, jx, jy, a, b, road) -> dict[str, Any]:
    """One band of paint, from a to b (metres), as the page reads a crossing."""
    return {
        "kind": "crossing",
        "name": None,
        "points": [_lonlat(*a), _lonlat(*b)],
        "covered": way.get("covered", True),
        "crossing_m": BAND_M,
        "road_m": round(road, 2),
        "road_source": way.get("road_source"),
        "crossing_markings": "zebra",
        "resolved_crossing_marking": "continental",
        "continental": True,
        "continental_source": "sfmta_inventory",
        "marking_provenance": "sfmta_crosswalk_inventory",
        "geometry_basis": "inventory_junction_city_standard_setback",
        "inferred_geometry": True,
        "crossing_style_group": f"intersection:{round(jx / LON_M, 6)}:{round(jy / LAT_M, 6)}",
        "inventory": {"cnn": record.get("cnn"), "year": record.get("year"),
                      "street": record.get("street"), "cross": record.get("cross")},
    }
