"""Plane fitting for the road and the walking surface.

The two planes are the skeleton of every geometric fact the product sells. Kerb height is the
vertical step between them, sidewalk cross slope is the tilt of the upper one, and sidewalk
width is its lateral extent. Fit them badly and every downstream number is wrong in a way no
amount of corroboration will reveal, because every contributor will fit them badly the same way.

RANSAC rather than least squares. A least-squares plane through a sidewalk point cloud is
dragged by the kerb face, by parked cars, by pedestrians, and by the road on the other side of
the gutter — all of which are *real* structure, not noise, so no amount of averaging removes
them. RANSAC finds the dominant plane and treats the rest as what it is: other things.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True, slots=True)
class Plane:
    """A plane as unit normal and offset: ``n . x + d = 0``."""

    normal: np.ndarray
    offset: float
    inliers: np.ndarray
    rms_m: float

    def __post_init__(self) -> None:
        normal = np.asarray(self.normal, dtype=np.float64).reshape(3)
        norm = float(np.linalg.norm(normal))
        if norm < 1e-9:
            raise ValueError("plane normal has zero length")
        normal = normal / norm
        # Canonical orientation: normals point up, so slope signs are comparable between fits.
        if normal[2] < 0:
            normal = -normal
            object.__setattr__(self, "offset", -self.offset)
        object.__setattr__(self, "normal", normal)

    @property
    def inlier_count(self) -> int:
        return int(self.inliers.sum())

    def height_at(self, east: float, north: float) -> float:
        """Surface height above the datum at a horizontal position."""
        if abs(self.normal[2]) < 1e-6:
            raise ValueError("plane is vertical; it has no single height")
        return -(self.normal[0] * east + self.normal[1] * north + self.offset) / self.normal[2]

    def distance_to(self, points: np.ndarray) -> np.ndarray:
        array = np.asarray(points, dtype=np.float64).reshape(-1, 3)
        return np.abs(array @ self.normal + self.offset)

    @property
    def slope(self) -> float:
        """Steepest slope as a fraction. A level surface is 0."""
        horizontal = float(np.linalg.norm(self.normal[:2]))
        return horizontal / max(abs(float(self.normal[2])), 1e-9)

    def slope_along(self, direction: np.ndarray) -> float:
        """Signed slope in a horizontal direction — the cross slope, given the kerb normal."""
        direction = np.asarray(direction, dtype=np.float64).reshape(3)
        direction = direction / max(float(np.linalg.norm(direction[:2])), 1e-9)
        return -float(
            (self.normal[0] * direction[0] + self.normal[1] * direction[1])
            / max(abs(float(self.normal[2])), 1e-9)
        )


#: Steepest slope a running surface can plausibly have. Well above the 8.33% ramp maximum,
#: far below a wall. Its real job is rejecting building facades, which are the densest planar
#: surfaces in a street scene and will otherwise win the fit outright.
MAX_WALKABLE_SLOPE = 0.20


def fit_plane_ransac(
    points: np.ndarray,
    *,
    threshold_m: float = 0.02,
    iterations: int = 300,
    min_inliers: int = 30,
    max_slope: float | None = None,
    rng: np.random.Generator | None = None,
) -> Plane | None:
    """Dominant plane in a point set, or ``None`` if there is not one.

    The default 20 mm threshold is chosen against the standards, not for convenience: it sits
    just above the quarter-inch (6.35 mm) level change that defines a trip hazard, so genuine
    surface defects stay *outliers* to the plane rather than being absorbed into it. Loosening
    it is how a pipeline stops being able to see the very features it exists to report.

    ``max_slope`` restricts candidates to surfaces that could be walked on. Without it a fit
    over a wearer's frame happily returns a shopfront: a facade is large, flat, densely sampled
    and completely vertical, so it beats the footway on inlier count and then reports a footway
    width of zero, because a vertical plane has no horizontal extent.
    """
    points = np.asarray(points, dtype=np.float64).reshape(-1, 3)
    if len(points) < max(3, min_inliers):
        return None
    rng = rng or np.random.default_rng(0)

    best_inliers: np.ndarray | None = None
    best_count = 0

    for _ in range(iterations):
        sample = points[rng.choice(len(points), size=3, replace=False)]
        normal = np.cross(sample[1] - sample[0], sample[2] - sample[0])
        norm = float(np.linalg.norm(normal))
        if norm < 1e-9:
            continue
        normal = normal / norm
        if max_slope is not None:
            vertical = abs(float(normal[2]))
            if vertical < 1e-6 or float(np.linalg.norm(normal[:2])) / vertical > max_slope:
                continue
        offset = -float(normal @ sample[0])
        inliers = np.abs(points @ normal + offset) < threshold_m
        count = int(inliers.sum())
        if count > best_count:
            best_count = count
            best_inliers = inliers

    if best_inliers is None or best_count < min_inliers:
        return None

    # Refit on the consensus set by total least squares (the smallest singular direction).
    consensus = points[best_inliers]
    centroid = consensus.mean(axis=0)
    _, _, vt = np.linalg.svd(consensus - centroid)
    normal = vt[-1]
    offset = -float(normal @ centroid)
    if max_slope is not None:
        vertical = abs(float(normal[2]))
        if vertical < 1e-6 or float(np.linalg.norm(normal[:2])) / vertical > max_slope:
            return None
    residuals = np.abs(points[best_inliers] @ normal + offset)

    return Plane(
        normal=normal,
        offset=offset,
        inliers=best_inliers,
        rms_m=float(np.sqrt(np.mean(residuals**2))),
    )


@dataclass(frozen=True, slots=True)
class KerbPlanes:
    """The road plane, the walking plane, and the step between them."""

    road: Plane
    walk: Plane
    #: Height of the walking surface above the road, at the kerb line.
    step_m: float
    kerb_offset_m: float
    road_points: np.ndarray
    walk_points: np.ndarray

    @property
    def planes_are_parallel(self) -> bool:
        """Whether the two surfaces are close to parallel, as a sanity signal."""
        return float(abs(self.road.normal @ self.walk.normal)) > 0.985


def estimate_kerb_offset(
    points: np.ndarray,
    cross_axis: np.ndarray,
    *,
    min_side_points: int = 30,
    step_m: float = 0.1,
) -> float | None:
    """Find the lateral position of the kerb line by scanning for the largest height step.

    Fitting planes first and splitting afterwards does not work here, and the failure is
    instructive: the roadway spans ten metres laterally while the kerb step is 0.15 m, so a
    plane tilted by two percent — well inside any plausible slope limit — reaches across both
    surfaces and RANSAC happily calls it the dominant plane. It has more inliers than either
    real surface, so no amount of iteration recovers.

    Scanning for the discontinuity first makes the problem well posed: split the points, then
    fit each side independently. A flush kerb is not a failure of this method, it is the
    answer — the largest step found is simply near zero.

    In production the split does not have to be searched for at all: the street map already
    says where the roadway edge is. :func:`smc.overlay.street.kerb_offset_from_map` supplies it,
    and this function is the fallback for when the map is silent.
    """
    points = np.asarray(points, dtype=np.float64).reshape(-1, 3)
    cross_axis = np.asarray(cross_axis, dtype=np.float64).reshape(3)
    cross_axis = cross_axis / max(float(np.linalg.norm(cross_axis)), 1e-9)
    lateral = points @ cross_axis

    low, high = np.percentile(lateral, [3.0, 97.0])
    if high - low < 3.0 * step_m:
        return None

    best_offset: float | None = None
    best_step = -np.inf
    for offset in np.arange(low + step_m, high - step_m, step_m):
        below = points[lateral < offset]
        above = points[lateral >= offset]
        if len(below) < min_side_points or len(above) < min_side_points:
            continue
        # Compare near the boundary only. Far-field points on a sloping surface would otherwise
        # dominate the median and hide the step.
        near_below = below[below @ cross_axis > offset - 1.5]
        near_above = above[above @ cross_axis < offset + 1.5]
        if len(near_below) < 10 or len(near_above) < 10:
            continue
        rise = float(np.median(near_above[:, 2]) - np.median(near_below[:, 2]))
        if rise > best_step:
            best_step = rise
            best_offset = float(offset)

    return best_offset


def split_kerb_planes(
    points: np.ndarray,
    *,
    threshold_m: float = 0.02,
    rng: np.random.Generator | None = None,
    cross_axis: np.ndarray | None = None,
    kerb_offset_hint: float | None = None,
    min_surface_points: int = 30,
) -> KerbPlanes | None:
    """Find the road and walking surfaces, and the step between them.

    Splits laterally at the kerb line, then fits each side independently. Pass
    ``kerb_offset_hint`` when the street map knows where the roadway edge is; otherwise the
    kerb line is located by :func:`estimate_kerb_offset`.
    """
    points = np.asarray(points, dtype=np.float64).reshape(-1, 3)
    rng = rng or np.random.default_rng(0)
    axis = np.array([0.0, 1.0, 0.0]) if cross_axis is None else np.asarray(cross_axis, float)
    axis = axis / max(float(np.linalg.norm(axis)), 1e-9)

    offset = kerb_offset_hint
    if offset is None:
        offset = estimate_kerb_offset(points, axis)
    if offset is None:
        return None

    lateral = points @ axis
    road_side = points[lateral < offset]
    walk_side = points[lateral >= offset]
    if len(road_side) < min_surface_points or len(walk_side) < min_surface_points:
        return None

    road = fit_plane_ransac(
        road_side,
        threshold_m=threshold_m,
        min_inliers=min_surface_points,
        max_slope=MAX_WALKABLE_SLOPE,
        rng=rng,
    )
    walk = fit_plane_ransac(
        walk_side,
        threshold_m=threshold_m,
        min_inliers=min_surface_points,
        max_slope=MAX_WALKABLE_SLOPE,
        rng=rng,
    )
    if road is None or walk is None:
        return None

    road_points = road_side[road.inliers]
    walk_points = walk_side[walk.inliers]

    # Evaluate both surfaces at the kerb line itself, where the step physically is.
    along = float(np.median(points[:, 0]))
    east, north = (along, offset) if abs(axis[1]) > abs(axis[0]) else (offset, along)
    step = walk.height_at(east, north) - road.height_at(east, north)

    return KerbPlanes(
        road=road,
        walk=walk,
        step_m=max(0.0, step),
        kerb_offset_m=offset,
        road_points=road_points,
        walk_points=walk_points,
    )


def perpendicular_extent(
    points: np.ndarray, axis: np.ndarray, *, trim_percent: float = 2.0
) -> tuple[float, float, float]:
    """Extent of a point set along a horizontal axis: (span, low, high).

    Percentile-bounded rather than min/max, because a single stray reconstruction point beyond
    the building line would otherwise report a twelve-metre footway.

    Trimming introduces a *known* bias, and it is corrected rather than tolerated: for points
    spread evenly across a surface, the p to 100-p percentile range covers ``1 - 2p/100`` of the
    true extent, so a 2% trim reads 4% narrow — 6 cm on a 1.5 m footway, which is a third of the
    Tier B tolerance being claimed. Dividing it back out costs nothing and removes a systematic
    error that no amount of corroboration would ever reveal, because every contributor would
    make it identically.
    """
    points = np.asarray(points, dtype=np.float64).reshape(-1, 3)
    axis = np.asarray(axis, dtype=np.float64).reshape(3)
    axis = axis / max(float(np.linalg.norm(axis)), 1e-9)
    projected = points @ axis
    low = float(np.percentile(projected, trim_percent))
    high = float(np.percentile(projected, 100.0 - trim_percent))
    coverage = 1.0 - 2.0 * trim_percent / 100.0
    span = (high - low) / coverage
    centre = (high + low) / 2.0
    return span, centre - span / 2.0, centre + span / 2.0


def slope_uncertainty(plane: Plane, span_m: float) -> float:
    """1-sigma uncertainty of a slope measured over a span, given the fit residual.

    Slope is a rise over a run, so the uncertainty falls as the run grows. A cross slope
    measured across a 1.5 m footway from a 15 mm fit is uncertain by about 1%, which straddles
    the 2.08% compliance limit — the arithmetic reason cross slope is a Tier C advisory and not
    a measured guarantee.
    """
    if span_m <= 0:
        raise ValueError("span_m must be positive")
    return math.sqrt(2.0) * plane.rms_m / span_m
