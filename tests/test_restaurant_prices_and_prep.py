"""Price identity/expiry, real shell dimensions and usable professional prep islands."""

from __future__ import annotations

import copy
import json
import math
import runpy
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from shapely import affinity
from shapely.geometry import LineString, Polygon, box, shape

from smc.buildings.enrichment import normalize_google_place
from smc.interiors.inference.catalog import Catalog
from smc.interiors.inference.model import geo
from smc.interiors.kerbside import mapped_geometry
from smc.interiors.restaurants.engine import (
    RestaurantInput,
    _component,
    _kitchen,
    _room,
    inward_point,
    restaurant_style,
)
from smc.interiors.restaurants.prices import apply_price, price_evidence

ROOT = Path(__file__).resolve().parents[1]
INGEST = runpy.run_path(str(ROOT / "scripts/ingest_restaurant_prices.py"))
NOW = datetime(2026, 10, 22, tzinfo=UTC)


def test_google_actual_range_wins_and_open_upper_bound_is_supported():
    actual = {
        "id": "known",
        "priceLevel": "PRICE_LEVEL_MODERATE",
        "priceRange": {
            "startPrice": {"currencyCode": "USD", "units": "30", "nanos": 500000000},
            "endPrice": {"currencyCode": "USD", "units": "50"},
        },
    }
    e = price_evidence(actual, fetched_at=NOW)
    assert e["range_usd"] == {"min": 30.5, "max": 50}
    assert e["average_spend_per_person"] == 40.25
    assert e["economics_source"] == "Google published USD range"
    del actual["priceRange"]["endPrice"]
    e = price_evidence(actual, fetched_at=NOW)
    assert e["range_usd"]["max"] is None
    assert e["estimate_is_inferred"]
    assert normalize_google_place(actual)["price_range"] == actual["priceRange"]


@pytest.mark.parametrize("value", ["$", "$$", "$$$", "$$$$", 1, 2, 3, 4])
def test_symbol_and_legacy_levels_have_explicit_calibrated_bands(value):
    e = price_evidence({"price_level": value}, fetched_at=NOW)
    assert e["average_spend_per_person"] > 0
    assert "inferred USD" in e["economics_source"]
    assert e["measured"] is False


@pytest.mark.parametrize("value", [None, 0, True, 2.0, "PRICE_LEVEL_UNSPECIFIED", "$$$$$"])
def test_unknown_levels_do_not_invent_a_price(value):
    assert price_evidence({"priceLevel": value}, fetched_at=NOW) is None


def test_foreign_currency_never_becomes_usd_without_level_calibration():
    assert (
        price_evidence({"priceRange": {"startPrice": {"currencyCode": "EUR", "units": "50"}}})
        is None
    )


def test_expiry_identity_and_explicit_spend_priority():
    e = price_evidence({"price_level": 2}, fetched_at=NOW)
    e["venue_id"] = "v"
    row = {"id": "v"}
    assert apply_price(row, e, now=NOW)
    assert not apply_price({"id": "other"}, e, now=NOW)
    assert not apply_price({"id": "v"}, e, now=NOW + timedelta(days=31))
    explicit = {
        "id": "v",
        "average_spend_per_person": 80,
        "economics_source": "caller supplied USD spend per person",
    }
    assert not apply_price(explicit, e, now=NOW)
    assert explicit["average_spend_per_person"] == 80


def test_ingestion_matches_identity_reuses_cache_and_obeys_request_budget():
    venue = {"id": "v", "name": "Example Garden", "osm_id": "7", "origin_lon_lat": [-122.4, 37.8]}
    place = {
        "id": "google-id",
        "displayName": {"text": "Example Garden Restaurant"},
        "location": {"longitude": -122.4, "latitude": 37.8},
        "priceLevel": "PRICE_LEVEL_EXPENSIVE",
    }
    assert INGEST["matching_place"](venue, [place])
    other = copy.deepcopy(place)
    other["displayName"]["text"] = "Unrelated Garden"
    assert INGEST["matching_place"](venue, [other]) is None
    other = {**place, "id": "ambiguous-second"}
    assert INGEST["matching_place"](venue, [place, other]) is None
    far = {**place, "location": {"longitude": -122.41, "latitude": 37.8}}
    assert INGEST["matching_place"](venue, [far]) is None
    calls = []

    def fetch(row):
        calls.append(row["id"])
        return [place]

    cache = {}
    report = INGEST["ingest"]([venue], cache, fetch=fetch, max_requests=0)
    assert report["requests"] == 0 and not calls
    report = INGEST["ingest"]([venue], cache, fetch=fetch, max_requests=1)
    assert report["matched"] == 1 and calls == ["v"]
    report = INGEST["ingest"]([venue], cache, fetch=fetch, max_requests=1)
    assert report["fresh_cached"] == 1 and report["requests"] == 0


def test_kerbside_shape_area_height_and_entrance_survive_without_rectangle_substitution():
    ring = [(0, 0), (12, 0), (12, 4), (7, 4), (7, 11), (0, 11), (0, 0)]
    lon, lat = -122.4, 37.8
    points = [[lon + x / (111320 * math.cos(math.radians(lat))), lat + y / 111320] for x, y in ring]
    way = {"osm_id": 7, "centroid": [lon, lat], "points": points, "height_m": 9}
    fitted = [0] * 14
    fitted[9:11] = [3, 2.85]
    fitted[13] = [[0, 0.3, 1, 0]]
    geometry = mapped_geometry(way, fitted)
    assert shape(geometry["footprint"]).symmetric_difference(Polygon(ring)).area < 1e-7
    assert geometry["geometry_evidence"]["footprint_area_m2"] == pytest.approx(97)
    assert geometry["geometry_evidence"]["footprint_area_sqft"] == pytest.approx(97 * 10.7639104167)
    assert geometry["height_m"] == 2.85
    assert geometry["entrance"] == pytest.approx([3.6, 0])
    assert geometry["geometry_evidence"]["shell_floor_area_m2"] == pytest.approx(291)
    assert mapped_geometry(way)["height_m"] == 3


@pytest.mark.parametrize("angle", [0, 27, 90])
def test_prep_island_has_stainless_top_and_connected_aisles_on_unseen_rotated_kitchens(angle):
    p = affinity.rotate(box(0, 0, 8, 7), angle, origin=(0, 0))
    line = affinity.rotate(LineString([(3.4, 0), (4.6, 0)]), angle, origin=(0, 0))
    style = restaurant_style(RestaurantInput("unseen-island", box(0, 0, 12, 12)))
    room = _room("k", "professional_kitchen", p, style, 0)
    portals = [
        {
            "rooms": ["k", "dining"],
            "segment": geo(line),
            "clearance": geo(line.buffer(0.7, cap_style=2)),
        }
    ]
    items, targets = _kitchen(room, style, Catalog(), portals)
    island = next(o for o in items if o.get("placement") == "central_prep_island")
    board = next(o for o in items if o["role"] == "cutting_board")
    assert board["size_m"] == [0.55, 0.025, 0.35]
    assert board["support"]["id"] == island["id"]
    assert board["position_m"][1] == island["size_m"][1]
    assert island["role"] == "prep_table" and island["finish"] == "stainless_steel"
    aisle = shape(island["work_aisle"])
    assert p.covers(aisle)
    obstacles = [shape(o["footprint"]) for o in items if o["support"]["kind"] == "floor"]
    assert all(
        not aisle.intersects(shape(o["footprint"]))
        for o in items
        if o["id"] != island["id"] and o["support"]["kind"] == "floor"
    )
    from shapely.geometry import Point

    assert _component(
        p, obstacles, [inward_point(p, line)] + [Point(t["point"]) for t in targets], 0.45
    )


def test_narrow_pickup_kitchen_keeps_required_inventory_without_forced_island():
    p = box(0, 0, 3.2, 7)
    style = restaurant_style(RestaurantInput("tiny", box(0, 0, 4, 8)))
    room = _room("k", "professional_kitchen", p, style, 0)
    line = LineString([(1, 0), (2.2, 0)])
    items, _ = _kitchen(
        room,
        style,
        Catalog(),
        [
            {
                "rooms": ["k", "dining"],
                "segment": geo(line),
                "clearance": geo(line.buffer(0.7, cap_style=2)),
            }
        ],
    )
    assert not any(o.get("placement") == "central_prep_island" for o in items)
    assert {"prep_table", "warewash_sink", "commercial_range"} <= {o["role"] for o in items}


def test_generated_houses_use_canonical_shell_area_and_storey_heights():
    lab = ROOT / "docs/inferred-interiors"
    manifest = json.loads((lab / "manifest.json").read_text())
    canonical = json.loads((lab / "envelopes.json").read_text())["buildings"]
    for record in manifest["houses"]:
        if not record["passed"]:
            continue
        h = json.loads((lab / record["file"]).read_text())
        audit = h["provenance"]["geometry"]
        assert audit["footprint_area_m2"] == pytest.approx(shape(h["storeys"][0]["footprint"]).area)
        assert audit["floor_area_m2"] == pytest.approx(
            sum(shape(f["footprint"]).area for f in h["storeys"])
        )
        assert audit["storey_heights_m"] == [f["height_m"] for f in h["storeys"]]
        if h["id"] in canonical:
            assert shape(h["storeys"][0]["footprint"]).equals(
                shape(canonical[h["id"]]["footprint"])
            )
            assert audit["storey_heights_m"] == [
                f["height_m"] for f in canonical[h["id"]]["storeys"]
            ]


def test_bounded_house_review_retains_previously_published_regions(tmp_path):
    builder = runpy.run_path(str(ROOT / "scripts/build_inferred_interiors.py"))
    path = tmp_path / "map-overlay.json"
    other = {"99": {"file": "houses/sf-sunset/osm-99.json", "origin_lon_lat": [-122.5, 37.7]}}
    path.write_text(json.dumps({"buildings": other}))
    builder["update_overlay"](path, {"7": {"file": "osm-7.json"}})
    assert json.loads(path.read_text())["buildings"]["99"] == other["99"]
    builder["update_overlay"](path, {"7": {"file": "refreshed/osm-7.json"}})
    rows = json.loads(path.read_text())["buildings"]
    assert len(rows) == 2 and rows["7"]["file"] == "refreshed/osm-7.json"
