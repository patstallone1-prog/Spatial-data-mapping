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
