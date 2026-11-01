// Actual pinned Three geometry, offline. Live planar mirror is separately checked in WebGL.
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createSpecialtyRenderer} from '../../src/smc/interiors/specialty/renderer.mjs';
import {createExteriorRenderer} from '../../src/smc/exteriors/renderer.mjs';
const THREE=await import(pathToFileURL(process.argv[2]).href);
globalThis.document={createElement:()=>({width:512,height:256,getContext:()=>({clearRect(){},fillRect(){},fillText(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},measureText:t=>({width:String(t).length*60})})})};
const data=JSON.parse(fs.readFileSync(process.argv[3]));const exterior=await createExteriorRenderer(THREE,{},''),runtime=createSpecialtyRenderer(THREE,exterior),cases=[];
for(const p of Object.values(data.shops)){
 const target=new THREE.Group(),g=runtime.mount(target,p);if(!g)throw Error('missing '+p.id);let meshes=0,triangles=0;
 g.traverse(o=>{if(!o.geometry)return;meshes++;triangles+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3;
  for(const a of Object.values(o.geometry.attributes))if(!Array.from(a.array).every(Number.isFinite))throw Error('nonfinite '+p.id);
  if(o.material?.vertexColors&&!o.geometry.attributes.color)throw Error('lost barber pole stripes '+p.id);
 });
 let apertureChecks=0;
 for(const f of p.exterior.facades){const L=Math.hypot(f.b[0]-f.a[0],f.b[1]-f.a[1]),tx=(f.b[0]-f.a[0])/L,ty=(f.b[1]-f.a[1])/L;
  for(const o of f.openings){const u=o.u+o.w/2,h=o.v+o.h/2;
   const point=new THREE.Vector3(f.a[0]+tx*u-f.normal[0]*.206,h,-f.a[1]-ty*u+f.normal[1]*.206);
   g.traverse(m=>{if(!m.material?.userData?.roomFinish)return;const pos=m.geometry.attributes.position;
    for(let i=0;i<pos.count;i+=3){const vs=[0,1,2].map(j=>new THREE.Vector3().fromBufferAttribute(pos,i+j));
     const triangle=new THREE.Triangle(...vs),plane=triangle.getPlane(new THREE.Plane());
     if(Math.abs(plane.distanceToPoint(point))<.002&&triangle.containsPoint(point))throw Error('room finish closes aperture '+p.id+' '+o.id);
    }
   });apertureChecks++;
  }
 }
 if(!g.userData.ceiling||g.userData.doors.length!==2||triangles<2000)throw Error('incomplete shop '+p.id);
 cases.push({id:p.id,meshes,triangles,shared_aperture_checks:apertureChecks,finite_geometry:true});g.traverse(o=>o.geometry?.dispose());
}
runtime.dispose();exterior.dispose();console.log(JSON.stringify({three_revision:THREE.REVISION,cases},null,2));
