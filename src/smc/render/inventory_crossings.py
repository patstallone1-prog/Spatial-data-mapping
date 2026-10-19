"""Crosswalks the city has painted where OpenStreetMap maps none.

SFMTA's inventory of continental (high-visibility) crosswalks records a point per junction it
has restriped (``data/sf_public_works/crosswalks.json``). The page draws a crosswalk only where
OpenStreetMap maps a crossing way, and 229 of the corridor's 238 junctions with no crossing at
all are in that inventory: the paint is on the street, and the model showed a bare junction.

For each such junction, a crossing is laid across every leg, as SFMTA paints them: a band about
twelve feet wide, its middle just past the cross street's kerb line. The junction's position
and its streets' widths are measured (the city's point, the centreline, the carriageway); where
on the leg the band lies is the city's standard, not a survey, and each crossing says so.

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
LON_M, LAT_M = 88_000.0, 111_320.0
PRECISION = 6


def _xy(p: list[float]) -> tuple[float, float]:
    return p[0] * LON_M, p[1] * LAT_M


def _lonlat(x: float, y: float) -> list[float]:
    return [round(x / LON_M, PRECISION), round(y / LAT_M, PRECISION)]


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
        for leg in merged:
            # The widest street crossing this leg sets where its kerb line is.
            across = max((m["road"] for m in merged
                          if abs(m["ux"] * leg["ux"] + m["uy"] * leg["uy"]) < math.cos(math.radians(45))),
                         default=DEFAULT_ROAD_M)
            setback = across / 2 + BAND_SETBACK_M
            if setback > leg["length"] - 2:
                continue
            cx, cy = jx + leg["ux"] * setback, jy + leg["uy"] * setback
            nx, ny = -leg["uy"], leg["ux"]
            half = leg["road"] / 2 + 0.3
            way = leg["way"]
            out.append({
                "kind": "crossing",
                "name": None,
                "points": [_lonlat(cx - nx * half, cy - ny * half), _lonlat(cx + nx * half, cy + ny * half)],
                "covered": way.get("covered", True),
                "crossing_m": BAND_M,
                "road_m": round(leg["road"], 2),
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
            })
    return out
