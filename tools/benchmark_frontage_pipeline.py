"""Measure real local screening/extraction without estimating from sleep intervals."""

import argparse
import json
import sys
import time
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from smc.facades.detail_detection import FacadeDetailDetector  # noqa: E402
from smc.facades.fit import extract_front  # noqa: E402
from smc.facades.frontage_pixels import FrontagePixelScreen  # noqa: E402


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--inputs", nargs="+", type=Path, required=True)
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--rounds", type=int, default=2)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    detector = FacadeDetailDetector(ROOT / "build/facade-detail-model-cache", device=args.device)
    screen = FrontagePixelScreen(ROOT / "build/frontage-pilot-v2/model-cache", device=args.device)
    results = []
    for round_index in range(args.rounds):
        for path in args.inputs:
            row = json.loads(path.read_text())
            image = cv2.imread(str(path.with_suffix(".jpg")))
            wall = row["candidate"]["wall"]
            width = np.linalg.norm(np.subtract(wall["b"], wall["a"]))
            start = time.perf_counter()
            mask = screen.screen(image, np.ones(image.shape[:2], bool))
            screened = time.perf_counter()
            rule_fit = extract_front(
                image,
                mask["labels"],
                width,
                wall["height_m"],
                {"image_sha256": row["pixel_sha256"]},
            )
            rules = time.perf_counter()
            objects = detector.detect(image)
            detected = time.perf_counter()
            fit = extract_front(
                image,
                mask["labels"],
                width,
                wall["height_m"],
                {"detector_proposals": objects["objects"], "image_sha256": row["pixel_sha256"]},
            )
            finished = time.perf_counter()
            result = {
                "building_id": row["building_id"],
                "round": round_index,
                "screen_seconds": screened - start,
                "rule_fit_seconds": rules - screened,
                "rule_openings": len(rule_fit["openings"]),
                "detector_seconds": detected - rules,
                "fit_seconds": finished - detected,
                "openings": len(fit["openings"]),
                "screen_pass": mask["pass"],
            }
            results.append(result)
            print(json.dumps(result), flush=True)
    warm = [r for r in results if r["round"] > 0]

    def mean(field):
        return sum(r[field] for r in warm) / len(warm)

    stats = {
        "device": args.device,
        "samples": results,
        "warm_means": {
            k: mean(k)
            for k in ("screen_seconds", "rule_fit_seconds", "detector_seconds", "fit_seconds")
        },
        "exclusions": [
            "network_download",
            "decode_and_pixel_storage",
            "human_or_AI_review",
            "city_mesh_compilation",
            "retries",
        ],
        "measurement_not_completion_promise": True,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(stats, indent=2))


if __name__ == "__main__":
    main()
