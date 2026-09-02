#!/usr/bin/env python3
"""Build the first bounded SF street-imagery metadata catalog.

The catalog stores provider metadata only. Source imagery is resolved and fetched
later, only when a reconstruction stage explicitly asks for pixels.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path
from typing import Iterable

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from smc.imagery.catalog import write_coverage, write_json, write_observations, write_sequences
from smc.imagery.coverage import assign_cells, build_coverage_rows
from smc.imagery.filtering import exact_dedupe, mark_eligibility
from smc.imagery.http import HttpClient
from smc.imagery.kartaview import KartaViewProvider
from smc.imagery.panoramax import PanoramaxProvider
from smc.imagery.region import Region, get_region
from smc.imagery.schema import Observation, SequenceRecord


def provider_by_name(
    name: str,
    *,
    kartaview_discovery_step_m: float = 300.0,
    kartaview_max_photo_pages: int | None = 12,
):
    if name == "panoramax":
        return PanoramaxProvider(client=HttpClient(timeout_s=20, max_attempts=2))
    if name == "kartaview":
        return KartaViewProvider(
            client=HttpClient(timeout_s=8, max_attempts=1),
            discovery_step_m=kartaview_discovery_step_m,
            max_photo_pages=kartaview_max_photo_pages,
        )
    raise ValueError(f"unknown provider {name!r}")


def bounded_sequences(
    provider,
    region: Region,
    *,
    max_sequences: int | None,
) -> Iterable[SequenceRecord]:
    count = 0
    for sequence in provider.discover_sequences(region):
        yield sequence
        count += 1
        if max_sequences is not None and count >= max_sequences:
            break


def collect_provider(
    provider_name: str,
    region: Region,
    max_sequences: int | None,
    *,
    min_megapixels: float,
    kartaview_discovery_step_m: float,
    kartaview_max_photo_pages: int | None,
) -> tuple[
    list[SequenceRecord], list[Observation], list[str]
]:
    provider = provider_by_name(
        provider_name,
        kartaview_discovery_step_m=kartaview_discovery_step_m,
        kartaview_max_photo_pages=kartaview_max_photo_pages,
    )
    sequences: list[SequenceRecord] = []
    observations: list[Observation] = []
    errors: list[str] = []
    for sequence in bounded_sequences(provider, region, max_sequences=max_sequences):
        sequences.append(sequence)
        try:
            for observation in provider.iter_observations(sequence.provider_sequence_id):
                if not region.bbox.contains(observation.latitude, observation.longitude):
                    continue
                observation.source_locator = (
                    f"{observation.provider}://{observation.provider_instance}/"
                    f"{observation.provider_sequence_id}/{observation.provider_image_id}"
                )
                observation.source_preview_locator = None
                observations.append(
                    mark_eligibility(observation, region, min_megapixels=min_megapixels)
                )
        except Exception as exc:  # noqa: BLE001 - external APIs fail in colorful ways.
            errors.append(f"{provider_name}:{sequence.provider_sequence_id}: {exc}")
    errors.extend(getattr(provider, "errors", []))
    return sequences, observations, errors


def summary(
    *,
    region: Region,
    sequences: list[SequenceRecord],
    observations: list[Observation],
    coverage_rows: list[dict],
    errors: list[str],
) -> dict:
    providers = Counter(o.provider for o in observations)
    tiers = Counter(o.resolution_tier for o in observations)
    projections = Counter(o.projection_type for o in observations)
    licenses = Counter(o.license_id for o in observations)
    eligible = [o for o in observations if o.eligible]
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
        "providers": dict(providers),
        "resolution_tiers": dict(tiers),
        "projection_types": dict(projections),
        "licenses": dict(licenses),
        "top_coverage_cells": sorted(
            coverage_rows, key=lambda row: row["coverage_score"], reverse=True
        )[:10],
        "errors": errors[:50],
        "error_count": len(errors),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--region", default="sf-corridor")
    parser.add_argument("--out", type=Path, default=Path("data/sf_corridor"))
    parser.add_argument("--provider", action="append", choices=("panoramax", "kartaview"))
    parser.add_argument("--max-sequences", type=int, default=18)
    parser.add_argument("--h3-resolution", type=int, default=10)
    parser.add_argument(
        "--min-megapixels",
        type=float,
        default=2.0,
        help=(
            "Reject observations below this source-resolution floor. "
            "The default stays above Meta DAT 1440x1080 delivery."
        ),
    )
    parser.add_argument(
        "--kartaview-discovery-step-m",
        type=float,
        default=300.0,
        help="Grid spacing for KartaView nearby-photo sequence discovery.",
    )
    parser.add_argument(
        "--kartaview-max-photo-pages",
        type=int,
        default=12,
        help="Maximum KartaView photo pages per sequence; use 0 for every available page.",
    )
    args = parser.parse_args()

    region = get_region(args.region)
    providers = args.provider or ["panoramax", "kartaview"]
    max_sequences = args.max_sequences if args.max_sequences > 0 else None
    kartaview_max_photo_pages = (
        args.kartaview_max_photo_pages if args.kartaview_max_photo_pages > 0 else None
    )

    sequences: list[SequenceRecord] = []
    observations: list[Observation] = []
    errors: list[str] = []
    for provider_name in providers:
        ps, po, pe = collect_provider(
            provider_name,
            region,
            max_sequences,
            min_megapixels=args.min_megapixels,
            kartaview_discovery_step_m=args.kartaview_discovery_step_m,
            kartaview_max_photo_pages=kartaview_max_photo_pages,
        )
        sequences.extend(ps)
        observations.extend(po)
        errors.extend(pe)
        print(f"{provider_name}: {len(ps)} sequences, {len(po)} in-region observations")

    observations = exact_dedupe(observations)
    assign_cells(observations, resolution=args.h3_resolution)
    coverage_rows = build_coverage_rows(observations)

    out = args.out
    write_observations(out / "observations" / "external-000.parquet", observations)
    write_sequences(out / "sequences" / "external.parquet", sequences)
    write_coverage(out / "coverage" / "h3.parquet", coverage_rows)
    write_json(out / "stats" / "summary.json", summary(
        region=region,
        sequences=sequences,
        observations=observations,
        coverage_rows=coverage_rows,
        errors=errors,
    ))
    write_json(out / "licenses" / "sources.json", {
        "sources": sorted(
            {
                (
                    o.provider,
                    o.provider_instance,
                    o.license_id,
                    o.license_url,
                    o.attribution,
                )
                for o in observations
            }
        )
    })
    write_json(out / "dataset_manifest.json", {
        "name": "Kerbside SF corridor street-imagery metadata seed",
        "generated_at": datetime.now(UTC).isoformat(),
        "region": region.name,
        "providers": providers,
        "normalization": "meta-pixel-budget, applied only during ephemeral pixel fetch",
        "source_imagery_committed": False,
        "files": [
            "observations/external-000.parquet",
            "sequences/external.parquet",
            "coverage/h3.parquet",
            "licenses/sources.json",
            "stats/summary.json",
        ],
    })
    print(json.dumps(summary(
        region=region,
        sequences=sequences,
        observations=observations,
        coverage_rows=coverage_rows,
        errors=errors,
    ), indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
