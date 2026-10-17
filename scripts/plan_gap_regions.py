#!/usr/bin/env python3
"""Generate dormant bounded jobs, never intake. Activation is a separate explicit operation."""
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from smc.imagery.streetview_reference import atomic_json  # noqa: E402
from smc.regions.gaps import plan_gaps  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cell-km", type=float, default=2.5)
    parser.add_argument("--output", type=Path, default=ROOT / "data/regions/gap-plan.json")
    args = parser.parse_args()
    plan = plan_gaps(json.loads((ROOT / "data/regions/gap-regions.json").read_text()),
                     json.loads((ROOT / "docs/app-regions.json").read_text())["regions"], args.cell_km)
    atomic_json(args.output, plan)
    print(f"{len(plan['jobs'])} dormant jobs, {plan['area_km2']:.1f} km2 planning envelope; NO intake started")


if __name__ == "__main__":
    main()
