#!/usr/bin/env python3
"""Future operator entry point. Default is plan-only; --allow-intake is explicit activation.

Not called by --all, deployment, the background house workers, or the gap planner.
Once authorized, uses the existing journalled source adapters and failure gates.
"""
import argparse
import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from smc.imagery.region import BBox, Region  # noqa: E402
from smc.imagery.streetview_reference import atomic_json  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("job", help="an exact job name in the committed gap plan")
    parser.add_argument("--allow-intake", action="store_true")
    parser.add_argument("--stages", default="discover", help="discovery first; subsequent existing stages opt in")
    args = parser.parse_args()
    jobs = json.loads((ROOT / "data/regions/gap-plan.json").read_text())["jobs"]
    job = next((j for j in jobs if j["name"] == args.job), None)
    if job is None:
        parser.error("unknown planned job")
    if not args.allow_intake:
        print(json.dumps({"intake_started": False, "job": job}, indent=2))
        return 0
    spec = importlib.util.spec_from_file_location("gap_existing_ingester", ROOT / "scripts/ingest_region.py")
    ingester = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(ingester)
    stages = args.stages.split(",")
    if any(stage not in ingester.DEFAULT_STAGES for stage in stages):
        parser.error("only established ingestion stages may be activated")
    path = ROOT / "data/regions/regions.json"
    registry = json.loads(path.read_text())
    previous = next((r for r in registry["regions"] if r["name"] == job["name"]), None)
    if previous and previous["bbox"] != job["bbox"]:
        raise ValueError("active bounds differ; do not silently expand a region")
    if previous is None:
        registry["regions"].append({"name": job["name"], "bbox": job["bbox"],
                                    "city": job["adapter"], "description": job["reason"]})
        atomic_json(path, registry)
    return 0 if ingester.ingest(Region(job["name"], BBox(*job["bbox"]), job["reason"]), stages) else 1


if __name__ == "__main__":
    raise SystemExit(main())
