#!/usr/bin/env python3
"""Give every observation a place on the street network, and a position in its own sequence.

A frame in the catalogue knows where its camera was and almost nothing about where that is. It
carries a latitude, a longitude and a heading, which is enough to put a dot on a map and not
enough to say what the dot is looking at.

This writes a sidecar -- one row per observation, keyed by ``observation_uid`` -- saying which
street the frame stands on, how far along it, which side, and what the city records about that
stretch of it. A frame stops being "a photograph at 37.80, -122.42" and becomes "a photograph
of the south side of Clay Street at station 47 m, where the carriageway measures 8.9 m between
mapped curbs and the footway is a surveyed 3.05 m".

It is a sidecar rather than new columns on the observation because the catalogue's source rows
are meant to stay exactly as the provider gave them. Everything here is derived, every value
can change when the official geometry improves, and none of it should be mistaken for something
a provider said.

The other thing it fixes is ordering. Mapillary hands us no frame index at all -- 307,986 rows
with nothing to say which frame comes before which -- so an ordering is derived from capture
time within each sequence and recorded as derived. Without it there are no neighbours, and with
no neighbours there is no baseline, no stereo pair and no multi-view anything for what is now
four fifths of the catalogue.
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

from smc.facades.geometry import LocalFrame  # noqa: E402
from smc.official.join import CentrelineIndex  # noqa: E402

CATALOG = ROOT / "data" / "sf_corridor" / "observations" / "external-000.parquet"
OFFICIAL = ROOT / "data" / "sf_public_works"
OUT = ROOT / "data" / "observation_enrichment"
CORRIDOR = {"south": 37.786, "west": -122.4475, "north": 37.8095, "east": -122.392}

SCHEMA = pa.schema([
    ("observation_uid", pa.string()),
    ("provider", pa.string()),
    # -- where on the street network -------------------------------------------------------
    ("segment_id", pa.string()),
    ("street_name", pa.string()),
    ("station_m", pa.float32()),
    ("street_side", pa.int8()),
    ("centreline_distance_m", pa.float32()),
    # -- what the city records about that stretch ------------------------------------------
    ("official_row_m", pa.float32()),
    ("official_carriageway_m", pa.float32()),
    ("carriageway_source", pa.string()),
    ("official_sidewalk_m", pa.float32()),
    ("measured_curb_height_m", pa.float32()),
    ("oneway", pa.string()),
    # -- position in its own sequence -------------------------------------------------------
    ("sequence_uid", pa.string()),
    ("sequence_index", pa.int32()),
    ("sequence_length", pa.int32()),
    ("sequence_order_source", pa.string()),
    ("previous_observation_uid", pa.string()),
    ("next_observation_uid", pa.string()),
    ("neighbour_gap_m", pa.float32()),
])


def haversine_m(lat1, lon1, lat2, lon2) -> float:
    import math
    return math.hypot((lat2 - lat1) * 111_320.0,
                      (lon2 - lon1) * 111_320.0 * math.cos(math.radians(lat1)))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--limit", type=int, default=None)
    args = ap.parse_args()

    def progress(message: str) -> None:
        print(message, flush=True)

    columns = ["observation_uid", "provider", "provider_sequence_id", "sequence_uid",
               "provider_sequence_index", "captured_at", "latitude", "longitude", "eligible"]
    rows = pq.read_table(CATALOG, columns=columns).to_pydict()
    total = len(rows["observation_uid"])
    if args.limit:
        total = min(total, args.limit)
    progress(f"{total} observations")

    frame = LocalFrame((CORRIDOR["south"] + CORRIDOR["north"]) / 2,
                       (CORRIDOR["west"] + CORRIDOR["east"]) / 2)
    index = CentrelineIndex.from_centrelines(
        json.loads((OFFICIAL / "centrelines.json").read_text()), frame)
    segments = {r["feature_id"]: r for r in json.loads((OFFICIAL / "segments.json").read_text())}
    attributes = json.loads((OFFICIAL / "street_attributes.json").read_text())
    progress(f"{len(index.segments)} centrelines, {len(attributes)} with street attributes")

    # -- ordering within each sequence ------------------------------------------------------
    #
    # The provider's own index is used wherever it exists. Where it does not, frames are put in
    # capture-time order and the sidecar says so, because a derived ordering and a supplied one
    # are not the same claim.
    by_sequence: dict[str, list[int]] = defaultdict(list)
    for i in range(total):
        key = rows["provider_sequence_id"][i] or rows["sequence_uid"][i]
        if key:
            by_sequence[key].append(i)

    order_index = [None] * total
    order_source = [None] * total
    order_length = [None] * total
    previous = [None] * total
    following = [None] * total
    gap = [None] * total

    derived = 0
    for members in by_sequence.values():
        supplied = [rows["provider_sequence_index"][i] for i in members]
        if all(v is not None for v in supplied) and len(set(supplied)) == len(supplied):
            ordered = sorted(members, key=lambda i: rows["provider_sequence_index"][i])
            source = "provider"
        else:
            timed = [i for i in members if rows["captured_at"][i] is not None]
            if len(timed) < 2:
                continue
            ordered = sorted(timed, key=lambda i: rows["captured_at"][i])
            source = "captured_at"
            derived += len(ordered)
        for position, i in enumerate(ordered):
            order_index[i] = position
            order_source[i] = source
            order_length[i] = len(ordered)
            if position > 0:
                j = ordered[position - 1]
                previous[i] = rows["observation_uid"][j]
                gap[i] = haversine_m(rows["latitude"][j], rows["longitude"][j],
                                     rows["latitude"][i], rows["longitude"][i])
            if position + 1 < len(ordered):
                following[i] = rows["observation_uid"][ordered[position + 1]]
    progress(f"{len(by_sequence)} sequences; {derived} frames ordered by capture time")

    # -- the join ----------------------------------------------------------------------------
    out: dict[str, list] = {name: [] for name in SCHEMA.names}
    placed = 0
    for i in range(total):
        found = index.locate_full(rows["longitude"][i], rows["latitude"][i])
        segment_id = station = side = distance = None
        record: dict = {}
        attribute: dict = {}
        if found is not None:
            segment_id, station, side, distance = found
            record = segments.get(segment_id) or {}
            attribute = attributes.get(segment_id) or {}
            placed += 1
        walks = record.get("sidewalk_m") or {}
        sidewalk = walks.get(str(side)) or walks.get("0")
        oneway = attribute.get("oneway")

        out["observation_uid"].append(rows["observation_uid"][i])
        out["provider"].append(rows["provider"][i])
        out["segment_id"].append(segment_id)
        out["street_name"].append(index.names.get(segment_id) if segment_id else None)
        out["station_m"].append(station)
        out["street_side"].append(side)
        out["centreline_distance_m"].append(distance)
        out["official_row_m"].append(attribute.get("record_row_m")
                                     or record.get("right_of_way_m"))
        out["official_carriageway_m"].append(attribute.get("road_m"))
        out["carriageway_source"].append(attribute.get("road_source"))
        out["official_sidewalk_m"].append(sidewalk)
        out["measured_curb_height_m"].append(record.get("curb_height_m"))
        out["oneway"].append(oneway if isinstance(oneway, str) else ("yes" if oneway else None))
        out["sequence_uid"].append(rows["sequence_uid"][i])
        out["sequence_index"].append(order_index[i])
        out["sequence_length"].append(order_length[i])
        out["sequence_order_source"].append(order_source[i])
        out["previous_observation_uid"].append(previous[i])
        out["next_observation_uid"].append(following[i])
        out["neighbour_gap_m"].append(gap[i])
        if (i + 1) % 100_000 == 0:
            progress(f"  joined {i + 1}/{total}")

    OUT.mkdir(parents=True, exist_ok=True)
    table = pa.table(out, schema=SCHEMA)
    pq.write_table(table, OUT / "enrichment-000.parquet", compression="zstd")

    gaps = sorted(g for g in out["neighbour_gap_m"] if g is not None and g > 0)
    summary = {
        "observations": total,
        "placed_on_a_street": placed,
        "with_official_carriageway": sum(1 for v in out["official_carriageway_m"] if v),
        "with_official_sidewalk": sum(1 for v in out["official_sidewalk_m"] if v),
        "with_measured_curb_height": sum(1 for v in out["measured_curb_height_m"] if v),
        "ordered_in_a_sequence": sum(1 for v in out["sequence_index"] if v is not None),
        "order_from_provider": sum(1 for v in out["sequence_order_source"] if v == "provider"),
        "order_from_capture_time": sum(1 for v in out["sequence_order_source"]
                                       if v == "captured_at"),
        # The gap to the previous frame is the baseline a stereo pair would have. One to three
        # metres is the band that triangulates well.
        "neighbour_gap_median_m": round(gaps[len(gaps) // 2], 2) if gaps else None,
        "neighbour_gap_1_to_3m": sum(1 for g in gaps if 1.0 <= g <= 3.0),
    }
    (OUT / "summary.json").write_text(json.dumps(summary, indent=1))
    print(json.dumps(summary, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
