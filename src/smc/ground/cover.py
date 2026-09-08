"""Measuring how much of the corridor the model actually describes.

The honest version of "the map looks patchy" is a number: what fraction of the ground inside
the region has anything drawn on it at all. Everything else in this package exists to move that
number, so it is worth being able to compute it the same way before and after.

The measure is a raster rather than a polygon union. A union of sixteen thousand footprints,
four thousand carriageways and every footway is a hard computational geometry problem and a
grid is not: stamp each feature into a two-metre lattice and count what is left. Two metres is
finer than any real gap between a house and its property line and coarse enough that the whole
corridor is three million cells.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

#: Side of one lattice cell, in metres.
CELL_M = 2.0


@dataclass(frozen=True)
class Coverage:
    covered: int
    total: int
    by_layer: dict[str, int]

    @property
    def described(self) -> float:
        return self.covered / self.total if self.total else 0.0

    @property
    def undefined(self) -> float:
        return 1.0 - self.described


class Lattice:
    """A boolean grid over a lon/lat box, in local metres."""

    def __init__(self, bbox: dict, *, cell_m: float = CELL_M) -> None:
        self.cell_m = cell_m
        self.lat0 = (bbox["south"] + bbox["north"]) / 2.0
        self.lon0 = (bbox["west"] + bbox["east"]) / 2.0
        self.m_per_lat = math.pi * 6_378_137.0 / 180.0
        self.m_per_lon = self.m_per_lat * math.cos(math.radians(self.lat0))
        west, south = self.to_xy(bbox["west"], bbox["south"])
        east, north = self.to_xy(bbox["east"], bbox["north"])
        self.origin = (west, south)
        self.width = max(1, int((east - west) / cell_m) + 1)
        self.height = max(1, int((north - south) / cell_m) + 1)
        self.grid = np.zeros((self.height, self.width), dtype=bool)

    def to_xy(self, lon: float, lat: float) -> tuple[float, float]:
        return ((lon - self.lon0) * self.m_per_lon, (lat - self.lat0) * self.m_per_lat)

    def to_cell(self, x: float, y: float) -> tuple[int, int]:
        return (int((y - self.origin[1]) / self.cell_m),
                int((x - self.origin[0]) / self.cell_m))

    @property
    def total(self) -> int:
        return int(self.grid.size)

    def stamp_polygon(self, ring: list) -> int:
        """Mark every cell whose centre falls inside a lon/lat ring. Returns cells newly set."""
        if len(ring) < 3:
            return 0
        local = np.array([self.to_xy(lon, lat) for lon, lat in ring])
        return self._fill(local)

    def stamp_polyline(self, points: list, width_m: float) -> int:
        """Mark a band of ``width_m`` along a lon/lat polyline."""
        if len(points) < 2 or width_m <= 0:
            return 0
        local = np.array([self.to_xy(lon, lat) for lon, lat in points])
        before = int(self.grid.sum())
        half = width_m / 2.0
        for a, b in zip(local[:-1], local[1:]):
            length = float(np.hypot(*(b - a)))
            if length < 1e-6:
                continue
            direction = (b - a) / length
            normal = np.array([-direction[1], direction[0]])
            corners = np.array([a + normal * half, b + normal * half,
                                b - normal * half, a - normal * half])
            self._fill(corners)
        return int(self.grid.sum()) - before

    def _fill(self, local: np.ndarray) -> int:
        """Even-odd fill of a convex-or-not polygon given in local metres."""
        before = int(self.grid.sum())
        min_row, min_col = self.to_cell(local[:, 0].min(), local[:, 1].min())
        max_row, max_col = self.to_cell(local[:, 0].max(), local[:, 1].max())
        min_row = max(0, min_row); min_col = max(0, min_col)
        max_row = min(self.height - 1, max_row + 1); max_col = min(self.width - 1, max_col + 1)
        if max_row < min_row or max_col < min_col:
            return 0

        rows = np.arange(min_row, max_row + 1)
        cols = np.arange(min_col, max_col + 1)
        ys = self.origin[1] + (rows + 0.5) * self.cell_m
        xs = self.origin[0] + (cols + 0.5) * self.cell_m
        gx, gy = np.meshgrid(xs, ys)

        inside = np.zeros(gx.shape, dtype=bool)
        n = len(local)
        for i in range(n):
            x1, y1 = local[i]
            x2, y2 = local[(i + 1) % n]
            if y1 == y2:
                continue
            crosses = (y1 > gy) != (y2 > gy)
            with np.errstate(divide="ignore", invalid="ignore"):
                cut = x1 + (gy - y1) * (x2 - x1) / (y2 - y1)
            inside ^= crosses & (cut > gx)
        self.grid[min_row:max_row + 1, min_col:max_col + 1] |= inside
        return int(self.grid.sum()) - before
