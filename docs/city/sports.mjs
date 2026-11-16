// People on the parks' courts: how many a court has at a time, and what each of them is doing.
//
// A court is booked an hour at a time. Each hour of each day a court either stands empty or has a
// game of a size that suits it -- two or four at tennis, anything from one shooting alone to five
// a side at basketball -- dealt from the court and the day, so everyone agrees without asking each
// other. Residents planning a game (routines.mjs) join an hour that has one and skip one that
// does not. On the court (fleet.mjs City.playing) the first so many are the game; anyone over
// waits at the side for the next one.
//
// The play itself is a small choreography around a ball nobody draws: a rally from baseline to
// baseline with a swing as it arrives, a possession brought up the court, worked round the arc
// and shot. Pure; a function of the court, the hour and the second.

import { hash32, rng } from "./people.mjs";

//: How long a game is booked for (minutes).
export const SESSION_MIN = 60;
//: By sport: the sizes a game can be with their weights, the most on court, the share of
//: residents who find a place when they want one, and how the game is played.
export const SPORTS = {
  tennis: { play: "net", sizes: [[2, 0.56], [4, 0.3], [1, 0.14]], valid: [1, 2, 4], join: 0.6, name: "playing tennis", wait: "waiting for a court" },
  pickleball: { play: "net", sizes: [[4, 0.6], [2, 0.4]], valid: [2, 4], join: 0.7, name: "playing pickleball", wait: "waiting for a court" },
  volleyball: { play: "net", sizes: [[4, 0.4], [6, 0.3], [8, 0.2], [12, 0.1]], valid: [2, 4, 6, 8, 10, 12], join: 0.9, name: "playing volleyball", wait: "waiting for a game" },
  basketball: { play: "hoop", hoops: 2, sizes: [[1, 0.1], [2, 0.14], [3, 0.1], [4, 0.14], [6, 0.2], [8, 0.16], [10, 0.16]], valid: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], join: 1, name: "playing basketball", wait: "waiting to play" },
  basketball_half: { play: "hoop", hoops: 1, sizes: [[1, 0.2], [2, 0.26], [3, 0.14], [4, 0.2], [6, 0.2]], valid: [1, 2, 3, 4, 5, 6], join: 0.75, name: "playing basketball", wait: "waiting to play" },
  soccer: { play: "pitch", sizes: [[6, 0.25], [8, 0.25], [10, 0.25], [14, 0.25]], valid: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14], join: 1, name: "playing football", wait: "waiting to play" },
  baseball: { play: "pitch", sizes: [[4, 0.3], [6, 0.3], [9, 0.4]], valid: [2, 3, 4, 5, 6, 7, 8, 9, 10], join: 1, name: "playing ball", wait: "waiting to play" },
  other: { play: "pitch", sizes: [[2, 0.4], [4, 0.4], [6, 0.2]], valid: [1, 2, 3, 4, 5, 6], join: 0.8, name: "playing", wait: "waiting to play" },
};
export const sportOf = (s) => SPORTS[s] || SPORTS.other;
//: Waiting at the side, at most this many are drawn.
export const SIDELINE_MAX = 4;

//: The game a court has in the hour ``minute`` of ``day`` falls in: {n, block, start}; n is 0 for
//: an hour it stands empty (more often early and late, less at lunch and after work).
export function courtSession(courtId, sport, day, minute) {
  const block = Math.floor(minute / SESSION_MIN), hour = Math.floor(block * SESSION_MIN / 60);
  const r = rng("court", courtId, day, block);
  const empty = hour < 8 || hour >= 20 ? 1 : hour < 9 || hour >= 19 ? 0.5 : hour === 12 || hour === 17 || hour === 18 ? 0.12 : 0.24;
  if (r() < empty) return { n: 0, block, start: block * SESSION_MIN };
  const S = sportOf(sport);
  let x = r() * S.sizes.reduce((s, [, w]) => s + w, 0), n = S.sizes.at(-1)[0];
  for (const [size, w] of S.sizes) { x -= w; if (x <= 0) { n = size; break; } }
  return { n, block, start: block * SESSION_MIN };
}
//: Whether ``personId`` planning a game at this court at ``minute`` finds one to join.
export function joinsGame(courtId, sport, day, minute, personId) {
  if (!courtSession(courtId, sport, day, minute).n) return false;
  return hash32("court-join", personId, courtId, day) / 4294967296 < sportOf(sport).join;
}
//: Of ``present`` people at a court, how many are the game (the rest wait at the side).
export function playersOf(sport, present, booked) {
  const S = sportOf(sport), most = Math.min(present, booked || S.valid.at(-1));
  let n = 0;
  for (const v of S.valid) if (v <= most) n = v;
  return n;
}

const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => { const x = Math.max(0, Math.min(1, t)); return x * x * (3 - 2 * x); };
const unit = (...seed) => hash32(...seed) / 4294967296;

// ---- the games: a place on the court (u along it, v across it, metres from its middle) ---------------

//: A net game: a rally from baseline to baseline, a point every few shots, then a walk back to serve.
function net(C, n, i, sec, key) {
  const T = 2.4, shot = Math.floor(sec / T), f = sec / T - shot;
  const hu = C.l / 2, hv = Math.max(1, C.w / 2 - 1);
  const per = Math.max(1, n / 2), side = i % 2 ? 1 : -1, mate = Math.floor(i / 2);
  const deep = hu - 1.2;
  if (n === 1) {
    // Alone: serving a basket of balls from the baseline, one every few seconds, a step along each time.
    const k = Math.floor(sec / 6), g = sec / 6 - k, spot = (j) => (j % 2 ? 1 : -1) * hv * 0.3;
    const v = lerp(spot(k - 1), spot(k), smooth(g / 0.35));
    return { u: -hu + 0.4, v, face: [hu * 0.5, -v], gesture: g > 0.55 && g < 0.8 ? { kind: "serve", f: (g - 0.55) / 0.25 } : null };
  }
  const POINT = 9, RALLY = POINT - 2, point = Math.floor(shot / POINT), inPoint = shot - point * POINT;
  // The ball of shot j is hit from side (j odd ? +1 : -1) and lands across the net at aim(j).
  const aim = (j) => (unit(key, "aim", j) * 2 - 1) * hv * 0.8;
  // Doubles: each keeps a half of their side, one a little further up; the ball is whose half it lands in.
  const mine = (j) => per === 1 || (aim(j) >= 0 ? 0 : 1) === mate % 2;
  const home = { u: side * (deep - (per > 1 && mate % 2 ? 2.2 : 0)), v: per > 1 ? (mate % 2 ? -1 : 1) * hv * 0.45 : 0 };
  const rallyAt = (j, ff) => {
    const hitter = j % 2 ? 1 : -1;
    if (side !== hitter && mine(j)) return { v: lerp(home.v, aim(j), smooth(ff * 1.15)), gesture: ff > 0.82 ? { kind: "swing", f: (ff - 0.82) / 0.18 } : null };
    if (side === hitter && mine(j - 1)) return { v: lerp(aim(j - 1), home.v, smooth(ff)), gesture: ff < 0.12 ? { kind: "swing", f: 0.5 + ff / 0.24 } : null };
    return { v: home.v, gesture: null };
  };
  const server = point % n === i;
  const serveAt = { u: server ? side * (deep + 0.6) : home.u, v: server ? hv * 0.3 * (point % 2 ? 1 : -1) : home.v };
  if (inPoint >= RALLY) {
    // Between points: from where the rally left you back to your place; the server serves the next.
    const g = (inPoint - RALLY + f) / 2, was = rallyAt(point * POINT + RALLY - 1, 1), t = smooth(g / 0.6);
    const next = point + 1, serving = next % n === i;
    const to = { u: serving ? side * (deep + 0.6) : home.u, v: serving ? hv * 0.3 * (next % 2 ? 1 : -1) : home.v };
    return { u: lerp(home.u, to.u, t), v: lerp(was.v, to.v, t), face: [0, 0], gesture: serving && g > 0.78 ? { kind: "serve", f: (g - 0.78) / 0.22 } : null };
  }
  const r = rallyAt(shot, f), hitter = shot % 2 ? 1 : -1;
  // The first ball of a point: out of the serving places into the rally.
  const t = inPoint === 0 ? smooth(f / 0.6) : 1;
  const ball = { u: lerp(hitter * deep, -hitter * deep, f), v: lerp(aim(shot - 1), aim(shot), f) };
  return { u: lerp(serveAt.u, home.u, t), v: lerp(serveAt.v, r.v, t), face: [ball.u, ball.v], gesture: r.gesture };
}

//: Basketball: alone or in a pair, shooting round the arc; three or more, a game -- a possession
//: brought up the court, worked round, shot, and back the other way (to the one hoop on a half court).
function hoop(C, n, i, sec, key, hoops) {
  const hu = C.l / 2, hv = Math.max(1.2, C.w / 2 - 0.8);
  const rim = (dir) => ({ u: dir * (hu - 1.3), v: 0 });
  const arc = (dir, angle, radius) => {
    const R = Math.min(radius, hoops === 1 ? C.l - 2.6 : hu - 0.5);
    return { u: dir * (hu - 1.3) - dir * R * Math.cos(angle), v: Math.max(-hv, Math.min(hv, R * Math.sin(angle))) };
  };
  if (n <= 2) {
    // Shooting around: to a spot, set, shoot, in for the rebound, out to the next spot.
    const T = 7.5, off = i * 3.1, k = Math.floor((sec + off) / T), f = (sec + off) / T - k;
    const dir = hoops === 1 ? 1 : (unit(key, i, "end") < 0.5 ? 1 : -1);
    const spot = (j) => arc(dir, (unit(key, i, "spot", j) * 2 - 1) * 1.25, 3.6 + unit(key, i, "r", j) * 2.6);
    const a = spot(k), b = spot(k + 1), under = { u: rim(dir).u - dir * 0.9, v: (unit(key, i, "reb", k) - 0.5) * 2 };
    let p = a, gesture = null;
    if (f < 0.34) { p = a; if (f > 0.2) gesture = { kind: "shoot", f: (f - 0.2) / 0.14 }; }
    else if (f < 0.62) p = { u: lerp(a.u, under.u, smooth((f - 0.34) / 0.28)), v: lerp(a.v, under.v, smooth((f - 0.34) / 0.28)) };
    else p = { u: lerp(under.u, b.u, smooth((f - 0.62) / 0.38)), v: lerp(under.v, b.v, smooth((f - 0.62) / 0.38)) };
    return { ...p, face: f < 0.62 ? [rim(dir).u, 0] : null, gesture };
  }
  const P = 13, k = Math.floor(sec / P), f = sec / P - k;
  const team = i % 2, slot = Math.floor(i / 2), per = team === 0 ? Math.ceil(n / 2) : Math.floor(n / 2);
  const set = (kk, ff) => {
    const attacking = (kk + team) % 2 === 0, dir = hoops === 1 ? 1 : (kk % 2 ? -1 : 1);
    const sway = Math.sin((kk * P + ff * P) * 0.55 + slot * 2.1 + team) * 0.22;
    const angle = (per > 1 ? lerp(-1.15, 1.15, slot / (per - 1)) : 0) + sway;
    const out = arc(dir, angle, 5.4 + 0.8 * Math.sin((kk * P + ff * P) * 0.4 + slot));
    const shooter = Math.floor(unit(key, "shooter", kk) * Math.max(1, Math.ceil(n / 2))) % Math.max(1, per);
    if (attacking) {
      // The shot goes up at the end of the possession; the others go in for the rebound.
      if (ff > 0.86) {
        if (slot === shooter) return { ...out, gesture: { kind: "shoot", f: (ff - 0.86) / 0.14 } };
        const t = smooth((ff - 0.86) / 0.14) * 0.22;
        return { u: lerp(out.u, rim(dir).u, t), v: lerp(out.v, 0, t), gesture: null };
      }
      return { ...out, gesture: null };
    }
    // Defending: between your player and the basket, arms out when the shot goes up.
    const d = { u: lerp(rim(dir).u, out.u, 0.6), v: lerp(0, out.v, 0.6) };
    return { ...d, gesture: ff > 0.8 && slot === shooter % Math.max(1, per) ? { kind: "guard", f: 1 } : null };
  };
  const now = set(k, f), dirNow = hoops === 1 ? 1 : (k % 2 ? -1 : 1);
  if (f < 0.36 && k > 0) {
    // Up the court (or, at the one hoop, out past the arc to take it again).
    const was = set(k - 1, 1), t = smooth(f / 0.36);
    // (The two sides run back past each other, each keeping to its own lane.)
    const lane = (team ? 1 : -1) * 1.1 * Math.sin(Math.PI * t);
    return { u: lerp(was.u, now.u, t), v: Math.max(-hv, Math.min(hv, lerp(was.v, now.v, t) + lane)), face: null, gesture: null };
  }
  return { u: now.u, v: now.v, face: [rim(dirNow).u, 0], gesture: now.gesture };
}

//: A field game: everyone has a place in the side's shape and is drawn toward the ball as it moves.
function pitch(C, n, i, sec, key) {
  const hu = C.l / 2 - 1, hv = Math.max(1, C.w / 2 - 1);
  const ball = { u: hu * 0.85 * Math.sin(sec * 0.11 + unit(key, "bu") * 6) * Math.cos(sec * 0.031), v: hv * 0.8 * Math.sin(sec * 0.17 + unit(key, "bv") * 6) };
  const team = i % 2, slot = Math.floor(i / 2), per = Math.max(1, team === 0 ? Math.ceil(n / 2) : Math.floor(n / 2));
  const rows = Math.max(1, Math.round(Math.sqrt(per))), row = slot % rows, col = Math.floor(slot / rows), cols = Math.ceil(per / rows);
  const home = { u: (team ? 1 : -1) * hu * lerp(0.75, 0.15, rows > 1 ? row / (rows - 1) : 0.5), v: cols > 1 ? lerp(-hv * 0.7, hv * 0.7, col / (cols - 1)) : 0 };
  const near = Math.hypot(ball.u - home.u, ball.v - home.v), pull = Math.max(0.2, Math.min(0.85, 1 - near / (C.l * 0.6)));
  const kick = near < 3 && Math.sin(sec * 2.1 + i) > 0.92;
  return { u: lerp(home.u, ball.u, pull), v: lerp(home.v, ball.v, pull), face: [ball.u, ball.v], gesture: kick ? { kind: "swing", f: 0.5 } : null };
}

function local(C, sport, n, i, sec, key) {
  const S = sportOf(sport);
  if (S.play === "net") return net(C, n, i, sec, key);
  if (S.play === "hoop") return hoop(C, n, i, sec, key, S.hoops);
  return pitch(C, n, i, sec, key);
}

//: Player ``i`` of ``n`` on court ``C`` ({x, z, a, l, w, s}) at ``sec`` (seconds of the day):
//: {x, z, yaw, moving, speed, gesture}. ``key`` seeds the game (the court and its hour).
export function playPose(C, n, i, sec, key = "") {
  const ux = Math.cos(C.a), uz = -Math.sin(C.a), vx = -Math.sin(C.a), vz = -Math.cos(C.a);
  const world = (p) => [C.x + ux * p.u + vx * p.v, C.z + uz * p.u + vz * p.v];
  // (Each a half step off their mark, their own way: two sent to one spot do not stand in each other.)
  const off = n > 1 ? { u: 0.45 * Math.cos(i * 2.399), v: 0.45 * Math.sin(i * 2.399) } : { u: 0, v: 0 };
  const hu = C.l / 2 - 0.2, hv = C.w / 2 - 0.2, net = sportOf(C.s).play === "net";
  const fit = (p) => ({ ...p, u: net ? p.u : Math.max(-hu, Math.min(hu, p.u + off.u)), v: Math.max(-hv, Math.min(hv, p.v + (net ? 0 : off.v))) });
  const a = fit(local(C, C.s, n, i, sec, key)), b = fit(local(C, C.s, n, i, sec + 0.25, key));
  const [x, z] = world(a), [x1, z1] = world(b);
  const speed = Math.hypot(x1 - x, z1 - z) * 4;
  let dx = x1 - x, dz = z1 - z;
  // Running: facing the way you go. Set, or shuffling: facing the ball or the basket.
  if (speed < 1.1 && a.face) { const [fx, fz] = world({ u: a.face[0], v: a.face[1] }); dx = fx - x; dz = fz - z; }
  if (Math.hypot(dx, dz) < 1e-4) { dx = -ux * (a.u || 1); dz = -uz * (a.u || 1); }
  return { x, z, yaw: Math.atan2(-dx, -dz), moving: speed > 0.35, speed, gesture: a.gesture || null };
}
//: Someone waiting at the side: ``k`` of those waiting, along the court's long edge, facing the game.
export function sidelinePose(C, k, seed = "") {
  const ux = Math.cos(C.a), uz = -Math.sin(C.a), vx = -Math.sin(C.a), vz = -Math.cos(C.a);
  const side = k % 2 ? 1 : -1, u = lerp(-C.l * 0.3, C.l * 0.3, unit(seed, "side")) + (Math.floor(k / 2) - 0.5) * 1.1, v = side * (C.w / 2 + 1.1);
  const x = C.x + ux * u + vx * v, z = C.z + uz * u + vz * v;
  return { x, z, yaw: Math.atan2(-(C.x - x), -(C.z - z)), moving: false, speed: 0, gesture: null };
}
