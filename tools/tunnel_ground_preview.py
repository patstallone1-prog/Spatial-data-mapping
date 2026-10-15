"""Real-data, full-resolution tunnel fixtures with visible audit results and view controls.

Serve the repo root. This never edits source worlds or release assets.
"""
from __future__ import annotations

import argparse
import json
import math
import runpy
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

AUDIT = r'''
{
const audit={bores:[],fences:{samples:0,maxBaseError:0},finite:true};
audit.bridges=[...new Set(BRIDGE_LIFTS.values())].filter(l=>l.clearanceControls?.length).map(l=>({
 basis:l.clearanceBasis,controls:l.clearanceControls.length,minClearance:Math.min(...l.clearanceControls.map(c=>
 l(c.x,c.z)-REGION_DECK_DEPTH_M-groundLiftAt(c.x,c.z)))}));
const probeRay=new THREE.Raycaster();scene.updateMatrixWorld(true);
audit.cuts=APPROACH_CUTS.map(({mx,mz,ux,uz,half,reach,deck,levelBasis})=>({mx,mz,ux,uz,half,reach,deck,levelBasis}));
audit.sidewalkSlopes=[];
groups.streets.traverse(o=>{
 if(!o.isMesh || !['walk','walk_narrow','walk_underlay','kerb'].includes(o.userData.surface))return;
 const p=o.geometry.getAttribute('position'),idx=o.geometry.index,n=idx?.count||p.count;
 for(let i=0;i<n;i+=3){
  const a=[0,1,2].map(j=>{const k=idx?idx.getX(i+j):i+j;return [p.getX(k),p.getY(k),p.getZ(k)];});
  const x=a.reduce((v,p)=>v+p[0],0)/3,z=a.reduce((v,p)=>v+p[2],0)/3;
  const c=APPROACH_CUTS.find(c=>{const dx=x-c.mx,dz=z-c.mz,along=dx*c.ux+dz*c.uz;
   return along>=0&&along<=c.reach&&Math.abs(dx*c.uz-dz*c.ux)<=c.half+10;});
  if(!c)continue;const u=a[1].map((v,j)=>v-a[0][j]),v=a[2].map((v,j)=>v-a[0][j]);
  const ny=u[2]*v[0]-u[0]*v[2],nx=u[1]*v[2]-u[2]*v[1],nz=u[0]*v[1]-u[1]*v[0];
  if(Math.hypot(nx,nz)>Math.abs(ny)*1.5&&Math.max(...a.map(p=>p[1]))>cutRoadAt(c,(x-c.mx)*c.ux+(z-c.mz)*c.uz)+.5)
   audit.sidewalkSlopes.push({surface:o.userData.surface,profile:o.userData.groundLiftFunction?.groundLiftKey||'default',points:a});
 }
});
audit.sidewalkSlopes=audit.sidewalkSlopes.slice(0,60);
// Unclipped opaque surface fragments must not occupy the pedestrian's headroom.
// This catches parcel slabs even when the floor below them is itself valid.
audit.intrudingFragments=[];
for(const group of [groups.ground,groups.streets,groups.mapped3d])group.traverse(o=>{
 if(!o.isMesh || o.isInstancedMesh || !o.geometry || o.userData.tunnelVoidCut
     || String(o.userData.surface||'').startsWith('tunnel'))return;
 const p=o.geometry.getAttribute('position'),idx=o.geometry.index;if(!p)return;
 o.geometry.computeBoundingBox();const box=o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
 if(!tunnelBores.some(b=>b.stations.some(s=>s.x>=box.min.x-b.half&&s.x<=box.max.x+b.half
    &&s.z>=box.min.z-b.half&&s.z<=box.max.z+b.half&&box.max.y>s.floor+.15&&box.min.y<s.floor+2.3)))return;
 const v=new THREE.Vector3(),n=idx?.count||p.count;
 for(let i=0;i<n;i+=3){
  const xyz=[0,1,2].map(j=>{const k=idx?idx.getX(i+j):i+j;
   return v.fromBufferAttribute(p,k).applyMatrix4(o.matrixWorld).toArray();});
  const q=xyz[0].map((_,j)=>(xyz[0][j]+xyz[1][j]+xyz[2][j])/3);
  const at=tunnelSurfaceAt(q[0],q[2],null);
  if(at&&q[1]>at.floor+.15&&q[1]<at.floor+2.3&&at.distance<at.bore.half-1.1){
   audit.intrudingFragments.push({surface:o.userData.surface,point:q});break;
  }
 }
});
for(const bore of tunnelBores){
 const row={id:bore.wayId,stations:bore.stations.length,length:bore.stations.at(-1).s,
 floorMisses:0,ceilingMisses:0,wallEscapes:0,aboveIncorrect:0,portalTransitions:[],minClearance:Infinity};
 for(const st of bore.stations.filter((st,i)=>i>0 && i<bore.stations.length-1 && i%3===0)){
  const info=tunnelSurfaceAt(st.x,st.z,st.floor);
  if(!info || Math.abs(info.floor-st.floor)>.03)row.floorMisses++;
  const ground=groundLiftAt(st.x,st.z);
  if(ground>st.floor+2 && walkerGroundInfo(st.x,st.z,ground).kind==='tunnel')row.aboveIncorrect++;
  const z=st.z+st.rz*(bore.half-.1),x=st.x+st.rx*(bore.half-.1);
  if(tunnelMoveAllowed(x,z,x+st.rx*.3,z+st.rz*.3,st.floor))row.wallEscapes++;
  row.minClearance=Math.min(row.minClearance,Math.min(st.cap,bore.crown));
  probeRay.set(new THREE.Vector3(st.x,st.floor+.8,st.z),new THREE.Vector3(0,-1,0));probeRay.far=1.5;
  if(!probeRay.intersectObjects(bore.group.children.filter(o=>['tunnel_floor','tunnel_road'].includes(o.userData.surface)),false).length)row.floorMisses++;
  probeRay.set(new THREE.Vector3(st.x,st.floor+1,st.z),new THREE.Vector3(0,1,0));probeRay.far=8;
  if(!probeRay.intersectObjects(bore.group.children.filter(o=>o.userData.surface==='tunnel'),false).length)row.ceilingMisses++;
 }
 for(const [st,sign] of [[bore.stations[0],-1],[bore.stations.at(-1),1]]) {
  const ax=st.x+st.ux*sign*.1,az=st.z+st.uz*sign*.1,
    bx=st.x-st.ux*sign*.1,bz=st.z-st.uz*sign*.1;
  row.portalTransitions.push({pass:tunnelMoveAllowed(ax,az,bx,bz,st.floor),
    gap:(approachRoadAt(ax,az) ?? groundLiftAt(ax,az))+ROAD_TOP_M-st.floor,
    surfaceAboveGap:groundLiftAt(ax,az)+ROAD_TOP_M-st.floor});
 }
 audit.bores.push(row);
}
groups.ground.traverse(o=>{
 if(!o.isMesh || !o.userData.elevationBasis || !o.geometry)return;
 const p=o.geometry.getAttribute('position');
 for(let i=0;i<p.count;i+=2){
  const x=p.getX(i),z=p.getZ(i),y=p.getY(i),surface=o.userData.surface;
  const base=surface==='fence:court' ? COURT_Y : surface.startsWith('fence:') ? YARD_Y : PLAYGROUND_Y;
  audit.fences.samples++;audit.fences.maxBaseError=Math.max(audit.fences.maxBaseError,
    Math.abs(y-(groundLiftAt(x,z)+base-.035)));
 }
});
groups.streets.traverse(o=>{
 if(!o.isMesh || !o.userData.surface?.startsWith('tunnel') || !o.geometry)return;
 const p=o.geometry.getAttribute('position');for(let i=0;i<p.array.length;i++)if(!Number.isFinite(p.array[i]))audit.finite=false;
});
const data=document.createElement('script');data.type='application/json';data.id='tunnel-safety-audit';
data.textContent=JSON.stringify(audit);document.body.append(data);
const panel=document.createElement('div');panel.style.cssText='position:fixed;left:10px;bottom:10px;z-index:1000;background:#fff;color:#222;padding:10px;font:12px sans-serif;max-width:520px';
const title=document.createElement('div');title.textContent='Tunnel verification — '+JSON.stringify(audit.bores.map(b=>({id:b.id,floors:b.floorMisses,ceiling:b.ceilingMisses,walls:b.wallEscapes,portals:b.portalTransitions.map(p=>p.pass)})));panel.append(title);
const selected=tunnelBores.find(b=>String(b.wayId)==='__TUNNEL_ID__') || tunnelBores[0];
function viewAt(fraction,first=true){
 if(!selected)return;const st=selected.stations[Math.round((selected.stations.length-1)*fraction)];
 if(state.explore)setExplore(false);
 goTo({x:st.x,z:st.z,y:st.floor},{travel:true,zoom:true});
 state.yaw=Math.atan2(-st.ux,-st.uz);state.look=0;state.dist=8;state.pitch=.25;
 setFirstPerson(first);placeCamera();
 renderer.render(scene,camera); // explicit audit frame, even when this tab is backgrounded
}
for(const [name,fraction,first] of [['Entrance',.01,true],['Middle',.5,true],['Exit',.99,true],['Third person',.5,false]]){
 const button=document.createElement('button');button.textContent=name;button.onclick=()=>viewAt(fraction,first);panel.append(button);
}
document.body.append(panel);viewAt(__FRACTION__,true);
const fenceView=document.createElement('button');fenceView.textContent='Inspect hilly fence';panel.append(fenceView);
fenceView.onclick=()=>{
 let best=null;
 groups.ground.traverse(o=>{
  if(!o.isMesh || !o.userData.elevationBasis)return;const p=o.geometry.getAttribute('position');
  for(let i=0;i+3<p.count;i+=2){
   const dx=p.getX(i+2)-p.getX(i),dz=p.getZ(i+2)-p.getZ(i),len=Math.hypot(dx,dz);
   const rise=Math.abs(p.getY(i+2)-p.getY(i));if(len<.1 || rise>.25 || rise<(best?.rise||.01))continue;
   const x=(p.getX(i)+p.getX(i+2))/2,z=(p.getZ(i)+p.getZ(i+2))/2;
   for(const side of [-1,1]){
    const nx=dz/len*side,nz=-dx/len*side;
    if([1,2,3,4,5,6].some(d=>buildingAt(x+nx*d,z+nz*d)))continue;
    const roofRay=new THREE.Raycaster(new THREE.Vector3(x+nx*3,4000,z+nz*3),new THREE.Vector3(0,-1,0));
    const roof=roofRay.intersectObjects(groups.mapped3d.children,true)[0];
    if(roof && roof.point.y>groundLiftAt(x+nx*3,z+nz*3)+.8)continue;
    best={x,z,nx,nz,rise};
   }
  }
 });
 if(!best)return;const {x,z,nx,nz}=best;
 // Inspect from an orbit above the public-facing side, rather than letting a
 // valid exterior-landing nudge put the camera behind a nearby building wall.
 setFirstPerson(false);setExplore(true);state.autoFirstPerson=false;
 state.target.set(x,groundLiftAt(x,z)+.7,z);state.yaw=Math.atan2(nx,nz);state.dist=6;state.pitch=.65;state.look=0;
 placeCamera();renderer.render(scene,camera);
};
const capture=document.createElement('button');capture.textContent='Capture current frame';panel.append(capture);
capture.onclick=()=>{renderer.render(scene,camera);const img=document.createElement('img');img.id='tunnel-frame';
 img.src=renderer.domElement.toDataURL();img.style.cssText='position:fixed;inset:0;width:100%;height:100%;z-index:900;pointer-events:none';
 document.getElementById('tunnel-frame')?.remove();document.body.append(img);};
for(const [label,group] of [['Toggle ground covers',groups.ground],['Toggle distant tiles',tileGroupRoot],['Toggle buildings',groups.mapped3d]]){
 const b=document.createElement('button');b.textContent=label;b.onclick=()=>{
  group.visible=!group.visible;b.textContent=label+': '+group.visible;renderer.render(scene,camera);
 };panel.append(b);
}
const isolate=document.createElement('button');isolate.textContent='Toggle portal geometry';panel.append(isolate);
isolate.onclick=()=>{groups.streets.traverse(o=>{if(o.userData.surface==='tunnel_portal')o.visible=!o.visible;});renderer.render(scene,camera);};
const walks=document.createElement('button');walks.textContent='Toggle sidewalk geometry';panel.append(walks);
walks.onclick=()=>{groups.streets.traverse(o=>{if(['walk','walk_narrow','walk_underlay','kerb'].includes(o.userData.surface))o.visible=!o.visible;});renderer.render(scene,camera);};
const status=document.createElement('pre');status.id='tunnel-walker-status';panel.append(status);
setInterval(()=>{const feet=walkerFeetY(),p=avatar.position,info=walkerGroundInfo(p.x,p.z,feet);
 status.textContent=JSON.stringify({x:p.x,z:p.z,feet,kind:info.kind,ground:info.y,
  covers:groups.ground.visible,tiles:tileGroupRoot.visible});},250);
const route=document.createElement('button');route.textContent='Walk every bore';panel.append(route);
route.onclick=()=>{
 const results=[];
 for(const bore of tunnelBores)for(const direction of [1,-1]){
  const stations=direction===1 ? bore.stations : [...bore.stations].reverse();
  const first=stations[0],last=stations.at(-1),targets=[...stations,
   {x:last.x+last.ux*direction*2,z:last.z+last.uz*direction*2}];
  goTo({x:first.x-first.ux*direction*.2,z:first.z-first.uz*direction*.2,y:first.floor},{travel:true,zoom:true});
  let failures=0,maxGap=0,firstFailure=null;
  for(const st of targets){
   moveWalker(st.x-avatar.position.x,st.z-avatar.position.z);
   const gap=Math.hypot(st.x-avatar.position.x,st.z-avatar.position.z);
   if(gap>.1){failures++;firstFailure ??= {s:st.s,target:[st.x,st.z],
    actual:[avatar.position.x,avatar.position.z],feet:walkerFeetY()};}maxGap=Math.max(maxGap,gap);
   if(failures>3)break;
  }
  results.push({id:bore.wayId,direction,failures,maxGap,feet:walkerFeetY(),firstFailure});
 }
 const out=document.createElement('pre');out.id='tunnel-route-audit';out.textContent=JSON.stringify(results);panel.append(out);
};
const trace=document.createElement('button');trace.textContent='Inspect obstruction';panel.append(trace);
trace.onclick=()=>{
 scene.updateMatrixWorld(true);const ray=new THREE.Raycaster();
 const hits=[[.07,-.12],[0,-.025],[0,.05],[-.7,-.05],[.8,-.12],[-.875,-.03],[-.765,.025],[-.51,-.02]].map(aim=>{ray.setFromCamera(new THREE.Vector2(...aim),camera);
 return {aim,hits:ray.intersectObjects(scene.children,true).filter(h=>{
  for(let o=h.object;o;o=o.parent)if(!o.visible)return false;
  return true;
 }).slice(0,8).map(h=>({
  distance:h.distance,point:h.point.toArray(),data:h.object.userData,name:h.object.name,
  parent:h.object.parent?.userData,material:Array.isArray(h.object.material)?'multi':h.object.material?.color?.getHexString(),
  face:h.faceIndex,materialIndex:h.face?.materialIndex,
  depthTest:h.object.material?.depthTest,depthWrite:h.object.material?.depthWrite,order:h.object.renderOrder,
  wouldClip:Boolean(h.object.userData.tunnelVoidCut && pointInTunnelVoid(h.point.x,h.point.y,h.point.z)),
  ground:groundLiftAt(h.point.x,h.point.z),cut:approachRoadAt(h.point.x,h.point.z),
  doors:[...footprintById.values()].flatMap(e=>(e.doors||[]).filter(d=>Math.hypot(d.cx-h.point.x,d.cz-h.point.z)<3)
    .map(d=>({id:e.way.osm_id,name:e.way.name,x:d.cx,z:d.cz,ground:d.ground}))) }))};});
 const output=document.createElement('pre');output.id='tunnel-obstruction';output.style.maxHeight='150px';output.style.overflow='auto';
 output.textContent=JSON.stringify(hits);panel.append(output);
};
console.info('tunnel-safety-audit '+JSON.stringify(audit));
}
'''


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--region", default="sf-corridor")
    parser.add_argument("--id", type=int, required=True)
    parser.add_argument("--fraction", type=float, default=.01)
    args = parser.parse_args()
    path = ROOT / ("docs/sf-corridor-3d.json" if args.region == "sf-corridor"
                   else f"docs/app-regions/{args.region}/sf-corridor-3d.json")
    if not path.exists():
        path = ROOT / f"docs/regions/{args.region}/sf-corridor-3d.json"
    world = json.loads(path.read_text())
    tunnel = next(w for w in world["ways"] if w.get("osm_id") == args.id)
    points = tunnel["points"]
    lon = (min(p[0] for p in points) + max(p[0] for p in points)) / 2
    lat = (min(p[1] for p in points) + max(p[1] for p in points)) / 2
    # Both portal neighbourhoods must be present: an entrance-only fixture can
    # falsely show empty grass at the other end of a kilometre-long tube.
    radius = 130 + max(max(abs(p[0]-lon)*111320*math.cos(math.radians(lat))
                          for p in points), max(abs(p[1]-lat)*111320 for p in points))
    module = runpy.run_path(str(ROOT / "tools/road_paint_preview.py"))
    module["main"].__globals__["DIAGNOSTIC"] = AUDIT.replace(
        "__TUNNEL_ID__", str(args.id)).replace("__FRACTION__", str(args.fraction))
    sys.argv = ["road_paint_preview", "--region", args.region, "--name", f"tunnel-{args.id}",
                "--lon", str(lon), "--lat", str(lat), "--radius", str(radius)]
    module["main"]()
    # Polygon rings are georeferenced, but legacy fence panels are flat metres
    # in the full region's frame. Recentring a fixture without this transform
    # placed every SF fence in unrelated hills and invalidated the visual check.
    out = ROOT / "build" / "road-paint-preview" / f"tunnel-{args.id}" / "preview-ground.json"
    ground = json.loads(out.read_text())
    bbox = world["bbox"]
    old_lon = (bbox["west"] + bbox["east"]) / 2
    old_lat = (bbox["south"] + bbox["north"]) / 2
    old_scale = 111320 * math.cos(math.radians(old_lat))
    new_scale = 111320 * math.cos(math.radians(lat))
    fences = {}
    for kind, panels in ground.get("fences", {}).items():
        kept = []
        for i in range(0, len(panels)-3, 4):
            ax, ay, bx, by = panels[i:i+4]
            ax, bx = (old_lon+ax/old_scale-lon)*new_scale, (old_lon+bx/old_scale-lon)*new_scale
            ay, by = (old_lat+ay/111320-lat)*111320, (old_lat+by/111320-lat)*111320
            if min(ax, bx) <= radius and max(ax, bx) >= -radius and min(ay, by) <= radius and max(ay, by) >= -radius:
                kept.extend((ax, ay, bx, by))
        fences[kind] = kept
    ground["fences"] = fences
    out.write_text(json.dumps(ground))


if __name__ == "__main__":
    main()
