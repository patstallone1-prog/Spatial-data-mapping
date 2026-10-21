// Geometry-only finish selection: canonical outside walls keep their window cuts.
import {inPolygon,segmentDistance} from './tour-world.mjs';
export function wallRoom(floor,a,b,u){const L=Math.hypot(b[0]-a[0],b[1]-a[1]),x=a[0]+(b[0]-a[0])*u/L,z=a[1]+(b[1]-a[1])*u/L;
 let best=null,distance=Infinity;for(const r of floor.rooms){let d=inPolygon(x,z,r.polygon)?0:Infinity;
 for(const ring of r.polygon.coordinates)for(let i=0;i<ring.length-1;i++)d=Math.min(d,segmentDistance(x,z,ring[i],ring[i+1]));
 if(d<distance){best=r;distance=d;}}
 return best;
}
export function wallRoomCuts(floor,a,b){const dx=b[0]-a[0],dz=b[1]-a[1],L=Math.hypot(dx,dz),cuts=[];
 for(const room of floor.rooms)for(const ring of room.polygon.coordinates)for(const p of ring){
 const off=Math.abs((p[0]-a[0])*dz-(p[1]-a[1])*dx)/L,u=((p[0]-a[0])*dx+(p[1]-a[1])*dz)/L;
 if(off<.35&&u>.001&&u<L-.001)cuts.push(u);
 }return cuts;
}

// Sanitary/food-service tile follows the room's own wall hue throughout restaurants,
// including the portions hidden by equipment. House bathroom stone stays unchanged.
export function wallTileColour(house,paint){return house.style.usage==='restaurant'?paint:house.style.stone;}

export function wallCapColour(house,faceColour,interiorColour=null){return house.style.usage==='restaurant'?(interiorColour||faceColour):'#e8e4da';}
