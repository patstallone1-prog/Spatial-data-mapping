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


def test_a_bus_shelter_is_clipped_whole_by_where_it_stands_never_cut_through() -> None:
    """A window's edge crossing a shelter cut part of it away, as if an invisible line ran through
    it. A material marked wholeClip is in or out of the box by its ``clipAt`` (where the stop
    stands, the same for all its parts), not by each fragment's place."""
    js = _page_js()
    script = """
const BOX_SET_MAX = 4;
let boxClipCount = 0;
class Material { constructor(){ this.userData = {}; this.onBeforeCompile = () => {}; this.customProgramCacheKey = () => "base"; } }
""" + _box_clip(js) + """
const compile = (whole) => {
  const material = new Material();
  if (whole) material.userData.wholeClip = true;
  applyBoxClip({ traverse: (visit) => visit({ material }) }, { value: [[0, 0, 1, 1]] });
  const shader = { uniforms: {}, vertexShader: "#include <common>\\n#include <project_vertex>",
    fragmentShader: "#include <common>\\nvoid main() {" };
  material.onBeforeCompile(shader);
  return { vertex: shader.vertexShader, key: material.customProgramCacheKey() };
};
console.log(JSON.stringify({ whole: compile(true), cut: compile(false) }));
"""
    out = subprocess.run([NODE, "-"], input=script, capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    got = json.loads(out.stdout)
    assert "attribute vec2 clipAt;" in got["whole"]["vertex"]
    assert "detailPosition=vec4(clipAt.x,0.0,clipAt.y,1.0)" in got["whole"]["vertex"]
    assert "clipAt" not in got["cut"]["vertex"] and "instanceMatrix*detailPosition" in got["cut"]["vertex"]
    assert got["whole"]["key"] != got["cut"]["key"], "the two programs must not share a cache entry"


def test_every_part_of_a_stop_carries_where_the_stop_stands() -> None:
    from pathlib import Path

    stops = (Path(__file__).resolve().parents[1] / "src/smc/renderer/page/module/19-the-dropped-kerb-at-every.js").read_text()
    body = stops[stops.index("function instanceParts("):]
    body = body[:body.index("\n}\n")]
    assert 'geometry.setAttribute("clipAt", new THREE.InstancedBufferAttribute(at, 2))' in body
    assert "stopMaterials[materialName].userData.wholeClip = true" in body
    assert "at[2 * i] = x; at[2 * i + 1] = z;" in body
