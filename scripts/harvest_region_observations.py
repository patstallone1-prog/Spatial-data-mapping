#!/usr/bin/env python3
"""Every observation both providers hold inside a region, at usable resolution.

Ingestion up to now has been sequence-shaped: find the sequences that touch the region, then
read each one whole. For a bounded region that is the wrong shape. A KartaView sequence is a
whole drive, routinely across a city, so reading it whole spends almost every request on frames
outside the box -- and the run hits its page cap long before the neighbourhoods are covered.
The 249 KartaView frames in the previous catalogue came from three sequences read that way.

This pass inverts it. Both archives can answer "what is at this place", so that is what it asks:

* Panoramax's ``/search`` returns whole STAC items for a box, so the result that finds a frame
  already describes it. Nothing further is fetched per frame.
* KartaView's nearby-photos locates frames but returns no width or height, so resolution is
  bought in a second pass -- a hundred known ids per request, never guessed from a sibling.

What survives is filtered on facts rather than estimates: inside the box, a real image id, not
withdrawn by the provider, and no smaller than the glasses' own delivered frame.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "scripts"))

from ingest_sf_corridor import summary  # noqa: E402

from smc.imagery.catalog import (  # noqa: E402
    write_coverage,
    write_json,
    write_observations,
    write_sequences,
)
from smc.imagery.coverage import assign_cells, build_coverage_rows  # noqa: E402
from smc.imagery.filtering import META_DELIVERY_MEGAPIXELS, exact_dedupe, mark_eligibility  # noqa: E402
from smc.imagery.http import HttpClient  # noqa: E402
from smc.imagery.kartaview import KartaViewProvider  # noqa: E402
from smc.imagery.panoramax import PanoramaxProvider  # noqa: E402
from smc.imagery.region import Region, get_region  # noqa: E402
from smc.imagery.schema import Observation, SequenceRecord  # noqa: E402


def build_provider(name: str, *, kartaview_step_m: float, workers: int):
    if name == "panoramax":
        # Generous timeout: a search tile at the top of the subdivision returns thousands of
        # whole STAC items, and cutting it short is what forces the needless subdividing below.
        return PanoramaxProvider(client=HttpClient(timeout_s=60, max_attempts=3))
    if name == "kartaview":
        return KartaViewProvider(
            client=HttpClient(timeout_s=30, max_attempts=3),
            discovery_step_m=kartaview_step_m,
            max_workers=workers,
        )
    raise ValueError(f"unknown provider {name!r}")


def collect(
    provider_name: str,
    region: Region,
    *,
    min_megapixels: float,
    kartaview_step_m: float,
    workers: int,
    progress,
) -> tuple[list[SequenceRecord], list[Observation], list[str]]:
    provider = build_provider(provider_name, kartaview_step_m=kartaview_step_m, workers=workers)
    observations: list[Observation] = []

    for observation in provider.iter_region_observations(region, progress=progress):
        # The catalogue stores where a frame lives, not a URL that expires. Provider CDN links
        # rotate; the locator stays resolvable through the provider's own API.
        observation.source_locator = (
            f"{observation.provider}://{observation.provider_instance}/"
            f"{observation.provider_sequence_id}/{observation.provider_image_id}"
        )
        observation.source_preview_locator = None
        observations.append(mark_eligibility(observation, region, min_megapixels=min_megapixels))

    cache = getattr(provider, "_collection_cache", None)
    if cache is None:
        cache = getattr(provider, "_sequence_cache", {})
    sequences = [record for record in cache.values() if record is not None]
    return sequences, observations, list(getattr(provider, "errors", []))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--region", default="sf-corridor")
    parser.add_argument("--out", type=Path, default=Path("data/sf_corridor_dense"))
    parser.add_argument("--provider", action="append", choices=("panoramax", "kartaview"))
    parser.add_argument("--h3-resolution", type=int, default=10)
    parser.add_argument(
        "--min-megapixels",
        type=float,
        default=META_DELIVERY_MEGAPIXELS,
        help=(
            "Reject observations below this source resolution. The default is what the Meta "
            "glasses themselves deliver, 1440x1080; anything smaller cannot be reduced to match "
            "a wearer's frame because it is already smaller."
        ),
    )
    parser.add_argument(
        "--kartaview-step-m",
        type=float,
        default=150.0,
        help="Grid spacing for the KartaView nearby-photos sweep. The radius is 0.8x the step.",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=6,
        help=(
            "Concurrent KartaView requests. Each worker gets its own client, so the polite "
            "minimum interval still holds per connection."
        ),
    )
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args()

    def progress(message: str) -> None:
        if not args.quiet:
            print(f"  {message}", flush=True)

    region = get_region(args.region)
    providers = args.provider or ["panoramax", "kartaview"]

    sequences: list[SequenceRecord] = []
    observations: list[Observation] = []
    errors: list[str] = []
    for provider_name in providers:
        print(f"{provider_name}: sweeping {region.name}", flush=True)
        ps, po, pe = collect(
            provider_name,
            region,
            min_megapixels=args.min_megapixels,
            kartaview_step_m=args.kartaview_step_m,
            workers=args.workers,
            progress=progress,
        )
        kept = sum(1 for o in po if o.eligible)
        print(
            f"{provider_name}: {len(ps)} sequences, {len(po)} in-region frames, {kept} eligible",
            flush=True,
        )
        sequences.extend(ps)
        observations.extend(po)
        errors.extend(pe)

    observations = exact_dedupe(observations)
    assign_cells(observations, resolution=args.h3_resolution)
    coverage_rows = build_coverage_rows(observations)

    out = args.out
    write_observations(out / "observations" / "external-000.parquet", observations)
    write_sequences(out / "sequences" / "external.parquet", sequences)
    write_coverage(out / "coverage" / "h3.parquet", coverage_rows)
    stats = summary(
        region=region,
        sequences=sequences,
        observations=observations,
        coverage_rows=coverage_rows,
        errors=errors,
    )
    stats["minimum_megapixels"] = args.min_megapixels
    write_json(out / "stats" / "summary.json", stats)
    write_json(
        out / "licenses" / "sources.json",
        {
            "sources": sorted(
                {
                    (o.provider, o.provider_instance, o.license_id, o.license_url, o.attribution)
                    for o in observations
                }
            )
        },
    )
    write_json(
        out / "dataset_manifest.json",
        {
            "name": "Kerbside dense street-imagery metadata sweep",
            "generated_at": datetime.now(UTC).isoformat(),
            "region": region.name,
            "providers": providers,
            "discovery": "place-shaped: every frame the providers report inside the box",
            "minimum_megapixels": args.min_megapixels,
            "normalization": "meta-pixel-budget, applied only during ephemeral pixel fetch",
            "source_imagery_committed": False,
            "files": [
                "observations/external-000.parquet",
                "sequences/external.parquet",
                "coverage/h3.parquet",
                "licenses/sources.json",
                "stats/summary.json",
            ],
        },
    )
    print(
        json.dumps(
            {k: v for k, v in stats.items() if k != "top_coverage_cells"}, indent=2, default=str
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
