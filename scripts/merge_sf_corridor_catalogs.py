#!/usr/bin/env python3
"""Merge bounded SF corridor provider catalogs without exact duplicates."""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path
from dataclasses import fields

import pyarrow.parquet as pq

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from smc.imagery.catalog import write_coverage, write_json, write_observations, write_sequences
from smc.imagery.coverage import assign_cells, build_coverage_rows
from smc.imagery.filtering import INGEST_MIN_MEGAPIXELS, exact_dedupe, mark_eligibility
from smc.imagery.region import get_region
from smc.imagery.schema import Observation, SequenceRecord


OBS_FIELDS = {field.name for field in fields(Observation)}
SEQ_FIELDS = {field.name for field in fields(SequenceRecord)}


def _rows(path: Path, rel: str) -> list[dict]:
    file_path = path / rel
    if not file_path.exists():
        return []
    return pq.read_table(file_path).to_pylist()


def _observation(row: dict) -> Observation:
    return Observation(**{key: row.get(key) for key in OBS_FIELDS})


def _sequence(row: dict) -> SequenceRecord:
    return SequenceRecord(**{key: row.get(key) for key in SEQ_FIELDS})


def _dedupe_sequences(sequences: list[SequenceRecord]) -> list[SequenceRecord]:
    seen: set[str] = set()
    out: list[SequenceRecord] = []
    for sequence in sequences:
        if sequence.sequence_uid in seen:
            continue
        seen.add(sequence.sequence_uid)
        out.append(sequence)
    return out


def _license_rows(path: Path) -> list[dict]:
    if not path.exists():
        return []
    payload = json.loads(path.read_text(encoding="utf-8"))
    rows = payload.get("sources") if isinstance(payload, dict) else payload
    normalized = []
    for row in rows or []:
        if isinstance(row, dict):
            normalized.append(row)
            continue
        provider, instance, license_id, license_url, attribution = (list(row) + [None] * 5)[:5]
        normalized.append(
            {
                "provider": provider,
                "provider_instance": instance,
                "license_id": license_id,
                "license_url": license_url,
                "attribution": attribution,
            }
        )
    return normalized


def _summary(region, sequences, observations, coverage_rows, errors) -> dict:
    eligible = [obs for obs in observations if obs.eligible]
    return {
        "generated_at": datetime.now(UTC).isoformat(),
        "region": {
            "name": region.name,
            "description": region.description,
            "bbox": {
                "north": region.bbox.north,
                "south": region.bbox.south,
                "west": region.bbox.west,
                "east": region.bbox.east,
            },
            "area_sq_mi": round(region.bbox.area_sq_mi, 2),
        },
        "sequences": len(sequences),
        "observations": len(observations),
        "eligible_observations": len(eligible),
        "coverage_cells": len(coverage_rows),
        "providers": dict(Counter(obs.provider for obs in observations)),
        "resolution_tiers": dict(Counter(obs.resolution_tier for obs in observations)),
        "projection_types": dict(Counter(obs.projection_type for obs in observations)),
        "licenses": dict(Counter(obs.license_id for obs in observations)),
        "top_coverage_cells": sorted(
            coverage_rows, key=lambda row: row["coverage_score"], reverse=True
        )[:10],
        "errors": errors[:80],
        "error_count": len(errors),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("catalog", type=Path, nargs="+")
    parser.add_argument("--region", default="sf-corridor")
    parser.add_argument("--out", type=Path, default=Path("data/sf_corridor"))
    parser.add_argument("--h3-resolution", type=int, default=10)
    parser.add_argument("--min-megapixels", type=float, default=INGEST_MIN_MEGAPIXELS,
                        help="Resolution floor applied uniformly to every provider at merge time.")
    args = parser.parse_args()

    region = get_region(args.region)
    observations: list[Observation] = []
    sequences: list[SequenceRecord] = []
    errors: list[str] = []
    seen_errors: set[str] = set()
    source_rows: dict[tuple[str, str, str, str | None, str | None], dict] = {}

    for catalog in args.catalog:
        observations.extend(
            _observation(row) for row in _rows(catalog, "observations/external-000.parquet")
        )
        sequences.extend(_sequence(row) for row in _rows(catalog, "sequences/external.parquet"))
        summary = catalog / "stats" / "summary.json"
        if summary.exists():
            payload = json.loads(summary.read_text(encoding="utf-8"))
            for error in payload.get("errors") or []:
                if error in seen_errors:
                    continue
                seen_errors.add(error)
                errors.append(error)
        sources = catalog / "licenses" / "sources.json"
        for row in _license_rows(sources):
            key = (
                row["provider"],
                row["provider_instance"],
                row["license_id"],
                row.get("license_url"),
                row.get("attribution"),
            )
            source_rows[key] = row

    # Eligibility is re-decided here rather than inherited from whenever each provider was
    # harvested. The floor is a policy about the catalogue as a whole, and a catalogue whose rows
    # were judged against different thresholds on different days cannot be reasoned about --
    # lowering the floor would silently apply to whatever was crawled next and to nothing else.
    for observation in observations:
        mark_eligibility(observation, region, min_megapixels=args.min_megapixels)

    observations = exact_dedupe(observations)
    assign_cells(observations, resolution=args.h3_resolution)
    coverage_rows = build_coverage_rows(observations)
    sequences = _dedupe_sequences(sequences)

    out = args.out
    write_observations(out / "observations" / "external-000.parquet", observations)
    write_sequences(out / "sequences" / "external.parquet", sequences)
    write_coverage(out / "coverage" / "h3.parquet", coverage_rows)
    write_json(
        out / "stats" / "summary.json",
        _summary(region, sequences, observations, coverage_rows, errors),
    )
    write_json(
        out / "dataset_manifest.json",
        {
            "title": "SF street-imagery dense metadata catalog",
            "generated_at": datetime.now(UTC).isoformat(),
            "region": region.name,
            "storage_policy": "metadata-only, no raw provider imagery",
            "inputs": [str(path) for path in args.catalog],
            "files": [
                "observations/external-000.parquet",
                "sequences/external.parquet",
                "coverage/h3.parquet",
                "licenses/sources.json",
                "stats/summary.json",
            ],
        },
    )
    write_json(
        out / "licenses" / "sources.json",
        [
            {
                "provider": provider,
                "provider_instance": instance,
                "license_id": license_id,
                "license_url": license_url,
                "attribution": attribution,
            }
            for provider, instance, license_id, license_url, attribution in sorted(source_rows)
        ],
    )
    print(json.dumps(_summary(region, sequences, observations, coverage_rows, errors), indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
