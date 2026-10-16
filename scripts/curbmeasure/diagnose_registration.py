#!/usr/bin/env python3
"""Resume the cached photo-kerb run without network access or modifying its evidence.

Report raw errors, independent lidar comparisons, and oracle-to-SFMTA fits separately.
Never use a fitted curb line as the truth for claiming reconstruction accuracy.
"""

from __future__ import annotations

import argparse
import hashlib
import itertools
import json
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))

from smc.curbmeasure.registration import error_stats, fit_camera, nearest_segments  # noqa: E402
from smc.curbmeasure.semantic import View, label_raster, measure, metres_per_degree  # noqa: E402
from smc.curbmeasure.terrain_grade import TerrainGrade  # noqa: E402


def fingerprint(path: Path) -> dict:
    parts = path.parts
    # Portable locators, not this machine's username or checkout name.
    first = next(
        (i for i, p in enumerate(parts) if p in ("build", "docs", "data", "src", "scripts")), 0
    )
    return {
        "path": str(Path(*parts[first:])),
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
    }


def diagnose(evidence: Path, region: str, official_path: Path) -> dict:
    run = evidence / "build" / "curbphoto" / region
    observations_path = run / "observations.jsonl"
    old = [json.loads(line) for line in observations_path.read_text().splitlines() if line]
    heights = {r["image"]: r["H"] for r in old}
    cache = evidence / "build" / "curbphoto" / "cache"
    official = json.loads(official_path.read_text())
    payload_path = evidence / "docs" / "regions" / region / "sf-corridor-3d.json"
    terrain_path = payload_path.with_name("sf-corridor-terrain.json")
    terrain = TerrainGrade(terrain_path)
    bbox = json.loads(payload_path.read_text())["bbox"]

    def supported(xy: np.ndarray) -> np.ndarray:
        lonlat = xy / k + origin
        # Explicit 5 m interior: no blaming a truncated boundary reference on a sensor.
        return (
            (lonlat[:, 0] >= bbox["west"] + 5 / k[0])
            & (lonlat[:, 0] <= bbox["east"] - 5 / k[0])
            & (lonlat[:, 1] >= bbox["south"] + 5 / k[1])
            & (lonlat[:, 1] <= bbox["north"] - 5 / k[1])
        )

    lines = [r["p"] for r in official.get("curb_lines", []) if r.get("r") == "block"]
    if not lines:
        raise ValueError("no block curb references; do not substitute islands or paint")
    lon0, lat0 = np.median(np.vstack(lines), axis=0)
    # WGS84 ellipsoid local derivatives; one shared frame for camera, observations and truth.
    k = np.array(metres_per_degree(lat0))
    origin = np.array([lon0, lat0])
    segments = np.array(
        [
            [a, b]
            for line in lines
            for a, b in itertools.pairwise(line)
            if np.linalg.norm((np.array(b) - a) * k) > 0.05
        ]
    )
    segments = (segments - origin) * k
    lidar_path = evidence / "data" / "regions" / region / "lidar" / "kerb_stations.jsonl"
    lidar = [json.loads(line) for line in lidar_path.read_text().splitlines() if line]
    lidar_xy = (np.array([[r["lon"], r["lat"]] for r in lidar]) - origin) * k
    from scipy.spatial import cKDTree

    tree = cKDTree(lidar_xy)
    lidar_reference_error = nearest_segments(lidar_xy, segments)[1]
    raw, oracle, fitted, height_errors, unpaired = [], [], [], [], 0
    controlled_raw, controlled_height, controlled_photos = [], [], set()
    height_by_photo = defaultdict(list)
    height_sequences, height_streets = set(), set()
    slope_raw, flat_same_slope_photos, slope_photos = [], [], 0
    source_docs = []
    by_image = defaultdict(list)
    for row in old:
        by_image[row["image"]].append(row)
    for image_id in sorted(heights):
        path = cache / f"{image_id}.json"
        if not path.exists():
            continue
        doc = json.loads(path.read_text())
        view = View.from_doc(doc)
        if view is None:
            continue
        source_docs.append(fingerprint(path))
        # Regenerate ALL extracted points, not only the old <=4 m matches.
        labels = label_raster(doc, view.raster)
        rows = measure(view, labels, heights[image_id])
        if not rows:
            continue
        xy = (np.array([[r.lon, r.lat] for r in rows]) - origin) * k
        camera = (np.array([view.lon, view.lat]) - origin) * k
        # Local references keep exact nearest segment matching cheap without extending lines.
        mid = segments.mean(axis=1)
        reach = np.linalg.norm(segments[:, 1] - segments[:, 0], axis=1) / 2 + 30
        near = np.linalg.norm(mid - camera, axis=1) <= reach
        if not near.any():
            unpaired += len(rows)
            continue
        local = segments[near]
        fit = fit_camera(xy, camera, local)
        fit.update(
            {
                "image": image_id,
                "sequence": view.sequence,
                "camera_type": view.camera_type,
                "assumed_camera_height_m": heights[image_id],
            }
        )
        raw.extend(nearest_segments(xy, local)[1])
        grade = terrain.at(view.lon, view.lat)
        if grade is not None:
            graded_rows = measure(view, labels, heights[image_id], grade_e_n=grade["grade_e_n"])
            graded_xy = (
                np.array([[r.lon, r.lat] for r in graded_rows]).reshape(-1, 2) - origin
            ) * k
            slope_raw.extend(nearest_segments(graded_xy, local)[1])
            flat_same_slope_photos.extend(nearest_segments(xy, local)[1])
            slope_photos += 1
            fit["terrain_grade_ablation"] = grade
        core = supported(xy)
        controlled_raw.extend(nearest_segments(xy[core], local)[1])
        if "candidate_scale" in fit:
            corrected = camera + (xy - camera) * fit["candidate_scale"] + fit["candidate_shift_m"]
            oracle.extend(nearest_segments(corrected, local)[1])
            fit["oracle_finite_segment_error"] = error_stats(nearest_segments(corrected, local)[1])
        fitted.append(fit)
        # Pair in plan only, never choose a truth station by the height we want to validate.
        distances, indices = tree.query(xy)
        for obs, distance, idx in zip(rows, distances, indices, strict=True):
            if distance > 1.0 or lidar[idx]["height_m"] is None:
                continue
            height_errors.append(obs.height_m - lidar[idx]["height_m"])
            # Independent survey screens the *lidar reference*, not the desired photo height.
            # Still diagnostic: proximity does not establish object correspondence.
            if lidar_reference_error[idx] <= 0.25:
                controlled_height.append(obs.height_m - lidar[idx]["height_m"])
                controlled_photos.add(image_id)
                height_by_photo[image_id].append(obs.height_m - lidar[idx]["height_m"])
                height_sequences.add(view.sequence)
                height_streets.add(lidar[idx]["way"])
    identified = [r for r in fitted if r["status"] == "identified"]
    return {
        "schema_version": 1,
        "region": region,
        "status": "diagnostic_only_not_promoted",
        "sources": [
            fingerprint(observations_path),
            fingerprint(official_path),
            fingerprint(lidar_path),
            fingerprint(payload_path),
            fingerprint(ROOT / "src" / "smc" / "curbmeasure" / "semantic.py"),
            fingerprint(ROOT / "src" / "smc" / "curbmeasure" / "registration.py"),
            fingerprint(ROOT / "src" / "smc" / "curbmeasure" / "terrain_grade.py"),
            fingerprint(Path(__file__).resolve()),
            fingerprint(terrain_path),
            fingerprint(terrain_path.with_suffix(".bin")),
        ],
        "camera_sources": source_docs,
        "cameras": len(fitted),
        "fully_identified_cameras": len(identified),
        "raw_all_extracted_to_sfmta": error_stats(np.array(raw)),
        "raw_reference_core_to_sfmta": error_stats(np.array(controlled_raw)),
        "terrain_grade_ablation": {
            "photos": slope_photos,
            "flat_raw_same_photos": error_stats(np.array(flat_same_slope_photos)),
            "lidar_grade_conditioned_raw": error_stats(np.array(slope_raw)),
            "independent_camera_only_accuracy": False,
        },
        "oracle_in_sample_to_sfmta_NOT_accuracy": error_stats(np.array(oracle)),
        "raw_photo_height_vs_lidar_within_1m": error_stats(np.array(height_errors)),
        "lidar_stations_to_sfmta_reference": error_stats(lidar_reference_error),
        "lidar_core_stations_to_sfmta": error_stats(lidar_reference_error[supported(lidar_xy)]),
        "lidar_stations_outside_reference_core": int((~supported(lidar_xy)).sum()),
        "photo_height_vs_survey_screened_lidar": error_stats(np.array(controlled_height)),
        "survey_screened_height_photos": len(controlled_photos),
        "survey_screened_height_sequences": len(height_sequences),
        "survey_screened_height_streets": len(height_streets),
        "height_error_photo_balanced": error_stats(
            np.array([np.median(rows) for rows in height_by_photo.values()])
        ),
        "unpaired_no_survey_near_camera": unpaired,
        "independent_promotion_pass": False,
        "new_streets_calibrated_run": "withheld until frozen calibration passes held-out streets",
        "limitations": [
            "Original cache covers only photos with old scored observations; not all 88 poses.",
            "No shared vertical datum established for computed_altitude minus lidar elevation.",
            "Flat-road, segmentation, pitch, scale and reference errors remain confounded.",
            "Adjacent pixel columns are correlated; point count is not independent sample count.",
            "1 m proximity is a pairing screen, not proof of corresponding curb identity.",
            "No validated photographic sidewalk back-edge/width truth pairs exist in this run.",
            "No fitted result updates canonical geometry or renderer defaults.",
        ],
        "per_photo": fitted,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--evidence-root", type=Path, default=ROOT)
    ap.add_argument("--region", default="sf-mission")
    ap.add_argument("--official", type=Path)
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()
    official = args.official or (
        args.evidence_root / "docs" / "regions" / args.region / "sf-corridor-official.json"
    )
    result = diagnose(args.evidence_root, args.region, official)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2, allow_nan=False) + "\n")
    print(
        json.dumps(
            {k: v for k, v in result.items() if k not in ("per_photo", "camera_sources")}, indent=2
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
