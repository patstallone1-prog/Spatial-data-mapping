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


def test_house_only_publications_are_part_of_the_installed_app_release():
    manifest = ROOT / "docs/sf-corridor-frontage-fits.manifest.json"
    released = json.loads((ROOT / "docs/runtime-release.json").read_text())["photo_derived_houses"]
    assert released["count"] == json.loads(manifest.read_text())["houses"]
    assert released["manifest_sha256"] == hashlib.sha256(manifest.read_bytes()).hexdigest()


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


def test_street_and_corner_names_follow_the_destination_owner():
    js = _page_js()
    result = run("""
      const g={api:{streetNameAt:(x,z)=>({x,z,name:'Destination Street'}),
        crossStreetsAt:(x,z,name)=>({x,z,name,at:'Destination Corner'})}};
      function guestUnder(){return g;}
      function hostToGuest(g,x,z){return [(x-10000)/2,z-20000];}
    """ + _extract("streetNameAt", js) + _extract("crossStreetsAt", js) + """
      console.log(JSON.stringify({street:streetNameAt(10050,20040),
        corner:crossStreetsAt(10050,20040,'Destination Street')}));
    """)
    assert result["street"] == {"x": 25, "z": 40, "name": "Destination Street"}
    assert result["corner"] == {"x": 25, "z": 40, "name": "Destination Street",
                                "at": "Destination Corner"}


def test_global_search_keeps_addresses_in_later_detail_windows():
    js = _page_js()
    result = run("""
      const elsewhere={loading:null},location={href:'https://city.test/app-model.html'},field={value:''};
      const document={querySelector:()=>({content:'app-regions.json'})};
      function tileOwnGround(){throw Error('moving ownership must not remove search results');}
      const fetch=async()=>({ok:true,json:async()=>({regions:[{title:'SF'}],
        addresses:[['Initial House',-122.42,37.8,0],['1330 Union Street',-122.4213,37.799129,0]]})});
    """ + _extract("searchEntryKey", js) + """
      const localSearchKeys=new Set([searchEntryKey('Initial House',-122.42,37.8)]);
    """ + _extract("loadElsewhere", js) + """
      await loadElsewhere();console.log(JSON.stringify(elsewhere.addresses));
    """)
    assert len(result) == 1 and result[0]["label"] == "1330 Union Street · SF"


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
    result = run("const BOX_SET_MAX=12;let boxClipCount=0;\n" + function + r"""
      let called=0;const uniform={value:[0,0,10,10]},houses={value:[1,1,2,2]},material={userData:{},
        onBeforeCompile(s){s.uniforms.original=true;called++;},customProgramCacheKey(){return 'original';}};
      const object={traverse:fn=>fn({material})};
      applyBoxClip(object,uniform,true);applyBoxClip(object,uniform,true);applyBoxClip(object,houses);
      const shader={uniforms:{},vertexShader:'#include <common>\n#include <project_vertex>',
        fragmentShader:'#include <common>\nvoid main() {'};
      material.onBeforeCompile(shader);uniform.value=[20,20,30,30];
      console.log(JSON.stringify({called,original:shader.uniforms.original,
        bounds:shader.uniforms.uDetailBoxes1.value,houses:shader.uniforms.uDetailBoxes2.value,fragment:shader.fragmentShader,
        instancing:shader.vertexShader.includes('instanceMatrix*detailPosition')}));
    """)
    assert result["called"] == 1 and result["original"] and result["instancing"]
    assert result["bounds"] == [20, 20, 30, 30] and result["houses"] == [1, 1, 2, 2]
    # Two clips on one material: each its own box set, one shared varying, both tests applied.
    fragment = result["fragment"]
    assert "if(inDetail) discard" in fragment and "if(!inDetail) discard" in fragment
    assert fragment.count("varying vec3 vDetailWorld;") == 1
    assert "uniform vec4 uDetailBoxes1[12];" in fragment and "uniform vec4 uDetailBoxes2[12];" in fragment


def test_scheduler_state_exists_before_first_animation_frame():
    js = _page_js()
    assert js.index("let attaching = null") < js.index("function animate(now)")
    assert "invalidateTilesTouching([previousBox,TILE_OWN_BOX])" not in js


def test_ground_shader_cache_cannot_reuse_another_windows_baked_mask_coordinates():
    result = run("""
      const THREE={DoubleSide:2,MeshStandardMaterial:class{constructor(p){Object.assign(this,p);}}};
    """ + _extract("maskedGrassMaterial", _page_js()) + """
      const a={west:0,east:800,south:0,north:800},b={...a,west:1000,east:1800};
      console.log(JSON.stringify([maskedGrassMaterial(null,a,1).customProgramCacheKey(),
        maskedGrassMaterial(null,b,1).customProgramCacheKey(),
        maskedGrassMaterial(null,{...a},1).customProgramCacheKey()]));
    """)
    assert result[0] != result[1] and result[0] == result[2]


def test_streaming_cannot_start_before_ui_and_guest_exports_exist():
    js = _page_js()
    result = run("const ATTACH=null,regionStreamingReady=false;"
                 + _extract("checkDetailExpansion", js)
                 + "checkDetailExpansion(1000);console.log(JSON.stringify({safe:true}));")
    assert result["safe"]
    assert js.rindex("regionStreamingReady = true") > js.index("window.kerbsideGuestApi =")


def test_a_fast_focus_asks_sooner_and_further_ahead():
    result = run("""
      import {detailRequest} from './docs/world-streaming.mjs';
      const metres=[1,1],region=[-5000,-5000,5000,5000],box=[-400,-400,400,400];
      const roomy={radius:400,arrival:220,keep:310,lead:200};
      console.log(JSON.stringify([
        detailRequest(box,400,[50,0],metres,[49,0],region,{...roomy,speed:1.4,buildSeconds:7}),
        detailRequest(box,400,[60,0],metres,[35,0],region,{...roomy,speed:25,buildSeconds:7}),
        detailRequest(box,400,[100,0],metres,[98,0],region,{...roomy,speed:1.4,buildSeconds:7}),
        detailRequest(box,400,[0,0],metres,null,region,{...roomy,speed:0})]));
    """)
    walking, driving, walked_on, standing = result
    # A walker 50 m in is not rebuilt round; a car going 25 m/s, 60 m in, is: it covers 225 m
    # while the next square builds, so that is asked for 225 m ahead of it.
    assert walking is None
    assert driving == {"lon": 285, "lat": 0, "radius": 400}
    # Past the keep line a walker's next square is the ordinary lead ahead.
    assert walked_on == {"lon": 300, "lat": 0, "radius": 400}
    assert standing is None
