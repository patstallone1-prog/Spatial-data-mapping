"""Isolated landscape visual audit using the production runtime and real atlas."""
# ruff: noqa: E501 -- embedded browser audit page, not Python expressions

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PAGE = """<!doctype html><html><head><meta charset="utf-8"><title>Kerbside nature audit</title>
<style>body{margin:0;background:#afc8d4;font:12px system-ui}nav{position:fixed;top:10px;left:10px;background:#fff;padding:8px;border-radius:8px;max-width:330px;max-height:48vh;overflow:auto}button{padding:7px}pre{max-width:320px}</style>
<script type="importmap">{"imports":{"three":"https://esm.sh/three@0.160.0"}}</script></head><body>
<nav><button id="presidio">Presidio</button><button id="beach">Baker Beach</button><button id="hills">East Bay hills</button><button id="peninsula">Peninsula forest</button><button id="close">Ground detail</button><button id="overview">Landscape overview</button><button id="measure">Measure frames</button><pre id="audit">Loading real atlas…</pre></nav>
<script type="module">
import * as THREE from "three";
import {OrbitControls} from "https://esm.sh/three@0.160.0/examples/jsm/controls/OrbitControls.js";
import {loadNatureAtlas,createNatureWorld} from "/docs/nature-runtime.mjs";
const scene=new THREE.Scene();scene.background=new THREE.Color(0xb6ccda);
const camera=new THREE.PerspectiveCamera(50,innerWidth/innerHeight,.2,180000);
const renderer=new THREE.WebGLRenderer({antialias:true,logarithmicDepthBuffer:true});renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));document.body.appendChild(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xe6f1ff,0x706a49,2));const sun=new THREE.DirectionalLight(0xffefd7,2);sun.position.set(-200,600,300);scene.add(sun);
const controls=new OrbitControls(camera,renderer.domElement);controls.maxPolarAngle=Math.PI*.49;
const atlas=await loadNatureAtlas(p=>"/docs/"+p),root=new THREE.Group();scene.add(root);
const mid=[-122.45,37.79],kx=111320*Math.cos(mid[1]*Math.PI/180),ky=111320;
const toPage=(lon,lat)=>[(lon-mid[0])*kx,-(lat-mid[1])*ky],fromPage=(x,z)=>[mid[0]+x/kx,mid[1]-z/ky];
const world=createNatureWorld({THREE,root,atlas,toPage,fromPage,heightAt:(x,z,h,wet)=>wet?0:h,waterAt:(x,z,s)=>s.water,blockedAt:()=>false});
window.natureAudit={atlas,world};
const locations={presidio:[-122.462,37.796],beach:[-122.484,37.793],hills:[-122.217,37.868],peninsula:[-122.299,37.429]};
async function visit(id){const ll=locations[id],p=toPage(...ll),s=atlas.sample(...atlas.local(...ll));controls.target.set(p[0],s.height,p[1]);camera.position.set(p[0]+220,s.height+220,p[1]+220);controls.update();await world.update(...p);document.querySelector("#audit").textContent=JSON.stringify({location:id,sample:atlas.sample(...atlas.local(...ll)),stats:world.stats},null,2);}
for(const id of Object.keys(locations))document.querySelector("#"+id).onclick=()=>visit(id);
for(const [id,d] of [['close',35],['overview',2600]])document.getElementById(id).onclick=()=>{camera.position.copy(controls.target).add(new THREE.Vector3(d,d*.55,d));controls.update();};
document.getElementById('measure').onclick=async()=>{const start=performance.now();for(let i=0;i<120;i++)await new Promise(r=>requestAnimationFrame(r));
 document.getElementById('audit').textContent=JSON.stringify({fps:120000/(performance.now()-start),calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,points:renderer.info.render.points,stats:world.stats},null,2);};
await visit("presidio");
renderer.setAnimationLoop(()=>{world.tick(performance.now(),camera);controls.update();renderer.render(scene,camera);});
addEventListener("resize",()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
</script></body></html>"""


def main() -> None:
    path = ROOT / "build/nature-preview/index.html"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(PAGE)
    print(path)


if __name__ == "__main__":
    main()
