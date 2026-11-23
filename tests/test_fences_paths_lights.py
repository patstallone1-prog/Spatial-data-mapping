"""The fence, path, light and kerbside pass of 2026-11-22: footpaths that end at the walk, a
sidewalk that carries on across a driveway, windows lit whole, street lamps that glow, gates you
can walk through, and the kerb's gutter pan where a kerb has one."""

from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

import pytest

from tests.test_corridor_geometry_rules import NODE, _extract, _page_js

pytestmark = pytest.mark.skipif(NODE is None, reason="node is not installed")
ROOT = Path(__file__).resolve().parents[1]
from tests.test_waterworks import THREE as THREE_MODULE  # noqa: E402


def _run(script: str, module: bool = False):
    args = [NODE, "--input-type=module", "-"] if module else [NODE, "-"]
    out = subprocess.run(args, input=script, capture_output=True, text=True, timeout=60, cwd=ROOT)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


def _const(name: str, js: str) -> str:
    m = re.search(rf"(?:const|let) {name} = [^;]+;", js)
    assert m, name
    return m.group(0)


def test_a_footpath_ends_at_the_walk_edge_and_the_walk_carries_on():
    # Moscone, 2026-11-22: a park path ran on under the pavement to the kerb and showed through it
    # as a dark tongue. Its runs stop where the walk (or the frontage paving) begins, to a few cm.
    js = _page_js()
    result = _run("""
function xy(lon,lat){return [lon,lat];}
function lonLatFromXZ(x,z){return [x,-z];}
// A street along z=0: roadway to 5 m out, its walk to 8 m; frontage paving 8 to 9 m on one side.
function insideCarriageway(x,z){return Math.abs(z)<5;}
function parkPavementAt(x,z){return z>8&&z<9;}
let PATH_CUT_GRID=null;
function pavementSurfaceAt(){return null;}
function onStreetOrItsWalk(x,z){return Math.abs(z)<8;}
""" + _extract("pathCutAt", js) + _extract("pathRunsOffStreets", js) + """
// A path from deep in the park (z=30) straight to the kerb (z=0): lat = -z.
const runs=pathRunsOffStreets([[2,-30],[2,0]]);
// One that crosses the street and carries on beyond it.
const through=pathRunsOffStreets([[4,-30],[4,30]]);
const ends=(r)=>r.map(run=>[run[0][1],run.at(-1)[1]].map(v=>-v));
console.log(JSON.stringify({runs:ends(runs),through:ends(through)}));
""")
    [run] = result["runs"]
    assert run[0] == pytest.approx(30, abs=0.01)
    assert run[1] == pytest.approx(9, abs=0.05), "ends at the frontage paving, not under the walk"
    assert len(result["through"]) == 2
    assert result["through"][1][0] == pytest.approx(-8, abs=0.05)


def test_a_driveway_does_not_cut_the_sidewalk_or_get_a_crosswalk():
    # Lombard Street, 2026-11-22: every motel's entrance broke the walk into islands with asphalt
    # and two white bars between them. A street's carriageway cuts a walk; a driveway's, a lot's
    # entrance or its aisle runs under it.
    js = _page_js()
    result = _run(
        _const("CARRIAGEWAY_CELL", js) + "\nconst carriagewayGrid=new Map();\n"
        + _const("SERVICE_ROAD_M", js) + "\n" + _const("UNMARKED_SERVICE", js) + "\n"
        + "".join(_extract(n, js) for n in ("isUnmarkedService", "distanceToSegmentSquared",
                                            "addCarriagewaySegment", "insideCarriageway",
                                            "insideStreetCarriageway")) + """
addCarriagewaySegment(-50,0,50,0,5,{kind:'street',name:'Lombard Street'});
for (const service of ['access','parking_aisle','driveway']) addCarriagewaySegment(10,0,10,20,3,{kind:'street',service});
const at=[[10,8],[10,5.5],[0,3]];
console.log(JSON.stringify({any:at.map(([x,z])=>insideCarriageway(x,z,0)),street:at.map(([x,z])=>insideStreetCarriageway(x,z,0))}));
""")
    assert result["any"] == [True, True, True]
    assert result["street"] == [False, False, True]
    js_all = _page_js()
    assert "insideStreetCarriageway(x, -y, 0.0)" in _extract("sidewalkCrossingReplacementSpans", js_all)
    guard = _extract("pavementRunsOutsideCarriageway", js_all)
    assert "insideStreetCarriageway(x, z, 0.30)" in guard and "insideCarriageway(x, z" not in guard
    assert "insideCarriageway(" not in _extract("pavementSurroundedByStreet", js_all)


def test_a_window_lights_whole_from_its_middle():
    # A window was lit in part: the hash was of the fragment's own cell, and a pane that crossed
    # a cell boundary was half lit. Every fragment of a pane hashes the pane's middle, found from
    # the map's texture coordinates (one window a tile).
    js = _page_js()
    assert "vec2 kbMid = floor(kbU) + 0.5;" in js
    assert "vec3 kbCell = floor(kbMidW / vec3(1.1, 1.4, 1.1));" in js
    assert "floor(kbWP / vec3(1.1, 1.4, 1.1))" not in js


def test_more_windows_are_lit_through_the_evening_and_night():
    source = (ROOT / "docs/environment-runtime.mjs").read_text()
    body = re.search(r"export function litShare\(h\)\{.*?\n\}", source, flags=re.S).group(0)
    result = _run(body.replace("export ", "") + """
console.log(JSON.stringify([19, 23, 0.5, 3, 6].map(litShare)));
""")
    evening, late, midnight, small_hours, dawn = result
    assert evening == pytest.approx(0.75)
    assert late == pytest.approx(0.65)
    assert midnight == pytest.approx(0.5)
    assert small_hours == pytest.approx(0.25)
    assert dawn == pytest.approx(0.4)


def test_street_lamps_glow_at_night_and_light_the_pavement():
    js = _page_js()
    lights = _extract("addStreetLights", js)
    assert lights.count("nightLamp(new THREE.MeshStandardMaterial") == 2
    assert "nightLampGlow(" in lights and "__kerbsideProxyLight" in lights
    glow = _extract("nightLampGlow", js)
    assert "AdditiveBlending" in glow and "kbNight" in glow
    assert "kbLampGlow" in _extract("nightLamp", js)
    light = (ROOT / "docs/proxy-light.mjs").read_text()
    assert re.search(r"lamp_strength:\s*2\.4", light) and re.search(r"lamp_reach_m:\s*17", light)


def test_the_bus_pad_is_not_painted_as_a_grey_strip():
    # Chestnut Street at Fillmore, 2026-11-22: the photo-verified concrete bus pad was drawn flat
    # and untextured over the lane, a grey strip at every stop.
    js = _page_js()
    assert "const BUS_PADS_DRAWN = false;" in js
    assert 'seen.verdict === "pad" && BUS_PADS_DRAWN' in js


def test_a_walk_gate_is_wide_and_tall_enough_to_walk_through():
    # A gate's bar at 2.1 m was under a walker's 2.0 m head clearance from a raised walk, and a
    # recorded half-metre gate was narrower than a walker: holes in a fence nobody could pass.
    js = _page_js()
    assert float(_const("GATE_BAR_CLEAR_M", js).split("=")[1].strip(" ;")) >= 2.5
    assert float(_const("GATE_MIN_W_M", js).split("=")[1].strip(" ;")) >= 1.0
    fences = _extract("buildPropertyFences", js)
    assert "Math.max(GATE_MIN_W_M, g.width_m)" in fences
    assert "Math.max(GATE_BAR_CLEAR_M + 0.14, f.h + 0.3)" in fences


def test_no_gutter_pan_along_a_median_and_the_wet_line_follows_the_kerb():
    # Lombard Street and Richardson Avenue, 2026-11-22: a flat olive pan ran down the median's
    # kerbs and over the centre lines; a drain's wet line ran straight on off a curve and out
    # across the road, glossy enough to mirror the sky blue.
    result = _run("""
import * as THREE from "__THREE__";
import * as W from "./docs/waterworks-renderer.mjs";
// A street 12 m wide along x; a 2 m median kerb at z = -1..1 with the far carriageway beyond it.
const onRoad=(x,z)=>Math.abs(z)<6 && !(Math.abs(z)<1);
const island=W.islandKerb(onRoad,0,1,0,-1);    // the median's kerb, facing out of the road (-z)
const kerbside=W.islandKerb(onRoad,0,6,0,1);   // the street's own kerb, the walk behind it
// A curb inlet at x=0 on a kerb that turns away 3 m along +x (it runs on along -x): the line
// stops where the kerb goes.
const kerb=(x,z,reach)=>x<3?{x,z:6,nx:0,nz:1,ax:1,az:0}:null;
const tile={schema:"kerbside.waterworks/1",drains:[{id:"d",p:[0,-6/111000],f:"curb_opening",s:"storm",r:0}]};
const g=W.buildWaterworks(THREE,[tile],{place:(lon,lat)=>({x:lon*88000,z:-lat*111000}),ground:()=>0,kerb,document:null});
const wet=g.children.find(c=>c.name==="waterworks-gutter-flow");
const p=wet.geometry.getAttribute("position");let maxX=-1e9;for(let i=0;i<p.count;i++)maxX=Math.max(maxX,p.getX(i));
console.log(JSON.stringify({island,kerbside,maxX,rough:wet.material.roughness}));
""".replace("__THREE__", THREE_MODULE.as_uri()), module=True)
    assert result["island"] is True and result["kerbside"] is False
    assert result["maxX"] < 3.0, "no wet line past where the kerb turns away"
    assert result["rough"] >= 0.8, "damp concrete, not a mirror"
