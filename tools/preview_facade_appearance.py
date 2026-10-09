#!/usr/bin/env python3
"""Private synthetic visual regression scene, extracting authoritative renderer code.

Not photographic accuracy evidence. Run from the repository with PYTHONPATH=src.
The two buildings exercise the real clipped city walls and close-up home shell.
"""

# Embedded browser fixture retains readable JavaScript statement boundaries.
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from tests.test_world_object_renderer import _extract, _page_js  # noqa: E402

FUNCTIONS = (
    "facadeAppearanceBands",
    "clipFacadeBand",
    "wallPanels",
    "homeWallGeometry",
    "mergeParts",
    "batchHomeShell",
    "facadeStoreyMetres",
    "buildHomeShell",
)
SCENE = r"""
const scene=new THREE.Scene();scene.background=new THREE.Color('#d9e2df');
const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setSize(1200,720);renderer.setPixelRatio(1);
document.body.append(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xffffff,0x788879,2.4));
const sun=new THREE.DirectionalLight(0xffffff,2);sun.position.set(8,20,9);scene.add(sun);
const camera=new THREE.PerspectiveCamera(45,1200/720,.1,200);
const MATERIALS=[{name:'brick',rough:.9,metal:0},{name:'stucco',rough:.95,metal:0}];
const PHOTO_CLASS_TO_MATERIAL={brick:'brick',stucco_render:'stucco'};
function frontageFitFor(){return {appearance:{bands:[
  {bottom_m:0,top_m:3,material:'brick',colour:'#a56c50',front_basis:'synthetic_fixture'},
  {bottom_m:3,top_m:6,material:'stucco_render',colour:'#cedcc8',front_basis:'synthetic_fixture'}]}};}
const textureCache=new Map();
function bareFacadeTextureFor(material){
  if(textureCache.has(material.name))return textureCache.get(material.name);
  const c=document.createElement('canvas');c.width=c.height=128;const ctx=c.getContext('2d');
  ctx.fillStyle='#ffffff';ctx.fillRect(0,0,128,128);ctx.strokeStyle='#bbbbbb';ctx.lineWidth=2;
  if(material.name==='brick')for(let y=0;y<=128;y+=16){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(128,y);ctx.stroke();
    for(let x=(y%32?16:0);x<=128;x+=32){ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x,y+16);ctx.stroke();}}
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;
  textureCache.set(material.name,t);return t;
}
const spec={material:MATERIALS[0],seed:1,tint:0xffffff,height:6,clockwise:false};
spec.appearanceBands=facadeAppearanceBands({}, {...spec,bottom:0,top:6});
const points=[[-3,-3],[3,-3],[3,3],[-3,3]];
const edges=points.map((a,i)=>{const b=points[(i+1)%4],ux=(b[0]-a[0])/6,uz=(b[1]-a[1])/6;
  return {edge:i,a,length:6,ux,uz,nx:-uz,nz:ux,windows:[
    {u:1,v:.8,w:1.3,h:1.5,design:{vertical_bars:[.5],trim:{colour:'#ffffff'}}},
    {u:3.6,v:3.8,w:1.3,h:1.5,design:{horizontal_bars:[.5],trim:{colour:'#ffffff'}}}]};});
const layout={bottom:0,top:6,floor:0,edges};
const HOME_RENDER=new Map([['1',spec]]),BUILDING_VISUAL_RANGES=new Map([['1',[]]]),homeShells=new Set();
const STOREY_M=3.2,BAY_M=4,HOME_PANEL_OVERLAP_M=.001,INTERIOR_WALL_INSET_M=.08;
const WALL_PAINTS=[0xeee8df];function roomPaint(){return 0;}
const plasterMaterial=new THREE.MeshStandardMaterial({color:0xeee8df,side:THREE.DoubleSide});
const homeGlassMaterial=new THREE.MeshStandardMaterial({color:0x527889,transparent:true,opacity:.75,side:THREE.FrontSide});
const homeGlassInsideMaterial=homeGlassMaterial.clone(),homeFrameMaterial=new THREE.MeshStandardMaterial({color:0x444444});
function shellGlassOpacity(){return .75;}
function setBatchedHomeVisible(){}function setHomeDecalsVisible(){}function removeInterior(){}function buildInterior(){}
const homeShellGroup=new THREE.Group();homeShellGroup.position.x=5;scene.add(homeShellGroup);
const entry={way:{osm_id:1},fit:[],decalLayout:layout,doors:[]};buildHomeShell(entry);
const far=new THREE.Group();far.position.x=-5;scene.add(far);
for(const e of edges){const g=homeWallGeometry(e.a,e.ux,e.uz,[[0,0,6,6]],0,0,0,(u,v)=>[u/4,v/3]);
  const ids=Array.from({length:g.getAttribute('position').count},(_,i)=>i);
  for(const band of spec.appearanceBands){const clipped=clipFacadeBand(g,ids,band.bottom,band.top);
    far.add(new THREE.Mesh(clipped,new THREE.MeshStandardMaterial({color:band.tint,map:bareFacadeTextureFor(band.material),side:THREE.DoubleSide})));}g.dispose();}
for(const group of [far,homeShellGroup]){const roof=new THREE.Mesh(new THREE.BoxGeometry(6,.12,6),new THREE.MeshStandardMaterial({color:0x858e87}));roof.position.y=6;group.add(roof);}
const ground=new THREE.Mesh(new THREE.PlaneGeometry(70,70),new THREE.MeshStandardMaterial({color:0xb7b9a5}));ground.rotation.x=-Math.PI/2;ground.position.y=-.02;scene.add(ground);
let view=0;
function redraw(){const positions=[[18,13,23],[-18,12,-23],[19,10,-21]];camera.position.set(...positions[view]);camera.lookAt(0,2.5,0);renderer.render(scene,camera);}
document.querySelector('button').onclick=()=>{view=(view+1)%3;redraw();};redraw();
document.querySelector('#status').textContent='Ready: actual clipped-wall and home-shell helpers; white trim; intact roofs. Synthetic materials, not photo truth.';
"""


def main():
    target = ROOT / "build/appearance-preview/index.html"
    target.parent.mkdir(parents=True, exist_ok=True)
    functions = "\n".join(_extract(name, _page_js()) for name in FUNCTIONS)
    target.write_text(
        """<!doctype html><meta charset="utf-8"><title>Facade appearance regression</title>
<style>body{margin:12px;font:16px system-ui;background:#eef0e6}canvas{display:block}button{padding:8px}</style>
<h2>Synthetic regression — left: city walls; right: close-up house shell</h2>
<p id="status">Loading…</p><button>Next corner</button><script type="module">
import * as THREE from 'https://esm.sh/three@0.160.0';
"""
        + functions
        + SCENE
        + "</script>"
    )
    print(target)


if __name__ == "__main__":
    main()
