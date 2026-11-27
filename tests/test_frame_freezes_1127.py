"""The 2026-11-27 frame pass: shaders of what is made in play compiled before it is drawn, a
tile's ground read once a point, the walkers' plans kept while they hold (docs/76)."""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODULES = ROOT / "src" / "smc" / "renderer" / "page" / "module"


def _module(name: str) -> str:
    return next(MODULES.glob(f"{name}-*.js")).read_text()


def test_surfaces_made_in_play_are_compiled_off_the_page_before_they_are_drawn() -> None:
    gate = _module("27")
    assert "THREE.Object3D.prototype.add = function" in gate
    assert "renderer.compileAsync(object, camera, scene)" in gate
    # Both the page's shader and a picture's (the stand-in capture, portraits).
    assert "renderer.setRenderTarget(compileGateTarget);" in gate
    assert "if (!xrFrame) runCompileGate();" in gate
    # Nested jobs never put the gate's layer back as an object's own.
    assert "compileGateHeld.has(o)" in gate
    view = (ROOT / "docs" / "city" / "view.mjs").read_text()
    assert "group.userData.compileGate = true;" in view
    assert 'rehearsal.name = "city-rehearsal"' in view
    assert "homeShellGroup.userData.compileGate = true;" in _module("25")


def test_tile_builds_read_each_point_once_and_skip_far_bridge_cuts() -> None:
    tiles = _module("04")
    assert "const memo = new Map();" in tiles and "tileGroundMemo = memo;" in tiles
    # Built a piece at a time: the frame goes on between its layers and its lawns.
    assert "await buildTile(tile, layers);" in tiles
    assert "for (let k = 0; k < layers.lawns.length; k += TILE_LAWN_ROWS_A_PIECE)" in tiles
    ground = _module("03")
    assert "if(x<bridgeCutsBox[0]||x>bridgeCutsBox[2]||z<bridgeCutsBox[1]||z>bridgeCutsBox[3])return y;" in ground


def test_walkers_look_again_only_when_their_plan_stops_holding() -> None:
    view = (ROOT / "docs" / "city" / "view.mjs").read_text()
    assert "now - P.at > every" not in view
    assert "blockedAhead(entry, pos, P, now)" in view
    assert "w.d - P.d0 > P.reach * 0.6" in view


def test_ground_reads_allocate_nothing() -> None:
    parks = _module("18")
    assert "ring._box" in parks
    stairs = _module("14")
    assert "publicStairNear" in stairs
