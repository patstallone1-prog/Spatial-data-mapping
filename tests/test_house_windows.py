"""A house's windows are one layout for the street and for the walker, and none touches the ground.

The street sees a house's windows as decals; the walker who comes near sees its shell, with real
glass. Both are drawn from homeWindowLayout, so a house never changes on screen when its shell is
built. Inside a house the view is first person; nothing lifts a roof off.
"""

from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

import pytest

from tests.test_corridor_geometry_rules import NODE, _extract, _page_js

ROOT = Path(__file__).resolve().parents[1]
pytestmark = pytest.mark.skipif(NODE is None, reason="node is not installed")

# A 10 m by 8 m house in a flat metre frame; its street wall is the edge z = 0 (x 0..10), outward
# is -z. The ground outside rises toward x = 10 (a hill along the street).
PREAMBLE = """
const xy = (lon, lat) => [lon * 100000, lat * 100000];
const DOOR_HEIGHT_M = 2.1, GARAGE_HEIGHT_M = 2.7, HILLSIDE_RISE_M = 1.2;
const HOME_OPENINGS = { buildings: {} };
let slope = 0;
function terrainGroundAt(x, z) { return slope * x; }
function entryFloorY(entry) { return 0.05; }
function insideFootprint(entry, x, z) { return x > 0 && x < 10 && z > 0 && z < 8; }
function buildingAt() { return null; }
let photographed = false;
function photographedEdge() { return photographed; }
function homeStoreyCount(entry, h) { return Math.max(1, Math.round(h / 2.9)); }
function random(s) { const x = Math.sin(s) * 43758.5453; return x - Math.floor(x); }
const entry = { way: { osm_id: 7, garages: [] }, local: [[0, 0], [10, 0], [10, 8], [0, 8], [0, 0]] };
const spec = { base: 0, height: 6.2, seed: 11 };
"""


def _run(body: str) -> dict:
    js = _page_js()
    consts = "\n".join(re.search(rf"const {n} = [^;]+;", js).group(0)
                       for n in ("WINDOW_GROUND_CLEAR_M", "FRONT_DOOR_PANEL_W_M"))
    script = PREAMBLE + consts + "\n" + "\n".join(
        _extract(n, js) for n in ("regularHomeWindows", "homeWindowLayout")) + "\n" + body
    out = subprocess.run([NODE, "-"], input=script, capture_output=True, text=True, timeout=30)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


def test_no_window_touches_the_ground_even_on_a_hill() -> None:
    result = _run("""
    const flat = homeWindowLayout(entry, spec).edges[0].windows;
    slope = 0.25;                     // 2.5 m of rise along the street wall
    const hill = homeWindowLayout(entry, spec).edges[0].windows;
    const ground = (u) => slope * u;
    console.log(JSON.stringify({ flat: flat.length, hill: hill.length,
      lowest: Math.min(...hill.map((o) => o.v - Math.max(ground(o.u), ground(o.u + o.w)))) }));
    """)
    assert result["flat"] > 0
    assert result["hill"] < result["flat"], "windows the hill would reach are left out"
    assert result["lowest"] >= 0.45 - 1e-9


def test_no_window_over_a_door_a_garage_or_on_a_photographed_wall() -> None:
    result = _run("""
    entry.doors = [{ edge: 0, t0: 0.2, t1: 0.3, width: 1.0 }];
    entry.way.garages = [{ a: [0.00007, 0], b: [0.00007, 0], t: 0, w: 2.6 }];   // centred at x = 7
    const layout = homeWindowLayout(entry, spec);
    const ws = layout.edges[0].windows;
    const clear = ws.every((o) => (o.u + o.w <= 2.5 - 0.95 - 0.15 || o.u >= 2.5 + 0.95 + 0.15 || o.v > 0.05 + 2.1 + 0.3 + 0.15)
      && (o.u + o.w <= 7 - 1.3 - 0.15 || o.u >= 7 + 1.3 + 0.15 || o.v > 2.7 + 0.2 + 0.15));
    photographed = true;
    const none = homeWindowLayout(entry, spec).edges.every((e) => e.windows.length === 0);
    console.log(JSON.stringify({ clear, none, n: ws.length }));
    """)
    assert result["clear"], "a window overlaps the door or the garage"
    assert result["none"], "a photographed wall shows its own windows"


def test_the_street_and_the_shell_draw_the_same_windows() -> None:
    js = _page_js()
    shell = _extract("buildHomeShell", js)
    assert "const layout = entry.decalLayout || homeWindowLayout(entry, spec);" in shell
    assert "setHomeDecalsVisible(id, false);" in shell
    decals = _extract("pumpHomeDecals", js)
    assert "homeWindowLayout(entry, spec)" in decals and "entry.decalLayout = layout" in decals
    shells = _extract("updateHomeShells", js)
    assert "e.decalLayout" in shells, "a shell is only built on decals already drawn"
    assert "e.homeShell.layout !== e.decalLayout" in shells
    # The shell's walls are the batch's: the same bare texture, mapped from the same end.
    assert "map: bareFacadeTextureFor(spec.material, spec.seed)" in shell
    assert "(spec.clockwise ? length - u : u) / BAY_M" in shell
    assert ": isHome ? bareFacadeTextureFor(material, seed) : facadeTextureFor(material, seed)" in js
    south = _extract("addSouthFacadeDetail", js)
    assert "if (hasStorefront(feature)) planePart(" in south, "no painted window panel on a house"


def test_shell_glass_reads_as_the_decal_from_the_street_and_clears_close_to() -> None:
    js = _page_js()
    consts = "\n".join(re.search(rf"const {n} = [^;]+;", js).group(0)
                       for n in ("SHELL_GLASS_CLEAR_M", "SHELL_GLASS_DECAL_M"))
    script = consts + "\n" + _extract("shellGlassOpacity", js) + \
        "\nconsole.log(JSON.stringify([2, 6, 12, 18, 25, 60].map(shellGlassOpacity)));"
    out = subprocess.run([NODE, "-"], input=script, capture_output=True, text=True, timeout=30)
    values = json.loads(out.stdout)
    assert values == sorted(values), "the glass only gets clearer as the walker comes closer"
    assert values[-1] >= 0.95 and values[-2] >= 0.95
    assert values[0] <= 0.6


def test_trees_are_built_of_limbs_and_leaves_and_each_kind_differently() -> None:
    js = _page_js()
    tree = _extract("treeVariant", js)
    for kind in ('kind === "palm"', 'kind === "conifer"', "street:", "broad:", "columnar:"):
        assert kind in tree, kind
    assert "branchGeometry(" in tree and "leafCard(" in _extract("treeVariant", js) + js
    assert "alphaTest: 0.45" in tree and "treeLeafTexture(" in tree
    leaf = _extract("treeLeafTexture", js)
    assert 'kind === "palm"' in leaf and 'kind === "conifer"' in leaf
    assert "SphereGeometry" not in tree and "ConeGeometry" not in tree


def test_painted_materials_take_the_house_colour_and_brick_and_stone_keep_theirs() -> None:
    js = _page_js()
    paintable = re.search(r"const PAINTABLE_PHOTO_CLASSES = new Set\(\[([^\]]+)\]\)", js).group(1)
    assert '"wood_siding"' in paintable and '"stucco_render"' in paintable
    assert '"brick"' not in paintable and '"stone"' not in paintable
    assert "material.photoLabel && !PAINTABLE_PHOTO_CLASSES.has(material.photoLabel)" in js
    assert "if (photo && PAINTABLE_PHOTO_CLASSES.has(materialClass)) toPaintableDetail(ctx, canvas);" in js
    library = (ROOT / "scripts/build_material_library.py").read_text()
    for cls in ("vinyl_siding", "painted_brick", "ceramic_tile", "metal_panel"):
        assert f'"{cls}"' in library and f"{cls}:" in js
    manifest = json.loads((ROOT / "docs/materials/manifest.json").read_text())
    assert len({a["material_class"] for a in manifest["assets"]}) >= 9
    assert len(manifest["assets"]) >= 30


def test_vercel_deploys_nothing_that_has_not_passed() -> None:
    vercel = json.loads((ROOT / "vercel.json").read_text())
    assert vercel["ignoreCommand"] == "node tools/vercel/gate.mjs"
    assert "!/tools/vercel" in (ROOT / ".vercelignore").read_text()
    gate = (ROOT / "tools/vercel/gate.mjs").read_text()
    assert '["ruff", "pytest", "render audit vs baseline"]' in gate
    # A branch other than main never deploys: the gate exits 0 (skip) without asking GitHub.
    out = subprocess.run([NODE, str(ROOT / "tools/vercel/gate.mjs")], capture_output=True, text=True,
                         env={"VERCEL_GIT_COMMIT_REF": "some-branch", "PATH": "/usr/bin:/bin"}, timeout=30)
    assert out.returncode == 0 and "not deploying" in out.stdout
