"""Rules against things that cannot be: a tree in a pole, a kerb apart from its walk, a bench on
a crossing island (docs/61-cleanup-rules.md). The page's source is read as written."""
from __future__ import annotations

import re
from pathlib import Path

MODULES = Path(__file__).resolve().parents[1] / "src" / "smc" / "renderer" / "page" / "module"


def _js(prefix: str) -> str:
    [path] = sorted(MODULES.glob(prefix + "-*.js"))
    return path.read_text(encoding="utf-8")


def test_a_tree_is_never_left_standing_in_a_pole() -> None:
    trees, ground = _js("17"), _js("18")
    clear = float(re.search(r"TREE_POLE_CLEAR_M = ([\d.]+)", trees).group(1))
    # Half a three-foot opening and a pole's foot: the pole is outside the opening.
    assert clear >= 0.4572 + 0.2
    # An opening is slid off a pole like any other obstacle; with no slide clear, no tree.
    assert "treeCrossingNear(x,z) || Boolean(poleNear(x,z))" in ground
    assert re.search(r"if \(!placed && poleNear\(plot\.center\[0\], plot\.center\[1\]\)\) \{ treeSquareStats\.poleDropped \+= 1; return false; \}", ground)
    # A tree with no opening is stepped off it or left out, and both are counted.
    assert "stepOffPole(tx, tz, clear" in ground and "treeSquareStats.poleMoved += 1" in ground
    # Trees and the furniture layer read one record, fetched once.
    assert "streetFurnitureOnce()" in ground and "furniture = await streetFurnitureOnce();" in _js("21")


def test_no_loose_furniture_on_an_island_or_in_the_way_of_a_crossing() -> None:
    kerbs = _js("19")
    body = kerbs[kerbs.index("function furnitureMisplaced"):kerbs.index("window.kerbsideFurnitureGuard")]
    for why in ("road", "junction", "driveway", "crossing", "island"):
        assert f'return "{why}"' in body
    benches = kerbs[kerbs.index("function addBenches"):kerbs.index("function addMuniShelters")]
    assert "furnitureMisplaced(row.anchor.x, row.anchor.z)" in benches
    # A bus stop's own bench and shelter are the stop's: not asked.
    shelters = kerbs[kerbs.index("function addMuniShelters"):]
    assert "furnitureMisplaced" not in shelters[:4000]
