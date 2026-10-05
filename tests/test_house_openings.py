"""Garages only where their own kerb cut is, and a front door on every house, never under one."""

from __future__ import annotations

import json
import re
import subprocess

import pytest

from tests.test_corridor_geometry_rules import NODE, _extract, _page_js

pytestmark = pytest.mark.skipif(NODE is None, reason="node is not installed")

# A flat metre frame: lon/lat are metres / 100000, and y is north.
PREAMBLE = """
const xy = (lon, lat) => [lon * 100000, lat * 100000];
const M = (x, y) => [x / 100000, y / 100000];
function buildingAt() { return null; }
function photographedEdge() { return false; }
// The street is to the north.
function streetDistanceFacing(wall) { return wall.nz < -0.5 ? 5 : Infinity; }
const GARAGE_REACH_PAGE_M = 22;
const GARAGE_HEIGHT_M = 2.7;
const GARAGE_DOOR_ROOM_M = 1.75;
"""


def _run(body: str, names: tuple[str, ...]) -> dict:
    js = _page_js()
    consts = "\n".join(re.search(rf"const {n} = [0-9.]+;", js).group(0)
                       for n in ("DOOR_CLEAR_M", "DOOR_LEAF_M"))
    script = PREAMBLE + consts + "\n" + "\n".join(_extract(n, js) for n in names) + "\n" + body
    out = subprocess.run([NODE, "-"], input=script, capture_output=True, text=True, timeout=30)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


def _house(x0: float, width: float) -> str:
    # A 10 m deep house, its street wall along y = 0 facing north (outward is +y).
    return (f"{{ kind: 'building', covered: true, points: [M({x0}, 0), M({x0}, -10), "
            f"M({x0 + width}, -10), M({x0 + width}, 0), M({x0}, 0)] }}")


def test_a_neighbours_cut_moves_to_the_house_it_is_in_front_of_and_duplicates_merge() -> None:
    result = _run(f"""
    const a = {_house(0, 7)}, b = {_house(7, 7)};
    // Both cuts were attached to house a; the second is in front of house b.
    const g = (cx) => ({{ a: M(7, 0), b: M(0, 0), t: 0.5, w: 2.6, n: 0, cp: M(cx, 3) }});
    a.garages = [g(3.5), g(10.5), g(3.6)];
    normaliseGarages([a, b]);
    console.log(JSON.stringify({{ a: a.garages.length, b: (b.garages || []).length,
      cutsKept: a.kerb_cuts.length }}));
    """, ("outwardBearing", "normaliseGarages"))
    assert result == {"a": 1, "b": 1, "cutsKept": 3}


def test_the_front_door_is_beside_the_garage_never_under_it() -> None:
    result = _run(f"""
    const house = {_house(0, 7.5)};
    house.garages = [{{ a: M(7.5, 0), b: M(0, 0), t: 0.5, w: 2.6, n: 0 }}];
    const spot = frontDoorSpot(house);
    const garages = garagesOnWall(house, spot.wall);
    console.log(JSON.stringify({{ along: spot.along, garage: garages[0].along, gw: garages[0].w,
      street: spot.wall.nz < 0 }}));
    """, ("footprintWalls", "bestFacadeWall", "garagesOnWall", "frontDoorSpot"))
    assert result["street"], "the door is on the street wall"
    gap = abs(result["along"] - result["garage"])
    assert gap >= result["gw"] / 2 + 1.05 / 2 + 0.35 - 1e-6


def test_an_inferred_interior_door_under_a_garage_moves_beside_it() -> None:
    result = _run(f"""
    function distanceToSegmentSquared(px, pz, ax, az, bx, bz) {{
      const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz || 1;
      let t = ((px - ax) * dx + (pz - az) * dz) / L; t = Math.max(0, Math.min(1, t));
      return (ax + dx * t - px) ** 2 + (az + dz * t - pz) ** 2;
    }}
    function insideFootprint(entry, x, z) {{ return x > 0 && x < 7.5 && z > 0 && z < 10; }}
    const way = {_house(0, 7.5)};
    way.garages = [{{ a: M(7.5, 0), b: M(0, 0), t: 0.5, w: 2.6, n: 0 }}];
    // Page frame: z = -y, so the street wall (y = 0) is the edge z = 0 from x = 7.5 to x = 0.
    const entry = {{ way, local: [[7.5, 0], [0, 0], [0, 10], [7.5, 10], [7.5, 0]] }};
    // Inferred, dead centre: under the garage.
    entry.doors = [doorOn(entry, 0, 0.5, 1.0, 2)];
    settleDoors(entry);
    const d = entry.doors[0];
    console.log(JSON.stringify({{ n: entry.doors.length, centre: (d.t0 + d.t1) / 2 * 7.5 }}));
    """, ("garageSpansOnEdge", "doorOn", "settleDoors"))
    assert result["n"] == 1
    # The garage spans 3.75 +- 1.3 m along the edge; the door's centre clears it by half a leaf.
    assert abs(result["centre"] - 3.75) >= 1.3 + 0.5 + 0.35 - 1e-6


def test_a_narrow_house_with_two_cuts_in_front_gets_one_garage_door() -> None:
    result = _run(f"""
    const a = {_house(0, 8.3)};
    a.garages = [{{ a: M(8.3, 0), b: M(0, 0), t: 0.25, w: 2.93, n: 0, cp: M(2.0, 3) }},
                 {{ a: M(8.3, 0), b: M(0, 0), t: 0.75, w: 2.93, n: 0, cp: M(6.0, 3) }}];
    normaliseGarages([a]);
    console.log(JSON.stringify({{ n: a.garages.length, w: a.garages[0].w }}));
    """, ("outwardBearing", "normaliseGarages"))
    assert result["n"] == 1
    assert result["w"] <= 8.3 * 0.62 + 1e-9


def test_a_garage_leaves_room_on_its_frontage_for_the_front_door() -> None:
    result = _run(f"""
    const a = {_house(0, 6.0)};
    a.garages = [{{ a: M(6, 0), b: M(0, 0), t: 0.5, w: 4.9, n: 0, cp: M(3, 3) }}];
    normaliseGarages([a]);
    const spot = frontDoorSpot(a);
    console.log(JSON.stringify({{ w: a.garages[0].w, door: Boolean(spot),
      street: spot && spot.wall.nz < 0 }}));
    """, ("outwardBearing", "normaliseGarages", "footprintWalls", "bestFacadeWall", "garagesOnWall",
          "frontDoorSpot"))
    assert result["w"] < 4.9 and result["door"] and result["street"]


def test_a_house_shell_lights_like_the_batched_house_it_replaces() -> None:
    """The colour change as a house came into range was the shell's material: three.js's default
    environment intensity (1.0) against the batch's 0.35, and near-clear glass against dark
    panes. Both must keep matching."""
    js = _page_js()
    rule = r'name === "glass" \? 1\.6 : {0}name === "metal" \? 1\.1 : 0\.35'
    batched = re.search(r"envMapIntensity: material\." + rule.format(r"material\."), js)
    shell = re.search(r"envMapIntensity: spec\.material\." + rule.format(r"spec\.material\."), js)
    assert batched and shell, "the shell wall must reflect the sky as the batched wall does"
    glass = re.search(r"const homeGlassMaterial = new THREE\.MeshStandardMaterial\(\{ "
                      r"color: (0x[0-9a-f]+),\s*transparent: true, opacity: ([0-9.]+)", js)
    assert glass and float(glass.group(2)) >= 0.4, "shell glass must read as the batch's dark panes"
