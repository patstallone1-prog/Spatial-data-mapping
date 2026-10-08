"""A device that cannot hold a whole region builds the square round the walker, from 500 m cells.

The page used to be killed and reloaded, over and over, on anything smaller than the machine it
was made on: three gigabytes while the corridor built. These hold the parts that stop that.
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

from tests.test_corridor_geometry_rules import NODE, _extract, _page_js

ROOT = Path(__file__).resolve().parents[1]


def _cells():
    spec = importlib.util.spec_from_file_location("build_window_cells", ROOT / "tools/build_window_cells.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_cells_put_back_together_are_the_file(tmp_path: Path) -> None:
    cells = _cells()
    ways = [{"kind": "street", "points": [[-122.42 + i * 0.001, 37.79], [-122.42 + i * 0.001, 37.795]]}
            for i in range(80)]
    ways += [{"kind": "poi", "name": f"p{i}"} for i in range(20)]          # nowhere in particular
    source = tmp_path / "sf-corridor-3d.json"
    source.write_text(json.dumps({"bbox": {"west": -122.43, "east": -122.33, "south": 37.78, "north": 37.8},
                                  "ways": ways, "summary": {"n": 1}}))
    result = cells.cut(source)
    assert result and result["lists"] == 1
    folder = tmp_path / "cells" / "sf-corridor-3d"
    manifest = json.loads((folder / "manifest.json").read_text())
    base = json.loads((folder / "base.json").read_text())
    assert base["ways"] == [] and base["summary"] == {"n": 1} and manifest["bbox"]["west"] == -122.43
    # Every cell gathered, as the page gathers them: each item once, in its first order.
    gathered = {}
    for name in manifest["cells"]:
        for index, item in json.loads((folder / f"{name}.json").read_text())["ways"]:
            gathered[index] = item
    assert [gathered[i] for i in sorted(gathered)] == ways


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_a_page_that_died_loads_lighter_and_never_builds_two_regions() -> None:
    js = _page_js()
    level = js[js.index("const LIGHT_LEVEL = (() => {"):js.index("if (!ATTACH) {\n  try { localStorage.setItem(LOAD_MARK_KEY")]
    assert "mark && Date.now() - mark.at < 15 * 60 * 1000" in level and "Math.max(level, mark.level || 0) + 1" in level
    assert "progress.hidden = true; markLoadSurvived();" in js
    # Decided before anything is fetched, and only the cells the square touches are.
    assert js.index("const LIGHT_SPEC") < js.index("const [DATA, OFFICIAL_GEOMETRY")
    assert "fetchWindowed(PAYLOAD_URL," in js and "fetchWindowed(GROUND_URL," in js
    assert 'fetchWindowed(asset("sf-corridor-furniture.json"),' in js
    # The rest of the city from the tile tree, outside the square.
    assert "let TILE_OWN_BOX = BUILD_WINDOW ? BUILD_WINDOW.box.slice()" in js
    # A lighter build opens a page for another place rather than building a second region in this one.
    assert "if (inOwn) { rebuildRoundHere(lon, lat); return true; }" in js
    assert "checkLightWindow(frameCount);" in _extract("animate", js)


def test_app_pages_fetch_their_own_payload_whole_or_in_cells() -> None:
    page = (ROOT / "docs/app-regions/sf-mission/app-model.html").read_text()
    assert 'const PAYLOAD_URL = "sf-corridor-3d.json";' in page
    assert (ROOT / "docs/app-regions/sf-mission/cells/sf-corridor-3d/manifest.json").exists()
    corridor = (ROOT / "docs/app-model.html").read_text()
    assert 'const GROUND_URL = "app-sf-corridor-ground.json";' in corridor
    assert (ROOT / "docs/cells/app-sf-corridor-ground/manifest.json").exists()
