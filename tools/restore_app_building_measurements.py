#!/usr/bin/env python3
"""Put the website payload's building measurements back into the app's regional payloads.

The app's regional worlds (``docs/app-regions/<region>/sf-corridor-3d.json``) were built on
28 September from the same footprints as the website's, with the mapped kerb ramps added --
and without what had been measured for each building. Every app region but Oakland lost
it: the Mission's 4,327 sampled wall colours, the Sunset's 3,727 photographed facades, a
lidar roof height on 1,509 Mission buildings that the app drew at the default height
instead. The website's copy (``docs/regions/<region>/``) kept them, and it is the app that
people open.

So each app building takes, from the website building with the same OpenStreetMap id and the
same footprint, what the app does not have: its colour, its facade, its address and shops,
and its measured height where the app's is only the default or the storey count. Nothing the
app has is overwritten, and a building whose footprint differs is left alone.

    .venv/bin/python tools/restore_app_building_measurements.py
"""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
#: Taken where the app has nothing.
FILLED = ("colour", "colour_basis", "facade", "address", "shops", "underground", "garages",
          "parcel", "zoning")
#: A measured height replaces one of these, never a mapper's.
WEAK_HEIGHTS = {None, "inferred_default", "osm_levels"}
MEASURED_HEIGHTS = {"lidar_region", "datasf_lidar_median_height", "osm_height"}


def restore(app: dict, web: dict) -> Counter:
    counts: Counter = Counter()
    by_id = {w.get("osm_id"): w for w in web.get("ways", []) if w.get("kind") == "building"}
    for way in app.get("ways", []):
        if way.get("kind") != "building":
            continue
        source = by_id.get(way.get("osm_id"))
        if source is None or source.get("points") != way.get("points"):
            counts["unmatched"] += 1
            continue
        for key in FILLED:
            if source.get(key) and not way.get(key):
                way[key] = source[key]
                counts[key] += 1
        if (way.get("height_source") in WEAK_HEIGHTS
                and source.get("height_source") in MEASURED_HEIGHTS):
            for key in ("height_m", "height_source", "height_points"):
                if key in source:
                    way[key] = source[key]
            counts["height"] += 1
    return counts


def main() -> int:
    for app_path in sorted((DOCS / "app-regions").glob("*/sf-corridor-3d.json")):
        region = app_path.parent.name
        web_path = DOCS / "regions" / region / "sf-corridor-3d.json"
        if not web_path.exists():
            continue
        app = json.loads(app_path.read_text())
        counts = restore(app, json.loads(web_path.read_text()))
        if sum(v for k, v in counts.items() if k != "unmatched"):
            app_path.write_text(json.dumps(app, separators=(",", ":")))
        print(f"{region}: " + (", ".join(f"{k} {v}" for k, v in sorted(counts.items())) or "nothing to restore"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
