#!/usr/bin/env python3
"""Build compact building metadata for the SF corridor 3D renderer.

The output is intentionally small JSON, keyed by stable building IDs. Large
source pulls and provider responses remain in build/ caches. Google Places is
optional and limit-gated because one request per building would be expensive and
its fields are refreshable provider content, not permanent measured geometry.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
import urllib.error
import urllib.request
from collections import Counter, defaultdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from smc.buildings.enrichment import (  # noqa: E402
    archetype_for,
    building_centroid,
    building_id,
    normalize_google_place,
    normalize_osm_building,
    parcel_address,
    score_google_place_for_building,
)
from smc.imagery.region import SF_CORRIDOR  # noqa: E402
from smc.official.crs import geojson_rings  # noqa: E402

DEFAULT_OUT = ROOT / "data" / "sf_building_enrichment" / "buildings.json"
DEFAULT_SUMMARY = ROOT / "data" / "sf_building_enrichment" / "summary.json"
PARCEL_GRID = 2200
USER_AGENT = "spatial-mapping-crowdsource/building-enrichment"


def point_in_ring(lon: float, lat: float, ring: list[tuple[float, float]]) -> bool:
    inside = False
    j = len(ring) - 1
    for i, point in enumerate(ring):
        xi, yi = point
        xj, yj = ring[j]
        crosses = (yi > lat) != (yj > lat)
        if crosses:
            x_at_y = (xj - xi) * (lat - yi) / ((yj - yi) or 1e-18) + xi
            if lon < x_at_y:
                inside = not inside
        j = i
    return inside


def ring_bbox(ring: list[tuple[float, float]]) -> tuple[float, float, float, float]:
    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    return min(xs), min(ys), max(xs), max(ys)


def load_buildings(page_json: Path) -> list[dict[str, Any]]:
    payload = json.loads(page_json.read_text(encoding="utf-8"))
    buildings = []
    for way in payload.get("ways", []):
        if way.get("kind") != "building":
            continue
        item = dict(way)
        item["building_id"] = building_id(item, len(buildings))
        buildings.append(item)
    return buildings


def default_parcel_cache() -> Path | None:
    paths = sorted((ROOT / "build" / "sf_public_works").glob("acdm-wktn-*.json"))
    return paths[-1] if paths else None


def load_parcels(cache_path: Path | None) -> list[dict[str, Any]]:
    if cache_path is None or not cache_path.exists():
        return []
    payload = json.loads(cache_path.read_text(encoding="utf-8"))
    return list(payload.get("rows", []))


def parcel_index(parcels: list[dict[str, Any]]) -> dict[tuple[int, int], list[dict[str, Any]]]:
    cells: dict[tuple[int, int], list[dict[str, Any]]] = defaultdict(list)
    for parcel in parcels:
        rings = geojson_rings(parcel.get("shape") or {})
        if not rings:
            continue
        ring = rings[0]
        if len(ring) < 3:
            continue
        west, south, east, north = ring_bbox(ring)
        item = {"row": parcel, "ring": ring, "bbox": (west, south, east, north)}
        for ix in range(int(west * PARCEL_GRID), int(east * PARCEL_GRID) + 1):
            for iy in range(int(south * PARCEL_GRID), int(north * PARCEL_GRID) + 1):
                cells[(ix, iy)].append(item)
    return cells


def attach_parcels(records: list[dict[str, Any]], parcels: list[dict[str, Any]]) -> int:
    index = parcel_index(parcels)
    matched = 0
    for row in records:
        lon, lat = row.get("centroid") or [None, None]
        if lon is None or lat is None:
            continue
        candidates = index.get((int(float(lon) * PARCEL_GRID), int(float(lat) * PARCEL_GRID)), [])
        for candidate in candidates:
            west, south, east, north = candidate["bbox"]
            if not (west <= lon <= east and south <= lat <= north):
                continue
            if not point_in_ring(float(lon), float(lat), candidate["ring"]):
                continue
            parcel = candidate["row"]
            row["parcel"] = {
                "blklot": parcel.get("blklot") or parcel.get("mapblklot"),
                "active": parcel.get("active"),
                "analysis_neighborhood": parcel.get("analysis_neighborhood"),
                "planning_district": parcel.get("planning_district"),
                "data_as_of": parcel.get("data_as_of"),
                "source": "datasf:acdm-wktn",
            }
            address = parcel_address(parcel)
            if address and not row.get("address"):
                row["address"] = address
            zoning = {
                "code": parcel.get("zoning_code"),
                "district": parcel.get("zoning_district"),
                "source": "datasf:acdm-wktn",
            }
            row["zoning"] = {k: v for k, v in zoning.items() if v not in (None, "")}
            if parcel.get("zoning_district"):
                row["land_use"] = str(parcel["zoning_district"])
            row["archetype"] = archetype_for(
                place_types=row.get("osm_types") or [],
                land_use=row.get("land_use"),
                building=row.get("building_osm"),
                name=row.get("name"),
            )
            sources = set(row.get("sources") or [])
            sources.add("datasf_parcels")
            row["sources"] = sorted(sources)
            matched += 1
            break
    return matched


def distance_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat = (a[1] + b[1]) / 2.0
    return math.hypot(
        (a[0] - b[0]) * 111_320.0 * math.cos(math.radians(lat)),
        (a[1] - b[1]) * 111_320.0,
    )


def google_nearby(
    *,
    key: str,
    lat: float,
    lon: float,
    radius_m: float,
    max_results: int,
) -> list[dict[str, Any]]:
    body = json.dumps(
        {
            "maxResultCount": max(1, min(20, max_results)),
            "locationRestriction": {
                "circle": {
                    "center": {"latitude": lat, "longitude": lon},
                    "radius": max(5.0, min(100.0, radius_m)),
                }
            },
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        "https://places.googleapis.com/v1/places:searchNearby",
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "User-Agent": USER_AGENT,
            "X-Goog-Api-Key": key,
            "X-Goog-FieldMask": (
                "places.id,places.displayName,places.formattedAddress,places.primaryType,"
                "places.types,places.businessStatus,places.location"
            ),
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8")).get("places", [])


def attach_google_places(
    records: list[dict[str, Any]],
    *,
    key: str | None,
    limit: int,
    radius_m: float,
    sleep_s: float,
) -> tuple[int, list[str]]:
    if not key or limit <= 0:
        return 0, []
    fetched_at = datetime.now(UTC)
    errors: list[str] = []
    done = 0
    for row in records:
        if done >= limit:
            break
        lon, lat = row.get("centroid") or [None, None]
        if lon is None or lat is None:
            continue
        try:
            places = google_nearby(
                key=key,
                lat=float(lat),
                lon=float(lon),
                radius_m=radius_m,
                max_results=5,
            )
        except urllib.error.HTTPError as exc:
            errors.append(f"HTTP {exc.code}: {exc.read()[:160].decode('utf-8', 'ignore')}")
            break
        except OSError as exc:
            errors.append(str(exc))
            break
        done += 1
        if sleep_s > 0:
            time.sleep(sleep_s)
        normal = [normalize_google_place(place, fetched_at=fetched_at) for place in places]
        normal = [place for place in normal if place.get("place_id")]
        if not normal:
            continue
        for place in normal:
            place_distance = distance_m(
                (float(lon), float(lat)),
                (float(place.get("lon") or lon), float(place.get("lat") or lat)),
            )
            place["distance_m"] = round(place_distance, 1)
            match = score_google_place_for_building(row, place, distance_m=place_distance)
            place["match_score"] = match["score"]
            place["match_reasons"] = match["reasons"]
            place["promote_to_building"] = match["promote"]
        normal.sort(key=lambda place: (-int(place.get("match_score") or 0), float(place.get("distance_m") or 9999)))
        row["google_places"] = normal[:3]
        best = next((place for place in normal if place.get("promote_to_building")), None)
        if best is None:
            row["google_place_review"] = "candidate_only_not_promoted"
            sources = set(row.get("sources") or [])
            sources.add("google_places_candidates")
            row["sources"] = sorted(sources)
            continue
        row["place"] = {
            "provider": "google_places",
            "place_id": best["place_id"],
            "name": best.get("name"),
            "primary_type": best.get("primary_type"),
            "formatted_address": best.get("formatted_address"),
            "expires_at": best.get("expires_at"),
            "match_score": best.get("match_score"),
            "match_reasons": best.get("match_reasons"),
        }
        if best.get("formatted_address") and not row.get("address"):
            row["address"] = {"formatted": best["formatted_address"]}
        row["archetype"] = best.get("archetype") or row.get("archetype")
        sources = set(row.get("sources") or [])
        sources.add("google_places")
        row["sources"] = sorted(sources)
    return done, errors


def attach_overture(records: list[dict[str, Any]], *, limit: int, release: str) -> tuple[int, str | None]:
    if limit <= 0:
        return 0, None
    try:
        import duckdb  # type: ignore
    except ModuleNotFoundError:
        return 0, "duckdb is not installed; install the project dependency to enable Overture pulls"

    bbox = SF_CORRIDOR.bbox
    path = f"s3://overturemaps-us-west-2/release/{release}/theme=buildings/type=building/*"
    sql = f"""
        INSTALL spatial; LOAD spatial; INSTALL httpfs; LOAD httpfs;
        SET s3_region='us-west-2';
        SELECT
          id,
          names,
          subtype,
          class,
          height,
          num_floors,
          ST_AsGeoJSON(geometry) AS geometry_json
        FROM read_parquet('{path}', hive_partitioning=1)
        WHERE bbox.xmin <= {bbox.east}
          AND bbox.xmax >= {bbox.west}
          AND bbox.ymin <= {bbox.north}
          AND bbox.ymax >= {bbox.south}
        LIMIT {int(limit)}
    """
    try:
        rows = duckdb.sql(sql).fetchall()
    except Exception as exc:  # noqa: BLE001 - Overture schema/release can move
        return 0, f"Overture query failed: {exc}"

    by_centroid: list[tuple[tuple[float, float], dict[str, Any]]] = []
    for overture_id, names, subtype, cls, height, floors, geometry_json in rows:
        try:
            coords = json.loads(geometry_json)["coordinates"][0]
            centroid = building_centroid(coords)
        except Exception:
            continue
        by_centroid.append(
            (
                (float(centroid[0]), float(centroid[1])),
                {
                    "id": overture_id,
                    "names": names,
                    "subtype": subtype,
                    "class": cls,
                    "height_m": height,
                    "num_floors": floors,
                    "source": "overture:buildings",
                    "release": release,
                },
            )
        )

    matched = 0
    for row in records:
        lon, lat = row.get("centroid") or [None, None]
        if lon is None or lat is None:
            continue
        nearby = [
            (distance_m((float(lon), float(lat)), centre), fact) for centre, fact in by_centroid
        ]
        if not nearby:
            continue
        metres, fact = min(nearby, key=lambda item: item[0])
        if metres > 12.0:
            continue
        row["overture"] = fact
        if fact.get("height_m") and not row.get("height_m"):
            row["height_m"] = fact["height_m"]
            row["height_source"] = "overture_height"
        if fact.get("num_floors") and not row.get("building_levels"):
            row["building_levels"] = fact["num_floors"]
        row["archetype"] = archetype_for(
            place_types=[str(fact.get("subtype") or ""), str(fact.get("class") or "")],
            land_use=row.get("land_use"),
            building=row.get("building_osm"),
            name=row.get("name"),
        )
        sources = set(row.get("sources") or [])
        sources.add("overture_buildings")
        row["sources"] = sorted(sources)
        matched += 1
    return matched, None


def compact(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    keep = []
    for row in records:
        slim = {
            key: value
            for key, value in row.items()
            if value not in (None, "", [], {})
            and key
            in {
                "building_id",
                "osm_id",
                "name",
                "centroid",
                "area_m2",
                "address",
                "parcel",
                "zoning",
                "land_use",
                "building_osm",
                "osm_types",
                "overture",
                "google_places",
                "place",
                "archetype",
                "sources",
                "height_m",
                "height_source",
                "building_levels",
            }
        }
        keep.append(slim)
    return keep


def display_path(path: Path | None) -> str | None:
    if path is None:
        return None
    try:
        return str(path.resolve().relative_to(ROOT))
    except ValueError:
        return str(path)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--page-json", type=Path, default=ROOT / "docs" / "sf-corridor-3d.json")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--summary", type=Path, default=DEFAULT_SUMMARY)
    parser.add_argument("--parcel-cache", type=Path, default=None)
    parser.add_argument("--google-limit", type=int, default=0)
    parser.add_argument("--google-radius-m", type=float, default=28.0)
    parser.add_argument("--google-sleep-s", type=float, default=0.05)
    parser.add_argument("--overture-limit", type=int, default=0)
    parser.add_argument("--overture-release", default="2026-08-19.0")
    args = parser.parse_args()

    buildings = load_buildings(args.page_json)
    records = [normalize_osm_building(feature, index) for index, feature in enumerate(buildings)]

    parcel_cache = args.parcel_cache or default_parcel_cache()
    parcels = load_parcels(parcel_cache)
    parcel_matches = attach_parcels(records, parcels)

    overture_matches, overture_error = attach_overture(
        records, limit=args.overture_limit, release=args.overture_release
    )

    google_key = os.environ.get("GOOGLE_MAPS_API_KEY")
    google_requests, google_errors = attach_google_places(
        records,
        key=google_key,
        limit=args.google_limit,
        radius_m=args.google_radius_m,
        sleep_s=args.google_sleep_s,
    )

    output = compact(records)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(output, indent=1, sort_keys=True) + "\n", encoding="utf-8")

    counter = Counter(row.get("archetype") or "generic" for row in output)
    summary = {
        "generated_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "buildings": len(output),
        "parcel_cache": display_path(parcel_cache),
        "datasf_parcel_matches": parcel_matches,
        "overture_matches": overture_matches,
        "overture_error": overture_error,
        "google_places_requests": google_requests,
        "google_places_errors": google_errors,
        "with_address": sum(1 for row in output if row.get("address")),
        "with_place": sum(1 for row in output if row.get("place")),
        "archetypes": dict(counter),
        "google_policy": (
            "Google Places fields in this file are refreshable non-commercial metadata. "
            "Do not promote them into permanent measured geometry; retain place_id as the durable key."
        ),
    }
    args.summary.write_text(json.dumps(summary, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
