"""Isolated WebGL proof using the production billboard functions, not a second renderer."""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from tests.test_world_object_renderer import _extract, _page_js  # noqa: E402

NAMES = (
    "safeBillboardWebsite",
    "billboardSpec",
    "billboardAnchor",
    "billboardImagePlacement",
    "billboardTexture",
    "addBillboards",
    "activateBillboard",
)
source = "\n".join(_extract(n, _page_js()) for n in NAMES)
creatives = json.loads((ROOT / "docs/billboard-creatives.json").read_text())
records = json.loads((ROOT / "docs/sf-corridor-furniture.json").read_text())["inferred"][
    "ad_panels"
]
demo = next(r for r in records if r["id"] == "osm:ad_panel:node:6970578437")
page = """<!doctype html><html><head><meta charset="utf-8"><title>Production billboard verification</title>
<style>body{margin:0;background:#edf0e9;color:#222;font:16px system-ui}header{padding:16px}button{padding:10px}canvas{display:block;width:100%;height:calc(100vh - 100px)}</style></head>
<body><header>Production billboard functions · isolated geometry check · artwork is a labelled demo
<button id="front">Front</button><button id="back">Back</button><span id="status">Loading artwork…</span></header>
<canvas id="scene"></canvas><script type="module">
import * as THREE from 'https://esm.sh/three@0.160.0';
const canvas=document.getElementById('scene'),scene=new THREE.Scene();scene.background=new THREE.Color(0xedf0e9);
const groups={furniture:new THREE.Group(),mapped3d:new THREE.Group(),ground:new THREE.Group()};
Object.values(groups).forEach(g=>scene.add(g));const terrainTiles=[],activeGuest=null,footprintById=new Map();
const billboardFaces=[],billboardTextureCache=new Map(),ROAD_TOP_M=0;
const billboardFrameMaterial=new THREE.MeshStandardMaterial({color:0x454b4a,roughness:.7,metalness:.5});
const sharedAsset=name=>'/docs/'+name;
function xy(){return [0,0];}function groundLiftAt(){return 0;}function pavementTopAt(){return 0;}
function buildingAt(){return {height_m:8.38};}function furnitureBearing(){return -Math.PI/2;}
__FUNCTIONS__
const demo=__DEMO__,creatives=__CREATIVES__;addBillboards([demo],creatives);
const roof=new THREE.Mesh(new THREE.BoxGeometry(14,8.38,18),new THREE.MeshStandardMaterial({color:0xb6b2a3}));
roof.position.y=4.19;groups.mapped3d.add(roof);
scene.add(new THREE.HemisphereLight(0xffffff,0x5e6c58,2));const sun=new THREE.DirectionalLight(0xffffff,2);sun.position.set(-15,35,18);scene.add(sun);
const camera=new THREE.PerspectiveCamera(40,innerWidth/(innerHeight-100),.1,200);camera.position.set(-27,17,8);camera.lookAt(0,12,0);
const renderer=new THREE.WebGLRenderer({canvas,antialias:true});renderer.setSize(innerWidth,innerHeight-100);renderer.setPixelRatio(devicePixelRatio);
document.getElementById('front').onclick=()=>{camera.position.set(-27,17,8);camera.lookAt(0,12,0);};
document.getElementById('back').onclick=()=>{camera.position.set(27,17,8);camera.lookAt(0,12,0);};
let start=null;canvas.onpointerdown=e=>start=[e.clientX,e.clientY];
canvas.onpointerup=e=>{if(e.button!==0 || !start || Math.hypot(e.clientX-start[0],e.clientY-start[1])>5)return;
 const rect=canvas.getBoundingClientRect(),ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1),camera);activateBillboard(ray);};
function tick(){requestAnimationFrame(tick);renderer.render(scene,camera);document.getElementById('status').textContent=billboardFaces.some(f=>f.material.map)?'Artwork loaded · click the face to open its external source':'Loading artwork…';}tick();
</script></body></html>"""
out = ROOT / "build/billboards/index.html"
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(
    page.replace("__FUNCTIONS__", source)
    .replace("__DEMO__", json.dumps(demo))
    .replace("__CREATIVES__", json.dumps(creatives))
)
print(out)
