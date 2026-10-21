"""Explore: the walker put away, the view moved freely, the walker back where the view is."""

from __future__ import annotations

import json
import subprocess

import pytest

from tests.test_corridor_geometry_rules import NODE, _extract, _page_js

pytestmark = pytest.mark.skipif(NODE is None, reason="node is not installed")


def _run(script: str):
    out = subprocess.run([NODE, "-"], input=script, capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


PRELUDE = """
class V { constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;}
  set(x,y,z){this.x=x;this.y=y;this.z=z;return this;} copy(v){return this.set(v.x,v.y,v.z);}
  add(v){this.x+=v.x;this.y+=v.y;this.z+=v.z;return this;} sub(v){this.x-=v.x;this.y-=v.y;this.z-=v.z;return this;}
  negate(){return this.set(-this.x,-this.y,-this.z);} lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z;}
  normalize(){const l=Math.sqrt(this.lengthSq())||1;return this.set(this.x/l,this.y/l,this.z/l);}
  multiplyScalar(k){return this.set(this.x*k,this.y*k,this.z*k);} }
const THREE = { Vector3: V };
const META = false;
const state = { yaw: 0, dist: 100, target: new V(0, 0, 0), firstPerson: false };
const avatar = { position: new V(5, 1, 5), visible: true };
const gps = { follow: true }; var GPS_LEASH = { on: true };
const held = new Set();
const AVATAR_STAND_Y = 1, EXPLORE_SPEED_PER_M = 0.8, EXPLORE_SPEED_MIN = 8;
const document = { getElementById: () => ({ setAttribute() {} }) };
function walkerGroundAt() { return 0; }
function groundLiftAt() { return 0; }
function walkerExteriorAt(x, z) { return { x: x + 1, z }; }   // the nearest open ground
function placeCamera() {}
function setFirstPerson(on) { state.firstPerson = on; }
"""


def test_exploring_moves_the_view_and_the_walker_comes_back_where_it_is() -> None:
    js = _page_js()
    out = _run(PRELUDE + _extract("setExplore", js) + _extract("exploreStep", js) + """
const log = {};
setExplore(true);
log.hidden = !avatar.visible && !gps.follow && !GPS_LEASH.on;
held.add("ArrowUp");
exploreStep(0.5);                       // 100 m out: 80 m/s for half a second
log.moved = [state.target.x, state.target.z];
log.walkerStayed = [avatar.position.x, avatar.position.z];
setExplore(false);
log.back = [avatar.position.x, avatar.position.z, avatar.visible];
log.viewOnWalker = [state.target.x, state.target.z];
console.log(JSON.stringify(log));
""")
    assert out["hidden"]
    assert out["moved"] == pytest.approx([0, -40]), "forward, the way the view looks, at 0.8 m/s per metre out"
    assert out["walkerStayed"] == [5, 5]
    assert out["back"] == [1, -40, True], "stood on the open ground nearest the view"
    assert out["viewOnWalker"] == [1, -40]


def test_explore_is_wired_to_e_the_button_the_frame_and_clicks() -> None:
    js = _page_js()
    assert "if (state.explore) { exploreStep(dt); return; }" in _extract("stepAvatar", js)
    assert "if (state.explore && travel) {" in _extract("goToNow", js)
    assert "if (on && state.explore) setExplore(false);" in _extract("setFirstPerson", js)
    assert 'document.getElementById("explore").addEventListener("click", () => setExplore(!state.explore));' in js
    assert '(e.key !== "e" && e.key !== "E")' in js


def test_zooming_out_past_the_walker_explores_and_back_in_returns_unless_explore_was_chosen() -> None:
    js = _page_js()
    out = _run(PRELUDE + """
const ATTACH = null, innerHeight = 800, camera = { fov: 50 };
const AVATAR_HEIGHT = 2.1336, AVATAR_SCALE = 1;
""" + _extract("setExplore", js) + _extract("walkerPixelsAt", js) + _extract("autoExploreByZoom", js) + """
const AUTO_EXPLORE_OUT_PX = 5, AUTO_EXPLORE_IN_PX = 8;
const at = (d) => { state.dist = d; autoExploreByZoom(); return Boolean(state.explore); };
const log = {};
log.near = at(100);
log.edge = at(300);            // about 6 px: neither switch
log.far = at(500);             // about 3.7 px: explore
log.hidden = !avatar.visible;
log.between = at(300);         // still exploring inside the gap
log.back = at(150);            // about 12 px: the walker again
log.visible = avatar.visible;
setExplore(true);              // chosen with E
log.chosenNear = at(50);
log.chosenFar = at(5000);
log.chosenBack = at(50);
setExplore(false);             // left by hand
log.leftFar = at(5000);        // not taken straight back
at(50);
log.again = at(5000);          // once in and out again, it is
console.log(JSON.stringify(log));
""")
    assert out["near"] is False and out["edge"] is False
    assert out["far"] is True and out["hidden"] is True
    assert out["between"] is True
    assert out["back"] is False and out["visible"] is True
    assert out["chosenNear"] and out["chosenFar"] and out["chosenBack"], "chosen explore stays at any zoom"
    assert out["leftFar"] is False
    assert out["again"] is True


def test_the_zoom_drives_explore_on_a_computer_only() -> None:
    js = _page_js()
    assert 'if (typeof autoExploreByZoom === "function") autoExploreByZoom();' in _extract("zoomBy", js)
    assert "if (META || ATTACH || state.firstPerson) return;" in _extract("autoExploreByZoom", js)
