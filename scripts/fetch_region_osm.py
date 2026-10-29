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
import math
import runpy
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from smc.imagery.region import SF_CORRIDOR, get_region  # noqa: E402


def response_floor(capabilities: dict, bounds: list[float], default: int = 2000) -> int:
    """A small cell is not the entire corridor. Require a matching independent probe."""
    if capabilities.get("bbox") != bounds:
        return default
    counts = capabilities.get("osm", {})
    values = [counts.get(k) for k in ("highway_ways", "buildings")]
    if not all(isinstance(v, int) and not isinstance(v, bool) and v >= 0 for v in values):
        return default
    return max(1, math.ceil(sum(values) * .8))


#: Mirrors that hold the whole planet. overpass.osm.ch holds Switzerland and answers anywhere
#: else at once with nothing, so it is never the one asked how much a cell should hold.
GLOBAL_MIRRORS = (
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
)
#: The fetch may come in under its own count by this much: the map is edited between the two.
COUNT_TOLERANCE = 0.9


def count_query(query: str) -> str:
    """The fetch's own query, counted: the same statements, ``out count`` for ``out geom``."""
    if not query.endswith(");out geom;"):
        raise ValueError("expected an Overpass union ending in out geom")
    return query[:-len("out geom;")] + "out count;"


def _get(url: str, timeout: float = 120) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "Kerbside/0.1 SF corridor 3D viewer"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def expected_elements(query: str, *, fetch=_get, attempts: int = 3, pause_s: float = 20) -> int | None:
    """How many elements the fetch should bring back, from a whole-planet mirror's count of the
    very same query -- or None when none would say.

    The capabilities probe counts every highway way and every building, so a suburb of fire
    roads, farm tracks and a salt pond's levees came in under 80% of it however honestly it was
    answered; and when that probe had failed the floor was a flat 2,000. Every cell with less
    than that -- Millbrae's bay shore, the San Mateo and East Bay flats -- was refused by every
    mirror, every try, and quarantined."""
    counted = count_query(query)
    for attempt in range(attempts):
        for mirror in GLOBAL_MIRRORS:
            try:
                answer = json.loads(fetch(mirror + "?" + urllib.parse.urlencode({"data": counted})))
                if answer.get("remark"):  # a timeout or a refusal, not a count
                    raise RuntimeError(str(answer["remark"])[:200])
                totals = [e.get("tags", {}) for e in answer.get("elements", []) if e.get("type") == "count"]
                return int(totals[0]["total"])
            except Exception as exc:  # noqa: BLE001 - any failure means ask the next mirror
                print(f"  count {mirror.split('/')[2]}: {exc}", file=sys.stderr)
        time.sleep(pause_s * (attempt + 1))
    return None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("region")
    args = ap.parse_args()
    region = get_region(args.region)
    builder = runpy.run_path(str(ROOT / "scripts" / "build_sf_corridor_3d.py"), run_name="kerbside_builder")
    caps_path = ROOT / "data/regions" / region.name / "capabilities.json"
    caps = json.loads(caps_path.read_text()) if caps_path.exists() else {}
    b = region.bbox
    expected = expected_elements(builder["overpass_query"](region.bbox))
    if expected == 0:
        # Open water, or a cell nothing has been mapped in: there is nothing to build here, and
        # an empty fetch is never written over the cache.
        print(f"{region.name}: OpenStreetMap has nothing in this cell's bounds; not built", file=sys.stderr)
        return 2  # the count answered nought; a retry asks the same question
    if expected is not None:
        floor = max(1, math.floor(expected * COUNT_TOLERANCE))
        print(f"{region.name}: {expected} elements counted; the fetch must bring at least {floor}")
    else:
        floor = response_floor(caps, [b.south, b.west, b.north, b.east])
    ways = builder["fetch_osm"](region.bbox, minimum_elements=floor)
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
