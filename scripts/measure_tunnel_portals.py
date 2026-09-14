#!/usr/bin/env python3
"""Measure each road tunnel's portals from the city's lidar: how high the ground stands over
the mouth, and the grade of the road going in.

The corridor has three road tunnels -- Broadway, Stockton and the 1st Street ramp -- and the
model is flat, so a tunnel cannot be drawn as the hill it goes through. What can be drawn
truthfully is the mouth: a headwall as tall as the ground really is above the road there, with
the bore going in under it. Nothing here is invented: the road level at the mouth and the
ground level over the bore both come from the USGS lidar's ground returns.

Output: data/sf_public_works/tunnel_portals.json, keyed by OSM way id, with each end's road
elevation, the ground elevation over the bore behind it, and their difference in metres.
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

#: Tunnels of these road classes are bores through a hill with a mouth to draw. A busway or a
#: service tunnel is a ramp under a building.
ROAD_TUNNEL_CLASSES = {"primary", "secondary", "tertiary", "residential", "unclassified", "trunk",
                       "primary_link", "secondary_link", "trunk_link"}
MIN_TUNNEL_M = 40.0
#: Where the road level is read: on the approach, just outside the mouth.
ROAD_FROM_M, ROAD_TO_M = 3.0, 14.0
#: Where the ground over the bore is read: behind the headwall, over the tunnel.
HILL_FROM_M, HILL_TO_M = 10.0, 24.0
LATERAL_M = 6.0
MIN_POINTS = 40


def length_m(points: list[list[float]]) -> float:
    return sum(math.hypot((b[0] - a[0]) * 88_000.0, (b[1] - a[1]) * 111_320.0)
               for a, b in zip(points[:-1], points[1:], strict=True))


def median_ground(cloud, ux: float, uy: float, along: tuple[float, float]) -> float | None:
    """Median ground elevation in a strip along the unit direction from the cloud's origin."""
    ground = cloud.ground()
    if len(ground) == 0:
        return None
    s = ground.east * ux + ground.north * uy
    t = -ground.east * uy + ground.north * ux
    keep = (s >= along[0]) & (s <= along[1]) & (np.abs(t) <= LATERAL_M)
    if int(keep.sum()) < MIN_POINTS:
        return None
    return float(np.median(ground.up[keep]))


def measure_portal(reader: EptReader, mouth: list[float], inward: list[float]) -> dict | None:
    lon, lat = mouth
    dx = (inward[0] - lon) * 88_000.0
    dy = (inward[1] - lat) * 111_320.0
    span = math.hypot(dx, dy)
    if span < 1e-6:
        return None
    ux, uy = dx / span, dy / span
    cloud = reader.around(lat, lon, HILL_TO_M + 4.0, resolution_m=0.5)
    road = median_ground(cloud, -ux, -uy, (ROAD_FROM_M, ROAD_TO_M))
    hill = median_ground(cloud, ux, uy, (HILL_FROM_M, HILL_TO_M))
    if road is None or hill is None:
        return None
    return {"road_z": round(road, 2), "hill_z": round(hill, 2),
            "headwall_m": round(hill - road, 2), "points": len(cloud)}


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
        record = {"name": way.get("name"), "length_m": round(length_m(points), 1)}
        for label, mouth, inward in (("start", points[0], points[1]),
                                     ("end", points[-1], points[-2])):
            try:
                record[label] = measure_portal(reader, mouth, inward)
            except Exception as exc:  # noqa: BLE001 - a bad tile must not end the run
                print(f"  {way.get('name')} {label}: lidar unavailable ({exc})", flush=True)
                record[label] = None
        out[key] = record
        print(f"{way.get('name')}: {json.dumps(record)}", flush=True)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps({
        "source": "USGS 3DEP CA_SanFrancisco_1_B23 ground returns, via Entwine",
        "method": "median ground elevation on the approach (3-14 m outside the mouth) and over "
                  "the bore (10-24 m inside), within 6 m of the centreline",
        "tunnels": out,
    }, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {args.out} ({len(out)} tunnels)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
