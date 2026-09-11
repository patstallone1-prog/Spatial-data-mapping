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

ARCGIS_ROOT = "https://services.sfmta.com/arcgis/rest/services"
ARCGIS_LAYERS = {
    "sfmta_signs": {
        "service": "Traffic/traffic/MapServer",
        "layer": 6,
        "name": "MTA.signs",
        "where": "STATUS_CODE='IS'",
        "license": "City and County of San Francisco open data",
        "provenance": "official_sign_shop_asset_inventory",
        "methodology": "SFMTA sign shop assets manually added and updated via Sign Shop Web Map Editor.",
    },
    "sfmta_stop_signs": {
        "service": "Traffic/traffic/MapServer",
        "layer": 10,
        "name": "MTA.stopsigns",
        "where": "1=1",
        "license": "City and County of San Francisco open data",
        "provenance": "official_mtab_stop_sign_inventory",
        "methodology": "SFMTA stop-sign inventory manually updated from MTAB resolutions.",
    },
    "sfmta_traffic_signals": {
        "service": "Traffic/traffic/MapServer",
        "layer": 7,
        "name": "MTA.signals",
        "where": "1=1",
        "license": "City and County of San Francisco open data",
        "provenance": "official_signal_inventory",
        "methodology": "SFMTA traffic signal, flasher, and related-equipment inventory.",
    },
    "sfmta_curb_zones": {
        "service": "Parking/parking/MapServer",
        "layer": 21,
        "name": "MTA.curb_zones_all_policies",
        "where": "1=1",
        "license": "City and County of San Francisco open data",
        "provenance": "official_digital_curb_policy_polyline",
        "methodology": "SFMTA Digital Curb policy linework by block face.",
    },
    "sfmta_color_curbs": {
        "service": "Parking/parking/MapServer",
        "layer": 18,
        "name": "MTA.colorcurb",
        "where": "1=1",
        "license": "City and County of San Francisco open data",
        "provenance": "official_color_curb_asset_point",
        "methodology": "SFMTA Color Curb Program asset points as published in the Parking service.",
    },
}

ARCGIS_PAGE = 2000

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


def arcgis_query_url(layer: dict[str, Any], bbox: dict[str, float], offset: int) -> str:
    params: dict[str, str | int] = {
        "where": str(layer["where"]),
        "outFields": "*",
        "returnGeometry": "true",
        "geometry": f"{bbox['west']},{bbox['south']},{bbox['east']},{bbox['north']}",
        "geometryType": "esriGeometryEnvelope",
        "inSR": "4326",
        "outSR": "4326",
        "spatialRel": "esriSpatialRelIntersects",
        "resultOffset": offset,
        "resultRecordCount": ARCGIS_PAGE,
        "f": "geojson",
    }
    return (
        f"{ARCGIS_ROOT}/{layer['service']}/{layer['layer']}/query?"
        f"{urllib.parse.urlencode(params)}"
    )


def fetch_arcgis_layer(
    key: str,
    bbox: dict[str, float],
    *,
    refresh: bool,
    progress=print,
) -> list[dict[str, Any]]:
    layer = ARCGIS_LAYERS[key]
    CACHE.mkdir(parents=True, exist_ok=True)
    cache_key = hashlib.blake2b(
        json.dumps([key, bbox, layer["where"]], sort_keys=True).encode(),
        digest_size=8,
    ).hexdigest()
    path = CACHE / f"{key}-{cache_key}.geojson"
    if path.exists() and not refresh:
        features = json.loads(path.read_text(encoding="utf-8"))
        progress(f"{layer['name']}: {len(features)} features from cache")
        return features

    features: list[dict[str, Any]] = []
    while True:
        try:
            request = urllib.request.Request(
                arcgis_query_url(layer, bbox, len(features)),
                headers={"User-Agent": "spatial-mapping-crowdsource/furniture"},
            )
            with urllib.request.urlopen(request, timeout=180) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except Exception as exc:  # noqa: BLE001
            progress(f"{layer['name']}: official fetch failed ({exc}); keeping layer empty")
            return []
        page = payload.get("features") or []
        features.extend(page)
        if len(page) < ARCGIS_PAGE:
            break
    path.write_text(json.dumps(features, separators=(",", ":")), encoding="utf-8")
    progress(f"{layer['name']}: {len(features)} official features")
    return features


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


def bearing_from_facing(value: Any) -> float | None:
    text = str(value or "").strip().upper().replace(".", "")
    if not text:
        return None
    mapping = {
        "N": 180.0,
        "NB": 180.0,
        "NORTH": 180.0,
        "S": 0.0,
        "SB": 0.0,
        "SOUTH": 0.0,
        "E": 270.0,
        "EB": 270.0,
        "EAST": 270.0,
        "W": 90.0,
        "WB": 90.0,
        "WEST": 90.0,
        "NE": 225.0,
        "NW": 135.0,
        "SE": 315.0,
        "SW": 45.0,
    }
    return mapping.get(text)


def first_bearing(*values: Any) -> float | None:
    for value in values:
        bearing = bearing_from_facing(value)
        if bearing is not None:
            return bearing
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


def geojson_point(feature: dict[str, Any]) -> tuple[float, float] | None:
    geometry = feature.get("geometry") or {}
    coords = geometry.get("coordinates")
    if geometry.get("type") == "Point" and isinstance(coords, list) and len(coords) >= 2:
        return float(coords[0]), float(coords[1])
    if geometry.get("type") == "MultiPoint" and coords:
        lon = sum(float(p[0]) for p in coords) / len(coords)
        lat = sum(float(p[1]) for p in coords) / len(coords)
        return lon, lat
    props = feature.get("properties") or {}
    lon = props.get("POINT_X") or props.get("GPS_LONGITUDE") or props.get("LONGITUDE")
    lat = props.get("POINT_Y") or props.get("GPS_LATITUDE") or props.get("LATITUDE")
    if lon is not None and lat is not None:
        return float(lon), float(lat)
    return None


def geojson_lines(feature: dict[str, Any]) -> list[list[list[float]]]:
    geometry = feature.get("geometry") or {}
    coords = geometry.get("coordinates") or []
    if geometry.get("type") == "LineString":
        return [[[round(float(p[0]), 7), round(float(p[1]), 7)] for p in coords if len(p) >= 2]]
    if geometry.get("type") == "MultiLineString":
        return [
            [[round(float(p[0]), 7), round(float(p[1]), 7)] for p in line if len(p) >= 2]
            for line in coords
        ]
    return []


def official_sign_kind(props: dict[str, Any]) -> str | None:
    category = str(props.get("SIGN_CATEGORY") or "").upper()
    code = str(props.get("SIGN_CODE") or "").upper()
    legend = str(props.get("LEGEND") or "").upper()
    if category == "STOP" or code.startswith("R1-1") or legend == "STOP":
        return "stop"
    if legend == "ALL WAY":
        return "all_way"
    if "YIELD" in legend or code.startswith("R1-2"):
        return "yield"
    if "NPRK" in legend or "NO PARK" in legend or "NO PARKING" in category:
        return "no_parking"
    if "LOADING" in legend or "TAXI" in legend or "TANSAT" in legend:
        return "loading"
    if "STREET CLEANING" in category:
        return "parking_restriction"
    if "PARKING" in category:
        return "parking"
    if "STREET NAME" in category:
        return "street_name"
    return "regulatory" if category or legend or code else None


def curb_color(props: dict[str, Any]) -> str | None:
    text = " ".join(
        str(props.get(key) or "")
        for key in (
            "POLICY_CATEGORY",
            "POLICY_SUB_CATEGORY",
            "POLICY_SUPER_CATEGORY",
            "CZ_PRIMARY_CURB_POLICY",
            "ZONE_TYPE",
            "LABEL",
        )
    ).lower()
    if "accessible" in text or "blue zone" in text:
        return "blue"
    if "commercial loading" in text or "six wheeled" in text or "6-wheel" in text or "yellow zone" in text:
        return "yellow"
    if "passenger loading" in text or "whitezone" in text or "white zone" in text:
        return "white"
    if "short term" in text or "green zone" in text:
        return "green"
    if "transit vehicle loading" in text or "munizone" in text:
        return "red"
    if "no parking" in text or "driveway red" in text or "crosswalk" in text:
        return "red"
    return None


def records_from_official(
    features_by_layer: dict[str, list[dict[str, Any]]],
) -> dict[str, list[dict[str, Any]]]:
    out: dict[str, list[dict[str, Any]]] = {
        "street_signs": [],
        "traffic_signals": [],
        "curb_zones": [],
        "color_curbs": [],
        "bus_stops": [],
        "shelters": [],
        "ad_panels": [],
    }
    seen_sign_ids: set[str] = set()

    for feature in features_by_layer.get("sfmta_stop_signs", []):
        props = feature.get("properties") or {}
        point = geojson_point(feature)
        if not point:
            continue
        record = {
            "id": f"sfmta:stop_sign:{props.get('OBJECTID')}",
            "kind": "street_sign",
            "sign_kind": "stop",
            "p": [round(point[0], 6), round(point[1], 6)],
            "source": "sfmta_stop_signs",
            "license": ARCGIS_LAYERS["sfmta_stop_signs"]["license"],
            "provenance": ARCGIS_LAYERS["sfmta_stop_signs"]["provenance"],
            "geometry_basis": "official_asset_point",
            "confidence": 0.92,
            "bearing": first_bearing(props.get("ST_FACING"), props.get("DIRECTION")),
            "orientation_basis": "ST_FACING approach direction; sign face inferred opposite traffic approach",
            "face_policy": "single_sided_from_approach_heading",
            "label": "STOP",
            "tags": {
                key: props.get(key)
                for key in ("STREET", "X_STREET", "DIRECTION", "ST_FACING", "CNN", "STATUS", "ASSET_ID")
                if props.get(key) not in (None, "", " ")
            },
        }
        out["street_signs"].append(record)
        seen_sign_ids.add(record["id"])

    for feature in features_by_layer.get("sfmta_signs", []):
        props = feature.get("properties") or {}
        kind = official_sign_kind(props)
        point = geojson_point(feature)
        if not kind or not point or kind == "stop":
            continue
        record_id = f"sfmta:sign:{props.get('ASSET_ID') or props.get('OBJECTID_1') or props.get('OBJECTID')}"
        if record_id in seen_sign_ids:
            continue
        record = {
            "id": record_id,
            "kind": "street_sign",
            "sign_kind": kind,
            "p": [round(point[0], 6), round(point[1], 6)],
            "source": "sfmta_signs",
            "license": ARCGIS_LAYERS["sfmta_signs"]["license"],
            "provenance": ARCGIS_LAYERS["sfmta_signs"]["provenance"],
            "geometry_basis": "official_asset_point",
            "confidence": 0.82,
            "bearing": first_bearing(props.get("ST_FACING"), props.get("CORNER_SIDE_FACING")),
            "orientation_basis": "SFMTA ST_FACING/CORNER_SIDE_FACING when available",
            "face_policy": "single_sided_when_facing_known",
            "label": str(props.get("LEGEND") or props.get("SIGN_CATEGORY") or "")[:64],
            "tags": {
                key: props.get(key)
                for key in ("SIGN_CODE", "LEGEND", "SIGN_CATEGORY", "SIGN_CLASS", "ARROW_DIR", "STSIDE", "CNN")
                if props.get(key) not in (None, "", " ")
            },
        }
        out["street_signs"].append(record)
        seen_sign_ids.add(record_id)

    for feature in features_by_layer.get("sfmta_traffic_signals", []):
        props = feature.get("properties") or {}
        point = geojson_point(feature)
        if not point:
            continue
        out["traffic_signals"].append({
            "id": f"sfmta:traffic_signal:{props.get('OBJECTID')}",
            "kind": "traffic_signal",
            "p": [round(point[0], 6), round(point[1], 6)],
            "source": "sfmta_traffic_signals",
            "license": ARCGIS_LAYERS["sfmta_traffic_signals"]["license"],
            "provenance": ARCGIS_LAYERS["sfmta_traffic_signals"]["provenance"],
            "geometry_basis": "official_asset_point",
            "confidence": 0.88,
            "signal_type": props.get("TYPE"),
            "tags": {
                key: props.get(key)
                for key in ("STREET1", "STREET2", "STREET3", "STREET4", "TYPE", "PED_SIGNAL", "APS")
                if props.get(key) not in (None, "", " ")
            },
        })

    for feature in features_by_layer.get("sfmta_curb_zones", []):
        props = feature.get("properties") or {}
        lines = [line for line in geojson_lines(feature) if len(line) >= 2]
        color = curb_color(props)
        if not lines or not color:
            continue
        out["curb_zones"].append({
            "id": f"sfmta:curb_zone:{props.get('CURB_ZONE_ID') or props.get('OBJECTID')}",
            "kind": "curb_zone",
            "lines": lines,
            "curb_color": color,
            "source": "sfmta_curb_zones",
            "license": ARCGIS_LAYERS["sfmta_curb_zones"]["license"],
            "provenance": ARCGIS_LAYERS["sfmta_curb_zones"]["provenance"],
            "geometry_basis": "official_digital_curb_polyline",
            "confidence": 0.90,
            "policy_category": props.get("POLICY_CATEGORY"),
            "policy_super_category": props.get("POLICY_SUPER_CATEGORY"),
            "label": props.get("LABEL"),
            "length_ft": props.get("LENGTH_FT"),
            "side_of_street": props.get("SIDE_OF_STREET"),
            "street_name": props.get("STREET_NAME"),
        })

    for feature in features_by_layer.get("sfmta_color_curbs", []):
        props = feature.get("properties") or {}
        point = geojson_point(feature)
        color = curb_color(props)
        if not point or not color:
            continue
        out["color_curbs"].append({
            "id": f"sfmta:color_curb:{props.get('OBJECTID') or props.get('OBJECTID_1')}",
            "kind": "color_curb_asset",
            "p": [round(point[0], 6), round(point[1], 6)],
            "curb_color": color,
            "source": "sfmta_color_curbs",
            "license": ARCGIS_LAYERS["sfmta_color_curbs"]["license"],
            "provenance": ARCGIS_LAYERS["sfmta_color_curbs"]["provenance"],
            "geometry_basis": "official_color_curb_asset_point",
            "confidence": 0.78,
            "zone_type": props.get("ZONE_TYPE"),
            "length_ft": props.get("FEET"),
            "subject_location": props.get("SUBJECT_LO"),
            "zone_specs": props.get("ZONE_SPECS"),
        })
    return out


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
    official_features = {
        key: fetch_arcgis_layer(key, CORRIDOR, refresh=args.refresh)
        for key in ARCGIS_LAYERS
    }
    geometry_based = records_from_official(official_features)
    geometry_counts = {key: len(value) for key, value in geometry_based.items()}
    osm_tag_counts = Counter()
    for element in elements:
        for key in (element.get("tags") or {}):
            if key in ("advertising", "amenity", "highway", "public_transport", "shelter_type", "traffic_sign"):
                osm_tag_counts[key] += 1

    data = {
        "schema_version": 2,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "bbox": CORRIDOR,
        "separation_policy": {
            "inferred": "OSM tags and point/way anchors; useful for visualization but not measured geometry.",
            "geometry_based": "Official SFMTA asset points and curb-zone linework, plus future field-measured meshes; kept out of inferred arrays.",
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
            *[
                {
                    "id": key,
                    "name": layer["name"],
                    "license": layer["license"],
                    "provenance": layer["provenance"],
                    "url": f"{ARCGIS_ROOT}/{layer['service']}/{layer['layer']}",
                    "methodology": layer["methodology"],
                }
                for key, layer in ARCGIS_LAYERS.items()
            ],
        ],
        "specs": {"muni": MUNI_STOP_SPECS},
        "inferred": inferred,
        "geometry_based": geometry_based,
        "summary": {
            "available": True,
            "osm_elements": len(elements),
            "inferred_counts": counts,
            "official_feature_counts": {key: len(value) for key, value in official_features.items()},
            "geometry_based_counts": geometry_counts,
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
