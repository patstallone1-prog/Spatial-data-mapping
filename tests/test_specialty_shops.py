"""Fixed specialty programs: source ledgers, functional fixtures and navigable rooms."""

from __future__ import annotations

import copy
import json
import runpy
import subprocess
from pathlib import Path

import pytest
from shapely import union_all
from shapely.geometry import shape

from smc.exteriors.library import category
from smc.exteriors.validate import validate_exterior
from smc.interiors.specialty import infer_specialty_shop
from smc.interiors.specialty.engine import validate_specialty_shop

ROOT = Path(__file__).resolve().parents[1]
ROWS = json.loads((ROOT / "tests/fixtures/specialty-shops.json").read_text())
REQUIRED = {
    "jewelry": {"jewelry_island", "jewelry_wall_case", "reception_desk", "jewelry_safe"},
    "barber": {
        "styling_station",
        "shampoo_station",
        "waiting_bench",
        "reception_desk",
        "utility_sink",
    },
    "salon": {
        "styling_station",
        "shampoo_station",
        "waiting_bench",
        "reception_desk",
        "utility_sink",
    },
    "laundry": {
        "commercial_washer",
        "stacked_dryer",
        "folding_table",
        "laundry_payment",
        "utility_sink",
    },
}


@pytest.fixture(scope="module")
def plans():
    return {r["id"]: infer_specialty_shop(r) for r in ROWS}


def test_fixed_cohort_keeps_all_shapes_and_programs(plans):
    assert len(plans) == len(ROWS) == 24
    assert {r["id"].split("-", 1)[1] for r in ROWS} == {
        "standard",
        "narrow",
        "rotated",
        "concave",
        "corner",
        "observed",
    }
    for r in ROWS:
        p = plans[r["id"]]
        assert p["validation"]["passed"], p["id"]
        assert validate_specialty_shop(p)["passed"]
        assert shape(p["exterior"]["footprint"]).equals_exact(shape(r["footprint"]), 0)
        assert p["exterior"]["height_m"] == r["height_m"]
        assert p["canonical_geometry_modified"] is False
        floor = p["storeys"][0]
        assert (
            shape(floor["inside"])
            .symmetric_difference(
                union_all([shape(q["polygon"]) for q in floor["rooms"]], grid_size=1e-6)
            )
            .area
            < 0.001
        )
        assert all(q["kind"] != "hallway" for q in floor["rooms"])
        assert {o["role"] for o in floor["objects"]} >= REQUIRED[p["kind"]] | {
            "toilet",
            "bath_sink",
        }
        assert p["interaction_targets"]
        assert len({q["materials"]["wall"] for q in floor["rooms"]}) >= 2
        assert all(not o["evidence"]["measured"] for o in floor["objects"])
        if p["kind"] == "laundry":
            assert sum(o["role"] == "commercial_washer" for o in floor["objects"]) >= 2


def test_one_ledger_preserves_measured_apertures_and_double_leaf_entries(plans):
    for row in ROWS:
        p = plans[row["id"]]
        assert p["envelope"]["exterior_plan_sha256"] == p["exterior"]["content_sha256"]
        ext = p["exterior"]["facades"][0]
        if row["id"].endswith("observed"):
            for source, opening in zip(
                row["frontages"][0]["openings"], ext["openings"], strict=True
            ):
                assert opening["source_record"] == source
                assert all(opening[k] == v for k, v in source.items())
        doors = [o for o in ext["openings"] if o["component_kind"] == "door"]
        entries = [o for o in p["storeys"][0]["openings"] if o.get("entrance")]
        assert len(doors) == len(entries)
        assert [d.get("leaf_count", 1) for d in doors] == [d["leaf_count"] for d in entries]
        if p["kind"] == "laundry":
            assert doors[0]["leaf_count"] == 2
            assert entries[0]["type"] == "double_door"


def test_assemblies_reserve_working_space_without_making_chairs_solid_blocks(plans):
    for p in plans.values():
        for o in p["storeys"][0]["objects"]:
            assert all(
                shape(o["footprint"]).buffer(0.001).covers(shape(c))
                for c in o["collision_polygons"]
            )
            if o["role"] in {"styling_station", "shampoo_station"}:
                assert len(o["collision_polygons"]) == 2
                assert (
                    sum(shape(c).area for c in o["collision_polygons"])
                    < shape(o["footprint"]).area * 0.6
                )


def test_conflicts_are_rejected_and_ledger_tampering_is_detected(plans):
    r = copy.deepcopy(ROWS[0])
    old = copy.deepcopy(r)
    assert infer_specialty_shop(r)["content_sha256"] == plans[r["id"]]["content_sha256"]
    assert r == old
    r["kind"] = "laundry"
    with pytest.raises(ValueError, match="conflicts"):
        infer_specialty_shop(r)
    p = copy.deepcopy(plans[ROWS[0]["id"]])
    p["envelope"]["exterior_plan_sha256"] = "stale"
    assert "stale shared envelope" in validate_specialty_shop(p)["errors"]
    q = copy.deepcopy(plans["barber-standard"]["exterior"])
    f = q["facades"][0]
    f["barber_pole"] = dict(f["openings"][0])
    assert not validate_exterior(q)["passed"]


def test_classification_distinguishes_jewelers_barbers_salon_and_laundry():
    for text in ["jeweler", "jewellery", "jewelry store"]:
        assert category(text) == "jewelry"
    assert category("barbershop") == "barber"
    assert category("salon") == "salon"
    assert category("laundromat") == "laundry"


def test_bundle_retains_rejected_fixed_id_and_refuses_published_docs(tmp_path):
    build = runpy.run_path(str(ROOT / "scripts/build_specialty_shops.py"))["build"]
    bad = copy.deepcopy(ROWS[0])
    bad["kind"] = "laundry"
    payload = build(tmp_path / "review", [bad, ROWS[6]])
    assert payload["selected"] == [bad["id"], ROWS[6]["id"]]
    assert [r["id"] for r in payload["rejected"]] == [bad["id"]]
    assert list(payload["shops"]) == [ROWS[6]["id"]]
    assert (tmp_path / "review/specialty.html").exists()
    with pytest.raises(ValueError, match="published docs"):
        build(ROOT / "docs/inferred-stores", [])


def test_real_tour_collision_can_reach_every_room_and_each_work_target(plans, tmp_path):
    data = tmp_path / "plans.json"
    data.write_text(json.dumps({"shops": plans}))
    result = json.loads(
        subprocess.check_output(
            ["node", str(ROOT / "tests/fixtures/specialty-tour-probe.mjs"), str(data)], text=True
        )
    )
    assert len(result["cases"]) == 24
    assert all(
        p["connected_rooms"] == 3 and p["wall_collision"] and p["door_collision"]
        for p in result["cases"]
    )
