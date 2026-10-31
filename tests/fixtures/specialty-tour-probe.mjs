import fs from 'node:fs';
import {inPolygon} from '../../docs/inferred-interiors/tour-world.mjs';
import {createSpecialtyTour,initialShopYaw,shopSpawn} from '../../src/smc/interiors/specialty/tour.mjs';
const data=JSON.parse(fs.readFileSync(process.argv[2])),cases=[];
for(const source of Object.values(data.shops)){
 const p=structuredClone(source),floor=p.storeys[0];
 const doors=floor.openings.filter(o=>!o.entrance).map(o=>({level:0,open:true,segment:o.segment.coordinates,openSegment:o.open_leaf_segment.coordinates}));
 const world=createSpecialtyTour(p,doors),start=world.spawn(),step=.2,queue=[[0,0]],seen=new Set(['0,0']),reached=[];
 for(let i=0;i<queue.length;i++){
  const [u,v]=queue[i],x=start.x+u*step,z=start.z+v*step;reached.push([x,z]);
  for(const [du,dv] of [[1,0],[-1,0],[0,1],[0,-1]]){
   const nu=u+du,nv=v+dv,key=nu+','+nv;if(seen.has(key))continue;seen.add(key);
   const nx=start.x+nu*step,nz=start.z+nv*step;if(!world.clear(nx,nz,0))continue;
   const next=world.move({x,z,y:0},du*step,dv*step);
   if(Math.hypot(next.x-nx,next.z-nz)<1e-5)queue.push([nu,nv]);
  }
 }
 let rooms=0;for(const r of floor.rooms){const spawn=shopSpawn(world,r.id);if(!world.clear(spawn.x,spawn.z,0))throw Error('blocked spawn '+p.id);
  if(!Number.isFinite(initialShopYaw(world,spawn,r.id)))throw Error('invalid initial view '+p.id);
  if(!reached.some(([x,z])=>inPolygon(x,z,r.polygon)))throw Error('disconnected room '+p.id+' '+r.id);rooms++;
 }
 for(const t of p.interaction_targets)if(!reached.some(([x,z])=>Math.hypot(x-t.point[0],z-t.point[1])<.32))throw Error('disconnected target '+p.id+' '+JSON.stringify(t));
 let closed=true;for(const d of doors){const [a,b]=d.segment,x=(a[0]+b[0])/2,z=(a[1]+b[1])/2;
  if(!world.clear(x,z,0))throw Error('blocked open door '+p.id);d.open=false;closed&&=!world.clear(x,z,0);d.open=true;
 }
 const q=floor.inside.coordinates[0][0],wall=!world.clear(q[0],q[1],0);
 cases.push({id:p.id,connected_rooms:rooms,work_targets:source.interaction_targets.length,reachable_samples:queue.length,wall_collision:wall,door_collision:closed});
}
console.log(JSON.stringify({cases}));
