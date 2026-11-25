// A climb as it is seen: the moves climb-route.mjs plans, played out over time. Each frame says
// where the hips are and where each hand and foot is going, in the face's own frame (u along it,
// v up it, ``out`` metres off it toward the climber; negative past its far face), for the page to
// bend the body to (climb-pose.mjs). Pure (tests/city_climb_motion.test.mjs).
//
// A move lifts its limb off the wall in a short arc to the new hold while the hips ease across to
// where the new stance puts them, the hips starting a little after the limb and arriving with it.
// Held arrows keep the climb going: as soon as one move lands the next one the same way is
// planned. Over the top the top-out's steps are eased through in turn (climb-route.mjs topOut);
// a straddle ends on the far face, hanging, from where the climber goes down that side.

import { BODY, applyMove, faceOf, holdsOf, nextMove, startOn, topOut } from "./climb-route.mjs";

const ease = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

//: How long a move takes (s): a hand, a foot, two together; a lunge (a long reach) takes longer.
export const MOVE_S = { hand: 0.42, foot: 0.36, pair: 0.5, per_m: 0.35 };
//: How far a limb is lifted off the face as it moves (m), and how far the grip sits off it.
const LIFT_M = 0.12, GRIP_OUT_M = 0.03, FOOT_OUT_M = 0.07, GROUND_OUT_M = 0.22;

//: Where a limb at ``l`` (climb-route's { hold, u, v }) is drawn: its hand or foot's place.
function placeOf(k, l, hipOut) {
  if (!l) return null;
  const hand = k[1] === "h";
  if (l.hold?.ground) return { u: l.u, v: 0, out: Math.max(GROUND_OUT_M, hipOut * 0.8), grip: 0 };
  if (!l.hold) return { u: l.u, v: l.v, out: hand ? 0.02 : FOOT_OUT_M - 0.03, grip: hand ? 0.2 : 0 };
  const depth = l.hold.depth_m ?? 0.02;
  return { u: l.u, v: l.v + (hand ? 0.03 : 0), out: hand ? depth / 2 + GRIP_OUT_M : depth / 2 + FOOT_OUT_M, grip: hand ? (l.hold.kind === "jug" ? 1 : l.hold.kind === "sloper" ? 0.35 : 0.8) : 0 };
}

//: A climb under way: ``face`` (climb-route faceOf), the statics ``C`` and the ``climber``.
//: ``start``: { u, standing, handsV } where the climber takes the face (climb-route startOn).
export function createClimbMotion({ face, C, climber = {}, body = BODY, start = {} }) {
  const F = faceOf(face);
  let holds = holdsOf(F, (start.u ?? 0) - 3, (start.u ?? 0) + 3), holdsAround = start.u ?? 0;
  let S = startOn(F, { holds, body, ...start });
  let hipOut = 0.25, anim = null, side = 1, phase = "climb", last = { reason: null };
  const events = [];
  // Where everything is drawn now, and what it was easing from.
  const drawn = { hip: { u: S.hip.u, v: S.hip.v, out: hipOut }, limbs: {} };
  for (const k of ["lh", "rh", "lf", "rf"]) drawn.limbs[k] = placeOf(k, S.limbs[k], hipOut);

  function holdsNear(u) {
    if (Math.abs(u - holdsAround) > 1) { holds = holdsOf(F, u - 3, u + 3); holdsAround = u; }
    return holds;
  }

  //: Plan and begin the next move way ``dir`` ({ u, v }); false (with ``last.reason``) when none.
  function begin(dir) {
    const m = nextMove(S, dir, C, climber, { holds: holdsNear(S.hip.u), body });
    last = m;
    if (m.kind === "top") {
      const steps = topOut(F, m.top, S.hip.u, body);
      anim = { kind: "top", top: m.top, steps, i: 0, t: 0, from: snapshot() };
      phase = "top";
      return true;
    }
    if (m.kind === "off") { phase = "ground"; events.push({ kind: "off" }); return false; }
    if (!m.moves.length) return false;
    const reach = Math.max(...m.moves.map((x) => Math.hypot(x.to.u - (x.from?.u ?? x.to.u), x.to.v - (x.from?.v ?? x.to.v))));
    const dur = (m.moves.length > 1 ? MOVE_S.pair : m.moves[0].limb[1] === "h" ? MOVE_S.hand : MOVE_S.foot) + MOVE_S.per_m * Math.max(0, reach - 0.4);
    const next = applyMove(S, m);
    anim = { kind: "move", t: 0, dur, move: m, from: snapshot(), toS: next };
    return true;
  }

  function snapshot() {
    return { hip: { ...drawn.hip }, limbs: Object.fromEntries(Object.entries(drawn.limbs).map(([k, v]) => [k, v && { ...v }])) };
  }

  //: Advance ``dt`` seconds with the arrows' way ``dir`` ({ u, v }; zero when none are held).
  //: Returns what happened this frame: [{ kind: "moved" | "top" | "over" | "stood" | "sat" |
  //: "off" | "stuck", ... }].
  function step(dt, dir = { u: 0, v: 0 }) {
    events.length = 0;
    if (!anim && phase === "climb" && Math.hypot(dir.u, dir.v) > 0.01) {
      if (!begin(dir) && last.reason && last.reason !== "still") events.push({ kind: "stuck", reason: last.reason });
    }
    if (anim?.kind === "move") {
      anim.t += dt / anim.dur;
      const t = clamp(anim.t, 0, 1), moving = new Set(anim.move.moves.map((x) => x.limb));
      const targetOut = 0.12 + 0.6 * (anim.move.effort ?? 0.3) * 0.25;
      for (const k of Object.keys(drawn.limbs)) {
        const a = anim.from.limbs[k], b = placeOf(k, anim.toS.limbs[k], hipOut);
        if (!moving.has(k) || !a || !b) { drawn.limbs[k] = b || a; continue; }
        const e = ease(t);
        drawn.limbs[k] = { u: lerp(a.u, b.u, e), v: lerp(a.v, b.v, e), out: lerp(a.out, b.out, e) + LIFT_M * Math.sin(Math.PI * t), grip: t < 0.85 ? 0.1 : b.grip };
      }
      // The hips go after the limb, starting a fifth of the way in and arriving with it.
      const h = ease(clamp((t - 0.2) / 0.8, 0, 1));
      hipOut = lerp(anim.from.hip.out, clamp(targetOut, 0.12, 0.4), h);
      drawn.hip = { u: lerp(anim.from.hip.u, anim.toS.hip.u, h), v: lerp(anim.from.hip.v, anim.toS.hip.v, h), out: hipOut };
      if (anim.t >= 1) {
        S = anim.toS; anim = null;
        events.push({ kind: "moved", limbs: [...moving], effort: last.effort ?? 0 });
      }
    } else if (anim?.kind === "top") {
      const st = anim.steps[anim.i];
      anim.t += dt / st.dur_s;
      const t = ease(clamp(anim.t, 0, 1)), prev = anim.i ? anim.steps[anim.i - 1].hip : anim.from.hip;
      drawn.hip = { u: lerp(prev.u, st.hip.u, t), v: lerp(prev.v, st.hip.v, t), out: lerp(prev.out, st.hip.out, t) };
      poseTop(st, t);
      if (anim.t >= 1) {
        anim.i += 1; anim.t = 0;
        if (anim.i >= anim.steps.length) finishTop();
      }
    }
    return events.slice();
  }

  // The limbs through a top-out step: hands pressing on the top, a foot up onto it, legs over.
  function poseTop(st, t) {
    const H = F.height_m, T = F.thickness_m, u = drawn.hip.u, hip = drawn.hip;
    const onTop = (du, back) => ({ u: u + du, v: H + 0.01, out: -back, grip: 0.3 });
    if (st.hands === "press" || st.hands === "pull" || st.hands === "hold") { drawn.limbs.lh = onTop(-0.22, Math.min(0.12, T / 3)); drawn.limbs.rh = onTop(0.22, Math.min(0.12, T / 3)); }
    if (st.hands === "hang") { drawn.limbs.lh = { u: u - 0.2, v: H, out: -T - 0.03, grip: 1 }; drawn.limbs.rh = { u: u + 0.2, v: H, out: -T - 0.03, grip: 1 }; }
    if (st.hands === "free") { drawn.limbs.lh = null; drawn.limbs.rh = null; }
    const footFace = (k, du) => ({ u: u + du, v: Math.max(0, hip.v - 0.75), out: FOOT_OUT_M, grip: 0 });
    if (!st.feet) { drawn.limbs.lf = footFace("lf", -0.12); drawn.limbs.rf = footFace("rf", 0.12); }
    else if (st.feet === "one up") { drawn.limbs.lf = footFace("lf", -0.12); drawn.limbs.rf = { u: u + 0.15, v: H + 0.02 + 0.15 * Math.sin(Math.PI * t), out: lerp(FOOT_OUT_M, -T / 2, t), grip: 0 }; }
    else if (st.feet === "on top") { drawn.limbs.lf = { u: u - 0.12, v: H, out: -T / 2, grip: 0 }; drawn.limbs.rf = { u: u + 0.12, v: H, out: -T / 2, grip: 0 }; }
    else if (st.feet === "straddle") { drawn.limbs.lf = { u: u - 0.15, v: H - 0.5, out: 0.12, grip: 0 }; drawn.limbs.rf = { u: u + 0.25, v: H - 0.45 + 0.45 * Math.sin(Math.PI * t), out: lerp(0.12, -T - 0.12, t), grip: 0 }; }
    else if (st.feet === "over") { drawn.limbs.rf = { u: u + 0.2, v: H - 0.5, out: -T - 0.12, grip: 0 }; drawn.limbs.lf = { u: u - 0.2, v: H - 0.45 + 0.45 * Math.sin(Math.PI * t), out: lerp(0.12, -T - 0.12, t), grip: 0 }; }
    else if (st.feet === "far face") { drawn.limbs.lf = { u: u - 0.12, v: Math.max(0, hip.v - 0.75), out: -T - FOOT_OUT_M, grip: 0 }; drawn.limbs.rf = { u: u + 0.12, v: Math.max(0, hip.v - 0.75), out: -T - FOOT_OUT_M, grip: 0 }; }
    else if (st.feet === "hang") { drawn.limbs.lf = { u: u - 0.1, v: H - 0.45, out: -T / 2 + 0.25, grip: 0 }; drawn.limbs.rf = { u: u + 0.1, v: H - 0.45, out: -T / 2 + 0.3, grip: 0 }; }
    // Turning round to face the fence again from its far side, half way through the swing.
    if (st.name === "swing over") side = t < 0.5 ? 1 : -1;
  }

  function finishTop() {
    const top = anim.top;
    anim = null;
    if (top === "mantle") { phase = "standing"; events.push({ kind: "stood", u: drawn.hip.u, v: F.height_m, out: -F.thickness_m / 2 }); return; }
    if (top === "perch") { phase = "sitting"; events.push({ kind: "sat" }); return; }
    // Over a thin top: now on its far face, hanging from the top, the frame turned round (u runs
    // the other way, out is off the far face).
    phase = "over";
    events.push({ kind: "over", u: drawn.hip.u });
  }

  //: Begin again on the far face (after "over"): ``farFace`` (the same thing seen from its far
  //: side: its own u0, u1, height above that side's ground), the climber's ``u`` on it.
  function crossTo(farFace, u) {
    const G = faceOf({ ...farFace, key: `${F.key}:far` });
    Object.assign(F, G);
    holds = holdsOf(F, u - 3, u + 3); holdsAround = u;
    const hands = holds.filter((h) => h.top).sort((a, b) => Math.abs(a.u - u) - Math.abs(b.u - u));
    const lh = hands.find((h) => h.u <= u) || hands[0], rh = hands.find((h) => h.u > u) || hands[1] || hands[0];
    S = startOn(F, { holds, body, u, standing: false, handsV: F.height_m });
    if (lh && rh) { S.limbs.lh = { hold: lh, u: lh.u, v: lh.v }; S.limbs.rh = { hold: rh, u: rh.u, v: rh.v }; }
    side = 1; phase = "climb"; hipOut = 0.15;
    drawn.hip = { u, v: S.hip.v, out: hipOut };
    for (const k of Object.keys(drawn.limbs)) drawn.limbs[k] = placeOf(k, S.limbs[k], hipOut);
  }

  return {
    step, crossTo,
    //: This frame: { hip: { u, v, out }, limbs: { lh, rh, lf, rf: { u, v, out, grip } | null },
    //: side (1 facing the face, -1 turned round), phase, moving (a move or top-out under way) }.
    frame: () => ({ hip: drawn.hip, limbs: drawn.limbs, side, phase, moving: Boolean(anim) }),
    get state() { return S; },
    get face() { return F; },
    get phase() { return phase; },
    get last() { return last; },
    get busy() { return Boolean(anim); },
  };
}
