// Who each person is when something happens: the same street, the same car coming, and one
// steps back early, one barely looks up, one films it and one runs to help.
//
// A temperament is five shares (0..1), the same for a person every time (from their id, tilted by
// their age and their work): how much frightens them (nerve), how quick they are to push on
// (temper), how long they will wait (patience), how careful they are (care) and how much the
// street is their business (civic). Two things are read off it:
//
//   - how they drive (drivingStyle): the pace they hold, the room they leave, how long they sit
//     behind something before going round, how far ahead they brake, and whether, with a car
//     coming across, they go first or let it;
//   - what they do near you when something happens (reactionTo): a car bearing down on them, a
//     crash, a fight.
//
// Only the people and the cars near you are run this way (the full and moderate rings,
// detail.mjs; the cars driven by the rules, view.mjs SIM_M). Everyone further off is where their
// day has them and nothing else: a start, an end and the time between.
import { hash32 } from "./people.mjs";

const unit = (...k) => (hash32(...k) % 10007) / 10006;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const lerp = (a, b, k) => a + (b - a) * k;

//: Work that shapes a temperament: {trait: shift}.
export const ROLE_TILT = {
  patrol: { nerve: 0.35, civic: 0.4, care: 0.15 }, police: { nerve: 0.35, civic: 0.4, care: 0.15 },
  paramedic: { nerve: 0.3, civic: 0.45, care: 0.2 }, nurse: { nerve: 0.2, civic: 0.35, care: 0.2 }, doctor: { nerve: 0.2, civic: 0.35, care: 0.2 },
  bus_driver: { patience: 0.25, care: 0.2 }, taxi: { temper: 0.2, patience: -0.15 }, courier: { temper: 0.2, patience: -0.2 },
  delivery: { temper: 0.15, patience: -0.15 }, teacher: { civic: 0.2, care: 0.15 }, student: { temper: 0.1, care: -0.1 },
};

//: The temperament of ``p`` ({id, age, base: {role}}): kept on the person once worked out.
export function temperamentOf(p) {
  if (!p) return STEADY_TEMPERAMENT;
  if (p._temperament) return p._temperament;
  const id = p.id, age = p.age ?? p.base?.age ?? 35, tilt = ROLE_TILT[p.base?.role] || {};
  // The young are quicker to push on and less careful; the old the other way.
  const young = clamp01((30 - age) / 14), old = clamp01((age - 55) / 20);
  const t = {
    nerve: clamp01(lerp(0.1, 0.9, unit(id, "nerve")) - old * 0.15 + (tilt.nerve || 0)),
    temper: clamp01(lerp(0.05, 0.95, unit(id, "temper")) + young * 0.15 - old * 0.2 + (tilt.temper || 0)),
    patience: clamp01(lerp(0.1, 0.95, unit(id, "patience")) - young * 0.1 + old * 0.15 + (tilt.patience || 0)),
    care: clamp01(lerp(0.15, 0.95, unit(id, "care")) - young * 0.15 + old * 0.2 + (tilt.care || 0)),
    civic: clamp01(lerp(0.05, 0.9, unit(id, "civic")) + old * 0.1 + (tilt.civic || 0)),
  };
  try { Object.defineProperty(p, "_temperament", { value: t, enumerable: false, configurable: true }); } catch { /* a frozen record: worked out again next time */ }
  return t;
}
export const STEADY_TEMPERAMENT = Object.freeze({ nerve: 0.5, temper: 0.5, patience: 0.5, care: 0.5, civic: 0.5 });

//: A driver with no temperament given: as the traffic's own numbers have it.
export const STEADY_STYLE = Object.freeze({ pace: 1, headway: 1, patience: 1, alert: 1, assertive: false });

//: How someone of temperament ``t`` drives. None of it breaks the law: nobody is faster than the
//: limit or closer than a car can stop in -- the careful hold back more, they do not all drive alike.
//:   pace: the share of their cruising speed they hold (0.86 .. 1);
//:   headway: the time they leave to the car ahead, against the usual (0.8 .. 1.6);
//:   patience: how long they sit behind something stood in the lane before going round (0.5 .. 2.2);
//:   alert: how far ahead they brake for someone in the road, against the usual (1 .. 1.5);
//:   assertive: with a car coming across and no way of telling who is first, they go.
export function drivingStyle(t = STEADY_TEMPERAMENT) {
  return {
    pace: +lerp(0.86, 1, clamp01(0.55 * t.temper + 0.45 * (1 - t.care))).toFixed(3),
    headway: +Math.max(0.8, Math.min(1.6, 1.25 - 0.55 * t.temper + 0.35 * t.care)).toFixed(3),
    patience: +lerp(0.5, 2.2, t.patience).toFixed(3),
    alert: +lerp(1, 1.5, t.care).toFixed(3),
    assertive: t.temper > 0.66 && t.care < 0.5,
  };
}

//: The same driver in the rain: slower, with more room, braking earlier.
export function wetStyle(s) {
  return { pace: +(s.pace * 0.9).toFixed(3), headway: +Math.min(1.9, s.headway * 1.25).toFixed(3), patience: s.patience, alert: +(s.alert * 1.15).toFixed(3), assertive: false };
}

//: How people near you react. Times in seconds, lengths in metres; [bold, timid] where two.
export const REACT = {
  notice_m: 30,               // an incident this near is noticed
  incident_s: 14,             // and for this long after it
  car_ttc_s: [0.9, 2.3],      // a car this far off (in time) makes them move: the bold late, the timid early
  car_side_m: 0.9,            // ... if it would pass this near their shoulder
  jump_m: [1.1, 2.0],         // how far they get out of its way
  jump_s: 1.1,                // and how long before they walk on
  watch_s: [4, 10], film_s: [6, 12], call_s: [7, 11], help_s: [8, 14],
  // At one incident, no more than this many do each: a street does not all telephone at once.
  most: { help: 3, call: 3, film: 6, flee: 14, watch: 16 },
  flee_m: [8, 16], flee_ms: 3.4,
};

//: What ``t`` does about ``event`` ({kind: "crash" | "fight", id}), ``dist`` m away. The same
//: person does the same about the same event; another event may take them differently.
//: "help": goes to it; "call": stops and telephones; "film": holds a phone up to it; "watch":
//: stops and looks; "flee": gets away from it; "carry_on".
export function reactionTo(t, event, dist, who = "") {
  if (dist > REACT.notice_m) return "carry_on";
  const roll = unit(who, event.id ?? "", "react"), near = 1 - dist / REACT.notice_m;
  const fight = event.kind === "fight";
  // Fear first: a fight frightens more than a crash, and the nearer the more.
  const fear = (1 - t.nerve) * (fight ? 1 : 0.6) * (0.55 + 0.45 * near);
  if (fear > 0.3 + roll * 0.25) return "flee";
  if (t.nerve > 0.62 && t.civic > 0.55 && !fight && roll < 0.75) return "help";
  if (t.civic > 0.5 && roll < 0.35 + t.civic * 0.4) return "call";
  if (t.care < 0.55 && roll < 0.5) return "film";
  if (roll < 0.35 + near * 0.4) return "watch";
  return "carry_on";
}

//: How long a reaction lasts for ``t`` (s).
export function reactionFor(t, kind) {
  const k = clamp01(1 - t.patience * 0.5 + (1 - t.nerve) * 0.2);
  if (kind === "watch") return lerp(REACT.watch_s[0], REACT.watch_s[1], k);
  if (kind === "film") return lerp(REACT.film_s[0], REACT.film_s[1], k);
  if (kind === "call") return lerp(REACT.call_s[0], REACT.call_s[1], t.civic);
  if (kind === "help") return lerp(REACT.help_s[0], REACT.help_s[1], t.civic);
  if (kind === "flee") return lerp(REACT.flee_m[0], REACT.flee_m[1], 1 - t.nerve) / REACT.flee_ms + 2;
  return 0;
}

//: A car at (cx, cz) going (vx, vz) m/s, ``half`` wide to each side, and someone of temperament
//: ``t`` at (x, z): null if it is no danger to them, else the step they take out of its way
//: ({dx, dz} m, to the side they are already on) and how soon it would be on them (s).
export function stepClear(t, x, z, cx, cz, vx, vz, half = 0.95) {
  const v = Math.hypot(vx, vz);
  if (v < 2.5) return null;
  const ux = vx / v, uz = vz / v, rx = x - cx, rz = z - cz;
  const along = rx * ux + rz * uz, side = rx * uz - rz * ux;
  if (along <= 0.5 || Math.abs(side) > half + REACT.car_side_m) return null;
  const ttc = along / v, limit = lerp(REACT.car_ttc_s[0], REACT.car_ttc_s[1], 1 - t.nerve);
  if (ttc > limit) return null;
  const want = Math.min(lerp(REACT.jump_m[0], REACT.jump_m[1], 1 - t.nerve), half + REACT.car_side_m + 0.5 - Math.abs(side) + 0.6);
  const s = side >= 0 ? 1 : -1;
  // (To the right of the car's way is (uz, -ux).)
  return { dx: uz * s * want, dz: -ux * s * want, ttc };
}

//: Two things on straight ways: (x, z) going (vx, vz), each ``r`` round. The time (s, within
//: ``horizon``) at which they would first be within their two radii of each other, or -1.
export function timeToMeet(ax, az, avx, avz, ar, bx, bz, bvx, bvz, br, horizon = 2.5) {
  const rx = bx - ax, rz = bz - az, vx = bvx - avx, vz = bvz - avz, R = ar + br;
  const c = rx * rx + rz * rz - R * R;
  if (c <= 0) return 0;
  const a = vx * vx + vz * vz, b = 2 * (rx * vx + rz * vz);
  if (a < 1e-6 || b >= 0) return -1;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= horizon ? t : -1;
}
