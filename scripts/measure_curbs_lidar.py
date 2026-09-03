#!/usr/bin/env python3
"""Measure kerbs along the corridor's footways from public aerial lidar.

Every curb height in this catalogue up to now has been a default: six inches, written down
because six inches is what a kerb usually is, and flagged ``requires_metric_depth_for_measurement``
so nobody would mistake it for an observation. This is the pass that replaces some of them with
numbers that came off a sensor.

The source is USGS 3DEP, which is in the public domain. It is flown from an aircraft, and that
sets the limit of what this can do: a kerb face is a near-vertical strip about 150 mm tall, seen
from almost directly above, and whether it registers at all depends on the scan geometry over
that particular metre of street. Where it registers the measurement is good. Where it does not,
this writes nothing -- the existing needs-depth row stands, waiting for ground-level capture.

Work is batched by grid cell rather than by footway. One lidar fetch serves every footway whose
midpoint falls in the cell, which matters because the fetch is the whole cost: measuring is
arithmetic on points already in memory.

Runs are resumable. Each footway's result is appended to a JSONL journal as it completes, and a
re-run skips what the journal already holds.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

import h3  # noqa: E402

from smc.lidar.curb import (  # noqa: E402
    ROAD_REACH_M,
    WALK_REACH_M,
    measure_footway,
    split_footway,
)
from smc.lidar.ept import EptReader  # noqa: E402

#: Coarser than the 5 cm the tree can serve. Measured side by side on fourteen footways the two
#: return the same kerbs at the same heights, and this costs a quarter of the download.
RESOLUTION_M = 0.10

#: Grid cell for batching fetches. Larger cells amortise the fetch over more footways but pull a
#: quadratically larger box; 150 m keeps a single fetch to roughly a hundred megabytes.
CELL_M = 150.0

EARTH_RADIUS_M = 6_378_137.0


def segment_length_m(points: list[list[float]]) -> float:
    (lon1, lat1), (lon2, lat2) = points[0], points[-1]
    east = math.radians(lon2 - lon1) * EARTH_RADIUS_M * math.cos(math.radians(lat1))
    north = math.radians(lat2 - lat1) * EARTH_RADIUS_M
    return math.hypot(east, north)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog", type=Path, default=Path("data/sf_corridor"))
    parser.add_argument("--journal", type=Path, default=None)
    parser.add_argument("--limit", type=int, default=0, help="stop after this many footways")
    parser.add_argument("--min-length-m", type=float, default=20.0)
    parser.add_argument("--resolution-m", type=float, default=RESOLUTION_M)
    parser.add_argument("--h3-resolution", type=int, default=10)
    args = parser.parse_args()

    journal = args.journal or args.catalog / "depth" / "lidar" / "curb_sections.jsonl"
    journal.parent.mkdir(parents=True, exist_ok=True)

    ways = json.loads((args.catalog / "stats" / "osm_ways.json").read_text())
    # Long ways are broken into straight runs before anything else sees them, so that both the
    # batching and the measurement work on geometry they can actually treat as a line.
    def runs_of(way: dict) -> list[dict]:
        return [
            {**way, "points": run, "run_index": index}
            for index, run in enumerate(split_footway(way["points"]))
        ]

    footways = [
        run
        for w in ways
        if w.get("kind") == "sidewalk" and len(w.get("points") or []) >= 2
        for run in runs_of(w)
        if segment_length_m(run["points"]) >= args.min_length_m
    ]
    streets = np.array(
        [p for w in ways if w.get("kind") == "street" for p in (w.get("points") or [])],
        dtype=np.float64,
    )
    if not len(streets):
        sys.exit("no street geometry in the catalog; cannot orient the across-axis")

    done: set[str] = set()
    if journal.exists():
        for line in journal.read_text().splitlines():
            if line.strip():
                done.add(json.loads(line)["footway_id"])
    print(f"{len(footways)} footways >= {args.min_length_m:g} m, {len(done)} already journalled")

    def footway_id(way: dict) -> str:
        first, last = way["points"][0], way["points"][-1]
        return f"{first[0]:.6f},{first[1]:.6f}:{last[0]:.6f},{last[1]:.6f}"

    def nearest_street(lon: float, lat: float) -> tuple[float, float]:
        # Longitude degrees are shorter than latitude degrees here, so compare in a frame where
        # the two axes mean the same thing; otherwise "nearest" leans east-west.
        squash = 1.0 / math.cos(math.radians(lat))
        d = (streets[:, 0] - lon) ** 2 + ((streets[:, 1] - lat) * squash) ** 2
        return tuple(streets[int(d.argmin())])

    cells: dict[tuple[int, int], list[dict]] = defaultdict(list)
    for way in footways:
        if footway_id(way) in done:
            continue
        lon, lat = way["points"][len(way["points"]) // 2]
        key = (int(lat * 111320 / CELL_M), int(lon * 88000 / CELL_M))
        cells[key].append(way)

    reader = EptReader()
    written = attempted = with_kerb = sections = 0
    with journal.open("a") as out:
        for index, (_, group) in enumerate(sorted(cells.items()), start=1):
            lons = [w["points"][len(w["points"]) // 2][0] for w in group]
            lats = [w["points"][len(w["points"]) // 2][1] for w in group]
            centre_lon, centre_lat = float(np.mean(lons)), float(np.mean(lats))
            spread = max(
                segment_length_m([[min(lons), min(lats)], [max(lons), max(lats)]]) / 2.0, 1.0
            )
            longest = max(segment_length_m(w["points"]) for w in group)
            radius = spread + longest / 2.0 + ROAD_REACH_M + WALK_REACH_M
            try:
                cloud = reader.around(centre_lat, centre_lon, radius, resolution_m=args.resolution_m)
            except Exception as exc:  # noqa: BLE001 - a bad tile must not end the run
                print(f"  cell {index}: lidar unavailable ({exc})", flush=True)
                continue

            for way in group:
                attempted += 1
                lon, lat = way["points"][len(way["points"]) // 2]
                measurements = measure_footway(
                    reader, way["points"], nearest_street(lon, lat), cloud=cloud
                )
                usable = [m for m in measurements if m.section.ok]
                if usable:
                    with_kerb += 1
                    sections += len(usable)
                for m in usable:
                    out.write(
                        json.dumps(
                            {
                                "footway_id": footway_id(way),
                                "station_m": m.station_m,
                                "lat": m.lat,
                                "lon": m.lon,
                                "h3_cell": h3.latlng_to_cell(m.lat, m.lon, args.h3_resolution),
                                "curb_height_m": m.section.kerb.height_m,
                                "curb_height_sigma_m": m.section.kerb.sigma_m,
                                "sidewalk_width_m": m.section.sidewalk.width_m,
                                "sidewalk_width_sigma_m": m.section.sidewalk.width_sigma_m,
                                "cross_slope": m.section.sidewalk.cross_slope,
                                "cross_slope_sigma": m.section.sidewalk.cross_slope_sigma,
                                "point_count": m.point_count,
                                "flags": list(m.section.flags),
                            }
                        )
                        + "\n"
                    )
                    written += 1
                if not usable:
                    # Journal the attempt so a resume does not retry a footway the lidar cannot
                    # see. An absent kerb here is a finding about the sensor, not a gap in work.
                    out.write(
                        json.dumps({"footway_id": footway_id(way), "station_m": None}) + "\n"
                    )
                out.flush()

                if args.limit and attempted >= args.limit:
                    break
            print(
                f"  cell {index}/{len(cells)}: {attempted} footways, {with_kerb} with a kerb, "
                f"{sections} slices, {reader.bytes_fetched / 1e6:.0f} MB",
                flush=True,
            )
            if args.limit and attempted >= args.limit:
                break

    print(
        f"\nattempted {attempted} footways\n"
        f"  with a measurable kerb: {with_kerb} ({100 * with_kerb / max(attempted, 1):.0f}%)\n"
        f"  measured slices written: {sections}\n"
        f"  lidar downloaded: {reader.bytes_fetched / 1e6:.0f} MB"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
