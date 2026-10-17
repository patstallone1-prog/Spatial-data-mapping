"""Merge accepted external-worker facts into immutable app tiles, retaining manual reviews.

Reads an atomic snapshot of individual accepted records, never changes the running
worker or publishes source pixels, detection proposals or rejected houses.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "tools"))
from tile_frontage_fits import slim, tile  # noqa: E402

from smc.imagery.streetview_reference import atomic_json  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--houses", type=Path, required=True)
    args = parser.parse_args()
    # The committed world is the baseline, not a half-written/generated local run.
    def committed(path):
        return json.loads(subprocess.check_output(["git", "show", f"HEAD:{path}"], cwd=ROOT))

    manifest = committed("docs/sf-corridor-frontage-fits.manifest.json")
    buildings = {}
    for item in manifest["tiles"]:
        buildings.update(committed("docs/" + item["path"])["buildings"])
    before = len(buildings)
    index = json.loads((args.houses / "index.json").read_text())
    accepted = skipped = 0
    for house in index["houses"]:
        ident, region = str(house["building_id"]), house["region"]
        if not ident.isdigit() or not region.replace("-", "").isalnum():
            raise ValueError("invalid worker record identity")
        path = args.houses / region / f"{ident}.json"
        record = json.loads(path.read_text())
        if record.get("review_status") != "auto_accepted_visual_parameters" or not record.get("auto_review", {}).get("accept"):
            skipped += 1
            continue
        if not record.get("certainty") or not record.get("canonical_footprint"):
            skipped += 1
            continue
        accepted += 1
        # Material/trim/manual refinements in the production tile must not be lost
        # by replaying an older accepted worker record for the same building.
        if ident in buildings:
            continue
        buildings[ident] = slim(record)
    published = tile(buildings, manifest.get("base", ""))
    report = {"schema": "kerbside.house_publication/1", "worker_accepted_index": index["count"],
              "eligible_worker_records": accepted, "skipped_records": skipped, "before": before,
              "published": published["houses"], "net_added": published["houses"]-before,
              "version": published["version"], "raw_photos_published": False,
              "representation": "image_derived_inferred_visual_parameters_not_dense_scan_or_measured_collision"}
    atomic_json(ROOT / "docs/audits/house-publication-snapshot.json", report)
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
