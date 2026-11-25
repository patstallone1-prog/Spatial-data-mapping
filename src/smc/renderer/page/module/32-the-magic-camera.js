// ---- The magic camera ------------------------------------------------------------------------------
//: In City mode the view looks after itself as you go, on foot or at the wheel. It comes round
//: behind you as you turn -- quickly when you have turned right round, so that you are not left
//: walking toward it (walkSteer) -- it looks a little ahead of you, the further the faster you go,
//: and it stands a little further back at speed in the car. Buildings push it, softly, never
//: stop it: near a wall it leans away (round a little to the open side); coming up to a building
//: that would be between it and you, it slides round to one side or up a little, the smallest
//: change that clears it, and back again once there is room. Where nothing clears it (or you
//: have turned the view there yourself) it zooms in, eased, to stand on your side of that
//: building -- closer to you than it is, never in it -- starting a moment before the building
//: comes between, and easing back out when it has passed. Dragging the view is yours: it is
//: left where you put it until you walk on.
var MAGIC = {
  on: true,
  // The offsets it has taken from the view asked for (rad), and those it is easing toward.
  yawOff: 0, pitchOff: 0, goalYaw: 0, goalPitch: 0,
  // How far ahead it looks (m) and how much further back it stands (a share), eased.
  lead: 0, back: 0,
  // How fast what it follows is going (m/s), from where it was.
  speed: 0, lastX: null, lastZ: null,
  // When it last looked for a clear line, when the view was last dragged, whether you are hidden.
  checkedAt: 0, draggedAt: -1e9, hidden: false,
  // Looked for every so often (ms); left alone for so long after a drag (ms).
  checkEveryMs: 120, dragHoldMs: 1800,
  yawRate: 1.3, pitchRate: 0.5, maxPitch: 1.25,
  // Ahead: so many seconds of the way at the speed, up to so far.
  leadS: 0.3, leadMax: 5,
  // The soft push off a wall beside the camera (rad, eased), and how far it feels one (m).
  push: 0, pushGoal: 0, pushReach: 3, pushMax: 0.3,
  // Zoomed in short of a building: how far out it stands now (m; null at the distance asked),
  // when that was last eased, and the building a moment ahead on your way (m from you, or
  // null) and until when that is worth knowing.
  near: null, nearAt: 0, ahead: null, aheadUntil: 0, aheadS: 0.35,
  // How quickly it zooms in, and back out (s, the time constant of the ease).
  inS: 0.14, outS: 0.75,
  // Which way you are going (m/s).
  vx: 0, vz: 0,
  // The cameraman's shot beyond the turn and rise (cameraman.mjs): a share of the distance, to the
  // right (m), up (m), and how far the aim is moved toward what you deal with; whether it wants the outline.
  distK: 1, shoulder: 0, lift: 0, focusMix: 0, focus: null, cmGhost: false,
};
//: The view given on foot and at the wheel: how far behind (m) and how high it looks down from
//: (rad above level). On foot close enough to read a face and a door; in the car far enough back
//: to see the junction coming.
var MAGIC_VIEWS = { walk: { dist_m: 7, pitch: 0.36 }, drive: { dist_m: 13, pitch: 0.44 } };
//: The offsets tried for a clear line, the smallest change first.
var MAGIC_TRIES = (() => {
  const out = [];
  for (const dp of [0, 0.14, 0.3]) for (const dy of [0, 0.22, -0.22, 0.45, -0.45, 0.75, -0.75, 1.05, -1.05]) out.push([dy, dp, Math.abs(dy) + 2.2 * dp]);
  return out.sort((a, b) => a[2] - b[2]);
})();
//: Whether the view looks after itself now: City mode, from behind (not the walker's eyes), not
//: in the headset.
function magicCameraOn() {
  // (Asked before this part of the module has run -- a view placed while the page is built -- it
  // is off.)
  return typeof MAGIC !== "undefined" && Boolean(MAGIC) && MAGIC.on && typeof cityGame === "function" && cityGame() && !state.firstPerson && !state.explore
    && !(META && renderer.xr.isPresenting);
}
//: What the view looks at: the walker (or the car), a little ahead the way the view faces.
var magicAimPoint = null;
function magicAim(target) {
  if (!magicAimPoint) magicAimPoint = new THREE.Vector3();
  return magicAimPoint.set(target.x - Math.sin(state.yaw) * MAGIC.lead, target.y, target.z - Math.cos(state.yaw) * MAGIC.lead);
}
var magicProbe = null;
//: Whether the camera, turned ``dy`` and raised ``dp`` from the view asked for, sees ``aim``.
function magicClear(aim, dy, dp) {
  if (!magicProbe) magicProbe = new THREE.Vector3();
  return orbitBlockedAt(aim, magicCameraAt(aim, dy, dp, magicProbe)) === null;
}
//: Each frame, before the view is placed: how fast you are going, how far ahead to look, and --
//: every so often while you move -- the smallest turn or rise that clears what is in the way.
function magicCameraStep(dt) {
  // (The page draws frames while its module is still being read: until this part has run, nothing.)
  if (typeof MAGIC === "undefined" || !MAGIC) return;
  if (!magicCameraOn()) {
    MAGIC.yawOff = MAGIC.pitchOff = MAGIC.goalYaw = MAGIC.goalPitch = 0; MAGIC.lead = 0; MAGIC.back = 0;
    MAGIC.push = MAGIC.pushGoal = 0; MAGIC.near = null; MAGIC.ahead = null;
    MAGIC.distK = 1; MAGIC.shoulder = 0; MAGIC.lift = 0; MAGIC.focusMix = 0; MAGIC.cmGhost = false;
    if (typeof CM !== "undefined" && CM.fadeEl) cmFade(0);
    return;
  }
  const t = state.target;
  if (MAGIC.lastX !== null && dt > 0) {
    const v = Math.hypot(t.x - MAGIC.lastX, t.z - MAGIC.lastZ) / dt;
    MAGIC.speed += (Math.min(v, 40) - MAGIC.speed) * Math.min(1, dt * 3);
    const k = Math.min(1, dt * 3), cap = v > 40 ? 40 / v : 1;
    MAGIC.vx += ((t.x - MAGIC.lastX) / dt * cap - MAGIC.vx) * k;
    MAGIC.vz += ((t.z - MAGIC.lastZ) / dt * cap - MAGIC.vz) * k;
  }
  MAGIC.lastX = t.x; MAGIC.lastZ = t.z;
  const moving = MAGIC.speed > 0.3, driving = typeof livingCity !== "undefined" && Boolean(livingCity?.driving);
  const now = performance.now(), held = dragging || now - MAGIC.draggedAt < MAGIC.dragHoldMs;
  // The view you are given: behind and above, nearer on foot and further back at the wheel
  // (MAGIC_VIEWS). Taken up when the city is entered and each time you get in or out of a car,
  // eased; yours to turn right round or zoom as before -- the moment you do, it is left to you.
  {
    const mode = driving ? "drive" : "walk";
    if (MAGIC.mode !== mode) { MAGIC.mode = mode; MAGIC.preset = { ...MAGIC_VIEWS[mode], dist: null, pitch: null }; }
    const P = MAGIC.preset;
    if (P) {
      if (held || (P.dist !== null && (Math.abs(state.dist - P.dist) > 0.02 || Math.abs(state.pitch - P.pitch) > 0.004))) MAGIC.preset = null;
      else {
        const want = MAGIC_VIEWS[mode], lo = typeof minOrbitDist === "function" ? minOrbitDist() : 2, k = Math.min(1, dt * 3.2);
        const goal = Math.max(lo, want.dist_m);
        state.dist += (goal - state.dist) * k; state.pitch += (want.pitch - state.pitch) * k;
        P.dist = state.dist; P.pitch = state.pitch;
        if (Math.abs(goal - state.dist) < 0.05 && Math.abs(want.pitch - state.pitch) < 0.01) MAGIC.preset = null;
      }
    }
  }
  // Ahead the faster you go; further back in the car at speed.
  const leadGoal = moving ? Math.min(MAGIC.leadMax, MAGIC.speed * MAGIC.leadS) : 0;
  MAGIC.lead += (leadGoal - MAGIC.lead) * Math.min(1, dt * 1.5);
  const backGoal = driving ? Math.min(0.3, MAGIC.speed / 45) : 0;
  MAGIC.back += (backGoal - MAGIC.back) * Math.min(1, dt * 1.2);
  // The cameraman, where it is loaded and on: it does the looking for a clear view from here.
  if (cameramanOn() && state.dist <= ORBIT_BLOCK_REACH_M) { cameramanStep(dt, t, now, held, driving); return; }
  MAGIC.distK = 1; MAGIC.shoulder = 0; MAGIC.lift = 0; MAGIC.focusMix = 0; MAGIC.cmGhost = false;
  if (typeof CM !== "undefined" && CM.fadeEl) cmFade(0);
  if (moving && !held && now - MAGIC.checkedAt > MAGIC.checkEveryMs && state.dist <= ORBIT_BLOCK_REACH_M) {
    MAGIC.checkedAt = now;
    const aim = magicAim(t);
    if (magicClear(aim, MAGIC.goalYaw, MAGIC.goalPitch)) {
      // Clear where it is going: back toward the view asked for, once that is clear too.
      if ((MAGIC.goalYaw || MAGIC.goalPitch) && magicClear(aim, 0, 0)) { MAGIC.goalYaw = 0; MAGIC.goalPitch = 0; }
    } else {
      // The smallest change that clears it, keeping to the side it already went round by.
      let best = null, bestCost = Infinity;
      for (const [dy, dp, cost] of MAGIC_TRIES) {
        const c = cost + 0.35 * Math.abs(dy - MAGIC.goalYaw);
        if (c >= bestCost) continue;
        if (magicClear(aim, dy, dp)) { best = [dy, dp]; bestCost = c; }
      }
      if (best) { MAGIC.goalYaw = best[0]; MAGIC.goalPitch = best[1]; }
    }
    // A wall beside where it stands leans it away; a building a moment ahead on your way is
    // zoomed in short of before it comes between.
    MAGIC.pushGoal = magicWallLean(aim);
    const s = MAGIC.aheadS, ahead = { x: aim.x + MAGIC.vx * s, y: aim.y, z: aim.z + MAGIC.vz * s };
    MAGIC.ahead = orbitBlockedAt(ahead, magicCameraAt(ahead, MAGIC.goalYaw, MAGIC.goalPitch, magicProbe));
    MAGIC.aheadUntil = now + MAGIC.checkEveryMs * 2.5;
  } else if (!moving) {
    MAGIC.pushGoal = 0;
  }
  const ease = (v, goal, rate) => (goal > v ? Math.min(goal, v + rate * dt) : Math.max(goal, v - rate * dt));
  if (!dragging) {
    // The lean is eased in slowly, so a passing wall bends the view rather than knocks it.
    MAGIC.push = ease(MAGIC.push, held ? 0 : MAGIC.pushGoal, MAGIC.yawRate * 0.35);
    MAGIC.yawOff = ease(MAGIC.yawOff, MAGIC.goalYaw + MAGIC.push, MAGIC.yawRate);
    MAGIC.pitchOff = ease(MAGIC.pitchOff, MAGIC.goalPitch, MAGIC.pitchRate);
  }
}
//: Where the camera stands turned ``dy`` and raised ``dp`` from the view asked for, round ``aim``.
function magicCameraAt(aim, dy, dp, out) {
  const yaw = state.yaw + dy, pitch = Math.min(MAGIC.maxPitch, state.pitch + dp), d = state.dist * (1 + MAGIC.back);
  return out.set(aim.x + Math.sin(yaw) * Math.cos(pitch) * d, aim.y + Math.sin(pitch) * d, aim.z + Math.cos(yaw) * Math.cos(pitch) * d);
}
//: How far to lean the view round (rad) off the walls beside where the camera stands: each wall
//: within pushReach to one side pushes it toward the other, harder the nearer; walls both sides
//: (a street between two rows of houses) cancel out.
var magicLeanProbe = null;
function magicWallLean(aim) {
  if (!magicLeanProbe) magicLeanProbe = new THREE.Vector3();
  const at = magicCameraAt(aim, MAGIC.goalYaw, MAGIC.goalPitch, magicLeanProbe);
  const yaw = state.yaw + MAGIC.goalYaw;
  // The way a larger yaw moves the camera, along the ground.
  const sx = Math.cos(yaw), sz = -Math.sin(yaw);
  const home = orbitBuildingTop(aim.x, aim.z)?.way || null;
  const wallAt = (x, z) => { const hit = orbitBuildingTop(x, z); return Boolean(hit && hit.way !== home && at.y < hit.top); };
  let lean = 0;
  for (const d of [0.75, 1.5, 2.25, MAGIC.pushReach]) {
    const w = 1 - (d - 0.75) / MAGIC.pushReach;
    if (wallAt(at.x + sx * d, at.z + sz * d)) lean -= w;
    if (wallAt(at.x - sx * d, at.z - sz * d)) lean += w;
  }
  return Math.max(-MAGIC.pushMax, Math.min(MAGIC.pushMax, lean * 0.09));
}
//: How far out the camera stands this frame (m), given ``wall`` -- how far out it could stand
//: before a building, or null -- and ``full``, the distance asked for. In short of a building,
//: eased: quickly in (inS) and slowly back out (outS), from the moment a building is a moment
//: ahead on your way. Null at the distance asked for, with nothing in the way.
function magicPullIn(wall, full) {
  const now = performance.now(), dt = Math.min(0.1, Math.max(0, (now - (MAGIC.nearAt || now)) / 1000));
  MAGIC.nearAt = now;
  let goal = full;
  if (wall !== null) goal = Math.min(goal, wall);
  if (MAGIC.ahead !== null && now < MAGIC.aheadUntil) goal = Math.min(goal, MAGIC.ahead);
  goal = Math.max(0.3, goal);
  if (MAGIC.near === null) {
    if (goal >= full - 0.01) return null;
    MAGIC.near = full;
  }
  // Zoomed in by hand past where it stood: there.
  MAGIC.near = Math.min(MAGIC.near, full);
  const tau = goal < MAGIC.near ? MAGIC.inS : MAGIC.outS;
  MAGIC.near += (goal - MAGIC.near) * (1 - Math.exp(-dt / tau));
  // Never past the wall's face, whatever the ease (wall is already ORBIT_WALL_GAP_M short of
  // it): the rooms behind it are not seen. A building cutting in at once (a turn round a
  // corner) is the one time this, not the ease, sets where it stands.
  if (wall !== null && MAGIC.near > wall + 0.35) MAGIC.near = wall + 0.35;
  if (goal >= full - 0.01 && MAGIC.near >= full - 0.03) { MAGIC.near = null; return null; }
  return MAGIC.near;
}
//: The view dragged: what the camera had turned by itself becomes the view asked for (so it
//: does not jump), and it is left there.
function magicCameraDragged() {
  // (The cameraman's turn and rise become the view asked for; how near and high it stands is kept.)
  if (typeof CM !== "undefined" && cameramanOn()) CM.man.taken();
  if (!MAGIC.yawOff && !MAGIC.pitchOff) { MAGIC.draggedAt = performance.now(); return; }
  state.yaw += MAGIC.yawOff;
  state.pitch = Math.max(ORBIT_MIN_PITCH, Math.min(1.28, state.pitch + MAGIC.pitchOff));
  MAGIC.yawOff = MAGIC.pitchOff = MAGIC.goalYaw = MAGIC.goalPitch = 0;
  MAGIC.draggedAt = performance.now();
}
//: You (on foot, or your car) drawn through what stands between you and the view, as an outline
//: over everything, for the moment the zoom has not yet come in past it.
var magicGhostMaterial = null;
function magicGhostsOf(root) {
  if (!root) return null;
  const key = root.getObjectByName?.("imported-realistic-demo-character")?.uuid || `${root.children.length}:${root.children[0]?.uuid || ""}`;
  if (root.userData.magicGhostKey === key) return root.userData.magicGhosts;
  for (const g of root.userData.magicGhosts || []) g.removeFromParent();
  // Only where you are hidden (drawn where something nearer is already there: GreaterDepth), and
  // faint. Drawn over all of you, as it was, the whole walker went pale and see-through whenever
  // a branch or a pole was in the way -- a ghost in the street and in the profile's portrait.
  if (!magicGhostMaterial) magicGhostMaterial = new THREE.MeshBasicMaterial({ color: 0x6fb8d8, transparent: true, opacity: 0.26, depthTest: true, depthFunc: THREE.GreaterDepth, depthWrite: false, fog: false });
  const sources = [];
  root.traverse((o) => { if (o.isMesh && !o.userData.magicGhost && o.visible && o.geometry) sources.push(o); });
  const ghosts = [];
  for (const o of sources) {
    let g;
    if (o.isSkinnedMesh) { g = new THREE.SkinnedMesh(o.geometry, magicGhostMaterial); g.bindMode = o.bindMode; g.bind(o.skeleton, o.bindMatrix); }
    else if (o.isInstancedMesh) { g = new THREE.InstancedMesh(o.geometry, magicGhostMaterial, o.count); g.instanceMatrix = o.instanceMatrix; }
    else g = new THREE.Mesh(o.geometry, magicGhostMaterial);
    g.userData.magicGhost = true; g.renderOrder = 20; g.castShadow = false; g.receiveShadow = false; g.frustumCulled = false; g.visible = false;
    o.add(g);
    ghosts.push(g);
  }
  root.userData.magicGhostKey = key; root.userData.magicGhosts = ghosts;
  return ghosts;
}
var magicGhostRoots = new Set();
function magicShowGhost(on) {
  if (typeof MAGIC === "undefined" || !MAGIC) return;
  if (!on) {
    if (!MAGIC.hidden) return;
    for (const root of magicGhostRoots) for (const g of root.userData.magicGhosts || []) g.visible = false;
    magicGhostRoots.clear();
    MAGIC.hidden = false;
    return;
  }
  const car = typeof livingCity !== "undefined" && livingCity?.driving ? livingCity.car?.()?.mesh : null;
  const root = car || (typeof avatar !== "undefined" ? avatar : null);
  if (!root) return;
  for (const other of magicGhostRoots) if (other !== root) for (const g of other.userData.magicGhosts || []) g.visible = false;
  magicGhostRoots.clear();
  for (const g of magicGhostsOf(root) || []) g.visible = true;
  magicGhostRoots.add(root);
  MAGIC.hidden = true;
}
// ---- The cameraman (docs/70, docs/city/cameraman.mjs) ------------------------------------------------
//: The view as a camera operator would keep it: every so often it scores shots near the one it holds
//: by how much of you they see -- past buildings, and past the trees, poles, shelters, fences and
//: vehicles the old probe never saw -- and eases to the best; when none near will do, it cuts:
//: mostly a swoop, a fade out and in for a change too big to swoop, a hard cut in the car or for a
//: fight right round; gently inside a room. Talking it looks over your shoulder; in a fight it comes
//: closer, from the side; stopped at a light it cuts to the side of the car. While you hold the view it
//: keeps your direction and bends the camera round what is in the way (nearer, higher, to the
//: side) instead of stopping on it. The outline is drawn only when nothing clears you for a moment.
//: ``kerbsideCameraman("strong" | "gentle" | "off")`` sets how hard it works ("off" is the magic
//: camera as it was); strong is the default.
var CM = {
  lib: null, man: null, occ: null, strength: "strong",
  gatheredAt: -1e9, gx: 0, gz: 0, home: null, bcache: new Map(), bcacheAt: 0,
  lastYaw: null, dragDir: 0, carYaw: null, steer: 0, fadeEl: null, bones: null, bonesKey: null,
  bSince: null, out: null, points: [], probe: null,
};
try { CM.strength = new URLSearchParams(location.search).get("camera") || localStorage.getItem("kerbside.cameraman") || "strong"; } catch { CM.strength = "strong"; }
if (typeof sharedAsset === "function" && typeof location !== "undefined") {
  import(sharedAsset("city/cameraman.mjs?rev=__CITY_HASH__"))
    .then((lib) => { CM.lib = lib; CM.man = lib.createCameraman(); CM.occ = lib.createOccluders(); })
    .catch((e) => console.warn("cameraman not loaded", e));
}
if (typeof window !== "undefined") {
  window.kerbsideCameraman = (strength) => {
    if (strength !== undefined) {
      CM.strength = ["off", "gentle", "strong"].includes(strength) ? strength : "strong";
      try { localStorage.setItem("kerbside.cameraman", CM.strength); } catch {}
      CM.man?.reset();
    }
    return { strength: CM.strength, ready: Boolean(CM.man), occluders: CM.occ?.count ?? 0, ...(CM.man ? { stats: { ...CM.man.stats }, shot: CM.man.current, moving: CM.man.moving } : {}) };
  };
}
function cameramanOn() { return Boolean(CM.man) && CM.strength !== "off"; }
//: What blocks the eye, by the catalogue's archetype: a post (drawn as its upright only: a street
//: light's arm is not a wall), a turned box, a tree (a trunk and a see-through crown) or a crown. The
//: number is how solid it is to the eye.
var CM_BLOCKS = {
  "furniture.street_light": ["post", 1], "furniture.utility_pole": ["post", 1], "furniture.trolley_pole": ["post", 1],
  "furniture.sign_post": ["post", 1], "furniture.traffic_signal": ["post", 1], "furniture.floodlight": ["post", 1],
  "furniture.parking_meter": ["post", 1], "furniture.tower": ["box", 1], "furniture.sign_plate": ["box", 0.9],
  "furniture.shelter": ["box", 0.5], "furniture.ad_panel": ["box", 1], "furniture.cabinet": ["box", 1],
  "furniture.station_entrance": ["box", 1], "furniture.street_cafe": ["box", 0.5], "furniture.play_equipment": ["box", 0.35],
  "barrier.fence_board": ["box", 1], "barrier.fence_picket": ["box", 0.55], "barrier.fence_chainlink": ["box", 0.15],
  "barrier.wall": ["box", 1], "barrier.jersey": ["box", 1], "barrier.parapet": ["box", 1], "barrier.railing": ["box", 0.3],
  "structure.mast": ["post", 1], "vehicle.car": ["box", 0.95],
  "vegetation.tree": ["tree", 0.5], "vegetation.foliage": ["crown", 0.45],
};
var cmM = null, cmV = null, cmA = null, cmB = null;
//: One instance as the cameraman's boxes and balls (cameraman.mjs createOccluders).
function cmInstanceShapes(e, out) {
  const spec = CM_BLOCKS[e.archetype?.id];
  if (!spec) return;
  const o = e.o, g = o.geometry;
  if (!g.boundingBox) g.computeBoundingBox();
  const bb = g.boundingBox;
  if (!bb || !Number.isFinite(bb.min.x)) return;
  cmM ||= new THREE.Matrix4(); cmV ||= new THREE.Vector3(); cmA ||= new THREE.Vector3(); cmB ||= new THREE.Vector3();
  o.getMatrixAt(e.i, cmM); cmM.premultiply(o.matrixWorld);
  const el = cmM.elements;
  const sx = Math.hypot(el[0], el[1], el[2]), sy = Math.hypot(el[4], el[5], el[6]), sz = Math.hypot(el[8], el[9], el[10]);
  if (!(sx > 0 && sy > 0 && sz > 0)) return;
  bb.getCenter(cmV).applyMatrix4(cmM);
  const hx = (bb.max.x - bb.min.x) / 2 * sx, hy = (bb.max.y - bb.min.y) / 2 * sy, hz = (bb.max.z - bb.min.z) / 2 * sz;
  const y0 = cmV.y - hy, y1 = cmV.y + hy, yaw = Math.atan2(-el[2] / sx, el[0] / sx), [shape, opacity] = spec;
  if (!(hy > 0.05) || hy > 60) return;
  // A post is its upright where it stands: the instance's own place (its foot), not the middle of
  // the box its arm or sign makes.
  cmA.setFromMatrixPosition(cmM);
  if (shape === "post") out.push({ kind: "box", cx: cmA.x, cz: cmA.z, hx: 0.14, hz: 0.14, yaw: 0, y0, y1, opacity });
  else if (shape === "box") out.push({ kind: "box", cx: cmV.x, cz: cmV.z, hx: Math.max(0.05, hx), hz: Math.max(0.05, hz), yaw, y0, y1, opacity });
  else if (shape === "tree") {
    const h = y1 - y0, r = Math.max(0.6, Math.min(Math.max(hx, hz) * 0.9, h * 0.45));
    out.push({ kind: "box", cx: cmA.x, cz: cmA.z, hx: 0.18, hz: 0.18, yaw: 0, y0, y1: y0 + h * 0.45, opacity: 1 });
    out.push({ kind: "ball", x: cmV.x, y: y0 + h * 0.65, z: cmV.z, r, opacity });
  } else out.push({ kind: "ball", x: cmV.x, y: cmV.y, z: cmV.z, r: Math.max(0.4, Math.max(hx, hz, hy) * 0.85), opacity });
}
//: What is near what the view follows, gathered again every so often or when it has moved on.
function cmGather(t, now) {
  if (now - CM.gatheredAt < 700 && Math.hypot(t.x - CM.gx, t.z - CM.gz) < 5) return;
  CM.gatheredAt = now; CM.gx = t.x; CM.gz = t.z;
  const out = [];
  const prox = typeof objectProximity !== "undefined" ? objectProximity : null;
  try {
    if (prox?.instancesNear) for (const e of prox.instancesNear(t.x, t.z, 36, (a) => CM_BLOCKS[a.id] !== undefined, 700)) cmInstanceShapes(e, out);
  } catch (e) { /* the catalogue is between indexings */ }
  const cars = typeof livingCity !== "undefined" ? livingCity?.cameraBlockers?.(t.x, t.z, 40) : null;
  for (const v of cars || []) {
    const ground = typeof walkerGroundAt === "function" ? walkerGroundAt(v.x, v.z) : t.y;
    out.push({ kind: "box", cx: v.x, cz: v.z, hx: v.w / 2, hz: v.l / 2, yaw: v.yaw, y0: ground + 0.15, y1: ground + v.h, opacity: 0.95, car: v.id });
  }
  CM.occ.set(out);
  // The buildings' answers are kept a while (they do not move), and dropped now and then for the
  // tiles that have come in since.
  if (now - CM.bcacheAt > 10000 || CM.bcache.size > 150000) { CM.bcache.clear(); CM.bcacheAt = now; }
}
function cmBuildingTop(x, z) {
  const k = (Math.floor(x * 2) + 1048576) * 2097152 + (Math.floor(z * 2) + 1048576);
  let v = CM.bcache.get(k);
  if (v === undefined) { v = orbitBuildingTop(x, z) || null; CM.bcache.set(k, v); }
  return v;
}
//: How hidden ``b`` is from a camera at ``a``: behind a building (solid), or behind the things
//: gathered (some see-through).
function cmOcclusion(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z, L = Math.hypot(dx, dz), n = Math.max(1, Math.ceil(L / 0.5));
  for (let i = 1; i <= n; i += 1) {
    const f = i / n;
    if (f * L < 0.4) continue;
    const hit = cmBuildingTop(b.x + dx * f, b.z + dz * f);
    if (hit && hit.way !== CM.home && b.y + dy * f < hit.top) return 1;
  }
  return CM.occ.occlusion(a, b);
}
function cmSolidAt(p) { const hit = cmBuildingTop(p.x, p.z); return Boolean(hit && hit.way !== CM.home && p.y < hit.top - 0.2); }
//: The points of you the shot must see: head, chest, both hands and feet on foot (the hands where
//: they are); the car's corners and roof at the wheel.
function cmSubjectPoints(t, driving) {
  const pts = CM.points; pts.length = 0;
  const carMesh = driving ? livingCity?.car?.()?.mesh : null;
  if (carMesh) {
    const c = livingCity.car(), yaw = c.yaw ?? carMesh.rotation.y, fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const y = carMesh.position.y;
    for (const [f, r] of [[2, 0.8], [2, -0.8], [-2, 0.8], [-2, -0.8]]) pts.push({ x: carMesh.position.x + fx * f + rx * r, y: y + 0.9, z: carMesh.position.z + fz * f + rz * r, w: 1 });
    pts.push({ x: carMesh.position.x, y: y + 1.4, z: carMesh.position.z, w: 2 });
    return pts;
  }
  const feet = typeof avatar !== "undefined" ? avatar.position : t;
  const fy = Number.isFinite(state.floorY) ? state.floorY : (typeof walkerGroundAt === "function" ? walkerGroundAt(feet.x, feet.z) : feet.y);
  pts.push({ x: feet.x, y: fy + 1.65, z: feet.z, w: 3 }, { x: feet.x, y: fy + 1.25, z: feet.z, w: 2 }, { x: feet.x, y: fy + 0.15, z: feet.z, w: 1 });
  // The hands, from the bones (found once a body).
  const key = typeof avatar !== "undefined" ? avatar.children[0]?.uuid : null;
  if (key && CM.bonesKey !== key) {
    CM.bonesKey = key;
    CM.bones = [avatar.getObjectByName?.("mixamorigRightHand"), avatar.getObjectByName?.("mixamorigLeftHand")].filter(Boolean);
  }
  CM.probe ||= new THREE.Vector3();
  for (const b of CM.bones || []) {
    b.getWorldPosition(CM.probe);
    if (avatar.parent) avatar.parent.worldToLocal(CM.probe);
    if (Number.isFinite(CM.probe.x) && Math.hypot(CM.probe.x - feet.x, CM.probe.z - feet.z) < 2) pts.push({ x: CM.probe.x, y: CM.probe.y, z: CM.probe.z, w: 2 });
  }
  if (pts.length < 5) pts.push({ x: feet.x, y: fy + 1.0, z: feet.z, w: 3 });
  return pts;
}
//: Each frame in City mode (magicCameraStep): the cameraman told where you are and what you are
//: doing, and its shot taken up as the magic camera's offsets.
function cameramanStep(dt, t, now, held, driving) {
  cmGather(t, now);
  CM.home = cmBuildingTop(t.x, t.z)?.way || null;
  // Which way the view is being dragged (the cameraman leads that way only), and how hard the car
  // is turning (no cuts while you steer hard).
  if (CM.lastYaw !== null && dragging) { const d = state.yaw - CM.lastYaw; if (Math.abs(d) > 1e-4) CM.dragDir = Math.sign(d); } else if (!held) CM.dragDir = 0;
  CM.lastYaw = state.yaw;
  const c = driving ? livingCity?.car?.() : null;
  if (c && Number.isFinite(c.yaw)) { if (CM.carYaw !== null && dt > 0) CM.steer += (Math.min(1, Math.abs(Math.atan2(Math.sin(c.yaw - CM.carYaw), Math.cos(c.yaw - CM.carYaw))) / dt / 0.8) - CM.steer) * Math.min(1, dt * 4); CM.carYaw = c.yaw; } else { CM.carYaw = null; CM.steer = 0; }
  const cue = typeof livingCity !== "undefined" ? livingCity?.cameraCue?.() : null;
  const inside = Boolean(cue?.inside) || Number.isFinite(state.floorY);
  const ground = typeof walkerGroundAt === "function" ? walkerGroundAt(t.x, t.z) : t.y;
  const focus = cue?.focus ? { x: cue.focus.x, y: (Number.isFinite(state.floorY) ? state.floorY : ground) + (cue.focus.up ?? 1.4), z: cue.focus.z } : null;
  const aim = magicAim(t);
  const out = CM.man.step({
    now, dt, mode: driving ? "drive" : inside ? "inside" : "walk", strength: CM.strength,
    base: { yaw: state.yaw, pitch: state.pitch, dist: state.dist * (1 + MAGIC.back) }, aim: { x: aim.x, y: aim.y, z: aim.z },
    you: { x: t.x, y: t.y, z: t.z }, points: cmSubjectPoints(t, driving), focus,
    held, dragDir: CM.dragDir, events: cue?.events || [], activity: held ? null : cue?.activity || null,
    speed: MAGIC.speed, travel: { x: MAGIC.vx, z: MAGIC.vz }, steering: CM.steer,
    occlusion: cmOcclusion, solidAt: cmSolidAt,
  });
  CM.out = out;
  const s = out.shot;
  MAGIC.yawOff = s.dYaw; MAGIC.pitchOff = s.dPitch; MAGIC.distK = s.distK; MAGIC.shoulder = s.shoulder; MAGIC.lift = s.lift;
  MAGIC.focusMix = focus ? s.focusMix : 0; MAGIC.focus = focus;
  MAGIC.goalYaw = MAGIC.goalPitch = 0; MAGIC.push = MAGIC.pushGoal = 0; MAGIC.ahead = null;
  MAGIC.cmGhost = out.ghost;
  cmFade(out.fade);
}
//: The fade between two shots: black drawn over the view (not over the panels).
function cmFade(v) {
  if (!CM.fadeEl) {
    if (!(v > 0.001) || typeof document === "undefined" || !canvas?.parentElement) return;
    const el = document.createElement("div");
    el.id = "cameraman-fade";
    el.style.cssText = "position:absolute;inset:0;background:#000;pointer-events:none;opacity:0;z-index:1";
    canvas.parentElement.insertBefore(el, canvas.nextSibling);
    CM.fadeEl = el;
  }
  const o = Math.max(0, Math.min(1, v || 0));
  if (CM.fadeEl.style.opacity !== String(o)) CM.fadeEl.style.opacity = String(o);
}
var cmLook = null, cmShift = null;
//: The shot's own placing over the magic camera's (placeCamera, module 21): the camera to your
//: right by ``shoulder`` and up by ``lift``, the aim moved half as far right and toward what you are
//: dealing with by ``focusMix``. Moves camera.position; returns where to look.
function magicShotLook(aim, yaw) {
  cmLook ||= new THREE.Vector3(); cmShift ||= new THREE.Vector3();
  cmLook.copy(aim);
  if (!cameramanOn() || typeof MAGIC === "undefined") return cmLook;
  const sh = MAGIC.shoulder || 0, rx = Math.cos(yaw), rz = -Math.sin(yaw), f = MAGIC.focus, fm = f ? MAGIC.focusMix || 0 : 0;
  cmLook.x += rx * sh * 0.5 + (f ? (f.x - aim.x) * fm : 0);
  cmLook.y += f ? (f.y - aim.y) * fm : 0;
  cmLook.z += rz * sh * 0.5 + (f ? (f.z - aim.z) * fm : 0);
  cmShift.set(cmLook.x - aim.x + rx * sh * 0.5, cmLook.y - aim.y + (MAGIC.lift || 0), cmLook.z - aim.z + rz * sh * 0.5);
  camera.position.add(cmShift);
  return cmLook;
}
//: The outline under the cameraman: only when it has found you hidden for a moment -- and not for
//: a building the camera has already come in past -- or a building between you a moment (250 ms)
//: and not yet zoomed past.
function cameramanGhost(blocked, buildingGhost) {
  const now = performance.now();
  if (buildingGhost) CM.bSince ??= now; else CM.bSince = null;
  const pulledPast = blocked !== null && !buildingGhost;
  return (Boolean(MAGIC.cmGhost) && !pulledPast) || (CM.bSince !== null && now - CM.bSince > 250);
}
