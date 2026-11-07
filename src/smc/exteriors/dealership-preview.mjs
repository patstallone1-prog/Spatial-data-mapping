import * as THREE from 'https://esm.sh/three@0.160.0';
import {OrbitControls} from 'https://esm.sh/three@0.160.0/examples/jsm/controls/OrbitControls.js';
import {createExteriorRenderer} from './renderer.mjs';
import {createDealershipRenderer} from './dealership-renderer.mjs';
const $=id=>document.getElementById(id),canvas=$('view');
const renderer=new THREE.WebGLRenderer({canvas,antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;
const scene=new THREE.Scene();scene.background=new THREE.Color('#c9dce1');
const camera=new THREE.PerspectiveCamera(48,1,.1,1200),controls=new OrbitControls(camera,canvas);controls.enableDamping=true;controls.maxPolarAngle=Math.PI*.49;controls.minDistance=1.5;
const hemi=new THREE.HemisphereLight('#e6f1ff','#66765c',2.6);scene.add(hemi);
const sun=new THREE.DirectionalLight('#fff1dc',3.1);sun.position.set(-30,65,45);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.normalBias=.04;sun.shadow.bias=-.00035;Object.assign(sun.shadow.camera,{left:-120,right:120,top:120,bottom:-120,far:220});scene.add(sun);
const ground=new THREE.Mesh(new THREE.PlaneGeometry(2000,2000),new THREE.MeshStandardMaterial({color:'#acb7a4',roughness:1}));ground.rotation.x=-Math.PI/2;ground.position.y=-.11;ground.receiveShadow=true;scene.add(ground);
const manifest=await fetch('./dealership-scenes.json',{cache:'no-store'}).then(r=>r.json()),assets=await fetch('./assets/manifest.json',{cache:'no-store'}).then(r=>r.json());
const exteriors=await createExteriorRenderer(THREE,assets,new URL('./assets/',location.href).href),runtime=createDealershipRenderer(THREE,exteriors);
let plan,built,currentView='overview';
for(const p of Object.values(manifest.dealerships))$('case').add(new Option(`${p.name} · ${p.brand||'independent'}`,p.id));
function overview(){currentView='overview';const b=new THREE.Box3().setFromObject(built),c=b.getCenter(new THREE.Vector3()),s=b.getSize(new THREE.Vector3()),radius=s.length()/2,fov=camera.fov*Math.PI/180,hfov=2*Math.atan(Math.tan(fov/2)*camera.aspect),distance=radius/Math.sin(Math.min(fov,hfov)/2)*1.12;controls.target.copy(c);camera.position.copy(c).add(new THREE.Vector3(.65,.65,.85).normalize().multiplyScalar(distance));controls.update();renderer.render(scene,camera);}
function entrance(inside=false){currentView=inside?'showroom':'entrance';const f=plan.building.facades.find(f=>f.role==='public'),d=f.openings.find(o=>o.component_kind==='door'),u=d.u+d.w/2,L=Math.hypot(f.b[0]-f.a[0],f.b[1]-f.a[1]),p=[f.a[0]+(f.b[0]-f.a[0])*u/L,f.a[1]+(f.b[1]-f.a[1])*u/L];
 const distance=inside?-8:Math.max(12,L*.65);camera.position.set(p[0]+f.normal[0]*distance,inside?2.1:3,-p[1]-f.normal[1]*distance);controls.target.set(p[0]-f.normal[0]*(inside?14:0),inside?1.5:2.9,-p[1]+f.normal[1]*(inside?14:0));controls.update();renderer.render(scene,camera);}
function build(){if(built){built.traverse(o=>o.geometry?.dispose());scene.remove(built);}plan=manifest.dealerships[$('case').value];built=runtime.mount(scene,plan,{x:0,y:0,z:0},{roof:$('roof').checked,cars:$('cars').checked});
 $('name').textContent=plan.name;$('status').textContent='Inferred layout · Source geometry retained';
 $('stats').textContent=`${plan.stalls.length} lot spaces · ${plan.showroom.cars.length} showroom displays · ${plan.driveways.length} supplied driveways · ${plan.service_aprons.length} service doors`;
 $('warnings').textContent=plan.warnings.join(' ')+' Reference style does not establish the current remodel generation of a real dealer.';
 $('rejections').textContent=manifest.rejected.length?`${manifest.rejected.length} rejected cases retained in the review ledger.`:'';
 $('errors').textContent=exteriors.missingAssets.length?'Unavailable identity artwork: '+exteriors.missingAssets.join(', '):'';
 $('sources').replaceChildren(...plan.references.map(s=>{const li=document.createElement('li'),a=document.createElement('a');a.href=s.url;a.target='_blank';a.rel='noopener';a.textContent=s.title;li.append(a,document.createElement('br'),s.organization);return li;}));
 $('service').disabled=!plan.service_aprons.length;overview();}
$('case').addEventListener('change',build);$('overview').addEventListener('click',overview);$('entrance').addEventListener('click',()=>entrance());$('showroom').addEventListener('click',()=>entrance(true));
$('roof').addEventListener('change',()=>{built.getObjectByName('dealershipRoof').visible=$('roof').checked;renderer.render(scene,camera);});$('cars').addEventListener('change',()=>{built.getObjectByName('dealershipCars').visible=$('cars').checked;renderer.render(scene,camera);});
$('service').addEventListener('click',()=>{currentView='service';const r=plan.service_aprons[0],[a,b]=r.points;controls.target.set(a[0],1.8,-a[1]);camera.position.set(b[0],2.1,-b[1]);controls.update();renderer.render(scene,camera);});
$('night').addEventListener('change',()=>{scene.background.set($('night').checked?'#253343':'#c9dce1');hemi.intensity=$('night').checked?.7:2.6;sun.intensity=$('night').checked?.35:3.1;renderer.render(scene,camera);});
function resize(){const r=canvas.getBoundingClientRect();if(renderer.getSize(new THREE.Vector2()).equals(new THREE.Vector2(r.width,r.height)))return;renderer.setSize(r.width,r.height,false);camera.aspect=r.width/r.height;camera.updateProjectionMatrix();if(built){if(currentView==='overview')overview();else renderer.render(scene,camera);}}new ResizeObserver(resize).observe(canvas);resize();controls.addEventListener('change',()=>renderer.render(scene,camera));renderer.setAnimationLoop(()=>controls.update());
if($('case').options.length)build();else{$('status').textContent='No passing dealership layouts';$('errors').textContent=manifest.rejected.map(r=>r.id+': '+r.errors.join(', ')).join('\n');}
window.addEventListener('pagehide',()=>{built?.traverse(o=>o.geometry?.dispose());controls.dispose();runtime.dispose();exteriors.dispose();renderer.dispose();});
