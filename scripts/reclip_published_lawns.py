#!/usr/bin/env python3
"""Reclip existing SF front lawns without refetching unavailable city parcel rows.

Only the existing lawn class is changed.  Each qualifying lawn is split at
the first mapped house face parallel to its street frontage; the remainder
becomes a backyard.  Ambiguous lots remain untouched for review.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "src"))

from smc.ground.cover import Lattice  # noqa: E402
from scripts.build_ground_cover import ring_area_m2, split_at_frontage  # noqa: E402


def reclip(payload: dict, cover: dict) -> tuple[dict, dict]:
    bbox = payload["bbox"]
    mid_lat = (bbox["south"] + bbox["north"]) / 2
    mid_lon = (bbox["west"] + bbox["east"]) / 2
    metres_lon = 111_320 * math.cos(math.radians(mid_lat))

    def to_metres(lon: float, lat: float) -> tuple[float, float]:
        return (lon - mid_lon) * metres_lon, (lat - mid_lat) * 111_320

    def to_lonlat(x: float, y: float) -> tuple[float, float]:
        return x / metres_lon + mid_lon, y / 111_320 + mid_lat

    street = Lattice(bbox, cell_m=1.0)
    houses = Lattice(bbox, cell_m=1.0)
    for way in payload["ways"]:
        points = way.get("points") or []
        if way.get("kind") == "building" and len(points) >= 4:
            houses.stamp_polygon(points)
        elif way.get("kind") == "street" and len(points) >= 2:
            street.stamp_polyline(points, (way.get("road_m") or 8.0)
                                  + 2 * (way.get("walk_m") or 3.0))

    def occupied(lattice: Lattice, x: float, y: float) -> bool:
        row, col = lattice.to_cell(x, y)
        return 0 <= row < lattice.height and 0 <= col < lattice.width \
            and bool(lattice.grid[row, col])

    lawns = []
    backyards = list(cover.get("backyards") or [])
    backyard_ids = {row.get("id") for row in backyards}
    clipped = ambiguous = already_clipped = 0
    rejected = {"no_street_or_house": 0, "multiple_frontages": 0, "too_small": 0}
    for lawn in cover.get("lawns") or []:
        if lawn.get("frontage_clipped_m") is not None or lawn.get("id") in backyard_ids:
            lawns.append(lawn)
            already_clipped += 1
            continue
        ring = lawn["p"]
        metric = [to_metres(*p) for p in ring]
        signed_area = sum(metric[i][0] * metric[i + 1][1]
                          - metric[i + 1][0] * metric[i][1]
                          for i in range(len(metric) - 1))
        turn = 1 if signed_area > 0 else -1
        candidates = []
        for (ax, ay), (bx, by) in zip(metric[:-1], metric[1:]):
            span = math.hypot(bx - ax, by - ay)
            if span < 2:
                continue
            nx, ny = turn * (by - ay) / span, turn * -(bx - ax) / span
            probes = [(ax + (bx - ax) * t, ay + (by - ay) * t)
                      for t in (0.25, 0.5, 0.75)]
            faces_street = sum(occupied(street, x + nx * d, y + ny * d)
                               for x, y in probes for d in (1.0, 3.0, 5.0))
            if faces_street < 2:
                continue
            depths = []
            for x, y in probes:
                for depth in (2.5, 3, 3.5, 4, 4.5, 5, 6, 7, 8, 9, 10, 12):
                    if occupied(houses, x - nx * depth, y - ny * depth):
                        depths.append(depth)
                        break
            if depths:
                candidates.append((min(depths), (ax, ay), (bx, by), faces_street))
        # Two frontage candidates at similar distance mean a corner parcel.
        # A single rectangular guess there would erase a genuine side lawn.
        candidates.sort(key=lambda row: (row[0], -row[3]))
        if not candidates or (len(candidates) > 1
                              and candidates[1][0] - candidates[0][0] < 0.75):
            rejected["no_street_or_house" if not candidates else "multiple_frontages"] += 1
            lawns.append(lawn)
            ambiguous += 1
            continue
        depth, a, b, _ = candidates[0]
        front, back = split_at_frontage(ring, a, b, depth, to_metres, to_lonlat)
        if not front or ring_area_m2(front, to_metres) < 6:
            rejected["too_small"] += 1
            lawns.append(lawn)
            ambiguous += 1
            continue
        lawns.append({**lawn, "p": [[round(x, 7), round(y, 7)] for x, y in front],
                      "frontage_clipped_m": depth})
        if back and ring_area_m2(back, to_metres) >= 6:
            backyards.append({"id": lawn["id"],
                              "p": [[round(x, 7), round(y, 7)] for x, y in back]})
        clipped += 1
    updated = {**cover, "lawns": lawns, "backyards": backyards}
    return updated, {"front_lawns_clipped": clipped, "already_clipped": already_clipped,
                     "ambiguous_left_unchanged": ambiguous,
                     "total_lawns": len(lawns), "rejected": rejected}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--page", type=Path, default=ROOT / "docs" / "sf-corridor-3d.json")
    parser.add_argument("--ground", type=Path, default=ROOT / "data" / "sf_public_works" / "ground_cover.json")
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    updated, summary = reclip(json.loads(args.page.read_text()),
                              json.loads(args.ground.read_text()))
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(updated, separators=(",", ":")) + "\n")
    print(summary)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
