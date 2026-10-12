#!/usr/bin/env python3
"""Parking meters and Muni's trolleybus wires into every region's street furniture.

Two kinds of thing a walk down a San Francisco street is full of and the model had none of:

  parking meters   SFMTA's own inventory (DataSF 8vzz-qzz9, public domain): every metered space,
                   with its post, its meter type and its cap colour. Kept: on-street meters in
                   service (active flag M). A single-space meter is a head on a post -- two heads
                   where two spaces share the post; a multi-space pay station is one kiosk for all
                   the spaces it serves, at the middle of them. Outside San Francisco, the parking
                   ticket machines OpenStreetMap maps (amenity=vending_machine, vending=parking_
                   tickets).
  trolley wires    the streets OpenStreetMap marks trolley_wire=yes: Muni's overhead contact
                   wires, the most visible wiring in the city -- 539 street segments in the
                   corridor alone, where OpenStreetMap maps no power line and no pole.

Written into each furniture file whose area they fall in: ``geometry_based.parking_meters``
(SFMTA's), ``inferred.parking_meters`` (OpenStreetMap's) and ``inferred.trolley_wires``; then
the files' windowed cells are cut again (tools/build_window_cells.py).

    .venv/bin/python scripts/ingest_kerb_assets.py [--refresh]
"""

from __future__ import annotations

import argparse
import json
import runpy
import statistics
import sys
import time
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from smc.net import use_certifi  # noqa: E402

CACHE = ROOT / "build" / "kerb_assets"
DATASF = "https://data.sf.gov/resource/8vzz-qzz9.json"
OVERPASS = ("https://maps.mail.ru/osm/tools/overpass/api/interpreter",
            "https://overpass-api.de/api/interpreter")
USER_AGENT = "Kerbside street furniture ingest (https://spatial-data-mapping.vercel.app)"
METER_FIELDS = ("post_id", "ms_pay_station_id", "meter_type", "cap_color", "street_name", "street_num",
                "longitude", "latitude", "active_meter_flag", "on_offstreet_type")


def fetch(url: str, data: bytes | None = None, timeout: int = 180) -> bytes:
    request = urllib.request.Request(url, data=data, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def sfmta_meters(refresh: bool) -> list[dict]:
    path = CACHE / "sfmta-parking-meters.json"
    if path.exists() and not refresh:
        return json.loads(path.read_text())
    rows, offset = [], 0
    where = "active_meter_flag='M' AND on_offstreet_type='ON'"
    while True:
        query = urllib.parse.urlencode({"$select": ",".join(METER_FIELDS), "$where": where,
                                        "$limit": 50000, "$offset": offset, "$order": "objectid"})
        page = json.loads(fetch(f"{DATASF}?{query}"))
        rows += page
        if len(page) < 50000:
            break
        offset += 50000
    CACHE.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(rows))
    return rows


def meters_from_rows(rows: list[dict]) -> list[dict]:
    """One record per post (single-space heads) and per pay station (multi-space kiosk)."""
    posts, stations = defaultdict(list), defaultdict(list)
    for row in rows:
        try:
            lon, lat = float(row["longitude"]), float(row["latitude"])
        except (KeyError, TypeError, ValueError):
            continue
        station = row.get("ms_pay_station_id") or "-"
        if row.get("meter_type") == "MS" and station not in {"-", ""}:
            stations[station].append((lon, lat, row))
        elif row.get("post_id"):
            posts[row["post_id"]].append((lon, lat, row))
    out = []
    for post, spaces in posts.items():
        lon, lat, row = spaces[0]
        out.append({"id": f"sfmta:parking_meter:{post}", "kind": "parking_meter", "p": [round(lon, 7), round(lat, 7)],
                    "meter_type": "single_space", "heads": min(2, len(spaces)),
                    "cap_color": (row.get("cap_color") or "-").lower(),
                    "street": " ".join(filter(None, [row.get("street_num"), row.get("street_name")])),
                    "source": "sfmta_parking_meters", "provenance": "official_meter_inventory"})
    for station, spaces in stations.items():
        lon = statistics.median(s[0] for s in spaces)
        lat = statistics.median(s[1] for s in spaces)
        row = spaces[0][2]
        out.append({"id": f"sfmta:pay_station:{station}", "kind": "parking_meter", "p": [round(lon, 7), round(lat, 7)],
                    "meter_type": "pay_station", "spaces": len(spaces),
                    "street": row.get("street_name"), "source": "sfmta_parking_meters",
                    "provenance": "official_meter_inventory"})
    return out


def overpass(bbox: dict, refresh: bool, name: str) -> dict:
    path = CACHE / f"osm-kerb-{name}.json"
    if path.exists() and not refresh:
        return json.loads(path.read_text())
    b = f"{bbox['south']},{bbox['west']},{bbox['north']},{bbox['east']}"
    query = (f'[out:json][timeout:120];(node["amenity"="vending_machine"]["vending"="parking_tickets"]({b});'
             f'way["trolley_wire"="yes"]({b}););out geom tags;')
    last = None
    # The public mirrors are busy and fail now and then: each is tried a few times, patiently.
    for attempt in range(4):
        for mirror in OVERPASS:
            try:
                data = json.loads(fetch(mirror, urllib.parse.urlencode({"data": query}).encode(), timeout=240))
                CACHE.mkdir(parents=True, exist_ok=True)
                path.write_text(json.dumps(data))
                return data
            except (OSError, ValueError) as error:
                last = error
                time.sleep(10 * (attempt + 1))
    raise RuntimeError(f"no Overpass mirror answered for {name}: {last}")


def osm_assets(data: dict) -> tuple[list[dict], list[dict]]:
    machines, wires = [], []
    for element in data.get("elements", []):
        tags = element.get("tags") or {}
        if element["type"] == "node" and tags.get("vending") == "parking_tickets":
            machines.append({"id": f"osm:parking_meter:node:{element['id']}", "kind": "parking_meter",
                             "p": [element["lon"], element["lat"]], "meter_type": "pay_station",
                             "source": "osm_overpass", "provenance": "inferred_from_osm_tags"})
        elif element["type"] == "way" and tags.get("trolley_wire") == "yes" and element.get("geometry"):
            lanes = tags.get("lanes")
            wires.append({"id": f"osm:trolley_wire:way:{element['id']}", "kind": "trolley_wire",
                          "points": [[g["lon"], g["lat"]] for g in element["geometry"]],
                          "oneway": tags.get("oneway") in {"yes", "1", "true"},
                          "lanes": int(lanes) if lanes and lanes.isdigit() else None,
                          "name": tags.get("name"), "source": "osm_overpass",
                          "provenance": "inferred_from_osm_tags"})
    return machines, wires


def inside(bbox: dict, lon: float, lat: float) -> bool:
    return bbox["west"] <= lon <= bbox["east"] and bbox["south"] <= lat <= bbox["north"]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--refresh", action="store_true")
    args = ap.parse_args()
    use_certifi()
    files = [ROOT / "docs/sf-corridor-furniture.json",
             *sorted((ROOT / "docs/regions").glob("*/sf-corridor-furniture.json")),
             *sorted((ROOT / "docs/app-regions").glob("*/sf-corridor-furniture.json"))]
    meters = meters_from_rows(sfmta_meters(args.refresh))
    cut = runpy.run_path(str(ROOT / "tools/build_window_cells.py"))["cut"]
    report = {}
    for path in files:
        document = json.loads(path.read_text())
        bbox = document.get("bbox")
        if not bbox:
            continue
        region = path.parent.name if path.parent.name != "docs" else "sf-corridor"
        machines, wires = osm_assets(overpass(bbox, args.refresh, region))
        official = [m for m in meters if inside(bbox, *m["p"])]
        document.setdefault("geometry_based", {})["parking_meters"] = official
        document.setdefault("inferred", {})["parking_meters"] = [m for m in machines
            if not any(abs(m["p"][0] - o["p"][0]) < 2e-5 and abs(m["p"][1] - o["p"][1]) < 2e-5 for o in official)]
        document["inferred"]["trolley_wires"] = wires
        sources = {s.get("id") for s in document.get("sources", []) if isinstance(s, dict)}
        if "sfmta_parking_meters" not in sources:
            document.setdefault("sources", []).append({
                "id": "sfmta_parking_meters", "name": "Parking Meters (SFMTA)", "url": "https://data.sf.gov/d/8vzz-qzz9",
                "license": "Open Data Commons Public Domain Dedication and License",
                "provenance": "official_meter_inventory",
                "methodology": "On-street meters in service (active flag M); one record per post or pay station."})
        path.write_text(json.dumps(document, separators=(",", ":")) + "\n")
        if (path.parent / "cells/sf-corridor-furniture/manifest.json").exists():
            cut(path)
        report[str(path.relative_to(ROOT))] = {"sfmta_meters": len(official),
                                               "osm_parking_machines": len(document["inferred"]["parking_meters"]),
                                               "trolley_wire_ways": len(wires)}
    print(json.dumps(report, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
