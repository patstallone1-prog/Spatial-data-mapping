#!/usr/bin/env python3
"""Fail closed when publishing optional visual cells.

Routine canonical builds are allowed without visual cells. Once a visual pilot is
present under docs/, it must satisfy the same evidence gate on every build.
"""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from smc.reconstruction.quality import evaluate_promotion  # noqa: E402
from smc.reconstruction.workflow import validate_pilot_output  # noqa: E402


def check_pilot(pilot: Path) -> None:
    canonical = ROOT / "docs/sf-corridor-3d.json"
    benchmark = ROOT / "data/reconstruction/pilot_benchmark.json"
    validate_pilot_output(pilot, canonical, benchmark)
    failures = evaluate_promotion(pilot, benchmark, pilot / "quality_metrics.json")
    if failures:
        raise ValueError("visual pilot is not publishable:\n- " + "\n- ".join(failures))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--publish", action="store_true", help="copy a fully promoted pilot into docs")
    parser.add_argument("--source", type=Path, default=ROOT / "build/visual/pilot")
    parser.add_argument("--destination", type=Path, default=ROOT / "docs/visual/pilot")
    args = parser.parse_args()
    if args.publish:
        check_pilot(args.source)
        if args.destination.exists():
            raise FileExistsError(f"refusing to overwrite published cells: {args.destination}")
        args.destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(args.source, args.destination)
        check_pilot(args.destination)
        print(f"published verified visual pilot: {args.destination}")
    elif args.destination.exists():
        check_pilot(args.destination)
        print(f"published visual pilot passes: {args.destination}")
    else:
        print("no visual pilot published; canonical/procedural renderer remains active")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
