// Kerbfront Building Studio: view a building model, edit any part of it, match it to photos.
// Selection is a path into the model ("walls.3.openings.2", "storefronts.0.awnings.0", ...);
// every edit goes through set(path, value) so undo, the changed-paths log and the rebuild
// all see it. URL: ?model=<id>&view=street|orbit|match|compare&photo=<i>&opacity=&sel=<path>&bare=1

import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {createBuilder, wallFrame} from './building.mjs';
import {FINISHES} from './materials.mjs';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const state = {model: null, sel: params.get('sel') || null, view: 'street', past: [], future: [], changed: new Set(), photo: 0, dirty: false};
window.studio = {state};

// ---- three ------------------------------------------------------------------------------------
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({canvas, antialias: true, preserveDrawingBuffer: true});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
const scene = new THREE.Scene(); scene.background = new THREE.Color('#c9d7dc');
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 2000);
const controls = new OrbitControls(camera, canvas); controls.enableDamping = false;
scene.add(new THREE.HemisphereLight('#e8f1f6', '#9a8f7c', 1.7));
const sun = new THREE.DirectionalLight('#fff3dc', 2.6); sun.position.set(-30, 45, 25); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, {left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 200});
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04; scene.add(sun); scene.add(sun.target);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(800, 800), new THREE.MeshStandardMaterial({color: '#a19c90', roughness: 1}));
ground.rotation.x = -Math.PI / 2; ground.position.y = -0.3; ground.receiveShadow = true; scene.add(ground);
const builder = await createBuilder(THREE, {assetBase: new URL('./kerbside/', location.href).href});
let group = null, highlight = null;
let raf = 0;
const render = () => {if (!raf) raf = requestAnimationFrame(() => {raf = 0; renderer.render(scene, camera);});};
controls.addEventListener('change', render);

function resize() {
  if (state.view === 'wall' && state.wallArgs) return wallView(...state.wallArgs);
  const v = $('view').getBoundingClientRect();
  let w = v.width, h = v.height, x = 0, y = 0;
  const img = $('photo');
  if ((state.view === 'match' || state.view === 'compare') && img.naturalWidth) {
    const aspect = img.naturalWidth / img.naturalHeight, boxW = state.view === 'compare' ? v.width / 2 : v.width;
    w = Math.min(boxW, v.height * aspect); h = w / aspect;
    x = state.view === 'compare' ? boxW + (boxW - w) / 2 : (v.width - w) / 2; y = (v.height - h) / 2;
    Object.assign(img.style, state.view === 'compare'
      ? {position: 'absolute', left: `${(boxW - w) / 2}px`, top: `${y}px`, width: `${w}px`, height: `${h}px`}
      : {position: 'absolute', left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px`});
  }
  Object.assign(canvas.style, {position: 'absolute', left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px`});
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); render();
}
new ResizeObserver(resize).observe($('view'));

// ---- model paths --------------------------------------------------------------------------------
const get = (path, obj = state.model) => path === 'building' ? obj : path.split('.').reduce((o, k) => o?.[k], obj);
function setIn(obj, path, value) {
  const keys = path.split('.'); let o = obj;
  for (const k of keys.slice(0, -1)) o = o[k] ??= {};
  o[keys.at(-1)] = value;
}
function snapshot() {state.past.push(JSON.stringify(state.model)); if (state.past.length > 200) state.past.shift(); state.future = [];}
function set(path, value, {rebuildNow = true, record = true} = {}) {
  if (record) snapshot();
  if (path.startsWith('building.')) setIn(state.model, path.slice(9), value); else setIn(state.model, path, value);
  state.changed.add(path.replace(/\.(u|v|w|h|u0|u1)$/, '')); state.dirty = true; status();
  if (rebuildNow) scheduleRebuild();
}
function typeOf(path) {
  if (!path) return null;
  if (path === 'roof') return 'roof';
  if (path === 'building') return 'building';
  const p = path.split('.');
  if (p[0] === 'walls') return p.length === 2 ? 'wall' : 'opening';
  if (p[0] === 'seating') return 'seating';
  if (p[0] === 'street_objects') return 'object';
  if (p[0] === 'storefronts') return p.length === 2 ? 'storefront' : {openings: 'sfopening', signs: 'sign', extra_signs: 'extrasign', awnings: 'awning', lights: 'light'}[p[2]];
  return null;
}
function wallOf(path) {
  const p = path?.split('.') || [];
  if (p[0] === 'walls') return Number(p[1]);
  if (p[0] === 'storefronts') return state.model.storefronts[Number(p[1])]?.edge;
  if (p[0] === 'seating') return state.model.seating[Number(p[1])]?.edge;
  return state.model.storefronts[0]?.edge ?? 0;
}
function pathFromSel(sel) {
  const m = state.model;
  if (!sel) return null;
  if (sel.type === 'wall') return `walls.${sel.wall}`;
  if (sel.type === 'opening') {const j = m.walls[sel.wall].openings.findIndex(o => o.id === sel.id); return j >= 0 ? `walls.${sel.wall}.openings.${j}` : `walls.${sel.wall}`;}
  const si = m.storefronts.findIndex(s => s.id === (sel.storefront || sel.id));
  if (sel.type === 'storefront') return si >= 0 ? `storefronts.${si}` : null;
  if (sel.type === 'awning') return `storefronts.${si}.awnings.${m.storefronts[si].awnings.findIndex(a => a.id === sel.id)}`;
  if (sel.type === 'sign') return `storefronts.${si}.extra_signs.${(m.storefronts[si].extra_signs || []).findIndex(a => a.id === sel.id)}`;
  if (sel.type === 'seating') return `seating.${m.seating.findIndex(s => s.id === sel.id)}`;
  if (sel.type === 'roof') return 'roof';
  if (sel.type === 'object') return `street_objects.${(m.street_objects || []).findIndex(o => o.id === sel.id)}`;
  return null;
}

// ---- build ------------------------------------------------------------------------------------
let rebuildTimer = 0;
function scheduleRebuild() {clearTimeout(rebuildTimer); rebuildTimer = setTimeout(rebuild, 40);}
function disposeGroup(g) {g?.traverse(o => {if (o.isMesh) {o.geometry?.dispose();}}); if (g) scene.remove(g);}
function rebuild() {
  disposeGroup(group);
  group = builder.build(state.model);
  scene.add(group);
  const sf = state.model.storefronts[0];
  if (sf) {const f = wallFrame(state.model, sf.edge); sun.target.position.set(f.a[0], 0, -f.a[1]); sun.position.set(f.a[0] - 30, 45, -f.a[1] + 25);}
  showHighlight(); drawTree(); drawElevation(); render();
}
function showHighlight() {
  if (highlight) {scene.remove(highlight); highlight = null;}
  if (!state.sel || !group) return;
  const box = new THREE.Box3(), want = state.sel;
  group.traverse(o => {if (o.isMesh && o.userData.sel && pathFromSel(o.userData.sel) === want) box.expandByObject(o);});
  if (!box.isEmpty()) {highlight = new THREE.Box3Helper(box.expandByScalar(0.03), new THREE.Color('#e2732b')); scene.add(highlight);}
}

// ---- views ------------------------------------------------------------------------------------
// the model's own business frontage (a building may carry neighbours' shopfronts too)
const ownFront = (m = state.model) => m.storefronts.find(sf => sf.business_id && sf.business_id === m.business_id) ?? m.storefronts[0];
function lookFrom(x, y, z, yawDeg, pitchDeg) {
  const yaw = THREE.MathUtils.degToRad(yawDeg), p = THREE.MathUtils.degToRad(pitchDeg);
  camera.position.set(x, z, -y);
  const t = new THREE.Vector3(x + Math.sin(yaw) * Math.cos(p) * 10, z + Math.sin(p) * 10, -y - Math.cos(yaw) * Math.cos(p) * 10);
  controls.target.copy(t); camera.lookAt(t); controls.update();
}
function streetView() {
  const m = state.model, sf = ownFront(m), f = wallFrame(m, sf?.edge ?? 0);
  const u = sf ? (sf.u0 + sf.u1) / 2 : f.L / 2, d = Math.max(9, (m.street?.sidewalk_m ?? 3) + 6.5);
  const px = f.a[0] + f.t[0] * u, py = f.a[1] + f.t[1] * u;
  camera.fov = 55; camera.position.set(px + f.n[0] * d, 1.7, -(py + f.n[1] * d));
  controls.target.set(px, Math.min(m.height_m * 0.45, 4.5), -py); controls.update(); camera.updateProjectionMatrix(); render();
}
// square-on elevation of one wall through a long lens, framed like `kerbfront rectify`
// (u from lo to hi, v from top down to -0.6), so a render and a rectified photo stack 1:1
function wallView(edge, lo, hi, top) {
  state.wallArgs = [edge, lo, hi, top];
  const m = state.model, f = wallFrame(m, edge);
  lo ??= -2; hi ??= f.L + 2; top ??= m.height_m + 1;
  const W = hi - lo, H = top + 0.6, d = 400, um = (lo + hi) / 2, vm = (top - 0.6) / 2;
  const px = f.a[0] + f.t[0] * um, py = f.a[1] + f.t[1] * um;
  camera.position.set(px + f.n[0] * d, vm, -(py + f.n[1] * d)); camera.near = d - 9; camera.far = d + 80;  // only 9 m in front of the wall: no buildings across the street
  camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(H / 2 / d)); camera.aspect = W / H;
  controls.target.set(px, vm, -py); controls.update(); camera.updateProjectionMatrix();
  const v = $('view').getBoundingClientRect(), s = Math.min(v.width / W, v.height / H);
  Object.assign(canvas.style, {position: 'absolute', left: '0px', top: '0px', width: `${W * s}px`, height: `${H * s}px`});
  renderer.setSize(W * s, H * s, false); render();
}
window.studio.wallView = wallView;
// save the current render to out/snaps/<name>.png (for stacking against rectified photos)
// the photo shown in match/compare (its URL), so a sheet can pair it with the snap
window.studio.photoUrl = () => $('photo').src;
window.studio.snap = async name => {renderer.render(scene, camera);
  const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
  return fetch(`/api/snap/${name}`, {method: 'POST', body: blob}).then(r => r.json());};
function orbitView() {
  const box = new THREE.Box3();
  group.traverse(o => {if (o.isMesh && o.userData.sel && o.userData.sel.type !== 'street' && o.userData.sel.type !== 'context') box.expandByObject(o);});
  const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3()), r = Math.max(s.x, s.y, s.z);
  const sf = ownFront(), f = wallFrame(state.model, sf?.edge ?? 0);
  camera.fov = 45; camera.position.set(c.x + (f.n[0] * 1.2 + f.t[0] * 0.6) * r, c.y + r * 0.8, c.z - (f.n[1] * 1.2 + f.t[1] * 0.6) * r);
  controls.target.copy(c); controls.update(); camera.updateProjectionMatrix(); render();
}
function photoCamera(p) {
  const m = state.model, al = p.align || {}, sf = ownFront(m), f = wallFrame(m, sf.edge);
  const u = (sf.u0 + sf.u1) / 2, tx = f.a[0] + f.t[0] * u, ty = f.a[1] + f.t[1] * u;
  const x = p.x + (al.dx || 0), y = p.y + (al.dy || 0), z = (p.z ?? 2) + (al.dz || 0);
  if (p.camera_type === 'spherical') {
    const yaw0 = p.view?.yaw ?? (Math.atan2(tx - p.x, ty - p.y) * 180 / Math.PI + 360) % 360;
    const dist = Math.hypot(tx - p.x, ty - p.y), pitch0 = p.view?.pitch ?? Math.min(20, Math.atan2(Math.min(m.height_m, 6) / 2 - 1, dist) * 180 / Math.PI);
    const hfov0 = p.view?.hfov ?? Math.max(55, Math.min(95, 2 * Math.atan2((sf.u1 - sf.u0) / 2 + 3, dist) * 180 / Math.PI));
    return {x, y, z, yaw: yaw0 + (al.dyaw || 0), pitch: pitch0 + (al.dpitch || 0), hfov: hfov0 + (al.dfov || 0),
      url: `/api/photo/${p.frame_id}.jpg?model=${m.id}&yaw=${yaw0.toFixed(2)}&pitch=${pitch0.toFixed(2)}&hfov=${hfov0.toFixed(2)}&w=1280&h=960`, yaw0, pitch0, hfov0};
  }
  return {x, y, z, yaw: p.heading + (al.dyaw || 0), pitch: al.dpitch || 0, hfov: p.hfov + (al.dfov || 0), url: `/api/photo/${p.frame_id}.jpg?model=${m.id}`};
}
async function matchView() {
  const m = state.model, p = m.photos?.[state.photo];
  if (!p) {$('photoInfo').textContent = 'This model has no photos.'; return;}
  const cam = photoCamera(p), img = $('photo');
  if (img.dataset.url !== cam.url) {
    img.dataset.url = cam.url; img.src = cam.url;
    await new Promise(r => {img.onload = r; img.onerror = r;});
  }
  resize();
  const aspect = img.naturalWidth / img.naturalHeight || 4 / 3;
  camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(cam.hfov) / 2) / aspect));
  camera.aspect = aspect; camera.updateProjectionMatrix();
  lookFrom(cam.x, cam.y, cam.z, cam.yaw, cam.pitch);
  const al = p.align || {};
  $('aYaw').value = al.dyaw || 0; $('aPitch').value = al.dpitch || 0; $('aFov').value = al.dfov || 0; $('aZ').value = al.dz || 0; $('aX').value = al.dx || 0; $('aY').value = al.dy || 0;
  $('photoInfo').textContent = `${p.frame_id} · ${p.camera_type} · ${(p.captured_at || '').slice(0, 10)} · ${p.slot || ''} · ${p.licence || ''}`;
  canvas.style.opacity = state.view === 'match' ? $('opacity').value : 1;
  render();
}
async function setView(v) {
  state.view = v;
  for (const [id, name] of [['vStreet', 'street'], ['vOrbit', 'orbit'], ['vMatch', 'match'], ['vCompare', 'compare']]) $(id).classList.toggle('on', name === v);
  $('view').classList.toggle('match', v === 'match'); $('view').classList.toggle('compare', v === 'compare');
  canvas.style.opacity = 1; controls.enabled = v === 'street' || v === 'orbit';
  if (v === 'match' || v === 'compare') await matchView();
  else if (v === 'wall') {camera.near = 0.1; const n = k => params.has(k) ? Number(params.get(k)) : undefined;
    wallView(n('wall') ?? state.model.storefronts[0]?.edge ?? 0, n('u0'), n('u1'), n('top'));}
  else {camera.near = 0.1; camera.far = 2000; resize(); v === 'street' ? streetView() : orbitView();}
}
window.studio.setView = setView;
for (const [id, v] of [['vStreet', 'street'], ['vOrbit', 'orbit'], ['vMatch', 'match'], ['vCompare', 'compare']]) $(id).onclick = () => setView(v);
$('opacity').oninput = () => {canvas.style.opacity = $('opacity').value;};
$('photoSel').onchange = () => {state.photo = Number($('photoSel').value); matchView();};
for (const [id, key] of [['aYaw', 'dyaw'], ['aPitch', 'dpitch'], ['aFov', 'dfov'], ['aZ', 'dz'], ['aX', 'dx'], ['aY', 'dy']]) $(id).oninput = () => {
  const p = state.model.photos[state.photo];
  set(`photos.${state.photo}.align`, {...(p.align || {}), [key]: Number($(id).value)}, {rebuildNow: false});
  matchView();
};

// ---- picking ------------------------------------------------------------------------------------
let down = null;
canvas.addEventListener('pointerdown', e => {down = [e.clientX, e.clientY];});
canvas.addEventListener('pointerup', e => {
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
  const r = canvas.getBoundingClientRect(), ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
  const hit = ray.intersectObject(group, true).find(h => h.object.userData.sel && !['street', 'context'].includes(h.object.userData.sel.type));
  select(hit ? pathFromSel(hit.object.userData.sel) : null);
});
function select(path) {state.sel = path; showHighlight(); drawTree(); drawInspector(); drawElevation(); render();}
window.studio.select = select;

// ---- parts tree -------------------------------------------------------------------------------
function drawTree() {
  const m = state.model, rows = [['building', 'Building', `${m.height_m} m · ${m.floors.length} floors`], ['roof', 'Roof', m.roof.shape]];
  m.storefronts.forEach((sf, i) => {
    rows.push([`storefronts.${i}`, 'Storefront', sf.name]);
    (sf.openings || []).forEach((o, j) => rows.push([`storefronts.${i}.openings.${j}`, '· ' + o.kind, `${o.w}×${o.h}`]));
    (sf.signs || []).forEach((s, j) => rows.push([`storefronts.${i}.signs.${j}`, '· sign', s.text]));
    (sf.extra_signs || []).forEach((s, j) => rows.push([`storefronts.${i}.extra_signs.${j}`, '· ' + s.kind, s.text]));
    (sf.awnings || []).forEach((a, j) => rows.push([`storefronts.${i}.awnings.${j}`, '· awning', a.kind]));
  });
  m.seating.forEach((s, i) => rows.push([`seating.${i}`, 'Seating', s.kind]));
  (m.street_objects || []).forEach((o, i) => rows.push([`street_objects.${i}`, 'Street', o.kind + (o.note ? ' · ' + o.note : '')]));
  m.walls.forEach((w, i) => rows.push([`walls.${i}`, `Wall ${i}`, `${w.role}${w.street ? ' · ' + w.street : ''} · ${w.length_m} m · ${w.openings.length} openings`]));
  $('tree').replaceChildren(...rows.map(([path, k, label]) => {
    const d = document.createElement('div'); d.className = path === state.sel ? 'on' : '';
    d.innerHTML = `<span class="k">${k}</span>`; d.append(document.createTextNode(label || ''));
    d.onclick = () => select(path); return d;
  }));
}

// ---- inspector --------------------------------------------------------------------------------
const C = 'color', N = 'number', T = 'text', B = 'bool';
const opt = (...o) => ({type: 'select', options: o});
const FIELDS = {
  building: [['height_m', 'Height (m)', N, 0.1], ['title', 'Title', T]],
  roof: [['colour', 'Roof colour', C], ['parapet_h', 'Parapet (m)', N, 0.05], ['cornice.h', 'Cornice height', N, 0.05], ['cornice.depth', 'Cornice depth', N, 0.05], ['cornice.colour', 'Cornice colour', C], ['cornice.brackets', 'Bracket spacing', N, 0.1], ['cornice.raise', 'Cornice raise', N, 0.05]],
  wall: [['material', 'Material', opt(...Object.keys(FINISHES))], ['colour', 'Colour', C], ['texture_scale', 'Texture scale', N, 0.05], ['trim_colour', 'Trim colour', C], ['visible', 'Visible', B], ['role', 'Role', opt('street', 'open', 'party', 'recess')]],
  opening: [['kind', 'Kind', opt('window', 'door', 'garage', 'bay')], ['u', 'u (along, m)', N, 0.05], ['v', 'v (up, m)', N, 0.05], ['w', 'Width', N, 0.05], ['h', 'Height', N, 0.05], ['shape', 'Shape', opt('rect', 'arched', 'segmental')], ['mullions.0', 'Mullion columns', N, 1], ['mullions.1', 'Mullion rows', N, 1], ['frame_colour', 'Frame colour', C], ['pane_colour', 'Glass reads as', C], ['colour', 'Door/garage colour', C], ['depth', 'Reveal depth', N, 0.01], ['sill', 'Sill', B], ['hood', 'Hood', B], ['surround', 'Surround', B], ['projection', 'Bay projection', N, 0.05], ['front_share', 'Bay front share', N, 0.05], ['material', 'Bay cladding', opt('', ...Object.keys(FINISHES))], ['v0', 'Bay bottom (m)', N, 0.05], ['v1', 'Bay top (m)', N, 0.05], ['cap.crest_h', 'Bay crest height', N, 0.05]],
  sfopening: [['kind', 'Kind', opt('window', 'door', 'garage')], ['u', 'u (along, m)', N, 0.05], ['v', 'v (up, m)', N, 0.05], ['w', 'Width', N, 0.05], ['h', 'Height', N, 0.05], ['shape', 'Shape', opt('rect', 'arched')], ['transom_fraction', 'Transom share', N, 0.01], ['privacy_fraction', 'Privacy film share', N, 0.01], ['leaf_count', 'Door leaves', N, 1], ['operation', 'Operation', opt('hinged', 'automatic_sliding', 'folding')]],
  storefront: [['name', 'Name', T], ['u0', 'From u (m)', N, 0.05], ['u1', 'To u (m)', N, 0.05], ['band_h', 'Band height', N, 0.05], ['material', 'Band material', opt('painted_wood', 'tile', 'brick', 'metal_panel', 'stone', 'stucco')], ['palette.wall', 'Band colour', C], ['palette.accent', 'Accent', C], ['palette.frame', 'Frames', C], ['palette.base', 'Bulkhead / trim', C], ['palette.letter', 'Lettering', C], ['palette.glass', 'Glass tint', C], ['door_style', 'Door style', opt('', 'timber_glazed', 'secure_glazed')], ['portal_colour', 'Door portal colour', C], ['visible', 'Visible', B]],
  sign: [['kind', 'Kind', opt('fascia', 'lightbox', 'neon', 'plaque', 'blade', 'painted_letters', 'entry_letters', 'door_vinyl', 'channel_letters')], ['text', 'Text', T], ['u', 'u', N, 0.05], ['v', 'v', N, 0.05], ['w', 'Width', N, 0.05], ['h', 'Height', N, 0.05], ['ink', 'Ink', C], ['illumination', 'Lit', opt('none', 'internal', 'external', 'halo')], ['visible', 'Visible', B]],
  extrasign: [['kind', 'Kind', opt('board', 'painted', 'window_vinyl', 'blade')], ['text', 'Text', T], ['u', 'u', N, 0.05], ['v', 'v', N, 0.05], ['w', 'Width', N, 0.05], ['h', 'Height', N, 0.05], ['ink', 'Ink', C], ['bg', 'Background', C], ['board', 'Board colour', C], ['font', 'Font', opt('Georgia, serif', 'Arial, sans-serif', '"Helvetica Neue", Arial, sans-serif', '"Times New Roman", serif', '"Brush Script MT", cursive', '"Courier New", monospace', 'Futura, "Trebuchet MS", sans-serif', 'Didot, "Bodoni 72", serif')], ['weight', 'Weight', N, 100], ['italic', 'Italic', B], ['visible', 'Visible', B]],
  awning: [['kind', 'Kind', opt('shed', 'dome', 'quarter_round', 'box', 'flat_canopy', 'retractable')], ['u0', 'From u', N, 0.05], ['u1', 'To u', N, 0.05], ['v', 'Top at wall (m)', N, 0.05], ['depth_m', 'Projection', N, 0.05], ['drop_m', 'Drop', N, 0.05], ['valance_h', 'Valance', N, 0.02], ['material', 'Cover', opt('canvas', 'metal_panel', 'glass', 'painted_wood')], ['colour', 'Colour', C], ['stripe', 'Stripe colour', C], ['stripe_w', 'Stripe width', N, 0.02], ['valance_colour', 'Valance colour', C], ['valance_text', 'Valance text', T], ['text_on_slope', 'Text on slope', T], ['text_colour', 'Text colour', C], ['font', 'Font', opt('Georgia, serif', 'Arial, sans-serif', '"Times New Roman", serif', '"Brush Script MT", cursive', 'Futura, "Trebuchet MS", sans-serif')], ['italic', 'Italic', B], ['sides', 'Closed sides', B], ['visible', 'Visible', B]],
  seating: [['kind', 'Kind', opt('sidewalk_strip', 'parklet', 'patio')], ['u0', 'From u', N, 0.1], ['u1', 'To u', N, 0.1], ['offset_m', 'Off the wall', N, 0.05], ['depth_m', 'Depth', N, 0.05], ['table', 'Tables', opt('two_top', 'four_top')], ['table_shape', 'Table shape', opt('round', 'square')], ['spacing_m', 'Spacing', N, 0.05], ['colour', 'Table colour', C], ['chair_colour', 'Chair colour', C], ['umbrellas', 'Umbrellas', B], ['umbrella_colour', 'Umbrella colour', C], ['barrier', 'Barrier', opt('none', 'rope', 'planter_wall', 'rail')], ['barrier_h', 'Barrier height', N, 0.05], ['barrier_colour', 'Barrier colour', C], ['benches', 'Benches', opt('none', 'street_side')], ['bench_colour', 'Bench colour', C], ['deck_colour', 'Deck colour', C], ['roof', 'Roof', opt('none', 'canopy', 'slats')], ['roof_colour', 'Roof colour', C], ['roof_h', 'Roof height', N, 0.05], ['plants', 'Planting', B], ['gap_m', 'Gap from kerb', N, 0.05], ['visible', 'Visible', B]],
  light: [['kind', 'Kind', opt('gooseneck', 'string')], ['u', 'u', N, 0.05], ['v', 'v', N, 0.05], ['colour', 'Colour', C]],
  object: [['kind', 'Kind', opt('tree', 'bus_shelter', 'cone_statue', 'planter', 'pole', 'box', 'a_frame', 'heater')], ['u', 'Along (m)', N, 0.1], ['w', 'Out from wall (m)', N, 0.1], ['rot', 'Turn (rad)', N, 0.05], ['h', 'Height', N, 0.1], ['r', 'Radius', N, 0.1], ['len', 'Length', N, 0.1], ['colour', 'Colour', C], ['visible', 'Visible', B]],
};
function field(path, [key, label, type, step]) {
  const full = `${path}.${key}`, val = get(path === 'building' ? key : full);
  const row = document.createElement('div'); row.className = 'row';
  const l = document.createElement('label'); l.textContent = label; row.append(l);
  let input;
  if (type && type.type === 'select') {
    input = document.createElement('select');
    for (const o of type.options) input.add(new Option(o || '(none)', o));
    input.value = val ?? '';
    input.onchange = () => set(path === 'building' ? `building.${key}` : full, input.value || null);
  } else if (type === B) {
    input = document.createElement('input'); input.type = 'checkbox'; input.checked = val !== false && val != null ? !!val : key === 'visible';
    input.onchange = () => set(path === 'building' ? `building.${key}` : full, input.checked);
  } else {
    input = document.createElement('input'); input.type = type === C ? 'color' : type === N ? 'number' : 'text';
    if (step) input.step = step;
    input.value = val ?? (type === C ? '#000000' : '');
    let first = true;
    input.oninput = () => {
      const v = type === N ? Number(input.value) : input.value;
      set(path === 'building' ? `building.${key}` : full, v, {record: first}); first = false;
      if (['u', 'v', 'w', 'h', 'u0', 'u1'].includes(key)) drawElevation();
    };
    input.onchange = () => {first = true;};
  }
  row.append(input); return row;
}
function btn(label, fn, cls = '') {const b = document.createElement('button'); b.className = 'tool ' + cls; b.textContent = label; b.onclick = fn; return b;}
function newId(prefix) {return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;}
function drawInspector() {
  const path = state.sel, type = typeOf(path), box = $('insp');
  box.replaceChildren();
  if (!type) {$('inspTitle').textContent = 'Inspector'; box.innerHTML = '<p class="hint">Click a part in the view, the parts list or the elevation. Drag openings in the elevation; double-click it to add a window.</p>'; return;}
  const item = get(path);
  $('inspTitle').textContent = {wall: `Wall ${path.split('.')[1]}`, opening: 'Opening', sfopening: 'Storefront opening', storefront: 'Storefront', sign: 'Sign (app renderer)', extrasign: 'Sign', awning: 'Awning', seating: 'Outdoor seating', roof: 'Roof', building: 'Building', light: 'Light'}[type];
  if (type === 'opening' && !item.mullions) item.mullions = [1, 1];
  for (const f of FIELDS[type] || []) box.append(field(path, f));
  const tools = document.createElement('div'); tools.style.marginTop = '8px';
  const listAt = path.split('.').slice(0, -1).join('.'), idx = Number(path.split('.').at(-1));
  if (type === 'wall') {
    tools.append(
      btn('Add window', () => addOpening(path, {kind: 'window'})), btn('Add door', () => addOpening(path, {kind: 'door', v: 0, w: 1.0, h: 2.3})),
      btn('Add bay', () => addOpening(path, {kind: 'bay', w: 3.0, h: 1.7, projection: 0.6})),
      btn('Window grid…', () => windowGrid(path)), btn('Add belt course', () => {const w = get(path); set(`${path}.belts`, [...(w.belts || []), {v: state.model.floors[1]?.v ?? 4, h: 0.2, colour: w.trim_colour}]);}),
      btn('Clear windows', () => set(`${path}.openings`, []), 'danger'));
  }
  if (type === 'storefront') {
    tools.append(
      btn('Add awning', () => {const sf = get(path); set(`${path}.awnings`, [...(sf.awnings || []), {id: newId('awning'), kind: 'shed', u0: sf.u0 + 0.1, u1: sf.u1 - 0.1, v: sf.band_h - 0.25, depth_m: 1.0, drop_m: 0.45, valance_h: 0.22, colour: sf.palette.accent, valance_text: sf.name, sides: true}]);}),
      btn('Add sign', () => {const sf = get(path); set(`${path}.extra_signs`, [...(sf.extra_signs || []), {id: newId('sign'), kind: 'board', text: sf.name, u: sf.u0 + 0.5, v: sf.band_h - 0.8, w: 2.4, h: 0.5, ink: '#f6f1e7', board: '#1f2a26'}]);}),
      btn('Add app sign', () => {const sf = get(path); set(`${path}.signs`, [...(sf.signs || []), {id: newId('asign'), kind: 'painted_letters', text: sf.name, u: sf.u0 + 0.5, v: sf.band_h - 0.7, w: 2.4, h: 0.45, illumination: 'none'}]);}),
      btn('Add door', () => {const sf = get(path); set(`${path}.openings`, [...sf.openings, {id: newId('door'), kind: 'door', u: (sf.u0 + sf.u1) / 2 - 0.5, v: 0, w: 1.0, h: 2.35, leaf_count: 1, operation: 'hinged'}]);}),
      btn('Add window', () => {const sf = get(path); set(`${path}.openings`, [...sf.openings, {id: newId('win'), kind: 'window', u: sf.u0 + 0.3, v: 0.5, w: 1.6, h: 2.2, transom_fraction: 0.2}]);}),
      btn('Add seating', () => addSeating(path)),
      btn('Add tree', () => addObject({kind: 'tree', u: (get(path).u0 + get(path).u1) / 2, w: (state.model.street?.sidewalk_m ?? 3) - 0.6, r: 1.8, trunk_h: 2.6})),
      btn('Add planter', () => addObject({kind: 'planter', u: get(path).u0 + 0.8, w: 0.5})),
      btn('Add heater', () => addObject({kind: 'heater', u: get(path).u0 + 1.2, w: 1.2, h: 2.3})));
  }
  if (['opening', 'sfopening', 'awning', 'sign', 'extrasign', 'seating', 'light', 'object'].includes(type)) {
    tools.append(btn('Duplicate', () => {const list = get(listAt); const copy = {...structuredClone(item), id: newId(item.id?.split('-')[0] || 'part')}; if ('u' in copy) copy.u += (copy.w || 1) + 0.3; set(listAt, [...list, copy]); select(`${listAt}.${list.length}`);}),
      btn('Delete', () => {const list = get(listAt); set(listAt, list.filter((_, k) => k !== idx)); select(null);}, 'danger'));
    if (type === 'opening') tools.append(btn('Repeat on every floor', () => repeatFloors(path)));
  }
  box.append(tools);
  // everything else about the part (pilasters, friezes, sign layers, ...) as JSON
  const det = document.createElement('details'); det.style.marginTop = '8px';
  det.innerHTML = '<summary class="hint">All properties (JSON)</summary>';
  const ta = document.createElement('textarea'); ta.rows = 14; ta.style.fontFamily = 'ui-monospace, monospace'; ta.style.fontSize = '11px';
  const raw = structuredClone(item); if (type === 'wall') delete raw.openings; if (type === 'storefront') for (const k of ['openings', 'signs', 'awnings', 'extra_signs', 'lights']) delete raw[k];
  if (type === 'building') for (const k of ['walls', 'storefronts', 'seating', 'context', 'photos', 'street_objects', 'evidence', 'edits', 'footprint']) delete raw[k];
  ta.value = JSON.stringify(raw, null, 1);
  det.append(ta, btn('Apply JSON', () => {
    try {const v = JSON.parse(ta.value); snapshot(); for (const [k, x] of Object.entries(v)) set(path === 'building' ? `building.${k}` : `${path}.${k}`, x, {record: false}); drawInspector();}
    catch (e) {status('JSON error: ' + e.message);}
  }));
  box.append(det);
  const ev = item?.evidence || state.model.evidence?.[path];
  const obs = Object.entries(state.model.evidence || {}).filter(([k]) => k.startsWith(path + '.') || k === path);
  if (ev || obs.length) {
    const d = document.createElement('div'); d.className = 'ev';
    d.textContent = [ev && `evidence: ${ev.kind} · ${ev.source || ev.frame || ''} · ${ev.confidence ?? ''} ${ev.note || ev.how || ''}`, ...obs.map(([k, e]) => `${k.slice(path.length + 1) || '(this)'}: ${e.kind} ${e.frame ? 'frame ' + e.frame : ''} ${e.how || ''}`)].filter(Boolean).join('\n');
    box.append(d);
  }
}
function addOpening(wallPath, o) {
  const w = get(wallPath), L = w.length_m, f = state.model.floors[1] || {v: 4, h: 3};
  const row = {id: newId('win'), kind: 'window', u: Math.max(0.2, L / 2 - 0.5), v: f.v + f.h * 0.28, w: 1.0, h: 1.6, shape: 'rect', mullions: [1, 2], ...o};
  set(`${wallPath}.openings`, [...w.openings, row]); select(`${wallPath}.openings.${w.openings.length}`);
}
function repeatFloors(path) {
  const o = get(path), wallPath = path.split('.').slice(0, 2).join('.'), w = get(wallPath), fl = state.model.floors;
  const mine = fl.findIndex(f => o.v >= f.v && o.v < f.v + f.h), off = o.v - (fl[mine]?.v ?? 0);
  const rows = fl.slice(1).map((f, k) => k + 1 === mine ? null : {...structuredClone(o), id: newId('win'), v: +(f.v + off).toFixed(2)}).filter(Boolean);
  set(`${wallPath}.openings`, [...w.openings, ...rows]);
}
function windowGrid(wallPath) {
  const n = Number(prompt('Windows per floor', '3')); if (!n) return;
  const ww = Number(prompt('Window width (m)', '1.0')) || 1, hh = Number(prompt('Window height (m)', '1.6')) || 1.6;
  const w = get(wallPath), L = w.length_m, fl = state.model.floors, gf = state.model.storefronts.some(s => s.edge === Number(wallPath.split('.')[1]));
  const rows = [];
  fl.forEach((f, k) => {if (k === 0 && gf) return; if (k === 0) return; for (let i = 0; i < n; i++) rows.push({id: newId('win'), kind: 'window', u: +((i + 0.5) * L / n - ww / 2).toFixed(2), v: +(f.v + (f.h - hh) * 0.55).toFixed(2), w: ww, h: hh, shape: 'rect', mullions: [1, 2]});});
  set(`${wallPath}.openings`, [...w.openings.filter(o => o.v < (fl[1]?.v ?? 0)), ...rows]);
}
function addObject(o) {
  const list = state.model.street_objects || [];
  set('street_objects', [...list, {id: newId(o.kind), edge: state.model.storefronts[0]?.edge ?? 0, ...o}]);
  select(`street_objects.${list.length}`);
}
function addSeating(sfPath) {
  const sf = get(sfPath), kind = prompt('Seating kind: sidewalk_strip or parklet', 'sidewalk_strip'); if (!kind) return;
  const row = kind === 'parklet'
    ? {id: newId('parklet'), kind: 'parklet', edge: sf.edge, u0: sf.u0, u1: sf.u1, depth_m: 1.83, deck_colour: '#7a5c43', barrier: 'planter_wall', barrier_h: 1.07, barrier_colour: '#4b3a2c', benches: 'street_side', tables: 'four_top', roof: 'none', plants: true}
    : {id: newId('sidewalk'), kind: 'sidewalk_strip', edge: sf.edge, u0: sf.u0 + 0.3, u1: sf.u1 - 0.3, offset_m: 0.15, depth_m: 0.95, table: 'two_top', spacing_m: 1.55, colour: '#2f2f2c', barrier: 'none'};
  set('seating', [...state.model.seating, row]); select(`seating.${state.model.seating.length - 1}`);
}

// ---- elevation editor ----------------------------------------------------------------------
const SVGNS = 'http://www.w3.org/2000/svg';
function el(tag, attrs, parent) {const e = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); parent?.append(e); return e;}
function drawElevation() {
  const m = state.model, wi = wallOf(state.sel), wall = m.walls[wi], svg = $('elevsvg');
  if (!wall) return;
  const f = wallFrame(m, wi), L = f.L, H = m.height_m;
  $('elevbar').innerHTML = `<b>Elevation · wall ${wi}</b> ${wall.role}${wall.street ? ' · ' + wall.street : ''} · ${L.toFixed(2)} m × ${H} m · drag to move, corner to resize, double-click to add a window, Delete to remove`;
  const r = svg.getBoundingClientRect(), pad = 14;
  if (r.width < 60 || r.height < 40) return;
  const s = Math.min((r.width - 2 * pad) / L, (r.height - 2 * pad - 18) / (H + 1.6));
  if (!(s > 0)) return;  // the panel is too small to draw into (bare mode, first layout pass)
  const X = u => pad + u * s, Y = v => pad + (H - v) * s;
  svg.replaceChildren();
  el('rect', {x: X(0), y: Y(H), width: L * s, height: H * s, fill: wall.colour || '#ddd', 'fill-opacity': 0.55, stroke: '#666'}, svg);
  for (const fl of m.floors) el('line', {x1: X(0), x2: X(L), y1: Y(fl.v), y2: Y(fl.v), stroke: '#999', 'stroke-dasharray': '3 3'}, svg);
  el('line', {x1: X(-1), x2: X(L + 1), y1: Y(0), y2: Y(0), stroke: '#333'}, svg);
  for (let u = 0; u <= L; u += 1) {el('line', {x1: X(u), x2: X(u), y1: Y(0), y2: Y(0) + 4, stroke: '#333'}, svg); if (u % 2 === 0) el('text', {x: X(u), y: Y(0) + 14, 'font-size': 9, 'text-anchor': 'middle', fill: '#555'}, svg).textContent = `${u}`;}
  const items = [];
  m.storefronts.forEach((sf, i) => {
    if (sf.edge !== wi) return;
    items.push([`storefronts.${i}`, {u: sf.u0, v: 0, w: sf.u1 - sf.u0, h: sf.band_h}, '#8a6d3b', 0.12, 'sf']);
    (sf.openings || []).forEach((o, j) => items.push([`storefronts.${i}.openings.${j}`, o, o.kind === 'door' ? '#7a4b2a' : '#3b6f8c', 0.35]));
    (sf.signs || []).forEach((o, j) => items.push([`storefronts.${i}.signs.${j}`, o, '#c99a1d', 0.45]));
    (sf.extra_signs || []).forEach((o, j) => items.push([`storefronts.${i}.extra_signs.${j}`, o, '#d9a514', 0.45]));
    (sf.awnings || []).forEach((a, j) => items.push([`storefronts.${i}.awnings.${j}`, {u: a.u0, w: a.u1 - a.u0, v: (a.v ?? sf.band_h) - (a.drop_m ?? 0.3) - (a.valance_h ?? 0.22), h: (a.drop_m ?? 0.3) + (a.valance_h ?? 0.22)}, a.colour || '#264f43', 0.5, 'aw']));
  });
  wall.openings.forEach((o, j) => items.push([`walls.${wi}.openings.${j}`, o, o.kind === 'door' ? '#7a4b2a' : o.kind === 'bay' ? '#5b4f8c' : '#3b6f8c', 0.4]));
  m.seating.forEach((st, i) => {if (st.edge === wi) items.push([`seating.${i}`, {u: st.u0, v: -1.2, w: st.u1 - st.u0, h: 0.8}, st.kind === 'parklet' ? '#6b4b33' : '#555', 0.5, 'seat']);});
  for (const [path, o, colour, alpha, tag] of items) {
    const g = el('g', {'data-path': path, cursor: 'move'}, svg), on = path === state.sel;
    el('rect', {x: X(o.u), y: Y(o.v + o.h), width: Math.max(1, o.w * s), height: Math.max(1, o.h * s), fill: colour, 'fill-opacity': alpha, stroke: on ? '#e2732b' : colour, 'stroke-width': on ? 2.5 : 1}, g);
    if (tag === 'seat') el('text', {x: X(o.u) + 3, y: Y(o.v) - 3, 'font-size': 9, fill: '#fff'}, g).textContent = get(path).kind;
    if (on) el('rect', {x: X(o.u + o.w) - 5, y: Y(o.v + o.h) - 5, width: 10, height: 10, fill: '#e2732b', 'data-handle': 1, cursor: 'nwse-resize'}, g);
  }
  // drag
  let drag = null;
  svg.onpointerdown = e => {
    const g = e.target.closest('g[data-path]');
    if (!g) return;
    const path = g.dataset.path; if (path !== state.sel) {select(path); return;}
    const item = get(path), type = typeOf(path);
    drag = {path, type, handle: !!e.target.dataset.handle, x: e.clientX, y: e.clientY, start: structuredClone(item), first: true};
    svg.setPointerCapture(e.pointerId);
  };
  svg.onpointermove = e => {
    if (!drag) return;
    const du = Math.round(((e.clientX - drag.x) / s) / 0.05) * 0.05, dv = Math.round((-(e.clientY - drag.y) / s) / 0.05) * 0.05;
    const it = drag.start, p = drag.path, rec = drag.first; drag.first = false;
    const fix = v => +v.toFixed(2);
    if (drag.type === 'storefront') {
      if (drag.handle) {set(`${p}.u1`, fix(it.u1 + du), {record: rec, rebuildNow: true}); set(`${p}.band_h`, fix(it.band_h + dv), {record: false});}
      else {set(`${p}.u0`, fix(it.u0 + du), {record: rec}); set(`${p}.u1`, fix(it.u1 + du), {record: false});}
    } else if (drag.type === 'awning' || drag.type === 'seating') {
      if (drag.handle) set(`${p}.u1`, fix(it.u1 + du), {record: rec});
      else {set(`${p}.u0`, fix(it.u0 + du), {record: rec}); set(`${p}.u1`, fix(it.u1 + du), {record: false}); if (drag.type === 'awning') set(`${p}.v`, fix((it.v ?? 3) + dv), {record: false});}
    } else if (drag.handle) {set(`${p}.w`, fix(Math.max(0.1, it.w + du)), {record: rec}); set(`${p}.h`, fix(Math.max(0.1, it.h + dv)), {record: false}); set(`${p}.v`, fix(it.v), {record: false});}
    else {set(`${p}.u`, fix(it.u + du), {record: rec}); set(`${p}.v`, fix(it.v + dv), {record: false});}
    drawElevation();
  };
  svg.onpointerup = () => {if (drag) {drag = null; drawInspector();}};
  svg.ondblclick = e => {
    if (e.target.closest('g[data-path]')) return;
    const rr = svg.getBoundingClientRect(), u = (e.clientX - rr.left - pad) / s, v = H - (e.clientY - rr.top - pad) / s;
    if (u < 0 || u > L || v < 0 || v > H) return;
    addOpening(`walls.${wi}`, {u: +(u - 0.5).toFixed(2), v: +(v - 0.8).toFixed(2)});
  };
}

// ---- undo / save / keys ------------------------------------------------------------------------
function undo() {if (!state.past.length) return; state.future.push(JSON.stringify(state.model)); state.model = JSON.parse(state.past.pop()); state.dirty = true; afterSwap();}
function redo() {if (!state.future.length) return; state.past.push(JSON.stringify(state.model)); state.model = JSON.parse(state.future.pop()); state.dirty = true; afterSwap();}
function afterSwap() {if (state.sel && get(state.sel) == null) state.sel = null; rebuild(); drawInspector(); status();}
async function save() {
  const m = state.model;
  m.edits = [...(m.edits || []), {at: new Date().toISOString(), by: 'studio', changed: [...state.changed].sort()}];
  const r = await fetch(`/api/models/${m.id}`, {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(m)});
  const j = await r.json(); state.dirty = !r.ok; if (r.ok) state.changed.clear(); status(r.ok ? `Saved ${j.saved}` : `Save failed: ${j.error}`);
}
$('undo').onclick = undo; $('redo').onclick = redo; $('save').onclick = save;
addEventListener('keydown', e => {
  if (e.target.matches('input,select,textarea')) return;
  const k = e.key.toLowerCase();
  if ((e.metaKey || e.ctrlKey) && k === 'z') {e.preventDefault(); e.shiftKey ? redo() : undo();}
  else if ((e.metaKey || e.ctrlKey) && k === 's') {e.preventDefault(); save();}
  else if ((k === 'delete' || k === 'backspace') && state.sel && /\.\d+$/.test(state.sel) && !/^walls\.\d+$|^storefronts\.\d+$/.test(state.sel)) {
    const listAt = state.sel.split('.').slice(0, -1).join('.'), idx = Number(state.sel.split('.').at(-1));
    set(listAt, get(listAt).filter((_, j) => j !== idx)); select(null);
  }
});
addEventListener('beforeunload', e => {if (state.dirty) e.preventDefault();});
function status(msg) {
  const m = state.model; if (!m) return;
  $('status').textContent = msg || `${m.title} · ${m.address ? m.address.number + ' ' + m.address.street : ''} · ${state.dirty ? 'unsaved changes' : 'saved'} · ${m.edits?.length || 0} edit sessions`;
}

// ---- facts ------------------------------------------------------------------------------------
function drawFacts() {
  const m = state.model, fx = m.facts || {}, bt = m.business_type || {};
  const line = (k, v) => v == null || v === '' ? '' : `<div><b>${k}</b> ${v}</div>`;
  $('facts').innerHTML = [
    line('Name', m.title), line('Address', m.address ? `${m.address.number} ${m.address.street}` : ''),
    line('Kind', (bt.kinds || []).join(', ') + (bt.render ? ` · drawn as ${bt.render.replace('_', ' ')}` : '')),
    line('Built', fx.year_built), line('Stories', fx.stories), line('Use', fx.class),
    line('Seating', (fx.outdoor?.kinds || []).join(', ') + (fx.outdoor?.sources?.length ? ` (${fx.outdoor.sources.join(', ')})` : '')),
    line('Licence', fx.licence ? Object.entries(fx.licence).map(([k, v]) => `${k}${v === true ? '' : ': ' + JSON.stringify(v)}`).join('; ') : ''),
    line('Google', fx.services ? `${fx.services.primaryType}${fx.services.reservable ? ' · reservable' : ''}${fx.services.dineIn ? ' · dine-in' : ''}` : ''),
    line('Sidewalk', m.street ? `${m.street.sidewalk_m} m · road ${m.street.road_m} m` : ''),
    line('Photos', `${m.photos?.length || 0}`), line('Observed', `${m.observations_applied || 0} observations`),
  ].join('');
  $('photoSel').replaceChildren(...(m.photos || []).map((p, i) => new Option(`${i + 1}. ${p.slot || ''} ${(p.captured_at || '').slice(0, 10)} ${p.camera_type}`, i)));
}

// ---- boot -------------------------------------------------------------------------------------
async function load(id) {
  const m = await fetch(`/api/models/${id}`, {cache: 'no-store'}).then(r => r.json());
  state.model = m; state.past = []; state.future = []; state.changed.clear(); state.dirty = false;
  state.photo = Number(params.get('photo') || 0);
  drawFacts(); rebuild(); drawInspector(); status();
  await setView(params.get('view') || 'street');
  if (params.get('opacity')) {$('opacity').value = params.get('opacity'); canvas.style.opacity = state.view === 'match' ? params.get('opacity') : 1;}
  renderer.render(scene, camera);
  window.studioReady = true;
}
const index = await fetch('/api/models', {cache: 'no-store'}).then(r => r.json());
$('modelSel').replaceChildren(...index.map(m => new Option(m.title, m.id)));
$('modelSel').onchange = () => {if (state.dirty && !confirm('Discard unsaved changes?')) return; history.replaceState(null, '', `?model=${$('modelSel').value}`); load($('modelSel').value);};
const first = params.get('model') || index[0]?.id;
$('modelSel').value = first;
if (params.get('bare')) document.body.classList.add('bare');
await load(first);
window.studio.load = load; window.studio.rebuild = rebuild; window.studio.set = set; window.studio.THREE = THREE; window.studio.camera = camera; window.studio.scene = scene;
