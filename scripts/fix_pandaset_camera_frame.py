#!/usr/bin/env python3
"""Re-derive every PandaSet heading, pitch and roll from the stored quaternions.

The reader took the camera's x axis as its optical axis. PandaSet's cameras are in the ordinary
computer-vision frame -- z forward, x right, y down; the official devkit projects with z as
depth, and the published poses put z along the direction of travel -- so every stored heading
was the direction of the camera's right-hand edge, ninety degrees from where it was looking.

The quaternions themselves were stored correctly, so nothing has to be fetched: the angles are
recomputed here, in the calibration sidecar and in the catalogue's own heading/pitch/roll
columns for the 15,282 PandaSet observations. The lidar depth benchmark
(scripts/build_lidar_depth.py) projects with the same axes and is rebuilt separately, because
that one does need the archive.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import UTC, datetime
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from smc.imagery.calibration import camera_angles, quaternion_to_matrix  # noqa: E402

ENRICH = ROOT / "data" / "observation_enrichment"
CATALOGUE = ROOT / "data" / "sf_corridor" / "observations" / "external-000.parquet"


def recompute(rows: dict) -> dict[str, tuple[float, float, float]]:
    angles: dict[str, tuple[float, float, float]] = {}
    for uid, w, x, y, z in zip(rows["observation_uid"], rows["quaternion_w"],
                               rows["quaternion_x"], rows["quaternion_y"], rows["quaternion_z"],
                               strict=True):
        if w is None:
            continue
        angles[uid] = camera_angles(quaternion_to_matrix(w, x or 0.0, y or 0.0, z or 0.0))
    return angles


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    calibration = pq.read_table(ENRICH / "calibration-000.parquet")
    rows = calibration.to_pydict()
    angles = recompute(rows)
    for i, uid in enumerate(rows["observation_uid"]):
        if uid in angles:
            rows["yaw_deg"][i], rows["pitch_deg"][i], rows["roll_deg"][i] = angles[uid]
    print(f"calibration: {len(angles)} frames re-derived", flush=True)

    catalogue = pq.read_table(CATALOGUE)
    cat = catalogue.to_pydict()
    patched = 0
    for i, (uid, provider) in enumerate(zip(cat["observation_uid"], cat["provider"], strict=True)):
        if provider != "pandaset" or uid not in angles:
            continue
        h, p, r = angles[uid]
        cat["heading_deg"][i], cat["pitch_deg"][i], cat["roll_deg"][i] = h, p, r
        if cat.get("computed_heading_deg") is not None:
            cat["computed_heading_deg"][i] = h
        patched += 1
    print(f"catalogue: {patched} PandaSet observations re-headed", flush=True)

    if args.dry_run:
        return 0
    pq.write_table(pa.table(rows, schema=calibration.schema), ENRICH / "calibration-000.parquet",
                   compression="zstd")
    pq.write_table(pa.table(cat, schema=catalogue.schema), CATALOGUE, compression="zstd")
    summary_path = ENRICH / "calibration_summary.json"
    summary = json.loads(summary_path.read_text()) if summary_path.exists() else {}
    summary["camera_frame"] = {
        "convention": "z forward, x right, y down (the devkit's)",
        "corrected_at": datetime.now(UTC).isoformat(),
        "frames_re_derived": len(angles),
        "catalogue_observations_re_headed": patched,
        "note": "headings were previously derived with x as the optical axis and sat 90 degrees "
                "off; the lidar depth benchmark projected on the same axis and must be rebuilt",
    }
    summary_path.write_text(json.dumps(summary, indent=1) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
