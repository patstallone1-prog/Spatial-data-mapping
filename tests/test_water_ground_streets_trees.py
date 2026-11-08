"""Nothing of the land is drawn in the water: a park's green wholly over a lake is left out, a
street crossing a cell the raster calls water stands at the shore's height rather than dipping to
the water's, a city tree on the water is not planted; and the far tile sheets each sit a step
nearer the eye than the one under them, so they stop taking turns from a distance."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from tests.test_corridor_geometry_rules import NODE, _extract, _page_js

ROOT = Path(__file__).resolve().parents[1]
THREE = ROOT / "docs/vendor/three-0.160.0/three.module.min.js"
pytestmark = pytest.mark.skipif(NODE is None, reason="node is not installed")


def _run(code: str) -> dict:
    code = f"import * as THREE from {json.dumps(THREE.as_uri())};\n" + code
    out = subprocess.run([NODE, "--input-type=module", "-e", code], capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


def _const(name: str, js: str) -> str:
    start = js.index(f"const {name} =")
    return js[start:js.index(";\n", start) + 2]


def test_a_cover_wholly_over_the_water_loses_those_triangles_and_keeps_its_shore() -> None:
    js = _page_js()
    out = _run(_const("COVER_OFF_WATER", js) + _extract("coverOffWater", js) + _extract("dropTrianglesOverWater", js) + """
// The lake is everything east of x = 10.
const overWaterAt = (x, z) => x > 10;
const g = new THREE.BufferGeometry();
g.setAttribute("position", new THREE.Float32BufferAttribute([
  0, 0, 0,  5, 0, 0,  0, 0, 5,      // on land
  8, 0, 0,  14, 0, 0,  8, 0, 5,     // across the shore
  12, 0, 0, 18, 0, 0, 12, 0, 5,     // on the lake
], 3));
const dropped = dropTrianglesOverWater(g, new THREE.Matrix4());
const kinds = ["park", "yard", "court", "plaza", "front_walk", "park:play_surface", "inferred:lawn", "inferred:plaza", "road"]
  .map((surface) => [surface, coverOffWater({ userData: { surface } })]);
// A region with tunnel approaches lifts every cover by its trench function: still cut.
const bridged = coverOffWater({ userData: { surface: "park", groundLiftFunction: () => 0 } });
console.log(JSON.stringify({ dropped, index: Array.from(g.getIndex().array), kinds: Object.fromEntries(kinds), bridged }));
""")
    assert out["dropped"] == 1
    assert out["index"] == [0, 1, 2, 3, 4, 5]
    assert out["kinds"] == {"park": True, "yard": True, "court": True, "plaza": False, "front_walk": False,
                            "park:play_surface": True, "inferred:lawn": True, "inferred:plaza": False, "road": False}
    assert out["bridged"] is True
    lift = _extract("liftOneMeshSteps", js)
    assert "if (coverOffWater(o)) dropTrianglesOverWater(refined, o.matrixWorld);" in lift
    assert lift.index("refineForTerrainSteps") < lift.index("dropTrianglesOverWater")


def test_a_street_over_a_wet_cell_stands_at_the_shore_and_open_water_stays_water() -> None:
    js = _page_js()
    out = _run("""
// A 10 x 10 grid of 2 m cells: a lake in columns 5 and up, its shore (columns 0-4) at 5.00 m.
const OPEN_WATER_GROUND_M = 0.4, STREET_SHORE_REACH_CELLS = 3, STREET_OVER_WATER_SLACK_M = 4.5;
var STREETS_GRIDDED = true;
const TERRAIN_FRAME = { x0: 0, y0: 0, step_m: 2, cols: 10, rows: 10, base_m: 0, nodata: -32768 };
const data = new Int16Array(100), LANDWATER = new Uint8Array(100);
let INLAND_MASK = null;
for (let r = 0; r < 10; r += 1) for (let c = 0; c < 10; c += 1) {
  data[r * 10 + c] = c < 5 ? 500 : 40; if (c >= 5) LANDWATER[r * 10 + c] = 1;
}
const TERRAIN = { visualData: data };
const pageToTerrain = (x, z) => [x, z];
let street = true;
const insideCarriageway = () => street;
const inlandWaterAt = (x, z) => INLAND_MASK ? INLAND_MASK[Math.floor(z / 2) * 10 + Math.floor(x / 2)] : 0;
const rawTerrainHeightAt = (x, z) => data[Math.floor(z / 2) * 10 + Math.floor(x / 2)] / 100;
function mappedWaterAt(x, z) { return LANDWATER[Math.floor(z / 2) * 10 + Math.floor(x / 2)] === 1; }
""" + _extract("nearestDryHeightAt", js) + _extract("streetOverWaterAt", js) + _extract("terrainHeightAt", js) + """
const shoreCell = terrainHeightAt(11, 9), farCell = terrainHeightAt(17, 9), land = terrainHeightAt(3, 9);
street = false;
const offStreet = terrainHeightAt(11, 9);
// An inland lake: its bed let down under the level, the same rule.
street = true; LANDWATER.fill(0); INLAND_MASK = new Uint8Array(100);
for (let i = 0; i < 100; i += 1) if (i % 10 >= 5) { INLAND_MASK[i] = 1; data[i] = -60; }
const lakeShore = terrainHeightAt(11, 9);
console.log(JSON.stringify({ shoreCell, farCell, land, offStreet, lakeShore }));
""")
    assert out["shoreCell"] == pytest.approx(5.0), "one cell out on the wet raster: the shore's height"
    assert out["farCell"] == pytest.approx(0.4), "past the reach it is a bridge's water, not the shore"
    assert out["land"] == pytest.approx(5.0)
    assert out["offStreet"] == pytest.approx(0.4), "off the street the water is water"
    assert out["lakeShore"] == pytest.approx(5.0)
    # Not asked before the first street is in the grid (it is declared after the terrain).
    assert "var STREETS_GRIDDED = false;" in js
    assert "STREETS_GRIDDED = carriagewayGrid.size > 0;" in js


def test_no_city_tree_is_planted_on_the_water() -> None:
    js = _page_js()
    at = js.index("const trees = (ground.trees || []).filter((tree) => {")
    assert "if (overWaterAt(tx, -ty))" in js[at:at + 900]
    out = _run("let NATURE = { local: (lon, lat) => [lon, lat], sample: (e, n) => ({ water: e > 100 }) }, natureWorld = null;\n"
               "const midLon = 0, midLat = 0, metersPerLon = 1, metersPerLat = 1;\n"
               "const mappedWaterAt = (x, z) => (x < 0 ? null : x < 50), inlandWaterAt = (x, z) => (x > 60 && x < 70 ? 1 : 0);\n"
               + _extract("natureWaterAt", js) + _extract("overWaterAt", js) + """
console.log(JSON.stringify([overWaterAt(10, 0), overWaterAt(55, 0), overWaterAt(65, 0), overWaterAt(-200, 0), overWaterAt(-5, 0)]));
""")
    # The page's grid where it has one (the map's water, a lake's bed); the atlas past its edge.
    assert out == [True, False, True, False, False]
    out = _run("let NATURE = { local: (lon, lat) => [lon, lat], sample: (e) => ({ water: e < -100 }) }, natureWorld = null;\n"
               "const midLon = 0, midLat = 0, metersPerLon = 1, metersPerLat = 1;\n"
               "const mappedWaterAt = () => null, inlandWaterAt = () => 0;\n"
               + _extract("natureWaterAt", js) + _extract("overWaterAt", js) + """
console.log(JSON.stringify([overWaterAt(-200, 0), overWaterAt(-5, 0)]));
""")
    assert out == [True, False]


def test_the_tile_sheets_are_each_drawn_a_step_nearer_the_eye_than_the_one_below() -> None:
    js = _page_js()
    out = _run(_const("TILE_DEPTH_BIAS", js) + _extract("tileDepthBias", js) + """
const keys = [], shaders = [];
for (const rank of [1, 2, 3]) {
  const m = new THREE.MeshBasicMaterial();
  const before = m.customProgramCacheKey();
  tileDepthBias(m, rank);
  const shader = { vertexShader: "a\\n#include <project_vertex>\\nb", fragmentShader: "" };
  m.onBeforeCompile(shader, null);
  keys.push(m.customProgramCacheKey()); shaders.push(shader.vertexShader);
}
console.log(JSON.stringify({ keys, shaders }));
""")
    assert len(set(out["keys"])) == 3, "each rank its own program"
    assert "mvPosition.xyz *= 0.999950;" in out["shaders"][0]
    assert "mvPosition.xyz *= 0.999850;" in out["shaders"][2]
    tile = js[js.index("tile.materials = Object.values(materials);"):][:400]
    assert "[materials.lawns, 1], [materials.roads, 2], [materials.pavement, 3]" in tile


def test_a_far_park_round_a_lake_is_drawn_round_it_not_over_it() -> None:
    js = _page_js()
    out = _run("const HEADSET = true, TILE_LAWN_Y = 0.08, TILE_GROUND_Y = 0;\n"
               "const earthDrop = () => 0, tileGroundAt = () => 0;\n"
               "let NATURE = { local: (lon, lat) => [lon, lat] }, natureWorld = null;\n"
               "const midLon = 0, midLat = 0, metersPerLon = 1, metersPerLat = 1;\n"
               "const mappedWaterAt = () => null, inlandWaterAt = () => 0;\n"
               + _extract("natureWaterAt", js)
               + _const("TILE_LAWN_PROBE_M", js).replace("const ", "var ", 1)
               + _const("TILE_LAWN_ASK_M2", js)
               + _extract("tileLawnWetTest", js) + _extract("ringOverWater", js) + _extract("pointInVectorRing", js)
               + _extract("dryLawnPieces", js) + _extract("tileLawns", js) + """
// A 400 m square park with a 200 m lake in its middle (page z = -north).
const lake = (x, z) => x > 100 && x < 300 && -z > 100 && -z < 300;
// The atlas is asked in its own east and north.
natureWorld = { ground: (east, north) => ({ water: lake(east, -north) }) };
const f = { x0: 0, y0: 0, sx: 1, sy: 1 };
const material = {};
const area = (mesh) => {
  const p = mesh.geometry.getAttribute("position"), i = mesh.geometry.getIndex();
  let total = 0, wet = 0;
  for (let t = 0; t < i.count; t += 3) {
    const [a, b, c] = [0, 1, 2].map((k) => [p.getX(i.getX(t + k)), p.getZ(i.getX(t + k))]);
    const s = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
    total += s; if (lake((a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3)) wet += s;
  }
  return { total, wet };
};
const park = area(tileLawns([[0, 0, 400, 0, 400, 400, 0, 400, 0, 0]], f, material)[0]);
const yard = tileLawns([[0, 0, 30, 0, 30, 30, 0, 30, 0, 0]], f, material)[0].geometry.getIndex().count;
console.log(JSON.stringify({ park, yard }));
""")
    assert out["park"]["wet"] == 0
    # 160,000 m² of park less the 40,000 m² lake, to within the shore's 8 m pieces.
    assert 116000 < out["park"]["total"] < 124000
    assert out["yard"] == 6, "a small lawn is laid as it was, unasked"
