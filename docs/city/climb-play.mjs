// Climbing and jumping in the city: the thing in front found and measured, a climb begun on it (E,
// or a jump at it), the arrows climbing it, its top stood on or swung over, and every jump flying
// on the way you were going. The rules of it are climb-route.mjs and climb-motion.mjs (pure); this
// is the page's side: rays into the world, the walker moved and bent (climb-pose.mjs).
//
// What can be climbed is what the object catalogue calls climbable (``climb_over``: fences, walls,
// rocks, benches) and trees' trunks; its holds are climb-route's for its kind. Its face is found by
// casting rays at the one mesh in front: where it is, which way it faces, how high its top is, how
// thick, and how far it runs either side.
//
// States: on foot (null), ``climb`` (on a face), ``perch`` (standing on a top, or sat in a tree's
// fork), ``flight`` (in the air: a jump, a vault, a drop). A jump keeps the speed you had: running,
// it carries you on the way you were running; from a wall it carries you off it.

import { createMechanics } from "./mechanics.mjs";
import { createClimbing } from "./climbing.mjs";
import { faceKindOf, faceOf, jumpPlan } from "./climb-route.mjs";
import { createClimbMotion } from "./climb-motion.mjs";
import { bodyFromRig, createLimbIK, faceFrame, limbBones, poseClimber } from "./climb-pose.mjs";

const G = 9.81;
//: How close a thing must be to be climbed or jumped at (m), and how squarely you must face it.
export const CLIMB_REACH_M = 1.15, FACING_DOT = 0.55;

export function createClimbPlay({ THREE, ctx, notify = () => {}, climber = () => ({}), legs = () => ({ height: 0.45, speed: 3 }) }) {
  // The mechanics, from the object catalogue (fetched once, on first need).
  let mech = null, mechP = null;
  function mechanics() {
    if (mech) return mech;
    mechP ||= fetch(ctx.catalogueUrl).then((r) => r.json()).then((cat) => { const M = createMechanics(cat); mech = { M, C: createClimbing(M), cat }; return mech; }).catch((e) => { console.warn("climbing: no catalogue", e); return null; });
    return null;
  }
  mechanics();
  const ik = createLimbIK(THREE);
  let bones = null, bonesKey = null, rigBody = null;
  function rig() {
    const a = ctx.avatar, key = a.getObjectByName?.("imported-realistic-demo-character")?.uuid || a.children.length;
    if (bones && bonesKey === key) return bones;
    bones = limbBones(a); bonesKey = key; rigBody = null;
    return bones;
  }
  const raycaster = new THREE.Raycaster();
  const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), m4 = new THREE.Matrix4();
  let speed = 0, speedDir = [0, 0], speedAt = 0;
  let climb = null, perch = null, flight = null, waitRelease = false, stuckAt = 0, landPose = 0;

  const me = () => ctx.avatar.position;
  const facing = () => { const y = ctx.avatar.rotation.y; return [Math.sin(y), Math.cos(y)]; };
  const feetY = () => me().y - ctx.standY;

  // ---- what is in front --------------------------------------------------------------------------

  //: The climbable thing in front within reach, cheaply (for the hints): { kind, name, d, k } or null.
  function thingInFront(reach = CLIMB_REACH_M) {
    const objs = ctx.objects?.();
    if (!objs) return null;
    const [fx, fz] = facing(), at = me();
    for (let d = 0.3; d <= reach + 1e-9; d += 0.15) {
      const k = objs.blocked(at.x + fx * d, at.z + fz * d, 0.12);
      const kind = k && faceKindOf(k.c.a.id);
      if (kind) return { kind, name: k.c.a.name || kind, d, k };
    }
    return null;
  }

  //: Cast at ``o`` from ``from`` along ``dir`` (Vector3s) within ``far``: the nearest hit, with its
  //: world normal, or null.
  function hitOn(o, from, dir, far) {
    raycaster.set(from, dir); raycaster.far = far;
    const hits = raycaster.intersectObject(o, true);
    const h = hits[0];
    if (!h) return null;
    const n = h.face ? h.face.normal.clone() : dir.clone().negate();
    if (o.isInstancedMesh && h.instanceId !== undefined) { o.getMatrixAt(h.instanceId, m4); m4.premultiply(o.matrixWorld); n.transformDirection(m4); }
    else n.transformDirection(o.matrixWorld);
    return { point: h.point.clone(), normal: n, distance: h.distance };
  }

  //: The face of the thing in front, measured: { spec (climb-route faceOf's), frame (climb-pose
  //: faceFrame), top (world y), d } or null with ``why``.
  function measure(found = thingInFront()) {
    if (!found) return { why: "Nothing to climb in front of you." };
    const o = found.k.c.o, at = me(), [fx, fz] = facing(), y0 = feetY();
    const dir = v1.set(fx, 0, fz).normalize();
    let hit = null;
    for (const h of [1.0, 0.6, 1.4, 0.3]) { hit = hitOn(o, v2.set(at.x, y0 + h, at.z), dir, CLIMB_REACH_M + 0.6); if (hit) break; }
    if (!hit) return { why: `The ${found.name.toLowerCase()} is not square in front of you.` };
    const n = hit.normal.setY(0);
    if (n.lengthSq() < 0.2) return { why: "Nothing upright to climb there." };
    n.normalize();
    if (n.dot(dir) > 0) n.negate();
    const p = hit.point, along = new THREE.Vector3(n.z, 0, -n.x);
    const gy = ctx.groundAt(p.x + n.x * 0.3, p.z + n.z * 0.3);
    // The top: the highest height a level ray still meets it, found in 10 cm steps then refined.
    const across = (u, y, far = 1.2) => hitOn(o, v2.set(p.x + along.x * u + n.x * 0.6, y, p.z + along.z * u + n.z * 0.6), v1.set(-n.x, 0, -n.z), far);
    let top = p.y;
    for (let y = p.y; y < gy + 8; y += 0.1) { if (across(0, y)) top = y; else break; }
    for (let y = top; y < top + 0.1; y += 0.01) { if (across(0, y)) top = y; else break; }
    // Its thickness: from beyond it, back to its far face.
    const back = hitOn(o, v2.set(p.x - n.x * 1.6, Math.max(gy + 0.3, top - 0.08), p.z - n.z * 1.6), v1.set(n.x, 0, n.z), 1.6);
    let thick = back ? Math.max(0.03, 1.6 - back.distance) : 0.04;
    // How far it runs either way, at waist height.
    const waist = Math.min(top - 0.05, gy + 1);
    let u0 = 0, u1 = 0;
    for (let u = 0.3; u <= 4; u += 0.3) { if (across(u, waist)) u1 = u; else break; }
    for (let u = -0.3; u >= -4; u -= 0.3) { if (across(u, waist)) u0 = u; else break; }
    const kind = found.kind;
    if (kind === "tree") { thick = Math.max(0.15, Math.min(1.2, u1 - u0 + 0.3)); u0 = -thick / 2; u1 = thick / 2; }
    const farG = ctx.groundAt(p.x - n.x * (thick + 0.35), p.z - n.z * (thick + 0.35));
    const mat = mech?.cat?.materials?.[found.k.c.a.material]?.mechanics;
    const height = (kind === "tree" ? Math.min(top - gy, 3.8) : top - gy);
    const spec = { kind, key: `${kind}@${Math.round(p.x * 4)},${Math.round(p.z * 4)}`, height_m: height, thickness_m: thick, u0: u0 - 0.1, u1: u1 + 0.1, substance: mat || undefined, far_drop_m: farG - gy };
    return { spec, frame: faceFrame(THREE, new THREE.Vector3(p.x, gy, p.z), along, n), top: gy + height, gy, farG, d: hit.distance, name: found.name };
  }

  // ---- climbing ----------------------------------------------------------------------------------

  function who() { const c = climber(); return { kg: c.kg ?? 75, strength: c.strength ?? 20, load_kg: c.load_kg ?? 0, hands: c.hands ?? "skin", feet: c.feet ?? "shoe_rubber" }; }
  function bodyNow() {
    if (!rigBody) { const B = rig(); rigBody = bodyFromRig(THREE, ctx.avatar, B, {}, ctx.standY) || null; }
    return rigBody;
  }

  //: Begin climbing ``m`` (measure's), from the ground or caught at ``start`` ({ standing,
  //: handsV }). False (with a note) when it cannot be.
  function begin(m, start = {}) {
    const mk = mechanics();
    if (!mk) { notify("Getting a grip… (try again in a moment)"); return false; }
    if (m.spec.height_m < 0.5) { notify("That is low enough to step or jump onto (Space)."); return false; }
    const body = bodyNow();
    climb = { m, motion: createClimbMotion({ face: m.spec, C: mk.C, climber: who(), body: body || undefined, start: { u: 0, ...start } }), frame: m.frame };
    perch = null; flight = null; waitRelease = false;
    return true;
  }

  //: E: climb what is in front; on it, let go.
  function climbKey() {
    if (flight) return false;
    if (climb || perch?.kind === "fork") { dropFrom(); return true; }
    if (perch) return false;
    const m = measure();
    if (!m.spec) { notify(m.why); return true; }
    if (m.d > CLIMB_REACH_M) { notify(`Closer to the ${m.name.toLowerCase()} to climb it.`); return true; }
    if (begin(m)) notify(`Climbing the ${m.name.toLowerCase()}: the arrows climb (two for a diagonal), Space jumps off, E lets go.`);
    return true;
  }

  function arrows(held) {
    return { u: (held.has("ArrowRight") ? 1 : 0) - (held.has("ArrowLeft") ? 1 : 0), v: (held.has("ArrowUp") ? 1 : 0) - (held.has("ArrowDown") ? 1 : 0) };
  }

  //: One frame on the face (the page's walk is stood down while this is on).
  function stepClimb(dt, held) {
    if (perch) return stepPerch(dt, held);
    still();
    if (!climb) return;
    let dir = arrows(held);
    // (Over the top with Up held: Up again only once it is let go -- else it would go back over.
    // Down climbs down this side straight away.)
    if (waitRelease) { if (dir.v > 0) dir = { u: dir.u, v: 0 }; else waitRelease = false; }
    for (const ev of climb.motion.step(dt, dir)) {
      if (ev.kind === "stuck" && performance.now() - stuckAt > 2500) {
        stuckAt = performance.now();
        notify(ev.reason === "nothing that way holds" ? "Nothing that way you can hold on to." : ev.reason === "no hold in reach that way" ? "No hold in reach that way." : ev.reason);
      }
      if (ev.kind === "over") {
        // Now on the far face: the same thing seen from beyond, its frame turned round.
        const F = climb.frame, T = climb.m.spec.thickness_m;
        const o = F.origin.clone().addScaledVector(F.out, -T);
        const farFrame = faceFrame(THREE, new THREE.Vector3(o.x, climb.m.farG, o.z), F.along.clone().negate(), F.out.clone().negate());
        const spec = { ...climb.m.spec, height_m: climb.m.top - climb.m.farG, u0: -climb.m.spec.u1, u1: -climb.m.spec.u0 };
        climb.frame = farFrame;
        climb.motion.crossTo(spec, -ev.u);
        waitRelease = true;
        notify("Over the top: Down climbs down this side, Space drops.");
      }
      if (ev.kind === "stood") {
        const F = climb.frame, T = climb.m.spec.thickness_m;
        perch = { kind: "top", F, m: climb.m, u: climb.motion.frame().hip.u, out: -T / 2, y: climb.m.top, yaw: F.facingYaw(1) };
        climb = null;
        notify("On top: Left and Right turn you, Up walks along it, Space jumps down.");
        return;
      }
      if (ev.kind === "sat") { perch = { kind: "fork", F: climb.frame, m: climb.m, u: 0, out: -climb.m.spec.thickness_m / 2, y: climb.m.top, yaw: climb.frame.facingYaw(1), sitting: true }; climb = null; notify("Sat in the tree: Space jumps down, E climbs down."); return; }
      if (ev.kind === "off") { stepOff(); return; }
    }
    if (!climb) return;
    // Keep the walker (and the view) where the climb has the body.
    const f = climb.motion.frame(), F = climb.frame, hip = F.toWorld(f.hip.u, f.hip.v, f.hip.out, v1);
    // (Its feet where they would be standing under those hips: the pose puts the hips exactly.)
    ctx.placeAvatar(hip.x, hip.y - (bodyNow()?.hip_rest_m ?? 0.95), hip.z, F.facingYaw(f.side));
  }

  //: Down at the foot of the face: standing on the ground in front of it again.
  function stepOff() {
    const f = climb.motion.frame(), F = climb.frame, p = F.toWorld(f.hip.u, 0, 0.4, v1);
    climb = null;
    ctx.moveAvatarTo(p.x, p.z);
  }

  //: The walking clip stood down (its idle under the climb's pose), the walk's lean off.
  function still() { ctx.animateWalk?.(0); ctx.avatar.userData.lastMoving = false; }

  // ---- on a top ----------------------------------------------------------------------------------

  function stepPerch(dt, held) {
    const P = perch, F = P.F, H = P.m.top;
    if (P.kind === "fork") { placePerch(); return; }
    const turn = (held.has("ArrowRight") ? -1 : 0) + (held.has("ArrowLeft") ? 1 : 0);
    if (held.has("ArrowDown") && !P.turning) { P.turning = Math.PI; }
    if (P.turning) { const s = Math.min(P.turning, 3.5 * dt); P.yaw += s; P.turning -= s; if (P.turning < 1e-3) P.turning = 0; }
    P.yaw += turn * 2.2 * dt;
    let moved = 0;
    if (held.has("ArrowUp")) {
      const fx = Math.sin(P.yaw), fz = Math.cos(P.yaw);
      const alongDot = fx * F.along.x + fz * F.along.z, outDot = fx * F.out.x + fz * F.out.z;
      const step = 1.0 * dt;
      if (Math.abs(alongDot) >= Math.abs(outDot)) {
        // Along the top, to its end; past the end, off.
        P.u += step * Math.sign(alongDot); moved = step;
        if (P.u > P.m.spec.u1 + 0.05 || P.u < P.m.spec.u0 - 0.05) { leap(0.6, 0.2); return; }
      } else { leap(0.9, 0.5); return; }   // off the side you face
    }
    placePerch();
    ctx.animateWalk?.(moved, Math.sin(P.yaw), Math.cos(P.yaw));
    ctx.avatar.position.y = H + ctx.standY;
  }

  function placePerch() {
    const P = perch, p = P.F.toWorld(P.u, 0, P.out, v1);
    ctx.placeAvatar(p.x, P.kind === "fork" ? P.m.top - 0.45 : P.m.top, p.z, P.yaw);
  }

  // ---- in the air ----------------------------------------------------------------------------------

  //: Off a top the way you face (``forward`` m/s on, ``up`` m/s up).
  function leap(forward, up) {
    const P = perch, x = me().x, z = me().z;
    flight = { x, y: P.kind === "fork" ? P.m.top - 0.45 : P.m.top, z, vx: Math.sin(P.yaw) * forward, vz: Math.cos(P.yaw) * forward, vy: up, free: 0.5, peak: P.m.top };
    perch = null;
  }

  //: Let go: straight down from where the body is.
  function dropFrom() {
    const at = me(), y = climb ? climb.frame.toWorld(0, climb.motion.frame().hip.v, 0).y - 0.9 : perch ? perch.m.top - 0.45 : feetY();
    const out = climb ? climb.frame.out : null;
    flight = { x: at.x, y, z: at.z, vx: out ? out.x * 0.6 : 0, vz: out ? out.z * 0.6 : 0, vy: 0, free: 0.4, peak: y };
    climb = null; perch = null;
  }

  //: Space. On a face: push off it, back the way you face from. On a top: jump off it the way you
  //: face. On foot with something climbable square in front: at it (onto it, over it, up it).
  //: Otherwise a jump that carries on the way you are going. False when a jump cannot be made.
  function jumpKey() {
    if (flight) return true;
    const j = legs();
    if (climb) {
      const F = climb.frame, f = climb.motion.frame(), hip = F.toWorld(f.hip.u, f.hip.v, f.hip.out, v1);
      flight = { x: hip.x, y: hip.y - 0.9, z: hip.z, vx: F.out.x * 2.2, vz: F.out.z * 2.2, vy: Math.min(2.2, j.speed * 0.7), free: 0.6, peak: hip.y };
      climb = null;
      return true;
    }
    if (perch) { leap(Math.max(1.8, speed), j.speed); return true; }
    if (j.height < 0.03) return false;
    if (performance.now() - speedAt > 200) speed = 0;
    const running = speed > 2.2;
    const found = thingInFront(CLIMB_REACH_M + (running ? 0.6 : 0));
    if (found) {
      const m = measure(found);
      if (m.spec) {
        const plan = jumpPlan(faceOf(m.spec), { jump_m: j.height, distance_m: m.d, running, body: bodyNow() || undefined });
        if (plan.action !== "none" && act(plan, m)) return true;
      }
    }
    // A plain jump: up by the legs, on the way you were going.
    const at = me();
    flight = { x: at.x, y: feetY(), z: at.z, vx: speedDir[0] * speed, vz: speedDir[1] * speed, vy: j.speed, free: 0, peak: feetY() };
    return true;
  }

  function act(plan, m) {
    const F = m.frame, T = m.spec.thickness_m, at = me();
    if (plan.action === "land_top") {
      // A hop up onto it: an arc to the middle of its top, then stood there.
      const to = F.toWorld(0, 0, -T / 2);
      flight = arcTo(at, feetY(), to.x, m.top, to.z, 0.55, () => { perch = { kind: "top", F, m, u: 0, out: -T / 2, y: m.top, yaw: F.facingYaw(1) }; });
      return true;
    }
    if (plan.action === "vault") {
      // A hand on the top and the legs swung over it, landing a stride beyond.
      const to = F.toWorld(0, 0, -T - 0.7);
      flight = arcTo(at, feetY(), to.x, m.farG, to.z, 0.7, null, { hand: F.toWorld(0, m.top - m.gy + 0.02, -T / 2), over: m.top + 0.15 });
      return true;
    }
    if (plan.action === "catch_top" || plan.action === "catch_holds") {
      const ok = begin(m, { standing: false, handsV: plan.action === "catch_top" ? m.spec.height_m : plan.reach_v });
      if (ok) notify(plan.action === "catch_top" ? "Caught the top: Up pulls over." : "Caught on: the arrows climb.");
      return ok;
    }
    return false;
  }

  //: A scripted arc from (x, y, z) to (tx, ty, tz) in ``s`` seconds, high enough to clear ``over``.
  function arcTo(at, y, tx, ty, tz, s, done, extra = {}) {
    const peak = Math.max(y, ty, extra.over ?? -Infinity) + 0.25;
    return { scripted: true, t: 0, s, from: [at.x, y, at.z], to: [tx, ty, tz], peak, done, hand: extra.hand || null, free: Infinity };
  }

  //: One frame in the air: on along the jump's line (a little steered by the arrows), falling;
  //: down where the ground (or the top aimed at) is.
  function stepAir(dt, held) {
    const fl = flight;
    if (!fl) return;
    still();
    if (fl.scripted) {
      fl.t = Math.min(1, fl.t + dt / fl.s);
      const t = fl.t, [x0, y0, z0] = fl.from, [x1, y1, z1] = fl.to;
      // A parabola through the peak: up fast, down onto the mark.
      const base = y0 + (y1 - y0) * t, lift = 4 * (fl.peak - Math.max(y0, y1) + Math.abs(y1 - y0) / 2) * t * (1 - t);
      ctx.placeAvatar(x0 + (x1 - x0) * t, base + lift, z0 + (z1 - z0) * t, Math.atan2(x1 - x0, z1 - z0));
      if (t >= 1) { flight = null; landPose = performance.now(); fl.done?.(); if (!perch) ctx.moveAvatarTo(x1, z1); }
      return;
    }
    // A touch of steering in the air, no more.
    const [fx, fz] = facing();
    const push = (held.has("ArrowUp") ? 1 : 0) - (held.has("ArrowDown") ? 0.5 : 0);
    fl.vx += fx * push * 1.5 * dt; fl.vz += fz * push * 1.5 * dt;
    fl.vy -= G * dt;
    const dx = fl.vx * dt, dz = fl.vz * dt;
    if (fl.free > 0) { fl.x += dx; fl.z += dz; fl.free -= Math.hypot(dx, dz); }
    else {
      // Through the world's own collisions (a wall stops you in the air as on foot).
      ctx.avatar.position.x = fl.x; ctx.avatar.position.z = fl.z;
      ctx.moveWalker?.(dx, dz);
      fl.x = ctx.avatar.position.x; fl.z = ctx.avatar.position.z;
    }
    fl.y += fl.vy * dt;
    fl.peak = Math.max(fl.peak, fl.y);
    const ground = ctx.groundAt(fl.x, fl.z);
    if (fl.y <= ground && fl.vy < 0) {
      const fell = fl.peak - ground;
      flight = null; landPose = performance.now();
      ctx.moveAvatarTo(fl.x, fl.z);
      if (fell > 3) notify(`A hard landing (${fell.toFixed(1)} m).`);
      return;
    }
    ctx.placeAvatar(fl.x, fl.y, fl.z, Math.abs(fl.vx) + Math.abs(fl.vz) > 0.3 ? Math.atan2(fl.vx, fl.vz) : null);
  }

  // ---- the body ----------------------------------------------------------------------------------

  //: Bend the walker for what is going on (after the walking clip): on a face, every limb to its
  //: hold; on a top, sat; in the air, the knees tucked and the arms up; just landed, a crouch.
  //: True when it posed the body (the page's other poses then stand down).
  function pose() {
    const B = rig();
    if (climb) {
      const body = bodyNow();
      // (The walker's origin is ``standY`` above its feet: the hips' height above the origin.)
      poseClimber(THREE, ctx.avatar, B, ik, climb.frame, climb.motion.frame(), (body?.hip_rest_m ?? 0.95) - ctx.standY, body?.hip_bone_m ?? 0);
      return true;
    }
    const tuck = (k) => {
      const side = new THREE.Vector3(1, 0, 0).applyQuaternion(ctx.avatar.quaternion);
      ik.turnAbout(B.lThigh, side, -0.9 * k); ik.turnAbout(B.rThigh, side, -0.9 * k);
      ik.turnAbout(B.lShin, side, 1.5 * k); ik.turnAbout(B.rShin, side, 1.5 * k);
    };
    if (perch?.kind === "fork" || perch?.sitting) { tuck(1); return true; }
    if (flight) {
      const k = flight.scripted ? Math.sin(Math.PI * flight.t) : Math.min(1, Math.max(0, 0.6 + flight.vy * 0.15));
      tuck(0.7 * k);
      const side = new THREE.Vector3(1, 0, 0).applyQuaternion(ctx.avatar.quaternion);
      ik.turnAbout(B.lUpper, side, -0.9 * k); ik.turnAbout(B.rUpper, side, -0.9 * k);
      // A vault: a hand down on the top as the legs go over.
      if (flight.hand && B.lUpper) ik.reach(B.lUpper, B.lFore, B.lHand, flight.hand, flight.hand.clone().add(new THREE.Vector3(0, 0.6, 0)), Math.sin(Math.PI * Math.min(1, flight.t * 1.6)));
      return true;
    }
    const since = (performance.now() - landPose) / 1000;
    if (since < 0.3) { tuck(0.6 * (1 - since / 0.3)); return false; }
    return false;
  }

  //: The walker's pace on foot, for a jump to carry on with.
  function noteSpeed(metres, dt) {
    if (!(dt > 0)) return;
    const now = metres / dt, t = performance.now();
    // (Stood still a while, the pace is none: the walk only reports when it moves.)
    if (t - speedAt > 200) speed = 0;
    speed += (now - speed) * Math.min(1, dt * 8);
    speedDir = facing(); speedAt = t;
  }

  //: What the hints say here: [{ key, label }] for the climbing controls that apply.
  function hints() {
    if (climb) return [{ key: "↑↓←→", label: "Climb" }, { key: "Space", label: "Jump off" }, { key: "E", label: "Let go" }];
    if (perch?.kind === "fork") return [{ key: "Space", label: "Jump down" }, { key: "E", label: "Climb down" }];
    if (perch) return [{ key: "↑", label: "Walk along the top" }, { key: "Space", label: "Jump down" }];
    if (flight) return [];
    const t = thingInFront();
    return t ? [{ key: "E", label: `Climb the ${t.name.toLowerCase()}` }, { key: "Space", label: `Jump at the ${t.name.toLowerCase()}` }] : [];
  }

  //: For the hint strip (affordances.mjs): what is in front to climb and what Space would do at
  //: it -- {climb: {name, kind, ok, reason}, jump: {action, name}} -- or null. A few raycasts: the
  //: page asks a few times a second, not each frame.
  function front() {
    if (climb || perch || flight) return null;
    const found = thingInFront();
    if (!found) return null;
    const m = measure(found), name = found.name;
    let jump = null;
    if (m.spec) {
      const j = legs();
      const running = performance.now() - speedAt <= 200 && speed > 2.2;
      try { jump = { action: jumpPlan(faceOf(m.spec), { jump_m: j.height, distance_m: m.d, running, body: bodyNow() || undefined }).action, name }; } catch { jump = null; }
    }
    return { climb: { name, kind: found.kind, ok: Boolean(m.spec), reason: m.why || null }, jump };
  }

  return {
    //: What the body is doing: "climb" (on a face), "perch" (on a top), "fork" (in a tree), "air",
    //: or null (on foot).
    get mode() { return climb ? "climb" : perch ? (perch.kind === "fork" ? "fork" : "perch") : flight ? "air" : null; },
    front,
    get climbing() { return Boolean(climb || perch); },
    get airborne() { return Boolean(flight); },
    get busy() { return Boolean(climb || perch || flight); },
    stepClimb, stepAir, pose, climbKey, jumpKey, noteSpeed, hints, thingInFront, measure,
    //: Off whatever is going on, standing where you are (a car, a menu, a teleport).
    reset() { climb = null; perch = null; flight = null; },
  };
}
