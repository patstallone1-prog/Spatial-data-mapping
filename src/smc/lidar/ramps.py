"""Kerb ramps and stairs read off the lidar's ground returns: candidates, never facts on their own.

* :func:`kerb_step_at` -- at the end of a crossing, the ground profile along the crossing's own
  line, from the road out onto the pavement: the sharpest rise in it over ``RISER_RUN_M``. A
  kerb is a riser of 10-20 cm in a few centimetres; a ramp (a dropped kerb) takes the pavement
  down to the road with no riser left, so the sharpest rise there is a couple of centimetres.
  Three answers: ``ramp`` (no riser over ``RAMP_MAX_RISE_M``), ``kerb`` (a riser of at least
  ``KERB_MIN_RISE_M``), or ``unknown`` (in between, or too few returns -- a parked car or a
  queue of people over the spot).
* :func:`stair_profile` -- along a footway, how steep it is: stairs climb 30-40 degrees, a
  pavement on San Francisco's steepest street 17. A stretch steeper than ``STAIR_MIN_GRADE``
  over ``STAIR_MIN_RUN_M`` or more is a flight-of-stairs candidate; the collection's 0.15 m
  spacing is too coarse to count the treads themselves.

Both work in the lidar's local metres (:class:`smc.lidar.ept.LocalCloud`) on ground returns.
"""

from __future__ import annotations

import itertools
import math

import numpy as np

from smc.lidar.ept import CLASS_GROUND, LocalCloud
from smc.lidar.region import enu

#: The strip either side of a crossing's line the profile is taken over.
HALF_WIDTH_M = 0.6
#: How far the profile runs each way from the crossing's end (the mapped end is often a metre
#: or two off the kerb, either way).
REACH_M = 2.5
BIN_M = 0.1
#: A riser is the rise over this run: a kerb face is a few centimetres deep, and the profile is
#: binned at a decimetre.
RISER_RUN_M = 0.3
RAMP_MAX_RISE_M = 0.045
KERB_MIN_RISE_M = 0.10
MIN_BIN_POINTS = 3
MIN_BINS = 30

#: Stairs: a footway steeper than this (rise over run) over at least this run.
STAIR_MIN_GRADE = 0.45
STAIR_MIN_RUN_M = 2.0
STAIR_STEP_M = 0.5


def _local(cloud: LocalCloud, lon: float, lat: float) -> tuple[float, float]:
    return enu(lat, lon, cloud.origin_lat, cloud.origin_lon)


def kerb_step_at(cloud: LocalCloud, end: tuple[float, float], toward: tuple[float, float]) -> dict:
    """At a crossing's ``end`` ([lon, lat]), looking back along it to ``toward`` (its other end,
    out in the road): ramp, kerb or unknown, with the riser measured."""
    ex, ey = _local(cloud, *end)
    tx, ty = _local(cloud, *toward)
    dx, dy = ex - tx, ey - ty
    length = math.hypot(dx, dy)
    if length < 1.0:
        return {"class": "unknown", "why": "crossing too short"}
    ux, uy = dx / length, dy / length          # from the road towards the pavement
    ground = cloud.classification == CLASS_GROUND
    e, n, u = cloud.east[ground] - ex, cloud.north[ground] - ey, cloud.up[ground]
    along = e * ux + n * uy
    across = -e * uy + n * ux
    sel = (np.abs(across) <= HALF_WIDTH_M) & (np.abs(along) <= REACH_M)
    if int(sel.sum()) < MIN_BINS * MIN_BIN_POINTS:
        return {"class": "unknown", "why": "too few ground returns", "points": int(sel.sum())}
    a, z = along[sel], u[sel]
    edges = np.arange(-REACH_M, REACH_M + BIN_M / 2, BIN_M)
    idx = np.digitize(a, edges) - 1
    prof = np.full(len(edges) - 1, np.nan)
    for i in range(len(prof)):
        zi = z[idx == i]
        if zi.size >= MIN_BIN_POINTS:
            prof[i] = float(np.median(zi))
    good = np.isfinite(prof)
    if int(good.sum()) < MIN_BINS:
        return {"class": "unknown", "why": "gaps in the profile", "bins": int(good.sum())}
    k = max(1, round(RISER_RUN_M / BIN_M))
    rises = [prof[i + k] - prof[i] for i in range(len(prof) - k) if good[i] and good[i + k]]
    if not rises:
        return {"class": "unknown", "why": "gaps in the profile"}
    rise = float(max(rises))
    # The road's level and the pavement's, a metre and more either side.
    centres = (edges[:-1] + edges[1:]) / 2
    road = prof[good & (centres <= -1.0)]
    walk = prof[good & (centres >= 1.0)]
    level = float(np.median(walk) - np.median(road)) if road.size and walk.size else None
    out = {"rise_m": round(rise, 3), "level_change_m": None if level is None else round(level, 3),
           "points": int(sel.sum()), "bins": int(good.sum())}
    if rise <= RAMP_MAX_RISE_M:
        return {"class": "ramp", **out}
    if rise >= KERB_MIN_RISE_M:
        return {"class": "kerb", **out}
    return {"class": "unknown", "why": "riser between a ramp's and a kerb's", **out}


def stair_profile(cloud: LocalCloud, line: list[list[float]]) -> dict:
    """Along a footway ([lon, lat] points): its steepest sustained grade, and whether that is a
    flight of stairs."""
    pts = np.array([_local(cloud, lon, lat) for lon, lat in line])
    ground = cloud.classification == CLASS_GROUND
    ge, gn, gu = cloud.east[ground], cloud.north[ground], cloud.up[ground]
    samples: list[tuple[float, float]] = []   # (distance along, height)
    walked = 0.0
    for (ax, ay), (bx, by) in itertools.pairwise(pts):
        seg = math.hypot(bx - ax, by - ay)
        if seg < 1e-6:
            continue
        ux, uy = (bx - ax) / seg, (by - ay) / seg
        box = (ge >= min(ax, bx) - 1) & (ge <= max(ax, bx) + 1) & (gn >= min(ay, by) - 1) & (gn <= max(ay, by) + 1)
        e, n, u = ge[box] - ax, gn[box] - ay, gu[box]
        along = e * ux + n * uy
        across = np.abs(-e * uy + n * ux)
        for s in np.arange(0, seg, STAIR_STEP_M):
            near = (across <= 0.7) & (np.abs(along - s) <= STAIR_STEP_M / 2)
            if near.sum() >= 3:
                samples.append((walked + s, float(np.median(u[near]))))
        walked += seg
    if len(samples) < 6:
        return {"stairs": None, "why": "too few ground returns", "length_m": round(walked, 1)}
    d = np.array([s[0] for s in samples])
    z = np.array([s[1] for s in samples])
    window = max(2, round(STAIR_MIN_RUN_M / STAIR_STEP_M))
    grades = []
    for i in range(len(d) - window):
        run = d[i + window] - d[i]
        if run > 0 and run <= STAIR_MIN_RUN_M * 1.6:
            grades.append(abs(z[i + window] - z[i]) / run)
    steepest = max(grades) if grades else 0.0
    steep_run = sum(1 for g in grades if g >= STAIR_MIN_GRADE) * STAIR_STEP_M
    return {"stairs": bool(steepest >= STAIR_MIN_GRADE), "steepest_grade": round(steepest, 3),
            "steep_run_m": round(steep_run, 1), "climb_m": round(float(z.max() - z.min()), 2),
            "length_m": round(walked, 1), "samples": len(samples)}
