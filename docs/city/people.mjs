// The people of a district and the traffic on its streets, as a function of time.
//
// Everyone's day is decided by a seeded roll for that person and that day: a job at a real
// building that does that work, a shift, a commute, breaks, errands, meals and evenings out.
// Where anyone is at any moment follows from that and the street graph: travelling between two
// places they are so far along the route, at their own pace. Nothing is stepped or stored, so two
// browsers in a party with the same seed and clock see the same person on the same corner
// without sending a byte about them. Pure, as docs/city/core.mjs is (tests/city_people.test.mjs).

import { shopKinds, tenantKinds } from "./core.mjs";

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
    //: Every drivable node's network (the streets that hang together), by label: a district
    //: seen in pieces (a jump across the map) is more than one.
    this.comp = seen;
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
        // Parking on the right of each way of travel (SFMTA's block faces: way.parking_sides, 1
        // the left of the way as drawn, -1 its right): true, false, or null where unknown.
        const sides = Array.isArray(way.parking_sides) ? way.parking_sides : null;
        // A bike lane on the right of each way of travel (way.bike: the drawn way's right and left).
        const bike = way.bike || null;
        this.edges[prev].push({ to: id, length, cls, drive: fwd, walk: true, half, lanes: way.lanes || 2, name: way.name || null, park: sides ? sides.includes(-1) : null, bike: bike ? bike.right || null : null });
        this.edges[id].push({ to: prev, length, cls, drive: back, walk: true, half, lanes: way.lanes || 2, name: way.name || null, park: sides ? sides.includes(1) : null, bike: bike ? bike.left || null : null });
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
        if (mode === "kerb" && !n.drive) continue;
        const d = Math.hypot(n.x - x, n.z - z);
        if (d < bestD) { bestD = d; best = id; }
      }
    }
    return best;
  }
  //: The way from node a to node b (A*), as a polyline with each point's distance along it and
  //: the half-width of the street it is on. Cached: a commute is asked for again and again.
  //: The streets' widths made the world's own: each street's half-width from the kerbs as the
  //: page draws them (``kerbAt(x, z, ax, az)`` -> the nearest drawn kerb point), measured either
  //: side of its middle, where both are found and sensible. OpenStreetMap's widths are often a
  //: few metres out from the measured kerbs: the cars parked at those kerbs stood in the lanes,
  //: and the pavement walked was in among them. Returns how many ways it changed.
  calibrate(kerbAt) {
    let changed = 0;
    for (let a = 0; a < this.nodes.length; a += 1) {
      for (const e of this.edges[a]) {
        if (!(e.half > 0) || e.to < a) continue;
        const A = this.nodes[a], B = this.nodes[e.to], L = Math.hypot(B.x - A.x, B.z - A.z);
        if (L < 4) continue;
        const ux = (B.x - A.x) / L, uz = (B.z - A.z) / L, nx = -uz, nz = ux, mx = (A.x + B.x) / 2, mz = (A.z + B.z) / 2;
        const side = (sg) => {
          const k = kerbAt(mx + nx * sg * e.half, mz + nz * sg * e.half, ux, uz);
          if (!k) return null;
          const off = (k.x - mx) * nx * sg + (k.z - mz) * nz * sg, along = Math.abs((k.x - mx) * ux + (k.z - mz) * uz);
          return off > 1.5 && off < 20 && along < L / 2 + 2 ? off : null;
        };
        const l = side(1), r = side(-1);
        if (l === null || r === null || Math.abs(l - r) > 4) continue;
        const half = Math.max(3, (l + r) / 2);
        if (Math.abs(half - e.half) < 0.3) continue;
        e.half = half;
        const back = this.edges[e.to].find((x) => x.to === a);
        if (back) back.half = half;
        changed += 1;
      }
    }
    if (changed) this.routes = new Map();
    return changed;
  }
  route(a, b, mode = "walk") {
    if (a === null || b === null || a === undefined || b === undefined) return null;
    const found = this.search(a, b, mode);
    return found || (mode === "drive" ? this.search(a, b, "drive_any") : null);
  }
  //: Drivers keep to the main streets (rules.json traffic): a way's cost is its time at the
  //: limit times its class's preference, less on a named corridor by its weight.
  setPreferences(traffic) {
    this.prefer = traffic?.class_preference || null;
    this.corridor = new Map((traffic?.corridors || []).map((c) => [c.name, c.weight]));
    const least = Math.min(1, ...Object.values(this.prefer || {})) / (1 + 0.06 * Math.max(0, ...this.corridor.values()));
    this.leastCost = least;
    this.routes = new Map();
  }
  driveCost(e) {
    const w = (e.name && this.corridor?.get(e.name)) || 0;
    return (e.length / SPEED_MS[e.cls]) * (this.prefer?.[e.cls] ?? 1) / (1 + 0.06 * w);
  }
  search(a, b, mode) {
    const key = `${mode}:${a}:${b}`;
    if (this.routes.has(key)) return this.routes.get(key);
    const goal = this.nodes[b], speed = mode !== "walk" ? SPEED_MS.freeway / (this.leastCost || 1) : 1;
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
        const cost = gn + (car ? this.driveCost(e) : e.length);
        if (cost < (g.get(e.to) ?? Infinity)) {
          g.set(e.to, cost); came.set(e.to, [n, e]);
          const m = this.nodes[e.to];
          open.push(cost + Math.hypot(m.x - goal.x, m.z - goal.z) / speed, e.to);
        }
      }
    }
    let route = null;
    if (found) {
      const ids = [b], halves = [], classes = [], parks = [], lanes = [], oneways = [], bikes = [];
      for (let n = b; n !== a;) {
        const [p, e] = came.get(n);
        halves.push(e.half); classes.push(e.cls); parks.push(e.park ?? null); ids.push(p);
        lanes.push(e.lanes || 2); oneways.push(!this.edges[e.to].some((r) => r.to === p && r.drive)); bikes.push(e.bike || null);
        n = p;
      }
      ids.reverse(); halves.reverse(); classes.reverse(); parks.reverse(); lanes.reverse(); oneways.reverse(); bikes.reverse();
      const pts = ids.map((id) => [this.nodes[id].x, this.nodes[id].z]);
      const s = [0];
      for (let i = 1; i < pts.length; i += 1) s.push(s[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      route = { pts, s, halves, classes, parks, ids, lanes, oneways, bikes, length: s[s.length - 1], mode: mode === "drive_any" ? "drive" : mode };
    }
    if (this.routes.size > 6000) this.routes.delete(this.routes.keys().next().value);
    this.routes.set(key, route);
    return route;
  }
}
//: How far right of a street's middle a car drives (the middle of its lane), from the street's
//: half-width, its class and whether cars park on that side (``park``: the edge's, true / false /
//: null for not known -- parked on where a residential street is not known not to be): clear of
//: the cars parked there, which stand a hand's width off the kerb.
export const LANE_PARKED_M = 3.3;
export function LANE(half, cls = null, park = null) {
  const parked = park === true || (park === null && cls === "residential");
  return Math.max(1.7, half - (parked ? LANE_PARKED_M : 1.8));
}
//: The lane a car keeps for the turn ahead (rules of the road: a left turn is made from the
//: leftmost lane, a right from the kerb lane). A street's lanes each way are its lanes (one-way)
//: or half of them; within TURN_LOOK_M of a turn of more than TURN_MIN_DEG a car is in the lane
//: for it, and it changes lanes at the block's start, never in the junction. Cars all drove in
//: the kerb lane: on Lombard a car turned left across two lanes from the far right (2026-11-11).
export const LANE_W = 3.2, TURN_LOOK_M = 90, TURN_MIN_DEG = 35;
export function lanePlan(route) {
  if (route.plan !== undefined) return route.plan;
  const { pts, s } = route;
  if (!route.lanes || pts.length < 3) return (route.plan = null);
  const n = route.lanes.map((l, i) => (route.oneways[i] ? Math.max(1, l) : Math.max(1, Math.floor(l / 2))));
  // The turn at each vertex: -1 left, 1 right, 0 on.
  const turn = new Int8Array(pts.length), sin = Math.sin((TURN_MIN_DEG * Math.PI) / 180);
  for (let v = 1; v < pts.length - 1; v += 1) {
    const ax = pts[v][0] - pts[v - 1][0], az = pts[v][1] - pts[v - 1][1], bx = pts[v + 1][0] - pts[v][0], bz = pts[v + 1][1] - pts[v][1];
    const la = Math.hypot(ax, az) || 1, lb = Math.hypot(bx, bz) || 1;
    // The way's right is (-dz, dx): the next leg's share of it is the turn's side and size.
    const right = (bx * -az + bz * ax) / (la * lb), on = (ax * bx + az * bz) / (la * lb);
    if (Math.abs(right) > sin || on < 0) turn[v] = right >= 0 ? 1 : -1;
  }
  // With no turn close ahead, routes spread over the lanes (by where they come from and go to):
  // the cars not driven by the rules (further off) are not all in the kerb lane either.
  const ids = route.ids || [], spread = hash32("lanes", ids[0] ?? 0, ids[ids.length - 1] ?? 0);
  const k = n.map((lanes, i) => {
    if (lanes <= 1) return 0;
    for (let v = i + 1; v < pts.length - 1 && s[v] - s[i + 1] < TURN_LOOK_M; v += 1) if (turn[v]) return turn[v] < 0 ? lanes - 1 : 0;
    return spread % lanes;
  });
  return (route.plan = { n, k, turn });
}
//: Right of a street's middle by ``half``, a car's lane: the kerb lane, or the one the turn
//: ahead takes (``lanePlan``). For alongRoute's side: (half, cls, park, segment, route).
export function DRIVE_LANE(half, cls = null, park = null, i = 0, route = null) {
  const base = LANE(half, cls, park), plan = route ? lanePlan(route) : null;
  if (!plan) return base;
  const n = plan.n[i] || 1, k = Math.min(plan.k[i] || 0, n - 1);
  if (n <= 1 || k === 0) return base;
  // The leftmost lane of a two-way street is beside the middle line; of a one-way, beside the
  // left kerb (clear of the cars parked there).
  const left = route.oneways[i] ? -LANE(half, cls, park) : 1.7;
  return base - ((base - left) * k) / (n - 1);
}
//: Lane ``j`` of segment ``i`` (0 the kerb lane, n - 1 the leftmost), as metres right of the
//: street's middle: the driving lanes only -- never the parking lane at the kerb (LANE keeps
//: the kerb lane clear of the cars parked there; PARK_LANE in fleet.mjs is where they stand).
export function laneOffset(half, cls, park, i, route, j) {
  const base = LANE(half, cls, park), n = laneCount(route, i);
  const k = Math.max(0, Math.min(n - 1, Math.round(j)));
  if (n <= 1 || k === 0) return base;
  const left = route.oneways?.[i] ? -LANE(half, cls, park) : 1.7;
  return base - ((base - left) * k) / (n - 1);
}
//: How many lanes segment ``i`` has the way the route goes (1 where not known).
export function laneCount(route, i) {
  const plan = route ? lanePlan(route) : null;
  return plan ? Math.max(1, plan.n[i] || 1) : 1;
}
//: The next turn on ``route`` after segment ``i``: its side (-1 left, 1 right), how far ahead
//: (m, from the segment's end) and how many junctions (blocks) come before it -- 0 when it is
//: at the end of this block. null when the route goes straight on to its end.
export function turnAhead(route, i, isJunction = null) {
  const plan = route ? lanePlan(route) : null;
  if (!plan) return null;
  const { pts, s, ids } = route;
  let blocks = 0;
  for (let v = i + 1; v < pts.length - 1; v += 1) {
    // (A bend where no street meets is no turn: only a junction's.)
    if (plan.turn[v] && (!isJunction || isJunction(ids?.[v] ?? -1))) return { side: plan.turn[v], dist: s[v] - s[i + 1], blocks, vertex: v };
    if (!isJunction || isJunction(ids?.[v] ?? -1)) blocks += 1;
  }
  return null;
}
//: The lane a car takes (``n`` lanes, now in ``cur``): the turn lane, on the block it turns at
//: (or within TURN_LOOK_M of the turn); otherwise the least crowded, leaning towards the lane of
//: the turn to come by WEIGHT x lanes away / (blocks until the turn + 1), and keeping to the
//: lane it is in unless another is clearly better. ``crowd[j]``: the cars in lane j ahead on
//: this block (a lane that is held up -- a bus at its stop -- counts heavy).
export const LANE_CHOICE = { weight: 1.5, stick: 0.75 };
export function chooseLane({ n, cur = 0, turn = null, crowd = [] }, C = LANE_CHOICE) {
  if (n <= 1) return 0;
  const want = turn ? (turn.side < 0 ? n - 1 : 0) : null;
  if (turn && (turn.blocks === 0 || turn.dist < TURN_LOOK_M)) return want;
  let best = Math.min(cur, n - 1), cost = Infinity;
  for (let j = 0; j < n; j += 1) {
    let c = crowd[j] || 0;
    if (want !== null) c += (C.weight * Math.abs(j - want)) / (turn.blocks + 1);
    if (j === cur) c -= C.stick;
    if (c < cost - 1e-9) { cost = c; best = j; }
  }
  return best;
}
//: A bike's line: in the bike lane where the street has one (beside the kerb, or outside the
//: parked cars), at the kerb's edge of the traffic lane where it is shared.
export function BIKE_LANE(half, cls = null, park = null, i = 0, route = null) {
  const lane = route?.bikes?.[i];
  const parked = park === true || (park === null && cls === "residential");
  if (lane === "track") return half - 0.75;
  if (lane === "lane") return parked ? half - LANE_PARKED_M + 0.2 - 0.9 : half - 0.95;
  return parked ? half - LANE_PARKED_M + 0.2 - 0.6 : half - 1.1;
}
//: Where along ``route`` distance ``d`` is: the point, the heading (as a yaw: 0 faces -z), and
//: the point moved ``side`` metres to the right of the way (a lane, a pavement). Off the centre
//: line the corners are rounded: the offset turns with the way over a few metres either side of
//: each bend, so a walker on the pavement or a car in its lane goes round, never across in a jump.
export function alongRoute(route, d, side = 0) {
  const { pts, s } = route;
  if (pts.length === 1) return { x: pts[0][0], z: pts[0][1], yaw: 0, half: 0 };
  d = Math.max(0, Math.min(route.length, d));
  let lo = 0, hi = s.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (s[m] <= d) lo = m; else hi = m; }
  const fn = typeof side === "function";
  const offOf = (i) => (fn ? side(route.halves?.[i] ?? 0, route.classes?.[i], route.parks?.[i], i, route) : side);
  // Segment i (from pts[i] to pts[i+1]) carried on past its ends, offset by its own side, at dd.
  const on = (i, off, dd = d) => {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1], len = s[i + 1] - s[i] || 1, t = (dd - s[i]) / len;
    const dx = (bx - ax) / len, dz = (bz - az) / len;
    // Right of travel, with x to the right and z towards the viewer: (-dz, dx).
    return { x: ax + (bx - ax) * t - dz * off, z: az + (bz - az) * t + dx * off, yaw: Math.atan2(-dx, -dz), ux: dx, uz: dz };
  };
  const half = route.halves?.[lo] ?? 0, off = offOf(lo);
  let at = on(lo, off);
  if (off !== 0 || fn) {
    // The bend nearer d: at the segment's start (lo) or its end (hi), if that is a bend.
    const v = d - s[lo] < s[hi] - d ? lo : hi;
    if (v > 0 && v < s.length - 1) {
      const a = v - 1, b = v, oa = offOf(a), ob = offOf(b);
      const r = Math.min(Math.max(Math.abs(oa), Math.abs(ob)) + 1, (s[v] - s[v - 1]) / 2, (s[v + 1] - s[v]) / 2);
      if (r > 0 && Math.abs(d - s[v]) < r) {
        // Round the corner on a curve from r before it in the way-in's lane to r after it in the
        // way-out's, bent towards where the two lanes' lines meet: inside the turn, never out
        // across it. (Blending the two lanes' lines carried past the corner swung a car turning
        // right from a lane far from the middle out to the left first, into the junction's other
        // traffic: 2026-11-11.)
        const P0 = on(a, oa, s[v] - r), P2 = on(b, ob, s[v] + r);
        const cr = P0.ux * P2.uz - P0.uz * P2.ux;
        let C = { x: (P0.x + P2.x) / 2, z: (P0.z + P2.z) / 2 };
        if (Math.abs(cr) > 0.15) {
          const t = ((P2.x - P0.x) * P2.uz - (P2.z - P0.z) * P2.ux) / cr;
          if (t > 0 && t < 2 * r + Math.max(Math.abs(oa), Math.abs(ob))) C = { x: P0.x + P0.ux * t, z: P0.z + P0.uz * t };
        }
        const u = (d - (s[v] - r)) / (2 * r), m = 1 - u;
        const x = m * m * P0.x + 2 * m * u * C.x + u * u * P2.x, z = m * m * P0.z + 2 * m * u * C.z + u * u * P2.z;
        const tx = 2 * m * (C.x - P0.x) + 2 * u * (P2.x - C.x), tz = 2 * m * (C.z - P0.z) + 2 * u * (P2.z - C.z);
        at = { x, z, yaw: Math.hypot(tx, tz) > 1e-9 ? Math.atan2(-tx, -tz) : P0.yaw };
      }
    }
  }
  return { x: at.x, z: at.z, yaw: at.yaw, half, cls: route.classes?.[lo] };
}

// ---- on foot: the pavements and the crosswalks ------------------------------------------------------

//: How far out from a street's kerb a walker keeps (the middle of the pavement), in metres.
export const PAVE_M = 1.6;
//: The way on foot along ``route`` (a walk route from Streets.route): on the pavement, crossing a
//: street only at a junction, along a crosswalk -- the line of the pavement carried across the
//: road, from one corner to the next. A walker keeps to the pavement it is on round a corner it
//: is turning towards; turning away it crosses the street it came along on the near crosswalk;
//: going straight on it crosses the street in front of it. It begins on the side of the street
//: ``from`` is on (a door, a bus stop, a car at the kerb) and ends on ``to``'s side: if that is
//: across the street it crosses at the last junction on the way (the one it ends at, or the one
//: before). It never crosses in the middle of a block, and never cuts across a junction from
//: one corner to the one opposite. (It did both: the walk was the street's middle line moved to
//: the right of the way, which at every left turn ran corner to corner through the junction.)
//: Returns a route to walk with no offset (alongRoute(r, d)): {pts, s, length, halves, classes,
//: crossings: [{s0, s1, node, bearing, signal}]} -- each crossing's stretch of the walk, the
//: node, the crossed street's own direction (as atan2(x, z)) and whether a light controls it.
export function pavementRoute(streets, route, { from = null, to = null, side = 1, offset = (h) => (h ? h + PAVE_M : 0) } = {}) {
  if (!route || !route.pts || route.pts.length < 2 || !(route.length > 0.5)) return route ? { ...route, crossings: [] } : null;
  const P = route.pts.map((q) => q.slice()), ids = (route.ids || []).slice(), halves = (route.halves || []).slice();
  // An end on another street than the way's own last (or first) one -- a bus stop round the
  // corner, a door on the side street: the walk goes on round the corner along that street to
  // it, over the street at the corner if it must, not across the corner.
  const fit = (pt, a, b, half) => {
    const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1, ux = dx / L, uz = dz / L;
    const t = (pt[0] - a[0]) * ux + (pt[1] - a[1]) * uz;
    if (t < -0.5 || t > L + 0.5) return Infinity;
    return Math.abs(Math.abs((pt[0] - a[0]) * -uz + (pt[1] - a[1]) * ux) - offset(half));
  };
  const roundCorner = (anchor, k, k2) => {
    const id = ids[k], here = streets?.nodes?.[id];
    if (!anchor || !here) return null;
    const pt = [anchor.x, anchor.z], own = fit(pt, P[k], P[k2], halves[Math.min(k, k2)] ?? 0);
    if (own < 3) return null;
    let best = null, bf = own - 1;
    for (const e of streets.edges[id] || []) {
      if (!(e.half > 0) || e.to === ids[k2]) continue;
      const m = streets.nodes[e.to], f = fit(pt, [here.x, here.z], [m.x, m.z], e.half);
      if (f < bf) { bf = f; best = { e, m }; }
    }
    if (!best) return null;
    const { m } = best, dx = m.x - here.x, dz = m.z - here.z, L = Math.hypot(dx, dz) || 1;
    const t = Math.max(0.5, Math.min(L, ((pt[0] - here.x) * dx + (pt[1] - here.z) * dz) / L));
    return { pt: [here.x + (dx / L) * t, here.z + (dz / L) * t], half: best.e.half };
  };
  const tail = roundCorner(to, P.length - 1, P.length - 2), head = roundCorner(from, 0, 1);
  if (tail) { P.push(tail.pt); ids.push(undefined); halves.push(tail.half); }
  if (head) { P.unshift(head.pt); ids.unshift(undefined); halves.unshift(head.half); }
  const n = P.length, seg = [];
  for (let i = 0; i + 1 < n; i += 1) {
    const dx = P[i + 1][0] - P[i][0], dz = P[i + 1][1] - P[i][1], len = Math.hypot(dx, dz) || 1e-6;
    const u = [dx / len, dz / len];
    seg.push({ u, nrm: [-u[1], u[0]], o: offset(halves[i] ?? 0), len, half: halves[i] ?? 0 });
  }
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1], cross = (a, b) => a[0] * b[1] - a[1] * b[0];
  // The line of segment i's pavement on side sg, through node point q: [point, dir].
  const line = (i, sg, q = P[i]) => [[q[0] + seg[i].nrm[0] * sg * seg[i].o, q[1] + seg[i].nrm[1] * sg * seg[i].o], seg[i].u];
  const meet = (L1, L2, near) => {
    const c = cross(L1[1], L2[1]);
    const lim = 4 * Math.max(3, ...seg.map((g) => g.o));
    if (Math.abs(c) > 0.15) {
      const t = cross([L2[0][0] - L1[0][0], L2[0][1] - L1[0][1]], L2[1]) / c;
      const q = [L1[0][0] + L1[1][0] * t, L1[0][1] + L1[1][1] * t];
      if (Math.hypot(q[0] - near[0], q[1] - near[1]) < lim) return q;
    }
    return [(L1[0][0] + L2[0][0]) / 2, (L1[0][1] + L2[0][1]) / 2];
  };
  // A junction: three ways or more meet there (streets, not paths).
  const junction = (i) => {
    const id = ids[i];
    if (id === undefined || !streets?.edges?.[id]) return false;
    return new Set(streets.edges[id].filter((e) => e.half > 0).map((e) => e.to)).size >= 3;
  };
  // The streets that meet at node i, as arms out from it.
  const arms = (i) => {
    const id = ids[i], here = streets?.nodes?.[id], out = [];
    if (!here) return out;
    for (const e of streets.edges[id] || []) {
      if (!(e.half > 0)) continue;
      const m = streets.nodes[e.to], L = Math.hypot(m.x - here.x, m.z - here.z) || 1, u = [(m.x - here.x) / L, (m.z - here.z) / L];
      out.push({ u, nrm: [-u[1], u[0]], o: offset(e.half), half: e.half });
    }
    return out;
  };
  // The street across the walker's way at node i (the arm most nearly square to segment a's
  // line); with ``sg``, only if an arm of it reaches out on the walker's side (a T-junction's
  // stem on the other side has nothing to cross).
  const crossStreet = (i, a, sg = 0) => {
    let best = null, bestS = 0.5;
    for (const c of arms(i)) {
      const sq = Math.abs(cross(seg[a].u, c.u));
      if (sq > bestS) { bestS = sq; best = c; }
    }
    if (best && sg && !arms(i).some((c) => Math.abs(cross(seg[a].u, c.u)) > 0.5 && dot(c.u, seg[a].nrm) * sg > 0.5)) return null;
    return best;
  };
  const cline = (c, sg, q) => [[q[0] + c.nrm[0] * sg * c.o, q[1] + c.nrm[1] * sg * c.o], c.u];
  const signalled = (i) => {
    const es = streets?.edges?.[ids[i]] || [];
    return es.some((e) => e.cls === "arterial" || e.cls === "freeway");
  };
  const sideOf = (pt, i, q) => Math.sign(dot([pt[0] - q[0], pt[1] - q[1]], seg[i].nrm));
  const project = (pt, i, sg, clamp) => {
    const [q0, u] = line(i, sg);
    let t = dot([pt[0] - q0[0], pt[1] - q0[1]], u);
    if (clamp) t = Math.max(0, Math.min(seg[i].len, t));
    return [q0[0] + u[0] * t, q0[1] + u[1] * t];
  };
  const bearing = (u) => Math.atan2(u[0], u[1]);
  const build = (forceAt) => {
    let sg = (from && sideOf([from.x, from.z], 0, P[0])) || side;
    const out = [], marks = [];   // marks: [index in out where a crossing begins, node i, bearing, signal]
    // Over a street at an end node (the place is round the corner, across the street the walk
    // meets there): along this pavement's line, corner to corner.
    const overEnd = (i, a, sg, q, first = null) => {
      const c = junction(i) ? crossStreet(i, a, sg) : null;
      if (!c) return false;
      if (first) out.push(first);
      const ua = seg[a].u;   // the way the walker goes over it, either end
      const sn = dot(c.nrm, ua) < 0 ? 1 : -1;
      const p0 = meet(line(a, sg, q), cline(c, sn, q), q), p1 = meet(line(a, sg, q), cline(c, -sn, q), q);
      marks.push([out.length, i, bearing(c.u), signalled(i)]);
      out.push(p0, p1);
      return true;
    };
    const along = (pt, i) => dot([pt[0] - P[i][0], pt[1] - P[i][1]], seg[i].u);
    // From the door (or the car, the pole) straight out to the pavement, and in again at the end:
    // not slanting off along the kerb through the cars parked there.
    if (from) out.push([from.x, from.z]);
    if (!(from && along([from.x, from.z], 0) < 0 && overEnd(0, 0, sg, P[0], project([from.x, from.z], 0, sg, false)))) out.push(from ? project([from.x, from.z], 0, sg, true) : line(0, sg)[0]);
    for (let i = 1; i < n - 1; i += 1) {
      const a = i - 1, b = i, q = P[i];
      if (!(seg[a].o > 0 && seg[b].o > 0) || !junction(i)) {
        // A bend, or a path joining: round it on the same side.
        out.push(meet(line(a, sg, q), line(b, sg, q), q));
        continue;
      }
      const ua = seg[a].u, ub = seg[b].u, straight = dot(ua, ub) > 0.9;
      const force = forceAt === i;
      if (straight) {
        const c = force ? crossStreet(i, a) : crossStreet(i, a, sg);
        if (!force || !c) {
          // Straight on: over the street in front, along this pavement's line.
          const at = meet(line(a, sg, q), line(b, sg, q), q);
          if (c) {
            const reach = c.half + 0.4;
            const before = [at[0] - ua[0] * reach, at[1] - ua[1] * reach], after = [at[0] + ub[0] * reach, at[1] + ub[1] * reach];
            marks.push([out.length, i, bearing(c.u), signalled(i)]);
            out.push(before, after);
          } else out.push(at);
          continue;
        }
        // Over to the other side here, on the near crosswalk of the street across, and on over
        // that street if it reaches out on the new side.
        const sn = dot(c.nrm, ua) < 0 ? 1 : -1;
        marks.push([out.length, i, bearing(ua), signalled(i)]);
        out.push(meet(line(a, sg, q), cline(c, sn, q), q), meet(line(a, -sg, q), cline(c, sn, q), q));
        sg = -sg;
        if (crossStreet(i, a, sg)) { marks.push([out.length - 1, i, bearing(c.u), signalled(i)]); out.push(meet(line(a, sg, q), cline(c, -sn, q), q)); }
        continue;
      }
      // A turn: to the corner on this side, over the street turned into only if it must, and over
      // the street come along if the new way leads to its other side.
      const sNear = dot(seg[b].nrm, ua) < 0 ? 1 : -1;
      const sb = force ? -sNear : sNear;
      out.push(meet(line(a, sg, q), line(b, sNear, q), q));
      if (sb !== sNear) { marks.push([out.length - 1, i, bearing(ub), signalled(i)]); out.push(meet(line(a, sg, q), line(b, sb, q), q)); }
      if (dot(ub, seg[a].nrm) * sg < -0.3) { marks.push([out.length - 1, i, bearing(ua), signalled(i)]); out.push(meet(line(a, -sg, q), line(b, sb, q), q)); }
      sg = sb;
    }
    const m = n - 2, end = P[n - 1];
    let need = to ? sideOf([to.x, to.z], m, end) || sg : sg, crossedAtEnd = false;
    if (need !== sg && forceAt === undefined && junction(n - 1)) {
      const c = crossStreet(n - 1, m);
      if (c) {
        const sn = dot(c.nrm, seg[m].u) < 0 ? 1 : -1;
        out.push(meet(line(m, sg, end), cline(c, sn, end), end));
        marks.push([out.length - 1, n - 1, bearing(seg[m].u), signalled(n - 1)]);
        out.push(meet(line(m, -sg, end), cline(c, sn, end), end));
        sg = -sg; crossedAtEnd = true;
      }
    }
    if (to && along([to.x, to.z], m) > seg[m].len && overEnd(n - 1, m, sg, end)) out.push(project([to.x, to.z], m, sg, false));
    else out.push(to ? project([to.x, to.z], m, sg, true) : line(m, sg, end)[0]);
    if (to) out.push([to.x, to.z]);
    return { out, marks, sg, need, crossedAtEnd };
  };
  let r = build(undefined);
  if (r.need !== r.sg) {
    // Across at the last junction on the way, then.
    for (let i = n - 2; i >= 1; i -= 1) if (seg[i - 1].o > 0 && seg[i].o > 0 && junction(i)) { r = build(i); break; }
  }
  // The walk's points, each crossing's stretch along it.
  const pts = [], at = [];   // at[k]: the walk's point out[k] became (a repeat is the one before)
  r.out.forEach((q) => {
    if (!pts.length || Math.hypot(q[0] - pts[pts.length - 1][0], q[1] - pts[pts.length - 1][1]) > 0.05) pts.push(q);
    at.push(pts.length - 1);
  });
  const sAt = [0];
  for (let i = 1; i < pts.length; i += 1) sAt.push(sAt[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const sOf = (k) => sAt[at[Math.min(k, at.length - 1)]];
  const crossings = r.marks.map(([k, node, b, signal]) => ({ s0: sOf(k), s1: sOf(k + 1), node: ids[node], bearing: b, signal }))
    .filter((c) => c.s1 > c.s0 + 0.5);
  if (pts.length < 2) pts.push(pts[0].slice());
  return { pts, s: sAt, length: sAt[sAt.length - 1], halves: pts.map(() => 0), classes: pts.map(() => null), crossings, side: r.sg, mode: "walk" };
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
  // Each tenant's kinds, its tag told more exactly by its name (core.mjs shopKinds).
  const shops = [];
  for (const s of b.shops || []) for (const kind of (R ? shopKinds(R, s.t, s.n) : [s.t])) if (kind && !shops.includes(kind)) shops.push(kind);
  if (R) {
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
    if (until - from < 60 || r() > Math.min(0.9, routine.errand_chance * (person.outgoing || 1))) return from;
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
    if (r() < Math.min(0.9, routine.stroll_chance * (person.outgoing || 1)) && clock < 20 * 60) {
      const start = clock + 20 + Math.floor(r() * 90);
      at("stroll", start, start + 25 + Math.floor(r() * 35), person.home, { outdoor: "stroll", seed: Math.floor(r() * 1e9) });
      clock = start + 65;
    }
    // A game at one of the parks' courts: the nearest to home of a few (rules.json routine.sport_chance).
    if (r() < Math.min(0.9, (routine.sport_chance || 0) * (person.outgoing || 1)) && clock < 20 * 60 && (person.age || 30) < 70) {
      const courts = places.filter((p) => p.court);
      if (courts.length) {
        const home = places.find((p) => p.id === person.home) || courts[0];
        let court = null, best = Infinity;
        for (let k = 0; k < 3; k += 1) { const c = courts[Math.floor(r() * courts.length) % courts.length], d = Math.hypot(c.x - home.x, c.z - home.z); if (d < best) { best = d; court = c; } }
        const [m0, m1] = routine.sport_minutes || [40, 90];
        const start = Math.max(clock + 20, 9 * 60 + Math.floor(r() * 9 * 60)), len = m0 + Math.floor(r() * (m1 - m0));
        if (start < 20 * 60) { at("sport", start, start + len, court.id); clock = Math.max(clock, start + len + 10); }
      }
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

export const TRAFFIC_BY_HOUR = [0.15, 0.1, 0.08, 0.08, 0.12, 0.25, 0.55, 0.9, 1.0, 0.8, 0.65, 0.65, 0.7, 0.65, 0.65, 0.75, 0.9, 1.0, 0.9, 0.7, 0.55, 0.45, 0.35, 0.25];
export const TRAFFIC_MIX = [["economy", 0.3], ["sedan", 0.18], ["suv", 0.12], ["compact_ev", 0.1], ["pickup", 0.05], ["taxi", 0.08], ["delivery_van", 0.1], ["box_truck", 0.04], ["bus", 0.02], ["patrol", 0.01]];

//: People out on foot by the hour, as a share of the busiest (noon to early evening).
export const WALK_BY_HOUR = [0.08, 0.05, 0.03, 0.03, 0.04, 0.1, 0.25, 0.55, 0.75, 0.7, 0.75, 0.9, 1.0, 1.0, 0.95, 0.9, 0.95, 1.0, 0.95, 0.8, 0.6, 0.45, 0.3, 0.15];
export const CLOTHES = ["#2e4057", "#8d3b3b", "#3f6e4a", "#d9d4c7", "#1f1f24", "#6b4f8a", "#b9773a", "#4b7da8", "#9aa3ab", "#c2405a", "#e3c45c", "#355c5a"];
//: How busy a place is, by the rules' density (docs/city/rules.json): the default, or the busiest
//: hotspot the point (lon, lat) is in. ``kind`` is "walkers" or "traffic".
export function densityAt(R, lon, lat, kind) {
  const D = R.density;
  if (!D) return 1;
  let m = D.default?.[kind] ?? 1;
  for (const h of D.hotspots || []) {
    const [s, w, n, e] = h.bbox;
    if (lat >= s && lat <= n && lon >= w && lon <= e) m = Math.max(m, h[kind] ?? m);
  }
  return m;
}
//: The district in motion: ``at(ms, focus)`` lists the people out of doors and the vehicles on
//: the streets within reach of ``focus``, each where it is at that moment.
export class Crowd {
  constructor(R, streets, places, people, { seed = "district", timeAt, toLonLat = null }) {
    this.R = R; this.streets = streets; this.people = people; this.seed = seed; this.timeAt = timeAt; this.toLonLat = toLonLat;
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
        const pos = alongRoute(leg.route, d, leg.mode === "drive" ? DRIVE_LANE : (half) => half + 1.6 * (hash32(p.id) % 2 ? 1 : -1));
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
    const pos = alongRoute(route, along, drive ? (half, cls, park, i) => (forward ? 1 : -1) * DRIVE_LANE(half, cls, park, i, forward ? route : null) : (half) => (forward ? 1 : -1) * (half + 1.6));
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
          const pos = alongRoute(route, d, DRIVE_LANE);
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
    const busy = this.densityOfCell(cell, 400, "traffic");
    const count = Math.floor(density * busy * Math.min(3, nodes.length / 40) + r());
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
  //: The rules' density over a square (its middle), cached.
  densityOfCell(cell, CELL, kind) {
    if (!this.toLonLat || !this.R.density) return 1;
    this._density ??= new Map();
    const key = `${kind}:${CELL}:${cell}`;
    if (!this._density.has(key)) {
      const [i, j] = cell.split(",").map(Number);
      const [lon, lat] = this.toLonLat((i + 0.5) * CELL, (j + 0.5) * CELL);
      this._density.set(key, densityAt(this.R, lon, lat, kind));
    }
    return this._density.get(key);
  }
  //: Street life: the people on the pavements who are not the district's residents at their
  //: business -- passers-by, shoppers, people out for the air. So many to a 150 m square of
  //: streets by the hour and the place (rules.json density), each walking out and back along a
  //: way of a few hundred metres for ten minutes or so, and seeded by the square and the ten
  //: minutes, so two browsers draw the same people. The residents' own days are too thin on the
  //: ground to fill a street: a thousand of them over five kilometres of city left it empty.
  streetLife(t, focus, reach) {
    const D = this.R.density, out = [];
    if (!D) return out;
    const CELL = 150, GEN = 600, tsec = t.ms / 1000, hour = WALK_BY_HOUR[Math.floor(t.minute / 60) % 24];
    const cx = Math.floor(focus.x / CELL), cz = Math.floor(focus.z / CELL), rr = Math.ceil(reach / CELL);
    this._walkers ??= new Map();
    for (let i = -rr; i <= rr; i += 1) for (let j = -rr; j <= rr; j += 1) {
      const ci = cx + i, cj = cz + j;
      if (Math.hypot((ci + 0.5) * CELL - focus.x, (cj + 0.5) * CELL - focus.z) > reach + CELL) continue;
      const nodes = this.cellDriveNodes(ci, cj, CELL);
      if (!nodes.length) continue;
      const cell = `${ci},${cj}`;
      const count = Math.round((D.walkers_per_cell || 0) * this.densityOfCell(cell, CELL, "walkers") * hour * Math.min(1, nodes.length / 10));
      for (let k = 0; k < count; k += 1) {
        // Each walker's ten minutes begin at its own moment, so they do not all change at once.
        const gen = Math.floor((tsec + k * 47) / GEN), key = `${cell}:${k}:${gen}`;
        let w = this._walkers.get(key);
        if (w === undefined) {
          const r = rng(this.seed, "walk", key);
          const a = nodes[Math.floor(r() * nodes.length)], na = this.streets.nodes[a];
          const ang = r() * Math.PI * 2, dist = 120 + r() * 300;
          const b = this.streets.nearest(na.x + Math.cos(ang) * dist, na.z + Math.sin(ang) * dist, "walk", 150);
          const route = b === null || b === a ? null : this.streets.route(a, b, "walk");
          w = route && route.length > 20 ? { key, route, start: gen * GEN - k * 47, phase: r() * route.length * 2, pace: 1.05 + r() * 0.5,
            side: r() < 0.5 ? 1 : -1, person: { id: `walk:${key}`, height: 1.55 + r() * 0.35, pace: 1.05 + r() * 0.5, uniform: CLOTHES[Math.floor(r() * CLOTHES.length)] } } : null;
          if (this._walkers.size > 6000) this._walkers.delete(this._walkers.keys().next().value);
          this._walkers.set(key, w);
        }
        if (!w) continue;
        const pos = this.walkerAt(w, tsec);
        if (Math.hypot(pos.x - focus.x, pos.z - focus.z) > reach) continue;
        out.push({ id: w.person.id, person: w.person, walker: w, ...pos });
      }
    }
    return out;
  }
  //: Where a passer-by is at ``tsec``: out and back along the way, on the pavement.
  walkerAt(w, tsec) {
    const L = w.route.length, d = (w.phase + (tsec - w.start) * w.pace) % (2 * L), forward = d <= L;
    const pos = alongRoute(w.route, forward ? d : 2 * L - d, (half) => (forward ? 1 : -1) * w.side * (half + 1.7));
    if (!forward) pos.yaw += Math.PI;
    return { ...pos, moving: true, mode: "walk", activity: "passing by" };
  }
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
    people.push(...this.streetLife(t, focus, Math.min(reach, this.R.density?.walk_radius_m ?? reach)));
    return { time: t, people, vehicles };
  }
}
export const INDOOR_REACH_M = 70;
//: Who works the counter in a shop (the rest are in the back, or not in a shop at all).
export const COUNTER_ROLES = new Set(["barista", "baker", "cook", "server", "bartender", "clerk", "grocer", "pharmacist", "pharmacy_tech",
  "stylist", "teller", "laundry_attendant", "attendant", "housekeeper", "night_auditor", "security_guard"]);
//: Where a shop's counter is: so far in from its front (``inside``: the front's middle, the inward
//: normal, half its width and its depth).
//: How much of a shopper's time inside goes on looking round the shelves, not at the counter.
export const BROWSE_SHARE = 0.6;
export function counterLine(inside) {
  const counter = Math.min(Math.max(1.6, inside.depth * 0.42), 3.4);
  return { counter, staff: counter + 0.85, back: Math.min(inside.depth - 0.7, counter + 2.6), front: Math.max(0.8, counter - 1.1), width: Math.max(0.5, inside.half - 0.7) };
}
//: Someone inside a shop: staff along the counter a step at a time (now and then to the back for
//: stock), customers waiting in front of it or at a table. Null for anyone else indoors.
export function indoorSpot(p, a, place, t) {
  const I = place.inside, L = counterLine(I);
  const tx = -I.nz, tz = I.nx;   // along the front
  const sec = t.minute * 60, slot = Math.floor(sec / 18);
  const staff = a.kind === "work" && COUNTER_ROLES.has(p.role);
  const customer = (a.kind === "errand" || a.kind === "meal" || a.kind === "evening") && place.shops.length;
  if (!staff && !customer) return null;
  const spot = (k) => {
    const r = rng(p.id, t.day, k);
    if (staff) return r() < 0.15 ? [(r() - 0.5) * 2 * L.width, L.back] : [(r() - 0.5) * 2 * L.width, L.staff];
    // Customers: about the shop floor looking at what is on the shelves most of the time, then at
    // the counter to pay; or (a meal) a table further toward the window.
    if (a.kind === "errand" && r() < BROWSE_SHARE) return [(r() - 0.5) * 2 * L.width, 0.6 + r() * Math.max(0.2, L.counter - 1.1)];
    return a.kind === "errand" ? [(r() - 0.5) * 2 * L.width, L.front + r() * 0.4] : [(r() - 0.5) * 2 * L.width, 0.7 + r() * Math.max(0.2, L.front - 0.6)];
  };
  const [a0, d0] = spot(slot - 1), [a1, d1] = spot(slot);
  const f = Math.min(1, (sec - slot * 18) / 3.5);
  const along = a0 + (a1 - a0) * f, deep = d0 + (d1 - d0) * f;
  const moving = f < 1 && Math.hypot(a1 - a0, d1 - d0) > 0.2;
  // Facing out over the counter (staff), or in toward it (customers).
  const yaw = staff ? Math.atan2(I.nx, I.nz) : Math.atan2(-I.nx, -I.nz);
  const browsing = a.kind === "errand" && d1 < L.front - 0.05;
  return { x: I.x + tx * along + I.nx * deep, z: I.z + tz * along + I.nz * deep, yaw: moving ? Math.atan2(-(tx * (a1 - a0) + I.nx * (d1 - d0)), -(tz * (a1 - a0) + I.nz * (d1 - d0))) : browsing ? (rng(p.id, slot)() < 0.5 ? Math.atan2(-tx, -tz) : Math.atan2(tx, tz)) : yaw,
    moving, mode: "walk", indoors: place.id, activity: staff ? "behind the counter" : browsing ? "looking round the shop" : a.kind === "errand" ? "at the counter" : "at a table" };
}
export function distToSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2)) : 0;
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}
