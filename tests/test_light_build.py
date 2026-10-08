"""A device that cannot hold a whole region builds the square round the walker, from 500 m cells.

The page used to be killed and reloaded, over and over, on anything smaller than the machine it
was made on: three gigabytes while the corridor built. These hold the parts that stop that.
"""

from __future__ import annotations

import importlib.util
import json
import subprocess
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
    level = js[js.index("const LIGHT_LEVEL = (() => {"):js.index("if (!ATTACH) {\n  try { sessionStorage.setItem(LOAD_MARK_KEY")]
    assert "age >= 0 && age < 15 * 60 * 1000" in level
    assert "Math.max(level, validLightLevel(mark.level)) + 1" in level
    assert "markLoadSurvived(); // only after BOTH" in js
    assert "!window.kerbsideReady?.streets || !window.kerbsideReady?.ground" in js
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


def test_the_service_worker_keeps_only_the_shell() -> None:
    worker = (ROOT / "tools/pwa/sw.js").read_text()
    # Nothing but the shell is stored: no copy of the payload, the cells, tiles or textures.
    assert "if (!shell && request.mode !== \"navigate\") return;" in worker
    assert "if (shell && response.ok)" in worker
    assert "caches.match(request).then((hit) =>\n      hit ||" not in worker      # no cache-first data
    js = _page_js()
    # Recovery is scoped and awaited; normal reloads and other tabs are not crashes.
    assert "await runtimeCacheRecovery;" in js
    assert 'addEventListener("pagehide", clearLoadMark)' in js
    assert 'sessionStorage.getItem(LOAD_MARK_KEY)' in js
    assert 'localStorage.getItem(LOAD_MARK_KEY)' not in js
    assert "key => /^kerbside-[0-9a-f]{16}$/.test(key)" in js


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_a_stationary_restored_spawn_cannot_trigger_an_endless_window_reload():
    js = _page_js()
    script = """
const BUILD_WINDOW={box:[-2,-2,2,2]},LIGHT_EDGE_M=120;
let lightRebuilding=false,lightWindowStart=null;
const midLon=0,midLat=0,metersPerLon=100,metersPerLat=100;
const DATA={bbox:{west:-5,south:-5,east:5,north:5}};
const avatar={position:{x:199,z:0}};
let reloads=0;function rebuildRoundHere(){reloads++;lightRebuilding=true;}
""" + _extract("checkLightWindow", js) + """
checkLightWindow(0);checkLightWindow(30);checkLightWindow(60);
const stationary=reloads;
avatar.position.x+=2;checkLightWindow(90);checkLightWindow(120);
console.log(JSON.stringify({stationary,moved:reloads}));
"""
    out = subprocess.run([NODE, "-"], input=script, text=True, capture_output=True, timeout=30)
    assert out.returncode == 0, out.stderr
    assert json.loads(out.stdout) == {"stationary": 0, "moved": 1}
