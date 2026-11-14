// One junction, however many nodes the map makes it of; a street drawn as two one-way lines keeps
// its two ways' lanes apart; a car at the kerb only on a side street (docs/40-npc-intent-plan.md;
// people.mjs junctions / twinOf / kerbRoomAt, fleet.mjs passages).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { loadRules } from "../docs/city/core.mjs";
import { Drivers, junctionAt, signalAt } from "../docs/city/fleet.mjs";
import { Streets, alongRoute, laneCount, laneOffset, placeFromBuilding, rng } from "../docs/city/people.mjs";

const R = loadRules(JSON.parse(readFileSync(new URL("../docs/city/rules.json", import.meta.url))));
const N = 6, STEP = 120;
//: A town drawn the way the map draws many streets: block by block, each block's ends a metre
//: short of the crossing, so every crossing is three or four nodes joined by short links.
function splitTown(main = false) {
  const ways = [];
  for (let i = 0; i <= N; i += 1) for (let j = 0; j < N; j += 1) {
    const hw = main && i % 3 === 0 ? "primary" : "residential", lanes = hw === "primary" ? 4 : 2, road_m = hw === "primary" ? 16 : 12;
    ways.push({ kind: "street", pts: [[i * STEP, j * STEP + 1], [i * STEP, (j + 1) * STEP - 1]], lanes, oneway: 0, id: `v${i}_${j}`, highway: hw, road_m });
    ways.push({ kind: "street", pts: [[j * STEP + 1, i * STEP], [(j + 1) * STEP - 1, i * STEP]], lanes, oneway: 0, id: `h${i}_${j}`, highway: hw, road_m });
  }
  const S = new Streets(ways);
  S.setPreferences(R.traffic);
  return S;
}

test("a crossing made of several nodes is one junction: one kind, one set of lights, one stop", () => {
  const S = splitTown(true), J = S.junctions();
  // 49 crossings; the four corners of the town are bends, not junctions.
  assert.equal(J.count, 45);
  const nodesAt = (x, z) => S.nodes.map((n, i) => [n, i]).filter(([n]) => Math.hypot(n.x - x, n.z - z) < 3).map(([, i]) => i);
  const at = nodesAt(360, 240), members = at.filter((i) => S.junctionOf(i));
  assert.ok(at.length >= 4 && members.length >= 3, `${at.length} nodes at the crossing, ${members.length} of them junction nodes`);
  const one = S.junctionOf(members[0]);
  for (const i of members) assert.equal(S.junctionOf(i), one, "all the same junction");
  // An avenue crosses here: every node of it is a light, and all show the same.
  for (const i of members) assert.equal(junctionAt(S, i), "signal");
  for (let t = 0; t < 60; t += 1.5) for (const bearing of [0, Math.PI / 2]) {
    const lights = new Set(members.map((i) => signalAt(S, i, bearing, t)));
    assert.equal(lights.size, 1, `at ${t} s the junction's nodes show ${[...lights].join(" and ")}`);
  }
  // A way through the town passes each crossing once, though it goes through two or three of its nodes.
  const D = new Drivers(S), route = S.route(S.nearest(30, 240, "drive"), S.nearest(700, 240, "drive"), "drive");
  const through = route.ids.filter((id) => S.junctionOf(id)).length, passes = D.passages(route);
  assert.ok(through > passes.length + 2, `${through} junction nodes on the way, ${passes.length} junctions`);
  assert.equal(new Set(passes.map((p) => p.key)).size, passes.length, "each once");
  // A turn inside a junction's own links costs nothing more; the turn out of it does.
  const [a, b] = [members[0], members[1]];
  if (S.edges[a].some((e) => e.to === b)) assert.equal(S.turnCost(S.edges[a].find((e) => e.to !== b).to, a, b), 0);
});

test("through a town of split crossings everyone gets there: no ring of cars giving way, nobody put anywhere", () => {
  const S = splitTown(false), r = rng("split"), cars = [];
  for (let k = 0; cars.length < 60 && k < 900; k += 1) {
    const pick = () => S.nearest(Math.floor(r() * (N + 1)) * STEP + 30, Math.floor(r() * (N + 1)) * STEP, "drive");
    const a = pick(), b = pick();
    if (a === b) continue;
    const route = S.route(a, b, "drive");
    if (!route || route.length < 200) continue;
    const t0 = r() * 100, dur = route.length / 9;
    cars.push({ id: `c${String(cars.length).padStart(2, "0")}`, key: `c${cars.length}:1`, route, t0, sched: (ts) => Math.max(0, Math.min(1, (ts - t0) / dur)) * route.length,
      unsched: (d) => t0 + (d / route.length) * dur, limit: 11, cruise: 11, length: 4.6, width: 1.85 });
  }
  const D = new Drivers(S), dt = 0.05, still = new Map();
  let last = null, worst = Infinity, longest = 0;
  for (let t = 0; t < 600; t += dt) {
    last = D.step(dt, t, cars.filter((c) => t >= c.t0), []);
    const at = last.cars.filter((x) => !x.arrived && t - cars.find((y) => y.id === x.id).t0 > 3).map((x) => alongRoute(x.route || cars.find((y) => y.id === x.id).route, x.d, D.stateOf(x.id).side));
    for (let i = 0; i < at.length; i += 1) for (let j = i + 1; j < at.length; j += 1) worst = Math.min(worst, Math.hypot(at[i].x - at[j].x, at[i].z - at[j].z));
    for (const x of last.cars) { const v = !x.arrived && x.v < 0.1 ? (still.get(x.id) || 0) + dt : 0; still.set(x.id, v); longest = Math.max(longest, v); }
  }
  assert.equal(last.cars.filter((x) => x.arrived).length, cars.length, "every car got where it was going");
  assert.ok(D.tally.jumps <= 2, `${D.tally.jumps} were put past a knot (${JSON.stringify(D.tally)})`);
  assert.ok(longest < 25, `a car stood ${longest.toFixed(0)} s`);
  assert.ok(worst > 1.9, `two cars' middles came ${worst.toFixed(2)} m apart`);
  // (A car whose trip ends at a junction gives up its turn there: it had kept it, parked.)
  for (const box of D.claims.values()) for (const id of box.keys()) assert.ok(!last.cars.find((x) => x.id === id)?.arrived, `${id} has arrived and still holds its turn`);
});

test("a street drawn as two one-way lines: each way's lanes keep to their own side", () => {
  // Lombard-like: eastbound on z = 0, westbound on z = -1 (two lines a metre apart), three lanes each, 20 m wide.
  const ways = [
    { kind: "street", pts: [[0, 0], [150, 0], [300, 0]], lanes: 3, oneway: 1, id: "east", highway: "primary", road_m: 20, name: "Lombard Street" },
    { kind: "street", pts: [[300, -1], [150, -1], [0, -1]], lanes: 3, oneway: 1, id: "west", highway: "primary", road_m: 20, name: "Lombard Street" },
    { kind: "street", pts: [[0, 60], [150, 60], [300, 60]], lanes: 3, oneway: 1, id: "alone", highway: "primary", road_m: 20 },
  ];
  const S = new Streets(ways);
  const east = S.route(S.nearest(0, 0, "kerb"), S.nearest(300, 0, "kerb"), "drive"), west = S.route(S.nearest(300, -1, "kerb"), S.nearest(0, -1, "kerb"), "drive");
  const alone = S.route(S.nearest(0, 60, "kerb"), S.nearest(300, 60, "kerb"), "drive");
  assert.ok(east && west && alone);
  assert.ok(east.twins[0] !== null && Math.abs(east.twins[0] - 1) < 0.01, "the line the other way runs a metre to its left");
  assert.equal(alone.twins[0], null, "a one-way street on its own has none");
  assert.equal(laneCount(east, 0), 3);
  // Where each lane's middle is, across the street (z): the two ways' never within a car and a gap of each other.
  const zOf = (route, lane) => alongRoute(route, 100, (h, c, p, i, r0) => laneOffset(h, c, p, i, r0, lane)).z;
  const E = [0, 1, 2].map((k) => zOf(east, k)), Wz = [0, 1, 2].map((k) => zOf(west, k));
  for (const a of E) for (const b of Wz) assert.ok(Math.abs(a - b) >= 3.3, `an eastbound lane at ${a.toFixed(1)} and a westbound at ${b.toFixed(1)}`);
  assert.ok(E[0] > E[1] && E[1] > E[2], "kerb lane to the south, inner lane by the middle");
  // On its own a one-way street's lanes span the road, as before.
  const A = [0, 2].map((k) => zOf(alone, k));
  assert.ok(A[0] - A[1] > 12, `${(A[0] - A[1]).toFixed(1)} m between its kerb lanes`);
});

test("room at the kerb for a resident's car: on a side street, not on a main one", () => {
  const ways = [
    { kind: "street", pts: [[0, 0], [100, 0], [200, 0], [300, 0], [400, 0]], lanes: 6, oneway: 0, id: "lombard", name: "Lombard Street", road_m: 22 },
    { kind: "street", pts: [[0, 100], [100, 100], [200, 100], [300, 100], [400, 100]], lanes: 2, oneway: 0, id: "side", name: "Moulton Street", road_m: 10 },
    { kind: "street", pts: [[0, 200], [100, 200], [200, 200], [300, 200], [400, 200]], lanes: 2, oneway: 0, id: "chestnut", name: "Chestnut Street", road_m: 12 },
    { kind: "street", pts: [[0, 300], [100, 300], [200, 300], [300, 300], [400, 300]], lanes: 2, oneway: 0, id: "noparking", name: "Pixley Street", road_m: 8, parking_sides: [] },
    { kind: "street", pts: [[0, 0], [0, 300]], lanes: 2, oneway: 0, id: "cross", name: "Pierce Street", road_m: 10 },
  ];
  const S = new Streets(ways);
  S.setPreferences(R.traffic);
  assert.equal(S.streetAt(200, 12).name, "Lombard Street");
  assert.equal(S.kerbRoomAt(200, 12), false, "an arterial");
  assert.equal(S.kerbRoomAt(200, 112), true, "a side street");
  assert.equal(S.kerbRoomAt(200, 212), false, "a corridor of the rules' (Chestnut), though two lanes");
  assert.equal(S.kerbRoomAt(200, 312), false, "no parking at its kerb");
  assert.equal(S.kerbRoomAt(2000, 2000), null, "no street near");
  const home = (z) => placeFromBuilding({ id: `h${z}`, x: 200, z, archetype: "residential", floors: 3, area: 200, tag: "apartments" }, S, R);
  assert.equal(home(12).kerb, false);
  assert.equal(home(112).kerb, true);
});

test("nobody drives a block against a one-way street: no lawful way is no way, and trips come in where traffic comes in", async () => {
  const { City, Roster } = await import("../docs/city/fleet.mjs");
  const { cityTime } = await import("../docs/city/core.mjs");
  // A one-way avenue eastbound along z = 0, with two-way side streets off it every 100 m.
  const xs = Array.from({ length: 9 }, (_, i) => i * 100), ways = [{ kind: "street", pts: xs.map((x) => [x, 0]), lanes: 3, oneway: 1, id: "oneway", highway: "primary", road_m: 16, name: "Lombard Street" }];
  for (const x of xs.slice(1, -1)) ways.push({ kind: "street", pts: [[x, 0], [x, 100], [x, 200], [x, 300]], lanes: 2, oneway: 0, id: `s${x}`, road_m: 10, name: `${x} Street` });
  ways.push({ kind: "street", pts: xs.slice(1, -1).map((x) => [x, 300]), lanes: 2, oneway: 0, id: "back", road_m: 10, name: "Back Street" });
  const S = new Streets(ways);
  S.setPreferences(R.traffic);
  const west = S.nearest(0, 0, "kerb"), east = S.nearest(800, 0, "kerb");
  assert.ok(S.route(west, east, "drive"), "with the traffic: a way");
  assert.equal(S.route(east, west, "drive"), null, "against it for 800 m: none");
  // Round by the back street is lawful, however far.
  const round = S.route(S.nearest(700, 0, "kerb"), S.nearest(100, 100, "kerb"), "drive");
  assert.ok(round && S.wrongWay(round) === 0 && round.length > 700, "round by the back street");
  // The avenue's ends are gates: in at the west, out at the east only.
  const places = [];
  for (const x of xs.slice(1, -1)) for (const z of [60, 160, 260]) places.push({ id: `b${x}_${z}`, x: x + 14, z, use: z === 160 ? "retail" : "residential", tag: "house", area: 120, floors: 2, name: `${z} ${x} Street`,
    keys: new Set(z === 160 ? ["use:retail", "shop:cafe"] : ["use:residential"]), shops: z === 160 ? ["cafe"] : [], node: S.nearest(x + 14, z, "walk", 200) });
  const roster = new Roster(R, { seed: "gates" });
  roster.add(places); roster.visitorsUpTo(40);
  const city = new City(R, roster, S, { seed: "gates", timeAt: (ms) => cityTime(ms, R.clock.zone) });
  const G = city.gateways;
  assert.ok(G.includes(west) && G.includes(east));
  assert.ok(city.gatesFor(G, "in").includes(west) && !city.gatesFor(G, "in").includes(east), "in by the west end only");
  assert.ok(city.gatesFor(G, "out").includes(east) && !city.gatesFor(G, "out").includes(west), "out by the east end only");
  const t = city.timeAt(Date.UTC(2026, 10, 10, 20, 0));
  let legs = 0;
  for (const p of roster.visitors.values()) for (const leg of city.planOf(p, t).drives) {
    if (leg.kind !== "go") continue;
    assert.notEqual(leg.from, east, "nobody comes in at the way out");
    assert.notEqual(leg.to, west, "nobody leaves by the way in");
    const route = city.legRoute(leg);
    if (route) { legs += 1; assert.ok(S.wrongWay({ ids: route.ids.filter((id) => id >= 0) }) <= 40, "never a block against the traffic"); }
  }
  assert.ok(legs > 20, `${legs} trips`);
});
