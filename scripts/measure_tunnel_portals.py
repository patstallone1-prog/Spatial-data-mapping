#!/usr/bin/env python3
"""Measure each road tunnel from the city's lidar: what it is, where its mouths are, how much
hill stands over it.

Seventy-five ways in the corridor are tagged ``tunnel=yes``. Deciding which are bores through a
hill used to be a matter of road class and length, and the mouths were wherever OpenStreetMap
ended the way. That put stone headwalls on 1st Street where it passes under the Transbay
transit centre, and read Broadway's east headwall as two metres tall because the window it
was read in fell on the open approach.

Everything here is read off the USGS lidar's ground returns along the way's own centreline:

* a ground profile every ``STATION_M`` from ``MARGIN_M`` before the first node to ``MARGIN_M``
  after the last;
* the road level on each approach, fitted to the ground outside the way and carried into it;
* each mouth: walking in from outside, the first station where the ground stands more than
  ``MOUTH_RISE_M`` above the road -- the face of the portal, wherever OpenStreetMap put its node;
* the cover along the bore between the mouths, and from it the kind of thing this is: a
  ``bore`` through a hill, an ``underpass`` beneath a building (the lidar has no ground there
  at all), or ``open`` ground with nothing over it.

Output: data/sf_public_works/tunnel_portals.json, keyed by OSM way id where the cache kept
one and by name and first node otherwise, with the kind, both mouths, the cover profile and
each end's headwall height. Nothing is invented: every number is a lidar reading or the
difference between two.
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

#: Tunnels of these road classes carry traffic; a busway or a service tunnel is looked at too,
#: but only a road class can be a bore that gets a mouth.
ROAD_TUNNEL_CLASSES = {"primary", "secondary", "tertiary", "residential", "unclassified", "trunk",
                       "primary_link", "secondary_link", "trunk_link"}
MIN_TUNNEL_M = 40.0
STATION_M = 4.0
MARGIN_M = 48.0
LATERAL_M = 6.0
MIN_POINTS = 30
#: Ground this far above the road it was on a moment ago is a structure over the road.
MOUTH_RISE_M = 0.8
#: Cover this deep is hill, not a roof: a bore is a way with this over most of its length.
BORE_COVER_M = 5.0
BORE_SHARE = 0.6
#: Half the stations with no ground at all is a way under a building.
UNDERPASS_SHARE = 0.5
#: The headwall is read behind the mouth, over the bore.
HILL_FROM_M, HILL_TO_M = 10.0, 24.0


def length_m(points: list[list[float]]) -> float:
    return sum(math.hypot((b[0] - a[0]) * 88_000.0, (b[1] - a[1]) * 111_320.0)
               for a, b in zip(points[:-1], points[1:], strict=True))


def point_at(points: list[list[float]], s: float) -> list[float]:
    """The lon/lat this far along the way, extrapolated straight past either end."""
    def lerp(a: list[float], b: list[float], t: float) -> list[float]:
        return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
    if s < 0:
        a, b = points[0], points[1]
        seg = length_m([a, b])
        return lerp(a, b, s / seg)
    acc = 0.0
    for a, b in zip(points[:-1], points[1:], strict=True):
        seg = length_m([a, b])
        if acc + seg >= s:
            return lerp(a, b, (s - acc) / seg if seg else 0.0)
        acc += seg
    a, b = points[-2], points[-1]
    seg = length_m([a, b])
    return lerp(a, b, 1.0 + (s - acc) / seg)


def ground_at(reader: EptReader, lon: float, lat: float) -> float | None:
    cloud = reader.around(lat, lon, LATERAL_M + 1.0, resolution_m=0.5)
    ground = cloud.ground()
    if len(ground) == 0:
        return None
    keep = np.hypot(ground.east, ground.north) <= LATERAL_M
    if int(keep.sum()) < MIN_POINTS:
        return None
    return float(np.median(ground.up[keep]))


def fit_line(samples: list[tuple[float, float]]) -> tuple[float, float] | None:
    """Least squares z = a + b s over (s, z) samples; None below two of them."""
    if len(samples) < 2:
        return None
    s = np.array([p[0] for p in samples])
    z = np.array([p[1] for p in samples])
    b, a = np.polyfit(s, z, 1)
    return float(a), float(b)


def measure_tunnel(reader: EptReader, way: dict) -> dict:
    points = way["points"]
    total = length_m(points)
    profile: list[tuple[float, float | None]] = []
    s = -MARGIN_M
    while s <= total + MARGIN_M:
        lon, lat = point_at(points, s)
        try:
            z = ground_at(reader, lon, lat)
        except Exception:  # noqa: BLE001 - a missing tile is a missing reading
            z = None
        profile.append((round(s, 1), None if z is None else round(z, 2)))
        s += STATION_M

    known = [(s, z) for s, z in profile if z is not None]
    inside = [(s, z) for s, z in profile if 0 <= s <= total]
    missing_share = sum(1 for _, z in inside if z is None) / max(1, len(inside))

    # The road on each approach, fitted outside the way and carried in.
    start_fit = fit_line([(s, z) for s, z in known if -MARGIN_M <= s <= -STATION_M])
    end_fit = fit_line([(s, z) for s, z in known if total + STATION_M <= s <= total + MARGIN_M])

    def mouth_from(fit: tuple[float, float] | None, outward: bool) -> float | None:
        # Walk in from the approach; the mouth is the first station where the ground stands
        # MOUTH_RISE_M above the road the approach was on.
        if fit is None:
            return None
        a, b = fit
        stations = [p for p in known if (p[0] >= -MARGIN_M if outward else p[0] <= total + MARGIN_M)]
        stations.sort(key=lambda p: p[0], reverse=not outward)
        for s_, z in stations:
            if outward and s_ > total / 2 or (not outward and s_ < total / 2):
                break
            if z - (a + b * s_) >= MOUTH_RISE_M:
                return round(s_ - STATION_M / 2 if outward else s_ + STATION_M / 2, 1)
        return None

    start_s = mouth_from(start_fit, True)
    end_s = mouth_from(end_fit, False)
    # A mouth the profile could not place stands where OpenStreetMap ended the way.
    if start_s is None:
        start_s = 0.0
    if end_s is None:
        end_s = round(total, 1)

    road_start = start_fit[0] + start_fit[1] * start_s if start_fit else None
    road_end = end_fit[0] + end_fit[1] * end_s if end_fit else None

    def road_at(s_: float) -> float | None:
        if road_start is None or road_end is None or end_s <= start_s:
            return road_start if road_start is not None else road_end
        t = (s_ - start_s) / (end_s - start_s)
        return road_start + (road_end - road_start) * t

    cover: list[list[float | None]] = []
    for s_, z in profile:
        if s_ < start_s or s_ > end_s:
            continue
        road = road_at(s_)
        cover.append([s_, None if z is None or road is None else round(z - road, 2)])
    covered = [c for _, c in cover if c is not None]
    bore_share = sum(1 for c in covered if c >= BORE_COVER_M) / max(1, len(covered))

    if missing_share >= UNDERPASS_SHARE:
        kind = "underpass"
    elif covered and bore_share >= BORE_SHARE:
        kind = "bore"
    else:
        kind = "open"

    def headwall(mouth_s: float, inward: int) -> float | None:
        window = [c for s_, c in cover
                  if c is not None and HILL_FROM_M <= (s_ - mouth_s) * inward <= HILL_TO_M]
        return round(float(np.median(window)), 2) if window else None

    return {
        "name": way.get("name"),
        "osm_length_m": round(total, 1),
        "kind": kind,
        "bore_share": round(bore_share, 2),
        "missing_share": round(missing_share, 2),
        "start": {"s": start_s, "p": [round(v, 6) for v in point_at(points, start_s)],
                  "road_z": None if road_start is None else round(road_start, 2),
                  "headwall_m": headwall(start_s, +1)},
        "end": {"s": end_s, "p": [round(v, 6) for v in point_at(points, end_s)],
                "road_z": None if road_end is None else round(road_end, 2),
                "headwall_m": headwall(end_s, -1)},
        "covered_length_m": round(end_s - start_s, 1),
        "cover": cover,
        "ground": [[s_, z] for s_, z in profile],
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--osm", type=Path, default=ROOT / "data/sf_corridor/stats/osm_ways.json")
    ap.add_argument("--out", type=Path, default=ROOT / "data/sf_public_works/tunnel_portals.json")
    args = ap.parse_args()
    ways = json.loads(args.osm.read_text(encoding="utf-8"))
    reader = EptReader()
    out: dict[str, dict] = {}
    for way in ways:
        if way.get("kind") != "street" or not way.get("tunnel"):
            continue
        if way.get("highway") not in ROAD_TUNNEL_CLASSES:
            continue
        points = way.get("points") or []
        if len(points) < 2 or length_m(points) < MIN_TUNNEL_M:
            continue
        key = str(way.get("osm_id") or f"{way.get('name')}:{points[0]}")
        record = measure_tunnel(reader, way)
        out[key] = record
        print(f"{way.get('name')}: {record['kind']} {record['covered_length_m']} m covered of "
              f"{record['osm_length_m']}; headwalls {record['start']['headwall_m']} / "
              f"{record['end']['headwall_m']}", flush=True)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps({
        "source": "USGS 3DEP CA_SanFrancisco_1_B23 ground returns, via Entwine",
        "method": f"ground profile every {STATION_M} m along the way within {LATERAL_M} m of the "
                  f"centreline; road level fitted on each approach; a mouth is the first station "
                  f"with ground {MOUTH_RISE_M} m over the road; cover is ground less the road "
                  f"carried between the mouths; a bore has {BORE_COVER_M} m of cover over "
                  f"{BORE_SHARE:.0%} of its length, an underpass no ground at all over "
                  f"{UNDERPASS_SHARE:.0%}",
        "tunnels": out,
    }, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {args.out} ({len(out)} tunnels)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
