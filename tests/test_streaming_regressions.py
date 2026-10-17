"""Exercise real window/query code for the returning-app regressions, not copies."""
import hashlib
import json
import subprocess

import pytest

from tests.test_corridor_geometry_rules import ROOT, _extract, _page_js
from tests.test_light_build import _cells


def run(code):
    result = subprocess.run(["node", "--input-type=module", "-e", code], cwd=ROOT,
                            capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def test_window_includes_crossing_lines_and_enclosing_parcels():
    result = run(_extract("makeWindow", _page_js()) + """
      const w=makeWindow({box:[0,0,1,1]});
      console.log(JSON.stringify([
        w.near([[-2,.5],[3,.5]]),w.near([[-2,-2],[-2,3],[3,3],[3,-2],[-2,-2]]),
        w.near([[2,2],[3,3]]),w.near({points:[[-2,.5],[3,.5]],centroid:[5,5]})]));
    """)
    assert result == [True, True, False, True]


def test_cell_index_keeps_the_middle_of_long_features(tmp_path):
    module = _cells()
    road = {"kind": "street", "points": [[0, .01], [.03, .01]]}
    parcel = {"kind": "park", "points": [[0, 0], [0, .03], [.03, .03], [.03, 0], [0, 0]]}
    doc = {"ways": [road, parcel] + [{"points": [[.001*i/60, .001]]} for i in range(60)]}
    source = tmp_path / "world.json"
    source.write_text(json.dumps(doc))
    module.cut(source)
    folder = tmp_path / "cells/world"
    manifest = json.loads((folder / "manifest.json").read_text())
    assert manifest["source_sha256"] and manifest["indexing"] == "feature-bounds-v2"
    key = f"{int(.015 // manifest['cell'][0])}_{int(.01 // manifest['cell'][1])}"
    rows = json.loads((folder / f"{key}.json").read_text())["ways"]
    assert {i for i, _ in rows} >= {0, 1}


def test_committed_cell_indexes_match_their_current_sources():
    module = _cells()
    manifests = list((ROOT / "docs").rglob("cells/*/manifest.json"))
    assert len(manifests) >= 29
    for path in manifests:
        manifest = json.loads(path.read_text())
        source = path.parents[2] / manifest["source"]
        assert manifest["indexing"] == "feature-bounds-v2", path
        assert manifest["source_sha256"] == hashlib.sha256(source.read_bytes()).hexdigest(), path
    assert module.CELL_M == 500


def test_generated_viewers_pin_the_matching_streaming_module():
    digest = hashlib.sha256((ROOT / "docs/world-streaming.mjs").read_bytes()).hexdigest()[:16]
    pages = [ROOT / "docs/app-model.html", *(ROOT / "docs/app-regions").glob("*/app-model.html")]
    assert len(pages) == 8
    for page in pages:
        assert f'world-streaming.mjs?rev={digest}' in page.read_text(), page


def test_roof_and_facade_picking_is_not_dependent_on_render_mesh_visibility():
    result = run("""
      import {rayPrism} from './docs/world-streaming.mjs';
      const ring=[[0,0],[10,0],[10,10],[0,10],[0,0]];
      console.log(JSON.stringify([
        rayPrism([5,100,5],[0,-1,0],ring,40,50),
        rayPrism([-5,45,5],[1,0,0],ring,40,50),
        rayPrism([-5,55,5],[1,0,0],ring,40,50),
        rayPrism([15,100,5],[0,-1,0],ring,40,50)]));
    """)
    assert result == [50, 5, None, None]


@pytest.mark.parametrize("force", [False, True])
def test_teleport_uses_clicked_guests_streets_not_startup_intersection(force):
    js = _page_js()
    result = run("""
      class Vector3 {constructor(x,y,z){Object.assign(this,{x,y,z});}}
      const THREE={Vector3},hostWorldActive=false;
      const g={ox:10000,oz:20000,oy:-8,sx:2,api:{eligibleLanding(p,force){
        if(p.x!==25 || p.z!==40 || p.y!==11)throw Error('wrong local frame');
        return {x:26,y:12,z:41};}}};
      function guestUnder(){return g;}
      function hostToGuest(g,x,z){return [(x-g.ox)/g.sx,z-g.oz];}
      function buildingAt(){throw Error('stale host lookup');}
      const streetLandingSegments=[[0,0,10,0]];
    """ + _extract("eligibleLanding", js) + f"""
      console.log(JSON.stringify(eligibleLanding({{x:10050,y:3,z:20040}}, {str(force).lower()})));
    """)
    assert result == {"x": 10052, "y": 4, "z": 20041}


def test_distant_unloaded_click_never_snaps_back_to_initial_streets():
    result = run("""
      const hostWorldActive=false,midLon=0,midLat=0,metersPerLon=100,metersPerLat=100;
      function guestUnder(){return null;}
      function buildingAt(){throw Error('stale building');}
      const streetLandingSegments=[[0,0,10,0]];
    """ + _extract("eligibleLanding", _page_js()) + """
      console.log(JSON.stringify(eligibleLanding({x:20000,y:30,z:40000},true)));
    """)
    assert result == {"x": 20000, "y": 30, "z": 40000}


def test_proactive_growth_lead_and_true_region_edges_do_not_thrash():
    result = run("""
      import {detailRequest} from './docs/world-streaming.mjs';
      const metres=[1,1],region=[-5000,-5000,5000,5000];
      console.log(JSON.stringify([
        detailRequest([-220,-220,220,220],220,[0,0],metres,null,region),
        detailRequest([-650,-650,650,650],650,[0,0],metres,null,region),
        detailRequest([-650,-650,650,650],650,[380,0],metres,[370,0],region),
        detailRequest([0,0,650,650],650,[10,10],metres,null,[0,0,5000,5000]),
        detailRequest([0,0,100,100],220,[10,10],metres,null,[0,0,100,100]),
        detailRequest([-650,-650,650,650],650,[3000,0],metres,null,region)]));
    """)
    assert result == [{"lon": 0, "lat": 0, "radius": 350}, None,
                      {"lon": 540, "lat": 0, "radius": 350}, None, None,
                      {"lon": 3000, "lat": 0, "radius": 220}]


def test_transient_cell_failure_cannot_fall_back_to_whole_city():
    function = "async " + _extract("fetchWindowed", _page_js())
    result = run("""
      const LIGHT_SPEC={box:[0,0,1,1],lon:.5,lat:.5},ATTACH=null,location={href:'https://city.test/'};
      let full=0;const worldCellCache={load:async()=>{throw Error('cell HTTP 503: manifest.json');}};
    """ + function + """
      let failed=false;try{await fetchWindowed('city.json',()=>{full++;return {};});}catch{failed=true;}
      console.log(JSON.stringify({failed,full}));
    """)
    assert result == {"failed": True, "full": 0}


def test_transient_503_retries_but_missing_cells_do_not_spin():
    result = run("""
      import {CellCache} from './docs/world-streaming.mjs';
      let attempts=0,missing=0;
      const cache=new CellCache({fetcher:async url=>{
        if(url==='missing'){missing++;return {ok:false,status:404};}
        attempts++;return attempts===1?{ok:false,status:503}:{ok:true,text:async()=>'{"ready":true}'};
      }});
      const good=await cache.load('good');try{await cache.load('missing');}catch{}
      console.log(JSON.stringify({good,attempts,missing,...cache.snapshot()}));
    """)
    assert result["good"]["ready"] and result["attempts"] == 2
    assert result["missing"] == 1 and result["failed"] == 1


def test_exact_shader_ownership_is_dynamic_and_preserves_existing_shader_hooks():
    js = _page_js()
    function = "function applyBoxClip" + js.split("function applyBoxClip", 1)[1].split("\nfunction clipDetailWorld", 1)[0]
    result = run(function + r"""
      let called=0;const uniform={value:[0,0,10,10]},material={userData:{},
        onBeforeCompile(s){s.uniforms.original=true;called++;},customProgramCacheKey(){return 'original';}};
      const object={traverse:fn=>fn({material})};
      applyBoxClip(object,uniform,true);applyBoxClip(object,uniform,true);
      const shader={uniforms:{},vertexShader:'#include <common>\n#include <project_vertex>',
        fragmentShader:'#include <common>\nvoid main() {'};
      material.onBeforeCompile(shader);uniform.value=[20,20,30,30];
      console.log(JSON.stringify({called,original:shader.uniforms.original,
        bounds:shader.uniforms.uDetailBounds.value,fragment:shader.fragmentShader,
        instancing:shader.vertexShader.includes('instanceMatrix*detailPosition')}));
    """)
    assert result["called"] == 1 and result["original"] and result["instancing"]
    assert result["bounds"] == [20, 20, 30, 30]
    assert "if(inDetail) discard" in result["fragment"]


def test_scheduler_state_exists_before_first_animation_frame():
    js = _page_js()
    assert js.index("let attaching = null") < js.index("function animate(now)")
    assert "invalidateTilesTouching([previousBox,TILE_OWN_BOX])" not in js


def test_streaming_cannot_start_before_ui_and_guest_exports_exist():
    js = _page_js()
    result = run("const ATTACH=null,regionStreamingReady=false;"
                 + _extract("checkDetailExpansion", js)
                 + "checkDetailExpansion(1000);console.log(JSON.stringify({safe:true}));")
    assert result["safe"]
    assert js.rindex("regionStreamingReady = true") > js.index("window.kerbsideGuestApi =")
