// Traffic that copes (docs/40-npc-intent-plan.md; docs/city/fleet.mjs Drivers, people.mjs Streets):
// someone standing in the lane is gone round, a stalled car too -- over the middle line only with
// nothing coming; a block stood full is routed round; a street shut right across is got past by a
// jump, never by driving through; routes prefer right turns; every trip keeps its lanes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { loadRules } from "../docs/city/core.mjs";
import { Drivers, TRAFFIC } from "../docs/city/fleet.mjs";
import { LANE, Streets, alongRoute, laneCount, rng } from "../docs/city/people.mjs";

const FLEET = readFileSync(new URL("../docs/city/fleet.mjs", import.meta.url), "utf8");
const R = loadRules(JSON.parse(readFileSync(new URL("../docs/city/rules.json", import.meta.url))));
const N = 6, STEP = 120;
function town(lanes, road_m, highway, prefs = true) {
  const ways = [];
  for (let i = 0; i <= N; i += 1) {
    const along = Array.from({ length: N + 1 }, (_, j) => j * STEP);
    ways.push({ kind: "street", pts: along.map((v) => [i * STEP, v]), lanes, oneway: 0, id: `v${i}`, highway, road_m });
    ways.push({ kind: "street", pts: along.map((v) => [v, i * STEP]), lanes, oneway: 0, id: `h${i}`, highway, road_m });
  }
  const S = new Streets(ways);
  if (prefs) S.setPreferences(R.traffic);
  return S;
}
const car = (id, route, t0, speed = 9) => {
  const dur = route.length / speed;
  return { id, key: `${id}:1`, route, t0, sched: (ts) => Math.max(0, Math.min(1, (ts - t0) / dur)) * route.length, unsched: (d) => t0 + (d / route.length) * dur,
    limit: 11, cruise: 11, length: 4.6, width: 1.85 };
};
//: Run the cars for ``T`` seconds: who arrived, how near any car's middle came to anyone on foot
//: and to anything else in the road, and the drivers' tally.
function run(S, cars, { people = [], blockers = [], T = 300, each = null } = {}) {
  const D = new Drivers(S), dt = 0.05;
  let last = null, person = Infinity, other = Infinity, jumped = new Set();
  for (let t = 0; t < T; t += dt) {
    last = D.step(dt, t, cars.filter((c) => t >= c.t0), people, blockers);
    const at = [];
    for (const x of last.cars) {
      if (x.jump) jumped.add(x.id);
      if (x.arrived) continue;
      const c = cars.find((y) => y.id === x.id), p = alongRoute(x.route || c.route, x.d, D.stateOf(x.id).side);
      at.push(p);
      for (const q of people) person = Math.min(person, Math.hypot(p.x - q.x, p.z - q.z));
      for (const b of blockers) other = Math.min(other, Math.hypot(p.x - b.x, p.z - b.z));
    }
    for (let i = 0; i < at.length; i += 1) for (let j = i + 1; j < at.length; j += 1) other = Math.min(other, Math.hypot(at[i].x - at[j].x, at[i].z - at[j].z));
    if (each) each(t, D, last);
  }
  return { D, arrived: last.cars.filter((x) => x.arrived).length, person, other, jumped, tally: D.tally };
}
const across = (S) => S.route(S.nearest(0, 240, "drive"), S.nearest(720, 240, "drive"), "drive");
const kerbLane = (h, c, p) => LANE(h, c, p);

test("someone standing in the lane of a side street is gone round, a metre clear, and nobody is put anywhere", () => {
  const S = town(2, 12, "residential"), route = across(S), at = alongRoute(route, 300, kerbLane);
  const cars = Array.from({ length: 6 }, (_, k) => car(`p${k}`, route, k * 4));
  const r = run(S, cars, { people: [{ id: "you", x: at.x, z: at.z, player: true }], T: 240 });
  assert.equal(r.arrived, 6, "every car got by");
  assert.equal(r.tally.dodges, 6, "each went round");
  assert.equal(r.tally.jumps, 0, "none was put past");
  // A car's side is 0.93 m from its middle and a person 0.35 m across: half a metre clear.
  assert.ok(r.person > 0.925 + 0.35 + 0.5, `a car's middle came ${r.person.toFixed(2)} m from them`);
  assert.ok(r.other > 4, `two cars' middles came ${r.other.toFixed(2)} m apart`);
});

test("someone who only crosses is waited for, not swerved round", () => {
  const S = town(2, 12, "residential"), route = across(S), at = alongRoute(route, 300, kerbLane);
  // They walk across the street (1.3 m/s) as the car comes up.
  const walker = { id: "w", x: at.x, z: at.z - 6 };
  const r = run(S, [car("c", route, 0)], { people: [walker], T: 120, each: (t) => { if (t > 28 && walker.z < at.z + 9) walker.z += 1.3 * 0.05; } });
  assert.equal(r.arrived, 1);
  assert.equal(r.tally.dodges, 0, "braked for, not gone round");
  assert.ok(r.person > 1.6, `${r.person.toFixed(2)} m`);
});

test("a stalled car in an avenue's kerb lane: the others change lanes and pass", () => {
  const S = town(4, 16, "primary"), route = across(S);
  assert.equal(laneCount(route, 1), 2, "two lanes each way");
  const probe = new Drivers(S); probe.step(0.05, 0, [car("probe", route, 0)], []);
  const at = alongRoute(route, 300, probe.stateOf("probe").side);
  const cars = Array.from({ length: 10 }, (_, k) => car(`a${k}`, route, k * 3));
  const r = run(S, cars, { blockers: [{ x: at.x, z: at.z, yaw: at.yaw, v: 0, length: 4.6, width: 1.85 }], T: 240 });
  assert.equal(r.arrived, 10);
  assert.equal(r.tally.jumps, 0);
  assert.ok(r.other > 2.3, `${r.other.toFixed(2)} m: never into it`);
});

test("a stalled car on a two-way side street: round it over the middle line, only when nothing is coming", () => {
  const S = town(2, 12, "residential"), route = across(S), back = S.route(S.nearest(720, 240, "drive"), S.nearest(0, 240, "drive"), "drive");
  const at = alongRoute(route, 300, kerbLane);
  const cars = [...Array.from({ length: 5 }, (_, k) => car(`e${k}`, route, k * 5)), ...Array.from({ length: 8 }, (_, k) => car(`w${k}`, back, k * 6))];
  const r = run(S, cars, { blockers: [{ x: at.x, z: at.z, yaw: at.yaw, v: 0, length: 4.6, width: 1.85 }], T: 300 });
  assert.equal(r.arrived, 13, "both ways got through");
  assert.equal(r.tally.jumps, 0, "driven round, not put past");
  assert.ok(r.tally.dodges >= 5);
  assert.ok(r.other > 2.2, `${r.other.toFixed(2)} m: passed with room, never head-on`);
});

test("a street shut right across: those not yet in the block take another way; those in it are put past, never driven through", () => {
  const S = town(2, 12, "residential"), route = across(S), mid = alongRoute(route, 470, 0);
  const wall = [-4.5, -2.4, -0.3, 1.8, 3.9].map((o) => ({ x: mid.x, z: mid.z + o, yaw: mid.yaw, v: 0, length: 4.6, width: 1.9 }));
  const cars = [...Array.from({ length: 12 }, (_, k) => car(`q${k}`, route, k * 2.5)), ...Array.from({ length: 8 }, (_, k) => car(`t${k}`, route, 70 + k * 4))];
  const r = run(S, cars, { blockers: wall, T: 400 });
  // A real collision is no longer hidden by an instantaneous stop. Every unfinished car
  // must be a wreck or queued behind that wreck, never simply lost by the planner.
  const heldByWreck = (id, seen = new Set()) => {
    const s = r.D.stateOf(id);
    if (!s || seen.has(id)) return false;
    if (s.hit) return true;
    seen.add(id); return heldByWreck(s.leader || s.blockedBy, seen);
  };
  const waiting = [...r.D.cars].filter(([id, s]) => s.d < r.D.endOf(cars.find((c) => c.id === id)) && heldByWreck(id));
  assert.equal(r.arrived + waiting.length, 20, "everyone arrived or is stopped by a recorded wreck");
  assert.ok(r.tally.reroutes >= 6, `${r.tally.reroutes} took another way`);
  assert.ok(r.jumped.size >= 1 && r.jumped.size <= 14, `${r.jumped.size} were put past it`);
  // Those that came later did not pile into the shut block: most went round.
  const later = cars.filter((c) => c.id.startsWith("t"));
  assert.ok(later.filter((c) => !r.jumped.has(c.id)).length >= 6, "the later cars went round");
  // Nobody was ever driven into the wall or another car.
  assert.ok(r.other > 2.3, `${r.other.toFixed(2)} m`);
});

test("a car far behind its day and out of sight is put back on it; in sight it is only ever driven", () => {
  const S = town(2, 12, "residential"), route = across(S);
  // Its day has it 400 m on by now (a slow trip begun 200 s ago); traffic left it 190 s behind.
  const late = { ...car("late", route, -200, 2), unseen: true }, seen = car("seen", route, -200, 2);
  for (const [c, jumps] of [[late, true], [seen, false]]) {
    const D = new Drivers(S);
    D.delays.set(c.key, 190);
    let jumped = false;
    for (let t = 0; t < 2; t += 0.05) { const res = D.step(0.05, t, [c], []); if (res.cars[0].jump) jumped = true; }
    assert.equal(jumped, jumps, c.id);
    if (jumps) { assert.ok(D.stateOf(c.id).d > 350, "where its day has it"); assert.ok(D.delayOf(c.key) < TRAFFIC.late_s + 5, "back on its day"); }
    else assert.ok(D.stateOf(c.id).d < 60, "driven on from where it was");
  }
});

test("drivers prefer right turns: a way with the turn across traffic costs more, so routes make fewer of them", () => {
  const count = (S) => {
    const r = rng("turns"); let left = 0, right = 0;
    for (let k = 0; k < 300; k += 1) {
      const a = S.nearest(Math.floor(r() * 7) * STEP, Math.floor(r() * 7) * STEP, "drive"), b = S.nearest(Math.floor(r() * 7) * STEP, Math.floor(r() * 7) * STEP, "drive");
      const route = a === b ? null : S.route(a, b, "drive");
      if (!route) continue;
      for (let v = 1; v < route.pts.length - 1; v += 1) {
        const ax = route.pts[v][0] - route.pts[v - 1][0], az = route.pts[v][1] - route.pts[v - 1][1], bx = route.pts[v + 1][0] - route.pts[v][0], bz = route.pts[v + 1][1] - route.pts[v][1];
        const cross = bx * -az + bz * ax;
        if (Math.abs(cross) > 1) { if (cross > 0) right += 1; else left += 1; }
      }
    }
    return { left, right };
  };
  const plain = count(town(2, 12, "residential", false)), costed = count(town(2, 12, "residential", true));
  assert.ok(costed.left < plain.left * 0.8, `${costed.left} left turns with the costs, ${plain.left} without`);
  assert.ok(costed.right > costed.left, `${costed.right} right, ${costed.left} left`);
  // The costs are the rules' (after Valhalla's): right cheap, left dear, a U-turn dearest.
  const M = R.traffic.maneuvers;
  assert.ok(M.right_s < M.left_s && M.left_s < M.uturn_s);
  const S = town(2, 12, "residential"), n = S.nearest(240, 240, "drive"), w = S.nearest(120, 240, "drive");
  assert.equal(S.turnCost(w, n, S.nearest(360, 240, "drive")), M.straight_s);
  assert.equal(S.turnCost(w, n, S.nearest(240, 360, "drive")), M.right_s, "east to south is a right turn (z runs south)");
  assert.equal(S.turnCost(w, n, S.nearest(240, 120, "drive")), M.left_s);
  assert.equal(S.turnCost(w, n, w), M.uturn_s);
});

test("another way round a block: a detour does not use it, nor go back the way it came", () => {
  const S = town(2, 12, "residential"), a = S.nearest(240, 240, "drive"), b = S.nearest(600, 240, "drive"), next = S.nearest(360, 240, "drive"), from = S.nearest(120, 240, "drive");
  const direct = S.route(a, b, "drive");
  assert.equal(direct.ids[1], next);
  const alt = S.detour(a, b, { from, avoid: new Map([[`${a}>${next}`, TRAFFIC.jam_cost_s]]) });
  assert.ok(alt && alt.ids[1] !== next && alt.ids[1] !== from, "by another street");
  assert.ok(alt.length <= direct.length + 2 * STEP + 1, "round the block, no further");
  assert.equal(S.route(a, b, "drive").ids[1], next, "the kept way is not changed by it");
});

test("cyclists keep the lane's edge and are passed with room, not crawled behind; they keep the rules too", () => {
  const S = town(2, 12, "residential"), route = across(S), back = S.route(S.nearest(720, 240, "drive"), S.nearest(0, 240, "drive"), "drive");
  const bike = (id, r, t0) => ({ ...car(id, r, t0, 4.6), limit: 5.6, cruise: 4.8, length: 1.8, width: 0.65, bike: true });
  const cars = [...Array.from({ length: 5 }, (_, k) => bike(`b${k}`, route, k * 7)), ...Array.from({ length: 8 }, (_, k) => car(`c${k}`, route, 12 + k * 5)), ...Array.from({ length: 5 }, (_, k) => car(`o${k}`, back, 20 + k * 14))];
  const D = new Drivers(S), dt = 0.05;
  let last = null, worst = Infinity;
  for (let t = 0; t < 400; t += dt) {
    last = D.step(dt, t, cars.filter((c) => t >= c.t0), []);
    const at = last.cars.filter((x) => !x.arrived).map((x) => { const c = cars.find((y) => y.id === x.id); return { id: x.id, bike: Boolean(c.bike), ...alongRoute(x.route || c.route, x.d, D.stateOf(x.id).side) }; });
    for (const a of at) for (const b of at) if (a.id < b.id && a.bike !== b.bike) worst = Math.min(worst, Math.hypot(a.x - b.x, a.z - b.z));
  }
  assert.equal(last.cars.filter((x) => x.arrived).length, cars.length, "everyone got there");
  assert.ok(D.tally.passes >= 8, `${D.tally.passes} passes`);
  assert.equal(D.tally.jumps, 0);
  // A car's side 0.93 m from its middle, a bicycle's 0.33 m: half a metre between them at least.
  assert.ok(worst > 0.93 + 0.33 + 0.5, `a car's middle came ${worst.toFixed(2)} m from a cyclist's`);
  // A cyclist picks no lane of its own: the bike lane, or the lane's edge.
  assert.equal(D.stateOf("b0").bike, true);
  assert.equal(D.stateOf("b0").lane, 0);
});

test("a trip keeps its streets' lanes, so an avenue's trips use both", async () => {
  const { City, Roster } = await import("../docs/city/fleet.mjs");
  const { cityTime } = await import("../docs/city/core.mjs");
  // Avenues over a mile square: homes at one end, the shops and work at the other.
  const ways = [], M = 10;
  for (let i = 0; i <= M; i += 1) {
    const along = Array.from({ length: M + 1 }, (_, j) => j * STEP);
    ways.push({ kind: "street", pts: along.map((v) => [i * STEP, v]), lanes: 4, oneway: 0, id: `v${i}`, highway: "primary", road_m: 16 });
    ways.push({ kind: "street", pts: along.map((v) => [v, i * STEP]), lanes: 4, oneway: 0, id: `h${i}`, highway: "primary", road_m: 16 });
  }
  const S = new Streets(ways), places = [];
  S.setPreferences(R.traffic);
  for (let i = 0; i < M; i += 1) for (let j = 0; j < M; j += 1) {
    if (i >= 3 && i <= 6) continue;
    const x = i * STEP + 40, z = j * STEP + 12, home = i < 3;
    places.push({ id: `b${i}_${j}`, x, z, use: home ? "residential" : "retail", tag: home ? "house" : "retail", area: 140, floors: 2, name: `${i} ${j}`, kind: home ? "home" : "shop",
      keys: new Set(home ? ["use:residential"] : ["use:retail", "shop:cafe", "shop:supermarket", "use:office"]), shops: home ? [] : ["cafe"], node: S.nearest(x, z, "walk", 200) });
  }
  const roster = new Roster(R, { seed: "lanes" });
  roster.add(places);
  const city = new City(R, roster, S, { seed: "lanes", timeAt: (ms) => cityTime(ms, R.clock.zone) });
  const t = city.timeAt(Date.UTC(2026, 10, 10, 20, 0));
  let routes = 0, twoLane = 0, byBike = 0;
  for (const p of roster.people.values()) for (const leg of city.planOf(p, t).drives) {
    if (leg.kind !== "go") continue;
    const route = city.legRoute(leg);
    if (!route) continue;
    routes += 1;
    assert.equal(route.lanes.length, route.pts.length, "a lane count for every point");
    assert.equal(route.bike, Boolean(roster.vehicles.get(leg.vehicle)?.bike));
    if (route.bike) byBike += 1;
    for (let i = 1; i < route.pts.length - 2; i += 1) if (laneCount(route, i) === 2) { twoLane += 1; break; }
  }
  assert.ok(routes > 10, `${routes} trips`);
  assert.ok(byBike > 0 && byBike < routes, `${byBike} of ${routes} by bicycle: some ride, some drive`);
  assert.ok(twoLane > routes * 0.6, `${twoLane} of ${routes} trips have two lanes to use`);
});

test("a corner is taken slowly: braked down to on the way in, so there is time to stop for who is on the crossing", () => {
  const S = town(2, 12, "residential"), route = S.route(S.nearest(0, 240, "drive"), S.nearest(240, 600, "drive"), "drive");
  const turnAt = route.pts.findIndex((p, i) => i > 0 && i < route.pts.length - 1 && Math.abs((route.pts[i + 1][0] - p[0]) * (p[1] - route.pts[i - 1][1]) - (route.pts[i + 1][1] - p[1]) * (p[0] - route.pts[i - 1][0])) > 1);
  assert.ok(turnAt > 0, "the way has a turn");
  const D = new Drivers(S), c = car("turner", route, 0);
  let fastest = 0, arrived = false;
  for (let t = 0; t < 200 && !arrived; t += 0.05) {
    const x = D.step(0.05, t, [c], []).cars[0];
    arrived = Boolean(x.arrived);
    if (!arrived && Math.abs(x.d - route.s[turnAt]) < 4) fastest = Math.max(fastest, x.v);
  }
  assert.ok(arrived, "it got there");
  assert.ok(fastest > 0.5 && fastest <= TRAFFIC.turn_speed + 0.3, `through the corner at ${fastest.toFixed(1)} m/s`);
});

test("a car obeys its wheels: braked to a stand before it backs, a moment for the gear, and never sideways without going forward", () => {
  const S = town(2, 12, "residential"), route = across(S), at = alongRoute(route, 300, kerbLane);
  const c = car("a", route, 0), D = new Drivers(S), dt = 0.05;
  const blockers = [{ x: at.x, z: at.z, yaw: at.yaw, v: 0, length: 4.6, width: 1.85 }];
  let prev = null, backed = 0, worstSlide = 0, worstTurn = 0, lastForward = -1, firstBack = -1, backV = [], steerWas = 0;
  for (let t = 0; t < 120; t += dt) {
    const out = D.step(dt, t, [c], [], blockers).cars[0], st = D.stateOf("a");
    if (!out || out.arrived) break;
    const now = { d: st.d, side: st.dodge, v: out.v };
    if (prev) {
      const along = now.d - prev.d, across = Math.abs(now.side - prev.side);
      // Sideways only as far as the way it points and the ground it covered allow.
      if (across > 1e-9) worstSlide = Math.max(worstSlide, across / Math.max(1e-9, Math.abs(along)));
      worstTurn = Math.max(worstTurn, Math.abs((st.steer || 0) - steerWas) / Math.max(1e-6, Math.abs(along)));
      if (along > 1e-6) lastForward = t;
      if (along < -1e-6) { backed += -along; if (firstBack < 0) { firstBack = t; assert.ok(prev.v <= 0.15, `backwards out of ${prev.v} m/s forward`); assert.ok(t - lastForward >= TRAFFIC.gear_s - dt, "a moment between forward and reverse"); } backV.push(-along / dt); }
      else if (along > 1e-6 && backV.length && !backV.done) { backV.done = true; assert.ok(t - backV.t >= TRAFFIC.gear_s - dt, "a moment between reverse and forward"); }
      if (along < -1e-6) backV.t = t;
    }
    steerWas = st.steer || 0; prev = now;
  }
  assert.ok(backed > 0.5, "it backed up for the room");
  assert.ok(backV[0] < 0.2 && Math.max(...backV) <= TRAFFIC.back_speed + 1e-6, "way gathered backwards, not all at once");
  assert.ok(worstSlide <= TRAFFIC.dodge_rate + 1e-6, `${worstSlide.toFixed(2)} m sideways a metre along`);
  assert.ok(worstTurn <= TRAFFIC.steer_per_m + 1e-3, "its wheels turned a little a metre");
  assert.equal(D.tally.jumps, 0);
  assert.ok(D.stateOf("a").d > 320, "and it got round");
  // Stood still it does not slide into the next lane; in your sight it waits longer to be put anywhere.
  assert.match(FLEET, /\(st\.v < 0\.3 \? 0 : Math\.min\(1, st\.v \/ 2\)\)/);
  assert.ok(TRAFFIC.seen_jump_x >= 3);
});

test("a car is drawn only where its wheels take it: on the way it faces, never back or square across", async () => {
  const { wheelStep, WHEEL_SLIP } = await import("../docs/city/detail.mjs");
  // Facing -z (yaw 0), its place a metre behind and a metre to the right: it stands.
  assert.deepEqual(wheelStep(0, 0, 1, 1, 0, 0.5), [0, 0]);
  // Ahead and a little across: forward by no more than the step, across by a share of that.
  const [x, z] = wheelStep(0, 0, 1, -3, 0, 0.5);
  assert.ok(Math.abs(z + 0.5) < 1e-9 && Math.abs(x) <= 0.5 * WHEEL_SLIP + 1e-9 && x > 0);
  // Backing, it goes back and not forward.
  assert.ok(wheelStep(0, 0, 0, 2, 0, 0.5, true)[1] > 0);
  assert.deepEqual(wheelStep(0, 0, 0, -2, 0, 0.5, true), [0, 0]);
  // Followed step by step it arrives, without once moving against its heading.
  let p = [0, 0];
  for (let i = 0; i < 40; i += 1) { const q = wheelStep(p[0], p[1], 0.8, -6, 0, 0.3); assert.ok(q[1] <= p[1] + 1e-12); p = q; }
  assert.ok(Math.hypot(p[0] - 0.8, p[1] + 6) < 0.05);
});

test("a vehicle begins its turn before the corner, a bus earlier than a car, and nobody on foot changes", async () => {
  const { alongRoute, TURN_LEAD, turnLead } = await import("../docs/city/people.mjs");
  // East along x, then a right turn south (+z), each street 5 m to its kerb.
  const pts = [[0, 0], [60, 0], [60, 60]], route = { pts, s: [0, 60, 120], length: 120, halves: [5, 5], classes: ["residential", "residential"] };
  const lane = (lead) => { const f = () => 3.2; if (lead) f.lead = lead; return f; };
  const turnedBy = (side, d) => { const a = alongRoute(route, d, side); const straight = alongRoute(route, 20, side); return Math.abs(a.yaw - straight.yaw); };
  // Five metres short of the corner the old curve had not begun; with a lead it has.
  assert.ok(turnedBy(lane(0), 55) < 1e-6);
  assert.ok(turnedBy(lane(TURN_LEAD.car), 55) > 0.02, "a car is already turning");
  assert.ok(turnedBy(lane(TURN_LEAD.long), 53) > 0.02 && turnedBy(lane(TURN_LEAD.car), 52.2) < 1e-6, "a bus begins sooner");
  assert.equal(turnLead(12), TURN_LEAD.long); assert.equal(turnLead(4.4), TURN_LEAD.car);
  // Its heading turns smoothly: no step of the way round turns more than a share of the whole.
  let last = alongRoute(route, 50, lane(TURN_LEAD.long)).yaw, most = 0;
  for (let d = 50.25; d <= 72; d += 0.25) { const y = alongRoute(route, d, lane(TURN_LEAD.long)).yaw; let t = Math.abs(y - last); t = Math.min(t, Math.PI * 2 - t); most = Math.max(most, t); last = y; }
  assert.ok(most < 0.12, `sharpest quarter metre ${most}`);
  // It ends in its lane on the street it turned into, and stays inside the lanes' corner.
  const out = alongRoute(route, 75, lane(TURN_LEAD.long));
  assert.ok(Math.abs(out.x - (60 - 3.2)) < 1e-6);
  for (let d = 45; d <= 75; d += 0.5) { const q = alongRoute(route, d, lane(TURN_LEAD.long)); assert.ok(q.z >= 3.2 - 1e-6 && q.x <= 60 - 3.2 + 1e-6, `inside its lanes at ${d}`); }
  // A plain offset (someone on the pavement) is as it was.
  assert.deepEqual(alongRoute(route, 57, 6.6), alongRoute(route, 57, Object.assign((h) => 6.6, {})) );
});

test("a bicycle with no rack leans on the wall beside the door, clear of the doorway and of driveways", async () => {
  const { City, BIKE_LEAN } = await import("../docs/city/fleet.mjs");
  // A door in a wall along x at z = 0, the building behind it (z > 0), n pointing in.
  const D = { x: 0, z: 0, nx: 0, nz: 1 };
  const city = Object.create(City.prototype);
  city.guardWalls = true; city.footprintAt = (x, z) => z > 0 && Math.abs(x) < 20; city.kerbside = null;
  for (let k = -3; k <= 3; k += 1) {
    const p = city.bikeLean(D, k);
    assert.ok(Math.abs(p.x) >= BIKE_LEAN.clear - 1e-9, `clear of the doorway (${k}): ${p.x}`);
    assert.ok(Math.abs(p.z + BIKE_LEAN.off) < 1e-9, "a hand off the wall, outside it");
    assert.ok(Math.abs(Math.abs(Math.sin(p.yaw)) - 1) < 1e-9, "its length along the wall");
  }
  // A driveway let down in front of one side: it goes to the other.
  city.kerbside = { kerbAt: (x, z) => ({ x, z: -3, ax: 1, az: 0 }), kerbParking: (x) => (x > 0 ? "driveway" : null) };
  assert.ok(city.bikeLean(D, 2).x < 0);
  // Where the wall ends a metre from the door on one side, the other side is taken.
  city.kerbside = null; city.footprintAt = (x, z) => z > 0 && x > -1 && x < 20;
  assert.ok(city.bikeLean(D, -2).x > 0);
});
