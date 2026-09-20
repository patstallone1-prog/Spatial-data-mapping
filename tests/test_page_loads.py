"""The page as shipped runs from top to bottom without an error.

Every other test here pulls a function out of the renderer by name and runs it on its own.
That is how two load-time errors -- a call above the `const` it read, a call to a function
that had been removed -- went out with every test green and a page that drew nothing. This
runs the whole script in Node (tests/page_smoke/run.mjs) with three.js and the DOM stubbed
and the committed payload served to its fetches, and fails on the first uncaught error.
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
PAGE = ROOT / "docs" / "sf-corridor-3d.html"
NODE = shutil.which("node")


def page_module(out: Path) -> Path:
    text = PAGE.read_text(encoding="utf-8")
    start = text.index('<script type="module">')
    js = text[start + len('<script type="module">'):text.index("</script>", start)]
    js = re.sub(r'^import \* as THREE from "[^"]+";', "const THREE = globalThis.__THREE;", js, flags=re.M)
    js = re.sub(r'^import \{ GLTFLoader \} from "[^"]+";',
                "const GLTFLoader = globalThis.__THREE.GLTFLoader;", js, flags=re.M)
    out.write_text(js, encoding="utf-8")
    return out


@pytest.mark.skipif(NODE is None, reason="node is needed to run the page")
def test_the_shipped_page_loads_without_an_error(tmp_path: Path) -> None:
    if not PAGE.exists() or not (ROOT / "docs" / "sf-corridor-3d.json").exists():
        pytest.skip("no built page to load")
    module = page_module(tmp_path / "page.mjs")
    out = subprocess.run([NODE, str(ROOT / "tests" / "page_smoke" / "run.mjs"), str(ROOT), str(module)],
                         capture_output=True, text=True, timeout=300)
    assert out.returncode == 0 and out.stdout.strip(), out.stdout[-2000:] + out.stderr[-2000:]
    result = json.loads(out.stdout.strip().splitlines()[-1])
    assert result["ok"], result
    # The page reached its exports, and the terrain it loaded stands under the corridor.
    assert result["exports"] > 50, result
    assert result["terrain"] and 40 < result["h0"] < 80, result
    # A world with no streets in it loaded without an error once, from an Overpass answer
    # that had no elements; a page that builds nothing is not a page that works.
    assert result["ways"] > 20_000 and result["streets"] > 2_000, result
