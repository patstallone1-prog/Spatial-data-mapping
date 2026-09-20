#!/usr/bin/env python3
"""Fetch OpenStreetMap for a region into data/regions/<name>/osm_ways.json.

The builder's own fetch (scripts/build_sf_corridor_3d.py: fetch_osm, with the guard that
refuses an Overpass answer with too few elements), run on its own so the ingestion can do it
once, keep the result, and build from the cache with --reuse-osm. For the corridor the cache
is where it always was, data/sf_corridor/stats/osm_ways.json.
"""

from __future__ import annotations

import argparse
import json
import runpy
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from smc.imagery.region import SF_CORRIDOR, get_region  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("region")
    args = ap.parse_args()
    region = get_region(args.region)
    builder = runpy.run_path(str(ROOT / "scripts" / "build_sf_corridor_3d.py"), run_name="kerbside_builder")
    ways = builder["fetch_osm"](region.bbox)
    out = (ROOT / "data" / "sf_corridor" / "stats" / "osm_ways.json" if region.name == SF_CORRIDOR.name
           else ROOT / "data" / "regions" / region.name / "osm_ways.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(ways, indent=2) + "\n", encoding="utf-8")
    kinds = {}
    for way in ways:
        kinds[way.get("kind")] = kinds.get(way.get("kind"), 0) + 1
    print(f"{region.name}: {len(ways)} ways -> {out.relative_to(ROOT)}; {kinds}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
