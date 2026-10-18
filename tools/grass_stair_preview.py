"""Local visual sweep using the current full renderer and actual mapped stairs/turf."""
import runpy
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DIAGNOSTIC = r"""
{
const panel=document.createElement('div');panel.style.cssText='position:fixed;bottom:8px;left:8px;z-index:1000;background:#fff;color:#222;padding:10px;max-width:340px;font:12px monospace';
const pre=document.createElement('pre');pre.id='locomotion-audit';panel.append(pre);
let flight=null;
function report(){pre.textContent=JSON.stringify({grassMeshes:grassStrands?.group.children.length||0,
 grassTriangles:grassStrands?.group.children.reduce((n,m)=>n+m.geometry.index.count/3,0)||0,
 stairs:publicStairs.length,selected:flight?.osm_id,at:[avatar.position.x,avatar.position.y,avatar.position.z],
 surface:walkerGroundInfo(avatar.position.x,avatar.position.z),moving:avatar.userData.lastMoving,
 clip:avatarActiveAction?.getClip().name},null,2);}
function button(label,action){const b=document.createElement('button');b.textContent=label;b.onclick=()=>{action();report();};panel.append(b);}
button('View grass strands',()=>{const mesh=grassStrands?.group.children[0];if(!mesh)return;
 const p=mesh.geometry.getAttribute('position');state.target.set(p.getX(0),p.getY(0),p.getZ(0));
 state.dist=2.5;state.pitch=.5;state.firstPerson=false;placeCamera();});
button('Visit mapped stair foot',()=>{
 flight=publicStairs.filter(s=>s.count>4).sort((a,b)=>Math.hypot(a.xs[0]-avatar.position.x,a.zs[0]-avatar.position.z)-Math.hypot(b.xs[0]-avatar.position.x,b.zs[0]-avatar.position.z))[0];
 if(!flight)return;GPS_LEASH.on=false;const x=flight.xs[0],z=flight.zs[0];
 avatar.position.set(x,AVATAR_STAND_Y+walkerGroundAt(x,z),z);state.target.copy(avatar.position);
 state.yaw=Math.atan2(x-flight.xs.at(-1),z-flight.zs.at(-1));state.pitch=.7;state.dist=8;state.firstPerson=false;placeCamera();});
button('Climb one stride',()=>{if(!flight)return;
 const n=flight.xs.length-1,dx=flight.xs[n]-avatar.position.x,dz=flight.zs[n]-avatar.position.z,L=Math.hypot(dx,dz);
 const v=new THREE.Vector3(dx/L,0,dz/L);const pace=walkPace(v);avatar.userData.onStairs=pace.stairs;avatar.userData.pace=pace.factor;
 const move=Math.min(.25,L),moved=moveWalker(v.x*move,v.z*move);animateAvatar(moved,v,moved>0);updateAvatarMixer(.18);
 state.target.copy(avatar.position);placeCamera();});
document.body.append(panel);setInterval(report,1000);report();
}
"""

if __name__ == "__main__":
    builder = runpy.run_path(str(ROOT / "tools/road_paint_preview.py"))
    builder["main"].__globals__["DIAGNOSTIC"] = DIAGNOSTIC
    builder["main"]()
