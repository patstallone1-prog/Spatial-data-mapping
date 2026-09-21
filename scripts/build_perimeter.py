#!/usr/bin/env python3
"""The country round a region, five miles out: land, water and the bridges that leave it.

    python scripts/build_perimeter.py                     # the corridor -> docs/sf-corridor-perimeter.json
    python scripts/build_perimeter.py --region oakland-downtown

Fetches the coastline, the water bodies and the bridge ways for the region's box widened by
five miles from Overpass (cached beside the output), classifies a 40 m grid land or water by
flooding from the region's own ground grid's water (smc.terrain.perimeter), and writes the
grid, the bridges and the counts. Runs as part of the region build; the page draws it as the
grass and the sea round the city and the decks across it.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from smc.imagery.region import SF_CORRIDOR, get_region  # noqa: E402
from smc.net import use_certifi  # noqa: E402
from smc.terrain.perimeter import (  # noqa: E402
    PERIMETER_M,
    bridges,
    classify,
    frame_for,
    perimeter_query,
    region_water_seeds,
    write_perimeter,
)

use_certifi()

MIRRORS = ("https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter")


def fetch(query: str, cache: Path) -> list[dict]:
    if cache.exists():
        return json.loads(cache.read_text()).get("elements", [])
    last = None
    for attempt in range(3):
        for mirror in MIRRORS:
            request = urllib.request.Request(mirror + "?" + urllib.parse.urlencode({"data": query}),
                                             headers={"User-Agent": "Kerbside/0.1 perimeter"})
            try:
                with urllib.request.urlopen(request, timeout=240) as response:
                    data = json.loads(response.read().decode("utf-8"))
                if (data.get("elements") or []) and "error" not in str(data.get("remark") or "").lower():
                    cache.parent.mkdir(parents=True, exist_ok=True)
                    cache.write_text(json.dumps(data))
                    return data["elements"]
                last = RuntimeError(f"thin answer: {len(data.get('elements') or [])} elements, {data.get('remark')}")
            except Exception as exc:  # noqa: BLE001
                last = exc
                print(f"  overpass {mirror.split('/')[2]}: {exc}", file=sys.stderr)
        time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"every Overpass mirror refused the perimeter query: {last}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--region", default=SF_CORRIDOR.name)
    args = ap.parse_args()
    region = get_region(args.region)
    corridor = region.name == SF_CORRIDOR.name
    site = ROOT / "docs" if corridor else ROOT / "data" / "regions" / region.name / "site"
    grid = site / "sf-corridor-terrain.bin"
    if not grid.exists():
        print(f"{region.name}: no terrain grid at {grid}; the perimeter needs its water", file=sys.stderr)
        return 1
    region_frame = json.loads(grid.with_suffix(".json").read_text())["frame"]
    bbox = {"south": region.bbox.south, "west": region.bbox.west, "north": region.bbox.north, "east": region.bbox.east}
    frame = frame_for(bbox, region_frame)
    b = frame["bbox"]
    cache = ROOT / "build" / "perimeter" / f"{region.name}-overpass.json"
    elements = fetch(perimeter_query(b["south"], b["west"], b["north"], b["east"]), cache)
    # A bridge that leaves the box has to reach the far shore, and the far shore has to be
    # there to reach: where the fetched bridge ways run past the box, the box is widened to
    # take them in (with a margin for the touchdown) and the country fetched again for it.
    reach = frame_for(bbox, region_frame)["bbox"]
    grew = False
    for element in elements:
        tags = element.get("tags") or {}
        if element.get("type") != "way" or not tags.get("bridge"):
            continue
        for p in element.get("geometry") or []:
            if "lon" not in p:
                continue
            if p["lon"] < reach["west"]: reach["west"], grew = p["lon"] - 0.01, True
            if p["lon"] > reach["east"]: reach["east"], grew = p["lon"] + 0.01, True
            if p["lat"] < reach["south"]: reach["south"], grew = p["lat"] - 0.008, True
            if p["lat"] > reach["north"]: reach["north"], grew = p["lat"] + 0.008, True
    if grew:
        frame = frame_for(bbox, region_frame, wide=reach)
        b = frame["bbox"]
        cache = ROOT / "build" / "perimeter" / f"{region.name}-overpass-wide.json"
        elements = fetch(perimeter_query(b["south"], b["west"], b["north"], b["east"]), cache)
        print(f"  widened for the bridges to {b['west']:.3f}..{b['east']:.3f} x {b['south']:.3f}..{b['north']:.3f}")
    seeds = region_water_seeds(frame, grid)
    payload = site / "sf-corridor-3d.json"
    buildings = []
    if payload.exists():
        buildings = [w["centroid"] for w in json.loads(payload.read_text()).get("ways", [])
                     if w.get("kind") == "building" and w.get("centroid")]
    water, counts = classify(elements, frame, seeds, buildings)
    spans = bridges(elements, frame, water)
    out = site / "sf-corridor-perimeter.json"
    write_perimeter(out, frame, water, spans, counts,
                    source=f"OpenStreetMap via Overpass, {time.strftime('%Y-%m-%d')}, {PERIMETER_M / 1609.344:.0f} miles round the region")
    print(f"{region.name}: {frame['cols']}x{frame['rows']} cells, {counts['cells_water']} water of {counts['cells']}, "
          f"{counts['coastline_ways']} coastline ways, {counts['water_polygons']} water polygons, "
          f"{len(spans)} bridge ways -> {out.relative_to(ROOT)} ({out.stat().st_size / 1e3:.0f} kB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
