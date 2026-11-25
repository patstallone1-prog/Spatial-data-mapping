// What a client may ask, and where it may be: checked before a command reaches the world.
//
// The world's own rules decide what a command does (docs/city/world.mjs: what you can afford,
// carry, reach, own). This is what stands in front of them on a server: the commands a client
// may not send at all, the shape and size of what it sends, the numbers it reports about itself
// held to what is possible, and its position -- on the city's map, and no further from where the
// server last saw it than it could have travelled.
import { Refused } from "./canon.mjs";

//: Never a client's to send: money from outside the world comes in by the server alone.
export const SERVER_ONLY = new Set(["import", "account_grant"]);

export const LIMITS = Object.freeze({
  //: The fastest anything in the city carries a player (m/s: about 155 mph), and the slack a
  //: position is given for the moments between a client's reports.
  speed_mps: 70, slack_m: 90,
  //: A client's reported position against the server's map: further apart than this and the
  //: page is not drawing the city the server keeps.
  map_error_m: 60,
  //: The home you are given on joining is one you stand near.
  join_home_m: 500,
  //: Commands a player may send in a window (ms).
  rate: [80, 10_000],
  bytes: 24_000, depth: 7, string: 2_000, keys: 120,
  //: Found things beyond the day's seeded ones (a crash's debris) a player may pick up in a day.
  debris_a_day: 12,
});

//: Numbers a client reports about itself, held to what can be: [min, max, whole].
const CLAMPS = {
  qty: [1, 99, true], witnesses: [0, 40, true], km: [0, 300, false], litres: [0, 120, false], seconds: [0, 60, false],
  sprint_s: [0, 60, false], walked_m: [0, 600, false], occupants: [1, 8, true], hours: [0, 72, false], speed: [0, 90, false],
  over_mph: [0, 200, false], mph: [0, 250, false], used_years: [0, 40, true],
  swim_s: [0, 60, false], swim_sprint_s: [0, 60, false], tread_s: [0, 60, false],
  //: How long a witness was on the phone to 911 (law.mjs: ten seconds gets through).
  call_s: [0, 120, false],
};

//: A command's arguments as plain, finite, bounded data (a copy). Throws Refused.
export function sanitize(args, command) {
  let text;
  try { text = JSON.stringify(args ?? {}); } catch { throw new Refused("that command cannot be read"); }
  if (text.length > LIMITS.bytes) throw new Refused("that command is too large");
  const walk = (v, depth) => {
    if (depth > LIMITS.depth) throw new Refused("that command is too deep");
    if (v === null || typeof v === "boolean") return v;
    if (typeof v === "number") { if (!Number.isFinite(v)) throw new Refused("that command has a number that is not one"); return v; }
    if (typeof v === "string") return v.slice(0, LIMITS.string);
    if (Array.isArray(v)) { if (v.length > LIMITS.keys) throw new Refused("that command lists too much"); return v.map((x) => walk(x, depth + 1)); }
    if (typeof v !== "object") return null;
    const entries = Object.entries(v);
    if (entries.length > LIMITS.keys) throw new Refused("that command lists too much");
    const out = {};
    for (const [k, x] of entries) {
      if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
      const measured = k === "qty" && ["lab_test","kitchen_serve","kitchen_bin","kitchen_prepare"].includes(command);
      const c = measured ? null : CLAMPS[k];
      if (c && typeof x === "number") { const n = Math.max(c[0], Math.min(c[1], x)); out[k] = c[2] ? Math.round(n) : n; }
      else out[k] = walk(x, depth + 1);
    }
    return out;
  };
  const out = walk(JSON.parse(text), 0);
  if (!out || typeof out !== "object" || Array.isArray(out)) throw new Refused("that command cannot be read");
  // What was walked is not more than the time allows.
  if (typeof out.walked_m === "number") out.walked_m = Math.min(out.walked_m, (out.seconds ?? 5) * 10);
  if (typeof out.sprint_s === "number") out.sprint_s = Math.min(out.sprint_s, out.seconds ?? 5);
  // (And so with time in the water.)
  for (const k of ["swim_s", "swim_sprint_s", "tread_s"]) if (typeof out[k] === "number") out[k] = Math.min(out[k], out.seconds ?? 5);
  return out;
}

//: Where the player is, as the server holds it: the client's (x, z) if it is on the map and
//: within reach of where it was last seen; longitude, latitude and county are the server's own.
export function position(canon, srv, pid, at, realNow) {
  const last = srv.pos[pid] || null;
  if (!at || !Number.isFinite(at.x) || !Number.isFinite(at.z)) {
    if (!last) throw new Refused("the city does not know where you are", "position");
    const [lon, lat] = canon.lonLat(last.x, last.z);
    return { x: last.x, z: last.z, lon, lat, county: canon.county };
  }
  if (!canon.inBounds(at.x, at.z)) throw new Refused("that is outside the city", "bounds");
  const [lon, lat] = canon.lonLat(at.x, at.z);
  if (Number.isFinite(at.lon) && Number.isFinite(at.lat)) {
    const off = Math.hypot((at.lon - lon) * 88_000, (at.lat - lat) * 111_000);
    if (off > LIMITS.map_error_m) throw new Refused("this page's map is not the city's: reload it", "map");
  }
  if (last) {
    const moved = Math.hypot(at.x - last.x, at.z - last.z), seconds = Math.max(0, (realNow - last.t) / 1000);
    if (moved > LIMITS.speed_mps * seconds + LIMITS.slack_m) throw new Refused("you cannot have got there that fast", "movement");
  }
  return { x: at.x, z: at.z, lon, lat, county: canon.county };
}

//: Too many commands too quickly is not a player.
export function rate(srv, pid, realNow) {
  const [most, windowMs] = LIMITS.rate;
  const r = srv.rate[pid];
  if (!r || realNow - r.t > windowMs) { srv.rate[pid] = { t: realNow, n: 1 }; return; }
  r.n += 1;
  if (r.n > most) throw new Refused("slow down", "rate");
}

//: What a command needs beyond its shape (after the places in it are canonical).
export function eligible(world, canon, srv, pid, command, args, here) {
  if (SERVER_ONLY.has(command)) throw new Refused("that is not a player's to ask");
  if (command === "join" && args.home) {
    if (Math.hypot(args.home.x - here.x, args.home.z - here.z) > LIMITS.join_home_m) delete args.home;
    else if (args.home.use !== "residential") delete args.home;
  }
  if (command === "pick_up" && args.found) {
    // A found thing is one of today's seeded ones (its id says which; each is picked up once in
    // the whole world), or a crash's debris, of which a player takes only so many a day.
    const day = world.time.day, max = world.R.found.per_district;
    const m = /^found:[^:]{0,80}:(\d+):(\d+)$/.exec(String(args.found.id || ""));
    const seeded = m && Number(m[1]) === day && Number(m[2]) < max;
    if (!seeded) {
      const f = srv.found[pid];
      if (!f || f.day !== day) srv.found[pid] = { day, n: 1 };
      else if ((f.n += 1) > LIMITS.debris_a_day) throw new Refused("nothing more lies here today");
    }
    if (Math.hypot(args.found.x - here.x, args.found.z - here.z) > 6) throw new Refused("too far to reach");
  }
  return args;
}
