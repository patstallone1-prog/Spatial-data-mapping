// Climbing a thing in the city: where its holds are, which limb goes to which hold next, and how a
// climber gets over the top. Pure (tests/city_climb_route.test.mjs); the statics are
// docs/city/climbing.mjs's (stanceAt), so a hold is only taken if the body can hang on it.
//
// A thing is climbed on one of its faces. The face has its own frame: ``u`` metres along it (to
// the climber's right as they face it), ``v`` metres up it from the ground at its foot. Its holds
// come from what it is (a chain-link fence's wire everywhere, a board fence's top and rails, a
// wall's mortar joints and coping, a rock's seeded edges, a tree's branches), the same every time
// for the same thing (seeded by its key).
//
// A climber is four limbs on holds (or a foot smeared on the face, or on the ground) and hips
// between them. A move puts one limb (or a hand and the opposite foot together) on a new hold:
// the move chosen is the one that goes furthest the way asked (up, down, sideways, diagonal) for
// the least effort, with the limbs taken in the order climbers take them -- hands lead going up,
// feet going down, the leading side's limbs going across -- unless skipping one or moving two at
// once is plainly the better way. The rest must hold while a limb is off (the release test).
//
// At the top: a top wide enough to stand on is mantled (press up, a foot on it, stand); a thin
// one (a fence's rail) is straddled and swung over, to hang on the far side. A tree's top is
// the fork of its first big limbs, where the climber sits. ``jumpPlan`` says what a jump at a
// thing does: lands on its top, vaults it, catches its top, or catches holds on its face.

const DEG = Math.PI / 180;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

//: The body, for a 1.75 m adult (scaled by height): hip to shoulder, shoulder to grip, hip joint to
//: sole, the half-spans across shoulders and hips, the reach standing flat-footed, the knees' tuck.
export const BODY = Object.freeze({
  height_m: 1.75, torso_m: 0.53, arm_m: 0.72, leg_m: 0.92, shoulder_half_m: 0.19, hip_half_m: 0.1,
  standing_reach_m: 2.17, tuck_m: 0.38,
});
//: Everyone climbs as at least an intermediate climber (strength 60 of 100): asked for in the
//: game's design, a little generous for an untrained body.
export const SKILL_FLOOR = 60;
//: The ground as a foothold: flat, as good as it gets.
export const GROUND = Object.freeze({ id: "ground", kind: "edge", depth_m: 0.3, slope_deg: 0, use: "foot", ground: true });

export function bodyOf(height_m = 1.75) {
  const k = height_m / BODY.height_m, out = {};
  for (const [key, value] of Object.entries(BODY)) out[key] = key === "height_m" ? height_m : value * k;
  return out;
}

// ---- seeded numbers ------------------------------------------------------------------------------

function hashOf(...parts) {
  let h = 2166136261 >>> 0;
  for (const ch of parts.join("|")) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
function rngOf(...parts) {
  let s = hashOf(...parts) || 1;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---- faces ---------------------------------------------------------------------------------------

//: What kind of face an object-catalogue archetype gives a climber, or null when it is not climbed.
export function faceKindOf(archetypeId) {
  const id = String(archetypeId || "");
  if (id === "barrier.fence_chainlink") return "chainlink";
  if (id === "barrier.fence_board") return "board";
  if (id === "barrier.fence_picket") return "picket";
  if (id === "barrier.wall" || id === "barrier.parapet" || id === "barrier.jersey") return "wall";
  if (id === "geology.rock") return "rock";
  if (id === "vegetation.tree") return "tree";
  if (id === "furniture.bench") return "low";
  if (id === "barrier.railing") return "railing";
  return null;
}

//: The substance (docs/object-catalogue.json mechanics) a face's holds are made of, by its kind.
const KIND_SUBSTANCE = { chainlink: "mild_steel", board: "douglas_fir_dry", picket: "douglas_fir_dry", wall: "clay_brick", rock: "granite", tree: "sycamore_green", low: "douglas_fir_dry", railing: "mild_steel" };

//: A face to climb: { key (seeds its holds), kind, height_m (its top above the ground at its foot),
//: thickness_m (its top, front to back), u0, u1 (its ends along it), substance, angle_deg, wet,
//: temperature_c, far_drop_m (the ground's drop on the far side, from this side's) }.
export function faceOf(spec) {
  const kind = spec.kind;
  const thick = spec.thickness_m ?? (kind === "wall" ? 0.3 : kind === "rock" ? 2 : kind === "tree" ? 0.4 : 0.04);
  return {
    key: String(spec.key ?? kind), kind, height_m: Math.max(0.2, spec.height_m ?? 1.8), thickness_m: thick,
    u0: spec.u0 ?? -3, u1: spec.u1 ?? 3, substance: spec.substance || KIND_SUBSTANCE[kind] || "concrete",
    angle_deg: spec.angle_deg ?? 0, wet: Boolean(spec.wet), temperature_c: spec.temperature_c ?? 15, far_drop_m: spec.far_drop_m ?? 0,
    // What the top is: wide enough to stand on, a thin rail to straddle, a tree's fork to sit in.
    top: kind === "tree" ? "fork" : thick >= 0.22 ? "stand" : "thin",
  };
}

//: The holds of ``face`` between u = from and u = to: [{ id, u, v, kind, depth_m, slope_deg,
//: substance, use ("hand" | "foot" | "both"), top }]. The same holds every time for the same face.
export function holdsOf(face, from = face.u0, to = face.u1) {
  const a = Math.max(face.u0, from), b = Math.min(face.u1, to), out = [], H = face.height_m, sub = face.substance;
  const add = (id, u, v, kind, depth_m, slope_deg, use, extra = {}) => { if (u >= a - 1e-9 && u <= b + 1e-9 && v > 0.05 && v <= H + 1e-9) out.push({ id: `${face.key}:${id}`, u, v, kind, depth_m, slope_deg, substance: sub, use, top: false, ...extra }); };
  const grid = (step, fn) => { for (let i = Math.ceil(a / step); i * step <= b + 1e-9; i += 1) fn(i, i * step); };
  const top = (depth, kind = "jug", slope = 0) => grid(0.15, (i, u) => add(`top${i}`, u, H, kind, depth, slope, "hand", { top: true }));
  switch (face.kind) {
    case "chainlink":
      // Fingers through the 50 mm mesh anywhere; toes into it; a pipe rail along the top.
      grid(0.1, (i, u) => { for (let j = 1; j * 0.12 < H - 0.06; j += 1) add(`m${i}.${j}`, u, j * 0.12, "jug", 0.03, -30, "both"); });
      top(0.045);
      break;
    case "board": {
      // Flush boards: nothing to hold on the face but the top, wrapped over; rails a third and
      // two thirds of the way up on this side (seeded: half of fences show their rails).
      const r = rngOf(face.key, "rails");
      if (r() < 0.5) for (const v of [0.28, H - 0.32]) grid(0.2, (i, u) => add(`r${i}@${v.toFixed(2)}`, u, v, "edge", 0.035, 0, "foot"));
      top(0.03, "jug", 10);
      break;
    }
    case "picket":
      // Pickets to pinch, the rails behind them for the toes, the pointed tops for the hands.
      grid(0.12, (i, u) => { add(`p${i}`, u, H * 0.6, "jug", 0.02, 0, "hand"); for (const v of [0.18, H * 0.72]) add(`r${i}@${v.toFixed(2)}`, u, v, "edge", 0.025, 0, "foot"); });
      top(0.025, "jug", 20);
      break;
    case "railing":
      grid(0.12, (i, u) => { add(`b${i}`, u, H * 0.5, "jug", 0.03, 0, "both"); add(`l${i}`, u, 0.12, "edge", 0.03, 0, "foot"); });
      top(0.05);
      break;
    case "wall": {
      // Brick coursing: 75 mm a course, the joints raked back about 10 mm (an edge for strong
      // fingertips, a toe-hold); the coping at the top as deep as the wall is thick.
      const course = 0.075;
      for (let j = 1; j * course < H - 0.05; j += 1) grid(0.12, (i, u) => add(`j${i}.${j}`, u + ((j % 2) * 0.06), j * course, "edge", 0.012, 0, "both", { recessed: true }));
      top(clamp(face.thickness_m, 0.03, 0.12), face.thickness_m >= 0.08 ? "jug" : "edge");
      break;
    }
    case "rock": {
      // A seeded scatter, eight holds a square metre: mostly edges, some jugs, some slopers.
      const cells = [];
      for (let i = Math.floor(a / 0.35); i * 0.35 <= b; i += 1) for (let j = 0; j * 0.35 < H; j += 1) cells.push([i, j]);
      for (const [i, j] of cells) {
        const r = rngOf(face.key, "rock", i, j);
        const u = (i + r()) * 0.35, v = (j + r()) * 0.35, pick = r();
        const kind = pick < 0.2 ? "jug" : pick < 0.4 ? "sloper" : "edge";
        add(`k${i}.${j}`, u, v, kind, kind === "jug" ? 0.04 + 0.03 * r() : 0.012 + 0.03 * r(), kind === "sloper" ? 15 + 20 * r() : kind === "jug" ? -15 : 5 * r(), "both");
      }
      top(0.15, "sloper", 10);
      break;
    }
    case "tree": {
      // Bark to smear and stand on; a stub or a branch every so often up to the first big fork.
      const r = rngOf(face.key, "tree");
      grid(0.18, (i, u) => { for (let j = 1; j * 0.25 < H; j += 1) if (r() < 0.45) add(`b${i}.${j}`, u, j * 0.25 + 0.1 * r(), "edge", 0.015 + 0.01 * r(), 0, "foot"); });
      for (let j = 0; j < 6; j += 1) { const v = 1.5 + r() * (H - 1.5), u = a + r() * (b - a); add(`limb${j}`, u, v, "jug", 0.08, -10, "both"); }
      // A trunk slim enough to get the arms round is hugged: the arms wrap it like a jug anywhere.
      if (face.thickness_m <= 0.6) for (let j = 1; j * 0.22 < H; j += 1) for (const s of [-1, 1]) add(`hug${j}${s}`, s * Math.min(0.16, face.thickness_m / 2), j * 0.22, "jug", 0.05, 0, "hand");
      top(0.12);
      break;
    }
    case "low":
      top(0.05);
      break;
    default:
      top(0.03, "edge");
  }
  return out;
}

// ---- the climber on the face ---------------------------------------------------------------------

export const LIMBS = ["lh", "rh", "lf", "rf"];
const HAND = { lh: true, rh: true, lf: false, rf: false };
const SIDE = { lh: -1, rh: 1, lf: -1, rf: 1 };
const OPPOSITE = { lh: "rf", rh: "lf", lf: "rh", rf: "lh" };

//: Where a limb is: { hold (a hold, GROUND, or null for a smear on the face), u, v }.
const at = (hold, u, v) => ({ hold, u, v });

//: Where the hips sit for limbs ``L``: between them along the wall; up as the legs stand them,
//: mostly on the higher foot (a climber steps up and stands on it), no lower than straight arms
//: hang them and no higher than the hands at the shoulders. Null where no such place reaches every
//: limb (the hands too high for the feet, or the feet too high under the hands).
export function hipsOf(L, body = BODY) {
  const hands = ["lh", "rh"].filter((k) => L[k]), feet = ["lf", "rf"].filter((k) => L[k]);
  const all = [...hands, ...feet];
  if (!all.length) return null;
  const u = all.reduce((s, k) => s + L[k].u, 0) / all.length;
  const handV = hands.length ? Math.min(...hands.map((k) => L[k].v)) : null;
  if (!feet.length) return { u, v: handV - body.torso_m - 0.95 * body.arm_m };   // hanging
  const fv = feet.map((k) => L[k].v), hi = Math.max(...fv), lo = Math.min(...fv);
  // On the ground the legs stand nearly straight; on holds they are bent, ready to push.
  let v = 0.65 * hi + 0.35 * lo + (hi <= 1e-3 ? 0.97 : 0.8) * body.leg_m;
  v = Math.min(v, lo + body.leg_m + 0.05);
  if (handV === null) return { u, v };
  v = Math.min(v, handV - body.torso_m - 0.12);
  v = Math.max(v, handV - body.torso_m - body.arm_m - 0.02);
  if (v > lo + body.leg_m + 0.05 + 1e-9 || v < hi + 0.3 - 1e-9) return null;
  return { u, v };
}

//: Whether every limb in ``L`` reaches its place from hips ``hip``.
export function reaches(L, hip, body = BODY) {
  for (const k of LIMBS) {
    const l = L[k];
    if (!l) continue;
    if (HAND[k]) {
      const su = hip.u + SIDE[k] * body.shoulder_half_m, sv = hip.v + body.torso_m;
      if (Math.hypot(l.u - su, l.v - sv) > body.arm_m + 0.02) return false;
      if (l.v < hip.v - 0.05 && !l.hold?.top) return false;
    } else {
      const ju = hip.u + SIDE[k] * body.hip_half_m;
      if (Math.hypot(l.u - ju, l.v - hip.v) > body.leg_m + 0.06) return false;
      if (l.v > hip.v - 0.12) return false;
    }
  }
  // Hands and feet keep to their own sides (crossed by a hand's width at most).
  if (L.lh && L.rh && L.lh.u > L.rh.u + 0.1) return false;
  if (L.lf && L.rf && L.lf.u > L.rf.u + 0.05) return false;
  return true;
}

//: The order limbs are moved in going way ``dir`` ({ u, v }): hands lead upward, feet downward,
//: the leading side's hand and foot across, each followed by the opposite limb.
export function limbOrder(dir) {
  if (Math.abs(dir.u) > Math.abs(dir.v) * 1.5) return dir.u > 0 ? ["rh", "rf", "lh", "lf"] : ["lh", "lf", "rh", "rf"];
  const lead = dir.u > 0.2 ? "r" : dir.u < -0.2 ? "l" : "r", other = lead === "r" ? "l" : "r";
  return dir.v >= 0 ? [`${lead}h`, `${other}f`, `${other}h`, `${lead}f`] : [`${lead}f`, `${other}h`, `${other}f`, `${lead}h`];
}

//: A climber's state on a face: { face, limbs: { lh, rh, lf, rf }, hip, last (the limbs moved last),
//: phase ("climb" | "top" | "straddle" | "over" | "perch" | "ground") }.
export function startOn(face, { holds = holdsOf(face), u = 0, standing = true, body = BODY, handsV = null } = {}) {
  // From the ground: the feet on it, the hands on the best holds a standing reach gets to (or
  // the ones given, as a jump catches).
  // A comfortable reach (the arms a little bent), not the full stretch.
  const reachV = handsV ?? Math.min(face.height_m, body.standing_reach_m - 0.12);
  const pick = (k) => {
    const want = u + SIDE[k] * 0.22;
    let best = null, bestS = Infinity;
    for (const h of holds) {
      if (h.use === "foot" || h.v > reachV + 1e-9) continue;
      const s = Math.abs(h.u - want) * 2 + (reachV - h.v) + (h.kind === "jug" ? -0.15 : 0);
      if (s < bestS) { bestS = s; best = h; }
    }
    return best ? at(best, best.u, best.v) : null;
  };
  const limbs = { lh: pick("lh"), rh: pick("rh"), lf: standing ? at(GROUND, u - body.hip_half_m, 0) : null, rf: standing ? at(GROUND, u + body.hip_half_m, 0) : null };
  if (!standing) {
    // Caught on the hands: the feet go where they reach, a smear on the face where nothing is.
    const hv = Math.min(limbs.lh?.v ?? reachV, limbs.rh?.v ?? reachV);
    for (const k of ["lf", "rf"]) {
      const fv = Math.max(0, hv - body.torso_m - 0.75 * body.arm_m - 0.8 * body.leg_m), fu = u + SIDE[k] * body.hip_half_m;
      const foot = holds.filter((h) => h.use !== "hand" && Math.abs(h.v - fv) < 0.25 && Math.abs(h.u - fu) < 0.25).sort((p, q) => Math.abs(p.v - fv) - Math.abs(q.v - fv))[0];
      limbs[k] = foot ? at(foot, foot.u, foot.v) : fv <= 0.02 ? at(GROUND, fu, 0) : at(null, fu, fv);
    }
  }
  return { face, limbs, hip: hipsOf(limbs, body) || { u, v: 0.9 }, last: [], phase: "climb" };
}

const toStance = (L) => LIMBS.filter((k) => L[k]).map((k) => ({ limb: HAND[k] ? "hand" : "foot", hold: L[k].hold?.ground ? GROUND : L[k].hold, u: L[k].u, v: L[k].v }));

//: The next move from state ``S`` going way ``dir`` ({ u, v }, any length; the arrows' sum), with
//: the climbing statics ``C`` (createClimbing) and ``climber`` ({ kg, strength, hands, feet,
//: load_kg }): { moves: [{ limb, from, to }], hip (after), effort, kind ("move" | "top" | "off"),
//: reason } -- or { moves: [], reason } when no hold that way can be taken.
export function nextMove(S, dir, C, climber = {}, { holds = null, body = BODY } = {}) {
  const len = Math.hypot(dir.u, dir.v);
  if (len < 1e-6) return { moves: [], reason: "still" };
  const d = { u: dir.u / len, v: dir.v / len };
  const face = S.face, L = S.limbs;
  // At the top with both hands on it (or a hand's breadth under it), going up: over it or onto it.
  const atTop = (l) => l && (l.hold?.top || l.v >= face.height_m - 0.13);
  if (atTop(L.lh) && atTop(L.rh) && d.v > 0.5 && S.hip.v >= face.height_m - body.torso_m - body.arm_m - 0.05) {
    const kind = face.top === "stand" ? "mantle" : face.top === "fork" ? "perch" : "straddle";
    return { moves: [], kind: "top", top: kind, hip: { u: S.hip.u, v: face.height_m }, effort: 0, reason: kind };
  }
  // Both feet on the ground, going down: off the face.
  if (d.v < -0.5 && L.lf?.hold?.ground && L.rf?.hold?.ground) return { moves: [], kind: "off", reason: "on the ground" };
  const all = holds || holdsOf(face, S.hip.u - 1.6, S.hip.u + 1.6);
  // An ordinary reach first; a lunge (the limb's full reach) only where nothing ordinary holds.
  const normal = search(S, d, C, climber, all, body, 0.6);
  if (normal.moves.length) return normal;
  const lunge = search(S, d, C, climber, all, body, Infinity);
  return lunge.moves.length ? lunge : normal;
}

function search(S, d, C, climber, all, body, maxMove) {
  const face = S.face, L = S.limbs;
  const who = { ...climber, strength: Math.max(SKILL_FLOOR, climber.strength ?? 0) };
  const wall = { angle_deg: face.angle_deg, substance: face.substance, wet: face.wet, temperature_c: face.temperature_c };
  const order = limbOrder(d), statics = (limbs, hip) => C.stanceAt({ wall, climber: who, limbs: toStance(limbs), hip });
  // Candidates: each limb to a hold it can use within its reach, scored first by how far the body
  // gets the way asked and how in line the reach is.
  const geo = [];
  for (const k of LIMBS) {
    const cur = L[k];
    const reachFrom = HAND[k] ? { u: S.hip.u + SIDE[k] * body.shoulder_half_m, v: S.hip.v + body.torso_m } : { u: S.hip.u + SIDE[k] * body.hip_half_m, v: S.hip.v };
    const reach = (HAND[k] ? body.arm_m : body.leg_m) + 0.25;
    const options = all.filter((h) => (h.use === "both" || h.use === (HAND[k] ? "hand" : "foot")) && Math.hypot(h.u - reachFrom.u, h.v - reachFrom.v) <= reach);
    if (!HAND[k] && d.v < 0) options.push({ ...GROUND, id: `ground@${k}`, u: (cur?.u ?? S.hip.u), v: 0 });
    // A foot can always press flat on the face itself (a smear: friction alone holds it), a
    // step or two the way asked.
    if (!HAND[k]) for (let i = 1; i <= 3; i += 1) {
      const su = (cur?.u ?? reachFrom.u) + d.u * 0.18 * i, sv = (cur?.v ?? 0) + d.v * 0.18 * i;
      if (sv > 0.1 && sv < face.height_m - 0.2) options.push({ id: `smear@${k}${i}`, smear: true, u: su, v: sv });
    }
    for (const h of options) {
      if (cur?.hold && cur.hold.id === h.id) continue;
      const mu = h.u - (cur?.u ?? reachFrom.u), mv = h.v - (cur?.v ?? reachFrom.v), m = Math.hypot(mu, mv);
      // (A hand's last little reach up onto the top counts.)
      if (m > maxMove || m < (h.top ? 0.03 : 0.08)) continue;
      const align = (mu * d.u + mv * d.v) / m;
      if (align < 0.25) continue;
      const nl = { ...L, [k]: at(h.ground ? GROUND : h.smear ? null : h, h.u, h.v) };
      const hip = hipsOf(nl, body);
      if (!hip || !reaches(nl, hip, body)) continue;
      // How far the body gets the way asked, and the limb's own reach that way; less for what
      // drifts off the line, and for a long reach (past half a metre a move is a lunge).
      const off = Math.abs(mu * d.v - mv * d.u), drift = off + 1.7 * Math.max(0, m - 0.5);
      const gain = (hip.u - S.hip.u) * d.u + (hip.v - S.hip.v) * d.v + 0.5 * m * align - 0.35 * drift - (h.smear ? 0.04 : 0) + (h.top ? 0.05 : 0);
      if (gain < 0.03) continue;
      geo.push({ limbs: [k], to: { [k]: nl[k] }, nl, hip, gain, align, m, drift });
    }
  }
  // The best few per limb are weighed for strength; a hand and the opposite foot together too.
  const perLimb = new Map();
  for (const c of geo.sort((p, q) => q.gain * (1 + q.align) - p.gain * (1 + p.align))) {
    const list = perLimb.get(c.limbs[0]) || [];
    if (list.length < 5) { list.push(c); perLimb.set(c.limbs[0], list); }
  }
  const tried = [...perLimb.values()].flat();
  for (const hk of ["lh", "rh"]) for (const a of (perLimb.get(hk) || []).slice(0, 2)) for (const b of (perLimb.get(OPPOSITE[hk]) || []).slice(0, 2)) {
    const nl = { ...L, ...a.to, ...b.to }, hip = hipsOf(nl, body);
    if (!hip || !reaches(nl, hip, body)) continue;
    // Two at once is worth it for what the body gains, not for the second limb's own reach.
    const gain = (hip.u - S.hip.u) * d.u + (hip.v - S.hip.v) * d.v + 0.5 * Math.max(a.m * a.align, b.m * b.align) - 0.35 * (a.drift + b.drift);
    tried.push({ limbs: [hk, OPPOSITE[hk]], to: { ...a.to, ...b.to }, nl, hip, gain, align: (a.align + b.align) / 2, m: Math.max(a.m, b.m) });
  }
  let best = null;
  const lastSet = new Set(S.last || []), due = nextInOrder(order, S.last);
  for (const c of tried) {
    // While the moving limbs are off, the rest must hold the body where it is.
    const rest = { ...L };
    for (const k of c.limbs) rest[k] = null;
    const during = statics(rest, S.hip);
    if (!during.holds) continue;
    const after = statics(c.nl, c.hip);
    if (!after.holds) continue;
    // Taken in turn: the limb whose turn it is costs nothing extra, each place later a little;
    // the limb just moved again, more; two at once only when it is plainly the stronger move.
    const turn = Math.min(...c.limbs.map((k) => (order.indexOf(k) - order.indexOf(due) + 4) % 4));
    const penalty = 0.06 * turn + (c.limbs.some((k) => lastSet.has(k)) ? 0.18 : 0) + (c.limbs.length > 1 ? 0.15 : 0);
    const score = (c.gain * (1 + 0.6 * c.align)) / (0.35 + after.effort + 0.5 * during.effort) - penalty;
    if (!best || score > best.score) best = { ...c, score, effort: after.effort, during: during.effort };
  }
  if (!best) return { moves: [], reason: geo.length ? "nothing that way holds" : "no hold in reach that way" };
  return { moves: best.limbs.map((k) => ({ limb: k, from: L[k], to: best.to[k] })), hip: best.hip, effort: best.effort, kind: "move", reason: null };
}

function nextInOrder(order, last = []) {
  if (!last?.length) return order[0];
  const i = Math.max(...last.map((k) => order.indexOf(k)));
  return order[(i + 1) % 4];
}

//: ``S`` after ``move`` (nextMove's).
export function applyMove(S, move) {
  if (!move.moves.length) return S;
  const limbs = { ...S.limbs };
  for (const m of move.moves) limbs[m.limb] = m.to;
  return { ...S, limbs, hip: move.hip, last: move.moves.map((m) => m.limb) };
}

//: Over the top: the steps of a top-out, each { name, dur_s, hip: { u, v, out } (out: metres
//: off the face; negative over the far side), feet, hands } for the animation to ease through.
//: ``kind``: "mantle" (stand on top), "straddle" (sit astride a thin top, swing over, hang on the
//: far side), "perch" (sit in a tree's fork).
export function topOut(face, kind, u = 0, body = BODY) {
  const H = face.height_m, T = face.thickness_m;
  if (kind === "mantle") return [
    { name: "press", dur_s: 0.6, hip: { u, v: H - 0.15, out: 0.25 }, hands: "press" },
    { name: "foot up", dur_s: 0.5, hip: { u, v: H + 0.25, out: 0.05 }, hands: "press", feet: "one up" },
    { name: "stand", dur_s: 0.6, hip: { u, v: H + 0.9 * body.leg_m, out: -T / 2 }, hands: "free", feet: "on top" },
  ];
  if (kind === "perch") return [
    { name: "pull up", dur_s: 0.7, hip: { u, v: H - 0.1, out: 0.2 }, hands: "pull" },
    { name: "sit", dur_s: 0.6, hip: { u, v: H + 0.05, out: -T / 2 }, hands: "hold", feet: "hang" },
  ];
  return [
    { name: "press", dur_s: 0.55, hip: { u, v: H - 0.1, out: 0.2 }, hands: "press" },
    { name: "leg over", dur_s: 0.6, hip: { u, v: H + 0.08, out: 0 }, hands: "press", feet: "straddle" },
    { name: "swing over", dur_s: 0.6, hip: { u, v: H - 0.05, out: -0.2 }, hands: "press", feet: "over" },
    { name: "hang", dur_s: 0.5, hip: { u, v: H - body.torso_m - 0.8 * body.arm_m, out: -0.3 }, hands: "hang", feet: "far face" },
  ];
}

//: What a jump at ``face`` does, from ``distance_m`` away with legs that lift the body
//: ``jump_m``: { action: "land_top" | "vault" | "catch_top" | "catch_holds" | "none", reach_v }.
//: A run up (``running``) adds the carry of its speed to how high the hands get.
export function jumpPlan(face, { jump_m = 0.45, distance_m = 0.8, running = false, body = BODY } = {}) {
  if (distance_m > 1.6) return { action: "none", reason: "too far to reach" };
  const H = face.height_m, lift = jump_m + (running ? 0.15 : 0);
  // Onto it: the top below where tucked feet get to, and room to stand there.
  if (face.top === "stand" && H <= lift + body.tuck_m) return { action: "land_top", reach_v: H };
  // Over a low thin top: a hand on it, the legs swung over.
  if (face.top === "thin" && H <= 1.35 && H <= lift + 0.95) return { action: "vault", reach_v: H };
  const hands = body.standing_reach_m + lift;
  if (H <= hands) return { action: "catch_top", reach_v: H };
  return { action: "catch_holds", reach_v: hands };
}
