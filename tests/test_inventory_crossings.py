"""Crosswalks from SFMTA's inventory at junctions where OpenStreetMap maps no crossing."""

from __future__ import annotations

import json
from pathlib import Path

from smc.render.inventory_crossings import inventory_crossings

ROOT = Path(__file__).resolve().parents[1]
K_LON, K_LAT = 88_000.0, 111_320.0


def street(name, a, b, road=12.0):
    return {"kind": "street", "name": name, "road_m": road, "points": [a, b]}


def ll(x, y):
    return [x / K_LON, 37.0 + y / K_LAT]


def test_a_four_way_junction_in_the_inventory_gets_a_band_across_each_leg() -> None:
    c = ll(0, 0)
    ways = [street("A", ll(-100, 0), c), street("A", c, ll(100, 0)),
            street("B", ll(0, -100), c, 18.0), street("B", c, ll(0, 100), 18.0)]
    out = inventory_crossings(ways, [{"p": ll(2, 1), "cnn": 1, "year": 2019}])
    assert len(out) == 4
    for crossing in out:
        assert crossing["kind"] == "crossing" and crossing["continental"]
        assert crossing["marking_provenance"] == "sfmta_crosswalk_inventory" and crossing["inferred_geometry"]
        (ax, ay), (bx, by) = [(p[0] * K_LON, (p[1] - 37.0) * K_LAT) for p in crossing["points"]]
        mx, my = (ax + bx) / 2, (ay + by) / 2
        # Just past the cross street's kerb: across A (east-west) the cross street is B, 18 m wide.
        expected = (18.0 if abs(my) < 1 else 12.0) / 2 + 3.66 / 2 + 0.5
        assert abs((mx ** 2 + my ** 2) ** 0.5 - expected) < 0.05


def test_a_junction_with_any_mapped_crossing_and_one_not_in_the_inventory_are_left_alone() -> None:
    c = ll(0, 0)
    ways = [street("A", ll(-100, 0), ll(100, 0)), street("B", ll(0, -100), c), street("B", c, ll(0, 100))]
    ways[0]["points"].insert(1, c)
    mapped = {"kind": "crossing", "points": [ll(-6, 9), ll(6, 9)]}
    assert inventory_crossings([*ways, mapped], [{"p": c}]) == []
    assert inventory_crossings(ways, []) == []
    assert len(inventory_crossings(ways, [{"p": c}])) == 4


def test_the_app_draws_the_inventory_crossings_and_the_website_payload_is_untouched() -> None:
    sidecar = json.loads((ROOT / "docs/app-inventory-crossings.json").read_text())
    assert sidecar["schema"] == "kerbside.inventory_crossings/1" and sidecar["junctions"] >= 150
    page = (ROOT / "docs/app-model.html").read_text()
    assert 'fetch(asset("app-inventory-crossings.json")' in page
    assert all(w.get("marking_provenance") != "sfmta_crosswalk_inventory"
               for w in json.loads((ROOT / "docs/sf-corridor-3d.json").read_text())["ways"])
