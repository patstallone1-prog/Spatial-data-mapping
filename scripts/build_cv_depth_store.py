#!/usr/bin/env python3
"""Build CV/depth storage indexes and simulation surface rows for a catalog."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from smc.depth.storage import write_depth_observations, write_json, write_surfaces  # noqa: E402
from smc.depth.surfaces import (  # noqa: E402
    build_depth_observation_rows,
    build_surface_rows,
    read_coverage_rows,
    read_observation_rows,
    summarize_depth_store,
)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog", type=Path, default=Path("data/sf_corridor"))
    parser.add_argument("--osm-cache", type=Path, default=Path("data/sf_corridor/stats/osm_ways.json"))
    parser.add_argument("--out", type=Path, default=Path("data/sf_corridor/depth"))
    parser.add_argument("--run-id", default="sf-corridor-depth-seed")
    parser.add_argument("--h3-resolution", type=int, default=10)
    args = parser.parse_args()

    observations = read_observation_rows(args.catalog)
    coverage = read_coverage_rows(args.catalog)
    ways = json.loads(args.osm_cache.read_text(encoding="utf-8"))
    depth_rows = build_depth_observation_rows(observations, run_id=args.run_id)
    surface_rows = build_surface_rows(
        ways,
        coverage,
        run_id=args.run_id,
        h3_resolution=args.h3_resolution,
    )
    summary = summarize_depth_store(
        observations,
        depth_rows,
        surface_rows,
        run_id=args.run_id,
    )

    write_depth_observations(args.out / "observations" / "depth_index.parquet", depth_rows)
    write_surfaces(args.out / "surfaces" / "surface_measurements.parquet", surface_rows)
    write_json(args.out / "runs" / f"{args.run_id}.json", summary)
    write_json(args.out / "stats" / "summary.json", summary)

    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

