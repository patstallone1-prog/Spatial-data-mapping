"""One authority on where the roadway is, so nothing else ends up standing in it.

Trees in the middle of the carriageway, driveway aprons laid across an intersection, gardens
over the tarmac: each of these was its own bug with its own cause, and they kept coming back in
new forms because every producer decided for itself where the road was. Fourteen per cent of the
street trees and two and a half thousand of the kerb anchors were inside a carriageway.

So the road gets rasterised once, and everything that is not road is tested against that mask
before it is written -- not in the renderer, where a mistake is invisible until somebody flies
past it, but in the build, so the data that ships cannot contain the overlap at all.

The mask is deliberately generous about what counts as road. A tree half a metre inside the
kerb line is a tree the carriageway width got wrong rather than a tree in the road, and pushing
it out is better than deleting it; a tree ten metres in is in the road.
"""

from __future__ import annotations

import math

import numpy as np

from smc.ground.cover import Lattice

#: How far outside the kerb a thing has to sit before it is clear of the road. Half a metre of
#: slack absorbs the difference between a derived carriageway width and the real one.
CLEARANCE_M = 0.5
#: How far a misplaced object may be pushed to get it out of the road before it is dropped
#: instead. Beyond this it is not a placement error, it belongs somewhere else entirely.
MAX_NUDGE_M = 6.0


class RoadMask:
    """Where the carriageway is, as a lattice, with a nearest-way-out for anything inside it."""

    def __init__(self, ways: list[dict], bbox: dict, *, cell_m: float = 1.0) -> None:
        self.lattice = Lattice(bbox, cell_m=cell_m)
        for way in ways:
            if way.get("kind") != "street" or not way.get("points"):
                continue
            width = (way.get("road_m") or 8.0) + 2 * CLEARANCE_M
            self.lattice.stamp_polyline(way["points"], width)
        self.grid = self.lattice.grid
        # Distance, in cells, from every point to the nearest cell that is not roadway. Built
        # once so that pushing ten thousand objects out costs one lookup each rather than a
        # search. scipy is not a dependency here, so this is a two-pass chamfer transform --
        # approximate, and the approximation is a few centimetres.
        self._out_row, self._out_col = _nearest_free(self.grid)

    def is_road(self, lon: float, lat: float) -> bool:
        row, col = self._cell(lon, lat)
        if row is None:
            return False
        return bool(self.grid[row, col])

    def _cell(self, lon: float, lat: float):
        x, y = self.lattice.to_xy(lon, lat)
        row, col = self.lattice.to_cell(x, y)
        if not (0 <= row < self.lattice.height and 0 <= col < self.lattice.width):
            return None, None
        return row, col

    def clear_of_road(self, lon: float, lat: float) -> tuple[float, float] | None:
        """The same point if it is already clear, the nearest clear one if it is not.

        Returns None when the nearest clear ground is further than a placement error can
        explain -- at which point the object is not slightly misplaced, it is somewhere else.
        """
        row, col = self._cell(lon, lat)
        if row is None or not self.grid[row, col]:
            return (lon, lat)
        free_row = int(self._out_row[row, col])
        free_col = int(self._out_col[row, col])
        if free_row < 0:
            return None
        moved = math.hypot((free_row - row) * self.lattice.cell_m,
                           (free_col - col) * self.lattice.cell_m)
        if moved > MAX_NUDGE_M:
            return None
        x = self.lattice.origin[0] + (free_col + 0.5) * self.lattice.cell_m
        y = self.lattice.origin[1] + (free_row + 0.5) * self.lattice.cell_m
        return (self.lattice.lon0 + x / self.lattice.m_per_lon,
                self.lattice.lat0 + y / self.lattice.m_per_lat)

    def share_inside(self, ring: list) -> float:
        """What fraction of a ring's cells are roadway."""
        local = np.array([self.lattice.to_xy(lon, lat) for lon, lat in ring])
        min_row, min_col = self.lattice.to_cell(local[:, 0].min(), local[:, 1].min())
        max_row, max_col = self.lattice.to_cell(local[:, 0].max(), local[:, 1].max())
        min_row = max(0, min_row); min_col = max(0, min_col)
        max_row = min(self.lattice.height - 1, max_row + 1)
        max_col = min(self.lattice.width - 1, max_col + 1)
        if max_row < min_row or max_col < min_col:
            return 0.0
        window = self.grid[min_row:max_row + 1, min_col:max_col + 1]
        return float(window.mean()) if window.size else 0.0


def _nearest_free(grid: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """For every cell, the row and column of the nearest cell that is False.

    A two-pass chamfer sweep: forward over the array propagating the best answer from above and
    left, then backward from below and right. Exact for the four-neighbour metric and within a
    cell of Euclidean, which is far finer than anything that depends on it.
    """
    height, width = grid.shape
    big = np.float32(1e9)
    distance = np.where(grid, big, np.float32(0.0))
    rows = np.tile(np.arange(height, dtype=np.int32)[:, None], (1, width))
    cols = np.tile(np.arange(width, dtype=np.int32)[None, :], (height, 1))
    out_row = np.where(grid, np.int32(-1), rows)
    out_col = np.where(grid, np.int32(-1), cols)

    def sweep(row_range, col_range, neighbours):
        for r in row_range:
            for dr, dc in neighbours:
                rr = r + dr
                if not (0 <= rr < height):
                    continue
                shifted = np.roll(distance[rr], dc) + 1.0
                sr = np.roll(out_row[rr], dc)
                sc = np.roll(out_col[rr], dc)
                if dc > 0:
                    shifted[:dc] = big
                elif dc < 0:
                    shifted[dc:] = big
                better = shifted < distance[r]
                distance[r] = np.where(better, shifted, distance[r])
                out_row[r] = np.where(better, sr, out_row[r])
                out_col[r] = np.where(better, sc, out_col[r])

    sweep(range(height), None, [(-1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1)])
    sweep(range(height - 1, -1, -1), None, [(1, 0), (0, 1), (0, -1), (1, 1), (1, -1)])
    return out_row, out_col
