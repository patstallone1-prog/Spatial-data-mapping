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

import { VEHICLE_DIMS } from "./vehicles.mjs";
import {
  CLOTHES, INDOOR_REACH_M, SPEED_MS, TRAFFIC_BY_HOUR, alongRoute, daySchedule, densityAt, distToSegment, hash32, indoorSpot, rng,
  DRIVE_LANE, LANE, PAVE_M, chooseLane, laneCount, laneOffset, lanePlan, pavementRoute, turnAhead, workplacesByRole,
} from "./people.mjs";

const pick = (r, list) => list[Math.floor(r() * list.length) % list.length];
const FIRST = ["Alex", "Sam", "Maria", "Wei", "Priya", "Jordan", "Luis", "Mei", "Ana", "Omar", "Grace", "Diego", "Hana", "Noah",
  "Fatima", "Kenji", "Rosa", "Theo", "Aisha", "Marco", "Lena", "Jamal", "Sofia", "Ravi", "Elena", "Kai", "Nadia", "Ivan", "Lucy", "Tomas",
  "Chloe", "Mateo", "Zoe", "Arjun", "Isla", "Felix", "Yuki", "Amara", "Owen", "Leila"];
const LAST = ["Nguyen", "Garcia", "Chen", "Patel", "Kim", "Lopez", "Wong", "Smith", "Singh", "Martinez", "Lee", "Johnson", "Ramirez",
  "Tran", "Brown", "Wu", "Hernandez", "Davis", "Liu", "Flores", "Park", "Silva", "Cohen", "Okafor", "Rossi", "Murphy", "Yamamoto",
  "Novak", "Haddad", "Reyes", "Ali", "Berg"];
//: What residents drive, by share (approx. the Bay Area's registrations by body type).
export const PRIVATE_MIX = [["economy", 0.3], ["sedan", 0.22], ["suv", 0.2], ["compact_ev", 0.14], ["pickup", 0.07], ["delivery_van", 0.05], ["sports", 0.02]];
//: The district's through traffic, by who drives it (approx.: ride-hail alone was some 15% of
//: the trips within San Francisco in the county transportation authority's "TNCs Today", 2017;
//: delivery vans and the rest of the through traffic make up the others).
//: ``trips``: how many times a day each comes through; ``stop``: the share of trips that stop at a
//: shop, and for how long (minutes); a stop of an hour or more is parked and walked about.
export const VISITOR_KINDS = [
  { kind: "ride_hail", title: "Ride-hail driver", share: 0.3, trips: [10, 18], stop: [0.6, 1, 3], models: [["sedan", 0.35], ["compact_ev", 0.3], ["suv", 0.2], ["economy", 0.15]] },
  { kind: "taxi", title: "Taxi driver", share: 0.05, trips: [10, 16], stop: [0.5, 1, 3], models: [["taxi", 1]] },
  { kind: "delivery", title: "Delivery driver", share: 0.15, trips: [8, 14], stop: [0.8, 3, 8], models: [["delivery_van", 0.75], ["box_truck", 0.1], ["pickup", 0.15]] },
  { kind: "private", title: "Visitor", share: 0.5, trips: null, stop: null, models: [["economy", 0.3], ["sedan", 0.23], ["suv", 0.2], ["compact_ev", 0.14], ["pickup", 0.06], ["delivery_van", 0.05], ["sports", 0.02]] },
];
export const ROLE_VEHICLE = { police: "patrol", taxi_driver: "taxi", delivery_driver: "delivery_van", street_cleaner: "box_truck" };
//: A car's lane: right of the street's middle, clear of the cars parked at its kerb, and the lane
//: for the turn ahead on a street of more than one each way (people.mjs DRIVE_LANE).
const KERB = DRIVE_LANE;
//: Parking at the kerb (kerbSpot): how a spot is looked for and how close in a car stands.
//: Two whiles at the kerb overlap: either held all day, or the same day and their times meet.
const overlaps = (a, b) => !a || !b || (a.day === b.day && a.t0 < b.t1 && b.t0 < a.t1);
//: Either side of a visit's while: the car pulling in and out (and a lagging driver).
const PARK_MARGIN_MIN = 3;
export const PARKING = { junction_clear_m: 6.1, step_m: 1.5, search_nodes: 9, max_tries: 160, visitor_choice: 10,
  kerb_gap_m: 0.15, kerb_reach_m: 2.5, gap_m: 0.8, need_kerb: true, max_walk_m: 160 };
//: Where a car stands without the drawn kerb: the street's half-width less half the car and a
//: hand's width (it stood 1.8 m in, a metre off the kerb, out in the lane).
const PARKED_OFF = (half, width) => Math.max(1.7, half - width / 2 - PARKING.kerb_gap_m);
//: Width and length of each model, as the page draws it (vehicles.mjs VEHICLE_DIMS).
const VEHICLE_W = Object.fromEntries(Object.entries(VEHICLE_DIMS).map(([k, d]) => [k, d[0]]));
const VEHICLE_L = Object.fromEntries(Object.entries(VEHICLE_DIMS).map(([k, d]) => [k, d[2]]));
const DRIVE_MIN_M = 700;
//: A round at work driven is a leg every so many minutes (roamDrive).
export const ROAM_SLOT_MIN = 4;
const DRIVE_MS = 9.5;
//: The time a trip of ``metres`` as the crow flies takes (minutes): streets wind about a third
//: further. Kept to the crow's distance, not the route's, so a trip takes the same time whether
//: or not its streets have been worked out (a route is found only for a trip near someone).
//: How far a walker comes out of a door before turning onto the pavement (m).
export const DOOR_STEP_M = 1.6;
//: Waiting at the kerb for a gap or the light: at most so long behind the day (s), then made up
//: at this much over the walker's pace.
export const WALK_LAG_MAX_S = 90, WALK_CATCH_UP = 0.3;
//: The longest a frame's slice of the district scan may run (ms).
export const SCAN_SLICE_MS = 10, SCAN_FIRST_SLICE_MS = 60;
//: Someone out on a break stands at least this far back from the kerb (m).
export const BREAK_KERB_M = 1.0;
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
  //: The district's bus lines (transit.mjs buildLines): residents without a car ride them.
  setLines(lines) {
    const had = this.lines?.length || 0;
    this.lines = lines || [];
    if (had !== this.lines.length) this.plans = new Map();
  }
  setStreets(streets) {
    this.streets = streets;
    streets.setPreferences?.(this.R.traffic);
    for (const pl of this.roster.places.values()) pl.node = streets.nearest(pl.x, pl.z, "walk", 120) ?? pl.node;
    this.plans = new Map(); this.spots = new Map(); this.taken = new Map(); this.roams = new Map(); this.walkLags = new Map(); this.breakSpots = new Map(); this._gateways = null; this.homeSlots = null;
  }
  //: The kerb as the world draws it (the page's): ``kerbAt(x, z)`` -> {x, z, nx, nz, ax, az}
  //: and ``kerbParking(x, z, ax, az, halfLen, kind)`` -> why a car may not stand there, or null.
  //: Set, every spot is found again against it.
  setKerbside(k) { this.kerbside = k || null; this.spots = new Map(); this.taken = new Map(); this.plans = new Map(); this.breakSpots?.clear(); }
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
    this.byNetwork = new Map(); this._netPlaces?.clear();
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
  //: A gate's street: its name, its class, and how much through traffic comes by it (a
  //: corridor's weight, an arterial's, or a side street's 1; rules.json traffic).
  gateInfo(g) {
    // Of the streets at it, the busiest.
    const T = this.R.traffic || {}, es = this.streets.edges[g].filter((e) => e.drive || e.name);
    let best = null;
    for (const e of es) {
      const corridor = (T.corridors || []).find((c) => c.name === e.name);
      const weight = corridor ? corridor.weight : e.cls === "arterial" || e.cls === "freeway" ? (T.arterial_gate_weight ?? 3) : 1;
      if (!best || weight > best.weight || (weight === best.weight && !best.name && e.name)) best = { name: e.name || null, cls: e.cls, weight };
    }
    return best || { name: null, cls: "residential", weight: 1 };
  }
  //: A gate drawn by its weight; or, for a corridor trip, the two ends of one corridor.
  pickGate(r, gates) {
    const w = gates.map((g) => this.gateInfo(g).weight), total = w.reduce((a, b) => a + b, 0);
    let x = r() * total;
    for (let i = 0; i < gates.length; i += 1) { x -= w[i]; if (x <= 0) return gates[i]; }
    return gates[gates.length - 1];
  }
  corridorTrip(r, gates) {
    const by = new Map();
    for (const g of gates) { const i = this.gateInfo(g); if (!i.name || i.weight <= 1) continue; if (!by.has(i.name)) by.set(i.name, { w: i.weight, gates: [] }); by.get(i.name).gates.push(g); }
    const list = [...by.values()].filter((c) => c.gates.length >= 2);
    if (!list.length) return null;
    let x = r() * list.reduce((a, c) => a + c.w, 0), c = list[0];
    for (const e of list) { x -= e.w; if (x <= 0) { c = e; break; } }
    // Its two ends farthest apart, one way or the other.
    const N = (g) => this.streets.nodes[g];
    let best = null;
    for (const a of c.gates) for (const b of c.gates) { const d = Math.hypot(N(a).x - N(b).x, N(a).z - N(b).z); if (!best || d > best.d) best = { a, b, d }; }
    return r() < 0.5 ? [best.a, best.b] : [best.b, best.a];
  }
  //: The network of streets a node is on (-1: none).
  netOf(node) { return node === null || node === undefined || !this.streets.comp ? -1 : this.streets.comp[node]; }
  //: Where on the street a car stands at a place: along one of the street ways from the place's
  //: nearest corner, so many metres on, at the kerb -- each car its own spot, a home's cars
  //: one behind another. In the garage when it has one at home.
  //: ``win`` ({day, t0, t1} in minutes of the day) is when a visiting car stands there: its
  //: spot is held for that while, so no other car is given it then.
  spotOf(vehicle, placeId, win = null) {
    const key = `${vehicle.id}:${placeId}`;
    let spot = this.spots.get(key);
    if (spot !== undefined) {
      if (spot && win && spot.held && !spot.garage) this.take(spot.x, spot.z, 0, 0, spot.halfLen, win);
      return spot;
    }
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
      spot = this.kerbSpot(vehicle, placeId, nodeId, win);
      this.spotStats = this.spotStats || { kerb: 0, garage: 0, none: 0, legacy: 0 };
      if (spot) this.spotStats.kerb += 1;
      else if (!this.kerbside) { spot = this.legacySpot(vehicle, placeId, nodeId, edges); this.spotStats.legacy += 1; }
      else if (place && placeId === vehicle.home) {
        // Nowhere legal on the street near home (the Marina is short of kerb): in the garage
        // under the house, as most Marina homes have one.
        const door = place.front ? { x: place.front.x, z: place.front.z } : { x: place.x, z: place.z };
        spot = { garage: true, gateway: false, node: nodeId, x: door.x, z: door.z, yaw: 0, door, place: placeId, full: true };
        this.spotStats.garage += 1;
      } else { this.spotStats.none += 1; this.spots.set(key, null); return null; }
    }
    this.spots.set(key, spot);
    return spot;
  }
  //: The old way (no legal spot found): along a street way from the corner, at the kerb.
  legacySpot(vehicle, placeId, nodeId, edges) {
    const s = this.streets, n = s.nodes[nodeId];
    const slot = placeId === vehicle.home ? this.homeSlot(vehicle) : hash32(vehicle.id, placeId) % 9;
    const e = edges[slot % edges.length], k = Math.floor(slot / edges.length);
    const b = s.nodes[e.to], len = e.length || 1, ux = (b.x - n.x) / len, uz = (b.z - n.z) / len;
    const room = Math.max(1, len - 10), along = 5 + ((k * 6.4) % room);
    const cx = n.x + ux * along, cz = n.z + uz * along, off = PARKED_OFF(e.half || 3, VEHICLE_W[vehicle.model] || 1.85);
    return { garage: false, node: nodeId, edge: e, along, cx, cz, x: cx - uz * off, z: cz + ux * off, yaw: Math.atan2(-ux, -uz), place: placeId, street: e.name || null };
  }
  //: A legal place at the kerb near a place, nearest the door first: on a side of the street
  //: that is parked on (SFMTA's block faces), clear of the junctions (California keeps 20 ft
  //: from a crosswalk), of driveways and of red, blue, yellow and white kerb (but for those it
  //: is for), and of the other cars' spots -- pulled in to the kerb as it is drawn, a hand's
  //: width off it, along the street.
  kerbSpot(vehicle, placeId, nodeId, win = null) {
    const s = this.streets, P = PARKING;
    const place = typeof placeId === "number" ? null : this.roster.places.get(placeId);
    const door = place?.front ? { x: place.front.x, z: place.front.z } : place ? { x: place.x, z: place.z } : s.nodes[nodeId];
    const width = VEHICLE_W[vehicle.model] || 1.85, halfLen = (VEHICLE_L[vehicle.model] || 4.6) / 2;
    const kind = vehicle.kind === "delivery" || ["delivery_van", "box_truck"].includes(vehicle.model) ? "delivery"
      : vehicle.cab || vehicle.kind === "ride_hail" || vehicle.kind === "taxi" ? "passenger" : null;
    // The streets round the place: its corner's, then the next corners'.
    const nodes = [nodeId], seen = new Set(nodes);
    for (let i = 0; i < nodes.length && nodes.length < P.search_nodes; i += 1)
      for (const e of s.edges[nodes[i]]) if (e.drive && !seen.has(e.to)) { seen.add(e.to); nodes.push(e.to); }
    const cands = [];
    // A corner further off costs more than its distance: the walk there goes round by the
    // streets, not across the block.
    const hop = new Map(nodes.map((id, i) => [id, i === 0 ? 0 : s.edges[nodeId].some((e) => e.to === id) ? 1 : 2]));
    for (const a of nodes) for (const e of s.edges[a]) {
      if (!e.drive || e.cls === "service" || e.cls === "freeway") continue;
      if (e.park === false || (e.park === null && e.cls !== "residential")) continue;
      const n = s.nodes[a], b = s.nodes[e.to], len = e.length || 1;
      // Clear of a corner by 20 ft from the cross street's kerb (its half-width from the line). A
      // driveway or a lane meeting the street is not a corner, nor is a bend in its line: there
      // a car may stand across the point.
      const streetsAt = (id) => s.edges[id].filter((x) => x.drive && x.cls !== "service");
      const cross = (id) => Math.min(8, Math.max(0, ...streetsAt(id).filter((x) => x.name !== e.name).map((x) => x.half || 3)));
      const corner = (id) => new Set(streetsAt(id).map((x) => x.to)).size >= 3 || new Set(streetsAt(id).map((x) => x.name).filter(Boolean)).size > 1;
      const lo = corner(a) ? P.junction_clear_m + cross(a) + halfLen : 0;
      const hi = len - (corner(e.to) ? P.junction_clear_m + cross(e.to) + halfLen : 0);
      if (hi < lo) continue;
      const ux = (b.x - n.x) / len, uz = (b.z - n.z) / len;
      for (let along = lo; along <= hi + 1e-6; along += P.step_m) {
        const cx = n.x + ux * along, cz = n.z + uz * along;
        const crow = Math.hypot(cx - door.x, cz - door.z);
        if (crow > P.max_walk_m) continue;
        cands.push({ a, e, along, cx, cz, ux, uz, d: crow * (1 + 0.6 * hop.get(a)) + (hash32(vehicle.id, a, Math.round(along)) % 100) / 100 });
      }
    }
    cands.sort((p, q) => p.d - q.d);
    // A home's cars keep their spots overnight: those are held, one car to a spot. A visitor's
    // stop is an hour or so: it is not held, but each visitor takes one of the few best legal
    // spots (by its plate), so they are not all in the one nearest the door.
    const resident = placeId === vehicle.home, hold = resident ? null : win;
    // A visit held for its while takes the nearest free spot; one not held (a cab's brief stop)
    // one of the few best by its plate.
    const pickOf = resident || win ? 0 : hash32(vehicle.id, placeId) % P.visitor_choice;
    let legal = 0;
    for (const c of cands.slice(0, P.max_tries)) {
      // The right side of the way of travel (rx, rz), the kerb as drawn there.
      const rx = -c.uz, rz = c.ux, half = c.e.half || 3;
      let x = c.cx + rx * PARKED_OFF(half, width), z = c.cz + rz * PARKED_OFF(half, width), ax = c.ux, az = c.uz;
      const px = c.cx + rx * Math.max(1, half - 1), pz = c.cz + rz * Math.max(1, half - 1);
      const k = this.kerbside?.kerbAt(px, pz, c.ux, c.uz);
      // This street's kerb on this side (not the cross street's round the corner), beside it.
      if (k && k.nx * rx + k.nz * rz > 0.5 && Math.abs((k.x - px) * c.ux + (k.z - pz) * c.uz) < 1 && Math.abs(Math.hypot(k.x - c.cx, k.z - c.cz) - half) < P.kerb_reach_m) {
        // Along the kerb, the way of travel; pulled in to it.
        const sgn = k.ax * c.ux + k.az * c.uz >= 0 ? 1 : -1;
        ax = k.ax * sgn; az = k.az * sgn;
        x = k.x - k.nx * (width / 2 + P.kerb_gap_m); z = k.z - k.nz * (width / 2 + P.kerb_gap_m);
        if (this.kerbside.kerbParking?.(k.x, k.z, ax, az, halfLen, kind)) continue;
      } else if (this.kerbside && P.need_kerb) continue;
      if (this.clashes(x, z, ax, az, halfLen, hold)) continue;
      if (legal++ < pickOf) continue;
      if (resident || win) this.take(x, z, ax, az, halfLen, hold);
      return { held: resident || Boolean(win), halfLen, garage: false, node: c.a, edge: c.e, along: c.along, cx: c.cx, cz: c.cz, x, z, yaw: Math.atan2(-ax, -az), place: placeId, street: c.e.name || null, kerb: Boolean(k) };
    }
    return null;
  }
  //: Spots already given out: none within a car's length (and a gap) along the same kerb -- a
  //: home's spot all day, a visit's while it is there (``win``; none: any held spot clashes).
  clashes(x, z, ax, az, halfLen, win = null) {
    for (let i = -1; i <= 1; i += 1) for (let j = -1; j <= 1; j += 1) {
      const cell = this.taken.get(`${Math.floor(x / 12) + i},${Math.floor(z / 12) + j}`);
      if (!cell) continue;
      for (const o of cell) {
        const dx = o.x - x, dz = o.z - z, along = Math.abs(dx * ax + dz * az), across = Math.abs(dx * az - dz * ax);
        if (across < 1.6 && along < halfLen + o.halfLen + PARKING.gap_m && overlaps(o.win, win)) return true;
      }
    }
    return false;
  }
  take(x, z, ax, az, halfLen, win = null) {
    const key = `${Math.floor(x / 12)},${Math.floor(z / 12)}`;
    if (!this.taken.has(key)) this.taken.set(key, []);
    const cell = this.taken.get(key);
    // A visiting car's old whiles (other days) let go: the cell keeps today's and the homes'.
    if (win && cell.length > 24) for (let i = cell.length - 1; i >= 0; i -= 1) if (cell[i].win && cell[i].win.day !== win.day) cell.splice(i, 1);
    cell.push({ x, z, halfLen, win: win ? { day: win.day, t0: win.t0 - PARK_MARGIN_MIN, t1: win.t1 + PARK_MARGIN_MIN } : null });
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
    const s = this.streets, v = leg.cab || this.roster.vehicles.get(leg.vehicle);
    const a = this.spotOf(v, leg.from), b = this.spotOf(v, leg.to);
    if (!a || !b) { leg.route = null; return null; }
    const pts = [], halves = [], classes = [], ids = [], parks = [];
    const push = (x, z, half, cls, id = -1, park = null) => { pts.push([x, z]); halves.push(half); classes.push(cls); ids.push(id); parks.push(park); };
    let start = a.node;
    // Streets that do not hang together (two pieces of the district): no way between that is
    // seen; the car goes out of sight between them.
    if (this.netOf(a.node) !== this.netOf(b.node)) { leg.route = null; return null; }
    // A spot with no street way beside it (a garage, the district's edge, or a place whose
    // nearest kerb has no drivable way once the streets were seen again): from its own point.
    if (a.garage || a.gateway || !a.edge) push(a.door?.x ?? a.x, a.door?.z ?? a.z, 3, "service");
    else { push(a.cx, a.cz, a.edge.half, a.edge.cls, -1, a.edge.park ?? null); start = a.edge.to; }
    const mid = s.route(start, b.node, "drive");
    if (mid) for (let i = 0; i < mid.pts.length; i += 1) push(mid.pts[i][0], mid.pts[i][1], mid.halves[i] ?? mid.halves[i - 1] ?? 3, mid.classes[i] ?? mid.classes[i - 1] ?? "residential", mid.ids?.[i] ?? -1, mid.parks?.[i] ?? mid.parks?.[i - 1] ?? null);
    else { const n = s.nodes[b.node]; push(n.x, n.z, 3, "residential", b.node); }
    if (b.garage || b.gateway || !b.edge) push(b.door?.x ?? b.x, b.door?.z ?? b.z, 3, "service");
    else push(b.cx, b.cz, b.edge.half, b.edge.cls, -1, b.edge.park ?? null);
    const S = [0];
    for (let i = 1; i < pts.length; i += 1) S.push(S[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    // Its spots at the kerb at each end: pulled out of and in to (view.mjs eases the car there).
    leg.route = { pts, s: S, halves, classes, parks, ids, length: S[S.length - 1], mode: "drive",
      startSpot: a.edge && !a.garage ? { x: a.x, z: a.z, yaw: a.yaw } : null, endSpot: b.edge && !b.garage ? { x: b.x, z: b.z, yaw: b.yaw } : null };
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
    // Too far to walk and no car to take: a taxi (some of the time), else the bus where a line
    // serves both ends, else on foot (rules.json transit_lines.npc).
    const N = R.transit_lines?.npc;
    const travel = (from, to, depart) => {
      if (N && dist(from, to) > N.far_m) {
        const r = rng(p.id, t.day, "ride", Math.round(depart));
        const cab = r() < N.taxi_share ? this.taxiTrip(p, from, to, depart, t) : null;
        const ride = cab || this.busTrip(p, from, to, depart, dayStart) || this.taxiTrip(p, from, to, depart, t);
        if (ride) { segs.push(...ride); clock = ride[ride.length - 1].t1; return; }
      }
      go(from, to, depart, "walk");
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
        } else travel(prev.place, a.place, depart);
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
    // The car left at work (or wherever it was driven, not home): its kerb spot held from when it
    // pulled in till it is driven off, so no other car is put in it meanwhile.
    if (v) {
      const drives = segs.filter((s) => s.kind === "go" && s.mode === "drive");
      const hold = (at, t0, t1) => { if (at !== p.home && at !== null && at !== undefined && t1 > t0) this.spotOf(v, at, { day: t.day, t0, t1 }); };
      let at = startAt, since = 0;
      for (const s of drives) { hold(at, since, s.t0); at = s.to; since = s.t1; }
      hold(at, since, 1440);
    }
    return { segs, drives: segs.filter((s) => s.mode === "drive" || (s.kind === "roam" && s.drive)), start: startAt };
  }
  //: A taxi from one place to another: out to the kerb, waiting there while the cab comes in from
  //: a few hundred metres off, the ride (in the cab, out of sight), and in at the other end while
  //: the cab drives away. The cab is the trip's own (``cab``), drawn from the legs it is on.
  taxiTrip(p, from, to, depart, t) {
    const P = this.roster.places, A = P.get(from), B = P.get(to), N = this.R.transit_lines.npc;
    if (!A || !B) return null;
    const id = `cab:${p.id}:${t.day}:${Math.round(depart * 10)}`;
    const cab = { id, model: "taxi", shade: 0, plate: plateOf(id), cab: true, owner: p.id };
    const pick = this.spotOf(cab, from), drop = this.spotOf(cab, to);
    if (!pick?.edge || !drop?.edge || this.netOf(pick.node) !== this.netOf(drop.node)) return null;
    const r = rng(id, "approach");
    const offNode = (X, at) => {
      for (let k = 0; k < 8; k += 1) {
        const ang = r() * Math.PI * 2;
        const n = this.streets.nearest(X.x + Math.cos(ang) * N.taxi_approach_m, X.z + Math.sin(ang) * N.taxi_approach_m, "kerb", 150);
        if (n !== null && n !== undefined && n !== at && this.netOf(n) === this.netOf(at)) return n;
      }
      return null;
    };
    const inFrom = offNode(A, pick.node), outTo = offNode(B, drop.node);
    if (inFrom === null || outTo === null) return null;
    // The rider waits on the pavement beside the cab's spot (a couple of metres back towards the
    // door), not in the road where the traffic would stop for them.
    const door = A.door || A, back = Math.hypot(door.x - pick.x, door.z - pick.z) || 1, step = Math.min(2.2, back * 0.5);
    const stand = [pick.x + ((door.x - pick.x) / back) * step, pick.z + ((door.z - pick.z) / back) * step];
    const walkOut = tripMinutes(Math.hypot(stand[0] - A.x, stand[1] - A.z), p.pace) + 0.3;
    const approach = tripMinutes(N.taxi_approach_m, DRIVE_MS);
    const board = depart + Math.max(walkOut + 0.5, approach);
    const ride = tripMinutes(Math.hypot(B.x - A.x, B.z - A.z), DRIVE_MS);
    const off = board + ride, walkIn = tripMinutes(Math.hypot(drop.x - B.x, drop.z - B.z), p.pace) + 0.3;
    const comeIn = { kind: "go", mode: "drive", t0: board - approach, t1: board, from: inFrom, to: from, vehicle: id, cab, taxi: true };
    const goAway = { kind: "go", mode: "drive", t0: off, t1: off + approach, from: to, to: outTo, vehicle: id, cab, taxi: true };
    return [
      { kind: "go", mode: "walk", t0: depart, t1: depart + walkOut, from, toXZ: stand, cabLegs: [comeIn], ride: "taxi" },
      { kind: "go", mode: "wait", t0: depart + walkOut, t1: board, at: stand, yaw: pick.yaw + Math.PI / 2, cabLegs: [comeIn], label: "waiting for a taxi" },
      { kind: "go", mode: "drive", t0: board, t1: off, from, to, vehicle: id, cab, taxi: true, rider: p.id },
      { kind: "go", mode: "walk", t0: off, t1: off + walkIn, fromXZ: [drop.x, drop.z], to, cabLegs: [goAway], ride: "taxi" },
    ];
  }
  //: The bus from near one place to near another, on a line that serves both: walked to the stop,
  //: waited at its pole for the next bus the timetable sends that way (transit.mjs: the same
  //: buses the page draws), aboard to the stop nearest the other end, and walked on from there.
  busTrip(p, from, to, depart, dayStart) {
    if (!this.lines?.length) return null;
    const P = this.roster.places, A = P.get(from), B = P.get(to), N = this.R.transit_lines.npc;
    if (!A || !B) return null;
    let best = null;
    for (const line of this.lines) {
      const near = (X) => { let k = -1, d = Infinity; line.stops.forEach((s, i) => { const e = Math.hypot(s.x - X.x, s.z - X.z); if (e < d) { d = e; k = i; } }); return d <= N.stop_reach_m ? { k, d } : null; };
      const a = near(A), b = near(B);
      if (!a || !b || a.k === b.k) continue;
      if (!best || a.d + b.d < best.walk) best = { line, a: a.k, b: b.k, walk: a.d + b.d };
    }
    if (!best) return null;
    const { line } = best, tl = line.timeline, C = line.cycle;
    // The dwell at the first stop that reaches the second soonest: the bus going the right way.
    let leg = null;
    tl.forEach((s, i) => {
      if (s.kind !== "dwell" || s.stop !== best.a) return;
      for (let k = 1; k < tl.length; k += 1) {
        const e = tl[(i + k) % tl.length];
        if (e.kind !== "dwell" || e.stop !== best.b) continue;
        const ride = ((e.t0 - s.t0) % C + C) % C;
        if (!leg || ride < leg.ride) leg = { at: s, off: e, ride };
        break;
      }
    });
    if (!leg) return null;
    const stopA = leg.at.pole, stopB = leg.off.pole;
    const walkA = tripMinutes(Math.hypot(stopA.x - A.x, stopA.z - A.z), p.pace) + 0.2;
    const atStop = dayStart / 1000 + (depart + walkA) * 60;
    // The next of the line's buses to stand at the stop (transit.mjs busesAt's phases).
    let arrive = Infinity;
    for (let j = 0; j < line.buses; j += 1) {
      const phase = ((atStop + j * C / line.buses) % C + C) % C;
      const wait = phase >= leg.at.t0 && phase < leg.at.t1 - 6 ? leg.at.t0 - phase : ((leg.at.t0 - phase) % C + C) % C;
      arrive = Math.min(arrive, atStop + wait);
    }
    if (!Number.isFinite(arrive) || arrive - atStop > 15 * 60) return null;
    const toMin = (sec) => (sec - dayStart / 1000) / 60;
    const board = toMin(arrive + Math.min(6, (leg.at.t1 - leg.at.t0) / 3));
    const off = toMin(arrive + leg.ride + 4);
    const walkB = tripMinutes(Math.hypot(B.x - stopB.x, B.z - stopB.z), p.pace) + 0.2;
    const r = rng(p.id, "stop", Math.round(depart));
    const spot = [stopA.x + (r() - 0.5) * 2.4, stopA.z + (r() - 0.5) * 2.4];
    return [
      { kind: "go", mode: "walk", t0: depart, t1: depart + walkA, from, toXZ: spot, ride: "bus" },
      { kind: "go", mode: "wait", t0: depart + walkA, t1: board, at: spot, yaw: r() * 6.28, label: `waiting for the ${line.route}`, route: line.route },
      { kind: "go", mode: "bus", t0: board, t1: off, from, to, route: line.route },
      { kind: "go", mode: "walk", t0: off, t1: off + walkB, fromXZ: [leg.off.at.x, leg.off.at.z], to, ride: "bus" },
    ];
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
    // (Worked out once a network, not once a visitor: the street search for every place, per
    // visitor's day, held a frame up for a second at a time while the district was scanned.)
    this._netPlaces ??= new Map();
    let places = this._netPlaces.get(net[0]);
    if (!places || this._netPlacesOf !== this.streets || this._netPlacesN !== this.roster.list.length) {
      if (this._netPlacesOf !== this.streets || this._netPlacesN !== this.roster.list.length) this._netPlaces.clear();
      this._netPlacesOf = this.streets; this._netPlacesN = this.roster.list.length;
      places = this.roster.list.filter((pl) => (pl.shops?.length || pl.use === "office" || pl.use === "restaurant")
        && pl.x >= box[0] && pl.x <= box[2] && pl.z >= box[1] && pl.z <= box[3] && this.netOf(this.streets.nearest(pl.x, pl.z, "kerb", 200)) === net[0]);
      this._netPlaces.set(net[0], places);
    }
    // When they drive: commuters in the rush hours, deliveries in the working day, ride-hail
    // into the evening, the rest as through traffic does (rules.json traffic.by_hour).
    const H = this.R.traffic?.by_hour || {};
    const curve = (p.kind === "ride_hail" || p.kind === "taxi" ? H.ride_hail : p.kind === "delivery" ? H.delivery : hash32(p.id, "commuter") % 5 < 2 ? H.commute : H.through) || TRAFFIC_BY_HOUR;
    const hourPick = () => { const total = curve.reduce((s, x) => s + x, 0); let x = r() * total; for (let h = 0; h < 24; h += 1) { x -= curve[h]; if (x <= 0) return h; } return 12; };
    const share = this.R.traffic?.corridor_share ?? 0;
    const ends = () => { const c = r() < share ? this.corridorTrip(r, G) : null; return c || [this.pickGate(r, G), this.pickGate(r, G)]; };
    const trips = [];
    // Through traffic is most of a district's traffic: a visitor's car comes through a few
    // times a day (rules.json density.visitor_trips), now and then stopping.
    const K = VISITOR_KINDS.find((x) => x.kind === p.kind) || VISITOR_KINDS[3];
    const [lo, hi] = K.trips || this.R.density?.visitor_trips || [3, 6];
    const n = lo + Math.floor(r() * (hi - lo + 1));
    const [stopShare, d0, d1] = K.stop || [this.R.density?.visitor_visit_share ?? 0.3, 30, 140];
    for (let k = 0; k < n; k += 1) { const [g1, g2] = ends(); trips.push({ at: hourPick() * 60 + r() * 60, visit: places.length && r() < stopShare ? pick(r, places).id : null, g1, g2, dwell: d0 + r() * (d1 - d0), brief: Boolean(K.stop) }); }
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
        const d1 = P ? tripMinutes(Math.hypot(P.x - A.x, P.z - A.z), DRIVE_MS) : 0;
        if (!P || !this.spotOf(v, trip.visit, { day: t.day, t0: depart + d1, t1: depart + d1 + trip.dwell })) continue;
        segs.push({ kind: "go", mode: "drive", t0: depart, t1: depart + d1, from: trip.g1, to: trip.visit, vehicle: v.id, visitor: true });
        const B = node(trip.g2), d2 = tripMinutes(Math.hypot(P.x - B.x, P.z - B.z), DRIVE_MS), back = depart + d1 + trip.dwell;
        segs.push({ kind: "go", mode: "drive", t0: back, t1: back + d2, from: trip.visit, to: trip.g2, vehicle: v.id, visitor: true });
        clock = back + d2;
      } else if (trip.visit) {
        const P = this.roster.places.get(trip.visit);
        const d1 = P ? tripMinutes(Math.hypot(P.x - A.x, P.z - A.z), DRIVE_MS) : 0;
        // Held from pulling in to driving off: the walks there and back are at most a few minutes.
        const spot = P && this.spotOf(v, trip.visit, { day: t.day, t0: depart + d1, t1: depart + d1 + trip.dwell + 2 * tripMinutes(PARKING.max_walk_m, p.pace) + 1 });
        if (!P || !spot) continue;
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
      if (seg.mode === "drive" || seg.mode === "bus") return null;
      if (seg.mode === "wait") return { x: seg.at[0], z: seg.at[1], yaw: seg.yaw || 0, moving: false, mode: "walk", activity: seg.label || "waiting" };
      const route = this.walkRoute(seg);
      if (!route) return null;
      const f = (t.minute - seg.t0) / (seg.t1 - seg.t0);
      // On the pavement, over the streets at the crosswalks (pavementRoute), as far along as
      // the waits at the kerb have left them (walkLags: held there, then a quicker step after).
      const a0 = this.anchor(seg.from, seg.fromXZ), a1 = this.anchor(seg.to, seg.toXZ);
      if (seg.pave === undefined) seg.pave = pavementRoute(this.streets, route, { from: a0, to: a1, side: hash32(p.id) % 2 ? 1 : -1 });
      const pave = seg.pave, L = pave.length, pace = L / Math.max(1, (seg.t1 - seg.t0) * 60);
      const key = `${p.id}:${seg.t0}`, lag = this.walkLags.get(key)?.lag || 0, d = Math.max(0, f * L - lag * pace);
      const off = (a, q) => (a && q ? Math.hypot(a.x - q[0], a.z - q[1]) : 0);
      // (Drawn in from the pavement to a door or a pole over a little more than its distance off.)
      const reach = Math.max(2, 1.6 * Math.max(off(a0, pave.pts[0]), off(a1, pave.pts[pave.pts.length - 1])));
      const pos = this.walkEnds(pave, d, 0, a0, a1, reach, f);
      return { ...pos, moving: true, mode: "walk", walk: { key, pave, d, pace, dir: 1 },
        activity: seg.visitor ? (seg.toXZ ? "back to the car" : "from the car") : `to ${this.nextKind(p, t, seg)}` };
    }
    const place = places.get(seg.place);
    if (!place) return null;
    if (seg.kind === "roam") return this.roaming(p, seg, place, t);
    const a = seg.act;
    if (a.kind === "sport" && place.court) return this.playing(p, seg, place, t);
    if (a.kind === "break" && a.outside) {
      // Out of the door for a break: on the pavement in front of it, a step or so out (door and
      // front point in) -- not out at the kerb among the parked cars.
      const r = rng(p.id, t.day, "break"), D = place.door || place.front;
      const out = DOOR_STEP_M + 0.2 + r() * 0.6, along = (r() - 0.5) * 3;
      const key = `${p.id}:${t.day}:${Math.round(seg.t0 * 10)}`;
      let at = this.breakSpots.get(key);
      if (at === undefined) {
        at = D ? { x: D.x - D.nx * out + D.nz * along, z: D.z - D.nz * out - D.nx * along } : this.anchor(seg.place, null, { door: false });
        // Kept on the pavement, back from the kerb (where the door is near it): not out among
        // the parked cars.
        const k = at && this.kerbside?.kerbAt(at.x, at.z);
        if (k) {
          const onPavement = (at.x - k.x) * k.nx + (at.z - k.z) * k.nz;
          if (onPavement < BREAK_KERB_M) { at.x += k.nx * (BREAK_KERB_M - onPavement); at.z += k.nz * (BREAK_KERB_M - onPavement); }
        }
        if (this.breakSpots.size > 4000) this.breakSpots.delete(this.breakSpots.keys().next().value);
        this.breakSpots.set(key, at || null);
      }
      if (!at) return null;
      return { x: at.x, z: at.z, yaw: r() * 6.28, moving: false, mode: "walk", activity: "on a break" };
    }
    if (place.inside && focus && Math.hypot(place.x - focus.x, place.z - focus.z) < INDOOR_REACH_M) return indoorSpot(p, a, place, t);
    return null;
  }
  //: On a court: about it the way the game goes -- running here and there and never leaping (a
  //: smooth way about the court, each player their own, at a run at most), a tennis player on
  //: their own side of the net, facing the way they run.
  playing(p, seg, place, t) {
    const C = place.court, sec = t.minute * 60, r = rng(p.id, "play");
    const ux = Math.cos(C.a), uz = -Math.sin(C.a), vx = -Math.sin(C.a), vz = -Math.cos(C.a);
    const side = C.s === "tennis" ? (hash32(p.id) % 2 ? 1 : -1) : 0;
    const w = [0.11 + r() * 0.06, 0.07 + r() * 0.05, 0.13 + r() * 0.07, 0.09 + r() * 0.05], ph = [r(), r(), r(), r()].map((x) => x * 6.28);
    const wave = (s, a, b) => 0.5 * (Math.sin(w[a] * s + ph[a]) + Math.sin(w[b] * s + ph[b]));   // -1..1
    const at = (s) => {
      const hu = C.l / 2 - 1, hv = C.w / 2 - 0.8;
      const du = side ? side * (2 + (hu - 2) * (0.5 + 0.5 * wave(s, 0, 1))) : hu * wave(s, 0, 1);
      return [C.x + ux * du + vx * hv * wave(s, 2, 3), C.z + uz * du + vz * hv * wave(s, 2, 3)];
    };
    const [x, z] = at(sec), [x1, z1] = at(sec + 0.5), v = Math.hypot(x1 - x, z1 - z) * 2;
    const game = { tennis: "playing tennis", basketball: "playing basketball", soccer: "playing football", baseball: "playing ball" }[C.s] || "playing";
    return { x, z, yaw: Math.atan2(-(x1 - x), -(z1 - z)), moving: v > 0.2, mode: "walk", speed: v, activity: game };
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
    // How far a point it starts or ends at (a bus stop's pole, a cab at the kerb) is off the
    // street node it is walked from: drawn in over that much more than the usual few metres.
    if (route?.pts.length) {
      const off = (xz, q) => (xz ? Math.hypot(xz[0] - q[0], xz[1] - q[1]) : 0);
      seg.pull = Math.max(off(seg.fromXZ, route.pts[0]), off(seg.toXZ, route.pts[route.pts.length - 1]));
    }
    return route;
  }
  //: A walker at the kerb (``walk.key`` from personAt) held there for ``dt`` seconds (``hold``),
  //: or making up the time after: a third quicker until they are where their day has them.
  holdWalk(key, dt, hold) {
    const w = this.walkLags.get(key);
    if (hold) {
      if (w) w.lag = Math.min(WALK_LAG_MAX_S, w.lag + dt);
      else {
        if (this.walkLags.size > 4000) this.walkLags.delete(this.walkLags.keys().next().value);
        this.walkLags.set(key, { lag: dt });
      }
    } else if (w) {
      w.lag -= dt * WALK_CATCH_UP;
      if (w.lag <= 0) this.walkLags.delete(key);
    }
  }
  //: Out of doors at work or for a walk: out and back along the streets near the place, a new
  //: way every twelve minutes (a patrol car, a delivery round, a letter carrier's route, a stroll).
  //: A car's round at work (a patrol, a delivery round, a cab cruising) as one leg the traffic
  //: can drive (view.mjs: by Drivers, like any other car near you, so it brakes, queues and gives
  //: way and is never driven through): out and back along its way as many times as its twelve
  //: minutes hold. {route, t0, t1 (minutes), key}; null for a round on foot, or none.
  //: A round at work driven (a patrol, a delivery round, a cab cruising): one way to the next
  //: place and on from there, each a whole route driven to its end before the next is set --
  //: every ROAM_SLOT_MIN minutes a new one, from where the last ended (the first from the
  //: workplace's kerb, the last back to it). Where each leg begins and ends follows from the
  //: day (seeded), so any leg is found without the ones before it. It had driven out and back
  //: along one way every twelve minutes, turning round in the middle of a street (2026-11-11).
  roamDrive(p, seg, t) {
    const place = this.roster.places.get(seg.place);
    if (!place || !seg.drive) return null;
    const span = seg.t1 - seg.t0, slots = Math.max(1, Math.floor(span / ROAM_SLOT_MIN));
    const k = Math.max(0, Math.min(slots - 1, Math.floor((t.minute - seg.t0) / ROAM_SLOT_MIN)));
    const key = `${p.id}:roam:${t.day}:${Math.round(seg.t0)}:${k}`;
    let leg = this.roams.get(key);
    if (leg === undefined) {
      const home = this.streets.nearest(place.x, place.z, "kerb", 200);
      const stop = (j) => {
        if (j <= 0 || j >= slots) return home;
        const r = rng(p.id, t.day, Math.round(seg.t0), "roam", j);
        for (let tries = 0; tries < 5; tries += 1) {
          const ang = r() * Math.PI * 2, dist = 250 + r() * 300;
          const n = this.streets.nearest(place.x + Math.cos(ang) * dist, place.z + Math.sin(ang) * dist, "kerb", 120);
          if (n !== null && n !== undefined && this.netOf(n) === this.netOf(home)) return n;
        }
        return home;
      };
      const from = stop(k), to = stop(k + 1);
      const route = from !== null && to !== null && from !== to ? this.streets.route(from, to, "drive") : null;
      leg = null;
      if (route && route.length >= 5) {
        const t0 = seg.t0 + k * ROAM_SLOT_MIN, room = (k === slots - 1 ? seg.t1 : t0 + ROAM_SLOT_MIN) - t0;
        const speed = seg.act.outdoor === "sweep" ? 2.2 : 8;
        leg = { route, t0, t1: t0 + Math.min(room * 0.95, route.length / speed / 60), key };
      }
      if (this.roams.size > 8000) this.roams.delete(this.roams.keys().next().value);
      this.roams.set(key, leg);
    }
    return leg;
  }
  //: The way of one twelve-minute round (cached).
  roamOf(p, seg, place, t, leg) {
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
      // On foot: out and back on the pavement, over at the crosswalks.
      if (r0 && !drive) r0.pave = pavementRoute(this.streets, route, { from: this.anchor(seg.place, null, { door: false }), side: hash32(p.id) % 2 ? 1 : -1 });
      if (this.roams.size > 8000) this.roams.delete(this.roams.keys().next().value);
      this.roams.set(key, r0);
    }
    return r0;
  }
  roaming(p, seg, place, t) {
    if (seg.drive) {
      // Driven: along this leg of the round, and pulled in at its end until the next.
      const L = this.roamDrive(p, seg, t);
      if (!L) return null;
      const f = Math.max(0, Math.min(1, (t.minute - L.t0) / Math.max(1e-6, L.t1 - L.t0)));
      const there = f >= 1;
      const pos = there ? alongRoute(L.route, L.route.length, PARK_LANE) : alongRoute(L.route, f * L.route.length, KERB);
      return { ...pos, moving: !there, mode: "drive", speed: there ? 0 : L.route.length / ((L.t1 - L.t0) * 60), walk: null,
        activity: `${this.R.jobs.roles[p.role]?.title.toLowerCase() || "at work"} at work` };
    }
    const leg = Math.floor((t.minute - seg.t0) / 12);
    const key = `${p.id}:${t.day}:${Math.round(seg.t0)}:${leg}`;
    const r0 = this.roamOf(p, seg, place, t, leg);
    if (!r0) return null;
    const { drive } = r0, route = drive ? r0.route : r0.pave;
    const speed = drive ? (seg.act.outdoor === "sweep" ? 2.2 : 8) : p.pace * (seg.act.kind === "stroll" ? 0.8 : 1);
    // Whole out-and-backs in the twelve minutes (or what is left of the stay), so each way ends
    // where the next begins, at the place: a walker never jumps from one round to the next.
    const span = Math.max(0.05, Math.min(12, seg.t1 - seg.t0 - leg * 12)) * 60, L = route.length;
    let turns = Math.max(1, Math.round((span * speed) / (2 * L))), far = L, pace = (turns * 2 * L) / span;
    if (pace > speed * 1.5) { turns = 1; far = (span * speed) / 2; pace = speed; }
    const lag = drive ? 0 : this.walkLags.get(key)?.lag || 0;
    const into = Math.max(0, Math.min(span, (t.minute - seg.t0 - leg * 12) * 60) * pace - lag * pace);
    const d = into % (2 * far), forward = d <= far;
    const along = forward ? d : 2 * far - d;
    // Turning back, a car crosses to the other lane over the last few metres either side of the
    // turn, not in one step.
    // (A walker keeps to the same pavement: the offset is to the right of the way, not of travel.)
    const turn = Math.min(1, Math.min(along, far - along) / 10), k = drive ? (forward ? 1 : -1) * turn : 1;
    const home = drive ? null : this.anchor(seg.place, null, { door: false });
    const pos = drive ? alongRoute(route, along, (half, cls, park, i) => k * KERB(half, cls, park, i, k > 0 ? route : null)) : this.walkEnds(route, along, 0, home, null, 3);
    if (!forward) pos.yaw += Math.PI;
    return { ...pos, moving: true, mode: drive ? "drive" : "walk", speed: pace, walk: drive ? null : { key, pave: route, d: along, pace, dir: forward ? 1 : -1 }, activity: seg.act.kind === "stroll" ? (p.visitor ? "about the shops" : "out for a walk") : `${this.R.jobs.roles[p.role]?.title.toLowerCase() || "at work"} at work` };
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
    return { ...alongRoute(route, Math.max(0, Math.min(route.length, d)), KERB), route };
  }
  //: Everyone and everything that might be in sight of ``focus`` in the next while: the full
  //: pass, a few times a second at most. Indoors, away, in a garage: not listed.
  scan(ms, focus, reach, parkedReach = 180) {
    this.scanBegin(ms, focus, reach, parkedReach);
    return this.scanMore(Infinity, true);
  }
  //: The same pass a slice at a time (``budget`` people and cars a call), so a frame is not
  //: held up by the whole district at once: null until the pass is done.
  scanBegin(ms, focus, reach, parkedReach = 180) {
    this._scan = { t: this.timeAt(ms), focus: { x: focus.x, z: focus.z }, reach, parkedReach, people: [], vehicles: [],
      P: [...this.roster.people.values(), ...this.roster.visitors.values()], V: [...this.roster.vehicles.values()], i: 0, j: 0, garaged: [] };
  }
  scanMore(budget = 2500, whole = false) {
    const S = this._scan;
    if (!S) return null;
    const { t, focus, reach, parkedReach, people, vehicles } = S;
    const near = (x, z, extra = 0) => Math.abs(x - focus.x) < reach + extra && Math.abs(z - focus.z) < reach + extra;
    const P = this.roster.places;
    // So many a frame, and never past a few milliseconds: a person whose day is planned for the
    // first time costs far more than one already planned, and a frame of first plans froze the page.
    let n = 0;
    // (The first scan, with nothing yet drawn, takes longer slices: it used to take one, of up
    // to half a minute.)
    const deadline = performance.now() + (budget === Infinity ? SCAN_FIRST_SLICE_MS : SCAN_SLICE_MS);
    const over = () => !whole && (n & 31) === 0 && n > 0 && performance.now() > deadline;
    for (; S.i < S.P.length && n < budget && !over(); S.i += 1, n += 1) {
      const p = S.P[S.i];
      const plan = this.planOf(p, t), seg = segAt(plan.segs, t.minute);
      const h = this.harm(p.id, t.ms);
      if (h?.down) { if (near(h.at.x, h.at.z)) people.push({ p, seg: null }); continue; }
      if (!seg || h?.out) continue;
      if (seg.kind === "go") {
        // A taxi on its way in or away while its fare walks, and the cab the fare is riding.
        for (const L of seg.cabLegs || []) if (L.t0 <= t.minute && t.minute < L.t1) this.cabNear(vehicles, L, t, focus, reach);
        if (seg.mode === "drive") { if (seg.cab) this.cabNear(vehicles, seg, t, focus, reach); continue; }
        if (seg.mode === "bus") continue;
        if (seg.mode === "wait") { if (near(seg.at[0], seg.at[1])) people.push({ p, seg }); continue; }
        const A = seg.fromXZ ? { x: seg.fromXZ[0], z: seg.fromXZ[1] } : P.get(seg.from), B = seg.toXZ ? { x: seg.toXZ[0], z: seg.toXZ[1] } : P.get(seg.to);
        if (A && B && distToSegment(focus.x, focus.z, A.x, A.z, B.x, B.z) < reach + 60) people.push({ p, seg });
        continue;
      }
      const pl = P.get(seg.place);
      if (!pl) continue;
      if (seg.kind === "roam") { if (!seg.drive && near(pl.x, pl.z, 350)) people.push({ p, seg }); continue; }
      if (seg.act.kind === "sport") { if (pl.court && near(pl.x, pl.z)) people.push({ p, seg }); continue; }
      if ((seg.act.kind === "break" && seg.act.outside && near(pl.x, pl.z)) || (pl.inside && Math.hypot(pl.x - focus.x, pl.z - focus.z) < INDOOR_REACH_M)) people.push({ p, seg });
    }
    for (; S.j < S.V.length && n < budget && !over(); S.j += 1, n += 1) {
      const v = S.V[S.j], s = this.vehicleAt(v, t);
      if (s?.state === "garage" && s.spot && near(s.spot.x, s.spot.z)) S.garaged.push({ v, s });
      if (!s || s.hidden) continue;
      if (s.state === "driving") {
        if (s.roam) { if (near(s.x, s.z, 120)) vehicles.push({ v, s }); continue; }
        const leg = s.leg, P0 = this.endOf(v, leg.from), P1 = this.endOf(v, leg.to);
        if (P0 && P1 && distToSegment(focus.x, focus.z, P0.x, P0.z, P1.x, P1.z) < reach + 250) vehicles.push({ v, s });
      } else if (Math.abs(s.x - focus.x) < parkedReach && Math.abs(s.z - focus.z) < parkedReach) vehicles.push({ v, s });
    }
    if (S.i < S.P.length || S.j < S.V.length) return null;
    this._scan = null;
    return { time: t, people, vehicles, garaged: S.garaged };
  }
  //: A cab on ``leg`` listed with the traffic when its way passes near ``focus``.
  cabNear(out, leg, t, focus, reach) {
    const P0 = this.endOf(leg.cab, leg.from), P1 = this.endOf(leg.cab, leg.to);
    if (!P0 || !P1 || distToSegment(focus.x, focus.z, P0.x, P0.z, P1.x, P1.z) > reach + 250) return;
    if (out.some((e) => e.v.id === leg.cab.id)) return;
    out.push({ v: leg.cab, s: { state: "driving", leg, f: Math.min(1, (t.minute - leg.t0) / (leg.t1 - leg.t0)), moving: true, lag: 0 } });
  }
  //: Whether a car's garage door stands open at ``t`` (minutes either side of ``open_min``): the
  //: door goes up before it drives out and comes down after; up as it comes home, down once in.
  garageOpen(v, t, lead = 0.45, after = 0.4) {
    if (!v.garage || !v.home) return false;
    const owner = this.roster.people.get(v.owner);
    if (!owner) return false;
    const m = t.minute;
    for (const s of this.planOf(owner, t).drives) {
      if (s.kind !== "go") continue;
      const lag = this.delay(v, s, t.day) || 0;
      if (s.from === v.home && m >= s.t0 - lead && m < s.t0 + after) return true;
      if (s.to === v.home && m >= s.t1 + lag - lead && m < s.t1 + lag + after) return true;
    }
    return false;
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
      if (s.kind === "go" && (s.mode === "wait" || (s.ride && s.mode === "walk"))) continue;
      if (s.kind === "go" && s.taxi) out.push(`${hhmm(s.t0)} took a taxi from ${name(s.from)} to ${name(s.to)}.`);
      else if (s.kind === "go" && s.mode === "bus") out.push(`${hhmm(s.t0)} rode the ${s.route} bus from near ${name(s.from)} toward ${name(s.to)}.`);
      else if (s.kind === "go") out.push(`${hhmm(s.t0)} ${s.mode === "drive" ? "drove" : "walked"} from ${s.fromXZ ? "the car" : name(s.from)} to ${s.toXZ ? "the car" : name(s.to)}.`);
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
  stop_line_m: 5, stop_sign_s: 1.4, signal_cycle_s: 42, green_s: 18, amber_s: 3, person_half_m: 0.35,
  // No queue stands for good: a car held behind another for ``stuck_queue_s`` with no light or
  // stop sign holding it creeps on. A car at the end of its leg pulls in and is parked at once.
  // (Someone in the road is always waited for.)
  stuck_queue_s: 8, release_s: 4, deadlock_s: 20,
  // Lanes: a change takes ``lane_change_s``, looked at once a second, never within a junction.
  // A car stood still in a junction's box for ``box_clear_s`` is driven out of it at
  // ``clear_speed`` (through whatever holds it: a jam must not lock the junction). Cars within
  // ``predict_r_m`` look ``predict_s`` ahead along both their routes; where they would meet, the
  // one in front is moved on for ``push_s`` at ``push_speed`` at least.
  lane_change_s: 2.5, box_clear_s: 5, clear_speed: 3, predict_r_m: 9, predict_s: [0.5, 1, 1.5], push_s: 1.2, push_speed: 3 };
//: Which segment of ``route`` distance ``d`` is on.
export function segOf(route, d) {
  const s = route.s;
  let lo = 0, hi = s.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (s[m] <= d) lo = m; else hi = m; }
  return Math.min(lo, Math.max(0, s.length - 2));
}
//: The same block one way, whichever route is on it: its two nodes (or its two ends' places).
export function edgeKey(route, i) {
  const a = route.ids?.[i], b = route.ids?.[i + 1];
  if (a >= 0 && b >= 0) return `${a}>${b}`;
  const p = route.pts[i], q = route.pts[i + 1];
  return `${Math.round(p[0])},${Math.round(p[1])}>${Math.round(q[0])},${Math.round(q[1])}`;
}
//: A car's own side of the street (for alongRoute): the lane it is in, or on its way across to
//: the next over (``lt`` 0..1), eased.
export function laneSide(st) {
  return (half, cls, park, i, route) => {
    const b = laneOffset(half, cls, park, i, route, st.lane);
    if (!(st.lt < 1)) return b;
    const a = laneOffset(half, cls, park, i, route, st.from), u = Math.max(0, st.lt);
    return a + (b - a) * u * u * (3 - 2 * u);
  };
}
//: Whether a reason a car is held is one it must wait for (a light, a stop sign, someone in the
//: road, its turn in the junction, a junction it cannot get out of): never pushed on through.
const HARD_HOLD = /light|stop sign|you|someone|giving way|way out/;
//: Where a car that has arrived stands: in the parking lane, off the way of the traffic.
export const PARK_LANE = (half, cls) => (cls === "service" ? 0 : Math.max(2.4, half - 1.0));
//: The light a car approaching ``node`` from ``bearing`` sees at ``tsec``: "green", "amber", "red".
export function signalAt(streets, node, bearing, tsec, T = TRAFFIC) {
  const e0 = streets.edges[node].find((e) => e.cls === "arterial") || streets.edges[node][0];
  const n = streets.nodes[node], m = streets.nodes[e0.to];
  const ref = Math.atan2(m.x - n.x, m.z - n.z);
  let a = Math.abs(((bearing - ref) % Math.PI + Math.PI) % Math.PI);
  const axis = a < Math.PI / 4 || a > (3 * Math.PI) / 4 ? 0 : 1;
  const C = T.signal_cycle_s, A = T.amber_s, phase = (tsec + (hash32("signal", node) % C)) % C;
  // The main street (the arterial the light is set by) has the longer green where it crosses a
  // lesser one; two arterials share the cycle.
  const both = e0.cls === "arterial" && streets.edges[node].some((e) => e.cls === "arterial" && e !== e0 && Math.abs(Math.sin(Math.atan2(streets.nodes[e.to].x - n.x, streets.nodes[e.to].z - n.z) - ref)) > 0.7);
  const share = e0.cls === "arterial" && !both ? (T.main_green_share ?? 0.5) : 0.5;
  const g0 = C * share - A, g1 = C * (1 - share) - A;
  const local = axis === 0 ? phase : (phase - (g0 + A) + C) % C, green = axis === 0 ? g0 : g1;
  return local < green ? "green" : local < green + A ? "amber" : "red";
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

//: How close two cars' ways through a junction may come and not be in each other's way (two
//: cars' half widths, and room for a turning car's corners to swing), in metres.
export const CLEAR_M = 3.0;
const segGap = (p, q, r, t) => {
  // The least distance between segments pq and rt.
  const d = (a, b, c) => {
    const ux = c[0] - b[0], uz = c[1] - b[1], L = ux * ux + uz * uz;
    const k = L ? Math.max(0, Math.min(1, ((a[0] - b[0]) * ux + (a[1] - b[1]) * uz) / L)) : 0;
    return Math.hypot(a[0] - b[0] - ux * k, a[1] - b[1] - uz * k);
  };
  const o = (a, b, c) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
  if (o(p, q, r) * o(p, q, t) < 0 && o(r, t, p) * o(r, t, q) < 0) return 0;
  return Math.min(d(p, r, t), d(q, r, t), d(r, p, q), d(t, p, q));
};
export function pathGap(A, B) {
  let g = Infinity;
  for (let i = 0; i + 1 < A.length; i += 1) for (let j = 0; j + 1 < B.length; j += 1) g = Math.min(g, segGap(A[i], A[i + 1], B[j], B[j + 1]));
  return g;
}
//: A way through a junction carried on ``m`` metres at either end (over the crosswalks there).
export function extendPath(P, m) {
  const ext = (a, b) => { const dx = a[0] - b[0], dz = a[1] - b[1], L = Math.hypot(dx, dz) || 1; return [a[0] + (dx / L) * m, a[1] + (dz / L) * m]; };
  return [ext(P[0], P[1]), ...P, ext(P[P.length - 1], P[P.length - 2])];
}
//: A car's way through a junction in its lane: in from the box's edge, to where its lane's line
//: meets the line of the lane it turns into, and out to the far edge.
export function junctionPath(node, inU, outU, kIn, kOut, box) {
  const nIn = [-inU[1], inU[0]], nOut = [-outU[1], outU[0]];
  const a = [node.x + nIn[0] * kIn, node.z + nIn[1] * kIn], b = [node.x + nOut[0] * kOut, node.z + nOut[1] * kOut];
  const p0 = [a[0] - inU[0] * box, a[1] - inU[1] * box], p2 = [b[0] + outU[0] * box, b[1] + outU[1] * box];
  const c = inU[0] * outU[1] - inU[1] * outU[0];
  if (Math.abs(c) < 0.2) return [p0, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], p2];
  const t = ((b[0] - a[0]) * outU[1] - (b[1] - a[1]) * outU[0]) / c;
  return [p0, [a[0] + inU[0] * t, a[1] + inU[1] * t], p2];
}
//: Which way a car goes through a junction, from the way in and the way out: "S"traight on,
//: "L"eft, "R"ight or "U" (back the way it came). x east, z south: a left turn is cross < 0.
export function turnOf(inU, outU) {
  const d = inU[0] * outU[0] + inU[1] * outU[1], c = inU[0] * outU[1] - inU[1] * outU[0];
  return d > 0.7 ? "S" : d < -0.7 ? "U" : c < 0 ? "L" : "R";
}
//: Whether two ways through a junction cross (or meet): not two from the same way in (one is
//: behind the other), nor two opposite ways straight on or turning right, nor two turning left
//: from opposite sides (they pass in front of each other), nor a right turn and a way across it
//: to another street (the right turn keeps to its corner). Two ways out into the same street do.
export function crosses(a, b) {
  const di = a.inU[0] * b.inU[0] + a.inU[1] * b.inU[1];
  if (di > 0.85) return false;
  // Where the lanes' own lines are known (``path``: in at the box's edge, the corner where the
  // way in meets the way out, out at the far edge), by them: two ways cross where those come
  // within a car's width of each other.
  if (a.path && b.path) return pathGap(a.path, b.path) < CLEAR_M;
  if (a.outU[0] * b.outU[0] + a.outU[1] * b.outU[1] > 0.85) return true;
  const ta = turnOf(a.inU, a.outU), tb = turnOf(b.inU, b.outU);
  if (di < -0.85) return ta === "L" && tb === "L" ? false : ta === "L" || tb === "L" || ta === "U" || tb === "U";
  return !(ta === "R" || tb === "R");
}

export class Drivers {
  constructor(streets, T = TRAFFIC) { this.streets = streets; this.T = T; this.cars = new Map(); this.delays = new Map(); this.claims = new Map(); this.boxes = new Map(); }
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
        st = { key: c.key, d, v: Math.min(lim, c.cruise ?? lim), stopped: new Set(), waitUntil: 0, hit: null, fresh: true };
        // In the lane its route has it in to begin with (lanePlan), its own from then on.
        const i0 = segOf(c.route, d), plan = lanePlan(c.route);
        st.lane = st.from = plan ? Math.min(plan.k[i0] || 0, Math.max(0, (plan.n[i0] || 1) - 1)) : 0;
        st.lt = 1; st.nextLook = 0; st.side = laneSide(st);
        this.cars.set(c.id, st);
      }
      live.push([c, st]);
    }
    // Where each is now, for the cars behind.
    const pos = new Map();
    // In its lane, as it is drawn: the kerb side of the street. A car coming into sight where
    // another already stands (its day had it there; the other was held up) comes in behind it.
    const grid = new Map(), CELL = 12, cellOf = (x, z) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
    const place = (id, p) => { const k = cellOf(p.x, p.z); p.cell = k; let g = grid.get(k); if (!g) grid.set(k, g = new Set()); g.add(id); };
    const unplace = (id, p) => grid.get(p.cell)?.delete(id);
    const near = (x, z, r, fn) => {
      const i0 = Math.floor((x - r) / CELL), i1 = Math.floor((x + r) / CELL), j0 = Math.floor((z - r) / CELL), j1 = Math.floor((z + r) / CELL);
      for (let i = i0; i <= i1; i += 1) for (let j = j0; j <= j1; j += 1) { const g = grid.get(`${i},${j}`); if (g) for (const id of g) fn(id); }
    };
    // How far into each other two bodies are (each a row of circles down its length), <= 0 apart.
    const bodies = (p, length, width) => {
      const r = width / 2, n = Math.max(1, Math.ceil((length - width) / width) + 1), k = (length - width) / 2, fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw), out = [];
      for (let j = 0; j < n; j += 1) { const t = n === 1 ? 0 : -k + (2 * k * j) / (n - 1); out.push([p.x + fx * t, p.z + fz * t]); }
      return { r, at: out };
    };
    const into = (A, B) => {
      let worst = -Infinity;
      for (const a of A.at) for (const b of B.at) worst = Math.max(worst, A.r + B.r + 0.25 - Math.hypot(a[0] - b[0], a[1] - b[1]));
      return worst;
    };
    const others = blockers.map((o, k) => ({ id: `blocker:${k}`, body: bodies(o, o.length || 4.5, o.width || 1.9) }));
    const deepest = (id, body, x, z, reach) => {
      let worst = -Infinity, who = null;
      near(x, z, reach, (oid) => { if (oid === id) return; const o = pos.get(oid); const d = into(body, o.body); if (d > worst) { worst = d; who = oid; } });
      for (const o of others) { const d = into(body, o.body); if (d > worst) { worst = d; who = o.id; } }
      return { worst, who };
    };
    // What a car's move from ``a`` to ``b`` would drive it into: another ahead of it that it
    // would go further into (so two that came to overlap -- come into sight so -- can draw
    // apart, the one in front going on).
    const blocking = (id, a, b, reach) => {
      let who = null;
      const fx = -Math.sin(a.yaw), fz = -Math.cos(a.yaw);
      const test = (oid, ob) => {
        if (who || oid === id) return;
        const later = into(b.body, ob);
        if (later <= 0) return;
        const o = ob.at[Math.floor(ob.at.length / 2)];
        if ((o[0] - a.x) * fx + (o[1] - a.z) * fz <= 0) return;
        if (later > into(a.body, ob) + 1e-4) who = oid;
      };
      near(b.x, b.z, reach, (oid) => test(oid, pos.get(oid).body));
      for (const o of others) test(o.id, o.body);
      return who;
    };
    // (The cars already in the traffic first, then those come into sight, behind them.)
    live.sort((a, b) => (a[1].fresh ? 1 : 0) - (b[1].fresh ? 1 : 0));
    for (const [c, st] of live) {
      let p = { ...alongRoute(c.route, st.d, st.side), c };
      p.body = bodies(p, c.length, c.width || 1.9);
      if (st.fresh) {
        for (let k = 0; k < 40 && st.d > 0 && deepest(c.id, p.body, p.x, p.z, c.length + 8).worst > 0; k += 1) {
          st.d = Math.max(0, st.d - 1.5); p = { ...alongRoute(c.route, st.d, st.side), c }; p.body = bodies(p, c.length, c.width || 1.9);
        }
        st.fresh = false;
      }
      pos.set(c.id, p);
      // (Arrived, it is in the parking lane, out of the way.)
      if (!(st.d >= this.endOf(c))) place(c.id, p);
    }
    // Arrived: at the end of its leg it pulls into the parking lane, out of the traffic's way.
    // (A leg that ends at a junction ends at its stop line: the car pulls in to its spot from
    // there, not out across the junction to the node.)
    const arrived = (c, st) => st.d >= this.endOf(c);
    // Who is in which lane of each block, for the lane each car takes (pickLane).
    const lanesOn = new Map();
    for (const [c, st] of live) {
      if (st.hit || arrived(c, st)) continue;
      const i = segOf(c.route, st.d), key = edgeKey(c.route, i);
      let list = lanesOn.get(key);
      if (!list) lanesOn.set(key, list = []);
      list.push({ id: c.id, along: st.d - c.route.s[i], lane: st.lane, from: st.lt < 1 ? st.from : st.lane, length: c.length, v: st.v });
    }
    // Two cars closing on each other: where both routes take them in the next moments (a thing
    // with no route -- your car, a bus at its stop -- stands where it is); if they would meet,
    // the one in front is moved on (the one behind brakes, as ever).
    const pushes = new Set();
    for (const [c, st] of live) {
      if (st.hit || arrived(c, st)) continue;
      const p = pos.get(c.id);
      near(p.x, p.z, T.predict_r_m, (oid) => {
        if (String(oid) <= String(c.id)) return;
        const o = this.cars.get(oid), op = pos.get(oid);
        if (!o || !op || o.hit || arrived(op.c, o) || (st.v < 0.2 && o.v < 0.2)) return;
        const now = into(p.body, op.body);
        for (const tau of T.predict_s) {
          const a = alongRoute(c.route, Math.min(c.route.length, st.d + st.v * tau), st.side);
          const b = alongRoute(op.c.route, Math.min(op.c.route.length, o.d + o.v * tau), o.side);
          const meet = into(bodies(a, c.length, c.width || 1.9), bodies(b, op.c.length, op.c.width || 1.9));
          if (meet > 0 && meet > now + 1e-4) {
            const ahead = (op.x - p.x) * -Math.sin(p.yaw) + (op.z - p.z) * -Math.cos(p.yaw);
            pushes.add(ahead > 0 ? oid : c.id);
            break;
          }
        }
      });
    }
    for (const [c, st] of live) {
      if (st.hit && !(st.hit.until > 0 && tsec > st.hit.until)) { out.push({ id: c.id, d: st.d, v: 0, hit: st.hit }); continue; }
      if (arrived(c, st)) { st.v = 0; out.push({ id: c.id, d: c.route.length, v: 0, arrived: true }); continue; }
      if (st.hit) st.hit = null;
      const here = pos.get(c.id), fx = -Math.sin(here.yaw), fz = -Math.cos(here.yaw);
      const limit = c.limitAt ? c.limitAt(here.cls) : c.limit;
      let target = Math.min(limit, c.cruise ?? limit), reason = null;
      // Its lane (one change at a time, into a gap, never in or at a junction's box).
      const J = this.junctionAhead(c, st);
      if (st.lt < 1) st.lt = Math.min(1, st.lt + dt / T.lane_change_s);
      else if (tsec >= st.nextLook && !(J && st.d > J.s - J.box - c.length / 2 - 6)) { st.nextLook = tsec + 1; this.pickLane(c, st, lanesOn, blockers); }
      // Waiting for a gap to get over (into the lane for its turn): eased off, to let one by.
      if (st.waiting) target = Math.min(target, limit * 0.7);
      // Junctions ahead on the way.
      const { s, ids } = c.route;
      for (let i = 1; i < s.length; i += 1) {
        const ahead = s[i] - st.d;
        if (ahead < -1) continue;
        if (ahead > T.look_m) break;
        const kind = junctionAt(this.streets, ids?.[i] ?? -1);
        if (!kind || i === s.length - 1) continue;
        const toLine = ahead - this.stopLine(ids[i], c);
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
      // Right of way in the junction ahead (or the one it is in): first come, first through.
      if (J) {
        const box = this.claims.get(J.node) || new Map(), mine = box.get(c.id);
        const toLine = J.s - this.stopLine(J.node, c) - st.d, entered = toLine < -1;
        let free = entered;
        if (!entered) {
          const stopping = st.v * st.v / (2 * T.brake);
          const light = J.kind === "signal" ? signalAt(this.streets, J.node, Math.atan2(J.inU[0], J.inU[1]), tsec, T) : null;
          free = J.kind === "stop" ? st.stopped.has(J.node) : light === "green" || (light === "amber" && stopping > toLine + 1);
          // Never into a junction it cannot get out of: the way out on the far side stood full.
          if (free && toLine < 30 && J.s + J.box + c.length < c.route.length) {
            const out = alongRoute(c.route, J.s + J.box + c.length / 2 + 1, st.side), ox = -Math.sin(out.yaw), oz = -Math.cos(out.yaw);
            // Standing in its lane there, facing its way (not one coming the other way).
            const inTheWay = (x, z, yaw, length) => {
              const dx = x - out.x, dz = z - out.z;
              return Math.abs(dx * ox + dz * oz) < (c.length + length) / 2 && Math.abs(dx * oz - dz * ox) < 1.5 && Math.cos(yaw - out.yaw) > 0.5;
            };
            let jammed = false;
            near(out.x, out.z, 8, (oid) => {
              if (jammed || oid === c.id) return;
              const op = pos.get(oid), ost = this.cars.get(oid);
              if (ost && ost.v < 1 && !arrived(op.c, ost) && inTheWay(op.x, op.z, op.yaw, op.c.length)) jammed = true;
            });
            for (const o of blockers) if (!jammed && (o.v || 0) < 1 && inTheWay(o.x, o.z, o.yaw || 0, o.length || 4.5)) jammed = true;
            if (jammed) {
              free = false;
              const v = Math.sqrt(2 * T.brake * Math.max(0, toLine));
              if (v < target) { target = v; reason = "the way out is blocked"; }
            }
          }
          if (!free && mine) box.delete(c.id);
        }
        if (free && toLine < st.v * st.v / (2 * T.brake) + 8) {
          const claim = mine || { at: entered ? tsec - 1e4 : tsec, inU: J.inU, outU: J.outU, path: J.path, id: c.id };
          claim.entered = entered; claim.out = J.s + J.box + c.length / 2;
          box.set(c.id, claim); this.claims.set(J.node, box);
          if (!entered) {
            // Someone on a crosswalk this way goes over (in, or out the far side): waited for.
            const ext = extendPath(J.path, PAVE_M + 1);
            for (const q of people) {
              if (Math.abs(q.x - J.path[1][0]) > J.box + 6 || Math.abs(q.z - J.path[1][1]) > J.box + 6) continue;
              if (pathGap(ext, [[q.x, q.z], [q.x, q.z]]) < 1.6) {
                const v = Math.sqrt(2 * T.brake * Math.max(0, toLine));
                if (v < target) { target = v; reason = q.player ? "you" : "someone crossing"; }
                break;
              }
            }
            for (const o of box.values()) {
              if (o.id === c.id || !(o.entered || o.at < claim.at || (o.at === claim.at && o.id < c.id))) continue;
              if (!crosses(claim, o)) continue;
              const v = Math.sqrt(2 * T.brake * Math.max(0, toLine));
              if (v < target) { target = v; reason = "giving way"; }
              break;
            }
          }
        }
      }
      // The car ahead.
      const queueFree = st.releaseQueue > tsec;
      const look = (fn) => near(here.x + fx * T.look_m / 2, here.z + fz * T.look_m / 2, T.look_m / 2 + 4, fn);
      look((oid) => {
        const op = pos.get(oid), o = op.c, ost = this.cars.get(oid);
        if (oid === c.id || !ost || arrived(o, ost) || queueFree) return;
        const dx = op.x - here.x, dz = op.z - here.z;
        const fwd = dx * fx + dz * fz, lat = Math.abs(dx * fz - dz * fx);
        if (fwd <= 0 || fwd > T.look_m || lat > 1.9) return;
        if (Math.cos(op.yaw - here.yaw) < 0.4) return;
        const gap = fwd - (c.length + o.length) / 2 - T.gap_m;
        const v = Math.max(0, Math.min(ost.v + gap / T.headway_s, Math.sqrt(2 * T.brake * Math.max(0, gap)) + ost.v));
        if (v < target) { target = v; reason = "the car ahead"; st.leader = o.id; }
      });
      // Your car (or anything else in the road that is not one of these): kept behind.
      for (const o of blockers) {
        const dx = o.x - here.x, dz = o.z - here.z;
        const fwd = dx * fx + dz * fz, lat = Math.abs(dx * fz - dz * fx);
        if (fwd <= 0 || fwd > T.look_m || lat > 1.9) continue;
        const gap = fwd - (c.length + (o.length || 4.5)) / 2 - T.gap_m, ov = Math.max(0, o.v || 0);
        const v = Math.max(0, Math.min(ov + gap / T.headway_s, Math.sqrt(2 * T.brake * Math.max(0, gap)) + ov));
        if (v < target) { target = v; reason = "the car ahead"; }
      }
      // About to be run into (pushes, above): moved on, unless something it must wait for holds it.
      if (pushes.has(c.id) && !HARD_HOLD.test(reason || "")) st.pushUntil = tsec + T.push_s;
      if (st.pushUntil > tsec && !HARD_HOLD.test(reason || "")) { target = Math.max(target, Math.min(limit, T.push_speed)); reason = "making room"; }
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
      // Stood still in a junction's box (a jam, a knot of cars each waiting on another): after a
      // while it is driven out the far side, through whatever held it -- never left there.
      const inBox = J && st.d > J.s - J.box - c.length / 2 && st.d < J.s + J.box + c.length / 2;
      if (!inBox) { st.boxStill = 0; st.clearing = false; }
      else if (st.v < 0.3 && !danger) { st.boxStill = (st.boxStill || 0) + dt; if (st.boxStill > T.box_clear_s) st.clearing = true; }
      if (st.clearing && !danger) { target = Math.max(target, T.clear_speed); reason = "clearing the junction"; }
      if (st.v > target) st.v = Math.max(target, st.v - decel * dt);
      else st.v = Math.min(target, st.v + T.accel * dt);
      // Held too long, and not by a light, a stop sign or you: let go.
      // Only a queue nothing real holds: follow it to its head; a light, a stop sign or someone
      // in the road there is waited for, a ring of cars each waiting on the next is not.
      if (st.v < 0.2 && reason === "the car ahead") {
        st.still = (st.still || 0) + dt;
        if (st.still > T.stuck_queue_s && !this.heldAtHead(c.id)) { st.releaseQueue = tsec + T.release_s; st.still = 0; }
      } else st.still = 0;
      // Never into another car: a move that would put this one further into any other (or into
      // your car) is not made. (A queue let go no longer drives through the car it waited on.)
      const d1 = Math.min(c.route.length, st.d + st.v * dt);
      if (d1 > st.d) {
        const next = { ...alongRoute(c.route, d1, st.side) };
        next.body = bodies(next, c.length, c.width || 1.9);
        const then = { who: blocking(c.id, here, next, c.length + 6) };
        // Last of all, two cars stuck in each other's way for good (it should not come to that):
        // the one with the lower id goes on.
        const other = this.cars.get(then.who), stuck = (st.blocked || 0) > T.deadlock_s && other && (other.blockedBy === c.id || other.leader === c.id) && String(c.id) < String(then.who);
        // Clearing a junction it goes through what held it -- but two clearing it go one at a
        // time (the lower id first), never through each other.
        const theirs = this.cars.get(then.who), ghost = st.clearing && !(theirs?.clearing && String(then.who) < String(c.id));
        if (then.who && !stuck && !ghost) {
          st.v = 0; reason = "blocked"; st.blocked = (st.blocked || 0) + dt; st.blockedBy = then.who;
          st.reason = reason; st.leader = then.who;
          this.delays.set(c.key, tsec - c.unsched(st.d));
          out.push({ id: c.id, d: st.d, v: 0, reason, braking: true });
          continue;
        }
      }
      st.blocked = 0; st.blockedBy = null;
      st.reason = reason;
      if (reason !== "the car ahead") st.leader = null;
      st.d = d1;
      { const p = { ...alongRoute(c.route, st.d, st.side), c }; p.body = bodies(p, c.length, c.width || 1.9); unplace(c.id, here); pos.set(c.id, p); place(c.id, p); }
      const delay = tsec - c.unsched(st.d);
      this.delays.set(c.key, delay);
      out.push({ id: c.id, d: st.d, v: st.v, reason, braking: st.v < target - 0.01 || decel > T.brake });
    }
    // Gone from sight: their state goes, their delay is kept (a few thousand at most).
    for (const id of this.cars.keys()) if (!seen.has(id)) this.cars.delete(id);
    // Through the junction (or gone): its claim goes.
    for (const [node, box] of this.claims) {
      for (const [id, cl] of box) { const st = this.cars.get(id); if (!st || st.d > cl.out || st.hit) box.delete(id); }
      if (!box.size) this.claims.delete(node);
    }
    if (this.delays.size > 5000) this.delays.delete(this.delays.keys().next().value);
    return { cars: out, hits };
  }
  //: The lane a car takes on the block it is on (people.mjs chooseLane): for the turn to come,
  //: and the least crowded; one lane over at a time, and only into a gap there.
  pickLane(c, st, lanesOn, blockers = []) {
    const route = c.route, i = segOf(route, st.d), n = laneCount(route, i);
    if (n <= 1) { st.lane = st.from = 0; return; }
    const cur = Math.min(st.lane, n - 1), here = st.d - route.s[i], others = lanesOn.get(edgeKey(route, i)) || [];
    const crowd = new Array(n).fill(0);
    for (const o of others) {
      if (o.id === c.id) continue;
      const ahead = o.along - here;
      if (ahead < -8 || ahead > 80) continue;
      crowd[Math.min(o.lane, n - 1)] += o.v < 0.5 ? 2 : 1;
    }
    // What stands in a lane with no route of its own (a bus at its stop, your car): heavy.
    const [ax, az] = route.pts[i], [bx, bz] = route.pts[i + 1], L = Math.hypot(bx - ax, bz - az) || 1, ux = (bx - ax) / L, uz = (bz - az) / L;
    const half = route.halves?.[i] ?? 0, cls = route.classes?.[i], park = route.parks?.[i] ?? null;
    for (const b of blockers) {
      const along = (b.x - ax) * ux + (b.z - az) * uz - here, off = (b.x - ax) * -uz + (b.z - az) * ux;
      if (along < -6 || along > 60) continue;
      let j = 0, best = Infinity;
      for (let k = 0; k < n; k += 1) { const g = Math.abs(laneOffset(half, cls, park, i, route, k) - off); if (g < best) { best = g; j = k; } }
      if (best < 1.6) crowd[j] += (b.v || 0) < 0.5 ? 4 : 1;
    }
    const turn = turnAhead(route, i, (node) => junctionAt(this.streets, node) !== null);
    const want = chooseLane({ n, cur, turn, crowd });
    st.waiting = false;
    if (want === cur) { st.lane = st.from = cur; return; }
    const next = cur + Math.sign(want - cur);
    for (const o of others) {
      if (o.id === c.id || (o.lane !== next && o.from !== next)) continue;
      const gap = o.along - here;
      if (gap > -((c.length + o.length) / 2 + 2 + o.v) && gap < (c.length + o.length) / 2 + 3) {
        st.waiting = Boolean(turn && (turn.blocks === 0 || turn.dist < 90));
        return;
      }
    }
    st.from = cur; st.lane = next; st.lt = 0;
  }
  //: Where a car's leg is over: half a metre short of its end, or at the stop line of a junction
  //: it ends at.
  endOf(c) {
    const r = c.route, last = r.ids?.[r.ids.length - 1];
    const L = r.length - (last !== undefined && junctionAt(this.streets, last) ? this.stopLine(last, c) : 0.5);
    return Math.max(Math.min(r.length - 0.5, 1), L);
  }
  //: How far out from a junction's node its box reaches: the widest street there, and a step.
  boxOf(node) {
    let box = this.boxes.get(node);
    if (box === undefined) { box = Math.max(3, ...this.streets.edges[node].map((e) => e.half || 0)) + 1.5; this.boxes.set(node, box); }
    return box;
  }
  //: Where a car waits for a light, a stop sign or its turn: its middle so far back from the node
  //: that its nose is short of the crosswalk (the pavement's line carried over the road, PAVE_M
  //: out from the street across's kerb) -- not on it, nor in the junction, where a car turning
  //: across its way would have to go through it.
  stopLine(node, c) { return Math.max(this.T.stop_line_m, this.boxOf(node) - 1.5 + PAVE_M + 1.6 + c.length / 2); }
  //: The junction a car is coming up to or in (its leg's next one with a light or a stop sign,
  //: within sight, until its back is out of the far side): the node, its distance along the leg,
  //: the size of its box, the way in and the way out (unit vectors, x east, z south).
  junctionAhead(c, st) {
    const { s, ids, pts } = c.route;
    if (!ids) return null;
    for (let i = 1; i < s.length - 1; i += 1) {
      const ahead = s[i] - st.d;
      if (ahead > this.T.look_m) return null;
      const kind = junctionAt(this.streets, ids[i]);
      if (!kind) continue;
      const box = this.boxOf(ids[i]);
      if (ahead < -(box + c.length / 2)) continue;
      const u = (a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1; return [dx / L, dz / L]; };
      const inU = u(pts[i - 1], pts[i]), outU = u(pts[i], pts[i + 1]);
      // Its way through, as it is driven (alongRoute rounds the corner: a right turn swings out a
      // little from its lanes' corner), from the box's near edge to its far one.
      // (In the lane the car is in: two cars side by side take different ways through.)
      const paths = (c.route._paths ??= new Map()), changing = st?.lt < 1, pk = `${i}:${st?.lane ?? "k"}`;
      let path = changing ? null : paths.get(pk);
      if (!path) {
        path = [];
        const a = Math.max(0, s[i] - box), b = Math.min(c.route.length, s[i] + box), side = st?.side || KERB;
        for (let k = 0; k <= 12; k += 1) { const q = alongRoute(c.route, a + ((b - a) * k) / 12, side); path.push([q.x, q.z]); }
        if (!changing) paths.set(pk, path);
      }
      return { node: ids[i], kind, s: s[i], box, inU, outU, path };
    }
    return null;
  }
  //: Whether the queue ``id`` waits in is held at its head by something to wait for (a light, a
  //: stop sign, someone in the road, you): false for a ring of cars, or a head that is not held.
  heldAtHead(id) {
    const seen = new Set();
    for (let at = this.cars.get(id); at; at = this.cars.get(at.leader)) {
      if (seen.has(at)) return false;
      seen.add(at);
      if (at.reason !== "the car ahead") return Boolean(at.reason && at.v < 0.5);
      if (!at.leader) return false;
    }
    return false;
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
