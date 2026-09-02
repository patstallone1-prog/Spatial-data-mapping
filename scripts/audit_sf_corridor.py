#!/usr/bin/env python3
"""Validate the SF corridor metadata catalog."""

from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

import pyarrow.parquet as pq

from smc.imagery.region import SF_CORRIDOR


def main() -> int:
    root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("data/sf_corridor")
    obs_path = root / "observations" / "external-000.parquet"
    seq_path = root / "sequences" / "external.parquet"
    cov_path = root / "coverage" / "h3.parquet"
    observations = pq.read_table(obs_path).to_pylist()
    sequences = pq.read_table(seq_path).to_pylist()
    coverage = pq.read_table(cov_path).to_pylist()
    errors: list[str] = []

    ids = [row["observation_uid"] for row in observations]
    if len(ids) != len(set(ids)):
        errors.append("duplicate observation_uid")
    for row in observations:
        if not SF_CORRIDOR.bbox.contains(row["latitude"], row["longitude"]):
            errors.append(f"outside bbox: {row['observation_uid']}")
        if row["source_locator"] and row["source_locator"].startswith("http"):
            errors.append(f"CDN URL persisted in source_locator: {row['observation_uid']}")
        if row["source_preview_locator"] and row["source_preview_locator"].startswith("http"):
            errors.append(f"CDN URL persisted in source_preview_locator: {row['observation_uid']}")
        if row["original_megapixels"] and row["original_megapixels"] < 2 and row["eligible"]:
            errors.append(f"sub-2MP eligible: {row['observation_uid']}")
        if not row["license_id"]:
            errors.append(f"missing license: {row['observation_uid']}")

    report = {
        "ok": not errors,
        "observations": len(observations),
        "sequences": len(sequences),
        "coverage_cells": len(coverage),
        "providers": dict(Counter(row["provider"] for row in observations)),
        "eligible": sum(1 for row in observations if row["eligible"]),
        "errors": errors[:100],
        "error_count": len(errors),
    }
    out = root / "stats" / "audit.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
