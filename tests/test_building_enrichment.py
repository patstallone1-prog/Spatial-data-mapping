from __future__ import annotations

from datetime import UTC, datetime

from smc.buildings.enrichment import (
    GOOGLE_PLACES_CACHE_DAYS,
    archetype_for,
    building_address,
    building_area_m2,
    building_centroid,
    merge_building_enrichment,
    normalize_google_place,
    normalize_osm_building,
    score_google_place_for_building,
)


def test_osm_address_and_business_tags_promote_to_archetype() -> None:
    feature = {
        "kind": "building",
        "osm_id": 123,
        "name": "Corner Fuel",
        "tags": {
            "addr:housenumber": "100",
            "addr:street": "Market St",
            "amenity": "fuel",
            "building": "yes",
        },
        "points": [
            [-122.0, 37.0],
            [-122.0, 37.0001],
            [-121.9999, 37.0001],
            [-121.9999, 37.0],
            [-122.0, 37.0],
        ],
    }

    row = normalize_osm_building(feature)

    assert row["building_id"] == "osm:way:123"
    assert row["address"]["formatted"] == "100 Market St"
    assert row["archetype"] == "gas_station"
    assert row["area_m2"] > 0


def test_google_place_metadata_is_refreshable_not_permanent_geometry() -> None:
    fetched_at = datetime(2026, 9, 7, tzinfo=UTC)
    row = normalize_google_place(
        {
            "id": "places/abc",
            "displayName": {"text": "Dolores Park"},
            "formattedAddress": "Dolores St, San Francisco, CA",
            "primaryType": "park",
            "types": ["park", "tourist_attraction"],
            "businessStatus": "OPERATIONAL",
            "location": {"latitude": 37.7596, "longitude": -122.4269},
        },
        fetched_at=fetched_at,
    )

    assert row["archetype"] == "park"
    assert row["expires_at"].startswith("2026-10-07")
    assert GOOGLE_PLACES_CACHE_DAYS == 30
    assert "refresh" in row["cache_policy"]
    assert row["place_id"] == "places/abc"


def test_google_tenant_does_not_promote_over_named_large_building() -> None:
    match = score_google_place_for_building(
        {
            "name": "Transamerica Pyramid",
            "address": {"house_number": "600", "street": "Montgomery St"},
            "area_m2": 4500,
            "archetype": "office",
        },
        {
            "name": "Prime Finance",
            "formatted_address": "600 Montgomery St, San Francisco, CA",
            "archetype": "office",
            "types": ["finance", "office"],
        },
        distance_m=6.0,
    )

    assert match["promote"] is False
    assert "building_name_unmatched" in match["reasons"]


def test_google_whole_place_with_address_can_promote() -> None:
    match = score_google_place_for_building(
        {
            "address": {"house_number": "100", "street": "Market St"},
            "area_m2": 700,
            "archetype": "generic",
        },
        {
            "name": "Corner Fuel",
            "formatted_address": "100 Market St, San Francisco, CA",
            "archetype": "gas_station",
            "types": ["gas_station"],
        },
        distance_m=9.0,
    )

    assert match["promote"] is True
    assert "address_match" in match["reasons"]


def test_merge_enrichment_attaches_place_address_and_land_use() -> None:
    ways = [
        {"kind": "street", "points": []},
        {"kind": "building", "osm_id": 9, "points": [[0, 0], [0, 1], [1, 1], [0, 0]]},
    ]
    counts = merge_building_enrichment(
        ways,
        [
            {
                "building_id": "osm:way:9",
                "address": {"formatted": "1 Test Ave"},
            "land_use": "Neighborhood Commercial",
            "place": {"name": "Test Cafe", "primary_type": "cafe"},
            "archetype": "restaurant",
            "height_m": 18.4,
            "height_source": "datasf_lidar_median_height",
            "height_confidence": 0.9,
        }
    ],
)

    assert counts["matched"] == 1
    assert counts["address"] == 1
    assert ways[1]["address"]["formatted"] == "1 Test Ave"
    assert ways[1]["place"]["name"] == "Test Cafe"
    assert ways[1]["archetype"] == "restaurant"
    assert ways[1]["height_m"] == 18.4
    assert ways[1]["height_source"] == "datasf_lidar_median_height"
    assert counts["height"] == 1


def test_geometry_helpers_are_stable_for_closed_rings() -> None:
    ring = [
        [-122.0, 37.0],
        [-122.0, 37.0001],
        [-121.9999, 37.0001],
        [-121.9999, 37.0],
        [-122.0, 37.0],
    ]

    assert building_centroid(ring) == [-121.99995, 37.00005]
    assert 95 <= building_area_m2(ring) <= 105
    assert archetype_for(place_types=["mini_golf"]) == "mini_golf"
    assert building_address({"addr:full": "10 Mission St, San Francisco, CA"}) == {
        "formatted": "10 Mission St, San Francisco, CA"
    }
