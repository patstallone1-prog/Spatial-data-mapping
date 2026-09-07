#!/usr/bin/env python3
"""Bound the lidar footway widths by the right of way, and see whether it helped.

Three sources describe the same footway: our aerial lidar, San Francisco's 2014 survey, and the
right of way recorded in feet and inches. The lidar disagreed with the survey by half a metre
on average, and the shape of the disagreement said why -- a long tail where the lidar reads far
too wide, because the ground-plane fit follows flat walkable ground past the property line.

So the lidar is bounded by the right of way, and then all three are compared again. The survey
takes no part in setting the bound, or the comparison would be measuring its own answer.
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

    out = []
    raw_pairs: list[tuple[float, float, float | None]] = []
    bounded_pairs: list[tuple[float, float, float | None]] = []
    counts = {"placed": 0, "bounded": 0, "clipped": 0, "no_bound": 0, "compared": 0}

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

        entry = {
            "lat": row["lat"], "lon": row["lon"], "segment_id": feature,
            "station_m": round(station, 2), "side": side,
            "measured_m": round(row["sidewalk_width_m"], 4),
            "bound_m": round(result.bound_m, 4) if result.bound_m is not None else None,
            "bounded_m": round(result.bounded_m, 4),
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

    report = {
        "counts": counts,
        "lidar_vs_survey_before": stats(raw_pairs),
        "lidar_vs_survey_after": stats(bounded_pairs),
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
