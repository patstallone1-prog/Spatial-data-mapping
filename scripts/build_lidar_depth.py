#!/usr/bin/env python3
"""Put PandaSet's lidar into its own photographs, and measure what the catalogue was guessing.

Fifteen thousand frames in this catalogue were taken with two lidars firing from the same
vehicle at the same instant. Nothing has ever used them. This projects each sweep into each
camera that shares its moment and writes, per frame, how far away the things in it actually
are -- the only metric truth in a corpus of 386,624 photographs.

The immediate use is checking an assumption. The pair graph scores two frames by the angle they
subtend at their subject, and it works out the subject's distance from the street's recorded
cross-section: half a carriageway plus a footway, less however far the camera stood off the
centreline. That is a reasonable guess and it has never been tested against a measurement.
Here it is tested.

The sweeps are gzipped pickles and are read through smc.imagery.safe_pickle, which refuses any
import the file was not expected to need and builds no pandas object at all.
"""

from __future__ import annotations

import argparse
import json
import http.client
import sys
import time
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

import numpy as np  # noqa: E402
import pyarrow as pa  # noqa: E402
import pyarrow.parquet as pq  # noqa: E402

from smc.enrich.depth import project_points_to_image  # noqa: E402
from smc.enrich.pairs import subject_distance  # noqa: E402
from smc.imagery.calibration import SensorCalibration  # noqa: E402
from smc.imagery.pandaset import IMAGE_HEIGHT, IMAGE_WIDTH, PandaSetProvider  # noqa: E402
from smc.imagery.safe_pickle import UnsafePickle, load_point_cloud  # noqa: E402

ENRICH = ROOT / "data" / "observation_enrichment"

#: A horizontal band about the optical axis. Returns landing here came off whatever the camera
#: was pointed at rather than off the road surface below it or the sky above, which is what
#: makes it comparable to the subject distance the pair graph assumes.
HORIZON_BAND = 0.12
#: Half-width of the central box, as a fraction of the image. Twenty per cent of a 52-degree
#: lens is about ten degrees either side of where the camera is pointed.
CENTRE_BOX = 0.20

SCHEMA = pa.schema([
    ("observation_uid", pa.string()),
    ("lidar_frame_id", pa.string()),
    ("camera", pa.string()),
    ("returns_in_frame", pa.int32()),
    ("depth_median_m", pa.float32()),
    ("depth_p10_m", pa.float32()),
    ("depth_p90_m", pa.float32()),
    ("horizon_depth_median_m", pa.float32()),
    ("centre_depth_median_m", pa.float32()),
    ("centre_depth_p10_m", pa.float32()),
    ("image_coverage", pa.float32()),
    ("assumed_subject_distance_m", pa.float32()),
])


def _camera_of(row: dict, lookup: dict) -> str | None:
    return lookup.get(row["observation_uid"])


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--sequences", type=int, default=None)
    args = ap.parse_args()

    def progress(message: str) -> None:
        print(message, flush=True)

    calibrations = pq.read_table(ENRICH / "calibration-000.parquet").to_pylist()
    # The camera an observation came from is in its image id: sequence/camera/index.
    image_ids = pq.read_table(
        ROOT / "data" / "sf_corridor" / "observations" / "external-000.parquet",
        columns=["observation_uid", "provider_image_id"]).to_pydict()
    calibrations_by_uid = {
        uid: image.split("/")[1] if image and image.count("/") >= 2 else None
        for uid, image in zip(image_ids["observation_uid"], image_ids["provider_image_id"])
    }
    by_sweep: dict[str, list[dict]] = defaultdict(list)
    for row in calibrations:
        if row["lidar_frame_id"]:
            by_sweep[row["lidar_frame_id"]].append(row)
    progress(f"{len(calibrations)} calibrated frames across {len(by_sweep)} sweeps")

    enrichment = pq.read_table(ENRICH / "enrichment-000.parquet", columns=[
        "observation_uid", "centreline_distance_m",
        "official_carriageway_m", "official_sidewalk_m"]).to_pydict()
    context = {uid: (a, b, c) for uid, a, b, c in zip(
        enrichment["observation_uid"], enrichment["centreline_distance_m"],
        enrichment["official_carriageway_m"], enrichment["official_sidewalk_m"])}

    provider = PandaSetProvider()
    sweeps = sorted(by_sweep)
    if args.sequences:
        keep = sorted({s.split("/")[0] for s in sweeps})[: args.sequences]
        sweeps = [s for s in sweeps if s.split("/")[0] in keep]
    progress(f"{len(sweeps)} sweeps to read")

    out: dict[str, list] = {name: [] for name in SCHEMA.names}
    refused = missing = 0
    for n, sweep in enumerate(sweeps, start=1):
        sequence, _, index = sweep.split("/")
        raw = None
        for attempt in range(4):
            try:
                raw = provider.archive.read(f"pandaset/{sequence}/lidar/{index}.pkl.gz")
                break
            except KeyError:
                break
            except (OSError, TimeoutError, http.client.HTTPException) as exc:
                # IncompleteRead is an HTTPException, not an OSError, so a retry list built
                # from OSError alone lets it through and ends the run -- which is exactly how
                # this died the first time and again at sweep 900.
                # Eleven gigabytes of HTTP range reads against a mirror: one of them will
                # eventually time out, and an unretried read ended a two-hour run at sweep 100.
                if attempt == 3:
                    progress(f"  gave up on {sweep}: {exc}")
                time.sleep(2 ** attempt)
        if raw is None:
            missing += 1
            continue
        try:
            cloud = load_point_cloud(raw)
        except UnsafePickle as exc:
            # A sweep asking to import something unexpected is not read, and the run says so
            # rather than quietly skipping it.
            progress(f"  refused {sweep}: {exc}")
            refused += 1
            continue
        points = np.column_stack([cloud["x"], cloud["y"], cloud["z"]])

        for row in by_sweep[sweep]:
            calibration = SensorCalibration(**{
                k: row[k] for k in
                ("observation_uid", "provider", "fx", "fy", "cx", "cy",
                 "position_x", "position_y", "position_z",
                 "quaternion_w", "quaternion_x", "quaternion_y", "quaternion_z")})
            u, v, depth, valid = project_points_to_image(
                points, calibration, IMAGE_WIDTH, IMAGE_HEIGHT)
            if not valid.any():
                continue
            near = depth[valid]
            band = valid & (np.abs(v - (calibration.cy or IMAGE_HEIGHT / 2))
                            < IMAGE_HEIGHT * HORIZON_BAND)
            # What is in the middle of the picture, rather than everything at eye level. A
            # band across the whole frame is dominated by long sightlines down the street,
            # which is why it reported a median subject twenty metres further away than any
            # facade: it was measuring the far end of the block.
            centre = band & (np.abs(u - (calibration.cx or IMAGE_WIDTH / 2))
                             < IMAGE_WIDTH * CENTRE_BOX)
            offset, carriageway, sidewalk = context.get(row["observation_uid"], (None, None, None))

            out["observation_uid"].append(row["observation_uid"])
            out["lidar_frame_id"].append(sweep)
            out["camera"].append(row["observation_uid"] and _camera_of(row, calibrations_by_uid))
            out["returns_in_frame"].append(int(valid.sum()))
            out["depth_median_m"].append(float(np.median(near)))
            out["depth_p10_m"].append(float(np.percentile(near, 10)))
            out["depth_p90_m"].append(float(np.percentile(near, 90)))
            out["horizon_depth_median_m"].append(
                float(np.median(depth[band])) if band.any() else None)
            out["centre_depth_median_m"].append(
                float(np.median(depth[centre])) if centre.any() else None)
            # The nearest substantial surface the camera is pointed at, which is the thing a
            # stereo pair would actually triangulate.
            out["centre_depth_p10_m"].append(
                float(np.percentile(depth[centre], 10)) if centre.any() else None)
            # How much of the frame a sweep actually lands on, at the resolution a depth map
            # would be used at.
            cells = np.unique((v[valid] // 8).astype(np.int32) * 1000
                              + (u[valid] // 8).astype(np.int32))
            out["image_coverage"].append(
                float(len(cells) / ((IMAGE_WIDTH // 8) * (IMAGE_HEIGHT // 8))))
            out["assumed_subject_distance_m"].append(
                subject_distance(offset, carriageway, sidewalk))
        if n % 100 == 0:
            progress(f"  {n}/{len(sweeps)} sweeps, {len(out['observation_uid'])} frames")

    ENRICH.mkdir(parents=True, exist_ok=True)
    pq.write_table(pa.table(out, schema=SCHEMA), ENRICH / "lidar_depth-000.parquet",
                   compression="zstd")

    # -- was the assumption any good? --------------------------------------------------------
    pairs = [(a, m) for a, m in zip(out["assumed_subject_distance_m"],
                                    out["centre_depth_p10_m"])
             if a is not None and m is not None and 1.0 < m < 120.0]
    errors = sorted(a - m for a, m in pairs)
    absolute = sorted(abs(e) for e in errors)
    returns = sorted(out["returns_in_frame"])
    coverage = sorted(out["image_coverage"])
    by_camera: dict[str, list] = defaultdict(list)
    for camera, assumed, measured in zip(out["camera"], out["assumed_subject_distance_m"],
                                         out["centre_depth_p10_m"]):
        if camera and assumed is not None and measured is not None and 1.0 < measured < 120.0:
            by_camera[camera].append(assumed - measured)
    camera_report = {}
    for camera, values in sorted(by_camera.items()):
        values.sort()
        camera_report[camera] = {
            "n": len(values),
            "assumed_minus_measured_median_m": round(values[len(values) // 2], 2),
            "mean_abs_error_m": round(sum(abs(v) for v in values) / len(values), 2),
        }

    summary = {
        "sweeps_read": len(sweeps) - missing - refused,
        "sweeps_refused_by_the_pickle_gate": refused,
        "sweeps_missing_from_the_archive": missing,
        "frames_with_depth": len(out["observation_uid"]),
        "returns_in_frame_median": returns[len(returns) // 2] if returns else None,
        "total_returns_projected": int(sum(out["returns_in_frame"])),
        "image_coverage_median": round(coverage[len(coverage) // 2], 3) if coverage else None,
        "subject_distance_check": {
            "n": len(pairs),
            "assumed_minus_measured_median_m": round(errors[len(errors) // 2], 2) if errors else None,
            "mean_abs_error_m": round(sum(absolute) / len(absolute), 2) if absolute else None,
            "within_3m": round(sum(1 for e in absolute if e <= 3.0) / len(absolute), 3)
            if absolute else None,
            # Split by camera, because "the subject" is not the same thing for all of them. A
            # forward camera on a street sees the far end of the block down its optical axis;
            # a side camera sees the frontage the assumption is actually about.
            "by_camera": camera_report,
        },
    }
    (ENRICH / "lidar_depth_summary.json").write_text(json.dumps(summary, indent=1))
    print(json.dumps(summary, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
