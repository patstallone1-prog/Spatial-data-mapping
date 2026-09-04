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
from dataclasses import asdict, fields as dataclass_fields
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
from smc.imagery.mapillary import MapillaryProvider  # noqa: E402
from smc.imagery.panoramax import PanoramaxProvider  # noqa: E402
from smc.imagery.region import Region, get_region  # noqa: E402
from smc.imagery.schema import Observation, SequenceRecord  # noqa: E402


def build_provider(name: str, *, kartaview_step_m: float, workers: int):
    if name == "panoramax":
        # Generous timeout: a search tile at the top of the subdivision returns thousands of
        # whole STAC items, and cutting it short is what forces the needless subdividing below.
        return PanoramaxProvider(client=HttpClient(timeout_s=60, max_attempts=3))
    if name == "mapillary":
        # Larger pages than the others because a Mapillary page is a cursor step rather than a
        # box split, so a bigger page means fewer round trips and no reconciliation.
        return MapillaryProvider(client=HttpClient(timeout_s=60, max_attempts=3))
    if name == "kartaview":
        return KartaViewProvider(
            client=HttpClient(timeout_s=30, max_attempts=3),
            discovery_step_m=kartaview_step_m,
            max_workers=workers,
        )
    raise ValueError(f"unknown provider {name!r}")


#: Observations are appended to a journal this often. A corridor harvest runs for tens of
#: minutes against a service that can drop a connection at any point, and a run that keeps
#: everything in memory until the last line turns any interruption into total loss -- which is
#: exactly what happened twice here before this existed. The journal is JSON Lines because it can
#: be appended to and flushed; parquet cannot.
CHECKPOINT_EVERY = 2000


def _journal_path(out: Path) -> Path:
    return out / "observations" / "journal.jsonl"


def _write_journal(handle, observations: list[Observation]) -> None:
    for observation in observations:
        handle.write(json.dumps(asdict(observation), default=str) + "\n")
    handle.flush()


def read_journal(out: Path) -> list[Observation]:
    """Whatever a previous run got as far as writing."""
    path = _journal_path(out)
    if not path.exists():
        return []
    # Datetimes go out through json's ``default=str`` and come back as strings, so they have to
    # be parsed or every downstream consumer that does date arithmetic fails on a str. Which
    # fields those are is taken from the dataclass rather than listed here, so a new timestamp
    # field cannot quietly arrive without being handled.
    fields = {f.name: f.type for f in dataclass_fields(Observation)}
    stamps = {name for name, kind in fields.items() if "datetime" in str(kind)}

    def revive(name: str, value):
        if name in stamps and isinstance(value, str) and value:
            try:
                return datetime.fromisoformat(value)
            except ValueError:
                return None
        return value

    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        raw = json.loads(line)
        rows.append(Observation(**{k: revive(k, v) for k, v in raw.items() if k in fields}))
    return rows


def collect(
    provider_name: str,
    region: Region,
    *,
    min_megapixels: float,
    kartaview_step_m: float,
    workers: int,
    progress,
    journal=None,
) -> tuple[list[SequenceRecord], list[Observation], list[str]]:
    provider = build_provider(provider_name, kartaview_step_m=kartaview_step_m, workers=workers)
    observations: list[Observation] = []
    unsaved: list[Observation] = []

    for observation in provider.iter_region_observations(region, progress=progress):
        # The catalogue stores where a frame lives, not a URL that expires. Provider CDN links
        # rotate; the locator stays resolvable through the provider's own API.
        observation.source_locator = (
            f"{observation.provider}://{observation.provider_instance}/"
            f"{observation.provider_sequence_id}/{observation.provider_image_id}"
        )
        observation.source_preview_locator = None
        observations.append(mark_eligibility(observation, region, min_megapixels=min_megapixels))
        if journal is not None:
            unsaved.append(observations[-1])
            if len(unsaved) >= CHECKPOINT_EVERY:
                _write_journal(journal, unsaved)
                progress(f"{provider_name}: journalled {len(observations)} frames")
                unsaved = []
    if journal is not None and unsaved:
        _write_journal(journal, unsaved)

    cache = getattr(provider, "_collection_cache", None)
    if cache is None:
        cache = getattr(provider, "_sequence_cache", {})
    sequences = [record for record in cache.values() if record is not None]
    return sequences, observations, list(getattr(provider, "errors", []))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--region", default="sf-corridor")
    parser.add_argument("--out", type=Path, default=Path("data/sf_corridor_dense"))
    parser.add_argument("--provider", action="append", choices=("panoramax", "kartaview", "mapillary"))
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
    parser.add_argument(
        "--from-journal",
        action="store_true",
        help=(
            "Skip the crawl and build the catalog from whatever the journal already holds. "
            "For finishing a harvest that was interrupted, without re-fetching it."
        ),
    )
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args()

    def progress(message: str) -> None:
        if not args.quiet:
            print(f"  {message}", flush=True)

    region = get_region(args.region)
    out = args.out
    providers = args.provider or ["panoramax", "kartaview", "mapillary"]

    sequences: list[SequenceRecord] = []
    observations: list[Observation] = []
    errors: list[str] = []
    for provider_name in providers:
        if args.from_journal:
            break
        print(f"{provider_name}: sweeping {region.name}", flush=True)
        journal_path = _journal_path(out)
        journal_path.parent.mkdir(parents=True, exist_ok=True)
        with journal_path.open("a") as journal:
            ps, po, pe = collect(
                provider_name,
                region,
                min_megapixels=args.min_megapixels,
                kartaview_step_m=args.kartaview_step_m,
                workers=args.workers,
                progress=progress,
                journal=journal,
            )
        kept = sum(1 for o in po if o.eligible)
        print(
            f"{provider_name}: {len(ps)} sequences, {len(po)} in-region frames, {kept} eligible",
            flush=True,
        )
        sequences.extend(ps)
        observations.extend(po)
        errors.extend(pe)

    # Anything a previous run journalled joins the fresh rows before deduplication, so an
    # interrupted harvest contributes what it did reach rather than being thrown away. The
    # dedupe is by provider image id, so a frame seen in both passes collapses to one row.
    recovered = read_journal(out)
    if recovered:
        print(f"recovered {len(recovered)} observations from an earlier run's journal", flush=True)
        observations = recovered + observations

    observations = exact_dedupe(observations)
    assign_cells(observations, resolution=args.h3_resolution)
    coverage_rows = build_coverage_rows(observations)

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
