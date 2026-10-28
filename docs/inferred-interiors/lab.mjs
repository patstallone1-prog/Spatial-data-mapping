import * as THREE from 'https://esm.sh/three@0.160.0';
import {OrbitControls} from 'https://esm.sh/three@0.160.0/examples/jsm/controls/OrbitControls.js';
import {GLTFLoader} from 'https://esm.sh/three@0.160.0/examples/jsm/loaders/GLTFLoader.js';
import {buildInferredHouse} from './renderer.mjs?v=retail-1';
import {TourWorld,inPolygon} from './tour-world.mjs';
const restaurant=location.pathname.includes('inferred-restaurants'),retail=location.pathname.includes('inferred-stores');
const $=id=>document.getElementById(id),canvas=$('canvas'),viewport=$('viewport');
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
const scene=new THREE.Scene();scene.background=new THREE.Color('#e8ece3');
const camera=new THREE.PerspectiveCamera(35,1,.1,300);const controls=new OrbitControls(camera,canvas);
controls.enableDamping=true;controls.maxPolarAngle=Math.PI*.49;
scene.add(new THREE.HemisphereLight('#fff7e6','#b2bfac',1.8));
const sun=new THREE.DirectionalLight('#fff4db',2.4);sun.position.set(8,18,10);sun.castShadow=true;
sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-25,right:25,top:25,bottom:-25,near:1,far:70});sun.shadow.bias=-.0003;scene.add(sun);
const ground=new THREE.Mesh(new THREE.PlaneGeometry(120,120),new THREE.MeshStandardMaterial({color:'#dfe5d7',roughness:1}));
ground.rotation.x=-Math.PI/2;ground.position.y=-.05;ground.receiveShadow=true;scene.add(ground);
const loader=new GLTFLoader(),cache=new Map();
function loadAsset(url){if(!cache.has(url))cache.set(url,loader.loadAsync(url).then(g=>g.scene));return cache.get(url);}
let current=null,built=null,mode='3d',fullWalls=false,generation=0,world=null,position=null,yaw=0,pitch=0,last=performance.now();const keys=new Set();
function resize(){const w=viewport.clientWidth,h=viewport.clientHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();}
new ResizeObserver(resize).observe(viewport);
function render(now=performance.now()){requestAnimationFrame(render);const dt=Math.min(.05,(now-last)/1000);last=now;
 if(mode==='tour'&&position){for(const door of built.doors)if(door.automatic&&door.level===world.level(position.y).level)door.setOpen(Math.hypot(door.x-position.x,door.z-position.z)<2.6);const forward=(keys.has('KeyW')||keys.has('ArrowUp')?1:0)-(keys.has('KeyS')||keys.has('ArrowDown')?1:0),side=(keys.has('KeyD')?1:0)-(keys.has('KeyA')?1:0);
 if(keys.has('ArrowLeft'))yaw+=dt*1.5;if(keys.has('ArrowRight'))yaw-=dt*1.5;
 const scale=dt*2.0/Math.max(1,Math.hypot(forward,side));position=world.move(position,(-Math.sin(yaw)*forward+Math.cos(yaw)*side)*scale,(-Math.cos(yaw)*forward-Math.sin(yaw)*side)*scale);
 camera.position.set(position.x,position.y+1.62,position.z);camera.rotation.set(pitch,yaw,0,'YXZ');
 const f=world.level(position.y),room=f.rooms.find(r=>inPolygon(position.x,position.z,r.polygon));$('location').textContent=`Floor ${f.level+1} · ${roomLabel(room)}`;
 }else controls.update();renderer.render(scene,camera);}render();
function escape(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function dispose(group){const mats=new Set(),textures=new Set();group.traverse(n=>{if(n.userData?.sharedInteriorAsset)return;if(n.geometry)n.geometry.dispose();for(const m of Array.isArray(n.material)?n.material:[n.material])if(m)mats.add(m);});for(const m of mats){for(const key of ['map','normalMap','bumpMap','roughnessMap'])if(m[key])textures.add(m[key]);m.dispose();}for(const t of textures)t.dispose();}
function rebuild(reset=false){
 if(!current)return;if(built){scene.remove(built.group);dispose(built.group);}
 const touring=mode==='tour',level=touring?-1:Number($('floor').value),height=touring?7:(fullWalls?7:.9);
 // The context plane must not cap basement openings or lower garage floors.
 ground.visible=!touring&&(level>=0||current.storeys.every(f=>f.elevation_m>=-.03));
 built=buildInferredHouse(THREE,current,{loadAsset,assetBase:new URL('../interior-assets/',location.href),wallHeight:height,floor:level,explode:touring?0:(level<0?2.2:0),ceilings:touring});
 if(level>=0)built.group.position.y=-current.storeys[level].elevation_m;
 scene.add(built.group);
 world=new TourWorld(current,built.doors);
 const view=built;$('validation').textContent='Geometry passed · loading models';
 view.ready.then(()=>{if(built===view)$('validation').textContent=view.assetErrors.length?
   `Geometry passed · ${view.assetErrors.length} model fallbacks`:'Geometry passed · models ready';});
 if(reset){const box=new THREE.Box3();built.group.updateMatrixWorld(true);for(const fg of built.floorGroups)if(fg.visible)box.union(new THREE.Box3().setFromObject(fg));const size=box.getSize(new THREE.Vector3()),c=box.getCenter(new THREE.Vector3());
  const fov=THREE.MathUtils.degToRad(camera.fov)/2,half=Math.min(fov,Math.atan(Math.tan(fov)*camera.aspect)),d=size.length()/2/Math.sin(half)*1.12;controls.target.copy(c);camera.position.copy(c).add(new THREE.Vector3(.72,.8,.92).normalize().multiplyScalar(d));controls.update();}
 drawPlan();
 window.kerbsideInteriorLab={house:current,built,renderer,scene,camera,loadAsset,get tour(){return {mode,position,yaw,pitch};}};
}
function drawPlan(){
 if(!current)return;let level=Number($('floor').value);if(level<0)level=0;const f=current.storeys[level];
 const coords=f.footprint.coordinates[0],xs=coords.map(p=>p[0]),ys=coords.map(p=>p[1]);
 const minX=Math.min(...xs),minY=Math.min(...ys),w=Math.max(...xs)-minX,h=Math.max(...ys)-minY;
 $('plan').setAttribute('viewBox',`${minX-1} ${minY-1} ${w+2} ${h+2}`);
 function path(g){return g.coordinates.map(r=>'M'+r.map(([x,y])=>`${x},${y}`).join('L')+'Z').join(' ');}
 let html='';
 for(const r of f.rooms){html+=`<path data-room="${escape(r.id)}" d="${path(r.polygon)}" fill="${r.materials.wall}" stroke="#a6b09d" stroke-width=".035" fill-rule="evenodd"/>`;}
 for(const o of f.objects){html+=`<path d="${path(o.footprint)}" fill="${o.support.kind==='object'?'#f5f1e5':current.style.wood}" fill-opacity=".75" stroke="#665b47" stroke-width=".025"/>`;}
 for(const r of f.rooms){const ps=r.polygon.coordinates[0],x=ps.reduce((s,p)=>s+p[0],0)/ps.length,y=ps.reduce((s,p)=>s+p[1],0)/ps.length;
  html+=`<text class="label" x="${x}" y="${y}" text-anchor="middle">${escape(roomLabel(r))}</text><text x="${x}" y="${y+.45}" text-anchor="middle">${r.area_m2.toFixed(1)} m²</text>`;}
 for(const o of f.openings){const [a,b]=o.segment.coordinates;html+=`<path d="M${a[0]},${a[1]}L${b[0]},${b[1]}" stroke="${o.leaf_count?'#54785c':'#fafbf5'}" stroke-width=".13"/>`;}
 $('plan').innerHTML=html;
 $('plan').querySelectorAll('[data-room]').forEach(el=>el.addEventListener('click',()=>{
  const r=f.rooms.find(r=>r.id===el.dataset.room),items=f.objects.filter(o=>o.room_id===r.id);
  $('inspector').textContent=`${r.kind.replaceAll('_',' ')} · ${r.area_m2.toFixed(1)} m². ${items.map(o=>o.role.replaceAll('_',' ')).join(', ')||'Clear circulation space'}.`;
 }));
}
async function choose(record){
 const token=++generation;
 document.querySelectorAll('.house').forEach(b=>b.classList.toggle('active',b.dataset.id===record.id));
 const h=await fetch(record.file,{cache:'no-store'}).then(r=>r.json());if(token!==generation)return;current=h;
 if($('household-count')){$('household-count').value=h.households||1;$('garage-count').value=h.validation.metrics.garage_cars||'';$('garage-mode').value=h.garage_mode||'auto';}
 if($('rebuild-retail')){$('rebuild-retail').disabled=false;$('retail-status').textContent='';}
 if($('regenerate-residential')){$('regenerate-residential').disabled=false;$('residential-status').textContent='';}
 $('name').textContent=h.name;$('subtitle').textContent=`${h.storeys.length} storey${h.storeys.length>1?'s':''} · ${h.style.tier} allowance · ${restaurant?'Assumed ground-floor tenant envelope':h.id.startsWith('osm-')?'Kerbside mapped footprint':'Synthetic stress shape'}`;
 if(retail)$('subtitle').textContent=`${h.kind.replaceAll('_',' ')} · ${h.style.label} · ${h.validation.metrics.parking_levels?`${h.validation.metrics.parking_levels} parking levels`:'Parking levels unverified'} · Inferred layout`;
 if(h.residential_units)$('subtitle').textContent=`${h.households} independent home${h.households>1?'s':''} · ${h.storeys.length} floor${h.storeys.length>1?'s':''} · ${h.validation.metrics.garage_cars} garage spaces · Inferred layout`;
 $('floor').innerHTML=h.storeys.map(f=>`<option value="${f.level}">${f.level===0?'Ground floor':`Floor ${f.level+1}`} · ${f.height_m.toFixed(2)} m</option>`).join('')+(h.storeys.length>1?'<option value="-1">All floors · separated</option>':'');
 if(retail){$('floor').value=String(h.storeys.at(-1).level);$('retail-chain').value=h.style.chain;for(const option of $('floor').options){const f=h.storeys[Number(option.value)];if(f)option.textContent=f.rooms[0].kind==='parking_garage'?`Parking B${h.storeys.length-1-f.level}`:'Store floor';}}
 $('area').textContent=h.storeys.reduce((s,f)=>s+f.rooms.reduce((a,r)=>a+r.area_m2,0),0).toFixed(1);
 $('rooms').textContent=h.validation.metrics.room_count;$('objects').textContent=`Rooms · ${h.validation.metrics.objects} placed objects`;
 $('swatches').innerHTML=[...h.style.walls,h.style.wood,h.style.accent].map(c=>`<i style="background:${c}"></i>`).join('');$('palette').textContent=h.style.name;
 $('validation').textContent=h.validation.passed?'Geometry checks passed':'Validation failed';
 $('inspector').textContent=restaurant?`${h.validation.metrics.seats} seats · ${h.validation.metrics.tables} tables · ${h.validation.metrics.booths} booths. ${Object.entries(h.validation.metrics.table_sizes||{}).filter(([_,n])=>n).map(([size,n])=>`${n} × ${size}-person`).join(', ')}. ${h.service_mode} service. ${h.style.economic_evidence}. Tenant boundary is an assumption. ${(h.omitted_optional_features||[]).join('; ')}`:`${(h.validation.metrics.coverage_min*100).toFixed(0)}% usable area covered. ${(h.validation.metrics.hallway_area_fraction_max*100).toFixed(0)}% maximum hallway share. ${h.storeys.reduce((sum,f)=>sum+(f.space_efficiency?.hallway_reclaimed_m2||0),0).toFixed(1)} m² of corridor returned to rooms. ${h.style.economic_evidence}.`;
 if(restaurant){
  $('spend').value=h.style.average_spend_per_person??'';
  const price=h.style.price_evidence,range=price?.range_usd;
  const amount=range?` · $${range.min}${range.max===null?'+':`–${range.max}`} USD${price.symbols?` (${price.symbols})`:''}` : '';
  $('economics').textContent=`${h.style.furnishing_finish} · ${h.style.economic_evidence}${amount}`;
  if(price?.source_url){const link=document.createElement('a');link.href=price.source_url;link.textContent=' · Google Maps';link.target='_blank';link.rel='noreferrer';$('economics').append(link);}
  if(h.footprint_area_m2)$('inspector').textContent+=` Outline ${h.footprint_area_m2.toFixed(1)} m² / ${h.footprint_area_sqft.toFixed(0)} ft²; floor height ${h.total_height_m.toFixed(2)} m. ${h.validation.metrics.prep_islands||0} central prep islands.`;
 }
 if(h.residential_units)$('inspector').textContent=`Each home has its own kitchen, full bathroom and sleeping space. ${h.residential_units.length} independent home${h.residential_units.length>1?'s':''} · ${h.validation.metrics.garage_cars} parked cars · ${h.validation.metrics.common_rooms} shared/service rooms. Garage positions follow source openings; supports are inferred proposals. ${h.garages?.some(g=>g.parking_mode==='tandem')?'Tandem parking: front cars move before rear cars.':''}`;
 if(retail)$('inspector').textContent=`${h.validation.metrics.shelves} stocked shelves · ${h.validation.metrics.sections} sections · ${h.validation.metrics.checkouts} checkouts (${h.validation.metrics.self_checkouts} self service). ${h.validation.metrics.parking_spaces} rendered parking spaces. ${h.parking.render_status}. Chain styling is a prior; the layout is inferred.`;
 const sources=new Map();for(const f of h.storeys)for(const o of f.objects)if(!o.asset.procedural)sources.set(o.asset.attribution,o.asset.source);
 $('credits').innerHTML=[...sources].map(([name,url])=>`<a href="${escape(url)}" target="_blank" rel="noreferrer">${escape(name)}</a>`).join(' · ');
 rebuild(true);if(mode==='tour')spawnTour();
}
function roomLabel(r){const label=r?.laundry_stack?'laundry alcove':(r?.kind||'stairs').replaceAll('_',' ');return current?.residential_units?`${r?.unit_id?'Home '+r.unit_id.split(':').at(-1):'Shared'} · ${label}`:label;}
function roomOptions(){const level=Math.max(0,Number($('floor').value));$('visit').innerHTML=current.storeys[level].rooms.filter(r=>!['closet','stair'].includes(r.kind)).map(r=>`<option value="${escape(r.id)}">${escape(roomLabel(r))}</option>`).join('')+((current.elevators||[]).some(l=>l.levels.includes(level))?'<option value="__lift__">Passenger / cart lift</option>':'');}
function spawnTour(roomId=null){
 const level=Math.max(0,Number($('floor').value)),f=current.storeys[level];
 const chosen=roomId||f.rooms.find(r=>['living','dining'].includes(r.kind))?.id,room=f.rooms.find(r=>r.id===chosen);
 position=chosen==='__lift__'?world.liftLanding(level):world.spawn(level,chosen);yaw=world.viewYaw(position);pitch=-.10;
 if(room?.laundry_stack){
  const washer=f.objects.find(o=>o.room_id===room.id&&o.role==='washing_machine');
  if(washer){const a=washer.rotation_deg*Math.PI/180,nx=-Math.sin(a),nz=Math.cos(a),[x,,z]=washer.position_m;
   // Stand on the clear approach so the complete fitted stack is visible, rather
   // than placing the eye almost against the dryer in a shallow service niche.
   for(const d of [1.6,1.4,1.2]){const p={x:x+nx*d,z:z+nz*d,y:f.elevation_m};
    if(world.clear(p.x,p.z,p.y)){position=p;yaw=Math.atan2(p.x-x,p.z-z);pitch=-.35;break;}}
  }
 }
 camera.fov=72;camera.updateProjectionMatrix();roomOptions();if(chosen)$('visit').value=chosen;canvas.focus();
}
function toggleDoor(){if(!position)return;const near=built.doors.filter(d=>d.level===world.level(position.y).level).sort((a,b)=>Math.hypot(a.x-position.x,a.z-position.z)-Math.hypot(b.x-position.x,b.z-position.z))[0];if(near&&Math.hypot(near.x-position.x,near.z-position.z)<2){if(near.setOpen)near.setOpen(!near.open);else{near.open=!near.open;near.leaf.rotation.y=near.open?near.angle:0;}}}
$('floor').addEventListener('change',()=>{rebuild(mode!=='tour');if(mode==='tour')spawnTour();});$('walls').onclick=()=>{fullWalls=!fullWalls;$('walls').classList.toggle('on',fullWalls);rebuild();};
function setMode(m){const wasTour=mode==='tour';mode=m;controls.enabled=m==='3d';canvas.style.display=m!=='2d'?'block':'none';$('plan').style.display=m==='2d'?'block':'none';$('three').classList.toggle('on',m==='3d');$('two').classList.toggle('on',m==='2d');$('tour').classList.toggle('on',m==='tour');$('tourbar').style.display=m==='tour'?'block':'none';$('walls').disabled=m==='tour';$('hint').textContent=m==='tour'?'WASD to walk · drag to look · arrows to turn · E for doors · walk up stairs or select a floor':m==='3d'?'Drag to orbit · scroll to zoom · select a floor above':'Select a room to inspect its inventory · local metre coordinates';
 if(m==='tour'){rebuild();spawnTour();}else if(wasTour){position=null;camera.fov=35;camera.updateProjectionMatrix();rebuild(true);}resize();}
$('three').onclick=()=>setMode('3d');$('two').onclick=()=>setMode('2d');$('tour').onclick=()=>setMode('tour');$('visit-go').onclick=()=>spawnTour($('visit').value);$('door').onclick=toggleDoor;
window.addEventListener('keydown',e=>{if(e.code==='Escape'&&viewport.classList.contains('expanded')){viewport.classList.remove('expanded');$('expand').textContent='Expand view';return;}if(mode!=='tour'||['INPUT','SELECT'].includes(document.activeElement.tagName))return;if(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)){e.preventDefault();if(!e.repeat&&e.code==='ArrowLeft')yaw+=Math.PI/12;if(!e.repeat&&e.code==='ArrowRight')yaw-=Math.PI/12;keys.add(e.code);}if(e.code==='KeyE'&&!e.repeat)toggleDoor();if(e.code==='Escape')setMode('3d');});window.addEventListener('keyup',e=>keys.delete(e.code));window.addEventListener('blur',()=>keys.clear());
let dragging=false;canvas.addEventListener('pointerdown',e=>{if(mode==='tour'){dragging=true;canvas.setPointerCapture(e.pointerId);canvas.focus();}});canvas.addEventListener('pointerup',()=>dragging=false);canvas.addEventListener('pointermove',e=>{if(mode==='tour'&&dragging){yaw-=e.movementX*.004;pitch=Math.max(-1.35,Math.min(1.35,pitch-e.movementY*.004));}});
async function showBatch(manifest){$('houses').replaceChildren();$('batch').textContent=`${manifest.passed} / ${manifest.total} ${retail?'stores':restaurant?'venues':location.pathname.includes('inferred-residential')?'buildings':'houses'} validated`;
 for(const [i,r]of manifest.houses.entries()){const b=document.createElement('button');b.className='house';b.dataset.id=r.id;
  b.innerHTML=`<span class="num">${String(i+1).padStart(2,'0')}</span><span><span class="title">${escape(r.name.split(',')[0])}</span><span class="sub">${r.passed?`${r.storeys} storey · ${r.metrics.objects} objects`:'Rejected input'}</span></span><span class="dot"></span>`;
  b.classList.toggle('failed',!r.passed);b.onclick=()=>{if(r.passed)return choose(r);$('inspector').textContent=`${r.name}: ${r.reason}`;if($('rebuild-retail')){$('rebuild-retail').disabled=true;$('retail-status').textContent='Rejected source/program. Select a validated store to rebuild.';}if($('regenerate-residential')){$('regenerate-residential').disabled=true;$('residential-status').textContent='Rejected source/program. Select a validated case to change its requirements.';}};$('houses').appendChild(b);}
 await choose(retail?(manifest.houses.find(r=>r.id==='retail-supermarket'&&r.passed)||manifest.houses.find(r=>r.passed)):restaurant?[...manifest.houses].filter(r=>r.passed).sort((a,b)=>b.metrics.seats-a.metrics.seats)[0]:manifest.houses.find(r=>r.id==='stress-family'&&r.passed)||manifest.houses.find(r=>r.passed));
}
try{
 const manifest=await fetch('./manifest.json',{cache:'no-store'}).then(r=>r.json());
 await showBatch(manifest);
 if(restaurant){
  const history=await fetch('./history.json',{cache:'no-store'}).then(r=>r.json());
  const rounds=history.rounds.filter(r=>r.status==='complete');
  $('round').innerHTML=rounds.map(r=>`<option value="${r.number}">Round ${r.number}</option>`).join('');$('round').value=String(manifest.round);
  $('round').onchange=async()=>{const r=rounds.find(r=>String(r.number)===$('round').value);if(r)await showBatch({houses:r.results,passed:r.results.filter(v=>v.passed).length,total:r.selected.length});};
 }
}catch(e){$('inspector').textContent=e.message;console.error(e);}

// A new spend runs the engine again, which only the local lab (scripts/serve_interior_lab.py) can;
// the published tour shows the batch as it was generated.
const LOCAL_LAB=['127.0.0.1','localhost','[::1]'].includes(location.hostname);
if(restaurant&&!LOCAL_LAB)$('reprice').parentElement.hidden=true;
if(restaurant)$('reprice').onclick=async()=>{
 const value=Number($('spend').value);if(!Number.isFinite(value)||value<=0){$('economics').textContent='Enter a positive average spend in USD.';return;}
 const button=$('reprice');button.disabled=true;button.textContent='Generating…';
 try{const response=await fetch('/api/infer-restaurant',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...current.input_evidence,average_spend_per_person:value,currency:'USD',economics_source:'caller supplied USD spend per person'})});
 const result=await response.json();if(!response.ok)throw Error(result.error||'Inference failed');
 // The server persists this separately from the immutable test rounds.
 const record={id:result.id,file:`overrides/${result.id}.json`};await choose(record);
 }catch(error){$('economics').textContent=error.message;}finally{button.disabled=false;button.textContent='Apply spend';}
};

$('expand').onclick=()=>{const expanded=viewport.classList.toggle('expanded');$('expand').textContent=expanded?'Restore view':'Expand view';resize();if(mode==='3d')rebuild(true);};

if($('regenerate-residential')){
 if(!LOCAL_LAB)$('residential-controls').hidden=true;
 $('regenerate-residential').onclick=async()=>{
  const button=$('regenerate-residential');button.disabled=true;$('residential-status').textContent='Building and checking the new layout…';
  try{
   const response=await fetch('/api/infer-residential',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:current.id,households:Number($('household-count').value),garage_cars:$('garage-count').value?Number($('garage-count').value):null,garage_mode:$('garage-mode').value})});
   const h=await response.json();if(!response.ok)throw Error(h.error||'Inference failed');
   await choose({id:h.id,file:`overrides/${h.id}.json`});$('residential-status').textContent='New layout passed geometry, privacy and navigation checks.';
  }catch(error){$('residential-status').textContent=error.message;}finally{button.disabled=false;}
 };
}

if(retail){
 if(!LOCAL_LAB)$('retail-controls').hidden=true;
 $('rebuild-retail').onclick=async()=>{
  const button=$('rebuild-retail');button.disabled=true;$('retail-status').textContent='Generating store…';
  try{const response=await fetch('/api/infer-store',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:current.id,chain:$('retail-chain').value})});
   const result=await response.json();if(!response.ok)throw Error(result.error||'Store inference failed');
   await choose({id:result.id,file:`overrides/${result.id}.json`});$('retail-status').textContent='New layout passed fixture, queue and circulation checks.';
  }catch(e){$('retail-status').textContent=e.message;}finally{button.disabled=false;}
 };
 $('ride-lift').onclick=()=>{try{position=world.liftStop(position,Number($('lift-floor').value));$('floor').value=String(world.level(position.y).level);roomOptions();}catch(e){$('location').textContent=e.message;}};
 const updateLift=()=>{const lifts=current?.elevators||[];$('ride-lift').hidden=$('lift-floor').hidden=!lifts.length;if(lifts.length)$('lift-floor').innerHTML=current.storeys.map(f=>`<option value="${f.level}">${f.level===current.storeys.length-1?'Store':`Parking B${current.storeys.length-1-f.level}`}</option>`).join('');};
 $('tour').addEventListener('click',updateLift);$('floor').addEventListener('change',updateLift);
}
