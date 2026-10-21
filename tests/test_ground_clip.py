"""A ground material clipped to the detail window keeps one copy of the clip, cloned or not."""

from __future__ import annotations

import json
import subprocess

import pytest

from tests.test_corridor_geometry_rules import NODE, _page_js

pytestmark = pytest.mark.skipif(NODE is None, reason="node is not installed")


def _box_clip(js: str) -> str:
    """applyBoxClip, cut by its neighbour: its shader strings hold braces a counter would miss."""
    start = js.index("function applyBoxClip(")
    return js[start:js.index("function clipDetailWorld(", start)]


def test_a_clipped_material_cloned_and_clipped_again_compiles_one_clip() -> None:
    js = _page_js()
    script = """
const BOX_SET_MAX = 4;
let boxClipCount = 0;
class Material { constructor(){ this.userData = {}; this.onBeforeCompile = () => {}; this.customProgramCacheKey = () => "base"; }
  // three.js copies userData through JSON, which is what lost the clip's identity.
  clone(){ const m = new Material(); m.userData = JSON.parse(JSON.stringify(this.userData));
    m.onBeforeCompile = this.onBeforeCompile; m.customProgramCacheKey = this.customProgramCacheKey; return m; } }
""" + _box_clip(js) + """
const box = { value: [[0, 0, 1, 1]] };
const wrap = (material) => ({ traverse: (visit) => visit({ material }) });
const original = new Material();
applyBoxClip(wrap(original), box);
const cloned = original.clone();                 // as the tunnel cut does
applyBoxClip(wrap(cloned), box);                 // and the window clips it again
const shader = { uniforms: {}, vertexShader: "#include <common>\\n#include <project_vertex>",
  fragmentShader: "#include <common>\\nvoid main() {" };
cloned.onBeforeCompile(shader);
console.log(JSON.stringify({ declarations: shader.fragmentShader.split("uniform vec4 uDetailBoxes1[").length - 1,
  key: cloned.customProgramCacheKey() }));
"""
    out = subprocess.run([NODE, "-"], input=script, capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    got = json.loads(out.stdout)
    assert got["declarations"] == 1, "a second copy of the clip redefines its uniform and the shader fails"
    assert got["key"].count(":ownership-v2:uDetailBoxes1:") == 1


def test_the_tunnel_cut_keeps_the_clips_a_material_carries() -> None:
    js = _page_js()
    assert "material.userData.detailOwnerships=original.userData.detailOwnerships.slice();" in js
    assert "cacheKey.includes(`:ownership-v2:${name}:`)" in _box_clip(js)
