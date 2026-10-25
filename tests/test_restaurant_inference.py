"""Restaurant physical acceptance, adverse inputs and rotating test cohorts."""

from __future__ import annotations

import copy
import json
import runpy
from pathlib import Path

import pytest
from shapely import affinity
from shapely.geometry import Polygon, box

from smc.interiors.restaurants import RestaurantInput, infer_restaurant, validate_restaurant
from smc.interiors.restaurants.engine import KITCHEN_ROLES, restaurant_style

ROOT = Path(__file__).resolve().parents[1]
LAB = ROOT / "docs/inferred-restaurants"


@pytest.fixture(scope="module")
def latest():
    history = json.loads((LAB / "history.json").read_text())
    return history["rounds"][-1]


def test_each_round_keeps_failures_and_replaces_every_prior_success(latest):
    history = json.loads((LAB / "history.json").read_text())
    seen_success = set()
    previous_failures = set()
    for run in history["rounds"]:
        selected = {row["id"] for row in run["selected"]}
        assert len(selected) == 5
        assert previous_failures <= selected
        assert not seen_success & selected
        assert {r["id"] for r in run["results"]} == selected
        assert run["status"] == "complete"
        previous_failures = {r["id"] for r in run["results"] if not r["passed"]}
        seen_success |= {r["id"] for r in run["results"] if r["passed"]}
    assert len(seen_success) >= 10
    # Future selection is equally constrained, and caller changes cannot edit history.
    builder = runpy.run_path(str(ROOT / "scripts/build_inferred_restaurants.py"))
    before = copy.deepcopy(history)
    selected = builder["select_round"](builder["candidates"](), history)
    assert previous_failures <= {r["id"] for r in selected}
    assert not seen_success & {r["id"] for r in selected}
    selected[0]["average_spend_per_person"] = 999
    assert history == before


def test_current_successes_have_connected_routes_and_required_inventory(latest):
    for record in latest["results"]:
        if not record["passed"]:
            assert record["reason"].startswith("no feasible restaurant:")
            continue
        h = json.loads((LAB / record["file"]).read_text())
        assert validate_restaurant(h)["passed"]
        assert h["provenance"]["tenant_boundary"] != "measured"
        assert h["measured"] is False
        assert h["style"]["economic_evidence"].startswith(("illustrative", "Google"))
        if h["style"].get("price_evidence"):
            assert h["style"]["price_evidence"]["venue_id"] == h["id"]
        roles = {o["role"] for o in h["storeys"][0]["objects"]}
        assert KITCHEN_ROLES <= roles
        assert h["validation"]["metrics"]["customer_route_width_m"] == 0.95


def test_corrupt_workstation_seat_capacity_and_props_are_rejected(latest):
    record = next(
        r
        for r in latest["results"]
        if r["passed"] and json.loads((LAB / r["file"]).read_text())["seating"]
    )
    source = json.loads((LAB / record["file"]).read_text())
    h = copy.deepcopy(source)
    h["storeys"][0]["objects"] = [
        o for o in h["storeys"][0]["objects"] if o["role"] != "commercial_hood"
    ]
    assert "missing professional kitchen station" in validate_restaurant(h)["errors"]
    h = copy.deepcopy(source)
    obj = next(o for o in h["storeys"][0]["objects"] if o["role"] == "commercial_range")
    target = next(t for t in h["interaction_targets"] if t["room_id"] == obj["room_id"])
    target["point"] = [obj["position_m"][0], obj["position_m"][2]]
    assert any("unreachable" in e for e in validate_restaurant(h)["errors"])
    h = copy.deepcopy(source)
    h["seating"][0]["seat_count"] += 2
    assert "seating capacity does not match furniture" in validate_restaurant(h)["errors"]
    h = copy.deepcopy(source)
    prop = next(o for o in h["storeys"][0]["objects"] if o["support"]["kind"] == "object")
    prop["position_m"][1] += 0.1
    assert "floating table prop" in validate_restaurant(h)["errors"]


def test_unseen_rotated_shape_with_bar_and_compact_pickup():
    p = affinity.rotate(box(0, 0, 12, 14), 31, origin=(0, 0))
    bar = infer_restaurant(RestaurantInput("unseen-bar", p, bar=True, average_spend_per_person=70))
    assert validate_restaurant(bar)["passed"]
    assert any(
        o["role"] == "bar_counter" and "staff_aisle" in o for o in bar["storeys"][0]["objects"]
    )
    assert not bar.get("omitted_optional_features")
    pickup = infer_restaurant(
        RestaurantInput("unseen-pickup", box(0, 0, 4.6, 8), average_spend_per_person=12)
    )
    assert pickup["service_mode"] == "pickup"
    assert pickup["validation"]["passed"] and not pickup["seating"]


def test_spend_changes_finishes_but_keeps_palette_and_missing_price_evidence():
    low = restaurant_style(
        RestaurantInput("stable", box(0, 0, 10, 10), average_spend_per_person=15)
    )
    high = restaurant_style(
        RestaurantInput("stable", box(0, 0, 10, 10), average_spend_per_person=75)
    )
    assert low["walls"] == high["walls"] and low["id"] == high["id"]
    assert low["tier"] == "economy" and high["tier"] == "premium"
    assert low["furnishing_finish"] != high["furnishing_finish"]
    missing = restaurant_style(RestaurantInput("stable", box(0, 0, 10, 10)))
    assert missing["average_spend_per_person"] is None
    assert missing["economic_evidence"] == "unspecified"
    with pytest.raises(ValueError, match="exchange rates"):
        RestaurantInput("currency", box(0, 0, 10, 10), currency="EUR")
    with pytest.raises(ValueError, match="valid finite"):
        RestaurantInput("bowtie", Polygon([(0, 0), (10, 10), (10, 0), (0, 10)]))
