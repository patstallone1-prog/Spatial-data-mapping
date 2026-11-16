// Reversible surface edits share the canonical geometry used by the renderer and world.
import clipping from '../vendor/polygon-clipping-0.15.7/index.mjs';
import {isBusiness,protectedArea,fixedObject} from './profiles.mjs';
export const FLOOR_FINISHES = [
 {id:'oak',name:'Natural oak',finish:'timber',color:'#b99a71'},
 {id:'walnut',name:'Warm walnut',finish:'timber',color:'#795843'},
 {id:'ivory_tile',name:'Ivory tile',finish:'tile',color:'#dfdbcd'},
 {id:'slate_tile',name:'Slate tile',finish:'tile',color:'#737f81'},
 {id:'concrete',name:'Polished concrete',finish:'concrete',color:'#aeb5b3'},
 {id:'sage_carpet',name:'Sage carpet',finish:'carpet',color:'#819884'},
 {id:'sand_carpet',name:'Sand carpet',finish:'carpet',color:'#c8b699'},
 {id:'terracotta',name:'Terracotta tile',finish:'tile',color:'#bd8469'}
];
export const WALL_ITEMS = [
 {id:'studio:artwork',name:'Framed landscape',role:'wall_art',dimensions_m:[.9,.65,.045],procedural:true,license:'Kerbside procedural geometry',mount:'wall'},
 {id:'studio:shelf',name:'Floating shelf & books',role:'wall_shelf',dimensions_m:[1,.3,.25],procedural:true,license:'Kerbside procedural geometry',mount:'wall'},
 {id:'studio:mirror',name:'Wall mirror',role:'wall_mirror',dimensions_m:[.7,1,.045],procedural:true,license:'Kerbside procedural geometry',mount:'wall'},
 {id:'studio:window-display',name:'Window display plinth',role:'window_display',dimensions_m:[1.2,.8,.5],procedural:true,license:'Kerbside procedural geometry',mount:'display'}
];
export const clone = v => structuredClone(v);
export const polygon = r => ({type:'Polygon',coordinates:[r]});
export const rectangle = (a,b) => {const x0=Math.min(a[0],b[0]),x1=Math.max(a[0],b[0]),z0=Math.min(a[1],b[1]),z1=Math.max(a[1],b[1]);return polygon([[x0,z0],[x1,z0],[x1,z1],[x0,z1],[x0,z0]]);};
const ringArea = r => Math.abs(r.slice(1).reduce((n,p,i)=>n+r[i][0]*p[1]-p[0]*r[i][1],0))/2;
export const area = p => ringArea(p.coordinates[0])-p.coordinates.slice(1).reduce((n,r)=>n+ringArea(r),0);
const multiArea = p => p.reduce((n,coordinates)=>n+area({type:'Polygon',coordinates}),0);
export function containsShape(p,q){return Math.abs(multiArea(clipping.intersection(p.coordinates,q.coordinates))-area(p))<1e-5;}
export const pointDistance=(p,a,b)=>{const dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/(dx*dx+dz*dz||1)));return Math.hypot(p[0]-a[0]-dx*t,p[1]-a[1]-dz*t);};
export function inShape(p,g){let yes=false;for(const [k,r]of g.coordinates.entries()){let inside=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[i],b=r[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;}if(k===0)yes=inside;else if(inside)return false;}return yes;}
const closed = r => [...r,r[0]];
const line = (a,b) => ({type:'LineString',coordinates:[a,b]});
export function objectFootprint(o){const[x,,z]=o.position_m,[w,,d]=o.size_m,t=o.rotation_deg*Math.PI/180,c=Math.cos(t),s=Math.sin(t);return polygon(closed([[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2]].map(([a,b])=>[x+a*c-b*s,z+a*s+b*c])));}
export const windowsEditable = h => isBusiness(h)||h.envelope?.window_editing_verified===true;
export function wallInfo(h,f,selection){
 if(selection?.type==='wall'){const w=f.walls[selection.index];if(!w)return null;return{a:w.segment.coordinates[0],b:w.segment.coordinates.at(-1),rooms:w.rooms||[],wall:w,index:selection.index,exterior:false};}
 if(selection?.type==='exterior'||selection?.type==='window'){
  const w=selection.type==='window'?h.envelope?.windows?.[selection.index]:null,edge=w?.edge??selection.edge,r=f.footprint.coordinates[0];if(!r[edge]||!r[edge+1])return null;
  return{a:r[edge],b:r[edge+1],rooms:f.rooms.map(r=>r.id),edge,exterior:true};
 }return null;
}
export function wallEditable(w){return w&&!w.exterior&&!w.measured&&!w.structural&&!w.load_bearing&&!w.shared&&!w.shared_unit&&w.rooms?.length===2&&!/structural|exterior|party|shared/.test(w.kind||w.type||'');}
export function nearestWall(h,f,p){let best=null,distance=Infinity;const candidates=f.walls.map((_,index)=>wallInfo(h,f,{type:'wall',index}));for(let edge=0;edge<f.footprint.coordinates[0].length-1;edge++)candidates.push(wallInfo(h,f,{type:'exterior',edge}));for(const w of candidates){const d=pointDistance(p,w.a,w.b);if(d<distance){distance=d;best=w;}}return best;}
export function remapFloorRegions(f,rooms){
 const ids=new Set(rooms.map(r=>r.id)),regions=[];
 for(const region of f.finish_regions||[]){if(!ids.has(region.room_id)){regions.push(region);continue;}let count=0;for(const r of rooms)for(const coordinates of clipping.intersection(region.polygon.coordinates,r.polygon.coordinates)){const p={type:'Polygon',coordinates};if(area(p)>.0001)regions.push({...clone(region),id:count++?region.id+':'+r.id:region.id,room_id:r.id,polygon:p});}}
 if(f.finish_regions)f.finish_regions=regions;
}
function remapRooms(f,rooms){
 const ids=new Set(rooms.map(r=>r.id));for(const o of f.objects.filter(o=>ids.has(o.room_id))){const r=rooms.find(r=>containsShape(o.footprint,r.polygon));if(r){const old=o.room_id;o.room_id=r.id;if(o.support?.id===old)o.support.id=r.id;}}
 const touches=(r,p)=>inShape(p,r.polygon)||r.polygon.coordinates.some(ring=>ring.slice(1).some((b,i)=>pointDistance(p,ring[i],b)<1e-6));
 for(const o of [...f.openings,...f.walls]){if(!o.rooms?.some(id=>ids.has(id)))continue;const[a,b]=o.segment.coordinates,mid=[(a[0]+b[0])/2,(a[1]+b[1])/2],touch=rooms.filter(r=>touches(r,mid));if(o.rooms.filter(id=>ids.has(id)).length===1&&touch.length===1){const old=o.rooms.find(id=>ids.has(id));o.rooms=o.rooms.map(id=>id===old?touch[0].id:id);if(o.swing_into===old)o.swing_into=touch[0].id;}}
 remapFloorRegions(f,rooms);
}
function verifyRoomAccess(f,w){if(!wallEditable(w))throw Error('Exterior, structural and shared walls stay fixed.');const rooms=w.rooms.map(id=>f.rooms.find(r=>r.id===id));if(rooms.some(r=>!r||/stair/.test(r.kind)||protectedArea({schema:'kerbside.inferred_business/1'},r)))throw Error('Stair, parking and access boundaries stay fixed.');return rooms;}
function moveWall(h,f,a){
 const w=f.walls[a.index],rooms=verifyRoomAccess(f,w),pair=rooms.map(r=>r.id);if(f.walls.some(w=>pair.every(id=>w.rooms?.includes(id))&&!wallEditable(w)))throw Error('This boundary contains a protected wall.');
 const [p,q]=w.segment.coordinates,dx=q[0]-p[0],dz=q[1]-p[1],L=Math.hypot(dx,dz),n=[-dz/L,dx/L],offset=a.offset_m;if(!Number.isFinite(offset)||Math.abs(offset)>30)throw Error('Choose a finite wall displacement.');
 const merged=clipping.union(...rooms.map(r=>r.polygon.coordinates));if(merged.length!==1)throw Error('These rooms do not share one usable boundary.');
 // Clip the union against the translated dividing line; supports angled and holed rooms.
 const all=merged[0][0],span=Math.max(...all.map(p=>Math.hypot(p[0]-all[0][0],p[1]-all[0][1])))*4+20,u=[dx/L,dz/L],c=[p[0]+n[0]*offset,p[1]+n[1]*offset];
 const at=(x,y)=>[c[0]+u[0]*x+n[0]*y,c[1]+u[1]*x+n[1]*y];
 const cut=side=>clipping.intersection(merged,[closed([at(-span,0),at(span,0),at(span,side*span),at(-span,side*span)])]);
 const halves=[cut(1),cut(-1)];if(halves.some(x=>x.length!==1||multiArea(x)<.1))throw Error('The moved wall must leave two connected rooms.');
 const centre=r=>r.polygon.coordinates[0].slice(0,-1).reduce((p,q,_,arr)=>[p[0]+q[0]/arr.length,p[1]+q[1]/arr.length],[0,0]);const positive=(centre(rooms[0])[0]-p[0])*n[0]+(centre(rooms[0])[1]-p[1])*n[1]>=0;
 rooms.forEach((r,i)=>{r.polygon={type:'Polygon',coordinates:halves[(i===0)===positive?0:1][0]};r.area_m2=area(r.polygon);});
 const projections=[];for(let i=0;i<all.length-1;i++){const a=all[i],b=all[i+1],sa=(a[0]-c[0])*n[0]+(a[1]-c[1])*n[1],sb=(b[0]-c[0])*n[0]+(b[1]-c[1])*n[1];if(sa*sb<0||Math.abs(sa)<1e-8){const t=Math.abs(sa)<1e-8?0:sa/(sa-sb),x=a[0]+(b[0]-a[0])*t,z=a[1]+(b[1]-a[1])*t;projections.push((x-c[0])*u[0]+(z-c[1])*u[1]);}}
 const ends=[...new Set(projections.map(x=>Math.round(x*1e6)/1e6))].sort((a,b)=>a-b);if(ends.length!==2)throw Error('This boundary would divide disconnected floor sections.');
 const shared=f.openings.filter(o=>pair.every(id=>o.rooms?.includes(id)));if(shared.some(o=>o.measured))throw Error('A measured opening on this wall is fixed.');
 const ranges=shared.map(o=>{const mid=o.segment.coordinates.reduce((p,q)=>[p[0]+q[0]/2,p[1]+q[1]/2],[0,0]),t=(mid[0]-p[0])*u[0]+(mid[1]-p[1])*u[1],width=o.width_m,centre=Math.max(ends[0]+width/2+.12,Math.min(ends[1]-width/2-.12,t));o.segment=line(at(centre-width/2,0),at(centre+width/2,0));o.clearance=polygon(closed([at(centre-width/2,-.45),at(centre+width/2,-.45),at(centre+width/2,.45),at(centre-width/2,.45)]));return[centre-width/2,centre+width/2];}).sort((a,b)=>a[0]-b[0]);
 let from=ends[0];const walls=[];for(const range of [...ranges,[ends[1],ends[1]]]){if(range[0]-from>.01)walls.push({...clone(w),segment:line(at(from,0),at(range[0],0)),lab_partition:true,lab_original_polygon:undefined,lab_split_polygons:undefined});from=range[1];}
 f.walls=f.walls.filter(w=>!pair.every(id=>w.rooms?.includes(id))).concat(walls);
 for(const o of f.objects.filter(o=>o.support?.kind==='wall'&&o.support.wall&&pointDistance([o.position_m[0],o.position_m[2]],p,q)<.5)){o.position_m[0]+=n[0]*offset;o.position_m[2]+=n[1]*offset;o.support.wall.a=o.support.wall.a.map((x,i)=>x+n[i]*offset);o.support.wall.b=o.support.wall.b.map((x,i)=>x+n[i]*offset);o.footprint=objectFootprint(o);}
 remapRooms(f,rooms);
}
function createRoom(h,f,a){
 const r=f.rooms.find(r=>r.id===a.id),region=a.polygon;if(!r||!region||!containsShape(region,r.polygon))throw Error('Draw the room entirely within one existing room.');
 const rest=clipping.difference(r.polygon.coordinates,region.coordinates);if(rest.length!==1||multiArea(rest)<.1)throw Error('Leave one connected usable area outside the new room.');
 if(!a.newRoomId||f.rooms.some(r=>r.id===a.newRoomId))throw Error('The new room needs a unique identity.');
 const original=clone(r.polygon),n={...clone(r),id:a.newRoomId,kind:a.kind||'office',polygon:clone(region),area_m2:area(region)};r.polygon={type:'Polygon',coordinates:rest[0]};r.area_m2=area(r.polygon);f.rooms.push(n);
 const ring=region.coordinates[0],segments=[];for(let i=0;i<ring.length-1;i++){const p=ring[i],q=ring[i+1],L=Math.hypot(q[0]-p[0],q[1]-p[1]),mid=[(p[0]+q[0])/2,(p[1]+q[1])/2],nx=-(q[1]-p[1])/L*.04,nz=(q[0]-p[0])/L*.04;if(inShape([mid[0]+nx,mid[1]+nz],original)&&inShape([mid[0]-nx,mid[1]-nz],original))segments.push({p,q,L});}
 const door=segments.filter(s=>s.L>1.06).sort((a,b)=>b.L-a.L)[0];if(!door)throw Error('Leave enough shared boundary for an accessible doorway.');
 for(const s of segments){const {p,q,L}=s,u=[(q[0]-p[0])/L,(q[1]-p[1])/L],at=t=>[p[0]+u[0]*t,p[1]+u[1]*t],parts=s===door?[[0,L/2-.4075],[L/2+.4075,L]]:[[0,L]];for(const [lo,hi]of parts)f.walls.push({segment:line(at(lo),at(hi)),rooms:[r.id,n.id],height_m:f.height_m,thickness_m:.1,materials:[r.materials.wall,n.materials.wall],lab_partition:true,grade:'inferred',measured:false});if(s===door){const privateRoom=/office|bed|bath|toilet|treatment|examination/.test(n.kind),lo=at(L/2-.4075),hi=at(L/2+.4075),nx=-u[1]*.45,nz=u[0]*.45;f.openings.push({id:n.id+':door',segment:line(lo,hi),rooms:[r.id,n.id],width_m:.815,height_m:2.1,type:privateRoom?'single_door':'doorway',leaf_count:privateRoom?1:0,lab_partition:true,clearance:polygon(closed([[lo[0]+nx,lo[1]+nz],[hi[0]+nx,hi[1]+nz],[hi[0]-nx,hi[1]-nz],[lo[0]-nx,lo[1]-nz]])),grade:'inferred',measured:false});}}
 remapRooms(f,[r,n]);
}
export function mountedObject(h,f,selection,asset,point,id){
 const w=wallInfo(h,f,selection);if(!w)throw Error('Choose a wall first.');const dx=w.b[0]-w.a[0],dz=w.b[1]-w.a[1],L=Math.hypot(dx,dz),u=[dx/L,dz/L],normal=[-u[1],u[0]],size=asset.dimensions_m,t=Math.max(size[0]/2+.06,Math.min(L-size[0]/2-.06,((point?.[0]??(w.a[0]+w.b[0])/2)-w.a[0])*u[0]+((point?.[1]??(w.a[1]+w.b[1])/2)-w.a[1])*u[1]));
 if(L<size[0]+.12)throw Error('Choose a smaller item for this wall.');
 const centre=[w.a[0]+u[0]*t,w.a[1]+u[1]*t];let room,sign;for(const side of[1,-1]){const r=f.rooms.find(r=>w.rooms.includes(r.id)&&inShape([centre[0]+normal[0]*side*.18,centre[1]+normal[1]*side*.18],r.polygon));if(r){room=r;sign=side;break;}}if(!room)throw Error('Choose the wall from inside an editable room.');
 const n=normal.map(x=>x*sign),rotation=Math.atan2(-n[0],n[1])*180/Math.PI,y=f.elevation_m+Math.min(1.4,f.height_m-size[1]-.1),o={id,role:asset.role,asset:clone(asset),position_m:[centre[0]+n[0]*(size[2]/2+.075),y,centre[1]+n[1]*(size[2]/2+.075)],size_m:[...size],rotation_deg:rotation,room_id:room.id,support:{kind:'wall',id:room.id,wall:{a:clone(w.a),b:clone(w.b)}},materials:clone(room.materials),grade:'inferred',measured:false,confidence:.25};o.footprint=objectFootprint(o);return o;
}
export function applySurfaceAction(h,f,a){
 if(a.type==='move-wall'){moveWall(h,f,a);return true;}
 if(a.type==='create-room'){createRoom(h,f,a);return true;}
 if(a.type==='replace-object'){
  const old=f.objects.find(o=>o.id===a.id);if(!old||fixedObject(old))throw Error('This fixture cannot be replaced.');const replacement={...clone(old),id:a.object.id,asset:clone(a.object.asset),size_m:clone(a.object.size_m),role:a.object.role};delete replacement.collision_polygons;delete replacement.interaction_point_m;replacement.footprint=objectFootprint(replacement);if(f.objects.some(o=>o.id===replacement.id))throw Error('The replacement needs a unique ID.');f.objects=f.objects.map(o=>o===old?replacement:o);for(const child of f.objects.filter(o=>o.support?.id===old.id)){child.support.id=replacement.id;child.position_m[1]+=replacement.size_m[1]-old.size_m[1];child.support.surface_y_m=child.position_m[1];child.footprint=objectFootprint(child);}return true;
 }
 if(a.type==='set-floor-material'){const r=f.rooms.find(r=>r.id===a.id),finish=FLOOR_FINISHES.find(x=>x.id===a.material);if(!r||!finish)throw Error('Choose a floor material.');r.materials={...r.materials,floor:finish.color,floor_finish:finish.finish};return true;}
 if(a.type==='set-floor-region'){
  const r=f.rooms.find(r=>r.id===a.id),finish=FLOOR_FINISHES.find(x=>x.id===a.material);if(!r||!finish||!a.polygon||!containsShape(a.polygon,r.polygon)||area(a.polygon)<.0624)throw Error('Select at least one floor square inside one room.');
  f.finish_regions ||= [];if(f.finish_regions.length>=200)throw Error('This floor already has 200 material areas.');const old=f.finish_regions.findIndex(r=>r.id===a.regionId),region={id:a.regionId,room_id:r.id,polygon:clone(a.polygon),material:finish.id,finish:finish.finish,color:finish.color,kind:a.carpet?'carpet':'material',grade:'inferred',measured:false};if(a.carpet&&!/carpet/.test(finish.finish))throw Error('Choose a carpet material.');if(old<0)f.finish_regions.push(region);else f.finish_regions[old]=region;return true;
 }
 if(a.type==='remove-floor-region'){f.finish_regions=(f.finish_regions||[]).filter(r=>r.id!==a.regionId);return true;}
 if(['add-window','update-window','remove-window'].includes(a.type)){
  if(!windowsEditable(h))throw Error('House windows are locked until the building is verified.');h.envelope ||= {};h.envelope.windows ||= [];
  if(a.type==='remove-window'){if(!h.envelope.windows[a.index])throw Error('Window not found.');h.envelope.windows.splice(a.index,1);}
  else if(a.type==='add-window')h.envelope.windows.push({...clone(a.window),id:a.window.id,kind:'window',grade:'user_edit',measured:false,confidence:.25});
  else{const o=h.envelope.windows[a.index];if(!o)throw Error('Window not found.');for(const key of['u','v','w','h','edge','design'])if(a.window[key]!==undefined)o[key]=clone(a.window[key]);o.kind='window';o.grade='user_edit';o.measured=false;delete o.a;delete o.b;}
  h.envelope.windows_customized=true;return true;
 }return false;
}
export function validateSurfaceEdits(h,original){
 const issues=[],add=(code,message,level,id)=>issues.push({code,message,level,id,severity:'error'});
 if(h.envelope?.window_editing_verified!==original.envelope?.window_editing_verified)add('window-permission','Window verification cannot be changed in the editor.');
 for(const f of h.storeys){
  const regions=f.finish_regions||[];if(!Array.isArray(regions)||regions.length>200){add('floor-region','Too many floor material areas.',f.level);continue;}
  const ids=new Set();for(const region of regions){const r=f.rooms.find(r=>r.id===region.room_id),material=FLOOR_FINISHES.find(m=>m.id===region.material);if(!region.id||ids.has(region.id)||!r||!material||material.color!==region.color||material.finish!==region.finish||!containsShape(region.polygon,r.polygon)||area(region.polygon)<.0001||protectedArea(h,r))add('floor-region','Keep each material area inside an editable room.',f.level,region.id);ids.add(region.id);}
  for(const o of f.objects.filter(o=>o.support?.kind==='wall'&&o.support.wall)){const w=o.support.wall,p=[o.position_m[0],o.position_m[2]],r=f.rooms.find(r=>r.id===o.room_id),actual=nearestWall(h,f,p);if(!r||!actual||pointDistance(p,actual.a,actual.b)>o.size_m[2]/2+.13||pointDistance(w.a,actual.a,actual.b)>.01||pointDistance(w.b,actual.a,actual.b)>.01)add('wall-support','Keep mounted items attached to an existing wall.',f.level,o.id);if(actual?.exterior){const length=Math.hypot(actual.b[0]-actual.a[0],actual.b[1]-actual.a[1]),project=p=>((p[0]-actual.a[0])*(actual.b[0]-actual.a[0])+(p[1]-actual.a[1])*(actual.b[1]-actual.a[1]))/length,ts=o.footprint.coordinates[0].map(project),lo=Math.min(...ts),hi=Math.max(...ts);for(const cut of [...(h.envelope?.windows||[]).filter(w=>w.edge===actual.edge),...f.openings.filter(x=>x.entrance&&x.segment.coordinates.every(p=>pointDistance(p,actual.a,actual.b)<.1)).map(x=>({u:Math.min(...x.segment.coordinates.map(project)),w:x.width_m,v:f.elevation_m,h:x.height_m}))])if(lo<cut.u+cut.w&&hi>cut.u&&o.position_m[1]<cut.v+cut.h&&o.position_m[1]+o.size_m[1]>cut.v)add('wall-opening','Mount items on solid wall, clear of doors and windows.',f.level,o.id);}for(const other of f.objects)if(other!==o&&other.support?.kind==='wall'&&String(other.id)<String(o.id)&&o.position_m[1]<other.position_m[1]+other.size_m[1]&&o.position_m[1]+o.size_m[1]>other.position_m[1]&&multiArea(clipping.intersection(o.footprint.coordinates,other.footprint.coordinates))>.0001)add('wall-item-overlap','Leave space between wall-mounted items.',f.level,o.id);}
 }
 if(!windowsEditable(original)&&JSON.stringify(h.envelope?.windows)!==JSON.stringify(original.envelope?.windows))add('windows-locked','House windows are locked until verified.');
 if(windowsEditable(original)){
  const windows=h.envelope?.windows||[];if(!Array.isArray(windows)||windows.length>250)add('window-size','A building supports at most 250 windows.');else for(const [index,w]of windows.entries()){
   if(original.envelope?.windows?.some(o=>JSON.stringify(o)===JSON.stringify(w)))continue;
   if(!Number.isInteger(w.edge)||![w.u,w.v,w.w,w.h].every(Number.isFinite)||w.w<.3||w.h<.3){add('window-geometry','Windows need a valid wall, width and height of at least 30 cm.',null,index);continue;}
   if(w.design&&(['vertical_bars','horizontal_bars'].some(k=>w.design[k]!==undefined&&(!Array.isArray(w.design[k])||w.design[k].length>12||w.design[k].some(t=>!Number.isFinite(t)||t<=0||t>=1))))){add('window-design','Choose a valid pane layout.',null,index);continue;}
   const f=h.storeys.find(f=>w.v>=f.elevation_m-.001&&w.v+w.h<=f.elevation_m+f.height_m-.05+.001),r=f?.footprint.coordinates[0],a=r?.[w.edge],b=r?.[w.edge+1];if(!f||!a||!b||w.u<.05||w.u+w.w>Math.hypot(b[0]-a[0],b[1]-a[1])-.05){add('window-bounds','Keep windows within one floor and wall, clear of corners.',f?.level,index);continue;}
   const length=Math.hypot(b[0]-a[0],b[1]-a[1]),at=t=>[a[0]+(b[0]-a[0])*t/length,a[1]+(b[1]-a[1])*t/length];
   for(const other of windows.slice(0,index))if(other.edge===w.edge&&w.u<other.u+other.w+.05&&w.u+w.w>other.u-.05&&w.v<other.v+other.h+.05&&w.v+w.h>other.v-.05)add('window-overlap','Leave space between windows.',f.level,index);
   for(const o of f.openings.filter(o=>o.entrance)){const[p,q]=o.segment.coordinates;if(pointDistance(p,a,b)<.1&&pointDistance(q,a,b)<.1){const project=p=>((p[0]-a[0])*(b[0]-a[0])+(p[1]-a[1])*(b[1]-a[1]))/length,lo=Math.min(project(p),project(q)),hi=Math.max(project(p),project(q));if(w.u<hi+.08&&w.u+w.w>lo-.08&&w.v<f.elevation_m+o.height_m)add('window-door','Keep windows clear of entrances.',f.level,index);}}
   for(const wall of f.walls)if(wall.segment.coordinates.some(p=>pointDistance(p,at(w.u),at(w.u+w.w))<.06))add('window-wall','Keep windows clear of internal wall junctions.',f.level,index);
  }
 }
 return issues;
}
