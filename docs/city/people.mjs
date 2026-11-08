// The people of a district and the traffic on its streets, as a function of time.
//
// Everyone's day is decided by a seeded roll for that person and that day: a job at a real
// building that does that work, a shift, a commute, breaks, errands, meals and evenings out.
// Where anyone is at any moment follows from that and the street graph: travelling between two
// places they are so far along the route, at their own pace. Nothing is stepped or stored, so two
// browsers in a party with the same seed and clock see the same person on the same corner
// without sending a byte about them. Pure, as docs/city/core.mjs is (tests/city_people.test.mjs).

import { tenantKinds } from "./core.mjs";

// ---- seeded numbers ------------------------------------------------------------------------------

export function hash32(...parts) {
  let h = 2166136261 >>> 0;
  for (const part of parts) {
    const s = String(part);
    for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    h ^= 0x9e3779b9; h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
  }
  return h >>> 0;
}
export function rng(...parts) {
  let a = hash32(...parts) || 1;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = (r, list) => list[Math.floor(r() * list.length) % list.length];

// ---- streets -------------------------------------------------------------------------------------

export const SPEED_MS = { freeway: 29, arterial: 13.4, residential: 11.2, shared: 6.7, service: 4.5 };

export function roadClass(way) {
  if (["driveway", "parking_aisle", "drive-through", "access"].includes(way.service)) return "service";
  if (way.service === "alley") return "shared";
  const name = way.name || "";
  if (/Freeway|Interstate|Skyway|Expressway|\bHighway\b/.test(name) && !/Avenue|Street/.test(name)) return "freeway";
  if (way.busway || (way.lanes || 0) >= 3 || (way.road_m || 0) >= 14) return "arterial";
  return "residential";
}

class Heap {
  constructor() { this.a = []; }
  push(p, v) { const a = this.a; a.push([p, v]); let i = a.length - 1; while (i) { const j = (i - 1) >> 1; if (a[j][0] <= a[i][0]) break; [a[i], a[j]] = [a[j], a[i]]; i = j; } }
  pop() { const a = this.a, top = a[0], last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[i], a[m]] = [a[m], a[i]]; i = m; } } return top; }
  get size() { return this.a.length; }
}

//: A district's streets as a graph in page metres. ``ways`` are the region's own streets and
//: footways: {pts: [[x, z], ...], kind, lanes, oneway (1 forward, -1 back, 0 both), road_m, name}.
export class Streets {
  constructor(ways, { snap = 0.8, cell = 60 } = {}) {
    this.nodes = []; this.edges = []; this.cell = cell; this.grid = new Map(); this.index = new Map();
    this.snap = snap;
    this.ends = [];
    for (const way of ways) this.addWay(way);
    this.joinEnds();
    this.reach = this.largestDriveNetwork();
    this.routes = new Map();
  }
  //: The map draws a street to the kerb of the one it meets, not always to a shared point: each
  //: street's end is joined to the nearest drivable point of another street within a few metres
  //: (Python's smc.city.streets does the same).
  joinEnds(reach = 9) {
    for (const [id, way] of this.ends) {
      const n = this.nodes[id];
      let best = null, bestD = reach;
      const cx = Math.floor(n.x / this.cell), cz = Math.floor(n.z / this.cell);
      for (let i = -1; i <= 1; i += 1) for (let j = -1; j <= 1; j += 1) {
        for (const m of this.grid.get(`${cx + i},${cz + j}`) || []) {
          const o = this.nodes[m];
          if (m === id || !o.drive || o.way === way) continue;
          const d = Math.hypot(o.x - n.x, o.z - n.z);
          if (d < bestD && !this.edges[id].some((e) => e.to === m)) { bestD = d; best = m; }
        }
      }
      if (best === null) continue;
      const e = { length: bestD, cls: "residential", drive: true, walk: true, half: 3, lanes: 2, name: null };
      this.edges[id].push({ ...e, to: best });
      this.edges[best].push({ ...e, to: id });
    }
  }
  //: The drivable streets that hang together (either way along one-way streets): cars start and
  //: end only on the largest such network.
  largestDriveNetwork() {
    const seen = new Int32Array(this.nodes.length).fill(-1);
    let best = -1, bestSize = 0, label = 0;
    const back = this.nodes.map(() => []);
    for (let a = 0; a < this.edges.length; a += 1) for (const e of this.edges[a]) if (e.drive) back[e.to].push(a);
    for (let s = 0; s < this.nodes.length; s += 1) {
      if (seen[s] >= 0 || !this.nodes[s].drive) continue;
      let size = 0; const stack = [s]; seen[s] = label;
      while (stack.length) {
        const u = stack.pop(); size += 1;
        for (const e of this.edges[u]) if (e.drive && seen[e.to] < 0) { seen[e.to] = label; stack.push(e.to); }
        for (const v of back[u]) if (seen[v] < 0) { seen[v] = label; stack.push(v); }
      }
      if (size > bestSize) { bestSize = size; best = label; }
      label += 1;
    }
    return new Set([...seen.keys()].filter((i) => seen[i] === best));
  }
  node(x, z) {
    const key = `${Math.round(x / this.snap)},${Math.round(z / this.snap)}`;
    let id = this.index.get(key);
    if (id === undefined) {
      id = this.nodes.length;
      this.index.set(key, id);
      this.nodes.push({ x, z, drive: false });
      this.edges.push([]);
      const g = `${Math.floor(x / this.cell)},${Math.floor(z / this.cell)}`;
      if (!this.grid.has(g)) this.grid.set(g, []);
      this.grid.get(g).push(id);
    }
    return id;
  }
  addWay(way) {
    const street = way.kind === "street";
    const cls = street ? roadClass(way) : "shared";
    const half = street ? Math.max(3, (way.road_m || (way.lanes || 2) * 3.4) / 2) : 0;
    let prev = null;
    const tag = way.id ?? (this._ways = (this._ways || 0) + 1);
    way.pts.forEach(([x, z], k) => {
      const id = this.node(x, z);
      if (street) { this.nodes[id].way ??= tag; if (k === 0 || k === way.pts.length - 1) this.ends.push([id, tag]); }
      if (prev !== null && prev !== id) {
        const a = this.nodes[prev], b = this.nodes[id], length = Math.hypot(b.x - a.x, b.z - a.z);
        const fwd = street && way.oneway !== -1, back = street && way.oneway !== 1;
        if (street) { a.drive = b.drive = true; }
        this.edges[prev].push({ to: id, length, cls, drive: fwd, walk: true, half, lanes: way.lanes || 2, name: way.name || null });
        this.edges[id].push({ to: prev, length, cls, drive: back, walk: true, half, lanes: way.lanes || 2, name: way.name || null });
      }
      prev = id;
    });
  }
  get size() { return this.nodes.length; }
  nearest(x, z, mode = "walk", reach = 200) {
    let best = null, bestD = reach;
    const r = Math.ceil(reach / this.cell), cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    for (let i = -r; i <= r; i += 1) for (let j = -r; j <= r; j += 1) {
      for (const id of this.grid.get(`${cx + i},${cz + j}`) || []) {
        const n = this.nodes[id];
        if (mode === "drive" && (!n.drive || (this.reach && !this.reach.has(id)))) continue;
        const d = Math.hypot(n.x - x, n.z - z);
        if (d < bestD) { bestD = d; best = id; }
      }
    }
    return best;
  }
  //: The way from node a to node b (A*), as a polyline with each point's distance along it and
  //: the half-width of the street it is on. Cached: a commute is asked for again and again.
  route(a, b, mode = "walk") {
    if (a === null || b === null || a === undefined || b === undefined) return null;
    const found = this.search(a, b, mode);
    return found || (mode === "drive" ? this.search(a, b, "drive_any") : null);
  }
  search(a, b, mode) {
    const key = `${mode}:${a}:${b}`;
    if (this.routes.has(key)) return this.routes.get(key);
    const goal = this.nodes[b], speed = mode !== "walk" ? SPEED_MS.freeway : 1;
    const g = new Map([[a, 0]]), came = new Map(), open = new Heap();
    open.push(0, a);
    let found = a === b, visited = 0;
    while (open.size && !found) {
      const [, n] = open.pop();
      if (n === b) { found = true; break; }
      if (++visited > 40000) break;
      const gn = g.get(n);
      for (const e of this.edges[n]) {
        const car = mode !== "walk";
        if (mode === "drive" ? !e.drive : mode === "drive_any" ? !(e.drive || this.edges[e.to].some((r) => r.to === n && r.drive)) : !e.walk) continue;
        const cost = gn + (car ? e.length / SPEED_MS[e.cls] : e.length);
        if (cost < (g.get(e.to) ?? Infinity)) {
          g.set(e.to, cost); came.set(e.to, [n, e]);
          const m = this.nodes[e.to];
          open.push(cost + Math.hypot(m.x - goal.x, m.z - goal.z) / speed, e.to);
        }
      }
    }
    let route = null;
    if (found) {
      const ids = [b], halves = [], classes = [];
      for (let n = b; n !== a;) { const [p, e] = came.get(n); halves.push(e.half); classes.push(e.cls); ids.push(p); n = p; }
      ids.reverse(); halves.reverse(); classes.reverse();
      const pts = ids.map((id) => [this.nodes[id].x, this.nodes[id].z]);
      const s = [0];
      for (let i = 1; i < pts.length; i += 1) s.push(s[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      route = { pts, s, halves, classes, length: s[s.length - 1], mode: mode === "drive_any" ? "drive" : mode };
    }
    if (this.routes.size > 6000) this.routes.delete(this.routes.keys().next().value);
    this.routes.set(key, route);
    return route;
  }
}
//: Where along ``route`` distance ``d`` is: the point, the heading (as a yaw: 0 faces -z), and
//: the point moved ``side`` metres to the right of the way (a lane, a pavement).
export function alongRoute(route, d, side = 0) {
  const { pts, s } = route;
  if (pts.length === 1) return { x: pts[0][0], z: pts[0][1], yaw: 0, half: 0 };
  d = Math.max(0, Math.min(route.length, d));
  let lo = 0, hi = s.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (s[m] <= d) lo = m; else hi = m; }
  const [ax, az] = pts[lo], [bx, bz] = pts[hi];
  const len = s[hi] - s[lo] || 1, t = (d - s[lo]) / len;
  const dx = (bx - ax) / len, dz = (bz - az) / len;
  const half = route.halves?.[lo] ?? 0;
  const off = typeof side === "function" ? side(half, route.classes?.[lo]) : side;
  // Right of travel, with x to the right and z towards the viewer: (-dz, dx).
  return { x: ax + (bx - ax) * t - dz * off, z: az + (bz - az) * t + dx * off, yaw: Math.atan2(-dx, -dz), half, cls: route.classes?.[lo] };
}

// ---- places and jobs ------------------------------------------------------------------------------

export const USE_BY_ARCHETYPE = {
  residential: "residential", generic: "residential", office: "office", restaurant: "restaurant", retail: "retail",
  gas_station: "gas_station", hotel: "hotel", civic: "civic", school: "school", parking: "parking", industrial: "industrial", park: "park",
};
//: A building as a place people live or work: what it is used for and what its shops are.
//: With the rules, a tenant named as a clinic or a gym is one (the map tags neither as a shop).
export function placeFromBuilding(b, streets, R = null) {
  const use = USE_BY_ARCHETYPE[b.archetype || "generic"] || "residential";
  const shops = (b.shops || []).map((s) => s.t).filter(Boolean);
  if (R) {
    for (const s of b.shops || []) for (const kind of tenantKinds(R, s.n)) if (!shops.includes(kind)) shops.push(kind);
    if (!shops.length && use !== "residential") for (const kind of tenantKinds(R, b.name)) shops.push(kind);
  }
  const node = streets.nearest(b.x, b.z, "walk", 120);
  if (node === null) return null;
  const keys = new Set([`use:${use}`, ...shops.map((t) => `shop:${t}`)]);
  // A house with shops at street level is a home upstairs and a workplace below.
  if (shops.length && use === "residential") keys.add("use:retail");
  return { id: b.id, x: b.x, z: b.z, node, use, shops, keys, name: b.name || null, area: b.area || 0, floors: b.floors || 1,
    door: b.door || null, lon: b.lon, lat: b.lat, tag: b.tag || null, inside: shops.length ? b.inside || null : null };
}

//: For every role, the places that do its work.
export function workplacesByRole(R, places) {
  const out = {};
  for (const [role, spec] of Object.entries(R.jobs.roles)) {
    out[role] = spec.at.includes("home") ? [] : places.filter((p) => spec.at.some((k) => p.keys.has(k)));
  }
  return out;
}

const FIRST = ["Alex", "Sam", "Maria", "Wei", "Priya", "Jordan", "Luis", "Mei", "Ana", "Omar", "Grace", "Diego", "Hana", "Noah",
  "Fatima", "Kenji", "Rosa", "Theo", "Aisha", "Marco", "Lena", "Jamal", "Sofia", "Ravi", "Elena", "Kai", "Nadia", "Ivan", "Lucy", "Tomas"];
const LAST = ["Nguyen", "Garcia", "Chen", "Patel", "Kim", "Lopez", "Wong", "Smith", "Singh", "Martinez", "Lee", "Johnson", "Ramirez",
  "Tran", "Brown", "Wu", "Hernandez", "Davis", "Liu", "Flores", "Park", "Silva", "Cohen", "Okafor", "Rossi", "Murphy"];

//: A district's people: each a home, a role at a real workplace for it and their own pace.
//: Roles are dealt by the rules' shares, and only to roles with somewhere to do them.
export function generatePopulation(R, places, { seed = "district", size = 1000 } = {}) {
  const homes = places.filter((p) => p.use === "residential");
  if (!homes.length) return [];
  const work = workplacesByRole(R, places);
  const roles = Object.entries(R.jobs.roles).filter(([role, spec]) => spec.at.includes("home") || work[role].length);
  const total = roles.reduce((s, [, spec]) => s + spec.share, 0);
  const people = [];
  const r = rng(seed, "population");
  // Larger homes house more: a home's chance by its floors.
  const weights = homes.map((h) => Math.max(1, h.floors || 1));
  const weightSum = weights.reduce((s, w) => s + w, 0);
  const homeFor = () => { let x = r() * weightSum; for (let i = 0; i < homes.length; i += 1) { x -= weights[i]; if (x <= 0) return homes[i]; } return homes[homes.length - 1]; };
  for (let i = 0; i < size; i += 1) {
    let x = r() * total, role = roles[0][0];
    for (const [id, spec] of roles) { x -= spec.share; if (x <= 0) { role = id; break; } }
    const spec = R.jobs.roles[role];
    const home = homeFor();
    const places = work[role] || [];
    // The nearer of three: people tend to work within reach of home.
    let workplace = null;
    if (places.length) {
      let best = Infinity;
      for (let k = 0; k < 3; k += 1) {
        const p = places[Math.floor(r() * places.length)];
        const d = Math.hypot(p.x - home.x, p.z - home.z);
        if (d < best) { best = d; workplace = p; }
      }
    }
    const pace = R.routine.walk_speed_ms[0] + r() * (R.routine.walk_speed_ms[1] - R.routine.walk_speed_ms[0]);
    people.push({ id: `npc:${i}`, name: `${pick(r, FIRST)} ${pick(r, LAST)}`, role, title: spec.title, uniform: spec.uniform,
      home: home.id, work: workplace?.id || (spec.at.includes("home") ? home.id : null), shift: Math.floor(r() * Math.max(1, spec.shifts.length)),
      pace, drives: r() < R.routine.drive_share || Boolean(spec.outdoor && /patrol|deliveries|fares|bus|sweep/.test(spec.outdoor)),
      height: 1.58 + r() * 0.3, outdoor: spec.outdoor || null, age: spec.at.includes("use:school") && role === "student" ? 8 + Math.floor(r() * 10) : 20 + Math.floor(r() * 50) });
  }
  return people;
}
export function populationByRole(people) {
  const out = {};
  for (const p of people) out[p.role] = (out[p.role] || 0) + 1;
  return out;
}

//: Whether a role works on this day of the week (0 Sunday) and day number.
export function worksOn(days, weekday, day, offset = 0) {
  switch (days) {
    case "daily": return true;
    case "weekdays": return weekday >= 1 && weekday <= 5;
    case "mon_sat": return weekday >= 1;
    case "tue_sat": return weekday >= 2;
    case "rotating": return (day + offset) % 7 < 5;
    case "every_third": return (day + offset) % 3 === 0;
    case "three_days": return (day + offset) % 7 < 3;
    default: return false;
  }
}

//: One person's day: what they do from midnight to midnight (minutes, and past 1440 for a night
//: shift that runs into tomorrow), each activity at a place or out of doors. Yesterday's night
//: shift is carried into the morning.
export function daySchedule(R, person, day, weekday, places) {
  const key = `${person.id}:${day}`;
  if (person._days?.has(key)) return person._days.get(key);
  const r = rng(person.id, day, "day");
  const spec = R.jobs.roles[person.role];
  const routine = R.routine;
  const out = [];
  const at = (kind, start, end, place, extra = {}) => { if (end > start) out.push({ kind, start, end, place, ...extra }); };
  const shiftFor = (d, wd) => (spec.shifts.length && person.work && worksOn(spec.days, wd, d, hash32(person.id) % 7))
    ? spec.shifts[person.shift % spec.shifts.length].map((h) => h * 60 + Math.round((rng(person.id, d, "late")() - 0.5) * 20)) : null;
  // A shift from yesterday that runs past midnight.
  const yesterday = shiftFor(day - 1, (weekday + 6) % 7);
  let clock = 0;
  if (yesterday && yesterday[1] > 1440) {
    at("work", 0, yesterday[1] - 1440, person.work, { outdoor: person.outdoor });
    clock = yesterday[1] - 1440;
  }
  const shift = shiftFor(day, weekday);
  const sleepEnd = shift ? Math.max(clock + 60, shift[0] - routine.ready_minutes - 25) : 7 * 60 + Math.floor(r() * 150);
  // Asleep at home until it is time to get ready (after a night shift, asleep through the morning).
  const wake = clock > 0 ? Math.min(clock + routine.sleep_hours * 60, shift ? shift[0] - 90 : 15 * 60) : sleepEnd;
  at("sleep", clock, wake, person.home);
  clock = Math.max(clock, wake);
  at("home", clock, clock + routine.ready_minutes, person.home);
  clock += routine.ready_minutes;
  const placeIds = places.map((p) => p.id);
  const errand = (from, until) => {
    if (until - from < 60 || r() > routine.errand_chance) return from;
    const shop = places[Math.floor(r() * places.length)];
    if (!shop || !shop.shops?.length) return from;
    const start = from + 10 + Math.floor(r() * 30);
    at("errand", start, start + 15 + Math.floor(r() * 25), shop.id);
    return start + 40;
  };
  if (shift) {
    const [s, e] = shift;
    clock = errand(clock, s - 30);
    const breakAt = s + R.routine.break_after_hours * 60;
    if (e - s > 6 * 60) {
      at("work", s, breakAt, person.work, { outdoor: person.outdoor });
      at("break", breakAt, breakAt + routine.break_minutes, person.work, { outside: true });
      at("work", breakAt + routine.break_minutes, e, person.work, { outdoor: person.outdoor });
    } else at("work", s, e, person.work, { outdoor: person.outdoor });
    clock = e;
  }
  if (clock < 1440) {
    // After work or through a free day: a meal out, an errand, an evening out, a walk.
    if (r() < routine.meal_out_chance && clock < 21 * 60) {
      const food = places.filter((p) => p.keys.has("shop:restaurant") || p.keys.has("shop:cafe") || p.keys.has("use:restaurant"));
      if (food.length) { const p = food[Math.floor(r() * food.length)]; const start = Math.max(clock + 20, 12 * 60 + Math.floor(r() * 8 * 60)); at("meal", start, start + 50, p.id); clock = Math.max(clock, start + 60); }
    }
    clock = errand(clock, 21 * 60);
    if (r() < routine.stroll_chance && clock < 20 * 60) {
      const start = clock + 20 + Math.floor(r() * 90);
      at("stroll", start, start + 25 + Math.floor(r() * 35), person.home, { outdoor: "stroll", seed: Math.floor(r() * 1e9) });
      clock = start + 65;
    }
    if (r() < routine.evening_out_chance && clock < 22 * 60) {
      const bars = places.filter((p) => p.keys.has("shop:bar") || p.keys.has("shop:restaurant"));
      if (bars.length) { const p = bars[Math.floor(r() * bars.length)]; const start = Math.max(clock + 30, 19 * 60 + Math.floor(r() * 120)); at("evening", start, start + 90 + Math.floor(r() * 90), p.id); clock = start + 200; }
    }
    at("sleep", Math.min(Math.max(clock + 30, 22 * 60 + Math.floor(r() * 90)), 1500), 1440 + 1, person.home);
  }
  // Activities in order, none overlapping: a later one waits for the one before to end.
  out.sort((a, b) => a.start - b.start);
  for (let i = 1; i < out.length; i += 1) if (out[i].start < out[i - 1].end) { const len = out[i].end - out[i].start; out[i].start = out[i - 1].end; out[i].end = Math.max(out[i].end, out[i].start + Math.min(len, 30)); }
  const result = out.filter((a) => a.end > a.start && placeIds.length);
  person._days ??= new Map();
  if (person._days.size > 3) person._days.delete(person._days.keys().next().value);
  person._days.set(key, result);
  return result;
}

// ---- where everyone is ----------------------------------------------------------------------------

const TRAFFIC_BY_HOUR = [0.15, 0.1, 0.08, 0.08, 0.12, 0.25, 0.55, 0.9, 1.0, 0.8, 0.65, 0.65, 0.7, 0.65, 0.65, 0.75, 0.9, 1.0, 0.9, 0.7, 0.55, 0.45, 0.35, 0.25];
const TRAFFIC_MIX = [["economy", 0.3], ["sedan", 0.18], ["suv", 0.12], ["compact_ev", 0.1], ["pickup", 0.05], ["taxi", 0.08], ["delivery_van", 0.1], ["box_truck", 0.04], ["bus", 0.02], ["patrol", 0.01]];

//: The district in motion: ``at(ms, focus)`` lists the people out of doors and the vehicles on
//: the streets within reach of ``focus``, each where it is at that moment.
export class Crowd {
  constructor(R, streets, places, people, { seed = "district", timeAt }) {
    this.R = R; this.streets = streets; this.people = people; this.seed = seed; this.timeAt = timeAt;
    this.places = places; this.place = new Map(places.map((p) => [p.id, p]));
    this.nodes = places.length ? places.map((p) => p.node) : [];
    this.driveNodes = streets.nodes.map((n, i) => (n.drive ? i : -1)).filter((i) => i >= 0);
  }
  //: Where person p is at time t (and which way they face): null when indoors.
  personAt(p, t, focus, reach) {
    const day = t.day, minute = t.minute;
    let sched = daySchedule(this.R, p, day, t.weekday, this.places);
    let i = sched.findIndex((a) => minute >= a.start && minute < a.end);
    const travel = (a, b, depart) => {
      const from = this.place.get(a.place), to = this.place.get(b.place);
      if (!from || !to || from === to) return null;
      const drive = p.drives && Math.hypot(to.x - from.x, to.z - from.z) > 700;
      const mode = drive ? "drive" : "walk";
      const s = drive ? this.streets.nearest(from.x, from.z, "drive") : from.node, e = drive ? this.streets.nearest(to.x, to.z, "drive") : to.node;
      // Cheap first: neither end nor the line between them anywhere near the focus.
      if (distToSegment(focus.x, focus.z, from.x, from.z, to.x, to.z) > reach) return { far: true };
      const route = this.streets.route(s, e, mode);
      if (!route) return null;
      const speed = drive ? 9.5 : p.pace;
      const duration = route.length / speed / 60;
      return { route, depart, duration, mode, speed };
    };
    // Between two activities at different places: on the way, if the clock is in the journey.
    for (let k = Math.max(0, i - 1); k < sched.length - 1 && k <= i + 1; k += 1) {
      const a = sched[k], b = sched[k + 1];
      if (a.place === b.place) continue;
      const leg = travel(a, b, a.end);
      if (!leg || leg.far) continue;
      if (minute >= leg.depart && minute < leg.depart + leg.duration) {
        const d = (minute - leg.depart) * 60 * leg.speed;
        const pos = alongRoute(leg.route, d, leg.mode === "drive" ? (half) => Math.max(1.7, half - 1.8) : (half) => half + 1.6 * (hash32(p.id) % 2 ? 1 : -1));
        return { ...pos, moving: true, mode: leg.mode, activity: `to ${b.kind}` };
      }
    }
    if (i < 0) return null;
    const a = sched[i];
    const place = this.place.get(a.place);
    if (!place) return null;
    if (a.kind === "break" && a.outside) {
      const r = rng(p.id, day, "break");
      return { x: place.x + (place.door?.nx ?? 0) * 2 + (r() - 0.5) * 3, z: place.z + (place.door?.nz ?? 0) * 2 + (r() - 0.5) * 3, yaw: r() * 6.28, moving: false, mode: "walk", activity: "on a break", at: place.door };
    }
    if (a.kind === "stroll" || (a.kind === "work" && a.outdoor)) return this.roaming(p, a, place, t, focus, reach);
    // Inside a shop near you: its staff behind the counter, its customers in front of it.
    if (place.inside && Math.hypot(place.x - focus.x, place.z - focus.z) < INDOOR_REACH_M) return indoorSpot(p, a, place, t);
    return null;
  }
  //: Out of doors at work or for a walk: a loop round the streets near the place, at the role's
  //: pace (a patrol car, a delivery round, a letter carrier's route, a street sweeper's crawl).
  roaming(p, a, place, t, focus, reach) {
    if (Math.hypot(place.x - focus.x, place.z - focus.z) > reach + 1500) return null;
    const leg = Math.floor((t.minute - a.start) / 12);
    const r = rng(p.id, t.day, a.kind, leg);
    const drive = p.drives && a.kind !== "stroll" && !/route/.test(a.outdoor || "") ;
    const mode = drive ? "drive" : "walk";
    const from = drive ? this.streets.nearest(place.x, place.z, "drive") : place.node;
    let to = null;
    for (let k = 0; k < 6 && to === null; k += 1) {
      const ang = r() * Math.PI * 2, dist = (drive ? 500 : 180) * (0.4 + r());
      to = this.streets.nearest(place.x + Math.cos(ang) * dist, place.z + Math.sin(ang) * dist, mode, 120);
    }
    const route = this.streets.route(from, to, mode);
    if (!route || route.length < 5) return null;
    const speed = drive ? (a.outdoor === "sweep" ? 2.2 : 8) : p.pace * (a.kind === "stroll" ? 0.8 : 1);
    const into = (t.minute - a.start - leg * 12) * 60 * speed;
    // Out and back along the same way.
    const d = into % (2 * route.length);
    const forward = d <= route.length;
    const along = forward ? d : 2 * route.length - d;
    const pos = alongRoute(route, along, drive ? (half) => (forward ? 1 : -1) * Math.max(1.7, half - 1.8) : (half) => (forward ? 1 : -1) * (half + 1.6));
    if (!forward) pos.yaw += Math.PI;
    return { ...pos, moving: true, mode, activity: a.kind === "stroll" ? "out for a walk" : `${this.R.jobs.roles[p.role].title.toLowerCase()} at work` };
  }
  //: Through traffic: trips that start in each 400 m square in each half minute, seeded by the
  //: square and the half minute -- so two browsers near each other draw the same cars.
  traffic(t, focus, reach) {
    const out = [];
    if (!this.driveNodes.length) return out;
    const SLOT = 30, CELL = 400;
    const secondsOfDay = t.minute * 60;
    const slot = Math.floor(t.ms / 1000 / SLOT);
    const density = TRAFFIC_BY_HOUR[Math.floor(t.minute / 60) % 24];
    const cx = Math.floor(focus.x / CELL), cz = Math.floor(focus.z / CELL), rr = Math.ceil(reach / CELL);
    for (let i = -rr; i <= rr; i += 1) for (let j = -rr; j <= rr; j += 1) {
      const cell = `${cx + i},${cz + j}`;
      const nodes = this.cellDriveNodes(cx + i, cz + j, CELL);
      if (!nodes.length) continue;
      // A trip lasts up to four minutes; the slots that could still have a car on the road.
      for (let back = 0; back < 8; back += 1) {
        const s = slot - back;
        for (const trip of this.trips(cell, s, nodes, density)) {
          const { k, route, model, shade: colourRoll } = trip;
          const elapsed = (t.ms / 1000 - s * SLOT) - k * 3;
          const speedFor = (cls) => SPEED_MS[cls] * (model === "bus" || model === "box_truck" ? 0.75 : 0.85);
          // Distance along with each stretch at its own class's speed.
          let d = 0, left = elapsed;
          for (let q = 1; q < route.pts.length && left > 0; q += 1) {
            const seg = route.s[q] - route.s[q - 1], v = speedFor(route.classes[q - 1]);
            const tt = seg / v;
            if (tt <= left) { d += seg; left -= tt; } else { d += left * v; left = 0; }
          }
          if (elapsed < 0 || d >= route.length) continue;
          const pos = alongRoute(route, d, (half) => Math.max(1.7, half - 1.8));
          if (Math.hypot(pos.x - focus.x, pos.z - focus.z) > reach) continue;
          out.push({ id: `car:${cell}:${s}:${k}`, ...pos, model, moving: true, shade: colourRoll, speed: speedFor(pos.cls || "residential"), secondsOfDay });
        }
      }
    }
    return out;
  }
  //: The trips that start in a square in a half minute: decided once, kept a while.
  trips(cell, s, nodes, density) {
    this._trips ??= new Map();
    const key = `${cell}:${s}`;
    let list = this._trips.get(key);
    if (list) return list;
    list = [];
    const r = rng(this.seed, "traffic", cell, s);
    const count = Math.floor(density * Math.min(3, nodes.length / 40) + r());
    for (let k = 0; k < count; k += 1) {
      const a = nodes[Math.floor(r() * nodes.length)];
      const ang = r() * Math.PI * 2, dist = 300 + r() * 700;
      const na = this.streets.nodes[a];
      const b = this.streets.nearest(na.x + Math.cos(ang) * dist, na.z + Math.sin(ang) * dist, "drive", 200);
      const roll = r();
      let model = TRAFFIC_MIX[0][0];
      for (let m = 0, acc = 0; m < TRAFFIC_MIX.length; m += 1) { acc += TRAFFIC_MIX[m][1]; if (roll <= acc) { model = TRAFFIC_MIX[m][0]; break; } }
      const shade = r();
      if (b === null || b === a) continue;
      const route = this.streets.route(a, b, "drive");
      if (route) list.push({ k, route, model, shade });
    }
    if (this._trips.size > 4000) this._trips.delete(this._trips.keys().next().value);
    this._trips.set(key, list);
    return list;
  }
  cellDriveNodes(i, j, CELL) {
    this._cells ??= new Map();
    const key = `${i},${j}`;
    let list = this._cells.get(key);
    if (!list) {
      list = this.driveNodes.filter((n) => { const p = this.streets.nodes[n]; return Math.floor(p.x / CELL) === i && Math.floor(p.z / CELL) === j; });
      this._cells.set(key, list);
    }
    return list;
  }
  //: Everyone out of doors and every vehicle within ``reach`` of ``focus`` at ``ms``.
  at(ms, focus, reach = this.R.routine.visible_radius_m) {
    const t = this.timeAt(ms);
    const people = [], vehicles = [];
    for (const p of this.people) {
      const s = this.personAt(p, t, focus, reach);
      if (!s || Math.hypot(s.x - focus.x, s.z - focus.z) > reach) continue;
      const entry = { id: p.id, person: p, ...s };
      if (s.mode === "drive") vehicles.push({ ...entry, model: p.role === "police" ? "patrol" : p.role === "taxi_driver" ? "taxi" : p.role === "bus_driver" ? "bus" : p.role === "delivery_driver" ? "delivery_van" : p.role === "street_cleaner" ? "box_truck" : "sedan", shade: (hash32(p.id) % 1000) / 1000 });
      else people.push(entry);
    }
    vehicles.push(...this.traffic(t, focus, reach));
    return { time: t, people, vehicles };
  }
}
const INDOOR_REACH_M = 70;
//: Who works the counter in a shop (the rest are in the back, or not in a shop at all).
export const COUNTER_ROLES = new Set(["barista", "baker", "cook", "server", "bartender", "clerk", "grocer", "pharmacist", "pharmacy_tech",
  "stylist", "teller", "laundry_attendant", "attendant", "housekeeper", "night_auditor", "security_guard"]);
//: Where a shop's counter is: so far in from its front (``inside``: the front's middle, the inward
//: normal, half its width and its depth).
export function counterLine(inside) {
  const counter = Math.min(Math.max(1.6, inside.depth * 0.42), 3.4);
  return { counter, staff: counter + 0.85, back: Math.min(inside.depth - 0.7, counter + 2.6), front: Math.max(0.8, counter - 1.1), width: Math.max(0.5, inside.half - 0.7) };
}
//: Someone inside a shop: staff along the counter a step at a time (now and then to the back for
//: stock), customers waiting in front of it or at a table. Null for anyone else indoors.
function indoorSpot(p, a, place, t) {
  const I = place.inside, L = counterLine(I);
  const tx = -I.nz, tz = I.nx;   // along the front
  const sec = t.minute * 60, slot = Math.floor(sec / 18);
  const staff = a.kind === "work" && COUNTER_ROLES.has(p.role);
  const customer = (a.kind === "errand" || a.kind === "meal" || a.kind === "evening") && place.shops.length;
  if (!staff && !customer) return null;
  const spot = (k) => {
    const r = rng(p.id, t.day, k);
    if (staff) return r() < 0.15 ? [(r() - 0.5) * 2 * L.width, L.back] : [(r() - 0.5) * 2 * L.width, L.staff];
    // Customers: at the counter, or (a meal) a table further toward the window.
    return a.kind === "errand" ? [(r() - 0.5) * 2 * L.width, L.front + r() * 0.4] : [(r() - 0.5) * 2 * L.width, 0.7 + r() * Math.max(0.2, L.front - 0.6)];
  };
  const [a0, d0] = spot(slot - 1), [a1, d1] = spot(slot);
  const f = Math.min(1, (sec - slot * 18) / 3.5);
  const along = a0 + (a1 - a0) * f, deep = d0 + (d1 - d0) * f;
  const moving = f < 1 && Math.hypot(a1 - a0, d1 - d0) > 0.2;
  // Facing out over the counter (staff), or in toward it (customers).
  const yaw = staff ? Math.atan2(I.nx, I.nz) : Math.atan2(-I.nx, -I.nz);
  return { x: I.x + tx * along + I.nx * deep, z: I.z + tz * along + I.nz * deep, yaw: moving ? Math.atan2(-(tx * (a1 - a0) + I.nx * (d1 - d0)), -(tz * (a1 - a0) + I.nz * (d1 - d0))) : yaw,
    moving, mode: "walk", indoors: place.id, activity: staff ? "behind the counter" : a.kind === "errand" ? "at the counter" : "at a table" };
}
function distToSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2)) : 0;
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}
