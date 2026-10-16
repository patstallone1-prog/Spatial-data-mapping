#!/usr/bin/env python3
"""Prepare reviewed/masked photo tracks, then refine against separate fitting controls.

Two phases intentionally separate feature IDs from test truth. --prepare writes
tracks for independent landmark review. --benchmark scores a frozen, ID-matched
survey/lidar manifest; checkpoint coordinates never enter the optimizer.
Nothing here publishes geometry or modifies canonical/renderer data.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))

from smc.curbmeasure.geometry import Camera  # noqa: E402
from smc.reconstruction.contracts import load_rights, sha256_file  # noqa: E402
from smc.reconstruction.fusion import mask_temporary_objects  # noqa: E402
from smc.reconstruction.matching import Frame, Track, match_frames  # noqa: E402
from smc.reconstruction.matching_benchmark import (  # noqa: E402
    assert_holdout_disjoint,
    evaluate,
    validate_benchmark,
)
from smc.reconstruction.multiview import Control, Relation, refine  # noqa: E402
from smc.reconstruction.pixel_store import CanonicalPixels  # noqa: E402


def camera(row):
    data = row["camera"]
    return Camera(
        str(data["image_id"]),
        np.array(data["centre"], float),
        np.array(data["rotation"], float),
        float(data["focal_px"]),
        tuple(data["principal"]),
        float(data["k1"]),
        float(data["k2"]),
        int(data["width"]),
        int(data["height"]),
        float(data["fy_px"]) if data.get("fy_px") is not None else None,
    )


def prepare(case, rights):
    if case.get("controls") or case.get("relations"):
        raise ValueError("prepare feature IDs before assigning fitting controls or relations")
    frames, images, masks, landmarks = [], [], [], []
    for row in case["images"]:
        source = rights[row["source_id"]]
        source.require("cv_processing")
        if row["license_id"] != source.license_id or not row.get("attribution"):
            raise ValueError("license/attribution mismatch")
        for path_key, hash_key in (("image_path", "image_sha256"), ("masks_npz", "masks_sha256")):
            if sha256_file(Path(row[path_key])) != row[hash_key]:
                raise ValueError(f"{path_key} checksum mismatch")
        pixels = CanonicalPixels.from_image(Path(row["image_path"]))
        if pixels.sha256 != row["pixel_sha256"] or pixels.bits_per_channel != 8:
            raise ValueError("canonical pixel checksum mismatch or unsupported matching precision")
        image = np.frombuffer(pixels.samples, dtype=np.uint8).reshape(
            pixels.height, pixels.width, pixels.channels
        )
        if pixels.channels == 3:
            image = cv2.cvtColor(image, cv2.COLOR_RGB2BGR)
        elif pixels.channels != 1:
            raise ValueError("matching requires RGB or grayscale canonical pixels")
        else:
            image = image[:, :, 0]
        with np.load(row["masks_npz"], allow_pickle=False) as archive:
            labels = {k: archive[k].astype(bool) for k in archive.files}
        if not {"person", "face", "license_plate", "car", "sky"} <= labels.keys():
            raise ValueError("required privacy/dynamic masks absent")
        blocked = mask_temporary_objects(labels, row["reprojection_sigma_px"])
        c = camera(row)
        frames.append(Frame(c, row["sequence_id"], row["component_id"], row["pixel_sha256"]))
        images.append(image)
        masks.append(blocked)
        priority = np.zeros(blocked.shape, bool)
        for key in ("street_corner", "building_edge", "pole"):
            priority |= labels.get(key, np.zeros_like(priority))
        landmarks.append(priority & ~blocked)
    tracks, report = match_frames(frames, images, masks, landmarks)
    groups = report["overlap_groups"]
    return [
        {
            **case,
            "matching": report,
            "parent_case_id": case["case_id"],
            "case_id": case["case_id"] if len(groups) == 1 else f"{case['case_id']}:overlap-{i}",
            "images": [r for r in case["images"] if str(r["camera"]["image_id"]) in group],
            "tracks": [
                {"track_id": t.track_id, "pixels": {k: v.tolist() for k, v in t.pixels.items()}}
                for t in tracks
                if set(t.pixels) <= set(group)
            ],
        }
        for i, group in enumerate(groups)
    ]


def run(document, benchmark):
    if document.get("coordinate_frame") != "local_ENU_m":
        raise ValueError("all cameras and truth must use local_ENU_m")
    if document.get("enu_origin_wgs84") != benchmark.get("enu_origin_wgs84"):
        raise ValueError("fitting and checkpoint ENU origins differ")
    if (
        np.shape(document.get("enu_origin_wgs84")) != (3,)
        or not np.isfinite(document["enu_origin_wgs84"]).all()
    ):
        raise ValueError("explicit finite WGS84 ENU origin required")
    cases = {c["case_id"]: c for c in document["cases"]}
    if len(cases) != len(document["cases"]):
        raise ValueError("duplicate input case IDs")
    validate_benchmark(benchmark, cases)
    assert_holdout_disjoint(
        [r for c in cases.values() for r in c.get("images", [])],
        benchmark.get("held_out_observations", []),
    )
    predictions = {}
    for case_id, case in cases.items():
        try:
            if "tracks" not in case:
                predictions[case_id] = {"status": "missing_prepared_tracks"}
                continue
            if len(case["images"]) < 3:
                predictions[case_id] = {"status": "insufficient_views"}
                continue
            tracks = [
                Track(t["track_id"], {k: np.array(p, float) for k, p in t["pixels"].items()})
                for t in case["tracks"]
            ]
            controls = [
                Control(
                    c["track_id"], np.array(c["xyz"], float), float(c["sigma_m"]), c["source_id"]
                )
                for c in case.get("controls", [])
            ]
            relations = [Relation(**r) for r in case.get("relations", [])]
            predictions[case_id] = refine(
                [camera(r) for r in case["images"]], tracks, controls, relations
            )
        except (ValueError, KeyError, np.linalg.LinAlgError) as exc:
            predictions[case_id] = {"status": "invalid_input", "reason": str(exc)}
    return {"predictions": predictions, "benchmark": evaluate(benchmark, predictions, cases)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--prepare", action="store_true")
    parser.add_argument(
        "--rights", type=Path, default=ROOT / "data/reconstruction/source_rights.json"
    )
    parser.add_argument("--benchmark", type=Path)
    args = parser.parse_args()
    if args.output.resolve() == args.manifest.resolve():
        parser.error("never overwrite the fitting manifest")
    document = json.loads(args.manifest.read_text())
    if args.prepare:
        if args.benchmark:
            parser.error(
                "prepare feature IDs before independent checkpoint review, not against truth"
            )
        rights = load_rights(args.rights)
        cases = []
        for case in document["cases"]:
            # A failed refresh must not preserve stale tracks from an earlier preparation.
            case = {k: v for k, v in case.items() if k not in {"tracks", "matching"}}
            try:
                cases.extend(prepare(case, rights))
            except (OSError, ValueError, KeyError) as exc:
                cases.append({**case, "preparation_failure": str(exc)})
        result = {**document, "cases": cases, "input_sha256": sha256_file(args.manifest)}
    else:
        if not args.benchmark:
            parser.error("a frozen benchmark is required for refinement")
        if args.output.resolve() == args.benchmark.resolve():
            parser.error("never overwrite the benchmark")
        benchmark = json.loads(args.benchmark.read_text())
        if benchmark.get("fitting_manifest_sha256") != sha256_file(args.manifest):
            parser.error("benchmark must freeze the exact prepared fitting manifest hash")
        result = run(document, benchmark)
        result["input_sha256"] = sha256_file(args.manifest)
        result["benchmark_sha256"] = sha256_file(args.benchmark)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, allow_nan=False) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
