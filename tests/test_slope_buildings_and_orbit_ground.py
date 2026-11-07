"""A building on a slope is as tall as the lidar measured it over the ground at its foot, not
buried to its roof on the uphill side; the orbit view stops at the ground instead of tilting
up past it."""

from __future__ import annotations

import json
import subprocess

import pytest

from tests.test_corridor_geometry_rules import NODE, _extract, _page_js

pytestmark = pytest.mark.skipif(NODE is None, reason="node is not installed")


def _node(script: str):
    out = subprocess.run([NODE, "-"], input=script, capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


def _rise_harness(js: str) -> str:
    return ("var BUILDING_FOOT_PAD_M = 4, BUILDING_RISE_MAX_M = 12, BUILDING_FOOT_SAMPLES = 400;\n"
            "const TERRAIN_FRAME = true; const xy = (lon, lat) => [lon, lat];\n"
            "let slope = 0; const terrainHeightAt = (x, z) => 60 + slope * x;\n"
            + _extract("groundBaseFor", js) + _extract("groundRiseFor", js))


def test_a_building_on_a_slope_is_drawn_up_to_the_roof_the_lidar_measured() -> None:
    js = _page_js()
    out = _node(_rise_harness(js) + """
// The Oxford Research Unit: about 74 by 49 m, on a fall of some five metres west to east.
const ring = [[0, 0], [74, 0], [74, 49], [0, 49], [0, 0]];
const at = (s) => { slope = s; return { low: groundBaseFor(ring), rise: groundRiseFor(ring) }; };
console.log(JSON.stringify({ flat: at(0), oxford: at(0.07), cliff: at(1.5) }));
""")
    assert out["flat"]["rise"] == 0, "flat ground: drawn exactly as tall as measured"
    # The low corner is the base; the measure was over the median ground, the middle of the fall.
    assert out["oxford"]["low"] == pytest.approx(60)
    assert out["oxford"]["rise"] == pytest.approx(0.07 * 37, abs=0.35)
    assert out["cliff"]["rise"] == 12, "capped, so a bad terrain cell cannot raise a house on stilts"


def test_the_rise_is_added_to_a_drawn_building_and_its_roof_is_what_the_camera_meets() -> None:
    js = _page_js()
    mesh = _extract("buildingMesh", js)
    assert "groundRiseFor(feature.points, hillLift)" in mesh
    assert "if (rise > 0.05) { height += rise; feature._groundRiseM = +rise.toFixed(2); }" in mesh
    # Not a lot at one level (a car park, a filling station) nor a building drawn as its parts.
    assert "!shaped && !ARCHETYPE_LOT_KINDS.has(feature.archetype)" in mesh
    # The roof the camera stops at, and the picked prism, are the drawn roof.
    out = _node(_extract("buildingTopAt", js) + """
const way = { height_m: 6, _treeClipRoof: 76.5 };
const buildingAt = () => way; const groundLiftAt = () => 70;
const drawn = buildingTopAt(0, 0).top;
delete way._treeClipRoof;
console.log(JSON.stringify({ drawn, measured: buildingTopAt(0, 0).top }));
""")
    assert out["drawn"] == pytest.approx(76.8)
    assert out["measured"] == pytest.approx(76.3)
    assert "entry.way._treeClipRoof??" in _extract("pickRayBuilding", js)


def test_the_orbit_stops_at_the_ground_and_never_tilts_up_past_it() -> None:
    js = _page_js()
    place = _extract("placeCamera", js)
    assert "camera.position.y < floor + ORBIT_GROUND_CLEAR_M" in place
    assert "camera.position.y = floor + ORBIT_GROUND_CLEAR_M;" in place
    # Not for a walker under the ground (a tunnel, a station): its bore keeps the camera.
    assert "!(state.target.y < under - 1)" in place
    assert "var ORBIT_GROUND_CLEAR_M = 0.8, cameraOnGround = false;" in js
    # The drag: no tilt past the lowest pitch, and no winding the pitch on under the ground.
    out = _node("""
const ORBIT_MIN_PITCH = 0.25; let cameraOnGround = false;
const state = { pitch: 0.3, tilt: 0 };
function drag(dy) {
  const v = state.pitch + dy * 0.004;
  if (!(cameraOnGround && v < state.pitch)) state.pitch = Math.max(ORBIT_MIN_PITCH, Math.min(1.28, v));
  state.tilt = 0;
}
drag(-200); const floor = { ...state };
cameraOnGround = true; state.pitch = 0.6; drag(-50); const grounded = { ...state };
drag(50); const back = { ...state };
console.log(JSON.stringify({ floor, grounded, back }));
""")
    assert out["floor"] == {"pitch": 0.25, "tilt": 0}
    assert out["grounded"]["pitch"] == 0.6, "held where the ground stopped it"
    assert out["back"]["pitch"] == pytest.approx(0.8), "and moves again at once dragged back up"
    assert "if (!(cameraOnGround && v < state.pitch)) state.pitch" in js


def test_an_unbuilt_parcel_fallback_never_paints_over_a_mapped_car_park() -> None:
    js = _page_js()
    at = js.index('"neutral_ground");')
    block = js[js.index("const neutralServiceGeom", at - 3000):at + 80]
    # Drawn first after the terrain and without a depth test, so a mapped surface wins.
    assert "depthTest: false" in block
    assert "neutralMesh.renderOrder = -1.6;" in block
    order = {
        "terrain": "tile.renderOrder = -2;",
        "inferred": "mesh.renderOrder = -1.5;",
        "yards": 'if (what === "yard" || what === "park") mesh.renderOrder = -1;',
    }
    for name, line in order.items():
        assert line in js, name
