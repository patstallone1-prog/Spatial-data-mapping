import * as THREE from 'https://esm.sh/three@0.160.0';
import {OrbitControls} from 'https://esm.sh/three@0.160.0/examples/jsm/controls/OrbitControls.js';
import {createExteriorRenderer} from './renderer.mjs';
import {createStationRenderer} from './station-renderer.mjs';
const $=id=>document.getElementById(id),canvas=$('view');
const renderer=new THREE.WebGLRenderer({canvas,antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;
const scene=new THREE.Scene();scene.background=new THREE.Color('#c9dce1');
const camera=new THREE.PerspectiveCamera(46,1,.05,2000),controls=new OrbitControls(camera,canvas);controls.enableDamping=true;
const hemi=new THREE.HemisphereLight('#e8f4ff','#929385',2.6);scene.add(hemi);
const sun=new THREE.DirectionalLight('#fff4de',3);sun.position.set(-25,40,30);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.normalBias=.04;sun.shadow.bias=-.00025;Object.assign(sun.shadow.camera,{left:-70,right:70,top:70,bottom:-70,far:160});scene.add(sun);
const ground=new THREE.Mesh(new THREE.PlaneGeometry(1000,1000),new THREE.MeshStandardMaterial({color:'#c2c3b8',roughness:1}));ground.rotation.x=-Math.PI/2;ground.position.y=-.10;ground.receiveShadow=true;scene.add(ground);
const manifest=await fetch('./station-scenes.json',{cache:'no-store'}).then(r=>r.json()),assets=await fetch('./assets/manifest.json',{cache:'no-store'}).then(r=>r.json());
const exteriors=await createExteriorRenderer(THREE,assets,new URL('./assets/',location.href).href),runtime=createStationRenderer(THREE,exteriors);
const cases=Object.values(manifest.stations);let current,built;
for(const p of cases)$('case').add(new Option(`${p.name} · ${p.id}`,p.id));
function clear(){if(built){built.traverse(o=>o.geometry?.dispose());scene.remove(built);}}
function overview(){const box=new THREE.Box3().setFromObject(built),c=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3()),r=Math.max(size.x,size.z,12);controls.target.set(c.x,1.7,c.z);camera.position.set(c.x+r*.65,r*.48,c.z+r*.95);controls.update();}
function front(){const b=new THREE.Box3().setFromObject(built),c=b.getCenter(new THREE.Vector3()),s=b.getSize(new THREE.Vector3());controls.target.set(c.x,2.2,c.z);const h=(current.source_input.heading_degrees||0)*Math.PI/180,r=Math.max(s.x,s.z)*1.25;camera.position.set(c.x+Math.sin(h)*r,3,c.z+Math.cos(h)*r);controls.update();}
function shop(){if(!current.store)return;const f=current.store.facades[0],u=(f.u0+f.u1)/2,L=Math.hypot(f.b[0]-f.a[0],f.b[1]-f.a[1]),x=f.a[0]+(f.b[0]-f.a[0])*u/L,z=-(f.a[1]+(f.b[1]-f.a[1])*u/L);controls.target.set(x,1.6,z);camera.position.set(x+f.normal[0]*12,2.1,z-f.normal[1]*12);controls.update();}
function build(){clear();current=manifest.stations[$('case').value];built=runtime.mount(scene,current,{x:0,y:0,z:0},{cars:true,canopies:$('canopies').checked});
built.getObjectByName('stationVehicles').visible=$('cars').checked;const paths=built.getObjectByName('stationApproaches');if(paths)paths.visible=$('evidence').checked;
$('name').textContent=current.name;$('category').textContent=current.kind==='fuel'?'Fuel forecourt + convenience store':'EV charging bays';
$('stats').textContent=`${current.bays.length} vehicle spaces · ${current.devices.length} dispensers · ${current.routes.length} checked approaches`;
$('details').textContent=current.price_sign?.prices.illustrative?'Fuel prices are illustrative USD per US gallon, not a live quote.':current.price_sign?'Supplied fuel prices retain their source and date.':'Each charger is assigned to one bay; no diagonal parking required by the inferred layout.';
$('grade').textContent='Inferred layout · Source geometry retained';$('error').textContent=[...current.validation.errors,...exteriors.missingAssets.map(k=>'Missing brand artwork: '+k)].join('\n');
$('sources').replaceChildren(...current.references.map(s=>{const li=document.createElement('li'),a=document.createElement('a');a.href=s.url;a.target='_blank';a.rel='noopener';a.textContent=s.title;li.append(a,document.createElement('br'),s.organization);return li;}));
$('shop').disabled=!current.store;$('prices').disabled=!current.price_sign;$('facade').textContent=current.validation.warnings.join(' ');overview();}
$('case').addEventListener('change',build);$('orbit').addEventListener('click',overview);$('street').addEventListener('click',front);$('shop').addEventListener('click',shop);
$('cars').addEventListener('change',()=>{const g=built.getObjectByName('stationVehicles');if(g)g.visible=$('cars').checked;});$('canopies').addEventListener('change',build);
$('evidence').addEventListener('change',()=>{const g=built.getObjectByName('stationApproaches');if(g)g.visible=$('evidence').checked;});
$('night').addEventListener('change',()=>{scene.background.set($('night').checked?'#1f2d3c':'#c9dce1');hemi.intensity=$('night').checked?.6:2.6;sun.intensity=$('night').checked?.3:3;});
function resize(){const r=canvas.getBoundingClientRect();renderer.setSize(r.width,r.height,false);camera.aspect=r.width/r.height;camera.updateProjectionMatrix();}new ResizeObserver(resize).observe(canvas);resize();renderer.setAnimationLoop(()=>{controls.update();renderer.render(scene,camera);});
if(cases.length)build();else $('error').textContent='No valid station layouts. Review the rejection ledger.';

$('prices').addEventListener('click',()=>{const p=current.price_sign;if(!p)return;const h=p.heading_degrees*Math.PI/180;controls.target.set(p.center[0],2.7,-p.center[1]);camera.position.set(p.center[0]+Math.sin(h)*6.5,2.7,-p.center[1]+Math.cos(h)*6.5);controls.update();});
$('detail').addEventListener('click',()=>{const d=current.devices[0],n=d.faces?.[0]?.normal||[Math.cos(d.heading_degrees*Math.PI/180),Math.sin(d.heading_degrees*Math.PI/180)];$('cars').checked=false;built.getObjectByName('stationVehicles').visible=false;controls.target.set(d.center[0],1.2,-d.center[1]);camera.position.set(d.center[0]+n[0]*4,1.6,-d.center[1]-n[1]*4);controls.update();});
