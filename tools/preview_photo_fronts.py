"""Private three-house render smoke test using actual viewer facade/shell functions.

Diagnostic massing is not a full-city geometry export or promotion approval.
No source photographs are embedded in the rendered scene.
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from tests.test_world_object_renderer import _extract, _page_js  # noqa: E402

FUNCTIONS = (
    "facadeAppearanceBands",
    "wallPanels",
    "homeWallGeometry",
    "mergeParts",
    "batchHomeShell",
    "facadeStoreyMetres",
    "buildHomeShell",
    "homeDesignMaterial",
    "frontageWindowsOnEdge",
    "photoOpeningTexture",
    "photoOpeningParts",
    "frontageOutcropsOnEdge",
    "homeOutcropSurfaces",
    "homeOutcropCapGeometry",
)
SCENE = r"""
const scene=new THREE.Scene();scene.background=new THREE.Color('#e0e4df');
const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setSize(1200,740);renderer.setPixelRatio(1);document.body.append(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xffffff,0x84918a,2));const light=new THREE.DirectionalLight(0xffffff,1.5);light.position.set(6,20,20);scene.add(light);
const camera=new THREE.PerspectiveCamera(38,1200/740,.1,200);camera.position.set(19,17,44);camera.lookAt(0,4,0);
const HOME_RENDER=new Map(),BUILDING_VISUAL_RANGES=new Map(),homeShells=new Set(),homeDesignMaterials=new Map(),PHOTO_OPENING_TEXTURES=new Map();
const STOREY_M=3.2,BAY_M=4,HOME_PANEL_OVERLAP_M=.001,INTERIOR_WALL_INSET_M=.08,DOOR_HEIGHT_M=2.1;
const WALL_PAINTS=[0xeee8df],MATERIALS=[{name:'stucco',rough:.95,metal:0}],PHOTO_CLASS_TO_MATERIAL={stucco_render:'stucco'};
const plasterMaterial=new THREE.MeshStandardMaterial({color:0xeee8df,side:THREE.DoubleSide});
const homeGlassMaterial=new THREE.MeshStandardMaterial({color:0xe7f0f3,transparent:true,opacity:.12,depthWrite:false});const homeGlassInsideMaterial=homeGlassMaterial.clone();
const homeFrameMaterial=new THREE.MeshStandardMaterial({color:0xdeddd4}),homeDecalMaterial=new THREE.MeshStandardMaterial({color:0x617a87});
const homeShellGroup=new THREE.Group();scene.add(homeShellGroup);
function roomPaint(){return 0;}function shellGlassOpacity(){return .8;}function setBatchedHomeVisible(){}function setHomeDecalsVisible(){}
function removeInterior(){}function buildInterior(){}function bareFacadeTextureFor(){return null;}function xy(x,y){return [x,y];}
let currentFit=null;function frontageFitFor(){return currentFit;}
let BUILDING_LIFT_M=0;
function planePart(group,x,y,z,w,h,map,yaw){const mesh=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshStandardMaterial({map,color:0xffffff,side:THREE.DoubleSide}));mesh.position.set(x,y+h/2,z);mesh.rotation.y=yaw;group.add(mesh);return mesh;}
const fits=await Promise.all(FILES.map(file=>fetch(file).then(r=>r.json())));
for(let k=0;k<fits.length;k++){
 const fit=fits[k],id=String(fit.building_id),w=fit.width_m,h=fit.height_m,d=4;
 currentFit={...fit,a:[-w/2,-d/2],b:[w/2,-d/2]};
 const points=[[-w/2,d/2],[-w/2,-d/2],[w/2,-d/2],[w/2,d/2]];
 const entry={way:{osm_id:id},fit:[],doors:[]};
 const edges=points.map((a,i)=>{const b=points[(i+1)%4],L=Math.hypot(b[0]-a[0],b[1]-a[1]),ux=(b[0]-a[0])/L,uz=(b[1]-a[1])/L;
  return {edge:i,a,length:L,ux,uz,nx:-uz,nz:ux,windows:frontageWindowsOnEdge(entry,a,b,L,0) || []};});
 entry.decalLayout={bottom:0,top:h,floor:0,edges};
 const tint=fit.appearance.colour || '#b8b4a8',material=MATERIALS[0];
 const bands=facadeAppearanceBands({}, {material,tint,height:h,bottom:0,top:h,seed:1});
 HOME_RENDER.set(id,{material,tint,height:h,seed:1,clockwise:false,appearanceBands:bands});BUILDING_VISUAL_RANGES.set(id,[]);
 buildHomeShell(entry);const shell=entry.homeShell.group;shell.position.x=(k-1)*13;
 const details=new THREE.Group();photoOpeningParts(details,entry.way,false);details.position.x=shell.position.x;scene.add(details);
 const roof=new THREE.Mesh(new THREE.BoxGeometry(w,.14,d),new THREE.MeshStandardMaterial({color:0x8e948e}));roof.position.set(shell.position.x,h,0);scene.add(roof);
 const label=document.createElement('span');label.textContent=(fit.address?.formatted || id)+' — LOW certainty';document.querySelector('#addresses').append(label);
}
const ground=new THREE.Mesh(new THREE.PlaneGeometry(100,70),new THREE.MeshStandardMaterial({color:0xb4b7a9}));ground.rotation.x=-Math.PI/2;ground.position.y=-.03;scene.add(ground);
renderer.render(scene,camera);let view=0;document.querySelector('button').onclick=()=>{view=(view+1)%3;camera.position.set(...[[19,17,44],[-19,14,40],[0,9,42]][view]);camera.lookAt(0,4,0);renderer.render(scene,camera);};
document.querySelector('#status').textContent='Three private trial fronts rendered. LOW certainty; manual image registration; proxy massing. Not promoted or metric-certified.';
"""


def main():
    target = ROOT / "build/frontage-accuracy-audit/pilot/index.html"
    files = [
        f"{row['building_id']}-grounded.json"
        for row in json.loads((target.parent / "trials.json").read_text())
    ]
    functions = "\n".join(_extract(name, _page_js()) for name in FUNCTIONS)
    target.write_text(
        """<!doctype html><meta charset="utf-8"><title>Private three-house facade audit</title>
<style>body{background:#eef0e6;font:16px system-ui;margin:12px}span{display:inline-block;width:32%;padding:4px}button{padding:8px}</style>
<h2>Photo-derived fronts — diagnostic geometry, not finished houses</h2><p id="status">Loading…</p>
<div id="addresses"></div><button>Next view</button><script type="module">
import * as THREE from 'https://esm.sh/three@0.160.0';
"""
        + "const FILES="
        + json.dumps(files)
        + ";\n"
        + functions
        + SCENE
        + "</script>"
    )
    print(target)


if __name__ == "__main__":
    main()
