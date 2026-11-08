"""A building behind the orbit camera lifts the view over its roof, at the distance asked for,
instead of shoving the camera in against its wall (under an awning, in the dark between a
shopfront and the pavement, away from the walker)."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from tests.test_corridor_geometry_rules import NODE, _extract, _page_js

ROOT = Path(__file__).resolve().parents[1]
THREE = ROOT / "docs/vendor/three-0.160.0/three.module.min.js"
pytestmark = pytest.mark.skipif(NODE is None, reason="node is not installed")


def _run(js: str, scene: str) -> dict:
    code = (f"import * as THREE from {json.dumps(THREE.as_uri())};\n"
            "var ORBIT_WALL_GAP_M = 0.45, ORBIT_TALLEST_M = 340, ORBIT_BLOCK_REACH_M = 300, cameraPulledIn = false;\n"
            "var ORBIT_GROUND_CLEAR_M = 0.8, cameraOnGround = false, ORBIT_RISE_STEP = 0.06, ORBIT_RISE_MAX_PITCH = 1.52;\n"
            "const META = false, ORBIT_MAX_TILT = 1.8, renderer = { xr: { isPresenting: false } };\n"
            "const camera = new THREE.PerspectiveCamera(50, 1.6, 0.5, 5000);\n"
            "const constrainWorldCamera = () => {}, fitViewToAltitude = () => {}, guestUnder = () => null;\n"
            "function groundLiftAt() { return 0; }\n"
            + _extract("orbitBuildingTop", js) + _extract("buildingTopAt", js) + _extract("orbitBlockedAt", js)
            + _extract("placeCamera", js) + scene)
    out = subprocess.run([NODE, "--input-type=module", "-e", code], capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


def test_a_shop_behind_the_camera_lifts_the_view_over_it_rather_than_pulling_it_in() -> None:
    js = _page_js()
    out = _run(js, """
// The walker on the street at the origin; a two-storey shop 15 to 30 m east of it.
const shop = { height_m: 8 }, tower = { height_m: 300 };
let wall = shop, near = 15;
function buildingAt(x, z) { return x > near && x < near + 15 && z > -20 && z < 20 ? wall : null; }
const state = { yaw: Math.PI / 2, pitch: 0.35, dist: 60, tilt: 0, firstPerson: false, target: new THREE.Vector3(0, 1.6, 0) };
placeCamera();
const risen = { d: camera.position.distanceTo(state.target), y: camera.position.y, pulled: cameraPulledIn, pitch: state.pitch };
wall = tower;
placeCamera();
const tall = { d: camera.position.distanceTo(state.target), pulled: cameraPulledIn, y: camera.position.y };
near = 0.5;
placeCamera();
const against = { d: camera.position.distanceTo(state.target), pulled: cameraPulledIn };
console.log(JSON.stringify({ risen, tall, against }));
""")
    # Kept at its distance, up over the shop's roof, and its own pitch untouched.
    assert out["risen"]["d"] == pytest.approx(60, abs=1e-3) and not out["risen"]["pulled"]
    assert out["risen"]["y"] > 8.3 + 1.6
    assert out["risen"]["pitch"] == 0.35
    # A tower across the street: looked down on from nearly overhead, still at its distance --
    # not pulled in to a few metres off the walker under the shopfronts.
    assert out["tall"]["d"] == pytest.approx(60, abs=1e-3) and not out["tall"]["pulled"]
    assert out["tall"]["y"] > 55
    # Only a tower the walker stands against, which nothing clears, pulls the camera in.
    assert out["against"]["pulled"] and out["against"]["d"] < 12
