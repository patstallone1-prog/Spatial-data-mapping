// Pure geometry used by keyboard walking and by the regression probes.
export function inRing(x,z,ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){
 const a=ring[i],b=ring[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;}
export function inPolygon(x,z,p){return inRing(x,z,p.coordinates[0])&&!p.coordinates.slice(1).some(r=>inRing(x,z,r));}
export function segmentDistance(x,z,a,b){const dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz||1)));return Math.hypot(x-a[0]-t*dx,z-a[1]-t*dz);}
export class TourWorld {
 constructor(house,doors=[]){this.house=house;this.doors=doors;this.radius=.25;}
 level(feet){return this.house.storeys.filter(f=>f.elevation_m<=feet+.22).at(-1)||this.house.storeys[0];}
 surface(x,z,feet){let best=null;for(const f of this.house.storeys)if(f.elevation_m<=feet+.22&&inPolygon(x,z,f.inside)&&!(f.slab_holes||[]).some(p=>inPolygon(x,z,p)))best=f.elevation_m;
 for(const stair of this.house.stairs)for(const s of stair.steps)if(s.top_m<=feet+.22&&(inPolygon(x,z,s.footprint)||s.footprint.coordinates[0].slice(1).some((b,i)=>segmentDistance(x,z,s.footprint.coordinates[0][i],b)<1e-5))&&(best===null||s.top_m>best))best=s.top_m;
 return best;
 }
 clear(x,z,feet){const f=this.level(feet),r=this.radius;
 if(!inPolygon(x,z,f.inside))return false;
 // A window stays a wall at walking height. Balconies need an evidenced door to be walkable.
 for(const ring of f.inside.coordinates)for(let i=0;i<ring.length-1;i++)if(segmentDistance(x,z,ring[i],ring[i+1])<r)return false;
 for(const w of f.walls){const c=w.segment.coordinates;for(let i=0;i<c.length-1;i++)if(segmentDistance(x,z,c[i],c[i+1])<r+.05)return false;}
 for(const o of f.objects)if(o.support.kind==='floor'&&o.position_m[1]+o.size_m[1]>feet+.18){
  if(inPolygon(x,z,o.footprint))return false;const ring=o.footprint.coordinates[0];for(let i=0;i<ring.length-1;i++)if(segmentDistance(x,z,ring[i],ring[i+1])<r)return false;
 }
 for(const stair of this.house.stairs)if(stair.guard_segment&&(stair.from_level===f.level||stair.to_level===f.level))if(segmentDistance(x,z,...stair.guard_segment.coordinates)<r+.03)return false;
 for(const door of this.doors)if(door.level===f.level&&!door.open&&door.segment&&segmentDistance(x,z,...door.segment)<r+.025)return false;
 return true;
 }
 move(position,dx,dz){let p={...position};const n=Math.max(1,Math.ceil(Math.hypot(dx,dz)/.08));
 const attempt=(x,z)=>{const y=this.surface(x,z,p.y);if(y!==null&&Math.abs(y-p.y)<.3&&this.clear(x,z,y)){p={x,z,y};return true;}return false;};
 for(let i=0;i<n;i++){
  if(attempt(p.x+dx/n,p.z+dz/n))continue;
  attempt(p.x+dx/n,p.z);attempt(p.x,p.z+dz/n);
 }return p;}
 viewYaw(p){const f=this.level(p.y);let best={distance:-1,yaw:0};
 for(let i=0;i<48;i++){const yaw=i*Math.PI/24;let d=.15;
  for(;d<10;d+=.1){const x=p.x-Math.sin(yaw)*d,z=p.z-Math.cos(yaw)*d;
   if(!inPolygon(x,z,f.inside)||f.walls.some(w=>segmentDistance(x,z,w.segment.coordinates[0],w.segment.coordinates.at(-1))<.08)||f.objects.some(o=>o.position_m[1]+o.size_m[1]>p.y+1.35&&inPolygon(x,z,o.footprint)))break;
  }if(d>best.distance)best={distance:d,yaw};
 }return best.yaw;
 }
 spawn(level=0,roomId=null){const f=this.house.storeys[level],rooms=roomId?f.rooms.filter(r=>r.id===roomId):[...f.rooms].sort((a,b)=>(a.kind==='hallway'?-1:0)-(b.kind==='hallway'?-1:0));
 for(const room of rooms){const ring=room.polygon.coordinates[0],xs=ring.map(p=>p[0]),zs=ring.map(p=>p[1]);
  const points=[];for(let x=Math.min(...xs)+.35;x<Math.max(...xs);x+=.22)for(let z=Math.min(...zs)+.35;z<Math.max(...zs);z+=.22)if(inPolygon(x,z,room.polygon)&&this.surface(x,z,f.elevation_m)===f.elevation_m&&this.clear(x,z,f.elevation_m))points.push({x,z,y:f.elevation_m});
  if(points.length){const entrance=f.openings.find(o=>o.entrance),line=entrance?.segment.coordinates;const c=line?[(line[0][0]+line[1][0])/2,(line[0][1]+line[1][1])/2]:[ring.reduce((s,p)=>s+p[0],0)/ring.length,ring.reduce((s,p)=>s+p[1],0)/ring.length];points.sort((a,b)=>Math.hypot(a.x-c[0],a.z-c[1])-Math.hypot(b.x-c[0],b.z-c[1]));return points[0];}
 }throw Error('No clear standing position on this floor');}
}
