#!/usr/bin/env python3
"""Reproducible SF inventory baseline; never mistake a photo label for dense geometry."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from smc.reconstruction.contracts import sha256_file  # noqa: E402
from smc.world.coverage import coverage_report  # noqa: E402


def report(root: Path = ROOT) -> dict:
    model_path = root / "docs/sf-corridor-3d.json"
    material_path = root / "docs/sf-corridor-materials.json"
    journal_path = root / "data/regions/sf-corridor/world/photo_objects.journal.jsonl"
    materials = json.loads(material_path.read_text())["assigned"]
    photo_details = set()
    for line in journal_path.read_text().splitlines():
        row = json.loads(line)
        if row["status"] == "accepted":
            photo_details.add(row["id"])
    inventory = []
    for way in json.loads(model_path.read_text())["ways"]:
        if way.get("kind") != "building":
            continue
        osm_id = str(way["osm_id"])
        key = "sf:building:" + osm_id
        inventory.append({"id": key, "category": "building", "geometry":
                          "prior_with_image_inferred_detail" if key in photo_details else "prior",
                          "appearance": "library_photo_material" if osm_id in materials else "procedural"})
    result = coverage_report(inventory)
    result.update(scope="SF canonical building inventory; not a render-visibility audit",
                  source_sha256={str(path.relative_to(root)): sha256_file(path)
                                 for path in (model_path, material_path, journal_path)},
                  reconstructed_dense_geometry_objects=0,
                  actual_rectified_wall_material_objects=0,
                  note="Image-backed openings retain prior footprint/height. Library CC0 textures "
                       "are not photos of those buildings. No promoted dense city object exists yet.")
    curbs = json.loads((root / "data/regions/sf-corridor/world/summary.json").read_text())
    result["curb_source_inventory"] = {key: curbs[key] for key in ("curb_lines", "objects", "heights", "skipped")}
    result["curb_source_inventory"]["note"] = (
        "Built surveyed plan lines, not rendered accuracy: many heights remain inferred; "
        "all-city fallback curb denominator is not enumerated. No percentage is claimed.")
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    result = report()
    encoded = json.dumps(result, indent=2, allow_nan=False) + "\n"
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        with args.out.open("x") as stream:
            stream.write(encoded)
    print(encoded)
