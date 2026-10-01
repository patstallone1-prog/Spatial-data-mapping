#!/usr/bin/env python3
"""Per-station kerb positions from the lidar journal, for every region measured.

The lidar stage (scripts/measure_region_lidar.py) finds, every 4 m along each street, the
distance from the centreline to the kerb riser on either side, and the riser's height. Until
now only per-street heights were kept downstream (kerb_heights.json). The positions were in
the journal all along: each station's centreline point, its left and right offsets. This writes
them out as points on the kerb -- the station moved by its offset along the street's left-hand
normal (left) or right-hand normal (right) -- so the kerb fitter can use lidar as *sensor*
samples wherever the lidar reached, not only where a city surveyed its curb lines.

Nothing is fetched: the journal is the measurement. Output, per region:

  data/regions/<name>/lidar/kerb_stations.jsonl
      one line per kerb point: way (osm id), side (l|r), lon, lat, offset_m, height_m (null when
      the riser height was not resolved), n (lidar returns in the station's window), and the
      centreline station it was measured from.
"""

from __future__ import annotations

import argparse
import itertools
import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REGIONS = ROOT / "data" / "regions"


def direction_at(points: list[list[float]], lon: float, lat: float, kx: float,
                 ky: float) -> tuple[float, float] | None:
    """Unit east/north direction of the way's segment nearest the station."""
    best, best_d = None, math.inf
    for a, b in itertools.pairwise(points):
        bx, by = (b[0] - a[0]) * kx, (b[1] - a[1]) * ky
        px, py = (lon - a[0]) * kx, (lat - a[1]) * ky
        seg2 = bx * bx + by * by
        if seg2 <= 0:
            continue
        t = max(0.0, min(1.0, (px * bx + py * by) / seg2))
        d = math.hypot(px - bx * t, py - by * t)
        if d < best_d:
            best_d, best = d, (bx / math.sqrt(seg2), by / math.sqrt(seg2))
    return best


def build(region: str) -> dict:
    base = REGIONS / region
    journal = base / "lidar" / "cells.jsonl"
    ways_path = base / "osm_ways.json"
    if not journal.exists() or not ways_path.exists():
        return {"region": region, "skipped": "no lidar journal or ways"}
    ways = {str(w["osm_id"]): w["points"] for w in json.loads(ways_path.read_text())
            if w.get("osm_id") is not None and w.get("points")}
    out_path = base / "lidar" / "kerb_stations.jsonl"
    written = no_way = 0
    seen: set[tuple] = set()
    with out_path.open("w") as out:
        for line in journal.read_text().splitlines():
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if row.get("error") or row.get("retry"):
                continue
            for osm_id, stations in (row.get("streets") or {}).items():
                points = ways.get(str(osm_id))
                if not points:
                    no_way += 1
                    continue
                for st in stations:
                    lon, lat = st["lon"], st["lat"]
                    kx = 111_320.0 * math.cos(math.radians(lat))
                    ky = 111_320.0
                    d = direction_at(points, lon, lat, kx, ky)
                    if d is None:
                        continue
                    left = (-d[1], d[0])
                    for side, offset, height, sign in (("l", st.get("l"), st.get("lh"), 1.0),
                                                       ("r", st.get("r"), st.get("rh"), -1.0)):
                        if offset is None:
                            continue
                        key = (osm_id, side, round(lon, 7), round(lat, 7))
                        if key in seen:  # a street measured from two cells: keep it once
                            continue
                        seen.add(key)
                        e, n = sign * left[0] * offset, sign * left[1] * offset
                        out.write(json.dumps({
                            "way": osm_id, "side": side,
                            "lon": round(lon + e / kx, 8), "lat": round(lat + n / ky, 8),
                            "offset_m": round(offset, 3),
                            "height_m": None if height is None else round(height, 3),
                            "n": st.get("n"), "station": [round(lon, 8), round(lat, 8)],
                        }, separators=(",", ":")) + "\n")
                        written += 1
    return {"region": region, "kerb_points": written, "streets_without_geometry": no_way,
            "output": str(out_path.relative_to(ROOT))}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("regions", nargs="*")
    args = ap.parse_args()
    regions = args.regions or sorted(
        p.parent.parent.name for p in REGIONS.glob("*/lidar/cells.jsonl"))
    for region in regions:
        print(json.dumps(build(region)), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
