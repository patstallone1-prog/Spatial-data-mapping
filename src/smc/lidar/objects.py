"""Street objects in an aerial lidar cloud: poles, trees, short posts, bench-shaped clusters.

Aerial lidar sees the city from above, at twenty to sixty returns a square metre. A lamp post
returns a handful of points down its length; a bench a patch at seat height. That is enough to
say *where* something stands, how tall it is and roughly how wide -- which is what an object
needs to be asked about by every other source (``smc.reconstruction.object_cloud.gather``) --
and not enough to say which of several similar things it is. So the kinds here are shapes, not
names: a *pole* is thin and tall; a *tree* is thin at the foot and wide at the top; a *short
post* is a bollard or a hydrant or a bin, and this does not pretend to know which; a *bench
candidate* is long, narrow and low. Naming comes later, from photographs or the city's records.

Buildings are removed by footprint before clustering (their walls are the bulk of the
non-ground returns), and the ground by the classifier plus a height-above-ground floor.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from smc.geometry.primitives import fit_cylinder, min_area_rectangle

CLASS_GROUND = 2
CLASS_NOISE = 7
#: Returns this close to the ground are the ground (kerbs, cars' tyres, paving) whatever the
#: classifier said; returns above MAX_OBJECT_M belong to roofs and canopies, not street objects.
MIN_ABOVE_GROUND_M = 0.25
MAX_OBJECT_M = 15.0
GROUND_CELL_M = 0.5
#: Two returns within this in plan belong to the same object.
CLUSTER_M = 0.35
MIN_POINTS = 6


@dataclass(frozen=True)
class StreetObject:
    kind: str                 # pole | tree | short_post | bench_candidate
    east: float
    north: float
    ground_m: float
    height_m: float
    width_m: float
    length_m: float
    bearing_deg: float
    radius_m: float | None
    points: int
    confidence: float

    def to_json(self) -> dict:
        out = {"kind": self.kind, "e": round(self.east, 2), "n": round(self.north, 2),
               "ground_m": round(self.ground_m, 2), "height_m": round(self.height_m, 2),
               "width_m": round(self.width_m, 2), "length_m": round(self.length_m, 2),
               "bearing_deg": round(self.bearing_deg, 1), "points": self.points,
               "confidence": round(self.confidence, 2)}
        if self.radius_m is not None:
            out["radius_m"] = round(self.radius_m, 3)
        return out


def ground_heights(xyz: np.ndarray, classes: np.ndarray) -> tuple[np.ndarray, np.ndarray, float]:
    """A ground grid (median of ground returns per cell), its origin and cell size, with empty
    cells filled from their neighbours so every point has a ground under it."""
    ground = xyz[classes == CLASS_GROUND]
    if not len(ground):
        return np.zeros((1, 1)), xyz[:, :2].min(axis=0) if len(xyz) else np.zeros(2), GROUND_CELL_M
    origin = xyz[:, :2].min(axis=0)
    shape = (np.floor((xyz[:, :2].max(axis=0) - origin) / GROUND_CELL_M).astype(int) + 1)
    idx = np.floor((ground[:, :2] - origin) / GROUND_CELL_M).astype(int)
    grid = np.full(tuple(shape), np.nan)
    order = np.lexsort((ground[:, 2], idx[:, 1], idx[:, 0]))
    keys = idx[order]
    z = ground[order, 2]
    boundaries = np.flatnonzero(np.any(np.diff(keys, axis=0) != 0, axis=1)) + 1
    for group_keys, group_z in zip(np.split(keys, boundaries), np.split(z, boundaries),
                                   strict=True):
        grid[group_keys[0, 0], group_keys[0, 1]] = float(np.median(group_z))
    # Fill holes (under cars, trees, buildings) by repeated neighbour means.
    for _ in range(64):
        missing = np.isnan(grid)
        if not missing.any():
            break
        padded = np.pad(grid, 1, constant_values=np.nan)
        stack = np.stack([padded[1 + dx:padded.shape[0] - 1 + dx, 1 + dy:padded.shape[1] - 1 + dy]
                          for dx in (-1, 0, 1) for dy in (-1, 0, 1) if dx or dy])
        known = ~np.isnan(stack)
        count = known.sum(axis=0)
        fill = np.where(count > 0, np.where(known, stack, 0.0).sum(axis=0) / np.maximum(count, 1),
                        np.nan)
        grid = np.where(missing & ~np.isnan(fill), fill, grid)
    grid = np.where(np.isnan(grid), float(np.nanmedian(grid)) if np.isfinite(grid).any() else 0.0,
                    grid)
    return grid, origin, GROUND_CELL_M


def height_above_ground(xyz: np.ndarray, grid: np.ndarray, origin: np.ndarray,
                        cell: float) -> np.ndarray:
    idx = np.floor((xyz[:, :2] - origin) / cell).astype(int)
    idx[:, 0] = np.clip(idx[:, 0], 0, grid.shape[0] - 1)
    idx[:, 1] = np.clip(idx[:, 1], 0, grid.shape[1] - 1)
    return xyz[:, 2] - grid[idx[:, 0], idx[:, 1]]


def _clusters(xy: np.ndarray) -> list[np.ndarray]:
    keys = np.floor(xy / CLUSTER_M).astype(np.int64)
    cells: dict[tuple[int, int], list[int]] = {}
    for i, (a, b) in enumerate(keys):
        cells.setdefault((int(a), int(b)), []).append(i)
    label: dict[tuple[int, int], int] = {}
    groups: list[list[int]] = []
    for start in cells:
        if start in label:
            continue
        label[start] = len(groups)
        stack, members = [start], []
        while stack:
            c = stack.pop()
            members.extend(cells[c])
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    nb = (c[0] + dx, c[1] + dy)
                    if nb in cells and nb not in label:
                        label[nb] = label[start]
                        stack.append(nb)
        groups.append(members)
    return [np.asarray(g) for g in groups]


def detect(xyz: np.ndarray, classes: np.ndarray, inside_building: np.ndarray | None = None
           ) -> list[StreetObject]:
    """Street objects in one cell's points (local metres)."""
    grid, origin, cell = ground_heights(xyz, classes)
    hag = height_above_ground(xyz, grid, origin, cell)
    keep = (classes != CLASS_GROUND) & (classes != CLASS_NOISE) & \
        (hag > MIN_ABOVE_GROUND_M) & (hag < MAX_OBJECT_M)
    if inside_building is not None:
        keep &= ~inside_building
    pts, above = xyz[keep], hag[keep]
    found: list[StreetObject] = []
    for members in _clusters(pts[:, :2]):
        if len(members) < MIN_POINTS:
            continue
        p, h = pts[members], above[members]
        centre, yaw, length, width = min_area_rectangle(p[:, :2])
        if width > length:
            length, width, yaw = width, length, yaw + np.pi / 2
        top = float(np.percentile(h, 98))
        ground = float(np.median(p[:, 2] - h))
        low = h < min(1.5, top * 0.4)
        high = h > top * 0.6
        spread_low = float(np.ptp(p[low, :2], axis=0).max()) if low.sum() >= 3 else 0.0
        spread_high = float(np.ptp(p[high, :2], axis=0).max()) if high.sum() >= 3 else 0.0
        # How evenly the returns fill the object's height: a pole is hit down its length, a
        # canopy only at the top.
        filled = len(np.unique(np.floor(h / 0.5))) / max(1.0, top / 0.5)
        kind, radius = None, None
        if top >= 2.5 and length <= 0.8 and filled >= 0.35:
            kind = "pole"
            fit = fit_cylinder(np.column_stack([p[:, :2], h]))
            radius = float(fit.primitive.dims[0]) if fit.primitive.dims[0] < 0.5 else None
        elif top >= 3.0 and spread_high >= 2.0 and spread_high > 2.5 * max(spread_low, 0.3):
            kind = "tree"
        elif 0.4 <= top <= 1.4 and length <= 0.9:
            kind = "short_post"
        elif 0.35 <= top <= 1.2 and 1.2 <= length <= 3.2 and width <= 1.0:
            kind = "bench_candidate"
        if kind is None:
            continue
        confidence = float(min(1.0, len(members) / 40.0))
        found.append(StreetObject(kind, float(centre[0]), float(centre[1]), ground, top,
                                  float(width), float(length), float(np.degrees(yaw) % 180),
                                  radius, len(members), confidence))
    return found


def points_in_polygons(xy: np.ndarray, polygons: list[np.ndarray]) -> np.ndarray:
    """Even-odd point-in-polygon for many points against several polygons (bbox prefiltered)."""
    inside = np.zeros(len(xy), dtype=bool)
    for poly in polygons:
        lo, hi = poly.min(axis=0), poly.max(axis=0)
        cand = np.flatnonzero((xy[:, 0] >= lo[0]) & (xy[:, 0] <= hi[0]) &
                              (xy[:, 1] >= lo[1]) & (xy[:, 1] <= hi[1]))
        if not cand.size:
            continue
        x, y = xy[cand, 0], xy[cand, 1]
        hit = np.zeros(len(cand), dtype=bool)
        j = len(poly) - 1
        for i in range(len(poly)):
            xi, yi = poly[i]
            xj, yj = poly[j]
            crosses = ((yi > y) != (yj > y)) & \
                (x < (xj - xi) * (y - yi) / np.where(yj - yi == 0, 1e-12, yj - yi) + xi)
            hit ^= crosses
            j = i
        inside[cand] |= hit
    return inside
