#!/usr/bin/env python3
"""Compare opening-rule decisions against private, hash-bound real-photo proposals.

Reuses existing detector outputs; does not rerun an expensive model, publish
pixels, or turn visual priors into measured geometry.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import cv2

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from smc.facades.opening_reasoning import reason_opening, reason_proposals  # noqa: E402


def audit(report_path: Path, detections: Path, output: Path, annotations: dict) -> dict:
    row = json.loads(report_path.read_text())
    photo = report_path.with_suffix(".context.jpg")
    image = cv2.imread(str(photo))
    if image is None:
        raise ValueError(f"missing context for {report_path}")
    raw = json.loads((detections / (photo.stem + ".json")).read_text())
    digest = hashlib.sha256(photo.read_bytes()).hexdigest()
    if raw["image_file_sha256"] != digest:
        raise ValueError("detection does not match these exact processed pixels")
    wall = row["candidate"]["wall"]
    width = math.dist(wall["a"], wall["b"]) * 1.24
    height = wall["height_m"] * 1.35 + 5
    objects = reason_proposals(
        image, raw["objects"], width, height, image_sha256=row["pixel_sha256"]
    )
    manual = []
    for entry in annotations.get(str(row["building_id"]), []):
        if (
            entry.get("image_sha256") != row["pixel_sha256"]
            or entry.get("image_file_sha256") != digest
        ):
            raise ValueError("manual opening review is not bound to this exact source/crop")
        x0, y0, x1, y1 = entry["box_px"]
        h, w = image.shape[:2]
        if not 0 <= x0 < x1 <= w or not 0 <= y0 < y1 <= h:
            raise ValueError("review box outside photo")
        result = reason_opening(
            image[y0:y1, x0:x1],
            (x1 - x0) / w * width,
            (y1 - y0) / h * height,
            "door",
            image_sha256=row["pixel_sha256"],
            step_review=entry,
        )
        manual.append({"box_px": entry["box_px"], "decision": result})
    record = {
        "schema": "kerbside.opening_rule_audit/1",
        "building_id": row["building_id"],
        "address": row["address"],
        "image_sha256": row["pixel_sha256"],
        "processed_image_sha256": digest,
        "observation_uid": row["candidate"]["observation"]["observation_uid"],
        "attribution": row["candidate"]["observation"]["attribution"],
        "license_id": row["candidate"]["observation"]["license_id"],
        "context_sampling_basis": "canonical facade width * 1.24; height * 1.35 + 5 m; not independent geometry truth",
        "objects": objects,
        "manual_openings": manual,
        "promotion_passed": False,
    }
    output.mkdir(parents=True, exist_ok=True)
    (output / f"{row['building_id']}.json").write_text(json.dumps(record, indent=2))
    overlay = image.copy()
    for item in objects:
        decision = item.get("opening_reasoning")
        if not decision:
            continue
        x0, y0, x1, y1 = item["box"]
        h, w = image.shape[:2]
        start, end = (round(x0 * w), round(y0 * h)), (round(x1 * w), round(y1 * h))
        cv2.rectangle(overlay, start, end, (0, 180, 255), 2)
        cv2.putText(
            overlay, decision["class"], start, cv2.FONT_HERSHEY_SIMPLEX, 0.30, (0, 0, 255), 1
        )
    for entry in manual:
        x0, y0, x1, y1 = entry["box_px"]
        cv2.rectangle(overlay, (x0, y0), (x1, y1), (0, 220, 0), 2)
        cv2.putText(
            overlay,
            entry["decision"]["class"],
            (x0, y0),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.30,
            (0, 120, 0),
            1,
        )
    cv2.imwrite(str(output / f"{row['building_id']}.jpg"), overlay)
    return {
        "building": row["building_id"],
        "decisions": [
            (o["kind"], o["opening_reasoning"]["class"])
            for o in objects
            if o.get("opening_reasoning")
        ],
        "manual_decisions": [o["decision"]["class"] for o in manual],
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("reports", type=Path, nargs="+")
    parser.add_argument("--detections", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--annotations", type=Path)
    args = parser.parse_args()
    annotations = json.loads(args.annotations.read_text()) if args.annotations else {}
    for path in args.reports:
        print(json.dumps(audit(path, args.detections, args.output, annotations)), flush=True)
