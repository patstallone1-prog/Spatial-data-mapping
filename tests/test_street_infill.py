"""The ground between the kerb and the frontage: what the walker stands on, and what is inferred.

Run, not read, where the rule is geometry (see test_corridor_geometry_rules): the pavement index
the walker stands on, and the frontage fill that carries a footway through where nothing was
laid. Read where the rule is wiring.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "scripts" / "build_sf_corridor_3d.py"
NODE = shutil.which("node")
needs_node = pytest.mark.skipif(NODE is None, reason="node is needed to run the renderer's own code")


def _page_js() -> str:
    text = SOURCE.read_text(encoding="utf-8")
    start = text.index('<script type="module">')
    return text[start:text.index("</script>", start)]


def _extract(name: str, js: str) -> str:
    head = f"function {name}("
    i = js.index(head)
    depth, body = 0, -1
    for k in range(i + len(head) - 1, len(js)):
        if js[k] == "(":
            depth += 1
        elif js[k] == ")":
            depth -= 1
            if depth == 0:
                body = js.index("{", k)
                break
    depth = 0
    for k in range(body, len(js)):
        if js[k] == "{":
            depth += 1
        elif js[k] == "}":
            depth -= 1
            if depth == 0:
                return js[i:k + 1]
    raise AssertionError(f"{name} is not closed")


def _index_block(js: str) -> str:
    """The pavement index's constants and state, as the page declares them."""
    start = js.index("const PAVED_SEGMENT_CELL_M")
    end = js.index("const pavedSegmentGrid = new Map();", start) + len("const pavedSegmentGrid = new Map();")
    return js[start:end]


def _run(body: str) -> dict:
    js = _page_js()
    script = "\n".join([
        _index_block(js),
        "const WALK_UV_M = 6;",
        _extract("filePavedShape", js), _extract("stampPavedRing", js), _extract("pavementSurfaceAt", js),
        _extract("onPavedSegment", js), _extract("nearRing", js),
        body,
    ])
    out = subprocess.run([NODE, "--input-type=module", "-e", script], capture_output=True, text=True, timeout=30)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


@needs_node
def test_the_pavement_index_ends_where_the_ribbon_does() -> None:
    # A ribbon segment from x 0 to 10, 3 m wide: drawn square-ended, so the ground past its end
    # is not pavement -- measured as a capsule it was, for half the width beyond.
    got = _run("""
filePavedShape(-2, -2, 12, 2, { ax: 0, az: 0, bx: 10, bz: 0, half: 1.5, top: 0.18 });
stampPavedRing([[20, -1], [24, -1], [24, 1], [20, 1]], 0.2);
console.log(JSON.stringify({ mid: pavementSurfaceAt(5, 1.2), seam: pavementSurfaceAt(10.03, 0),
  past: pavementSurfaceAt(11, 0), beside: pavementSurfaceAt(5, 1.6), ring: pavementSurfaceAt(22, 0),
  off: pavementSurfaceAt(25, 0) }));
""")
    assert got["mid"] == pytest.approx(0.18)
    assert got["seam"] == pytest.approx(0.18)       # a hair past, so two segments meet
    assert got["past"] is None
    assert got["beside"] is None
    assert got["ring"] == pytest.approx(0.2)
    assert got["off"] is None


def _run_fill(body: str) -> dict:
    js = _page_js()
    script = "\n".join([
        _index_block(js),
        "const WALK_UV_M = 6;",
        _extract("filePavedShape", js), _extract("stampPavedRing", js), _extract("pavementSurfaceAt", js),
        _extract("onPavedSegment", js), _extract("nearRing", js), _extract("addFrontageFill", js),
        # A street along x, its lon/lat in metres; the page's z is minus north.
        "const xy = (lon, lat) => [lon, lat];",
        "function densifyWay(points, step) { const out = []; const [a, b] = points;"
        " const n = Math.round(Math.hypot(b[0]-a[0], b[1]-a[1]) / step);"
        " for (let i = 0; i <= n; i += 1) out.push([a[0] + (b[0]-a[0]) * i / n, a[1] + (b[1]-a[1]) * i / n]); return out; }",
        "const insideCarriageway = (x, z) => Math.abs(z) < 5;",
        "const insideJunctionBox = () => false;",
        "let facadeAt = 8.5; const buildingAt = (x, z) => -z > facadeAt;",
        "const laid = [];",
        "const surfaceMaterial = () => ({});",
        "const addMerged = (key, mesh) => laid.push(mesh);",
        "const THREE = { BufferGeometry: class { setAttribute(k, v) { this[k] = v; } setIndex(i) { this.index = i; } computeVertexNormals() {} },"
        " Float32BufferAttribute: class { constructor(a) { this.array = a; } },"
        " Mesh: class { constructor(g, m) { this.geometry = g; this.material = m; this.userData = {}; } } };",
        body,
    ])
    out = subprocess.run([NODE, "--input-type=module", "-e", script], capture_output=True, text=True, timeout=30)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


@needs_node
def test_a_missing_stretch_of_footway_is_carried_through_from_the_kerb() -> None:
    # Pavement from the kerb (5 m out, on the side away from +z) to 8 m along x 0-15 and 25-40,
    # nothing in between, and the frontage at 8.5 m.
    got = _run_fill("""
const strip = (x0, x1) => filePavedShape(x0, -9, x1, -4, { ax: x0, az: -6.5, bx: x1, bz: -6.5, half: 1.5, top: 0.18 });
strip(0, 15); strip(25, 40);
const before = pavementSurfaceAt(20, -6);
frontageSides.push({ way: { osm_id: 1, walk_m: 3 }, renderPoints: [[0, 0], [40, 0]], side: 1, inner: 5, walk: 3.5,
  roadTop: 0.06, color: 0, opacity: 1 });
addFrontageFill();
const ys = laid.flatMap((m) => Array.from(m.geometry.position.array).filter((_, i) => i % 3 === 1));
console.log(JSON.stringify({ before, bridged: pavementSurfaceAt(20, -6), kerbside: pavementSurfaceAt(20, -5.05),
  toFacade: pavementSurfaceAt(5, -8.4), road: pavementSurfaceAt(20, -4.5), stats: frontageStats,
  lowest: Math.min(...ys), highest: Math.max(...ys), basis: laid[0].userData.basis }));
""")
    assert got["before"] is None
    assert got["bridged"] == pytest.approx(0.18)
    assert got["kerbside"] == pytest.approx(0.18)     # from the kerb, not from a pavement edge
    assert got["toFacade"] == pytest.approx(0.18)     # the strip between the pavement and the house
    assert got["road"] is None
    assert got["stats"]["bridged_m"] == pytest.approx(9)
    assert got["lowest"] == pytest.approx(0.06)       # its kerb face goes down to the road
    assert got["highest"] == pytest.approx(0.18 - 0.003)
    assert got["basis"] == "inferred"


@needs_node
def test_a_long_gap_or_one_open_at_an_end_is_not_invented() -> None:
    got = _run_fill("""
const strip = (x0, x1) => filePavedShape(x0, -9, x1, -4, { ax: x0, az: -6.5, bx: x1, bz: -6.5, half: 1.5, top: 0.18 });
strip(0, 5); strip(45, 80);
frontageSides.push({ way: { osm_id: 1, walk_m: 3 }, renderPoints: [[0, 0], [100, 0]], side: 1, inner: 5, walk: 3.5,
  roadTop: 0.06, color: 0, opacity: 1 });
addFrontageFill();
console.log(JSON.stringify({ gap: pavementSurfaceAt(25, -6), end: pavementSurfaceAt(90, -6), stats: frontageStats }));
""")
    assert got["gap"] is None          # forty metres with nothing laid: not a piece missing
    assert got["end"] is None          # nothing beyond it to carry through to
    assert got["stats"]["bridged_m"] == 0


def test_the_walker_stands_on_the_pavement_and_the_road_as_laid() -> None:
    js = _page_js()
    walker = _extract("walkerGroundInfo", js)
    assert "const paved = pavementSurfaceAt(x, z);" in walker
    assert 'return { y: lifted + paved, kind: "pavement" };' in walker
    assert 'return { y: lifted + STREET_STANDING.roadTop, kind: "road" };' in walker
    # Declared with var, so a walker asked before the streets are built gets the ground.
    assert "var STREET_STANDING = { roadTop: ROAD_TOP_M };" in js
    # Street-derived pavement half a centimetre under a mapped footway, not a step's worth.
    assert "const KERBSIDE_BELOW_MAPPED_M = HEADSET ? 0.015 : 0.005;" in js


def test_every_street_side_goes_to_the_frontage_fill() -> None:
    js = _page_js()
    assert "for (const side of [1, -1]) frontageSides.push({ way, renderPoints, side, inner, walk, roadTop, color, opacity });" in js
    assert "const frontageFilled = addFrontageFill();" in js
    assert "const FRONTAGE_BRIDGE_M = 30;" in js


def test_a_tree_in_the_roadway_stands_on_an_island_and_one_in_a_junction_is_left_out() -> None:
    js = _page_js()
    start = js.index("const islandTrees = [];")
    block = js[start:js.index("addTreeIslands(islandTrees);", start)]
    assert "if (!insideCarriageway(tx, -ty, TREE_ISLAND_DEPTH_M)) return true;" in block
    junction = block.index("treeIslandStats.junction += 1;")
    assert "return false;" in block[junction:junction + 60]
    assert "islandTrees.push({ x: tx, z: -ty, tree });\n    return true;" in block
    islands = _extract("addTreeIslands", js)
    assert 'mesh.userData.basis = "inferred";' in islands or "basis: \"inferred\"" in islands
    assert "stampPavedRing(ring, top);" in islands


def test_each_room_paints_its_own_outside_walls() -> None:
    js = _page_js()
    shell = _extract("buildHomeShell", js)
    assert "liningFaces.push({ edge, a, length, ux, uz, nx, nz, panels });" in shell
    assert "layout: laidOut, liningFaces," in shell
    # A bay's floor and ceiling have an inside face, not the facade's paint.
    assert "homeOutcropCapGeometry(cap.plan,y+inside),shellPlaster" in shell
    interior = _extract("buildInterior", js)
    assert "entry.homeShell?.liningFaces" in interior
    assert "paintMaterial(paint)" in interior
    assert 'skin.userData.surface = "interior_wall_paint";' in interior
