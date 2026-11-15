// Convert a JSON snapshot of an existing fitted interior to the canonical local
// metre coordinates used by the editor and inferred-house renderer. The caller
// retains the original exterior shell; this adapter never invents its windows.
import clipping from '../vendor/polygon-clipping-0.15.7/index.mjs';

const clone = x => structuredClone(x);
const polygon = coordinates => ({type:'Polygon',coordinates});
const line = coordinates => ({type:'LineString',coordinates});
const closed = ring => { const out=ring.map(p=>[Number(p[0]),Number(p[1])]); if(out.length && (out[0][0]!==out.at(-1)[0]||out[0][1]!==out.at(-1)[1]))out.push([...out[0]]); return out; };
const area = ring => Math.abs(ring.slice(1).reduce((n,p,i)=>n+ring[i][0]*p[1]-p[0]*ring[i][1],0))/2;
const validRing = r => Array.isArray(r)&&r.length>=3&&r.every(p=>Array.isArray(p)&&p.length>=2&&p.slice(0,2).every(Number.isFinite));
const materials = color => ({wall:color||'#ded8ca',accent_wall:'#b5a28b',trim:'#e7e0d2',ceiling:'#eee9de',wood:'#94785d',fabric:'#b7ad9d',metal:'#76786f',countertop:'#d5d0c6',floor:'#b59c7e',floor_finish:'timber',roughness:.75});
const style = {id:'fitted',name:'Existing fitted interior',walls:['#ded8ca'],wood:'#94785d',fabric:'#b7ad9d',metal:'#76786f',stone:'#d5d0c6',accent:'#b5a28b',tier:'inferred'};
function inRing(p,ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;}
function objectFootprint(x,z,w,d,degrees){const t=degrees*Math.PI/180,c=Math.cos(t),s=Math.sin(t);return polygon([closed([[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2]].map(([a,b])=>[x+a*c-b*s,z+a*s+b*c]))]);}
function inRoom(p,r){return inRing(p,r.polygon.coordinates[0])&&!r.polygon.coordinates.slice(1).some(h=>inRing(p,h));}
function segmentRooms(a,b,rooms){const dx=b[0]-a[0],dz=b[1]-a[1],L=Math.hypot(dx,dz);if(!L)return [];const mid=[(a[0]+b[0])/2,(a[1]+b[1])/2],n=[-dz/L*.06,dx/L*.06];return [1,-1].map(sign=>rooms.find(r=>inRoom([mid[0]+n[0]*sign,mid[1]+n[1]*sign],r))?.id).filter((v,i,arr)=>v&&arr.indexOf(v)===i);}

/**
 * Snapshot coordinates are page-world x,z and world y; origin is [east,north],
 * matching mountGeneratedInterior. Each level supplies world-space room rings,
 * clipped wall segments, known opening segments and floor-supported furniture.
 * Furniture `position` is the bottom centre, `size` is its unrotated local box,
 * and `yaw` is its world Three.js Y rotation in radians. `asset`, if known,
 * is the canonical asset record; otherwise a procedural proxy is used and
 * recorded as such. Stair/ramp geometry, if supplied, is already canonical.
 */
export function fittedHouseForEditing(snapshot) {
 const {id,origin,footprint:worldFootprint,levels,floorY=0,stairs=[],ramps=[],windows=[]}=snapshot||{};
 if(!id||!Array.isArray(origin)||origin.length!==2||!origin.every(Number.isFinite)||!validRing(worldFootprint)||!Array.isArray(levels)||!levels.length||!Number.isFinite(floorY))throw Error('A building ID, world origin, footprint and fitted floor snapshots are required');
 const local=([x,z])=>[x-origin[0],-z-origin[1]], base=closed(worldFootprint.map(local));
 if(area(base)<.01)throw Error('The building footprint has no usable area');
 const footprint=polygon([base]);
 const house={schema:'kerbside.inferred_house/1',id:String(id),name:'Existing fitted home',units:'metres',coordinates:'local XY floor plane; object position is [x, elevation, y]',grade:'inferred',measured:false,confidence:.25,style:clone(style),envelope:{windows:clone(windows)},stairs:clone(stairs),ramps:clone(ramps),provenance:{layout:'Existing fitted plan clipped to the building footprint; not a measured survey',footprint:'Existing building outline',not_an_as_built_survey:true,source_snapshot:clone(snapshot.metadata||{})},storeys:[]};
 for(const [index,source] of levels.entries()){
  const level=source.level??index, elevation=source.elevation??0,height=source.height;
  if(!Number.isInteger(level)||!Number.isFinite(elevation)||!Number.isFinite(height)||height<=0||!Array.isArray(source.rooms)||!Array.isArray(source.segments))throw Error('Each floor needs its level, elevation, height, rooms and wall segments');
  if(house.storeys.some(f=>f.level===level))throw Error('Floor levels must be unique');
  const f={level,elevation_m:elevation,height_m:height,footprint:clone(footprint),inside:clone(footprint),slab_holes:clone(source.slabHoles||[]),rooms:[],walls:[],openings:[],objects:[]};
  const roomMap=new Map();
  for(const [i,r] of source.rooms.entries()){
   if(!validRing(r.pts))throw Error(`Room ${i} has invalid world coordinates`);
   const parts=clipping.intersection([closed(r.pts.map(local))],[base]);
   const ids=[];for(const [part,poly] of parts.entries()){if(!poly[0]||area(poly[0])<.001)continue;const rid=`${id}:L${level}:R${i}${part?`:part${part}`:''}`;ids.push(rid);f.rooms.push({id:rid,kind:r.kind||'room',polygon:polygon(poly),area_m2:area(poly[0])-poly.slice(1).reduce((n,ring)=>n+area(ring),0),materials:materials(typeof r.color==='string'?r.color:null),grade:'inferred',measured:false,confidence:.25,...(r.unitId?{unit_id:r.unitId}:{})});}roomMap.set(i,ids);
  }
  for(const [i,entry] of source.segments.entries()){
   const s=Array.isArray(entry)?entry:entry?.coordinates;
   if(!Array.isArray(s)||s.length!==4||!s.every(Number.isFinite))throw Error(`Wall segment ${i} is invalid`);
   const a=local([s[0],s[1]]),b=local([s[2],s[3]]);if(Math.hypot(b[0]-a[0],b[1]-a[1])<.001)continue;
   // Fitted partitions are editable game geometry; explicitly protected boundaries stay protected.
   const protectedBoundary=!Array.isArray(entry)&&(entry.structural===true||entry.shared===true||entry.exterior===true||entry.measured===true);
   f.walls.push({segment:line([a,b]),thickness_m:.1,height_m:height,materials:['#ded8ca','#ded8ca'],rooms:segmentRooms(a,b,f.rooms),structural:protectedBoundary,structural_status:entry.structural_status||'unverified_game_partition',grade:'inferred',measured:entry.measured===true,...(entry.shared?{shared:true}:{}),...(entry.exterior?{exterior:true}:{})});
  }
  for(const [i,o] of (source.openings||[]).entries()){
   if(!Array.isArray(o.segment)||o.segment.length!==2||!o.segment.every(p=>Array.isArray(p)&&p.slice(0,2).every(Number.isFinite)))throw Error(`Opening ${i} needs its actual world-space segment`);
   const [a,b]=o.segment.map(local),width=Math.hypot(b[0]-a[0],b[1]-a[1]);if(width<.001)throw Error(`Opening ${i} has no width`);
   let adjacent=Array.isArray(o.rooms)?o.rooms.flatMap(r=>r==='outside'?['outside']:(roomMap.get(r)||[])):segmentRooms(a,b,f.rooms);
   if(o.entrance&&!adjacent.includes('outside'))adjacent.push('outside');
   f.openings.push({id:`${id}:L${level}:opening${i}`,segment:line([a,b]),rooms:adjacent,type:o.type||'doorway',width_m:width,height_m:o.height||2.1,leaf_count:o.leaf_count||0,entrance:!!o.entrance,grade:'inferred',measured:false});
  }
  for(const [i,o] of (source.objects||[]).entries()){
   if(!o.role||!Array.isArray(o.position)||o.position.length!==3||!o.position.every(Number.isFinite)||!Array.isArray(o.size)||o.size.length!==3||!o.size.every(n=>Number.isFinite(n)&&n>0)||!Number.isFinite(o.yaw))throw Error(`Furniture ${i} needs role, bottom position, local size and yaw`);
   const [x,z]=local([o.position[0],o.position[2]]),rotation=o.yaw*180/Math.PI,p=[x,o.position[1]-floorY,z],room=f.rooms.find(r=>inRoom([x,z],r));
   if(!room)throw Error(`Furniture ${i} is outside the fitted rooms`);
   const asset=o.asset?clone(o.asset):{id:`procedural:${o.role}`,role:o.role,procedural:true};
   f.objects.push({id:`${id}:L${level}:item${i}`,role:o.role,position_m:p,size_m:[...o.size],rotation_deg:rotation,footprint:objectFootprint(x,z,o.size[0],o.size[2],rotation),room_id:room.id,support:{kind:'floor',id:room.id,surface_y_m:p[1]},asset,materials:clone(room.materials),grade:'inferred',measured:false});
  }
  house.storeys.push(f);
 }
 return house;
}
