#!/usr/bin/env python3
"""Parking meters, Muni's trolleybus wires, utility poles and small cells into every region's
street furniture.

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

  utility poles    Mapillary's map features (object--support--utility-pole): each a pole
                   Mapillary placed from the several photographs it was detected in. OpenStreetMap
                   maps a few dozen poles in most of these regions and none in the corridor;
                   Mapillary has a hundred in a few Mission blocks. The renderer strings the
                   distribution wires from pole to pole (addElectricalNetwork). Its parking
                   meters (object--parking-meter) too, where no official meter stands.
                   Mapillary's data is CC BY-SA 4.0.
  small cells      Public Works' wireless service facility permits (DataSF xtj2-daw9, public
                   domain): the antennas carriers have put on the city's poles. Approved and
                   active permits, one site per position.

Written into each furniture file whose area they fall in: ``geometry_based.parking_meters``
(SFMTA's), ``inferred.parking_meters`` (OpenStreetMap's), ``inferred.trolley_wires``,
``inferred.detected_utility_poles`` and ``inferred.detected_parking_meters`` (Mapillary's) and
``geometry_based.small_cells``; then the files' windowed cells are cut again
(tools/build_window_cells.py).

    .venv/bin/python scripts/ingest_kerb_assets.py [--refresh]
"""

from __future__ import annotations

import argparse
import json
import os
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
from smc.config import load_env_file  # noqa: E402
from smc.net import use_certifi  # noqa: E402

CACHE = ROOT / "build" / "kerb_assets"
DATASF = "https://data.sf.gov/resource/8vzz-qzz9.json"
WIRELESS = "https://data.sf.gov/resource/xtj2-daw9.json"
MAPILLARY = "https://graph.mapillary.com/map_features"
MAPILLARY_VALUES = ("object--support--utility-pole", "object--parking-meter")
#: A Mapillary page holds at most this many features; a tile that fills one is split.
MAPILLARY_PAGE = 2000
#: Features not seen since then are taken to be gone.
MAPILLARY_SEEN_SINCE = "2018-01-01"
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


def mapillary_features(bbox: dict, token: str, refresh: bool, name: str) -> list[dict]:
    """Every utility pole and parking meter Mapillary has placed in the area, tile by tile."""
    path = CACHE / f"mapillary-kerb-{name}.json"
    if path.exists() and not refresh:
        return json.loads(path.read_text())
    out: dict[str, dict] = {}

    def tile(west: float, south: float, east: float, north: float, depth: int = 0) -> None:
        query = urllib.parse.urlencode({
            "access_token": token, "fields": "id,object_value,geometry,first_seen_at,last_seen_at",
            "bbox": f"{west:.6f},{south:.6f},{east:.6f},{north:.6f}",
            "object_values": ",".join(MAPILLARY_VALUES), "limit": MAPILLARY_PAGE})
        for attempt in range(4):
            try:
                page = json.loads(fetch(f"{MAPILLARY}?{query}", timeout=120)).get("data", [])
                break
            except (OSError, ValueError):
                time.sleep(5 * (attempt + 1))
        else:
            raise RuntimeError(f"Mapillary did not answer for a tile of {name}")
        if len(page) >= MAPILLARY_PAGE and depth < 6:
            mx, my = (west + east) / 2, (south + north) / 2
            for box in ((west, south, mx, my), (mx, south, east, my), (west, my, mx, north), (mx, my, east, north)):
                tile(*box, depth + 1)
            return
        for feature in page:
            out[str(feature["id"])] = feature

    step = 0.005
    west = bbox["west"]
    while west < bbox["east"]:
        south = bbox["south"]
        while south < bbox["north"]:
            tile(west, south, min(west + step, bbox["east"]), min(south + step, bbox["north"]))
            south += step
        west += step
    features = list(out.values())
    CACHE.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(features))
    return features


def detected_assets(features: list[dict]) -> tuple[list[dict], list[dict]]:
    """Mapillary's poles and meters as furniture records; ones not seen in years are dropped."""
    poles, meters = [], []
    for feature in features:
        geometry = feature.get("geometry") or {}
        coordinates = geometry.get("coordinates") or []
        if geometry.get("type") != "Point" or len(coordinates) < 2:
            continue
        seen = feature.get("last_seen_at")
        if isinstance(seen, (int, float)):
            seen = time.strftime("%Y-%m-%d", time.gmtime(seen / 1000))
        if seen and str(seen)[:10] < MAPILLARY_SEEN_SINCE:
            continue
        base = {"p": [round(coordinates[0], 7), round(coordinates[1], 7)], "last_seen": str(seen)[:10] if seen else None,
                "source": "mapillary_map_features", "provenance": "mapillary_detected_map_feature",
                "mapillary_feature_id": str(feature["id"])}
        if feature.get("object_value") == "object--support--utility-pole":
            poles.append({"id": f"mapillary:utility_pole:{feature['id']}", "kind": "utility_pole", **base})
        elif feature.get("object_value") == "object--parking-meter":
            meters.append({"id": f"mapillary:parking_meter:{feature['id']}", "kind": "parking_meter",
                           "meter_type": "single_space", "heads": 1, "cap_color": "-", **base})
    return poles, meters


def sf_small_cells(refresh: bool) -> list[dict]:
    """Public Works' wireless facility permits in force: one small cell per position."""
    path = CACHE / "sfdpw-wireless-permits.json"
    if path.exists() and not refresh:
        rows = json.loads(path.read_text())
    else:
        query = urllib.parse.urlencode({
            "$select": "permit_number,permit_purpose,permit_status,permit_approval_date,longitude,latitude",
            "$where": "permit_status in ('APPROVED','ACTIVE')", "$limit": 50000})
        rows = json.loads(fetch(f"{WIRELESS}?{query}"))
        CACHE.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(rows))
    sites: dict[tuple, dict] = {}
    for row in sorted(rows, key=lambda r: str(r.get("permit_approval_date") or ""), reverse=True):
        try:
            lon, lat = float(row["longitude"]), float(row["latitude"])
        except (KeyError, TypeError, ValueError):
            continue
        key = (round(lon, 5), round(lat, 5))
        if key in sites:
            continue
        sites[key] = {"id": f"sfdpw:small_cell:{row.get('permit_number')}", "kind": "small_cell",
                      "p": [round(lon, 7), round(lat, 7)], "purpose": row.get("permit_purpose"),
                      "approved": str(row.get("permit_approval_date") or "")[:10] or None,
                      "source": "sfdpw_wireless_permits", "provenance": "official_permit_location"}
    return list(sites.values())


def off_trolley_lines(poles: list[dict], wires: list[dict], metres: float = 10.0) -> list[dict]:
    """Poles that are not Muni's: a pole within ``metres`` of a trolleybus wire's street holds the
    wire up, and the renderer draws those itself (addTrolleyWires), span wires and all."""
    cell = 0.001
    grid = defaultdict(list)
    for wire in wires:
        points = wire.get("points") or []
        for (ax, ay), (bx, by) in zip(points, points[1:]):
            for gx in range(int(min(ax, bx) / cell) - 1, int(max(ax, bx) / cell) + 2):
                for gy in range(int(min(ay, by) / cell) - 1, int(max(ay, by) / cell) + 2):
                    grid[(gx, gy)].append((ax, ay, bx, by))

    def distance(p, seg) -> float:
        ax, ay, bx, by = seg
        kx, ky = 88000.0, 111000.0
        dx, dy = (bx - ax) * kx, (by - ay) * ky
        px, py = (p[0] - ax) * kx, (p[1] - ay) * ky
        t = max(0.0, min(1.0, (px * dx + py * dy) / (dx * dx + dy * dy))) if dx or dy else 0.0
        return ((px - t * dx) ** 2 + (py - t * dy) ** 2) ** 0.5

    return [pole for pole in poles
            if not any(distance(pole["p"], seg) < metres
                       for seg in grid.get((int(pole["p"][0] / cell), int(pole["p"][1] / cell)), ()))]


def near(a: list, b: list, metres: float) -> bool:
    return abs(a[0] - b[0]) * 88000 < metres and abs(a[1] - b[1]) * 111000 < metres


def dedupe(items: list[dict], against: list[dict], metres: float) -> list[dict]:
    """``items`` with none within ``metres`` of one of ``against`` (a coarse grid, not pairwise)."""
    cell = metres / 88000
    grid = defaultdict(list)
    for other in against:
        grid[(int(other["p"][0] / cell), int(other["p"][1] / cell))].append(other["p"])
    out = []
    for item in items:
        gx, gy = int(item["p"][0] / cell), int(item["p"][1] / cell)
        if not any(near(item["p"], q, metres) for dx in (-1, 0, 1) for dy in (-1, 0, 1) for q in grid[(gx + dx, gy + dy)]):
            out.append(item)
    return out


def inside(bbox: dict, lon: float, lat: float) -> bool:
    return bbox["west"] <= lon <= bbox["east"] and bbox["south"] <= lat <= bbox["north"]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--refresh", action="store_true")
    args = ap.parse_args()
    use_certifi()
    load_env_file(ROOT / ".env.local")
    token = os.environ.get("MAPILLARY_TOKEN") or os.environ.get("MAPILLARY_ACCESS_TOKEN")
    if not token:
        raise SystemExit("MAPILLARY_TOKEN is not set (.env.local)")
    files = [ROOT / "docs/sf-corridor-furniture.json",
             *sorted((ROOT / "docs/regions").glob("*/sf-corridor-furniture.json")),
             *sorted((ROOT / "docs/app-regions").glob("*/sf-corridor-furniture.json"))]
    meters = meters_from_rows(sfmta_meters(args.refresh))
    cells = sf_small_cells(args.refresh)
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
        poles, seen_meters = detected_assets(mapillary_features(bbox, token, args.refresh, region))
        poles = off_trolley_lines([p for p in poles if inside(bbox, *p["p"])], wires)
        document["inferred"]["detected_utility_poles"] = dedupe(poles, document["inferred"].get("utility_poles") or [], 7.0)
        document["inferred"]["detected_parking_meters"] = dedupe(
            [m for m in seen_meters if inside(bbox, *m["p"])],
            official + document["inferred"]["parking_meters"], 8.0)
        document["geometry_based"]["small_cells"] = [c for c in cells if inside(bbox, *c["p"])]
        sources = {s.get("id") for s in document.get("sources", []) if isinstance(s, dict)}
        if "sfmta_parking_meters" not in sources:
            document.setdefault("sources", []).append({
                "id": "sfmta_parking_meters", "name": "Parking Meters (SFMTA)", "url": "https://data.sf.gov/d/8vzz-qzz9",
                "license": "Open Data Commons Public Domain Dedication and License",
                "provenance": "official_meter_inventory",
                "methodology": "On-street meters in service (active flag M); one record per post or pay station."})
        for source in ({"id": "mapillary_map_features", "name": "Mapillary map features",
                        "url": "https://www.mapillary.com/developer/api-documentation",
                        "license": "CC BY-SA 4.0", "attribution": "© Mapillary",
                        "provenance": "mapillary_detected_map_feature",
                        "methodology": "Utility poles and parking meters Mapillary placed from several detections; "
                                       "not seen since 2018 dropped; within 7 m of a mapped pole (8 m of a meter) dropped; "
                                       "within 10 m of a trolleybus wire dropped (Muni's span poles, drawn with the wires)."},
                       {"id": "sfdpw_wireless_permits", "name": "Wireless Service Facility Permits (SF Public Works)",
                        "url": "https://data.sfgov.org/d/xtj2-daw9",
                        "license": "Open Data Commons Public Domain Dedication and License",
                        "provenance": "official_permit_location",
                        "methodology": "Approved and active permits; one small cell per position."}):
            if source["id"] not in sources:
                document["sources"].append(source)
        path.write_text(json.dumps(document, separators=(",", ":")) + "\n")
        if (path.parent / "cells/sf-corridor-furniture/manifest.json").exists():
            cut(path)
        report[str(path.relative_to(ROOT))] = {"sfmta_meters": len(official),
                                               "osm_parking_machines": len(document["inferred"]["parking_meters"]),
                                               "trolley_wire_ways": len(wires),
                                               "mapillary_poles": len(document["inferred"]["detected_utility_poles"]),
                                               "mapillary_meters": len(document["inferred"]["detected_parking_meters"]),
                                               "small_cells": len(document["geometry_based"]["small_cells"])}
    print(json.dumps(report, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
