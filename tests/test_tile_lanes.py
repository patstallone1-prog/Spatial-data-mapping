"""The far city's lane lines: from the street facts' cross-sections, as the street renderer's."""
from __future__ import annotations

import json
from pathlib import Path

from smc.tiles.compile import assets_for, lane_boundaries, lane_lines
from smc.tiles.tree import Frame

ROOT = Path(__file__).resolve().parents[1]
BOX = Frame(-122.4400, 37.7900, -122.4300, 37.8000)


def street(xs, points=((-122.4390, 37.7950), (-122.4310, 37.7950)), **extra):
    return {"kind": "street", "points": [list(p) for p in points], "xs": xs, **extra}


def station(s, bands, left=7.0, right=-7.0, status="r"):
    return [s, left, right, "M", status, bands]


TWO_WAY_FOUR = [["t", 3.5, "M", 0.8, -1], ["t", 3.5, "M", 0.8, -1],
                ["t", 3.5, "M", 0.8, 1], ["t", 3.5, "M", 0.8, 1]]


def test_opposing_lanes_meet_at_a_yellow_and_same_way_lanes_at_white():
    marks = lane_boundaries(station(10, TWO_WAY_FOUR))
    assert marks == [("white", 3.5), ("yellow", 0.0), ("white", -3.5)]
    # A turn lane in the middle has a yellow either side; parking against traffic, no line.
    turn = [["p", 2.4, "M", 0.8, 0], ["t", 3.2, "M", 0.8, -1], ["n", 3.2, "M", 0.8, 0], ["t", 3.2, "M", 0.8, 1]]
    assert [k for k, _ in lane_boundaries(station(10, turn, left=6.0, right=-6.0))] == ["yellow", "yellow"]


def test_an_unresolved_station_or_one_whose_lanes_cannot_close_is_not_painted():
    assert lane_boundaries(station(10, TWO_WAY_FOUR, status="u")) is None
    assert lane_boundaries(station(10, [["u", 14.0, "N", 0, 0]])) is None
    # Four lanes in thirty metres are not lanes.
    assert lane_boundaries(station(10, TWO_WAY_FOUR, left=15.0, right=-15.0)) is None


def test_lines_run_along_the_block_and_stop_short_of_its_ends():
    xs = [station(s, TWO_WAY_FOUR) for s in range(2, 700, 4)]
    out = lane_lines([street(xs)], BOX, 0.15)
    assert len(out["lanes_white"]) == 2 and len(out["lanes_yellow"]) == 1
    yellow = out["lanes_yellow"][0]
    xs_cm = yellow[0::2]
    length_m = (max(xs_cm) - min(xs_cm)) / 100
    way_m = (-122.4310 + 122.4390) * BOX.metres_per_lon
    assert way_m - 12 < length_m < way_m - 5
    # A gap in the facts breaks the line rather than painting through it.
    xs[60][4] = "u"
    assert len(lane_lines([street(xs)], BOX, 0.15)["lanes_yellow"]) == 2


def test_only_the_finest_tiles_carry_lanes_and_the_index_calls_them_derived():
    xs = [station(s, TWO_WAY_FOUR) for s in range(2, 700, 4)]
    way = street(xs, road_m=14.0)
    assert "lanes_yellow" in assets_for([way], BOX, 8)
    assert "lanes_yellow" not in assets_for([way], BOX, 7)
    index = json.loads((ROOT / "docs/tiles/index.json").read_text())
    assert set(index["derived_layers"]) == {"lanes_white", "lanes_yellow"}
    assert all("derived" in note for note in index["derived_layers"].values())
    lanes = [t for t in index["tiles"] if "lanes_yellow" in t["assets"]]
    assert lanes and all(t["id"].startswith("8/") for t in lanes)


def test_the_page_draws_the_lane_layers():
    source = (ROOT / "scripts/build_sf_corridor_3d.py").read_text()
    assert "function tileLaneLines(rows, kind, f, material)" in source
    assert 'tileLaneLines(layers.lanes_white, "white"' in source
    assert 'tileLaneLines(layers.lanes_yellow, "yellow"' in source
