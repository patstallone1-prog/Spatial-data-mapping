"""Add the buildings OpenStreetMap is missing to the corridor's payload, from DataSF footprints.

    PYTHONPATH=src python tools/fill_building_gaps.py [--bbox S W N E] [--payload docs/sf-corridor-3d.json]

The default box is the City mode area (the Marina, module 30's CITY_AREA) and the block south
of it to Filbert. Idempotent: buildings already added are not added again. The corridor build
(scripts/build_sf_corridor_3d.py) runs the same fill from the same cache, so a rebuild keeps them.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from smc.regions.building_gaps import fetch_footprints, fill_building_gaps  # noqa: E402

#: The Marina (City mode's area) to Filbert, (south, west, north, east).
MARINA_BBOX = (37.7975, -122.4478, 37.8082, -122.4310)
CACHE = ROOT / "data" / "sf_building_enrichment" / "datasf-footprints-marina.json"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--payload", type=Path, default=ROOT / "docs" / "sf-corridor-3d.json")
    parser.add_argument("--bbox", type=float, nargs=4, default=MARINA_BBOX)
    parser.add_argument("--cache", type=Path, default=CACHE)
    args = parser.parse_args()
    footprints = fetch_footprints(tuple(args.bbox), args.cache)
    payload = json.loads(args.payload.read_text(encoding="utf-8"))
    added = fill_building_gaps(payload["ways"], footprints)
    if added:
        osm = payload.get("summary", {}).get("osm", {})
        osm["datasf_gap_buildings"] = osm.get("datasf_gap_buildings", 0) + added
        args.payload.write_text(json.dumps(payload, separators=(",", ":"), default=str), encoding="utf-8")
    print(f"{len(footprints)} DataSF footprints; {added} buildings added to {args.payload.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
