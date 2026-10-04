"""Fail closed on Unreal's report, not its potentially-successful process exit code."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

REQUIRED = {"Kerbside.World.CollisionAcceptance", "Kerbside.World.SkyDefaults", "Kerbside.World.WalkerDefaults"}


def validate_report(path: Path) -> dict:
    report = json.loads(path.read_text(encoding="utf-8-sig"))
    results = {test["fullTestPath"]: test for test in report.get("tests", [])}
    missing = REQUIRED - results.keys()
    failed = [name for name in REQUIRED & results.keys()
              if results[name].get("state") != "Success" or results[name].get("errors", 0)]
    if missing or failed or any(report.get(key, 0) for key in ("failed", "notRun", "inProcess")):
        raise ValueError(f"Native acceptance failed/missing: {sorted(missing | set(failed))}")
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report", type=Path, help="Unreal automation index.json")
    args = parser.parse_args()
    report = validate_report(args.report)
    print(f"Native automation passed: {len(REQUIRED)} required tests; {report.get('succeededWithWarnings', 0)} with warnings")


if __name__ == "__main__":
    main()
