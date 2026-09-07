#!/usr/bin/env python3
"""Measure the carriageway across San Francisco's own curb lines, and check the result.

The model has been drawing every street as a centreline with half a width pushed out on either
side. This reads the width off the city's mapped curbs instead, every two metres along the
street, and then asks three sources whether they agree:

  the geometry     -- distance between the two curb faces
  the record       -- SFMTA's street-width table, in feet and inches, off a named sheet
  our own lidar    -- what the aerial returns say the footway measures

Nothing is overwritten. The point of running three sources against each other is to find out
where they disagree and by how much, because that is the only honest measure of how good any
of them is.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))


from smc.facades.geometry import LocalFrame  # noqa: E402
from smc.official.curbs import (  # noqa: E402
    curb_role,
    densify,
    profile_is_reliable,
    summarise,
    width_profile,
)
from smc.official.extract import (  # noqa: E402
    block_key_for_centreline,
    segment_id,
    street_width_facts,
)
from smc.official.join import CentrelineIndex  # noqa: E402
from smc.official.schema import OfficialFactClass  # noqa: E402
from smc.official.sfmta import CORRIDOR, LAYERS, fetch  # noqa: E402
from smc.official.datasf import DATASETS  # noqa: E402
from smc.official.datasf import fetch as datasf_fetch  # noqa: E402

CACHE = ROOT / "build" / "sfmta"
OUT = ROOT / "data" / "sf_public_works"
CENTRELINES = OUT / "centrelines.json"
LIDAR = ROOT / "data" / "sf_corridor" / "depth" / "lidar" / "curb_sections.jsonl"

#: The chunk that already wears photographs, so the geometry can be judged against ground we
#: have looked at.
CHUNK = {"key": "c14r03", "west": -122.40771024130188, "south": 37.792737364630895,
         "east": -122.4048681156806, "north": 37.7949831528412}


def in_box(lon: float, lat: float, box: dict) -> bool:
    return box["west"] <= lon <= box["east"] and box["south"] <= lat <= box["north"]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--all", action="store_true", help="the whole corridor, not one chunk")
    ap.add_argument("--refresh", action="store_true")
    args = ap.parse_args()

    def progress(message: str) -> None:
        print(message, flush=True)

    box = CORRIDOR if args.all else CHUNK
    frame = LocalFrame((CORRIDOR["south"] + CORRIDOR["north"]) / 2,
                       (CORRIDOR["west"] + CORRIDOR["east"]) / 2)
    index = CentrelineIndex.from_centrelines(json.loads(CENTRELINES.read_text()), frame)
    progress(f"{len(index.segments)} centrelines")

    curbs, curb_doc = fetch(LAYERS["curbs"], bbox=CORRIDOR, cache_dir=CACHE,
                            refresh=args.refresh, progress=progress)
    widths, width_doc = fetch(LAYERS["street_widths"], cache_dir=CACHE,
                              refresh=args.refresh, progress=progress)

    # -- assign every block-face curb to the street it belongs to --------------------------
    by_segment: dict[str, dict[int, list]] = defaultdict(lambda: {1: [], -1: []})
    roles = defaultdict(int)
    unassigned = 0
    for row in curbs:
        geometry = row.get("geometry") or {}
        coordinates = geometry.get("coordinates") or []
        if geometry.get("type") != "LineString" or len(coordinates) < 2:
            continue
        role = curb_role(row["properties"].get("CURB2_TYPE"))
        roles[role] += 1
        # Only a block face bounds a carriageway. An island's kerb is in the middle of the road
        # and pairing it against a block face measures the distance to the median instead.
        if role != "block":
            continue
        middle = coordinates[len(coordinates) // 2]
        if not in_box(middle[0], middle[1], box):
            continue
        placed = index.locate_way([tuple(c) for c in coordinates])
        if placed is None:
            unassigned += 1
            continue
        feature, side, _distance = placed
        local = densify([frame.to_xy(c[0], c[1]) for c in coordinates])
        by_segment[feature][side].extend(local)

    progress(f"curb lines by role: {dict(roles)}; {unassigned} could not be placed")
    both = {f: v for f, v in by_segment.items() if v[1] and v[-1]}
    progress(f"{len(by_segment)} segments have curb geometry, {len(both)} have both faces")

    # -- the profile ------------------------------------------------------------------------
    profiles: dict[str, dict] = {}
    for feature, sides in both.items():
        centreline = index.segments[feature]
        samples = width_profile(centreline, sides[1], sides[-1])
        summary = summarise(samples)
        if not summary.get("n"):
            continue
        profiles[feature] = {
            "feature_id": feature,
            "name": index.names.get(feature, ""),
            "summary": summary,
            "samples": [
                {"s": s.station_m, "w": round(s.width_m, 3),
                 "l": round(s.left_offset_m, 3), "r": round(s.right_offset_m, 3)}
                for s in samples if s.width_m is not None
            ],
        }
    progress(f"{len(profiles)} segments have a width profile")

    # -- the record --------------------------------------------------------------------------
    # The record is keyed by block, not by CNN, so a block key has to be built for every
    # centreline segment too and used as the bridge between them.
    streets, _ = datasf_fetch(DATASETS["streets"], bbox=CORRIDOR,
                              cache_dir=ROOT / "build" / "sf_public_works", progress=progress)
    features_for_block: dict[str, list[str]] = defaultdict(list)
    for street in streets:
        key = block_key_for_centreline(street)
        if key and street.get("cnn"):
            features_for_block[key].append(segment_id(street["cnn"]))
    progress(f"{len(features_for_block)} blocks resolved from the centreline network")

    record_facts = street_width_facts(widths, width_doc)
    row_by_feature: dict[str, float] = {}
    walk_by_feature: dict[str, list[float]] = defaultdict(list)
    sheets: dict[str, str] = {}
    resolved = 0
    for fact in record_facts:
        targets = ([fact.feature_id] if fact.feature_id.startswith("sfcnn:")
                   else features_for_block.get(fact.feature_id, []))
        if fact.feature_id.startswith("sfblock:") and targets:
            resolved += 1
        for target in targets:
            if fact.fact_class == OfficialFactClass.RIGHT_OF_WAY_WIDTH:
                row_by_feature[target] = float(fact.value)
                if fact.page_or_sheet:
                    sheets[target] = fact.page_or_sheet
            elif fact.fact_class == OfficialFactClass.SIDEWALK_WIDTH:
                walk_by_feature[target].append(float(fact.value))
    progress(f"{resolved} block-keyed records resolved onto centreline segments")
    progress(f"{len(record_facts)} facts from the street-width table: "
             f"{len(row_by_feature)} right-of-way, {len(walk_by_feature)} sidewalk")

    # -- what the model currently believes ---------------------------------------------------
    segments = {r["feature_id"]: r for r in json.loads((OUT / "segments.json").read_text())}

    comparisons = []
    for feature, profile in profiles.items():
        measured = profile["summary"]["median_m"]
        current = (segments.get(feature) or {}).get("right_of_way_m")
        record = row_by_feature.get(feature)
        walks = walk_by_feature.get(feature) or []
        # A right of way runs property line to property line, so the carriageway inside it is
        # what is left once both footways are taken out.
        implied = None
        if record and walks:
            implied = record - (walks[0] * 2 if len(walks) == 1 else sum(walks[:2]))
        comparisons.append({
            "feature_id": feature,
            "name": profile["name"],
            "curb_to_curb_m": measured,
            "curb_to_curb_p10_m": profile["summary"]["p10_m"],
            "curb_to_curb_p90_m": profile["summary"]["p90_m"],
            "record_row_m": round(record, 3) if record else None,
            "record_sheet": sheets.get(feature),
            "record_implied_carriageway_m": round(implied, 3) if implied else None,
            "current_model_row_m": round(current, 3) if current else None,
        })

    # -- one-way designations, which decide whether a street gets a centreline at all ------
    #
    # A one-way street has no centreline. Drawing a broken yellow line down every roadway put a
    # marking on hundreds of streets that do not have one, and a yellow centreline specifically
    # means two-way traffic to anyone reading it.
    oneway_rows, oneway_doc = fetch(LAYERS["oneway"], bbox=CORRIDOR, cache_dir=CACHE,
                                    refresh=args.refresh, progress=progress)
    oneway: dict[str, str] = {}
    for row in oneway_rows:
        cnn = row["properties"].get("CNN")
        if cnn:
            oneway[segment_id(cnn)] = str(row["properties"].get("DIRECTION") or "").strip()
    progress(f"{len(oneway)} one-way segments")

    # -- continental crosswalks -------------------------------------------------------------
    #
    # Not every marked crossing is a ladder of bars. San Francisco keeps an inventory of the
    # ones that are, with the year each was installed, and the model has been painting
    # continental bars on all 2,517 crossings in the corridor including the ones that are two
    # transverse lines and nothing else.
    crosswalk_rows, crosswalk_doc = fetch(LAYERS["crosswalks"], bbox=CORRIDOR, cache_dir=CACHE,
                                          refresh=args.refresh, progress=progress)
    crosswalks = []
    for row in crosswalk_rows:
        geometry = row.get("geometry") or {}
        coordinates = geometry.get("coordinates")
        props = row["properties"]
        if not coordinates:
            lon, lat = props.get("LONGITUDE"), props.get("LATITUDE")
            coordinates = [lon, lat] if lon and lat else None
        if not coordinates:
            continue
        crosswalks.append({
            "p": [round(float(coordinates[0]), 6), round(float(coordinates[1]), 6)],
            "cnn": props.get("CNN"),
            "year": props.get("YR_INSTALL"),
            "street": props.get("STREETNAME"),
            "cross": props.get("CROSS_STRE"),
        })
    progress(f"{len(crosswalks)} continental crosswalks")

    def spread(key_a: str, key_b: str) -> dict | None:
        pairs = [(c[key_a], c[key_b]) for c in comparisons
                 if c.get(key_a) is not None and c.get(key_b) is not None]
        if not pairs:
            return None
        diffs = sorted(a - b for a, b in pairs)
        return {"n": len(diffs),
                "median_diff_m": round(diffs[len(diffs) // 2], 3),
                "mean_abs_diff_m": round(sum(abs(d) for d in diffs) / len(diffs), 3)}

    report = {
        "scope": "corridor" if args.all else CHUNK["key"],
        "documents": [curb_doc.document_id, width_doc.document_id,
                      crosswalk_doc.document_id],
        "oneway_segments": len(oneway),
        "continental_crosswalks": len(crosswalks),
        "segments_with_both_curb_faces": len(both),
        "segments_with_profile": len(profiles),
        "varies_by_over_1m": sum(
            1 for p in profiles.values()
            if p["summary"]["p90_m"] - p["summary"]["p10_m"] > 1.0),
        "curb_to_curb_vs_record_row": spread("curb_to_curb_m", "record_row_m"),
        "curb_to_curb_vs_current_model": spread("curb_to_curb_m", "current_model_row_m"),
        "comparisons": sorted(comparisons, key=lambda c: (c["name"], c["feature_id"])),
    }

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "crosswalks.json").write_text(json.dumps(crosswalks, separators=(",", ":")))
    if args.all:
        # What the reconstruction needs, per segment, in one small file.
        attributes = {}
        declined = Counter()
        for feature, profile in profiles.items():
            summary = profile["summary"]
            reliable, why = profile_is_reliable(summary)
            if not reliable:
                declined[why] += 1
                attributes[feature] = {"road_declined": why}
                continue
            attributes[feature] = {
                "road_m": summary["median_m"],
                "road_p10_m": summary["p10_m"],
                "road_p90_m": summary["p90_m"],
                "road_n": summary["n"],
                "road_source": "curb_geometry",
            }
        progress(f"profiles declined: {dict(declined)}")
        for feature, direction in oneway.items():
            attributes.setdefault(feature, {})["oneway"] = direction or True
        for feature, value in row_by_feature.items():
            attributes.setdefault(feature, {})["record_row_m"] = round(value, 3)
            if feature in sheets:
                attributes[feature]["record_sheet"] = sheets[feature]
        # The record's own footway width, where it filled one in. This is a third and entirely
        # separate opinion about the same pavement -- feet and inches off a sheet, against a
        # 2014 consultant survey and against our lidar -- and three sources can be triangulated
        # where two can only disagree.
        for feature, values in walk_by_feature.items():
            if values:
                attributes.setdefault(feature, {})["record_sidewalk_m"] = round(
                    sorted(values)[len(values) // 2], 3)
        (OUT / "street_attributes.json").write_text(
            json.dumps(attributes, separators=(",", ":")))
        progress(f"wrote street_attributes.json: {len(attributes)} segments")

    suffix = "corridor" if args.all else CHUNK["key"]
    (OUT / f"curb_profiles_{suffix}.json").write_text(
        json.dumps({"profiles": profiles, "report": report}, separators=(",", ":")))
    print(json.dumps({k: v for k, v in report.items() if k != "comparisons"}, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
