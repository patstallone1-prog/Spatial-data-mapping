#!/usr/bin/env python3
"""Plant the trees the lidar and the aerial survey both see, where no inventory has them.

Oakland's tree inventory has one placeholder coordinate for all 38,598 rows and Berkeley
publishes none, so both regions had no trees at all; and every city's inventory is of
street trees, so no region had a tree in a back garden or a park. The region's own lidar
has every one of them as a crown (``smc.lidar.canopy``), and NAIP's near-infrared tells a
crown from a pole's head or an awning (``smc.imagery.naip``).

Measured against San Francisco's street-tree inventory, at the kerb, where that inventory is
complete: the crowns alone match an inventory tree 61% of the time; with the aerial check,
71%, keeping 79% of the inventory trees the lidar found. Much of the rest are trees the
inventory does not have.

A crown within ``SAME_TREE_M`` of a tree already in the ground file is that tree and is
skipped; one over the carriageway is moved to the nearest ground that is not road, as the
inventory's trees are (``RoadMask.clear_of_road``), or dropped. Each is drawn at the height
the lidar measured, and says where it came from.

    .venv/bin/python tools/plant_lidar_trees.py oakland-downtown berkeley-downtown
"""

from __future__ import annotations

import argparse
import json
import math
import runpy
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

import numpy as np  # noqa: E402
from scipy.spatial import cKDTree  # noqa: E402

from smc.ground.exclusion import RoadMask  # noqa: E402
from smc.imagery.naip import Vegetation  # noqa: E402

SAME_TREE_M = 4.0
#: The aerial check: this share of the disc round a crown must be leaves. The disc reaches
#: past the crown because the survey's tree tops lean away from its camera.
MIN_GREEN = 0.05
RELIEF_M = 1.5
#: The renderer's tree is this tall at scale one, and its scale is ``d * 0.34``.
PROTO_HEIGHT_M = 1.15
SCALE_PER_D = 0.34


def ground_files(region: str) -> list[Path]:
    if region == "sf-corridor":
        return [p for p in (ROOT / "docs/app-sf-corridor-ground.json",) if p.exists()]
    # The website's regional ground, and the app's own where it has one (Oakland's is wider).
    return [p for p in (ROOT / "docs/regions" / region / "sf-corridor-ground.json",
                        ROOT / "docs/app-regions" / region / "sf-corridor-ground.json") if p.exists()]


def payload(region: str) -> Path:
    if region == "sf-corridor":
        return ROOT / "docs/sf-corridor-3d.json"
    app = ROOT / "docs/app-regions" / region / "sf-corridor-3d.json"
    return app if app.exists() else ROOT / "docs/regions" / region / "sf-corridor-3d.json"


def variant(height: float, crown: float) -> str:
    if crown < 0.45 * height:
        return "columnar"
    return "broad" if crown >= 7.0 else "street"


def plant(region: str, veg: Vegetation) -> dict:
    trees_path = ROOT / "data/regions" / region / "points" / "trees.jsonl"
    if not trees_path.exists():
        subprocess.run([sys.executable, str(ROOT / "scripts/detect_lidar_trees.py"), region],
                       check=True)
    crowns = [json.loads(line) for line in trees_path.read_text().splitlines() if line]
    ways = json.loads(payload(region).read_text())["ways"]
    lons = [p[0] for w in ways for p in w.get("points", [])[:1]]
    lats = [p[1] for w in ways for p in w.get("points", [])[:1]]
    bbox = {"west": min(lons), "east": max(lons), "south": min(lats), "north": max(lats)}
    road = RoadMask(ways, bbox)
    report = {"crowns": len(crowns)}
    for path in ground_files(region):
        ground = json.loads(path.read_text())
        existing = ground.get("trees") or []
        lat0 = (bbox["south"] + bbox["north"]) / 2
        k = np.array([111_320 * math.cos(math.radians(lat0)), 110_540])
        tree = cKDTree(np.array([t["p"][:2] for t in existing]) * k) if existing else None
        added = moved = same = bare = off_road = no_aerial = 0
        for crown in crowns:
            lon, lat = crown["lon"], crown["lat"]
            if tree is not None and tree.query_ball_point(np.array([lon, lat]) * k, SAME_TREE_M):
                same += 1
                continue
            green = veg.green_share(lon, lat, crown["crown_m"] / 2 + RELIEF_M)
            if green < MIN_GREEN:
                bare += 1
                continue
            # NaN: the aerial tile could not be had. The crown stands on the lidar alone
            # (61% against San Francisco's inventory, where the aerial check makes it 71%)
            # and says so.
            unchecked = math.isnan(green)
            no_aerial += unchecked
            placed = road.clear_of_road(lon, lat)
            if placed is None:
                off_road += 1
                continue
            if placed != (lon, lat):
                moved += 1
            h = float(crown["height_m"])
            existing.append({"p": [round(placed[0], 6), round(placed[1], 6)],
                             "v": variant(h, float(crown["crown_m"])),
                             "d": round(min(48.0, max(1.0, h / (PROTO_HEIGHT_M * SCALE_PER_D))), 1),
                             "h": round(h, 1), "crown_m": round(float(crown["crown_m"]), 1),
                             "src": "lidar_canopy" if unchecked else "lidar_canopy+naip"})
            added += 1
        ground["trees"] = existing
        sources = ground.setdefault("sources", {})
        sources["lidar_canopy_trees"] = ("USGS 3DEP canopy crowns confirmed by USDA NAIP "
                                         "near-infrared (tools/plant_lidar_trees.py)")
        path.write_text(json.dumps(ground, separators=(",", ":")))
        runpy.run_path(str(ROOT / "tools/build_window_cells.py"))["cut"](path)
        report[path.name] = {"added": added, "already_a_tree": same, "not_green": bare,
                             "moved_off_road": moved, "dropped_in_road": off_road,
                             "no_aerial_check": no_aerial,
                             "trees_now": len(existing)}
    return report


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("regions", nargs="+")
    args = ap.parse_args()
    veg = Vegetation(ROOT / "build" / "naip")
    for region in args.regions:
        print(region, json.dumps(plant(region, veg)), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
