"""Lot shape, connectivity, faithful observations and brand/entry regressions."""

import copy
import json
import math
from pathlib import Path

import pytest
from shapely.geometry import shape
from shapely.ops import unary_union

from smc.exteriors.bundle import build_bundle
from smc.exteriors.dealerships import (
    from_kerbside_dealership,
    infer_dealership,
    validate_dealership,
)
from smc.exteriors.library import brand_for, category, library

ROOT = Path(__file__).resolve().parents[1]
ROWS = json.loads((ROOT / "tests/fixtures/dealerships.json").read_text())


@pytest.fixture(scope="module")
def plans():
    return {r["id"]: infer_dealership(r) for r in ROWS}


@pytest.mark.parametrize("row", ROWS, ids=lambda r: r["id"])
def test_distinct_shapes_preserve_parcel_building_and_circulation(row, plans):
    plan = plans[row["id"]]
    assert plan["validation"]["passed"], plan["validation"]
    assert plan["site_polygon"] == row["site_polygon"]
    assert shape(plan["building"]["footprint"]).equals_exact(shape(row["building"]["footprint"]), 0)
    assert plan["source_input"] == row
    assert plan["canonical_geometry_modified"] is False
    assert plan["driveways"][0]["source_record"] == row["driveways"][0]
    routes = unary_union(
        [shape(r["polygon"]) for r in plan["driveways"] + plan["aisles"] + plan["connections"]]
    )
    for bay in plan["stalls"]:
        assert shape(plan["site_polygon"]).covers(shape(bay["polygon"]))
        assert shape(bay["polygon"]).intersection(routes).area < 1e-6
        assert (
            shape(bay["polygon"]).distance(shape(plan["aisles"][bay["aisle_index"]]["polygon"]))
            < 0.01
        )
    for lane in plan["aisles"]:
        component = next(
            g
            for g in ([routes] if routes.geom_type == "Polygon" else routes.geoms)
            if g.buffer(0.01).covers(shape(lane["polygon"]).representative_point())
        )
        assert any(component.intersects(shape(d["polygon"])) for d in plan["driveways"])
    assert all(not s["evidence"]["measured"] for s in plan["stalls"])


def test_supplied_service_door_keeps_a_clear_approach(plans):
    p = plans["toyota-wide"]
    assert len(p["service_aprons"]) == 1
    apron = shape(p["service_aprons"][0]["polygon"])
    assert all(apron.intersection(shape(s["polygon"])).area < 1e-6 for s in p["stalls"])
    service = next(f for f in p["building"]["facades"] if f["role"] == "service")
    assert not service["signs"]
    assert service["openings"][0]["source_record"]["id"] == "toyota-service"


def test_rejects_blocked_circulation_instead_of_moving_source_stalls(plans):
    p = copy.deepcopy(plans["toyota-wide"])
    stall = p["stalls"][0]
    stall["polygon"] = p["aisles"][0]["polygon"]
    assert "vehicle space blocks circulation" in validate_dealership(p)["errors"]
    row = copy.deepcopy(ROWS[0])
    row["parking_stalls"] = [
        dict(
            id="observed",
            polygon=p["aisles"][0]["polygon"],
            measured=True,
            source_id="source:stall",
        )
    ]
    result = infer_dealership(row)
    assert not result["validation"]["passed"]
    assert result["stalls"][-1]["source_record"] == row["parking_stalls"][0]


def test_interior_displays_fit_concave_shell_and_do_not_block_reception(plans):
    for p in plans.values():
        shell = shape(p["building"]["footprint"])
        furniture = [shape(o["polygon"]) for o in p["showroom"]["furniture"]]
        for car in p["showroom"]["cars"]:
            assert shell.covers(shape(car["polygon"]))
            assert all(shape(car["polygon"]).distance(o) >= 0.99 for o in furniture)


def test_capacity_reduces_without_narrowing_aisles_or_stalls(plans):
    assert len(plans["mazda-compact"]["stalls"]) < len(plans["toyota-wide"]["stalls"])
    assert 0 < len(plans["independent-tiny"]["stalls"]) < len(plans["mazda-compact"]["stalls"])
    assert plans["independent-tiny"]["layout_search"]["offset_candidates"] >= 7
    assert plans["independent-tiny"]["warnings"]
    assert all(lane["width_m"] >= 6.5 for p in plans.values() for lane in p["aisles"])


def test_dealer_marks_center_above_entry_not_arbitrary_building_center(plans):
    for p in plans.values():
        f = next(f for f in p["building"]["facades"] if f["role"] == "public")
        doors = [d for d in f["openings"] if d["component_kind"] == "door"]
        center = (min(d["u"] for d in doors) + max(d["u"] + d["w"] for d in doors)) / 2
        assert f["signs"]
        for sign in f["signs"]:
            assert sign["u"] + sign["w"] / 2 == pytest.approx(center)
            if p["brand"]:
                assert sign["text"] == library()["brands"][p["brand"]]["name"]


def test_no_parcel_or_driveway_fabricated_from_a_roof():
    for key in ["site_polygon", "driveways"]:
        row = copy.deepcopy(ROWS[0])
        row.pop(key)
        with pytest.raises((ValueError, KeyError)):
            infer_dealership(row)
    row = copy.deepcopy(ROWS[0])
    row["driveways"][0]["points"] = [[30, 45], [30, 55]]
    with pytest.raises(ValueError, match="boundary"):
        infer_dealership(row)
    with pytest.raises(ValueError, match="separate"):
        from_kerbside_dealership(dict(kind="building", tags=dict(shop="car")), {}, driveways=[])


def test_bundle_retains_rejections_and_wires_3d_consumer(tmp_path):
    bad = copy.deepcopy(ROWS[0])
    bad["id"] = "bad"
    bad["units"] = "feet"
    result = build_bundle(tmp_path, dealership_inputs=[ROWS[0], bad])
    assert result["dealership_summary"]["passed"] == 1
    assert result["dealership_summary"]["rejected"][0]["id"] == "bad"
    scenes = json.loads((tmp_path / "dealership-scenes.json").read_text())
    assert scenes["selected"] == ["toyota-wide", "bad"]
    assert "createDealershipRenderer" in (tmp_path / "dealership-preview.mjs").read_text()
    assert (tmp_path / "dealership-renderer.mjs").is_file()
    assert "dealerships.html" in (tmp_path / "index.html").read_text()


def test_chain_matching_is_exact_and_automotive_repair_is_not_sales():
    for key in [
        "toyota",
        "honda",
        "ford",
        "nissan",
        "mazda",
        "kia",
        "bmw",
        "lexus",
        "mercedes_benz",
        "ups_store",
        "home_depot",
        "petco",
        "sephora",
        "dominos",
        "wingstop",
        "daiso",
    ]:
        b = library()["brands"][key]
        assert brand_for(b["name"]) == key
        assert brand_for(b["name"] + " unrelated shop") is None
        assert b["references"] and b["color_basis"]
    assert category("car") == "car_dealership"
    assert category("car repair") == "industrial"
    assert category("car_rental") != "car_dealership"


def test_lonlat_adapter_shares_shell_frame_and_keeps_source_height_and_openings():
    from smc.exteriors.kerbside import from_kerbside

    # An asymmetric actual building, not a rectangle synthesized from square footage.
    origin = [-122.42, 37.77]

    def ll(p):
        return [
            origin[0] + p[0] / (111320 * math.cos(math.radians(origin[1]))),
            origin[1] + p[1] / 111320,
        ]

    shell = dict(
        osm_id=501,
        kind="building",
        name="Local Toyota",
        archetype="retail",
        height_m=6.1,
        points=[
            ll(p) for p in [[18, 40], [60, 40], [60, 61], [30, 61], [30, 55], [18, 55], [18, 40]]
        ],
        shops=[dict(n="Local Toyota", t="car")],
        tags=dict(brand="Toyota"),
    )
    site = dict(
        osm_id=500,
        name="Local Toyota",
        tags=dict(shop="car", brand="Toyota"),
        points=[ll(p) for p in [[0, 0], [80, 0], [75, 70], [0, 70], [0, 0]]],
    )
    drives = [dict(points=[ll([5, 0]), ll([5, 8])], width_m=6.5, source_id="capture:drive")]
    original = copy.deepcopy((site, shell, drives))
    row = from_kerbside_dealership(site, shell, driveways=drives)
    base = from_kerbside(shell)
    assert row["building"]["footprint"] == base.footprint.__geo_interface__
    assert row["building"]["height_m"] == 6.1
    assert row["building"]["canonical_points"] == shell["points"]
    assert row["canonical_site_points"] == site["points"]
    assert row["driveways"][0]["canonical_lon_lat"] == drives[0]["points"]
    assert (site, shell, drives) == original
    p = infer_dealership(row)
    assert p["validation"]["passed"], p["validation"]
    assert p["brand"] == "toyota"


@pytest.mark.parametrize(
    "row",
    json.loads((ROOT / "tests/fixtures/chains-20261105.json").read_text()),
    ids=lambda r: r["id"],
)
def test_every_new_chain_fits_its_fixed_frontage(row):
    from smc.exteriors import ExteriorInput, infer_exterior

    p = infer_exterior(ExteriorInput.from_json(row))
    assert p["validation"]["passed"], p["validation"]
    assert p["footprint"] == row["footprint"] or shape(p["footprint"]).equals_exact(
        shape(row["footprint"]), 0
    )
    assert p["facades"][0]["brand"] == row["tenants"][0]["brand"]


def test_actual_three_geometry_material_groups_and_overview_framing(tmp_path, plans):
    import shutil
    import subprocess

    three = tmp_path / "three.mjs"
    shutil.copyfile(ROOT / "docs/vendor/three-0.160.0/three.module.min.js", three)
    scenes = tmp_path / "scenes.json"
    scenes.write_text(json.dumps(dict(dealerships=plans)))
    result = subprocess.run(
        [
            "node",
            str(ROOT / "tests/fixtures/dealership-geometry-probe.mjs"),
            str(three),
            str(scenes),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    report = json.loads(result.stdout)
    assert report["three_revision"] == "160"
    assert len(report["cases"]) == len(ROWS)
    assert all(
        r["finite_geometry"] and r["valid_material_groups"] and r["overview_fits"]
        for r in report["cases"]
    )


def test_preview_controls_keep_selected_view_after_resize(tmp_path, plans):
    import shutil
    import subprocess

    three = tmp_path / "three.mjs"
    shutil.copyfile(ROOT / "docs/vendor/three-0.160.0/three.module.min.js", three)
    scenes = tmp_path / "scenes.json"
    scenes.write_text(json.dumps(dict(dealerships=plans, rejected=[])))
    result = subprocess.run(
        [
            "node",
            str(ROOT / "tests/fixtures/dealership-preview-probe.mjs"),
            str(three),
            str(ROOT / "src/smc/exteriors/dealership-preview.mjs"),
            str(scenes),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    report = json.loads(result.stdout)
    assert report["controls_passed"] and report["resize_preserves_view"]


def test_cli_builds_dealership_only_bundle_and_reports_failures(tmp_path):
    import subprocess
    import sys

    result = subprocess.run(
        [
            sys.executable,
            str(ROOT / "scripts/build_store_exteriors.py"),
            "--dealerships",
            str(ROOT / "tests/fixtures/dealerships.json"),
            "--out",
            str(tmp_path),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    report = json.loads(result.stdout)
    assert report["dealerships"] == dict(selected=10, passed=10, rejected=[])
    assert (tmp_path / "dealerships.html").is_file()


def test_source_landscape_island_is_avoided_by_cars_and_all_routes(plans):
    row = copy.deepcopy(ROWS[0])
    row["obstacles"] = [
        dict(
            id="measured-planter",
            polygon=plans[row["id"]]["stalls"][2]["polygon"],
            height_m=0.45,
            measured=True,
            source_id="capture:landscape",
        )
    ]
    plan = infer_dealership(row)
    assert plan["validation"]["passed"], plan["validation"]
    assert plan["obstacles"] == row["obstacles"]
    island = shape(row["obstacles"][0]["polygon"])
    for obj in plan["stalls"] + plan["aisles"] + plan["connections"]:
        assert shape(obj["polygon"]).intersection(island).area < 1e-6
