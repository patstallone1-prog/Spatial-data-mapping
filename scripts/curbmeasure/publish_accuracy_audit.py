#!/usr/bin/env python3
"""Publish numeric receipts/tests only; never raw photographs or candidate world geometry."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))
from smc.imagery.streetview_reference import atomic_json  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=ROOT / "build/photo-lidar-real-v1")
    args = parser.parse_args()
    acquisitions = json.loads((args.data / "acquisition.json").read_text())
    usgs = json.loads((args.data / "usgs-receipt.json").read_text())
    atomic_json(ROOT / "data/benchmarks/photo-lidar-source-assets.json", acquisitions)
    atomic_json(ROOT / "data/benchmarks/photo-lidar-usgs-control.json", usgs)
    target = ROOT / "docs/audits"
    target.mkdir(parents=True, exist_ok=True)
    synthetic = ROOT / "data/benchmarks/multiview-analytic-5cm-results.json"
    (target / "photo-lidar-synthetic-5cm.json").write_bytes(synthetic.read_bytes())
    atomic_json(
        target / "photo-lidar-sources.json",
        {
            "source_assets": len(acquisitions["assets"]),
            "stored_bytes": acquisitions["stored_bytes"],
            "licenses": ["CC-BY-4.0", "USGS public domain"],
            "attribution": "Hesai and Scale AI, PandaSet; USGS / NV5 Geospatial",
            "usgs": {k: v for k, v in usgs.items() if k != "ept_metadata"},
            "models": json.loads((ROOT / "data/reconstruction/matching_models.json").read_text()),
            "raw_images_published": False,
        },
    )
    print("Published numeric real/synthetic audits and source receipts; no geometry promoted.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
