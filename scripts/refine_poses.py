#!/usr/bin/env python3
"""Correct camera positions against the streets they were taken from, and prove it helps.

Every frame carries a provider's guess at where it stood. The street network now says where the
right of way is, and a camera outside it is wrong. This pulls those frames back to the boundary
they crossed and smooths the sequences that were driven along a street, then writes the
correction beside the original rather than over it.

The last part is the point. A refinement nobody has measured is a refinement nobody should
trust, so the run ends by injecting a known lateral error into positions we already have,
re-running the same correction, and reporting how much of the injected error came back out.
"""

from __future__ import annotations

import argparse
import json
import math
import random
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

import numpy as np  # noqa: E402
import pyarrow as pa  # noqa: E402
import pyarrow.parquet as pq  # noqa: E402

from smc.enrich.pose import refine_sequence, sequence_follows_street  # noqa: E402
from smc.facades.geometry import LocalFrame  # noqa: E402
from smc.official.join import CentrelineIndex  # noqa: E402

CATALOG = ROOT / "data" / "sf_corridor" / "observations" / "external-000.parquet"
ENRICH = ROOT / "data" / "observation_enrichment"
OFFICIAL = ROOT / "data" / "sf_public_works"
CORRIDOR = {"south": 37.786, "west": -122.4475, "north": 37.8095, "east": -122.392}

SCHEMA = pa.schema([
    ("observation_uid", pa.string()),
    ("refined_latitude", pa.float64()),
    ("refined_longitude", pa.float64()),
    ("lateral_before_m", pa.float32()),
    ("lateral_after_m", pa.float32()),
    ("moved_m", pa.float32()),
    ("position_sigma_m", pa.float32()),
    ("refine_reason", pa.string()),
    ("refine_method", pa.string()),
])


def point_and_normal(vertices: np.ndarray, station_m: float):
    """Position and left-hand normal at a station along a polyline, in local metres."""
    travelled = 0.0
    for start, end in zip(vertices[:-1], vertices[1:]):
        edge = end - start
        length = float(np.linalg.norm(edge))
        if length < 1e-9:
            continue
        if travelled + length >= station_m:
            direction = edge / length
            point = start + direction * (station_m - travelled)
            return point, np.array([-direction[1], direction[0]]), direction
        travelled += length
    direction = vertices[-1] - vertices[-2]
    norm = max(float(np.linalg.norm(direction)), 1e-9)
    direction = direction / norm
    return vertices[-1], np.array([-direction[1], direction[0]]), direction


def bearing_of(direction: np.ndarray) -> float:
    return (90.0 - math.degrees(math.atan2(direction[1], direction[0]))) % 360.0


def run(offsets_by_group, rows, index, *, inject: float = 0.0, seed: int = 7):
    """Refine every group, optionally after injecting a known lateral error first."""
    rng = random.Random(seed)
    results = {}
    for (sequence, feature), members in offsets_by_group.items():
        vertices = index.segments.get(feature)
        if vertices is None:
            continue
        members.sort(key=lambda m: m["station"])
        _point, _normal, direction = point_and_normal(vertices, members[0]["station"])
        street_bearing = bearing_of(direction)
        smooth = sequence_follows_street([m["heading"] for m in members], street_bearing)

        laterals = []
        injected = []
        for member in members:
            error = rng.gauss(0.0, inject) if inject else 0.0
            injected.append(error)
            laterals.append(member["lateral"] + error)
        fixes = refine_sequence(laterals, [m["row"] for m in members], smooth=smooth)
        for member, fix, error in zip(members, fixes, injected, strict=True):
            results[member["uid"]] = (fix, error, smooth)
    return results


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--inject-m", type=float, default=3.0,
                    help="lateral error to inject in the validation pass")
    args = ap.parse_args()

    def progress(message: str) -> None:
        print(message, flush=True)

    catalogue = pq.read_table(CATALOG, columns=[
        "observation_uid", "latitude", "longitude", "heading_deg"]).to_pydict()
    enrichment = pq.read_table(ENRICH / "enrichment-000.parquet", columns=[
        "observation_uid", "segment_id", "station_m", "street_side",
        "centreline_distance_m", "sequence_uid", "official_row_m"]).to_pydict()
    frame = LocalFrame((CORRIDOR["south"] + CORRIDOR["north"]) / 2,
                       (CORRIDOR["west"] + CORRIDOR["east"]) / 2)
    index = CentrelineIndex.from_centrelines(
        json.loads((OFFICIAL / "centrelines.json").read_text()), frame)

    heading_by_uid = dict(zip(catalogue["observation_uid"], catalogue["heading_deg"]))
    groups = defaultdict(list)
    for i, uid in enumerate(enrichment["observation_uid"]):
        if enrichment["segment_id"][i] is None:
            continue
        groups[(enrichment["sequence_uid"][i], enrichment["segment_id"][i])].append({
            "uid": uid,
            "station": enrichment["station_m"][i] or 0.0,
            # Signed: positive to the left of the direction of travel.
            "lateral": (enrichment["centreline_distance_m"][i] or 0.0)
                       * (enrichment["street_side"][i] or 1),
            "row": enrichment["official_row_m"][i],
            "heading": heading_by_uid.get(uid),
        })
    progress(f"{len(groups)} sequence-and-street groups")

    fixed = run(groups, catalogue, index)
    progress(f"{len(fixed)} frames refined")

    # -- write the correction beside the original ------------------------------------------
    out = {name: [] for name in SCHEMA.names}
    moved_total = 0
    for (sequence, feature), members in groups.items():
        vertices = index.segments.get(feature)
        if vertices is None:
            continue
        for member in members:
            entry = fixed.get(member["uid"])
            if entry is None:
                continue
            fix, _error, smooth = entry
            point, normal, _direction = point_and_normal(vertices, member["station"])
            corrected = point + normal * fix.corrected_m
            lon, lat = frame.to_lonlat(float(corrected[0]), float(corrected[1]))
            out["observation_uid"].append(member["uid"])
            out["refined_latitude"].append(lat)
            out["refined_longitude"].append(lon)
            out["lateral_before_m"].append(fix.lateral_m)
            out["lateral_after_m"].append(fix.corrected_m)
            out["moved_m"].append(fix.moved_m)
            out["position_sigma_m"].append(fix.sigma_m)
            out["refine_reason"].append(fix.reason)
            out["refine_method"].append(
                "right_of_way+sequence_smoothing" if smooth else "right_of_way")
            if fix.moved_m > 0.05:
                moved_total += 1
    pq.write_table(pa.table(out, schema=SCHEMA), ENRICH / "pose-000.parquet",
                   compression="zstd")

    # -- does it actually help? --------------------------------------------------------------
    #
    # Inject a lateral error of known size into positions we already have, refine again, and see
    # how much of it comes back out. A correction that cannot beat the error it was given is a
    # correction that should not be applied.
    noisy = run(groups, catalogue, index, inject=args.inject_m)
    before, after = [], []
    for uid, (fix, error, _smooth) in noisy.items():
        if abs(error) < 1e-9:
            continue
        clean = fixed.get(uid)
        if clean is None:
            continue
        truth = clean[0].corrected_m
        before.append(abs(fix.lateral_m - truth))
        after.append(abs(fix.corrected_m - truth))
    before.sort()
    after.sort()

    moves = sorted(v for v in out["moved_m"] if v > 0.05)
    summary = {
        "frames_refined": len(out["observation_uid"]),
        "frames_moved": moved_total,
        "moved_median_m": round(moves[len(moves) // 2], 3) if moves else None,
        "moved_p90_m": round(moves[int(len(moves) * 0.9)], 3) if moves else None,
        "outside_right_of_way": sum(1 for r in out["refine_reason"]
                                    if r == "outside the right of way"),
        "smoothed": sum(1 for r in out["refine_reason"]
                        if r == "smoothed against its neighbours"),
        "left_alone_wrong_street": sum(
            1 for r in out["refine_reason"]
            if r == "outside by more than a correction can explain"),
        "validation": {
            "injected_sigma_m": args.inject_m,
            "n": len(before),
            "error_before_median_m": round(before[len(before) // 2], 3) if before else None,
            "error_after_median_m": round(after[len(after) // 2], 3) if after else None,
            "error_before_mean_m": round(sum(before) / len(before), 3) if before else None,
            "error_after_mean_m": round(sum(after) / len(after), 3) if after else None,
        },
    }
    (ENRICH / "pose_summary.json").write_text(json.dumps(summary, indent=1))
    print(json.dumps(summary, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
