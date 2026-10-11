"""Every rectangle on a front is something; detail is shared; gates close; garages cut the kerb."""

from __future__ import annotations

import json
import re
import subprocess

import pytest

from smc.facades.coarse_openings import assign_roles, group_windows, share_window_detail
from tests.test_corridor_geometry_rules import NODE, _extract, _page_js

STOREY = {"status": "inferred", "storey_height_m": 3.0}


def _o(id_, kind, u, v, w, h, label=None, cls=None, **extra):
    o = {"id": id_, "kind": kind, "u": u, "v": v, "w": w, "h": h, "confidence": 0.5,
         "design": {"vertical_bars": [], "horizontal_bars": []}}
    if label or cls:
        o["opening_reasoning"] = {"original_label": label or kind, "class": cls or "unknown"}
    o.update(extra)
    return o


def test_shape_and_height_decide_what_a_rectangle_is() -> None:
    found = [
        _o("up", "door", 2.0, 6.5, 0.9, 2.0, label="door"),            # 20 ft up: a window
        _o("car", "door", 3.5, 0.1, 2.5, 2.2, label="door"),            # a car's width: a garage
        _o("tag", "door", 0.4, 0.2, 1.8, 1.6, label="garage door"),     # labelled, car width
        _o("wide", "door", 0.2, 0.0, 7.2, 2.8, label="door"),           # a whole storey band
        _o("ped", "door", 6.2, 0.1, 0.9, 2.1, label="door"),            # a person's door
    ]
    assign_roles(found, {"entries": []}, 8.0, 10.0, STOREY)
    roles = {o["id"]: (o["role"], o["role_certainty"]) for o in found}
    assert roles["up"] == ("window", "medium")
    assert roles["car"] == ("garage", "medium") and roles["tag"] == ("garage", "medium")
    assert roles["wide"][0] == "unresolved" and roles["ped"] == ("entrance", "medium")


def test_anything_a_fence_stair_or_alcove_stands_at_is_an_entrance_and_panels_make_a_garage() -> None:
    found = [_o("d", "door", 2.0, 0.0, 2.3, 2.2, label="door"),
             _o("g", "garage_candidate", 5.0, 0.0, 2.4, 2.1, cls="garage_candidate")]
    entries = {"entries": [{"door_id": "x", "u": 2.2, "w": 1.0, "kind": "flat_alcove",
                            "gate": {"u": 2.0, "w": 1.6}}]}
    assign_roles(found, entries, 8.0, 9.0, STOREY)
    assert found[0]["role"] == "entrance" and "at_entry:flat_alcove+gate" in found[0]["role_basis"]
    assert (found[1]["role"], found[1]["role_certainty"]) == ("garage", "high")


def test_a_wide_low_ground_opening_is_a_garage_and_sills_are_read_from_the_lowest_opening() -> None:
    # The photograph's foot is a metre below the doors: the sill is still at the ground.
    found = [_o("g", "door", 3.0, 1.1, 1.73, 1.67, label="door"),
             _o("p", "door", 5.5, 1.0, 0.7, 1.9, label="door")]
    assign_roles(found, {"entries": []}, 8.0, 9.4, STOREY)
    assert found[0]["role"] == "garage" and found[0]["role_basis"] == ["ground_opening_wider_than_tall"]
    assert found[1]["role"] == "entrance"


def test_a_bay_holds_a_window_on_each_storey_a_small_pane_does_not_fill_it_and_eaves_are_not_bays() -> None:
    found = [_o("pane", "window", 1.7, 4.5, 0.43, 0.59)]
    assign_roles(found, {"entries": []}, 7.7, 10.0, STOREY)
    details = [{"kind": "canopy", "box": [0.0, 0.13, 0.37, 0.65], "score": 0.59},   # a 2-storey bay
               {"kind": "canopy", "box": [0.47, 0.18, 0.86, 0.32], "score": 0.35},  # an eave
               {"kind": "canopy", "box": [0.1, 0.0, 0.5, 0.3], "score": 0.4}]      # the roof's
    added = group_windows(found, details, 7.7, 10.0, STOREY)
    assert len(added) == 2 and all(o["role"] == "window" and o["size_inferred"] for o in added)
    assert added[0]["v"] < 6.0 < added[1]["v"]


def test_a_plain_window_takes_the_panes_of_one_of_its_shape_and_an_inferred_one_its_size() -> None:
    read = _o("read", "window", 1.0, 3.0, 1.2, 1.6, role="window",
              design={"vertical_bars": [0.5], "horizontal_bars": [0.3], "shape": "standard"})
    plain = _o("plain", "window", 4.0, 3.05, 1.25, 1.55, role="window")
    other = _o("other", "window", 4.0, 6.0, 0.5, 2.0, role="window")
    guessed = _o("guess", "window", 1.0, 6.2, 1.35, 1.0, role="window", size_inferred=True)
    found = [read, plain, other, guessed]
    assert share_window_detail(found) == 2
    assert plain["design"]["vertical_bars"] == [0.5] and plain["design"]["detail_from"] == "read"
    assert plain["w"] == 1.25, "a measured window keeps its own size"
    assert other["design"]["vertical_bars"] == [], "a different shape borrows nothing"
    assert (guessed["w"], guessed["h"], guessed["size_from"]) == (1.2, 1.6, "read")
    assert abs(guessed["u"] + guessed["w"] / 2 - (1.0 + 1.35 / 2)) < 1e-6, "about its own centre"


def _node(script: str) -> dict:
    if NODE is None:
        pytest.skip("node is not installed")
    out = subprocess.run([NODE, "-"], input=script, capture_output=True, text=True, timeout=30)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


def _const(js: str, name: str) -> str:
    return re.search(rf"const {name} = [^;]+;", js).group(0)


# A door on the edge z = 0 of a house from x = 0 to 8, the house at z < 0... in the door's frame
# outward is -n: n = (0, -1) points into the house (z < 0), so "out" is +z, toward the street.
GATE_DOOR = """
const door = { cx: 4, cz: 0, ux: 1, uz: 0, nx: 0, nz: -1, edge: 0,
  entry: { local: [[0, 0], [8, 0], [8, -10], [0, -10], [0, 0]] } };
const house = (x, z) => x > 0 && x < 8 && z < 0 && z > -10;
"""


def test_a_gate_on_the_property_line_is_fenced_to_the_neighbours_walls_with_no_gap() -> None:
    js = _page_js()
    result = _node("\n".join([_const(js, "FENCE_REACH_M"), _const(js, "FENCE_MEETS_M"),
                              _extract("gateLayout", js), GATE_DOOR, """
    // Neighbours either side stand forward of this house, to the property line and beyond.
    const solid = (x, z) => house(x, z) || ((x < 0.5 || x > 7.2) && z < 3);
    const l = gateLayout(door, 1.2, 2.0, false, solid);
    console.log(JSON.stringify({ ok: l.ok, runs: l.runs.map(r => r.map(v => +v.toFixed(2))) }));
    """]))
    assert result["ok"]
    left, right = sorted(result["runs"], key=lambda r: r[2])
    assert abs(left[2] - (0.5 - 4)) <= 0.06 and abs(right[2] - (7.2 - 4)) <= 0.06


def test_with_no_wall_on_the_line_the_fence_returns_to_the_house_and_a_gate_in_a_wall_is_refused() -> None:
    js = _page_js()
    result = _node("\n".join([_const(js, "FENCE_REACH_M"), _const(js, "FENCE_MEETS_M"),
                              _extract("gateLayout", js), GATE_DOOR, """
    const open = gateLayout(door, 1.2, 2.0, false, house);
    const walled = gateLayout(door, 1.2, 2.0, false, (x, z) => house(x, z) || z > 1.5);
    // A garage to the right, from 1.5 to 4 m along: the fence turns back to the wall before it.
    const garage = gateLayout(door, 1.2, 2.0, false, house, [[1.2, 4.3]]);
    const recess = gateLayout(door, 1.4, 0.03, true, house);
    const tooWide = gateLayout({ ...door, cx: 0.5 }, 1.4, 0.03, true, house);
    console.log(JSON.stringify({ open: open.ok, runs: open.runs.length,
      returns: open.runs.filter(r => r[3] === 0).map(r => r[2]), walled: walled.ok, why: walled.gaps,
      recess: recess.ok, tooWide: tooWide.ok, garage: garage.ok,
      garageReturn: garage.runs.filter(r => r[3] === 0).map(r => r[2]) }));
    """]))
    assert result["open"] and result["runs"] == 4 and sorted(result["returns"]) == [-4, 4]
    assert not result["walled"] and result["why"] == ["gate_inside_a_building"]
    assert result["recess"] and not result["tooWide"], "a recess mouth closes only against the front"
    assert result["garage"] and sorted(result["garageReturn"]) == [-4, 1.2], "never across the garage"


def test_a_photographed_garage_is_drawn_without_a_kerb_cut_and_cuts_one() -> None:
    js = _page_js()
    pre = """
    const xy = (lon, lat) => [lon * 100000, lat * 100000];
    const M = (x, y) => [x / 100000, y / 100000];
    const GARAGE_STYLES = 6;
    const PHOTO_GARAGE_CERTAINTY = new Set(["medium", "high"]);
    const fit = { a: M(0, 0), b: M(8, 0), openings: [
      { id: "g", role: "garage", role_certainty: "medium", u: 4.5, w: 2.4, v: 0, h: 2.2, design: { colour: "#ffffff" } },
      { id: "e", role: "entrance", role_certainty: "high", u: 1.0, w: 1.0, v: 0, h: 2.1 },
      { id: "x", role: "garage", role_certainty: "low", u: 0.2, w: 2.4, v: 0, h: 2.2 } ] };
    function frontageFitFor() { return fit; }
    // The street is to the south (y < 0); the house is north of y = 0.
    const way = { kind: "building", covered: true, osm_id: 7,
      points: [M(0, 0), M(8, 0), M(8, 10), M(0, 10), M(0, 0)],
      garages: [{ a: M(0, 0), b: M(8, 0), t: 0.19, w: 2.6, n: 180 }] };
    function nearestKerbAt(x, z, reach) {
      // The kerb runs along z = 5 (y = -5); its normal points out of the road, back at the house.
      return Math.abs(z - 5) <= reach ? { x, z: 5, nx: 0, nz: -1 } : null;
    }
    const photoDropStats = { cut: 0, noKerb: 0 };
    """
    result = _node("\n".join([pre, _const(js, "PHOTO_KERB_REACH_M"), _extract("outwardBearing", js),
                              _extract("fitOpeningOnOutline", js), _extract("addPhotoGarages", js),
                              _extract("photoKerbDrop", js), """
    const stats = addPhotoGarages([way]);
    const photo = way.garages.find(g => g.photo);
    const drop = photoKerbDrop(photo);
    console.log(JSON.stringify({ stats, n: way.garages.length, t: photo.t, h: photo.h, colour: photo.colour,
      bearing: Math.round(photo.n), drop: { z: drop.z, oz: drop.oz, half: drop.half, depth: drop.depth } }));
    """]))
    assert result["stats"] == {"photo": 1, "kerbReplaced": 1}, "the low one is not drawn; the kerb's goes"
    assert result["n"] == 1 and abs(result["t"] - (4.5 + 1.2) / 8) < 1e-9
    assert result["h"] == 2.2 and result["colour"] == "#ffffff" and result["bearing"] == 180
    assert result["drop"] == {"z": 5, "oz": -1, "half": 1.2, "depth": 3.0}


def test_houses_keep_their_colour_without_a_measured_height_and_roles_reach_the_renderer() -> None:
    js = _page_js()
    assert "hsl.s * 0.35" not in js, "an inferred height no longer greys a building out"
    assert '(o.role || o.kind) === "window"' in _extract("frontageWindowsOnEdge", js)
    parts = _extract("photoOpeningParts", js)
    assert 'o.id===fit.primary_entry?.door_id' in parts and '["window","entrance"].includes(role)' in parts
    gate = _extract("addGate", js)
    assert "if (!layout.ok) { gateStats.refused += 1;" in gate
    assert "if (!g.photo || !PHOTO_GARAGE_CERTAINTY.has(g.certainty)) continue;" in _extract(
        "dropKerbsAtDriveways", js)
