#!/usr/bin/env python3
"""Work out which observations are worth using together, and for what.

The catalogue is 386,624 photographs held as 386,624 separate things. Almost everything they
are worth beyond their own pixels is in the relationships between them, and until now none of
those were written down anywhere.

This finds them. Frames are compared only against others standing on the same side of the same
street within twenty-five metres, which the spatial join already told us, so the search is
local rather than quadratic. Each candidate pairing is then scored three different ways,
because "useful together" means three different things:

  geometry        -- a parallax in the band that actually fixes a depth
  corroboration   -- a second provider, which does not share the first one's mistakes
  change          -- the same place years apart, which is the opposite of what geometry wants

Nothing is thrown away on the strength of these numbers. They are an index of what could be
done next, not a judgement about which photographs deserve to exist.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

import pyarrow as pa  # noqa: E402
import pyarrow.parquet as pq  # noqa: E402

from smc.enrich.pairs import (  # noqa: E402
    MAX_CANDIDATES,
    MAX_STATION_GAP_M,
    Frame,
    best_pairs,
    subject_distance,
)
from smc.facades.geometry import LocalFrame  # noqa: E402

CATALOG = ROOT / "data" / "sf_corridor" / "observations" / "external-000.parquet"
ENRICH = ROOT / "data" / "observation_enrichment"
CORRIDOR = {"south": 37.786, "west": -122.4475, "north": 37.8095, "east": -122.392}

SCHEMA = pa.schema([
    ("observation_uid", pa.string()),
    ("n_candidates", pa.int32()),
    ("n_usable_geometry", pa.int32()),
    ("n_baseline_1_to_3m", pa.int32()),
    ("geometry_uid", pa.string()),
    ("geometry_baseline_m", pa.float32()),
    ("geometry_parallax_deg", pa.float32()),
    ("geometry_score", pa.float32()),
    ("cross_provider_uid", pa.string()),
    ("cross_provider_baseline_m", pa.float32()),
    ("temporal_uid", pa.string()),
    ("temporal_days", pa.float32()),
    ("temporal_distance_m", pa.float32()),
])


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--limit", type=int, default=None)
    args = ap.parse_args()

    def progress(message: str) -> None:
        print(message, flush=True)

    catalogue = pq.read_table(CATALOG, columns=[
        "observation_uid", "provider", "latitude", "longitude", "heading_deg",
        "captured_at", "projection_type", "eligible",
    ]).to_pydict()
    enrichment = pq.read_table(ENRICH / "enrichment-000.parquet", columns=[
        "observation_uid", "segment_id", "station_m", "street_side",
        "centreline_distance_m", "official_carriageway_m", "official_sidewalk_m",
    ]).to_pydict()
    progress(f"{len(catalogue['observation_uid'])} observations, "
             f"{len(enrichment['observation_uid'])} enriched")

    by_uid = {uid: i for i, uid in enumerate(enrichment["observation_uid"])}
    frame = LocalFrame((CORRIDOR["south"] + CORRIDOR["north"]) / 2,
                       (CORRIDOR["west"] + CORRIDOR["east"]) / 2)

    # -- one bucket per side of per street ---------------------------------------------------
    buckets: dict[tuple[str, int], list[Frame]] = defaultdict(list)
    total = len(catalogue["observation_uid"])
    if args.limit:
        total = min(total, args.limit)
    unplaced = 0
    for i in range(total):
        uid = catalogue["observation_uid"][i]
        j = by_uid.get(uid)
        if j is None or enrichment["segment_id"][j] is None:
            unplaced += 1
            continue
        x, y = frame.to_xy(catalogue["longitude"][i], catalogue["latitude"][i])
        captured = catalogue["captured_at"][i]
        buckets[(enrichment["segment_id"][j], enrichment["street_side"][j])].append(Frame(
            uid=uid,
            provider=catalogue["provider"][i],
            x=x, y=y,
            heading_deg=catalogue["heading_deg"][i],
            captured_at=captured.timestamp() if captured is not None else None,
            spherical=catalogue["projection_type"][i] == "spherical",
            station_m=enrichment["station_m"][j] or 0.0,
            subject_distance_m=subject_distance(
                enrichment["centreline_distance_m"][j],
                enrichment["official_carriageway_m"][j],
                enrichment["official_sidewalk_m"][j],
            ),
        ))
    progress(f"{len(buckets)} street sides hold frames; {unplaced} frames are on no street")

    out: dict[str, list] = {name: [] for name in SCHEMA.names}
    done = 0
    for members in buckets.values():
        members.sort(key=lambda f: f.station_m)
        stations = [f.station_m for f in members]
        for position, subject in enumerate(members):
            # A sliding window along the street. Downtown this can hold thousands of frames, so
            # only the nearest few dozen are compared -- every pair worth having is among them,
            # and the rest are the same view from further away.
            low = position
            while low > 0 and stations[position] - stations[low - 1] <= MAX_STATION_GAP_M:
                low -= 1
            high = position
            while high + 1 < len(members) and stations[high + 1] - stations[position] <= MAX_STATION_GAP_M:
                high += 1
            window = members[low:position] + members[position + 1:high + 1]
            if len(window) > MAX_CANDIDATES:
                window.sort(key=lambda f: abs(f.station_m - subject.station_m))
                window = window[:MAX_CANDIDATES]
            found = best_pairs(subject, window)
            out["observation_uid"].append(subject.uid)
            for key in SCHEMA.names[1:]:
                out[key].append(found.get(key))
            done += 1
            if done % 100_000 == 0:
                progress(f"  paired {done}")

    ENRICH.mkdir(parents=True, exist_ok=True)
    pq.write_table(pa.table(out, schema=SCHEMA), ENRICH / "pairs-000.parquet",
                   compression="zstd")

    scores = sorted(s for s in out["geometry_score"] if s)
    parallaxes = sorted(p for p in out["geometry_parallax_deg"] if p)
    summary = {
        "frames_paired": done,
        "frames_on_no_street": unplaced,
        "with_a_geometry_partner": sum(1 for v in out["geometry_uid"] if v),
        "with_a_cross_provider_partner": sum(1 for v in out["cross_provider_uid"] if v),
        "with_a_temporal_partner": sum(1 for v in out["temporal_uid"] if v),
        "median_geometry_score": round(scores[len(scores) // 2], 3) if scores else None,
        "median_best_parallax_deg": (round(parallaxes[len(parallaxes) // 2], 2)
                                     if parallaxes else None),
        "median_candidates": (sorted(out["n_candidates"])[done // 2] if done else None),
        "frames_with_a_1_to_3m_neighbour": sum(1 for v in out["n_baseline_1_to_3m"] if v),
        "temporal_over_a_year": sum(1 for v in out["temporal_days"] if v and v > 365),
        "temporal_over_five_years": sum(1 for v in out["temporal_days"] if v and v > 1825),
    }
    (ENRICH / "pairs_summary.json").write_text(json.dumps(summary, indent=1))
    print(json.dumps(summary, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
