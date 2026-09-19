#!/usr/bin/env python3
"""Bound the lidar footway widths by the right of way, and see whether it helped.

Three sources describe the same footway: our aerial lidar, San Francisco's 2014 survey, and the
right of way recorded in feet and inches. The lidar disagreed with the survey by half a metre
on average, and the shape of the disagreement said why -- a long tail where the lidar reads far
too wide, because the ground-plane fit follows flat walkable ground past the property line.

So the lidar is bounded by the right of way, and then all three are compared again. The survey
takes no part in setting the bound, or the comparison would be measuring its own answer.

Two lidar readings exist now. The walk run (``smc.lidar.curb.walk_run``) measures the paved
footway from the top of the kerb to the first step, wall or loss of ground -- what a person
can walk on; the older plane extent measured the whole flat surface the walk plane fitted,
forecourt and yard included. The survey records the *legal* footway, kerb to property line,
which is neither: a plaza reads wider than the law's footway, a setback narrower. The lidar
rung of the width ladder is the walk run bounded by the right of way, scored here as
``lidar_rung_vs_survey`` (the median of run, extent and bound was tried and leans 0.7 m wide).
The record itself, where the city has one, agrees with the survey to five centimetres and
outranks all of it; the lidar's remaining error against the survey is the gap between the
legal footway and the paved one, which no ground sensor can see.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from smc.facades.geometry import LocalFrame  # noqa: E402
from smc.official.footway import bound_footway  # noqa: E402
from smc.official.join import CentrelineIndex  # noqa: E402
from smc.official.reconcile import is_conflict  # noqa: E402

OFFICIAL = ROOT / "data" / "sf_public_works"
LIDAR = ROOT / "data" / "sf_corridor" / "depth" / "lidar" / "curb_sections.jsonl"
#: The earlier journal, whose width is the walk plane's extent; kept for the median of three.
LIDAR_EXTENT = ROOT / "data" / "sf_corridor" / "depth" / "lidar" / "curb_sections_extent.jsonl"
CORRIDOR = {"south": 37.786, "west": -122.4475, "north": 37.8095, "east": -122.392}


def curb_offset_at(profile: dict, station_m: float, side: int) -> float | None:
    """The kerb's distance from the centreline at a station, on one side."""
    key = "l" if side > 0 else "r"
    best, best_gap = None, 1e9
    for sample in profile.get("samples", ()):
        gap = abs(sample["s"] - station_m)
        if gap < best_gap and sample.get(key) is not None:
            best, best_gap = sample[key], gap
    return best if best_gap <= 12.0 else None


def stats(pairs: list[tuple[float, float, float | None]]) -> dict:
    """Error of the first value against the second, with a conflict rate."""
    if not pairs:
        return {"n": 0}
    diffs = sorted(a - b for a, b, _ in pairs)
    absolute = sorted(abs(d) for d in diffs)
    n = len(diffs)
    conflicts = sum(1 for a, b, sigma in pairs if is_conflict(b, a, sigma, 0.1524))
    return {
        "n": n,
        "mae_m": round(sum(absolute) / n, 4),
        "bias_m": round(sum(diffs) / n, 4),
        "median_error_m": round(diffs[n // 2], 4),
        "p90_abs_error_m": round(absolute[int(n * 0.9)], 4),
        "within_0_5m": round(sum(1 for d in absolute if d <= 0.5) / n, 3),
        "within_1m": round(sum(1 for d in absolute if d <= 1.0) / n, 3),
        "conflict_rate": round(conflicts / n, 3),
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.parse_args()

    def progress(message: str) -> None:
        print(message, flush=True)

    frame = LocalFrame((CORRIDOR["south"] + CORRIDOR["north"]) / 2,
                       (CORRIDOR["west"] + CORRIDOR["east"]) / 2)
    index = CentrelineIndex.from_centrelines(
        json.loads((OFFICIAL / "centrelines.json").read_text()), frame)
    attributes = json.loads((OFFICIAL / "street_attributes.json").read_text())
    segments = {r["feature_id"]: r for r in json.loads((OFFICIAL / "segments.json").read_text())}
    profiles = json.loads((OFFICIAL / "curb_profiles_corridor.json").read_text())["profiles"]
    progress(f"{len(profiles)} curb profiles, {len(attributes)} street attributes")

    rows = []
    for line in LIDAR.read_text().splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        if row.get("lat") is not None and row.get("sidewalk_width_m") is not None:
            rows.append(row)
    progress(f"{len(rows)} lidar footway measurements")

    extents: dict[tuple[str, float], float] = {}
    if LIDAR_EXTENT.exists():
        for line in LIDAR_EXTENT.read_text().splitlines():
            if not line.strip():
                continue
            row = json.loads(line)
            if row.get("sidewalk_width_m") is not None and row.get("station_m") is not None:
                extents[(row["footway_id"], round(row["station_m"], 1))] = row["sidewalk_width_m"]
    progress(f"{len(extents)} walk-plane extents from the earlier journal")

    out = []
    raw_pairs: list[tuple[float, float, float | None]] = []
    bounded_pairs: list[tuple[float, float, float | None]] = []
    rung_pairs: list[tuple[float, float, float | None]] = []
    counts = {"placed": 0, "bounded": 0, "clipped": 0, "no_bound": 0, "compared": 0,
              "with_extent": 0}

    for row in rows:
        found = index.locate_full(row["lon"], row["lat"])
        if found is None:
            counts["no_bound"] += 1
            continue
        feature, station, side, _distance = found
        counts["placed"] += 1
        attribute = attributes.get(feature) or {}
        record = segments.get(feature) or {}
        # The recorded dimension first; the polygon-derived one only if there is no record.
        right_of_way = attribute.get("record_row_m") or record.get("right_of_way_m")
        profile = profiles.get(feature)
        curb_offset = curb_offset_at(profile, station, side) if profile else None

        result = bound_footway(row["sidewalk_width_m"],
                               right_of_way_m=right_of_way, curb_offset_m=curb_offset)
        if result.bound_m is not None:
            counts["bounded"] += 1
        else:
            counts["no_bound"] += 1
        if result.clipped:
            counts["clipped"] += 1

        extent = extents.get((row["footway_id"], round(row.get("station_m") or -1, 1)))
        if extent is not None:
            counts["with_extent"] += 1
        # The lidar rung: the walk run, bounded by the right of way. The median of run, extent
        # and bound was tried and is biased 0.7 m wide, because the bound is usually the middle
        # value and the bound is generous by design; the bounded run has no bias to speak of
        # (median error -3 cm) and its error is the legal-versus-paved gap, not a lean.
        candidates = [row["sidewalk_width_m"]]
        if extent is not None:
            candidates.append(extent)
        if result.bound_m is not None and result.bound_m >= 1.5:
            candidates.append(result.bound_m)
        estimate = result.bounded_m
        entry = {
            "lat": row["lat"], "lon": row["lon"], "segment_id": feature,
            "station_m": round(station, 2), "side": side,
            "measured_m": round(row["sidewalk_width_m"], 4),
            "extent_m": round(extent, 4) if extent is not None else None,
            "bound_m": round(result.bound_m, 4) if result.bound_m is not None else None,
            "bounded_m": round(result.bounded_m, 4),
            "estimate_m": round(estimate, 4),
            "clipped": result.clipped,
            "sigma_m": row.get("sidewalk_width_sigma_m"),
        }
        walks = record.get("sidewalk_m") or {}
        survey = walks.get(str(side)) or walks.get("0")
        if survey:
            entry["survey_m"] = survey
            counts["compared"] += 1
            sigma = row.get("sidewalk_width_sigma_m")
            raw_pairs.append((row["sidewalk_width_m"], survey, sigma))
            bounded_pairs.append((result.bounded_m, survey, sigma))
            rung_pairs.append((estimate, survey, sigma))
        out.append(entry)

    # -- three sources, pairwise ------------------------------------------------------------
    #
    # Our lidar, a 2014 consultant survey, and a dimension in feet and inches off a city sheet.
    # Two sources that disagree tell you only that one is wrong. Three tell you which.
    record_pairs, survey_vs_record = [], []
    for entry in out:
        attribute = attributes.get(entry["segment_id"]) or {}
        recorded = attribute.get("record_sidewalk_m")
        if not recorded:
            continue
        record_pairs.append((entry["bounded_m"], recorded, entry.get("sigma_m")))
        if entry.get("survey_m"):
            survey_vs_record.append((entry["survey_m"], recorded, 0.1524))

    # Error by the survey's own width: a measurement that is right on average and wrong at
    # both ends is a different failure from one that is simply wide.
    by_bin: dict[str, list[float]] = {}
    for estimate, survey, _ in rung_pairs:
        by_bin.setdefault(f"{round(survey * 2) / 2:.1f}", []).append(estimate - survey)
    rung_by_survey = {
        k: {"n": len(v), "bias_m": round(sum(v) / len(v), 3),
            "mae_m": round(sum(abs(x) for x in v) / len(v), 3)}
        for k, v in sorted(by_bin.items()) if len(v) >= 10
    }
    report = {
        "counts": counts,
        "lidar_vs_survey_before": stats(raw_pairs),
        "lidar_vs_survey_after": stats(bounded_pairs),
        # The rung the width ladder actually uses where the city has no record.
        "lidar_rung_vs_survey": stats(rung_pairs),
        "lidar_rung_by_survey_width": rung_by_survey,
        "lidar_vs_record_after": stats(record_pairs),
        # Neither of these is ours, and they were taken years and a method apart. How far the
        # city's own two numbers sit from each other is the floor on how well anything we
        # measure could be expected to agree with either.
        "survey_vs_record": stats(survey_vs_record),
    }
    (OFFICIAL / "footway_reconciliation.json").write_text(
        json.dumps({"report": report, "measurements": out}, separators=(",", ":")))
    print(json.dumps(report, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
