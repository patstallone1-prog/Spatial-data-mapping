// How the people near you move: a small library of keyframed movements -- walking, strolling,
// running, a phone at the ear, a box carried, a limp; standing about, waiting at the kerb,
// talking, filming, waving down a taxi, flinching, crouching to help, sitting -- that the drawing
// code samples each frame instead of swinging every limb by one sine.
//
// The figure is the one view.mjs draws in full: rigid parts, a torso, a head, two one-piece legs
// hung at the hips and two one-piece arms hung at the shoulders. There is no knee and no elbow,
// so a movement here is what those parts can show: how far each leg and arm is swung, how far
// each arm is held out from the side, and how the trunk and head are carried. (Skinned bodies and
// motion capture would be another job; there are no licensed clips to retarget.)
//
// A pose is a plain object of twelve numbers (POSE_CHANNELS). A clip is a table of keys over a
// phase 0..1 per channel -- looping or played once -- read through one interpolator, a monotone
// cubic (Fritsch-Butland): smooth in value and slope (C1), never past its keys (so a clip inside
// LIMITS at its keys is inside them everywhere), and for a loop smooth across 1 -> 0 as well.
// A walking clip writes only the left leg (and, unless that arm is busy, the left arm); the right
// is the left half a cycle later, so the legs always alternate.
//
// Per person, a Blender (makeBlend / stepBlend) keeps where they are in their clip, moves it on at
// the right rate -- for a walk the cadence that keeps the planted foot still on the pavement --
// cross-fades a quarter of a second when the clip changes, and lays a one-shot (a startle, a
// sidestep) over whatever is underneath and lets it go. clipFor reads a person entry as view.mjs
// has it (moving, speed, activity, gesture ...) and says which clip.
//
// Nothing per frame allocates: every function writes into a pose the caller gives it.

// ---- the pose -------------------------------------------------------------------------------
//
// Channel conventions are those of drawPeople in view.mjs. There the figure is placed by
// base(x, y, z, p.yaw + PI, s): with the +PI the heading the person faces is the figure's local
// +z, local +y is up, and the parts sit on local x (the "L" parts at -x, the "R" parts at +x).
// "Forward" below means toward local +z, the heading.
//
//   legL, legR  rad. The angle given to RM.makeRotationX at the hip, as in
//               set(parts.legL, -0.1, 0.84, legL): the leg hangs along -y, so a negative angle
//               swings the foot forward (+z) and a positive one back. view.mjs walks with
//               legL = swing, legR = -swing. Rest 0.
//   armL, armR  rad. The angle given to RM.makeRotationX at the shoulder (+-0.272, 1.34):
//               negative raises the arm forward and up -- view.mjs films at -1.5 (held ahead),
//               phones at -2.6 (up by the head), shoots at -2.8 (overhead) -- positive swings it
//               back. Rest 0.
//   outL, outR  rad. The angle given to TM.makeRotationZ after the arm's X turn. outL negative /
//               outR positive hold the arm out from the side (view.mjs: rest -0.06 / +0.06, a
//               guard -0.45 / +0.45); the other sign brings it in across the body (film +0.12 /
//               -0.12). Rest -0.06 / +0.06.
//   lean        rad, the trunk pitched forward about the hips (y 0.84): positive tips the
//               shoulders toward the heading. As a matrix: Rx(+lean) about (0, 0.84, 0). (Not in
//               view.mjs today; its fall uses Rx(-fall * PI/2), backward, the opposite sign.)
//   twist       rad, the trunk turned about the vertical at the hips: Ry(+twist), which turns the
//               chest from +z toward +x (the R side). Not in view.mjs today.
//   sway        m (on the 1.75 m figure; base() scales by s), the whole body shifted along +x
//               (toward the R side). Not in view.mjs today.
//   bob         m (on the 1.75 m figure), the whole body lifted (+) or lowered (-). view.mjs
//               today adds |sin(phase)| * 0.03 * s to y while walking; this replaces it.
//   headPitch   rad, the head nodded about the neck (0, 1.40, 0): positive looks down. As a
//               matrix: Rx(+headPitch) about the neck. Not in view.mjs today.
//   headYaw     rad, the head turned about the neck: Ry(+headYaw), the face from +z toward +x
//               (the R side). Not in view.mjs today.
//
//: The channels of a pose, in a fixed order.
export const POSE_CHANNELS = Object.freeze(["legL", "legR", "armL", "armR", "outL", "outR", "lean", "twist", "sway", "bob", "headPitch", "headYaw"]);
const CH = POSE_CHANNELS, NCH = CH.length;
const IDX = Object.fromEntries(CH.map((c, i) => [c, i]));
//: The pose of someone standing still, arms hanging (view.mjs's rest).
export const REST = Object.freeze({ legL: 0, legR: 0, armL: 0, armR: 0, outL: -0.06, outR: 0.06, lean: 0, twist: 0, sway: 0, bob: 0, headPitch: 0, headYaw: 0 });
//: What a body can do, per channel [min, max]: a leg 1.9 forward (a deep crouch or a seat) to 0.8
//: back; an arm 3.1 forward-and-up (overhead) to 0.9 back; out 1.6 from the side or 0.5 across;
//: the trunk 0.9 forward, 0.35 back, 0.6 turned; 10 cm aside; 45 cm down (a seat) to 12 cm up;
//: the head 0.8 down, 0.6 up, 1.2 turned. Every clip keeps inside these; stepBlend clamps to them.
export const LIMITS = Object.freeze({
  legL: [-1.9, 0.8], legR: [-1.9, 0.8], armL: [-3.1, 0.9], armR: [-3.1, 0.9],
  outL: [-1.6, 0.5], outR: [-0.5, 1.6], lean: [-0.35, 0.9], twist: [-0.6, 0.6],
  sway: [-0.1, 0.1], bob: [-0.45, 0.12], headPitch: [-0.6, 0.8], headYaw: [-1.2, 1.2],
});
const LO = CH.map((c) => LIMITS[c][0]), HI = CH.map((c) => LIMITS[c][1]);
//: A new pose at rest (the only thing here that allocates: once per pose kept).
export function newPose() { return { ...REST }; }
//: The hip height of the 1.75 m figure (where the legs hang, and so the leg's length).
export const HIP = 0.84;
//: How long a change of clip takes to cross-fade, s -- at least; a bigger change takes longer, so
//: that nothing turns faster than FADE_RAD_S rad/s or moves faster than FADE_M_S m/s on average
//: (sitting down from a walk: about 0.4 s), up to FADE_MAX_S.
export const FADE_S = 0.25, FADE_RAD_S = 3.5, FADE_M_S = 0.9, FADE_MAX_S = 1;

// ---- the clips ------------------------------------------------------------------------------
//
// Keys per channel as a flat list [phase, value, phase, value, ...]. A loop's keys are in [0, 1)
// and wrap; a one-shot's run 0..1 and start and end at rest. A channel left out is at rest -- or,
// in a walking clip, a right leg / arm left out is the left one half a cycle on (an arm's out
// mirrored in sign).

// A gait: the left leg F forward at phase 0 (heel strike) and K back at ``duty`` (toe off) -- the
// backward sweep, 0..duty, is the planted foot's stance; the left arm against it, about a ``bias``
// (a runner's arms are carried forward, bent, which a one-piece arm shows as held forward); the
// body low at double support for a walk, low at mid-stance for a run (``runBob``), twice a cycle.
function gait({ F, K, duty, arm, bias, out, lean, bob, tw, sway, head, runBob = false }, over = {}) {
  const o = runBob ? duty / 2 : 0;
  const bobKeys = [0, 0.25, 0.5, 0.75].map((d, i) => [(o + d) % 1, i % 2 ? bob : -bob]).sort((a, b) => a[0] - b[0]).flat();
  const s = duty / 2;
  const swayKeys = [[s, -sway], [(s + 0.5) % 1, sway]].sort((a, b) => a[0] - b[0]).flat();
  return {
    loop: true, locomotion: true, duration_s: null,
    keys: {
      legL: [0, -F, duty, K], armL: [0, bias + arm, duty, bias - arm], outL: [0, out],
      lean: [0, lean], bob: bobKeys, twist: [0, tw, duty, -tw], sway: swayKeys, headPitch: [0, head],
      ...over,
    },
  };
}
const G = {
  stroll: { F: 0.3, K: 0.28, duty: 0.5, arm: 0.16, bias: -0.02, out: -0.05, lean: 0.02, bob: 0.008, tw: 0.03, sway: 0.012, head: 0.08 },
  walk: { F: 0.42, K: 0.4, duty: 0.5, arm: 0.3, bias: -0.04, out: -0.06, lean: 0.04, bob: 0.016, tw: 0.05, sway: 0.01, head: 0.04 },
  brisk: { F: 0.5, K: 0.46, duty: 0.5, arm: 0.42, bias: -0.08, out: -0.07, lean: 0.07, bob: 0.022, tw: 0.07, sway: 0.009, head: 0.03 },
  jog: { F: 0.62, K: 0.5, duty: 0.45, arm: 0.52, bias: -0.35, out: -0.12, lean: 0.12, bob: 0.035, tw: 0.09, sway: 0.006, head: 0, runBob: true },
  run: { F: 0.8, K: 0.62, duty: 0.4, arm: 0.7, bias: -0.5, out: -0.16, lean: 0.2, bob: 0.05, tw: 0.12, sway: 0.004, head: -0.02, runBob: true },
};
const shorter = (g, k) => ({ ...g, F: g.F * k, K: g.K * k, bob: g.bob * k });
const loopClip = (duration_s, keys) => ({ loop: true, locomotion: false, duration_s, keys });
const oneShot = (duration_s, keys) => ({ loop: false, locomotion: false, duration_s, keys });
const SIT = { legL: [0, -1.2], legR: [0, -1.18, 0.5, -1.24], bob: [0, -0.38] };

const TABLE = {
  // ---- on the move
  stroll: gait(G.stroll), walk: gait(G.walk), brisk: gait(G.brisk), jog: gait(G.jog), run: gait(G.run),
  // A phone at the ear (the R arm up by the head, as view.mjs's phone gesture), the head tipped to it.
  walk_phone: gait(shorter(G.walk, 0.95), { armR: [0, -2.6], outR: [0, 0.4], headYaw: [0, 0.12], headPitch: [0, 0.06] }),
  // Reading a phone held in both hands in front, head down, a shorter step.
  walk_text: gait({ ...shorter(G.walk, 0.85), lean: 0.06 }, { armL: [0, -0.95], armR: [0, -0.95], outL: [0, 0.16], outR: [0, -0.16], headPitch: [0, 0.5] }),
  // A box in both arms, held ahead; leant back a little against it.
  walk_carry: gait(shorter(G.walk, 0.8), { armL: [0, -1.15], armR: [0, -1.15], outL: [0, 0.08], outR: [0, -0.08], lean: [0, -0.05], headPitch: [0, 0] }),
  // A bag in the R hand: that arm weighted, a little out, barely swinging.
  walk_bag: gait(shorter(G.walk, 0.95), { armR: [0, 0.06, 0.5, 0.02], outR: [0, 0.16] }),
  // Hurt on the R leg: a short step on it and a quick one off it (its stance 0.62 -> 1, against
  // the good leg's 0 -> 0.62), a dip when it takes the weight, leant over, that arm out for balance.
  limp: {
    loop: true, locomotion: true, duration_s: null,
    keys: {
      legL: [0, -0.42, 0.62, 0.4], legR: [0, 0.25, 0.62, -0.28],
      armL: [0, 0.25, 0.62, -0.3], armR: [0, -0.1], outR: [0, 0.3], outL: [0, -0.08],
      bob: [0.3, 0, 0.82, -0.04], lean: [0, 0.1], sway: [0.3, -0.02, 0.82, 0.015],
      headPitch: [0, 0.15, 0.82, 0.22], twist: [0.3, 0.03, 0.82, -0.05],
    },
  },
  // ---- standing
  // Weight from one foot to the other, the hands drifting, now and then a look to the side.
  idle: loopClip(8, {
    sway: [0, 0.018, 0.5, -0.018], legL: [0, -0.04, 0.5, 0.03], legR: [0, 0.03, 0.5, -0.04],
    armL: [0, 0.02, 0.45, -0.05], armR: [0, -0.04, 0.55, 0.03],
    headYaw: [0, 0, 0.52, 0, 0.62, 0.55, 0.76, 0.5, 0.86, 0], headPitch: [0, 0.02, 0.3, -0.02, 0.6, 0.05],
    twist: [0, 0, 0.62, 0.08, 0.86, 0],
  }),
  // At the kerb: a look one way down the street, back, the other way, back.
  wait: loopClip(6, {
    headYaw: [0, 0, 0.12, 0.85, 0.32, 0.8, 0.45, 0, 0.58, -0.85, 0.78, -0.8, 0.9, 0],
    twist: [0, 0, 0.2, 0.1, 0.4, 0, 0.65, -0.1, 0.85, 0],
    headPitch: [0, 0.02], sway: [0, 0.01, 0.5, -0.01], armL: [0, 0.03], armR: [0, 0.03], lean: [0, 0.03],
  }),
  // Talking: the hands up and moving, a nod, a turn of the head.
  talk: loopClip(3.5, {
    armL: [0, -0.3, 0.25, -0.75, 0.45, -0.5, 0.7, -0.85, 0.9, -0.4], armR: [0, -0.6, 0.2, -0.35, 0.5, -0.8, 0.75, -0.45],
    outL: [0, -0.1, 0.3, 0.1, 0.6, -0.2], outR: [0, 0.15, 0.35, -0.05, 0.7, 0.25],
    headPitch: [0, 0, 0.3, 0.08, 0.55, -0.03, 0.8, 0.05], headYaw: [0, 0.05, 0.5, -0.1],
    twist: [0, 0.04, 0.5, -0.04], sway: [0, 0.008, 0.5, -0.008],
  }),
  // On the phone: the R hand at the ear (view.mjs's phone gesture), the other across the waist.
  phone: loopClip(7, {
    armR: [0, -2.6], outR: [0, 0.4], armL: [0, -0.35, 0.5, -0.5], outL: [0, 0.3],
    headPitch: [0, 0.1, 0.5, 0.02], headYaw: [0, 0.1, 0.4, -0.25, 0.7, 0.15],
    sway: [0, 0.015, 0.5, -0.015], legL: [0, -0.03, 0.5, 0.02], legR: [0, 0.02, 0.5, -0.03],
  }),
  // Filming: the phone held up ahead in both hands (view.mjs's film gesture), panning.
  film: loopClip(5, {
    armL: [0, -1.5, 0.5, -1.6], armR: [0, -1.5, 0.5, -1.6], outL: [0, 0.12], outR: [0, -0.12],
    headPitch: [0, 0.1], twist: [0, -0.08, 0.5, 0.08], headYaw: [0, -0.05, 0.5, 0.05], lean: [0, 0.02],
  }),
  // Watching: arms folded, the head going slowly round.
  watch: loopClip(9, {
    armL: [0, -0.55], armR: [0, -0.6], outL: [0, 0.42], outR: [0, -0.42],
    headYaw: [0, -0.3, 0.3, 0.2, 0.6, 0.4, 0.85, -0.1], headPitch: [0, 0.05, 0.5, 0],
    sway: [0, 0.015, 0.5, -0.015], lean: [0, -0.02],
  }),
  // A wave: the R arm up, the hand going side to side.
  wave: loopClip(1.2, { armR: [0, -2.75], outR: [0, 0.25, 0.5, 0.8], headPitch: [0, -0.08], armL: [0, 0.02], twist: [0, -0.05] }),
  // Hailing a taxi: the R arm straight up, looking up the street for one.
  hail: loopClip(3, { armR: [0, -2.85, 0.5, -2.95], outR: [0, 0.18], headYaw: [0, 0.35, 0.5, 0.28], headPitch: [0, -0.05], lean: [0, -0.03], sway: [0, 0.02] }),
  // Cowering: both arms up over the head, hunched, one foot back, trembling.
  cower: loopClip(1.6, {
    armL: [0, -2.35, 0.5, -2.45], armR: [0, -2.4, 0.5, -2.3], outL: [0, 0.35], outR: [0, -0.35],
    lean: [0, 0.3, 0.5, 0.34], headPitch: [0, 0.55], legL: [0, -0.35], legR: [0, 0.33], bob: [0, -0.055, 0.5, -0.06],
    twist: [0, 0.03, 0.25, -0.03, 0.5, 0.03, 0.75, -0.03],
  }),
  // Helping someone down: a stride stance, low, leant well over, both arms reaching to them.
  help: loopClip(3, {
    lean: [0, 0.72, 0.5, 0.78], armL: [0, -1.05, 0.5, -1.15], armR: [0, -1.15, 0.5, -1.0], outL: [0, 0.05], outR: [0, -0.05],
    legL: [0, -0.5], legR: [0, 0.48], bob: [0, -0.1, 0.5, -0.105], headPitch: [0, 0.35, 0.5, 0.45],
  }),
  // Sitting: thighs forward (as far as a leg without a knee can go and keep the feet near the
  // ground: 1.2 rad, the seat 38 cm down), hands in the lap.
  sit: loopClip(10, {
    ...SIT, armL: [0, -0.72], armR: [0, -0.7, 0.5, -0.76], outL: [0, 0.12], outR: [0, -0.12],
    lean: [0, 0.06, 0.5, 0.03], headYaw: [0, 0, 0.4, 0.3, 0.6, 0.25, 0.8, 0], headPitch: [0, 0.08],
  }),
  sit_phone: loopClip(8, { ...SIT, armL: [0, -0.95], armR: [0, -0.95], outL: [0, 0.18], outR: [0, -0.18], headPitch: [0, 0.55, 0.5, 0.5], lean: [0, 0.12] }),
  // Leaning back on a wall: feet a little out ahead, hands behind against it, looking about.
  lean_wall: loopClip(9, {
    lean: [0, -0.1], legL: [0, -0.22], legR: [0, -0.12], bob: [0, -0.02], armL: [0, 0.18], armR: [0, 0.15],
    outL: [0, -0.1], outR: [0, 0.1], headYaw: [0, -0.2, 0.5, 0.25], headPitch: [0, -0.05, 0.5, 0.05],
  }),
  // Standing still, nothing in hand (what stepBlend falls back to for no clip).
  rest: loopClip(1, {}),
  // ---- once, over whatever is underneath
  // A start: the arms up in front of the face, a jerk back and up, then easing down.
  startle: oneShot(0.9, {
    armL: [0, 0, 0.12, -1.9, 0.35, -1.6, 1, 0], armR: [0, 0, 0.12, -2.0, 0.35, -1.7, 1, 0],
    outL: [0, -0.06, 0.12, 0.3, 0.35, 0.2, 1, -0.06], outR: [0, 0.06, 0.12, -0.3, 0.35, -0.2, 1, 0.06],
    lean: [0, 0, 0.12, -0.15, 0.35, -0.05, 1, 0], headPitch: [0, 0, 0.12, -0.2, 0.4, 0, 1, 0],
    bob: [0, 0, 0.1, 0.03, 0.25, -0.012, 1, 0], headYaw: [0, 0, 0.15, 0.3, 0.6, 0.1, 1, 0],
  }),
  // A step aside (toward +x; mirrored people step the other way), arms out to balance.
  sidestep: oneShot(0.7, {
    sway: [0, 0, 0.4, 0.08, 1, 0], twist: [0, 0, 0.35, 0.2, 1, 0], lean: [0, 0, 0.3, 0.08, 1, 0],
    legL: [0, 0, 0.3, -0.2, 0.6, 0.1, 1, 0], legR: [0, 0, 0.3, 0.15, 0.6, -0.1, 1, 0],
    outL: [0, -0.06, 0.35, -0.35, 1, -0.06], outR: [0, 0.06, 0.35, 0.3, 1, 0.06], headYaw: [0, 0, 0.3, 0.35, 1, 0],
  }),
};

// ---- the interpolator -----------------------------------------------------------------------

// A curve compiled from keys: phases t, values v, slopes m (Fritsch-Butland: zero at a turn, and
// never steeper than three times the gentler side, so it never overshoots a key).
function compile(flat, loop) {
  const n = flat.length / 2, t = new Float64Array(n), v = new Float64Array(n), m = new Float64Array(n);
  for (let i = 0; i < n; i += 1) { t[i] = flat[2 * i]; v[i] = flat[2 * i + 1]; }
  if (n > 1) {
    const h = (i) => (i < n - 1 ? t[i + 1] - t[i] : t[0] + 1 - t[n - 1]);
    const d = (i) => ((i < n - 1 ? v[i + 1] : v[0]) - v[i]) / h(i);
    for (let i = 0; i < n; i += 1) {
      if (!loop && (i === 0 || i === n - 1)) { m[i] = 0; continue; }
      const i0 = (i + n - 1) % n, h0 = h(i0), h1 = h(i), d0 = d(i0), d1 = d(i);
      m[i] = d0 * d1 <= 0 ? 0 : 3 * (h0 + h1) / ((2 * h1 + h0) / d0 + (h1 + 2 * h0) / d1);
    }
  }
  return { n, t, v, m, loop };
}
function evalCurve(c, p) {
  const { n, t, v, m } = c;
  if (n === 1) return v[0];
  let i, j, t0, t1;
  if (c.loop) {
    p -= Math.floor(p);
    if (p < t[0] || p >= t[n - 1]) { i = n - 1; j = 0; t0 = t[n - 1]; t1 = t[0] + 1; if (p < t[0]) p += 1; }
    else { i = 0; while (t[i + 1] <= p) i += 1; j = i + 1; t0 = t[i]; t1 = t[j]; }
  } else {
    if (p <= t[0]) return v[0];
    if (p >= t[n - 1]) return v[n - 1];
    i = 0; while (t[i + 1] <= p) i += 1; j = i + 1; t0 = t[i]; t1 = t[j];
  }
  const h = t1 - t0, u = (p - t0) / h, u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * v[i] + (u3 - 2 * u2 + u) * h * m[i] + (-2 * u3 + 3 * u2) * v[j] + (u3 - u2) * h * m[j];
}

// Each clip compiled: per channel a curve, and the phase shift and sign to read it with.
const COMPILED = {};
//: The clips: name -> {loop, locomotion, duration_s (a standing loop's or a one-shot's length; null
//: for a walking clip, whose rate is its cadence), holds (the arms a walking clip keeps still)}.
export const CLIPS = {};
for (const [name, def] of Object.entries(TABLE)) {
  const curves = new Array(NCH), shift = new Float64Array(NCH), sign = new Float64Array(NCH).fill(1);
  for (let i = 0; i < NCH; i += 1) {
    const c = CH[i], k = def.keys[c];
    if (k) curves[i] = compile(k, def.loop);
  }
  if (def.locomotion) for (const [r, l, sg] of [["legR", "legL", 1], ["armR", "armL", 1], ["outR", "outL", -1]]) {
    const ri = IDX[r];
    if (!curves[ri] && curves[IDX[l]]) { curves[ri] = curves[IDX[l]]; shift[ri] = 0.5; sign[ri] = sg; }
  }
  for (let i = 0; i < NCH; i += 1) if (!curves[i]) curves[i] = compile([0, REST[CH[i]]], def.loop);
  // A walking clip "holds" an arm it gives keys of its own that hardly move (a phone, a box, a bag).
  const holds = !def.locomotion ? [] : ["armL", "armR"].filter((a) => {
    const k = def.keys[a]; if (!k) return false;
    const v = k.filter((_, i) => i % 2); return Math.max(...v) - Math.min(...v) < 0.15;
  });
  COMPILED[name] = { curves, shift, sign, loop: def.loop };
  CLIPS[name] = Object.freeze({ loop: def.loop, locomotion: def.locomotion, duration_s: def.duration_s, holds: Object.freeze(holds) });
}
Object.freeze(CLIPS);

//: The pose of clip ``name`` at ``phase`` (0..1; a loop wraps, a one-shot holds its ends),
//: written into ``out``. An unknown name is the rest pose.
export function sampleClip(name, phase, out) {
  const k = COMPILED[name] ?? COMPILED.rest;
  for (let i = 0; i < NCH; i += 1) out[CH[i]] = k.sign[i] * evalCurve(k.curves[i], phase + k.shift[i]);
  return out;
}

// ---- the stride: how fast the legs go ----------------------------------------------------------
//
// A rigid leg of length L (the hip height: 0.84 m on the 1.75 m figure, so 0.48 x height) swung
// from angle a_front to a_back carries its planted foot back, relative to the hips, by
// L (sin a_back - sin a_front). The foot is planted for the backward sweep, a share ``duty`` of the
// cycle (a walk 0.5, a jog 0.45, a run 0.4: a runner is in the air for part of it). For the foot not
// to slide the body must cover that distance in that time: v * duty / f = L * D, with D the sweep
// read off the clip's own left leg. So a stride (a full cycle, two steps) is S = L * D / duty and
// the cadence is f = v / S. The gait sets D and duty, the height sets L: a walk is 1.34 m a cycle
// for a 1.75 m person (1.0 cycles a second at 1.35 m/s), a run 2.73 m (1.8 a second at 5 m/s).
const SWEEP = {};
for (const [name, meta] of Object.entries(CLIPS)) {
  if (!meta.locomotion) continue;
  const N = 1024, c = COMPILED[name].curves[IDX.legL];
  let lo = Infinity, hi = -Infinity, tlo = 0, thi = 0;
  for (let i = 0; i < N; i += 1) { const a = evalCurve(c, i / N); if (a < lo) { lo = a; tlo = i / N; } if (a > hi) { hi = a; thi = i / N; } }
  SWEEP[name] = { D: Math.sin(hi) - Math.sin(lo), duty: (thi - tlo + 1) % 1, from: tlo, to: thi };
}
//: The left leg's planted sweep for walking clip ``name``: {D (sin back - sin front), duty (the
//: share of the cycle it lasts), from, to (its phases)}; null for a clip that is not walking.
export function sweepOf(name) { return SWEEP[name] ?? null; }
//: The length of one cycle (two steps), m, of walking clip ``name`` for a person ``height`` m tall.
export function strideLength(name, height = 1.75) {
  const s = SWEEP[name];
  return s ? HIP * (height / 1.75) * s.D / s.duty : 0;
}
//: Cycles a second for clip ``name``: for a walking clip at ``speed`` m/s and ``height`` m, the
//: cadence that keeps the planted foot still (speed / strideLength); for any other, once per its
//: duration.
export function cadence(name, speed = 1.35, height = 1.75) {
  const meta = CLIPS[name];
  if (!meta) return 1;
  if (!meta.locomotion) return 1 / meta.duration_s;
  return Math.max(0, speed) / strideLength(name, height);
}
//: The gaits from slow to fast, and the speeds (m/s) at which one gives way to the next: under 0.9
//: a stroll (window shopping), to 1.55 a walk (the city's 1.35), to 2.2 brisk (late for something),
//: to 3.6 a jog, over that a run.
export const GAITS = Object.freeze(["stroll", "walk", "brisk", "jog", "run"]);
export const GAIT_SPEEDS = Object.freeze([0.9, 1.55, 2.2, 3.6]);
//: The walking clip a speed in m/s implies.
export function gaitFor(speed) {
  let i = 0;
  while (i < GAIT_SPEEDS.length && speed >= GAIT_SPEEDS[i]) i += 1;
  return GAITS[i];
}

// ---- blending ---------------------------------------------------------------------------------

//: ``a`` toward ``b`` by ``k`` (0 all a, 1 all b), into ``out``.
export function blendPose(a, b, k, out) {
  for (let i = 0; i < NCH; i += 1) { const c = CH[i]; out[c] = a[c] + (b[c] - a[c]) * k; }
  return out;
}
const copyPose = (a, out) => { for (let i = 0; i < NCH; i += 1) out[CH[i]] = a[CH[i]]; return out; };
// A share 0..1 from a seed and a salt: the same for the same person every time.
function share(seed, salt) {
  let h = Math.imul((seed | 0) ^ Math.imul(salt + 1, 0x9e3779b1), 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const smooth = (x) => x * x * (3 - 2 * x);

//: A person's blend state: what they are doing, where in it, what they are fading from and any
//: one-shot laid over it. Plain data; keep one per person (stepBlend allocates nothing after this).
export function makeBlend() {
  return {
    init: false, mirror: false, rate: 1, offset: 0,
    target: null, cur: null, phase: 0, prev: null, prevPhase: 0, fade: 1, fadeS: FADE_S,
    shot: null, shotT: 0,
    a: newPose(), b: newPose(), from: newPose(), last: newPose(),
  };
}
function rateOf(st, name, speed, height) {
  const meta = CLIPS[name];
  return meta.locomotion ? cadence(name, speed, height) : st.rate / meta.duration_s;
}
const MIRROR_PAIRS = [[IDX.legL, IDX.legR, 1], [IDX.armL, IDX.armR, 1], [IDX.outL, IDX.outR, -1]];
const MIRROR_NEG = [IDX.twist, IDX.sway, IDX.headYaw];
//: Move person-state ``st`` on by ``dt`` s toward clip ``targetName`` and write their pose into
//: ``out``. ``opts`` {speed (m/s, for a walking clip's cadence), height (m), seed (the person's
//: number)} -- pass one reused object. A new looping clip cross-fades in over FADE_S or more (walking to
//: walking keeps the step's phase, so the feet carry on); a one-shot (startle, sidestep) is laid
//: over what was underneath, played once, and let go (asking for it again each frame does not
//: replay it -- ask for something else first). The seed sets, once, where in a standing loop the
//: person starts, how quickly they go through it (0.85..1.15) and whether they do it the other
//: way round (left for right). null or an unknown name stands at rest. The result is inside LIMITS.
export function stepBlend(st, targetName, dt, out, opts) {
  const speed = opts?.speed ?? 1.35, height = opts?.height ?? 1.75;
  if (!st.init) {
    const seed = opts?.seed ?? 0;
    st.init = true; st.mirror = share(seed, 11) < 0.5; st.rate = 0.85 + 0.3 * share(seed, 12); st.offset = share(seed, 13);
  }
  const name = targetName && CLIPS[targetName] ? targetName : "rest";
  if (st.cur === null) { st.cur = CLIPS[name].loop ? name : "rest"; st.phase = CLIPS[st.cur].locomotion ? 0 : st.offset; st.fade = 1; }
  if (name !== st.target) {
    st.target = name;
    const meta = CLIPS[name];
    if (!meta.loop) { st.shot = name; st.shotT = 0; }
    else if (name !== st.cur) {
      // Fade from the clip that was playing -- or, if a fade was already under way, from where it got to.
      if (st.fade < 1) { copyPose(st.last, st.from); st.prev = null; } else { st.prev = st.cur; st.prevPhase = st.phase; }
      st.fade = 0;
      const keepStep = meta.locomotion && CLIPS[st.cur].locomotion;
      st.cur = name;
      if (!keepStep) st.phase = meta.locomotion ? 0 : st.offset;
      // As long as the change needs.
      sampleClip(name, st.phase, st.b);
      let need = FADE_S;
      for (let i = 0; i < NCH; i += 1) {
        const c = CH[i], d = Math.abs(st.b[c] - st.last[c]) / (c === "sway" || c === "bob" ? FADE_M_S : FADE_RAD_S);
        if (d > need) need = d;
      }
      st.fadeS = Math.min(FADE_MAX_S, need);
    }
  }
  st.phase = (st.phase + dt * rateOf(st, st.cur, speed, height)) % 1;
  sampleClip(st.cur, st.phase, st.a);
  if (st.fade < 1) {
    st.fade = Math.min(1, st.fade + dt / st.fadeS);
    let from = st.from;
    if (st.prev !== null) { st.prevPhase = (st.prevPhase + dt * rateOf(st, st.prev, speed, height)) % 1; from = sampleClip(st.prev, st.prevPhase, st.b); }
    blendPose(from, st.a, smooth(st.fade), out);
    if (st.fade >= 1) st.prev = null;
  } else copyPose(st.a, out);
  if (st.shot !== null) {
    const d = CLIPS[st.shot].duration_s;
    st.shotT += dt;
    if (st.shotT >= d) st.shot = null;
    else {
      sampleClip(st.shot, st.shotT / d, st.b);
      for (let i = 0; i < NCH; i += 1) { const c = CH[i]; out[c] += st.b[c] - REST[c]; }
    }
  }
  for (let i = 0; i < NCH; i += 1) { const c = CH[i], x = out[c]; out[c] = x < LO[i] ? LO[i] : x > HI[i] ? HI[i] : x; }
  copyPose(out, st.last);
  if (st.mirror) {
    for (const [l, r, sg] of MIRROR_PAIRS) { const a = out[CH[l]]; out[CH[l]] = sg * out[CH[r]]; out[CH[r]] = sg * a; }
    for (const i of MIRROR_NEG) out[CH[i]] = -out[CH[i]];
  }
  return out;
}

// ---- which clip -------------------------------------------------------------------------------

// What an activity says, matched by substring (lower case), first match wins: [words, standing
// clip, the slowest gait if moving]. "breakfast" is a meal before it is a break.
const KINDS = [
  [["talking with you", "talk", "chat", "convers"], "talk", null],
  [["waiting to cross", "waiting for", "waiting at", "queue"], "wait", null],
  [["getting out of the way"], "sidestep", "brisk"],
  [["running from it", "fleeing", "running away"], "cower", "jog"],
  [["going to help"], "help", "brisk"],
  [["helping", "help"], "help", null],
  [["calling 911", "phone", "calling", "call"], "phone", null],
  [["filming", "film"], "film", null],
  [["watching", "watch", "looking"], "watch", null],
  [["taxi", "cab"], "hail", null],
  [["waving", "wave", "greet"], "wave", null],
  [["sit", "eat", "lunch", "dinner", "breakfast", "coffee", "cafe", "café", "drink", "bench", "read", "rest"], "sit", null],
  [["smok", "break"], "lean_wall", null],
  [["work", "desk", "office", "study"], "work", null],
];
const kindCache = new Map();
function kindOf(activity) {
  if (!activity) return -1;
  let k = kindCache.get(activity);
  if (k === undefined) {
    const a = String(activity).toLowerCase();
    k = KINDS.findIndex(([words]) => words.some((w) => a.includes(w)));
    if (kindCache.size > 2000) kindCache.clear();
    kindCache.set(activity, k);
  }
  return k;
}
const rank = (g) => GAITS.indexOf(g);
const SPORT = new Set(["shoot", "serve", "swing", "guard"]);
//: The clip for person entry ``e`` as view.mjs has them ({moving, speed, down, ride, indoors,
//: activity, gesture: {kind}, person: {pace}, carrying, injured, seed}), or null where view.mjs
//: poses them itself: lying hurt (down), riding, or in a sport's gesture (shoot, serve, swing,
//: guard). ``seed`` (default e.seed) picks, the same for a person every time, who walks along on
//: their phone (one in eight), who carries a bag, who stands about how.
export function clipFor(e, seed = e?.seed ?? 0) {
  if (!e || e.down || e.ride) return null;
  const g = e.gesture?.kind;
  if (g && SPORT.has(g)) return null;
  const moving = Boolean(e.moving);
  if (g === "sit" && !moving) return "sit";
  if (g === "phone") return moving ? "walk_phone" : "phone";
  if (g === "film") return moving ? "walk_text" : "film";
  const k = kindOf(e.activity), kind = k >= 0 ? KINDS[k] : null;
  if (moving) {
    let gait = gaitFor(e.speed ?? e.person?.pace ?? 1.35);
    if (kind && kind[2] && rank(gait) < rank(kind[2])) gait = kind[2];
    if (e.injured) return "limp";
    if (kind && kind[1] === "phone") return "walk_phone";
    if (kind && kind[1] === "film") return "walk_text";
    if (rank(gait) > rank("brisk")) return gait;
    if (e.carrying) return "walk_carry";
    const u = share(seed, 21);
    return u < 1 / 16 ? "walk_phone" : u < 1 / 8 ? "walk_text" : u < 0.2 ? "walk_bag" : gait;
  }
  if (kind) {
    const c = kind[1];
    if (c === "sit") return share(seed, 22) < 1 / 3 ? "sit_phone" : "sit";
    if (c === "lean_wall") return e.indoors || share(seed, 23) < 0.5 ? "idle" : "lean_wall";
    if (c === "work") return e.indoors ? (share(seed, 24) < 0.5 ? "sit" : "idle") : "idle";
    return c;
  }
  if (e.injured) return "idle";
  const u = share(seed, 25);
  return u < 0.72 ? "idle" : u < 0.88 ? "watch" : "phone";
}
