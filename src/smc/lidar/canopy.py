"""Trees in an aerial lidar cloud that classifies nothing but the ground.

The 3DEP collections these regions are read from classify the ground and leave everything
else unclassified, so a tree has to be told from what else stands up by its shape. Three
things give it away from above:

* **A crown, not a column.** Its top is a rounded cap metres across. A pole's head, a sign,
  a wire is a few decimetres of it.
* **It is rough.** The pulses go into a crown and come back from all through it, so a column of
  one half-metre square holds returns a metre or more apart in height. A roof -- including one
  the footprints have missed -- answers from one surface.
* **It is not a wall.** Points just outside a footprint are the wall and eaves, wherever the
  mapped outline sits a little off the lidar; a band round every footprint is kept out.

Each crown is found as a local maximum of the canopy height model (the highest return per
half-metre cell, above the ground) in a window that grows with the tree, and grown out over
the canopy to where it meets its neighbour's. Its height is the top; its spread is the
crown's area as a circle.

``smc.lidar.objects`` finds trees too, as one cluster each of thin-at-the-foot, wide-at-the-top
points. Against San Francisco's street-tree inventory that found one tree in sixteen: canopies
touch, so clusters merge, and most of what it calls a tree is a metre wide. This is the
detector the ground cover reads.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy import ndimage

from smc.lidar.objects import (
    CLASS_GROUND,
    CLASS_NOISE,
    ground_heights,
    height_above_ground,
    points_in_polygons,
)

CHM_CELL_M = 0.5
#: Lower than this is a hedge, a van, a shelter roof.
MIN_TREE_M = 3.0
#: Returns higher above the ground than this are not a tree in these cities.
MAX_TREE_M = 45.0
#: Points this near a footprint are its wall and eaves, wherever the outline is a little off.
BUILDING_BAND_M = 1.0
#: A crown smaller than this is a pole's head, a sign or a lamp.
MIN_CROWN_M2 = 3.0
#: How rough a crown must be: the median, over its cells, of the height between the highest
#: and lowest return in the cell. A roof answers from one surface.
MIN_CROWN_DEPTH_M = 0.8
#: Longer than this many times its width is a run of wire or a wall top, not a crown.
MAX_ELONGATION = 3.5
#: The largest crown radius a peak's window is allowed to look across.
MAX_WINDOW_M = 4.0


@dataclass(frozen=True)
class Tree:
    east: float
    north: float
    ground_m: float
    height_m: float
    crown_m: float
    depth_m: float
    cells: int

    def to_json(self) -> dict:
        return {"e": round(self.east, 2), "n": round(self.north, 2),
                "ground_m": round(self.ground_m, 2), "height_m": round(self.height_m, 1),
                "crown_m": round(self.crown_m, 1), "depth_m": round(self.depth_m, 2),
                "cells": self.cells}


def window_m(height_m: np.ndarray) -> np.ndarray:
    """The radius a peak must be the highest within: a crown widens as a tree grows."""
    return np.clip(1.0 + 0.09 * height_m, 1.0, MAX_WINDOW_M)


def _raster_mask(rings: list[np.ndarray], origin: np.ndarray, shape: tuple[int, int]
                 ) -> np.ndarray:
    """Cells whose centre is inside any footprint."""
    ii, jj = np.mgrid[0:shape[0], 0:shape[1]]
    centres = origin + (np.column_stack([ii.ravel(), jj.ravel()]) + 0.5) * CHM_CELL_M
    return points_in_polygons(centres, rings).reshape(shape)


def detect_trees(xyz: np.ndarray, classes: np.ndarray, footprints: list[np.ndarray],
                 *, half_extent_m: float | None = None) -> list[Tree]:
    """The trees in one cell's points (local metres), outside the given footprints."""
    if not len(xyz):
        return []
    grid, gorigin, gcell = ground_heights(xyz, classes)
    hag = height_above_ground(xyz, grid, gorigin, gcell)
    keep = (classes != CLASS_GROUND) & (classes != CLASS_NOISE) & (hag > 1.0) & (hag < MAX_TREE_M)
    pts, h = xyz[keep], hag[keep]
    if len(pts) < 20:
        return []
    origin = xyz[:, :2].min(axis=0)
    shape = tuple(np.floor((xyz[:, :2].max(axis=0) - origin) / CHM_CELL_M).astype(int) + 1)
    idx = np.floor((pts[:, :2] - origin) / CHM_CELL_M).astype(int)
    flat = idx[:, 0] * shape[1] + idx[:, 1]
    top = np.full(shape[0] * shape[1], np.nan)
    low = np.full(shape[0] * shape[1], np.nan)
    np.fmax.at(top, flat, h)
    np.fmin.at(low, flat, h)
    top, low = top.reshape(shape), low.reshape(shape)
    depth = np.where(np.isnan(top), 0.0, top - low)
    chm = np.nan_to_num(top, nan=0.0)

    band = int(np.ceil(BUILDING_BAND_M / CHM_CELL_M))
    building = _raster_mask(footprints, origin, shape) if footprints else np.zeros(shape, bool)
    if band and building.any():
        building = ndimage.binary_dilation(building, iterations=band)
    chm[building] = 0.0
    depth[building] = 0.0

    # A crown's top, smoothed so one high return does not make a peak of its own.
    smooth = ndimage.gaussian_filter(chm, 0.8)
    smooth[chm < MIN_TREE_M] = 0.0
    peaks = np.zeros(shape, dtype=bool)
    for radius in np.arange(1.0, MAX_WINDOW_M + 0.01, 0.5):
        r = round(float(radius) / CHM_CELL_M)
        yy, xx = np.mgrid[-r:r + 1, -r:r + 1]
        footprint = (xx ** 2 + yy ** 2) <= r * r
        is_max = smooth >= ndimage.maximum_filter(smooth, footprint=footprint) - 1e-6
        # This window belongs to the heights whose window rounds to it.
        wanted = np.abs(window_m(smooth) - radius) < 0.25
        peaks |= is_max & wanted
    peaks &= smooth >= MIN_TREE_M
    if not peaks.any():
        return []
    markers, _ = ndimage.label(peaks)
    # Grown over the canopy, each crown down to where it meets the next one or the canopy ends.
    canopy = chm >= 2.0
    level = np.clip(((smooth.max() - smooth) / max(smooth.max(), 1e-6)) * 250, 0, 250).astype(np.uint8)
    marks = markers.astype(np.int32)
    marks[~canopy & (marks == 0)] = -1
    labels = ndimage.watershed_ift(level, marks)
    labels[~canopy] = 0

    trees: list[Tree] = []
    ground_at = lambda e, n: float(grid[  # noqa: E731
        min(max(int((e - gorigin[0]) / gcell), 0), grid.shape[0] - 1),
        min(max(int((n - gorigin[1]) / gcell), 0), grid.shape[1] - 1)])
    objects = ndimage.find_objects(labels)
    for label, window in enumerate(objects, start=1):
        if window is None:
            continue
        cells = labels[window] == label
        n_cells = int(cells.sum())
        area = n_cells * CHM_CELL_M ** 2
        if area < MIN_CROWN_M2:
            continue
        ii, jj = np.nonzero(cells)
        ii = ii + window[0].start
        jj = jj + window[1].start
        crown_depth = float(np.median(depth[ii, jj]))
        if crown_depth < MIN_CROWN_DEPTH_M:
            continue
        coords = np.column_stack([ii, jj]).astype(float)
        if n_cells >= 4:
            spread = np.linalg.eigvalsh(np.cov(coords.T))
            if spread[0] <= 1e-9 or np.sqrt(spread[1] / spread[0]) > MAX_ELONGATION:
                continue
        heights = chm[ii, jj]
        k = int(np.argmax(heights))
        e = origin[0] + (ii[k] + 0.5) * CHM_CELL_M
        n = origin[1] + (jj[k] + 0.5) * CHM_CELL_M
        if half_extent_m is not None and (abs(e) > half_extent_m or abs(n) > half_extent_m):
            continue   # in the overlap: the neighbouring cell owns it
        trees.append(Tree(float(e), float(n), ground_at(e, n), float(heights[k]),
                          float(2 * np.sqrt(area / np.pi)), crown_depth, n_cells))
    return trees
