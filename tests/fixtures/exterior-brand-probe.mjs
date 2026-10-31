// Real Three.js regression: identity lettering must sit in front of its solid fascia.
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createExteriorRenderer} from '../../src/smc/exteriors/renderer.mjs';
const THREE=await import(pathToFileURL(process.argv[2]).href);
globalThis.document={createElement:()=>({width:1536,height:256,getContext:()=>({clearRect(){},fillText(){},measureText:t=>({width:String(t).length*75})})})};
const collection=JSON.parse(fs.readFileSync(process.argv[3]));const runtime=await createExteriorRenderer(THREE,{},'');let checked=0;
for(const p of Object.values(collection.buildings)){
 const group=new THREE.Group();runtime.mount(group,p);
 for(const f of p.facades)for(const s of f.signs){
  if(!['fascia','lightbox','neon','plaque'].includes(s.kind)||s.canopy)continue;
  const L=Math.hypot(f.b[0]-f.a[0],f.b[1]-f.a[1]),t=[(f.b[0]-f.a[0])/L,(f.b[1]-f.a[1])/L];let found=0;
  group.traverse(o=>{if(!o.geometry||!o.material?.map)return;const a=o.geometry.attributes.position;
   for(let i=0;i<a.count;i++){
    const x=a.getX(i)-f.a[0],y=-a.getZ(i)-f.a[1],u=x*t[0]+y*t[1],v=a.getY(i),d=x*f.normal[0]+y*f.normal[1];
    if(u>=s.u-.001&&u<=s.u+s.w+.001&&v>=s.v-.001&&v<=s.v+s.h+.001&&Math.abs(d)<.5){
     if(d<(s.kind==='lightbox'?.17:.13)+.005)throw Error('lettering hidden behind panel '+p.id+' '+s.kind+' depth='+d);found++;
    }
   }
  });
  if(!found)throw Error('no visible sign lettering '+p.id);checked++;
 }
 group.traverse(o=>o.geometry?.dispose());
}
runtime.dispose();console.log(JSON.stringify({three_revision:THREE.REVISION,checked_panels:checked}));
