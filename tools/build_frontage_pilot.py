"""Three real facade trials; every output remains private and low certainty.

Manual front registration is separate from camera calibration and is not used
to promote geometry. Compare semantic-rule and grounded proposals on the same
registered evidence; their agreement is NOT independent multiview evidence.
"""

import argparse
import hashlib
import json
import sys
import time
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from smc.facades.architecture_logic import front_footprint_frame  # noqa: E402
from smc.facades.detail_detection import FacadeDetailDetector  # noqa: E402
from smc.facades.fit import extract_front  # noqa: E402
from smc.facades.frontage_pixels import FrontagePixelScreen  # noqa: E402
from smc.facades.geometry import LocalFrame  # noqa: E402
from smc.facades.registration import register_front  # noqa: E402
from smc.facades.version import implementation_sha256  # noqa: E402


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, default=ROOT / "data/facade-pilot-2026-10-09.json")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--output", type=Path, default=ROOT / "build/frontage-accuracy-audit/pilot")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    screen = FrontagePixelScreen(ROOT / "build/frontage-pilot-v2/model-cache", device=args.device)
    detector = FacadeDetailDetector(ROOT / "build/facade-detail-model-cache", device=args.device)
    trials = []
    for house in json.loads(args.manifest.read_text())["houses"]:
        path = ROOT / house["review"]
        row = json.loads(path.read_text())
        source = path.with_suffix(".context.jpg")
        image = cv2.imread(str(source))
        wall = row["candidate"]["wall"]
        width = float(np.linalg.norm(np.subtract(wall["b"], wall["a"])))
        payload = json.loads(
            (ROOT / f"docs/app-regions/{row['region']}/sf-corridor-3d.json").read_text()
        )
        bbox = payload["bbox"]
        frame = LocalFrame(
            (bbox["north"] + bbox["south"]) / 2, (bbox["east"] + bbox["west"]) / 2
        )
        canonical = next(w for w in payload["ways"] if str(w.get("osm_id")) == row["building_id"])
        front_footprint = front_footprint_frame(
            [frame.to_xy(*p) for p in canonical["points"]], wall["a"], wall["b"], wall["normal"]
        )
        source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
        image, registration = register_front(
            image, width, wall["height_m"], house["registration"], row["pixel_sha256"], source_hash
        )
        registration["registered_input_file_sha256"] = source_hash
        start = time.perf_counter()
        mask = screen.screen(image, np.ones(image.shape[:2], bool))
        base = {
            "levels": house["levels"],
            "material": house["material"],
            "image_sha256": row["pixel_sha256"],
            "canonical_front_geometry": {
                "ring": front_footprint,
                "canonical_world_sha256": hashlib.sha256(json.dumps(canonical, sort_keys=True).encode()).hexdigest(),
            },
        }
        base["reviewed_outcrops"] = [
            {
                **o,
                "image_sha256": row["pixel_sha256"],
                "reviewer": "Codex private source-image shape review",
                "visible": True,
            }
            for o in house.get("outcrops", [])
        ]
        if house.get("parcel"):
            parcel = house["parcel"]
            base["property_boundary"] = {
                "source": parcel["source"],
                "sha256": hashlib.sha256(json.dumps(parcel, sort_keys=True).encode()).hexdigest(),
                "ring": [frame.to_xy(*p) for p in parcel["ring"]],
                "a": wall["a"],
                "b": wall["b"],
                "normal": wall["normal"],
            }
        rules = extract_front(image, mask["labels"], width, wall["height_m"], base)
        proposals = detector.detect_front(image)
        grounded = extract_front(
            image,
            mask["labels"],
            width,
            wall["height_m"],
            {**base, "detector_proposals": proposals["objects"]},
        )
        for name, fit in (("rules", rules), ("grounded", grounded)):
            fit.update(
                building_id=row["building_id"],
                address=row.get("address"),
                region=row["region"],
                registration=registration,
                image_sha256=row["pixel_sha256"],
                source_locator=row["candidate"]["observation"]["source_locator"],
                review_status="needs_visual_alignment_review",
                source_attribution=row["candidate"]["observation"]["attribution"],
                license_id=row["candidate"]["observation"]["license_id"],
                extraction=name,
                implementation_sha256=implementation_sha256(ROOT),
                canonical_footprint=canonical["points"],
                canonical_front_footprint_uv=front_footprint,
                footprint_basis="canonical_prior_transformed_rigidly_into_front_frame",
            )
            fit["certainty"].update(
                tier="low",
                keep_raw_locally=True,
                ai_review_required=True,
                reasons=[
                    "image_space_registration_not_metric_pose",
                    "bay_or_entrance_depth_unresolved",
                    "render_and_material_need_review",
                ],
            )
            (args.output / f"{row['building_id']}-{name}.json").write_text(
                json.dumps(fit, indent=2)
            )
        cv2.imwrite(str(args.output / f"{row['building_id']}-registered.jpg"), image)
        summary = {
            "building_id": row["building_id"],
            "address": row.get("address"),
            "seconds": time.perf_counter() - start,
            "rules_openings": len(rules["openings"]),
            "grounded_openings": len(grounded["openings"]),
            "screen_pass": mask["pass"],
            "certainty": "low",
            "promoted": False,
        }
        trials.append(summary)
        print(json.dumps(summary), flush=True)
    (args.output / "trials.json").write_text(json.dumps(trials, indent=2))


if __name__ == "__main__":
    main()
