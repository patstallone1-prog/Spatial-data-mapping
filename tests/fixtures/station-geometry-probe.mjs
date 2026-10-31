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
 let identityFaces=0;
 for(const canopy of p.canopies){
  const ring=canopy.polygon.coordinates[0],area=ring.slice(1).reduce((sum,q,i)=>sum+ring[i][0]*q[1]-q[0]*ring[i][1],0);
  for(let edge=1;edge<ring.length;edge++){
   const a=ring[edge-1],b=ring[edge],L=Math.hypot(b[0]-a[0],b[1]-a[1]);if(L<2.4)continue;
   const tx=(b[0]-a[0])/L,ty=(b[1]-a[1])/L,n=area>0?[ty,-tx]:[-ty,tx];let found=0;
   g.traverse(o=>{if(!o.geometry||!o.material?.userData?.stationIdentity)return;const pos=o.geometry.attributes.position;
    for(let i=0;i<pos.count;i++){
     const x=pos.getX(i)-a[0],y=-pos.getZ(i)-a[1],u=x*tx+y*ty,d=x*n[0]+y*n[1],h=pos.getY(i);
     if(u>=0&&u<=L&&Math.abs(d-.065)<.005&&h>canopy.underside_m&&h<canopy.underside_m+canopy.thickness_m)found++;
    }
   });
   if(found<3)throw Error('unbranded canopy face '+p.id+':'+edge);identityFaces++;
  }
 }
 let visibleMeshes=0;g.traverseVisible(o=>{if(o.geometry)visibleMeshes++;});
 results.push({id:p.id,meshes,canopy_identity_faces:identityFaces,visible_meshes:visibleMeshes,triangles,finite_geometry:true,render_inside_lot_bounds:true});
 g.traverse(o=>o.geometry?.dispose());
}
runtime.dispose();exteriors.dispose();
console.log(JSON.stringify({three_revision:THREE.REVISION,cases:results},null,2));
