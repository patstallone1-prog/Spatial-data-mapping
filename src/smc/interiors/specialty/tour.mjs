import {TourWorld,inPolygon} from '../../../../docs/inferred-interiors/tour-world.mjs';

// The renderer reserves a service assembly's full working area; walking collides
// with its actual counter/chair parts and with the current position of each door leaf.
export function createSpecialtyTour(plan,renderDoors=[]){
 const proxy=structuredClone(plan);
 for(const f of proxy.storeys)f.objects=f.objects.flatMap(o=>(o.collision_polygons||[o.footprint]).map(footprint=>({...o,footprint})));
 const doors=renderDoors.map(d=>({level:d.level,open:false,get segment(){
  return d.open?d.openSegment:d.segment;
 }}));
 return new TourWorld(proxy,doors);
}

export function initialShopYaw(tour,position,roomId=null){
 const f=tour.level(position.y),room=f.rooms.find(r=>roomId?r.id===roomId:inPolygon(position.x,position.z,r.polygon));
 if(roomId&&['utility','toilet'].includes(room?.kind)){
  const items=f.objects.filter(o=>o.room_id===roomId),x=items.reduce((s,o)=>s+o.position_m[0],0)/items.length,z=items.reduce((s,o)=>s+o.position_m[2],0)/items.length;
  if(items.length)return Math.atan2(position.x-x,z-position.z);
 }
 let best=-1,result=0;
 for(let i=0;i<48;i++){
  const angle=i*Math.PI/24,dx=Math.cos(angle),dz=Math.sin(angle);let distance=.1;
  for(;distance<10;distance+=.1){const x=position.x+dx*distance,z=position.z+dz*distance;
   if((room&&!inPolygon(x,z,room.polygon))||!tour.clear(x,z,position.y))break;
  }
  if(distance>best){best=distance;result=Math.atan2(-dx,dz);}
 }
 return result;
}

export function shopSpawn(tour,roomId=null){
 const start=tour.spawn(0,roomId),f=tour.level(start.y),room=f.rooms.find(r=>r.id===roomId);
 if(!room||!['utility','toilet'].includes(room.kind))return start;
 const pts=room.polygon.coordinates[0],xs=pts.map(q=>q[0]),zs=pts.map(q=>q[1]);let best=start,distance=-1;
 // Area teleports start beyond the threshold, facing back toward the fittings.
 // The normal walk entrance still starts beside the public entrance.
 for(let x=Math.min(...xs)+.35;x<Math.max(...xs);x+=.22)for(let z=Math.min(...zs)+.35;z<Math.max(...zs);z+=.22){
  const d=Math.hypot(x-start.x,z-start.z);
  if(d>distance&&inPolygon(x,z,room.polygon)&&tour.clear(x,z,start.y)){distance=d;best={x,z,y:start.y};}
 }
 return best;
}
