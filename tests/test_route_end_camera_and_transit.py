"""Ending a route, a ribbon that stays seen from far out, transit routes that land in the city,
a view that never looks out from inside a house, pins that bring you in close, and poles out of
the way of a garage."""

from __future__ import annotations

import json
import runpy
import subprocess
from pathlib import Path

import pytest

from tests.test_corridor_geometry_rules import NODE, _extract, _page_js

ROOT = Path(__file__).resolve().parents[1]
pytestmark = pytest.mark.skipif(NODE is None, reason="node is not installed")


def _node(script: str):
    out = subprocess.run([NODE, "-"], input=script, capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


def test_a_seven_place_polyline_decodes_to_san_francisco() -> None:
    # Transitous's shapes are at seven places; -122 there is past 2^31 as a zigzag value.
    js = _page_js()
    out = _node(_extract("decodePolyline6", js) + _extract("encodePolyline6", js) + """
const seven = "wrieoUnns}}gAgEn}@";
console.log(JSON.stringify({ seven: decodePolyline6(seven, 7),
  round: decodePolyline6(encodePolyline6([[-122.41902, 37.75911], [-122.4, 37.79]])) }));
""")
    assert out["seven"][0] == pytest.approx([-122.41902, 37.75911])
    assert out["round"] == [[-122.41902, 37.75911], [-122.4, 37.79]]


def test_a_route_ends_from_a_button_by_the_map_controls_or_escape() -> None:
    js = _page_js()
    page = (ROOT / "scripts/build_sf_corridor_3d.py").read_text()
    assert 'id="route-end" hidden title="End the route (Esc)"' in page
    assert 'document.getElementById("route-end").addEventListener("click", endRoute);' in js
    assert 'if (e.key !== "Escape" || !route.results.length) return;' in js
    assert 'document.getElementById("route-end").hidden = !route.results.length;' in js


def test_the_ribbon_widens_to_stay_seen_from_the_farthest_view() -> None:
    js = _page_js()
    out = _node("const state = { firstPerson: false, dist: 0 };\nconst ROUTE_RIBBON_M = { chosen: 2.6 };\n"
                "const ROUTE_RIBBON_PER_M = 0.007;\nconst ROUTE_RIBBON_MAX_SCALE = 60;\n" + _extract("routeScale", js) + """
const at = (d) => { state.dist = d; return routeScale() * ROUTE_RIBBON_M.chosen; };
console.log(JSON.stringify({ near: at(100), mid: at(2000), far: at(20000) }));
""")
    assert out["near"] == pytest.approx(2.6), "its ground width up close"
    assert out["mid"] == pytest.approx(14)
    # From 20 km a 140 m ribbon is a few pixels: the old cap stopped it at 31 m, a pixel or two.
    assert out["far"] == pytest.approx(140)
    assert "const ROUTE_RIBBON_MAX_SCALE = 60;" in js


def test_a_building_stops_the_view_at_its_wall_rather_than_letting_it_inside() -> None:
    js = _page_js()
    out = _node("var ORBIT_WALL_GAP_M = 0.45, ORBIT_TALLEST_M = 340;\n" + _extract("orbitBuildingTop", js)
                + _extract("buildingTopAt", js) + _extract("orbitBlockedAt", js) + """
const house = { height_m: 9 }, shed = { height_m: 3 };
// A house from x 10 to 20 (z -5 to 5); a shed from z 2 to 6 alongside the line x 0..8.
function buildingAt(x, z) {
  if (x > 10 && x < 20 && z > -5 && z < 5) return house;
  if (x > 0 && x < 8 && z > 2 && z < 6) return shed;
  return null;
}
function groundLiftAt() { return 0; }
const guestUnder = () => null;
const v = (x, y, z) => ({ x, y, z });
console.log(JSON.stringify({
  wall: orbitBlockedAt(v(0, 1, 0), v(30, 4, 0)),
  overRoof: orbitBlockedAt(v(0, 1, 0), v(30, 30, 0)),
  walkerIndoors: orbitBlockedAt(v(12, 1, 0), v(30, 4, 0)),
  clear: orbitBlockedAt(v(0, 1, -20), v(30, 4, -20)),
  besideShed: orbitBlockedAt(v(0, 1, 1.75), v(6, 1, 1.75)),
}));
""")
    # Stopped short of the house wall at x = 10 (less the gap), not behind it inside the house.
    t = out["wall"]
    assert t is not None and 9.0 < t < 10.0 * (30.15 / 30) - 0.4, out
    assert out["overRoof"] is None and out["walkerIndoors"] is None and out["clear"] is None
    # Along the shed's wall 0.25 m off it, the camera keeps a hand's width clear of it to the side.
    assert out["besideShed"] is not None and out["besideShed"] <= 0.3 + 1e-9, out
    place = _extract("placeCamera", js)
    assert "orbitBlockedAt(state.target, camera.position)" in place and "state.dist <= ORBIT_BLOCK_REACH_M" in place
    assert "state.firstPerson || cameraPulledIn ? 0.12" in _extract("fitViewToAltitude", js)
    # A region drawn over the page answers for its own buildings.
    assert "buildingTopAt,\n  eligibleLanding," in js


def test_a_pin_brings_you_in_as_close_as_a_right_click() -> None:
    js = _page_js()
    pins = js[js.index("// ---- pins: 1, 2 and 3"):js.index("// ---- the compass")]
    assert "goTo(landing, { travel: true, zoom: true });" in pins
    assert "if (state.firstPerson) setFirstPerson(false);" in pins


def test_a_pole_in_a_driveway_stands_beside_it() -> None:
    js = _page_js()
    out = _node("const DRIVEWAY_SIDE_CLEAR_M = 0.4;\n" + _extract("pointInRing", js) + _extract("inDriveway", js)
                + _extract("clearOfDriveway", js) + """
// A cut at the origin, the garage 6 m due north (bearing 0), 3 m wide.
const zone = { kx: 0, ky: 0, dx: 0, dy: 1, half: 2,
  ring: [[-2, 1], [2, 1], [2, -6], [-2, -6]], minX: -2, maxX: 2, minZ: -6, maxZ: 1 };
const DRIVEWAY_ZONES = [zone];
function buildingAt() { return null; }
function insideCarriageway() { return false; }
console.log(JSON.stringify({ moved: clearOfDriveway(0.5, -3), outside: clearOfDriveway(5, -3) }));
""")
    assert out["moved"]["x"] == pytest.approx(2.4) and out["moved"]["z"] == pytest.approx(-3)
    assert out["outside"] is None
    assert "const clear = clearOfDriveway(row.anchor.x, row.anchor.z);" in _extract("addElectricalNetwork", js)


def test_one_pole_seen_several_times_stands_where_they_agree() -> None:
    ingest = runpy.run_path(str(ROOT / "scripts/ingest_streetlights.py"))
    detected = [{"id": "m:1", "p": [-122.42, 37.76]}, {"id": "m:2", "p": [-122.42004, 37.76002]}]
    _, kept = ingest["one_per_pole"]([], [dict(p) for p in detected])
    assert len(kept) == 1 and kept[0]["position_basis"] == "mean_of_merged_detections"
    assert kept[0]["p"] == pytest.approx([-122.42002, 37.76001])
    # A mapped pole stays where a person put it.
    osm, _ = ingest["one_per_pole"]([{"id": "osm:utility_pole:node:1", "p": [-122.42, 37.76]}],
                                    [{"id": "m:2", "p": [-122.42004, 37.76002]}])
    assert osm[0]["p"] == [-122.42, 37.76]
