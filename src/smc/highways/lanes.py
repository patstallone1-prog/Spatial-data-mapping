"""Carpool and express lanes on the Bay's freeways, from OpenStreetMap's lane tags.

What the map records, and well, on almost every managed lane in the Bay Area:

* ``hov:lanes``: one value a lane, left to right in the way's direction; ``designated`` is the
  carpool lane (``hov:lanes=designated|||`` is the leftmost of four).
* ``hov:minimum``: how many must be in the car (2 unless signed 3+).
* ``hov:conditional`` / ``hov:lanes:conditional``: when it is a carpool lane, as opening hours
  (``designated @ (Mo-Fr 05:00-10:00,15:00-19:00)``). With no hours it is one at all times.
* ``toll:hov`` (or ``toll:lanes``, ``charge:hov:conditional``): a carpool lane solo drivers may
  buy their way into -- an express lane. ``toll:hov=no`` says carpools ride free.

Each way becomes one segment: its line, which lanes are managed, whether it is a carpool or an
express lane, the occupancy, the hours. Inferred from the map, never surveyed; the viewer
decides from the car's position across the carriageway which lane it is in.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass

LANE_M = 3.66
ROADS = {"motorway", "trunk", "motorway_link", "trunk_link", "primary"}
BASIS = ("inferred: OpenStreetMap hov:lanes, hov:minimum, hov:conditional and toll:hov on the way; "
         "lane positions from the way's centreline at 3.66 m a lane, not surveyed")

_HOURS = re.compile(r"(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})")


@dataclass
class ManagedLane:
    id: str
    ref: str | None
    kind: str                 # "hov" or "express"
    lanes: int
    managed: list[int]        # lane indices, 0 = leftmost in the way's direction
    minimum: int
    hours: list[list[float]] | None   # [[start_h, end_h], ...]; None = at all times
    weekdays_only: bool
    carpool_free: bool
    points: list[list[float]]
    oneway: bool

    def to_json(self) -> dict:
        return {"id": self.id, "ref": self.ref, "kind": self.kind, "lanes": self.lanes, "managed": self.managed,
                "min": self.minimum, "hours": self.hours, "weekdays": self.weekdays_only,
                "carpool_free": self.carpool_free, "oneway": self.oneway, "p": self.points}


def parse_hours(text: str | None) -> tuple[list[list[float]] | None, bool]:
    """Opening hours in a conditional as [[start, end], ...] in hours, and whether weekdays only."""
    if not text or "@" not in text:
        return None, False
    when = text.split("@", 1)[1]
    hours = [[int(a) + int(b) / 60, int(c) + int(d) / 60] for a, b, c, d in _HOURS.findall(when)]
    weekdays = bool(re.search(r"Mo\s*-\s*Fr", when))
    return (hours or None), weekdays


def managed_lane_indices(tags: dict) -> list[int]:
    value = tags.get("hov:lanes") or tags.get("hov:lanes:forward") or ""
    if not value and tags.get("hov:lanes:conditional"):
        value = tags["hov:lanes:conditional"].split("@", 1)[0].strip()
    lanes = value.split("|") if value else []
    picked = [i for i, v in enumerate(lanes) if v.strip() in ("designated", "lane")]
    if not picked and tags.get("hov") in ("designated", "lane"):
        picked = [0]
    return picked


def lane_kind(tags: dict) -> str:
    # "Expressway" is a county road's name (San Tomas Expressway), not an express lane.
    express = any(k in tags for k in ("toll:hov", "toll:lanes", "charge:hov:conditional")) or \
        "express lane" in (tags.get("name") or "").lower()
    return "express" if express else "hov"


def simplify(points: list[tuple[float, float]], tolerance_m: float = 2.0) -> list[tuple[float, float]]:
    """Douglas-Peucker on lon/lat, measured in metres."""
    if len(points) < 3:
        return points
    lat0 = math.radians(points[0][1])
    kx, ky = 111_320.0 * math.cos(lat0), 110_540.0
    xy = [(lon * kx, lat * ky) for lon, lat in points]
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        a, b = stack.pop()
        (ax, ay), (bx, by) = xy[a], xy[b]
        dx, dy = bx - ax, by - ay
        n = math.hypot(dx, dy) or 1e-9
        best, index = -1.0, -1
        for i in range(a + 1, b):
            d = abs((xy[i][0] - ax) * dy - (xy[i][1] - ay) * dx) / n
            if d > best:
                best, index = d, i
        if best > tolerance_m:
            keep[index] = True
            stack += [(a, index), (index, b)]
    return [p for p, k in zip(points, keep, strict=True) if k]


def lane_from_way(way: dict) -> ManagedLane | None:
    tags = way.get("tags") or {}
    if tags.get("highway") not in ROADS:
        return None
    managed = managed_lane_indices(tags)
    if not managed:
        return None
    try:
        lanes = int(str(tags.get("lanes", "")).split(";")[0])
    except ValueError:
        lanes = max(managed) + 2
    lanes = max(lanes, max(managed) + 1)
    hours, weekdays = parse_hours(tags.get("hov:conditional") or tags.get("hov:lanes:conditional"))
    try:
        minimum = int(tags.get("hov:minimum", 2))
    except ValueError:
        minimum = 2
    points = [(g["lon"], g["lat"]) for g in way.get("geometry") or [] if g]
    if len(points) < 2:
        return None
    points = simplify(points)
    return ManagedLane(
        id=f"way/{way['id']}", ref=tags.get("ref"), kind=lane_kind(tags), lanes=lanes, managed=managed,
        minimum=minimum, hours=hours, weekdays_only=weekdays, carpool_free=tags.get("toll:hov") == "no",
        points=[[round(lon, 6), round(lat, 6)] for lon, lat in points],
        oneway=tags.get("oneway", "yes" if tags.get("highway", "").startswith("motorway") else "no") == "yes",
    )


def lanes_from_overpass(elements: list[dict]) -> list[ManagedLane]:
    out = []
    seen = set()
    for e in elements:
        if e.get("type") != "way" or e["id"] in seen:
            continue
        seen.add(e["id"])
        lane = lane_from_way(e)
        if lane:
            out.append(lane)
    return sorted(out, key=lambda lane: lane.id)
