"""Run a recorded test plan without a shell, glob expansion or an empty pytest invocation."""

from __future__ import annotations

import argparse
import importlib.util
import json
import subprocess
import sys
from pathlib import Path

#: From this many test files the plan runs on every core (pytest-xdist, a file per worker:
#: tests in one file share module fixtures). The whole suite passed this way, 2,318 tests in
#: 2 min 54 s against about 16 min one at a time (2026-11-02); a few files gain nothing.
PARALLEL_FROM = 4


def parallel(paths: list[str]) -> list[str]:
    if len(paths) < PARALLEL_FROM or importlib.util.find_spec("xdist") is None:
        return []
    return ["-n", "auto", "--dist", "loadfile"]


def commands(plan: dict, kind: str, prefix: str = "") -> list[list[str]]:
    if (
        plan.get("schema") != "kerbside.ci_test_plan/1"
        or plan.get("uncovered")
        or plan.get("syntax_errors")
    ):
        raise ValueError("invalid or incomplete test plan")
    paths = plan.get(kind, [])
    if not isinstance(paths, list) or any(
        not isinstance(p, str)
        or p.startswith("-")
        or ".." in Path(p).parts
        or Path(p).is_absolute()
        for p in paths
    ):
        raise ValueError("invalid test paths")
    paths = [p for p in paths if p.startswith(prefix)]
    if kind == "python":
        return [[sys.executable, "-m", "pytest", "-q", *parallel(paths), *paths]] if paths else []
    if kind == "node":
        return [["node", "--test", *paths]] if paths else []
    if kind == "lint":
        return (
            [["ruff", "check", *paths, "--ignore", "E501", "--output-format", "github"]]
            if paths
            else []
        )
    raise ValueError("unknown plan section")


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--plan", type=Path, required=True)
    p.add_argument("--kind", choices=["python", "node", "lint"], required=True)
    p.add_argument(
        "--prefix", default="", help="Optional test-module prefix inside a container image"
    )
    args = p.parse_args(argv)
    plan = json.loads(args.plan.read_text())
    cmds = commands(plan, args.kind, args.prefix)
    if not cmds:
        print(f"No affected {args.kind} modules; no tests launched.")
    for command in cmds:
        subprocess.run(command, check=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
