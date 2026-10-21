import * as THREE from 'https://esm.sh/three@0.160.0';
import {OrbitControls} from 'https://esm.sh/three@0.160.0/examples/jsm/controls/OrbitControls.js';
import {GLTFLoader} from 'https://esm.sh/three@0.160.0/examples/jsm/loaders/GLTFLoader.js';
import {buildInferredHouse} from './renderer.mjs';
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
let current=null,built=null,mode='3d',fullWalls=false,generation=0;
function resize(){const w=viewport.clientWidth,h=viewport.clientHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();}
new ResizeObserver(resize).observe(viewport);
function render(){requestAnimationFrame(render);controls.update();renderer.render(scene,camera);}render();
function escape(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function dispose(group){group.traverse(n=>{if(n.geometry&&!n.userData?.sharedInteriorAsset)n.geometry.dispose();});}
function rebuild(reset=false){
 if(!current)return;if(built){scene.remove(built.group);dispose(built.group);}
 const level=Number($('floor').value),height=fullWalls?4.5:.9;
 built=buildInferredHouse(THREE,current,{loadAsset,assetBase:new URL('../interior-assets/',location.href),wallHeight:height,floor:level,explode:level<0?2.2:0});
 if(level>=0)built.group.position.y=-current.storeys[level].elevation_m;
 scene.add(built.group);
 const view=built;$('validation').textContent='Geometry passed · loading models';
 view.ready.then(()=>{if(built===view)$('validation').textContent=view.assetErrors.length?
   `Geometry passed · ${view.assetErrors.length} model fallbacks`:'Geometry passed · models ready';});
 if(reset){const box=new THREE.Box3();built.group.updateMatrixWorld(true);for(const fg of built.floorGroups)if(fg.visible)box.union(new THREE.Box3().setFromObject(fg));const size=box.getSize(new THREE.Vector3()),c=box.getCenter(new THREE.Vector3());
  const d=Math.max(size.x,size.z,size.y)*1.25;controls.target.copy(c);camera.position.set(c.x+d*.72,c.y+d*.8,c.z+d*.92);controls.update();}
 drawPlan();
 window.kerbsideInteriorLab={house:current,built,renderer,scene,camera,loadAsset};
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
  html+=`<text class="label" x="${x}" y="${y}" text-anchor="middle">${escape(r.kind.replaceAll('_',' '))}</text><text x="${x}" y="${y+.45}" text-anchor="middle">${r.area_m2.toFixed(1)} m²</text>`;}
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
 const h=await fetch(record.file).then(r=>r.json());if(token!==generation)return;current=h;
 $('name').textContent=h.name;$('subtitle').textContent=`${h.storeys.length} storey${h.storeys.length>1?'s':''} · ${h.style.tier} allowance · ${h.id.startsWith('osm-')?'Kerbside mapped footprint':'Synthetic stress shape'}`;
 $('floor').innerHTML=h.storeys.map(f=>`<option value="${f.level}">${f.level===0?'Ground floor':`Floor ${f.level+1}`} · ${f.height_m.toFixed(2)} m</option>`).join('')+(h.storeys.length>1?'<option value="-1">All floors · separated</option>':'');
 $('area').textContent=h.storeys.reduce((s,f)=>s+f.rooms.reduce((a,r)=>a+r.area_m2,0),0).toFixed(1);
 $('rooms').textContent=h.validation.metrics.room_count;$('objects').textContent=`Rooms · ${h.validation.metrics.objects} placed objects`;
 $('swatches').innerHTML=[...h.style.walls,h.style.wood,h.style.accent].map(c=>`<i style="background:${c}"></i>`).join('');$('palette').textContent=h.style.name;
 $('validation').textContent=h.validation.passed?'Geometry checks passed':'Validation failed';
 $('inspector').textContent=`${(h.validation.metrics.coverage_min*100).toFixed(0)}% usable area covered. ${(h.validation.metrics.hallway_area_fraction_max*100).toFixed(0)}% maximum hallway share. ${h.style.economic_evidence}.`;
 const sources=new Map();for(const f of h.storeys)for(const o of f.objects)if(!o.asset.procedural)sources.set(o.asset.attribution,o.asset.source);
 $('credits').innerHTML=[...sources].map(([name,url])=>`<a href="${escape(url)}" target="_blank" rel="noreferrer">${escape(name)}</a>`).join(' · ');
 rebuild(true);
}
$('floor').addEventListener('change',()=>rebuild(true));$('walls').onclick=()=>{fullWalls=!fullWalls;$('walls').classList.toggle('on',fullWalls);rebuild();};
function setMode(m){mode=m;canvas.style.display=m==='3d'?'block':'none';$('plan').style.display=m==='2d'?'block':'none';$('three').classList.toggle('on',m==='3d');$('two').classList.toggle('on',m==='2d');$('hint').textContent=m==='3d'?'Drag to orbit · scroll to zoom · select a floor above':'Select a room to inspect its inventory · local metre coordinates';resize();}
$('three').onclick=()=>setMode('3d');$('two').onclick=()=>setMode('2d');
try{const manifest=await fetch('./manifest.json').then(r=>r.json());$('batch').textContent=`${manifest.passed} / ${manifest.total} houses validated`;
 for(const [i,r]of manifest.houses.entries()){const b=document.createElement('button');b.className='house';b.dataset.id=r.id;
  b.innerHTML=`<span class="num">${String(i+1).padStart(2,'0')}</span><span><span class="title">${escape(r.name.split(',')[0])}</span><span class="sub">${r.passed?`${r.storeys} storey · ${r.metrics.objects} objects`:'Rejected input'}</span></span><span class="dot"></span>`;
  b.disabled=!r.passed;b.onclick=()=>choose(r);$('houses').appendChild(b);}
 await choose(manifest.houses.find(r=>r.id==='stress-family'&&r.passed)||manifest.houses.find(r=>r.passed));
}catch(e){$('inspector').textContent=e.message;console.error(e);}
