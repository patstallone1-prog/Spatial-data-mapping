"""How much room a street has before it runs into a building.

A way with no kerb reading and no recorded width is drawn at its class's prior, and the
prior for ``highway=residential`` in San Francisco is a two-lane street with parking on both
sides: 11.2 m. Grenard Terrace is tagged residential. It is a dead-end alley five metres wide
between two houses, and drawn at the prior its carriageway ran under both of them, over the
pavement of the street it opens onto, and the ground cover beside it was cut back to make
room for a road that is not there.

The map holds the evidence: the building footprints either side. A carriageway may not run
under a building, so where the kerbs were not read, each side's half width is clamped to
the distance from the centreline to the nearest building wall on that side, less a margin
for the pavement that stands between a wall and a kerb. Where there is no building within
reach the prior stands. This is a bound from surveyed footprints, not a measurement of the
kerb, and the station keeps its inferred grade with the reason recorded.
"""

from __future__ import annotations

import math
from collections import defaultdict
from typing import Any

from smc.facades.geometry import LocalFrame

#: A wall this close to the centreline bounds the carriageway; further, the class prior stands.
REACH_M = 14.0
#: The least there is between a kerb and the wall behind it: a narrow footway.
WALL_MARGIN_M = 1.5
CELL_M = 20.0


class BuildingClearance:
    """Building walls as segments in a local frame, gridded, with a ray-out-from-centreline query."""

    def __init__(self, ways: list[dict[str, Any]], frame: LocalFrame) -> None:
        self.frame = frame
        self.cells: dict[tuple[int, int], list[tuple[float, float, float, float]]] = defaultdict(list)
        self.walls = 0
        for way in ways:
            if way.get("kind") != "building" or len(way.get("points") or []) < 3:
                continue
            pts = [frame.to_xy(lon, lat) for lon, lat in way["points"]]
            for (ax, ay), (bx, by) in zip(pts, pts[1:] + pts[:1], strict=True):
                if ax == bx and ay == by:
                    continue
                self.walls += 1
                seg = (ax, ay, bx, by)
                for cx in range(int(min(ax, bx) // CELL_M), int(max(ax, bx) // CELL_M) + 1):
                    for cy in range(int(min(ay, by) // CELL_M), int(max(ay, by) // CELL_M) + 1):
                        self.cells[(cx, cy)].append(seg)

    def wall_distance(self, lon: float, lat: float, nx: float, ny: float, reach: float = REACH_M) -> float | None:
        """Metres from the point along the unit direction ``(nx, ny)`` to the first building wall
        within ``reach``, or None when none is that near."""
        px, py = self.frame.to_xy(lon, lat)
        qx, qy = px + nx * reach, py + ny * reach
        best: float | None = None
        for cx in range(int(min(px, qx) // CELL_M), int(max(px, qx) // CELL_M) + 1):
            for cy in range(int(min(py, qy) // CELL_M), int(max(py, qy) // CELL_M) + 1):
                for ax, ay, bx, by in self.cells.get((cx, cy), ()):
                    t = _ray_segment(px, py, nx, ny, ax, ay, bx, by)
                    if t is not None and 0.0 <= t <= reach and (best is None or t < best):
                        best = t
        return best

    def half_widths(self, lon: float, lat: float, ux: float, uy: float, half: float,
                    minimum: float) -> tuple[float, float, bool]:
        """The left and right half widths a prior ``half`` is allowed here, and whether a wall
        bounded either. Left is to the left of travel ``(ux, uy)``."""
        lx, ly = -uy, ux
        clamped = False
        out = []
        for sx, sy in ((lx, ly), (-lx, -ly)):
            wall = self.wall_distance(lon, lat, sx, sy, reach=half + WALL_MARGIN_M)
            allowed = half
            if wall is not None and wall - WALL_MARGIN_M < half:
                allowed = max(minimum, wall - WALL_MARGIN_M)
                clamped = allowed < half
            out.append(allowed)
        return out[0], out[1], clamped


def _ray_segment(px: float, py: float, dx: float, dy: float,
                 ax: float, ay: float, bx: float, by: float) -> float | None:
    """Distance along the ray ``p + t*d`` to segment ``ab``, or None when they do not meet."""
    ex, ey = bx - ax, by - ay
    denom = dx * ey - dy * ex
    if abs(denom) < 1e-12:
        return None
    t = ((ax - px) * ey - (ay - py) * ex) / denom
    u = ((ax - px) * dy - (ay - py) * dx) / denom
    if t < 0 or u < 0 or u > 1:
        return None
    return t


def bearing_unit(ux: float, uy: float) -> tuple[float, float]:
    """A unit vector from a bearing pair that may be in degrees-per-metre lon/lat units."""
    n = math.hypot(ux, uy)
    return (ux / n, uy / n) if n else (1.0, 0.0)
