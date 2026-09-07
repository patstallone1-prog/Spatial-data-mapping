"""Merge building facts from OSM, public records, Overture, and Places.

The important boundary is provenance. OSM/Overture buildings can seed a
non-commercial viewer and reference geometry, San Francisco records can be
durable official facts, and Google Places is a refreshable place signal. Keeping
them separate lets the renderer improve today without silently turning a future
commercial facts table into a provider-licensed derivative.
"""

from __future__ import annotations

import hashlib
import math
import re
from collections.abc import Iterable, Mapping
from datetime import UTC, datetime, timedelta
from typing import Any

GOOGLE_PLACES_CACHE_DAYS = 30
SMALL_SINGLE_TENANT_AREA_M2 = 900.0
INPUT_HEIGHT_SOURCES = {"osm_height", "osm_levels", "inferred_default", "osm_or_renderer_height"}

ADDRESS_KEYS = (
    "addr:housenumber",
    "addr:street",
    "addr:unit",
    "addr:city",
    "addr:state",
    "addr:postcode",
    "addr:full",
)

BUSINESS_KEYS = (
    "amenity",
    "shop",
    "tourism",
    "leisure",
    "office",
    "craft",
    "healthcare",
    "club",
    "man_made",
    "landuse",
    "building",
)

ARCHETYPE_TYPES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("gas_station", ("gas_station", "fuel")),
    ("park", ("park", "playground", "garden", "recreation_ground")),
    ("mini_golf", ("mini_golf",)),
    ("parking", ("parking", "parking_lot", "parking_garage")),
    ("school", ("school", "university", "college", "kindergarten")),
    ("hotel", ("lodging", "hotel", "motel")),
    ("civic", ("hospital", "fire_station", "police", "church", "place_of_worship", "library")),
    ("restaurant", ("restaurant", "cafe", "bar", "bakery", "food")),
    ("retail", ("store", "supermarket", "pharmacy", "bank", "shop", "retail")),
    ("office", ("office", "commercial")),
    ("industrial", ("industrial", "warehouse")),
    ("residential", ("apartments", "house", "residential", "detached", "terrace",
                     "semidetached_house", "dormitory", "bungalow", "hut", "cabin")),
)

#: OpenStreetMap building values that describe a *shape* rather than a use. They were being
#: returned as archetypes in their own right, so the renderer was asked to draw a "ship", a
#: "tent" and an "urban_pioneer" -- none of which is a kind of building it knows how to be.
STRUCTURE_ONLY = frozenset({
    "roof", "shed", "carport", "garage", "garages", "hangar", "greenhouse", "ship", "tent",
    "grandstand", "pavilion", "service", "bridge", "toilets", "container", "kiosk",
    "transformer_tower", "water_tower", "silo", "storage_tank", "urban_pioneer", "construction",
})

#: Values that are a use, but one of the archetypes already covers it.
STRUCTURE_ALIASES = {
    "train_station": "civic",
    "terminal": "civic",
    "transportation": "civic",
    "museum": "civic",
    "public": "civic",
    "hostel": "hotel",
    "mixed_use": "office",
}

WHOLE_PLACE_ARCHETYPES = {
    "gas_station",
    "park",
    "mini_golf",
    "parking",
    "school",
    "hotel",
    "civic",
}


def _closed_ring(points: Iterable[Iterable[float]]) -> list[list[float]]:
    ring = [[float(p[0]), float(p[1])] for p in points]
    if ring and ring[0] == ring[-1]:
        ring = ring[:-1]
    return ring


def building_centroid(points: Iterable[Iterable[float]]) -> list[float]:
    """Return a stable lon/lat centroid for a footprint-like ring."""
    ring = _closed_ring(points)
    if not ring:
        return [0.0, 0.0]
    origin_lon = ring[0][0]
    origin_lat = ring[0][1]
    local = [(p[0] - origin_lon, p[1] - origin_lat) for p in ring]
    signed = 0.0
    cx = 0.0
    cy = 0.0
    for a, b in zip(local, local[1:] + local[:1]):
        cross = a[0] * b[1] - b[0] * a[1]
        signed += cross
        cx += (a[0] + b[0]) * cross
        cy += (a[1] + b[1]) * cross
    if abs(signed) < 1e-18:
        return [
            round(sum(p[0] for p in ring) / len(ring), 7),
            round(sum(p[1] for p in ring) / len(ring), 7),
        ]
    return [
        round(origin_lon + cx / (3 * signed), 7),
        round(origin_lat + cy / (3 * signed), 7),
    ]


def building_area_m2(points: Iterable[Iterable[float]]) -> float:
    ring = _closed_ring(points)
    if len(ring) < 3:
        return 0.0
    lon0 = sum(p[0] for p in ring) / len(ring)
    lat0 = sum(p[1] for p in ring) / len(ring)
    scale_x = 111_320.0 * math.cos(math.radians(lat0))
    scale_y = 111_320.0
    local = [((p[0] - lon0) * scale_x, (p[1] - lat0) * scale_y) for p in ring]
    area = 0.0
    for a, b in zip(local, local[1:] + local[:1]):
        area += a[0] * b[1] - b[0] * a[1]
    return abs(area) / 2.0


def building_id(feature: Mapping[str, Any], index: int | None = None) -> str:
    """Stable identity usable before every source has its own durable ID."""
    existing = feature.get("building_id")
    if existing:
        return str(existing)
    osm_id = feature.get("osm_id")
    if osm_id:
        return f"osm:way:{osm_id}"
    centroid = feature.get("centroid") or building_centroid(feature.get("points") or [])
    first = (feature.get("points") or [[0.0, 0.0]])[0]
    basis = f"{centroid}|{first}|{index if index is not None else ''}"
    digest = hashlib.blake2b(basis.encode("utf-8"), digest_size=8).hexdigest()
    return f"footprint:{digest}"


def building_address(feature: Mapping[str, Any]) -> dict[str, str]:
    if feature.get("address"):
        return dict(feature["address"])
    tags = feature.get("tags") or feature
    full = tags.get("addr:full")
    if full:
        return {"formatted": str(full)}
    parts = {
        "house_number": tags.get("addr:housenumber"),
        "street": tags.get("addr:street"),
        "unit": tags.get("addr:unit"),
        "city": tags.get("addr:city"),
        "state": tags.get("addr:state"),
        "postcode": tags.get("addr:postcode"),
    }
    clean = {key: str(value) for key, value in parts.items() if value not in (None, "")}
    line = " ".join(v for v in (clean.get("house_number"), clean.get("street")) if v)
    if clean.get("unit"):
        line = f"{line} {clean['unit']}".strip()
    if line:
        city_line = ", ".join(v for v in (clean.get("city"), clean.get("state")) if v)
        formatted = ", ".join(v for v in (line, city_line, clean.get("postcode")) if v)
        clean["formatted"] = formatted
    return clean


def parcel_address(parcel: Mapping[str, Any]) -> dict[str, str]:
    street = " ".join(
        str(parcel.get(key, "")).strip()
        for key in ("street_name", "street_type")
        if parcel.get(key)
    ).strip().title()
    number = str(parcel.get("from_address_num") or "").strip()
    if not number or not street:
        return {}
    formatted = f"{number} {street}, San Francisco, CA"
    return {"house_number": number, "street": street, "city": "San Francisco", "state": "CA", "formatted": formatted}


def archetype_for(
    *,
    place_types: Iterable[str] = (),
    land_use: str | None = None,
    building: str | None = None,
    name: str | None = None,
) -> str:
    tokens = {str(t).lower().replace(" ", "_") for t in place_types if t}
    for value in (land_use, building, name):
        if value:
            tokens.update(part for part in str(value).lower().replace("-", "_").split() if part)
            tokens.add(str(value).lower().replace(" ", "_"))
    for archetype, needles in ARCHETYPE_TYPES:
        if any(needle in tokens for needle in needles):
            return archetype
    if building in (None, "", "yes"):
        return "generic"
    value = str(building).lower().replace(" ", "_")
    if value in STRUCTURE_ALIASES:
        return STRUCTURE_ALIASES[value]
    # Anything left is either a shape rather than a use, or a value nothing downstream knows
    # how to draw. Both are generic: inventing an archetype from an unrecognised tag gives the
    # renderer a type it has no rule for, which is worse than admitting we do not know.
    return "generic"


def _tokens(value: str | None) -> set[str]:
    if not value:
        return set()
    return {token for token in re.split(r"[^a-z0-9]+", value.lower()) if token}


def _street_tokens(address: Mapping[str, Any] | None) -> set[str]:
    if not address:
        return set()
    street = str(address.get("street") or "")
    if not street and address.get("formatted"):
        street = str(address["formatted"])
    return _tokens(street) - {"street", "st", "avenue", "ave", "road", "rd", "boulevard", "blvd"}


def score_google_place_for_building(
    building: Mapping[str, Any],
    place: Mapping[str, Any],
    *,
    distance_m: float,
) -> dict[str, Any]:
    """Score whether a Places hit represents the building, not just a tenant."""
    score = 0
    reasons: list[str] = []

    if distance_m <= 12:
        score += 3
        reasons.append("near_centroid")
    elif distance_m <= 25:
        score += 2
        reasons.append("near_building")
    elif distance_m <= 50:
        score += 1
        reasons.append("within_search_radius")

    address = building.get("address") or {}
    formatted = str(place.get("formatted_address") or "")
    address_tokens = _tokens(formatted)
    house_number = str(address.get("house_number") or "").strip().lower()
    street_tokens = _street_tokens(address)
    address_score = 0
    if house_number and house_number in address_tokens:
        address_score += 2
    if street_tokens and street_tokens.issubset(address_tokens):
        address_score += 2
    elif street_tokens and street_tokens & address_tokens:
        address_score += 1
    if address_score >= 4:
        reasons.append("address_match")
    elif address_score:
        reasons.append("address_partial")
    score += address_score

    building_name = str(building.get("name") or "")
    place_name = str(place.get("name") or "")
    building_name_tokens = _tokens(building_name)
    place_name_tokens = _tokens(place_name)
    name_score = 0
    if building_name_tokens and place_name_tokens:
        overlap = len(building_name_tokens & place_name_tokens)
        coverage = overlap / max(1, len(building_name_tokens))
        if coverage >= 0.75:
            name_score = 4
            reasons.append("name_match")
        elif coverage >= 0.4:
            name_score = 2
            reasons.append("name_partial")
    score += name_score

    place_archetype = str(place.get("archetype") or "generic")
    building_archetype = str(building.get("archetype") or "generic")
    whole_place = place_archetype in WHOLE_PLACE_ARCHETYPES
    if whole_place:
        score += 2
        reasons.append("whole_place_type")
    elif place_archetype != "generic" and place_archetype == building_archetype:
        score += 1
        reasons.append("type_agrees")

    try:
        area_m2 = float(building.get("area_m2") or 0)
    except (TypeError, ValueError):
        area_m2 = 0.0
    small_building = 0 < area_m2 <= SMALL_SINGLE_TENANT_AREA_M2
    if small_building:
        score += 1
        reasons.append("small_footprint")

    if building_name and name_score == 0:
        score -= 3
        reasons.append("building_name_unmatched")

    promote = False
    if name_score >= 4 and distance_m <= 60:
        promote = True
    elif address_score >= 4 and whole_place and distance_m <= 50:
        promote = True
    elif address_score >= 4 and small_building and distance_m <= 25:
        promote = True
    elif not building_name and not address and whole_place and distance_m <= 12:
        promote = True

    return {
        "score": score,
        "promote": promote,
        "reasons": sorted(set(reasons)),
    }


def normalize_osm_building(feature: Mapping[str, Any], index: int | None = None) -> dict[str, Any]:
    tags = feature.get("tags") or feature
    address = building_address(tags)
    place_types = [str(tags[key]) for key in BUSINESS_KEYS if tags.get(key)]
    row: dict[str, Any] = {
        "building_id": building_id(feature, index),
        "sources": ["osm"],
        "centroid": feature.get("centroid") or building_centroid(feature.get("points") or []),
        "area_m2": round(building_area_m2(feature.get("points") or []), 1),
    }
    if feature.get("points"):
        row["points"] = feature["points"]
    if feature.get("osm_id"):
        row["osm_id"] = feature["osm_id"]
    if feature.get("name"):
        row["name"] = feature["name"]
    if address:
        row["address"] = address
    if place_types:
        row["osm_types"] = sorted(set(place_types))
    building = tags.get("building")
    land_use = tags.get("landuse")
    if building:
        row["building_osm"] = str(building)
    if land_use:
        row["land_use"] = str(land_use)
    if feature.get("height_m") is not None and feature.get("height_source") in INPUT_HEIGHT_SOURCES:
        row["height_m"] = float(feature["height_m"])
        row["height_source"] = str(feature.get("height_source") or "osm_or_renderer_height")
    if tags.get("building:levels") is not None:
        try:
            row["building_levels"] = float(tags["building:levels"])
        except (TypeError, ValueError):
            pass
    row["archetype"] = archetype_for(
        place_types=place_types,
        land_use=str(land_use) if land_use else None,
        building=str(building) if building else None,
        name=str(feature.get("name")) if feature.get("name") else None,
    )
    return row


def normalize_google_place(place: Mapping[str, Any], *, fetched_at: datetime | None = None) -> dict[str, Any]:
    fetched_at = fetched_at or datetime.now(UTC)
    display = place.get("displayName") or {}
    location = place.get("location") or {}
    types = [str(t) for t in place.get("types") or []]
    primary = place.get("primaryType")
    if primary:
        types.insert(0, str(primary))
    row = {
        "provider": "google_places",
        "place_id": str(place.get("id") or place.get("name") or ""),
        "name": str(display.get("text") or place.get("name") or ""),
        "primary_type": str(primary or ""),
        "types": sorted(set(t for t in types if t)),
        "formatted_address": str(place.get("formattedAddress") or ""),
        "business_status": str(place.get("businessStatus") or ""),
        "lat": location.get("latitude"),
        "lon": location.get("longitude"),
        "fetched_at": fetched_at.isoformat().replace("+00:00", "Z"),
        "expires_at": (fetched_at + timedelta(days=GOOGLE_PLACES_CACHE_DAYS)).isoformat().replace(
            "+00:00", "Z"
        ),
        "cache_policy": "refresh Google Places fields; keep place_id only as durable identifier",
    }
    row["archetype"] = archetype_for(place_types=row["types"], name=row["name"])
    return row


def merge_building_enrichment(
    ways: Iterable[dict[str, Any]], enrichment_rows: Iterable[Mapping[str, Any]]
) -> dict[str, int]:
    """Attach enrichment rows to building ways in-place."""
    by_id = {str(row.get("building_id")): row for row in enrichment_rows if row.get("building_id")}
    by_osm = {str(row.get("osm_id")): row for row in enrichment_rows if row.get("osm_id")}
    counts = {"matched": 0, "address": 0, "place": 0, "archetype": 0, "land_use": 0, "height": 0}
    building_index = 0
    for way in ways:
        if way.get("kind") != "building":
            continue
        bid = building_id(way, building_index)
        way["building_id"] = bid
        building_index += 1
        row = by_id.get(bid) or by_osm.get(str(way.get("osm_id")))
        if not row:
            continue
        counts["matched"] += 1
        for key in (
            "address",
            "parcel",
            "zoning",
            "land_use",
            "building_osm",
            "overture",
            "google_places",
            "place",
            "archetype",
            "datasf_building_height",
            "height_m",
            "height_source",
            "height_confidence",
            "building_levels",
        ):
            if row.get(key) not in (None, "", [], {}):
                way[key] = row[key]
        if row.get("address"):
            counts["address"] += 1
        if row.get("google_places") or row.get("place"):
            counts["place"] += 1
        if row.get("archetype"):
            counts["archetype"] += 1
        if row.get("land_use") or row.get("zoning"):
            counts["land_use"] += 1
        if row.get("height_m"):
            counts["height"] += 1
    return counts
