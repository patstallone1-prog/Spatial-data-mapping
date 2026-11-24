// The game's clock: a day in 72 real minutes -- 48 of daylight, sunrise to sunset, and 24 of
// night, sunset to the next sunrise (the user's decision, 2026-11-14: real-world darkness made
// the evenings unplayable). The sun keeps its real path for the game's date at San Francisco:
// the clock runs faster by night than by day so each part takes its share, whatever the season.
//
// One function of real time, the same in every browser of a party: game(realMs) and its inverse
// real(gameMs). What keeps the books (shops' hours, shifts and pay, rent, bills, the NPCs' days,
// the sky) reads the game clock; what moves (walking, driving, the buses along their routes)
// moves in real seconds. The NPCs' days are planned in game minutes and travelled in real ones:
// fleetTime gives the fleet a day measured in real minutes from the game day's midnight, with
// toFleet / toGame to carry a planned time across (fleet.mjs residentPlan).
//
// Pure (tests/city_clock.test.mjs).

import { cityTime } from "./core.mjs";

const DAY_MS = 86_400_000, MIN = 60_000, RAD = Math.PI / 180;

// ---- sunrise and sunset (after suncalc 1.9, BSD-2-Clause, V. Agafonkin) -----------------------
const J1970 = 2440588, J2000 = 2451545, J0 = 0.0009, OBLIQUITY = RAD * 23.4397;
const toDays = (ms) => ms / DAY_MS - 0.5 + J1970 - J2000;
const fromJulian = (j) => (j + 0.5 - J1970) * DAY_MS;
const meanAnomaly = (d) => RAD * (357.5291 + 0.98560028 * d);
const eclipticLongitude = (M) => M + RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) + RAD * 102.9372 + Math.PI;
const transitJ = (ds, M, L) => J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
//: Sunrise and sunset (ms, UTC) of the day holding ``ms`` at (lat, lon): the sun's upper limb on
//: the horizon (-0.833 degrees, refraction included).
export function sunTimes(ms, lat, lon) {
  const lw = RAD * -lon, phi = RAD * lat, d = toDays(ms);
  const n = Math.round(d - J0 - lw / (2 * Math.PI));
  const ds = J0 + lw / (2 * Math.PI) + n;
  const M = meanAnomaly(ds), L = eclipticLongitude(M), dec = Math.asin(Math.sin(OBLIQUITY) * Math.sin(L));
  const noon = transitJ(ds, M, L);
  const cosW = (Math.sin(-0.833 * RAD) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
  const w = Math.acos(Math.max(-1, Math.min(1, cosW)));
  const set = transitJ(J0 + (w + lw) / (2 * Math.PI) + n, M, L);
  return { rise: fromJulian(noon - (set - noon)), set: fromJulian(set), noon: fromJulian(noon) };
}

// ---- the clock ---------------------------------------------------------------------------------

//: A clock from the rules' ``clock``: { day_minutes, night_minutes, epoch (real, ISO), start
//: (the game's first date, YYYY-MM-DD), lat, lon }. Game day k begins at sunrise of start + k
//: days, at real epoch + k cycles.
export function makeClock(spec) {
  const dayReal = (spec.day_minutes ?? 48) * MIN, nightReal = (spec.night_minutes ?? 24) * MIN, cycle = dayReal + nightReal;
  const lat = spec.lat ?? 37.8, lon = spec.lon ?? -122.43;
  const epoch = Date.parse(spec.epoch ?? "2026-11-14T08:00:00Z");
  const [y, m, d] = String(spec.start ?? "2026-11-14").split("-").map(Number);
  // Local noon of the start date (UTC ms), near enough for the day's sun.
  const noon0 = Date.UTC(y, m - 1, d, 12) - (lon / 15) * 3_600_000;
  const suns = new Map();
  const sun = (k) => {
    let s = suns.get(k);
    if (!s) { s = sunTimes(noon0 + k * DAY_MS, lat, lon); if (suns.size > 400) suns.clear(); suns.set(k, s); }
    return s;
  };
  const rise = (k) => sun(k).rise, set = (k) => sun(k).set;
  //: The game's time (ms) at real time ``realMs``.
  function game(realMs) {
    const k = Math.floor((realMs - epoch) / cycle), u = realMs - epoch - k * cycle;
    if (u < dayReal) return rise(k) + (u / dayReal) * (set(k) - rise(k));
    return set(k) + ((u - dayReal) / nightReal) * (rise(k + 1) - set(k));
  }
  //: The real time (ms) at which the game's clock reads ``gameMs``.
  function real(gameMs) {
    let k = Math.floor((gameMs - rise(0)) / DAY_MS);
    while (gameMs < rise(k)) k -= 1;
    while (gameMs >= rise(k + 1)) k += 1;
    const start = epoch + k * cycle;
    if (gameMs < set(k)) return start + ((gameMs - rise(k)) / (set(k) - rise(k))) * dayReal;
    return start + dayReal + ((gameMs - set(k)) / (rise(k + 1) - set(k))) * nightReal;
  }
  //: How many game seconds pass in a real second at real time ``realMs`` (by day ~12-18, by night ~30-40).
  function rate(realMs) {
    const k = Math.floor((realMs - epoch) / cycle), u = realMs - epoch - k * cycle;
    return u < dayReal ? (set(k) - rise(k)) / dayReal : (rise(k + 1) - set(k)) / nightReal;
  }
  //: Game time ``realDurationMs`` of real time after game time ``gameMs`` (a courier's deadline: the
  //: minutes the ride takes, on the game's clock).
  const after = (gameMs, realDurationMs) => game(real(gameMs) + realDurationMs);
  //: Daylight's share of the cycle at real time ``realMs``: 0 at sunrise, 1 at sunset; then the
  //: night's, from 1 to 2 at the next sunrise.
  function phase(realMs) {
    const k = Math.floor((realMs - epoch) / cycle), u = realMs - epoch - k * cycle;
    return u < dayReal ? u / dayReal : 1 + (u - dayReal) / nightReal;
  }
  return { game, real, rate, after, phase, sun, cycle, dayReal, nightReal, epoch, lat, lon };
}

// ---- time held ---------------------------------------------------------------------------------
//
// The practice game can hold its clock (the owner, 2026-11-23: a way to test a change against the
// same hour of the same day, as often as wanted). Everything that reads the game's time reads it
// through ``clockTime``: the real time, less however long the clock has stood in all (``skew``),
// or the moment it was stopped at while it is held. The sky, the books and the hours shops keep
// stand still; the street does not -- people and traffic go on moving at real speed through a
// short window of the held hour (``holdWindow``), each on their own phase of it, so that how many
// are out, and doing what, stays what that hour has (``heldOffset``). One state for the page: the
// sky (environment-runtime.mjs) and the city read the same hold. Never set where a server keeps
// the clock (the city online is one clock for everyone).

const HOLD = (globalThis.__kerbsideClockHold ||= { at: null, since: 0, skew: 0 });
//: The time the game's clock is read at, at real time ``realMs``.
export function clockTime(realMs = Date.now()) { return HOLD.at !== null ? HOLD.at : realMs - HOLD.skew; }
export const clockHeld = () => HOLD.at !== null;
//: The clock stopped: at this moment, or at ``at`` (a clock time, as clockTime gives).
export function holdClock(realMs = Date.now(), at = null) {
  HOLD.at = at ?? (HOLD.at !== null ? HOLD.at : realMs - HOLD.skew);
  HOLD.since = realMs;
  return HOLD.at;
}
//: ... and let go: it runs on from where it stood.
export function releaseClock(realMs = Date.now()) {
  if (HOLD.at === null) return;
  HOLD.skew = realMs - HOLD.at; HOLD.at = null;
}
//: The hold as kept between visits ({at, skew} or null), and put back.
export const clockHoldState = () => (HOLD.at !== null || HOLD.skew ? { at: HOLD.at, skew: HOLD.skew } : null);
export function restoreClockHold(state, realMs = Date.now()) {
  HOLD.at = Number.isFinite(state?.at) ? state.at : null; HOLD.skew = Number.isFinite(state?.skew) ? state.skew : 0; HOLD.since = realMs;
}
//: While the clock is held, how far into the held window (real ms, 0 to ``window``) phase ``k`` of
//: ``of`` is at real time ``realMs``, and how many times it has been round (``turn``): each phase
//: starts a different way through the window, so at any moment the phases are spread evenly over
//: the whole of it -- what is out on the street is the window's average, and stays so.
export function heldOffset(realMs, k, of, window) {
  const run = Math.max(0, realMs - HOLD.since) + (k / of) * window, turn = Math.floor(run / window);
  return { offset: run - turn * window, turn };
}

//: The clock the page's sky runs on before (and without) the city's rules: the same as rules.json
//: ``clock`` (tests/city_clock.test.mjs holds them equal).
export const CLOCK_SPEC = Object.freeze({ zone: "America/Los_Angeles", day_minutes: 48, night_minutes: 24, epoch: "2026-11-14T08:00:00Z", start: "2026-11-14", lat: 37.8, lon: -122.43 });

const CLOCKS = new WeakMap();
//: The rules' clock (one a rules object).
export function clockOf(R) {
  let c = CLOCKS.get(R);
  if (!c) { c = makeClock(R.clock || {}); CLOCKS.set(R, c); }
  return c;
}

//: The time the fleet works in at real time ``realMs``: the game's day, weekday and hour, and
//: ``minute`` counted in real minutes from the real moment the game day began (its midnight) --
//: so a journey planned in it is travelled at real speed. ``toFleet(gameMinute)`` and
//: ``toGame(fleetMinute)`` carry a time of that day across; ``ms`` is real.
export function fleetTime(clock, realMs, zone = "America/Los_Angeles") {
  const g = clock.game(realMs), ct = cityTime(g, zone);
  const gMid = g - ct.minute * MIN, rMid = clock.real(gMid);
  return {
    ...ct, ms: realMs, gameMs: g, gameMinute: ct.minute, minute: (realMs - rMid) / MIN,
    toFleet: (gm) => (clock.real(gMid + gm * MIN) - rMid) / MIN,
    toGame: (fm) => (clock.game(rMid + fm * MIN) - gMid) / MIN,
  };
}
