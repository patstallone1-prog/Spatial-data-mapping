#!/usr/bin/env python3
"""Prepare and validate geometry-guided visual cells for the SF pilot.

The preparation stage intentionally emits blocked manifests.  Promotion requires
licensed oblique imagery, masks, reconstruction, and independent truth; this
command never fabricates those assets from the canonical map.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from smc.reconstruction.colmap_runner import reconstruct_cell  # noqa: E402
from smc.reconstruction.workflow import prepare_pilot, validate_pilot_output  # noqa: E402

DEFAULT_CATALOGS = [
    ROOT / "data/sf_corridor_mapillary_dense/observations/external-000.parquet",
    ROOT / "data/sf_corridor_panoramax_dense/observations/external-000.parquet",
    ROOT / "data/sf_corridor_kartaview_dense/observations/external-000.parquet",
]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--region", default="sf-corridor")
    ap.add_argument("--out", type=Path, default=ROOT / "build/visual/pilot")
    ap.add_argument("--canonical", type=Path, default=ROOT / "docs/sf-corridor-3d.json")
    ap.add_argument("--catalog", type=Path, action="append")
    ap.add_argument("--run-id", default="sf-pilot-visual-v1")
    ap.add_argument("--inputs", type=Path, help="rights-checked local image and mask manifest")
    ap.add_argument("--work-dir", type=Path, help="scratch directory for SfM/MVS outputs")
    ap.add_argument("--validate", action="store_true")
    args = ap.parse_args()
    if args.region != "sf-corridor":
        print("visual reconstruction currently has only the SF pilot", file=sys.stderr)
        return 2
    benchmark = ROOT / "data/reconstruction/pilot_benchmark.json"
    if args.inputs:
        if not args.work_dir:
            ap.error("--inputs requires --work-dir")
        result = reconstruct_cell(
            args.inputs,
            ROOT / "data/reconstruction/source_rights.json",
            benchmark,
            args.work_dir,
        )
    elif args.validate:
        result = validate_pilot_output(args.out, args.canonical, benchmark)
    else:
        result = prepare_pilot(
            canonical_path=args.canonical,
            chunks_path=ROOT / "docs/sf-corridor-chunks.json",
            catalog_paths=args.catalog or DEFAULT_CATALOGS,
            benchmark_path=benchmark,
            rights_path=ROOT / "data/reconstruction/source_rights.json",
            output_dir=args.out,
            run_id=args.run_id,
        )
        result = {"cells": len(result), "quality_state": "blocked",
                  "output": str(args.out)}
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
