"""What a region's streets and buildings measure in the public aerial lidar, with no city record.

San Francisco's kerbs came from the city's own curb lines; its building heights from a
DataSF table. A region outside the city has neither, and its capability vector said "lidar"
for kerbs and heights while the build ran on OpenStreetMap widths and default heights. This
is the extractor that makes the word true:

* :func:`street_kerbs` -- along a street, every ``STATION_M``, the lidar ground points in a
  strip across the way; on each side, the first riser the road steps up at
  (:func:`smc.lidar.curb.find_kerb_line`, the same detector the corridor's footways were
  measured with), its offset from the centreline and its height. A station with no riser the
  sensor can tell from its own noise records nothing; the cross-section solver then runs on
  the mapped width there and says so.
* :func:`building_height` -- the returns the classifier did not call ground, inside a
  footprint, against the ground at its foot: a roof height with the number of points behind
  it. Aerial lidar sees every roof, so this is a measurement for every building, not the
  subset the map tagged.

Everything is in the lidar's own frame and comes with counts; nothing is filled in.
"""

from __future__ import annotations

import itertools
import math
from dataclasses import dataclass

import numpy as np

from smc.lidar.curb import KERB_BIN_M, MAX_STEP_M, MIN_STEP_M, MIN_STEP_SNR, PLATEAU_BINS
from smc.lidar.ept import CLASS_GROUND, LocalCloud

#: Stations along a street. The city's curb profile is read every 2 m; 4 m keeps a region's
#: lidar pass to a quarter of the arithmetic and still gives a bulb-out three stations.
STATION_M = 4.0
#: Half the along-street window a station's cross-section is taken over.
HALF_ALONG_M = 1.5
#: The riser is looked for from just off the centreline out to this far: a 40 m boulevard's
#: kerb is 20 m out; anything past this is the building line, not the kerb.
SEARCH_M = 22.0
#: A riser closer to the centreline than this is a median island, not the kerb.
MIN_OFFSET_M = 1.5
MIN_STRIP_POINTS = 60
#: Building heights: at least this many non-ground returns inside the footprint.
MIN_ROOF_POINTS = 30
ROOF_PERCENTILE = 92.0
EARTH_RADIUS_M = 6_378_137.0


@dataclass(frozen=True)
class KerbStation:
    s_m: float
    lon: float
    lat: float
    left_m: float | None      # offset of the left kerb from the centreline, positive
    right_m: float | None
    left_height_m: float | None
    right_height_m: float | None
    points: int


def enu(lat: float, lon: float, lat0: float, lon0: float) -> tuple[float, float]:
    east = math.radians(lon - lon0) * EARTH_RADIUS_M * math.cos(math.radians(lat0))
    north = math.radians(lat - lat0) * EARTH_RADIUS_M
    return east, north


def latlon(east: float, north: float, lat0: float, lon0: float) -> tuple[float, float]:
    lat = lat0 + math.degrees(north / EARTH_RADIUS_M)
    lon = lon0 + math.degrees(east / (EARTH_RADIUS_M * math.cos(math.radians(lat0))))
    return lat, lon


def _step_height(lateral: np.ndarray, up: np.ndarray, offset: float) -> float | None:
    """The kerb's height at a riser: the plateau past it less the plateau before it."""
    before = up[(lateral > offset - 1.2) & (lateral < offset - 0.3)]
    after = up[(lateral > offset + 0.3) & (lateral < offset + 1.2)]
    if before.size < 8 or after.size < 8:
        return None
    height = float(np.median(after) - np.median(before))
    return height if MIN_STEP_M <= height <= MAX_STEP_M else None


def first_riser(lateral: np.ndarray, up: np.ndarray) -> float | None:
    """The first step up of kerb height, walking out from the centreline.

    The corridor's footway detector (smc.lidar.curb.find_kerb_line) takes the *strongest* rise
    in a profile, which on a footway is the kerb; across a whole street the strongest rise is
    the garden wall or the building line, three metres up, and it refuses. Here the kerb is
    the first plateau-to-plateau rise of kerb height at kerb signal-to-noise, nearest the
    road; a median island a metre out is passed over by MIN_OFFSET_M.
    """
    if lateral.size < 40:
        return None
    edges = np.arange(lateral.min(), lateral.max() + KERB_BIN_M, KERB_BIN_M)
    if edges.size < 6:
        return None
    index = np.clip(np.digitize(lateral, edges) - 1, 0, edges.size - 2)
    medians = np.full(edges.size - 1, np.nan)
    spreads = np.full(edges.size - 1, np.nan)
    for b in range(edges.size - 1):
        here = up[index == b]
        if here.size < 8:
            continue
        medians[b] = np.median(here)
        spreads[b] = 1.4826 * np.median(np.abs(here - medians[b]))
    roughness = float(np.nanmedian(spreads)) if np.isfinite(spreads).any() else 0.0
    noise = max(roughness, MIN_STEP_M / MIN_STEP_SNR)
    count = medians.size
    rises = np.full(count, np.nan)
    for b in range(1, count - 2):
        before = medians[max(0, b - PLATEAU_BINS + 1): b + 1]
        after = medians[b + 2: b + 2 + PLATEAU_BINS]
        if np.isfinite(before).any() and np.isfinite(after).any():
            rises[b] = float(np.nanmedian(after) - np.nanmedian(before))
    passes = np.isfinite(rises) & (rises >= MIN_STEP_M) & (rises <= MAX_STEP_M) & (rises / noise >= MIN_STEP_SNR)
    passes &= edges[1:count + 1] >= MIN_OFFSET_M
    if not passes.any():
        return None
    # The riser smears over a bin or two, so a run of bins passes; the riser is the bin in the
    # first run where the rise peaks, and the kerb stands in the middle of that bin.
    first = int(np.argmax(passes))
    last = first
    while last + 1 < count and passes[last + 1]:
        last += 1
    b = first + int(np.nanargmax(rises[first:last + 1]))
    return float(edges[b + 1]) + KERB_BIN_M / 2.0


def _side_kerb(lateral: np.ndarray, up: np.ndarray) -> tuple[float | None, float | None]:
    """The first riser on one side. ``lateral`` is positive away from the centreline."""
    keep = (lateral > 0.3) & (lateral < SEARCH_M)
    if int(keep.sum()) < MIN_STRIP_POINTS:
        return None, None
    lat_, up_ = lateral[keep], up[keep]
    offset = first_riser(lat_, up_)
    if offset is None:
        return None, None
    return offset, _step_height(lat_, up_, offset)


def street_kerbs(cloud: LocalCloud, points: list[list[float]], *, station_m: float = STATION_M) -> list[KerbStation]:
    """Kerb offsets and heights at stations along one street way, from one cloud."""
    if len(points) < 2:
        return []
    ground = cloud.classification == CLASS_GROUND
    if int(ground.sum()) < MIN_STRIP_POINTS:
        return []
    ge = cloud.east[ground]
    gn = cloud.north[ground]
    gu = cloud.up[ground]
    lat0, lon0 = cloud.origin_lat, cloud.origin_lon
    verts = np.array([enu(lat, lon, lat0, lon0) for lon, lat in points], dtype=np.float64)
    out: list[KerbStation] = []
    acc = 0.0
    next_s = station_m / 2.0
    for a, b in itertools.pairwise(verts):
        seg = b - a
        length = float(np.hypot(*seg))
        if length <= 0:
            continue
        along = seg / length
        across = np.array([-along[1], along[0]])          # left-hand normal
        # Only the points near this segment matter; cut the cloud down once per segment.
        rel = np.column_stack((ge - a[0], gn - a[1]))
        u = rel @ along
        v = rel @ across
        near = (u > -HALF_ALONG_M) & (u < length + HALF_ALONG_M) & (np.abs(v) < SEARCH_M + 1)
        u_, v_, w_ = u[near], v[near], gu[near]
        while next_s <= acc + length:
            t = next_s - acc
            window = (u_ > t - HALF_ALONG_M) & (u_ <= t + HALF_ALONG_M)
            n = int(window.sum())
            if n >= MIN_STRIP_POINTS:
                lat_v, up_v = v_[window], w_[window]
                left, left_h = _side_kerb(lat_v, up_v)
                right, right_h = _side_kerb(-lat_v, up_v)
                if left is not None or right is not None:
                    here = a + along * t
                    lat, lon = latlon(float(here[0]), float(here[1]), lat0, lon0)
                    out.append(KerbStation(round(next_s, 2), lon, lat, left, right, left_h, right_h, n))
            next_s += station_m
        acc += length
    return out


def _inside(poly: np.ndarray, x: np.ndarray, y: np.ndarray) -> np.ndarray:
    """Vectorised ray cast: which of the points lie inside the polygon."""
    inside = np.zeros(x.shape, dtype=bool)
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        crosses = (y1 > y) != (y2 > y)
        with np.errstate(divide="ignore", invalid="ignore"):
            xs = x1 + (y - y1) * (x2 - x1) / ((y2 - y1) if y2 != y1 else 1e-12)
        inside ^= crosses & (xs > x)
    return inside


def building_height(cloud: LocalCloud, ring: list[list[float]]) -> dict | None:
    """The roof height of one footprint from the returns inside it, over the ground at its foot."""
    if len(ring) < 3:
        return None
    lat0, lon0 = cloud.origin_lat, cloud.origin_lon
    poly = np.array([enu(lat, lon, lat0, lon0) for lon, lat in ring], dtype=np.float64)
    xmin, ymin = poly.min(axis=0) - 4.0
    xmax, ymax = poly.max(axis=0) + 4.0
    box = (cloud.east >= xmin) & (cloud.east <= xmax) & (cloud.north >= ymin) & (cloud.north <= ymax)
    if int(box.sum()) < MIN_ROOF_POINTS:
        return None
    e, n, u, c = cloud.east[box], cloud.north[box], cloud.up[box], cloud.classification[box]
    inside = _inside(poly, e, n)
    roof = u[inside & (c != CLASS_GROUND)]
    # The ground at the foot: ground returns inside the footprint (a yard, a light well) and
    # in the four-metre ring around it (the pavement).
    foot = u[(c == CLASS_GROUND)]
    if roof.size < MIN_ROOF_POINTS or foot.size < 8:
        return None
    base = float(np.median(foot))
    top = float(np.percentile(roof, ROOF_PERCENTILE))
    height = top - base
    if not 2.0 <= height <= 320.0:
        return None
    return {"height_m": round(height, 2), "base_m": round(base, 2), "roof_points": int(roof.size),
            "ground_points": int(foot.size), "source": "lidar_roof_p92_over_foot"}
