"""The Marina clean-up of 2026-11-22: trees off fence lines, a footway that is only a street's own
pavement not drawn twice, and the walker an everyday height."""

from __future__ import annotations

import json
import re
import subprocess

import pytest

from tests.test_corridor_geometry_rules import NODE, _extract, _page_js

pytestmark = pytest.mark.skipif(NODE is None, reason="node is not installed")


def _run(script: str):
    out = subprocess.run([NODE, "-"], input=script, capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


def _const(name: str, js: str) -> str:
    m = re.search(rf"const {name} = [^;]+;", js)
    assert m, name
    return m.group(0)


def test_a_tree_on_a_fence_line_is_moved_square_off_it_to_the_side_it_stands_on():
    js = _page_js()
    out = _run(
        "const FENCE_LINE_CELL_M = 6, fenceLineGrid = new Map();\n"
        + _const("TREE_FENCE_CLEAR_M", js) + "\n"
        + _extract("noteFenceLine", js) + _extract("nearestFenceLine", js) + _extract("treeOffFence", js)
        + """
noteFenceLine(0, 0, 30, 0);              // a park's fence along z = 0
noteFenceLine(30, 0, 30, 20);            // and round its corner
const r = {};
r.onIt = treeOffFence(10, 0.1);          // a hand's breadth on the park side
r.pavement = treeOffFence(12, -0.25);    // a quarter metre on the pavement side
r.clear = treeOffFence(15, 2);           // well clear: left where it is
r.corner = treeOffFence(29.8, 0.2);      // in the corner: off both lines
// No room on its own side (a building there): the other side.
r.walled = treeOffFence(20, 0.2, (x, z) => z < 0);
console.log(JSON.stringify({...r, clearance: TREE_FENCE_CLEAR_M,
  after: [r.onIt, r.pavement, r.corner, r.walled].map(([x, z]) => nearestFenceLine(x, z, TREE_FENCE_CLEAR_M))}));
""")
    clear = out["clearance"]
    assert out["onIt"][1] >= clear and abs(out["onIt"][0] - 10) < 1e-6, "square off the line, into the park"
    assert out["pavement"][1] <= -clear and abs(out["pavement"][0] - 12) < 1e-6, "onto the pavement it was on"
    assert out["clear"] is None
    assert out["walled"][1] <= -clear
    assert out["after"] == [None, None, None, None], "every moved tree clear of every fence"
    # The page moves its trees off the fences it has laid, and every ground fence is noted.
    assert "noteFenceLine(ax, az, bx, bz);" in _extract("groundedFencePanel", js)
    assert "const moved = treeOffFence(tx, -ty, treeRoom);" in js


def test_a_footway_mapped_along_a_street_on_its_own_pavement_is_not_drawn_over_it():
    js = _page_js()
    out = _run(
        "const midLon = 0, midLat = 0, metersPerLon = 1, metersPerLat = 1;\n"
        "function xy(lon, lat) { return [lon, lat]; }\n"
        "const DATA = { ways: [{ kind: 'street', road_m: 12, walk_m: 3.6, points: [[0, 0], [100, 0]] }] };\n"
        "const MIN_RENDER_WALK_M = 0.6, MAX_RENDER_WALK_M = 6;\n"
        + _extract("renderedWalkWidth", js) + _extract("streetSegmentGrid", js) + _extract("pathAlongKerbsideWalk", js)
        + """
const path = (z, x0 = 5, x1 = 95) => ({ kind: "path", points: [[x0, z], [x1, z]] });
console.log(JSON.stringify({
  // The street's kerb is 6 m out (z = -6 in the page's metres) and its walk 3.6 m beyond.
  onWalk: pathAlongKerbsideWalk(path(7.2)),          // its middle 1.2 m out from the kerb
  parkPath: pathAlongKerbsideWalk(path(12)),         // a path in the park beyond the walk
  across: pathAlongKerbsideWalk({ kind: "path", points: [[50, 7], [50, 30]] }),
}));
""")
    assert out == {"onWalk": True, "parkPath": False, "across": False}
    assert "if (isPath && !pathHasOwnMaterial(way) && pathAlongKerbsideWalk(way)) continue;" in js


def test_the_walker_is_an_everyday_height_not_seven_feet():
    js = _page_js()
    assert "const AVATAR_HEIGHT = 1.75;" in js
    assert "2.1336" not in _const("AVATAR_HEIGHT", js)


def test_a_surveyed_curb_with_pavement_on_both_sides_is_not_drawn_down_the_middle_of_a_walk():
    js = _page_js()
    out = _run(
        "function worldLocalToPage(anchor, e, n) { return [e, n]; }\n"
        "function insideCarriageway(x, z) { return z < 0; }\n"
        # The walk the page drew: from the kerb at z = 0 out to z = 6.
        "function pavementTopAt(x, z) { return z >= 0 && z <= 6 ? 0.2 : undefined; }\n"
        + _extract("worldInsideWalk", js)
        + """
console.log(JSON.stringify({
  kerb: worldInsideWalk(null, 5, 0.05, 0, -1),     // the street's kerb: roadway beyond it
  middle: worldInsideWalk(null, 5, 3.5, 0, 1),     // a planter's old edge across the walk
  backOfWalk: worldInsideWalk(null, 5, 5.9, 0, 1), // the walk's far edge: ground beyond it
}));
""")
    assert out == {"kerb": False, "middle": True, "backOfWalk": False}
    assert '&& !(record.type === "curb" && worldInsideWalk(' in _extract("worldSupportedPieces", js)


def test_a_bus_pad_is_weathered_concrete_not_a_white_strip():
    js = _page_js()
    colour = int(re.search(r"const BUS_PAD_COLOUR = (0x[0-9a-f]+);", js).group(1), 16)
    lum = lambda c: 0.2126 * (c >> 16 & 255) + 0.7152 * (c >> 8 & 255) + 0.0722 * (c & 255)  # noqa: E731
    assert lum(colour) < lum(0x8E918A), "no paler than the pavement beside it"
    assert 'emit(pad, BUS_PAD_COLOUR, "bus_zone:pad", 0.95);' in js


def test_a_house_set_back_behind_the_footway_is_paved_to_not_left_a_ledge_below_it():
    js = _page_js()
    out = _run(
        "const FRONTAGE_STEP_M = 1.0, FRONTAGE_PROBE_M = 0.1, FRONTAGE_MIN_M = 0.15, FRONTAGE_BELOW_M = 0.003, WALK_UV_M = 1;\n"
        + _const("FRONTAGE_SETBACK_M", js) + "\n"
        "const frontageSetbacks = [], frontageSetbackStats = { stations: 0, paved: 0, paved_m2: 0, lawn: 0, open: 0, bare: 0 };\n"
        # A street along z = 0 whose footway is drawn out to z = 3.2 (the survey reached 3.0), the
        # underlay behind it to z = 8; houses from z = 5 except along x 40..50 (an open lot).
        "const pavementSurfaceAt = (x, z) => (z >= 0 && z <= 3.2 ? 0.18 : null);\n"
        "const parkPavementAt = (x, z) => z > 0 && z < 8;\n"
        "const buildingAt = (x, z) => z >= 5 && !(x > 40 && x < 50);\n"
        "const insideCarriageway = (x, z) => z < 0, insideJunctionBox = () => false;\n"
        "const rings = []; function stampPavedRing(ring, top) { rings.push({ ring, top }); }\n"
        "const THREE = { BufferGeometry: class { setAttribute(k, v) { this[k] = v; } setIndex(i) { this.index = i; } computeVertexNormals() {} },\n"
        "  Float32BufferAttribute: class { constructor(a) { this.array = a; } }, Mesh: class { constructor(g, m) { this.geometry = g; this.material = m; this.userData = {}; } } };\n"
        "function surfaceMaterial(kind, color, opacity) { return { kind, color, opacity }; }\n"
        + _extract("addFrontageSetbacks", js)
        + """
const station = (x) => ({ point: (d) => [x, d], from: 3.0, top: 0.177, ux: 1, uz: 0, color: 0xffffff, opacity: 1 });
frontageSetbacks.push(station(5), station(25), station(45));
// A front lawn along x 20..30, seen (nothing drawn over it).
const meshes = addFrontageSetbacks((x, z) => x > 20 && x < 30 && z > 3.5);
const far = rings.length ? Math.max(...rings[0].ring.map(([, z]) => z)) : null;
const near = rings.length ? Math.min(...rings[0].ring.map(([, z]) => z)) : null;
console.log(JSON.stringify({ stats: frontageSetbackStats, rings: rings.length, far, near, top: rings[0]?.top,
  meshes: meshes.length, kind: meshes[0]?.material.kind }));
""")
    s = out["stats"]
    assert (s["paved"], s["lawn"], s["open"]) == (1, 1, 1), "paved to the house; not over a lawn; not into an open lot"
    assert abs(out["far"] - 5.0) <= 0.11, "up to the house front"
    assert 3.1 <= out["near"] <= 3.25, "from the footway's drawn edge, not the survey's"
    assert abs(out["top"] - 0.18) < 1e-6, "at the footway's own height"
    assert out["meshes"] == 1 and out["kind"] == "walk"
    # The ground pass lays them once it knows the lawns, and a lawn under the underlay is not one.
    assert 'for (const mesh of addFrontageSetbacks(lawnDrawnAt)) addGround(mesh, "walk");' in js
    assert "const lawnDrawnAt = (x, z) => !parkPavementAt(x, z) && (" in js
    # Every station the survey's reach stopped short is handed on.
    assert "if (to + FRONTAGE_PROBE_M > reach)" in _extract("addFrontageFillSteps", js)


def test_the_street_photographs_light_a_surface_on_the_side_that_is_seen():
    js = _page_js()
    patch = js[js.index("NEAR_SURFACE.patch ||= function"):]
    patch = patch[:patch.index("\n};") + 3]
    assert "#define KB_NS_N (normalize(kbNsN) * (gl_FrontFacing ? 1.0 : -1.0))" in patch
    # No fragment code reads the stored normal as it is; the define is the only door to it.
    assert js.count("normalize(kbNsN)") == 1
    assert "vec3 kbNsWN = KB_NS_N;" in patch
