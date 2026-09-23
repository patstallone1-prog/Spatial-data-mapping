#!/usr/bin/env python3
"""Check pilot assets; --require-promotion is the publishing gate."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from smc.reconstruction.quality import evaluate_promotion  # noqa: E402
from smc.reconstruction.workflow import validate_pilot_output  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", type=Path, default=ROOT / "build/visual/pilot")
    ap.add_argument("--metrics", type=Path, default=ROOT / "build/visual/pilot/quality_metrics.json")
    ap.add_argument("--require-promotion", action="store_true")
    args = ap.parse_args()
    benchmark = ROOT / "data/reconstruction/pilot_benchmark.json"
    if not args.out.exists() and not args.require_promotion:
        print("visual pilot has not been built; no detail will be published")
        return 0
    summary = validate_pilot_output(args.out, ROOT / "docs/sf-corridor-3d.json", benchmark)
    failures = evaluate_promotion(args.out, benchmark, args.metrics)
    print(json.dumps({**summary, "promotion_failures": failures}, indent=2))
    if args.require_promotion and failures:
        return 1
    if summary["promoted"] and failures:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
