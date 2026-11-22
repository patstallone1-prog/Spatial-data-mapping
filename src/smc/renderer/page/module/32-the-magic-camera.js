// ---- The magic camera ------------------------------------------------------------------------------
//: In City mode the view looks after itself as you go, on foot or at the wheel. It comes round
//: behind you as you turn -- quickly when you have turned right round, so that you are not left
//: walking toward it (walkSteer) -- it looks a little ahead of you, the further the faster you go,
//: and it stands a little further back at speed in the car. Coming up to a building that would be
//: between it and you, it moves to see past it: round a little to one side or up a little, the
//: smallest change that clears it, and back again once there is room. Where nothing clears it (or
//: you have turned the view there yourself) it goes on round, through: it is never inside a
//: building -- it stands outside its far wall, so what is seen is that building's side, never its
//: rooms -- and you are drawn through the wall as an outline, so the view is never lost.
//: Dragging the view is yours: it is left where you put it until you walk on.
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
};
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
  const yaw = state.yaw + dy, pitch = Math.min(MAGIC.maxPitch, state.pitch + dp), d = state.dist * (1 + MAGIC.back);
  magicProbe.set(aim.x + Math.sin(yaw) * Math.cos(pitch) * d, aim.y + Math.sin(pitch) * d, aim.z + Math.cos(yaw) * Math.cos(pitch) * d);
  return orbitBlockedAt(aim, magicProbe) === null;
}
//: Each frame, before the view is placed: how fast you are going, how far ahead to look, and --
//: every so often while you move -- the smallest turn or rise that clears what is in the way.
function magicCameraStep(dt) {
  if (!magicCameraOn()) { MAGIC.yawOff = MAGIC.pitchOff = MAGIC.goalYaw = MAGIC.goalPitch = 0; MAGIC.lead = 0; MAGIC.back = 0; return; }
  const t = state.target;
  if (MAGIC.lastX !== null && dt > 0) {
    const v = Math.hypot(t.x - MAGIC.lastX, t.z - MAGIC.lastZ) / dt;
    MAGIC.speed += (Math.min(v, 40) - MAGIC.speed) * Math.min(1, dt * 3);
  }
  MAGIC.lastX = t.x; MAGIC.lastZ = t.z;
  const moving = MAGIC.speed > 0.3, driving = typeof livingCity !== "undefined" && Boolean(livingCity?.driving);
  const now = performance.now(), held = dragging || now - MAGIC.draggedAt < MAGIC.dragHoldMs;
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
  }
  const ease = (v, goal, rate) => (goal > v ? Math.min(goal, v + rate * dt) : Math.max(goal, v - rate * dt));
  if (!dragging) {
    MAGIC.yawOff = ease(MAGIC.yawOff, MAGIC.goalYaw, MAGIC.yawRate);
    MAGIC.pitchOff = ease(MAGIC.pitchOff, MAGIC.goalPitch, MAGIC.pitchRate);
  }
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
//: The camera at ``position`` looking at ``aim`` with a building in between: never inside it.
//: Inside a building it is taken on out through the far side, so that building's own wall is what
//: it sees -- or, where that is far, back in toward ``aim``, out of it on the near side.
function magicOutOfBuildings(aim, position) {
  const home = orbitBuildingTop(aim.x, aim.z)?.way || null;
  const inside = (x, y, z) => { const hit = orbitBuildingTop(x, z); return Boolean(hit && hit.way !== home && y < hit.top); };
  if (!inside(position.x, position.y, position.z)) return;
  const dx = position.x - aim.x, dy = position.y - aim.y, dz = position.z - aim.z, len = Math.hypot(dx, dy, dz) || 1;
  const ux = dx / len, uy = dy / len, uz = dz / len;
  for (let s = 0.4; s <= 30; s += 0.4) {
    if (!inside(position.x + ux * s, position.y + uy * s, position.z + uz * s)) { position.set(position.x + ux * (s + 0.4), position.y + uy * (s + 0.4), position.z + uz * (s + 0.4)); return; }
  }
  for (let s = 0.4; s < len; s += 0.4) {
    if (!inside(position.x - ux * s, position.y - uy * s, position.z - uz * s)) { position.set(position.x - ux * (s + 0.4), position.y - uy * (s + 0.4), position.z - uz * (s + 0.4)); return; }
  }
}
//: You (on foot, or your car) drawn through what stands between you and the view: an outline,
//: over everything, while something does.
var magicGhostMaterial = null;
function magicGhostsOf(root) {
  if (!root) return null;
  const key = root.getObjectByName?.("imported-realistic-demo-character")?.uuid || `${root.children.length}:${root.children[0]?.uuid || ""}`;
  if (root.userData.magicGhostKey === key) return root.userData.magicGhosts;
  for (const g of root.userData.magicGhosts || []) g.removeFromParent();
  if (!magicGhostMaterial) magicGhostMaterial = new THREE.MeshBasicMaterial({ color: 0x9fe3ff, transparent: true, opacity: 0.38, depthTest: false, depthWrite: false, fog: false });
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
