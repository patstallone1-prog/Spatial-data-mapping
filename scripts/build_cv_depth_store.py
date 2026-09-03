#!/usr/bin/env python3
"""Build CV/depth storage indexes and simulation surface rows for a catalog."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from smc.depth.storage import write_depth_observations, write_json, write_surfaces  # noqa: E402
from smc.depth.surfaces import (  # noqa: E402
    build_depth_observation_rows,
    build_surface_rows,
    measured_surface_rows_from_cross_section,
    read_coverage_rows,
    read_observation_rows,
    summarize_depth_store,
)


def _measured_rows(journal: Path, coverage: list, *, run_id: str) -> tuple[list, int]:
    """Promote journalled lidar sections into measured surface rows.

    The journal records every footway that was attempted, including those where no kerb could be
    resolved -- those carry a null station and are counted but produce no row. That is the point
    of writing them down: a footway absent from the measured set because the sensor could not see
    its kerb has to be distinguishable from one nobody has looked at yet.
    """
    by_cell = {row["coverage_cell"]: row for row in coverage}
    rows: list = []
    footways: set[str] = set()
    for line in journal.read_text().splitlines():
        if not line.strip():
            continue
        entry = json.loads(line)
        footways.add(entry["footway_id"])
        if entry.get("station_m") is None:
            continue
        cell = by_cell.get(entry["h3_cell"], {})
        section = SimpleNamespace(
            station_m=entry["station_m"],
            ok=True,
            kerb=SimpleNamespace(
                height_m=entry["curb_height_m"], sigma_m=entry["curb_height_sigma_m"]
            ),
            sidewalk=SimpleNamespace(
                width_m=entry["sidewalk_width_m"],
                width_sigma_m=entry["sidewalk_width_sigma_m"],
                cross_slope=entry["cross_slope"],
                cross_slope_sigma=entry["cross_slope_sigma"],
            ),
            flags=tuple(entry.get("flags") or ()) + ("aerial_lidar",),
        )
        rows.extend(
            measured_surface_rows_from_cross_section(
                section,
                feature_id=entry["footway_id"],
                lat=entry["lat"],
                lon=entry["lon"],
                h3_cell=entry["h3_cell"],
                run_id=run_id,
                observation_count=int(cell.get("eligible_observations") or 0),
                provider_count=int(cell.get("unique_providers") or 0),
                coverage_score=cell.get("coverage_score"),
                height_source="aerial_lidar_3dep",
            )
        )
    return rows, len(footways)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog", type=Path, default=Path("data/sf_corridor"))
    parser.add_argument("--osm-cache", type=Path, default=Path("data/sf_corridor/stats/osm_ways.json"))
    parser.add_argument(
        "--out",
        type=Path,
        default=None,
        help="Where to write the depth store. Defaults to <catalog>/depth.",
    )
    parser.add_argument(
        "--lidar-journal",
        type=Path,
        default=None,
        help=(
            "Measured kerb sections from scripts/measure_curbs_lidar.py. "
            "Defaults to <catalog>/depth/lidar/curb_sections.jsonl when it exists."
        ),
    )
    parser.add_argument("--run-id", default="sf-corridor-depth-seed")
    parser.add_argument("--h3-resolution", type=int, default=10)
    args = parser.parse_args()

    # Following the catalog rather than a fixed path: a run pointed at a scratch catalog that
    # still wrote into the committed one would overwrite real artefacts with test output, and
    # the two are indistinguishable afterwards.
    out = args.out or args.catalog / "depth"

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
    journal = args.lidar_journal or args.catalog / "depth" / "lidar" / "curb_sections.jsonl"
    if journal.exists():
        measured, attempted = _measured_rows(journal, coverage, run_id=args.run_id)
        # Measured rows replace the default-valued curb rows for the same place rather than
        # sitting beside them. Two curb heights in one cell, one of them a guess, is worse than
        # either alone: a consumer has no way to know which to believe.
        superseded = {row["h3_cell"] for row in measured}
        surface_rows = [
            row
            for row in surface_rows
            if not (row["surface_type"] == "curb_edge" and row["h3_cell"] in superseded)
        ]
        surface_rows.extend(measured)
        print(
            f"lidar: {len(measured)} measured surfaces from {attempted} footways "
            f"across {len(superseded)} cells",
            file=sys.stderr,
        )

    summary = summarize_depth_store(
        observations,
        depth_rows,
        surface_rows,
        run_id=args.run_id,
    )

    write_depth_observations(out / "observations" / "depth_index.parquet", depth_rows)
    write_surfaces(out / "surfaces" / "surface_measurements.parquet", surface_rows)
    write_json(out / "runs" / f"{args.run_id}.json", summary)
    write_json(out / "stats" / "summary.json", summary)

    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

