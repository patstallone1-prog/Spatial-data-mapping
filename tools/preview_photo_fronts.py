"""Private three-house render smoke test using actual viewer facade/shell functions.

Canonical footprint massing is not a full-city geometry export or promotion approval.
No source photographs are embedded in the rendered scene.
"""

import hashlib
import json
import re
import shutil
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
    "frontageNormalFor",
    "photoOpeningTexture",
    "photoOpeningParts",
    "frontageOutcropsOnEdge",
    "homeOutcropSurfaces",
    "homeOutcropCapGeometry",
    "shellGlassOpacity",
    "facadeFor",
    "bareFacadeTextureFor",
    "toPaintableDetail",
    "random",
    "homeWindowArchSpring",
    "homeWindowCrown",
    "homeWindowShape",
    "homeWindowPaneGeometry",
    "homeWindowArchCorners",
    "clipFacadeBand",
)
SCENE = r"""
const scene=new THREE.Scene();scene.background=new THREE.Color('#e0e4df');
const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setSize(760,620);renderer.setPixelRatio(1);document.querySelector('#render').append(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xffffff,0x84918a,2));const light=new THREE.DirectionalLight(0xffffff,1.5);light.position.set(6,20,20);scene.add(light);
const camera=new THREE.PerspectiveCamera(38,760/620,.1,200);
const HOME_RENDER=new Map(),BUILDING_VISUAL_RANGES=new Map(),homeShells=new Set(),homeDesignMaterials=new Map(),PHOTO_OPENING_TEXTURES=new Map();
const STOREY_M=3.2,BAY_M=4,HOME_PANEL_OVERLAP_M=.001,INTERIOR_WALL_INSET_M=.08,DOOR_HEIGHT_M=2.1;
const WALL_PAINTS=[0xeee8df],PHOTO_MATERIAL_IMAGES=new Map(),bareWallMaps=new Map(),MATERIAL_VARIANTS=5;
const PAINTABLE_PHOTO_CLASSES=new Set(['stucco_render','wood_siding','concrete','vinyl_siding','wood_shingle','board_and_batten','painted_brick']),PAINTABLE_DETAIL_MEAN=.86;
const WINDOW_STYLES=[];
const plasterMaterial=new THREE.MeshStandardMaterial({color:0xeee8df,side:THREE.DoubleSide});
const homeGlassMaterial=new THREE.MeshStandardMaterial({color:0xe7f0f3,transparent:true,opacity:.12,depthWrite:false});const homeGlassInsideMaterial=homeGlassMaterial.clone();
const homeFrameMaterial=new THREE.MeshStandardMaterial({color:0xdeddd4}),homeDecalMaterial=new THREE.MeshStandardMaterial({color:0x617a87});
const homeShellGroup=new THREE.Group();scene.add(homeShellGroup);
function roomPaint(){return 0;}function setBatchedHomeVisible(){}function setHomeDecalsVisible(){}
function removeInterior(){}function buildInterior(){}function xy(x,y){return [x,y];}
function terrainGroundAt(){return 0;}
let currentFit=null;function frontageFitFor(){return currentFit;}
let BUILDING_LIFT_M=0;
function planePart(group,x,y,z,w,h,map,yaw){const mesh=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshStandardMaterial({map,color:0xffffff,side:THREE.DoubleSide}));mesh.position.set(x,y+h/2,z);mesh.rotation.y=yaw;group.add(mesh);return mesh;}
const fits=await Promise.all(FILES.map(file=>fetch(file).then(r=>r.json())));
const renderAudit=[],houseGroups=[];
const manifest=await fetch('../../material-library/manifest.json').then(r=>{if(!r.ok)throw Error('material manifest missing');return r.json();});
for(const row of manifest.assets || []) {
 if(row.license!=='CC0-1.0' || !['stucco_render','brick','concrete','wood_siding','stone'].includes(row.material_class))continue;
 const image=new Image();image.src='../../material-library/'+row.file;await image.decode();
 if(!PHOTO_MATERIAL_IMAGES.has(row.material_class))PHOTO_MATERIAL_IMAGES.set(row.material_class,[]);
 PHOTO_MATERIAL_IMAGES.get(row.material_class).push(image);
}
for(let k=0;k<fits.length;k++){
 const fit=fits[k],id=String(fit.building_id),w=fit.width_m,h=fit.height_m;
 if(!fit.canonical_front_footprint_uv?.length)throw Error('canonical footprint missing; refusing rectangular proxy approval');
 const points=fit.canonical_front_footprint_uv.map(([u,n])=>[u-w/2,n]);
 if(Math.hypot(points[0][0]-points.at(-1)[0],points[0][1]-points.at(-1)[1])<.001)points.pop();
 const signed=points.reduce((sum,a,i)=>{const b=points[(i+1)%points.length];return sum+a[0]*b[1]-b[0]*a[1];},0);
 if(signed<0)points.reverse();
 currentFit={...fit,a:[-w/2,0],b:[w/2,0],front_normal_enu:[0,-1],
   canonical_footprint:points.map(([x,z])=>[x,-z])};
 const entry={way:{osm_id:id},local:points,fit:[],doors:[]};
 const edges=points.map((a,i)=>{const b=points[(i+1)%points.length],L=Math.hypot(b[0]-a[0],b[1]-a[1]),ux=(b[0]-a[0])/L,uz=(b[1]-a[1])/L;
  return {edge:i,a,length:L,ux,uz,nx:-uz,nz:ux,windows:frontageWindowsOnEdge(entry,a,b,L,0) || []};});
 entry.decalLayout={bottom:0,top:h,floor:0,edges};
 const tint=fit.appearance.colour || '#b8b4a8',material={...MATERIALS.find(m=>m.name==='stucco'),photoLabel:'stucco_render',neutralColourDetail:true};
 const bands=facadeAppearanceBands({}, {material,tint,height:h,bottom:0,top:h,seed:1});
 HOME_RENDER.set(id,{material,tint,height:h,seed:1,clockwise:false,appearanceBands:bands});BUILDING_VISUAL_RANGES.set(id,[]);
 buildHomeShell(entry);const shell=entry.homeShell.group;shell.position.x=(k-1)*13;
 renderAudit.push({building:id,uniqueWindows:new Set(entry.homeShell.group.userData.windows.map(o=>o.sourceOpeningId || o.id)).size,
   surfaceFragments:entry.homeShell.group.userData.windows.length,
   arched:entry.homeShell.group.userData.windows.filter(o=>homeWindowArchSpring(o)!==null).length});
 const details=new THREE.Group();photoOpeningParts(details,entry.way,false);details.position.x=shell.position.x;scene.add(details);
 const roofShape=new THREE.Shape();points.forEach(([x,z],i)=>i ? roofShape.lineTo(x,-z) : roofShape.moveTo(x,-z));roofShape.closePath();
 const roofGeometry=new THREE.ShapeGeometry(roofShape);roofGeometry.rotateX(-Math.PI/2);
 const roof=new THREE.Mesh(roofGeometry,new THREE.MeshStandardMaterial({color:0x8e948e,side:THREE.DoubleSide}));roof.position.set(shell.position.x,h,0);scene.add(roof);
 const houseGroup=new THREE.Group();houseGroup.add(shell,details,roof);scene.add(houseGroup);houseGroups.push(houseGroup);
 const label=document.createElement('span');label.textContent=(fit.address?.formatted || id)+' — LOW certainty';document.querySelector('#addresses').append(label);
}
const ground=new THREE.Mesh(new THREE.PlaneGeometry(100,70),new THREE.MeshStandardMaterial({color:0xb4b7a9}));ground.rotation.x=-Math.PI/2;ground.position.y=-.03;scene.add(ground);
let view=0;
function redraw(){
 const k=Number(document.querySelector('#house').value),fit=fits[k],x=(k-1)*13,dist=Math.max(18,fit.width_m*2.4);
 houseGroups.forEach((group,i)=>{group.visible=i===k;});
 const positions=[[x,fit.height_m*.5,dist],[x+dist*.3,fit.height_m*.7,dist],[x-dist*.3,fit.height_m*.7,dist]];
 camera.position.set(...positions[view]);camera.lookAt(x,fit.height_m*.48,0);renderer.render(scene,camera);
 document.querySelector('#source').src=fit.building_id+'-registered.jpg?v='+SOURCE_HASHES[k];
}
document.querySelector('button').onclick=()=>{view=(view+1)%3;redraw();};
document.querySelector('#house').onchange=()=>{view=0;redraw();};redraw();
document.querySelector('#status').textContent='Actual app clear-glass and photographic material helpers on canonical footprints. CC0 material references, not house-specific texture capture. LOW certainty; manual registration/height priors. Not promoted. Rendered openings: '+JSON.stringify(renderAudit);
"""


def main():
    target = ROOT / "build/frontage-accuracy-audit/pilot/index.html"
    files = [
        f"{row['building_id']}-grounded.json?v={hashlib.sha256((target.parent / (row['building_id']+'-grounded.json')).read_bytes()).hexdigest()[:12]}"
        for row in json.loads((target.parent / "trials.json").read_text())
    ]
    js = _page_js()
    functions = "\n".join(_extract(name, js) for name in FUNCTIONS)
    constants = "\n".join(re.search(rf"const {name} = [\s\S]*?\n[\]\}}];", js).group(0)
                          for name in ("MATERIALS", "PHOTO_CLASS_TO_MATERIAL"))
    shutil.copytree(ROOT / "docs/materials", ROOT / "build/material-library", dirs_exist_ok=True)
    target.write_text(
        """<!doctype html><meta charset="utf-8"><title>Private three-house facade audit</title>
<style>body{background:#eef0e6;font:16px system-ui;margin:12px}span{display:inline-block;width:32%;padding:4px}button,select{padding:8px}.comparison{display:flex;align-items:center;gap:16px}canvas{max-width:65vw;height:auto}#source{max-width:30vw;max-height:620px}small{display:block}</style>
<h2>Photo-derived fronts — diagnostic geometry, not finished houses</h2><p id="status">Loading…</p>
<div id="addresses"></div><select id="house" aria-label="Audit house"><option value="0">4153 20th Street</option><option value="1">652 Guerrero Street</option><option value="2">2332 Taraval Street</option></select><button>Next view</button>
<small>Render / registered source. Low-certainty local evidence only; source blinds intentionally not painted into glass. Material images are reference textures, not measured surface scale.</small>
<div class="comparison"><div id="render"></div><img id="source" alt="Registered source facade used for comparison"></div><script type="module">
import * as THREE from 'https://esm.sh/three@0.160.0';
"""
        + "const FILES="
        + json.dumps(files)
        + ";\n"
        + "const SOURCE_HASHES=" + json.dumps([hashlib.sha256((target.parent / (row['building_id']+'-registered.jpg')).read_bytes()).hexdigest()[:12]
                                             for row in json.loads((target.parent / "trials.json").read_text())]) + ";\n"
        + constants
        + functions
        + SCENE
        + "</script>"
    )
    print(target)


if __name__ == "__main__":
    main()
