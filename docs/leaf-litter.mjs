// Fallen leaves as leaves: each one a small bent blade lying on the ground under the tree it came
// from -- thick near the trunk and along the drip line, heaped where they gather, thinning to a
// scatter beyond the crown -- and each one a thing: the wind shifts it when it gusts hard enough,
// a foot going through a heap kicks it up and drags it along, and it stops at a wall, a kerb's
// step, a fence it cannot get through. (The owner, 2026-11-23: "make leaves 3d and get rid of the
// texture clumps".) It was flat patches of leaf texture under the park trees.
//
// The first half is pure (where the leaves lie, how one moves): tests/leaf_litter.test.mjs. The
// second draws them, a few thousand round the walker, and steps the ones that are moving.

//: Leaves a square metre under the crown (thinned by distance from the trunk), the most a tree
//: has, how far out they lie (crown radii) and how many of them lie in heaps.
export const LEAVES = {
  per_m2: 9, per_tree: 320, spread: 1.7, heaped: 0.55, heap_leaves: [7, 26], heap_r_m: [0.16, 0.5],
  // A leaf: so long (m), so thick a layer when heaped, and what it weighs against the wind.
  size_m: [0.07, 0.13], layer_m: 0.012,
  // The wind at the ground is ``ground_share`` of the sky's; a leaf lying still is shifted when
  // the gust there passes its own ``lift_ms`` (more for one under others), slides and tumbles
  // with ``drag`` of the air's speed over it, and stops again when the gust falls under ``rest``
  // of that. A gust over ``hop_ms`` lifts it off the ground for a moment.
  ground_share: 0.42, lift_ms: [1.9, 3.8], drag: 2.6, rest: 0.55, hop_ms: 3.4, friction: 3.2, buried: 0.5,
  // A foot within ``foot_m`` moving over ``foot_ms`` takes leaves with it: ``foot_carry`` of its
  // speed, and thrown outwards a little.
  foot_m: 0.42, foot_ms: 0.25, foot_carry: 0.75, foot_kick: 0.9,
  // How far round the walker leaves are kept (m), and how many are drawn at most.
  near_m: 34, keep_m: 48, most: 3600,
};
//: Which trees drop leaves, and how many of their share: broadleaved street and park trees do;
//: a conifer drops needles, a few; a palm none.
export const LEAF_FALL = { palm: 0, conifer: 0.18, eucalyptus: 0.7, default: 1 };

// A number 0..1 from a seed and a count (the same tree, the same leaves, every visit).
function rand(seed, k) {
  let h = (Math.imul(seed | 0, 374761393) + Math.imul(k | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const gauss = (seed, k) => (rand(seed, k) + rand(seed, k + 7919) + rand(seed, k + 15485) - 1.5) * 1.15;

//: The leaves under one tree at (x, z) whose crown is ``crown`` m in radius: each {x, z (m), h
//: (how many lie under it), size (m), turn, tilt, tone (0 dark brown .. 1 pale gold), lift (the
//: gust that shifts it, m/s)}. Where they lie is weighted by how near the trunk: most within the
//: crown, thinning beyond it to nothing at ``spread`` radii; ``heaped`` of them in heaps (a heap's
//: leaves lie on one another), the rest singly. ``wind``: the way the prevailing wind blows
//: (unit x, z): the heaps and the scatter lie a little downwind of the trunk.
export function leavesUnder({ x, z, crown = 3, seed = 1, share = 1, wind = [0.94, -0.34] } = {}) {
  const want = Math.min(LEAVES.per_tree, Math.round(Math.PI * crown * crown * LEAVES.per_m2 * share));
  const out = [];
  if (!(want > 0)) return out;
  // How far from the trunk: thick inside the crown, a tail beyond it.
  const radius = (k) => { const u = rand(seed, k), t = u < 0.72 ? Math.sqrt(u / 0.72) : 1 + (u - 0.72) / 0.28 * (LEAVES.spread - 1) * Math.sqrt(rand(seed, k + 31)); return crown * t; };
  const drift = crown * 0.18;
  const one = (px, pz, h, k) => {
    const [a, b] = LEAVES.size_m, [l0, l1] = LEAVES.lift_ms;
    out.push({ x: px, z: pz, h, size: a + (b - a) * rand(seed, k + 101), turn: rand(seed, k + 211) * Math.PI * 2, tilt: (rand(seed, k + 307) - 0.5) * 0.7,
      tone: rand(seed, k + 401), lift: l0 + (l1 - l0) * rand(seed, k + 503) });
  };
  let k = 0;
  const heaped = Math.round(want * LEAVES.heaped);
  while (out.length < heaped) {
    const r = radius(k), ang = rand(seed, k + 61) * Math.PI * 2, cx = x + Math.cos(ang) * r + wind[0] * drift, cz = z + Math.sin(ang) * r + wind[1] * drift;
    const [n0, n1] = LEAVES.heap_leaves, n = Math.min(heaped - out.length, Math.round(n0 + (n1 - n0) * rand(seed, k + 71) ** 2));
    const [r0, r1] = LEAVES.heap_r_m, hr = r0 + (r1 - r0) * Math.sqrt(n / n1);
    // (Deepest at the heap's middle: a leaf there has more under it.)
    for (let i = 0; i < n; i += 1) {
      const gx = gauss(seed, k * 97 + i * 3 + 1), gz = gauss(seed, k * 97 + i * 3 + 2), off = Math.hypot(gx, gz);
      one(cx + gx * hr, cz + gz * hr, Math.max(0, Math.round((1 - Math.min(1, off / 1.6)) * n * 0.22 * rand(seed, k * 97 + i * 3 + 3))), k * 131 + i);
    }
    k += 1;
  }
  for (let i = 0; out.length < want; i += 1) {
    const r = radius(5000 + i), ang = rand(seed, 6000 + i) * Math.PI * 2;
    one(x + Math.cos(ang) * r + wind[0] * drift * 0.5, z + Math.sin(ang) * r + wind[1] * drift * 0.5, 0, 9000 + i);
  }
  return out;
}

//: The wind over the ground at (x, z) at ``t`` seconds, for a sky's wind of ``speed`` m/s blowing
//: (ux, uz): gusts that come through in waves a few metres across and a few seconds long, so
//: the leaves of one heap go together and the next heap's a moment later. [vx, vz] m/s.
export function gustAt(x, z, t, speed, ux, uz) {
  const along = x * ux + z * uz, across = x * uz - z * ux;
  const wave = 0.5 + 0.5 * Math.sin(along * 0.19 - t * 1.25 + Math.sin(across * 0.11 + t * 0.31) * 1.7);
  const flurry = 0.5 + 0.5 * Math.sin(across * 0.47 + t * 2.3 + along * 0.05);
  const g = speed * LEAVES.ground_share * (0.25 + 1.15 * wave * wave) * (0.8 + 0.4 * flurry);
  // (A gust is not dead straight: it swings a little either side of the wind's way.)
  const swing = Math.sin(t * 0.7 + across * 0.2) * 0.3, c = Math.cos(swing), s = Math.sin(swing);
  return [(ux * c - uz * s) * g, (ux * s + uz * c) * g];
}

//: One leaf moved through ``dt`` seconds. ``leaf``: {x, y, z, vx, vy, vz, turn, tilt, spin, h,
//: lift, still}; ``env``: wind [vx, vz] at it, ground (the ground's height under a point),
//: solid(x, z) (true where a leaf cannot be: inside a wall, past a fence), feet (each {x, z, vx,
//: vz}). Returns true while it is moving (false: it lies still and need not be drawn again).
//: Never through what is solid: a move into it is tried along each axis alone, and failing
//: that the leaf stops against it.
//: The ground under a leaf, read again only once it has moved a fifth of a metre: each moving
//: leaf asked the page's walker ground twice a frame, and that ground read is not cheap.
function groundUnder(leaf, env) {
  if (Math.abs(leaf.x - leaf._gx) < 0.2 && Math.abs(leaf.z - leaf._gz) < 0.2) return leaf._gy;
  leaf._gx = leaf.x; leaf._gz = leaf.z;
  return (leaf._gy = env.ground(leaf.x, leaf.z));
}
export function stepLeaf(leaf, dt, env) {
  const L = LEAVES, [wx, wz] = env.wind, gust = Math.hypot(wx, wz);
  let kicked = false;
  for (const f of env.feet || []) {
    const dx = leaf.x - f.x, dz = leaf.z - f.z, d = Math.hypot(dx, dz), fv = Math.hypot(f.vx, f.vz);
    if (d > L.foot_m || fv < L.foot_ms) continue;
    // Taken along with the foot, and out from under it; the nearer the more.
    const near = 1 - d / L.foot_m, out = d > 1e-3 ? L.foot_kick * near * fv / d : 0;
    leaf.vx = f.vx * L.foot_carry * (0.5 + 0.5 * near) + dx * out; leaf.vz = f.vz * L.foot_carry * (0.5 + 0.5 * near) + dz * out;
    leaf.vy = Math.max(leaf.vy || 0, 0.5 + 1.1 * near * Math.min(1, fv / 2)); leaf.spin = (leaf.spin || 0) + (near - 0.3) * 9;
    leaf.h = 0; leaf.still = false; kicked = true;
  }
  const ground = groundUnder(leaf, env), up = leaf.y - ground;
  if (leaf.still) {
    // Lying still: shifted only by a gust over its own mark -- more for one with others on it.
    if (gust < leaf.lift * (1 + L.buried * Math.min(4, leaf.h || 0))) return false;
    leaf.still = false; leaf.h = 0;
  }
  const speed = Math.hypot(leaf.vx, leaf.vz);
  if (up <= 0.02) {
    // On the ground: pushed by the air over it, held by the ground under it.
    const push = gust >= leaf.lift * L.rest ? L.drag : 0;
    leaf.vx += ((wx - leaf.vx) * push - leaf.vx * L.friction) * dt; leaf.vz += ((wz - leaf.vz) * push - leaf.vz * L.friction) * dt;
    if (!kicked && gust > L.hop_ms && leaf.vy <= 0 && speed > 0.4) leaf.vy = 0.5 + (gust - L.hop_ms) * 0.35;
    if (!kicked && gust < leaf.lift * L.rest && Math.hypot(leaf.vx, leaf.vz) < 0.12 && !(leaf.vy > 0)) {
      leaf.vx = leaf.vz = leaf.vy = 0; leaf.spin = 0; leaf.y = ground; leaf.still = true;
      return false;
    }
  } else {
    // In the air: carried at the wind's speed, coming down.
    leaf.vx += (wx * 1.4 - leaf.vx) * 1.8 * dt; leaf.vz += (wz * 1.4 - leaf.vz) * 1.8 * dt;
  }
  leaf.vy = (leaf.vy || 0) - 4.2 * dt;   // (a leaf falls slowly: the air holds it)
  const nx = leaf.x + leaf.vx * dt, nz = leaf.z + leaf.vz * dt;
  if (!env.solid(nx, nz)) { leaf.x = nx; leaf.z = nz; }
  else if (!env.solid(nx, leaf.z)) { leaf.x = nx; leaf.vz *= -0.1; }
  else if (!env.solid(leaf.x, nz)) { leaf.z = nz; leaf.vx *= -0.1; }
  else { leaf.vx = 0; leaf.vz = 0; }
  const g2 = groundUnder(leaf, env);
  leaf.y += leaf.vy * dt;
  if (leaf.y <= g2) { leaf.y = g2; if (leaf.vy < 0) leaf.vy = 0; }
  const going = Math.hypot(leaf.vx, leaf.vz);
  leaf.turn += ((leaf.spin || 0) + going * 2.2) * dt; leaf.spin = (leaf.spin || 0) * Math.max(0, 1 - 2.5 * dt);
  leaf.tilt = leaf.y - g2 > 0.03 ? leaf.tilt + going * 3 * dt : leaf.tilt * Math.max(0, 1 - 4 * dt);
  return true;
}

// ---- drawn --------------------------------------------------------------------------------------

//: One leaf's shape: a blade a unit long, folded a little along its midrib and curled at the
//: tip, with a short stalk -- eight triangles, drawn from both sides.
export function leafGeometry(THREE) {
  const g = new THREE.BufferGeometry();
  // (x across, y up, z along: stalk at -0.5, tip at 0.5.)
  const P = [[0, 0.02, -0.5], [0, 0.0, -0.32], [-0.2, 0.05, -0.12], [0.2, 0.05, -0.12], [0, 0.0, 0.02], [-0.17, 0.07, 0.2], [0.17, 0.07, 0.2], [0, 0.03, 0.5]];
  const I = [0, 1, 2, 0, 3, 1, 1, 4, 2, 1, 3, 4, 2, 4, 5, 4, 3, 6, 5, 4, 7, 4, 6, 7];
  g.setAttribute("position", new THREE.Float32BufferAttribute(P.flat(), 3));
  g.setIndex(I); g.computeVertexNormals();
  return g;
}
//: A leaf's colour by its ``tone``: from dark, wet brown through rust and ochre to pale gold.
export const leafColour = (tone) => (tone < 0.3 ? [0.26 + tone * 0.5, 0.16 + tone * 0.3, 0.07 + tone * 0.1] : tone < 0.75 ? [0.5 + (tone - 0.3) * 0.5, 0.27 + (tone - 0.3) * 0.45, 0.09] : [0.72 + (tone - 0.75) * 0.5, 0.52 + (tone - 0.75) * 0.6, 0.14 + (tone - 0.75) * 0.3]);

//: The leaves round the walker. ``trees(x, z, reach)``: the trees there ({x, z, crown, kind,
//: key}); ``ground(x, z)``; ``solid(x, z)``; ``wind()``: {speed, from} (the sky's). ``step``
//: each frame with where the walker's feet are.
export function createLeafLitter(THREE, { parent, trees, ground, solid, wind, windVector }) {
  const L = LEAVES, mesh = new THREE.InstancedMesh(leafGeometry(THREE), new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide }), L.most);
  mesh.count = 0; mesh.frustumCulled = false; mesh.receiveShadow = true; mesh.castShadow = false; mesh.name = "leaf-litter";
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.userData = { surface: "litter:leaves", inferred: true, confidence: "visual prior under mapped tree crowns", liftedOntoGround: true };
  parent.add(mesh);
  const held = new Map();   // tree key -> { leaves, slot0 (-1: not drawn) }
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(0, 0, 0, "YXZ"), P = new THREE.Vector3(), S = new THREE.Vector3(), C = new THREE.Color();
  const moving = new Set();
  let last = { x: Infinity, z: Infinity }, foot = null, tsec = 0, dirty = true;
  const stats = { trees: 0, leaves: 0, moving: 0, kicked: 0, blown: 0, stopped: 0 };
  const put = (i, leaf) => {
    E.set(leaf.tilt, leaf.turn, 0); Q.setFromEuler(E);
    M.compose(P.set(leaf.x, leaf.y + 0.008 + (leaf.h || 0) * L.layer_m, leaf.z), Q, S.set(leaf.size, leaf.size, leaf.size));
    mesh.setMatrixAt(i, M);
  };
  //: Which trees' leaves are out: those within ``near_m``, kept until ``keep_m`` (a tree's leaves
  //: are where they were left while it is kept, and as they first lay when it comes back).
  function gather(x, z) {
    const [ux, uz] = windDir();
    for (const t of trees(x, z, L.near_m)) {
      if (held.has(t.key)) continue;
      const share = LEAF_FALL[t.kind] ?? LEAF_FALL.default;
      if (!(share > 0)) continue;
      const leaves = leavesUnder({ x: t.x, z: t.z, crown: t.crown, seed: t.seed, share, wind: [ux, uz] }).filter((q) => !solid(q.x, q.z));
      leaves.forEach((q, n) => { q.y = ground(q.x, q.z); q.vx = q.vy = q.vz = 0; q.spin = 0; q.still = true; q.j = (n * 2.399963 + (t.seed % 97)) % 6.2832; });
      held.set(t.key, { x: t.x, z: t.z, leaves });
    }
    for (const [key, t] of held) if (Math.hypot(t.x - x, t.z - z) > L.keep_m) { for (const q of t.leaves) moving.delete(q); held.delete(key); }
    // Laid out again: the nearest trees' first, as many as are drawn.
    const order = [...held.values()].sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
    let n = 0;
    for (const t of order) for (const q of t.leaves) { if (n >= L.most) { q.i = -1; continue; } q.i = n; put(n, q); const c = leafColour(q.tone); mesh.setColorAt(n, C.setRGB(c[0], c[1], c[2])); n += 1; }
    mesh.count = n; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    stats.trees = held.size; stats.leaves = n;
    dirty = false;
  }
  function windDir() { const w = wind() || {}; return windVector(Number.isFinite(w.from) ? w.from : 290); }
  //: Each frame. ``at``: the walker's feet {x, y, z}; ``dt`` seconds.
  function step(at, dt) {
    if (!at || !(dt > 0)) return;
    dt = Math.min(dt, 0.05); tsec += dt;
    if (dirty || Math.hypot(at.x - last.x, at.z - last.z) > 6) { last = { x: at.x, z: at.z }; gather(at.x, at.z); }
    const w = wind() || {}, speed = Number.isFinite(w.speed) ? w.speed : 4.5, [ux, uz] = windDir();
    // The walker's feet: where they are, and how fast they are going.
    const fv = foot ? { x: at.x, z: at.z, vx: (at.x - foot.x) / dt, vz: (at.z - foot.z) / dt } : null;
    foot = { x: at.x, z: at.z };
    const feet = fv && Math.hypot(fv.vx, fv.vz) < 12 ? [fv] : [];
    const env = { wind: [0, 0], ground, solid, feet };
    // Leaves lying still are looked at a few trees a frame (a gust may shift them); the ones at
    // the walker's feet, and the ones moving, every frame.
    let touched = false;
    for (const t of held.values()) {
      const d = Math.hypot(t.x - at.x, t.z - at.z);
      const underFoot = feet.length && d < 12;
      if (!underFoot && (t.turn = ((t.turn || 0) + 1) % 6) !== 0) continue;
      for (const q of t.leaves) {
        if (!q.still || q.i < 0) continue;
        if (underFoot && Math.hypot(q.x - at.x, q.z - at.z) < L.foot_m) { moving.add(q); stats.kicked += 1; continue; }
        const g = gustAt(q.x, q.z, tsec, speed, ux, uz);
        if (Math.hypot(g[0], g[1]) >= q.lift * (1 + L.buried * Math.min(4, q.h || 0))) { moving.add(q); stats.blown += 1; }
      }
    }
    for (const q of moving) {
      // Each leaf's own air: the gust where it is, turned and eased a little its own way (no two
      // leaves take the same line downwind: a heap blown out is a scatter, not a file).
      const g = gustAt(q.x, q.z, tsec, speed, ux, uz), a = Math.sin(tsec * 1.3 + q.j) * 0.75 + Math.sin(tsec * 0.37 + q.j * 2.1) * 0.35, k = 0.75 + 0.35 * Math.sin(tsec * 0.9 + q.j * 1.7);
      env.wind[0] = (g[0] * Math.cos(a) - g[1] * Math.sin(a)) * k; env.wind[1] = (g[0] * Math.sin(a) + g[1] * Math.cos(a)) * k;
      const before = q.still;
      const live = stepLeaf(q, dt, env);
      if (q.i >= 0) { put(q.i, q); touched = true; }
      if (!live) { moving.delete(q); if (!before) stats.stopped += 1; }
    }
    stats.moving = moving.size;
    if (touched) mesh.instanceMatrix.needsUpdate = true;
  }
  return { mesh, step, stats, held, refresh: () => { dirty = true; }, dispose: () => { mesh.removeFromParent(); mesh.geometry.dispose(); mesh.material.dispose(); held.clear(); moving.clear(); } };
}
