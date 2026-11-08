"""Publish the Bay's carpool and express lanes for the viewer (smc.highways.lanes).

    .venv/bin/python scripts/build_managed_lanes.py                 # fetch from Overpass, publish
    .venv/bin/python scripts/build_managed_lanes.py --cache hov.json  # from a saved Overpass answer

Writes docs/managed-lanes.json: one segment a way, its line and which of its lanes are managed.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from smc.highways.lanes import BASIS, lanes_from_overpass  # noqa: E402

#: The Bay Area, south to San Jose and north to the Carquinez Strait: (south, west, north, east).
BBOX = (37.1, -122.6, 38.2, -121.6)
ENDPOINT = "https://overpass-api.de/api/interpreter"


def query(bbox=BBOX) -> str:
    b = ",".join(str(v) for v in bbox)
    roads = "motorway|trunk|motorway_link|trunk_link|primary"
    return (f'[out:json][timeout:180];(way["highway"~"^({roads})$"]["hov:lanes"]({b});'
            f'way["highway"~"^({roads})$"]["hov"~"designated|lane"]({b});'
            f'way["highway"~"^({roads})$"]["toll:hov"]({b}););out tags geom;')


def fetch(bbox=BBOX) -> dict:
    data = urllib.parse.urlencode({"data": query(bbox)}).encode()
    request = urllib.request.Request(ENDPOINT, data=data, headers={"User-Agent": "kerbside-map-builder/1.0"})
    with urllib.request.urlopen(request, timeout=300) as response:
        return json.load(response)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--cache", type=Path, help="an Overpass JSON answer to read instead of fetching")
    parser.add_argument("--out", type=Path, default=ROOT / "docs" / "managed-lanes.json")
    args = parser.parse_args(argv)
    answer = json.loads(args.cache.read_text()) if args.cache else fetch()
    lanes = lanes_from_overpass(answer.get("elements", []))
    payload = {
        "schema": "kerbside.managed_lanes/1",
        "source": "OpenStreetMap contributors (ODbL), via Overpass",
        "basis": BASIS,
        "bbox": {"south": BBOX[0], "west": BBOX[1], "north": BBOX[2], "east": BBOX[3]},
        "counts": {"hov": sum(lane.kind == "hov" for lane in lanes), "express": sum(lane.kind == "express" for lane in lanes)},
        "lanes": [lane.to_json() for lane in lanes],
    }
    args.out.write_text(json.dumps(payload, separators=(",", ":")) + "\n")
    shown = args.out.relative_to(ROOT) if args.out.resolve().is_relative_to(ROOT) else args.out
    print(f"{shown}: {payload['counts']['hov']} carpool and {payload['counts']['express']} "
          f"express segments, {args.out.stat().st_size / 1e6:.2f} MB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
