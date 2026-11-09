"""What shape a roof is, from the aerial lidar returns that fall inside its footprint.

The region's lidar pass already reads a roof *height* for nearly every building
(:func:`smc.lidar.region.building_height`). The same returns say the roof's *shape*: planes are
fitted to them, one after another (RANSAC, then the next plane in what is left), and the set
of planes is read as a shape:

* ``flat`` -- the planes found are level (under ``FLAT_DEG``), at one height or several (a
  flat roof with a parapet, a penthouse or a light well is still flat);
* ``shed`` -- one pitched plane carries the roof (OpenStreetMap's ``skillion``);
* ``gable`` -- two pitched planes facing opposite ways (``gabled``);
* ``hip`` -- pitched planes facing three or four ways (``hipped``);
* ``unknown`` -- anything else: a cross gable, a mansard, a dome, a roof of many small planes.

It abstains rather than guesses where the returns cannot say: a footprint too small for its
planes to be told apart (``MIN_AREA_M2``), too few returns (``MIN_POINTS``), or a footprint
under tree canopy (vegetation returns over ``MAX_CANOPY_SHARE`` of what is inside it) -- a
crown over a roof is fitted as roof planes, at the wrong pitch. An abstention is ``unknown``
with ``abstain`` saying why.

Everything is in the lidar's local metres (:class:`smc.lidar.ept.LocalCloud`); nothing is
filled in. The tag the renderer draws is :data:`OSM_SHAPE` of the shape.
"""

from __future__ import annotations

import math

import numpy as np

from smc.lidar.ept import CLASS_GROUND, LocalCloud
from smc.lidar.region import _inside, enu

#: ASPRS classes 3-5: low, medium and high vegetation.
VEGETATION = (3, 4, 5)
#: Below this a footprint's planes cannot be told apart at the collection's spacing: a 40 m2
#: cottage roof is two 20 m2 faces, a few hundred returns each, and its eaves are most of it.
MIN_AREA_M2 = 45.0
MIN_POINTS = 150
#: Vegetation returns over this share of the footprint's non-ground returns: a crown over it.
MAX_CANOPY_SHARE = 0.15
#: Returns this far inside the outline only: the outline's edge is the wall, a neighbour's
#: eave or the gap between two buildings, none of them this roof.
EDGE_INSET_M = 0.6
#: Returns this far above the ground at the foot and more: not a car, a fence or a hedge.
MIN_ABOVE_GROUND_M = 2.0
#: A return within this of a plane is on it. The collection's vertical noise is ~5 cm; shingles
#: and tiles add their own relief.
PLANE_TOL_M = 0.15
RANSAC_TRIALS = 300
MAX_PLANES = 6
#: A plane must hold this share of the roof's returns (and at least MIN_PLANE_POINTS) to count.
MIN_PLANE_SHARE = 0.06
MIN_PLANE_POINTS = 25
#: Level to within this is flat; a pitched roof here is 15-45 degrees.
FLAT_DEG = 6.0
MIN_PITCH_DEG = 10.0
MAX_PITCH_DEG = 60.0
#: The planes found must hold this share of the roof's returns for any shape to be read.
MIN_EXPLAINED = 0.65
#: Two faces of a gable face opposite ways to within this.
OPPOSITE_TOL_DEG = 25.0
#: A pitched roof is only read over a footprint this close to its own bounding rectangle
#: (its area over the smallest rectangle round it): an L, a T or a house with wings has a roof of
#: crossing ridges, which the faces alone would call a hip. Measured on 135 Berkeley houses
#: labelled from the photographs: every complex roof was under 0.92; most hips 0.94-1.
MIN_RECTANGULARITY = 0.92
MAX_PITCHED_PLANES = 4
MIN_EXPLAINED_PITCHED = 0.8
#: How far a roof comes down at the two ends of its ridge, as a share of its rise: a gable's
#: ends are walls, so its faces reach them at full height (near 0). Only used to confirm a
#: two-faced roof is a gable: on hips it ranged 0.2-0.75, too wide to tell them by.
GABLE_MAX_END_DROP = 0.35

#: The shapes as OpenStreetMap's ``roof:shape`` writes them (what the renderer draws).
OSM_SHAPE = {"flat": "flat", "shed": "skillion", "gable": "gabled", "hip": "hipped"}


def _fit_plane(p: np.ndarray, rng: np.random.Generator) -> tuple[np.ndarray, float, np.ndarray] | None:
    """The plane through the most returns of ``p`` (RANSAC on three, refined by least squares)."""
    n = len(p)
    if n < 3:
        return None
    best: tuple[int, np.ndarray, float] | None = None
    for _ in range(RANSAC_TRIALS):
        a, b, c = p[rng.choice(n, 3, replace=False)]
        normal = np.cross(b - a, c - a)
        norm = float(np.linalg.norm(normal))
        if norm < 1e-6:
            continue
        normal /= norm
        if normal[2] < 0:
            normal = -normal
        # A wall is not a roof.
        if normal[2] < math.cos(math.radians(MAX_PITCH_DEG + 5)):
            continue
        d = -float(normal @ a)
        count = int((np.abs(p @ normal + d) < PLANE_TOL_M).sum())
        if best is None or count > best[0]:
            best = (count, normal, d)
    if best is None:
        return None
    inliers = np.abs(p @ best[1] + best[2]) < PLANE_TOL_M
    # Least squares on the inliers: z = ax + by + c.
    q = p[inliers]
    if len(q) >= 3:
        A = np.column_stack((q[:, 0], q[:, 1], np.ones(len(q))))
        (ax, by, c), *_ = np.linalg.lstsq(A, q[:, 2], rcond=None)
        normal = np.array([-ax, -by, 1.0])
        normal /= np.linalg.norm(normal)
        d = -float(normal @ np.array([0.0, 0.0, c]))
        inliers = np.abs(p @ normal + d) < PLANE_TOL_M
        return normal, d, inliers
    return best[1], best[2], inliers


def _inset(poly: np.ndarray, metres: float) -> np.ndarray:
    """The outline pulled in towards its centroid by about ``metres`` (good enough for a test of
    which returns are well inside it; a true offset is not needed)."""
    centre = poly.mean(axis=0)
    out = []
    for v in poly:
        d = v - centre
        r = float(np.linalg.norm(d))
        out.append(centre + d * max(0.0, (r - metres) / r) if r > 1e-6 else v)
    return np.array(out)


def _area(poly: np.ndarray) -> float:
    x, y = poly[:, 0], poly[:, 1]
    return float(abs(np.dot(x, np.roll(y, -1)) - np.dot(np.roll(x, -1), y)) / 2.0)


def _angle_diff(a: float, b: float) -> float:
    d = abs(a - b) % 360.0
    return min(d, 360.0 - d)


def rectangularity(poly: np.ndarray) -> float:
    """A footprint's area over the area of the smallest rectangle round it (1 for a rectangle)."""
    area = _area(poly)
    best = math.inf
    closed = np.vstack((poly, poly[:1]))
    for i in range(len(poly)):
        d = closed[i + 1] - closed[i]
        length = float(np.hypot(*d))
        if length < 1e-6:
            continue
        u = d / length
        v = np.array([-u[1], u[0]])
        best = min(best, float(np.ptp(poly @ u) * np.ptp(poly @ v)))
    return area / best if best > 0 and math.isfinite(best) else 0.0


def end_drop(points: np.ndarray, ridge_bearing_deg: float) -> float | None:
    """How far the roof comes down at the ends of a ridge running along ``ridge_bearing_deg``,
    as a share of its rise (see GABLE_MAX_END_DROP)."""
    if len(points) < 60:
        return None
    a = math.radians(ridge_bearing_deg)
    along = points[:, 0] * math.sin(a) + points[:, 1] * math.cos(a)
    lo, hi = np.percentile(along, 2), np.percentile(along, 98)
    span = hi - lo
    if span < 4.0:
        return None
    z = points[:, 2]
    eave, ridge = float(np.percentile(z, 5)), float(np.percentile(z, 97))
    rise = ridge - eave
    if rise < 0.8:
        return None
    end = 0.12 * span
    tops = []
    for sel in (along <= lo + end, along >= hi - end):
        if sel.sum() < 8:
            return None
        tops.append(float(np.percentile(z[sel], 95)))
    return max(0.0, min(1.0, (ridge - min(tops)) / rise))


def classify_planes(planes: list[dict], explained: float, *, rect: float = 1.0,
                    drop: float | None = None) -> tuple[str, str | None]:
    """The shape a set of fitted planes makes: (shape, why it is unknown or None). ``rect``:
    the footprint's rectangularity; ``drop``: the roof's end drop along its main ridge."""
    if explained < MIN_EXPLAINED:
        return "unknown", "no dominant planes"
    total = sum(p["share"] for p in planes) or 1.0
    flat = sum(p["share"] for p in planes if p["slope_deg"] < FLAT_DEG)
    pitched = [p for p in planes if MIN_PITCH_DEG <= p["slope_deg"] <= MAX_PITCH_DEG]
    pitched_share = sum(p["share"] for p in pitched)
    if flat / total >= 0.8:
        return "flat", None
    if pitched_share / total < 0.7:
        return "unknown", "mixed flat and pitched"
    if rect < MIN_RECTANGULARITY:
        return "unknown", "footprint not a simple rectangle"
    if len(pitched) > MAX_PITCHED_PLANES:
        return "unknown", "complex pitched roof"
    if explained < MIN_EXPLAINED_PITCHED:
        return "unknown", "no dominant planes"
    pitched.sort(key=lambda p: -p["share"])
    main = pitched[0]
    if main["share"] / pitched_share >= 0.85 and len(pitched) == 1:
        return "shed", None
    # The directions the pitched faces look, each counted once per 90-degree quadrant about the
    # main face's: opposite, either side.
    ways = {0}
    for p in pitched[1:]:
        d = _angle_diff(p["azimuth_deg"], main["azimuth_deg"])
        if d <= 45:
            continue   # a face looking the same way (a step in the roof)
        ways.add(2 if d >= 135 else 1 if (p["azimuth_deg"] - main["azimuth_deg"]) % 360 < 180 else 3)
    if ways == {0, 2} and len(pitched) >= 2:
        two = pitched[1]
        if _angle_diff(two["azimuth_deg"], main["azimuth_deg"]) < 180 - OPPOSITE_TOL_DEG \
                or (main["share"] + two["share"]) / pitched_share < 0.8:
            return "unknown", "complex pitched roof"
        # Two faces only: a gable if its ridge reaches the ends at full height (gable walls);
        # otherwise it may be a hip whose small end faces were too small to fit.
        if drop is not None and drop <= GABLE_MAX_END_DROP:
            return "gable", None
        return "unknown", "two faces, ridge ends not walls"
    # Faces looking three or four ways over a rectangle: a hip.
    if len(ways) >= 3:
        return "hip", None
    return "unknown", "complex pitched roof"


def roof_shape(cloud: LocalCloud, ring: list[list[float]], *, seed: int = 0) -> dict:
    """The shape of the roof over one footprint (``ring``: [lon, lat] pairs)."""
    lat0, lon0 = cloud.origin_lat, cloud.origin_lon
    poly = np.array([enu(lat, lon, lat0, lon0) for lon, lat in ring], dtype=np.float64)
    if len(poly) > 3 and np.allclose(poly[0], poly[-1]):
        poly = poly[:-1]
    area = _area(poly)
    out: dict = {"shape": "unknown", "area_m2": round(area, 1)}
    if area < MIN_AREA_M2:
        return {**out, "abstain": "too small"}
    xmin, ymin = poly.min(axis=0) - 2.0
    xmax, ymax = poly.max(axis=0) + 2.0
    box = (cloud.east >= xmin) & (cloud.east <= xmax) & (cloud.north >= ymin) & (cloud.north <= ymax)
    e, n, u, c = cloud.east[box], cloud.north[box], cloud.up[box], cloud.classification[box]
    inside = _inside(_inset(poly, EDGE_INSET_M), e, n)
    # The ground at the foot: ground returns in and within two metres of the outline.
    ground = u[c == CLASS_GROUND]
    if ground.size < 8:
        return {**out, "abstain": "no ground near"}
    base = float(np.median(ground))
    above = inside & (c != CLASS_GROUND) & (u > base + MIN_ABOVE_GROUND_M)
    veg = above & np.isin(c, VEGETATION)
    if above.sum() and veg.sum() / above.sum() > MAX_CANOPY_SHARE:
        return {**out, "abstain": "under canopy", "canopy_share": round(float(veg.sum() / above.sum()), 2)}
    keep = above & ~veg
    if int(keep.sum()) < MIN_POINTS:
        return {**out, "abstain": "too few returns", "points": int(keep.sum())}
    p = np.column_stack((e[keep], n[keep], u[keep]))
    # Clutter well below the top (an awning, a lower annex's roof seen past the inset) is not
    # this roof: keep the top 8 m of it.
    top = float(np.percentile(p[:, 2], 98))
    p = p[p[:, 2] >= top - 8.0]
    total = len(p)
    rng = np.random.default_rng(seed)
    planes: list[dict] = []
    left = np.ones(total, dtype=bool)
    for _ in range(MAX_PLANES):
        rest = p[left]
        if len(rest) < MIN_PLANE_POINTS:
            break
        fit = _fit_plane(rest, rng)
        if fit is None:
            break
        normal, _, on = fit
        count = int(on.sum())
        if count < max(MIN_PLANE_POINTS, MIN_PLANE_SHARE * total):
            break
        slope = math.degrees(math.acos(max(-1.0, min(1.0, float(normal[2])))))
        # The way the face looks: its downhill direction, a compass bearing (0 north, 90 east).
        azimuth = math.degrees(math.atan2(normal[0], normal[1])) % 360.0
        z = rest[on, 2]
        planes.append({"slope_deg": round(slope, 1), "azimuth_deg": round(azimuth, 1), "share": round(count / total, 3),
                       "z_top": round(float(np.percentile(z, 95)), 2), "z_low": round(float(np.percentile(z, 5)), 2)})
        idx = np.flatnonzero(left)
        left[idx[on]] = False
    explained = 1.0 - left.sum() / total
    rect = rectangularity(poly)
    pitched = [q for q in planes if MIN_PITCH_DEG <= q["slope_deg"] <= MAX_PITCH_DEG]
    drop = None
    if pitched:
        # The main face looks one way; its ridge runs across that.
        main = max(pitched, key=lambda q: q["share"])
        drop = end_drop(p, (main["azimuth_deg"] + 90.0) % 360.0)
    shape, why = classify_planes(planes, explained, rect=rect, drop=drop)
    out.update({"shape": shape, "points": total, "explained": round(float(explained), 3), "planes": planes,
                "rectangularity": round(rect, 3), "end_drop": None if drop is None else round(drop, 2)})
    if why:
        out["why"] = why
    if shape in ("shed", "gable", "hip") and pitched:
        out["pitch_deg"] = round(float(np.average([q["slope_deg"] for q in pitched], weights=[q["share"] for q in pitched])), 1)
        out["roof_height_m"] = round(max(q["z_top"] for q in pitched) - min(q["z_low"] for q in pitched), 2)
        main = max(pitched, key=lambda q: q["share"])
        # roof:direction is the way a skillion's face looks; a gable's ridge runs across it.
        out["direction_deg"] = main["azimuth_deg"]
    return out
