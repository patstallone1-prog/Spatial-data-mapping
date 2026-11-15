"""The world holds the walker as it is drawn: the ground cover underfoot at the height it is drawn,
the footway's walked surfaces at the kerb's height, an entrance recess with its walls, and no
building walked into -- not even by the slide round a pole or along a parked car.

Run, not read: the renderer's own functions, in node, on small scenes (and on five real Marina
footprints for the walls).
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from tests.test_corridor_geometry_rules import _extract, _page_js

ROOT = Path(__file__).resolve().parents[1]
THREE = ROOT / "docs/vendor/three-0.160.0/three.module.min.js"
NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node is needed to run the renderer's own code")


def _consts(js: str, *prefixes: str) -> str:
    """Top-level const declarations by name prefix, each up to its closing semicolon."""
    out = []
    for prefix in prefixes:
        for m in re.finditer(rf"^const {prefix}\w* = [\s\S]*?;\n", js, re.M):
            out.append(m.group(0))
    assert out, prefixes
    return "".join(out)


def _node(code: str) -> dict:
    out = subprocess.run([NODE, "--input-type=module", "-"], input=code, capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr[-3000:]
    return json.loads(out.stdout.strip().splitlines()[-1])


# ---- 1. the ground cover as drawn ---------------------------------------------------------------

def _ground_scene(body: str) -> dict:
    js = _page_js()
    code = "\n".join([
        f"import * as THREE from {json.dumps(THREE.as_uri())};",
        "let terrain = () => 0;",
        "function groundLiftAt(x, z) { return terrain(x, z); }",
        "function outsideTerrainGrid() { return false; }",
        "function tunnelSurfaceAt() { return null; }",
        _consts(js, "WALK_COVER_"),
        "var walkCoverIndex = null;",
        *(_extract(n, js) for n in ["walkCoverSurface", "registerWalkCover", "clearWalkCover", "walkCoverCells",
                                    "walkCoverTopAt", "walkerGroundInfo"]),
        # A flat sheet of cover from (x0, z0) to (x1, z1), its vertices at height(x, z), cut n x n.
        """function sheet(surface, x0, z0, x1, z1, height, n = 4) {
  const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0, n, n);
  g.rotateX(-Math.PI / 2); g.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
  const p = g.getAttribute("position");
  for (let i = 0; i < p.count; i += 1) p.setY(i, height(p.getX(i), p.getZ(i)));
  const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
  mesh.userData.surface = surface;
  return mesh;
}
const group = new THREE.Group();
const at = (x, z) => +walkerGroundInfo(x, z).y.toFixed(4);""",
        body,
    ])
    return _node(code)


def test_the_walker_stands_on_raised_and_lowered_ground_cover_as_it_is_drawn() -> None:
    out = _ground_scene("""
// A terraced lawn 0.30 m over the street's ground, a plaza sunk 0.25 m under it, a park at its
// GROUND_STACK height, and a sheet 1.5 m up (a chord across a wall) that is not the ground.
group.add(sheet("yard", 0, 0, 10, 10, () => 0.30));
group.add(sheet("plaza", 20, 0, 30, 10, () => -0.25));
group.add(sheet("park", 40, 0, 50, 10, () => 0.022));
group.add(sheet("inferred:paving", 60, 0, 70, 10, () => 0.011));
group.add(sheet("walk_underlay", 80, 0, 90, 10, () => 0.5));   // not a cover: the streets' own
group.add(sheet("park", 100, 0, 110, 10, () => 1.5));
const before = [at(5, 5), at(25, 5), at(45, 5), at(65, 5), at(85, 5), at(105, 5), at(150, 5)];
registerWalkCover(group);
const after = [at(5, 5), at(25, 5), at(45, 5), at(65, 5), at(85, 5), at(105, 5), at(150, 5)];
console.log(JSON.stringify({ before, after, kind: walkerGroundInfo(5, 5).kind }));
""")
    # Before the cover was registered the walker stood on the bare ground under all of it.
    assert out["before"] == [0, 0, 0, 0, 0, 0, 0]
    raised, sunk, park, inferred, underlay, chord, bare = out["after"]
    assert raised == pytest.approx(0.30, abs=1e-3)
    assert sunk == pytest.approx(-0.25, abs=1e-3)
    assert park == pytest.approx(0.022, abs=1e-3) and inferred == pytest.approx(0.011, abs=1e-3)
    assert underlay == 0 and chord == 0 and bare == 0
    # Still plain ground: a cliff of it is not walked up (walkPace reads "terrain").
    assert out["kind"] == "terrain"


def test_the_walker_follows_the_drawn_chord_not_the_grid_under_it() -> None:
    """A front path cut to 12 m with no chord bridges a hump in the grid: the walker stood on the
    grid (up to the hump's height inside the paving); it now stands on the path as drawn."""
    out = _ground_scene("""
terrain = (x, z) => 0.4 * Math.max(0, 1 - Math.abs(x - 6) / 2);   // a 40 cm hump at x = 6
// Drawn corner to corner over 12 m, lifted only at its vertices (0 at both ends).
group.add(sheet("front_walk", 0, 0, 12, 2, (x, z) => terrain(x, z) + 0.025, 1));
registerWalkCover(group);
console.log(JSON.stringify({ hump: at(6, 1), drawnAtHump: 0.025, end: at(0.5, 1) }));
""")
    assert out["hump"] == pytest.approx(out["drawnAtHump"], abs=0.01)
    assert out["end"] == pytest.approx(0.025, abs=0.01)


def test_a_released_window_lets_its_cover_go() -> None:
    js = _page_js()
    assert "registerWalkCover(groups.ground);" in js
    release = js[js.index("function releaseHostWorld()"):]
    assert "clearWalkCover();" in release[:600]
    assert js.count("grassSampleAt=null;clearWalkCover();") == 2


# ---- 2. the footway's walked surfaces at the kerb's height ------------------------------------------

def _pavement_scene(body: str) -> dict:
    js = _page_js()
    code = "\n".join([
        "const midLon = 0, midLat = 0, metersPerLon = 1, metersPerLat = 1;",
        "function xy(lon, lat) { return [(lon - midLon) * metersPerLon, (lat - midLat) * metersPerLat]; }",
        "function groundLiftAt() { return 0; }",
        "function outsideTerrainGrid() { return false; }",
        "function tunnelSurfaceAt() { return null; }",
        "let road = () => false;",
        "function insideCarriageway(x, z) { return road(x, z); }",
        "const ROAD_TOP_M = 0.06, APRON_FLARE_M = 0.35;",
        "var STREET_STANDING = { roadTop: ROAD_TOP_M };",
        "const KERB_RULES = { drops: [] };",
        "const PROPERTY_LINE_PAVEMENT_Y = -0.05, PROPERTY_LINE_PAVEMENT_THICKNESS_M = 0.004, UNDERLAY_CELL_M = 16;",
        "const underlayGrid = new Map();",
        _consts(js, "PAVED_SEGMENT_"),
        "const pavedSegmentGrid = new Map(), walkerPavedGrid = new Map();",
        "let walkerDropGrid = null; const WALKER_DROP_CELL_M = 16;",
        *(_extract(n, js) for n in ["filePavedShape", "stampPavedRing", "stampWalkerPavedRing", "stampWalkerPaved",
                                    "walkerPavementAt", "pavementSurfaceAt", "onPavedSegment", "nearRing",
                                    "pointInRing", "parkPavementAt", "walkerUnderlayTop", "walkerKerbDrop",
                                    "walkerGroundInfo"]),
        "const at = (x, z) => +walkerGroundInfo(x, z).y.toFixed(4);",
        body,
    ])
    return _node(code)


def test_a_bulb_out_and_a_park_path_are_stood_on_at_their_tops_not_on_the_road() -> None:
    out = _pavement_scene("""
const kerbTop = ROAD_TOP_M + 0.126;
// The bulb-out lies over the carriageway (x 0..2, z 0..6); before its stamp the walker stood on
// the road there, 12.6 cm down inside the drawn kerb.
road = (x, z) => x >= 0 && x <= 2;
const before = at(1, 3);
stampWalkerPavedRing([[0, 0], [2, 0], [2, 6], [0, 6]], kerbTop - 0.003);
// A gravel path 2.4 m wide along z = 20, drawn at ROAD_TOP_M + .006 (.008 thick).
stampWalkerPaved([[-10, -20], [10, -20]], 2.4, ROAD_TOP_M + 0.006 + 0.004);
// And the frontage fill does not take either for footway: they are the walker's alone.
console.log(JSON.stringify({ before, bulb: at(1, 3), path: at(0, 20), offPath: at(5, 22),
  laid: pavementSurfaceAt(1, 3), kind: walkerGroundInfo(1, 3).kind }));
""")
    assert out["before"] == pytest.approx(0.06)
    assert out["bulb"] == pytest.approx(0.183, abs=1e-3) and out["kind"] == "pavement"
    assert out["path"] == pytest.approx(0.07, abs=1e-3)
    assert out["offPath"] == 0
    assert out["laid"] is None


def test_the_walker_goes_down_a_driveway_drop_as_the_pavement_is_drawn() -> None:
    out = _pavement_scene("""
const top = ROAD_TOP_M + 0.126;
// A footway along the kerb x = 0, out to x = 3 (the road is x < 0).
stampPavedRing([[0, -20], [3, -20], [3, 20], [0, 20]], top);
// A driveway at z = 0: the kerb's normal points out of the road (+x), 3 m deep, 1.75 m half width.
KERB_RULES.drops.push({ x: 0, z: 0, ox: 1, oz: 0, half: 1.75, depth: 3 });
const gutter = ROAD_TOP_M + 0.002;
console.log(JSON.stringify({ kerb: at(0.05, 0), half: at(1.5, 0), back: at(2.99, 0), flare: at(0.05, 1.75 + 0.175),
  past: at(0.05, 5), gutter, top }));
""")
    assert out["kerb"] == pytest.approx(out["gutter"] + (out["top"] - out["gutter"]) * 0.05 / 3, abs=1e-3)
    assert out["half"] == pytest.approx((out["gutter"] + out["top"]) / 2, abs=1e-3)
    assert out["back"] == pytest.approx(out["top"], abs=2e-3)
    # Half way across the flare, half the drop; beyond it the footway's own top.
    assert out["gutter"] < out["flare"] < out["top"]
    assert out["past"] == pytest.approx(out["top"], abs=1e-4)


def test_the_property_line_underlay_is_stood_on_where_it_alone_is_laid() -> None:
    out = _pavement_scene("""
const quad = [[0, 0], [4, 0], [4, 8], [0, 8]];
underlayGrid.set("0:0", [quad]);
console.log(JSON.stringify({ on: at(2, 4), off: at(20, 4) }));
""")
    assert out["on"] == pytest.approx(-0.048, abs=1e-4)
    assert out["off"] == 0


def test_the_walked_surfaces_are_filed_where_they_are_laid() -> None:
    js = _page_js()
    bulbs = _extract("addBulbOuts", js)
    assert "stampWalkerPavedRing([P, Q, R, S], top);" in bulbs
    path = _extract("renderPedestrianPath", js)
    assert "if(mesh)stampWalkerPaved(run.points,width,ROAD_TOP_M+.006+.004);" in path
    # Every kerbside footway is laid at the kerb's height over the road: measured-else-inferred is
    # the one rule (renderedKerbHeight), and a measurement of 0 is no measurement.
    assert "return Math.min((way && way.kerb_m) || KERB_FALLBACK, KERB_RENDER_MAX_M);" in js
    assert "const KERB_FALLBACK = DATA.kerb_height_m || 0.126;" in js
    assert "roadTop + KERB / 2 - KERBSIDE_BELOW_MAPPED_M, KERB, way);" in js


# ---- 3a. an entrance recess has its walls -----------------------------------------------------------

def test_an_indented_entrance_has_its_two_return_walls_back_and_soffit() -> None:
    js = _page_js()
    code = "\n".join([
        f"import * as THREE from {json.dumps(THREE.as_uri())};",
        "const DOOR_HEIGHT_M = 2.1;",
        _consts(js, "RECESS_WALL_T_M"),
        "const recessWallMaterial = new THREE.MeshBasicMaterial();",
        _extract("recessRevealWalls", js),
        """
const door = { width: 0.9 };
const plan = { width: 1.3, depth: 1.6, street: 10, floor: 10.5 };
const walls = recessRevealWalls(door, plan);
const parts = walls.children.map((m) => { m.geometry.computeBoundingBox(); const b = m.geometry.boundingBox.clone().translate(m.position);
  return { part: m.userData.part, x0: b.min.x, x1: b.max.x, y0: b.min.y, y1: b.max.y, z0: b.min.z, z1: b.max.z }; });
console.log(JSON.stringify(parts));
""",
    ])
    parts = _node(code)
    returns = [p for p in parts if p["part"] == "return"]
    assert len(returns) == 2
    for p, side in zip(sorted(returns, key=lambda p: p["x0"]), (-1, 1), strict=True):
        # Outside the recess, its inner face on the recess's side; the whole depth; street to head.
        inner = p["x1"] if side < 0 else p["x0"]
        assert inner == pytest.approx(side * 0.65, abs=1e-6)
        assert p["z0"] == pytest.approx(0, abs=1e-6) and p["z1"] >= 1.6
        assert p["y0"] <= 10 and p["y1"] == pytest.approx(10.5 + 2.1, abs=1e-6)
    assert len([p for p in parts if p["part"] == "back"]) == 2
    soffit = [p for p in parts if p["part"] == "soffit"]
    assert len(soffit) == 1 and soffit[0]["y0"] == pytest.approx(12.6, abs=1e-6)


def test_the_recess_walls_are_drawn_with_the_stoop_and_stand_down_for_a_home_shell() -> None:
    js = _page_js()
    stoop = _extract("addStoop", js)
    assert "door.recessWalls = recessRevealWalls(door, plan);" in stoop
    assert stoop.index("group.add(door.recessWalls);") < stoop.index("group.traverse(")
    doors = _extract("updateDoors", js)
    assert "if (door.recessWalls) door.recessWalls.visible = !door.entry.homeShell;" in doors
    assert "door.recessWalls = null;" in _extract("hideDoor", js)


# ---- 3b. no building walked into -----------------------------------------------------------------

def _marina_footprints(count: int = 5) -> list[list[list[float]]]:
    data = json.loads((ROOT / "docs/sf-corridor-3d.json").read_text(encoding="utf-8"))
    south, west, north, east = 37.7983, -122.4478, 37.8082, -122.4310
    out = []
    for way in data["ways"]:
        if way.get("kind") != "building" or len(way.get("points") or []) < 5:
            continue
        pts = way["points"]
        if not all(south < p[1] < north and west < p[0] < east for p in pts):
            continue
        if "Chestnut" not in str((way.get("address") or {}).get("street") or way.get("address") or ""):
            continue
        out.append(pts)
        if len(out) == count:
            break
    assert len(out) == count
    return out


def _walk_scene(footprints: list, guest: bool, body: str) -> dict:
    js = _page_js()
    code = "\n".join([
        f"const FOOTPRINTS = {json.dumps(footprints)};",
        "const lon0 = FOOTPRINTS[0][0][0], lat0 = FOOTPRINTS[0][0][1];",
        "const mPerLat = 111320, mPerLon = 111320 * Math.cos(lat0 * Math.PI / 180);",
        "const toLocal = ([lon, lat]) => [(lon - lon0) * mPerLon, -(lat - lat0) * mPerLat];",
        _consts(js, "WALKER_RADIUS_M", "WALK_SUBSTEP_M", "KNOCK_ROUND_"),
        "const FOOTPRINT_CELL = 60, footprintGrid = new Map();",
        """for (const pts of FOOTPRINTS) {
  const local = pts.map(toLocal), xs = local.map((p) => p[0]), zs = local.map((p) => p[1]);
  const entry = { way: { points: pts }, local, minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
  for (let ix = Math.floor(entry.minX / 60); ix <= Math.floor(entry.maxX / 60); ix += 1)
    for (let iz = Math.floor(entry.minZ / 60); iz <= Math.floor(entry.maxZ / 60); iz += 1) {
      const key = `${ix}:${iz}`; if (!footprintGrid.has(key)) footprintGrid.set(key, []); footprintGrid.get(key).push(entry);
    }
}
const entries = [...new Set([...footprintGrid.values()].flat())];""",
        *(_extract(n, js) for n in ["insideFootprint", "distanceToSegmentSquared", "pushOutOfWalls",
                                    "walkerFootprintBlocked", "firstBuildingCollision", "knockRoundObject",
                                    "slidePastObjects", "walkerStepIntoBuilding", "moveWalker"]),
        """function wallSegmentsNear(x, z) {
  const out = [];
  for (const e of entries) for (let i = 1; i < e.local.length; i += 1) out.push([...e.local[i - 1], ...e.local[i]]);
  return out;
}
const avatar = { position: { x: 0, y: 0, z: 0 } };
function walkerFeetY() { return 0; }
let poles = [];
var objectProximity = {
  update() {}, speedAt() { return 1; },
  blocked(x, z, r) {
    for (const [px, pz, h] of poles) if (Math.max(Math.abs(x - px), Math.abs(z - pz)) < h + r)
      return { pts: [px - h, pz - h, px + h, pz - h, px + h, pz + h, px - h, pz + h] };
    return null;
  },
};
var livingCity = null;""",
        ("""const GUEST = { ready: true, ox: 0, oz: 0, oy: 0, sx: 1,
  api: { firstBuildingCollision, walkerFootprintBlocked, wallSegmentsNear } };
const activeGuest = GUEST;
const guestUnder = () => GUEST;
const hostToGuest = (g, x, z) => [x, z];""" if guest else
         "const activeGuest = null;\nconst guestUnder = () => null;\nconst hostToGuest = (g, x, z) => [x, z];"),
        """// The worst a walk did: the deepest it went inside a footprint, or how near a wall it came.
function probe(start, heading, seconds = 5, speed = 1.4) {
  avatar.position.x = start[0]; avatar.position.z = start[1];
  let inside = false, nearest = Infinity;
  for (let t = 0; t < seconds; t += 1 / 60) {
    moveWalker(Math.cos(heading) * speed / 60, Math.sin(heading) * speed / 60);
    const { x, z } = avatar.position;
    for (const e of entries) {
      if (insideFootprint(e, x, z)) inside = true;
      for (let i = 1; i < e.local.length; i += 1)
        nearest = Math.min(nearest, Math.sqrt(distanceToSegmentSquared(x, z, ...e.local[i - 1], ...e.local[i])));
    }
  }
  return { inside, nearest: +nearest.toFixed(3) };
}
// Out from the middle of a footprint's longest open edge (not a party wall: 3 m out is in no
// footprint), into the street, facing the wall.
function approach(e, angle = 0) {
  let best = null;
  for (let i = 1; i < e.local.length; i += 1) {
    const [ax, az] = e.local[i - 1], [bx, bz] = e.local[i], L = Math.hypot(bx - ax, bz - az);
    if (L < 1e-6) continue;
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    let nx = -(bz - az) / L, nz = (bx - ax) / L;
    if (insideFootprint(e, mx + nx * 0.5, mz + nz * 0.5)) { nx = -nx; nz = -nz; }   // outward
    if (entries.some((f) => insideFootprint(f, mx + nx * 3, mz + nz * 3) || insideFootprint(f, mx + nx * 0.5, mz + nz * 0.5))) continue;
    if (!best || L > best.L) best = { ax, az, bx, bz, L, mx, mz, nx, nz };
  }
  const { mx, mz, nx, nz } = best;
  const start = [mx + nx * 3, mz + nz * 3], heading = Math.atan2(-nz, -nx) + angle;
  return { start, heading, mx, mz, nx, nz, ux: (best.bx - best.ax) / best.L, uz: (best.bz - best.az) / best.L };
}""",
        body,
    ])
    return _node(code)


@pytest.mark.parametrize("guest", [False, True], ids=["host", "attached-region"])
def test_five_walks_into_marina_walls_all_stop_outside(guest: bool) -> None:
    out = _walk_scene(_marina_footprints(), guest, """
const results = entries.map((e, k) => { const a = approach(e, [0, 0.5, -0.6, 0.9, -0.9][k]); return probe(a.start, a.heading); });
console.log(JSON.stringify(results));
""")
    assert len(out) == 5
    for r in out:
        assert not r["inside"]
        # Up against the wall (a body's radius off it), not short of it nor in it.
        assert 0.29 <= r["nearest"] <= 0.35


@pytest.mark.parametrize("guest", [False, True], ids=["host", "attached-region"])
def test_the_slide_round_a_pole_by_a_facade_does_not_go_through_the_wall(guest: bool) -> None:
    """A pole 0.45 m off the facade, walked into along the wall leaning in: knocked round it the
    walker was put into the wall, unchecked in an attached region (City mode's Marina)."""
    out = _walk_scene(_marina_footprints(), guest, """
const results = entries.map((e) => {
  const a = approach(e);
  // The pole beside the wall, the walk along the wall toward it from 3 m off, leaning in.
  poles = [[a.mx + a.nx * 0.45, a.mz + a.nz * 0.45, 0.1]];
  const start = [a.mx + a.nx * 0.42 - a.ux * 3, a.mz + a.nz * 0.42 - a.uz * 3];
  return probe(start, Math.atan2(a.uz - a.nz * 0.12, a.ux - a.nx * 0.12), 4);
});
console.log(JSON.stringify(results));
""")
    for r in out:
        assert not r["inside"]
        assert r["nearest"] >= 0.29


def test_the_slide_along_a_car_does_not_go_through_the_wall() -> None:
    out = _walk_scene(_marina_footprints(1), False, """
const a = approach(entries[0]);
// A car whose slide (as the city answers it) pushes the walker straight at the wall.
livingCity = { walkerBlocked: () => true,
  walkerSlide: (x, z, tx, tz) => [tx - a.nx * 0.2, tz - a.nz * 0.2] };
const r = probe([a.mx + a.nx * 0.6, a.mz + a.nz * 0.6], Math.atan2(a.uz, a.ux), 3);
console.log(JSON.stringify(r));
""")
    assert not out["inside"]
    assert out["nearest"] >= 0.29
