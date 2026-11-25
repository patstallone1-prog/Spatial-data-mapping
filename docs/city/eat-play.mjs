// Eating and drinking: what is in your hand held as it is held (a pint round its body, a wine glass
// by its stem, a mug by its handle, a burger in both hands, a plate on the flat of the hand), and
// U to take a bite or a sip -- held, to go on until it is finished.
//
// A sip: the glass up to the lips and tipped until the drink reaches its rim -- further each time,
// as it empties (liquid.mjs: the surface stays level in the world) -- then on, so it runs over the
// lip into the mouth in a stream as thick as the flow; tipped back, lowered, swallowed.
//
// A bite: the food up to the mouth with the edge nearest it foremost, the head forward a little,
// the teeth closing on it (the bite's scalloped edge taken out of every layer: bites.mjs), lowered,
// chewed and swallowed. A plate at a table: the knife saws a forkful off the steak while the fork
// holds it, the fork takes it up to the mouth; a spoon dips into the soup (its level going down) and
// comes up level so as not to spill; a hand picks up the fries two at a time.
//
// What is eaten is built from its recipe (dish-models.mjs); nothing is eaten for the books until the
// last bite (``finish``: the page tells the city it was used).
//
// The animation is driven by the things, not the arms: each frame says where the glass, the food or
// the fork is (at the lips, tipped so far); the hands are reached to grip it there (climb-pose.mjs
// IK), the fingers curled round it. Seated in first person the walker is not drawn, but what is
// eaten still comes up under the view and tips.

import { createLimbIK, limbBones } from "./climb-pose.mjs";
import { makeDish } from "./dish-models.mjs";
import { makeUtensil, VESSELS } from "./tableware.mjs";
import { createStream, tiltToReach } from "./liquid.mjs";

//: How long each part of a mouthful takes (s).
export const EAT_TIMES = { raise: 0.6, tip: 0.45, sip: 1.1, untip: 0.35, lower: 0.55, bite: 0.28, pull: 0.25, chew: 1.7, swallow: 0.45, reach: 0.5, scoop: 0.35, saw: 1.0, mouth: 0.25 };
//: A sip (m³): 25 ml, a gulp of water is about that.
export const SIP_M3 = 25e-6;
//: Held a moment, U goes on bite after bite.
export const HOLD_S = 0.35;

const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

//: The plan of a mouthful, by what it is (pure: tests/city_eat_play.test.mjs): the phases in
//: order, [name, seconds], and what happens at the end of which.
export function mouthfulPlan(action) {
  const T = EAT_TIMES;
  switch (action) {
    case "sip": return [["raise", T.raise], ["tip", T.tip], ["sip", T.sip], ["untip", T.untip], ["lower", T.lower], ["swallow", T.swallow]];
    case "straw": return [["raise", T.raise], ["sip", T.sip], ["lower", T.lower], ["swallow", T.swallow]];
    case "bite": return [["raise", T.raise], ["bite", T.bite], ["pull", T.pull], ["lower", T.lower], ["chew", T.chew], ["swallow", T.swallow]];
    case "cut": return [["reach", T.reach], ["saw", T.saw], ["raise", T.raise], ["mouth", T.mouth], ["pull", T.pull], ["lower", T.lower], ["chew", T.chew], ["swallow", T.swallow]];
    case "scoop": return [["reach", T.reach], ["scoop", T.scoop], ["raise", T.raise], ["mouth", T.mouth], ["pull", T.pull], ["lower", T.lower], ["chew", T.chew], ["swallow", T.swallow]];
    case "spoon": return [["reach", T.reach], ["scoop", T.scoop], ["raise", T.raise], ["mouth", T.mouth], ["pull", T.pull], ["lower", T.lower], ["swallow", T.swallow]];
    case "pick": return [["reach", T.reach], ["raise", T.raise], ["bite", T.bite], ["pull", T.pull], ["lower", T.lower], ["chew", T.chew], ["swallow", T.swallow]];
    default: return [];
  }
}
//: What a part of a dish is eaten by (pure): sip, straw, bite (held to the mouth), cut (knife and
//: fork), scoop (a fork or chopsticks), spoon, or pick (a hand).
export function actionFor(part, tool) {
  if (part.kind === "drink") return tool === "straw" ? "straw" : "sip";
  if (part.kind === "bite") return tool === "hand" ? "bite" : part.cutPiece ? "cut" : "scoop";
  if (part.kind === "pieces") return tool === "hand" || tool === "chopsticks" ? (tool === "hand" ? "pick" : "scoop") : "scoop";
  if (part.kind === "pool" || part.kind === "spoonfuls") return "spoon";
  return tool === "spoon" ? "spoon" : "scoop";
}
//: The next part of a dish to eat: the one with the most left of it (so a plate is eaten round,
//: the steak and its frites together), drinks alone; null when it is all eaten.
export function nextPart(food) {
  // (Any not done, even one whose share left reads 0: it is finished by eating it.)
  let best = null, bl = -Infinity;
  for (const p of food) { if (p.done()) continue; const l = p.left(); if (l > bl + 1e-9) { bl = l; best = p; } }
  return best;
}
//: What is held in which hand for a dish (pure): {R, L} of a utensil kind, "food" or "vessel".
export function handsFor(form, tool, { seated = false } = {}) {
  if (form === "drink") return { R: "vessel", L: null };
  if (tool === "hand") return { R: "food", L: seated ? null : "plate" };
  if (tool === "fork_knife") return seated ? { R: "knife", L: "fork" } : { R: "fork", L: "plate" };
  const u = tool === "chopsticks" ? "chopsticks" : tool === "spoon" ? "spoon" : "fork";
  return seated ? { R: u, L: form === "noodle_soup" ? "spoon" : null } : { R: u, L: "plate" };
}

//: ``madeOf(item)``: the plate as a cook made it (plated.mjs madeFrom, with a ``sig``), or null for
//: the dish as the recipe has it.
export function createEatPlay({ THREE, ctx, R, notify = () => {}, finish = async () => true, tableAhead = () => null, seated = () => false, firstPerson = () => false, madeOf = () => null }) {
  const ik = createLimbIK(THREE);
  const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
  const Q = () => new THREE.Quaternion();
  const root = new THREE.Group(); root.name = "eating";
  const kept = new Map();   // item -> its dish part-eaten (put away and taken out again)
  let cur = null, bones = null, bonesKey = null, fingersOf = new Map();
  let downAt = 0, holding = false, queued = 0;
  const streamMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.05, clearcoat: 1, transparent: true, opacity: 0.85 });
  const stream = createStream(THREE, streamMat);
  root.add(stream.mesh);

  // ---- the body's frame ------------------------------------------------------------------------------
  const av = () => ctx.avatar;
  const fwd = () => V(0, 0, 1).applyQuaternion(av().quaternion).setY(0).normalize();
  const left = () => V(1, 0, 0).applyQuaternion(av().quaternion).setY(0).normalize();
  const UP = V(0, 1, 0);
  //: A point ``right`` m to the walker's right, ``up`` m over its feet, ``ahead`` m in front.
  const at = (right, up, ahead) => av().position.clone().addScaledVector(left(), -right).addScaledVector(fwd(), ahead).setY(av().position.y - ctx.standY + up);
  function rig() {
    const a = av(), key = a.getObjectByName?.("imported-realistic-demo-character")?.uuid || a.children.length;
    if (bones && bonesKey === key) return bones;
    bones = limbBones(a); bonesKey = key; fingersOf = new Map();
    const jaw = a.getObjectByName?.("mixamorigJaw") || a.getObjectByName?.("Jaw") || a.getObjectByName?.("jaw") || null;
    bones.jaw = jaw;
    return bones;
  }
  //: Where the mouth is: before the head (or, in first person, just under the eyes and out from
  //: them, past the camera's near plane).
  function mouth() {
    const B = rig();
    if (firstPerson() && ctx.camera) { const c = ctx.camera(); const p = c.getWorldPosition(V()); return p.addScaledVector(UP, -0.1).addScaledVector(fwd(), 0.1); }
    if (B.head) { const h = B.head.getWorldPosition(V()); return h.addScaledVector(UP, 0.06).addScaledVector(fwd(), 0.095); }
    return at(0, 1.58, 0.1);
  }

  // ---- holding things --------------------------------------------------------------------------------

  //: A thing's pose in the world from a frame: ``z`` its +z (unit), ``y`` its +y, at ``p``.
  function poseOf(obj, p, z, y = UP) {
    const Z = z.clone().normalize(), X = V().crossVectors(y, Z).normalize(), Y = V().crossVectors(Z, X);
    obj.position.copy(p);
    obj.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
    obj.updateMatrixWorld(true);
  }
  //: Where a hand holds a thing, in the thing's frame: the palm's contact point ``c``, the way the
  //: fingers point ``f`` and the way the palm faces ``n``; and how far the fingers close.
  function gripOf(obj, hand) {
    const u = obj.userData.utensil, v = obj.userData.vessel, held = obj.userData.held;
    if (u) return { c: V(...u.grip), f: V(0, 0, 1), n: V(0, -1, 0), curl: 0.8 };
    if (v) {
      const g = v.grip || { kind: "wrap", at: [0, v.rim * 0.45, 0] }, y = g.at[1];
      const r = g.kind === "stem" ? 0.0045 : g.kind === "handle" ? Math.abs(g.at[0]) + 0.004 : radiusOuter(v.outer, y) + 0.004;
      return { c: V(r, y, 0), f: V(0, 0, -1), n: V(-1, 0, 0), curl: g.kind === "wrap" ? 0.55 : g.kind === "handle" ? 0.8 : 0.9 };
    }
    if (held) {
      const s = hand === "L" ? -1 : 1;
      if (held.hands === 2) return { c: V(s * held.halfWidth, held.height * 0.45, 0), f: V(0, 0, -1), n: V(-s, 0, 0), curl: 0.45 };
      return { c: V(0, -0.004, -held.depth * 0.3), f: V(0, 0, 1), n: V(0, 1, 0), curl: 0.35 };
    }
    // A plate (or a bowl, a basket) on the flat of the left hand, the thumb over its rim.
    return { c: V(-0.07, -0.002, 0.02), f: V(1, 0, 0), n: V(0, 1, 0), curl: 0.15 };
  }
  const radiusOuter = (profile, y) => { let r = 0; for (let i = 1; i < profile.length; i += 1) { const [r0, y0] = profile[i - 1], [r1, y1] = profile[i]; if (y0 !== y1 && (y - y0) * (y - y1) <= 0) r = Math.max(r, r0 + (r1 - r0) * (y - y0) / (y1 - y0)); } return r; };
  //: The world targets for a hand gripping ``obj``: its wrist, the way its fingers point and its
  //: thumb side.
  function handOn(obj, hand) {
    const g = gripOf(obj, hand), q = obj.getWorldQuaternion(Q()), p = obj.getWorldPosition(V());
    const c = g.c.clone().applyQuaternion(q).add(p), f = g.f.clone().applyQuaternion(q), n = g.n.clone().applyQuaternion(q);
    // The thumb's side: f x n for a right hand, n x f for a left.
    const a = hand === "R" ? V().crossVectors(f, n) : V().crossVectors(n, f);
    return { wrist: c.addScaledVector(f, -0.075).addScaledVector(n, -0.022), f, a, curl: g.curl };
  }

  // ---- what is in hand -------------------------------------------------------------------------------

  //: The thing now in the hand (an item id that is food or drink), or null: what is held follows.
  function sync(item) {
    if (cur?.item === item) return;
    if (cur) putAway();
    if (!item) return;
    const it = R.items[item];
    if (!it || it.kind !== "prepared_food") return;
    let made = null;
    try { made = madeOf(item); } catch { made = null; }
    const key = made ? `${item}|${made.sig || ""}` : item;
    const dish = kept.get(key) || makeDish(THREE, R, item, made ? { made } : {});
    kept.set(key, dish);
    begin(item, dish);
  }
  function putAway() {
    if (!cur) return;
    root.remove(cur.dish.group);
    for (const u of Object.values(cur.tools)) if (u) root.remove(u);
    for (const o of cur.loose) root.remove(o);
    stream.mesh.visible = false;
    cur = null;
  }
  function begin(item, dish) {
    const scene = av().parent;
    if (root.parent !== scene) scene?.add(root);
    const sit = seated() && tableAhead();
    const hands = handsFor(dish.form, dish.tool, { seated: Boolean(sit) });
    cur = { item, key: dish.made ? `${item}|${dish.made.sig || ""}` : item, dish, sit, hands, tools: {}, loose: [], action: null, phase: 0, t: 0, next: null, part: null, carry: null, held: null, gulp: 0, chew: 0, bitten: 0 };
    root.add(dish.group);
    for (const side of ["R", "L"]) {
      const k = hands[side];
      if (k && !["food", "vessel", "plate"].includes(k)) { const u = makeUtensil(THREE, k); root.add(u); cur.tools[side] = u; }
    }
    // A food held in the hand: the first part taken off its plate (a burger, a slice), its plate
    // left on the table or put away. (Fries, wings: picked from the basket one by one.)
    const first = nextPart(dish.food);
    if (hands.R === "food" && first?.kind === "bite") takeUp(first);
  }
  //: Into the hand: ``part`` (a food's group) out of the dish, held by it as a food is held.
  function takeUp(part) {
    if (!part?.group) return;
    cur.part = part;
    const g = part.group;
    const wrap = new THREE.Group(); wrap.name = "held-food";
    // Turned so the edge it is bitten from (its ``front``) is toward the mouth (the wrap's +z),
    // and held by its middle.
    const [fx, fz] = part.front || [0, 1];
    wrap.add(g); g.position.set(0, 0, 0); g.quaternion.setFromAxisAngle(UP, -Math.atan2(fx, fz));
    wrap.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(g), size = box.getSize(V()), mid = box.getCenter(V());
    g.position.set(-mid.x, -box.min.y, -mid.z);
    wrap.userData.held = { hands: part.hands || (size.x > 0.12 ? 2 : 1), halfWidth: Math.min(0.07, size.x / 2), height: size.y, depth: size.z };
    root.add(wrap);
    cur.held = wrap;
  }

  // ---- U ---------------------------------------------------------------------------------------------

  //: U down (true) or up (false): a tap takes a mouthful; held, it goes on till it is finished.
  function press(down) {
    if (!cur) return false;
    if (down) { downAt = performance.now(); queued = Math.max(queued, 1); holding = true; }
    else holding = false;
    return true;
  }

  function startMouthful() {
    const part = cur.held ? cur.part : nextPart(cur.dish.food);
    if (!part || part.done()) return false;
    const action = cur.held ? "bite" : actionFor(part, cur.dish.tool);
    cur.action = action; cur.part = part; cur.phase = 0; cur.t = 0; cur.plan = mouthfulPlan(action);
    cur.sipFrom = null;
    return true;
  }

  // ---- each frame -----------------------------------------------------------------------------------

  function step(dt) {
    if (!cur) return;
    const c = cur;
    if (!c.action && (queued > 0 || (holding && performance.now() - downAt > HOLD_S * 1000))) {
      queued = Math.max(0, queued - 1);
      if (!startMouthful()) { done(); return; }
    }
    if (c.action) {
      c.t += dt;
      while (c.action && c.t >= c.plan[c.phase][1]) { c.t -= c.plan[c.phase][1]; endPhase(c.plan[c.phase][0]); c.phase += 1; if (c.phase >= c.plan.length) { c.action = null; if (finished()) { done(); return; } } }
    }
    place(dt);
  }
  const finished = () => cur.dish.food.every((p) => p.done());
  async function done() {
    const item = cur.item;
    kept.delete(cur.key || item);
    putAway();
    holding = false; queued = 0;
    await finish(item);
  }
  //: At the end of a phase, what it did: the bite taken, the forkful cut off, the sip swallowed.
  function endPhase(name) {
    const c = cur, p = c.part;
    if (name === "bite") {
      if (c.carry) { root.remove(c.carry); c.carry = null; }
      else if (p.bite) p.bite();
      c.bitten += 1;
    }
    if (name === "saw") { const r = p.cutPiece?.(0.028); if (r) { c.carry = r.piece; root.add(c.carry); } }
    if (name === "scoop") {
      const big = p.list?.[0], size = big ? new THREE.Box3().setFromObject(big).getSize(V()) : null;
      if (big && Math.max(size.x, size.z) > 0.045 && c.dish.tool !== "chopsticks") {
        // Too big for a forkful (an egg, a rasher): a forkful of it off it, it smaller.
        const piece = big.clone(); piece.scale.multiplyScalar(0.04 / Math.max(size.x, size.z)); c.carry = piece; root.add(piece);
        big.scale.multiplyScalar(0.7); if (Math.max(size.x, size.z) * 0.7 < 0.03) p.take();
      } else { const got = p.take?.(); if (got) { c.carry = got.isObject3D ? got : null; if (c.carry) root.add(c.carry); } }
    }
    if (name === "reach" && c.action === "pick") { const got = p.take?.(); if (got) { c.carry = got; root.attach(got); } }
    if (name === "mouth") { if (c.carry) { root.remove(c.carry); c.carry = null; } }
    if (name === "chew" || name === "swallow") c.chew = 0;
  }

  //: Where everything is this frame.
  function place(dt) {
    const c = cur, dish = c.dish;
    const M = mouth(), F = fwd(), Lf = left(), Rt = Lf.clone().negate();
    const ph = c.action ? c.plan[c.phase][0] : null, u = c.action ? ease(c.t / c.plan[c.phase][1]) : 0;
    const name = c.action;
    const away = F.clone().negate();   // a thing's front toward the walker
    // Where the dish is: on the table in front, or held (a plate on the left hand at the chest).
    dish.group.visible = true;
    if (c.sit) {
      const T = c.sit;
      poseOf(dish.group, T.point, T.toward ? T.toward.clone() : away);
    } else if (c.held?.userData.held.hands === 2) {
      // Both hands on the burger: its plate is not carried about.
      dish.group.visible = false;
    } else if (c.hands.L === "plate") {
      poseOf(dish.group, at(-0.06, 1.0, 0.34), away);
    } else if (dish.form === "drink") {
      // (Placed below with the glass.)
    } else if (!c.held) {
      poseOf(dish.group, at(0, 1.0, 0.34), away);
    }
    // Rest places (between mouthfuls): a glass at the chest, a food at the chest, utensils over the plate.
    const restR = c.sit ? c.sit.point.clone().addScaledVector(Rt, 0.17).addScaledVector(F, -0.12).setY(c.sit.point.y + 0.12) : at(0.15, 1.04, 0.3);
    const restL = c.sit ? c.sit.point.clone().addScaledVector(Lf, 0.17).addScaledVector(F, -0.12).setY(c.sit.point.y + 0.12) : at(-0.12, 1.06, 0.3);
    let streamOn = false;

    // ---- a drink ----
    if (dish.form === "drink") {
      const glass = dish.vessel, spec = glass.userData.vessel, D = dish.drink;
      const lipLocal = V(0, spec.rim, spec.inner[spec.inner.length - 1][0]);
      let p = restR.clone(), tilt = 0;
      const atLips = () => {
        // The glass's lip on the lower lip, the glass tipped ``tilt`` toward the mouth (its +z
        // toward the walker): placed so the lip stays put as it tips.
        const q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), away.clone());
        const qt = new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), tilt);
        const lipW = lipLocal.clone().applyQuaternion(qt).applyQuaternion(q);
        return M.clone().addScaledVector(UP, -0.012).addScaledVector(F, 0.006).sub(lipW);
      };
      if (name === "sip" || name === "straw") {
        const need = name === "sip" ? tiltToReach(spec.inner, D.v) : 0;
        c.sipFrom ??= D.v;
        if (ph === "raise") { tilt = need * 0.25 * u; p = restR.clone().lerp(atLips(), u); }
        else if (ph === "tip") { tilt = need * (0.25 + 0.75 * u); p = atLips(); }
        else if (ph === "sip") {
          // On past where it reaches the rim, a little at a time: tipped further while it runs slower
          // than a sip's pace (30 ml/s), back while faster, and back to the rim once a sip is in.
          const sipped = c.sipFrom - D.v >= SIP_M3;
          c.extra = Math.max(0, (c.extra || 0) + dt * (sipped ? -0.5 : D.flow < 3e-5 ? 0.12 : -0.2));
          tilt = Math.min(Math.PI * 0.62, need + c.extra);
          if (name === "straw") { D.v = Math.max(0, D.v - SIP_M3 * dt / EAT_TIMES.sip); tilt = 0; }
          p = atLips();
        } else if (ph === "untip") { tilt = (c.lastTilt ?? need) * (1 - u); p = atLips(); c.extra = 0; }
        else if (ph === "lower") { tilt = 0; p = atLips().lerp(restR, u); }
        if (ph === "swallow") { c.gulp = Math.sin(Math.PI * u); c.sipFrom = null; }
        if (ph !== "untip") c.lastTilt = tilt;
      }
      // The glass: upright facing the walker, then tipped.
      const q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), away.clone()).multiply(new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), tilt));
      dish.group.position.copy(p); dish.group.quaternion.copy(q); dish.group.updateMatrixWorld(true);
      const flow = D.step(dt, tilt);
      dish.drinkMesh.update(D);
      if (glass.userData.ice) glass.userData.ice.position.y = Math.min(0, D.level() - spec.rim * 0.8);
      if (flow > 0) {
        streamOn = true;
        const lipW = glass.localToWorld(lipLocal.clone()), into = M.clone().addScaledVector(F, -0.01).addScaledVector(UP, -0.004);
        stream.set(lipW, into, flow, away);
        streamMat.color.copy(dish.drinkMesh.parts[0].mesh.material.color);
      }
      c.objR = glass;
    }

    // ---- a food held in the hand ----
    if (c.held) {
      const H = c.held, part = c.part;
      let p = restR.clone().lerp(at(0, 1.05, 0.3), H.userData.held.hands === 2 ? 1 : 0), pitch = 0.15;
      const bitePoint = () => {
        const n = part.nextAt?.();
        if (!n) return V();
        const frame = part.holder || part.frame?.() || part.group;
        return frame.localToWorld(V(n.x, n.y, n.z)).sub(H.getWorldPosition(V()));
      };
      const toMouth = () => M.clone().addScaledVector(F, 0.012).sub(bitePoint());
      if (name === "bite") {
        if (ph === "raise") p = p.lerp(toMouth(), u);
        else if (ph === "bite") p = toMouth().addScaledVector(F, -0.012 * Math.sin(Math.PI * u));
        else if (ph === "pull") p = toMouth().addScaledVector(F, 0.05 * u).addScaledVector(UP, -0.03 * u);
        else if (ph === "lower") p = toMouth().addScaledVector(F, 0.05).addScaledVector(UP, -0.03).lerp(p, u);
        if (ph === "chew") c.chew += dt;
        if (ph === "swallow") c.gulp = Math.sin(Math.PI * u);
      }
      poseOf(H, p, away.clone().applyAxisAngle(Lf, -pitch));
      c.objR = H;
      if (part.done() && !c.action) {
        // On to the next (the other half of the sandwich, the next taco): or all eaten.
        root.remove(H); c.held = null;
        const nx = nextPart(dish.food);
        if (nx) takeUp(nx);
      }
    }

    // ---- utensils: a fork, a knife, a spoon, chopsticks ----
    const tool = c.tools.R, other = c.tools.L;
    if (tool) {
      const part = c.part, tgt = part && name && ["cut", "scoop", "spoon"].includes(name) ? targetOf(part) : null;
      const restTip = restR.clone();
      const down = V().copy(F).multiplyScalar(0.55).addScaledVector(UP, -0.8).normalize();
      const toFace = V().copy(away).multiplyScalar(0.85).addScaledVector(Lf, 0.35).addScaledVector(UP, 0.15).normalize();
      let tip = restTip, dir = V().copy(F).multiplyScalar(0.9).addScaledVector(UP, -0.3).normalize();
      // In the cut, the fork (left hand) holds and the knife (right) saws; then the fork carries.
      const carrier = name === "cut" && other ? other : tool;
      if (name && tgt) {
        const over = tgt.clone().addScaledVector(UP, 0.05);
        if (ph === "reach") { tip = restTip.clone().lerp(over, u); }
        else if (ph === "saw" || ph === "scoop") { tip = ph === "saw" ? tgt.clone().addScaledVector(Rt, 0.03).addScaledVector(F, 0.012 * Math.sin(c.t * 18)) : tgt.clone().addScaledVector(away, 0.02 * u).addScaledVector(UP, -0.006 * Math.sin(Math.PI * u)); dir = down.clone(); }
        else if (ph === "raise" || ph === "mouth" || ph === "pull" || ph === "lower") { if (carrier === tool) { const atMouth = M.clone().addScaledVector(F, ph === "mouth" ? -0.03 * u : 0); tip = ph === "raise" ? tgt.clone().lerp(atMouth, u) : ph === "mouth" ? atMouth : ph === "pull" ? M.clone().addScaledVector(F, 0.04 * u) : M.clone().addScaledVector(F, 0.04).lerp(restTip, u); dir = ph === "lower" ? down.clone().lerp(toFace, 1 - u).normalize() : toFace.clone(); } else { tip = restTip.clone(); } }
        if (ph === "chew") c.chew += dt;
        if (ph === "swallow") c.gulp = Math.sin(Math.PI * u);
      }
      placeUtensil(tool, tip, name === "spoon" && ["raise", "mouth"].includes(ph) ? V().copy(toFace).setY(0).normalize() : dir);
      // The fork in the left hand: holding the food while the knife cuts, then to the mouth.
      if (other) {
        let ltip = restL.clone(), ldir = down.clone();
        if (name === "cut" && tgt) {
          const pin = tgt.clone().addScaledVector(Lf, 0.015);
          if (ph === "reach") ltip = restL.clone().lerp(pin, u);
          else if (ph === "saw") ltip = pin.clone();
          else if (["raise", "mouth", "pull", "lower"].includes(ph)) {
            const atMouth = M.clone().addScaledVector(F, ph === "mouth" ? -0.03 * u : 0);
            ltip = ph === "raise" ? pin.clone().lerp(atMouth, u) : ph === "mouth" ? atMouth : ph === "pull" ? M.clone().addScaledVector(F, 0.04 * u) : M.clone().addScaledVector(F, 0.04).lerp(restL, u);
            ldir = ph === "lower" ? down : V().copy(away).multiplyScalar(0.85).addScaledVector(Rt, 0.35).addScaledVector(UP, 0.15).normalize();
          }
        }
        placeUtensil(other, ltip, ldir);
      }
      // What is on the fork goes with its tip.
      if (c.carry) { const holder = carrier; const t = holder.localToWorld(V(...holder.userData.utensil.tip)); c.carry.position.copy(t).addScaledVector(UP, 0.006); c.carry.quaternion.copy(holder.getWorldQuaternion(Q())); }
      c.objR = tool; c.objL = other || null;
    }

    // ---- a piece picked up by hand (fries, a wing, a nigiri) ----
    if (!tool && !c.held && name === "pick") {
      const part = c.part, tgt = targetOf(part) || restR;
      let p = restR.clone();
      if (ph === "reach") p = restR.clone().lerp(tgt, u);
      else if (ph === "raise") p = tgt.clone().lerp(M.clone().addScaledVector(F, 0.02), u);
      else if (ph === "bite") p = M.clone().addScaledVector(F, 0.02 - 0.015 * Math.sin(Math.PI * u));
      else if (ph === "pull") p = M.clone().addScaledVector(F, 0.02 + 0.04 * u);
      else if (ph === "lower") p = M.clone().addScaledVector(F, 0.06).lerp(restR, u);
      if (ph === "chew") c.chew += dt;
      if (ph === "swallow") c.gulp = Math.sin(Math.PI * u);
      if (!c.pinch) { c.pinch = new THREE.Object3D(); c.pinch.userData.held = { hands: 1, halfWidth: 0.01, height: 0.01, depth: 0.04 }; root.add(c.pinch); }
      poseOf(c.pinch, p, away);
      if (c.carry) { c.carry.position.copy(p); c.carry.quaternion.copy(c.pinch.quaternion); }
      c.objR = c.pinch;
    } else if (!tool && !c.held && dish.form !== "drink") c.objR = null;

    // The plate on the left hand, standing.
    c.objL = c.hands.L === "plate" && !c.sit ? (dish.vessel || dish.group) : c.objL || null;
    if (!streamOn) stream.set(V(), V(), 0, V());
    if (!c.action) { c.chew = 0; c.gulp = 0; }
  }
  //: The world point a part is eaten from next.
  function targetOf(part) {
    const n = part.nextAt?.();
    if (!n) return null;
    const frame = part.frame?.() || part.group;
    return frame ? frame.localToWorld(V(n.x, n.y, n.z)) : null;
  }
  //: A utensil with its working tip at ``tip``, pointing along ``dir``, its top face up.
  function placeUtensil(u, tip, dir) {
    const d = dir.clone().normalize(), side = V().crossVectors(UP, d);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    side.normalize();
    const y = V().crossVectors(d, side).normalize();
    u.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(side, y, d));
    const off = V(...u.userData.utensil.tip).applyQuaternion(u.quaternion);
    u.position.copy(tip).sub(off);
    u.updateMatrixWorld(true);
  }

  // ---- the body ----------------------------------------------------------------------------------------

  const q1 = Q(), q2 = Q(), m1 = new THREE.Matrix4(), m2 = new THREE.Matrix4();
  //: The fingers of a hand (its index, middle and little finger's first bones), found once.
  function fingers(hand) {
    if (fingersOf.has(hand)) return fingersOf.get(hand);
    const f = { index: null, middle: null, pinky: null };
    hand.traverse((o) => { if (o === hand) return; const n = o.name; if (!f.index && /index1|index_01/i.test(n)) f.index = o; if (!f.middle && /middle1|middle_01/i.test(n)) f.middle = o; if (!f.pinky && /pinky1|pinky_01|little1/i.test(n)) f.pinky = o; });
    fingersOf.set(hand, f);
    return f;
  }
  //: Turn ``hand`` so its fingers point along ``fw`` with its thumb's side toward ``aw``.
  function aimHand(hand, fw, aw) {
    const F = fingers(hand);
    if (!F.middle || !F.index || !F.pinky) return;
    hand.updateWorldMatrix(true, true);
    const h = hand.getWorldPosition(V()), f0 = F.middle.getWorldPosition(V()).sub(h).normalize();
    const a0 = F.index.getWorldPosition(V()).sub(F.pinky.getWorldPosition(V()));
    a0.addScaledVector(f0, -a0.dot(f0)).normalize();
    const f1 = fw.clone().normalize(), a1 = aw.clone().addScaledVector(f1, -aw.dot(f1)).normalize();
    m1.makeBasis(f0, a0, V().crossVectors(f0, a0)); m2.makeBasis(f1, a1, V().crossVectors(f1, a1));
    const delta = q1.setFromRotationMatrix(m2.multiply(m1.transpose()));
    hand.parent.updateWorldMatrix(true, false);
    const pw = hand.parent.getWorldQuaternion(Q()), hw = hand.getWorldQuaternion(q2);
    hand.quaternion.copy(pw.invert().multiply(delta.multiply(hw)));
    hand.updateWorldMatrix(false, true);
  }
  //: Bend the walker to what it holds (after the walking clip). True when the arms are its.
  function pose() {
    if (!cur || !av().visible) return Boolean(cur);
    const B = rig(), c = cur;
    const reachTo = (side, obj) => {
      if (!obj) return;
      const upper = side === "R" ? B.rUpper : B.lUpper, lower = side === "R" ? B.rFore : B.lFore, hand = side === "R" ? B.rHand : B.lHand;
      if (!upper || !lower || !hand) return;
      const h = handOn(obj, side), sh = upper.getWorldPosition(V());
      const pole = sh.clone().addScaledVector(UP, -0.45).addScaledVector(left(), side === "R" ? -0.35 : 0.35).addScaledVector(fwd(), -0.15);
      ik.reach(upper, lower, hand, h.wrist, pole, 1);
      aimHand(hand, h.f, h.a);
      ik.grip(hand, h.curl);
    };
    reachTo("R", c.objR);
    if (c.held?.userData.held.hands === 2) reachTo("L", c.held);
    else reachTo("L", c.objL);
    // The head: forward into a bite, back with a tipped glass; the jaw chewing, a swallow.
    const side = left().negate();
    const ph = c.action ? c.plan[c.phase][0] : null, u = c.action ? Math.min(1, c.t / c.plan[c.phase][1]) : 0;
    let nod = 0, jaw = 0;
    if (ph === "bite" || ph === "mouth") { nod = 0.14 * Math.sin(Math.PI * u); jaw = Math.sin(Math.PI * Math.min(1, u * 1.3)); }
    if (c.action === "sip" && ["tip", "sip", "untip"].includes(ph)) nod = -0.4 * Math.min(1, (c.lastTilt || 0) / 1.4);
    if (c.chew > 0) { jaw = 0.35 + 0.35 * Math.sin(c.chew * 2 * Math.PI * 1.8); nod += 0.03 * Math.sin(c.chew * 2 * Math.PI * 1.8); }
    if (c.gulp) nod += 0.06 * c.gulp;
    // (About the walker's right a positive turn lifts the face: a nod forward is negative.)
    if (B.head) ik.turnAbout(B.head, side, -nod);
    if (B.neck && c.gulp) ik.turnAbout(B.neck, side, 0.04 * c.gulp);
    if (B.jaw && jaw) ik.turnAbout(B.jaw, side, -0.22 * jaw);
    return true;
  }

  return {
    sync, press, step, pose, root,
    get active() { return Boolean(cur); },
    get busy() { return Boolean(cur?.action); },
    get what() { return cur ? { item: cur.item, form: cur.dish.form, tool: cur.dish.tool, action: cur.action, phase: cur.action ? cur.plan[cur.phase][0] : null, left: cur.dish.food.reduce((s, p) => s + p.left(), 0) / Math.max(1, cur.dish.food.length) } : null; },
    //: The hint for U here.
    hint() {
      if (!cur) return null;
      const f = cur.dish.form, t = cur.dish.tool;
      return { key: "Right click", label: f === "drink" ? "Sip (hold: drink it all)" : t === "hand" ? "Take a bite (hold: eat it all)" : t === "spoon" ? "A spoonful (hold: eat it all)" : "A forkful (hold: eat it all)" };
    },
    putAway, VESSELS,
  };
}
