#!/usr/bin/env python3
"""Draw each app region's buildings at the roof height its own lidar measured.

The builder now takes the region's lidar roof over a mapped height where the two agree
(``smc.buildings.lidar_heights``); this applies the same policy to the app's published regional
payloads (``docs/app-regions/<region>/sf-corridor-3d.json``) without rebuilding them, and
recuts their cells. The website's frozen regional pages are left as they are.

    .venv/bin/python tools/apply_region_lidar_heights.py
"""

from __future__ import annotations

import json
import runpy
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from smc.buildings.lidar_heights import adopt_lidar_height  # noqa: E402


def apply(payload: dict, heights: dict) -> Counter:
    counts: Counter = Counter()
    for way in payload.get("ways", []):
        if way.get("kind") != "building":
            continue
        found = heights.get(str(way.get("osm_id")))
        counts[adopt_lidar_height(way, found) if found else "no_roof"] += 1
    return counts


def main() -> int:
    cut = runpy.run_path(str(ROOT / "tools/build_window_cells.py"))["cut"]
    for path in sorted((ROOT / "docs/app-regions").glob("*/sf-corridor-3d.json")):
        region = path.parent.name
        heights_path = ROOT / "data/regions" / region / "lidar" / "building_heights.json"
        if not heights_path.exists():
            continue
        payload = json.loads(path.read_text())
        counts = apply(payload, json.loads(heights_path.read_text()).get("buildings", {}))
        if counts["confirmed"] or counts["adopted"]:
            path.write_text(json.dumps(payload, separators=(",", ":")))
            if (path.parent / "cells" / path.stem).exists():
                cut(path)
        print(f"{region}: " + ", ".join(f"{k} {v}" for k, v in sorted(counts.items())))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
