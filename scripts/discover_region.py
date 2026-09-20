#!/usr/bin/env python3
"""Probe the sources for a region and write its capability vector.

    python scripts/discover_region.py oakland-downtown
    python scripts/discover_region.py --bbox 37.79,-122.29,37.82,-122.25 --name oakland-test

Writes data/regions/<name>/capabilities.json: what OpenStreetMap, the USGS lidar index, the
imagery services and the project's municipal-record adapters answer for the box, and the
ladder of sources each property will be built from. The ingestion (scripts/ingest_region.py)
reads it; a person can read it too, and see before a build what a region will and will not
know about itself.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from smc.imagery.region import BBox, Region, get_region  # noqa: E402
from smc.net import use_certifi  # noqa: E402
from smc.regions.discover import discover  # noqa: E402

use_certifi()

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("region", nargs="?", help="a name from data/regions/regions.json")
    ap.add_argument("--bbox", help="south,west,north,east instead of a named region")
    ap.add_argument("--name", help="the name to file an ad-hoc box under")
    args = ap.parse_args()
    if args.bbox:
        south, west, north, east = (float(v) for v in args.bbox.split(","))
        region = Region(name=args.name or "adhoc", bbox=BBox(south=south, west=west, north=north, east=east),
                        description="ad hoc")
    elif args.region:
        region = get_region(args.region)
    else:
        ap.error("a region name or --bbox is needed")
    out_dir = ROOT / "data" / "regions" / region.name
    out_dir.mkdir(parents=True, exist_ok=True)
    caps = discover(region, cache_dir=ROOT / "build" / "regions")
    (out_dir / "capabilities.json").write_text(json.dumps(caps.to_json(), indent=1) + "\n")
    print(f"{region.name}: {region.bbox.area_km2:.1f} km2")
    print(f"  osm        {caps.osm}")
    print(f"  lidar      {[(c['dataset'], c['coverage']) for c in caps.lidar.get('collections', [])[:3]]}")
    print(f"  imagery    {caps.imagery}")
    print(f"  municipal  {caps.municipal.get('city')}: {len(caps.municipal.get('records', []))} record types")
    for prop, rung in caps.vector.items():
        print(f"  {prop:16s} {rung}")
    if caps.errors:
        print(f"  errors     {caps.errors}")
    print(f"wrote {out_dir / 'capabilities.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
