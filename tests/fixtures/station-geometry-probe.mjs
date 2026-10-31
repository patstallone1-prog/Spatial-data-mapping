// Run against real pinned Three.js: node probe.mjs <local-three-module> <station-scenes.json>.
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createStationRenderer} from '../../src/smc/exteriors/station-renderer.mjs';
import {createExteriorRenderer} from '../../src/smc/exteriors/renderer.mjs';
const THREE=await import(pathToFileURL(process.argv[2]).href);
globalThis.document={createElement:()=>({width:1024,height:512,getContext:()=>({clearRect(){},fillRect(){},fillText(){},measureText:t=>({width:String(t).length*60})})})};
const data=JSON.parse(fs.readFileSync(process.argv[3]));
const exteriors=await createExteriorRenderer(THREE,{},'');const runtime=createStationRenderer(THREE,exteriors),results=[];
for(const p of Object.values(data.stations)){
 const target=new THREE.Group(),g=runtime.mount(target,p);if(!g)throw Error('missing station '+p.id);
 let meshes=0,triangles=0;
 g.traverse(o=>{if(!o.geometry)return;meshes++;triangles+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3;
  for(const a of Object.values(o.geometry.attributes))if(!Array.from(a.array).every(Number.isFinite))throw Error('nonfinite geometry '+p.id);
 });
 const bounds=new THREE.Box3().setFromObject(g),points=p.site_polygon.coordinates[0];
 const minx=Math.min(...points.map(p=>p[0])),maxx=Math.max(...points.map(p=>p[0])),minz=Math.min(...points.map(p=>-p[1])),maxz=Math.max(...points.map(p=>-p[1]));
 if(bounds.min.x<minx-.12||bounds.max.x>maxx+.12||bounds.min.z<minz-.12||bounds.max.z>maxz+.12)throw Error('render outside source lot '+p.id+' '+JSON.stringify(bounds));
 if(!g.getObjectByName('stationVehicles')||!g.getObjectByName('stationApproaches'))throw Error('missing controls');
 let visibleMeshes=0;g.traverseVisible(o=>{if(o.geometry)visibleMeshes++;});
 results.push({id:p.id,meshes,visible_meshes:visibleMeshes,triangles,finite_geometry:true,render_inside_lot_bounds:true});
 g.traverse(o=>o.geometry?.dispose());
}
runtime.dispose();exteriors.dispose();
console.log(JSON.stringify({three_revision:THREE.REVISION,cases:results},null,2));
