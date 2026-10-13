"""Park repairs must remain shared rules, not Moscone-only exceptions."""
from __future__ import annotations

import json
import subprocess

import pytest

from tests.test_corridor_geometry_rules import NODE, _extract, _page_js

pytestmark = pytest.mark.skipif(NODE is None, reason="node is not installed")


def run_js(script: str):
    result = subprocess.run([NODE, "-"], input=script, text=True, capture_output=True, timeout=30)
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def test_only_explicit_osm_overhead_connectivity_is_accepted():
    js = _page_js()
    result = run_js(_extract("mappedOverheadLine", js) + """
const line={id:'osm:power_line:way:123',source:'openstreetmap',
 geometry_basis:'osm_overhead_line_way',power_kind:'minor_line',points:[[0,0],[1,1]]};
console.log(JSON.stringify([mappedOverheadLine(line),
 mappedOverheadLine({...line,location:'underground'}),
 mappedOverheadLine({...line,geometry_basis:'nearest_poles'}),
 mappedOverheadLine({...line,source:'mapillary'}),
 mappedOverheadLine({...line,id:'inferred:123'}),
 mappedOverheadLine({...line,points:[[0,NaN],[1,1]]})]));
""")
    assert result == [True, False, False, False, False, False]
    network = _extract("addElectricalNetwork", js)
    assert "inferredSpans" not in network
    assert "inferred_pole_to_pole" not in network
    assert "inferred_wire_spans: 0" in network
    assert "utility_poles: poleRows.length" in network


def test_inside_landing_moves_just_outside_not_to_building_centroid():
    js = _page_js()
    result = run_js("""
const WALKER_RADIUS_M=.35;
const entry={way:{osm_id:1},local:[[0,0],[10,0],[10,10],[0,10],[0,0]],
 minX:0,maxX:10,minZ:0,maxZ:10};
const footprintById=new Map([['1',entry]]);
""" + _extract("insideFootprint", js) + """
function buildingAt(x,z){return insideFootprint(entry,x,z)?entry.way:null;}
function eligibleLanding(){throw Error('should find the nearby exterior');}
""" + _extract("exteriorLanding", js) + """
const inside=exteriorLanding({x:1,z:5}),outside=exteriorLanding({x:-2,z:5});
console.log(JSON.stringify({inside,outside,blocked:Boolean(buildingAt(inside.x,inside.z))}));
""")
    assert result["inside"]["x"] == pytest.approx(-0.45)
    assert result["inside"]["z"] == 5
    assert not result["blocked"]
    assert result["outside"] == {"x": -2, "z": 5}


def test_open_door_does_not_let_walker_cross_canonical_footprint():
    js = _page_js()
    result = run_js("""
const WALK_SUBSTEP_M=.18,WALKER_RADIUS_M=.35,FOOTPRINT_CELL=60,footprintGrid=new Map();
const entry={local:[[1,-1],[2,-1],[2,1],[1,1],[1,-1]],minX:1,maxX:2,minZ:-1,maxZ:1};
footprintGrid.set('0:0',[entry]);footprintGrid.set('0:-1',[entry]);
const avatar={position:{x:0,z:0}},activeGuest=null;
function wallSegmentsNear(){return [];} // fully open doorway, no wall collision segment
""" + _extract("insideFootprint", js) + _extract("firstBuildingCollision", js)
        + _extract("distanceToSegmentSquared", js) + _extract("walkerFootprintBlocked", js)
        + _extract("moveWalker", js) + """
const moved=moveWalker(20,0);
console.log(JSON.stringify({moved,x:avatar.position.x,inside:insideFootprint(entry,avatar.position.x,0)}));
""")
    assert 0 < result["x"] <= 0.65
    assert not result["inside"]


def test_grass_stays_pixel_based_without_large_repeating_features():
    js = _page_js()
    grass = _extract("grassTexture", js)
    assert "createImageData(size, size)" in grass
    assert "createRadialGradient" not in grass
    assert "mowStep" not in grass
    assert "ctx.putImageData(image, 0, 0)" in grass
    assert "GRASS_TEXTURES.set(key, texture)" in grass


def test_park_follows_survey_grid_and_recomputes_slope_normals():
    js = _page_js()
    assert "park: [4.0, 0.05, 2.0, true]" in js
    lifted = _extract("liftOneMesh", js)
    assert "groundLiftAt(v.x, v.z)" in lifted
    assert '"park", "yard", "court", "plaza", "front_walk"' in lifted
    assert "o.geometry.computeVertexNormals();" in lifted


def test_all_worlds_and_gps_share_exterior_guard():
    js = _page_js()
    assert "keepWalkerOutside();" in _extract("stepAvatar", js)
    assert "keepWalkerOutside();" in _extract("guestFrame", js)
    assert "walkerExteriorAt(x, -y)" in _extract("startGps", js)
    assert "moveWalker(move.x, move.z)" in _extract("followGps", js)
    assert "walkerExteriorAt(gps.target.x, gps.target.z)" in _extract("followGps", js)
    assert "walkerExteriorAt(gps.target.x, gps.target.z)" in _extract("returnToGps", js)
    assert "walkerExteriorAt(landing.x, landing.z)" in _extract("goTo", js)
