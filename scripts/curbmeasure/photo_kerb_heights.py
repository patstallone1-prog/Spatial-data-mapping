#!/usr/bin/env python3
"""Kerb heights read from photographs, for the streets the lidar gave no kerb height.

``photo_kerbs.py --faces 0 --box ...`` reads every kerb photographed in a region: where the
kerb's foot is and how tall its riser stands. Scored against the lidar, the photographs put
the kerb's line a metre or more off (no better than the mapped width), but its height within
a few centimetres. So only the height is taken, and only where nothing better has one.

Each photographed reading is given to the street whose centreline it lies beside -- not near
a second street, so a corner is left out -- and a street's height is the median of its
readings. The same estimate is made for the streets the lidar did measure, and compared with
the lidar's: the photographs are used only if they agree there. The output says how well.

    .venv/bin/python scripts/curbmeasure/photo_kerb_heights.py --region sf-central-gap-p2-0-0 \\
        --photo "/Volumes/HP P700 1/Kerbside/curbphoto-gap/box/sf-central-gap-p2-0-0"

Written to ``data/regions/<r>/lidar/kerb_heights_photo.json``. The builder takes a height from
it only for a street with neither a city nor a lidar kerb height, as ``kerb_source:
photo_semantic`` -- a lower rung than the lidar, never mistaken for it.
"""

from __future__ import annotations

import argparse
import itertools
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree

ROOT = Path(__file__).resolve().parents[2]

#: A reading further from every centreline than this is not beside a street.
REACH_M = 15.0
#: The street a reading is given to must be nearer than the next street by this much.
CLEAR_M = 4.0
#: Riser heights outside this are a misread edge (a step, a planter), not a kerb.
PLAUSIBLE_M = (0.03, 0.40)
MIN_READINGS = 30
MIN_IMAGES = 3
#: The photographs are used only if, on the streets the lidar measured, at least this many
#: agree with it and nine in ten are within this.
MIN_CHECKED = 15
MAX_P90_ERR_M = 0.10


def street_points(ways: list[dict], k: np.ndarray, step_m: float = 1.0):
    """Every street centreline, densified to a point a metre, with the way each belongs to."""
    xy, owner, keys = [], [], []
    for way in ways:
        if (
            way.get("kind") != "street"
            or way.get("osm_id") is None
            or len(way.get("points") or []) < 2
        ):
            continue
        index = len(keys)
        keys.append(f"osm:{way['osm_id']}")
        pts = np.array(way["points"], dtype=float) * k
        for a, b in itertools.pairwise(pts):
            n = max(1, math.ceil(np.linalg.norm(b - a) / step_m))
            for t in np.linspace(0, 1, n, endpoint=False):
                xy.append(a + (b - a) * t)
                owner.append(index)
        xy.append(pts[-1])
        owner.append(index)
    return np.array(xy), np.array(owner), keys


def assign(
    readings: list[dict], xy: np.ndarray, owner: np.ndarray, keys: list[str], k: np.ndarray
) -> dict[str, list[dict]]:
    """Each reading given to the street it lies beside, if it lies beside only one."""
    tree = cKDTree(xy)
    by_way: dict[str, list[dict]] = defaultdict(list)
    for row in readings:
        p = np.array([row["lon"], row["lat"]]) * k
        found = tree.query_ball_point(p, REACH_M + CLEAR_M)
        if not found:
            continue
        nearest: dict[int, float] = {}
        for i in found:
            d = float(np.linalg.norm(xy[i] - p))
            if d < nearest.get(int(owner[i]), math.inf):
                nearest[int(owner[i])] = d
        ranked = sorted(nearest.items(), key=lambda item: item[1])
        best, dist = ranked[0]
        if dist > REACH_M or (len(ranked) > 1 and ranked[1][1] - dist < CLEAR_M):
            continue
        by_way[keys[best]].append(row)
    return by_way


def way_heights(by_way: dict[str, list[dict]]) -> dict[str, dict]:
    out = {}
    lo, hi = PLAUSIBLE_M
    for key, rows in by_way.items():
        kept = [r for r in rows if lo <= r["h"] <= hi]
        images = {r["image"] for r in kept}
        if len(kept) < MIN_READINGS or len(images) < MIN_IMAGES:
            continue
        h = np.array([r["h"] for r in kept])
        median = float(np.median(h))
        out[key] = {
            "curb_height_m": round(median, 3),
            "curb_height_n": len(kept),
            "images": len(images),
            "curb_height_mad_m": round(float(np.median(np.abs(h - median))), 3),
        }
    return out


def check(photo: dict[str, dict], lidar: dict[str, dict]) -> dict:
    """The photographs against the lidar on the streets both measured."""
    errs = [
        photo[key]["curb_height_m"] - lidar[key]["curb_height_m"]
        for key in sorted(photo.keys() & lidar.keys())
    ]
    if not errs:
        return {"streets": 0, "accepted": False}
    a = np.abs(errs)
    p90 = float(np.percentile(a, 90))
    return {
        "streets": len(errs),
        "median_err_m": round(float(np.median(errs)), 3),
        "abs_p50_m": round(float(np.median(a)), 3),
        "abs_p90_m": round(p90, 3),
        "accepted": len(errs) >= MIN_CHECKED and p90 <= MAX_P90_ERR_M,
        "rule": f"at least {MIN_CHECKED} streets, nine in ten within {MAX_P90_ERR_M} m of the lidar",
    }


def build(region: str, photo_dir: Path, data_root: Path = ROOT) -> dict:
    base = data_root / "data" / "regions" / region
    ways = json.loads((base / "osm_ways.json").read_text())
    ways = ways.get("ways", ways) if isinstance(ways, dict) else ways
    lidar_path = base / "lidar" / "kerb_heights.json"
    lidar = json.loads(lidar_path.read_text()) if lidar_path.exists() else {}
    readings = [
        json.loads(line) for line in (photo_dir / "raw_observations.jsonl").open() if line.strip()
    ]
    lat0 = float(np.median([r["lat"] for r in readings])) if readings else 37.77
    k = np.array([111_320 * math.cos(math.radians(lat0)), 111_320])
    xy, owner, keys = street_points(ways, k)
    photo = way_heights(assign(readings, xy, owner, keys, k)) if len(xy) and readings else {}
    checked = check(photo, lidar)
    fills = (
        {key: row for key, row in sorted(photo.items()) if key not in lidar}
        if checked["accepted"]
        else {}
    )
    report_path = photo_dir / "report.json"
    report = json.loads(report_path.read_text()) if report_path.exists() else {}
    return {
        "schema": "kerbside.kerb_heights_photo/1",
        "region": region,
        "grade": "image",
        "certainty": "lower than the lidar: Mapillary semantic kerbs, camera height from the drive's "
        "solved altitude less the lidar ground (datum compatibility unverified)",
        "accepted": checked["accepted"],
        "checked_against_lidar": checked,
        "streets_without_lidar_height": len(set(keys) - lidar.keys()),
        "filled": len(fills),
        "photographs": report.get("photographs"),
        "readings": len(readings),
        "heights": fills,
        "not_used": "the photographed kerb line: a metre or more off the lidar's, so never a kerb position",
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--region", required=True)
    ap.add_argument("--photo", type=Path, required=True, help="photo_kerbs.py --box output folder")
    ap.add_argument("--data-root", type=Path, default=ROOT)
    args = ap.parse_args()
    result = build(args.region, args.photo, args.data_root)
    out = args.data_root / "data" / "regions" / args.region / "lidar" / "kerb_heights_photo.json"
    out.write_text(json.dumps(result, indent=1) + "\n")
    print(json.dumps({k: v for k, v in result.items() if k != "heights"}, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
