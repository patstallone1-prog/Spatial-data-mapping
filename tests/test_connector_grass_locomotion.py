"""Actual shared kernels: probability, bounded residency, stair clearance and intake."""
import importlib.util
import json
import subprocess
from pathlib import Path

import pytest

from tests.test_corridor_geometry_rules import _extract, _page_js
from tests.test_walking_and_interiors import TestWalls as WallsFixture

ROOT = Path(__file__).resolve().parents[1]


def test_blade_height_and_colour_concentrate_at_centre_without_camera_seed():
    uri = (ROOT / "docs/grass-strands.mjs").as_uri()
    script = f"import {{grassBlade}} from {json.dumps(uri)};" + """
let height=0,hue=0,rare=0,central=0,lo=9,hi=0;
for(let i=0;i<20000;i++){const a=grassBlade(i%200,Math.floor(i/200));
height+=a.height;hue+=a.hue;lo=Math.min(lo,a.height);hi=Math.max(hi,a.height);
if(Math.abs(a.height-.10)>.055)rare++;
if(Math.abs(a.height-.10)<.025)central++;
if(JSON.stringify(a)!==JSON.stringify(grassBlade(i%200,Math.floor(i/200))))throw Error('unstable');}
console.log(JSON.stringify({height:height/20000,hue:hue/20000,rare,central,lo,hi}));
"""
    row = json.loads(subprocess.check_output(["node", "--input-type=module", "-e", script], text=True))
    assert row["height"] == pytest.approx(.10, abs=.001)
    assert row["hue"] == pytest.approx(.29, abs=.001)
    assert row["central"] > 15000 and row["rare"] < 100
    assert .02 <= row["lo"] < .07 and .13 < row["hi"] <= .18


def test_nature_lod_retains_same_tree_detail_thirty_percent_farther():
    uri = (ROOT / "docs/nature-runtime.mjs").as_uri()
    script = f"import {{plantLODWeights}} from {json.dumps(uri)};" + """
console.log(JSON.stringify([180,220,260,600,710,820].map(d=>plantLODWeights(d*1.3))));
"""
    near, mixed, middle, start, fade, far = json.loads(subprocess.check_output(
        ["node", "--input-type=module", "-e", script], text=True))
    assert near == [1, 0, 0] and middle == [0, 1, 0] and far == [0, 0, 1]
    assert mixed == pytest.approx([.5, .5, 0])
    assert start == [0, 1, 0] and fade == pytest.approx([0, .5, .5])


def test_blades_are_real_triangles_on_ground_and_clear_entire_path_envelope():
    uri = (ROOT / "docs/grass-strands.mjs").as_uri()
    script = f"import {{createGrassStrands}} from {json.dumps(uri)};" + """
class Group{constructor(){this.children=[];this.visible=true;}add(v){this.children.push(v);}remove(v){this.children=this.children.filter(x=>x!==v);}}
class Geometry{constructor(){this.attributes={};}setAttribute(k,v){this.attributes[k]=v;}setIndex(v){this.index=v;}computeVertexNormals(){}computeBoundingSphere(){}dispose(){this.disposed=true;}}
class Attribute{constructor(array,size){this.array=array;this.itemSize=size;}}
class Mesh{constructor(g,m){this.geometry=g;this.material=m;}}
class Material{dispose(){}}
class Color{setHSL(){this.r=.2;this.g=.4;this.b=.1;}}
const THREE={Group,Mesh,BufferGeometry:Geometry,Float32BufferAttribute:Attribute,MeshStandardMaterial:Material,Color};
Object.defineProperty(performance,'now',{value:()=>10000});
const parent=new Group(),grass=createGrassStrands(THREE,{parent,maxCells:1,radius:2,
 sample:(x,z)=>x>=0&&x<4&&z>=0&&z<8?{y:3}:null});
grass.update(2,2,2);
const meshes=grass.group.children,vertices=meshes.flatMap(m=>m.geometry.attributes.position.array);
let bad=0;for(let i=0;i<vertices.length;i+=3)if(vertices[i]<0||vertices[i]>=4||vertices[i+1]<3)bad++;
const triangles=meshes.reduce((n,m)=>n+m.geometry.index.length/3,0),lifted=meshes.every(m=>m.userData.liftedOntoGround);
grass.dispose();console.log(JSON.stringify({bad,triangles,lifted,remaining:parent.children.length}));
"""
    row = json.loads(subprocess.check_output(["node", "--input-type=module", "-e", script], text=True))
    assert row["bad"] == 0 and row["triangles"] > 1000 and row["lifted"]
    assert row["remaining"] == 0


def test_roots_use_drawn_triangle_plane_not_bilinear_terrain_at_retaining_edges():
    uri = (ROOT / "docs/grass-strands.mjs").as_uri()
    script = f"import {{triangleGroundSampler}} from {json.dumps(uri)};" + """
const vertices=[[0,0,0],[4,0,0],[4,4,4],[0,8,4]],ids=[0,1,2,0,2,3];
const mesh={geometry:{getAttribute:()=>({getX:i=>vertices[i][0],getY:i=>vertices[i][1],getZ:i=>vertices[i][2]}),
 getIndex:()=>({count:ids.length,getX:i=>ids[i]})}};
const at=triangleGroundSampler([mesh]);console.log(JSON.stringify([at(3,1),at(1,3),at(-1,0),at(2,2)]));
"""
    assert json.loads(subprocess.check_output(["node", "--input-type=module", "-e", script], text=True)) == [1, 5, None, 2]


def test_recessed_stairs_can_be_climbed_but_room_and_side_walls_stay_solid():
    result = WallsFixture()._run("""
const AVATAR_STAND_Y=.9;
function walkerGroundAt(x,z){return z<0?0:Math.min(1.36,(Math.floor(z/.3)+1)*.17);}
const surface=()=>0;surface.stairs=true;
entry.doors.push({edge:0,t0:.41,t1:.59,width:1.8,cx:5,cz:0,ux:1,uz:0,nx:0,nz:1,
  open:false,stoopPlan:{width:1.8,depth:3.6,steps:8},stoopSurface:surface});
avatar.position.y=.9;
const moved=moveWalker(0,7),at={...avatar.position};
console.log(JSON.stringify({moved,at,side:stairRecessClear(entry,5.8,1),
room:stairRecessClear(entry,5,4),landing:stairRecessClear(entry,5,3)}));
""", extra=("stairRecessClear",))
    assert result["moved"] > 4.5
    assert 2.8 < result["at"]["z"] <= 3.3 + 1e-9
    assert result["at"]["y"] == pytest.approx(2.26)
    assert result["landing"] and not result["side"] and not result["room"]


def test_zoom_does_not_turn_climbing_into_flying_and_flat_speed_is_unchanged():
    script = _extract("walkSurfaceSpeed", _page_js()) + """
console.log(JSON.stringify([walkSurfaceSpeed(100,{factor:.55,stairs:true}),
walkSurfaceSpeed(8.94,{factor:.6,grade:.2}),walkSurfaceSpeed(5.36,{factor:1,grade:0})]));
"""
    assert json.loads(subprocess.check_output(["node", "-e", script], text=True)) == [1.35, 2.2, 5.36]


def test_retired_world_releases_blades_and_triangle_sampler_instead_of_rebuilding_it():
    source = _page_js()
    host = _extract("releaseHostWorld", source)
    assert "grassStrands.dispose()" in host and "grassStrands=null;grassSurfaceAt=null" in host
    release = source.split("release() {", 1)[1].split("footprintGrid.clear()", 1)[0]
    assert "grassStrands.dispose()" in release and "grassSurfaceAt=null" in release


def test_connector_schedule_starts_each_envelope_before_second_job_and_before_lidar():
    spec = importlib.util.spec_from_file_location("gap_runner", ROOT / "scripts/run_gap_intake.py")
    runner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runner)
    jobs = runner.interleaved([{"name": n} for n in ["a-gap-p0-0", "a-gap-p0-1", "b-gap-p0-0"]])
    schedule = runner.schedule(jobs, ["discover", "osm", "terrain", "lidar"])
    assert [j["name"] for j in jobs] == ["a-gap-p0-0", "b-gap-p0-0", "a-gap-p0-1"]
    assert [(j["name"], s) for j, s in schedule[:4]] == [
        ("a-gap-p0-0", "discover"), ("a-gap-p0-0", "osm"),
        ("b-gap-p0-0", "discover"), ("b-gap-p0-0", "osm")]
    assert all(s in {"terrain", "lidar"} for _, s in schedule[6:])


def test_connector_registration_never_overwrites_bounds_or_existing_storage(tmp_path):
    spec = importlib.util.spec_from_file_location("gap_runner", ROOT / "scripts/run_gap_intake.py")
    runner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runner)
    registry, local, external = tmp_path / "registry.json", tmp_path / "local", tmp_path / "external"
    registry.write_text('{"regions":[]}')
    local.mkdir()
    job = {"name": "test-gap-p0-0", "bbox": [1, 2, 3, 4], "adapter": "test", "reason": "fixture"}
    runner.prepare([job], external, registry, local)
    assert (local / job["name"]).resolve() == external / job["name"]
    assert json.loads(registry.read_text())["regions"][0]["built"] is False
    with pytest.raises(ValueError, match="bounds"):
        runner.prepare([{**job, "bbox": [1, 2, 3, 5]}], external, registry, local)


def test_sparse_region_response_floor_requires_independent_matching_probe():
    from scripts.fetch_region_osm import response_floor
    box = [37.6, -122.5, 37.622, -122.47]
    caps = {"bbox": box, "osm": {"highway_ways": 469, "buildings": 1195}}
    assert response_floor(caps, box) == 1332  # The genuine 1,800-element cell is not empty.
    assert response_floor(caps, [1, 2, 3, 4]) == 2000
    assert response_floor({"bbox": box, "osm": {}}, box) == 2000
    assert response_floor({"bbox": box, "osm": {"highway_ways": 0, "buildings": 0}}, box) == 1
