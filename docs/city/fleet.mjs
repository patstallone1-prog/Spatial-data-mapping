// Everyone and every vehicle in a district, kept: nobody and nothing is made up where you look.
//
// The district's people were dealt again whenever the detail round the walker was built again
// (every window had its own thousand), and the traffic was trips started out of nowhere in each
// 400 m square each half minute, so cars appeared, and people vanished, as you walked
// (2026-11-08). Here each home has its residents, made once from the building and kept for the
// region; each resident who drives has their car, parked on the street outside or in the garage
// under the house; and the through traffic is a fleet of visitors' cars that come in from the
// edge of the streets and go out again. Where each is at any moment follows from their day (the
// same seeded day the people had before): a car is where its last trip ended, or on the way, and
// the trips of the day say how it got there (``history``). Pure, as people.mjs is
// (tests/city.test.mjs).

import {
  CLOTHES, INDOOR_REACH_M, SPEED_MS, TRAFFIC_BY_HOUR, alongRoute, daySchedule, densityAt, distToSegment, hash32, indoorSpot, rng,
  workplacesByRole,
} from "./people.mjs";

const pick = (r, list) => list[Math.floor(r() * list.length) % list.length];
const FIRST = ["Alex", "Sam", "Maria", "Wei", "Priya", "Jordan", "Luis", "Mei", "Ana", "Omar", "Grace", "Diego", "Hana", "Noah",
  "Fatima", "Kenji", "Rosa", "Theo", "Aisha", "Marco", "Lena", "Jamal", "Sofia", "Ravi", "Elena", "Kai", "Nadia", "Ivan", "Lucy", "Tomas",
  "Chloe", "Mateo", "Zoe", "Arjun", "Isla", "Felix", "Yuki", "Amara", "Owen", "Leila"];
const LAST = ["Nguyen", "Garcia", "Chen", "Patel", "Kim", "Lopez", "Wong", "Smith", "Singh", "Martinez", "Lee", "Johnson", "Ramirez",
  "Tran", "Brown", "Wu", "Hernandez", "Davis", "Liu", "Flores", "Park", "Silva", "Cohen", "Okafor", "Rossi", "Murphy", "Yamamoto",
  "Novak", "Haddad", "Reyes", "Ali", "Berg"];
//: What residents drive, by share (approx. the Bay Area's registrations by body type).
export const PRIVATE_MIX = [["economy", 0.3], ["sedan", 0.24], ["suv", 0.2], ["compact_ev", 0.14], ["pickup", 0.07], ["delivery_van", 0.05]];
//: The district's through traffic, by who drives it (approx.: ride-hail alone was some 15% of
//: the trips within San Francisco in the county transportation authority's "TNCs Today", 2017;
//: delivery vans and the rest of the through traffic make up the others).
//: ``trips``: how many times a day each comes through; ``stop``: the share of trips that stop at a
//: shop, and for how long (minutes); a stop of an hour or more is parked and walked about.
export const VISITOR_KINDS = [
  { kind: "ride_hail", title: "Ride-hail driver", share: 0.3, trips: [10, 18], stop: [0.6, 1, 3], models: [["sedan", 0.35], ["compact_ev", 0.3], ["suv", 0.2], ["economy", 0.15]] },
  { kind: "taxi", title: "Taxi driver", share: 0.05, trips: [10, 16], stop: [0.5, 1, 3], models: [["taxi", 1]] },
  { kind: "delivery", title: "Delivery driver", share: 0.15, trips: [8, 14], stop: [0.8, 3, 8], models: [["delivery_van", 0.75], ["box_truck", 0.1], ["pickup", 0.15]] },
  { kind: "private", title: "Visitor", share: 0.5, trips: null, stop: null, models: [["economy", 0.3], ["sedan", 0.25], ["suv", 0.2], ["compact_ev", 0.14], ["pickup", 0.06], ["delivery_van", 0.05]] },
];
export const ROLE_VEHICLE = { police: "patrol", taxi_driver: "taxi", delivery_driver: "delivery_van", street_cleaner: "box_truck" };
const KERB = (half) => Math.max(1.7, half - 1.8);
const DRIVE_MIN_M = 700;
const DRIVE_MS = 9.5;
//: The time a trip of ``metres`` as the crow flies takes (minutes): streets wind about a third
//: further. Kept to the crow's distance, not the route's, so a trip takes the same time whether
//: or not its streets have been worked out (a route is found only for a trip near someone).
//: How far a walker comes out of a door before turning onto the pavement (m).
export const DOOR_STEP_M = 1.6;
export const tripMinutes = (metres, speed) => (metres * 1.32 / speed + 20) / 60;

export function plateOf(id) {
  let h = 0; for (const c of id) h = (h * 33 + c.charCodeAt(0)) >>> 0;
  const L = "ABCDEFGHJKLMNPRSTUVWXYZ";
  return `${1 + (h % 9)}${L[(h >>> 4) % L.length]}${L[(h >>> 9) % L.length]}${L[(h >>> 14) % L.length]}${String((h >>> 3) % 1000).padStart(3, "0")}`;
}
function mixPick(r, mix) {
  const roll = r();
  let acc = 0;
  for (const [id, share] of mix) { acc += share; if (roll <= acc) return id; }
  return mix[0][0];
}
//: How many live in a home: a house one household; a block of flats by its floor area.
export function residentsIn(R, home) {
  const single = (R.housing?.single_family_tags || []).includes(home.tag);
  const units = single ? 1 : Math.max(1, Math.round((home.area || 80) * (home.floors || 1) * 0.82 / 90));
  return Math.max(1, Math.min(10, single ? 2 + (hash32(home.id) % 2) : Math.round(units * 0.75)));
}

// ---- the roster: who lives here, and what they drive ------------------------------------------------

export class Roster {
  constructor(R, { seed = "district", saved = null, toLonLat = null } = {}) {
    this.R = R; this.seed = seed; this.toLonLat = toLonLat;
    this.places = new Map(); this.people = new Map(); this.vehicles = new Map(); this.visitors = new Map();
    this.homesDone = new Set(); this.list = []; this.work = {};
    this.saved = { work: { ...(saved?.work || {}) } };
    this.version = 0; this.dirty = false;
  }
  //: Places seen in a window: those new are kept, each new home with its residents; and those
  //: who had nowhere to work yet are given a job where one now is.
  add(places) {
    let added = 0;
    for (const pl of places) {
      const had = this.places.get(pl.id);
      if (had) { had.node = pl.node; had.front ??= pl.front; had.ring ??= pl.ring; had.inside ??= pl.inside; continue; }
      this.places.set(pl.id, pl); added += 1;
    }
    if (!added) return 0;
    this.list = [...this.places.values()];
    this.work = workplacesByRole(this.R, this.list);
    for (const pl of places) if (pl.use === "residential" && !this.homesDone.has(pl.id)) { this.homesDone.add(pl.id); this.house(pl); }
    for (const p of this.people.values()) if (p.needsWork) this.employ(p);
    this.version += 1;
    return added;
  }
  house(home) {
    const R = this.R, roles = Object.entries(R.jobs.roles), total = roles.reduce((s, [, x]) => s + x.share, 0);
    const outgoing = this.toLonLat ? densityAt(R, ...this.toLonLat(home.x, home.z), "walkers") : 1;
    const n = residentsIn(R, home);
    for (let k = 0; k < n; k += 1) {
      const id = `npc:${home.id}:${k}`, r = rng(id, "person");
      let x = r() * total, role = roles[0][0];
      for (const [rid, spec] of roles) { x -= spec.share; if (x <= 0) { role = rid; break; } }
      const spec = R.jobs.roles[role];
      const pace = R.routine.walk_speed_ms[0] + r() * (R.routine.walk_speed_ms[1] - R.routine.walk_speed_ms[0]);
      const p = { id, name: `${pick(r, FIRST)} ${pick(r, LAST)}`, role, title: spec.title, uniform: spec.uniform || pick(r, CLOTHES),
        home: home.id, work: null, needsWork: true, shift: Math.floor(r() * Math.max(1, spec.shifts.length)), pace, outgoing,
        drives: r() < R.routine.drive_share || Boolean(ROLE_VEHICLE[role]), height: 1.58 + r() * 0.3, outdoor: spec.outdoor || null,
        age: role === "student" ? 8 + Math.floor(r() * 10) : 20 + Math.floor(r() * 50) };
      this.people.set(id, p);
      this.employ(p);
      if (p.drives) {
        const model = ROLE_VEHICLE[role] || mixPick(rng(id, "car"), PRIVATE_MIX);
        const single = (R.housing?.single_family_tags || []).includes(home.tag);
        const garage = rng(id, "garage")() < (single ? 0.6 : (home.floors || 1) >= 4 ? 0.45 : 0.15);
        this.vehicles.set(`veh:${id}`, { id: `veh:${id}`, owner: id, model, shade: rng(id, "paint")(), plate: plateOf(id), home: home.id, garage });
        p.car = `veh:${id}`;
      }
    }
  }
  //: A job at a real place that does the work: the nearer of three, kept once given (and kept
  //: on this device, so a reload finds them at the same work).
  employ(p) {
    const spec = this.R.jobs.roles[p.role];
    if (spec.at.includes("home")) { p.work = p.home; p.needsWork = false; return; }
    const saved = this.saved.work[p.id];
    if (saved) { if (this.places.has(saved)) { p.work = saved; p.needsWork = false; } return; }
    const list = this.work[p.role] || [];
    if (!list.length) return;
    const home = this.places.get(p.home), r = rng(p.id, "work");
    // Within a walk or a short drive of home where there is such a place (the district may be
    // pieces far apart: a jump across the map).
    const near = list.filter((c) => Math.hypot(c.x - home.x, c.z - home.z) < 1500);
    const pool = near.length ? near : list;
    let best = null, bestD = Infinity;
    for (let k = 0; k < 3; k += 1) {
      const c = pool[Math.floor(r() * pool.length) % pool.length];
      const d = Math.hypot(c.x - home.x, c.z - home.z);
      if (d < bestD) { bestD = d; best = c; }
    }
    p.work = best.id; p.needsWork = false;
    this.saved.work[p.id] = best.id; this.dirty = true;
  }
  //: The visitors' cars: the district's through traffic and its shoppers, each with its driver,
  //: and only ever more of them as more of the district is seen.
  visitorsUpTo(n) {
    for (let k = this.visitors.size; k < n; k += 1) {
      const id = `visitor:${k}`, r = rng(this.seed, id);
      // Who drives through: ride-hail and taxi drivers on fares all day, delivery drivers on their
      // rounds, and people coming to the shops or passing on their way (rules.json density.visitor_kinds).
      const kind = mixPick(r, VISITOR_KINDS.map((x) => [x.kind, x.share]));
      const spec = VISITOR_KINDS.find((x) => x.kind === kind);
      this.visitors.set(id, { id, name: `${pick(r, FIRST)} ${pick(r, LAST)}`, role: "visitor", kind, title: spec.title, uniform: pick(r, CLOTHES),
        pace: 1.1 + r() * 0.4, height: 1.56 + r() * 0.34, visitor: true, car: `veh:${id}` });
      this.vehicles.set(`veh:${id}`, { id: `veh:${id}`, owner: id, model: mixPick(r, spec.models), shade: r(), plate: plateOf(id), visitor: true, kind });
    }
  }
  //: What to keep on this device: who works where.
  toJSON() { return { work: this.saved.work }; }
}

// ---- the city: where each is, and how they got there ---------------------------------------------

const segAt = (segs, minute) => {
  let lo = 0, hi = segs.length - 1, at = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (segs[m].t0 <= minute) { at = m; lo = m + 1; } else hi = m - 1; }
  return at >= 0 && minute < segs[at].t1 ? segs[at] : null;
};
const hhmm = (min) => { const m = ((Math.round(min) % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; };

export class City {
  //: ``harm(id, ms)``: the books' word on someone hurt or something broken ({state, ...}), or null.
  constructor(R, roster, streets, { seed = "district", timeAt, harm = () => null, delay = () => 0 } = {}) {
    this.R = R; this.roster = roster; this.seed = seed; this.timeAt = timeAt; this.harm = harm; this.delay = delay;
    this.setStreets(streets);
  }
  //: The key a car's trip is known by (its delay in traffic is kept under it).
  static legKey(v, leg, day) { return `${v.id}:${day}:${Math.round(leg.t0 * 60)}`; }
  //: Someone's day made again (a car of theirs crashed, or they were hurt).
  forget(id) { for (const k of this.plans.keys()) if (k.startsWith(`${id}:`)) this.plans.delete(k); }
  //: A new street graph (more of the district seen): the places' street points again, and every
  //: way and spot worked out again on it. Who is where does not change; only the streets they
  //: take there might.
  setStreets(streets) {
    this.streets = streets;
    for (const pl of this.roster.places.values()) pl.node = streets.nearest(pl.x, pl.z, "walk", 120) ?? pl.node;
    this.plans = new Map(); this.spots = new Map(); this.roams = new Map(); this._gateways = null; this.homeSlots = null;
  }
  //: Where cars come into the district and leave it: the ends of its streets at the edge of
  //: what has been seen, for each network of streets that hangs together (``byNetwork``).
  get gateways() {
    if (this._gateways) return this._gateways;
    const s = this.streets, nets = new Map();
    for (let i = 0; i < s.nodes.length; i += 1) {
      if (!s.nodes[i].drive || !s.comp || s.comp[i] < 0) continue;
      const c = s.comp[i];
      if (!nets.has(c)) nets.set(c, []);
      nets.get(c).push(i);
    }
    this.byNetwork = new Map();
    for (const [c, ids] of nets) {
      if (ids.length < 30) continue;
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const i of ids) { const n = s.nodes[i]; x0 = Math.min(x0, n.x); x1 = Math.max(x1, n.x); z0 = Math.min(z0, n.z); z1 = Math.max(z1, n.z); }
      const edgeD = (n) => Math.min(n.x - x0, x1 - n.x, n.z - z0, z1 - n.z);
      let g = ids.filter((i) => edgeD(s.nodes[i]) < 70 && s.edges[i].filter((e) => e.drive).length <= 2);
      if (g.length < 8) g = [...ids].sort((a, b) => edgeD(s.nodes[a]) - edgeD(s.nodes[b])).slice(0, 24);
      this.byNetwork.set(c, { gates: g.sort((a, b) => hash32(this.seed, a) - hash32(this.seed, b)), size: ids.length, box: [x0, z0, x1, z1] });
    }
    this._gateways = [...this.byNetwork.values()].flatMap((n) => n.gates);
    return this._gateways;
  }
  //: The network of streets a node is on (-1: none).
  netOf(node) { return node === null || node === undefined || !this.streets.comp ? -1 : this.streets.comp[node]; }
  //: Where on the street a car stands at a place: along one of the street ways from the place's
  //: nearest corner, so many metres on, at the kerb -- each car its own spot, a home's cars
  //: one behind another. In the garage when it has one at home.
  spotOf(vehicle, placeId) {
    const key = `${vehicle.id}:${placeId}`;
    let spot = this.spots.get(key);
    if (spot) return spot;
    const s = this.streets, place = typeof placeId === "number" ? null : this.roster.places.get(placeId);
    const nodeId = typeof placeId === "number" ? placeId : place ? s.nearest(place.x, place.z, "kerb", 200) : null;
    if (nodeId === null || nodeId === undefined) return null;
    const garage = Boolean(place && vehicle.garage && placeId === vehicle.home);
    const edges = s.edges[nodeId].filter((e) => e.drive).sort((a, b) => a.to - b.to);
    const n = s.nodes[nodeId];
    if (garage || !edges.length || typeof placeId === "number") {
      const door = place?.front ? { x: place.front.x, z: place.front.z } : place ? { x: place.x, z: place.z } : { x: n.x, z: n.z };
      spot = { garage, gateway: typeof placeId === "number", node: nodeId, x: garage ? door.x : n.x, z: garage ? door.z : n.z, yaw: 0, door, place: placeId };
    } else {
      const slot = placeId === vehicle.home ? this.homeSlot(vehicle) : hash32(vehicle.id, placeId) % 9;
      const e = edges[slot % edges.length], k = Math.floor(slot / edges.length);
      const b = s.nodes[e.to], len = e.length || 1, ux = (b.x - n.x) / len, uz = (b.z - n.z) / len;
      const room = Math.max(1, len - 10), along = 5 + ((k * 6.4) % room);
      const cx = n.x + ux * along, cz = n.z + uz * along, off = KERB(e.half || 3);
      spot = { garage: false, node: nodeId, edge: e, along, cx, cz, x: cx - uz * off, z: cz + ux * off, yaw: Math.atan2(-ux, -uz), place: placeId, street: e.name || null };
    }
    this.spots.set(key, spot);
    return spot;
  }
  //: A home's cars on the street one behind another: this one's place in the queue.
  homeSlot(vehicle) {
    if (!this.homeSlots) {
      this.homeSlots = new Map();
      const byHome = new Map();
      for (const v of this.roster.vehicles.values()) if (v.home && !v.garage) { if (!byHome.has(v.home)) byHome.set(v.home, []); byHome.get(v.home).push(v.id); }
      for (const list of byHome.values()) list.sort().forEach((id, i) => this.homeSlots.set(id, i));
    }
    return this.homeSlots.get(vehicle.id) ?? 0;
  }
  //: A car's way from one spot to another: out of the spot along the street it stands on, on
  //: by the streets, and into the other -- so it leaves from where it was parked and parks
  //: where it is next seen standing.
  legRoute(leg) {
    if (leg.route !== undefined) return leg.route;
    const s = this.streets, v = this.roster.vehicles.get(leg.vehicle);
    const a = this.spotOf(v, leg.from), b = this.spotOf(v, leg.to);
    if (!a || !b) { leg.route = null; return null; }
    const pts = [], halves = [], classes = [], ids = [];
    const push = (x, z, half, cls, id = -1) => { pts.push([x, z]); halves.push(half); classes.push(cls); ids.push(id); };
    let start = a.node;
    // Streets that do not hang together (two pieces of the district): no way between that is
    // seen; the car goes out of sight between them.
    if (this.netOf(a.node) !== this.netOf(b.node)) { leg.route = null; return null; }
    if (a.garage || a.gateway) push(a.door.x, a.door.z, 3, "service");
    else { push(a.cx, a.cz, a.edge.half, a.edge.cls); start = a.edge.to; }
    const mid = s.route(start, b.node, "drive");
    if (mid) for (let i = 0; i < mid.pts.length; i += 1) push(mid.pts[i][0], mid.pts[i][1], mid.halves[i] ?? mid.halves[i - 1] ?? 3, mid.classes[i] ?? mid.classes[i - 1] ?? "residential", mid.ids?.[i] ?? -1);
    else { const n = s.nodes[b.node]; push(n.x, n.z, 3, "residential", b.node); }
    if (b.garage || b.gateway) push(b.door.x, b.door.z, 3, "service");
    else push(b.cx, b.cz, b.edge.half, b.edge.cls);
    const S = [0];
    for (let i = 1; i < pts.length; i += 1) S.push(S[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    leg.route = { pts, s: S, halves, classes, ids, length: S[S.length - 1], mode: "drive" };
    return leg.route;
  }
  // -- days --------------------------------------------------------------------------------------
  //: A resident's day as what they are doing and where they are going, minute by minute: their
  //: day (people.mjs daySchedule) with the journeys between, on foot or by car. The car goes
  //: only from where it stands (left at work, it is walked back to), and is always home by night.
  planOf(p, t) {
    const key = `${p.id}:${t.day}`;
    let plan = this.plans.get(key);
    if (plan) return plan;
    plan = p.visitor ? this.visitorPlan(p, t) : this.residentPlan(p, t);
    if (this.plans.size > 120000) this.plans.delete(this.plans.keys().next().value);
    this.plans.set(key, plan);
    return plan;
  }
  residentPlan(p, t) {
    const R = this.R, places = this.roster.places, segs = [];
    const sched = daySchedule(R, p, t.day, t.weekday, this.roster.list);
    const v = p.car ? this.roster.vehicles.get(p.car) : null;
    const dayStart = t.ms - t.minute * 60_000;
    const carFree = (minute) => { const h = v && this.harm(v.id, dayStart + minute * 60_000); return v && !(h && h.out); };
    const dist = (a, b) => { const A = places.get(a), B = places.get(b); return A && B ? Math.hypot(A.x - B.x, A.z - B.z) : 0; };
    // The car where the night left it: at work for a night shift driven to, else at home.
    const startAt = v ? (sched[0]?.kind === "work" && sched[0].start === 0 && dist(p.home, p.work) > DRIVE_MIN_M ? p.work : p.home) : null;
    let carAt = startAt, clock = 0;
    const go = (from, to, depart, mode) => {
      const m = dist(from, to), dur = tripMinutes(m, mode === "drive" ? DRIVE_MS : p.pace);
      const seg = { kind: "go", t0: depart, t1: depart + dur, from, to, mode, vehicle: mode === "drive" ? v.id : null };
      segs.push(seg); clock = seg.t1;
      if (mode === "drive") carAt = to;
      return seg;
    };
    let prev = null;
    for (const a of sched) {
      if (prev && prev.place !== a.place && places.has(prev.place) && places.has(a.place)) {
        const depart = Math.max(prev.end, clock), far = dist(prev.place, a.place) > DRIVE_MIN_M;
        if (v && carAt === prev.place && far && carFree(depart)) go(prev.place, a.place, depart, "drive");
        else if (v && a.place === p.home && carAt !== p.home && carAt !== null && carFree(depart)) {
          // Home by way of the car, wherever it was left.
          if (carAt !== prev.place) go(prev.place, carAt, depart, "walk");
          go(carAt, p.home, clock, "drive");
        } else go(prev.place, a.place, depart, "walk");
      }
      const t0 = Math.max(a.start, clock);
      if (a.end > t0) {
        const roam = a.kind === "stroll" || (a.kind === "work" && a.outdoor);
        segs.push({ kind: roam ? "roam" : "stay", t0, t1: a.end, place: a.place, act: a, drive: roam && a.kind !== "stroll" && p.drives && !/route|site/.test(a.outdoor || "") && carAt === a.place });
        clock = a.end;
      }
      prev = a;
    }
    segs.sort((x, y) => x.t0 - y.t0);
    return { segs, drives: segs.filter((s) => s.mode === "drive" || (s.kind === "roam" && s.drive)), start: startAt };
  }
  //: A visitor's day: through trips from one edge of the district to another, and now and then a
  //: stop -- parked near a shop, an hour or so about the shops on foot, and away again.
  visitorPlan(p, t) {
    const segs = [];
    if (!this.gateways.length) return { segs, drives: [], start: null };
    const r = rng(this.seed, p.id, t.day), v = this.roster.vehicles.get(p.car);
    // A network of the district's streets, the bigger the likelier: its edges and its shops.
    const nets = [...this.byNetwork.entries()], total = nets.reduce((a, [, n]) => a + n.size, 0);
    let x = r() * total, net = nets[0];
    for (const e of nets) { x -= e[1].size; if (x <= 0) { net = e; break; } }
    const G = net[1].gates, box = net[1].box;
    const places = this.roster.list.filter((pl) => (pl.shops?.length || pl.use === "office" || pl.use === "restaurant")
      && pl.x >= box[0] && pl.x <= box[2] && pl.z >= box[1] && pl.z <= box[3] && this.netOf(this.streets.nearest(pl.x, pl.z, "kerb", 200)) === net[0]);
    const hourPick = () => { const total = TRAFFIC_BY_HOUR.reduce((s, x) => s + x, 0); let x = r() * total; for (let h = 0; h < 24; h += 1) { x -= TRAFFIC_BY_HOUR[h]; if (x <= 0) return h; } return 12; };
    const trips = [];
    // Through traffic is most of a district's traffic: a visitor's car comes through a few
    // times a day (rules.json density.visitor_trips), now and then stopping.
    const K = VISITOR_KINDS.find((x) => x.kind === p.kind) || VISITOR_KINDS[3];
    const [lo, hi] = K.trips || this.R.density?.visitor_trips || [3, 6];
    const n = lo + Math.floor(r() * (hi - lo + 1));
    const [share, d0, d1] = K.stop || [this.R.density?.visitor_visit_share ?? 0.3, 30, 140];
    for (let k = 0; k < n; k += 1) trips.push({ at: hourPick() * 60 + r() * 60, visit: places.length && r() < share ? pick(r, places).id : null, g1: G[Math.floor(r() * G.length)], g2: G[Math.floor(r() * G.length)], dwell: d0 + r() * (d1 - d0), brief: Boolean(K.stop) });
    trips.sort((a, b) => a.at - b.at);
    const node = (id) => this.streets.nodes[id];
    let clock = 0;
    for (const trip of trips) {
      const depart = Math.max(trip.at, clock + 5);
      if (depart > 1430) break;
      const A = node(trip.g1);
      if (trip.visit && trip.brief) {
        // A fare picked up or dropped, a parcel handed over: a few minutes at the kerb.
        const P = this.roster.places.get(trip.visit);
        if (!P || !this.spotOf(v, trip.visit)) continue;
        const d1 = tripMinutes(Math.hypot(P.x - A.x, P.z - A.z), DRIVE_MS);
        segs.push({ kind: "go", mode: "drive", t0: depart, t1: depart + d1, from: trip.g1, to: trip.visit, vehicle: v.id, visitor: true });
        const B = node(trip.g2), d2 = tripMinutes(Math.hypot(P.x - B.x, P.z - B.z), DRIVE_MS), back = depart + d1 + trip.dwell;
        segs.push({ kind: "go", mode: "drive", t0: back, t1: back + d2, from: trip.visit, to: trip.g2, vehicle: v.id, visitor: true });
        clock = back + d2;
      } else if (trip.visit) {
        const P = this.roster.places.get(trip.visit), spot = this.spotOf(v, trip.visit);
        if (!P || !spot) continue;
        const d1 = tripMinutes(Math.hypot(P.x - A.x, P.z - A.z), DRIVE_MS);
        segs.push({ kind: "go", mode: "drive", t0: depart, t1: depart + d1, from: trip.g1, to: trip.visit, vehicle: v.id, visitor: true });
        const w = tripMinutes(Math.hypot(spot.x - P.x, spot.z - P.z), p.pace) + 0.5;
        segs.push({ kind: "go", mode: "walk", t0: depart + d1, t1: depart + d1 + w, fromXZ: [spot.x, spot.z], to: trip.visit, visitor: true });
        segs.push({ kind: "roam", t0: depart + d1 + w, t1: depart + d1 + w + trip.dwell, place: trip.visit, act: { kind: "stroll", start: depart + d1 + w }, visitor: true });
        const back = depart + d1 + w + trip.dwell;
        segs.push({ kind: "go", mode: "walk", t0: back, t1: back + w, from: trip.visit, toXZ: [spot.x, spot.z], visitor: true });
        const B = node(trip.g2), d2 = tripMinutes(Math.hypot(P.x - B.x, P.z - B.z), DRIVE_MS);
        segs.push({ kind: "go", mode: "drive", t0: back + w, t1: back + w + d2, from: trip.visit, to: trip.g2, vehicle: v.id, visitor: true });
        clock = back + w + d2;
      } else {
        const B = node(trip.g2 === trip.g1 ? G[(G.indexOf(trip.g1) + 1) % G.length] : trip.g2);
        const d = tripMinutes(Math.hypot(B.x - A.x, B.z - A.z), DRIVE_MS);
        if (d < 1) continue;
        segs.push({ kind: "go", mode: "drive", t0: depart, t1: depart + d, from: trip.g1, to: trip.g2 === trip.g1 ? G[(G.indexOf(trip.g1) + 1) % G.length] : trip.g2, vehicle: v.id, visitor: true });
        clock = depart + d;
      }
    }
    return { segs, drives: segs.filter((s) => s.mode === "drive"), start: null, visitor: true };
  }
  // -- where they are ----------------------------------------------------------------------------
  //: Someone out of doors at ``t``: where, which way they face, and what they are about; null
  //: indoors (or in a car, or not in the district).
  personAt(p, t, seg = segAt(this.planOf(p, t).segs, t.minute), focus = null) {
    const h = this.harm(p.id, t.ms);
    if (h?.down) return { x: h.at.x, z: h.at.z, yaw: h.at.yaw || 0, moving: false, mode: "walk", down: true, activity: h.label || "hurt" };
    if (h?.out) return null;
    if (!seg) return null;
    const places = this.roster.places;
    if (seg.kind === "go") {
      if (seg.mode === "drive") return null;
      const route = this.walkRoute(seg);
      if (!route) return null;
      const f = (t.minute - seg.t0) / (seg.t1 - seg.t0);
      const side = hash32(p.id) % 2 ? 1 : -1;
      const pos = this.walkEnds(route, f * route.length, (half) => (half ? half + 1.6 : 0) * side,
        this.anchor(seg.from, seg.fromXZ), this.anchor(seg.to, seg.toXZ), 8, f);
      return { ...pos, moving: true, mode: "walk", activity: seg.visitor ? (seg.toXZ ? "back to the car" : "from the car") : `to ${this.nextKind(p, t, seg)}` };
    }
    const place = places.get(seg.place);
    if (!place) return null;
    if (seg.kind === "roam") return this.roaming(p, seg, place, t);
    const a = seg.act;
    if (a.kind === "break" && a.outside) {
      // Out of the door for a break: on the pavement in front of it (door and front point in).
      const r = rng(p.id, t.day, "break"), D = place.door || place.front;
      const at = D ? { x: D.x - D.nx * (DOOR_STEP_M + 0.6 + r() * 1.2) + D.nz * (r() - 0.5) * 3, z: D.z - D.nz * (DOOR_STEP_M + 0.6 + r() * 1.2) - D.nx * (r() - 0.5) * 3 } : this.anchor(seg.place, null, { door: false });
      if (!at) return null;
      return { x: at.x, z: at.z, yaw: r() * 6.28, moving: false, mode: "walk", activity: "on a break" };
    }
    if (place.inside && focus && Math.hypot(place.x - focus.x, place.z - focus.z) < INDOOR_REACH_M) return indoorSpot(p, a, place, t);
    return null;
  }
  nextKind(p, t, seg) {
    const segs = this.planOf(p, t).segs, i = segs.indexOf(seg);
    for (let k = i + 1; k < segs.length; k += 1) if (segs[k].kind !== "go") return segs[k].act?.kind || "the next thing";
    return "home";
  }
  //: Where a walk begins and ends by a place: the pavement corner on its side of the street node
  //: (or the car's kerb spot), so one walk ends where the next begins and nobody changes pavement
  //: in a step.
  //: A building with a door (place.door: the walker's own doors where the page has them, else the
  //: middle of the wall facing the street; n points in) is left and entered through it: the walk
  //: begins on its threshold, steps out along the door's line to the pavement, and ends the same
  //: way in. The walls are not walked through.
  anchor(id, xz, { door = true } = {}) {
    if (xz) return { x: xz[0], z: xz[1] };
    const P = this.roster.places.get(id);
    if (P?.door) {
      const D = P.door, step = { x: D.x - D.nx * DOOR_STEP_M, z: D.z - D.nz * DOOR_STEP_M };
      return door ? { ...step, door: { x: D.x + D.nx * 0.3, z: D.z + D.nz * 0.3 } } : step;
    }
    const n = P && this.streets.nodes[P.node];
    if (!n) return null;
    const dx = P.x - n.x, dz = P.z - n.z, L = Math.hypot(dx, dz);
    return L < 0.1 ? { x: n.x, z: n.z } : { x: n.x + (dx / L) * Math.min(L, 4.5), z: n.z + (dz / L) * Math.min(L, 4.5) };
  }
  //: The point along a walk: through the door over its first (and last) DOOR_STEP_M, then drawn
  //: in from the anchors to the pavement over the next few metres. ``through``: in the doorway.
  walkEnds(route, d, side, a0, a1, reach = 8, f = null) {
    const L = route.length;
    // A walk with next to no street in it (the car is parked at the same corner): straight from
    // one end to the other over its time.
    if (L < 1 && a0 && a1 && f !== null) {
      const u = Math.max(0, Math.min(1, f));
      return { x: a0.x + (a1.x - a0.x) * u, z: a0.z + (a1.z - a0.z) * u, yaw: Math.atan2(-(a1.x - a0.x), -(a1.z - a0.z)), half: 0 };
    }
    const gone = (a) => (a?.door ? Math.min(DOOR_STEP_M, L / 2) : 0);
    const g0 = gone(a0), g1 = gone(a1);
    const doorway = (a, s, g, out) => {
      const u = g > 0 ? Math.max(0, Math.min(1, s / g)) : 1, from = out ? a.door : a, to = out ? a : a.door;
      const k = out ? u : 1 - u;
      return { x: a.door.x + (a.x - a.door.x) * k, z: a.door.z + (a.z - a.door.z) * k, yaw: Math.atan2(-(to.x - from.x), -(to.z - from.z)), half: 0, through: true };
    };
    if (g0 && d < g0) return doorway(a0, d, g0, true);
    if (g1 && L - d < g1) return doorway(a1, L - d, g1, false);
    const pos = alongRoute(route, d, side);
    const pull = (a, u) => { if (!a || u >= 1) return; const w = u * u * (3 - 2 * u); pos.x = a.x + (pos.x - a.x) * w; pos.z = a.z + (pos.z - a.z) * w; };
    const r = Math.min(reach, Math.max(0.1, (L - g0 - g1) / 2));
    pull(a0, (d - g0) / r); pull(a1, (L - g1 - d) / r);
    return pos;
  }
  walkRoute(seg) {
    if (seg.route !== undefined) return seg.route;
    const s = this.streets, P = this.roster.places;
    const end = (id, xz) => xz ? s.nearest(xz[0], xz[1], "walk", 120) : P.get(id)?.node;
    const a = end(seg.from, seg.fromXZ), b = end(seg.to, seg.toXZ);
    const route = a === null || a === undefined || b === null || b === undefined ? null : a === b ? { pts: [[s.nodes[a].x, s.nodes[a].z]], s: [0], halves: [0], classes: [null], length: 0 } : s.route(a, b, "walk");
    seg.route = route;
    return route;
  }
  //: Out of doors at work or for a walk: out and back along the streets near the place, a new
  //: way every twelve minutes (a patrol car, a delivery round, a letter carrier's route, a stroll).
  roaming(p, seg, place, t) {
    const leg = Math.floor((t.minute - seg.t0) / 12);
    const key = `${p.id}:${t.day}:${Math.round(seg.t0)}:${leg}`;
    let r0 = this.roams.get(key);
    if (r0 === undefined) {
      const r = rng(p.id, t.day, seg.act.kind, leg), drive = seg.drive, mode = drive ? "drive" : "walk";
      const from = drive ? this.streets.nearest(place.x, place.z, "kerb", 200) : place.node;
      let to = null;
      for (let k = 0; k < 6 && to === null; k += 1) {
        const ang = r() * Math.PI * 2, dist = (drive ? 500 : 180) * (0.4 + r());
        to = this.streets.nearest(place.x + Math.cos(ang) * dist, place.z + Math.sin(ang) * dist, drive ? "kerb" : "walk", 120);
        if (drive && to !== null && this.netOf(to) !== this.netOf(from)) to = null;
      }
      const route = this.streets.route(from, to, mode);
      r0 = route && route.length >= 5 ? { route, drive } : null;
      if (this.roams.size > 8000) this.roams.delete(this.roams.keys().next().value);
      this.roams.set(key, r0);
    }
    if (!r0) return null;
    const { route, drive } = r0;
    const speed = drive ? (seg.act.outdoor === "sweep" ? 2.2 : 8) : p.pace * (seg.act.kind === "stroll" ? 0.8 : 1);
    // Whole out-and-backs in the twelve minutes (or what is left of the stay), so each way ends
    // where the next begins, at the place: a walker never jumps from one round to the next.
    const span = Math.max(0.05, Math.min(12, seg.t1 - seg.t0 - leg * 12)) * 60, L = route.length;
    let turns = Math.max(1, Math.round((span * speed) / (2 * L))), far = L, pace = (turns * 2 * L) / span;
    if (pace > speed * 1.5) { turns = 1; far = (span * speed) / 2; pace = speed; }
    const into = Math.min(span, (t.minute - seg.t0 - leg * 12) * 60) * pace;
    const d = into % (2 * far), forward = d <= far;
    const along = forward ? d : 2 * far - d;
    // Turning back, a car crosses to the other lane over the last few metres either side of the
    // turn, not in one step.
    // (A walker keeps to the same pavement: the offset is to the right of the way, not of travel.)
    const turn = Math.min(1, Math.min(along, far - along) / 10), k = drive ? (forward ? 1 : -1) * turn : 1;
    const home = drive ? null : this.anchor(seg.place, null, { door: false });
    const pos = drive ? alongRoute(route, along, (half) => k * KERB(half)) : this.walkEnds(route, along, (half) => half + 1.6, home, null);
    if (!forward) pos.yaw += Math.PI;
    return { ...pos, moving: true, mode: drive ? "drive" : "walk", speed: pace, activity: seg.act.kind === "stroll" ? (p.visitor ? "about the shops" : "out for a walk") : `${this.R.jobs.roles[p.role]?.title.toLowerCase() || "at work"} at work` };
  }
  //: Where a car is at ``t``: on its way (and how far along), or standing where its last trip
  //: ended -- on the street, in a garage, or away beyond the district's streets.
  vehicleAt(v, t) {
    const h = this.harm(v.id, t.ms);
    if (h?.at && h.stays) return { state: h.state, x: h.at.x, z: h.at.z, yaw: h.at.yaw || 0, moving: false, harm: h };
    if (h?.out) return { state: "repair", hidden: true, harm: h };
    const owner = v.visitor ? this.roster.visitors.get(v.owner) : this.roster.people.get(v.owner);
    if (!owner) return null;
    const plan = this.planOf(owner, t), m = t.minute;
    let last = null;
    for (const s of plan.drives) {
      // How far behind its day the car has fallen in traffic (minutes), seen driven.
      const lag = s.kind === "go" ? this.delay(v, s, t.day) : 0;
      if (s.t0 <= m && m < s.t1 + lag) {
        if (s.kind === "roam") {
          const pos = this.personAt(owner, t, s);
          return pos ? { state: "driving", leg: s, ...pos, moving: true, roam: true } : { state: "driving", hidden: true };
        }
        return { state: "driving", leg: s, f: Math.min(1, (m - lag - s.t0) / (s.t1 - s.t0)), moving: true, lag };
      }
      if (s.t1 + lag <= m && s.kind === "go") last = s;
    }
    const where = last ? last.to : plan.start;
    if (where === null || where === undefined) return { state: "away", hidden: true, last };
    const spot = this.spotOf(v, where);
    if (!spot) return { state: "away", hidden: true };
    if (spot.gateway) return { state: "away", hidden: true, last };
    if (spot.garage) return { state: "garage", hidden: true, spot };
    return { state: "parked", x: spot.x, z: spot.z, yaw: spot.yaw, moving: false, spot };
  }
  //: Where along its leg a car is at fraction ``f`` of it, in its lane.
  onLeg(leg, d) {
    const route = this.legRoute(leg);
    if (!route) return null;
    return { ...alongRoute(route, Math.max(0, Math.min(route.length, d)), (half) => KERB(half)), route };
  }
  //: Everyone and everything that might be in sight of ``focus`` in the next while: the full
  //: pass, a few times a second at most. Indoors, away, in a garage: not listed.
  scan(ms, focus, reach, parkedReach = 180) {
    this.scanBegin(ms, focus, reach, parkedReach);
    return this.scanMore(Infinity);
  }
  //: The same pass a slice at a time (``budget`` people and cars a call), so a frame is not
  //: held up by the whole district at once: null until the pass is done.
  scanBegin(ms, focus, reach, parkedReach = 180) {
    this._scan = { t: this.timeAt(ms), focus: { x: focus.x, z: focus.z }, reach, parkedReach, people: [], vehicles: [],
      P: [...this.roster.people.values(), ...this.roster.visitors.values()], V: [...this.roster.vehicles.values()], i: 0, j: 0 };
  }
  scanMore(budget = 2500) {
    const S = this._scan;
    if (!S) return null;
    const { t, focus, reach, parkedReach, people, vehicles } = S;
    const near = (x, z, extra = 0) => Math.abs(x - focus.x) < reach + extra && Math.abs(z - focus.z) < reach + extra;
    const P = this.roster.places;
    let n = 0;
    for (; S.i < S.P.length && n < budget; S.i += 1, n += 1) {
      const p = S.P[S.i];
      const plan = this.planOf(p, t), seg = segAt(plan.segs, t.minute);
      const h = this.harm(p.id, t.ms);
      if (h?.down) { if (near(h.at.x, h.at.z)) people.push({ p, seg: null }); continue; }
      if (!seg || h?.out) continue;
      if (seg.kind === "go") {
        if (seg.mode === "drive") continue;
        const A = seg.fromXZ ? { x: seg.fromXZ[0], z: seg.fromXZ[1] } : P.get(seg.from), B = seg.toXZ ? { x: seg.toXZ[0], z: seg.toXZ[1] } : P.get(seg.to);
        if (A && B && distToSegment(focus.x, focus.z, A.x, A.z, B.x, B.z) < reach + 60) people.push({ p, seg });
        continue;
      }
      const pl = P.get(seg.place);
      if (!pl) continue;
      if (seg.kind === "roam") { if (!seg.drive && near(pl.x, pl.z, 350)) people.push({ p, seg }); continue; }
      if ((seg.act.kind === "break" && seg.act.outside && near(pl.x, pl.z)) || (pl.inside && Math.hypot(pl.x - focus.x, pl.z - focus.z) < INDOOR_REACH_M)) people.push({ p, seg });
    }
    for (; S.j < S.V.length && n < budget; S.j += 1, n += 1) {
      const v = S.V[S.j], s = this.vehicleAt(v, t);
      if (!s || s.hidden) continue;
      if (s.state === "driving") {
        if (s.roam) { if (near(s.x, s.z, 120)) vehicles.push({ v, s }); continue; }
        const leg = s.leg, P0 = this.endOf(v, leg.from), P1 = this.endOf(v, leg.to);
        if (P0 && P1 && distToSegment(focus.x, focus.z, P0.x, P0.z, P1.x, P1.z) < reach + 250) vehicles.push({ v, s });
      } else if (Math.abs(s.x - focus.x) < parkedReach && Math.abs(s.z - focus.z) < parkedReach) vehicles.push({ v, s });
    }
    if (S.i < S.P.length || S.j < S.V.length) return null;
    this._scan = null;
    return { time: t, people, vehicles };
  }
  endOf(v, where) { const spot = this.spotOf(v, where); return spot ? { x: spot.x, z: spot.z } : null; }
  // -- the record -------------------------------------------------------------------------------
  //: How someone or something came to be where it is today: each thing done and each journey,
  //: up to ``t``, as lines a person reads.
  history(id, t) {
    const R = this.roster, out = [];
    const name = (where, v = null) => {
      if (typeof where === "number") { const n = this.streets.nodes[where]; return `the edge of the district${n ? ` (${this.streetNear(where) || "a street"})` : ""}`; }
      const pl = R.places.get(where);
      const label = pl ? (pl.name || (pl.shops?.length ? pl.shops[0] : pl.use)) : "somewhere";
      if (v && where === v.home) return v.garage ? `the garage at home (${label})` : `the kerb outside home${this.spotOf(v, where)?.street ? ` on ${this.spotOf(v, where).street}` : ""}`;
      return label;
    };
    const v = R.vehicles.get(id);
    if (v) {
      const owner = v.visitor ? R.visitors.get(v.owner) : R.people.get(v.owner);
      const plan = owner ? this.planOf(owner, t) : null;
      out.push(`${v.plate}: ${owner?.name || "?"}'s ${String(v.model).replace("_", " ")}${v.visitor ? ", a visitor's" : ""}.`);
      if (plan?.start !== null && plan?.start !== undefined) out.push(`00:00 at ${name(plan.start, v)}.`);
      else if (v.visitor) out.push("00:00 away, beyond the district's streets.");
      for (const s of plan?.drives || []) {
        if (s.t0 > t.minute) break;
        if (s.kind === "roam") { out.push(`${hhmm(s.t0)} out on ${owner.title.toLowerCase()} rounds${s.t1 <= t.minute ? `, back ${hhmm(s.t1)}` : ""}.`); continue; }
        const km = (this.legRoute(s)?.length || 0) / 1000;
        out.push(`${hhmm(s.t0)} ${owner?.name.split(" ")[0] || "The driver"} drove from ${name(s.from, v)} to ${name(s.to, v)}${km ? ` (${km.toFixed(1)} km)` : ""}${s.t1 <= t.minute ? `, there ${hhmm(s.t1)}` : ", on the way now"}.`);
      }
      return out;
    }
    const p = R.people.get(id) || R.visitors.get(id);
    if (!p) return out;
    const plan = this.planOf(p, t);
    out.push(`${p.name}, ${p.visitor ? "visiting" : `${p.age}, ${p.title.toLowerCase()}`}${p.home ? `; lives at ${name(p.home)}` : ""}${p.work && p.work !== p.home ? `; works at ${name(p.work)}` : ""}.`);
    for (const s of plan.segs) {
      if (s.t0 > t.minute) break;
      if (s.kind === "go") out.push(`${hhmm(s.t0)} ${s.mode === "drive" ? "drove" : "walked"} from ${s.fromXZ ? "the car" : name(s.from)} to ${s.toXZ ? "the car" : name(s.to)}.`);
      else out.push(`${hhmm(s.t0)} ${s.act.kind === "sleep" ? "asleep at" : s.act.kind === "work" ? "at work at" : s.act.kind === "roam" || s.kind === "roam" ? "out and about near" : `${s.act.kind} at`} ${name(s.place)}.`);
    }
    return out;
  }
  streetNear(nodeId) { return this.streets.edges[nodeId]?.find((e) => e.name)?.name || null; }
}

// ---- driving by the rules ------------------------------------------------------------------------
//
// The cars near you are driven, not just placed: each at the limit for its street, stopping at a
// stop sign and going on, stopping for a red light, keeping its distance behind the car ahead, and
// braking for anyone in its way -- you, or someone crossing. A car that cannot stop in time hits
// what is in its way: ``step`` says so, at what speed. How far behind its day a car falls by all
// that (``delay``) it keeps when it goes out of sight, so it does not jump.

export const TRAFFIC = { accel: 2.2, brake: 3.2, emergency: 8.5, reaction_s: 0.6, gap_m: 2.5, headway_s: 1.2, look_m: 45,
  stop_line_m: 5, stop_sign_s: 1.4, signal_cycle_s: 60, green_s: 26, amber_s: 4, person_half_m: 0.35 };
//: The light a car approaching ``node`` from ``bearing`` sees at ``tsec``: "green", "amber", "red".
export function signalAt(streets, node, bearing, tsec, T = TRAFFIC) {
  const e0 = streets.edges[node].find((e) => e.cls === "arterial") || streets.edges[node][0];
  const n = streets.nodes[node], m = streets.nodes[e0.to];
  const ref = Math.atan2(m.x - n.x, m.z - n.z);
  let a = Math.abs(((bearing - ref) % Math.PI + Math.PI) % Math.PI);
  const axis = a < Math.PI / 4 || a > (3 * Math.PI) / 4 ? 0 : 1;
  const phase = (tsec + (hash32("signal", node) % T.signal_cycle_s)) % T.signal_cycle_s;
  const half = T.signal_cycle_s / 2, local = axis === 0 ? phase : (phase + half) % T.signal_cycle_s;
  return local < T.green_s ? "green" : local < T.green_s + T.amber_s ? "amber" : "red";
}
//: What kind of junction a node is: "signal" where an arterial meets (three ways or more),
//: "stop" at other junctions, null along a street.
export function junctionAt(streets, node) {
  if (node < 0) return null;
  const es = streets.edges[node];
  if (!es) return null;
  const others = new Set(es.filter((e) => e.drive || streets.edges[e.to]?.some((r) => r.to === node && r.drive)).map((e) => e.to));
  if (others.size < 3) return null;
  return es.some((e) => e.cls === "arterial" || e.cls === "freeway") ? "signal" : "stop";
}

export class Drivers {
  constructor(streets, T = TRAFFIC) { this.streets = streets; this.T = T; this.cars = new Map(); this.delays = new Map(); }
  //: One frame for the cars in sight. ``cars``: {id, key (the leg), route, sched (the distance
  //: its day has it at, by time: (tsec) => metres, and back: (metres) => tsec), limit (m/s),
  //: length, width}. ``people``: {id, x, z} -- you among them. Returns each car's distance
  //: along, speed, and any hits.
  step(dt, tsec, cars, people, blockers = []) {
    const T = this.T, out = [], hits = [], seen = new Set();
    const live = [];
    for (const c of cars) {
      seen.add(c.id);
      let st = this.cars.get(c.id);
      if (!st || st.key !== c.key) {
        const delay = this.delays.get(c.key) ?? 0;
        const d = Math.max(0, Math.min(c.route.length, c.sched(tsec - delay)));
        const lim = c.limitAt ? c.limitAt(alongRoute(c.route, d).cls) : c.limit;
        st = { key: c.key, d, v: Math.min(lim, c.cruise ?? lim), stopped: new Set(), waitUntil: 0, hit: null };
        this.cars.set(c.id, st);
      }
      live.push([c, st]);
    }
    // Where each is now, for the cars behind.
    const pos = new Map();
    // In its lane, as it is drawn: the kerb side of the street.
    for (const [c, st] of live) pos.set(c.id, { ...alongRoute(c.route, st.d, KERB), c });
    for (const [c, st] of live) {
      if (st.hit && !(st.hit.until > 0 && tsec > st.hit.until)) { out.push({ id: c.id, d: st.d, v: 0, hit: st.hit }); continue; }
      if (st.hit) st.hit = null;
      const here = pos.get(c.id), fx = -Math.sin(here.yaw), fz = -Math.cos(here.yaw);
      const limit = c.limitAt ? c.limitAt(here.cls) : c.limit;
      let target = Math.min(limit, c.cruise ?? limit), reason = null;
      // Junctions ahead on the way.
      const { s, ids } = c.route;
      for (let i = 1; i < s.length; i += 1) {
        const ahead = s[i] - st.d;
        if (ahead < -1) continue;
        if (ahead > T.look_m) break;
        const kind = junctionAt(this.streets, ids?.[i] ?? -1);
        if (!kind || i === s.length - 1) continue;
        const toLine = ahead - T.stop_line_m;
        if (kind === "stop") {
          if (st.stopped.has(ids[i])) continue;
          if (toLine < 0.8 && st.v < 0.4) { if (!st.waitUntil) st.waitUntil = tsec + T.stop_sign_s; if (tsec >= st.waitUntil) { st.stopped.add(ids[i]); st.waitUntil = 0; continue; } }
          const v = Math.sqrt(2 * T.brake * Math.max(0, toLine));
          if (v < target) { target = v; reason = "stop sign"; }
          break;
        }
        const [ax, az] = c.route.pts[i - 1], [bx, bz] = c.route.pts[i];
        const light = signalAt(this.streets, ids[i], Math.atan2(bx - ax, bz - az), tsec, T);
        if (light === "green" || toLine < -0.5) continue;
        const stopping = st.v * st.v / (2 * T.brake);
        if (light === "amber" && stopping > toLine + 1) continue;   // too close to stop: through on amber
        const v = Math.sqrt(2 * T.brake * Math.max(0, toLine));
        if (v < target) { target = v; reason = `${light} light`; }
        break;
      }
      // The car ahead.
      for (const [o, ost] of live) {
        if (o.id === c.id) continue;
        const op = pos.get(o.id), dx = op.x - here.x, dz = op.z - here.z;
        const fwd = dx * fx + dz * fz, lat = Math.abs(dx * fz - dz * fx);
        if (fwd <= 0 || fwd > T.look_m || lat > 1.9) continue;
        if (Math.cos(op.yaw - here.yaw) < 0.4) continue;
        const gap = fwd - (c.length + o.length) / 2 - T.gap_m;
        const v = Math.max(0, Math.min(ost.v + gap / T.headway_s, Math.sqrt(2 * T.brake * Math.max(0, gap)) + ost.v));
        if (v < target) { target = v; reason = "the car ahead"; }
      }
      // Your car (or anything else in the road that is not one of these): kept behind.
      for (const o of blockers) {
        const dx = o.x - here.x, dz = o.z - here.z;
        const fwd = dx * fx + dz * fz, lat = Math.abs(dx * fz - dz * fx);
        if (fwd <= 0 || fwd > T.look_m || lat > 1.9) continue;
        const gap = fwd - (c.length + (o.length || 4.5)) / 2 - T.gap_m, ov = Math.max(0, o.v || 0);
        const v = Math.max(0, Math.min(ov + gap / T.headway_s, Math.sqrt(2 * T.brake * Math.max(0, gap)) + ov));
        if (v < target) { target = v; reason = "the car ahead"; }
      }
      // Anyone in the way: brake for them, hard if need be; a car that cannot stop in time hits.
      let danger = null;
      for (const q of people) {
        const dx = q.x - here.x, dz = q.z - here.z;
        const fwd = dx * fx + dz * fz, lat = Math.abs(dx * fz - dz * fx);
        if (fwd < -c.length / 2 || lat > c.width / 2 + T.person_half_m + 0.25) continue;
        const gap = fwd - c.length / 2 - T.person_half_m;
        if (gap > st.v * T.reaction_s + st.v * st.v / (2 * T.brake) + 6) continue;
        if (!danger || gap < danger.gap) danger = { q, gap };
      }
      let decel = T.brake;
      if (danger) {
        const room = Math.max(0.05, danger.gap - 0.6);
        const need = st.v * st.v / (2 * room);
        target = 0; reason = danger.q.player ? "you" : "someone in the road";
        decel = Math.min(T.emergency, Math.max(T.brake, need));
        // Between the city's own people the law holds: a walker who steps out looks first and a
        // driver who is too close stops dead, so nobody is run down unless you are in it --
        // on foot where the cars are, or in a car yourself (view.mjs hitInTraffic).
        if (danger.gap <= 0.15 && st.v > 0.6 && !danger.q.player) {
          st.v = 0;
          out.push({ id: c.id, d: st.d, v: 0, reason, braking: true });
          continue;
        }
        if (danger.gap <= 0.15 && st.v > 0.6) {
          st.hit = { who: danger.q.id, speed: st.v, x: here.x, z: here.z, yaw: here.yaw, until: tsec + 9 };
          hits.push({ car: c.id, ...st.hit, player: Boolean(danger.q.player) });
          st.v = 0;
          out.push({ id: c.id, d: st.d, v: 0, hit: st.hit, reason });
          continue;
        }
      }
      if (st.v > target) st.v = Math.max(target, st.v - decel * dt);
      else st.v = Math.min(target, st.v + T.accel * dt);
      st.d = Math.min(c.route.length, st.d + st.v * dt);
      const delay = tsec - c.unsched(st.d);
      this.delays.set(c.key, delay);
      out.push({ id: c.id, d: st.d, v: st.v, reason, braking: st.v < target - 0.01 || decel > T.brake });
    }
    // Gone from sight: their state goes, their delay is kept (a few thousand at most).
    for (const id of this.cars.keys()) if (!seen.has(id)) this.cars.delete(id);
    if (this.delays.size > 5000) this.delays.delete(this.delays.keys().next().value);
    return { cars: out, hits };
  }
  //: A car stopped where it is (a crash): it goes no further on this leg.
  stop(id, hit) { const st = this.cars.get(id); if (st) { st.hit = hit; st.v = 0; } }
  //: A car's distance along its leg and its speed, while it is driven here.
  stateOf(id) { return this.cars.get(id) || null; }
  delayOf(key) { return this.delays.get(key) ?? 0; }
}

// ---- hurt and broken -------------------------------------------------------------------------------

//: What the books' record of harm (world.mjs harmed) means at ``ms``: someone down where they
//: fell, in hospital or at home mending (``out``: off the street); a car standing broken where it
//: stopped until the tow (``stays``), then in the body shop (``out``).
export function harmNow(h, ms) {
  if (!h) return null;
  if (h.kind === "vehicle") {
    if (h.tow_at && ms < h.tow_at) return { stays: true, state: h.state, at: h.at, condition: h.condition, label: h.state };
    if (h.out_until && ms < h.out_until) return { out: true, state: "repair", condition: h.condition };
    return h.condition < 100 ? { condition: h.condition, state: h.state } : null;
  }
  if (h.down_until && ms < h.down_until) return { down: true, at: h.at, label: h.injuries?.at(-1)?.type || "hurt" };
  if (h.out_until && ms < h.out_until) return { out: true, state: ms < (h.hospital_until || 0) ? "hospital" : "recovering" };
  return null;
}

//: An injury by how hard someone is hit (an impact at ``speed`` m/s, a car on someone on foot;
//: or a blow of so many joules): its kind, how bad (1 slight to 5 critical), the health it
//: takes, and how long it keeps them off the street. From R.harm.injuries.
export function injuryFor(R, { speed = 0, joules = 0, seed = "" } = {}) {
  const H = R.harm;
  const table = speed > 0 ? H.pedestrian : H.blow;
  const x = speed > 0 ? speed : joules;
  let band = table[0];
  for (const b of table) if (x >= b.over) band = b;
  const r = rng("injury", seed, Math.round(x * 10));
  const type = band.types[Math.floor(r() * band.types.length) % band.types.length];
  const health = Math.round(band.health[0] + r() * (band.health[1] - band.health[0]));
  return { type, severity: band.severity, health, hospital_h: band.hospital_h, recover_h: band.recover_h, bill: band.bill };
}
//: What an impact at ``speed`` m/s does to a car: the share of its condition it takes, and the
//: state it leaves it in.
export function vehicleDamage(R, condition, speed) {
  const V = R.harm.vehicle;
  const loss = Math.min(100, Math.max(0, speed - V.scratch_under_ms) * V.loss_per_ms);
  const left = Math.max(0, Math.round(condition - loss));
  return { loss: Math.round(loss), condition: left, state: vehicleState(R, left) };
}
export function vehicleState(R, condition) {
  const V = R.harm.vehicle;
  return condition >= V.fine_at ? "fine" : condition >= V.dented_at ? "dented" : condition >= V.broken_at ? "broken" : "wrecked";
}
export { SPEED_MS };
