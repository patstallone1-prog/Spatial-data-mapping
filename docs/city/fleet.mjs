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

import { arrivalsAt } from "./transit.mjs";
import { STEADY_STYLE, timeToMeet } from "./temperament.mjs";
import { VEHICLE_DIMS } from "./vehicles.mjs";
import {
  BIKE_LANE, CLOTHES, COUNTER_ROLES, INDOOR_REACH_M, LONG_VEHICLE_M, SPEED_MS, TRAFFIC_BY_HOUR, alongRoute, turnLead, daySchedule, densityAt, distToSegment, hash32, indoorSpot, rng,
  shopCapacity, shopLanes,
  DRIVE_LANE, LANE, PAVE_M, chooseLane, laneCount, laneOffset, lanePlan, paveOffset, pavementRoute, shopSeen, turnAhead, workplacesByRole,
  JUNCTION_SPAN_M,
} from "./people.mjs";
import { householdsFor } from "./households.mjs";
import { isRunner } from "./wardrobe.mjs";
import { booksOf, careerOf, weekdayOfDay } from "./npc-economy.mjs";
import { TASKS, dayPlan, milestonesOf, routineType } from "./routines.mjs";
import { homePrices, neighbourhoodAt, unitsOf } from "./market.mjs";
import { NpcContextIndex } from "./npc-context.mjs";
import { SIDELINE_MAX, courtSession, playPose, playersOf, sidelinePose, sportOf } from "./sports.mjs";

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
  // Someone who lives outside the district and works outside it, seen only as they drive through
  // on their way, once a game day (Roster.commutersUpTo): never drawn by the share above.
  { kind: "commuter", title: "Commuter", share: 0, trips: [1, 1], stop: [0, 0, 0], models: [["economy", 0.28], ["sedan", 0.26], ["suv", 0.22], ["compact_ev", 0.16], ["pickup", 0.06], ["sports", 0.02]] },
];
// Shared by the street itinerary and the city service desk. Only this shop and
// this game-day booking can authorize this visitor's NPC-funded repair.
export function serviceBooking(region, person, day, shop) {
  if (!person.visitor || person.kind !== "private") return null;
  const r = rng(region, person.id, day, String(shop), "service booking");
  if (r() >= 1/24) return null;
  return { at: (8 + r()*7)*60, dwell: 65 + r()*35, visit:String(shop), service:true };
}
export const ROLE_VEHICLE = { police: "patrol", taxi_driver: "taxi", delivery_driver: "delivery_van", street_cleaner: "box_truck" };
//: A car's lane: right of the street's middle, clear of the cars parked at its kerb, and the lane
//: for the turn ahead on a street of more than one each way (people.mjs DRIVE_LANE).
const KERB = DRIVE_LANE;
//: How far apart (m) a through trip's way in and way out are, at the least, where they can be.
const THROUGH_MIN_M = 600;
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
//: Width and length of each model, as the page draws it (vehicles.mjs VEHICLE_DIMS: the imported
//: fleet's own measured sizes, the rest a common car of the kind) -- a car takes the kerb its own
//: length needs, so a pickup is not put where only a hatchback fits.
const VEHICLE_W = Object.fromEntries(Object.entries(VEHICLE_DIMS).map(([k, d]) => [k, d[0]]));
const VEHICLE_L = Object.fromEntries(Object.entries(VEHICLE_DIMS).map(([k, d]) => [k, d[2]]));
//: The kerb a car of ``model`` needs between the cars either side of it: its length and the gap
//: kept at each end (PARKING.gap_m, to pull out). A space shorter is not offered it (clashes).
//: The racks are filed by cells this wide (m) for finding the nearest.
const RACK_CELL_M = 25;
//: How far from the door a rider will lock up (m): about a minute's walk back.
const BIKE_RACK_WALK_M = 60;
//: A bicycle leant on a wall: how far its line is from the wall (m), and how far along the wall
//: from a door's middle its own middle is at the least (half a doorway and half a bicycle).
export const BIKE_LEAN = { off: 0.28, clear: 1.5 };
export const kerbRunFor = (model) => (VEHICLE_L[model] || VEHICLE_L.sedan) + 2 * PARKING.gap_m;
//: The old way's spots (legacySpot: no kerb drawn) are a fixed pitch along the street: the
//: longest that parks at a kerb (the box truck), so whatever stands in one fits it.
const LEGACY_PITCH_M = Math.max(...["economy", "compact_ev", "sedan", "suv", "pickup", "delivery_van", "box_truck", "taxi", "patrol", "sports"].map((m) => VEHICLE_L[m] || 0)) + PARKING.gap_m;
const DRIVE_MIN_M = 700;
//: A resident with a bicycle rides anything further than this (and walks the rest), at about
//: this speed; the bicycle is 1.8 m long and 0.65 m across the bars.
export const BIKE_TRANSIT_SHARE = 0.33;
export const BIKE_MIN_M = 600, BIKE_MS = 4.8, BIKE_TOP_MS = 5.6, BIKE_DIMS = [0.65, 1.1, 1.8];
//: The most residents of one building kept (whole households; households.mjs): the rest of a big
//: block's flats are not followed, to keep a district's thousands within a frame.
export const HOME_CAP = 6;
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
//: One in this many takes a break out of doors.
export const BREAK_OUTSIDE_OF = 5;
//: ... and of a large place's people no more than this many in a day: a fifth of a depot's
//: hundred and sixty stood thirty-two at one doorway at lunchtime (measured 2026-11-21).
export const BREAK_OUTSIDE_MOST = 7;
//: Someone whose work is a round on foot (letters, a beat) keeps to a patch of their own this far
//: from the place they work from (m): all started from its door, ten and more on one corner.
export const BEAT_M = [140, 420];
//: Up to this speed one of the city's drivers stops dead for one of its walkers (about 15 mph).
export const NPC_STOP_DEAD_MS = 7;
//: The longest a frame's slice of the district scan may run (ms).
export const SCAN_SLICE_MS = 10, SCAN_FIRST_SLICE_MS = 60;
//: Someone out on a break stands at least this far back from the kerb (m).
export const BREAK_KERB_M = 1.0;
export const tripMinutes = (metres, speed) => (metres * 1.32 / speed + 20) / 60;
//: A shop full (people.mjs shopCapacity): a customer who finds it so waits outside in a short
//: line along the front by the door (at most ``queue_len`` of them, ``queue_step_m`` apart, for
//: ``queue_wait_min`` at most), else goes to another shop that does the same within ``alt_m``
//: (on foot), else comes later (staying where they were up to ``later_min``), else gives it up
//: and looks in the windows round about instead. Nobody is let in past the shop's capacity, and
//: each customer in it has a lane of the floor of their own (City.admit).
//: How a walk is kept off the roadway (City.legalize): looked at every ``step_m`` along it; a
//: stretch of roadway by a crossing is that crossing's when it is ``kerb_m`` or less (the
//: crossing is grown over it, so the wait is at the kerb; ``grow_m`` where no pavement is found); one up to ``mouth_m`` long with pavement either end is the mouth of a side
//: street or a driveway, walked over; a longer one is moved onto the pavement beside it -- the
//: nearest kerb within ``kerb_reach_m``, ``out_m`` in from it, never an island (roadway again
//: within ``island_m`` beyond), no step of it more than ``hop_m`` from the last.
export const WALK_LEGAL = { step_m: 1, mouth_m: 16, kerb_m: 6, grow_m: 22, kerb_reach_m: 26, out_m: 0.9, island_m: 9, hop_m: 6, every: 2, search_m: 32, spur_gap_m: 2.5, spur_share: 0.45, same_line: 0.82 };
//: How a street's drawn kerb is looked for (City.kerbOffset): at so many points along a stretch,
//: out a step at a time to ``reach_m``; a pavement is ground with no roadway for ``clear_m``.
export const KERB_SCAN = { points: 3, step_m: 0.5, reach_m: 42, clear_m: 9 };
//: How the fronts along a stretch of street are looked for (City.walkOffset): a point every
//: ``every_m`` (``most`` at most), clear of the last ``ends_m`` at each end, stepping out from
//: the kerb ``step_m`` at a time.
//: Car parks: a stall is walked to from this far at most; the grid the stalls are kept in; and
//: the longest car a stall takes.
export const LOT_WALK_M = 70, LOT_CELL_M = 40, LOT_CAR_MAX_M = 5.8;
export const FRONT_SCAN = { every_m: 7, most: 14, ends_m: 9, step_m: 0.3 };
export const SHOP_QUEUE = { queue_len: 4, queue_wait_min: 6, queue_step_m: 0.8, alt_m: 450, later_min: 45, min_stay_min: 5 };
const CUSTOMER_KINDS = new Set(["errand", "meal", "evening"]);
//: The k-th of a shop's staff to a lane of n: spread over the counter rather than bunched at one end.
const spreadLane = (k, n) => { if (n <= 1) return 0; const order = []; for (let s = 0; s < n; s += 1) order.push(s); order.sort((a, b) => Math.abs(a - (n - 1) / 2) - Math.abs(b - (n - 1) / 2) || a - b); return order[k % n]; };

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

//: Whether a household member is one of the redundant (rules.json density.trim): an adult
//: flatmate, or a partner where there are no children, whose trade is one of ``roles`` (the big
//: cohorts sharing one story and voice) and who has none of the parts the district needs.
function redundant(R, T, m, role, hh) {
  if (!(m.age >= 18) || !T.roles?.includes(role)) return false;
  if (m.relation === "flatmate") return true;
  return m.relation === "partner" && !hh.members.some((x) => x.relation === "child");
}

//: How far apart along the pavement by a bus stop's pole its riders wait (m), and how many are in
//: sight there at once: a busy Muni stop at the evening peak has a dozen or so at the pole.
const STOP_SPREAD_M = 6, STOP_WAIT_MAX = 12;
//: Where across the pavement each walker keeps: their own line, this share of the way from the
//: kerb to the pavement's middle line and past it (by their id). Everyone had walked the one line
//: PAVE_M out, so they met in single file, and at each corner all of a block's walkers came to
//: the one point where two lines meet -- a crowd at every corner, pushing to stand apart
//: (Chestnut and Fillmore, 2026-11-21).
const LANE_SPREAD = [0.55, 1.45];
//: A pavement narrower than this kerb to wall (m) is a narrow walk: fewer walk it (rules.json
//: density.narrow_walk_keep, the share of a walk all on one kept), as fewer walk a narrow one.
const NARROW_WALK_W_M = 2.4;
export class Roster {
  constructor(R, { seed = "district", saved = null, toLonLat = null } = {}) {
    this.R = R; this.seed = seed; this.toLonLat = toLonLat;
    this.places = new Map(); this.people = new Map(); this.vehicles = new Map(); this.visitors = new Map(); this.commuters = new Map();
    this.homesDone = new Set(); this.list = []; this.work = {}; this.households = new Map(); this.open = [];
    this.saved = { work: { ...(saved?.work || {}) }, npcGroups: Array.isArray(saved?.npcGroups) ? saved.npcGroups : [] };
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
    // The trades with somewhere to work here (a change of job is to one of them): no drivers of
    // the district's own vehicles, whose cars go with the job.
    const openNow = Object.keys(this.R.jobs.roles).filter((r) => this.work[r]?.length && !ROLE_VEHICLE[r] && !this.R.jobs.roles[r].outdoor && r !== "student").sort();
    if (openNow.join() !== this.open.join()) { this.open = openNow; for (const p of this.people.values()) p.careerDay = null; }
    for (const pl of places) if (pl.use === "residential" && !this.homesDone.has(pl.id)) { this.homesDone.add(pl.id); this.house(pl); }
    for (const p of this.people.values()) if (p.needsWork) this.employ(p);
    this.version += 1;
    return added;
  }
  //: A home's people: its households (households.mjs: sized as the city's are and to the flat
  //: each has), each member a person with their own trade, pace and way of getting about --
  //: on foot and by car where the household has a garage or room at the kerb, on foot and by
  //: bicycle where it has not.
  house(home) {
    const R = this.R, roles = Object.entries(R.jobs.roles).filter(([id]) => id !== "student" && id !== "retiree");
    const total = roles.reduce((s, [, x]) => s + x.share, 0);
    // (A hotspot's passers-by multiplier is for the crowd beyond the residents: on the residents'
    // own days it made nearly everyone run every errand and go out every evening. Capped.)
    const outgoing = Math.min(R.density?.resident_outgoing_max ?? Infinity, this.toLonLat ? densityAt(R, ...this.toLonLat(home.x, home.z), "walkers") : 1);
    const T = R.density?.trim;
    for (const hh of householdsFor(R, home, { cap: R.households?.cap ?? HOME_CAP })) {
      this.households.set(hh.id, hh);
      const cut = new Set();
      for (const m of hh.members) {
        const id = `npc:${home.id}:${m.k}`, r = rng(id, "person");
        // By age: at school, at college (some), a trade by the rules' shares, or retired.
        let x = r() * total, role = roles[0][0];
        for (const [rid, spec] of roles) { x -= spec.share; if (x <= 0) { role = rid; break; } }
        if (m.age < 18) role = "student";
        else if (m.age < 23 && r() < 0.35) role = "student";
        else if (m.age >= 66) role = "retiree";
        const spec = R.jobs.roles[role];
        // The redundant ones are not made (rules.json density.trim): a flatmate, or a partner in a
        // home with no children, in one of the big trades every member of which tells the same
        // story in the same voice (npc-stories.mjs: a cohort's shared backstory), with no part to
        // play the district needs -- no counter to serve at, no round, no vehicle, no school.
        if (T && redundant(R, T, m, role, hh) && hash32(id, "trim") % 1000 < T.share * 1000) { cut.add(m.k); continue; }
        const pace = R.routine.walk_speed_ms[0] + r() * (R.routine.walk_speed_ms[1] - R.routine.walk_speed_ms[0]);
        const height = m.age < 6 ? 0.95 + r() * 0.2 : m.age < 13 ? 1.2 + r() * 0.25 : m.age < 18 ? 1.5 + r() * 0.2 : 1.58 + r() * 0.3;
        const shift = Math.floor(r() * Math.max(1, spec.shifts.length));
        const p = { id, name: `${m.first} ${m.surname}`, role, title: m.age < 5 ? "Child" : spec.title, uniform: spec.uniform || pick(r, CLOTHES),
          home: home.id, hh: hh.id, relation: m.relation, infant: m.age < 5, work: null, needsWork: true, shift, pace: m.age < 10 ? pace * 0.8 : pace, outgoing,
          drives: Boolean(ROLE_VEHICLE[role]) || (m.mode === "drive" && m.age >= 18), height, outdoor: spec.outdoor || null, age: m.age,
          base: { id, role, shift, age: m.age, home: home.id } };
        p.rides = !p.drives && m.mode === "bike";
        this.people.set(id, p);
        this.employ(p);
        if (p.drives) {
          const model = ROLE_VEHICLE[role] || mixPick(rng(id, "car"), PRIVATE_MIX);
          this.vehicles.set(`veh:${id}`, { id: `veh:${id}`, owner: id, model, shade: rng(id, "paint")(), plate: plateOf(id), home: home.id, garage: hh.garage });
          p.car = `veh:${id}`;
        } else if (p.rides) {
          this.vehicles.set(`bike:${id}`, { id: `bike:${id}`, owner: id, model: "bike", bike: true, shade: rng(id, "paint")(), plate: null, home: home.id, garage: false });
          p.bike = `bike:${id}`;
        }
      }
      if (cut.size) { hh.members = hh.members.filter((m) => !cut.has(m.k)); hh.size = hh.members.length; this.trimmed = (this.trimmed || 0) + cut.size; }
    }
  }
  //: Someone's work on ``day`` (npc-economy.mjs careerOf): jobs are left and new ones found, so
  //: their trade, title and workplace are the day's -- set here before the day is planned. (Those
  //: whose job comes with one of the district's vehicles, and the young, keep theirs.)
  today(p, day) {
    if (p.visitor || p.careerDay === day) return p.career || null;
    p.careerDay = day;
    if (!p.base || p.infant || ROLE_VEHICLE[p.base.role] || this.R.jobs.roles[p.base.role]?.outdoor) return (p.career = null);
    const c = careerOf(this.R, p.base, day, { open: this.open });
    p.career = c;
    const role = this.R.jobs.roles[c.role] ? c.role : p.base.role;
    if (role !== p.role) {
      const spec = this.R.jobs.roles[role];
      p.role = role; p.title = c.title || spec.title; p.uniform = spec.uniform || p.uniform; p.outdoor = spec.outdoor || null;
      p.shift = hash32(p.id, role) % Math.max(1, spec.shifts.length);
      p.work = null; p.needsWork = true; p._days = null; p._plans = null;
      this.employ(p);
    }
    return c;
  }
  householdOf(p) { return p.hh ? this.households.get(p.hh) || null : null; }
  //: A job at a real place that does the work: the nearer of three, kept once given (and kept
  //: on this device, so a reload finds them at the same work).
  employ(p) {
    const spec = this.R.jobs.roles[p.role];
    if (spec.at.includes("home")) { p.work = p.home; p.needsWork = false; return; }
    const key = p.base && p.role !== p.base.role ? `${p.id}:${p.role}` : p.id;
    const saved = this.saved.work[key];
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
    this.saved.work[key] = best.id; this.dirty = true;
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
  //: Those who live and work outside the district and drive through it once a game day, on
  //: their way to work or home (rules.json density.commuters): traffic without anyone to keep
  //: track of the rest of the day.
  //:
  //: These are partial people: a row in a table and no more -- a name, a car, a bank balance, and
  //: one of two days. Most drive **through** (in at one edge, out at another). The rest **work
  //: here** (``works_share``): in at the morning rush to the same place every day, the car left
  //: at its kerb till the evening, and out again -- which is what fills a district's parking by
  //: day. None has a home here, a story, a routine or anything to say; from the street each is a
  //: driver seen from the waist up through a windscreen. Their money moves only when something
  //: makes it: a crash they are in is billed to them (``billPartial``), and that is all.
  commutersUpTo(n) {
    const K = VISITOR_KINDS.find((x) => x.kind === "commuter"), works = this.R.density?.commuters?.works_share ?? 0;
    for (let k = this.commuters.size; k < n; k += 1) {
      const id = `commuter:${k}`, r = rng(this.seed, id);
      this.commuters.set(id, { id, name: `${pick(r, FIRST)} ${pick(r, LAST)}`, role: "visitor", kind: "commuter", title: K.title, uniform: pick(r, CLOTHES),
        pace: 1.1 + r() * 0.4, height: 1.56 + r() * 0.34, visitor: true, commuter: true, partial: true, car: `veh:${id}`,
        pattern: hash32(this.seed, id, "pattern") % 1000 < works * 1000 ? "works" : "through", balance: 800 + (hash32(this.seed, id, "balance") % 24000), bills: [] });
      this.vehicles.set(`veh:${id}`, { id: `veh:${id}`, owner: id, model: mixPick(r, K.models), shade: r(), plate: plateOf(id), visitor: true, kind: "commuter" });
    }
  }
  //: A visitor or a commuter by id.
  visitorOf(id) { return this.visitors.get(id) || this.commuters.get(id); }
  //: A partial person made to pay (a crash they were in): taken from their balance, as far as it
  //: goes, and written against them. {paid, owed, balance} -- or null if ``id`` is not one.
  billPartial(id, amount, why, when = null) {
    const p = this.commuters.get(id);
    if (!p || !(amount > 0)) return null;
    const paid = Math.min(p.balance, Math.round(amount)), owed = Math.round(amount) - paid;
    p.balance -= paid;
    p.bills.push({ why, amount: Math.round(amount), paid, owed, when });
    if (p.bills.length > 12) p.bills.shift();
    return { paid, owed, balance: p.balance };
  }
  //: What to keep on this device: who works where.
  toJSON() { return { work: this.saved.work, npcGroups: this.saved.npcGroups }; }
}

// ---- the city: where each is, and how they got there ---------------------------------------------

//: How far out of a wall someone put out of a building stands (m).
export const WALL_CLEAR_M = 0.35;
//: Whether (x, z) is inside ``ring`` ([[x, z], ...], either way round).
export function inRing(ring, x, z) {
  let inside = false;
  // (Read by index, not destructured: asked for everyone near a building every frame, the
  // destructuring made iterators -- 91 MB a second of garbage in the Marina, 2026-11-20.)
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const pi = ring[i], pj = ring[j], xi = pi[0], zi = pi[1], xj = pj[0], zj = pj[1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
//: The nearest point WALL_CLEAR_M outside ``ring`` from (x, z) inside it that ``ok(x, z)`` takes
//: (in no other building), or the nearest outside point at all.
//: (Kept in reused scratch arrays, nearest first by insertion: it is asked for everyone standing
//: in a footprint every frame, and a list of three-number lists a wall each time was 12 MB a
//: second of garbage in the Marina, measured 2026-11-20. Same answers.)
let ringScratch = new Float64Array(3 * 64), ringOrder = new Int32Array(64);
export function outOfRing(ring, x, z, ok = () => true) {
  if (ring.length > ringOrder.length) { ringScratch = new Float64Array(3 * ring.length); ringOrder = new Int32Array(ring.length); }
  const C = ringScratch, O = ringOrder;
  let n = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i], b = ring[(i + 1) % ring.length], ax = a[0], az = a[1], ex = b[0] - ax, ez = b[1] - az, L2 = ex * ex + ez * ez;
    if (L2 < 1e-6) continue;
    const u = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / L2)), qx = ax + ex * u, qz = az + ez * u, L = Math.sqrt(L2);
    let nx = ez / L, nz = -ex / L;
    if (inRing(ring, qx + nx * 0.05, qz + nz * 0.05)) { nx = -nx; nz = -nz; }
    const d = Math.hypot(x - qx, z - qz), o = 3 * n;
    C[o] = d; C[o + 1] = qx + nx * WALL_CLEAR_M; C[o + 2] = qz + nz * WALL_CLEAR_M;
    // Stable insertion by distance (Array.prototype.sort is stable: ties keep wall order).
    let j = n;
    while (j > 0 && C[3 * O[j - 1]] > d) { O[j] = O[j - 1]; j -= 1; }
    O[j] = n; n += 1;
  }
  for (let k = 0; k < n; k += 1) { const o = 3 * O[k], cx = C[o + 1], cz = C[o + 2]; if (!inRing(ring, cx, cz) && ok(cx, cz)) return [cx, cz]; }
  for (let k = 0; k < n; k += 1) { const o = 3 * O[k], cx = C[o + 1], cz = C[o + 2]; if (!inRing(ring, cx, cz)) return [cx, cz]; }
  return null;
}

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
    //: pavementRoute's ``offset``: the pavement's line by what stands along it (walkOffset);
    //: ``frontLines = false`` (tests) puts it back the fixed distance out.
    this.paveLine = (half, where) => (this.frontLines === false ? paveOffset(half) : this.walkOffset(half, where));
    this.setStreets(streets);
  }
  //: Lazily prepare a roster/day's cohorts outside the render loop. `ready` resolves false
  //: if the roster changes during preparation; callers can request again on the next refresh.
  characterContext(person, time, world = null) {
    this._contextIndex ??= new NpcContextIndex(this);
    const index = this._contextIndex;
    const current = index.key === index.rosterKey(time);
    if (current) return { state: "ready", context: index.contextFor(person, time, world), ready: null };
    return { state: "pending", context: null, ready: index.ensure(time) };
  }
  //: The key a car's trip is known by (its delay in traffic is kept under it).
  static legKey(v, leg, day) { return `${v.id}:${day}:${Math.round(leg.t0 * 60)}`; }
  //: Someone's day made again (a car of theirs crashed, or they were hurt).
  forget(id) {
    for (const k of this.plans.keys()) if (k.startsWith(`${id}:`)) this.plans.delete(k);
    // (Their places in the shops given up: the day made again books them again.)
    for (const [k, list] of this.shopBooks || []) this.shopBooks.set(k, list.filter((b) => b.who !== id));
    for (const k of [...(this.admitted?.keys() || [])]) if (k.startsWith(`${id}:`)) this.admitted.delete(k);
  }
  //: A new street graph (more of the district seen): the places' street points again, and every
  //: way and spot worked out again on it. Who is where does not change; only the streets they
  //: take there might.
  //: The district's bus lines (transit.mjs buildLines): residents without a car ride them.
  setLines(lines) {
    const had = this.lines?.length || 0;
    this.lines = lines || [];
    if (had !== this.lines.length) { this.plans = new Map(); this.shopBooks = new Map(); this.admitted = new Map(); }
  }
  setStreets(streets) {
    this.streets = streets;
    streets.setPreferences?.(this.R.traffic);
    for (const pl of this.roster.places.values()) pl.node = streets.nearest(pl.x, pl.z, "walk", 120) ?? pl.node;
    this.plans = new Map(); this.spots = new Map(); this.taken = new Map(); this.lotTaken = new Map(); this.roams = new Map(); this.walkLags = new Map(); this.breakSpots = new Map(); this._gateways = null; this.homeSlots = null;
    this.shopBooks = new Map(); this.admitted = new Map(); this.staffLanes = new Map(); this._footprints = null;
    this._walkOffsets = null;
    this.rackTaken = new Map();
  }
  //: The kerb as the world draws it (the page's): ``kerbAt(x, z)`` -> {x, z, nx, nz, ax, az}
  //: and ``kerbParking(x, z, ax, az, halfLen, kind)`` -> why a car may not stand there, or null.
  //: Set, every spot is found again against it.
  setKerbside(k) { this.kerbside = k || null; this._walkOffsets = null; this.spots = new Map(); this.taken = new Map(); this.plans = new Map(); this.breakSpots?.clear(); this.shopBooks = new Map(); this.admitted = new Map(); this.rackTaken = new Map(); this.lotTaken = new Map(); }
  //: The bicycle racks the world draws (the page's module 21 placeCityBikeRacks: the city's
  //: racks, DataSF), each with its places for a bicycle ({x, z, yaw, lock}). A rider out on an
  //: errand locks up to the nearest with a place free, within BIKE_RACK_WALK_M of the
  //: door; only where none has, the bicycle is left by the door. Set, every bicycle's spot (and
  //: so the days, planned to them) is found again.
  setRacks(racks) {
    this.racks = (racks || []).filter((r) => Number.isFinite(r.x) && Number.isFinite(r.z) && Array.isArray(r.slots) && r.slots.length);
    this.rackGrid = new Map();
    for (const r of this.racks) {
      const key = `${Math.floor(r.x / RACK_CELL_M)}:${Math.floor(r.z / RACK_CELL_M)}`;
      if (!this.rackGrid.has(key)) this.rackGrid.set(key, []);
      this.rackGrid.get(key).push(r);
    }
    this.rackTaken = new Map();
    for (const [key, spot] of this.spots) if (spot?.rack) this.spots.delete(key);
    this.plans = new Map();
  }
  //: The stalls painted in the world's car parks (the page's module 14 cityParkingStalls):
  //: {id, lot, x, z, yaw}. A car going to a place with a stall free within LOT_WALK_M of its
  //: door parks in it, nosed in, one car a stall -- before the kerb is looked at. Set, every
  //: car's spot (and so the days, planned to them) is found again.
  setLots(stalls) {
    this.lots = (stalls || []).filter((q) => Number.isFinite(q.x) && Number.isFinite(q.z) && Number.isFinite(q.yaw));
    this.lotGrid = new Map();
    for (const q of this.lots) {
      const key = `${Math.floor(q.x / LOT_CELL_M)}:${Math.floor(q.z / LOT_CELL_M)}`;
      if (!this.lotGrid.has(key)) this.lotGrid.set(key, []);
      this.lotGrid.get(key).push(q);
    }
    this.lotTaken = new Map();
    for (const [key, spot] of this.spots) if (!spot || spot.lot || spot.stacked) this.spots.delete(key);
    this.plans = new Map();
  }
  //: A stall free in a car park near ``at`` for ``vehicle`` (claimed for it), nearest first, or
  //: null. ``win`` ({day, t0, t1}) is when a visiting car stands there: the stall is its for
  //: that while, and another's at another hour; with none it is the car's for good (where a
  //: resident parks for work). Two cars are never given one stall for the same time.
  lotStall(vehicle, at, win = null, reach = LOT_WALK_M) {
    if (!this.lots?.length || !at || vehicle.bike) return null;
    if ((VEHICLE_L[vehicle.model] || 4.6) > LOT_CAR_MAX_M) return null;   // a bus, a box truck: not in a stall
    const clash = (e) => e.v !== vehicle.id && (!e.win || !win || (e.win.day === win.day && e.win.t0 < win.t1 && win.t0 < e.win.t1));
    let best = null, bestD = reach;
    for (let cx = Math.floor((at.x - reach) / LOT_CELL_M); cx <= Math.floor((at.x + reach) / LOT_CELL_M); cx += 1)
      for (let cz = Math.floor((at.z - reach) / LOT_CELL_M); cz <= Math.floor((at.z + reach) / LOT_CELL_M); cz += 1)
        for (const q of this.lotGrid.get(`${cx}:${cz}`) || []) {
          const d = Math.hypot(q.x - at.x, q.z - at.z);
          if (d >= bestD || this.lotTaken.get(q.id)?.some(clash)) continue;
          bestD = d; best = q;
        }
    if (!best) return null;
    let held = this.lotTaken.get(best.id);
    if (!held) this.lotTaken.set(best.id, held = []);
    // (Yesterday's visitors are gone: their hours are let go.)
    if (win && held.length > 6) for (let i = held.length - 1; i >= 0; i -= 1) if (held[i].win && held[i].win.day < win.day - 1) held.splice(i, 1);
    held.push({ v: vehicle.id, win });
    return best;
  }
  //: Where a bicycle leans by door ``D`` ({x, z, nx, nz}: n points in): against the wall the door
  //: is in, BIKE_LEAN.off out from it, its length along the wall, BIKE_LEAN.clear or more to one
  //: side of the doorway (``k``: which side and how far, by the bicycle) -- at the first such
  //: place that has wall behind it, open pavement under it, and no driveway let down in front
  //: of it (a garage's door). None: close beside the door on the wall, never in front of it.
  bikeLean(D, k = 0) {
    const ox = -D.nx, oz = -D.nz, ax = D.nz, az = -D.nx, yaw = Math.atan2(D.nz, -D.nx);
    const at = (along) => ({ x: D.x + ox * BIKE_LEAN.off + ax * along, z: D.z + oz * BIKE_LEAN.off + az * along, yaw });
    const sign = k < 0 ? -1 : 1, order = [];
    for (let j = 0; j < 5; j += 1) order.push(sign * (BIKE_LEAN.clear + (Math.abs(k) % 3) * 0.3 + j * 0.9), -sign * (BIKE_LEAN.clear + j * 0.9));
    for (const along of order) {
      const p = at(along);
      if (this.guardWalls !== false && this.footprintAt) {
        if (this.footprintAt(p.x, p.z) || this.footprintAt(p.x + ax * 0.8, p.z + az * 0.8) || this.footprintAt(p.x - ax * 0.8, p.z - az * 0.8)) continue;   // in a wall, or round a corner into one
        if (!this.footprintAt(p.x - ox * (BIKE_LEAN.off + 0.35), p.z - oz * (BIKE_LEAN.off + 0.35))) continue;   // nothing to lean on
      }
      const kerb = this.kerbside?.kerbAt?.(p.x, p.z);
      if (kerb && this.kerbside.kerbParking && /driveway/.test(this.kerbside.kerbParking(kerb.x, kerb.z, kerb.ax, kerb.az, 1.0, "bike") || "")) continue;
      return p;
    }
    return at(sign * BIKE_LEAN.clear);
  }
  //: A place free at a rack near ``at`` for ``vehicle`` (claimed for it), or null.
  rackSlot(vehicle, at) {
    if (!this.racks?.length || !at) return null;
    const reach = BIKE_RACK_WALK_M, near = [];
    for (let cx = Math.floor((at.x - reach) / RACK_CELL_M); cx <= Math.floor((at.x + reach) / RACK_CELL_M); cx += 1)
      for (let cz = Math.floor((at.z - reach) / RACK_CELL_M); cz <= Math.floor((at.z + reach) / RACK_CELL_M); cz += 1)
        for (const r of this.rackGrid.get(`${cx}:${cz}`) || []) {
          const d = Math.hypot(r.x - at.x, r.z - at.z);
          if (d <= reach) near.push({ r, d });
        }
    near.sort((a, b) => a.d - b.d);
    for (const { r } of near) for (let i = 0; i < r.slots.length; i += 1) {
      const key = `${r.id}:${i}`;
      if (this.rackTaken.has(key)) continue;
      this.rackTaken.set(key, vehicle.id);
      return { ...r.slots[i], rack: r.id };
    }
    return null;
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
    // Which gates traffic can come in by (a way leads on from it) and which it can leave by (a
    // way leads to it): a one-way street's end is one or the other, not both. (Trips were
    // started at any gate: from a one-way's far end there was no lawful way in.)
    this._gateIn = new Set(this._gateways.filter((g) => s.edges[g].some((e) => e.drive)));
    this._gateOut = new Set(this._gateways.filter((g) => s.edges[g].some((e) => s.edges[e.to].some((q) => q.to === g && q.drive))));
    return this._gateways;
  }
  //: The gates of ``gates`` a trip can start at (``way`` "in") or end at ("out").
  gatesFor(gates, way) {
    this.gateways;
    const set = way === "in" ? this._gateIn : this._gateOut, list = gates.filter((g) => set.has(g));
    return list.length ? list : gates;
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
    // A street's end is one way in however many of its points lie at the edge: where a street
    // runs along the district's edge (Lombard's last blocks, Marina Boulevard) every point of it
    // was a gate at the street's full weight, and that end sent out ten times its traffic --
    // Lombard two to one eastbound (measured 2026-11-21). Each gate's weight is shared among
    // the gates of the same street within 150 m of it.
    this._gateShare ??= new Map();
    const shareOf = (g) => {
      let s = this._gateShare.get(g);
      if (s === undefined) {
        const name = this.gateInfo(g).name, N = this.streets.nodes[g];
        const near = name ? this.gateways.filter((o) => this.gateInfo(o).name === name && Math.hypot(this.streets.nodes[o].x - N.x, this.streets.nodes[o].z - N.z) < 150).length : 1;
        s = 1 / Math.max(1, near); this._gateShare.set(g, s);
      }
      return s;
    };
    const w = gates.map((g) => this.gateInfo(g).weight * shareOf(g)), total = w.reduce((a, b) => a + b, 0);
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
    // (In by an end traffic comes in at, out by one it leaves at: the farthest such two.)
    this.gateways;
    // One way along it or the other, at the toss of a coin: the farthest pair each way (east to
    // west, and west to east; on a street that runs the other way, north and south). Taken as
    // simply the farthest pair, whichever end's gates lay a few metres further out won every
    // time, and Lombard ran two to one eastbound (measured on the real Marina, 2026-11-21).
    const ways = [null, null];
    for (const a of c.gates) for (const b of c.gates) {
      if (a === b || !this._gateIn.has(a) || !this._gateOut.has(b)) continue;
      const dx = N(b).x - N(a).x, dz = N(b).z - N(a).z, d = Math.hypot(dx, dz) * (0.75 + 0.5 * r());
      const k = (Math.abs(dx) >= Math.abs(dz) ? dx : dz) >= 0 ? 0 : 1;
      if (!ways[k] || d > ways[k].d) ways[k] = { a, b, d };
    }
    const far = Math.max(ways[0]?.d || 0, ways[1]?.d || 0);
    const open = ways.filter((w) => w && w.d >= far * 0.6);
    const best = open.length ? open[Math.floor(r() * open.length) % open.length] : null;
    return best ? [best.a, best.b] : null;
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
    // A stall kept from an earlier visit is theirs again only if no other car has it for these
    // hours: else another is found.
    if (spot && spot.lot && win) {
      const held = this.lotTaken.get(spot.stall) || [];
      const over = (e) => !e.win || (e.win.day === win.day && e.win.t0 < win.t1 && win.t0 < e.win.t1);
      if (held.some((e) => e.v !== vehicle.id && over(e))) { this.spots.delete(key); spot = undefined; }
      else if (!held.some((e) => e.v === vehicle.id && (!e.win || (e.win.day === win.day && e.win.t0 === win.t0)))) { held.push({ v: vehicle.id, win }); this.lotTaken.set(spot.stall, held); }
    }
    if (spot !== undefined) {
      if (spot && win && spot.held && !spot.garage) this.take(spot.x, spot.z, 0, 0, spot.halfLen, win);
      return spot;
    }
    const s = this.streets, place = typeof placeId === "number" ? null : this.roster.places.get(placeId);
    const nodeId = typeof placeId === "number" ? placeId : place ? s.nearest(place.x, place.z, "kerb", 200) : null;
    if (nodeId === null || nodeId === undefined) return null;
    if (vehicle.bike && place) {
      // A bicycle stands on the pavement by the door (a step out from it, along the wall by
      // whose it is), not at the kerb among the cars.
      const D = place.door || place.front, k = (hash32(vehicle.id) % 7) - 3;
      // Out on an errand, locked to a rack near the door where one has room (setRacks); at home
      // it is kept by the door.
      const slot = placeId !== vehicle.home ? this.rackSlot(vehicle, D || place) : null;
      if (slot) {
        spot = { garage: false, gateway: false, rack: true, locked: true, rackId: slot.rack, node: nodeId, x: slot.x, z: slot.z, yaw: slot.yaw, lock: slot.lock, door: { x: slot.x, z: slot.z }, place: placeId };
        this.spots.set(key, spot);
        return spot;
      }
      // At home it is taken indoors (not drawn while it is there: its rides begin and end at
      // the door).
      if (placeId === vehicle.home && D && D.nx !== undefined) {
        const step = { x: D.x - D.nx * DOOR_STEP_M, z: D.z - D.nz * DOOR_STEP_M };
        spot = { garage: false, gateway: false, rack: true, indoors: true, node: nodeId, x: step.x, z: step.z, yaw: Math.atan2(D.nz, -D.nx), door: step, place: placeId };
        this.spots.set(key, spot);
        return spot;
      }
      // With no rack in reach: leant against the building's wall beside the door -- along the
      // wall, a hand off it, clear of the doorway and of any driveway or garage (bikeLean).
      // It stood a step out in the pavement, as often as not in front of the door.
      const at = D && D.nx !== undefined ? this.bikeLean(D, k) : { x: place.x + k * 0.5, z: place.z, yaw: 0 };
      spot = { garage: false, gateway: false, rack: true, leaning: Boolean(D && D.nx !== undefined), node: nodeId, x: at.x, z: at.z, yaw: at.yaw, door: { x: at.x, z: at.z }, place: placeId };
      this.spots.set(key, spot);
      return spot;
    }
    const garage = Boolean(place && vehicle.garage && placeId === vehicle.home);
    let edges = s.edges[nodeId].filter((e) => e.drive).sort((a, b) => a.to - b.to);
    // In a car park by the door, where there is one with a stall free: nosed into the stall.
    if (place && !garage) {
      const D = place.door || place.front || place, stall = this.lotStall(vehicle, D, placeId === vehicle.home ? null : win);
      if (stall) {
        const node = s.nearest(stall.x, stall.z, "drive", 160) ?? nodeId;
        spot = { garage: false, gateway: false, lot: true, stall: stall.id, node, x: stall.x, z: stall.z, yaw: stall.yaw, door: { x: stall.x, z: stall.z }, place: placeId };
        this.spotStats = this.spotStats || { kerb: 0, garage: 0, none: 0, legacy: 0 };
        this.spotStats.lot = (this.spotStats.lot || 0) + 1;
        this.spots.set(key, spot);
        return spot;
      }
    }
    // A place whose nearest corner no street runs from (the end of a car park's aisle, a path's
    // end): the kerb is looked for from the nearest corner a street does run from. Every car
    // for such a place was stood on that one corner, one inside another (2026-11-17).
    let kerbNode = nodeId;
    if (place && !garage && !edges.length) {
      const other = s.nearest(place.x, place.z, "drive", 260);
      const there = other === null || other === undefined ? [] : s.edges[other].filter((e) => e.drive).sort((a, b) => a.to - b.to);
      if (there.length) { kerbNode = other; edges = there; }
    }
    const n = s.nodes[nodeId];
    if (place && !garage && !edges.length) {
      // No street to stand on anywhere near: at home the car is kept in (a garage, as most
      // Marina homes have); anywhere else the place is not driven to.
      if (placeId === vehicle.home) {
        const door = place.front ? { x: place.front.x, z: place.front.z } : { x: place.x, z: place.z };
        spot = { garage: true, gateway: false, node: nodeId, x: door.x, z: door.z, yaw: 0, door, place: placeId, full: true };
      } else { this.spots.set(key, null); return null; }
    } else if (garage || !edges.length || typeof placeId === "number") {
      const door = place?.front ? { x: place.front.x, z: place.front.z } : place ? { x: place.x, z: place.z } : { x: n.x, z: n.z };
      spot = { garage, gateway: typeof placeId === "number", node: nodeId, x: garage ? door.x : n.x, z: garage ? door.z : n.z, yaw: 0, door, place: placeId };
    } else {
      spot = this.kerbSpot(vehicle, placeId, kerbNode, win);
      this.spotStats = this.spotStats || { kerb: 0, garage: 0, none: 0, legacy: 0 };
      if (spot) this.spotStats.kerb += 1;
      else if (!this.kerbside) { spot = this.legacySpot(vehicle, placeId, kerbNode, edges); this.spotStats.legacy += 1; }
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
    const room = Math.max(1, len - 10), along = 5 + ((k * LEGACY_PITCH_M) % room);
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
  //: Both cars' own half-lengths: the space between two parked cars is offered only to a car
  //: that fits it with the gap kept at each end (kerbRunFor), a hatchback where a pickup is not.
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
    const pts = [], halves = [], classes = [], ids = [], parks = [], lanes = [], oneways = [], bikes = [], twins = [];
    // (Each point's own street: its width, class, kerb, lanes each way and bike lane -- a trip
    // that dropped the lanes drove every street in its kerb lane, six-lane Lombard too: 2026-11-13.)
    const push = (x, z, half, cls, id = -1, park = null, lane = 2, oneway = false, bike = null, twin = null) => { pts.push([x, z]); halves.push(half); classes.push(cls); ids.push(id); parks.push(park); lanes.push(lane); oneways.push(oneway); bikes.push(bike); twins.push(twin); };
    let start = a.node;
    // Streets that do not hang together (two pieces of the district): no way between that is
    // seen; the car goes out of sight between them.
    if (this.netOf(a.node) !== this.netOf(b.node)) { leg.route = null; return null; }
    // A spot with no street way beside it (a garage, the district's edge, or a place whose
    // nearest kerb has no drivable way once the streets were seen again): from its own point.
    if (a.garage || a.gateway || !a.edge) push(a.door?.x ?? a.x, a.door?.z ?? a.z, 3, "service");
    else { push(a.cx, a.cz, a.edge.half, a.edge.cls, -1, a.edge.park ?? null); start = a.edge.to; }
    const mid = s.route(start, b.node, "drive");
    if (mid) for (let i = 0; i < mid.pts.length; i += 1) push(mid.pts[i][0], mid.pts[i][1], mid.halves[i] ?? mid.halves[i - 1] ?? 3, mid.classes[i] ?? mid.classes[i - 1] ?? "residential", mid.ids?.[i] ?? -1, mid.parks?.[i] ?? mid.parks?.[i - 1] ?? null,
      mid.lanes?.[i] ?? mid.lanes?.[i - 1] ?? 2, mid.oneways?.[i] ?? mid.oneways?.[i - 1] ?? false, mid.bikes?.[i] ?? mid.bikes?.[i - 1] ?? null, mid.twins?.[i] ?? mid.twins?.[i - 1] ?? null);
    else { const n = s.nodes[b.node]; push(n.x, n.z, 3, "residential", b.node); }
    if (b.garage || b.gateway || !b.edge) push(b.door?.x ?? b.x, b.door?.z ?? b.z, 3, "service");
    else push(b.cx, b.cz, b.edge.half, b.edge.cls, -1, b.edge.park ?? null);
    const S = [0];
    for (let i = 1; i < pts.length; i += 1) S.push(S[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    // Its spots at the kerb at each end: pulled out of and in to (view.mjs eases the car there).
    leg.route = { pts, s: S, halves, classes, parks, ids, lanes, oneways, bikes, twins, length: S[S.length - 1], mode: "drive", bike: Boolean(v?.bike),
      startSpot: (a.edge && !a.garage) || a.lot ? { x: a.x, z: a.z, yaw: a.yaw } : a.locked ? { x: a.x, z: a.z, yaw: a.yaw, lock: a.lock } : null,
      endSpot: (b.edge && !b.garage) || b.lot ? { x: b.x, z: b.z, yaw: b.yaw } : b.locked ? { x: b.x, z: b.z, yaw: b.yaw, lock: b.lock } : null };
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
    if (!p.visitor) this.roster.today?.(p, t.day);
    plan = p.visitor ? this.visitorPlan(p, t) : this.residentPlan(p, t);
    if (this.plans.size > 120000) this.plans.delete(this.plans.keys().next().value);
    this.plans.set(key, plan);
    return plan;
  }
  residentPlan(p, t) {
    const R = this.R, places = this.roster.places, segs = [];
    // (The very young are at home; a parent's day is theirs.)
    if (p.infant) return { segs: [{ kind: "stay", t0: 0, t1: 1441, place: p.home, act: { kind: "home", start: 0, end: 1441, place: p.home, label: "At home" } }], drives: [], start: null };
    // The day by the kind of day it is (routines.mjs: a shift worker's, a parent's, a retiree's,
    // someone looking for work...), each stop a task; the old one template where the rules say.
    const hh = this.roster.householdOf?.(p) || null;
    // (The fuller days have about three stops for every one the old template had: the optional
    // ones -- not work, school or the school run -- are kept by the rules' share, so the streets
    // carry about what they did; rules.json routine.task_keep.)
    const keep = R.routine.task_keep ?? 0.5, must = /^school_/;
    const sched = (R.routine.planner === "legacy" ? daySchedule(R, p, t.day, t.weekday, this.roster.list)
      : dayPlan(R, p, t.day, t.weekday, this.roster.list, { household: hh, career: p.career || null })
        .filter((a) => !a.task || must.test(a.task) || a.place === p.home || a.place === p.work || rng(p.id, t.day, "keep", Math.round(a.start))() < keep)
    // The day is planned in game minutes (a shift 9 to 5 by the game's clock) and travelled in
    // real ones (clock.mjs fleetTime): each stop's start and end carried into the fleet's minutes,
    // the journeys between them as long as they really take.
    ).map((a) => (t.toFleet ? { ...a, start: t.toFleet(a.start), end: t.toFleet(a.end), gameStart: a.start, gameEnd: a.end } : a));
    // What they go by, further than a walk: their car, or their bicycle.
    const v = p.car ? this.roster.vehicles.get(p.car) : p.bike ? this.roster.vehicles.get(p.bike) : null;
    const farM = v?.bike ? BIKE_MIN_M : DRIVE_MIN_M, vMs = v?.bike ? BIKE_MS : DRIVE_MS;
    const dayStart = t.ms - t.minute * 60_000;
    const carFree = (minute) => { const h = v && this.harm(v.id, dayStart + minute * 60_000); return v && !(h && h.out); };
    const dist = (a, b) => { const A = places.get(a), B = places.get(b); return A && B ? Math.hypot(A.x - B.x, A.z - B.z) : 0; };
    // The car where the night left it: at work for a night shift driven to, else at home.
    const startAt = v ? (sched[0]?.kind === "work" && sched[0].start === 0 && dist(p.home, p.work) > farM ? p.work : p.home) : null;
    let carAt = startAt, clock = 0;
    const go = (from, to, depart, mode) => {
      const m = dist(from, to), dur = tripMinutes(m, mode === "drive" ? vMs : p.pace);
      const seg = { kind: "go", t0: depart, t1: depart + dur, from, to, mode, vehicle: mode === "drive" ? v.id : null, bike: mode === "drive" && Boolean(v.bike) };
      segs.push(seg); clock = seg.t1;
      if (mode === "drive") carAt = to;
      return seg;
    };
    // Too far to walk and no car to take: the bus where a line serves both ends, a taxi some of
    // the time (and on a long way no bus serves), else on foot (rules.json transit_lines.npc).
    const N = R.transit_lines?.npc;
    const travel = (from, to, depart) => {
      // (The bus is worth it over a shorter way than a cab is: ``bus_m`` and ``far_m``.)
      if (N && dist(from, to) > (N.bus_m ?? N.far_m)) {
        const r = rng(p.id, t.day, "ride", Math.round(depart));
        const cab = dist(from, to) > N.far_m && r() < N.taxi_share ? this.taxiTrip(p, from, to, depart, t) : null;
        // (The bus first where a line serves both ends; with none, on foot unless it is a
        // long way -- then a cab.)
        const ride = cab || this.busTrip(p, from, to, depart, dayStart) || (dist(from, to) > (N.walk_max_m ?? 2200) ? this.taxiTrip(p, from, to, depart, t) : null);
        if (ride) { segs.push(...ride); clock = ride[ride.length - 1].t1; return; }
      }
      go(from, to, depart, "walk");
    };
    let prev = null;
    for (const a of sched) {
      if (prev && prev.place !== a.place && places.has(prev.place) && places.has(a.place)) {
        // (By bicycle a long way is sometimes not ridden: the bus or a cab instead, about a
        // third of the time over the rules' far distance -- the buses keep their riders.)
        const span = dist(prev.place, a.place), leave = Math.max(prev.end, clock);
        const transit = v?.bike && N && span > N.far_m && rng(p.id, t.day, "transit", Math.round(leave))() < BIKE_TRANSIT_SHARE;
        const far = span > farM, rides = v && carAt === prev.place && far && !transit;
        // Away in time to be there by its start (the day's milestone), not as soon as the last
        // thing is done: until then they are where they were.
        const need = tripMinutes(dist(prev.place, a.place), rides ? vMs : p.pace) + 2;
        // On the game's clock a walk takes game hours: where the next stop wants them sooner than
        // this one ends, they leave this one early (never before it began) to be there on time.
        // (The time they have been there, as far back as they have been: asleep and then up at
        // home are both home.)
        let floor = clock;
        for (let i = segs.length - 1; i >= 0 && segs[i].kind === "stay" && segs[i].place === prev.place; i -= 1) floor = segs[i].t0;
        const earliest = t.toFleet ? Math.max(floor, Math.min(Math.max(prev.end, clock), a.start - need)) : Math.max(prev.end, clock);
        const depart = Math.max(earliest, Math.min(a.start - need, prev.end + 600));
        const last = segs[segs.length - 1];
        if (depart > Math.max(prev.end, clock) && last && last.kind === "stay" && last.place === prev.place && last.t1 < depart) last.t1 = depart;
        if (depart < clock) {
          while (segs.length && segs[segs.length - 1].kind === "stay" && segs[segs.length - 1].place === prev.place && segs[segs.length - 1].t0 >= depart) segs.pop();
          const l = segs[segs.length - 1];
          if (l && l.kind === "stay" && l.place === prev.place && l.t1 > depart) l.t1 = depart;
          clock = depart;
        }
        if (rides && carFree(depart)) go(prev.place, a.place, depart, "drive");
        else if (v && a.place === p.home && carAt !== p.home && carAt !== null && carFree(depart)) {
          // Home by way of the car, wherever it was left.
          if (carAt !== prev.place) go(prev.place, carAt, depart, "walk");
          go(carAt, p.home, clock, "drive");
        } else travel(prev.place, a.place, depart);
      }
      const t0 = Math.max(a.start, clock);
      if (a.end > t0) {
        const roam = a.kind === "stroll" || (a.kind === "work" && a.outdoor);
        segs.push({ kind: roam ? "roam" : "stay", t0, t1: a.end, place: a.place, act: a, drive: roam && a.kind !== "stroll" && p.drives && !v?.bike && !/route|site/.test(a.outdoor || "") && carAt === a.place });
        clock = a.end;
      }
      prev = a;
    }
    segs.sort((x, y) => x.t0 - y.t0);
    // The walks seen. On the game's clock a day is 72 minutes and a walk is as long as it really
    // is, so a day's walking done at once had a third of the district out on the pavements at
    // every hour (8,300 out of doors at 20:00 in the Marina, 2,600 walking at 03:00: measured
    // 2026-11-20). Most walks are out of sight (rules.json density.walks_seen), as most of the
    // through traffic is (``through``); and so is one that would have them out long before the
    // thing it is for -- leaving home in the small hours to be at work by eight
    // (``walk_early_max``, game minutes).
    const WS = this.R.density?.walks_seen;
    if (WS !== undefined && t.toGame) {
      const most = this.R.density?.walk_early_max ?? 240;
      for (let i = 0; i < segs.length; i += 1) {
        const g = segs[i];
        if (g.kind !== "go" || g.mode !== "walk") continue;
        let next = null;
        for (let j = i + 1; j < segs.length; j += 1) if (segs[j].kind !== "go") { next = segs[j]; break; }
        const at = next?.act?.gameStart ?? t.toGame(next ? next.t0 : g.t1);
        g.unseen = at - t.toGame(g.t0) > most || hash32(p.id, t.day, "walk", Math.round(g.t0 * 10)) % 1000 >= WS * 1000;
      }
      // The wait at a bus stop or the kerb for a cab is seen as the walk there is: all of a stop's
      // riders were drawn while most of their walks were not, and 70 stood at the 30's pole at
      // Chestnut and Fillmore at four in the afternoon (2026-11-21).
      for (let i = 1; i < segs.length; i += 1) {
        const g = segs[i], w = segs[i - 1];
        if (g.kind === "go" && g.mode === "wait" && w.kind === "go" && w.mode === "walk") g.unseen = Boolean(w.unseen);
      }
    }
    // In at the shops' doors as far as there is room (each shop's capacity), the rest waiting,
    // going elsewhere, coming later or giving it up.
    this.admitShoppers(p, t.day, segs);
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
  // -- the shops' doors ---------------------------------------------------------------------------
  //: Who is booked into a shop on a day (customers, and those waiting at its door): [{who, t0, t1,
  //: lane | q}], in minutes.
  shopBook(placeId, day) {
    const key = `${placeId}:${day}`;
    let list = this.shopBooks.get(key);
    if (!list) { list = []; this.shopBooks.set(key, list); }
    return list;
  }
  //: The most of ``list`` (in the shop, or waiting: ``which``) there at once over [t0, t1).
  static mostAtOnce(list, t0, t1, which = "in") {
    const ev = [];
    for (const b of list) {
      if ((which === "in") === (b.q !== undefined) || !(b.t0 < t1 && b.t1 > t0)) continue;
      ev.push([Math.max(t0, b.t0), 1], [Math.min(t1, b.t1), -1]);
    }
    ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let n = 0, most = 0;
    for (const [, d] of ev) { n += d; most = Math.max(most, n); }
    return most;
  }
  //: A lane of the shop's floor free over [t0, t1) with room for one more there then, or -1.
  roomIn(place, day, t0, t1, who) {
    const list = this.shopBook(place.id, day), cap = shopCapacity(place);
    if (City.mostAtOnce(list, t0, t1) >= cap) return -1;
    const used = new Set();
    for (const b of list) if (b.q === undefined && b.t0 < t1 && b.t1 > t0) used.add(b.lane);
    // A place on the drawn floor while there is one (shopSeen); after that, further in among
    // the aisles, where nobody is drawn.
    const seen = shopSeen(place), front = [], back = [];
    for (let k = 0; k < cap; k += 1) if (!used.has(k)) (k < seen ? front : back).push(k);
    const free = front.length ? front : back;
    return free.length ? free[hash32(who, place.id, Math.round(t0)) % free.length] : -1;
  }
  //: A place in the line at the door over [t0, t1), or -1.
  queueIn(place, day, t0, t1) {
    const used = new Set();
    for (const b of this.shopBook(place.id, day)) if (b.q !== undefined && b.t0 < t1 && b.t1 > t0) used.add(b.q);
    for (let k = 0; k < SHOP_QUEUE.queue_len; k += 1) if (!used.has(k)) return k;
    return -1;
  }
  //: Where the k-th in the line at a shop's door stands: on the pavement a step out from the
  //: front, along it to one side of the door (not in the doorway), facing the door.
  queueSpot(place, k) {
    const D = (place.door && this.doorOf(place)) || place.front;
    if (!D) return null;
    const out = DOOR_STEP_M + 0.3, tx = -D.nz, tz = D.nx, along = 1.0 + k * SHOP_QUEUE.queue_step_m;
    const x = D.x - D.nx * out + tx * along, z = D.z - D.nz * out + tz * along;
    return { x, z, yaw: Math.atan2(tx, tz) };
  }
  //: The places that would do instead of ``place`` for ``act`` (its task's kinds of shop, or the
  //: place's own), nearest first, within ``alt_m``.
  alternativesTo(place, act) {
    const keys = act.task && TASKS[act.task]?.keys ? TASKS[act.task].keys : (place.shops || []).map((k) => `shop:${k}`);
    if (!keys.length) return [];
    // (The shops by what they do, made once a roster.)
    if (!this._shopsByKey || this._shopsByKeyN !== this.roster.list.length) {
      this._shopsByKey = new Map(); this._shopsByKeyN = this.roster.list.length;
      for (const pl of this.roster.list) if (pl.shops?.length) for (const k of pl.keys || []) { if (!this._shopsByKey.has(k)) this._shopsByKey.set(k, []); this._shopsByKey.get(k).push(pl); }
    }
    const out = [], seen = new Set();
    for (const k of keys) for (const pl of this._shopsByKey.get(k) || []) {
      if (pl === place || seen.has(pl)) continue;
      seen.add(pl);
      const d = Math.hypot(pl.x - place.x, pl.z - place.z);
      if (d <= SHOP_QUEUE.alt_m) out.push([d, pl]);
    }
    return out.sort((a, b) => a[0] - b[0]).map((e) => e[1]);
  }
  //: Each customer's stay in a shop in ``segs`` (a day planned, in order) let in while there is
  //: room. The decisions are kept (``admitted``), so a day planned again comes out the same.
  admitShoppers(p, day, segs) {
    if (this.admitting === false) return;
    const P = this.roster.places;
    for (let i = 0; i < segs.length; i += 1) {
      const S = segs[i];
      if (S.kind !== "stay" || !S.act || !CUSTOMER_KINDS.has(S.act.kind)) continue;
      const place = P.get(S.place);
      if (!place?.shops?.length) continue;
      const key = `${p.id}:${day}:${Math.round(S.t0 * 10)}:${S.place}`;
      let d = this.admitted.get(key);
      if (!d) { d = this.admitOne(p, day, segs, i, place); this.admitted.set(key, d); if (this.admitted.size > 200000) this.admitted.delete(this.admitted.keys().next().value); }
      i += this.applyAdmission(segs, i, d);
    }
  }
  //: What becomes of one customer at the door: {kind: "in" | "queue" | "elsewhere" | "later" |
  //: "gave_up", ...}, booked.
  admitOne(p, day, segs, i, place) {
    const Q = SHOP_QUEUE, S = segs[i], G = segs[i - 1], H = segs[i + 1], P = this.roster.places;
    const book = (pl, t0, t1, lane) => this.shopBook(pl.id, day).push({ who: p.id, t0, t1, lane });
    let lane = this.roomIn(place, day, S.t0, S.t1, p.id);
    if (lane >= 0) { book(place, S.t0, S.t1, lane); return { kind: "in", lane }; }
    // When someone in it now comes out: the times the room might be.
    const outs = (pl, from, to) => this.shopBook(pl.id, day).filter((b) => b.q === undefined && b.t1 > from && b.t1 <= to).map((b) => b.t1).sort((a, b) => a - b);
    // A short wait at the door.
    for (const t of outs(place, S.t0, S.t0 + Q.queue_wait_min)) {
      if (S.t1 - t < Q.min_stay_min) break;
      const k = this.queueIn(place, day, S.t0, t);
      if (k < 0) break;
      lane = this.roomIn(place, day, t, S.t1, p.id);
      if (lane < 0) continue;
      const spot = this.queueSpot(place, k);
      if (!spot) break;
      this.shopBook(place.id, day).push({ who: p.id, t0: S.t0, t1: t, q: k });
      book(place, t, S.t1, lane);
      return { kind: "queue", lane, at: t, k, spot };
    }
    // Another shop that does the same, near, walked to and from (a walk either side, nothing else).
    const walkG = G && G.kind === "go" && G.mode === "walk" && G.to === S.place && !G.ride && !G.toXZ && G.from !== undefined && !G.fromXZ;
    const walkH = !H || (H.kind === "go" && H.mode === "walk" && H.from === S.place && !H.ride && !H.fromXZ && !H.toXZ);
    if (walkG && walkH) {
      const dist = (a, b) => (a && b ? Math.hypot(a.x - b.x, a.z - b.z) : 0);
      for (const alt of this.alternativesTo(place, S.act)) {
        const t0 = G.t0 + tripMinutes(dist(P.get(G.from), alt), p.pace);
        const t1 = H ? H.t1 - tripMinutes(dist(alt, P.get(H.to)), p.pace) : S.t1;
        if (t1 - t0 < Q.min_stay_min || t0 <= G.t0) continue;
        lane = this.roomIn(alt, day, t0, t1, p.id);
        if (lane < 0) continue;
        book(alt, t0, t1, lane);
        return { kind: "elsewhere", lane, place: alt.id, t0, t1 };
      }
    }
    // Later: where they were a while longer, then there.
    const before = segs[i - 2];
    // (Not where they were in another shop: their time there is booked as it is.)
    if (walkG && before && before.kind === "stay" && before.lane === undefined && Math.abs(before.t1 - G.t0) < 1e-6) {
      for (const t of outs(place, S.t0, S.t0 + Q.later_min)) {
        if (S.t1 - t < Q.min_stay_min) break;
        lane = this.roomIn(place, day, t, S.t1, p.id);
        if (lane < 0) continue;
        book(place, t, S.t1, lane);
        return { kind: "later", lane, delay: t - S.t0 };
      }
    }
    return { kind: "gave_up" };
  }
  //: The day changed by a decision at the door (segs[i] the stay): how many segs were put in before it.
  applyAdmission(segs, i, d) {
    const S = segs[i], G = segs[i - 1], H = segs[i + 1];
    if (d.kind === "in") { S.lane = d.lane; return 0; }
    if (d.kind === "queue") {
      const t0 = S.t0;
      S.t0 = d.at; S.lane = d.lane;
      if (G && G.kind === "go" && G.mode === "walk" && G.to === S.place && Math.abs(G.t1 - t0) < 1e-6) { G.toXZ = [d.spot.x, d.spot.z]; G.queue = true; }
      const place = this.roster.places.get(S.place);
      segs.splice(i, 0, { kind: "go", mode: "wait", t0, t1: d.at, at: [d.spot.x, d.spot.z], yaw: d.spot.yaw, place: S.place, queue: d.k,
        label: `waiting to get into ${place?.name || "the shop"} (it is full)` });
      return 1;
    }
    if (d.kind === "elsewhere") {
      G.to = d.place; G.t1 = d.t0;
      S.place = d.place; S.act = { ...S.act, place: d.place, redirected: true }; S.t0 = d.t0; S.t1 = d.t1; S.lane = d.lane;
      if (H) { H.from = d.place; H.t0 = d.t1; }
      return 0;
    }
    if (d.kind === "later") {
      const before = segs[i - 2];
      before.t1 += d.delay; G.t0 += d.delay; G.t1 += d.delay; S.t0 += d.delay; S.lane = d.lane;
      return 0;
    }
    // Full, and no other way: about the shops' windows near it instead, out of doors.
    S.kind = "roam"; S.drive = false; S.act = { kind: "stroll", start: S.t0, place: S.place, label: "Looking in the windows (it was full)", full: true };
    return 0;
  }
  //: A member of a shop's staff's lane along its counter (spread out, one each).
  staffLane(place, p) {
    let m = this.staffLanes.get(place.id);
    if (!m) { m = new Map(); this.staffLanes.set(place.id, m); }
    if (!m.has(p.id)) m.set(p.id, m.size);
    const k = m.get(p.id), n = shopLanes(place.inside);
    return k < n ? { k: spreadLane(k, n) } : { back: true };
  }
  //: What someone is about today, for whoever asks (the People list): their household, their
  //: work and how long they have had it, their money (npc-economy.mjs: pay for the shifts
  //: worked, less rent and spending), what they go by, and the day's milestones -- where they
  //: have to be and by when -- with the next one.
  about(p, t) {
    if (p.visitor) return { visitor: true, kind: p.kind, title: p.title };
    const R = this.R, roster = this.roster, hh = roster.householdOf(p), home = roster.places.get(p.home);
    const plan = this.planOf(p, t), career = p.career || null;
    const type = p.infant ? "infant" : routineType(R, p, { household: hh, career, day: t.day, weekday: t.weekday });
    // (The day's stops as it was planned: the stays, in order.)
    const stops = milestonesOf(plan.segs.filter((s) => s.act).map((s) => ({ ...s.act, start: s.t0 }))).map((m) => ({ ...m, name: roster.places.get(m.place)?.name || null }));
    const next = stops.find((m) => m.at > t.minute) || null;
    // The household's rent (or what its home would let for), by the neighbourhood.
    let rent = null, owns = null;
    if (hh && home && roster.toLonLat) {
      const unit = unitsOf(R, home).find((u) => u.id === hh.unit), hood = unit && neighbourhoodAt(R, ...roster.toLonLat(home.x, home.z));
      if (unit && hood) { const pr = homePrices(R, unit, hood); rent = R.money(pr.rent); if (hh.tenure === "own") owns = R.money(pr.sale); }
    }
    const adults = hh ? Math.max(1, hh.members.filter((m) => m.adult).length) : 1;
    const assets = [];
    const car = p.car && roster.vehicles.get(p.car), bike = p.bike && roster.vehicles.get(p.bike);
    if (car) assets.push({ kind: "car", label: `${R.vehicles?.models?.[car.model]?.name || car.model} ${car.plate}`, value: Math.round((R.vehicles?.models?.[car.model]?.price || 0) * 0.6) });
    if (bike) assets.push({ kind: "bike", label: "Bicycle", value: R.money(450) });
    if (owns && p.relation === "head") assets.push({ kind: "home", label: hh.label ? `Flat ${hh.label}` : "House", value: owns });
    const books = p.base && !p.infant ? booksOf(R, p.base, t.day, weekdayOfDay, { rent: hh?.tenure === "own" ? Math.round((rent || 0) * 0.55) : rent, adults, assets, open: roster.open }) : null;
    return { household: hh ? { id: hh.id, kind: hh.kind, size: hh.size, label: hh.label, beds: hh.beds, tenure: hh.tenure, garage: hh.garage,
      members: hh.members.map((m) => ({ name: `${m.first} ${m.surname}`, relation: m.relation, age: m.age, id: `npc:${p.home}:${m.k}` })) } : null,
      relation: p.relation || null, age: p.age, routine: type, career, books, travel: p.car ? "drive" : p.bike ? "bike" : "walk", milestones: stops, next };
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
    // The dwell at the first stop that reaches the second soonest: the bus going the right way
    // (a timetabled run goes one way only, and does not come round again).
    let leg = null;
    tl.forEach((s, i) => {
      if (s.kind !== "dwell" || s.stop !== best.a) return;
      for (let k = 1; k < tl.length; k += 1) {
        if (line.schedule && i + k >= tl.length) break;
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
    // The next of the line's buses to stand at the stop (transit.mjs: the buses the page draws),
    // one standing there still counted while it has 6 s to go.
    const arrive = arrivalsAt(line, leg.at, atStop + 6, 1)[0]?.at ?? Infinity;
    if (!Number.isFinite(arrive) || arrive - atStop > 15 * 60) return null;
    const toMin = (sec) => (sec - dayStart / 1000) / 60;
    // (A bus already standing at the stop as they come up is got on then, not before they are there.)
    const board = Math.max(toMin(arrive + Math.min(6, (leg.at.t1 - leg.at.t0) / 3)), depart + walkA);
    const off = toMin(arrive + leg.ride + 4);
    const walkB = tripMinutes(Math.hypot(B.x - stopB.x, B.z - stopB.z), p.pace) + 0.2;
    const r = rng(p.id, "stop", Math.round(depart));
    // (On the pavement: a stop the map has out in the roadway is waited for from beside it.)
    // Spread along the pavement by the pole (STOP_SPREAD_M either way along the kerb, and a step
    // to a couple of metres in from it), not all on the one square metre. (Spread round the pole
    // and stood off the road, half of them came to the one point beside the kerb: eight within a
    // metre at the 30's pole at Chestnut and Fillmore, 2026-11-21.)
    const spot = this.stopSpot(stopA, r);
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
    // (A commuter is on the through routes, which are the largest network's.)
    if (p.commuter) net = nets.reduce((a, b) => (b[1].size > a[1].size ? b : a), nets[0]);
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
      // And the homes a caller might be going to: a friend's, a parcel's, a plumber's job.
      this._netHomes ??= new Map();
      this._netHomes.set(net[0], this.roster.list.filter((pl) => pl.use === "residential" && !pl.court
        && pl.x >= box[0] && pl.x <= box[2] && pl.z >= box[1] && pl.z <= box[3] && this.netOf(this.streets.nearest(pl.x, pl.z, "kerb", 200)) === net[0]));
    }
    const homes = this._netHomes?.get(net[0]) || [];
    // When they drive: commuters in the rush hours, deliveries in the working day, ride-hail
    // into the evening, the rest as through traffic does (rules.json traffic.by_hour).
    const H = this.R.traffic?.by_hour || {};
    const curve = (p.kind === "ride_hail" || p.kind === "taxi" ? H.ride_hail : p.kind === "delivery" ? H.delivery : p.commuter || hash32(p.id, "commuter") % 5 < 2 ? H.commute : H.through) || TRAFFIC_BY_HOUR;
    const hourPick = () => { const total = curve.reduce((s, x) => s + x, 0); let x = r() * total; for (let h = 0; h < 24; h += 1) { x -= curve[h]; if (x <= 0) return h; } return 12; };
    // (A commuter keeps to the through routes: Lombard, Marina Boulevard, the avenues.)
    const share = p.commuter ? this.R.density?.commuters?.corridor_share ?? 0.8 : this.R.traffic?.corridor_share ?? 0;
    const Gin = this.gatesFor(G, "in"), Gout = this.gatesFor(G, "out");
    // A way through is through: the edges it comes in and goes out at drawn till they are a few
    // hundred metres apart (drawn at random, three in four were the two ends of one street at the
    // edge, tens of metres apart, and the trip was too short to drive: measured 2026-11-20).
    const gd = (a, b) => { const A = this.streets.nodes[a], B = this.streets.nodes[b]; return A && B ? Math.hypot(A.x - B.x, A.z - B.z) : 0; };
    const ends = () => {
      const c = r() < share ? this.corridorTrip(r, G) : null;
      if (c && gd(c[0], c[1]) >= THROUGH_MIN_M) return c;
      const a = this.pickGate(r, Gin);
      let b = this.pickGate(r, Gout), bd = gd(a, b);
      for (let k = 0; k < 8 && bd < THROUGH_MIN_M; k += 1) { const x = this.pickGate(r, Gout), dx = gd(a, x); if (dx > bd) { b = x; bd = dx; } }
      return [a, b];
    };
    const trips = [];
    // Through traffic is most of a district's traffic: a visitor's car comes through a few
    // times a day (rules.json density.visitor_trips), now and then stopping.
    const K = VISITOR_KINDS.find((x) => x.kind === p.kind) || VISITOR_KINDS[3];
    const [lo, hi] = K.trips || this.R.density?.visitor_trips || [3, 6];
    const n = lo + Math.floor(r() * (hi - lo + 1));
    const [stopShare, d0, d1] = K.stop || [this.R.density?.visitor_visit_share ?? 0.3, 30, 140];
    // A stop is at a shop, or -- as often as ``calls_share`` -- at somebody's home: the car is
    // driven to that street, parked at its kerb and its driver goes in. That is what puts a car
    // on a residential block and in its parking: with every stop a shop's, the through traffic
    // kept to the corridors and two blocks in five saw no car in three minutes at five o'clock.
    const callsShare = K.stop ? 0 : this.R.density?.calls_share ?? 0;
    // One who works here: in for the morning, the car at the kerb all day, out in the evening
    // -- to the same door every day (drawn from who they are, not from the day).
    const works = p.commuter && p.pattern === "works" && (places.length || homes.length);
    if (works) {
      const w = rng(this.seed, p.id, "workplace"), at = (6.6 + w() * 2.6) * 60 + (r() - 0.5) * 20, leave = (15.8 + w() * 3) * 60 + (r() - 0.5) * 20;
      const pool = places.length && (w() < 0.7 || !homes.length) ? places : homes, [g1, g2] = ends();
      trips.push({ at, visit: pick(w, pool).id, call: true, work: true, g1, g2: g1, dwell: leave - at, brief: false });
    }
    for (let k = 0; k < (works ? 0 : n); k += 1) {
      const [g1, g2] = ends(), stops = r() < stopShare, call = stops && homes.length && r() < callsShare;
      trips.push({ at: hourPick() * 60 + r() * 60, visit: call ? pick(r, homes).id : stops && places.length ? pick(r, places).id : null, call, g1, g2, dwell: call ? 20 + r() * 70 : d0 + r() * (d1 - d0), brief: Boolean(K.stop) });
    }
    // Some existing visiting motorists book an indoor appointment on their own street network.
    if (trips.length && !K.stop) {
      const booking = places.filter(pl => pl.inside && ["shop:auto_parts","use:gas_station","shop:fuel"].some(key=>pl.keys.has(key)))
        .map(pl=>serviceBooking(this.seed,p,t.day,pl.id)).filter(Boolean).sort((a,b)=>a.at-b.at)[0];
      if (booking) {
        Object.assign(trips[0],booking);
        // Leave a clear approach before the reserved slot.
        for(let i=trips.length-1;i>0;i--) if(trips[i].at<booking.at+booking.dwell) trips.splice(i,1);
      }
    }
    trips.sort((a, b) => a.at - b.at);
    // (Planned in game minutes, driven in real ones: clock.mjs fleetTime.)
    const F = t.toFleet || ((m) => m);
    if (t.toFleet) for (const tr of trips) { const at = tr.at; tr.at = F(at); tr.dwell = F(at + tr.dwell) - tr.at; }
    const node = (id) => this.streets.nodes[id];
    let clock = 0;
    // The through traffic is a day's worth, and the game's day is 72 minutes: so many of the
    // visitors' trips are seen (``through``: view.mjs), each trip whole -- its drive, the walk
    // from the kerb and the hour about the shops -- not a car hidden and its driver seen walking
    // out of it. A commuter's one trip a day is always seen.
    for (const [k, trip] of trips.entries()) {
      const depart = Math.max(trip.at, clock + 5);
      if (depart > F(1430)) break;
      // (A call at a home is seen more often than a way through: ``calls_seen`` times as often.)
      const share = this.through * (trip.call ? this.R.density?.calls_seen ?? 1 : 1);
      const from = segs.length, seen = p.commuter || !(this.through < 1) || hash32(p.id, t.day, "trip", k) % 1000 < share * 1000;
      const mark = () => { for (let i = from; i < segs.length; i += 1) segs[i].unseen = !seen; };
      const A = node(trip.g1);
      if (trip.visit && trip.brief) {
        // A fare picked up or dropped, a parcel handed over: a few minutes at the kerb.
        const P = this.roster.places.get(trip.visit);
        const d1 = P ? tripMinutes(Math.hypot(P.x - A.x, P.z - A.z), DRIVE_MS) : 0;
        if (!P || !this.spotOf(v, trip.visit, { day: t.day, t0: depart + d1, t1: depart + d1 + trip.dwell })) continue;
        segs.push({ kind: "go", mode: "drive", t0: depart, t1: depart + d1, from: trip.g1, to: trip.visit, vehicle: v.id, visitor: true });
        const B = node(trip.g2), d2 = tripMinutes(Math.hypot(P.x - B.x, P.z - B.z), DRIVE_MS), back = depart + d1 + trip.dwell;
        segs.push({ kind: "go", mode: "drive", t0: back, t1: back + d2, from: trip.visit, to: trip.g2, vehicle: v.id, visitor: true });
        clock = back + d2; mark();
      } else if (trip.visit) {
        const P = this.roster.places.get(trip.visit);
        const d1 = P ? tripMinutes(Math.hypot(P.x - A.x, P.z - A.z), DRIVE_MS) : 0;
        // Held from pulling in to driving off: the walks there and back are at most a few minutes.
        const spot = P && this.spotOf(v, trip.visit, { day: t.day, t0: depart + d1, t1: depart + d1 + trip.dwell + 2 * tripMinutes(PARKING.max_walk_m, p.pace) + 1 });
        if (!P || !spot) continue;
        segs.push({ kind: "go", mode: "drive", t0: depart, t1: depart + d1, from: trip.g1, to: trip.visit, vehicle: v.id, visitor: true });
        const w = tripMinutes(Math.hypot(spot.x - P.x, spot.z - P.z), p.pace) + 0.5;
        segs.push({ kind: "go", mode: "walk", t0: depart + d1, t1: depart + d1 + w, fromXZ: [spot.x, spot.z], to: trip.visit, visitor: true });
        const start = depart + d1 + w;
        segs.push({ kind: trip.service || trip.call ? "stay" : "roam", t0: start, t1: start + trip.dwell, place: trip.visit,
          act: trip.service ? { kind: "errand", start, end: start + trip.dwell, place: trip.visit, label: "At the auto service counter" }
            : trip.call ? { kind: "errand", start, end: start + trip.dwell, place: trip.visit, label: trip.work ? "At work" : "Calling at a home" } : { kind: "stroll", start }, visitor: true });
        const back = depart + d1 + w + trip.dwell;
        segs.push({ kind: "go", mode: "walk", t0: back, t1: back + w, from: trip.visit, toXZ: [spot.x, spot.z], visitor: true });
        const B = node(trip.g2), d2 = tripMinutes(Math.hypot(P.x - B.x, P.z - B.z), DRIVE_MS);
        segs.push({ kind: "go", mode: "drive", t0: back + w, t1: back + w + d2, from: trip.visit, to: trip.g2, vehicle: v.id, visitor: true });
        clock = back + w + d2; mark();
      } else {
        const g2 = trip.g2 === trip.g1 ? Gout[(Gout.indexOf(trip.g1) + 1) % Gout.length] : trip.g2;
        const B = node(g2);
        const d = tripMinutes(Math.hypot(B.x - A.x, B.z - A.z), DRIVE_MS);
        if (d < 1) continue;
        segs.push({ kind: "go", mode: "drive", t0: depart, t1: depart + d, from: trip.g1, to: g2, vehicle: v.id, visitor: true });
        clock = depart + d; mark();
      }
    }
    if (trips.some(trip => trip.service)) this.admitShoppers(p, t.day, segs);
    return { segs, drives: segs.filter((s) => s.mode === "drive"), start: null, visitor: true };
  }
  // -- where they are ----------------------------------------------------------------------------
  //: Someone out of doors at ``t``: where, which way they face, and what they are about; null
  //: indoors (or in a car, or not in the district).
  //: Nobody on foot is drawn inside a building but the one they are going in or out of by its
  //: door (``through``) or are in (``indoors``): a point of a walk, a wait or a break that would
  //: be is put out on the nearest outside face of the wall (keepOutside). Walkers cut corners
  //: through buildings and stood in them (2026-11-14): drawn in from a door step by a straight
  //: blend, a door on a wall shared with the house next door, a break spot in a doorway.
  personAt(p, t, seg = segAt(this.planOf(p, t).segs, t.minute), focus = null) {
    const pos = this.placeOnFoot(p, t, seg, focus);
    if (pos && pos.mode === "walk" && !pos.indoors && !pos.through && !pos.down && this.guardWalls !== false) this.keepOutside(pos, seg?.mode === "wait" ? "wait" : seg?.kind === "go" ? "walk" : seg?.kind || "stay");
    return pos;
  }
  // -- the buildings' walls ---------------------------------------------------------------------
  //: The district's footprints (its places' rings) in a grid, for asking what a point is inside.
  footprints() {
    const list = this.roster.list;
    if (this._footprints && this._footprints.n === list.length) return this._footprints;
    const CELL = 24, grid = new Map();
    for (const pl of list) {
      const ring = pl.ring;
      if (!ring || ring.length < 3) continue;
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (const [x, z] of ring) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
      if (x1 - x0 > 600 || z1 - z0 > 600) continue;
      const f = { pl, ring, x0, z0, x1, z1 };
      for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i += 1) for (let j = Math.floor(z0 / CELL); j <= Math.floor(z1 / CELL); j += 1) {
        // (A cell's key is a number: footprintAt is asked for everyone every frame, and a string
        // made for each ask was garbage that added up.)
        const k = (i + 1048576) * 2097152 + j + 1048576;
        let at = grid.get(k); if (!at) grid.set(k, at = []);
        at.push(f);
      }
    }
    this._footprints = { n: list.length, grid, CELL };
    this.wallFixes ??= {};
    return this._footprints;
  }
  //: The pavement's line beside a stretch of street, on one side of it (pavementRoute's
  //: ``offset``): midway between the kerb and the nearest front along that side (people.mjs
  //: paveOffset). The fronts are found by stepping out from the kerb at points along the
  //: stretch -- clear of its ends, where the cross street's own corner buildings stand -- and
  //: the nearest of them sets the line for the whole stretch, so it stays straight. Kept by
  //: stretch and side: a block is walked by thousands.
  walkOffset(half, where) {
    if (!half || !where || !(where.len > 0)) return paveOffset(half);
    const key = `${Math.round(where.x)}:${Math.round(where.z)}:${Math.round(where.ux * 16)}:${Math.round(where.uz * 16)}:${Math.round(where.len)}:${where.side}:${Math.round(half * 4)}`;
    const F = this.footprints();
    if (this._walkOffsets?.for !== F) this._walkOffsets = { for: F, map: new Map() };
    const kept = this._walkOffsets.map.get(key);
    if (kept !== undefined) return kept;
    const nx = -where.uz * where.side, nz = where.ux * where.side;
    const ends = Math.min(FRONT_SCAN.ends_m, where.len * 0.25), span = where.len - 2 * ends;
    const n = Math.max(1, Math.min(FRONT_SCAN.most, Math.ceil(span / FRONT_SCAN.every_m)));
    // The kerb as the world draws it on this side (kerbOffset), where it is built: the street's
    // own half width is the map's, and a street with a cycle lane, a slip lane or an island
    // along it is wider than that on one side.
    half = this.kerbOffset(half, where, nx, nz, ends, span);
    let gap = Infinity;
    for (let k = 0; k < n; k += 1) {
      const t = ends + span * (k + 0.5) / n, x = where.x + where.ux * t, z = where.z + where.uz * t;
      for (let d = FRONT_SCAN.step_m; d <= 2 * PAVE_M + FRONT_SCAN.step_m && d < gap; d += FRONT_SCAN.step_m) {
        if (this.footprintAt(x + nx * (half + d), z + nz * (half + d))) { gap = d - FRONT_SCAN.step_m / 2; break; }
      }
    }
    const o = paveOffset(half, gap);
    this._walkOffsets.map.set(key, o);
    if (gap < Infinity) { this.wallFixes ??= {}; this.wallFixes.narrowed = (this.wallFixes.narrowed || 0) + 1; }
    return o;
  }
  //: The pavement beside (x, z), a point in a roadway: just in from the nearest kerb -- or null
  //: where there is none within reach, or the nearest kerb is an island's or a median's.
  pavementBy(x, z) {
    const K = this.kerbside, G = WALK_LEGAL;
    const k = K?.kerbNear?.(x, z, G.kerb_reach_m);
    if (!k || !K.onRoad) return null;
    const qx = k.x + k.nx * G.out_m, qz = k.z + k.nz * G.out_m;
    if (K.onRoad(qx, qz)) return null;
    let island = false;
    for (let d = 3; d <= G.island_m; d += 3) if (K.onRoad(k.x + k.nx * (G.out_m + d), k.z + k.nz * (G.out_m + d))) { island = true; break; }
    if (!island) return { x: qx, z: qz };
    // The nearest kerb is an island's or a median's: the pavement is the other way, over the lane
    // the point is in -- the first ground out that way that is no roadway and has none beyond it.
    // (A walk beside a median had no pavement found for it at all, and stayed in the road.)
    for (let d = 1; d <= G.kerb_reach_m; d += 1) {
      const px = x - k.nx * d, pz = z - k.nz * d;
      if (K.onRoad(px, pz)) continue;
      const ox = px - k.nx * G.out_m, oz = pz - k.nz * G.out_m;
      if (K.onRoad(ox, oz)) continue;
      for (let e = 3; e <= G.island_m; e += 3) if (K.onRoad(ox - k.nx * e, oz - k.nz * e)) return null;
      return { x: ox, z: oz };
    }
    return null;
  }
  //: Somewhere to stand off the roadway near (x, z) -- a stop's pole, a place to wait: the point
  //: itself where it is no roadway; else the pavement by the nearest kerb; else (that kerb an
  //: island's) the nearest ground, looked for outwards all round, that is not roadway and has
  //: none beyond it. [x, z], the point given where nothing is found or the world is not built.
  //: Where one waiting at the stop ``at`` stands (``r``: their own random): along the kerb by
  //: the pole and in on the pavement, or round the pole where the kerb is not known.
  stopSpot(at, r) {
    const along = (r() - 0.5) * 2 * STOP_SPREAD_M, inward = 0.7 + r() * 1.8;
    // (A pole the map has out in the roadway -- the 30's at Chestnut and Fillmore is in the
    // crossroads -- has no kerb of its own: the kerb is the one beside the pavement it is stood
    // off onto.)
    let k = this.kerbside?.kerbAt?.(at.x, at.z);
    if (!k && this.kerbside?.kerbAt) { const [px, pz] = this.standOff(at.x, at.z); k = this.kerbside.kerbAt(px, pz); }
    if (k && Number.isFinite(k.nx) && Number.isFinite(k.ax)) {
      const road = this.kerbside?.onRoad;
      // A pole at a corner has the crossroads on one side: a spot out in it is taken the same
      // way up the kerb on the other side (and nearer the pole if that will not do).
      for (const a of [along, -along, along / 2, -along / 2]) {
        const x = k.x + k.ax * a + k.nx * inward, z = k.z + k.az * a + k.nz * inward;
        if (!(road && road(x, z)) && !this.footprintAt?.(x, z)) return [x, z];
      }
    }
    return this.standOff(at.x + along * 0.5, at.z + (r() - 0.5) * STOP_SPREAD_M);
  }
  standOff(x, z) {
    const road = this.kerbside?.onRoad, G = WALK_LEGAL;
    if (!road || !road(x, z)) return [x, z];
    const by = this.pavementBy(x, z);
    if (by) return [by.x, by.z];
    for (let r = 1; r <= G.search_m; r += 1) {
      for (let k = 0; k < 16; k += 1) {
        const ux = Math.cos(k * Math.PI / 8), uz = Math.sin(k * Math.PI / 8), px = x + ux * (r + G.out_m), pz = z + uz * (r + G.out_m);
        if (road(x + ux * r, z + uz * r) || road(px, pz)) continue;
        let island = false;
        for (let d = 3; d <= G.island_m; d += 3) if (road(px + ux * d, pz + uz * d)) { island = true; break; }
        if (!island) return [px, pz];
      }
    }
    return [x, z];
  }
  //: A walk (pavementRoute's) made to keep off the roadway as the world draws it (WALK_LEGAL):
  //: its crossings grown to the kerbs they leave and reach, so the wait is on the pavement; the
  //: stretches it ran along a roadway moved onto the pavement beside. The same walk where the
  //: world is not built (no kerbside.onRoad) or nothing needed changing.
  legalize(pave) {
    const road = this.kerbside?.onRoad, G = WALK_LEGAL;
    if (!road || !pave || !pave.pts || pave.pts.length < 2 || !(pave.length > 2)) return pave;
    const pts = pave.pts, S = pave.s, L = pave.length;
    const n = Math.floor(L / G.step_m), flag = new Uint8Array(n + 1), X = new Float64Array(n + 1), Z = new Float64Array(n + 1);
    let any = false;
    for (let i = 0, k = 0; i <= n; i += 1) {
      const d = i * G.step_m;
      while (k + 2 < pts.length && S[k + 1] < d) k += 1;
      const span = S[k + 1] - S[k] || 1, t = Math.max(0, Math.min(1, (d - S[k]) / span));
      X[i] = pts[k][0] + (pts[k + 1][0] - pts[k][0]) * t; Z[i] = pts[k][1] + (pts[k + 1][1] - pts[k][1]) * t;
      if (road(X[i], Z[i])) { flag[i] = 1; any = true; }
    }
    if (!any) return pave;
    const crossings = (pave.crossings || []).map((c) => ({ ...c })), fixes = [];
    // A stretch of roadway walked that no crossing covers, from ``u`` to ``v`` along the walk,
    // with the crossing before it and the one after (or null): a few steps of it are the
    // crossing's own (the crossing is grown over them); more is moved onto the pavement.
    const piece = (u, v, prev, next, entry) => {
      u = Math.max(0, u); v = Math.min(L, v);
      if (!(v - u > 0.01)) return;
      const grow = () => {
        if (prev && next) { const m = (u + v) / 2; prev.s1 = Math.max(prev.s1, m); next.s0 = Math.min(next.s0, m); }
        else if (next) next.s0 = Math.min(next.s0, u);
        else if (prev) prev.s1 = Math.max(prev.s1, v);
      };
      if ((prev || next) && v - u <= G.kerb_m) { grow(); return; }
      const line = [], m0 = Math.max(0, Math.ceil(u / G.step_m)), m1 = Math.min(n, Math.floor(v / G.step_m));
      for (let m = m0; m <= m1; m += G.every) {
        if (!flag[m]) continue;
        const q = this.pavementBy(X[m], Z[m]), last = line[line.length - 1];
        if (!q || (last && Math.hypot(q.x - last[0], q.z - last[1]) > G.hop_m)) continue;
        // (Not the pavement it came off: looked for a little further on, then given up.)
        if (!last && entry && Math.hypot(q.x - entry[0], q.z - entry[1]) > G.hop_m + 2 + (m - m0) * G.step_m * 0.5) { if (m - m0 > 8) break; continue; }
        line.push([q.x, q.z]);
      }
      if (line.length >= 2) fixes.push({ a: u, b: v, line, prev, next });
      else if ((prev || next) && v - u <= G.grow_m) grow();
      // No pavement found to move it to, and no crossing to make it part of: it is waited at for
      // a gap in the traffic like a crossing, and walked without stopping -- never set out on
      // with a car coming, never stopped on half way (view.mjs waitsAtKerb).
      else if (!prev && !next) { crossings.push({ s0: Math.max(0, u), s1: Math.min(L, v), node: undefined, bearing: 0, signal: false, path: true, along: true }); this.wallFixes ??= {}; this.wallFixes.roadWalks = (this.wallFixes.roadWalks || 0) + 1; }
    };
    for (let i = 0; i <= n; i += 1) {
      if (!flag[i]) continue;
      let j = i;
      while (j + 1 <= n && flag[j + 1]) j += 1;
      const a = i * G.step_m, b = j * G.step_m;
      const xs = crossings.filter((x) => x.s1 >= a - 1.5 && x.s0 <= b + 1.5).sort((p, q) => p.s0 - q.s0);
      if (!xs.length) {
        if (b - a > G.mouth_m && i > 0) piece(a - 0.6, b + 0.6, null, null, [X[i - 1], Z[i - 1]]);
        else if (i > 0 && j < n && b - a >= G.step_m) {
          // A short stretch of roadway no crossing covers. It was left as it was: walked with no
          // look at the traffic, since only a crossing is waited at.
          const ex = X[i - 1], ez = Z[i - 1], fx = X[j + 1], fz = Z[j + 1], gap = Math.hypot(fx - ex, fz - ez);
          if (gap < Math.max(G.spur_gap_m, (b - a) * G.spur_share)) {
            // Out into the road and back to the pavement it left (the walk's line doubling back
            // through a staggered junction): cut out. They went part way into the road,
            // stopped and came back.
            fixes.push({ a: Math.max(0, a - G.step_m), b: Math.min(L, b + G.step_m), line: [[ex, ez], [fx, fz]], prev: null, next: null });
            this.wallFixes ??= {}; this.wallFixes.spurs = (this.wallFixes.spurs || 0) + 1;
          } else {
            // Over the roadway from one side to the other where a path meets a street (no
            // junction of streets, so no crossing was made): a crossing of its own, waited at
            // for a gap in the traffic like any other. The crossed street's line is square to it.
            crossings.push({ s0: Math.max(0, a - G.out_m), s1: Math.min(L, b + G.out_m), node: undefined, bearing: Math.atan2(-(fz - ez), fx - ex), signal: false, path: true });
            this.wallFixes ??= {}; this.wallFixes.pathCrossings = (this.wallFixes.pathCrossings || 0) + 1;
          }
        }
      } else {
        let from = a - G.step_m, prev = null;
        for (const x of xs) {
          if (x.s0 > from) piece(from, x.s0, prev, x, prev || i === 0 ? null : [X[i - 1], Z[i - 1]]);
          from = Math.max(from, x.s1); prev = x;
        }
        if (b + G.step_m > from) piece(from, b + G.step_m, prev, null, null);
      }
      i = j;
    }
    crossings.sort((p, q) => p.s0 - q.s0);
    if (!fixes.length) return City.prototype.joinDivided.call(this, { ...pave, crossings });
    let P = pts, SS = S;
    const pointAt = (d) => {
      let k = 0;
      while (k + 2 < P.length && SS[k + 1] < d) k += 1;
      const span = SS[k + 1] - SS[k] || 1, t = Math.max(0, Math.min(1, (d - SS[k]) / span));
      return [P[k][0] + (P[k + 1][0] - P[k][0]) * t, P[k][1] + (P[k + 1][1] - P[k][1]) * t];
    };
    const far = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
    for (let f = fixes.length - 1; f >= 0; f -= 1) {
      const { a, b, line, prev, next: after } = fixes[f], pa = pointAt(a), pb = pointAt(b), mid = [pa, ...line, pb], next = [];
      const put = (q) => { const last = next[next.length - 1]; if (!last || far(q, last) > 0.05) next.push(q); };
      for (let k = 0; k < P.length; k += 1) if (SS[k] < a) put(P[k]);
      for (const q of mid) put(q);
      let midLen = 0;
      for (let k = 1; k < mid.length; k += 1) midLen += far(mid[k], mid[k - 1]);
      for (let k = 0; k < P.length; k += 1) if (SS[k] > b) put(P[k]);
      const delta = midLen - (b - a);
      for (const c of crossings) if (c !== prev && c.s0 >= b - 1e-6) { c.s0 += delta; c.s1 += delta; }
      // The crossing leaves from, and comes in to, the pavement the walk was moved onto.
      if (after) after.s0 -= far(line[line.length - 1], pb);
      if (prev) prev.s1 += far(pa, line[0]);
      P = next; SS = [0];
      for (let k = 1; k < P.length; k += 1) SS.push(SS[k - 1] + far(P[k], P[k - 1]));
    }
    if (P.length < 2) return City.prototype.joinDivided.call(this, { ...pave, crossings });
    this.wallFixes ??= {}; this.wallFixes.offRoad = (this.wallFixes.offRoad || 0) + fixes.length;
    return City.prototype.joinDivided.call(this, { ...pave, pts: P, s: SS, length: SS[SS.length - 1], halves: P.map(() => 0), classes: P.map(() => null), crossings });
  }
  //: A street with an island or a median in it is crossed in one go. The walk's crossings come
  //: one to a carriageway there, a few steps of island between them: each was waited at on its
  //: own, so a walker set out, reached the island and stood on it (or short of it, in the first
  //: carriageway: the place to wait is a pace or few back from a crossing) until the second half
  //: was clear -- seen stopping in the road, stepping about and going back. Two crossings one
  //: after the other on the same line (the walk does not turn between them by more than
  //: ``turn``) with no more than ``island_m`` between them are one crossing, from the first kerb
  //: to the last: waited for once, on the pavement, for long enough to walk the whole of it.
  //: (Two round a corner -- one street, a turn, the next street -- stay two.)
  joinDivided(pave) {
    const list = pave?.crossings;
    if (!list || list.length < 2) return pave;
    const G = WALK_LEGAL, P = pave.pts, S = pave.s;
    const at = (d) => {
      let k = 0;
      while (k + 2 < P.length && S[k + 1] < d) k += 1;
      const span = S[k + 1] - S[k] || 1, t = Math.max(0, Math.min(1, (d - S[k]) / span));
      return [P[k][0] + (P[k + 1][0] - P[k][0]) * t, P[k][1] + (P[k + 1][1] - P[k][1]) * t];
    };
    const out = [];
    let joined = 0;
    for (const c of list) {
      const last = out[out.length - 1];
      if (last && c.s0 - last.s1 <= G.island_m && c.s0 >= last.s0) {
        const a0 = at(last.s0), a1 = at(last.s1), b0 = at(c.s0), b1 = at(c.s1);
        const ux = a1[0] - a0[0], uz = a1[1] - a0[1], vx = b1[0] - b0[0], vz = b1[1] - b0[1], m = Math.hypot(ux, uz) * Math.hypot(vx, vz);
        if (m > 0 && (ux * vx + uz * vz) / m >= G.same_line) {
          last.s1 = Math.max(last.s1, c.s1); last.divided = true;
          // (Lit if either half is: the light looked at is the first half's, where they set out.)
          if (!last.signal && c.signal) { last.signal = c.signal; last.node = c.node; last.bearing = c.bearing; }
          joined += 1;
          continue;
        }
      }
      out.push(c);
    }
    if (!joined) return pave;
    this.wallFixes ??= {}; this.wallFixes.dividedCrossings = (this.wallFixes.dividedCrossings || 0) + joined;
    return { ...pave, crossings: out };
  }
  //: How far out from a street's line its pavement begins on one side, as the world is drawn
  //: (kerbside.onRoad): stepped out from the line at points along the stretch until the
  //: roadway ends and stays ended for KERB_SCAN.clear_m -- past a cycle lane, a slip lane, the
  //: other carriageway, and past any island or median on the way (ground with roadway again
  //: beyond it is the middle of the road, not a pavement). The middle one of the points'
  //: answers; ``half`` where the world is not built, the line is not in a roadway, or no
  //: pavement is found within reach. Walkers kept ``half`` + a step out everywhere once, and on
  //: every street wider than the map says they walked in the road (a quarter of them, counted
  //: in the Marina at 07:30, 2026-11-17).
  kerbOffset(half, where, nx, nz, ends, span) {
    const road = this.kerbside?.onRoad;
    if (!road || !(half > 0)) return half;
    const found = [], S = KERB_SCAN;
    for (let k = 0; k < S.points; k += 1) {
      const t = ends + span * (k + 0.5) / S.points, x = where.x + where.ux * t, z = where.z + where.uz * t;
      if (!road(x, z)) continue;   // not a roadway here (a square, a path the map calls a street)
      let start = -1;
      for (let d = S.step_m; d <= S.reach_m + S.clear_m; d += S.step_m) {
        if (road(x + nx * d, z + nz * d)) { start = -1; continue; }
        if (start < 0) start = d;
        if (d - start >= S.clear_m) break;
      }
      if (start > 0 && start <= S.reach_m) found.push(start - S.step_m / 2);
    }
    if (!found.length) return half;
    found.sort((a, b) => a - b);
    return Math.max(1.5, found[found.length >> 1]);
  }
  //: The footprint (a place's) that (x, z) is inside, if any but ``except`` (a place id).
  footprintAt(x, z, except = null) {
    const F = this.footprints(), cell = F.grid.get((Math.floor(x / F.CELL) + 1048576) * 2097152 + Math.floor(z / F.CELL) + 1048576);
    if (!cell) return null;
    for (const f of cell) {
      if (x < f.x0 || x > f.x1 || z < f.z0 || z > f.z1 || (except !== null && f.pl.id === except)) continue;
      if (inRing(f.ring, x, z)) return f;
    }
    return null;
  }
  //: ``pos`` put out of any footprint it is in: on the nearest face of the wall outside that is in
  //: no other building, WALL_CLEAR_M out. Counted by ``why`` (wallFixes). True if it was moved.
  keepOutside(pos, why = "walk") {
    const f = this.footprintAt(pos.x, pos.z);
    if (!f) return false;
    const best = outOfRing(f.ring, pos.x, pos.z, this._inNoFootprint ??= (x, z) => !this.footprintAt(x, z));
    if (!best) return false;
    pos.x = best[0]; pos.z = best[1];
    this.wallFixes[why] = (this.wallFixes[why] || 0) + 1;
    return true;
  }
  placeOnFoot(p, t, seg = segAt(this.planOf(p, t).segs, t.minute), focus = null) {
    const h = this.harm(p.id, t.ms);
    if (h?.down) return { x: h.at.x, z: h.at.z, yaw: h.at.yaw || 0, moving: false, mode: "walk", down: true, carried: Boolean(h.carried), activity: h.label || "hurt" };
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
      if (seg.pave === undefined) seg.pave = this.paveFor(p, route, { from: a0, to: a1 });
      const pave = seg.pave, L = pave.length, pace = L / Math.max(1, (seg.t1 - seg.t0) * 60);
      // Fewer on the narrow walks: a walk mostly along one is out of sight more often (decided
      // once, with the walk's way, before they are ever drawn).
      if (seg.thin === undefined) {
        const keep = this.R.density?.narrow_walk_keep ?? 0.45, share = pave.narrowShare || 0;
        seg.thin = share > 0 && hash32(p.id, Math.round(seg.t0 * 10), "narrow") % 1000 >= 1000 * (1 - (1 - keep) * share);
      }
      if (seg.thin) return null;
      const key = `${p.id}:${seg.t0}`, lag = this.walkLags.get(key)?.lag || 0, d = Math.max(0, f * L - lag * pace);
      const off = (a, q) => (a && q ? Math.hypot(a.x - q[0], a.z - q[1]) : 0);
      // (Drawn in from the pavement to a door or a pole over a little more than its distance off.)
      const reach = Math.max(2, 1.6 * Math.max(off(a0, pave.pts[0]), off(pave.blocked ? null : a1, pave.pts[pave.pts.length - 1])));
      const pos = this.walkEnds(pave, d, 0, a0, pave.blocked ? null : a1, reach, f);
      return { ...pos, moving: true, mode: "walk", walk: { key, pave, d, pace, dir: 1 },
        activity: pave.blocked && d >= L ? "waiting for a legal crossing" : seg.visitor ? (seg.toXZ ? "back to the car" : "from the car") : `to ${this.nextKind(p, t, seg)}` };
    }
    const place = places.get(seg.place);
    if (!place) return null;
    if (seg.kind === "roam") return this.roaming(p, seg, place, t);
    const a = seg.act;
    if (a.kind === "sport" && place.court) return this.playing(p, seg, place, t);
    // A break is taken out of doors by one in BREAK_OUTSIDE_OF of a place's people; the rest take
    // theirs inside. (Everyone out at once stood twenty and more at one doorway: 468 of the 525
    // people in tight groups in the Marina, 2026-11-17.)
    // (Those who stay in are in the back, not seen: stood on the shop floor they were the same crowd, indoors.)
    if (a.kind === "break" && a.outside && !this.breakOutside(p, t)) return null;
    if (a.kind === "break" && a.outside) {
      // Out of the door for a break: on the pavement in front of it, a step or so out (door and
      // front point in) -- not out at the kerb among the parked cars -- and along the front, not
      // all at the door.
      const r = rng(p.id, t.day, "break"), D = (place.door && this.doorOf(place)) || place.front;
      const out = DOOR_STEP_M + 0.2 + r() * 0.9, along = (r() - 0.5) * 9;
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
    if (place.inside && focus && Math.hypot(place.x - focus.x, place.z - focus.z) < INDOOR_REACH_M) {
      const lane = seg.lane !== undefined ? { k: seg.lane } : a.kind === "work" && COUNTER_ROLES.has(p.role) ? this.staffLane(place, p) : null;
      // (More staff on than the counter has lanes for: the rest are in the back, not seen; and
      // the customers beyond the drawn floor's places are further in, among the aisles.)
      if (lane?.back || (seg.lane !== undefined && seg.lane >= shopSeen(place))) return null;
      return indoorSpot(p, a, place, t, lane);
    }
    return null;
  }
  //: On a court: about it the way the game goes -- running here and there and never leaping (a
  //: smooth way about the court, each player their own, at a run at most), a tennis player on
  //: their own side of the net, facing the way they run.
  //: On a court: one of the game it has this hour (sports.mjs), or waiting at the side for the next.
  //: Null for someone over even the side's few (not drawn).
  playing(p, seg, place, t) {
    const C = place.court, S = sportOf(C.s), sec = t.minute * 60;
    const here = this.courtNow?.get(place.id) || [];
    let i = here.indexOf(p.id);
    if (i < 0) i = here.length;
    const present = Math.max(here.length, i + 1);
    let booked = courtSession(place.id, C.s, t.day, t.minute);
    if (!booked.n) booked = courtSession(place.id, C.s, t.day, seg.t0);
    const n = playersOf(C.s, present, booked.n || S.sizes[0][0]);
    if (i < n) return { ...playPose(C, n, i, sec, `${place.id}:${t.day}:${booked.block}`), mode: "walk", activity: S.name };
    if (i - n >= SIDELINE_MAX) return null;
    return { ...sidelinePose(C, i - n, p.id), mode: "walk", activity: S.wait };
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
      const D = this.doorOf(P), step = { x: D.x - D.nx * DOOR_STEP_M, z: D.z - D.nz * DOOR_STEP_M };
      return door ? { ...step, door: { x: D.x + D.nx * 0.3, z: D.z + D.nz * 0.3 } } : step;
    }
    const n = P && this.streets.nodes[P.node];
    if (!n) return null;
    const dx = P.x - n.x, dz = P.z - n.z, L = Math.hypot(dx, dz);
    return L < 0.1 ? { x: n.x, z: n.z } : { x: n.x + (dx / L) * Math.min(L, 4.5), z: n.z + (dz / L) * Math.min(L, 4.5) };
  }
  //: A place's door, as walked through: its own, unless the step out of it would be inside
  //: another building (a door on the wall it shares with the house next door: the front was
  //: taken as the wall nearest the street's node, which at a corner can be a party wall) -- then
  //: the middle of the wall nearest the street whose step out is clear. Checked once a door.
  doorOf(P) {
    const D = P.door;
    if (!D || !P.ring || this.guardWalls === false) return D;
    if (P._doorSeen === D) return P._doorUse || D;
    P._doorSeen = D; P._doorUse = D;
    const clear = (x, z) => !this.footprintAt(x, z);
    if (clear(D.x - D.nx * DOOR_STEP_M, D.z - D.nz * DOOR_STEP_M)) return D;
    const n = this.streets.nodes[P.node], ring = P.ring, walls = [];
    for (let i = 0; i < ring.length; i += 1) {
      const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length], L = Math.hypot(bx - ax, bz - az);
      if (L < 2) continue;
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      let ox = (bz - az) / L, oz = -(bx - ax) / L;
      if (inRing(ring, mx + ox * 0.05, mz + oz * 0.05)) { ox = -ox; oz = -oz; }
      walls.push({ d: n ? Math.hypot(n.x - mx, n.z - mz) : 0, mx, mz, ox, oz });
    }
    walls.sort((a, b) => a.d - b.d);
    for (const w of walls) {
      if (!clear(w.mx + w.ox * DOOR_STEP_M, w.mz + w.oz * DOOR_STEP_M)) continue;
      P._doorUse = { x: w.mx, z: w.mz, nx: -w.ox, nz: -w.oz, from: "clear_wall" };
      this.wallFixes.doors = (this.wallFixes.doors || 0) + 1;
      break;
    }
    return P._doorUse;
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
  //: ``p``'s way on foot along ``route``: on the pavement, on their own line across it
  //: (LANE_SPREAD), over at the crosswalks. ``narrowShare``: how much of it is along a narrow
  //: walk (NARROW_WALK_W_M).
  paveFor(p, route, ends = {}) {
    const k = LANE_SPREAD[0] + (LANE_SPREAD[1] - LANE_SPREAD[0]) * ((hash32(p.id, "lane") % 1000) / 999);
    let narrow = 0, all = 0;
    const offset = (half, where) => {
      const o = this.paveLine(half, where);
      if (!half) return o;
      if (where?.len > 0) { all += where.len; if ((o - half) * 2 < NARROW_WALK_W_M) narrow += where.len; }
      return half + (o - half) * k;
    };
    const pave = this.legalize(pavementRoute(this.streets, route, { ...ends, side: hash32(p.id) % 2 ? 1 : -1, offset }));
    if (pave) pave.narrowShare = all > 0 ? narrow / all : 0;
    return pave;
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
  //: Whether ``p`` takes today's break out of doors: one in BREAK_OUTSIDE_OF, fewer of a large
  //: place's people (BREAK_OUTSIDE_MOST of them at most).
  breakOutside(p, t) {
    const people = this.roster.people;
    if (!this._staff || this._staff.n !== people.size) {
      const by = new Map();
      for (const q of people.values()) if (q.work) by.set(q.work, (by.get(q.work) || 0) + 1);
      this._staff = { n: people.size, by };
    }
    const of = Math.max(BREAK_OUTSIDE_OF, Math.ceil((this._staff.by.get(p.work) || 0) / BREAK_OUTSIDE_MOST));
    return hash32(p.id, t.day, "break-out") % of === 0;
  }
  roamOf(p, seg, place, t, leg) {
    const key = `${p.id}:${t.day}:${Math.round(seg.t0)}:${leg}`;
    let r0 = this.roams.get(key);
    if (r0 === undefined) {
      const r = rng(p.id, t.day, seg.act.kind, leg), drive = seg.drive, mode = drive ? "drive" : "walk";
      // A round at work on foot is walked on the worker's own patch (the same every day), not
      // out from the door and back with everyone else who works from it.
      let base = place, beat = null;
      if (!drive && seg.act.kind !== "stroll") {
        const ang = ((hash32(p.id, "beat") % 3600) / 3600) * Math.PI * 2, far = BEAT_M[0] + ((hash32(p.id, "beat-far") % 1000) / 1000) * (BEAT_M[1] - BEAT_M[0]);
        const node = this.streets.nearest(place.x + Math.cos(ang) * far, place.z + Math.sin(ang) * far, "walk", 160);
        if (node !== null && node !== undefined) { const N = this.streets.nodes[node]; beat = { x: N.x, z: N.z }; base = { x: N.x, z: N.z, node }; }
      }
      const from = drive ? this.streets.nearest(place.x, place.z, "kerb", 200) : base.node;
      let to = null;
      for (let k = 0; k < 6 && to === null; k += 1) {
        const ang = r() * Math.PI * 2, dist = (drive ? 500 : 180) * (0.4 + r());
        to = this.streets.nearest(base.x + Math.cos(ang) * dist, base.z + Math.sin(ang) * dist, drive ? "kerb" : "walk", 120);
        if (drive && to !== null && this.netOf(to) !== this.netOf(from)) to = null;
      }
      const route = this.streets.route(from, to, mode);
      r0 = route && route.length >= 5 ? { route, drive } : null;
      // On foot: out and back on the pavement, over at the crosswalks.
      if (r0 && !drive) { r0.home = beat || this.anchor(seg.place, null, { door: false }); r0.pave = this.paveFor(p, route, { from: r0.home }); }
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
    // (A runner -- dressed for it, wardrobe.mjs -- goes for a run, not a walk: at a jog.)
    const running = !drive && seg.act.kind === "stroll" && !p.visitor && isRunner(p);
    const speed = drive ? (seg.act.outdoor === "sweep" ? 2.2 : 8) : running ? p.pace * 2.1 : p.pace * (seg.act.kind === "stroll" ? 0.8 : 1);
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
    const home = drive ? null : r0.home || this.anchor(seg.place, null, { door: false });
    const pos = drive ? alongRoute(route, along, (half, cls, park, i) => k * KERB(half, cls, park, i, k > 0 ? route : null)) : this.walkEnds(route, along, 0, home, null, 3);
    if (!forward) pos.yaw += Math.PI;
    return { ...pos, moving: true, mode: drive ? "drive" : "walk", speed: pace, walk: drive ? null : { key, pave: route, d: along, pace, dir: forward ? 1 : -1 }, activity: seg.act.kind === "stroll" ? (p.visitor ? "about the shops" : running ? "out for a run" : "out for a walk") : `${this.R.jobs.roles[p.role]?.title.toLowerCase() || "at work"} at work` };
  }
  //: Where a car is at ``t``: on its way (and how far along), or standing where its last trip
  //: ended -- on the street, in a garage, or away beyond the district's streets.
  vehicleAt(v, t) {
    const h = this.harm(v.id, t.ms);
    if (h?.at && h.stays) return { state: h.state, x: h.at.x, z: h.at.z, yaw: h.at.yaw || 0, moving: false, harm: h };
    if (h?.out) return { state: "repair", hidden: true, harm: h };
    const owner = v.visitor ? this.roster.visitorOf(v.owner) : this.roster.people.get(v.owner);
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
    if (spot.indoors) return { state: "indoors", hidden: true, spot };
    return { state: "parked", x: spot.x, z: spot.z, yaw: spot.yaw, moving: false, spot, lock: spot.lock || null };
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
    this.through ??= 1;
    this._scan = { t: this.timeAt(ms), focus: { x: focus.x, z: focus.z }, reach, parkedReach, people: [], vehicles: [],
      P: [...this.roster.people.values(), ...this.roster.visitors.values(), ...this.roster.commuters.values()], V: [...this.roster.vehicles.values()], i: 0, j: 0, garaged: [], courts: new Map(), waits: new Map() };
  }
  scanMore(budget = 2500, whole = false) {
    const S = this._scan;
    if (!S) return null;
    // (``timeFor``: each one's own time while the game's clock is held -- view.mjs; else everyone's.)
    const { t: t0, focus, reach, parkedReach, people, vehicles } = S, own = this.timeFor;
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
      const p = S.P[S.i], t = own ? own(p.id, t0) : t0;
      const plan = this.planOf(p, t), seg = segAt(plan.segs, t.minute);
      const h = this.harm(p.id, t.ms);
      if (h?.down) { if (near(h.at.x, h.at.z)) people.push({ p, seg: null }); continue; }
      if (!seg || h?.out) continue;
      // (A walk not seen: on the game's clock a day's walking is done in its 72 minutes, so most
      // of it is out of sight -- residentPlan, visitorPlan.)
      if (seg.unseen) continue;
      if (seg.kind === "go") {
        // A taxi on its way in or away while its fare walks, and the cab the fare is riding.
        for (const L of seg.cabLegs || []) if (L.t0 <= t.minute && t.minute < L.t1) this.cabNear(vehicles, L, t, focus, reach, p.id);
        if (seg.mode === "drive") { if (seg.cab) this.cabNear(vehicles, seg, t, focus, reach, p.id); continue; }
        if (seg.mode === "bus") continue;
        if (seg.mode === "wait") {
          if (!near(seg.at[0], seg.at[1])) continue;
          // No more at one stop than STOP_WAIT_MAX: the rest are not in sight (as most walks are not).
          const key = seg.route ? `${seg.route}:${Math.round(seg.at[0] / 12)}:${Math.round(seg.at[1] / 12)}` : null;
          if (key) { const k = (S.waits.get(key) || 0) + 1; S.waits.set(key, k); if (k > STOP_WAIT_MAX) continue; }
          people.push({ p, seg });
          continue;
        }
        const A = seg.fromXZ ? { x: seg.fromXZ[0], z: seg.fromXZ[1] } : P.get(seg.from), B = seg.toXZ ? { x: seg.toXZ[0], z: seg.toXZ[1] } : P.get(seg.to);
        if (A && B && distToSegment(focus.x, focus.z, A.x, A.z, B.x, B.z) < reach + 60) people.push({ p, seg });
        continue;
      }
      const pl = P.get(seg.place);
      if (!pl) continue;
      if (seg.kind === "roam") { if (!seg.drive && near(pl.x, pl.z, 350)) people.push({ p, seg }); continue; }
      if (seg.act.kind === "sport") {
        // Everyone at a court, near or not, so each knows their place in its game (playing).
        if (pl.court) { let list = S.courts.get(pl.id); if (!list) S.courts.set(pl.id, list = []); list.push(p.id); if (near(pl.x, pl.z)) people.push({ p, seg }); }
        continue;
      }
      // (Nobody takes their break out in the rain: view.mjs sets ``wet``.)
      if ((seg.act.kind === "break" && seg.act.outside && !this.wet && this.breakOutside(p, t) && near(pl.x, pl.z)) || (pl.inside && Math.hypot(pl.x - focus.x, pl.z - focus.z) < INDOOR_REACH_M)) people.push({ p, seg });
    }
    for (; S.j < S.V.length && n < budget && !over(); S.j += 1, n += 1) {
      const v = S.V[S.j], t = own ? own(v.owner, t0) : t0, s = this.vehicleAt(v, t);
      if (s?.state === "garage" && s.spot && near(s.spot.x, s.spot.z)) S.garaged.push({ v, s });
      if (!s || s.hidden) continue;
      if (s.state === "driving") {
        if (s.roam) { if (near(s.x, s.z, 120)) vehicles.push({ v, s }); continue; }
        const leg = s.leg, P0 = this.endOf(v, leg.from), P1 = this.endOf(v, leg.to);
        // The through traffic is a day's worth, and the game's day is 72 minutes: driven all at
        // once it is twenty times what the streets carry, and they stood solid (five hundred
        // cars in sight of you, one in eight of them moving: measured 2026-11-19). So many of
        // the visitors' trips are driven where you can see them (``through``: view.mjs), the
        // same ones every time; the residents' own are all driven.
        if (leg.unseen || (leg.unseen === undefined && v.visitor && this.through < 1 && hash32(v.id, Math.round(leg.t0)) % 1000 >= this.through * 1000)) continue;
        if (P0 && P1 && distToSegment(focus.x, focus.z, P0.x, P0.z, P1.x, P1.z) < reach + 250) vehicles.push({ v, s });
      } else if (Math.abs(s.x - focus.x) < parkedReach && Math.abs(s.z - focus.z) < parkedReach) vehicles.push({ v, s });
    }
    if (S.i < S.P.length || S.j < S.V.length) return null;
    for (const [id, list] of S.courts) list.sort((a, b) => hash32(a, id) - hash32(b, id) || (a < b ? -1 : 1));
    this.courtNow = S.courts;
    this._scan = null;
    return { time: t0, people, vehicles, garaged: S.garaged };
  }
  //: A cab on ``leg`` listed with the traffic when its way passes near ``focus``.
  cabNear(out, leg, t, focus, reach, who = undefined) {
    const P0 = this.endOf(leg.cab, leg.from), P1 = this.endOf(leg.cab, leg.to);
    if (!P0 || !P1 || distToSegment(focus.x, focus.z, P0.x, P0.z, P1.x, P1.z) > reach + 250) return;
    if (out.some((e) => e.v.id === leg.cab.id)) return;
    out.push({ v: leg.cab, who, s: { state: "driving", leg, f: Math.min(1, (t.minute - leg.t0) / (leg.t1 - leg.t0)), moving: true, lag: 0 } });
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
      const owner = v.visitor ? R.visitorOf(v.owner) : R.people.get(v.owner);
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
    const p = R.people.get(id) || R.visitorOf(id);
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

export const TRAFFIC = { accel: 2.2, brake: 3.2, emergency: 8.5, reaction_s: 0.6, gap_m: 2.5, headway_s: 1.2, look_m: 45, left_gap_s: 4.5, left_wait_s: 14, follow_share: 0.8, follow_s: 1.6, start_wait_s: 10,
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
  lane_change_s: 2.5, box_clear_s: 5, clear_speed: 3, predict_r_m: 9, predict_s: [0.5, 1, 1.5], push_s: 1.2, push_speed: 3,
  // Going round (after the steering behaviours of Godot's and GDQuest's toolkits: arrive, avoid):
  // what stands in the lane -- someone, a crashed car, your car -- for ``dodge_after_s`` is gone
  // round at ``dodge_speed``, ``dodge_clear_m`` clear of it, a metre sideways for every
  // ``1 / dodge_rate`` forward (its wheels turned to that a little at a time, ``steer_per_m`` a
  // metre: no car goes sideways from straight ahead), backing up first -- braked to a stand, a
  // moment in between for the gear (``gear_s``), gathering way backwards (``back_accel``) and the
  // same moment again before it goes forward. In your sight a car is put on past a knot only
  // after ``seen_jump_x`` times the wait.
  // (It had been a metre sideways a metre forward, backwards at once from any speed: 2026-11-22.)
  // ``1 / dodge_rate`` forward, backing up first (``back_speed``, at most ``back_max_m``) where
  // there is no room to swing out; over the middle line only with nothing coming for ``oncoming_s``.
  dodge_after_s: 2, dodge_speed: 3, dodge_clear_m: 0.6, dodge_rate: 0.6, steer_per_m: 0.4, swing_room_m: 3, oncoming_s: 4, back_speed: 1.2, back_accel: 0.9, gear_s: 0.7, seen_jump_x: 3, back_max_m: 4, person_still_s: 1.5, waiting_s: 3,
  // Looking ahead (after A/B Street: never into a block that cannot be left; and round a jam):
  // the block after the next junction stood full back to its start (``jam_cars`` a lane stopped,
  // the last within ``jam_tail_m`` of the way in), or with that many stood ``jam_stood_s`` (longer
  // than any light holds them), or stood over ``jam_share`` of its length for ``jam_min_s``, is a
  // jam, known for ``jam_known_s`` (a street found shut, for ``shut_known_s``: those behind the
  // one put on past it follow after ``shut_jump_s``, not each after the full wait); a driver
  // takes another way round it (``jam_cost_s`` dearer), looked for every ``reroute_every_s``.
  jam_cars: 3, jam_tail_m: 28, jam_stood_s: 30, jam_share: 0.4, jam_min_s: 8, jam_known_s: 30, shut_known_s: 120, shut_jump_s: 5, jam_cost_s: 240, reroute_every_s: 5, reroute_look_m: 160,
  // The day's milestones: ``late_s`` behind, a driver goes at the limit to catch up; ``hopeless_s``
  // behind and out of your sight, it is put where its day has it. Two cars in each other's way for
  // ``deadlock_s``: one backs off; stood blocked ``teleport_s`` (after SUMO's time-to-teleport) it
  // is put on beyond what blocks it -- never driven through it.
  late_s: 8, hopeless_s: 150, teleport_s: 28, box_jump_s: 10, teleport_reach_m: 60,
  // A cyclist ahead is passed at ``pass_over`` m/s more than they go, with room for the whole pass.
  pass_over: 3.5, turn_speed: 4.5, turn_long: 0.7,
  // Two cars that have hit stand ``wreck_s`` (a bump) or ``wreck_hard_s`` (20 mph and over), then drive on.
  wreck_s: 30, wreck_hard_s: 120 };
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
// A fresh alongRoute point with its car on it (alongRoute makes a new one each call: no copy).
const withCar = (p, c) => { p.c = c; return p; };
//: A car's own side of the street (for alongRoute): the lane it is in, or on its way across to
//: the next over (``lt`` 0..1), eased.
export function laneSide(st) {
  const side = (half, cls, park, i, route) => {
    // (``dodge``: swung out so far to go round what stands in the lane.)
    const b = laneOffset(half, cls, park, i, route, st.lane) + (st.dodge || 0);
    if (!(st.lt < 1)) return b;
    const a = laneOffset(half, cls, park, i, route, st.from) + (st.dodge || 0), u = Math.max(0, st.lt);
    return a + (b - a) * u * u * (3 - 2 * u);
  };
  // (How early it begins a turn: people.mjs alongRoute, TURN_LEAD.)
  side.lead = st.lead || 0;
  return side;
}
//: The street a car is on, as its lanes see it (for the record of knots).
function segInfo(route, st) {
  const i = segOf(route, st.d);
  return { oneway: Boolean(route.oneways?.[i]), twin: route.twins?.[i] ?? null, half: +(route.halves?.[i] ?? 0).toFixed(1), lanes: route.lanes?.[i] ?? null, n: laneCount(route, i), cls: route.classes?.[i],
    off: +st.side(route.halves?.[i] ?? 0, route.classes?.[i], route.parks?.[i] ?? null, i, route).toFixed(1), ids: [route.ids?.[i], route.ids?.[i + 1]] };
}
//: Whether a reason a car is held is one it must wait for (a light, a stop sign, someone in the
//: road, its turn in the junction, a junction it cannot get out of): never pushed on through.
const HARD_HOLD = /light|stop sign|you|someone|giving way|way out|pulling out/;
//: ... or something its own way shows it would drive into: braked for whatever is behind it.
const SEEN_AHEAD = /in its way|letting one in|in the lane|coming across/;
//: Where a car that has arrived stands: in the parking lane, off the way of the traffic.
export const PARK_LANE = (half, cls) => (cls === "service" ? 0 : Math.max(2.4, half - 1.0));
//: The light a car approaching ``node`` from ``bearing`` sees at ``tsec``: "green", "amber", "red".
export function signalAt(streets, node, bearing, tsec, T = TRAFFIC) {
  // (One junction, one set of lights: its nodes -- people.mjs junctions -- share a phase.)
  const J = streets.junctionOf(node);
  const key = J ? J.key : node, ref = J ? J.ref : 0, both = J ? J.both : false, main = J ? J.main : false;
  let a = Math.abs(((bearing - ref) % Math.PI + Math.PI) % Math.PI);
  const axis = a < Math.PI / 4 || a > (3 * Math.PI) / 4 ? 0 : 1;
  const C = T.signal_cycle_s, A = T.amber_s, phase = (tsec + (hash32("signal", key) % C)) % C;
  // The main street (the arterial the light is set by) has the longer green where it crosses a
  // lesser one; two arterials share the cycle.
  const share = main && !both ? (T.main_green_share ?? 0.5) : 0.5;
  const g0 = C * share - A, g1 = C * (1 - share) - A;
  const local = axis === 0 ? phase : (phase - (g0 + A) + C) % C, green = axis === 0 ? g0 : g1;
  return local < green ? "green" : local < green + A ? "amber" : "red";
}
//: What kind of junction a node is part of: "signal" where an arterial meets (three ways or
//: more), "stop" at other junctions, null along a street.
export function junctionAt(streets, node) {
  return node >= 0 ? streets.junctionOf(node)?.kind || null : null;
}

//: How close two cars' ways through a junction may come and not be in each other's way (two
//: cars' half widths, and room for a turning car's corners to swing), in metres.
export const CLEAR_M = 3.0;
// (Plain functions and plain arithmetic: segGap is called for every pair of segments of every
// pair of ways through a junction, and made two functions of its own each time.)
const pointSegGap = (a, b, c) => {
  const ux = c[0] - b[0], uz = c[1] - b[1], L = ux * ux + uz * uz;
  const k = L ? Math.max(0, Math.min(1, ((a[0] - b[0]) * ux + (a[1] - b[1]) * uz) / L)) : 0;
  const dx = a[0] - b[0] - ux * k, dz = a[1] - b[1] - uz * k;
  return Math.sqrt(dx * dx + dz * dz);
};
const turnSign = (a, b, c) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
const segGap = (p, q, r, t) => {
  // The least distance between segments pq and rt.
  if (turnSign(p, q, r) * turnSign(p, q, t) < 0 && turnSign(r, t, p) * turnSign(r, t, q) < 0) return 0;
  return Math.min(pointSegGap(p, r, t), pointSegGap(q, r, t), pointSegGap(r, p, q), pointSegGap(t, p, q));
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
  constructor(streets, T = TRAFFIC) {
    this.streets = streets; this.T = T; this.cars = new Map(); this.delays = new Map(); this.claims = new Map(); this.boxes = new Map();
    this.stood = new Map();   // people: where each was last seen to move from, and when
    this.jams = new Map();    // blocks stood full: "a>b" -> known until (s)
    this.tally = { dodges: 0, backs: 0, reroutes: 0, jumps: 0, catchups: 0 };
    this.knots = [];
  }
  //: One frame for the cars in sight. ``cars``: {id, key (the leg), route, sched (the distance
  //: its day has it at, by time: (tsec) => metres, and back: (metres) => tsec), limit (m/s),
  //: length, width}. ``people``: {id, x, z} -- you among them. Returns each car's distance
  //: along, speed, and any hits.
  step(dt, tsec, cars, people, blockers = []) {
    this.nowS = tsec;
    const T = this.T, out = [], hits = [], seen = new Set();
    const live = [];
    // Who is standing in the road, and which way those who are not are going (people come with
    // no speed of their own: from where each was last frame).
    for (const q of people) {
      const w = this.stood.get(q.id);
      if (!w) { this.stood.set(q.id, { x: q.x, z: q.z, since: tsec, px: q.x, pz: q.z, pt: tsec, vx: 0, vz: 0 }); q.still = 0; q.vx = 0; q.vz = 0; continue; }
      const gone = tsec - w.pt;
      if (gone > 0) { const k = Math.min(1, gone / 0.3); w.vx += ((q.x - w.px) / gone - w.vx) * k; w.vz += ((q.z - w.pz) / gone - w.vz) * k; w.px = q.x; w.pz = q.z; w.pt = tsec; }
      if (Math.hypot(q.x - w.x, q.z - w.z) > 0.4) { w.x = q.x; w.z = q.z; w.since = tsec; }
      q.still = tsec - w.since; q.vx = w.vx; q.vz = w.vz;
    }
    if (this.stood.size > 600) for (const [id, w] of this.stood) if (tsec - w.pt > 5) this.stood.delete(id);
    for (const [k, until] of this.jams) if (until < tsec) this.jams.delete(k);
    for (const c0 of cars) {
      seen.add(c0.id);
      let st = this.cars.get(c0.id);
      // On a way of its own round a jam (reroute): the same trip, by other streets.
      const c = st && st.key === c0.key && st.route ? { ...c0, route: st.route, sched: (ts) => c0.sched(ts) * st.scale, unsched: (d) => c0.unsched(d / st.scale) } : c0;
      if (!st || st.key !== c.key) {
        const delay = this.delays.get(c.key) ?? 0;
        const d = Math.max(0, Math.min(c.route.length, c.sched(tsec - delay)));
        const lim = c.limitAt ? c.limitAt(alongRoute(c.route, d).cls) : c.limit;
        st = { key: c.key, d, v: Math.min(lim, c.cruise ?? lim), stopped: new Set(), waitUntil: 0, hit: null, fresh: true };
        // In the lane its route has it in to begin with (lanePlan), its own from then on.
        const i0 = segOf(c.route, d), plan = lanePlan(c.route);
        st.lane = st.from = plan ? Math.min(plan.k[i0] || 0, Math.max(0, (plan.n[i0] || 1) - 1)) : 0;
        st.lt = 1; st.nextLook = 0; st.dodge = 0;
        // (A bicycle keeps the bike lane, or the kerb's edge of a shared one.)
        st.lead = c.bike ? 0 : turnLead(c.length || 4.5);
        st.side = c.bike ? (half, cls, park, i, route) => BIKE_LANE(half, cls, park, i, route) + st.dodge : laneSide(st);
        st.bike = Boolean(c.bike);
        st.dodgeTo = 0; st.hold = null; st.holdT = 0; st.backUp = 0;
        this.cars.set(c.id, st);
      }
      live.push([c, st]);
    }
    // Where each is now, for the cars behind.
    const pos = new Map();
    // In its lane, as it is drawn: the kerb side of the street. A car coming into sight where
    // another already stands (its day had it there; the other was held up) comes in behind it.
    // (Cells are keyed by a number, not a string made for every look: a car looks round itself
    // several times a frame, twenty-five cells a look.)
    const grid = new Map(), CELL = 12, cellKey = (i, j) => (i + 32768) * 65536 + (j + 32768), cellOf = (x, z) => cellKey(Math.floor(x / CELL), Math.floor(z / CELL));
    const place = (id, p) => { const k = cellOf(p.x, p.z); p.cell = k; let g = grid.get(k); if (!g) grid.set(k, g = new Set()); g.add(id); };
    // The people by square too (kept between frames and emptied, not made again).
    const PCELL = 16, pgrid = (this._pgrid ||= new Map()), pnear = (this._pnear ||= []);
    for (const g of pgrid.values()) g.length = 0;
    if (pgrid.size > 4000) pgrid.clear();
    for (let qi = 0; qi < people.length; qi += 1) { const q = people[qi], k = cellKey(Math.floor(q.x / PCELL), Math.floor(q.z / PCELL)); let g = pgrid.get(k); if (!g) pgrid.set(k, g = []); g.push(qi); }
    const unplace = (id, p) => grid.get(p.cell)?.delete(id);
    const near = (x, z, r, fn) => {
      const i0 = Math.floor((x - r) / CELL), i1 = Math.floor((x + r) / CELL), j0 = Math.floor((z - r) / CELL), j1 = Math.floor((z + r) / CELL);
      for (let i = i0; i <= i1; i += 1) for (let j = j0; j <= j1; j += 1) { const g = grid.get(cellKey(i, j)); if (g) for (const id of g) fn(id); }
    };
    // How far into each other two bodies are (each a row of circles down its length), <= 0 apart.
    const bodies = (p, length, width) => {
      const r = width / 2, n = Math.max(1, Math.ceil((length - width) / width) + 1), k = (length - width) / 2, fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw), out = [];
      for (let j = 0; j < n; j += 1) { const t = n === 1 ? 0 : -k + (2 * k * j) / (n - 1); out.push([p.x + fx * t, p.z + fz * t]); }
      return { r, at: out };
    };
    const into = (A, B) => {
      let worst = -Infinity;
      const AA = A.at, BB = B.at, rr = A.r + B.r + 0.25;
      for (let i = 0; i < AA.length; i += 1) { const a = AA[i]; for (let j = 0; j < BB.length; j += 1) { const b = BB[j], dx = a[0] - b[0], dz = a[1] - b[1], g = rr - Math.sqrt(dx * dx + dz * dz); if (g > worst) worst = g; } }
      return worst;
    };
    const others = blockers.map((o, k) => ({ id: `blocker:${k}`, body: bodies(o, o.length || 4.5, o.width || 1.9) }));
    const deepest = (id, body, x, z, reach) => {
      let worst = -Infinity, who = null;
      near(x, z, reach, (oid) => { if (oid === id) return; const o = pos.get(oid); const d = into(body, o.body); if (d > worst) { worst = d; who = oid; } });
      for (const o of others) { const d = into(body, o.body); if (d > worst) { worst = d; who = o.id; } }
      return { worst, who };
    };
    // Whether a car may be put down at ``to`` along its way (past a knot, back on its day): not
    // in front of one coming up that lane that could not stop for it -- put a length ahead of a
    // car doing 28 mph it was driven into (2026-11-21).
    const landable = (c, st, to) => {
      const q = alongRoute(c.route, to, st.side), fx = -Math.sin(q.yaw), fz = -Math.cos(q.yaw);
      let ok = true;
      near(q.x - fx * 20, q.z - fz * 20, 30, (oid) => {
        if (!ok || oid === c.id) return;
        const o = pos.get(oid), ost = this.cars.get(oid);
        if (!o || !ost || ost.hit || ost.v < 2 || Math.cos(o.yaw - q.yaw) < 0.4) return;
        const dx = o.x - q.x, dz = o.z - q.z, back = -(dx * fx + dz * fz);
        if (back > 0 && Math.abs(dx * fz - dz * fx) < 2.6 && back - (c.length + o.c.length) / 2 < ost.v * 0.8 + (ost.v * ost.v) / (2 * T.brake) + 2) ok = false;
      });
      return ok;
    };
    // What a car's move from ``a`` to ``b`` would drive it into: another ahead of it that it
    // would go further into (so two that came to overlap -- come into sight so -- can draw
    // apart, the one in front going on).
    const blocking = (id, a, b, reach, dir = 1) => {
      let who = null;
      const fx = -Math.sin(a.yaw) * dir, fz = -Math.cos(a.yaw) * dir;
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
      let p = withCar(alongRoute(c.route, st.d, st.side), c);
      p.body = bodies(p, c.length, c.width || 1.9);
      if (st.fresh) {
        for (let k = 0; k < 40 && st.d > 0 && deepest(c.id, p.body, p.x, p.z, c.length + 8).worst > 0; k += 1) {
          st.d = Math.max(0, st.d - 1.5); p = withCar(alongRoute(c.route, st.d, st.side), c); p.body = bodies(p, c.length, c.width || 1.9);
        }
        // And at a speed it can stop from in the room it has: it came in at its cruising speed
        // whatever stood in front of it, and the first step drove it into the back of a queue
        // at 12 m/s -- a crash, a wreck stood in the lane, and the next car in did the same
        // (87 crashes in six minutes of a weekday morning on the real Marina, 85 of them this:
        // measured 2026-11-19).
        const efx = -Math.sin(p.yaw), efz = -Math.cos(p.yaw);
        let room = Infinity, lead = 0;
        const ahead = (ox, oz, ol, ov, oyaw) => {
          const dx = ox - p.x, dz = oz - p.z, fwd = dx * efx + dz * efz;
          if (fwd <= 0 || fwd > T.look_m + 15 || Math.abs(dx * efz - dz * efx) > 2.4) return;
          const gap = fwd - (c.length + ol) / 2 - T.gap_m, same = Math.cos(oyaw - p.yaw) > 0.4;
          if (gap < room) { room = gap; lead = same ? Math.max(0, ov) : 0; }
        };
        near(p.x + efx * T.look_m / 2, p.z + efz * T.look_m / 2, T.look_m / 2 + 20, (oid) => { if (oid === c.id) return; const o = pos.get(oid), ost = this.cars.get(oid); ahead(o.x, o.z, o.c.length, ost?.hit ? 0 : ost?.v || 0, o.yaw); });
        for (const o of blockers) ahead(o.x, o.z, o.length || 4.5, o.v || 0, o.yaw);
        // (And for anyone on foot in front of it.)
        for (const q of people) { const dx = q.x - p.x, dz = q.z - p.z, fwd = dx * efx + dz * efz; if (fwd > 0 && fwd < T.look_m && Math.abs(dx * efz - dz * efx) < 2.2 && fwd - c.length / 2 - 1.5 < room) { room = fwd - c.length / 2 - 1.5; lead = 0; } }
        // (And along its way as it bends: straight ahead misses whatever stands round the corner
        // or in the junction it is about to turn through -- 3 of 13 crashes, 2026-11-21.)
        for (let far = 4; far <= T.look_m && far - c.length / 2 - T.gap_m < room && st.d + far < c.route.length; far += 3) {
          const q = alongRoute(c.route, st.d + far, st.side);
          near(q.x, q.z, 3, (oid) => {
            if (oid === c.id) return;
            const o = pos.get(oid) || null, ost = this.cars.get(oid);
            if (!o || Math.hypot(o.x - q.x, o.z - q.z) > 2.6) return;
            const gap = far - (c.length + o.c.length) / 2 - T.gap_m;
            if (gap < room) { room = gap; lead = Math.cos(o.yaw - q.yaw) > 0.4 && !ost?.hit ? Math.max(0, ost?.v || 0) : 0; }
          });
        }
        if (room < Infinity) st.v = Math.min(st.v, lead + Math.sqrt(2 * T.brake * 0.8 * Math.max(0, room)));
        // And not slower than one coming up close behind it can slow to: put down in front of a
        // car at speed, a length or two ahead, it was driven into before that car could brake.
        let pushed = 0;
        {
          let push = 0;
          near(p.x - efx * 14, p.z - efz * 14, 22, (oid) => {
            if (oid === c.id) return;
            const o = pos.get(oid), ost = this.cars.get(oid);
            if (!o || !ost || ost.hit || ost.v <= st.v || Math.cos(o.yaw - p.yaw) < 0.4) return;
            const dx = o.x - p.x, dz = o.z - p.z, back = -(dx * efx + dz * efz);
            if (back <= 0 || Math.abs(dx * efz - dz * efx) > 2.4) return;
            const gap = Math.max(0.2, back - (c.length + o.c.length) / 2 - 1), can = Math.sqrt(Math.max(0, ost.v * ost.v - 2 * T.brake * gap));
            if (can > st.v) push = Math.max(push, can);
          });
          if (push > 0) st.v = Math.min(room < Infinity ? lead + Math.sqrt(2 * T.brake * Math.max(0, room)) : Infinity, Math.max(st.v, Math.min(push, (c.cruise ?? push) * 1.2)));
          pushed = push;
        }
        // At the very start of its trip, with something in its lane there or bearing down on it:
        // it starts from the kerb, stood, and pulls out when the lane is clear -- not put down
        // in the lane at its cruising speed on top of a car turning in (as its trips began).
        if (st.d < 6 && !c.bike && c.route.halves && !(c.route.ids?.[0] >= 0 && this.streets.junctionOf(c.route.ids[0])) && (pushed > 0 || deepest(c.id, p.body, p.x, p.z, c.length + 8).worst > 0)) {
          const i0 = segOf(c.route, st.d), half = c.route.halves[i0] ?? 0, cls = c.route.classes?.[i0];
          const out = PARK_LANE(half, cls) - laneOffset(half, cls, c.route.parks?.[i0] ?? null, i0, c.route, st.lane ?? 0);
          if (out > 0.8) {
            st.dodge = out; st.dodgeTo = 0; st.v = 0; st.startHold = tsec;
            p = withCar(alongRoute(c.route, st.d, st.side), c); p.body = bodies(p, c.length, c.width || 1.9);
          }
        }
        // (Still on top of something, with nowhere to be put back to: stood, till that has gone.)
        if (deepest(c.id, p.body, p.x, p.z, c.length + 8).worst > 0) { st.v = 0; st.spawnAt = tsec; }
        // And short of a light that is not green, or a stop sign: it came in a few metres from a
        // red at its cruising speed and went through it, braking (16 of 637 lights passed in three
        // minutes of a weekday evening, measured 2026-11-21).
        if (c.route.ids) for (const P of this.passages(c.route)) {
          const far = P.s0 - st.d;
          if (far < -1) continue;
          const node = c.route.ids[P.i0], toLine = far - this.stopLine(node, c);
          if (toLine > st.v * st.v / (2 * T.brake * 0.8)) break;
          if (toLine < -0.5) continue;
          const [ax, az] = c.route.pts[P.i0 - 1], [bx, bz] = c.route.pts[P.i0];
          if (P.kind === "stop" || signalAt(this.streets, node, Math.atan2(bx - ax, bz - az), tsec, T) !== "green") st.v = Math.min(st.v, Math.sqrt(2 * T.brake * 0.8 * Math.max(0, toLine)));
          break;
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
      if (arrived(c, st) || c.bike) continue;
      const i = segOf(c.route, st.d), key = edgeKey(c.route, i);
      let list = lanesOn.get(key);
      if (!list) lanesOn.set(key, list = []);
      list.push({ id: c.id, along: st.d - c.route.s[i], lane: st.lane, from: st.lt < 1 ? st.from : st.lane, length: c.length, v: st.hit ? 0 : st.v, stood: st.hit ? 1e6 : st.stood || 0 });
    }
    // Two cars closing on each other: where both routes take them in the next moments (a thing
    // with no route -- your car, a bus at its stop -- stands where it is); if they would meet,
    // the one in front is moved on (the one behind brakes, as ever).
    const pushes = new Set();
    // Each car's bodies at those moments, worked out once a step (a car is in many pairs).
    const ahead = (this._ahead ||= new Map()); ahead.clear();
    const predicted = (car, cst) => {
      let a = ahead.get(car.id);
      if (!a) {
        a = [];
        for (const tau of T.predict_s) a.push(bodies(alongRoute(car.route, Math.min(car.route.length, cst.d + cst.v * tau), cst.side), car.length, car.width || 1.9));
        ahead.set(car.id, a);
      }
      return a;
    };
    for (const [c, st] of live) {
      if (st.hit || arrived(c, st)) continue;
      const p = pos.get(c.id);
      near(p.x, p.z, T.predict_r_m, (oid) => {
        if (String(oid) <= String(c.id)) return;
        const o = this.cars.get(oid), op = pos.get(oid);
        if (!o || !op || o.hit || arrived(op.c, o) || (st.v < 0.2 && o.v < 0.2)) return;
        const now = into(p.body, op.body);
        const A = predicted(c, st), B = predicted(op.c, o);
        for (let ti = 0; ti < A.length; ti += 1) {
          const meet = into(A[ti], B[ti]);
          if (meet > 0 && meet > now + 1e-4) {
            const ahead = (op.x - p.x) * -Math.sin(p.yaw) + (op.z - p.z) * -Math.cos(p.yaw);
            pushes.add(ahead > 0 ? oid : c.id);
            break;
          }
        }
      });
    }
    for (const [c, st] of live) {
      if (st.hit && !(st.hit.until > 0 && tsec > st.hit.until)) { out.push({ id: c.id, d: st.d, v: 0, hit: st.hit, route: st.route }); continue; }
      if (arrived(c, st)) {
        // (Its turn at any junction goes with it: a car parked at the end of its trip had kept
        // its place in the right of way, and everyone after it gave way to it for good.)
        if (!st.done) { st.done = true; for (const box of this.claims.values()) box.delete(c.id); }
        st.v = 0; out.push({ id: c.id, d: c.route.length, v: 0, arrived: true, route: st.route }); continue;
      }
      if (st.hit) st.hit = null;
      const here = pos.get(c.id), fx = -Math.sin(here.yaw), fz = -Math.cos(here.yaw);
      const limit = c.limitAt ? c.limitAt(here.cls) : c.limit;
      // Behind its day (its milestones): at the limit, to catch up; else at its own pace.
      const behind = tsec - c.unsched(st.d), late = behind > T.late_s;
      if (late && !st.late) this.tally.catchups += 1;
      st.late = late;
      // Their own way of driving (temperament.mjs drivingStyle): the pace they hold, the room they leave.
      const S = c.style || STEADY_STYLE, headway = T.headway_s * S.headway;
      let target = late ? limit : Math.min(limit, (c.cruise ?? limit) * S.pace), reason = null;
      // Its lane (one change at a time, into a gap, never in or at a junction's box), and the
      // block after the next junction: stood full, another way is taken (lookAhead).
      const J = this.junctionAhead(c, st);
      const dodging = st.dodgeTo !== 0 || Math.abs(st.dodge) > 0.02;
      // (Over as it goes forward: stood still it does not slide sideways into the next lane.)
      if (st.lt < 1) st.lt = Math.min(1, st.lt + (dt / T.lane_change_s) * (st.v < 0.3 ? 0 : Math.min(1, st.v / 2)));
      else if (tsec >= st.nextLook && !(J && st.d > J.s - J.box - c.length / 2 - 6)) {
        st.nextLook = tsec + 1;
        if (!dodging && !c.bike) this.pickLane(c, st, lanesOn, blockers, people);
        if (!c.bike) this.lookAhead(c, st, lanesOn, tsec);
      }
      // Waiting for a gap to get over (into the lane for its turn): eased off, to let one by.
      if (st.waiting) target = Math.min(target, limit * 0.7);
      // Stood at the kerb at the start of its trip: out when its lane is clear beside it and
      // nobody is coming up it (two and a half seconds off, or more) -- and after a while, anyway.
      if (st.startHold) {
        const d0 = st.dodge; st.dodge = 0;
        const q = alongRoute(c.route, st.d, st.side);
        st.dodge = d0;
        let busy = deepest(c.id, bodies(q, c.length, c.width || 1.9), q.x, q.z, c.length + 8).worst > 0;
        if (!busy) near(q.x - fx * 18, q.z - fz * 18, 28, (oid) => {
          if (busy || oid === c.id) return;
          const o = pos.get(oid), ost = this.cars.get(oid);
          if (!ost || ost.hit || ost.v < 1 || Math.cos(o.yaw - q.yaw) < 0.4) return;
          const dx = o.x - q.x, dz = o.z - q.z, back = -(dx * fx + dz * fz);
          if (back > -2 && back < ost.v * 2.5 + 6 && Math.abs(dx * fz - dz * fx) < 2.4) busy = true;
        });
        if (busy && tsec - st.startHold < T.start_wait_s) { target = 0; reason = "pulling out"; }
        else st.startHold = 0;
      }
      // Junctions ahead on the way: each one junction, however many nodes it is made of
      // (``passages``) -- one stop at its line, one light.
      const { ids } = c.route;
      for (const P of this.passages(c.route)) {
        const ahead = P.s0 - st.d;
        if (ahead < -1) continue;
        // (Seen from as far off as it takes to stop at its line: the line of a wide street's
        // junction is well short of its middle, and at 30 mph ``look_m`` was too late for it.)
        const node = ids[P.i0], back = this.stopLine(node, c);
        if (ahead > Math.max(T.look_m, back + st.v * st.v / (2 * T.brake) + st.v * 1.5 + 6)) break;
        const toLine = ahead - back;
        if (P.kind === "stop") {
          if (st.stopped.has(P.key)) continue;
          if (toLine < 0.8 && st.v < 0.4) { if (!st.waitUntil) st.waitUntil = tsec + T.stop_sign_s; if (tsec >= st.waitUntil) { st.stopped.add(P.key); st.waitUntil = 0; continue; } }
          const v = Math.sqrt(2 * T.brake * Math.max(0, toLine));
          if (v < target) { target = v; reason = "stop sign"; }
          break;
        }
        const [ax, az] = c.route.pts[P.i0 - 1], [bx, bz] = c.route.pts[P.i0];
        const light = signalAt(this.streets, node, Math.atan2(bx - ax, bz - az), tsec, T);
        if (light === "green" || toLine < -0.5) continue;
        const stopping = st.v * st.v / (2 * T.brake);
        if (light === "amber" && stopping > toLine + 1) continue;   // too close to stop: through on amber
        const v = Math.sqrt(2 * T.brake * Math.max(0, toLine));
        if (v < target) { target = v; reason = `${light} light`; }
        break;
      }
      // A turn is taken slowly (``turn_speed``), braked down to on the way in: round a corner at
      // the street's speed a driver sees who is on the crossing too late to stop for them.
      if (J && turnOf(J.inU, J.outU) !== "S") {
        // (A bus or a lorry slower still: it is braked down to its own turning speed by the
        // junction's edge and takes the sharpest of the turn, half way round, at that.)
        const slow = T.turn_speed * ((c.length || 4.5) > LONG_VEHICLE_M ? T.turn_long : 1);
        const v = Math.sqrt(slow * slow + 2 * T.brake * Math.max(0, J.s - J.box - st.d));
        if (v < target) target = v;
      }
      // ... and so is any sharp bend of the way that is not a junction's (a hairpin through a
      // stub, a dog-leg): taken at 20 mph it swung across the other lane.
      {
        const plan = lanePlan(c.route), sR = c.route.s;
        if (plan) for (let v = segOf(c.route, st.d) + 1; v < sR.length - 1 && sR[v] - st.d < T.look_m; v += 1) {
          if (!plan.turn[v]) continue;
          const cap = Math.sqrt(T.turn_speed * T.turn_speed + 2 * T.brake * Math.max(0, sR[v] - st.d - 4));
          if (cap < target) target = cap;
          break;
        }
        const at = segOf(c.route, st.d);
        if (plan && at > 0 && plan.turn[at] && st.d - sR[at] < 5 && T.turn_speed < target) target = T.turn_speed;
      }
      // Right of way in the junction ahead (or the one it is in): first come, first through.
      if (J) {
        const box = this.claims.get(J.key) || new Map(), mine = box.get(c.id);
        const toLine = J.s - this.stopLine(J.node, c) - st.d, entered = toLine < -1;
        let free = entered;
        if (!entered) {
          const stopping = st.v * st.v / (2 * T.brake);
          const light = J.kind === "signal" ? signalAt(this.streets, J.node, Math.atan2(J.inU[0], J.inU[1]), tsec, T) : null;
          free = J.kind === "stop" ? st.stopped.has(J.key) : light === "green" || (light === "amber" && stopping > toLine + 1);
          // Never into a junction it cannot get out of: the way out on the far side stood full.
          if (free && toLine < 30 && J.end + c.length < c.route.length) {
            const out = alongRoute(c.route, J.end + c.length / 2 + 1, st.side), ox = -Math.sin(out.yaw), oz = -Math.cos(out.yaw);
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
          claim.entered = entered; claim.out = J.end + c.length / 2;
          box.set(c.id, claim); this.claims.set(J.key, box);
          if (!entered) {
            // Someone on a crosswalk this way goes over (in, or out the far side): waited for.
            const ext = extendPath(J.path, PAVE_M + 1);
            const jr = Math.ceil((J.reach + 6) / PCELL) , ji = Math.floor(J.mid[0] / PCELL), jj = Math.floor(J.mid[1] / PCELL);
            pnear.length = 0;
            for (let i = ji - jr; i <= ji + jr; i += 1) for (let j = jj - jr; j <= jj + jr; j += 1) { const g = pgrid.get(cellKey(i, j)); if (g) for (let k = 0; k < g.length; k += 1) pnear.push(g[k]); }
            for (let qn = 0; qn < pnear.length; qn += 1) {
              const q = people[pnear[qn]];
              if (Math.abs(q.x - J.mid[0]) > J.reach + 6 || Math.abs(q.z - J.mid[1]) > J.reach + 6) continue;
              // (Someone stood at the kerb waiting is not crossing: they were waited for while
              // they waited for the car. Stood in its very way, they are gone round -- below.)
              if (q.still >= T.waiting_s) continue;
              if (pathGap(ext, [[q.x, q.z], [q.x, q.z]]) < 1.6) {
                const v = Math.sqrt(2 * T.brake * Math.max(0, toLine));
                if (v < target) { target = v; reason = q.player ? "you" : "someone crossing"; }
                break;
              }
            }
            // A left turn waits at its line for a gap in what comes the other way and then turns
            // straight into its lane: first come, first through let it cut across a car coming on
            // at speed, which braked for it or did not (the rule of the road; asked 2026-11-21).
            // Not for ever: held ``left_wait_s`` with no gap, it takes its turn as any other.
            const myTurn = turnOf(claim.inU, claim.outU), leftish = myTurn === "L" || myTurn === "U";
            if (!leftish) st.gapSince = 0;
            const patient = leftish && (!st.gapSince || tsec - st.gapSince < T.left_wait_s);
            let oncoming = false;
            if (patient) {
              near(J.mid[0], J.mid[1], T.left_gap_s * 14 + J.reach, (oid) => {
                if (oncoming || oid === c.id) return;
                const o = pos.get(oid), ost = this.cars.get(oid);
                if (!o || !ost || ost.hit || arrived(o.c, ost) || ost.v < 1.5) return;
                // Coming the other way, still short of the junction's middle, in the street this one leaves.
                const fx = -Math.sin(o.yaw), fz = -Math.cos(o.yaw);
                if (fx * claim.inU[0] + fz * claim.inU[1] > -0.8) return;
                const rx = o.x - J.mid[0], rz = o.z - J.mid[1], off = rx * claim.inU[0] + rz * claim.inU[1];
                if (off < -2 || Math.abs(rx * claim.inU[1] - rz * claim.inU[0]) > 14) return;
                // (One turning left itself passes in front; one about to turn off slows and is seen again.)
                const theirs = box.get(oid);
                if (theirs && turnOf(theirs.inU, theirs.outU) === "L") return;
                if (off / ost.v < T.left_gap_s) oncoming = true;
              });
              if (oncoming) {
                if (!st.gapSince) st.gapSince = tsec;
                const v = Math.sqrt(2 * T.brake * Math.max(0, toLine));
                if (v < target) { target = v; reason = "giving way to oncoming"; }
              }
            }
            for (const o of box.values()) {
              if (oncoming) break;
              const first = o.entered || o.at < claim.at || (o.at === claim.at && o.id < c.id);
              // (Across a left turn that is still waiting for its gap, one coming straight on goes.)
              const oTurn = turnOf(o.inU, o.outU), opposite = o.inU[0] * claim.inU[0] + o.inU[1] * claim.inU[1] < -0.85;
              // (Only for one that is moving: two stood facing each other, each waiting for the
              // other, never left -- then it is first come, first through as before.)
              const oMoving = (this.cars.get(o.id)?.v || 0) >= 1.5;
              if (o.id === c.id || (!first && !(patient && opposite && oMoving && oTurn !== "L" && oTurn !== "U"))) continue;
              if (!o.entered && !leftish && opposite && st.v >= 1.5 && (oTurn === "L" || oTurn === "U") && /^giving way/.test(this.cars.get(o.id)?.reason || "")) continue;
              // (One still in the queue behind another has no turn yet: giving way to it, while
              // the car it waits behind gives way to this one, was a ring nobody left: 2026-11-13.)
              if (!o.entered && this.cars.get(o.id)?.reason === "the car ahead") continue;
              if (!crosses(claim, o)) continue;
              const v = Math.sqrt(2 * T.brake * Math.max(0, toLine));
              if (v < target) { target = v; reason = "giving way"; }
              break;
            }
          }
        }
      }
      // What the law holds it to (a light, a stop sign, its turn): going round something stood in
      // the lane is only for a driver who could otherwise go on.
      const lawful = target;
      st.byBlocker = false;
      // What stands in the lane, to be gone round (the nearest): {x, z, hw, hl, id}.
      let hold = null, carGap = Infinity;
      const holdIf = (h, gap) => { if (!hold || gap < hold.gap) hold = { ...h, gap }; };
      // The car ahead.
      const queueFree = st.releaseQueue > tsec;
      const look = (fn) => near(here.x + fx * T.look_m / 2, here.z + fz * T.look_m / 2, T.look_m / 2 + 4, fn);
      let hard = 0;   // the braking the car ahead calls for (m/s2), where that is more than the usual
      look((oid) => {
        const op = pos.get(oid), o = op.c, ost = this.cars.get(oid);
        if (oid === c.id || !ost || arrived(o, ost) || (dodging && st.hold?.id === oid)) return;
        const dx = op.x - here.x, dz = op.z - here.z;
        const fwd = dx * fx + dz * fz, lat = Math.abs(dx * fz - dz * fx);
        // (In its way by its own width and the other's: a bicycle at the lane's edge is a
        // narrow thing, a car fills the lane.)
        const wide = c.bike || o.bike ? ((c.width || 1.9) + (o.width || 1.9)) / 2 + 0.45 : 1.9;
        if (fwd <= 0 || fwd > T.look_m || lat > wide) return;
        // (Room left behind one going round something: it may have to back up to swing out.)
        const gap = fwd - (c.length + o.length) / 2 - T.gap_m - (ost.dodgeTo !== 0 || ost.holdT > 0.5 ? T.swing_room_m : 0);
        // A crashed car stands where it stopped: gone round, whichever way it faces.
        if (ost.hit) { if (gap < 12) holdIf({ x: op.x, z: op.z, hw: (o.width || 1.9) / 2, hl: o.length / 2, id: oid }, gap); }
        else if (Math.cos(op.yaw - here.yaw) < 0.4) {
          // Facing another way, and squarely in this lane (round something over the middle
          // line, turned across, stood where it was shut in): not a queue to join, but nothing
          // to drive into either -- stopped for, as hard as it takes, and gone round if it stands.
          if (lat < 1.3 && gap < 28) {
            const v = Math.sqrt(2 * T.brake * Math.max(0, gap - 1));
            if (v < target) { target = v; reason = "a car in the lane"; }
            if (gap < 22) hard = Math.max(hard, st.v * st.v / (2 * Math.max(0.4, gap - 1)));
            if (ost.v < 0.5 && gap < 12) holdIf({ x: op.x, z: op.z, hw: (o.width || 1.9) / 2, hl: o.length / 2, id: oid }, gap);
          }
          return;
        }
        else if (queueFree) return;
        if (!ost.hit) carGap = Math.min(carGap, gap);
        const lead = ost.hit ? 0 : ost.v;
        // (Its time behind the one ahead is kept: matched to the leader's speed it sat two metres
        // off its bumper at 28 mph for as long as that lasted, and drove into it the moment it
        // stopped short -- three of seven crashes in three minutes of a weekday morning, 2026-11-21.
        // Short of its room it is slower than the one ahead until it has it.)
        const v = Math.max(0, Math.min(lead < 1.5 ? Infinity : Math.max(lead - 2, lead + (gap - st.v * headway * T.follow_share) / T.follow_s), lead + gap / headway, Math.sqrt(2 * T.brake * Math.max(0, gap)) + lead));
        if (v < target) { target = v; reason = "the car ahead"; st.leader = o.id; }
        // (The one ahead stopped dead -- hit, or shut in: as hard as it takes, not the usual braking.)
        if (st.v > lead + 0.5 && gap < 30) hard = Math.max(hard, (st.v * st.v - lead * lead) / (2 * Math.max(0.4, gap - 0.5)));
        // A cyclist ahead, slower than this car would go: passed, when there is room (``slow``).
        if (o.bike && !c.bike && !ost.hit && gap < 14 && Math.cos(op.yaw - here.yaw) > 0.7 && ost.v < lawful - 2) holdIf({ x: op.x, z: op.z, hw: (o.width || 0.65) / 2, hl: o.length / 2, id: oid, slow: Math.max(0, ost.v) }, gap);
      });
      // And along its own way as it bends: the look above is a straight strip ahead of the
      // bonnet, and a car stood round a curve, in the junction it turns through or where two lanes
      // run into one was seen a second too late or not at all (most of what was still hit at
      // speed on the real Marina, 2026-11-21). Its own body is tried along the way it will drive,
      // as far as it needs to stop in; the first thing it would touch is braked for.
      if (st.v > 1.5 && !c.bike) {
        const need = Math.min(T.look_m + 15, (st.v * st.v) / (2 * T.brake) + st.v * 0.8 + c.length + 4), w = c.width || 1.9;
        // Those moving close by, who will not be where they are now: each is tried where it will
        // be when this car gets there -- going its way (two lanes run into one), or across it
        // (turning through a junction this car's own junction does not know of).
        const moving = [];
        near(here.x + fx * need / 2, here.z + fz * need / 2, need / 2 + 12, (oid) => {
          if (oid === c.id) return;
          const op = pos.get(oid), ost = this.cars.get(oid);
          if (ost && !ost.hit && ost.v > 1 && ost.side && !arrived(op.c, ost)) moving.push(op, ost);
        });
        const lt0 = st.lt, brakeFor = (gap, lead, why) => {
          const v = lead + Math.sqrt(2 * T.brake * gap);
          if (v < target) { target = v; reason = why; }
          if (st.v > lead + 0.5) hard = Math.max(hard, (st.v * st.v - lead * lead) / (2 * Math.max(0.4, gap)));
        };
        let met = false;
        for (let far = c.length * 0.7; far <= need && st.d + far < c.route.length && !met; far += 2.4) {
          // (Changing lanes, it will be further over by then.)
          if (lt0 < 1) st.lt = Math.min(1, lt0 + far / Math.max(2, st.v) / T.lane_change_s);
          const q = alongRoute(c.route, st.d + far, st.side), mine = bodies(q, c.length, w);
          st.lt = lt0;
          const t = far / Math.max(2, st.v);
          for (let k = 0; k < moving.length && !met; k += 2) {
            const op = moving[k], ost = moving[k + 1], same = Math.cos(op.yaw - here.yaw) > 0.4;
            if (same && far >= 15) continue;
            const reachD = ost.d + ost.v * t;
            if (Math.abs(op.x - q.x) + Math.abs(op.z - q.z) > ost.v * t + c.length + op.c.length + 3) continue;
            const then = alongRoute(op.c.route, Math.min(op.c.route.length, reachD), ost.side);
            if (into(mine, bodies(then, op.c.length, op.c.width || 1.9)) <= 0.12) continue;
            const lead = (op.x - here.x) * fx + (op.z - here.z) * fz;
            if (same) {
              // The one in front goes first; abreast, the one whose name comes first.
              if (lead < -1.2 || (Math.abs(lead) <= 1.2 && String(c.id) < String(op.c.id))) continue;
              // (Nothing for one squarely ahead in its own lane: that is the car ahead, above.)
              if (lead > c.length && Math.abs((op.x - here.x) * fz - (op.z - here.z) * fx) < 1.2) continue;
              const v = Math.max(0, Math.min(ost.v, st.v) - 2.5);
              if (v < target) { target = v; reason = "letting one in"; }
              if (st.v > v + 0.5) hard = Math.max(hard, (st.v * st.v - v * v) / (2 * Math.max(0.4, far - c.length * 0.5)));
              st.letIn = tsec + 1.2; st.letV = v;
            } else {
              // Across: the one already in a junction goes; of two outside, the nearer to where
              // they would meet; and it is stopped short of there.
              const theirs = ost.d !== undefined ? Math.hypot(then.x - op.x, then.z - op.z) : 0;
              if (theirs > far + 2 || (Math.abs(theirs - far) <= 2 && String(c.id) < String(op.c.id))) continue;
              brakeFor(Math.max(0, far - c.length - 1), 0, "a car coming across");
            }
            met = true;
          }
          if (met) break;
          // What stands, or goes slowly, on the way itself: every one of them (the nearest moving
          // one hid a car stood half into the lane behind it).
          let stop = false;
          const tryOne = (who, op, ost) => {
            if (!op || (ost && arrived(op.c, ost) && !ost.hit)) return;
            if (dodging && st.hold?.id === who) return;   // what it is going round
            const dx = op.x - here.x, dz = op.z - here.z, ahead = dx * fx + dz * fz;
            // (Not one behind. One alongside it now, where two lanes run into one: above.)
            if (ahead < c.length * 0.3 && far < c.length * 1.5) return;
            const same = Math.cos((op.yaw || 0) - q.yaw) > 0.4 && !ost?.hit, lead = same ? Math.max(0, ost ? ost.v : op.v || 0) : 0;
            brakeFor(Math.max(0, far - 2.4 - T.gap_m * 0.5), lead, "a car in its way");
            stop = true;
          };
          near(q.x, q.z, c.length + 6, (oid) => { if (oid === c.id) return; const o = pos.get(oid); if (into(mine, o.body) > 0.12) tryOne(oid, o, this.cars.get(oid)); });
          for (let k = 0; k < others.length; k += 1) if (into(mine, others[k].body) > 0.12) tryOne(others[k].id, blockers[k], null);
          if (stop) break;
        }
      }
      // (Having let one in, it holds back a moment: not on, off and on again.)
      if (st.letIn > tsec && st.letV < target) { target = st.letV; reason = "letting one in"; }
      // Your car (or anything else in the road that is not one of these): kept behind, and gone
      // round where it stands still.
      for (let k = 0; k < blockers.length; k += 1) {
        const o = blockers[k];
        if (dodging && st.hold?.id === `blocker:${k}`) continue;
        const dx = o.x - here.x, dz = o.z - here.z;
        const fwd = dx * fx + dz * fz, lat = Math.abs(dx * fz - dz * fx);
        if (fwd <= 0 || fwd > T.look_m || lat > 1.9) continue;
        const gap = fwd - (c.length + (o.length || 4.5)) / 2 - T.gap_m, ov = Math.max(0, o.v || 0);
        const v = Math.max(0, Math.min(ov + gap / headway, Math.sqrt(2 * T.brake * Math.max(0, gap)) + ov));
        if (v < target) { target = v; reason = "the car ahead"; st.leader = null; st.byBlocker = ov < 0.5; }
        if (st.v > ov + 0.5 && gap < 30) hard = Math.max(hard, (st.v * st.v - ov * ov) / (2 * Math.max(0.4, gap - 0.5)));
        if (ov < 0.3 && gap < 12) holdIf({ x: o.x, z: o.z, hw: (o.width || 1.9) / 2, hl: (o.length || 4.5) / 2, id: `blocker:${k}` }, gap);
      }
      // (Blocked last frame by something standing that is not dead ahead: that, too.)
      if (st.blockedBy && String(st.blockedBy).startsWith("blocker:")) {
        const o = blockers[Number(String(st.blockedBy).slice(8))];
        if (o && (o.v || 0) < 0.3) holdIf({ x: o.x, z: o.z, hw: (o.width || 1.9) / 2, hl: (o.length || 4.5) / 2, id: st.blockedBy }, 0);
      }
      // (Only the driver at the head of the queue goes round: with a car between, it is that car's.)
      if (hold && !(hold.slow >= 0) && carGap < hold.gap) hold = null;
      // About to be run into (pushes, above): moved on, unless something it must wait for holds it.
      // (Never up against what stands in front of it: a car pushed nose to tail with a stopped
      // one has no room left to go round it.)
      const tight = (reason === "the car ahead" && target < 0.5) || dodging;
      if (pushes.has(c.id) && !HARD_HOLD.test(reason || "") && !tight) st.pushUntil = tsec + T.push_s;
      // (Never into what its own way shows it: pushed on at ``push_speed`` it drove into the car
      // it was braking for -- three of the last four crashes measured, 2026-11-21.)
      if (st.pushUntil > tsec && !HARD_HOLD.test(reason || "") && !SEEN_AHEAD.test(reason || "") && !tight) { target = Math.max(target, Math.min(limit, T.push_speed)); reason = "making room"; }
      // Anyone in the way: brake for them, hard if need be; a car that cannot stop in time hits.
      // (Someone about to step into the lane -- where they will be in a second -- is braked for
      // already: the warning a driver has.)
      let danger = null;
      // (Only someone in the roadway, and in front of it: a walker stood on the pavement waiting
      // to cross was braked for -- and waited for the car, which waited for them -- and someone
      // passing a stopped car's flank held it there: 2026-11-13, seen live.)
      const seg0 = segOf(c.route, st.d), R0 = c.route;
      const inRoad = (x, z) => {
        for (let k = seg0; k <= seg0 + 1 && k + 1 < R0.pts.length; k += 1) {
          const [ax, az] = R0.pts[k], [bx, bz] = R0.pts[k + 1];
          if (distToSegment(x, z, ax, az, bx, bz) <= (R0.halves?.[k] ?? 3) - 0.15) return true;
        }
        return false;
      };
      // (Every car against every person in sight, every frame: nothing is made in this loop.
      // It made an array a person a car a frame to count 0, 1 -- some 460 MB of garbage a
      // second, most of what the page threw away, and the collector's pauses were the freezes
      // while walking: measured 2026-11-16. Anyone too far to be reached at all is passed over
      // on two subtractions.)
      const reach = st.v * T.reaction_s * S.alert + st.v * st.v / (2 * T.brake) + 6;
      const farOff = reach + c.length + (c.width || 1.9) + 3;
      const heldPerson = dodging && typeof st.hold?.id === "string" && st.hold.id.startsWith("person:") ? st.hold.id.slice(7) : null;
      // (Only those in the squares round the car: every car against every person was 360,000
      // looks a frame with two thousand people out at lunchtime, and most of the frame.)
      const pr = Math.ceil((farOff + 8) / PCELL), pci = Math.floor(here.x / PCELL), pcj = Math.floor(here.z / PCELL);
      pnear.length = 0;
      for (let i = pci - pr; i <= pci + pr; i += 1) for (let j = pcj - pr; j <= pcj + pr; j += 1) { const g = pgrid.get(cellKey(i, j)); if (g) for (let k = 0; k < g.length; k += 1) pnear.push(g[k]); }
      for (let qn = 0; qn < pnear.length; qn += 1) {
        const q = people[pnear[qn]];
        const qvx = q.vx || 0, qvz = q.vz || 0, far = farOff + Math.abs(qvx) + Math.abs(qvz);
        if (Math.abs(q.x - here.x) > far || Math.abs(q.z - here.z) > far) continue;
        if (heldPerson !== null && heldPerson === String(q.id)) continue;
        // (Where they are, where they will be in a second, and -- at speed, when it takes two
        // seconds to stop -- in two: someone walking out from the kerb is seen before they are in the lane.)
        const taus = qvx || qvz ? (st.v > 6 ? 3 : 2) : 1;
        for (let tau = 0; tau < taus; tau += 1) {
          const qx = q.x + qvx * tau, qz = q.z + qvz * tau;
          const dx = qx - here.x, dz = qz - here.z;
          const fwd = dx * fx + dz * fz, lat = Math.abs(dx * fz - dz * fx);
          if (fwd < c.length / 2 - 0.5 || lat > c.width / 2 + T.person_half_m + 0.25) continue;
          const gap = fwd - c.length / 2 - T.person_half_m;
          // (Two seconds on, only if the car would be there by then.)
          if (gap > reach || (tau === 2 && gap > st.v * 2.4 + 2) || !inRoad(qx, qz)) continue;
          if (!danger || gap < danger.gap) danger = { q, gap, soon: tau > 0 };
          // Stood there (not walking through): to be gone round, whoever else walks by meanwhile.
          if (tau === 0 && q.still >= T.person_still_s && gap < 12) holdIf({ x: q.x, z: q.z, hw: T.person_half_m, hl: T.person_half_m, id: `person:${q.id}` }, gap);
        }
      }
      // A car coming across its way (yours, a bus pulling out, a bicycle): where the two would
      // meet within the next two and a half seconds, this driver decides. The assertive, all
      // but there already, go on through; everyone else brakes for it, as hard as it takes.
      // (Cars going the same way are the car ahead, above.)
      let across = 0;
      // The city's own cars the same: of two whose ways cross, the one that would drive into the
      // other's side gives way (nose to nose, the one with the later name).
      // (Looked for every other frame, each car on its own beat; what was found holds between.)
      const lookAcross = ((st.beat = (st.beat || 0) + 1) & 1) === 0;
      if (!lookAcross) across = st.acrossWas || 0;
      if (st.v > 1.5 && lookAcross) near(here.x + fx * 13, here.z + fz * 13, 26, (oid) => {
        if (oid === c.id) return;
        const op = pos.get(oid), ost = this.cars.get(oid);
        if (!ost || ost.hit || ost.v < 1.5 || arrived(op.c, ost)) return;
        const ox = -Math.sin(op.yaw), oz = -Math.cos(op.yaw), cos = ox * fx + oz * fz;
        if (Math.abs(cos) > 0.7) return;
        const tm = timeToMeet(here.x, here.z, fx * st.v, fz * st.v, (c.width || 1.9) / 2 + 0.4, op.x, op.z, ox * ost.v, oz * ost.v, Math.min(2.4, op.c.length / 2), 2.2);
        if (tm < 0) return;
        // Where each is then: the other in front of this one's nose, and this one not in front of its.
        const mx = here.x + fx * st.v * tm, mz = here.z + fz * st.v * tm, qx = op.x + ox * ost.v * tm, qz = op.z + oz * ost.v * tm;
        const mineAhead = (qx - mx) * fx + (qz - mz) * fz > 0, itsAhead = (mx - qx) * ox + (mz - qz) * oz > 0;
        if (!mineAhead || (itsAhead && String(c.id) < String(oid))) return;
        across = Math.max(across, st.v * st.v / (2 * Math.max(0.5, st.v * tm - 1.2)));
      });
      if (lookAcross) st.acrossWas = across;
      if (st.v > 1.5) for (let k = 0; k < blockers.length; k += 1) {
        const o = blockers[k], ov = o.v || 0;
        if (Math.abs(ov) < 1.5 || Math.abs(o.x - here.x) > 60 || Math.abs(o.z - here.z) > 60) continue;
        const ox = -Math.sin(o.yaw), oz = -Math.cos(o.yaw);
        // (One coming the other way is in its own lane: only what cuts across.)
        if (Math.abs(ox * fx + oz * fz) > 0.7) continue;
        const tm = timeToMeet(here.x, here.z, fx * st.v, fz * st.v, (c.width || 1.9) / 2 + 0.5, o.x, o.z, ox * ov, oz * ov, Math.min(2.5, (o.length || 4.5) / 2), 2.5);
        if (tm < 0 || (S.assertive && tm < 0.7)) continue;
        across = Math.max(across, st.v * st.v / (2 * Math.max(0.5, st.v * tm - 1.5)));
      }
      let decel = hard > T.brake ? Math.min(T.emergency, hard) : T.brake;
      if (across > 0) { target = 0; reason = "a car coming across"; decel = Math.min(T.emergency, Math.max(decel, across)); if (!st.yielding) { st.yielding = true; this.tally.yields = (this.tally.yields || 0) + 1; } } else st.yielding = false;
      if (danger) {
        const room = Math.max(0.05, danger.gap - 0.6);
        const need = st.v * st.v / (2 * room);
        target = 0; reason = danger.q.player ? "you" : "someone in the road";
        decel = Math.min(T.emergency, Math.max(decel, need));
        // Between the city's own people the law holds: a walker who steps out looks first and a
        // driver who is too close stops dead, so nobody is run down unless you are in it (on foot
        // where the cars are, or in a car yourself). Without this the traffic hurt some twenty
        // residents a minute (measured 2026-11-16): they lay in heaps at the crossings.
        // (At speed, with no room at all, the blow is real: a car doing 12 m/s does not stop in a hand's width.)
        if (danger.gap <= 0.15 && st.v > 0.6 && st.v <= NPC_STOP_DEAD_MS && !danger.q.player && !danger.soon) {
          st.v = 0;
          out.push({ id: c.id, d: st.d, v: 0, reason, braking: true, route: st.route });
          continue;
        }
        if (danger.gap <= 0.15 && st.v > 0.6 && !danger.soon) {
          st.hit = { id: `${c.key}:${danger.q.id}:${Math.round(tsec * 1000)}`, kind: "person", who: danger.q.id, speed: st.v, x: here.x, z: here.z, yaw: here.yaw, until: danger.q.player ? tsec + 9 : 0,
            context: { tsec, dt, route: c.key, segment: segInfo(c.route, st), d: st.d, lane: st.lane, reason, junction: J?.key ?? null, signal: J?.kind === "signal" ? signalAt(this.streets, J.node, Math.atan2(J.inU[0], J.inU[1]), tsec, T) : null, gap: danger.gap, target: { x: danger.q.x, z: danger.q.z, vx: danger.q.vx, vz: danger.q.vz } } };
          this.tally.ran_down = (this.tally.ran_down || 0) + 1;
          hits.push({ car: c.id, ...st.hit, player: Boolean(danger.q.player) });
          st.v = 0;
          out.push({ id: c.id, d: st.d, v: 0, hit: st.hit, reason, route: st.route });
          continue;
        }
      }
      // Going round what stands in the lane (dodge): held by it a moment with the law letting
      // it on, a way round is looked for -- to the left first, over the middle line only with
      // nothing coming; found, it swings out, goes by at a crawl and comes back to its lane.
      if (dodging) {
        const h = st.hold, at = h && this.holdAt(h, people, blockers, pos), passing = h?.slow >= 0;
        // Round something standing: at a crawl. Past a cyclist: a little quicker than they go.
        target = Math.min(target, passing ? Math.min(limit, h.slow + T.pass_over) : T.dodge_speed);
        const ahead = at ? (at.x - here.x) * fx + (at.z - here.z) * fz : 0;
        if (st.dodgeTo !== 0 && (!at || ahead < -(c.length / 2 + h.hl + (passing ? 3 : 1)) || (!passing && Math.hypot(at.x - h.x, at.z - h.z) > 2.5) || (passing && ahead > 40))) { st.dodgeTo = 0; st.hold = null; }
        else if (at && ahead > -(c.length / 2 + h.hl)) {
          // Not yet clear of it sideways: no nearer than the swing still to make needs (a metre
          // sideways for every 1 / dodge_rate forward) -- else back up for the room.
          const side = Math.abs((at.x - here.x) * -fz + (at.z - here.z) * fx);
          if (side < c.width / 2 + h.hw + 0.25) {
            const room = ahead - c.length / 2 - h.hl - 0.3, travel = Math.abs(st.dodgeTo - st.dodge) / T.dodge_rate + Math.max(0, T.dodge_rate - Math.abs(st.steer || 0)) / T.steer_per_m;
            if (travel > room && passing) target = Math.min(target, Math.max(0, h.slow - 0.5));   // behind it till the swing is made
            else if (travel - 0.4 > room) {   // (short by a hand's width is steered, not backed for again)
              target = 0; decel = T.emergency;
              if (st.v < 0.15 && !(st.backUp > 0)) {
                // (No room behind either: the way round is given up for now, and looked for again.)
                if (st.noBack > tsec) { st.dodgeTo = 0; st.hold = null; st.nextDodge = tsec + 2; }
                else { st.backUp = Math.min(T.back_max_m, travel - room + 0.3); this.tally.backs += 1; }
              }
            }
          }
        }
        reason = reason || "going round";
      } else if (hold && lawful >= 1 && (st.v < 0.8 || hold.slow >= 0)) {
        st.holdT += dt;
        if (st.holdT >= T.dodge_after_s * S.patience && tsec >= (st.nextDodge || 0)) {
          st.nextDodge = tsec + 0.7;
          const plan = this.planDodge(c, st, here, hold, { near, pos, people, blockers });
          if (plan) {
            st.dodgeTo = plan.to; st.hold = { ...hold }; st.holdT = 0;
            if (hold.slow >= 0) this.tally.passes = (this.tally.passes || 0) + 1; else this.tally.dodges += 1;
            if (plan.back > 0 && !(hold.slow >= 0)) { st.backUp = plan.back; this.tally.backs += 1; }
          }
        }
        if (hold.slow >= 0) st.holdT = Math.min(st.holdT, T.teleport_s - 1);   // (a cyclist is followed, never jumped past)
        // No way round it for good (the street stood shut): put on past it, where the road is
        // free -- never through it.
        // (Sooner in a junction's box: one stood there holds every way through it.)
        const blockKey = edgeKey(c.route, segOf(c.route, st.d));
        const inside = J && st.d > J.s - J.box - c.length / 2 && st.d < J.end + c.length / 2;
        if (!(hold.slow >= 0) && st.holdT > (this.jams.get(`shut:${blockKey}`) > tsec ? T.shut_jump_s : inside ? T.box_jump_s : T.teleport_s)) {
          const to = this.jumpAhead(c, st, { deepest, bodies, people }, hold);
          if (to !== null && landable(c, st, to)) {
            // The street is shut here: known, so those coming take another way and those in
            // the queue behind are not each kept the whole wait.
            const why = `jumps_${String(hold.id).split(":")[0]}${inside ? "_box" : ""}`; this.tally[why] = (this.tally[why] || 0) + 1;
            this.jams.set(blockKey, tsec + T.shut_known_s); this.jams.set(`shut:${blockKey}`, tsec + T.shut_known_s);
            st.d = to; st.holdT = 0; st.blocked = 0; st.blockedBy = null; this.tally.jumps += 1;
            const p = withCar(alongRoute(c.route, st.d, st.side), c); p.body = bodies(p, c.length, c.width || 1.9); unplace(c.id, here); pos.set(c.id, p); place(c.id, p);
            this.delays.set(c.key, tsec - c.unsched(st.d));
            out.push({ id: c.id, d: st.d, v: 0, reason: "put on past what shut the street", jump: true, route: st.route });
            continue;
          }
        }
      } else if (hold) {
        // (Held by the law as well -- a red light, its turn: the wait already had is kept, not
        // run down; it had been, so a car behind you at a light never came to its last resort.)
      } else st.holdT = Math.max(0, st.holdT - dt);
      // The last resort, whatever state it is in (half way round something, backing, held by
      // you with no way by): stood so long with nothing lawful holding it, it is put on past
      // what holds it. (A car half way round a bus, then held by you, stood in a junction for
      // nine minutes with every way through it waiting behind: 2026-11-13, seen live.)
      {
        const lawHeld = /light|stop sign|giving way|way out|crossing/.test(reason || "");
        const held = st.v < 0.3 && !lawHeld && (/you|someone in the road|going round/.test(reason || "") || (reason === "the car ahead" && st.byBlocker));
        if (held) st.stuckT = (st.stuckT || 0) + dt; else if (st.v > 1) st.stuckT = 0;
        const inside = J && st.d > J.s - J.box - c.length / 2 && st.d < J.end + c.length / 2;
        if (st.stuckT > (inside ? T.box_jump_s : T.teleport_s) * (c.unseen === false ? T.seen_jump_x : 1) + 2) {
          const h = hold || st.hold || { gap: danger ? Math.max(0, danger.gap) : 0, hl: 0.5 };
          const to = h.slow >= 0 ? null : this.jumpAhead(c, st, { deepest, bodies, people }, { gap: Math.max(0, h.gap ?? 0), hl: h.hl ?? 0.5 });
          if (to !== null && landable(c, st, to)) {
            st.d = to; st.stuckT = 0; st.holdT = 0; st.blocked = 0; st.blockedBy = null; st.dodge = 0; st.dodgeTo = 0; st.hold = null; st.backUp = 0;
            this.tally.jumps += 1; this.tally.jumps_stuck = (this.tally.jumps_stuck || 0) + 1;
            const p = withCar(alongRoute(c.route, st.d, st.side), c); p.body = bodies(p, c.length, c.width || 1.9); unplace(c.id, here); pos.set(c.id, p); place(c.id, p);
            this.delays.set(c.key, tsec - c.unsched(st.d));
            out.push({ id: c.id, d: st.d, v: 0, reason: "put on past what held it", jump: true, route: st.route });
            continue;
          }
          st.stuckT = 0;   // (nowhere clear yet: looked for again after another wait)
        }
      }
      // Stood still in a junction's box (a jam, a knot of cars each waiting on another): after a
      // while it has the way (whatever its turn) and goes as soon as the road in front is clear --
      // never left there, and never through what stands in front of it.
      const inBox = J && st.d > J.s - J.box - c.length / 2 && st.d < J.end + c.length / 2;
      if (!inBox) { st.boxStill = 0; st.clearing = false; }
      else if (st.v < 0.3 && !danger) { st.boxStill = (st.boxStill || 0) + dt; if (st.boxStill > T.box_clear_s) st.clearing = true; }
      if (st.clearing && !danger) { target = Math.max(target, T.clear_speed); reason = "clearing the junction"; }
      // Far behind its day, out of your sight: put where its day has it (the day's milestones
      // are kept; a trip does not run for ever behind). In sight it is only ever driven.
      if (behind > T.hopeless_s && c.unseen && !inBox && !danger) {
        const to = this.catchUp(c, st, tsec, { deepest, bodies });
        if (to !== null && landable(c, st, to)) {
          st.d = to; st.v = Math.min(limit, c.cruise ?? limit); st.dodge = 0; st.dodgeTo = 0; st.hold = null; st.blocked = 0; st.blockedBy = null; st.backUp = 0;
          const p = withCar(alongRoute(c.route, st.d, st.side), c); p.body = bodies(p, c.length, c.width || 1.9); unplace(c.id, here); pos.set(c.id, p); place(c.id, p);
          this.delays.set(c.key, tsec - c.unsched(st.d)); this.tally.jumps += 1; this.tally.jumps_unseen = (this.tally.jumps_unseen || 0) + 1;
          out.push({ id: c.id, d: st.d, v: st.v, reason: "back on its day", jump: true, route: st.route });
          continue;
        }
      }
      // The sideways move that goes with this frame's move along (a metre for every 1 / dodge_rate).
      // Steered into, not slid: how far over a metre takes it (``st.steer``) changes a little a metre.
      const swing = (moved) => {
        const gap = st.dodgeTo - st.dodge, m = Math.abs(moved), aim = Math.max(-T.dodge_rate, Math.min(T.dodge_rate, gap * 1.3)), turn = m * T.steer_per_m;
        st.steer = (st.steer || 0) + Math.max(-turn, Math.min(turn, aim - (st.steer || 0)));
        const step = st.steer * m;
        return st.dodge + (gap > 0 ? Math.max(0, Math.min(step, gap)) : Math.min(0, Math.max(step, gap)));
      };
      // Backing up: to get room to swing out, or out of a knot. Slowly, never into what is behind.
      // (Braked to a stand first, then a moment for the gear, then gathering way: never backwards
      // out of going forwards.)
      if (st.backUp > 0 && !danger && st.v > 0.15) { target = 0; decel = Math.max(decel, T.brake); st.gearT = 0; st.rv = 0; }
      else if (st.backUp > 0 && !danger && (st.gearT = (st.gearT || 0) + dt) < T.gear_s) {
        st.v = 0; st.rv = 0; st.reason = "backing up";
        out.push({ id: c.id, d: st.d, v: 0, reason: "backing up", braking: true, reversing: true, route: st.route });
        continue;
      } else if (st.backUp > 0 && !danger) {
        st.rv = Math.min(T.back_speed, (st.rv || 0) + T.back_accel * dt);
        const d1 = Math.max(0, st.d - st.rv * dt), was = st.dodge;
        const next = alongRoute(c.route, d1, st.side);
        next.body = bodies(next, c.length, c.width || 1.9);
        if (d1 < st.d && !blocking(c.id, here, next, c.length + 6, -1) && !blocking(c.id, here, next, c.length + 6, 1)) {
          st.backUp -= st.d - d1; st.d = d1; st.v = 0; st.reason = "backing up";
          if (!(st.backUp > 0)) { st.rv = 0; st.gearT = 0; st.forwardAt = tsec + T.gear_s; }
          const p = { ...next, c }; unplace(c.id, here); pos.set(c.id, p); place(c.id, p);
          out.push({ id: c.id, d: st.d, v: -st.rv, reason: "backing up", reversing: true, route: st.route });
          continue;
        }
        st.dodge = was; st.backUp = 0; st.noBack = tsec + 1; st.rv = 0; st.gearT = 0; st.forwardAt = tsec + T.gear_s;
      }
      if (st.forwardAt > tsec && st.v < 0.15) target = 0;   // (into forward gear)
      if (st.v > target) st.v = Math.max(target, st.v - decel * dt);
      else st.v = Math.min(target, st.v + T.accel * dt);
      // How long it has stood (a jam is cars stood longer than a light holds them), and how long
      // for people on foot (after a while it has the next turn: view.mjs waitsAtKerb).
      if (st.v < 0.5) st.stood = (st.stood || 0) + dt; else if (st.v > 1.5) st.stood = 0;
      if (st.v < 0.5 && /someone|you/.test(reason || "")) st.pedT = (st.pedT || 0) + dt; else if (st.v > 1.5) st.pedT = 0;
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
        const was = st.dodge;
        st.dodge = swing(d1 - st.d);
        const next = alongRoute(c.route, d1, st.side);
        next.body = bodies(next, c.length, c.width || 1.9);
        const who = blocking(c.id, here, next, c.length + 6);
        if (who) {
          const op = pos.get(who), ost = this.cars.get(who);
          // Do not disguise an unavoidable physical impact as an instantaneous stop. The
          // 25 cm planning buffer still stops ordinary queues without causing a crash.
          const otherSpeed = ost?.v || 0, speed = op ? Math.hypot(st.v * fx + otherSpeed * Math.sin(op.yaw), st.v * fz + otherSpeed * Math.cos(op.yaw)) : 0;
          // (A crash is contact at speed. Two of the city's cars touching in a queue or a tight turn
          // stop; counted as crashes they hurt some twenty residents a minute, 2026-11-16.)
          // (Not with one put down on top of it this moment, where its trip begins: it stops.)
          if (op && into(next.body, op.body) > 0.25 && speed > NPC_STOP_DEAD_MS && st.v > 2 && !(ost?.spawnAt > tsec - 2)) {
            // (They stand a while -- half a minute after a bump, two after a hard one -- and
            // then drive on: stood for the rest of its leg, every bump was a wall in the lane.)
            const until = tsec + (speed >= 9 ? T.wreck_hard_s : T.wreck_s);
            st.hit = { id: `${c.key}:${who}:${Math.round(tsec * 1000)}`, kind: "vehicle", who, speed, x: next.x, z: next.z, yaw: next.yaw, until,
              target: { x: op.x, z: op.z, yaw: op.yaw }, context: { tsec, dt, route: c.key, segment: segInfo(c.route, st), d: st.d, lane: st.lane, speed: st.v, otherSpeed, reason, junction: J?.key ?? null, signal: J?.kind === "signal" ? signalAt(this.streets, J.node, Math.atan2(J.inU[0], J.inU[1]), tsec, T) : null,
                other: ost ? { route: ost.key, segment: segInfo(op.c.route, ost), d: ost.d, lane: ost.lane, reason: ost.reason } : null } };
            st.d = d1; st.v = 0;
            if (ost) { ost.hit = { id: st.hit.id, who: c.id, until }; ost.v = 0; const drawn = out.find((o) => o.id === who); if (drawn) { drawn.v = 0; drawn.hit = ost.hit; } }
            this.tally.crashes = (this.tally.crashes || 0) + 1;
            hits.push({ car: c.id, ...st.hit });
            out.push({ id: c.id, d: st.d, v: 0, hit: st.hit, route: st.route });
            continue;
          }
          st.dodge = was;
          st.v = 0; reason = "blocked"; st.blocked = (st.blocked || 0) + dt; st.blockedBy = who;
          st.reason = reason; st.leader = who;
          const other = this.cars.get(who);
          // Two in each other's way (it should not come to that): the one with the lower id backs
          // off a little and takes another way from the next junction.
          if (st.blocked > T.deadlock_s && other && (other.blockedBy === c.id || other.leader === c.id) && String(c.id) < String(who) && !st.backed) {
            st.backUp = 3; st.backed = true; st.avoidNext = true; this.tally.backs += 1;
          }
          // Stood blocked so long (a knot nothing unties): put on beyond what blocks it, where
          // the road is free -- a jump, never a drive through it.
          // (Out of your sight, after a moment: nobody watches a knot nobody sees.)
          if (st.blocked > (c.unseen ? T.shut_jump_s : T.teleport_s * (c.unseen === false ? T.seen_jump_x : 1))) {
            const to = this.jumpAhead(c, st, { deepest, bodies, people });
            if (to !== null && landable(c, st, to)) {
              { const o = this.cars.get(who), why = `jumps_knot_${c.bike ? "bike" : "car"}_by_${String(who).startsWith("blocker") ? "blocker" : o?.bike ? "bike" : "car"}`; this.tally[why] = (this.tally[why] || 0) + 1;
                // (The last few knots, for whoever looks into them: where, and how the two stood.)
                const op = pos.get(who);
                this.knots.push({ t: Math.round(tsec), x: Math.round(here.x), z: Math.round(here.z), a: c.id, b: who, inBox: Boolean(inBox), turn: J ? turnOf(J.inU, J.outU) : null, yaw: op ? +(((op.yaw - here.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI).toFixed(2) : null,
                  fwd: op ? +((op.x - here.x) * fx + (op.z - here.z) * fz).toFixed(1) : null, lat: op ? +((op.x - here.x) * -fz + (op.z - here.z) * fx).toFixed(1) : null, lane: st.lane, olane: o?.lane, oreason: o?.reason, oblockedBy: o?.blockedBy, oarrived: op && o ? o.d >= this.endOf(op.c) : null, unseen: Boolean(c.unseen),
                  mine: segInfo(c.route, st), theirs: op && o ? segInfo(op.c.route, o) : null });
                if (this.knots.length > 40) this.knots.shift(); }
              st.d = to; st.blocked = 0; st.blockedBy = null; st.backed = false; st.dodge = 0; st.dodgeTo = 0; st.hold = null; this.tally.jumps += 1;
              const p = withCar(alongRoute(c.route, st.d, st.side), c); p.body = bodies(p, c.length, c.width || 1.9); unplace(c.id, here); pos.set(c.id, p); place(c.id, p);
              this.delays.set(c.key, tsec - c.unsched(st.d));
              out.push({ id: c.id, d: st.d, v: 0, reason: "put on past a knot", jump: true, route: st.route });
              continue;
            }
          }
          this.delays.set(c.key, tsec - c.unsched(st.d));
          out.push({ id: c.id, d: st.d, v: 0, reason, braking: true, route: st.route });
          continue;
        }
      }
      // (Only once it is really going again: an inch forward and blocked again is still blocked --
      // the count had started over each time, so a knot never came to be backed out of.)
      if (st.v > 1) { st.blocked = 0; st.blockedBy = null; st.backed = false; }
      st.reason = reason;
      if (reason !== "the car ahead") st.leader = null;
      st.d = d1;
      { const p = withCar(alongRoute(c.route, st.d, st.side), c); p.body = bodies(p, c.length, c.width || 1.9); unplace(c.id, here); pos.set(c.id, p); place(c.id, p); }
      const delay = tsec - c.unsched(st.d);
      this.delays.set(c.key, delay);
      out.push({ id: c.id, d: st.d, v: st.v, reason, braking: st.v < target - 0.01 || decel > T.brake, route: st.route, behind: delay, held: st.pedT || 0 });
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
  pickLane(c, st, lanesOn, blockers = [], people = []) {
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
    // Someone standing in a lane: it is not going anywhere.
    for (const q of people) {
      if (!(q.still >= this.T.person_still_s)) continue;
      const along = (q.x - ax) * ux + (q.z - az) * uz - here, off = (q.x - ax) * -uz + (q.z - az) * ux;
      if (along < 2 || along > 60) continue;
      for (let k = 0; k < n; k += 1) if (Math.abs(laneOffset(half, cls, park, i, route, k) - off) < 1.5) crowd[k] += 4;
    }
    const turn = turnAhead(route, i, (node) => junctionAt(this.streets, node) !== null);
    const want = chooseLane({ n, cur, turn, crowd });
    st.waiting = false;
    if (want === cur) { st.lane = st.from = cur; return; }
    const next = cur + Math.sign(want - cur);
    for (const o of others) {
      if (o.id === c.id || (o.lane !== next && o.from !== next)) continue;
      const gap = o.along - here;
      // (Room behind for the one coming up that lane to slow to this car's speed: pulling out at
      // a crawl in front of one doing 25 mph, a second ahead of it, it was driven into.)
      const closing = Math.max(0, o.v * o.v - st.v * st.v) / (2 * this.T.brake);
      if (gap > -((c.length + o.length) / 2 + 2 + o.v + closing) && gap < (c.length + o.length) / 2 + 3) {
        st.waiting = Boolean(turn && (turn.blocks === 0 || turn.dist < 90));
        return;
      }
    }
    st.from = cur; st.lane = next; st.lt = 0;
  }
  //: Where what a car is going round is now (it may have walked off, or driven away): its place,
  //: or null when it is gone.
  holdAt(h, people, blockers, pos) {
    const id = String(h.id);
    if (id.startsWith("person:")) { const q = people.find((x) => `person:${x.id}` === id); return q ? { x: q.x, z: q.z } : null; }
    if (id.startsWith("blocker:")) { const o = blockers[Number(id.slice(8))]; return o && (o.v || 0) < 1 ? { x: o.x, z: o.z } : null; }
    const p = pos.get(h.id), o = this.cars.get(h.id);
    return p && (o?.hit || h.slow >= 0) ? { x: p.x, z: p.z } : null;
  }
  //: A way round what stands in the lane (``hold``): how far to swing out (``to``, metres right
  //: of its lane; left is less) and how far to back up first for the room (``back``) -- or null
  //: where there is no way: the kerb or the cars parked at it, another car beside or ahead in
  //: the way round, someone else there, or, over the middle line, a car coming.
  planDodge(c, st, here, hold, { near, pos, people, blockers }) {
    const T = this.T, route = c.route, i = segOf(route, st.d);
    const half = route.halves?.[i] ?? 3, cls = route.classes?.[i], park = route.parks?.[i] ?? null;
    const fx = -Math.sin(here.yaw), fz = -Math.cos(here.yaw), rx = -fz, rz = fx;
    const dx = hold.x - here.x, dz = hold.z - here.z, fwd = dx * fx + dz * fz, lat = dx * rx + dz * rz;
    const need = c.width / 2 + hold.hw + T.dodge_clear_m;
    if (Math.abs(lat) >= need) return null;   // not in the way after all
    const off0 = st.side(half, cls, park, i, route);
    // As far right as the kerb where nothing parks, else the edge of the parked cars; as far
    // left as the far lane (the far kerb's parked cars, on a one-way street the same).
    const kerb = Math.max(1.2, half - c.width / 2 - 0.3), lane = LANE(half, cls, park) + 0.5;
    const maxR = park === false || cls === "service" ? kerb : Math.min(kerb, lane), minL = -Math.min(kerb, lane);
    // (Past a cyclist the way round is as long as the pass takes, at the little it gains on them.)
    const moving = hold.slow >= 0, gain = T.pass_over;
    const passLen = moving ? ((Math.max(0, fwd) + hold.hl + c.length + 6) / gain) * (hold.slow + gain) : Math.max(0, fwd) + hold.hl + c.length + 4;
    const free = (shift) => {
      const off = off0 + shift;
      if (off > maxR + 1e-6 || off < minL - 1e-6) return false;
      let ok = true;
      near(here.x + fx * passLen / 2, here.z + fz * passLen / 2, passLen + 60, (oid) => {
        if (!ok || oid === c.id || oid === hold.id) return;
        const op = pos.get(oid), o = this.cars.get(oid);
        if (!op || !o) return;
        const ex = op.x - here.x, ez = op.z - here.z, ofwd = ex * fx + ez * fz, olat = ex * rx + ez * rz - shift;
        if (Math.abs(olat) > (c.width + (op.c.width || 1.9)) / 2 + 0.5) return;
        const same = Math.cos(op.yaw - here.yaw) > 0;
        // (The queue behind it in its own lane is not in the way round.)
        if (same && ofwd < 0 && Math.abs(olat + shift) < 1.2) return;
        if (same && moving && op.c.bike) return;   // (other cyclists along the edge are passed with it)
        if (same ? ofwd > -(c.length + 2 + o.v * 2) && ofwd < passLen + 2 : ofwd > -2 && ofwd < passLen * (1 + o.v / Math.max(1, hold.slow + gain || T.dodge_speed)) + (moving ? 12 : (o.v + T.dodge_speed) * T.oncoming_s + 8)) ok = false;
      });
      if (!ok) return false;
      for (let k = 0; k < blockers.length; k += 1) {
        if (`blocker:${k}` === hold.id) continue;
        const o = blockers[k], ex = o.x - here.x, ez = o.z - here.z, ofwd = ex * fx + ez * fz, olat = ex * rx + ez * rz - shift;
        if (Math.abs(olat) > (c.width + (o.width || 1.9)) / 2 + 0.5) continue;
        const same = Math.cos((o.yaw || 0) - here.yaw) > 0, ov = Math.abs(o.v || 0);
        if (same ? ofwd > -(c.length + 2) && ofwd < passLen + 2 : ofwd > -2 && ofwd < passLen + (ov + T.dodge_speed) * T.oncoming_s + 8) return false;
      }
      for (const q of people) {
        if (`person:${q.id}` === hold.id) continue;
        const ex = q.x - here.x, ez = q.z - here.z, ofwd = ex * fx + ez * fz, olat = ex * rx + ez * rz - shift;
        if (ofwd > -1 && ofwd < passLen && Math.abs(olat) < c.width / 2 + T.person_half_m + 0.6) return false;
      }
      return true;
    };
    // The lesser swing first; equal, the left (the way a driver goes round).
    const left = lat - need, right = lat + need;
    const order = Math.abs(right) + 0.3 < Math.abs(left) ? [right, left] : [left, right];
    for (const shift of order) {
      if (!free(shift)) continue;
      const room = fwd - c.length / 2 - hold.hl - 0.4, travel = Math.abs(shift) / T.dodge_rate + T.dodge_rate / T.steer_per_m;
      return { to: st.dodge + shift, back: Math.max(0, Math.min(T.back_max_m, travel - room)) };
    }
    return null;
  }
  //: The block after the next junction, looked at before it is turned into: stood full back to
  //: its start (a jam), the rest of the trip is planned again round it -- the same trip, by other
  //: streets, from that junction on; nobody piles in behind a jam they could see.
  lookAhead(c, st, lanesOn, tsec) {
    const T = this.T, route = c.route, { s, ids, pts } = route;
    if (!ids || tsec < (st.nextRoute || 0)) return;
    const i = segOf(route, st.d);
    let L = ids.length - 1;
    while (L > 0 && !(ids[L] >= 0)) L -= 1;
    for (const P of this.passages(route)) {
      // (The block after a junction: the one that leaves its last node on this way.)
      const j = P.i1, ahead = P.s0 - st.d;
      if (j <= i || j >= L) continue;
      if (ahead > T.reroute_look_m) return;
      if (!(ids[j] >= 0) || !(ids[j + 1] >= 0)) continue;
      // Too close to choose another way (in its turn lane, at the line): it goes on.
      if (ahead < this.stopLine(ids[P.i0], c) + 12) continue;
      const key = `${ids[j]}>${ids[j + 1]}`;
      const lanes = laneCount(route, j), on = (lanesOn.get(edgeKey(route, j)) || []).filter((o) => o.v < 0.7 && o.id !== c.id);
      const long = on.filter((o) => o.stood > T.jam_min_s).length * 6.5 / lanes >= T.jam_share * (s[j + 1] - s[j]);
      const jam = on.length >= T.jam_cars * lanes && (long || on.some((o) => o.along < T.jam_tail_m) || on.filter((o) => o.stood > T.jam_stood_s).length >= T.jam_cars * lanes);
      if (jam) this.jams.set(key, tsec + T.jam_known_s);
      if (!jam && !this.jams.has(key) && !st.avoidNext) continue;
      st.nextRoute = tsec + T.reroute_every_s;
      const avoid = new Map([...this.jams.keys()].filter((k) => !k.startsWith("shut:")).map((k) => [k, T.jam_cost_s]));
      avoid.set(key, T.jam_cost_s);
      const alt = this.streets.detour(ids[j], ids[L], { from: ids[j - 1] >= 0 ? ids[j - 1] : null, avoid });
      st.avoidNext = false;
      if (!alt || alt.ids.length < 2 || alt.ids[1] === ids[j + 1]) return;          // no other way: it waits its turn
      if (alt.length > (s[L] - s[j]) * 2.2 + 300) return;                             // too far round: the jam is quicker
      // The trip so far, the new way from the junction, and its last steps to the kerb as before.
      const next = { pts: [], halves: [], classes: [], parks: [], ids: [], lanes: [], oneways: [], bikes: [], twins: [] };
      const put = (x, z, half, cls, park, id, lane, oneway, bike, twin) => { next.pts.push([x, z]); next.halves.push(half); next.classes.push(cls); next.parks.push(park); next.ids.push(id); next.lanes.push(lane); next.oneways.push(oneway); next.bikes.push(bike); next.twins.push(twin ?? null); };
      const old = (k) => put(pts[k][0], pts[k][1], route.halves?.[k] ?? 3, route.classes?.[k] ?? "residential", route.parks?.[k] ?? null, ids[k], route.lanes?.[k] ?? 2, route.oneways?.[k] ?? false, route.bikes?.[k] ?? null, route.twins?.[k] ?? null);
      for (let k = 0; k < j; k += 1) old(k);
      const m = alt.ids.length;
      for (let k = 0; k < m; k += 1) { const e = Math.min(k, m - 2); put(alt.pts[k][0], alt.pts[k][1], alt.halves[e] ?? 3, alt.classes[e] ?? "residential", alt.parks[e] ?? null, alt.ids[k], alt.lanes[e] ?? 2, alt.oneways[e] ?? false, alt.bikes[e] ?? null, alt.twins?.[e] ?? null); }
      for (let k = L + 1; k < pts.length; k += 1) old(k);
      const S = [0];
      for (let k = 1; k < next.pts.length; k += 1) S.push(S[k - 1] + Math.hypot(next.pts[k][0] - next.pts[k - 1][0], next.pts[k][1] - next.pts[k - 1][1]));
      const first = st.first || (st.first = { length: route.length / (st.scale || 1) });
      st.route = { ...next, s: S, length: S[S.length - 1], mode: "drive", startSpot: route.startSpot || null, endSpot: route.endSpot || null, detour: true };
      st.scale = st.route.length / first.length;
      this.tally.reroutes += 1;
      return;
    }
  }
  //: Where a car far behind its day is put to be back on it: where its day has it (a little
  //: behind, so it comes on from there), at the first clear place at or before that -- or null
  //: where it would gain nothing or there is no room.
  catchUp(c, st, tsec, { deepest, bodies }) {
    const want = Math.min(this.endOf(c) - 1, c.sched(tsec - this.T.late_s));
    if (!(want > st.d + 30)) return null;
    // (Looked for once a second, not every frame: a late car with nowhere to be put looked at a
    // dozen places a frame, and with a few hundred late that was a third of the frame: 2026-11-19.)
    if (tsec < (st.noPut || 0)) return null;
    st.noPut = tsec + 1;
    for (let k = 0, d = want; k < 12 && d > st.d + 20; k += 1, d -= 4) {
      const p = alongRoute(c.route, d, st.side);
      if (this.inAnyBox(c.route, d, c.length)) continue;
      if (deepest(c.id, bodies(p, c.length, c.width || 1.9), p.x, p.z, c.length + 8).worst <= 0) return d;
    }
    return null;
  }
  //: Where a car stood blocked for good is put on to: the first clear place past what blocks it,
  //: outside any junction, within ``teleport_reach_m`` -- or null (it waits on).
  jumpAhead(c, st, { deepest, bodies, people }, hold = null) {
    const T = this.T, end = this.endOf(c);
    if (this.nowS < (st.noJump || 0)) return null;
    st.noJump = this.nowS + 0.5;
    const from = hold ? Math.max(0, hold.gap) + c.length + hold.hl * 2 + T.gap_m + 2 : c.length + 2;
    for (let d = st.d + from; d < Math.min(end, st.d + T.teleport_reach_m); d += 2) {
      if (this.inAnyBox(c.route, d, c.length)) continue;
      const p = alongRoute(c.route, d, st.side);
      if (deepest(c.id, bodies(p, c.length, c.width || 1.9), p.x, p.z, c.length + 8).worst > -0.5) continue;
      if (people.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < c.length / 2 + 1.5)) continue;
      return d;
    }
    // (Nothing clear before its leg's end: at the end, parked -- its trip is over.)
    return end - st.d < T.teleport_reach_m ? end : null;
  }
  //: Whether distance ``d`` along ``route`` is within a junction's box (a car's length either side).
  inAnyBox(route, d, length) {
    const { s, ids } = route;
    for (let i = 1; i < s.length - 1; i += 1) {
      if (s[i] - d > 40) break;
      if (d - s[i] > 40 || !(ids?.[i] >= 0) || !junctionAt(this.streets, ids[i])) continue;
      if (Math.abs(d - s[i]) < this.boxOf(ids[i]) + length / 2) return true;
    }
    return false;
  }
  //: Where a car's leg is over: half a metre short of its end, or at the stop line of a junction
  //: it ends at.
  endOf(c) {
    const r = c.route, n = r.ids ? r.ids.length - 1 : -1, last = r.ids?.[n];
    if (r._end !== undefined && r._endFor === c.length) return r._end;
    let L = r.length - 0.5;
    const J = last >= 0 ? this.streets.junctionOf(last) : null;
    if (J) {
      // (The first of the junction's nodes on the way in: its line is the trip's end.)
      let i = n;
      while (i > 1 && r.s[n] - r.s[i - 1] < JUNCTION_SPAN_M && r.ids[i - 1] >= 0 && this.streets.junctionOf(r.ids[i - 1]) === J) i -= 1;
      L = r.s[i] - this.stopLine(r.ids[i], c);
    }
    r._endFor = c.length;
    return (r._end = Math.max(Math.min(r.length - 0.5, 1), L));
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
    for (const P of this.passages(c.route)) {
      const ahead = P.s0 - st.d;
      if (ahead > this.T.look_m) return null;
      const box = this.boxOf(ids[P.i0]), end = P.s1 + this.boxOf(ids[P.i1]);
      if (st.d > end + c.length / 2) continue;
      const u = (a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1; return [dx / L, dz / L]; };
      const inU = u(pts[P.i0 - 1], pts[P.i0]), outU = u(pts[P.i1], pts[P.i1 + 1]);
      // Its way through, as it is driven (alongRoute rounds the corner: a right turn swings out a
      // little from its lanes' corner), from the box's near edge to its far one.
      // (In the lane the car is in: two cars side by side take different ways through.)
      const paths = (c.route._paths ??= new Map()), changing = st?.lt < 1 || Math.abs(st?.dodge || 0) > 0.01, pk = `${P.i0}:${st?.lane ?? "k"}`;
      const a = Math.max(0, P.s0 - box), b = Math.min(c.route.length, end);
      let path = changing ? null : paths.get(pk);
      if (!path) {
        path = [];
        const side = st?.side || KERB, n = Math.max(12, Math.ceil((b - a) / 1.5));
        for (let k = 0; k <= n; k += 1) { const q = alongRoute(c.route, a + ((b - a) * k) / n, side); path.push([q.x, q.z]); }
        if (!changing) paths.set(pk, path);
      }
      return { node: ids[P.i0], key: P.key, kind: P.kind, s: P.s0, box, end, inU, outU, path, mid: path[path.length >> 1], reach: (b - a) / 2 };
    }
    return null;
  }
  //: The junctions a route goes through, each once: from the first of a junction's nodes on the
  //: way (``i0``) to the last (``i1``) -- its line is before the first, its far side after the
  //: last. Not the junction the trip starts in, nor one it ends in.
  passages(route) {
    if (route._pass) return route._pass;
    const { s, ids } = route, out = [], S = this.streets, last = s.length - 1;
    const J0 = ids?.[0] >= 0 ? S.junctionOf(ids[0]) : null, JN = ids?.[last] >= 0 ? S.junctionOf(ids[last]) : null;
    for (let i = 1; ids && i < last; i += 1) {
      const J = ids[i] >= 0 ? S.junctionOf(ids[i]) : null;
      if (!J) continue;
      let i1 = i;
      for (let k = i + 1; k < last && s[k] - s[i] <= JUNCTION_SPAN_M; k += 1) if (ids[k] >= 0 && S.junctionOf(ids[k]) === J) i1 = k;
      const starts = J === J0 && s[i] < JUNCTION_SPAN_M, ends = J === JN && s[last] - s[i] < JUNCTION_SPAN_M;
      if (!starts && !ends) out.push({ i0: i, i1, key: J.key, kind: J.kind, s0: s[i], s1: s[i1] });
      i = i1;
    }
    return (route._pass = out);
  }
  //: Whether the queue ``id`` waits in is held at its head by something to wait for (a light, a
  //: stop sign, someone in the road, you): false for a ring of cars, or a head that is not held.
  heldAtHead(id) {
    const seen = new Set();
    for (let at = this.cars.get(id); at; at = this.cars.get(at.leader)) {
      if (seen.has(at)) return false;
      seen.add(at);
      if (at.reason !== "the car ahead") return Boolean(at.reason && at.v < 0.5);
      if (!at.leader) return Boolean(at.byBlocker && at.v < 0.5);
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
    if (h.serviceBay) return { out: true, state: "repair", condition: h.condition };
    if (h.tow_at && ms < h.tow_at && h.at) return { stays: true, state: h.state, at: h.at, condition: h.condition, label: h.state, damage: h.damage || null };
    // Towed and made good: stood at the mechanic's until its owner next has it out (crash.mjs).
    if (h.shop && ms < h.shop.until) return { stays: true, shop: true, state: "fine", at: h.shop, condition: 100, label: "at the mechanic's", damage: null };
    if (h.out_until && ms < h.out_until) return { out: true, state: "repair", condition: h.condition };
    return h.condition < 100 || h.damage ? { condition: h.condition, state: h.state, damage: h.damage || null } : null;
  }
  if (h.down_until && ms < h.down_until) return { down: true, at: h.at, carried: Boolean(h.carried), label: h.injuries?.at(-1)?.type || "hurt" };
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
