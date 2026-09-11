#!/usr/bin/env python3
"""Publish inferred street furniture separately from measured corridor geometry."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import time
import urllib.parse
import urllib.request
from collections import Counter
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "build" / "street_furniture"
OUT = ROOT / "docs" / "sf-corridor-furniture.json"
CORRIDOR = {"south": 37.786, "west": -122.4475, "north": 37.8095, "east": -122.392}

OVERPASS_MIRRORS = (
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.osm.ch/api/interpreter",
)

OSM_SELECTORS = (
    'node["highway"~"^(bus_stop|stop|give_way|traffic_signals)$"]',
    'node["public_transport"="platform"]["bus"="yes"]',
    'node["traffic_sign"]',
    'node["amenity"="shelter"]',
    'node["shelter_type"="public_transport"]',
    'node["advertising"]',
    'way["highway"~"^(bus_stop|stop|give_way|traffic_signals)$"]',
    'way["public_transport"="platform"]["bus"="yes"]',
    'way["traffic_sign"]',
    'way["amenity"="shelter"]',
    'way["shelter_type"="public_transport"]',
    'way["advertising"]',
)

MUNI_STOP_SPECS = {
    "source": "https://www.sfmta.com/accessibility-strategy-needs-assessment-2024/muni-capital-projects/35-improved-bus-stop-amenities",
    "source_accessed": "2026-09-10",
    "official_geometry": {
        "stop_types": ["bus_zone", "bus_bulb", "transit_island", "flag_stop"],
        "bus_bulb_front_door_width_m": [2.44, 3.66],
        "transit_island_min_width_m": 2.44,
        "transit_island_min_length_m": 45.72,
        "transit_island_height_m": [0.152, 0.203],
        "transit_island_low_height_exception_m": 0.051,
    },
    "inferred_shelter_mesh": {
        "length_m": 4.0,
        "depth_m": 1.45,
        "height_m": 2.6,
        "ad_panel_m": [1.2, 1.8],
        "provenance": "inferred_standard_mesh_from_osm_shelter_tag",
        "note": "SFMTA source verifies stop types and amenities, but does not publish shelter dimensions on that page.",
    },
}


def overpass_query(bbox: dict[str, float]) -> str:
    area = f"{bbox['south']},{bbox['west']},{bbox['north']},{bbox['east']}"
    body = "".join(f"{selector}({area});" for selector in OSM_SELECTORS)
    return f"[out:json][timeout:120];({body});out tags geom;"


def fetch_overpass(bbox: dict[str, float], *, refresh: bool, progress=print) -> list[dict[str, Any]]:
    CACHE.mkdir(parents=True, exist_ok=True)
    query = overpass_query(bbox)
    key = hashlib.blake2b(query.encode(), digest_size=8).hexdigest()
    path = CACHE / f"osm_furniture-{key}.json"
    if path.exists() and not refresh:
        elements = json.loads(path.read_text(encoding="utf-8"))
        progress(f"osm furniture: {len(elements)} elements from cache")
        return elements
    data = urllib.parse.urlencode({"data": query}).encode()
    last: Exception | None = None
    for mirror in OVERPASS_MIRRORS:
        try:
            request = urllib.request.Request(
                mirror,
                data=data,
                headers={"User-Agent": "spatial-mapping-crowdsource/furniture"},
            )
            with urllib.request.urlopen(request, timeout=240) as response:
                payload = json.loads(response.read().decode("utf-8"))
            elements = payload.get("elements") or []
            path.write_text(json.dumps(elements, separators=(",", ":")), encoding="utf-8")
            progress(f"osm furniture: {len(elements)} elements from {mirror.split('/')[2]}")
            return elements
        except Exception as exc:  # noqa: BLE001
            last = exc
            progress(f"  overpass {mirror.split('/')[2]}: {exc}")
    progress(f"osm furniture: all Overpass mirrors failed ({last}); publishing empty layer")
    return []


def element_point(element: dict[str, Any]) -> tuple[float, float, str] | None:
    if element.get("type") == "node" and "lon" in element and "lat" in element:
        return float(element["lon"]), float(element["lat"]), "osm_node"
    geometry = [
        (float(p["lon"]), float(p["lat"]))
        for p in element.get("geometry") or []
        if "lon" in p and "lat" in p
    ]
    if not geometry:
        return None
    lon = sum(p[0] for p in geometry) / len(geometry)
    lat = sum(p[1] for p in geometry) / len(geometry)
    return lon, lat, "osm_way_centroid"


def bearing_from_tags(tags: dict[str, str]) -> float | None:
    for key in ("direction", "camera:direction", "traffic_sign:direction"):
        value = tags.get(key)
        if value is None:
            continue
        try:
            return float(value) % 360
        except ValueError:
            pass
    return None


def advertising_kind(tags: dict[str, str]) -> str:
    ad = (tags.get("advertising") or tags.get("advertising:medium") or "board").lower()
    if "billboard" in ad:
        return "billboard"
    if "column" in ad:
        return "column"
    if "poster" in ad:
        return "poster"
    return "board"


def sign_kind(tags: dict[str, str]) -> str | None:
    highway = (tags.get("highway") or "").lower()
    traffic_sign = (tags.get("traffic_sign") or "").lower()
    if highway == "stop" or "stop" in traffic_sign:
        return "stop"
    if highway == "give_way" or "yield" in traffic_sign or "give_way" in traffic_sign:
        return "yield"
    if highway == "traffic_signals":
        return "traffic_signal"
    if traffic_sign:
        return "generic"
    return None


def base_record(element: dict[str, Any], kind: str, lon: float, lat: float, basis: str) -> dict[str, Any]:
    tags = {str(k): str(v) for k, v in (element.get("tags") or {}).items()}
    return {
        "id": f"osm:{kind}:{element.get('type')}:{element.get('id')}",
        "kind": kind,
        "p": [round(lon, 6), round(lat, 6)],
        "source": "osm_overpass",
        "license": "ODbL",
        "provenance": "inferred_from_osm_tags",
        "geometry_basis": basis,
        "confidence": 0.58 if basis == "osm_node" else 0.42,
        "bearing": bearing_from_tags(tags),
        "tags": {k: tags[k] for k in sorted(tags) if k in {
            "advertising", "advertising:medium", "amenity", "direction", "highway",
            "name", "network", "operator", "public_transport", "ref", "route_ref",
            "shelter", "shelter_type", "traffic_sign",
        }},
    }


def records_from_osm(elements: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    out: dict[str, list[dict[str, Any]]] = {
        "street_signs": [],
        "bus_stops": [],
        "shelters": [],
        "ad_panels": [],
    }
    seen: set[str] = set()
    for element in elements:
        located = element_point(element)
        if not located:
            continue
        lon, lat, basis = located
        tags = {str(k): str(v) for k, v in (element.get("tags") or {}).items()}

        if tags.get("highway") == "bus_stop" or (
            tags.get("public_transport") == "platform" and tags.get("bus") == "yes"
        ):
            record = base_record(element, "bus_stop", lon, lat, basis)
            record["stop_geometry"] = {
                "basis": "osm_stop_anchor",
                "render_default": "flag_stop",
                "provenance": "inferred",
            }
            if record["id"] not in seen:
                out["bus_stops"].append(record)
                seen.add(record["id"])

        if tags.get("amenity") == "shelter" or tags.get("shelter_type") == "public_transport":
            record = base_record(element, "shelter", lon, lat, basis)
            record["spec"] = "muni_inferred_shelter_mesh"
            if record["id"] not in seen:
                out["shelters"].append(record)
                seen.add(record["id"])

        if "advertising" in tags or "advertising:medium" in tags:
            record = base_record(element, "ad_panel", lon, lat, basis)
            record["ad_kind"] = advertising_kind(tags)
            record["creative"] = "blank_white_placeholder"
            if record["id"] not in seen:
                out["ad_panels"].append(record)
                seen.add(record["id"])

        skind = sign_kind(tags)
        if skind:
            record = base_record(element, "street_sign", lon, lat, basis)
            record["sign_kind"] = skind
            if record["id"] not in seen:
                out["street_signs"].append(record)
                seen.add(record["id"])
    return out


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, default=OUT)
    parser.add_argument("--refresh", action="store_true")
    args = parser.parse_args()

    elements = fetch_overpass(CORRIDOR, refresh=args.refresh)
    inferred = records_from_osm(elements)
    counts = {key: len(value) for key, value in inferred.items()}
    osm_tag_counts = Counter()
    for element in elements:
        for key in (element.get("tags") or {}):
            if key in ("advertising", "amenity", "highway", "public_transport", "shelter_type", "traffic_sign"):
                osm_tag_counts[key] += 1

    data = {
        "schema_version": 1,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "bbox": CORRIDOR,
        "separation_policy": {
            "inferred": "OSM tags and point/way anchors; useful for visualization but not measured geometry.",
            "geometry_based": "Reserved for future official footprints/asset points/field-measured meshes; kept out of inferred arrays.",
        },
        "sources": [
            {
                "id": "osm_overpass",
                "license": "ODbL",
                "provenance": "inferred_from_osm_tags",
                "geometry_basis": "osm node coordinate or way centroid",
            },
            {
                "id": "sfmta_bus_stop_amenity_specs",
                "license": "public agency web page",
                "provenance": "official_stop_type_dimensions",
                "url": MUNI_STOP_SPECS["source"],
            },
        ],
        "specs": {"muni": MUNI_STOP_SPECS},
        "inferred": inferred,
        "geometry_based": {
            "street_signs": [],
            "bus_stops": [],
            "shelters": [],
            "ad_panels": [],
        },
        "summary": {
            "available": True,
            "osm_elements": len(elements),
            "inferred_counts": counts,
            "geometry_based_counts": {key: 0 for key in inferred},
            "osm_tag_counts": dict(osm_tag_counts),
            "storage_note": "Street furniture is published as a lazy sidecar and is not embedded in sf-corridor-3d.json.",
        },
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(data, separators=(",", ":"), sort_keys=True), encoding="utf-8")
    print(f"{args.out} -> {args.out.stat().st_size / 1e3:.1f} kB")
    print(json.dumps(data["summary"], indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
