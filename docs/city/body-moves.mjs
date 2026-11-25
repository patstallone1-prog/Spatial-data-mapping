// The body's own moves: how a jump, a punch and a swing of what is held are posed, as joint turns
// over time. Pure numbers (no three.js): the page turns its bones by them (view.mjs afterPose),
// and the tests read the same curves.
//
// Angles are radians about the walker's own right axis unless named otherwise, with view.mjs's
// signs: a positive ``thigh`` lifts the knee forward, a negative ``shin`` folds the knee back, a
// positive ``upper`` raises an arm forward, a positive ``fore`` bends the elbow, a negative
// ``lean`` bends the back forward, and ``twist`` turns the shoulders to the left (the right
// shoulder forward is a negative twist). ``drop`` lowers the hips (m).
//
// A jump (2026-11-24, "bend down, then hop"): the knees and hips bend and the arms go back -- the
// load -- then the legs drive straight and the arms swing up through take-off; in the air the
// knees come up a little; on landing the legs give and come back up. A punch: from a guard, the
// fist driven straight out from the shoulder with the shoulders turning into it and a little
// weight forward, then pulled back to the guard -- quick out, slower back. A swing of something
// held: drawn back over the shoulder with the shoulders turned away, then brought through on a
// slant across the body to the target and on past it, the weight going onto the front foot.

const clamp01 = (t) => Math.min(1, Math.max(0, t));
const ease = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };
const easeOut = (t) => { t = clamp01(t); return 1 - (1 - t) * (1 - t); };
const easeIn = (t) => { t = clamp01(t); return t * t; };
const lerp = (a, b, t) => a + (b - a) * t;

//: The jump's timing (s) and depths. The crouch is the load before take-off: long enough to be
//: seen (a real countermovement is 0.2-0.4 s), short enough that Space still feels like a jump.
export const JUMP = {
  crouch_s: 0.2,
  land_s: 0.28,
  //: How deep the hips go in the crouch, and on landing, for a jump of ``height`` (m): a bigger
  //: jump loads deeper.
  crouchDrop: (height) => Math.min(0.26, 0.12 + 0.35 * Math.max(0, height)),
  landDrop: (fall) => Math.min(0.3, 0.08 + 0.18 * Math.max(0, fall)),
};

//: A bent leg of hip-drop ``drop`` (m): thigh forward, knee back, the back over a little.
function legsFor(drop) {
  const k = clamp01(drop / 0.3);
  return { thigh: 1.15 * k, shin: -2.0 * k, lean: -0.45 * k, drop };
}

//: The load before take-off, ``t`` 0..1 of JUMP.crouch_s: down into the knees, the arms back.
export function jumpCrouch(t, height = 0.4) {
  const down = ease(t / 0.85);
  const L = legsFor(JUMP.crouchDrop(height) * down);
  return { ...L, upper: -0.75 * down, fore: 0.35 * down, twist: 0 };
}

//: In the air: the legs straight off the ground and the knees brought up a little at the top,
//: the arms through and up as they swung at take-off. ``rise`` 1 at take-off, 0 at the top, -1
//: coming down onto the ground (the vertical speed over the take-off speed).
export function jumpAir(rise) {
  const r = Math.max(-1, Math.min(1, rise));
  const top = 1 - Math.abs(r);                         // 0 at take-off and landing, 1 at the top
  const up = r > 0 ? lerp(1.25, 0.9, 1 - r) : lerp(0.9, 0.5, -r);
  return { thigh: 0.55 * top + (r < 0 ? 0.25 * -r : 0), shin: -0.9 * top - (r < 0 ? 0.3 * -r : 0),
    lean: -0.12 * top, drop: 0, upper: up, fore: 0.25, twist: 0 };
}

//: The landing, ``t`` 0..1 of JUMP.land_s, from a fall of ``fall`` metres: the knees give at
//: once and the body comes back up, the arms forward for balance and down.
export function jumpLand(t, fall = 0.4) {
  const give = t < 0.3 ? easeOut(t / 0.3) : 1 - ease((t - 0.3) / 0.7);
  const L = legsFor(JUMP.landDrop(fall) * give);
  return { ...L, upper: 0.5 * give, fore: 0.3 * give, twist: 0 };
}

//: A jump that catches the top of a fence (or the first holds of a climb): the crouch, then up
//: with both arms reaching high to the grab, ``t`` 0..1 of the flight; ``reach`` how far above
//: the shoulder the hands go (m).
export function jumpGrab(t, reach = 0.6) {
  const k = ease(t / 0.7);
  const tuck = Math.sin(Math.PI * clamp01(t));
  return { thigh: 0.7 * tuck, shin: -1.1 * tuck, lean: -0.1 * tuck, drop: 0,
    upper: lerp(1.1, 2.75 + Math.min(0.3, reach * 0.2), k), fore: lerp(0.3, 0.12, k), twist: 0, both: true };
}

//: The punch's timing (s), and the share of it at which the fist lands.
export const PUNCH = { dur_s: 0.36, hit: 0.38 };
//: A straight punch with the right hand, ``t`` 0..1 of PUNCH.dur_s, at a target ``arm`` radians
//: up from the arm hanging (pi/2 is straight out at shoulder height). Both hands start in a guard
//: by the chin; the right goes out fast on a straight line -- the elbow opening as the shoulder
//: raises it -- the shoulders turn into it and the weight goes forward; it is pulled back to the
//: guard more slowly than it went out. The left stays up.
export function punchPose(t, arm = Math.PI / 2) {
  t = clamp01(t);
  const guardUpper = 0.55, guardFore = 1.95;
  // A small cock back first (a fifth), the strike (to PUNCH.hit), held a beat, then back.
  const cock = t < 0.18 ? ease(t / 0.18) : t < PUNCH.hit ? 1 - easeIn((t - 0.18) / (PUNCH.hit - 0.18)) : 0;
  const out = t < 0.18 ? 0 : t < PUNCH.hit ? easeIn((t - 0.18) / (PUNCH.hit - 0.18))
    : t < 0.5 ? 1 : 1 - ease((t - 0.5) / 0.5);
  const target = Math.max(0.9, Math.min(1.9, arm));
  return {
    rUpper: lerp(guardUpper, target, out) - 0.15 * cock,
    rFore: lerp(guardFore, 0.08, out) + 0.1 * cock,
    lUpper: guardUpper + 0.1 * out, lFore: guardFore,
    // The right shoulder comes forward into it (negative twist), drawn back a little to load.
    twist: 0.22 * cock - 0.45 * out,
    lean: -0.12 * out,
    drop: 0.03 * out,
  };
}

//: A swing's timing (s) and the share of it at which the blow lands.
export const SWING = { dur_s: 0.62, hit: 0.56 };
//: A swing of what is held in the right hand (``two`` with both), ``t`` 0..1 of SWING.dur_s, at a
//: target ``arm`` radians up from hanging. Wound up -- drawn back up over the shoulder, the
//: elbow bent, the shoulders turned away -- then brought down and across on a slant through the
//: target with the elbow opening and the shoulders turning through, on past it, and recovered.
export function swingPose(t, arm = Math.PI / 2, two = false) {
  t = clamp01(t);
  const windEnd = 0.38, hit = SWING.hit, follow = 0.78;
  const low = Math.max(0.35, Math.min(1.8, arm));
  let upper, fore, twist, lean, side;
  if (t < windEnd) {
    // The back-swing: up and back, slower at the top (the load).
    const k = ease(t / windEnd);
    upper = lerp(0.35, 2.6, k); fore = lerp(0.6, 1.35, k);
    twist = lerp(0, 0.55, k); lean = lerp(0, 0.08, k); side = lerp(0, 0.35, k);
  } else if (t < hit) {
    // Down through the blow: fast, accelerating to the contact.
    const k = easeIn((t - windEnd) / (hit - windEnd));
    upper = lerp(2.6, low, k); fore = lerp(1.35, 0.15, k);
    twist = lerp(0.55, -0.35, k); lean = lerp(0.08, -0.22, k); side = lerp(0.35, -0.1, k);
  } else if (t < follow) {
    // On past the target, across the body and down, slowing.
    const k = easeOut((t - hit) / (follow - hit));
    upper = lerp(low, Math.max(0.1, low - 0.6), k); fore = lerp(0.15, 0.3, k);
    twist = lerp(-0.35, -0.55, k); lean = lerp(-0.22, -0.28, k); side = lerp(-0.1, -0.3, k);
  } else {
    // Back to carrying it.
    const k = ease((t - follow) / (1 - follow));
    upper = lerp(Math.max(0.1, low - 0.6), 0.25, k); fore = lerp(0.3, 0.9, k);
    twist = lerp(-0.55, 0, k); lean = lerp(-0.28, 0, k); side = lerp(-0.3, 0, k);
  }
  const knees = t > windEnd && t < 1 ? Math.sin(Math.PI * clamp01((t - windEnd) / (1 - windEnd))) : 0;
  return { rUpper: upper, rFore: fore, rSide: side, lUpper: two ? upper * 0.92 : 0.35 + 0.2 * knees,
    lFore: two ? fore + 0.25 : 0.6, lSide: two ? -side * 0.6 : 0, twist, lean, drop: 0.06 * knees, two };
}
