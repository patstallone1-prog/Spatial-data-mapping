"""The visible bore and the walker's occupied level must agree, including at portals."""
from __future__ import annotations

import json
import subprocess

import pytest

from tests.test_corridor_geometry_rules import NODE, _extract, _page_js

pytestmark = pytest.mark.skipif(NODE is None, reason="node unavailable")


def run(body: str, *names: str):
    js = _page_js()
    script = "\n".join(_extract(name, js) for name in names) + "\n" + body
    out = subprocess.run([NODE, "--input-type=module", "-"], input=script,
                         capture_output=True, text=True, timeout=30)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


BORE = """
const TUNNEL_CROWN_M=6.4,WALKER_RADIUS_M=.3,ROAD_TOP_M=.06;
const station=(x,z=0,floor=-10)=>({s:x,x,z,floor,ground:20,cap:6.4,ux:1,uz:0,rx:0,rz:1});
const tunnelBores=[{stations:[station(0),station(50),station(100)],half:5,
  walkWidth:1,walkHeight:.3,roadOffset:.006}];
function groundLiftAt(x,z){return x<0 || x>100 ? -10.06 : 20;}
function walkerFeetY(){return -10;}
"""


def test_bore_query_selects_real_level_not_the_lowest_thing_at_same_xy():
    result = run(BORE + """
console.log(JSON.stringify({above:tunnelSurfaceAt(50,0,20),
 road:tunnelSurfaceAt(50,0,-10)?.y,walk:tunnelSurfaceAt(50,4.5,-10)?.y,
 before:tunnelSurfaceAt(-.1,0,-10),after:tunnelSurfaceAt(100.1,0,-10),
 outside:tunnelSurfaceAt(50,5.1,-10)}));
""", "tunnelSurfaceAt")
    assert result == {"above": None, "road": -9.994, "walk": -9.7,
                      "before": None, "after": None, "outside": None}


def test_tunnel_sides_are_solid_but_both_portals_remain_passable():
    result = run(BORE + """
console.log(JSON.stringify([tunnelMoveAllowed(50,4.6,50,4.8,-10),
 tunnelMoveAllowed(50,4.95,50,5.1,-10),tunnelMoveAllowed(-.1,0,.1,0,-10),
 tunnelMoveAllowed(99.9,0,100.1,0,-10),tunnelMoveAllowed(50,0,50.15,0,-10),
 tunnelMoveAllowed(50,0,50.15,0,20)]));
""", "tunnelSurfaceAt", "tunnelMoveAllowed")
    assert result == [False, False, True, True, True, True]


def test_parallel_bores_cannot_be_crossed_through_their_walls():
    result = run(BORE + """
tunnelBores.push({stations:[station(0,10.4),station(100,10.4)],half:5});
console.log(JSON.stringify(tunnelMoveAllowed(50,4.6,50,5.8,-10)));
""", "tunnelSurfaceAt", "tunnelMoveAllowed")
    assert result is False


def test_walker_keeps_surface_level_above_tunnel_and_bore_level_inside():
    result = run(BORE + """
function outsideTerrainGrid(){return false;}
console.log(JSON.stringify([walkerGroundInfo(50,0,20),walkerGroundInfo(50,0,-10)].map(v=>({y:v.y,kind:v.kind}))));
""", "tunnelSurfaceAt", "walkerGroundInfo")
    assert result == [{"y": 20, "kind": "terrain"}, {"y": -9.994, "kind": "tunnel"}]


def test_camera_cannot_orbit_under_ground_in_explore_mode():
    result = run("""
const state={explore:true},camera={position:{x:0,y:-30,z:0}};
const avatar={position:{x:0,z:0}};
function groundLiftAt(){return 12;}
console.log(JSON.stringify((constrainWorldCamera(),camera.position.y)));
""", "constrainWorldCamera")
    assert result == pytest.approx(12.35)


def test_fences_sample_hills_at_most_every_75cm_without_a_second_lift():
    result = run("""
const FENCE_GROUND_STEP_M=.75;
function groundLiftAt(x,z){return 4*Math.sin(x/2)+z*.3;}
const sink={positions:[],uvs:[],indices:[]};
groundedFencePanel(sink,0,0,20,0,.02,1.8,.6);
let step=0,error=0,topError=0;
for(let i=0;i<sink.positions.length;i+=6){
 const [x,y,z,tx,ty]=sink.positions.slice(i,i+6);
 error=Math.max(error,Math.abs(y-(groundLiftAt(x,z)+.02-.035)));
 topError=Math.max(topError,Math.abs(ty-(groundLiftAt(x,z)+.02+1.8)));
 if(i)step=Math.max(step,x-sink.positions[i-6]);
}
console.log(JSON.stringify({step,error,topError,triangles:sink.indices.length/3}));
""", "groundedFencePanel")
    assert result["step"] <= .75
    assert result["error"] < 1e-9 and result["topError"] < 1e-9
    assert result["triangles"] >= 54
    js = _page_js()
    assert "liftedOntoGround=true" in _extract("buildFences", js)
    assert "liftedOntoGround:true" in _extract("emitFence", js)
    assert "groundedFencePanel" in _extract("fenceSink", js)
    assert "groundedFencePanel" in _extract("buildCourts", js)


def test_dashed_tunnel_lines_have_exact_rectangular_ends_not_collapsed_triangles():
    result = run("""
const station=s=>({s,x:s,z:0,floor:0,ground:10,cap:Infinity,ux:1,uz:0,rx:0,rz:1});
const out=tunnelPaintStations([0,3,6,9,12,15,18,20].map(station),4,4);
console.log(JSON.stringify({breaks:out.filter(s=>s.breakBefore).map(s=>s.s),
 ends:out.filter((s,i)=>i===out.length-1 || out[i+1].breakBefore).map(s=>s.s)}));
""", "tunnelPaintStations")
    assert result == {"breaks": [0, 8, 16], "ends": [4, 12, 20]}


def test_no_tunnel_roof_can_collapse_to_a_1_5metre_high_barrier():
    js = _page_js()
    stations = _extract("tunnelStations", js)
    assert "Math.max(TUNNEL_WALL_M, headroom)" in stations
    assert "TUNNEL_WALK_H_M + 1.2" not in stations
    assert "tunnelMoveAllowed" in _extract("moveWalker", js)
    assert "constrainWorldCamera();" in _extract("placeCamera", js)
    assert "tunnelFloorAt" not in _extract("terrainGroundAt", js)


def test_immersed_portal_buildings_do_not_spawn_house_doors_or_collision():
    js = _page_js()
    index = js.split("const footprintGrid = new Map();", 1)[1].split(
        "function insideFootprint", 1)[0]
    assert "if (mappedTubePortalBuilding(way)) continue;" in index
    assert js.index("const IMMERSED_MOUTHS") < js.index("if (mappedTubePortalBuilding(way)) continue;")
    assert "belowBuildings" in _extract("moveWalker", js)
    result = run("""
const IMMERSED_MOUTHS=[[0,0]];
function xy(x,y){return [x,y];}
console.log(JSON.stringify([
 mappedTubePortalBuilding({name:'Posey Tube Alameda Portal',centroid:[1,1]}),
 mappedTubePortalBuilding({name:'Ordinary house',centroid:[1,1]}),
 mappedTubePortalBuilding({name:'Unrelated tube portal sign',centroid:[100,100]})]));
""", "mappedTubePortalBuilding")
    assert result == [True, False, False]


def test_cut_approach_under_street_deck_is_not_the_deck_and_has_side_walls():
    result = run(BORE + """
const APPROACH_CUTS=[{mx:0,mz:0,ux:-1,uz:0,half:7,reach:30,mouthZ:-10.06,farZ:-9}];
groundLiftAt=()=>20; // the cross street is on the deck, above the lower approach
function cutRoadAt(c,s){return c.mouthZ+(c.farZ-c.mouthZ)*Math.max(0,Math.min(1,s/c.reach));}
function approachRoadAt(x,z){return x<=0 && x>=-30 && Math.abs(z)<=7 ? cutRoadAt(APPROACH_CUTS[0],-x):null;}
function outsideTerrainGrid(){return false;}
console.log(JSON.stringify({entry:tunnelMoveAllowed(-.1,0,.1,0,-10),
 road:walkerGroundInfo(-2,0,-10),deck:walkerGroundInfo(-2,0,20),
 throughWall:approachMoveAllowed(-2,6.6,-2,7.1,-10),
 behindPortal:approachSurfaceAt(2,6,-10)}));
""", "tunnelSurfaceAt", "approachSurfaceAt", "approachMoveAllowed",
                 "tunnelMoveAllowed", "walkerGroundInfo")
    assert result["entry"] is True
    assert result["road"]["kind"] == "tunnel_approach"
    assert result["road"]["y"] < -9
    assert result["deck"] == {"y": 20, "kind": "terrain"}
    assert result["throughWall"] is False
    assert result["behindPortal"] is None


def test_visual_cut_only_removes_ground_inside_the_bore_not_above_or_below():
    result = run(BORE + """
const TUNNEL_WALL_M=4.2;tunnelBores[0].crown=6.4;tunnelBores[0].spring=4.2;
console.log(JSON.stringify([pointInTunnelVoid(50,-8,0),pointInTunnelVoid(50,20,0),
 pointInTunnelVoid(50,-12,0),pointInTunnelVoid(50,-8,6)]));
""", "tunnelSurfaceAt", "occupiedTunnelAt", "pointInTunnelVoid")
    assert result == [True, False, False, False]
    source = _page_js()
    clipping = _extract("installTunnelVoidCuts", source)
    assert "geometry_changed:false" in clipping
    assert "tunnelVoidInverse" in clipping
    assert "discard" in clipping
    assert "uTunnelVoidMin" in clipping and "uTunnelVoidMax" in clipping
    assert 'startsWith("tunnel")' in clipping
    assert "neutral_ground" in clipping and "tactile_warning" in clipping
    assert "installTunnelVoidCuts(groups.ground,true)" in source
    assert "installTunnelVoidCuts(groups.streets,true)" in source
    backdrop = _extract("addBackdropTile", source)
    assert "if (inTubePortalOpening" not in backdrop


def test_clipping_lookup_simplification_retains_station_accuracy_and_mesh_detail():
    result = run("""
const stations=Array.from({length:401},(_,i)=>({s:i,x:i,z:Math.sin(i/60),
 floor:-12+Math.sin(i/80)*4,cap:4.47}));
const bore={stations,half:4,crown:4.47,spring:3};
const segments=tunnelVoidSegments(bore);let error=0;
for(const {a,b} of segments)for(const p of stations.filter(p=>p.s>=a.s && p.s<=b.s)){
 const t=(p.s-a.s)/(b.s-a.s);
 error=Math.max(error,Math.hypot(p.x-a.x-(b.x-a.x)*t,p.z-a.z-(b.z-a.z)*t),
 Math.abs(p.floor-a.floor-(b.floor-a.floor)*t));
}
console.log(JSON.stringify({count:segments.length,error,original:stations.length}));
""", "tunnelVoidSegments")
    assert result["count"] < 100
    assert result["error"] <= .0040001
    assert result["original"] == 401


def test_home_floor_above_a_bore_cannot_capture_the_walker():
    result = run(BORE + """
const standingSurfaces=new Set([()=>20]);
function outsideTerrainGrid(){return false;}
console.log(JSON.stringify(walkerGroundInfo(50,0,-10).kind));
""", "tunnelSurfaceAt", "walkerGroundInfo")
    assert result == "tunnel"
    source = _page_js()
    assert "inPassage ? null : buildingAt" in _extract("updateDoors", source)
    assert "entryTunnelConflict(entry)" in _extract("buildHomeShell", source)
    assert "entryTunnelConflict(entry)" in _extract("buildInterior", source)


def test_approach_passage_exempts_the_road_but_not_retaining_wall_halo():
    result = run("""
const APPROACH_CUT_MARGIN_M=4;
function approachSurfaceAt(x,z,y){return {y:5,across:Math.abs(z),cut:{half:10}};}
console.log(JSON.stringify([Boolean(approachPassageAt(0,0,5)),
 Boolean(approachPassageAt(0,8,5)),Boolean(approachPassageAt(0,0,undefined))]));
""", "approachPassageAt")
    assert result == [True, False, False]


def test_inferred_overpass_clears_lower_street_without_disconnecting_its_ends():
    result = run("""
const base=()=>8,abutments=[[-100,0,8],[100,0,8]],controls=[{x:0,z:0,target:14}];
const lift=bridgeClearanceProfile(base,abutments,controls);
console.log(JSON.stringify({middle:lift(0,0),start:lift(-100,0),end:lift(100,0),
 near:lift(-99.999,0),basis:lift.clearanceBasis}));
""", "bridgeClearanceProfile")
    assert result["middle"] == 14
    assert result["start"] == result["end"] == 8
    assert result["near"] == pytest.approx(8, abs=.001)
    assert result["basis"] == "inferred_visual_not_measured"


def test_tunnel_has_an_outer_lining_and_base_not_only_a_two_sided_skin():
    source = _extract("addTunnel", _page_js())
    assert '"tunnel_shell"' in source
    assert "if(shell)group.add(shell)" in source and "if(shellBase)group.add(shellBase)" in source


def test_bends_have_no_uncut_segment_end_wedge_but_portals_stay_bounded():
    result = run(BORE + """
tunnelBores[0].stations=[{...station(-10),s:0},station(0),
 {...station(10,5),s:21.18,ux:2/Math.sqrt(5),uz:1/Math.sqrt(5)}];
const x=.1,z=-1;
// This point projects past the first segment but before the second. It is
// still inside the continuous bore, not a triangular terrain shard.
console.log(JSON.stringify(Boolean(tunnelSurfaceAt(x,z,-10))));
""", "tunnelSurfaceAt")
    assert result is True
    clipping = _extract("installTunnelVoidCuts", _page_js())
    assert "float t=clamp(" in clipping
    assert "vTunnelVoidLocal.xz-entry.xy" in clipping
    assert "vTunnelVoidLocal.xz-exitPlane.xy" in clipping
    assert "if(t<0.0 || t>1.0)continue" not in clipping


def test_clicks_cannot_reach_a_tunnel_floor_through_its_roof_or_wall():
    pick = _extract("groundAt", _page_js()) + _extract("groundOnRay", _page_js())
    assert "tunnelWalkMeshes(true)" in pick
    assert "h.distance<blocker-.01" in pick
    assert "if(Number.isFinite(blocker))return null;" in pick


def test_cut_heights_are_applied_after_subdivision_and_never_merged_with_plain_ground():
    result = run("""
function cutLiftAt(){return 8;}
let WAY_LIFT=cutLiftAt;
const BUILDING_VISUAL_ID=null,MERGED=new Map(),CANONICAL_MATERIALS=new Map(),IDENTITY={};
function materialKey(){return 'shared';}
const mesh=()=>({material:{},geometry:{userData:{}},updateMatrix(){},matrix:{equals(){return true;}}});
addMerged('walk',mesh(),'walk');WAY_LIFT=null;addMerged('walk',mesh(),'walk');
console.log(JSON.stringify({buckets:MERGED.size,profile:[...MERGED.values()][0].groundLift(0,0),
 plain:[...MERGED.values()][1].groundLift}));
""", "addMerged")
    assert result == {"buckets": 2, "profile": 8, "plain": None}
    lift = _extract("liftOneMesh", _page_js())
    assert lift.index("refineForTerrain") < lift.index("o.userData.groundLiftFunction(v.x, v.z)")


def test_only_unmeasured_approaches_replace_noisy_terrain_with_a_graded_visual_road():
    result = run("""
const APPROACH_CUT_INSIDE_M=6;
const APPROACH_CUTS=[{mx:0,mz:0,ux:1,uz:0,reach:40,half:7,deck:10,
 mouthZ:8,farZ:10,levelBasis:'inferred_terrain_endpoint'}];
function cutRoadAt(c,s){return c.mouthZ+(c.farZ-c.mouthZ)*Math.max(0,Math.min(1,s/c.reach));}
const road=inferredApproachLevelAt(20,0),deck=inferredApproachLevelAt(2,0,true);
APPROACH_CUTS[0].levelBasis='measured_mouth';
console.log(JSON.stringify({road,deck,measured:inferredApproachLevelAt(20,0)}));
""", "inferredApproachLevelAt")
    assert result == {"road": 9, "deck": None, "measured": None}


def test_inferred_retaining_caps_are_smooth_without_lowering_the_soil_evidence():
    result = run("""
const raw=[4,4,7,4,5,4,4],samples=raw.map((top,i)=>({top,along:i*2}));
const top=retainingTopEnvelope(samples);let grade=0;
for(let i=1;i<top.length;i++)grade=Math.max(grade,Math.abs(top[i]-top[i-1])/2);
console.log(JSON.stringify({grade,retained:top.every((v,i)=>v>=raw[i]),raw:samples.map(p=>p.top)}));
""", "retainingTopEnvelope")
    assert result["grade"] <= .1200001
    assert result["retained"] is True
    assert result["raw"] == [4, 4, 7, 4, 5, 4, 4]


def test_releasing_a_region_removes_disposed_bores_from_picking_and_collision():
    source = _page_js()
    assert "tunnelBores.length = 0;" in _extract("releaseHostWorld", source)
    guest_release = source.split("// Let go: what this world holds", 1)[1].split("</script>", 1)[0]
    assert "tunnelBores.length = 0;" in guest_release


def test_approach_underlay_cannot_climb_the_retaining_wall_at_its_outer_edge():
    result = run("""
const APPROACH_CUT_INSIDE_M=6,PROPERTY_LINE_PAVEMENT_WIDTH_M=8.6;
const APPROACH_CUTS=[{mx:0,mz:0,ux:1,uz:0,half:8.45,reach:40,
 mouthZ:5,farZ:7,levelBasis:'inferred_terrain_endpoint'}];
function terrainHeightAt(){return 12;}
function cutRoadAt(c,s){return c.mouthZ+(c.farZ-c.mouthZ)*Math.max(0,Math.min(1,s/c.reach));}
console.log(JSON.stringify([4,8.4,8.5,12,18].map(z=>cutRibbonLiftAt(20,z))));
""", "cutRibbonLiftAt")
    assert result[:2] == [6, 6]
    assert result[2] == pytest.approx(6, abs=.001)
    assert 6 < result[3] < 12
    assert result[4] == 12
    source = _page_js()
    assert "wayFollowsCut(way) ? cutRibbonLiftAt" in source
    # Occupancy and excavation retain their narrower bounds.
    assert "cut.half-radius" in _extract("approachSurfaceAt", source)


def test_late_corner_covers_share_cut_profile_but_cross_street_decks_stay_above():
    result = run("""
const APPROACH_CUT_INSIDE_M=6,PROPERTY_LINE_PAVEMENT_WIDTH_M=8.6;
const APPROACH_CUTS=[{mx:0,mz:0,ux:1,uz:0,half:8.45,reach:40,deck:5,
 mouthZ:5,farZ:7,levelBasis:'inferred_terrain_endpoint'}];
function terrainHeightAt(){return 12;}
function groundLiftAt(){return 12;}
function cutRoadAt(c,s){return c.mouthZ+(c.farZ-c.mouthZ)*Math.max(0,Math.min(1,s/c.reach));}
console.log(JSON.stringify([pavementLiftAt(20,8.4),pavementLiftAt(20,8.5),pavementLiftAt(2,0)]));
""", "cutRibbonLiftAt", "pavementLiftAt")
    assert result[0] == 6
    assert result[1] == pytest.approx(6, abs=.001)
    assert result[2] == 12


def test_discrete_gps_arrival_uses_destination_surface_not_departure_bore_height():
    result = run("""
const GPS_LEASH={on:false},AVATAR_STAND_Y=1;
const gps={target:{x:50,z:0,set(x,y,z){this.x=x;this.z=z;}},follow:false};
const state={target:{copy(){}},indoors:false};
const avatar={position:{y:-9,set(x,y,z){this.y=y;}}};
function walkerExteriorAt(x,z){return {x,z};}
function groundLiftAt(){return 20;}
function walkerGroundAt(x,z,referenceY){return referenceY===20 ? 20 : -10;}
function placeCamera(){}
returnToGps();console.log(JSON.stringify({feet:avatar.position.y-AVATAR_STAND_Y,follow:gps.follow}));
""", "returnToGps")
    assert result == {"feet": 20, "follow": True}
    source = _page_js()
    for name in ("startGps", "returnToGps", "followGps"):
        assert "groundLiftAt(gps.target.x,gps.target.z)" in _extract(name, source)


def test_attached_region_preserves_occupied_level_and_surface_kind_in_host_frame():
    result = run("""
let received;
const guest={oy:100,api:{walkerGroundInfo(x,z,y){received=[x,z,y];return {y:12,kind:'tunnel'};}}};
function guestUnder(){return guest;}
function hostToGuest(g,x,z){return [x-200,z-300];}
console.log(JSON.stringify({info:walkerGroundInfo(205,307,112),received}));
""", "walkerGroundInfo")
    assert result == {"info": {"y": 112, "kind": "tunnel"}, "received": [5, 7, 12]}
