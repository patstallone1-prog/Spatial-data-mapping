// Fine shadows near you: the scene's depth as the sun sees it.
//
// The stand-in light (proxy-light.mjs) traces shadows through a map of heights seen from above:
// right for a block of buildings at 400 m, but a texel is metres, and a person, a fence post or
// a kerb's edge is smaller than one. Here the square around you is drawn from the sun's side
// instead, at a few centimetres a texel. A surface is in shadow when something stands between
// it and the sun -- whichever way the surface faces, so a person's shadow falls across the
// pavement and up the wall behind them, and it is the person's own outline.
//
// Two maps of the same square:
//   - what stands still (buildings, fences, kerbs, trees, parked scenery), drawn a slice a frame
//     and swapped in whole when the last slice is done; again when you have walked on, the sun
//     has moved, or streets have arrived since;
//   - what moves (the city's people and cars, you), drawn every frame.
// The shader takes the nearer of the two (module 02, PROXY_LIGHT.patch).
//
// Nothing here is a three.js "shadow": the sun light casts none, so no material's program
// changes and no light count moves (docs/freeze: a changed count recompiles every shader).

export const FINE = {
  size: 2048,            // texels a side, each map
  half_m: 56,            // the square reaches this far from its centre, across the sun's rays
  back_m: 520,           // how far towards the sun a caster is looked for
  depth_m: 700,          // the whole depth of the box
  frame_tris: 1200000,   // the still map is drawn this many triangles a frame, until it is whole
  list_ms: 8000,         // what stands still is listed again this often (or when the scene's geometry changes)
  recentre_m: 10,        // walked this far from the square's centre: drawn again
  sun_deg: 0.2,          // the sun has moved this far: drawn again
  refresh_ms: 6000,      // and this often when streets have arrived since
  min_el_deg: 5,         // below this the sun's shadows are longer than the square: off
  fade_el_deg: 9,        // full strength from here up
  normal_m: 0.07,        // a surface is looked up this far off itself (against its own shadow)
  bias_m: 0.05,          // and this much nearer the sun
};

//: The ground itself: surfaces that lie flat and are what shadows fall on. They are not drawn
//: from the sun's side. Several of them overlap (terrain under a road, an underlay under a walk)
//: with the lower one cut away in the picture by its shader; drawn whole, it would shade the one
//: above it. A kerb is not one of these: its edge throws a shadow.
export const GROUND = /^(walk|walk_underlay|road|terrain|nature_terrain|yard|park|plaza|tile|globe|marking|crossing|parking_lot|tactile_warning|tree_pit|waterworks:gutter)$|^inferred:|^park:[\w:]*fill$|\|hard_ground$/;

//: Whether an object is left out of the sun's view: what has no body (lines, wires, sprites,
//: points), what does not write depth (paint, glows, the old shadow blobs), what is mostly seen
//: through, the ground, and anything that says so (`userData.noShadow`).
export function castsNothing(o) {
  if (o.userData && o.userData.noShadow) return true;
  if (o.isLine || o.isSprite || o.isPoints) return true;
  if (!o.isMesh) return false;
  if (o.userData && typeof o.userData.surface === "string" && GROUND.test(o.userData.surface)) return true;
  const m = Array.isArray(o.material) ? o.material[0] : o.material;
  if (!m) return true;
  if (m.userData && m.userData.noShadow) return true;
  if (m.depthWrite === false || m.visible === false || m.colorWrite === false) return true;
  if (m.transparent && !(m.opacity >= 0.6)) return true;
  if (m.isShaderMaterial && !(m.userData && m.userData.castsShadow)) return true;
  return false;
}

//: How many triangles drawing a mesh costs.
export function trianglesOf(o) {
  const g = o.geometry; if (!g) return 0;
  const n = g.index ? g.index.count : g.attributes && g.attributes.position ? g.attributes.position.count : 0;
  return (n / 3) * (o.isInstancedMesh ? Math.max(0, o.count) : 1);
}

//: What stands still and casts, from `root` down: the meshes to draw, each once (a mesh that is
//: listed brings its own children with it). Nothing under an object that is not shown, and
//: nothing under `skip` (what moves).
export function casters(root, skip = new Set()) {
  const out = [];
  const walk = (o, carried) => {
    if (!o.visible || skip.has(o)) return;
    let mine = carried;
    if (!carried && o.isMesh && !castsNothing(o)) { out.push(o); mine = true; }
    for (const k of o.children) walk(k, mine);
  };
  walk(root, false);
  return out;
}

//: The list cut into a frame's worth each: `[from, to)` ranges of at most `budget` triangles
//: (one mesh larger than the budget is a range of its own).
export function batches(tris, budget) {
  const out = []; let from = 0, sum = 0;
  for (let i = 0; i < tris.length; i += 1) {
    if (i > from && sum + tris[i] > budget) { out.push([from, i]); from = i; sum = 0; }
    sum += tris[i];
  }
  if (from < tris.length) out.push([from, tris.length]);
  return out;
}

//: The square's centre for a focus, snapped to whole texels across the sun's rays (so a still
//: shadow's edge does not crawl as you walk). `right` and `up` are the map's axes (unit, world).
export function snapAcross(focus, right, up, texel_m) {
  const a = focus.x * right.x + focus.y * right.y + focus.z * right.z, b = focus.x * up.x + focus.y * up.y + focus.z * up.z;
  const da = Math.round(a / texel_m) * texel_m - a, db = Math.round(b / texel_m) * texel_m - b;
  return { x: focus.x + right.x * da + up.x * db, y: focus.y + right.y * da + up.y * db, z: focus.z + right.z * da + up.z * db };
}

//: How strong the fine shadows are for the sun's height (0..1): they fade out towards sunset.
export function strengthFor(elevation_deg, F = FINE) {
  return Math.max(0, Math.min(1, (elevation_deg - F.min_el_deg) / Math.max(0.1, F.fade_el_deg - F.min_el_deg)));
}

export function createFineShadows({ THREE, renderer, scene, sun, uniforms, F = FINE }) {
  const U = uniforms;
  const target = () => {
    const t = new THREE.WebGLRenderTarget(F.size, F.size, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false, depthBuffer: true, stencilBuffer: false, format: THREE.RedFormat });
    t.depthTexture = new THREE.DepthTexture(F.size, F.size);
    t.depthTexture.minFilter = t.depthTexture.magFilter = THREE.NearestFilter;
    return t;
  };
  // (Two still maps: the one being read and the one being drawn.)
  let still = target(), next = target();
  const moving = target();
  const depth = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide });
  depth.userData.kbDepthOnly = true;
  const eye = new THREE.OrthographicCamera(-F.half_m, F.half_m, F.half_m, -F.half_m, 1, F.depth_m);
  eye.matrixAutoUpdate = true;
  const movingScene = new THREE.Scene(); movingScene.matrixWorldAutoUpdate = false; movingScene.overrideMaterial = depth;
  const state = { on: true, ok: true, ready: false, job: null, at: 0, centre: new THREE.Vector3(), dir: new THREE.Vector3(), jobs: 0, stillMs: 0, movingMs: 0, hiddenStill: 0, strength: 0 };
  const dir = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
  const toUv = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
  const pending = new THREE.Matrix4();

  function aim(centre, d) {
    eye.up.copy(Math.abs(d.y) > 0.98 ? Z : Y);
    eye.position.set(centre.x + d.x * F.back_m, centre.y + d.y * F.back_m, centre.z + d.z * F.back_m);
    eye.lookAt(centre.x, centre.y, centre.z);
    eye.updateMatrixWorld(true);
  }
  function whole() { eye.left = -F.half_m; eye.right = F.half_m; eye.bottom = -F.half_m; eye.top = F.half_m; eye.updateProjectionMatrix(); }
  function drawTo(t, draw) {
    const was = renderer.getRenderTarget(), auto = renderer.autoClear, xr = renderer.xr.enabled;
    renderer.xr.enabled = false; renderer.autoClear = false; renderer.setRenderTarget(t);
    try { draw(); } finally { renderer.setRenderTarget(was); renderer.xr.enabled = xr; renderer.autoClear = auto; }
  }
  const hide = (list) => { const out = []; for (const o of list) if (o.visible) { o.visible = false; out.push(o); } return out; };
  const show = (list) => { for (const o of list) o.visible = true; };

  const stillScene = new THREE.Scene(); stillScene.matrixWorldAutoUpdate = false; stillScene.overrideMaterial = depth;
  const frustum = new THREE.Frustum(), sphere = new THREE.Sphere(), pv = new THREE.Matrix4();
  let listed = null;   // { meshes, at, geoms }
  function begin(focus, d, now) {
    aim(focus, d);
    right.setFromMatrixColumn(eye.matrixWorld, 0); up.setFromMatrixColumn(eye.matrixWorld, 1);
    const c = snapAcross(focus, right, up, (2 * F.half_m) / F.size), w0 = performance.now();
    const geoms = renderer.info.memory.geometries;
    if (!listed || listed.geoms !== geoms || now - listed.at > F.list_ms) listed = { meshes: casters(scene, new Set(U.dynamic)), at: now, geoms };
    // Only what the sun's box holds, so a frame's share is a share of what is drawn.
    whole(); aim(c, d);
    frustum.setFromProjectionMatrix(pv.multiplyMatrices(eye.projectionMatrix, pv.copy(eye.matrixWorld).invert()));
    const meshes = [], tris = [];
    for (const o of listed.meshes) {
      if (!o.parent) continue;
      const g = o.geometry;
      if (g && !o.isInstancedMesh && !o.isSkinnedMesh && o.frustumCulled !== false) {
        if (!g.boundingSphere) g.computeBoundingSphere();
        if (!frustum.intersectsSphere(sphere.copy(g.boundingSphere).applyMatrix4(o.matrixWorld))) continue;
      }
      meshes.push(o); tris.push(trianglesOf(o));
    }
    state.job = { c: new THREE.Vector3(c.x, c.y, c.z), d: d.clone(), step: 0, meshes, parts: batches(tris, F.frame_tris), t0: now, ms: 0, calls: 0, tris: 0, walk_ms: performance.now() - w0 };
    state.hiddenStill = listed.meshes.length;
  }
  function slice() {
    const job = state.job, t0 = performance.now(), part = job.parts[job.step];
    whole(); aim(job.c, job.d);
    next.scissorTest = false; next.viewport.set(0, 0, F.size, F.size);
    stillScene.children = part ? job.meshes.slice(part[0], part[1]) : [];
    try {
      drawTo(next, () => {
        if (job.step === 0) { renderer.state.buffers.depth.setMask(true); renderer.clear(true, true, false); }
        renderer.render(stillScene, eye); job.calls += renderer.info.render.calls; job.tris += renderer.info.render.triangles;
      });
    } finally { stillScene.children = []; }
    job.ms = Math.max(job.ms, performance.now() - t0); job.step += 1;
    if (job.step < job.parts.length) return;
    // Done: this is the map that is read from now on, and what moves is drawn to match it.
    pending.multiplyMatrices(eye.projectionMatrix, eye.matrixWorldInverse).premultiply(toUv);
    U.fineMat.value.copy(pending);
    [still, next] = [next, still];
    U.fineMap.value = still.depthTexture;
    state.centre.copy(job.c); state.dir.copy(job.d); state.at = job.t0; state.jobs += 1; state.stillMs = job.ms; state.stillCalls = job.calls; state.stillTris = job.tris; state.walkMs = job.walk_ms; state.frames = job.parts.length; state.geoms = renderer.info.memory.geometries; state.ready = true; state.job = null;
  }
  function drawMoving() {
    const t0 = performance.now();
    whole(); aim(state.centre, state.dir);
    const roots = [...U.dynamic].filter((o) => o && o.visible && o.parent), out = [];
    for (const root of roots) { root.updateMatrixWorld(); root.traverse((o) => { if (castsNothing(o)) out.push(o); }); }
    const hidden = hide(out);
    movingScene.children = roots;
    try { drawTo(moving, () => { renderer.state.buffers.depth.setMask(true); renderer.clear(true, true, false); renderer.render(movingScene, eye); state.movingCalls = renderer.info.render.calls; }); }
    finally { movingScene.children = []; show(hidden); }
    state.movingMs = performance.now() - t0;
  }

  //: Once a frame, after the world's matrices are current. `focus`: where you are; `indoors`: in
  //: a room (its roof would put it in the dark); `level`: the stand-in's own 0..1 (it fades in).
  function update(now, focus, { indoors = false, level = 1 } = {}) {
    dir.copy(sun.position).normalize();
    const el = Math.asin(Math.max(-1, Math.min(1, dir.y))) * 180 / Math.PI;
    const want = state.on && state.ok && !indoors && focus && sun.intensity > 0.02 ? strengthFor(el, F) : 0;
    state.strength = want * (state.ready ? 1 : 0) * level;
    U.fineK.value.set(state.strength, 1 / F.size, F.normal_m, F.bias_m / (F.depth_m - 1));
    U.fineDir.value.copy(dir);
    if (!(want > 0)) { state.job = null; return false; }
    try {
      if (state.job) slice();
      else {
        const off = Math.hypot(focus.x - state.centre.x, focus.z - state.centre.z), turned = Math.acos(Math.max(-1, Math.min(1, dir.dot(state.dir)))) * 180 / Math.PI;
        if (!state.ready || off > F.recentre_m || turned > F.sun_deg || (now - state.at > F.refresh_ms && renderer.info.memory.geometries !== state.geoms)) { begin(focus, dir, now); slice(); }
      }
      if (state.ready) drawMoving();
    } catch (error) {
      state.ok = false; U.fineK.value.x = 0;
      console.warn("kerbside: no fine shadows", error);
    }
    return true;
  }
  U.fineMap.value = still.depthTexture; U.fineMoving.value = moving.depthTexture;
  return {
    update,
    setEnabled(on) { state.on = Boolean(on); if (!state.on) U.fineK.value.x = 0; },
    stats: () => ({ on: state.on, ok: state.ok, ready: state.ready, strength: +state.strength.toFixed(2), jobs: state.jobs, still_ms: +state.stillMs.toFixed(1), moving_ms: +state.movingMs.toFixed(2), casters: state.hiddenStill, frames: state.frames, still_calls: state.stillCalls, still_tris: state.stillTris, walk_ms: +(state.walkMs || 0).toFixed(1), moving_calls: state.movingCalls, texel_cm: +((200 * F.half_m) / F.size).toFixed(1), gpu_mib: Math.round((3 * F.size * F.size * 5) / 1048576) }),
    settings: F,
    targets: { get still() { return still; }, moving },
    dispose() { for (const t of [still, next, moving]) { t.depthTexture.dispose(); t.dispose(); } depth.dispose(); U.fineK.value.x = 0; },
  };
}
