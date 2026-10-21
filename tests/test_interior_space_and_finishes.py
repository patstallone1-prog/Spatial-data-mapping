"""Spatial economy and coordinated finishes, independent of address-specific snapshots."""

import json
import subprocess
from pathlib import Path

import pytest
from shapely.geometry import LineString, box, shape
from shapely.ops import unary_union

from smc.interiors.inference.efficiency import blind_corridor_ends, trim_blind_ends
from smc.interiors.inference.style import door_finish, house_style, room_materials
from smc.interiors.restaurants.engine import space_audit

ROOT = Path(__file__).resolve().parents[1]
LAB = ROOT / "docs/inferred-interiors"


def test_blind_branch_is_donated_without_losing_any_floor_area_or_door_approach():
    rooms = [
        {"id": "hall", "kind": "hallway", "shape": box(4, 0, 5.12, 7)},
        {"id": "bed", "kind": "bedroom", "shape": box(0, 0, 4, 7)},
    ]
    portal = {
        "rooms": ["hall", "bed"],
        "segment": {"type": "LineString", "coordinates": [[4, 5.6], [4, 6.5]]},
    }
    original = unary_union([r["shape"] for r in rooms])
    assert len(blind_corridor_ends(rooms[0]["shape"], [shape(portal["segment"])])) == 1
    updated, reclaimed = trim_blind_ends(rooms, [portal])
    hall = updated[0]["shape"]
    assert reclaimed > 4
    assert not blind_corridor_ends(hall, [shape(portal["segment"])])
    assert original.symmetric_difference(unary_union([r["shape"] for r in updated])).area < 1e-8
    assert updated[0]["shape"].intersection(updated[1]["shape"]).area < 1e-8
    assert hall.buffer(0.001).covers(LineString([[4.55, 5.4], [4.55, 6.5]]))
    assert rooms[0]["shape"].area == pytest.approx(7 * 1.12), "input was mutated"


def test_pilot_has_no_blind_corridors_or_empty_or_oversized_wet_rooms():
    manifest = json.loads((LAB / "manifest.json").read_text())
    assert manifest["passed"] == 16
    reclaimed = 0
    added_half_baths = 0
    for row in manifest["houses"]:
        h = json.loads((LAB / row["file"]).read_text())
        for f in h["storeys"]:
            reclaimed += f["space_efficiency"]["hallway_reclaimed_m2"]
            added_half_baths += f["space_efficiency"]["half_baths_added"]
            for r in f["rooms"]:
                if r["kind"] == "hallway":
                    assert not blind_corridor_ends(
                        shape(r["polygon"]),
                        [shape(o["segment"]) for o in f["openings"] if r["id"] in o["rooms"]],
                    ), r["id"]
                if r["kind"] not in {"toilet", "full_bathroom"}:
                    continue
                roles = {o["role"] for o in f["objects"] if o["room_id"] == r["id"]}
                assert {"toilet", "bath_sink"} <= roles
                assert r["area_m2"] <= (5.5 if r["kind"] == "toilet" else 8.5) + 0.001
                if r["kind"] == "full_bathroom":
                    assert "bath_shower" in roles
                    tub = next(
                        o
                        for o in f["objects"]
                        if o["room_id"] == r["id"] and o["role"] == "bath_shower"
                    )
                    assert tub["size_m"][0] >= 1.45
                    assert tub["size_m"][1] == 0.6
    assert reclaimed > 10
    assert added_half_baths >= 1


def test_room_colours_and_door_construction_are_coordinated_and_different():
    for key in ("one", "two", "three", "four", "five", "six"):
        style = house_style(key, 180, 650)
        mats = [
            room_materials(style, kind, i)
            for i, kind in enumerate(("living", "kitchen", "dining", "toilet", "bedroom"))
        ]
        assert len({m["wall"] for m in mats}) >= 4
        assert {m["wood"] for m in mats} == {style["wood"]}
        assert all(m["wall"] not in {"#ffffff", "#f9f9f9"} for m in mats)
        assert door_finish(style, "bedroom", "a")["design"] == "recessed_panels"
        assert door_finish(style, "full_bathroom", "b")["design"] == "reeded_privacy"
        assert door_finish(style, "office", "c")["design"] == "glazed_office"
        assert door_finish(style, "living", "d", True)["design"] == "glazed_entry"


def test_exterior_lining_selects_each_adjacent_room_finish():
    script = """
import {wallRoom,wallRoomCuts} from './docs/inferred-interiors/finishes.mjs';
const room=(id,x0,x1)=>({id,
polygon:{type:'Polygon',coordinates:[[[x0,0],[x1,0],[x1,4],[x0,4],[x0,0]]]}});
const f={rooms:[room('living',0,4),room('kitchen',4,8)]};
console.log(JSON.stringify([wallRoom(f,[0,0],[8,0],2).id,wallRoom(f,[0,0],[8,0],6).id,wallRoomCuts(f,[0,0],[8,0])]));
"""
    result = json.loads(
        subprocess.check_output(["node", "--input-type=module", "-e", script], cwd=ROOT, text=True)
    )
    assert result[:2] == ["living", "kitchen"]
    assert 4 in result[2]


def test_restaurant_waste_audit_detects_a_stranded_clear_floor_pocket():
    room = {"id": "d", "kind": "dining", "polygon": box(0, 0, 8, 5).__geo_interface__}
    h = {
        "storeys": [
            {
                "rooms": [room],
                "inside": room["polygon"],
                "openings": [
                    {
                        "rooms": ["d", "outside"],
                        "segment": LineString([(0, 1), (0, 2)]).__geo_interface__,
                    }
                ],
                "objects": [
                    {
                        "room_id": "d",
                        "support": {"kind": "floor"},
                        "footprint": box(3, 0, 4, 5).__geo_interface__,
                    }
                ],
            }
        ],
        "seating": [],
    }
    assert space_audit(h)["isolated_clear_floor_m2"] > 5
    h["storeys"][0]["objects"] = []
    assert space_audit(h)["isolated_clear_floor_m2"] == 0
