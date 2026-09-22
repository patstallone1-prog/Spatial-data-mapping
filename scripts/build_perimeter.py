#!/usr/bin/env python3
"""The country round the map, five miles out from every rendered region and all the country
between them: land, water and the bridges that leave the regions.

    python scripts/build_perimeter.py             # -> docs/sf-corridor-perimeter.json, and every built region's site
    python scripts/build_perimeter.py --refetch   # ignore the cached Overpass answer

One box round every region that has been built, widened by five miles; the coastline, the
water bodies, the bay and the bridge ways for it from Overpass (cached under build/perimeter);
a 40 m grid classified land or water by flooding from the regions' own ground grids' water
and the map's bay (smc.terrain.perimeter); the bridges whole. The one file is written beside
the corridor's page and copied beside every region's, so each site stays self-contained and
every page draws the same country.
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

import numpy as np  # noqa: E402

from smc.imagery.region import SF_CORRIDOR, load_regions  # noqa: E402
from smc.net import use_certifi  # noqa: E402
from smc.terrain.perimeter import (  # noqa: E402
    PERIMETER_M,
    atlas_cells,
    beaches,
    built_up,
    bridges,
    classify,
    frame_for,
    perimeter_query,
    region_water_seeds,
    union_box,
    write_perimeter,
)

use_certifi()

MIRRORS = ("https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter")
CACHE = ROOT / "build" / "perimeter"


def site_of(name: str) -> Path:
    return ROOT / "docs" if name == SF_CORRIDOR.name else ROOT / "data" / "regions" / name / "site"


def fetch(query: str, cache: Path) -> list[dict]:
    if cache.exists():
        return json.loads(cache.read_text()).get("elements", [])
    last = None
    for attempt in range(3):
        for mirror in MIRRORS:
            request = urllib.request.Request(mirror + "?" + urllib.parse.urlencode({"data": query}),
                                             headers={"User-Agent": "Kerbside/0.1 perimeter"})
            try:
                with urllib.request.urlopen(request, timeout=900) as response:
                    data = json.loads(response.read().decode("utf-8"))
                # An answer with a remark is a mirror under load, not an answer. An empty
                # answer with none is the open sea: a tile off Half Moon Bay has nothing in it.
                if "error" not in str(data.get("remark") or "").lower() and "elements" in data:
                    cache.parent.mkdir(parents=True, exist_ok=True)
                    cache.write_text(json.dumps(data))
                    return data["elements"]
                last = RuntimeError(f"thin answer: {len(data.get('elements') or [])} elements, {data.get('remark')}")
            except Exception as exc:
                last = exc
                print(f"  overpass {mirror.split('/')[2]}: {exc}", file=sys.stderr)
        time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"every Overpass mirror refused the perimeter query: {last}")


#: The atlas is fetched in tiles: eighty kilometres of coast, salt pond and bridge in one
#: answer is more than a public Overpass mirror gives before its gateway times out.
FETCH_TILES = 6


def fetch_tiled(box: dict, stem: str) -> list[dict]:
    """The perimeter query over ``box`` in FETCH_TILES x FETCH_TILES pieces, each cached on its
    own, the answers joined with every element once."""
    seen: set[tuple[str, int]] = set()
    elements: list[dict] = []
    dlat = (box["north"] - box["south"]) / FETCH_TILES
    dlon = (box["east"] - box["west"]) / FETCH_TILES
    for r in range(FETCH_TILES):
        for c in range(FETCH_TILES):
            south, west = box["south"] + r * dlat, box["west"] + c * dlon
            for element in fetch(perimeter_query(south, west, south + dlat, west + dlon),
                                 CACHE / f"{stem}-{r}-{c}.json"):
                key = (element.get("type"), element.get("id"))
                if key in seen:
                    continue
                seen.add(key)
                elements.append(element)
            print(f"  tile {r},{c}: {len(elements)} elements so far", flush=True)
    return elements


def widened_for_bridges(box: dict, elements: list[dict]) -> dict | None:
    """The box grown to take in every bridge way that runs past it (with a margin for the
    touchdown), or None when none does. A bridge that leaves the box has to reach the far
    shore, and the far shore has to be there to reach."""
    reach = dict(box)
    grew = False
    for element in elements:
        tags = element.get("tags") or {}
        if element.get("type") != "way" or not tags.get("bridge"):
            continue
        for p in element.get("geometry") or []:
            if "lon" not in p:
                continue
            if p["lon"] < reach["west"]:
                reach["west"], grew = p["lon"] - 0.01, True
            if p["lon"] > reach["east"]:
                reach["east"], grew = p["lon"] + 0.01, True
            if p["lat"] < reach["south"]:
                reach["south"], grew = p["lat"] - 0.008, True
            if p["lat"] > reach["north"]:
                reach["north"], grew = p["lat"] + 0.008, True
    return reach if grew else None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--refetch", action="store_true", help="fetch from Overpass even when the answer is cached")
    args = ap.parse_args()
    regions = load_regions()
    built = {name: site_of(name) for name in regions if (site_of(name) / "sf-corridor-terrain.bin").exists()}
    if not built:
        print("no region has a terrain grid; the perimeter needs their water", file=sys.stderr)
        return 1
    boxes = [{"south": regions[n].bbox.south, "west": regions[n].bbox.west,
              "north": regions[n].bbox.north, "east": regions[n].bbox.east} for n in built]
    box = union_box(boxes)
    frame = frame_for(box)
    if args.refetch:
        for stale in CACHE.glob("atlas-overpass*.json"):
            stale.unlink()
    b = frame["bbox"]
    print(f"atlas of {len(built)} regions: {b['west']:.3f}..{b['east']:.3f} x {b['south']:.3f}..{b['north']:.3f}, "
          f"{frame['cols']}x{frame['rows']} cells", flush=True)
    elements = fetch_tiled(b, "atlas-overpass")
    wide = widened_for_bridges(b, elements)
    if wide:
        frame = frame_for(box, wide=wide)
        b = frame["bbox"]
        print(f"  widened for the bridges to {b['west']:.3f}..{b['east']:.3f} x {b['south']:.3f}..{b['north']:.3f}, "
              f"{frame['cols']}x{frame['rows']} cells", flush=True)
        elements = fetch_tiled(b, "atlas-overpass-wide")
    seeds = np.zeros((frame["rows"], frame["cols"]), dtype=bool)
    buildings: list[list[float]] = []
    for site in built.values():
        seeds |= region_water_seeds(frame, site / "sf-corridor-terrain.bin")
        payload = site / "sf-corridor-3d.json"
        if payload.exists():
            buildings.extend(w["centroid"] for w in json.loads(payload.read_text()).get("ways", [])
                             if w.get("kind") == "building" and w.get("centroid"))
    print(f"  {int(seeds.sum())} seed cells from the regions' grids, {len(buildings)} buildings", flush=True)
    water, counts = classify(elements, frame, seeds, buildings)
    sand = beaches(elements, frame, water)
    counts["cells_beach"] = int(sand.sum())
    town = built_up(buildings, frame, water)
    counts["cells_built"] = int(town.sum())
    cells = atlas_cells(water, sand, town)
    spans = bridges(elements, frame, water)
    source = (f"OpenStreetMap via Overpass, {time.strftime('%Y-%m-%d')}, {PERIMETER_M / 1609.344:.0f} miles "
              f"round {len(built)} regions and the country between them")
    for site in built.values():
        out = site / "sf-corridor-perimeter.json"
        write_perimeter(out, frame, cells, spans, counts, source=source, regions=sorted(built))
    out = site_of(SF_CORRIDOR.name) / "sf-corridor-perimeter.json"
    print(f"{frame['cols']}x{frame['rows']} cells, {counts['cells_water']} water, {counts['cells_beach']} beach "
          f"and {counts['cells_built']} built-up of {counts['cells']}, "
          f"{counts['coastline_ways']} coastline ways, {counts['water_polygons']} water polygons, "
          f"{counts['bodies']} bodies ({counts['bodies_rejected_as_land']} rejected as land), "
          f"{len(spans)} bridge ways -> {out.relative_to(ROOT)} ({out.stat().st_size / 1e3:.0f} kB) "
          f"and {len(built) - 1} region sites")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
