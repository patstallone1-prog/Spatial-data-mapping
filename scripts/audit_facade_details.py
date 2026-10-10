#!/usr/bin/env python3
"""Run pinned detail detection on named local evidence; no public publication."""

import argparse
import hashlib
import json
import sys
from pathlib import Path

import cv2

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from smc.facades.detail_detection import FacadeDetailDetector  # noqa: E402

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("images", type=Path, nargs="+")
    parser.add_argument("--cache", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    detector = FacadeDetailDetector(args.cache)
    for path in args.images:
        image = cv2.imread(str(path))
        if image is None:
            raise ValueError(f"cannot decode {path}")
        result = detector.detect(image)
        result["image_file_sha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
        (args.output / f"{path.stem}.json").write_text(json.dumps(result, indent=2))
        overlay = image.copy()
        h, w = image.shape[:2]
        for item in result["objects"]:
            x0, y0, x1, y1 = item["box"]
            start, end = (round(x0 * w), round(y0 * h)), (round(x1 * w), round(y1 * h))
            cv2.rectangle(overlay, start, end, (0, 200, 255), 2)
            cv2.putText(
                overlay, item["kind"], start, cv2.FONT_HERSHEY_SIMPLEX, 0.35, (0, 0, 255), 1
            )
        cv2.imwrite(str(args.output / f"{path.stem}.jpg"), overlay)
        print(json.dumps({"image": path.name, "objects": len(result["objects"])}), flush=True)
