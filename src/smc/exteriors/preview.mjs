import * as THREE from 'https://esm.sh/three@0.160.0';
import {OrbitControls} from 'https://esm.sh/three@0.160.0/examples/jsm/controls/OrbitControls.js';
import {createExteriorRenderer, cutExteriorWallBands} from './renderer.mjs';

const $ = id => document.getElementById(id), canvas = $('view');
const renderer = new THREE.WebGLRenderer({canvas, antialias: true, alpha: false});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
const scene = new THREE.Scene(); scene.background = new THREE.Color('#c5d6dc');
const camera = new THREE.PerspectiveCamera(48, 1, 0.05, 3000);
const controls = new OrbitControls(camera, canvas); controls.enableDamping = true; controls.minDistance = 1;
const hemi = new THREE.HemisphereLight('#e5f2fa', '#9e8d71', 2.4); scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff1d7', 3.1); sun.position.set(-14, 24, 20);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.camera.left = sun.shadow.camera.bottom = -70;
sun.shadow.camera.right = sun.shadow.camera.top = 70; sun.shadow.normalBias = 0.025; scene.add(sun);
sun.shadow.bias=-0.00035;sun.shadow.normalBias=0.06;
const fill = new THREE.DirectionalLight('#dbeaff', 0.7); fill.position.set(18, 5, -15); scene.add(fill);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshStandardMaterial({color: '#9e9b90', roughness: 0.97}));
floor.rotation.x = -Math.PI / 2; floor.position.y = -0.035; floor.receiveShadow = true; scene.add(floor);
const sidewalk = new THREE.Mesh(new THREE.PlaneGeometry(600, 10), new THREE.MeshStandardMaterial({color: '#d4d0c5', roughness: 0.93}));
sidewalk.rotation.x = -Math.PI / 2; sidewalk.position.set(0, -0.02, 4); sidewalk.receiveShadow = true; scene.add(sidewalk);
const manifest = await fetch('./storefront-exteriors.json',{cache:'no-store'}).then(r => r.json());
const assets = await fetch('./assets/manifest.json',{cache:'no-store'}).then(r => r.json());
const exterior = await createExteriorRenderer(THREE, assets, new URL('./assets/', location.href).href);
let current, building, outlines, faceIndex = 0;
const cases = Object.values(manifest.buildings).sort((a,b)=>(a.cohort==='mapped')-(b.cohort==='mapped'));
for (const p of cases) {const o = new Option(`${p.cohort === 'mapped' ? 'Mapped · ' : ''}${p.facades[0].name}`, p.id); $('case').add(o);}

function disposeGroup(group) {
  if (!group) return;
  group.traverse(o => {o.geometry?.dispose(); if (o.userData.ownMaterial) for(const m of Array.isArray(o.material)?o.material:[o.material])m?.dispose();}); scene.remove(group);
}
function build(p) {
  disposeGroup(building); disposeGroup(outlines); current = p; building = new THREE.Group(); scene.add(building);
  const ring = p.footprint.coordinates[0], shape = new THREE.Shape(ring.map(q => new THREE.Vector2(q[0], q[1])));
  for (const hole of p.footprint.coordinates.slice(1)) shape.holes.push(new THREE.Path(hole.map(q => new THREE.Vector2(q[0], q[1]))));
  const base = new THREE.ExtrudeGeometry(shape, {depth: p.height_m, bevelEnabled: false}); base.rotateX(-Math.PI / 2);
  const body = cutExteriorWallBands(THREE, base, p); base.dispose();
  const roof = new THREE.MeshStandardMaterial({color: '#a5a195', roughness: 0.9, side: THREE.DoubleSide});
  const wall = new THREE.MeshStandardMaterial({color: p.facades[0].palette.wall, roughness: 0.9, side: THREE.DoubleSide});
  const mesh = new THREE.Mesh(body, [roof, wall]); mesh.castShadow = true; mesh.receiveShadow = true; mesh.userData.ownMaterial = true;
  building.add(mesh); exterior.mount(building, p);
  outlines = new THREE.Group();
  for (const f of p.facades) for (const o of f.openings.filter(o => o.evidence.observed)) {
    const L = Math.hypot(f.b[0] - f.a[0], f.b[1] - f.a[1]);
    const at = (u, v) => new THREE.Vector3(f.a[0] + (f.b[0] - f.a[0]) * u / L + f.normal[0] * 0.19,
      v, -(f.a[1] + (f.b[1] - f.a[1]) * u / L + f.normal[1] * 0.19));
    const pts = [at(o.u,o.v),at(o.u+o.w,o.v),at(o.u+o.w,o.v+o.h),at(o.u,o.v+o.h),at(o.u,o.v)];
    for(let i=1;i<pts.length;i++) {
      const segment = new THREE.LineCurve3(pts[i-1],pts[i]);
      const line = new THREE.Mesh(new THREE.TubeGeometry(segment,1,.018,4,false),new THREE.MeshBasicMaterial({color:'#20d3f5',depthTest:false,depthWrite:false,transparent:true}));
      line.renderOrder = 999; line.userData.ownMaterial = true; outlines.add(line);
    }
  }
  outlines.visible = $('evidence').checked; scene.add(outlines);
  $('facade').replaceChildren(...p.facades.map((f, i) => new Option(`${f.name} · ${f.role}`, String(i))));
  faceIndex = 0;
  $('name').textContent = p.facades[0].name; $('grade').textContent = p.cohort === 'mapped' ? 'Mapped shell · Inferred facade' : 'Reference test · Proposed facade';
  $('category').textContent = p.facades[0].category.replaceAll('_',' ');
  $('details').textContent = `${p.facades[0].economics.tier} finish · ${p.facades[0].brand?.replaceAll('_',' ') || 'Independent identity'}. ${p.facades[0].economics.basis}.`;
  $('stats').textContent = `${p.validation.metrics.observed_openings} source openings · ${p.validation.metrics.inferred_openings} inferred openings · ${p.height_m.toFixed(1)} m source height`;
  $('sources').replaceChildren(...p.references.map(s => {const li = document.createElement('li'), a = document.createElement('a'); a.href = s.url; a.textContent = s.title; a.target = '_blank'; a.rel = 'noopener'; li.append(a, document.createElement('br'), document.createTextNode(s.organization + ' · ' + s.kind.replaceAll('_',' '))); return li;}));
  $('error').textContent = [...p.validation.warnings,...exterior.missingAssets.map(k=>'Unavailable brand artwork: '+k)].join('\n');
  street(); window.exteriorReview = {id: p.id, plan: p, meshes: building.children.length, missingAssets: exterior.missingAssets};
}
function street() {
  if (!current) return;
  const f = current.facades[faceIndex], u = (f.u0 + f.u1) / 2, L = Math.hypot(f.b[0]-f.a[0],f.b[1]-f.a[1]);
  const x = f.a[0] + (f.b[0]-f.a[0])*u/L, z = -(f.a[1]+(f.b[1]-f.a[1])*u/L);
  const distance = Math.max(5.3, (f.u1-f.u0)*0.78);
  camera.position.set(x+f.normal[0]*distance, Math.min(2.8, f.band_height_m*0.55), z-f.normal[1]*distance);
  controls.target.set(x, Math.min(2.2, f.band_height_m*0.5), z); controls.update();
}
$('case').addEventListener('change', () => build(manifest.buildings[$('case').value]));
$('facade').addEventListener('change', () => {faceIndex=Number($('facade').value); street();});
$('street').addEventListener('click', street);
$('orbit').addEventListener('click', () => {
  const box=new THREE.Box3().setFromObject(building), c=box.getCenter(new THREE.Vector3()), s=box.getSize(new THREE.Vector3());
  const r=Math.max(s.x,s.z,s.y);camera.position.set(c.x+r*.85,c.y+r*.65,c.z+r*.95);controls.target.copy(c);controls.update();
});
$('night').addEventListener('change', () => {
  const night=$('night').checked;scene.background.set(night?'#152334':'#c5d6dc');hemi.intensity=night?.38:2.4;sun.intensity=night?.15:3.1;fill.intensity=night?.3:.7;
});
$('evidence').addEventListener('change',()=>{if(outlines)outlines.visible=$('evidence').checked;});
function resize(){const r=canvas.getBoundingClientRect();renderer.setSize(r.width,r.height,false);camera.aspect=r.width/r.height;camera.updateProjectionMatrix();}
new ResizeObserver(resize).observe(canvas);resize();
renderer.setAnimationLoop(()=>{controls.update();renderer.render(scene,camera);});
if(cases.length)build(cases[0]);else $('error').textContent='No validated exterior cases in this bundle.';
