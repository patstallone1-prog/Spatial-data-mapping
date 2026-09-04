#!/usr/bin/env python3
"""Measure kerbs from Waymo lidar, to check what the aerial pass measured from above.

This does not add rows to the corridor map and is not trying to. Waymo poses are local to each
twenty-second segment and no absolute georeference is published, so these kerbs cannot be placed
on a street. What they can do is answer the question the aerial pass cannot answer about itself:
a kerb face is a 150 mm vertical strip, and an aircraft sees it almost edge-on, so a systematic
underestimate would look exactly like a real distribution of worn kerbs. From 2.18 m up, in a
vehicle beside it, the same face is seen broadside.

The measurement itself is deliberately the same code the aerial pass uses -- `find_kerb_line`
then `measure_cross_section`. Running a different estimator here would confound the two things
being compared: whether the sensors agree, and whether the estimators do.

Where Waymo has published 3D semantic labels, TYPE_CURB gives a second, independent reading that
depends on no estimator at all. Those frames are a minority, and they are reported separately
rather than pooled, because a subset chosen by Waymo for labelling is not a random subset.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "build" / "waymo_proto"))

from smc.lidar.curb import (  # noqa: E402
    LIDAR_CONFIG,
    MAX_STEP_M,
    MIN_STEP_M,
    find_kerb_line,
)
from smc.lidar.waymo_mirror import HF_RESOLVE, iter_records, load_protos  # noqa: E402
from smc.lidar.waymo_points import TYPE_CURB, TYPE_ROAD, TYPE_SIDEWALK, frame_cloud  # noqa: E402
from smc.measure.extract import measure_cross_section  # noqa: E402

#: A slice reaches this far along the vehicle's direction of travel. Longer gathers more points
#: but starts to span a real change in the kerb; this is the same 5 m station the aerial pass
#: uses, so the two are measuring comparable lengths of street.
STATION_HALF_M = 2.5

#: Lateral band searched for a kerb, per side. Starts outside the vehicle body and stops before
#: the building line, where stoops and steps offer a second discontinuity to lock onto.
LATERAL_NEAR_M = 1.5
LATERAL_FAR_M = 11.0

#: Returns above this are not ground and only make the plane fits worse.
MAX_HEIGHT_M = 1.2


def slices_from_frame(dataset_pb2, frame) -> list[dict]:
    """Every kerb this frame can see, both sides, along the vehicle's travel."""
    cloud = frame_cloud(dataset_pb2, frame)
    if not len(cloud):
        return []
    xyz = cloud.xyz
    low = xyz[:, 2] < MAX_HEIGHT_M
    xyz, semantic = xyz[low], (cloud.semantic[low] if cloud.semantic is not None else None)

    out: list[dict] = []
    for side, sign in (("left", 1.0), ("right", -1.0)):
        # The across-axis points away from the vehicle, so the footway is on its positive side --
        # the sign convention `split_kerb_planes` uses to decide which surface is which.
        lateral = xyz[:, 1] * sign
        band = (lateral > LATERAL_NEAR_M) & (lateral < LATERAL_FAR_M)
        for station in (-5.0, 0.0, 5.0):
            window = band & (np.abs(xyz[:, 0] - station) < STATION_HALF_M)
            if int(window.sum()) < LIDAR_CONFIG.min_surface_points:
                continue
            u = xyz[window, 0] - station
            v = lateral[window]
            w = xyz[window, 2]

            offset = find_kerb_line(v, w)
            if offset is None:
                continue
            section = measure_cross_section(
                np.column_stack((u, v, w)), station, config=LIDAR_CONFIG, kerb_offset_hint=offset
            )
            if section.kerb is None:
                continue
            if not (MIN_STEP_M <= section.kerb.height_m <= MAX_STEP_M):
                # The same post-fit bound the aerial pass applies. Without it a candidate riser
                # that the plane fit then disagrees with still yields a row -- and because the
                # fitted step is clamped at zero, those rows pile up at exactly 0 mm and drag the
                # distribution down. A quarter of this sample was that, before the bound.
                continue
            row = {
                "side": side,
                "station_m": station,
                "curb_height_m": float(section.kerb.height_m),
                "curb_height_sigma_m": float(section.kerb.sigma_m),
                "point_count": int(window.sum()),
                "flags": list(section.flags),
                "labelled": False,
            }
            if semantic is not None:
                here = semantic[window]
                curb_points = w[here == TYPE_CURB]
                road_points = w[here == TYPE_ROAD]
                walk_points = w[here == TYPE_SIDEWALK]
                if len(curb_points) >= 10 and len(road_points) >= 10 and len(walk_points) >= 10:
                    # A reading that owes nothing to the estimator: the labelled footway surface
                    # against the labelled roadway surface.
                    row["labelled"] = True
                    row["labelled_height_m"] = float(
                        np.median(walk_points) - np.median(road_points)
                    )
            out.append(row)
    return out


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--segments", type=Path, default=Path("data/waymo_sf/sf_segments.json"))
    parser.add_argument("--out", type=Path, default=Path("data/waymo_sf/curb_sections.jsonl"))
    parser.add_argument("--limit-segments", type=int, default=25)
    parser.add_argument("--frames-per-segment", type=int, default=6)
    parser.add_argument("--max-bytes", type=int, default=48 * 1024 * 1024)
    args = parser.parse_args()

    dataset_pb2 = load_protos()
    segments = json.loads(args.segments.read_text())[: args.limit_segments]
    args.out.parent.mkdir(parents=True, exist_ok=True)

    done: set[str] = set()
    if args.out.exists():
        for line in args.out.read_text().splitlines():
            if line.strip():
                done.add(json.loads(line)["segment"])

    written = 0
    with args.out.open("a") as handle:
        for index, segment in enumerate(segments, start=1):
            name = segment["name"]
            if name in done:
                continue
            try:
                frames = list(
                    iter_records(
                        f"{HF_RESOLVE}/{segment['path']}",
                        limit=args.frames_per_segment,
                        max_bytes=args.max_bytes,
                    )
                )
            except Exception as exc:  # noqa: BLE001 - one bad segment must not end the run
                print(f"  {index}/{len(segments)} {name[:28]}: unavailable ({exc})", flush=True)
                continue
            rows = [row for frame in frames for row in slices_from_frame(dataset_pb2, frame)]
            for row in rows:
                handle.write(json.dumps({"segment": name, **row}) + "\n")
            handle.flush()
            written += len(rows)
            print(
                f"  {index}/{len(segments)} {name[:28]}: {len(frames)} frames, {len(rows)} kerb slices",
                flush=True,
            )
    print(f"{written} slices -> {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
