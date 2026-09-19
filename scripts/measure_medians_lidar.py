#!/usr/bin/env python3
"""Find the median between the two halves of a divided street in the city's lidar.

The city's kerb file has island lines on some divided streets and not others. Where it has
none, each half of the street was drawn as wide as its lane count said, or as wide as the
right of way left over -- which is how the ``divided_half`` bucket came to be the worst in the
width audit (p90 13 m against the kerbs). The lidar sees the median: a raised one is a
plateau between the two carriageways, a few centimetres to a kerb's height above them, and
a painted one is nothing at all, in which case the halves meet at the middle.

For every pair of one-way ways that are the two halves of one street, this reads a ground
profile across the whole road every ``STATION_M`` along it and looks between the two
carriageways for a plateau at least ``MEDIAN_RISE_M`` above the road on both sides and at
least ``MEDIAN_MIN_W_M`` wide. The plateau's two edges become island kerb lines the page's
kerb envelope reads like the city's own (role ``island``, source ``lidar``); where there is no
plateau, the midpoint between the halves becomes a ``median`` line, which the envelope reads
as the inner edge of each half and nothing else reads at all -- a painted centre is not a
kerb and must not part a crossing.

Output: data/sf_public_works/medians_lidar.json, and the lidar lines appended to
docs/sf-corridor-official.json (replacing any earlier lidar lines there).
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from smc.lidar.ept import EptReader  # noqa: E402

STATION_M = 5.0
BIN_M = 0.25
#: The plateau stands this far above the road level on both sides of it.
MEDIAN_RISE_M = 0.06
MEDIAN_MIN_W_M = 0.6
MEDIAN_MAX_W_M = 12.0
#: The road level either side is read over the lanes nearest the median: this far from each
#: half's centreline toward the other half, which is where the inner lane is.
LANE_FROM_M, LANE_TO_M = 0.5, 2.5
#: Two halves of one street: same name, opposite directions, this far apart.
PAIR_MIN_SEP_M, PAIR_MAX_SEP_M = 4.0, 40.0
MIN_OVERLAP_M = 30.0
MIN_POINTS = 40
RESOLUTION_M = 0.10

KX, KY = 88_000.0, 111_320.0


def to_m(p, o):
    return ((p[0] - o[0]) * KX, (p[1] - o[1]) * KY)


def from_m(x, y, o):
    return [round(o[0] + x / KX, 7), round(o[1] + y / KY, 7)]


def project(points, x, y):
    """(distance, station, side, lateral signed, tangent) of (x, y) onto a metre polyline."""
    best = None
    acc = 0.0
    for a, b in zip(points[:-1], points[1:]):
        sx, sy = b[0] - a[0], b[1] - a[1]
        l2 = sx * sx + sy * sy
        if l2 <= 0:
            continue
        t = max(0.0, min(1.0, ((x - a[0]) * sx + (y - a[1]) * sy) / l2))
        cx, cy = a[0] + sx * t, a[1] + sy * t
        d = math.hypot(x - cx, y - cy)
        if best is None or d < best[0]:
            ln = math.sqrt(l2)
            cross = (sx * (y - a[1]) - sy * (x - a[0])) / ln
            best = (d, acc + ln * t, 1 if cross >= 0 else -1, cross, (sx / ln, sy / ln))
        acc += math.sqrt(l2)
    return best


def pairs_of_halves(ways):
    # A divided half as the page knows one: one-way, with a footway on one side only (the
    # other side is the median). The same test as the page's isDividedHalf.
    streets = [w for w in ways if w.get("kind") == "street" and w.get("name")
               and (w.get("oneway") or w.get("osm_oneway")) and len(w.get("points") or []) >= 2
               and isinstance(w.get("walk_sides"), list) and len(w["walk_sides"]) == 1
               # The two approaches to a tunnel have the hill between them, not a median.
               and not w.get("tunnel_approach") and not w.get("tunnel_kind")]
    by_name = {}
    for w in streets:
        by_name.setdefault(w["name"], []).append(w)
    out = []
    for name, group in by_name.items():
        for i, a in enumerate(group):
            o = a["points"][0]
            pa = [to_m(p, o) for p in a["points"]]
            ua = (pa[-1][0] - pa[0][0], pa[-1][1] - pa[0][1])
            la = math.hypot(*ua) or 1.0
            for b in group[i + 1:]:
                pb = [to_m(p, o) for p in b["points"]]
                ub = (pb[-1][0] - pb[0][0], pb[-1][1] - pb[0][1])
                lb = math.hypot(*ub) or 1.0
                if (ua[0] * ub[0] + ua[1] * ub[1]) / (la * lb) > -0.85:
                    continue          # not opposite directions
                # Lateral separation at b's midpoint, and how much of b runs beside a.
                mid = pb[len(pb) // 2]
                found = project(pa, mid[0], mid[1])
                if found is None or not (PAIR_MIN_SEP_M <= found[0] <= PAIR_MAX_SEP_M):
                    continue
                overlap = 0.0
                for q in pb:
                    f = project(pa, q[0], q[1])
                    if f and f[0] <= PAIR_MAX_SEP_M:
                        overlap += 1
                if overlap < 2:
                    continue
                out.append((a, b))
    return out


def profile_across(reader, lon, lat, ux, uy, half_span, cache):
    """Ground medians in BIN_M bins along the normal (positive left of (ux, uy))."""
    key = (round(lat, 4), round(lon, 4))
    cloud = cache.get(key)
    if cloud is None:
        cloud = reader.around(lat, lon, half_span + 4.0, resolution_m=RESOLUTION_M).ground()
        cache[key] = cloud
    if len(cloud.east) < MIN_POINTS:
        return None
    o = (cloud.origin_lon, cloud.origin_lat)
    px, py = to_m((lon, lat), o)
    ex, ny = cloud.east - px, cloud.north - py
    nx_, ny_ = -uy, ux
    lateral = ex * nx_ + ny * ny_
    along = ex * ux + ny * uy
    keep = (np.abs(along) <= 2.5) & (np.abs(lateral) <= half_span)
    lateral, up = lateral[keep], cloud.up[keep]
    if lateral.size < MIN_POINTS:
        return None
    edges = np.arange(-half_span, half_span + BIN_M, BIN_M)
    idx = np.clip(np.digitize(lateral, edges) - 1, 0, edges.size - 2)
    med = np.full(edges.size - 1, np.nan)
    for b in range(edges.size - 1):
        h = up[idx == b]
        if h.size >= 5:
            med[b] = float(np.median(h))
    return edges, med


def find_median(edges, med, la, lb):
    """The plateau between lateral offsets la (this half) and lb (the other half), if any.
    Returns (left_edge, right_edge, rise) in lateral metres or None."""
    lo, hi = sorted((la, lb))
    centres = (edges[:-1] + edges[1:]) / 2
    def level(a, b):
        m = med[(centres >= min(a, b)) & (centres <= max(a, b))]
        m = m[np.isfinite(m)]
        return float(np.median(m)) if m.size >= 2 else None
    # The road on each side: the inner lane of each half.
    road_a = level(la + (LANE_FROM_M if lb > la else -LANE_TO_M), la + (LANE_TO_M if lb > la else -LANE_FROM_M))
    road_b = level(lb + (LANE_FROM_M if la > lb else -LANE_TO_M), lb + (LANE_TO_M if la > lb else -LANE_FROM_M))
    if road_a is None or road_b is None:
        return None
    road = (road_a + road_b) / 2
    between = (centres > lo + LANE_FROM_M) & (centres < hi - LANE_FROM_M)
    raised = between & np.isfinite(med) & (med - road >= MEDIAN_RISE_M)
    # The longest contiguous raised run.
    best = None
    start = None
    for i in range(len(raised) + 1):
        on = i < len(raised) and raised[i]
        if on and start is None:
            start = i
        if not on and start is not None:
            width = (i - start) * BIN_M
            if width >= MEDIAN_MIN_W_M and (best is None or width > best[2]):
                best = (edges[start], edges[i], width, float(np.nanmedian(med[start:i]) - road))
            start = None
    if best is None or best[2] > MEDIAN_MAX_W_M:
        return None
    return best[0], best[1], best[3]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--osm", type=Path, default=ROOT / "docs/sf-corridor-3d.json",
                    help="the page payload: its ways carry walk_sides, which says which are halves")
    ap.add_argument("--out", type=Path, default=ROOT / "data/sf_public_works/medians_lidar.json")
    ap.add_argument("--official", type=Path, default=ROOT / "docs/sf-corridor-official.json")
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()
    loaded = json.loads(args.osm.read_text(encoding="utf-8"))
    ways = loaded["ways"] if isinstance(loaded, dict) else loaded
    pairs = pairs_of_halves(ways)
    print(f"{len(pairs)} pairs of divided halves", flush=True)
    reader = EptReader()
    cache: dict = {}
    lines = []
    report = {"pairs": len(pairs), "stations": 0, "raised": 0, "painted": 0, "unread": 0, "streets": {}}
    for n, (a, b) in enumerate(pairs, start=1):
        if args.limit and n > args.limit:
            break
        o = a["points"][0]
        pa = [to_m(p, o) for p in a["points"]]
        pb = [to_m(p, o) for p in b["points"]]
        total = sum(math.hypot(q[0] - p[0], q[1] - p[1]) for p, q in zip(pa[:-1], pa[1:]))
        raised_left, raised_right, centre = [], [], []
        runs = {"raised": [], "centre": []}
        s = STATION_M / 2
        while s < total:
            # The station on a, its tangent, and where b is across from it.
            acc = 0.0
            here = None
            for p, q in zip(pa[:-1], pa[1:]):
                seg = math.hypot(q[0] - p[0], q[1] - p[1])
                if acc + seg >= s and seg > 0:
                    t = (s - acc) / seg
                    here = (p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, ((q[0] - p[0]) / seg, (q[1] - p[1]) / seg))
                    break
                acc += seg
            if here is None:
                break
            x, y, (ux, uy) = here
            fb = project(pb, x, y)
            s += STATION_M
            if fb is None or fb[0] > PAIR_MAX_SEP_M:
                continue
            lb = fb[3]          # b's lateral offset from a's line, positive left of a
            # Where along the normal b sits: b's line is at lateral lb.
            half_span = abs(lb) / 2 + 10.0
            lon, lat = from_m(x, y, o)
            prof = profile_across(reader, lon, lat, ux, uy, half_span, cache)
            report["stations"] += 1
            if prof is None:
                report["unread"] += 1
                continue
            edges, med = prof
            found = find_median(edges, med, 0.0, lb)
            nx_, ny_ = -uy, ux
            if found:
                e0, e1, rise = found
                runs["raised"].append((from_m(x + nx_ * e0, y + ny_ * e0, o), from_m(x + nx_ * e1, y + ny_ * e1, o), rise))
                report["raised"] += 1
            else:
                m = lb / 2
                runs["centre"].append(from_m(x + nx_ * m, y + ny_ * m, o))
                report["painted"] += 1
        # Assemble lines: the two raised edges as island lines, the centre as a median line.
        if len(runs["raised"]) >= 2:
            lines.append({"c": "curb", "r": "island", "s": "lidar", "p": [r[0] for r in runs["raised"]],
                          "rise_m": round(float(np.median([r[2] for r in runs["raised"]])), 3)})
            lines.append({"c": "curb", "r": "island", "s": "lidar", "p": [r[1] for r in runs["raised"]],
                          "rise_m": round(float(np.median([r[2] for r in runs["raised"]])), 3)})
        if len(runs["centre"]) >= 2:
            lines.append({"c": "curb", "r": "median", "s": "lidar", "p": runs["centre"]})
        street = report["streets"].setdefault(a["name"], {"raised": 0, "painted": 0})
        street["raised"] += len(runs["raised"])
        street["painted"] += len(runs["centre"])
        print(f"  {n}/{len(pairs)} {a['name']}: {len(runs['raised'])} raised, {len(runs['centre'])} centre stations", flush=True)
    args.out.write_text(json.dumps({"report": report, "lines": lines}, indent=1) + "\n", encoding="utf-8")
    # Into the page's official geometry, replacing any earlier lidar lines.
    if args.official.exists():
        official = json.loads(args.official.read_text(encoding="utf-8"))
        kept = [c for c in official.get("curb_lines", []) if c.get("s") != "lidar"]
        official["curb_lines"] = kept + [{k: v for k, v in line.items() if k != "rise_m"} for line in lines]
        official.setdefault("summary", {})["lidar_medians"] = {k: v for k, v in report.items() if k != "streets"}
        args.official.write_text(json.dumps(official, separators=(",", ":")), encoding="utf-8")
    print(json.dumps({k: v for k, v in report.items() if k != "streets"}, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
