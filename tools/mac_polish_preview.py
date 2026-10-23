"""Real-data Mac court, shop and directions sweep; never a deployment asset.

Use road_paint_preview's bounded fixture generator with a small, explicit audit UI.
The controls exercise the real renderer and direction request handler, not a second renderer.
"""
from __future__ import annotations

import runpy
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DIAGNOSTIC = r'''
{
const box=document.createElement('div');box.id='mac-audit';
box.style.cssText='position:fixed;bottom:8px;left:8px;z-index:10000;background:white;color:#222;padding:6px;font:10px monospace;max-width:300px';
const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Mac audit data';
const report=document.createElement('pre');report.id='mac-audit-report';details.append(summary,report);box.append(details);
const button=(text,run)=>{const b=document.createElement('button');b.textContent=text;b.style.cssText='font:10px monospace;padding:3px;margin:2px';b.onclick=run;box.append(b);};
button('Audit daylight',()=>environmentController?.setTime(new Date('2026-10-22T20:00:00Z')));
button('Audit overhead',()=>{state.firstPerson=false;state.pitch=1.5;state.dist=170;placeCamera();});
button('Audit street view',()=>{state.firstPerson=false;state.pitch=.35;state.dist=25;placeCamera();});
button('Audit restaurant door',()=>{
 const e=footprintById.get('262397369');if(!e)return;
 const [x,y]=xy(...e.way.centroid);goTo(addressLanding(new THREE.Vector3(x,0,-y)),{travel:true,zoom:true});
});
let lastEntry=null;
let tallObjects=[];
button('Audit court objects',()=>{
 const owner=activeGuest?.api || {root,midLon,midLat,metersPerLon};tallObjects=[];
 owner.root.updateMatrixWorld(true);
 owner.root.traverse(o=>{
  if(!o.isMesh)return; o.geometry.computeBoundingBox();
  const add=(matrix)=>{const b=o.geometry.boundingBox.clone().applyMatrix4(matrix),c=b.getCenter(new THREE.Vector3());
   const local=owner.root.worldToLocal(c.clone()),lon=owner.midLon+local.x/owner.metersPerLon,lat=owner.midLat-local.z/metersPerLat;
   if(lon> -122.43465&&lon< -122.4339&&lat>37.8016&&lat<37.8023&&b.max.y-b.min.y>2)
    tallObjects.push({surface:o.userData.surface,data:o.userData,lon,lat,height:b.max.y-b.min.y});};
  if(o.isInstancedMesh){const m=new THREE.Matrix4();for(let i=0;i<o.count;i++){o.getMatrixAt(i,m);add(m.clone().premultiply(o.matrixWorld));}}
  else add(o.matrixWorld);
 });
});
button('Audit enter / leave',()=>{lastEntry=enterOrLeave();});
button('Audit routes',()=>{
 const a=DATA.ways.find(w=>w.kind==='street'&&w.points?.length>1);if(!a)return;
 const [lon,lat]=a.points[0],b=a.points.at(-1);
 route.stops=[{label:a.name+' start',lon,lat},{label:a.name+' end',lon:b[0],lat:b[1]}];
 document.getElementById('hud').dataset.open='true';
 document.getElementById('route-go').click();
});
const refresh=()=>{
 const e=footprintById.get('262397369');
 report.textContent=JSON.stringify({at:[avatar.position.x,avatar.position.y,avatar.position.z],
  pitch:state.pitch,distance:state.dist,controlsOpen:document.getElementById('hud').dataset.open,
  chosen:route.chosen,routes:route.results.length,routeScale:routeScale(),
  indoors:Boolean(state.indoors),lastEntry,tallObjects,hostWorldActive,guest:activeGuest?.region.name,
  currentRestaurant:activeGuest?.api.interiorStatus?.('262397369') || interiorStatus('262397369'),
  restaurant:e?{ref:e.generatedInteriorRef?.kind,plan:e.interior?.plan,
   generated:e.interior?.generated,failed:e.generatedInteriorFailed,
   kinds:e.interior?.house?.storeys[0].rooms.map(r=>r.kind),doors:e.doors?.map(d=>({open:d.open,x:d.cx,z:d.cz}))}:null,
  courts:groups.ground.children.filter(o=>o.userData.surface==='court').map(o=>({order:o.renderOrder,depth:o.material.depthTest})),
  failures:window.kerbsideReady?.error},null,1);
};
document.body.append(box);setInterval(refresh,1000);refresh();
}
'''

if __name__ == '__main__':
    builder = runpy.run_path(str(ROOT/'tools/road_paint_preview.py'))
    builder['main'].__globals__['DIAGNOSTIC'] = DIAGNOSTIC
    builder['main']()
