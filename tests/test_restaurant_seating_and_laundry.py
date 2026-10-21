"""Dining party sizes, coherent seating, wall backing and supported laundry stacks."""

from __future__ import annotations

import copy
import json
import subprocess
from pathlib import Path

import pytest
from shapely import affinity
from shapely.geometry import box, shape

from smc.interiors.inference.catalog import Catalog
from smc.interiors.inference.validate import validate_house
from smc.interiors.restaurants import RestaurantInput, infer_restaurant, validate_restaurant
from smc.interiors.restaurants.engine import restaurant_style
from smc.interiors.restaurants.seating import back_edge, solid_backing, wall_backed

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="module")
def dining():
    return infer_restaurant(
        RestaurantInput(
            "rotated-dining-probe",
            affinity.rotate(box(0, 0, 12, 14), 27, origin=(0, 0)),
            average_spend_per_person=65,
        )
    )


def test_joined_two_top_modules_form_two_four_and_six_person_tables(dining):
    assert validate_restaurant(dining)["passed"]
    assert {g["seat_count"] for g in dining["seating"]} == {2, 4, 6}
    f = dining["storeys"][0]
    assert len({o["asset"]["id"] for o in f["objects"] if o["role"] == "dining_chair"}) == 1
    assert len({o["asset"]["id"] for o in f["objects"] if o["role"] == "booth"}) == 1
    for group in dining["seating"]:
        assert len(group["table_ids"]) == group["seat_count"] // 2
        assert group["joined_modules"] == len(group["table_ids"])
    broken = copy.deepcopy(dining)
    group = next(g for g in broken["seating"] if g["seat_count"] == 6)
    group["table_ids"].pop()
    assert "invalid modular table capacity" in validate_restaurant(broken)["errors"]


def test_whole_booth_back_follows_solid_wall_and_rotation(dining):
    f = dining["storeys"][0]
    benches = [o for o in f["objects"] if o["role"] == "booth"]
    assert benches
    for b in benches:
        room = next(r for r in f["rooms"] if r["id"] == b["room_id"])
        wall = solid_backing({**room, "shape": shape(room["polygon"])}, f["openings"])
        x, _, y = b["position_m"]
        w, _, d = b["size_m"]
        assert wall_backed(back_edge(x, y, w, d, b["rotation_deg"]), wall)
    broken = copy.deepcopy(dining)
    bench = next(o for o in broken["storeys"][0]["objects"] if o["role"] == "booth")
    bench["rotation_deg"] += 90
    assert "booth back is not against a solid wall" in validate_restaurant(broken)["errors"]
    broken = copy.deepcopy(dining)
    chair = next(o for o in broken["storeys"][0]["objects"] if o["role"] == "dining_chair")
    chair["asset"]["id"] = "different chair"
    assert "inconsistent seating design within restaurant" in validate_restaurant(broken)["errors"]


def test_seating_design_is_stable_within_each_venue_and_varies_between_venues():
    catalog = Catalog()
    chairs = set()
    booths = set()
    for i in range(12):
        style = restaurant_style(
            RestaurantInput(f"venue-{i}", box(0, 0, 10, 12), average_spend_per_person=40)
        )
        choices = [
            catalog.choose("dining_chair", style, (0.45, 0.85, 0.45), f"item-{j}")["id"]
            for j in range(8)
        ]
        assert len(set(choices)) == 1
        chairs.update(choices)
        choices = [
            catalog.choose("booth", style, (1.44, 1.05, 0.58), f"item-{j}")["id"] for j in range(8)
        ]
        assert len(set(choices)) == 1
        booths.update(choices)
    assert len(chairs) >= 2
    assert len(booths) >= 2


def test_restaurant_equipment_wall_tile_keeps_the_wall_colour():
    script = """
import {wallTileColour,wallCapColour} from './docs/inferred-interiors/finishes.mjs';
console.log(JSON.stringify([
wallTileColour({style:{usage:'restaurant',stone:'#eee'}},'#789'),
wallTileColour({style:{stone:'#eee'}},'#789'),
wallCapColour({style:{usage:'restaurant'}},'#789'),
wallCapColour({style:{usage:'restaurant'}},'#eee','#789'),
wallCapColour({style:{}},'#789')]));
"""
    assert json.loads(
        subprocess.check_output(["node", "--input-type=module", "-e", script], cwd=ROOT, text=True)
    ) == ["#789", "#eee", "#789", "#789", "#e8e4da"]


def test_former_hall_recesses_have_wall_backed_physically_supported_stacks():
    manifest = json.loads((ROOT / "docs/inferred-interiors/manifest.json").read_text())
    stacks = 0
    for row in manifest["houses"]:
        h = json.loads((ROOT / "docs/inferred-interiors" / row["file"]).read_text())
        assert validate_house(h)["passed"]
        for f in h["storeys"]:
            for r in f["rooms"]:
                if not r.get("laundry_stack"):
                    continue
                stacks += 1
                assert r["reused_space"] == "former_hall_end"
                washer = next(
                    o
                    for o in f["objects"]
                    if o["room_id"] == r["id"] and o["role"] == "washing_machine"
                )
                dryer = next(
                    o
                    for o in f["objects"]
                    if o["room_id"] == r["id"] and o["role"] == "clothes_dryer"
                )
                assert dryer["support"]["id"] == washer["id"]
                assert dryer["position_m"][1] == pytest.approx(
                    washer["position_m"][1] + washer["size_m"][1]
                )
                assert shape(dryer["footprint"]).equals(shape(washer["footprint"]))
                broken = copy.deepcopy(h)
                d = next(
                    o for o in broken["storeys"][f["level"]]["objects"] if o["id"] == dryer["id"]
                )
                d["position_m"][1] += 0.10
                assert any("floating/intersecting" in e for e in validate_house(broken)["errors"])
    assert stacks >= 1
