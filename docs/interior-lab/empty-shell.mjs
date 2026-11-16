import clipping from '../vendor/polygon-clipping-0.15.7/index.mjs';
import {fittedHouseForEditing} from './fitted-house.mjs';
import {area} from './surface-edit.mjs';
const polygon=ring=>({type:'Polygon',coordinates:[[...ring,ring[0]]]}),copy=v=>structuredClone(v);
// Empty means no domestic furniture or speculative room partitions. The fixed staircase is
// architectural circulation; source floors and facade openings retain their exact coordinates.
export function emptyMarinaHouse(snapshot){
 const clean={...copy(snapshot),levels:snapshot.levels.map(f=>({...copy(f),rooms:[{kind:'open_plan',pts:copy(snapshot.footprint)}],objects:[],segments:(f.segments||[]).filter(w=>!Array.isArray(w)&&(w.structural||w.measured||w.shared)),openings:(f.openings||[]).filter(o=>o.entrance||o.rooms?.includes('outside')).map(o=>({...copy(o),rooms:[0,'outside']}))}))};
 const h=fittedHouseForEditing(clean);h.name='Empty Marina home';h.provenance.layout='Empty shell replacing the original systematic Marina fitted layout';h.provenance.empty_marina_legacy=true;
 if(h.storeys.length<2||h.stairs.length)return h;
 const shape=h.storeys[0].footprint,ring=shape.coordinates[0],xs=ring.map(p=>p[0]),zs=ring.map(p=>p[1]),maxRise=Math.max(...h.storeys.slice(0,-1).map((f,i)=>h.storeys[i+1].elevation_m-f.elevation_m)),maxN=Math.ceil(maxRise/.175),half=Math.ceil(maxN/2),tread=.27,width=1.05,gap=.12,landing=.95,L=half*tread+landing*2,W=width*2+gap;
 const angles=[...new Set([0,Math.PI/2,...ring.slice(1).flatMap((p,i)=>{const a=Math.atan2(p[1]-ring[i][1],p[0]-ring[i][0]);return[a,a+Math.PI/2];})].map(a=>Math.round((a%Math.PI)*1e8)/1e8))],entrances=h.storeys[0].openings;
 const box=(x,z,a,l,w)=>{const u=[Math.cos(a),Math.sin(a)],v=[-u[1],u[0]];return polygon([[-l/2,-w/2],[l/2,-w/2],[l/2,w/2],[-l/2,w/2]].map(([s,t])=>[x+s*u[0]+t*v[0],z+s*u[1]+t*v[1]].map(n=>Math.round(n*1e6)/1e6)));};
 let fit=null;
 // Search close to the boundary first, preserving the middle for the user's future rooms.
 const candidates=[];for(let x=Math.min(...xs)+.25;x<Math.max(...xs);x+=.5)for(let z=Math.min(...zs)+.25;z<Math.max(...zs);z+=.5)candidates.push([x,z]);candidates.sort((a,b)=>Math.min(a[0]-Math.min(...xs),Math.max(...xs)-a[0],a[1]-Math.min(...zs),Math.max(...zs)-a[1])-Math.min(b[0]-Math.min(...xs),Math.max(...xs)-b[0],b[1]-Math.min(...zs),Math.max(...zs)-b[1]));
 for(const [x,z]of candidates){for(const a of angles){const reserved=box(x,z,a,L,W);let outside;try{outside=clipping.difference(box(x,z,a,L+.2,W+.2).coordinates,shape.coordinates).reduce((n,p)=>n+area({type:'Polygon',coordinates:p}),0);}catch{continue;}if(outside>1e-6)continue;if(entrances.some(o=>{const p=o.segment.coordinates[0],q=o.segment.coordinates[1],mx=(p[0]+q[0])/2,mz=(p[1]+q[1])/2;return clipping.intersection(reserved.coordinates,box(mx,mz,Math.atan2(q[1]-p[1],q[0]-p[0]),o.width_m+1,2).coordinates).length;}))continue;fit={x,z,a};break;}if(fit)break;}
 if(!fit)throw Error('This footprint needs a verified stair position before its upper floors can be edited.');
 const {x,z,a}=fit,u=[Math.cos(a),Math.sin(a)],v=[-u[1],u[0]],at=(s,t)=>[x+s*u[0]+t*v[0],z+s*u[1]+t*v[1]].map(n=>Math.round(n*1e6)/1e6),part=(s0,s1,t0,t1)=>polygon([[s0,t0],[s1,t0],[s1,t1],[s0,t1]].map(([s,t])=>at(s,t))),start=-L/2+landing,far=start+half*tread;
 for(let i=0;i<h.storeys.length-1;i++){
  const f=h.storeys[i],next=h.storeys[i+1],rise=next.elevation_m-f.elevation_m,n=Math.ceil(rise/.175),first=Math.ceil(n/2),second=n-first,stepRise=rise/n,steps=[];
  for(let k=0;k<first;k++)steps.push({footprint:part(start+k*tread,start+(k+1)*tread,-W/2,-gap/2),top_m:f.elevation_m+(k+1)*stepRise});
  steps.push({footprint:part(start+Math.min(first,second)*tread,far+landing,-W/2,W/2),top_m:f.elevation_m+first*stepRise});
  for(let k=0;k<second;k++)steps.push({footprint:part(start+(second-k-1)*tread,start+(second-k)*tread,gap/2,W/2),top_m:f.elevation_m+(first+k+1)*stepRise});
  const hole=part(start,far+landing,-W/2,W/2),stair={id:`${h.id}:fixed-stair:${i}`,from_level:f.level,to_level:next.level,base_y_m:f.elevation_m,flight_width_m:width,riser_count:n,rise_m:stepRise,tread_m:tread,footprint:hole,steps,grade:'inferred',measured:false,structural:true};
  h.stairs.push(stair);next.slab_holes.push(copy(hole));const inside=clipping.difference(next.footprint.coordinates,...next.slab_holes.map(p=>p.coordinates));if(inside.length!==1)throw Error('The fixed stairs would disconnect this floor.');next.inside={type:'Polygon',coordinates:inside[0]};next.rooms[0].polygon=copy(next.inside);next.rooms[0].area_m2=area(next.inside);
 }
 h.provenance.stairs='Fixed inferred circulation within the source envelope; not a measured survey';return h;
}
