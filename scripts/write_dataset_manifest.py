#!/usr/bin/env python3
"""Describe a catalog directory from what is actually in it.

The manifest used to be a list written by hand, which meant every artefact added downstream --
the depth store, the release shards -- was described only until the next merge overwrote the
file with the list the merge step knew about. A manifest that has to be re-edited after every
run is a manifest that will eventually be wrong, and the whole point of it is to be the thing a
consumer can trust without opening the parquet files.

So it is generated last and it enumerates the directory. If a file is listed here it exists.
"""

from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime
from pathlib import Path

#: Written as prose because these are commitments about the data, not descriptions of it, and
#: they cannot be derived from a directory listing.
STORAGE_POLICY = (
    "metadata in Git; owned capture pixels packed into GitHub Release assets; "
    "no raw provider imagery"
)
CV_DEPTH_POLICY = (
    "metric depth, segmentation, point-cloud artifacts are indexed separately from simulation "
    "surfaces; measured curb heights require metric-depth promotion"
)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog", type=Path, default=Path("data/sf_corridor"))
    parser.add_argument("--title", default="SF street-imagery dense metadata catalog")
    parser.add_argument("--region", default="sf-corridor")
    parser.add_argument("--input", action="append", default=None)
    args = parser.parse_args()

    catalog = args.catalog
    files = sorted(
        str(path.relative_to(catalog))
        for path in catalog.rglob("*")
        if path.is_file() and path.name != "dataset_manifest.json"
    )

    summary_path = catalog / "stats" / "summary.json"
    summary = json.loads(summary_path.read_text(encoding="utf-8")) if summary_path.exists() else {}

    manifest = {
        "title": args.title,
        "generated_at": datetime.now(UTC).isoformat(),
        "region": args.region,
        "storage_policy": STORAGE_POLICY,
        "cv_depth_policy": CV_DEPTH_POLICY,
        "inputs": args.input or [],
        "observations": summary.get("observations"),
        "eligible_observations": summary.get("eligible_observations"),
        "sequences": summary.get("sequences"),
        "coverage_cells": summary.get("coverage_cells"),
        "providers": summary.get("providers"),
        "minimum_megapixels": summary.get("minimum_megapixels"),
        "files": files,
    }
    path = catalog / "dataset_manifest.json"
    path.write_text(json.dumps(manifest, indent=2, default=str) + "\n", encoding="utf-8")
    print(f"{path}: {len(files)} files, {manifest['observations']} observations")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
