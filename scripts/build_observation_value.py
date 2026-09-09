#!/usr/bin/env python3
"""B8 -- rank the catalogue by what each frame can contribute, not by its sensor.

Everything the previous seven passes worked out about a photograph lives in a different file,
keyed by ``observation_uid`` and joined by nothing. This is the join, and the ranking that comes
out of it.

  B3  enrichment-000    street, side, station, official cross-section
  B4  pairs-000         partners, baselines, parallax
  B5  lidar_depth-000   metric depth for 15,246 frames
  B6  pose-000          refined position and its uncertainty
  B7  semantics-000     what is actually in the frame

The output is one row per observation carrying the nine components of
:mod:`smc.enrich.value`, the scalar they combine into, how much of that scalar was measured
rather than defaulted, and the single component holding the frame back. That last column is the
useful one: it turns "this frame scores 0.31" into "this frame is worth little because nothing
is standing near enough to triangulate it against", which is something a capture policy can act
on -- and B9 does.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

import pyarrow as pa  # noqa: E402
import pyarrow.parquet as pq  # noqa: E402

from smc.enrich.value import COMPONENTS, WEIGHTS, build_value  # noqa: E402

CATALOG = ROOT / "data" / "sf_corridor" / "observations" / "external-000.parquet"
ENRICH = ROOT / "data" / "observation_enrichment"
OUT = ENRICH / "value-000.parquet"
SUMMARY = ENRICH / "value_summary.json"

SCHEMA = pa.schema(
    [("observation_uid", pa.string()), ("provider", pa.string())]
    + [(name, pa.float32()) for name in COMPONENTS]
    + [("value", pa.float32()), ("confidence", pa.float32()),
       ("limiting_factor", pa.string()), ("resolution_tier", pa.string()),
       ("eligible", pa.bool_())]
)


def index_by_uid(path: Path, columns: list[str]) -> dict[str, dict]:
    """One enrichment table as a lookup, reading only the columns that are used."""
    if not path.exists():
        return {}
    table = pq.read_table(path, columns=columns)
    rows = table.to_pylist()
    return {row["observation_uid"]: row for row in rows}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--catalog", type=Path, default=CATALOG)
    ap.add_argument("--out", type=Path, default=OUT)
    args = ap.parse_args()

    def say(message: str) -> None:
        print(message, flush=True)

    if not args.catalog.exists():
        say(f"{args.catalog} is missing; run the harvest first")
        return 2

    semantics = index_by_uid(ENRICH / "semantics-000.parquet",
                             ["observation_uid", "kerb_value", "facade_value", "road_value",
                              "occlusion"])
    say(f"semantics: {len(semantics)}")
    pairs = index_by_uid(ENRICH / "pairs-000.parquet",
                         ["observation_uid", "n_baseline_1_to_3m", "geometry_baseline_m",
                          "geometry_parallax_deg"])
    say(f"pairs: {len(pairs)}")
    pose = index_by_uid(ENRICH / "pose-000.parquet", ["observation_uid", "position_sigma_m"])
    say(f"pose: {len(pose)}")
    lidar = index_by_uid(ENRICH / "lidar_depth-000.parquet",
                         ["observation_uid", "image_coverage"])
    say(f"lidar: {len(lidar)}")
    context = index_by_uid(ENRICH / "enrichment-000.parquet",
                           ["observation_uid", "segment_id", "street_side", "station_m"])
    say(f"context: {len(context)}")

    catalog = pq.read_table(args.catalog,
                            columns=["observation_uid", "provider", "original_megapixels",
                                     "eligible", "resolution_tier"])
    say(f"catalogue: {catalog.num_rows}")

    columns: dict[str, list] = {name: [] for name in SCHEMA.names}
    limiting = Counter()
    tier_value: dict[str, list[float]] = {}
    values: list[float] = []
    covered = Counter()

    for row in catalog.to_pylist():
        uid = row["observation_uid"]
        vector = build_value(
            uid,
            semantics=semantics.get(uid),
            pairs=pairs.get(uid),
            pose=pose.get(uid),
            lidar=lidar.get(uid),
            context=context.get(uid),
            megapixels=row.get("original_megapixels"),
            eligible=bool(row.get("eligible")),
        )
        scalar = vector.scalar()
        limit = vector.limiting_factor()
        limiting[limit] += 1
        values.append(scalar)
        tier_value.setdefault(row.get("resolution_tier") or "unknown", []).append(scalar)
        for name in vector.known:
            covered[name] += 1

        columns["observation_uid"].append(uid)
        columns["provider"].append(row.get("provider"))
        for name in COMPONENTS:
            columns[name].append(float(getattr(vector, name)))
        columns["value"].append(float(scalar))
        columns["confidence"].append(float(vector.confidence()))
        columns["limiting_factor"].append(limit)
        columns["resolution_tier"].append(row.get("resolution_tier"))
        columns["eligible"].append(bool(row.get("eligible")))

    table = pa.table({name: pa.array(columns[name], type=SCHEMA.field(name).type)
                      for name in SCHEMA.names}, schema=SCHEMA)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(table, args.out, compression="zstd")

    ordered = sorted(values)
    def at(fraction: float) -> float:
        return round(ordered[min(len(ordered) - 1, int(len(ordered) * fraction))], 4)

    # What the tier was standing in for, and how badly. If tier were a proxy for value the
    # medians would be ordered A > B > C and far apart; the interesting result is how much they
    # overlap.
    tier_summary = {
        tier: {
            "n": len(scores),
            "median_value": round(sorted(scores)[len(scores) // 2], 4),
        }
        for tier, scores in sorted(tier_value.items())
    }
    top = sorted(range(len(values)), key=lambda i: -values[i])[:max(1, len(values) // 100)]
    top_tiers = Counter(columns["resolution_tier"][i] for i in top)

    summary = {
        "observations": len(values),
        "weights": WEIGHTS,
        "component_coverage": {name: covered[name] for name in COMPONENTS},
        "value_percentiles": {"p10": at(0.10), "p25": at(0.25), "p50": at(0.50),
                              "p75": at(0.75), "p90": at(0.90), "p99": at(0.99)},
        "limiting_factor": dict(limiting.most_common()),
        "by_resolution_tier": tier_summary,
        "top_one_percent_by_tier": dict(top_tiers.most_common()),
    }
    SUMMARY.write_text(json.dumps(summary, indent=1) + "\n")
    say(json.dumps(summary, indent=1))
    say(f"wrote {args.out.name}: {table.num_rows} rows")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
