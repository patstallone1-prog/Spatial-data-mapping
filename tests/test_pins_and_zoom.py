"""Pins stay findable from any height; zoom is quick; directions are pinned at every stop."""
from __future__ import annotations

import json
import subprocess

import pytest

from tests.test_corridor_geometry_rules import NODE, ROOT, _extract, _page_js

pytestmark = pytest.mark.skipif(NODE is None, reason="node is needed to run the page's code")


def run_js(script: str):
    result = subprocess.run([NODE, "-"], input=script, text=True, capture_output=True, timeout=30)
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def test_a_pin_keeps_its_size_on_screen_as_the_view_pulls_back():
    js = _page_js()
    out = run_js("""
class V { constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;}
  set(x,y,z){this.x=x;this.y=y;this.z=z;return this;}
  copy(o){return this.set(o.x,o.y,o.z);}
  distanceTo(o){return Math.hypot(this.x-o.x,this.y-o.y,this.z-o.z);} }
const THREE = { Vector3: V };
const camera = { position: new V(0, 0, 0) };
const markerAt = new V();
function marker(x, near) {
  const object = { visible: true, s: 1, scale: { setScalar(v) { object.s = v; } },
                   getWorldPosition(out) { return out.set(x, 0, 0); } };
  return { object, near };
}
const findableMarkers = new Set();
""" + _extract("keepMarkersFindable", js) + """
const close = marker(30, 45), far = marker(900, 45), hidden = marker(900, 45);
hidden.object.visible = false;
[close, far, hidden].forEach((m) => findableMarkers.add(m));
keepMarkersFindable();
console.log(JSON.stringify([close.object.s, far.object.s, hidden.object.s]));
""")
    assert out == [1, 20, 1], "true size up close; twenty times at twenty times the distance; hidden left alone"


def test_zoom_is_quicker_and_pinch_zooms_too():
    js = _page_js()
    out = run_js("""
const state = { dist: 100, firstPerson: false, zoom: 1 };
const MAX_ORBIT_DIST_M = 5000, FIRST_PERSON_MAX_ZOOM = 2, FIRST_PERSON_FOV = 70;
const camera = { fov: 70, updateProjectionMatrix() {} };
const ZOOM_FULL_SPEED_M = 400, ZOOM_NEAR_SENSITIVITY = 0.2;
function placeCamera() {}
""" + _extract("zoomSensitivity", js) + _extract("zoomBy", js) + """
zoomBy(Math.exp(100 * 0.0025));
const near = state.dist;
state.dist = 1000; zoomBy(Math.exp(100 * 0.0025));
const out = state.dist;
state.dist = 10; zoomBy(Math.exp(100 * 0.0025));
const street = state.dist;
state.dist = 1000; zoomBy(1e9);
const capped = state.dist;
state.firstPerson = true; zoomBy(0.5);
console.log(JSON.stringify([out, capped, state.zoom, camera.fov, near, street]));
""")
    assert out[0] == pytest.approx(1284, abs=1), "far off, one wheel notch: about a quarter further out"
    assert out[4] == pytest.approx(113.3, abs=0.1), "at 100 m, half that"
    assert out[5] == pytest.approx(10.51, abs=0.01), "at the street, a fifth"
    assert out[1] == 5000 and out[2] == 2 and out[3] == 35
    assert "const WHEEL_ZOOM_PER_UNIT = 0.0025;" in js and "e.ctrlKey ? TRACKPAD_PINCH_PER_UNIT" in js
    assert "zoomBy((pinchSpread / spread) ** TOUCH_PINCH_POWER)" in js
    page = (ROOT / "scripts/build_sf_corridor_3d.py").read_text()
    assert "touch-action:none;" in page[page.index("#scene {"):][:200], "two fingers zoom the map, not the page"


def test_directions_put_blue_pins_at_the_start_every_stop_and_the_end():
    js = _page_js()
    assert "const ROUTE_PIN_BLUE = 0x2563eb;" in js
    assert "placeRoutePins(stops);" in js, "pinned as soon as directions are asked for"
    assert "clearRoutePins();" in js, "and taken up with Clear"
    assert "String.fromCharCode(65 + i)" in js, "lettered A (the start), B, C ... in order"
    assert "findableMarkers.add(marker);" in _extract("placePin", js), "the numbered pins grow too"
    assert "keepMarkersFindable();" in _extract("animate", js)
