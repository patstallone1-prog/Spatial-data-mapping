"""Vehicle-space ownership, provenance and unmodified source-site regression checks."""

import copy
import json
import math
from pathlib import Path

import pytest
from shapely.geometry import LineString, Point, shape
from shapely.ops import unary_union

from smc.exteriors import ExteriorInput, infer_exterior
from smc.exteriors.bundle import build_bundle
from smc.exteriors.kerbside import from_kerbside
from smc.exteriors.library import brand_for, library
from smc.exteriors.stations import from_kerbside_site, infer_station, validate_station

ROOT = Path(__file__).resolve().parents[1]
ROWS = json.loads((ROOT / "tests/fixtures/station-exteriors.json").read_text())


@pytest.fixture(scope="module")
def plans():
    return {r["id"]: infer_station(r) for r in ROWS}


@pytest.mark.parametrize("row", ROWS, ids=lambda r: r["id"])
def test_fixed_lots_fit_without_moving_source_geometry(row, plans):
    p = plans[row["id"]]
    assert p["validation"]["passed"], p["validation"]
    assert p["site_polygon"] == row["site_polygon"]
    assert p["source_input"] == row
    assert not p["canonical_geometry_modified"]
    assert validate_station(p)["passed"]
    assert p["routes"] and len(p["routes"]) == len(p["bays"])
    for o in p["bays"] + p["devices"] + p["canopies"]:
        assert shape(p["site_polygon"]).buffer(1e-7).covers(shape(o["polygon"]))


def test_pumps_have_opposed_vehicle_facing_nozzles(plans):
    p = plans["fuel-chevron"]
    bays = {b["id"]: b for b in p["bays"]}
    for d in p["devices"]:
        a, b = d["faces"]
        assert a["normal"] == pytest.approx([-n for n in b["normal"]])
        for face in d["faces"]:
            bay = bays[face["bay_id"]]
            delta = [bay["center"][i] - d["center"][i] for i in range(2)]
            assert sum(delta[i] * face["normal"][i] for i in range(2)) > 1.5
    wrong = copy.deepcopy(p)
    wrong["devices"][0]["faces"][0]["normal"] = [
        -n for n in wrong["devices"][0]["faces"][0]["normal"]
    ]
    assert "fuel nozzle faces wrong lane" in validate_station(wrong)["errors"]


def test_each_ev_charger_serves_one_parallel_bay_with_reachable_port(plans):
    for p in plans.values():
        if p["kind"] != "ev":
            continue
        assert len({d["bay_id"] for d in p["devices"]}) == len(p["bays"])
        for d, b in zip(p["devices"], p["bays"], strict=True):
            assert d["bay_id"] == b["id"]
            assert abs(
                math.remainder(d["heading_degrees"] - b["heading_degrees"], 360)
            ) == pytest.approx(180)
            assert math.dist(d["center"], d["served_port"]) < d["cable_reach_m"]
            assert not shape(d["polygon"]).intersects(shape(b["polygon"]))
    p = copy.deepcopy(plans["ev-chargepoint"])
    p["devices"][0]["heading_degrees"] += 180
    assert "charger faces away from its bay" in validate_station(p)["errors"]
    p = copy.deepcopy(plans["ev-chargepoint"])
    p["devices"][0]["served_port"] = [1000, 1000]
    assert "cable cannot reach assigned bay port" in validate_station(p)["errors"]


def test_approaches_do_not_drive_through_occupied_neighbor_spaces(plans):
    for p in plans.values():
        site = shape(p["site_polygon"])
        for route in p["routes"]:
            corridor = LineString(route["points"]).buffer(
                route["clear_width_m"] / 2, cap_style=2, join_style=2
            )
            assert site.buffer(1e-7).covers(corridor)
            others = unary_union(
                [shape(b["polygon"]) for b in p["bays"] if b["id"] != route["bay_id"]]
                + [shape(d["polygon"]) for d in p["devices"]]
            )
            assert corridor.intersection(others).area < 1e-6


def test_columns_and_bollards_stay_out_of_vehicle_spaces(plans):
    for p in plans.values():
        for canopy in p["canopies"]:
            assert canopy["supports"] and canopy["underside_m"] >= 3.8
            for point in canopy["supports"]:
                assert not any(
                    Point(point).buffer(0.18).intersects(shape(b["polygon"])) for b in p["bays"]
                )
        for d in p["devices"]:
            for point in d.get("bollards", []):
                assert math.dist(point, d["center"]) >= 0.457
                assert not any(
                    Point(point).buffer(0.09).intersects(shape(b["polygon"])) for b in p["bays"]
                )


def test_observed_stall_positions_and_price_payment_basis_are_retained(plans):
    row = next(r for r in ROWS if r["id"] == "observed-bays")
    p = plans[row["id"]]
    assert [b["source_record"] for b in p["bays"]] == row["parking_stalls"]
    assert all(b["evidence"]["measured"] for b in p["bays"])
    p = plans["observed-pump-faces"]
    raw = p["source_input"]["prices"]
    sign = p["price_sign"]["prices"]
    assert sign["rows"] == raw["rows"] and sign["source_id"] == raw["source_id"]
    assert not sign["illustrative"] and sign["evidence"]["freshness"] == "2026-10-30"
    sample = plans["fuel-chevron"]["price_sign"]["prices"]
    assert sample["illustrative"] and sample["currency"] == "USD" and sample["unit"] == "US_gallon"
    assert all(
        round(r["price"] % 1, 3) == pytest.approx(0.009 + math.floor(r["price"] % 1 * 100) / 100)
        for r in sample["rows"]
    )


def test_small_lot_reduces_capacity_instead_of_squeezing_bays(plans):
    p = plans["fuel-compact"]
    assert len(p["bays"]) < p["source_input"]["requested_bays"] and p["validation"]["warnings"]
    assert all(b["width_m"] >= 3 for b in p["bays"])


def test_attached_shop_uses_same_entries_and_actual_corner_store_engine(plans):
    for p in plans.values():
        if not p["store"]:
            continue
        interior = p["store_interior"]
        assert interior["validation"]["passed"]
        roles = {o["role"] for o in interior["storeys"][0]["objects"]}
        assert {"checkout_lane", "drink_cooler", "gondola_shelf"} <= roles
        assert interior["envelope"]["exterior_plan_sha256"] == p["store"]["content_sha256"]
        assert p["pedestrian_routes"]
        assert (
            not shape(p["store"]["footprint"])
            .intersection(unary_union([shape(b["polygon"]) for b in p["bays"]]))
            .area
        )


def test_bad_observed_layout_is_rejected_not_repaired_or_replaced(tmp_path):
    r = copy.deepcopy(ROWS[14])
    r["parking_stalls"][1]["center"] = r["parking_stalls"][0]["center"][:]
    old = copy.deepcopy(r)
    p = infer_station(r)
    assert not p["validation"]["passed"] and r == old
    assert p["bays"][1]["source_record"] == r["parking_stalls"][1]
    build_bundle(tmp_path, station_inputs=[r, ROWS[0]])
    m = json.loads((tmp_path / "station-scenes.json").read_text())
    assert len(m["selected"]) == 2 and len(m["rejected"]) == 1 and len(m["stations"]) == 1


def test_kerbside_adapter_refuses_to_treat_a_canopy_as_a_parcel():
    with pytest.raises(ValueError, match="not a building or canopy"):
        from_kerbside_site(dict(kind="building", tags={"building": "roof", "amenity": "fuel"}))
    way = dict(
        kind="area",
        osm_id=52,
        name="Source fuel lot",
        tags={"amenity": "fuel"},
        points=[
            [-122.4, 37.8],
            [-122.3996, 37.8],
            [-122.3996, 37.8003],
            [-122.4, 37.8003],
            [-122.4, 37.8],
        ],
    )
    old = copy.deepcopy(way)
    p = infer_station(from_kerbside_site(way))
    assert way == old and p["canonical_points"] == way["points"]
    assert p["origin_lon_lat"] == way["points"][0]
    assert p["validation"]["passed"]


def test_expanded_chain_programs_preserve_shells_and_retain_safeway():
    rows = json.loads((ROOT / "tests/fixtures/storefront-chains-expanded.json").read_text())
    assert len(rows) == 8
    for row in rows:
        p = infer_exterior(ExteriorInput.from_json(row))
        assert p["validation"]["passed"] and shape(p["footprint"]).equals_exact(
            shape(row["footprint"]), 0
        )
        assert p["facades"][0]["brand"] == row["tenants"][0]["brand"]
        assert p["references"]
    assert brand_for("Safeway") == "safeway"
    assert brand_for("Target Repairs") is None
    assert library()["station_brands"]["tesla"]["hardware"] == "tesla_v4"


def test_price_input_requires_currency_units_and_source():
    r = copy.deepcopy(ROWS[0])
    r["prices"] = {"currency": "EUR", "unit": "litre", "rows": []}
    with pytest.raises(ValueError, match="USD"):
        infer_station(r)


def test_storefront_adapter_does_not_wrap_a_fuel_canopy_in_retail_walls():
    with pytest.raises(ValueError, match="not retail walls"):
        from_kerbside(dict(archetype="gas_station", tags={"building": "roof"}))
