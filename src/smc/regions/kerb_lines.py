"""The lidar's median and island kerb lines kept to where the medians are.

scripts/measure_medians_lidar.py walks each divided street's two halves every few metres and
reads the lidar across them: a raised island's two edges, or (none found) the painted middle.
Its stations run on through the junctions the street crosses, where the lidar finds the flat
road -- "painted" -- so the median line ran on across the cross street, and a pair of kerb
lines stood out of the end of each island into the junction (Lombard at Fillmore, 2026-11-10).
And where the city's own survey already has the island, the lidar's two edges were the same
kerb drawn a second time, a few centimetres off.

``clip_lidar_kerb_lines`` cuts each lidar line where it enters another street's carriageway
(a street of another name, crossing at a real angle), keeps the pieces long enough to be a
median, and drops the lidar island edges the survey already has.
"""

from __future__ import annotations

import math
from typing import Any, Iterable

#: Metres past a cross street's kerb line that a median stops short: the crosswalk across the
#: divided street there (3 m) and a step clear of it.
JUNCTION_MARGIN_M = 4.0
#: The narrowest cross street a median stops for (m of roadway): not a driveway or an alley.
MIN_CROSS_ROAD_M = 5.0
#: A crossing street meets the median's line at more than this (degrees).
CROSS_MIN_DEG = 30.0
#: The shortest piece of a median line kept (m).
MIN_PIECE_M = 4.0
#: A lidar island edge this near a surveyed island kerb all along (m) is that kerb again.
DUPLICATE_M = 1.0
#: The share of its points that near for a lidar line to be a duplicate.
DUPLICATE_SHARE = 0.8


class _Frame:
    """Metres east and north of a point, for distances on a block's scale."""

    def __init__(self, lon: float, lat: float):
        self.lon0, self.lat0 = lon, lat
        self.mx = 111_320.0 * math.cos(math.radians(lat))
        self.my = 110_540.0

    def m(self, p: Iterable[float]) -> tuple[float, float]:
        lon, lat = list(p)[:2]
        return ((lon - self.lon0) * self.mx, (lat - self.lat0) * self.my)


def _seg_dist(px, py, ax, ay, bx, by) -> float:
    dx, dy = bx - ax, by - ay
    L2 = dx * dx + dy * dy
    t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / L2))
    return math.hypot(px - (ax + dx * t), py - (ay + dy * t))


class _Segments:
    """Line segments in metres, by 25 m cell."""

    def __init__(self, cell: float = 25.0):
        self.cell, self.cells = cell, {}

    def add(self, a, b, payload) -> None:
        c = self.cell
        for i in range(int(min(a[0], b[0]) // c) - 1, int(max(a[0], b[0]) // c) + 2):
            for j in range(int(min(a[1], b[1]) // c) - 1, int(max(a[1], b[1]) // c) + 2):
                self.cells.setdefault((i, j), []).append((a, b, payload))

    def near(self, p):
        return self.cells.get((int(p[0] // self.cell), int(p[1] // self.cell)), ())


def _length(pts) -> float:
    return sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(pts, pts[1:]))


def clip_lidar_kerb_lines(curb_lines: list[dict[str, Any]], ways: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, int]]:
    """``curb_lines`` with the lidar's lines cut out of the junctions and its duplicate island
    edges dropped. Lines from other sources are returned as they were, in their order."""
    lidar = [c for c in curb_lines if c.get("s") == "lidar" and len(c.get("p") or []) >= 2]
    stats = {"lidar_lines": len(lidar), "cut_at_junctions": 0, "pieces": 0, "duplicates": 0, "dropped_short": 0}
    if not lidar:
        return curb_lines, stats
    frame = _Frame(*lidar[0]["p"][0][:2])
    streets = _Segments()
    for w in ways:
        if w.get("kind") != "street" or len(w.get("points") or []) < 2:
            continue
        # A driveway or an alley meeting the street is not a junction: the median runs past it.
        if w.get("service") or float(w.get("road_m") or 7.0) < MIN_CROSS_ROAD_M:
            continue
        half = float(w.get("road_m") or 7.0) / 2
        pts = [frame.m(p) for p in w["points"]]
        for a, b in zip(pts, pts[1:]):
            if a != b:
                streets.add(a, b, (w.get("name"), half))
    surveyed = _Segments()
    for c in curb_lines:
        if c.get("s") == "lidar" or c.get("r") not in ("island", "median"):
            continue
        pts = [frame.m(p) for p in c.get("p") or []]
        for a, b in zip(pts, pts[1:]):
            surveyed.add(a, b, None)

    def street_of(p, q):
        """The name of the street the line from p to q runs along (the nearest parallel one)."""
        dx, dy = q[0] - p[0], q[1] - p[1]
        L = math.hypot(dx, dy) or 1.0
        best, best_d = None, 1e9
        for a, b, (name, half) in streets.near(p):
            ex, ey = b[0] - a[0], b[1] - a[1]
            E = math.hypot(ex, ey) or 1.0
            if abs(dx * ex + dy * ey) / (L * E) < math.cos(math.radians(CROSS_MIN_DEG)):
                continue
            d = _seg_dist(p[0], p[1], *a, *b)
            if d < best_d:
                best, best_d = name, d
        return best

    def in_cross_street(p, own, dx, dy):
        L = math.hypot(dx, dy) or 1.0
        for a, b, (name, half) in streets.near(p):
            if own is not None and name == own:
                continue
            ex, ey = b[0] - a[0], b[1] - a[1]
            E = math.hypot(ex, ey) or 1.0
            if abs(dx * ex + dy * ey) / (L * E) > math.cos(math.radians(CROSS_MIN_DEG)):
                continue          # running alongside, not across
            if _seg_dist(p[0], p[1], *a, *b) < half + JUNCTION_MARGIN_M:
                return True
        return False

    out: list[dict[str, Any]] = []
    for c in curb_lines:
        if c.get("s") != "lidar" or len(c.get("p") or []) < 2:
            out.append(c)
            continue
        pts = [frame.m(p) for p in c["p"]]
        # The surveyed kerb again: dropped.
        if c.get("r") == "island":
            close = sum(1 for p in pts if any(_seg_dist(p[0], p[1], *a, *b) < DUPLICATE_M for a, b, _ in surveyed.near(p)))
            if close / len(pts) >= DUPLICATE_SHARE:
                stats["duplicates"] += 1
                continue
        own = street_of(pts[0], pts[-1])
        keep = []
        for i, p in enumerate(pts):
            q = pts[min(i + 1, len(pts) - 1)] if i + 1 < len(pts) else pts[i - 1]
            dx, dy = (q[0] - p[0], q[1] - p[1]) if i + 1 < len(pts) else (p[0] - q[0], p[1] - q[1])
            keep.append(not in_cross_street(p, own, dx, dy))
        if all(keep):
            out.append(c)
            stats["pieces"] += 1
            continue
        stats["cut_at_junctions"] += 1
        run: list[int] = []
        for i, k in enumerate(keep + [False]):
            if k:
                run.append(i)
                continue
            if len(run) >= 2 and _length([pts[j] for j in run]) >= MIN_PIECE_M:
                out.append({**c, "p": [c["p"][j] for j in run]})
                stats["pieces"] += 1
            elif run:
                stats["dropped_short"] += 1
            run = []
    return out, stats
