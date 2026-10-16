"""Exercise nature in the actual app renderer, with a small real city window."""

# ruff: noqa: E501 -- embedded browser audit UI
import runpy
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DIAGNOSTIC = r"""
{
const panel=document.createElement('div');panel.style.cssText='position:fixed;bottom:12px;left:12px;background:white;color:#222;padding:12px;max-width:400px;max-height:60vh;overflow:auto;z-index:1000';
const data=document.createElement('pre');data.id='nature-app-audit';panel.append(data);
const results={};
function audit(){data.textContent=JSON.stringify({loaded:Boolean(NATURE),world:Boolean(natureWorld),stats:natureWorld?.stats,
 hostBox:natureWorld?.hostBox.value.toArray(),camera:camera.position.toArray(),results},null,2);}
for(const [name,lon,lat,dist] of [['Presidio',-122.462,37.796,350],['Baker Beach',-122.484,37.793,350],
 ['East Bay hills',-122.217,37.868,350],['Peninsula forest',-122.299,37.429,350],['Bay overview',-122.43,37.8,12500]]){
 const button=document.createElement('button');button.textContent=name;button.onclick=async()=>{
 delete results.ground;delete results.performance;results.loading=name;audit();
 const [x,y]=xy(lon,lat);goTo({x,z:-y},{travel:true,zoom:true});state.dist=dist;state.pitch=.8;placeCamera();
 await natureWorld?.update(x,-y);delete results.loading;results.location=name;audit();};panel.append(button);
}
const performanceButton=document.createElement('button');performanceButton.textContent='Measure active frames';
performanceButton.onclick=async()=>{
 const start=performance.now(),first=frameCount;performanceButton.disabled=true;
 for(let i=0;i<180;i++)await new Promise(resolve=>requestAnimationFrame(()=>{lastInputAt=performance.now();resolve();}));
 results.performance={fps:(frameCount-first)*1000/(performance.now()-start),calls:renderer.info.render.calls,
 triangles:renderer.info.render.triangles,points:renderer.info.render.points,geometries:renderer.info.memory.geometries};
 performanceButton.disabled=false;audit();};panel.append(performanceButton);
const groundButton=document.createElement('button');groundButton.textContent='Audit rendered ground';
groundButton.onclick=()=>{
 const ray=new THREE.Raycaster(),down=new THREE.Vector3(0,-1,0);let checked=0,skipped=0,maxError=0,sourceChecked=0,maxSourceError=0;
 for(let r=-2;r<=2;r++)for(let c=-2;c<=2;c++){
  const x=state.target.x+c*80,z=state.target.z+r*80,info=natureWorld.groundInfoAt(x,z);
  if(!info||info.kind==='stairs'){skipped++;continue;}
  ray.set(new THREE.Vector3(x,info.y+3000,z),down);
  const hit=ray.intersectObjects(natureWorld.terrain.children,false).find(h=>natureWorld.isVisibleGroundHit(h));
  if(!hit){skipped++;continue;}
  maxError=Math.max(maxError,Math.abs(info.y-(hit.point.y+.035)));checked++;
  if(!info.water&&outsideTerrainGrid(x,z)){
   const source=NATURE.sample(...NATURE.local(midLon+x/metersPerLon,midLat-z/metersPerLat));
   maxSourceError=Math.max(maxSourceError,Math.abs(source.height-info.y));sourceChecked++;
  }
 }
 results.ground={checked,skipped,maxErrorM:maxError,sourceChecked,maxSourceErrorM:maxSourceError,
  pass:checked>0&&maxError<.01&&maxSourceError<.01};audit();
};panel.append(groundButton);
const treeButton=document.createElement('button');treeButton.textContent='Audit city tree clearance';treeButton.onclick=()=>{
 let tested=0,inside=0;const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),matrix=new THREE.Matrix4();
 groups.ground.updateMatrixWorld(true);groups.ground.traverse(o=>{
  if(!o.isMesh||!String(o.userData.surface||'').startsWith('tree:'))return;
  const p=o.geometry.getAttribute('position'),index=o.geometry.getIndex(),N=index?index.count:p.count;
  for(let instance=0;instance<(o.isInstancedMesh?o.count:1);instance++){
   if(o.isInstancedMesh){o.getMatrixAt(instance,matrix);matrix.premultiply(o.matrixWorld);}else matrix.copy(o.matrixWorld);
   for(let j=0;j<N;j+=3){
    [a,b,c].forEach((v,k)=>v.fromBufferAttribute(p,index?index.getX(j+k):j+k).applyMatrix4(matrix));
    const x=(a.x+b.x+c.x)/3,z=(a.z+b.z+c.z)/3,y=(a.y+b.y+c.y)/3,building=buildingAt(x,z);tested++;
    if(building&&y>(building._treeClipBase??groundBaseFor(building.points))+.005&&y<(building._treeClipRoof??Infinity)-.005)inside++;
   }
  }
 });results.cityTrees={...window.kerbsideTreeClearance,tested,inside,pass:tested>0&&inside===0};audit();
};panel.append(treeButton);
document.body.append(panel);audit();
}
"""


if __name__ == "__main__":
    builder = runpy.run_path(str(ROOT / "tools/road_paint_preview.py"))
    builder["main"].__globals__["DIAGNOSTIC"] = DIAGNOSTIC
    builder["main"]()
