"""Measure kerbs from a point cloud along a mapped footway.

The measurement itself is not new here. :func:`smc.measure.extract.measure_cross_section` has
always known how to take a slice of points across a kerb, split it into a road plane and a
walking plane, and report the step between them. What it never had was points it could trust:
everything upstream of it was either simulated or recovered from photographs, where the scale
of the reconstruction is itself an estimate and the kerb height inherits that uncertainty.

Aerial lidar removes that. Range is measured, not inferred, so there is no scale unknown for the
error budget to carry -- what is left is the scatter of the surface fits, which is measured too.
This module's whole job is to turn a mapped footway into slices in the frame that function
expects: along the kerb, across it, and up.

The across-axis has to point from the road toward the footway, because that is the sign
convention the splitter uses to decide which side is which. It is taken from the nearest mapped
street rather than from the footway's own winding order, which is arbitrary in OpenStreetMap and
would silently swap road for footway on about half the ways.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from smc.lidar.ept import EptReader, LocalCloud
from smc.measure.extract import CrossSection, MeasurementConfig, measure_cross_section

EARTH_RADIUS_M = 6_378_137.0

#: How far each slice reaches toward the road and away from it. The road side needs enough
#: surface to fit a plane through parked cars and camber; the footway side stops before the
#: building line, where steps and stoops would offer a second discontinuity to lock onto.
ROAD_REACH_M = 6.0
WALK_REACH_M = 4.0

#: Slices are taken every ``STATION_STEP_M`` and each gathers points within half a step either
#: side, so the whole length is covered exactly once with no overlap between neighbours.
STATION_STEP_M = 5.0

#: Lateral bin width for locating the kerb line. Ground returns arrive at roughly fifty per
#: square metre, so a 25 cm bin across a five-metre slice holds enough points for a stable
#: median while staying narrower than the feature being looked for.
KERB_BIN_M = 0.25

#: A kerb is only accepted where the ground surface actually steps. The rise between adjacent
#: bins has to clear both an absolute floor -- below about six centimetres a step is
#: indistinguishable from this sensor's own vertical scatter -- and a multiple of the local
#: surface roughness, which is what separates a kerb from a road that happens to be cambered.
MIN_STEP_M = 0.06
MIN_STEP_SNR = 3.0

#: How many bins on each side of a candidate riser are averaged to get the surface level there.
#: Two bins is half a metre of road and half a metre of footway -- long enough to be a plateau,
#: short enough not to reach the crown of the road or the building line.
PLATEAU_BINS = 2

#: Above this the feature is not a kerb. San Francisco has retaining walls, stairways and
#: garden terraces along its footways, and they read as clean steps of a metre or more.
MAX_STEP_M = 0.45

#: Lidar is metrically exact, so unlike a photogrammetric reconstruction there is no scale
#: factor to propagate: the height error is the scatter of the two plane fits and nothing else.
#: Leaving this at the photogrammetric default would inflate every sigma by an error that this
#: sensor does not make.
LIDAR_CONFIG = MeasurementConfig(
    plane_threshold_m=0.05,
    scale_relative_sigma=0.0,
    min_surface_points=60,
    cross_axis=(0.0, 1.0, 0.0),
)


@dataclass(frozen=True, slots=True)
class SegmentMeasurement:
    """One slice, placed on the ground."""

    section: CrossSection
    lat: float
    lon: float
    station_m: float
    point_count: int


def _enu(lat: float, lon: float, lat0: float, lon0: float) -> tuple[float, float]:
    """Local east/north metres of a position about an origin."""
    east = math.radians(lon - lon0) * EARTH_RADIUS_M * math.cos(math.radians(lat0))
    north = math.radians(lat - lat0) * EARTH_RADIUS_M
    return east, north


def _latlon(east: float, north: float, lat0: float, lon0: float) -> tuple[float, float]:
    lat = lat0 + math.degrees(north / EARTH_RADIUS_M)
    lon = lon0 + math.degrees(east / (EARTH_RADIUS_M * math.cos(math.radians(lat0))))
    return lat, lon


#: A run is measured as a straight line from its first vertex to its last, so a long winding
#: footway has to be broken up before it is measured. Eighty metres is short enough that a city
#: block's curve stays inside the corridor half-width, and long enough to amortise the lidar
#: fetch over a useful number of slices.
MAX_RUN_M = 80.0


def split_footway(
    points: list[tuple[float, float]], *, max_run_m: float = MAX_RUN_M
) -> list[list[tuple[float, float]]]:
    """Break a footway into runs short enough to treat as straight.

    Two things go wrong without this, and only one of them is obvious. The obvious one is cost:
    a cell's lidar fetch is sized to hold its longest footway, so a single kilometre-long way
    drags a half-kilometre box into memory and the cell takes hours instead of seconds.

    The other is quietly worse. A run is projected onto the line between its first and last
    vertex, so on a way that bends, the slices are cut across a chord rather than across the
    kerb -- and near the middle of a long bend they miss the footway altogether. The measurement
    that comes back is not a worse kerb, it is some other piece of ground.
    """
    if len(points) < 2:
        return []
    runs: list[list[tuple[float, float]]] = []
    current: list[tuple[float, float]] = [points[0]]
    for point in points[1:]:
        current.append(point)
        lon0, lat0 = current[0]
        lon1, lat1 = current[-1]
        east, north = _enu(lat1, lon1, lat0, lon0)
        if math.hypot(east, north) >= max_run_m:
            runs.append(current)
            # The next run starts where this one ended, so the join is measured from both sides
            # rather than falling in a gap between them.
            current = [point]
    if len(current) >= 2:
        runs.append(current)
    return runs


def measure_footway(
    reader: EptReader,
    footway: list[tuple[float, float]],
    road_point: tuple[float, float],
    *,
    config: MeasurementConfig | None = None,
    station_step_m: float = STATION_STEP_M,
    cloud: LocalCloud | None = None,
) -> list[SegmentMeasurement]:
    """Measure every slice along one mapped footway.

    ``footway`` is a run of ``(lon, lat)`` vertices; ``road_point`` is ``(lon, lat)`` anywhere on
    the roadway it runs beside, and is used only to orient the across-axis.
    """
    if len(footway) < 2:
        return []
    config = config or LIDAR_CONFIG

    lon0, lat0 = footway[len(footway) // 2]
    vertices = np.array([_enu(lat, lon, lat0, lon0) for lon, lat in footway], dtype=np.float64)

    start, end = vertices[0], vertices[-1]
    span = end - start
    length = float(np.hypot(*span))
    if length < station_step_m:
        return []
    along = span / length

    # Left-hand normal of the along-axis, then flipped if it points at the road rather than away
    # from it. The footway's own direction of travel carries no meaning here.
    across = np.array([-along[1], along[0]])
    road_east, road_north = _enu(road_point[1], road_point[0], lat0, lon0)
    toward_road = np.array([road_east, road_north]) - start
    if float(toward_road @ across) > 0:
        across = -across

    if cloud is None:
        radius = length / 2.0 + ROAD_REACH_M + WALK_REACH_M
        midpoint = (start + end) / 2.0
        mid_lat, mid_lon = _latlon(midpoint[0], midpoint[1], lat0, lon0)
        cloud = reader.around(mid_lat, mid_lon, radius)
    ground = cloud.ground()
    if len(ground) < config.min_surface_points:
        return []

    # Cloud origin and footway origin are different points, so shift before projecting.
    origin_east, origin_north = _enu(cloud.origin_lat, cloud.origin_lon, lat0, lon0)
    east = ground.east + origin_east
    north = ground.north + origin_north

    relative = np.column_stack((east - start[0], north - start[1]))
    u = relative @ along
    v = relative @ across
    w = ground.up

    in_corridor = (v > -ROAD_REACH_M) & (v < WALK_REACH_M)
    u, v, w = u[in_corridor], v[in_corridor], w[in_corridor]

    out: list[SegmentMeasurement] = []
    half = station_step_m / 2.0
    for station in np.arange(half, length, station_step_m):
        window = (u > station - half) & (u <= station + half)
        if int(window.sum()) < config.min_surface_points:
            continue
        offset = find_kerb_line(v[window], w[window])
        if offset is None:
            # No step here that this sensor can distinguish from its own noise. Saying nothing
            # is the correct output: the plane splitter will always return *a* pair of surfaces,
            # and on a smoothly cambered road that pair is two halves of the same road.
            continue
        slab = np.column_stack((u[window] - station, v[window], w[window]))
        section = measure_cross_section(
            slab, float(station), config=config, kerb_offset_hint=offset
        )
        if section.kerb is not None and not (MIN_STEP_M <= section.kerb.height_m <= MAX_STEP_M):
            # The binned profile found a riser inside the plausible range and the plane fit then
            # disagreed with it. That happens where the riser is the bottom of a stairway or a
            # terraced garden wall: the detector sees its first step, the fit spans the whole
            # structure. Bounding the detector alone let a handful of 900 mm walls through as
            # kerbs, and a wrong measurement is worse here than a missing one -- the whole point
            # of this pass is that what it does write came off a sensor.
            continue
        here = start + along * station
        lat, lon = _latlon(here[0], here[1], lat0, lon0)
        out.append(SegmentMeasurement(section, lat, lon, float(station), int(window.sum())))
    return out


def find_kerb_line(lateral: np.ndarray, up: np.ndarray) -> float | None:
    """Where the ground steps up, or ``None`` if it does not.

    Returns the lateral offset of the riser, in the same frame as ``lateral``, suitable for
    passing to :func:`smc.measure.extract.measure_cross_section` as ``kerb_offset_hint``.

    Working from a binned median profile rather than from the plane fit is deliberate. Fitting
    first and asking questions afterwards always produces two planes and therefore always
    produces a height; the question of whether there is a kerb at all has to be settled before
    anything is fitted, and it has to be settled against the surface's own roughness rather than
    against a fixed threshold.
    """
    if lateral.size < 40:
        return None
    edges = np.arange(lateral.min(), lateral.max() + KERB_BIN_M, KERB_BIN_M)
    if edges.size < 4:
        return None
    index = np.clip(np.digitize(lateral, edges) - 1, 0, edges.size - 2)

    medians = np.full(edges.size - 1, np.nan)
    spreads = np.full(edges.size - 1, np.nan)
    for b in range(edges.size - 1):
        here = up[index == b]
        if here.size < 8:
            continue
        medians[b] = np.median(here)
        # Median absolute deviation, scaled to a standard deviation. Robust to the odd point on
        # a parked car or a pedestrian standing at the kerb.
        spreads[b] = 1.4826 * np.median(np.abs(here - medians[b]))

    # Compare plateau to plateau, skipping the bin the riser falls in. A kerb never lands neatly
    # on a bin edge, so the transition is smeared across one or two bins and the difference
    # between immediate neighbours reads short -- a 70 mm kerb measures 45 mm and falls under the
    # floor. Taking the level a couple of bins clear on each side recovers the step itself and
    # stops the result depending on where the bin edges happened to fall.
    count = medians.size
    rises = np.full(count - 1, np.nan)
    for b in range(1, count - 2):
        before = medians[max(0, b - PLATEAU_BINS + 1) : b + 1]
        after = medians[b + 2 : b + 2 + PLATEAU_BINS]
        if not (np.isfinite(before).any() and np.isfinite(after).any()):
            continue
        rises[b] = np.nanmedian(after) - np.nanmedian(before)

    valid = np.isfinite(rises)
    if not valid.any():
        return None

    # Roughness is taken across the whole profile, not from the two bins either side of the
    # candidate. Those two bins straddle the riser and therefore contain both surfaces by
    # construction, so their spread is about half the step height -- using it as the noise floor
    # divides the signal by itself and suppresses precisely the feature being looked for. Most
    # bins lie on flat road or flat footway, so their median spread is what the surface actually
    # does when nothing is happening.
    roughness = float(np.nanmedian(spreads)) if np.isfinite(spreads).any() else 0.0
    noise = max(roughness, MIN_STEP_M / MIN_STEP_SNR)
    # The footway is on the positive side of the axis, so a kerb is a rise, not a drop.
    score = np.where(valid & (rises > 0), rises / noise, -np.inf)
    best = int(np.argmax(score))
    if not np.isfinite(score[best]) or score[best] < MIN_STEP_SNR:
        return None
    if not (MIN_STEP_M <= rises[best] <= MAX_STEP_M):
        return None
    return float(edges[best + 1])
