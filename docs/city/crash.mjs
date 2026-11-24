// A crash, as it leaves things: what an impact does to a car's body (a scratch, a dent, the front
// pushed in), what it does to someone on foot (knocked down and gone over, folded onto the bonnet
// and carried, thrown), and how the street is cleared afterwards -- an ambulance for the hurt, a
// tow truck for the car, each arriving, working and leaving in its own time (the owner,
// 2026-11-23: "a realistic way to get from injured on road to hospital, for cars to mechanic").
//
// Pure: the numbers and the shapes. Drawing and driving are crash-scene.mjs (the page's), the
// books are world.mjs (harm, bills, repair). tests/city_crash.test.mjs.

//: Speeds are metres a second at the moment of contact (closing speed for two cars).
export const CRASH = {
  // Below ``scratch_ms`` nothing shows; to ``dent_ms`` the paint is scraped; to ``crumple_ms``
  // the panel is dented; over it the end that took it is pushed in, all the way at ``full_ms``.
  scratch_ms: 0.8, dent_ms: 3.5, crumple_ms: 7, full_ms: 20,
  // How far a crumpled end is pushed back at the worst (m, and never more than this share of
  // the car's length), how far along the car the buckling reaches for each metre pushed in,
  // and how deep a dent in a side goes.
  crush_m: 0.95, crush_share: 0.2, reach: 2.2, dent_m: 0.26,
  // Someone on foot, by the speed they are hit at: slowly, knocked down in front of the car,
  // which goes over them before it stops; faster, folded over the bonnet and carried until it
  // has stopped, then off the front; faster still, thrown clear.
  run_over_ms: 4.5, fold_ms: 11,
  // The scene: someone rings (``call_s``); the ambulance and the tow truck come from a few
  // blocks off; a casualty takes ``load_s`` to be put on the stretcher and into the ambulance, a
  // wreck ``hook_s`` to be hooked and lifted. With nobody there to see (you ``leave_m`` off and
  // it out of sight ``unseen_s``) it is cleared at once: the hurt in hospital, the car at the
  // nearest mechanic's, as new.
  // (``down_s``, ``stale_s``: the longest someone lies, and a wreck stands, if nothing comes: real seconds.)
  call_s: 5, ambulance_from_m: [220, 420], tow_from_m: [260, 480], load_s: 13, hook_s: 15, leave_m: 150, unseen_s: 12, down_s: 240, stale_s: 600,
  // The block the crash is on is known shut to drivers who have not turned into it for as long
  // as a wreck stands in it (looked at every ``shut_every_s``): they take another way.
  shut_every_s: 2, shut_for_s: 8,
};

export const newDamage = () => ({ front: 0, rear: 0, left: 0, right: 0, bias: 0, at: 0, scratch: 0 });
const clamp01 = (x) => Math.max(0, Math.min(1, x));

//: Which part of a car a blow lands on: (lx, lz) is the point of contact in the car's own frame
//: (x to its right, z to its rear, metres from its middle), ``dims`` [width, height, length].
//: {zone: front | rear | left | right, bias (-1 its left .. 1 its right, for an end), at (-1 its
//: front .. 1 its rear, for a side)}.
export function impactZone(lx, lz, dims) {
  const [w, , l] = dims;
  const ex = Math.abs(lx) / (w / 2), ez = Math.abs(lz) / (l / 2);
  if (ez >= ex) return { zone: lz < 0 ? "front" : "rear", bias: Math.max(-1, Math.min(1, lx / (w / 2))), at: 0 };
  return { zone: lx < 0 ? "left" : "right", bias: 0, at: Math.max(-1, Math.min(1, lz / (l / 2))) };
}

//: A car's damage after one more blow of ``speed`` on ``zone``: scraped, dented or pushed in
//: (CRASH), never less than it was. Each zone is 0 (as new) to 1 (as far in as it goes).
export function impactOn(damage, { zone = "front", speed = 0, bias = 0, at = 0 } = {}) {
  const d = { ...newDamage(), ...(damage || {}) };
  if (!(speed >= CRASH.scratch_ms)) return d;
  d.scratch = clamp01(d.scratch + (speed < CRASH.dent_ms ? 0.3 : 0.45));
  if (speed < CRASH.dent_ms) return d;
  const sev = speed < CRASH.crumple_ms
    ? 0.08 + 0.2 * (speed - CRASH.dent_ms) / (CRASH.crumple_ms - CRASH.dent_ms)
    : 0.3 + 0.7 * clamp01((speed - CRASH.crumple_ms) / (CRASH.full_ms - CRASH.crumple_ms));
  const was = d[zone] || 0;
  // (A second blow on a panel already in adds to it, less than it would to a whole one.)
  d[zone] = clamp01(Math.max(was, sev) + Math.min(was, sev) * 0.35);
  if (zone === "front" || zone === "rear") { if (sev >= was) d.bias = bias; }
  else if (sev >= was) d.at = at;
  return d;
}
//: What a damaged car is, in a word: "new", "scratched", "dented" or "crumpled".
export function damageLevel(damage) {
  if (!damage) return "new";
  const worst = Math.max(damage.front || 0, damage.rear || 0, damage.left || 0, damage.right || 0);
  return worst >= 0.3 ? "crumpled" : worst >= 0.06 ? "dented" : damage.scratch > 0 ? "scratched" : "new";
}
//: The damage as one short string (the same damage, the same string): what a body made for it is kept by.
export const damageKey = (d) => (d ? ["front", "rear", "left", "right", "bias", "at", "scratch"].map((k) => Math.round((d[k] || 0) * 20)).join(".") : "");
//: How much of its top speed a car with this damage still makes (a front pushed right in limps).
export const damagePace = (d) => (d ? 1 - 0.55 * clamp01(((d.front || 0) - 0.3) / 0.7) - 0.15 * clamp01(d.rear || 0) : 1);

// A number 0..1 from a place on the body: the same for every corner that sits at it, whichever
// part or triangle the corner belongs to -- so a crumple opens no cracks between them.
function grain(x, y, z, k) {
  let h = (Math.round(x * 40) * 73856093) ^ (Math.round(y * 40) * 19349663) ^ (Math.round(z * 40) * 83492791) ^ (k * 2654435761);
  h = Math.imul(h ^ (h >>> 15), 2246822519); h = Math.imul(h ^ (h >>> 13), 3266489917);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
// Smooth lumps a hand across: the buckling of a panel, not its grain.
function lump(x, y, z, k) {
  return 0.5 + 0.5 * Math.sin(x * 9.1 + k * 1.7) * Math.sin(y * 11.3 + k * 2.9) * Math.sin(z * 7.7 + k * 0.6);
}

//: How far one end is pushed in (m) for its zone's damage, by the car's length.
export const crushDepth = (level, dims) => clamp01(level) * Math.min(CRASH.crush_m, CRASH.crush_share * dims[2]);

//: A body's corners (``pos``: x, y, z each, in the car's own frame -- x to its right, y up from
//: the road, z to its rear) as the damage leaves them: an end pushed in is shortened towards the
//: car's middle (more on the side that took it), its bonnet or boot kinked up along the fold and
//: every panel of it buckled; a side is dented in round where it was struck. The same array
//: back when there is nothing to do; else a new one (or ``out``).
export function crumple(pos, dims, damage, out = null) {
  if (!damage || damageLevel(damage) === "new" || damageLevel(damage) === "scratched") return pos;
  const [w, h, l] = dims, n = pos.length / 3, to = out || new Float32Array(pos.length);
  const ends = [["front", -1], ["rear", 1]].map(([zone, sign]) => ({ sign, depth: crushDepth(damage[zone] || 0, dims), level: damage[zone] || 0 })).filter((e) => e.depth > 0.005);
  const sides = [["left", -1], ["right", 1]].map(([zone, sign]) => ({ sign, level: damage[zone] || 0 })).filter((s) => s.level > 0.02);
  for (let i = 0; i < n; i += 1) {
    let x = pos[3 * i], y = pos[3 * i + 1], z = pos[3 * i + 2];
    const x0 = x, y0 = y, z0 = z;
    for (const e of ends) {
      // (``t``: 0 where the buckling stops, 1 at the bumper.)
      const reach = Math.min(l * 0.45, e.depth * CRASH.reach + 0.25), t = clamp01((z0 * e.sign - (l / 2 - reach)) / reach);
      if (t <= 0) continue;
      // More on the side the blow came in on.
      const skew = 1 + 0.55 * (damage.bias || 0) * (x0 / (w / 2));
      const push = e.depth * Math.max(0.25, skew) * Math.pow(t, 1.25);
      z -= e.sign * push;
      // The fold: a ridge across the bonnet a third of the way back from the bumper, and the
      // panels each side of it at odds with each other.
      const high = clamp01((y0 / h - 0.25) / 0.3), fold = Math.sin(Math.PI * clamp01(t * 1.15)) * e.depth * 0.34;
      y += fold * high * (0.6 + 0.8 * lump(x0, y0, z0, 1));
      const rough = e.depth * 0.16 * t;
      x += (lump(x0, y0, z0, 2) - 0.5) * rough * 1.4 + (grain(x0, y0, z0, 3) - 0.5) * rough * 0.5;
      y += (grain(x0, y0, z0, 4) - 0.5) * rough * 0.6;
      // (Nothing is pushed under the road.)
      if (y < 0.02 && y0 >= 0.02) y = 0.02;
    }
    for (const s of sides) {
      const face = clamp01((x0 * s.sign - (w / 2 - 0.45)) / 0.45);
      if (face <= 0) continue;
      const zc = (damage.at || 0) * l * 0.32, r = l * 0.2 + s.level * l * 0.16, away = Math.abs(z0 - zc) / r;
      if (away >= 1) continue;
      const bowl = (1 - away * away) * clamp01(1 - Math.abs(y0 / h - 0.42) / 0.5);
      x -= s.sign * CRASH.dent_m * (0.25 + 0.75 * s.level) * bowl * face * (0.75 + 0.5 * lump(x0, y0, z0, 5));
    }
    to[3 * i] = x; to[3 * i + 1] = y; to[3 * i + 2] = z;
  }
  return to;
}

//: The marks the damage leaves on the paint: for each corner of the body, r, g, b and how much
//: of it shows (0 none .. 1) -- bare, darkened metal where it is pushed in and along the creases,
//: pale scrapes along the flanks and the corners where it has only rubbed. Null when it is as new.
export function scuff(pos, dims, damage) {
  if (!damage || damageLevel(damage) === "new") return null;
  const [w, h, l] = dims, n = pos.length / 3, out = new Float32Array(n * 4);
  let any = false;
  for (let i = 0; i < n; i += 1) {
    const x = pos[3 * i], y = pos[3 * i + 1], z = pos[3 * i + 2];
    let dark = 0;
    for (const [zone, sign] of [["front", -1], ["rear", 1]]) {
      const depth = crushDepth(damage[zone] || 0, dims);
      if (depth <= 0.005) continue;
      const reach = Math.min(l * 0.45, depth * CRASH.reach + 0.25), t = clamp01((z * sign - (l / 2 - reach)) / reach);
      dark = Math.max(dark, t * (0.35 + 0.65 * (damage[zone] || 0)) * (0.45 + 0.55 * lump(x, y, z, 6)));
    }
    for (const [zone, sign] of [["left", -1], ["right", 1]]) {
      const level = damage[zone] || 0;
      if (level <= 0.02) continue;
      const face = clamp01((x * sign - (w / 2 - 0.45)) / 0.45), zc = (damage.at || 0) * l * 0.32, r = l * 0.2 + level * l * 0.16;
      dark = Math.max(dark, face * clamp01(1 - Math.abs(z - zc) / r) * (0.3 + 0.6 * level));
    }
    // Scrapes: long thin marks at bumper height along the flanks and round the corners.
    const flank = clamp01((Math.abs(x) - (w / 2 - 0.3)) / 0.3), corner = clamp01((Math.abs(z) - (l / 2 - 0.5)) / 0.5);
    const band = clamp01(1 - Math.abs(y / h - 0.36) / 0.22), line = grain(0, Math.round(y * 30) / 30, 0, 7) > 0.55 ? 1 : 0.25;
    const pale = (damage.scratch || 0) * Math.max(flank, corner) * band * line * (0.4 + 0.6 * lump(x, y, z, 8));
    const a = Math.max(clamp01(dark * 0.8), clamp01(pale * 0.75));
    if (a > 0.02) any = true;
    // (Dark where it is pushed in; the grey of primer where it is only scraped.)
    const tone = dark * 0.8 >= pale * 0.75 ? 0.07 : 0.62;
    out[4 * i] = tone; out[4 * i + 1] = tone; out[4 * i + 2] = tone * 1.04; out[4 * i + 3] = a;
  }
  return any ? out : null;
}

// ---- someone on foot ---------------------------------------------------------------------------

//: What a car does to someone it hits at ``speed``: "run_over", "fold" or "thrown" (CRASH).
export const personImpact = (speed) => (speed < CRASH.run_over_ms ? "run_over" : speed < CRASH.fold_ms ? "fold" : "thrown");

//: Where the body is ``age`` seconds after the blow, for the page to draw: ``along`` (m ahead of
//: where they stood, the way the car was going), ``lift`` (m off the road), ``fall`` (0 upright ..
//: 1 flat), ``carried`` (on the car: the page keeps them at its front as it stops) and ``done``.
//: ``car``: its [width, height, length]; ``stop``: how far the car went on before it stood (m).
export function personPose(kind, age, { speed = 6, car = [1.84, 1.45, 4.9], stop = 6 } = {}) {
  const bonnet = Math.min(1.05, car[1] * 0.58);
  if (kind === "run_over") {
    // Knocked off their feet in front of the bumper in a third of a second, and the car goes
    // over where they lie (it stops a length on: the page draws it there).
    const k = clamp01(age / 0.35);
    return { along: 0.5 * k, lift: Math.sin(k * Math.PI) * 0.12, fall: k, carried: false, under: true, done: age > 0.35 };
  }
  if (kind === "fold") {
    // Legs taken from under them: folded onto the bonnet (bent double over its edge) by 0.25 s,
    // carried there while the car brakes, and off its front onto the road when it stands.
    const braking = Math.max(0.6, Math.min(2.6, (2 * stop) / Math.max(1, speed)));
    if (age < 0.25) { const k = age / 0.25; return { along: 0, lift: bonnet * k, fall: 0.45 * k, carried: true, under: false, done: false }; }
    if (age < 0.25 + braking) return { along: 0, lift: bonnet, fall: 0.45 + 0.2 * Math.sin((age - 0.25) * 5), carried: true, under: false, done: false };
    const k = clamp01((age - 0.25 - braking) / 0.6);
    return { along: 1.4 * k, lift: bonnet * (1 - k * k), fall: 0.6 + 0.4 * k, carried: false, slid: true, under: false, done: k >= 1 };
  }
  // Thrown: up and on ahead, and down on the road.
  const far = Math.min(14, 1.5 + speed * 0.75), k = clamp01(age / Math.max(0.7, far / Math.max(4, speed * 0.8)));
  return { along: far * Math.sin(k * Math.PI / 2), lift: Math.sin(k * Math.PI) * Math.min(1.9, speed * 0.13), fall: clamp01(k * 1.6), carried: false, under: false, done: k >= 1 };
}

// ---- clearing it up ----------------------------------------------------------------------------

//: A response vehicle's part in a scene at ``t`` seconds after it pulled up, with ``n`` to deal
//: with (casualties for the ambulance, wrecks for the tow truck: one at a time for a truck) and
//: ``each`` seconds for each: { i (which one), k (0..1 through it), phase, done }.
//: An ambulance's ``k``: the crew out to the casualty with the stretcher (0-0.3), down and the
//: casualty lifted on (0.3-0.55), back to the doors (0.55-0.85), in (0.85-1). A tow truck's: the
//: boom lowered and the cable run out (0-0.3), hooked (0.3-0.4), the car's end lifted and drawn
//: up to the truck (0.4-1).
export function workAt(t, n, each) {
  if (!(n > 0)) return { i: 0, k: 1, phase: "done", done: true };
  const i = Math.floor(Math.max(0, t) / each);
  if (i >= n) return { i: n - 1, k: 1, phase: "done", done: true };
  return { i, k: clamp01((t - i * each) / each), phase: "working", done: false };
}
//: The stretcher party at ``k`` of a casualty's loading (workAt): how far along the way from the
//: ambulance's doors to the casualty they are (``reach`` 0..1), whether the casualty is on the
//: stretcher (``carried``), how high it is (``lift`` m) and whether they are inside (``in``).
export function stretcherAt(k) {
  if (k < 0.3) return { reach: k / 0.3, carried: false, lift: 0.75, in: false };
  if (k < 0.55) { const u = (k - 0.3) / 0.25; return { reach: 1, carried: u > 0.5, lift: 0.75 - 0.6 * Math.sin(u * Math.PI), in: false }; }
  if (k < 0.85) return { reach: 1 - (k - 0.55) / 0.3, carried: true, lift: 0.75, in: false };
  return { reach: 0, carried: true, lift: 0.75 + 0.25 * (k - 0.85) / 0.15, in: k > 0.93 };
}
//: The tow at ``k`` of a wreck's hooking (workAt): the boom's drop (``boom`` 0 stowed .. 1 down),
//: the cable out to the car (``cable`` 0..1), whether it is hooked, and how far the car's near
//: end is lifted (``lift`` 0..1) and drawn up to the truck (``draw`` 0..1).
export function towAt(k) {
  if (k < 0.3) return { boom: k / 0.3, cable: k / 0.3, hooked: false, lift: 0, draw: 0 };
  if (k < 0.4) return { boom: 1, cable: 1, hooked: true, lift: 0, draw: 0 };
  const u = (k - 0.4) / 0.6, e = u * u * (3 - 2 * u);
  return { boom: 1 - 0.6 * e, cable: 1 - 0.75 * e, hooked: true, lift: e, draw: e };
}
//: Whether a scene nobody is watching is cleared out of hand: you ``far`` metres off, it out of
//: your sight for ``unseen`` seconds -- or stale (nothing has come of it in ten minutes).
export const clearedUnseen = ({ far = 0, unseen = 0, age = 0 } = {}) => (far > CRASH.leave_m && unseen > CRASH.unseen_s) || age > CRASH.stale_s;
