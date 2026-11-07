// Actual pinned Three.js geometry, independent of browser GPU/asset-network availability.
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createDealershipRenderer} from '../../src/smc/exteriors/dealership-renderer.mjs';
import {createExteriorRenderer} from '../../src/smc/exteriors/renderer.mjs';
const THREE=await import(pathToFileURL(process.argv[2]).href);
globalThis.document={createElement:()=>({width:1536,height:256,getContext:()=>({clearRect(){},fillRect(){},fillText(){},measureText:t=>({width:String(t).length*60})})})};
const data=JSON.parse(fs.readFileSync(process.argv[3]));
const exteriors=await createExteriorRenderer(THREE,{},''),runtime=createDealershipRenderer(THREE,exteriors),results=[];
for(const p of Object.values(data.dealerships)){
 const target=new THREE.Group(),g=runtime.mount(target,p);if(!g)throw Error('missing dealership '+p.id);
 let meshes=0,triangles=0;
 g.traverse(o=>{if(!o.geometry)return;meshes++;const geometry=o.geometry,count=geometry.index?.count||geometry.attributes.position.count;triangles+=count/3;
  for(const a of Object.values(geometry.attributes))if(!Array.from(a.array).every(Number.isFinite))throw Error('nonfinite geometry '+p.id);
  for(const group of geometry.groups)if(group.start+group.count>count)throw Error('material group exceeds geometry '+p.id);
  if(geometry.index&&Math.max(...geometry.index.array)>=geometry.attributes.position.count)throw Error('invalid triangle index '+p.id);
 });
 const bounds=new THREE.Box3().setFromObject(g),points=p.site_polygon.coordinates[0];
 if(bounds.min.x<Math.min(...points.map(p=>p[0]))-.15||bounds.max.x>Math.max(...points.map(p=>p[0]))+.15||bounds.min.z<Math.min(...points.map(p=>-p[1]))-.15||bounds.max.z>Math.max(...points.map(p=>-p[1]))+.15)throw Error('render outside source lot '+p.id);
 if(!g.getObjectByName('dealershipCars')||!g.getObjectByName('dealershipRoof'))throw Error('missing controls '+p.id);
 const camera=new THREE.PerspectiveCamera(48,660/526,.1,1200),c=bounds.getCenter(new THREE.Vector3()),s=bounds.getSize(new THREE.Vector3()),radius=s.length()/2,fov=camera.fov*Math.PI/180,hfov=2*Math.atan(Math.tan(fov/2)*camera.aspect),distance=radius/Math.sin(Math.min(fov,hfov)/2)*1.12;
 camera.position.copy(c).add(new THREE.Vector3(.65,.65,.85).normalize().multiplyScalar(distance));camera.lookAt(c);camera.updateMatrixWorld();
 for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z]){const v=new THREE.Vector3(x,y,z).project(camera);if(Math.abs(v.x)>1||Math.abs(v.y)>1)throw Error('overview clips source site '+p.id);}
 results.push({id:p.id,meshes,triangles,finite_geometry:true,valid_material_groups:true,overview_fits:true});
 g.traverse(o=>o.geometry?.dispose());
}
runtime.dispose();exteriors.dispose();console.log(JSON.stringify({three_revision:THREE.REVISION,cases:results}));
