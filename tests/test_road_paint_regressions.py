"""Road paint must survive slopes, coarse way sampling and overlapping crossings."""
import json
import re
import shutil
import subprocess

import pytest

from tests.test_corridor_geometry_rules import ROOT, _extract, _page_js


def run(script):
    if not shutil.which("node"):
        pytest.skip("Node required for renderer behavior")
    result = subprocess.run(["node", "--input-type=module", "-e", script],
                            text=True, capture_output=True, timeout=30, check=False)
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def test_lane_paint_settles_on_actual_road_not_independent_terrain():
    js = _page_js()
    rules = re.search(r"const SETTLE_RULES = \[[\s\S]*?\n\];", js).group(0)
    result = run("\n".join([
        "function attribute(values){return {count:values.length/3,getX:i=>values[i*3],getY:i=>values[i*3+1],getZ:i=>values[i*3+2],setY:(i,y)=>values[i*3+1]=y};}",
        "function mesh(surface,values){const p=attribute(values);return {isMesh:true,userData:{surface},geometry:{getAttribute:()=>p,getIndex:()=>null,computeBoundingSphere(){}}};}",
        "const road=mesh('road',[0,10,0, 4,11,0, 0,12,4]);",
        "const lane=mesh('marking',[1,0,1, 1.1,0,1, 1,0,1.1]);",
        "const crossing=mesh('crossing',[1,0,1, 1.1,0,1, 1,0,1.1]);",
        "const groups={streets:{traverse:f=>[road,lane,crossing].forEach(f)}};",
        "const SETTLE_CELL_M=2, SETTLE_COARSE_M=8; const settleKey=(x,z)=>Math.floor(x/2)*1048576+Math.floor(z/2);",
        "function refineForTerrain(g){return g;} async function maybeYield(){}",
        rules, "async " + _extract("settleOnto", js),
        "for(const rule of SETTLE_RULES)await settleOnto(rule);",
        "console.log(JSON.stringify([lane,crossing].map(m=>m.geometry.getAttribute().getY(0))));",
    ]))
    assert 10.76 <= result[0] <= 10.82, result
    assert result[1] == pytest.approx(10.81), result


def test_separate_parallel_and_perpendicular_crosswalks_are_not_duplicates():
    js = _page_js()
    result = run("\n".join([
        "const CROSSING_DEDUPE_CELL_M=4,CROSSING_DEDUPE_ANGLE_DEG=12,crossingDrawGrid=new Map();",
        "function xy(x,y){return [x,y];}",
        *[_extract(n, js) for n in ("crossingDrawPose", "crossingBearingDifference", "crossingDrawConflict", "shouldDrawCrossing")],
        "console.log(JSON.stringify([shouldDrawCrossing([[-10,0],[10,0]],3.7),",
        "shouldDrawCrossing([[10,0],[-10,0]],3.7),",
        "shouldDrawCrossing([[-10,4],[10,4]],3.7),",
        "shouldDrawCrossing([[0,-10],[0,10]],3.7)]));",
    ]))
    assert result == [True, False, True, True]


def test_preview_uses_actual_renderer_and_keeps_neighboring_context():
    source = (ROOT / "tools/road_paint_preview.py").read_text()
    assert 'page = (viewer / "app-model.html").read_text()' in source
    assert 'data["ways"] = [w for w in data["ways"] if touches' in source


def test_lane_offsets_outside_the_drawn_carriageway_are_not_painted():
    js = _page_js()
    result = run("\n".join([
        "const MARK_W=.102,JUNCTION_CLEAR_M=1;function xy(x,y){return [x,y];}",
        "function densifyWay(p){return p;}function crosswiseCarriagewayAt(){return false;}",
        "function insideIntersection(){return false;}function insideCarriageway(x,z,slack){return Math.abs(z)<4-slack;}",
        "function wayLength(p){return p.length?Math.hypot(p.at(-1)[0]-p[0][0],p.at(-1)[1]-p[0][1]):0;}",
        _extract("markingRunsClearOfJunctions", js),
        "console.log(JSON.stringify([markingRunsClearOfJunctions([[0,0],[5,0],[10,0]],{}).length,",
        "markingRunsClearOfJunctions([[0,5],[5,5],[10,5]],{}).length]));",
    ]))
    assert result == [1, 0]


def test_recorded_walk_width_cannot_bypass_measured_curb_fit():
    js = _page_js()
    assert "const fitted = walkWidthAgainstMeasuredKerbs(surfacePoints, widthMeters);" in js
    assert "const fitted = way.walk_m ? widthMeters" not in js


def test_whole_bike_edge_stripe_fits_inside_its_lane():
    result = run("\n".join([
        "const BIKE_EDGE_W_M=.18;", _extract("bikePaintEdgeOffset", _page_js()),
        "console.log(JSON.stringify([1.75,2.4].map(w=>bikePaintEdgeOffset(w)+BIKE_EDGE_W_M/2-w/2)));",
    ]))
    assert result == pytest.approx([-.02, -.02])


def test_short_corner_connector_cannot_expand_to_a_full_road_crossing():
    from tests.test_corridor_geometry_rules import _run_crossing

    result = _run_crossing("""
const ll=(x,z)=>[x/metersPerLon,-z/metersPerLat];
addCarriagewaySegment(-20,0,20,0,4.21);
// A link at the rounded end cap passes the old 2.5 m road-overlap test.
const link=[ll(19,-1.9),ll(19,1.9)];
const full=[ll(18,-5),ll(18,5)];
console.log(JSON.stringify({link:crossingRectanglePoints(link).length,full:crossingRectanglePoints(full).length}));
""")
    assert result == {"link": 0, "full": 2}


def _paint_surface_fixture(body):
    js = _page_js()
    rules = re.search(r"const SETTLE_RULES = \[[\s\S]*?\n\];", js).group(0)
    return run("\n".join([
        "function attribute(v){return {count:v.length/3,getX:i=>v[i*3],getY:i=>v[i*3+1],getZ:i=>v[i*3+2],setY:(i,y)=>v[i*3+1]=y};}",
        "function mesh(surface,v){const p=attribute(v);let idx=null;return {isMesh:true,userData:{surface},geometry:{getAttribute:()=>p,getIndex:()=>idx,setIndex:i=>{idx={count:i.length,getX:j=>i[j]};},computeBoundingSphere(){}}};}",
        "const SETTLE_CELL_M=2,SETTLE_COARSE_M=8;const settleKey=(x,z)=>Math.floor(x/2)*1048576+Math.floor(z/2);",
        "function refineForTerrain(g){return g;}async function maybeYield(){}",
        rules, "async " + _extract("settleOnto", js), body,
    ]))


def test_paint_centre_cannot_sink_under_an_overlapping_road_triangle():
    result = _paint_surface_fixture("""
const road=mesh('road',[-10,0,-10,30,0,-10,-10,0,30]);
const peak=mesh('road',[1,.5,1,2,.5,1,1,.5,2]);
const paint=mesh('marking',[0,0,0,4,0,0,0,0,4]);
const groups={streets:{traverse:f=>[road,peak,paint].forEach(f)}};
await settleOnto(SETTLE_RULES.at(-1));
const p=paint.geometry.getAttribute();
console.log(JSON.stringify((p.getY(0)+p.getY(1)+p.getY(2))/3));
""")
    assert result >= .5299


def test_concrete_clips_only_the_affected_paint_not_neighbouring_crossings():
    result = _paint_surface_fixture("""
const road=mesh('road',[-10,0,-10,30,0,-10,-10,0,30]);
const walk=mesh('walk',[-1,.15,-1,4,.15,-1,-1,.15,4]);
const a=mesh('crossing',[0,0,0,1,0,0,0,0,1]);
const b=mesh('crossing',[5,0,0,6,0,0,5,0,1]);
const groups={streets:{traverse:f=>[road,walk,a,b].forEach(f)}};
await settleOnto(SETTLE_RULES.at(-1));
console.log(JSON.stringify([a,b].map(m=>m.geometry.getIndex()?.count??3)));
""")
    assert result == [0, 3]


@pytest.mark.parametrize("vertices", [[[0, 0], [20, 0]], [[0, 0], [2, 0], [7, 0], [20, 0]]])
def test_dash_geometry_has_exact_lengths_independent_of_way_sampling(vertices):
    js = _page_js()
    result = run("\n".join([
        "const DASH_M=3.05,GAP_M=9.14;function xy(x,y){return [x,y];}",
        "function mitredEdges(p,w){return {left:p.map(q=>[q[0],q[1]-w/2]),right:p.map(q=>[q[0],q[1]+w/2])};}",
        "const THREE={BufferGeometry:class {setAttribute(n,a){this[n]=a;}setIndex(i){this.indices=i;}computeVertexNormals(){}},Float32BufferAttribute:class {constructor(a){this.array=a;}},Mesh:class{constructor(g){this.geometry=g;this.userData={};}},MeshStandardMaterial:class{}};",
        *[_extract(n, js) for n in ("lerpLonLat", "dashRuns", "paintedLine")],
        f"const g=paintedLine({json.dumps(vertices)},.102,0xffffff,0,{{dash:true}}).geometry;",
        "let length=0;for(let i=0;i<g.position.array.length;i+=12)length+=Math.abs(g.position.array[i+6]-g.position.array[i]);",
        "console.log(JSON.stringify({length,min:Math.min(...g.position.array.filter((v,i)=>i%3===0)),max:Math.max(...g.position.array.filter((v,i)=>i%3===0))}));",
    ]))
    assert result["length"] == pytest.approx(6.10, abs=1e-5)
    assert result["min"] == 0
    assert result["max"] == pytest.approx(15.24, abs=1e-5)
