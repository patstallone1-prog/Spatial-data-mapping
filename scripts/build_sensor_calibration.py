#!/usr/bin/env python3
"""Persist the measured camera geometry PandaSet publishes and the catalogue was dropping.

The observation schema has one focal length and a compass bearing. PandaSet gives four
intrinsic parameters and a six-degree-of-freedom pose per frame, in the same world frame as its
lidar. Those go in a sidecar of their own, because they are what makes these fifteen thousand
frames able to calibrate the other three hundred and seventy thousand.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

import pyarrow as pa  # noqa: E402
import pyarrow.parquet as pq  # noqa: E402

from smc.imagery.calibration import SCHEMA  # noqa: E402
from smc.imagery.pandaset import PandaSetProvider  # noqa: E402
from smc.imagery.region import get_region  # noqa: E402

OUT = ROOT / "data" / "observation_enrichment"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--region", default="sf-corridor")
    ap.add_argument("--sequences", type=int, default=None)
    args = ap.parse_args()

    provider = PandaSetProvider()
    region = get_region(args.region)
    sequences = provider.sequences_in(region, progress=lambda m: print(f"  {m}", flush=True))
    if args.sequences:
        sequences = sequences[: args.sequences]
    print(f"{len(sequences)} sequences intersect {region.name}", flush=True)

    frames = 0
    for sequence in sequences:
        for _ in provider._sequence_observations(sequence, region):
            frames += 1
        print(f"  {sequence}: {len(provider.calibrations)} calibrations so far", flush=True)

    rows = {name: [] for name in SCHEMA.names}
    for calibration in provider.calibrations:
        for name in SCHEMA.names:
            rows[name].append(getattr(calibration, name))
    OUT.mkdir(parents=True, exist_ok=True)
    pq.write_table(pa.table(rows, schema=SCHEMA), OUT / "calibration-000.parquet",
                   compression="zstd")

    pitches = sorted(c.pitch_deg for c in provider.calibrations if c.pitch_deg is not None)
    rolls = sorted(abs(c.roll_deg) for c in provider.calibrations if c.roll_deg is not None)
    summary = {
        "frames": frames,
        "calibrations": len(provider.calibrations),
        "with_intrinsics": sum(1 for c in provider.calibrations if c.fx),
        "with_pose": sum(1 for c in provider.calibrations if c.position_x is not None),
        "with_lidar_frame": sum(1 for c in provider.calibrations if c.lidar_frame_id),
        "pitch_deg_median": round(pitches[len(pitches) // 2], 3) if pitches else None,
        "pitch_deg_p95": round(pitches[int(len(pitches) * 0.95)], 3) if pitches else None,
        "abs_roll_deg_median": round(rolls[len(rolls) // 2], 3) if rolls else None,
    }
    (OUT / "calibration_summary.json").write_text(json.dumps(summary, indent=1))
    print(json.dumps(summary, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
