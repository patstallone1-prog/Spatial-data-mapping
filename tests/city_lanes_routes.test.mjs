// Cars in lanes of their own, rounds driven as whole routes, junctions never locked, buses at the
// kerb only at their stops, and everyone a player of the city from the start (docs/city/people.mjs
// chooseLane / laneOffset / turnAhead; fleet.mjs Drivers, roamDrive; transit.mjs busSide;
// view.mjs ensureJoined).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { loadRules } from "../docs/city/core.mjs";
import { City, Drivers, Roster, TRAFFIC, edgeKey, segOf } from "../docs/city/fleet.mjs";
import { LANE, LANE_CHOICE, Streets, alongRoute, chooseLane, laneOffset, placeFromBuilding, rng, turnAhead } from "../docs/city/people.mjs";
import { BUS_KERB_M, busSide } from "../docs/city/transit.mjs";

const R = loadRules(JSON.parse(readFileSync(new URL("../docs/city/rules.json", import.meta.url))));
const VIEW = readFileSync(new URL("../docs/city/view.mjs", import.meta.url), "utf8");
const N = 6, STEP = 120;
//: Avenues of two lanes each way (four in all), 120 m blocks.
function avenues() {
  const ways = [];
  for (let i = 0; i <= N; i += 1) {
    const along = Array.from({ length: N + 1 }, (_, j) => j * STEP);
    ways.push({ kind: "street", pts: along.map((v) => [i * STEP, v]), lanes: 4, oneway: 0, id: `v${i}`, highway: "primary", road_m: 16 });
    ways.push({ kind: "street", pts: along.map((v) => [v, i * STEP]), lanes: 4, oneway: 0, id: `h${i}`, highway: "primary", road_m: 16 });
  }
  return new Streets(ways);
}

test("the lane: the turn lane on the turn's block; before that a lean to it by lanes away / (blocks + 1); else the least crowded", () => {
  const W = LANE_CHOICE.weight, stick = LANE_CHOICE.stick;
  // Turning left at the end of this block: the leftmost lane, however full.
  assert.equal(chooseLane({ n: 3, cur: 0, turn: { side: -1, blocks: 0, dist: 200 }, crowd: [0, 0, 9] }), 2);
  assert.equal(chooseLane({ n: 3, cur: 2, turn: { side: 1, blocks: 0, dist: 200 }, crowd: [9, 0, 0] }), 0);
  // No turn to come: the least crowded lane, kept to unless another is clearly better.
  assert.equal(chooseLane({ n: 2, cur: 0, turn: null, crowd: [3, 0] }), 1);
  assert.equal(chooseLane({ n: 2, cur: 0, turn: null, crowd: [1, 0.5] }), 0, "not for half a car");
  // A left turn three blocks on: the pull to the left lane is W x 1 / 4 ...
  const far = { side: -1, blocks: 3, dist: 400 };
  assert.ok((W * 1) / 4 < stick, "too slight alone to change lanes for");
  assert.equal(chooseLane({ n: 2, cur: 0, turn: far, crowd: [0, 0] }), 0);
  // ... and it tips an even choice: two cars ahead in either lane, it moves over towards the turn.
  assert.equal(chooseLane({ n: 2, cur: 1, turn: far, crowd: [2, 2] }), 1);
  assert.equal(chooseLane({ n: 2, cur: 0, turn: far, crowd: [2 + stick, 2] }), 1);
  // One block before the turn the lean is twice as strong as three blocks before it.
  const lean = (blocks) => (W * 1) / (blocks + 1);
  assert.ok(lean(1) > lean(3) * 1.9);
  // Lane 0 is the kerb lane, clear of the parking lane; the leftmost is beside the middle line.
  const S = avenues(), route = S.route(S.nearest(0, 0, "drive"), S.nearest(0, 600, "drive"), "drive");
  const i = 1, half = route.halves[i], cls = route.classes[i];
  assert.equal(laneOffset(half, cls, false, i, route, 0), LANE(half, cls, false));
  assert.ok(Math.abs(laneOffset(half, cls, false, i, route, 1) - 1.7) < 1e-9);
  assert.equal(turnAhead(route, i), null, "straight on to the end");
});

test("cars spread over the lanes, turn from the lane for their turn, never meet, and all get there", () => {
  const S = avenues(), r = rng("lanes"), cars = [];
  for (let k = 0; cars.length < 70 && k < 900; k += 1) {
    const pick = () => S.nearest(Math.floor(r() * (N + 1)) * STEP, Math.floor(r() * (N + 1)) * STEP, "drive");
    const a = pick(), b = pick();
    if (a === b) continue;
    const route = S.route(a, b, "drive");
    if (!route || route.length < 200) continue;
    const t0 = r() * 100, dur = route.length / 10, d0 = 25;
    cars.push({ id: `c${String(cars.length).padStart(2, "0")}`, key: `c${cars.length}:1`, route, t0,
      sched: (ts) => (ts < t0 ? 0 : d0 + Math.max(0, Math.min(1, (ts - t0) / dur)) * (route.length - d0)),
      unsched: (d) => t0 + ((d - d0) / (route.length - d0)) * dur, limit: 12, cruise: 12, length: 4.6, width: 1.85 });
  }
  const D = new Drivers(S), dt = 0.05;
  const lanesSeen = new Set(), wrongTurns = new Set();
  let worst = Infinity, last = null;
  for (let t = 0; t < 520; t += dt) {
    const res = D.step(dt, t, cars.filter((c) => t >= c.t0), []);
    last = res;
    const drawn = [];
    for (const x of res.cars) {
      if (x.arrived) continue;
      const c = cars.find((y) => y.id === x.id), st = D.stateOf(x.id);
      if (st.lt >= 1) lanesSeen.add(st.lane);
      // At a junction it turns left at: in the leftmost lane on the way in.
      const i = segOf(c.route, x.d), at = c.route.s[i + 1] - x.d, turn = turnAhead(c.route, i);
      if (turn && turn.blocks === 0 && turn.vertex === i + 1 && at < 12 && at > 6 && st.lt >= 1 && st.lane !== (turn.side < 0 ? 1 : 0)) wrongTurns.add(`${x.id} ${turn.side < 0 ? "L" : "R"} from lane ${st.lane}`);
      if (t - c.t0 > 3) {
        const p = alongRoute(c.route, x.d, st.side);
        drawn.push([-1.375, 0, 1.375].map((u) => [p.x - Math.sin(p.yaw) * u, p.z - Math.cos(p.yaw) * u]));
      }
    }
    for (let i = 0; i < drawn.length; i += 1) for (let j = i + 1; j < drawn.length; j += 1) {
      for (const p of drawn[i]) for (const q of drawn[j]) worst = Math.min(worst, Math.hypot(p[0] - q[0], p[1] - q[1]));
    }
  }
  assert.deepEqual([...lanesSeen].sort(), [0, 1], "both lanes used");
  // (A car that found no gap to get over in time may still turn from the next lane: one or two.)
  assert.ok(wrongTurns.size <= 2, `turned from the wrong lane: ${[...wrongTurns].slice(0, 5).join(", ")}`);
  assert.ok(worst > 1.4, `two cars came ${worst.toFixed(2)} m apart`);
  assert.equal(last.cars.filter((x) => x.arrived).length, cars.length, "every car got where it was going");
  // Lanes are counted by block, the same block whichever route is on it.
  const route = cars[0].route;
  assert.equal(edgeKey(route, 0), `${route.ids[0]}>${route.ids[1]}`);
});

test("a car stuck in a junction is driven out of it; a stalled car about to be hit is moved on", () => {
  const S = avenues();
  const route = S.route(S.nearest(240, 0, "drive"), S.nearest(240, 480, "drive"), "drive");
  const node = route.ids.indexOf(S.nearest(240, 240, "drive")), sNode = route.s[node];
  // In the middle of the box, something with no route of its own stands just ahead: it waits,
  // then after box_clear_s is driven out the far side.
  const car = { id: "box", key: "box:1", route, sched: () => sNode - 2, unsched: () => 0, limit: 12, cruise: 12, length: 4.6, width: 1.85 };
  const D = new Drivers(S), dt = 0.05;
  D.step(dt, 0, [car], []);
  const ahead = alongRoute(route, sNode + 4, D.stateOf("box").side);   // in its lane
  const stand = [{ x: ahead.x, z: ahead.z, yaw: ahead.yaw, v: 0, length: 4.5, width: 1.9 }];
  let t = dt;
  for (; t < 2; t += dt) D.step(dt, t, [car], [], stand);
  assert.ok(D.stateOf("box").d < sNode + 1, "held at first");
  for (; t < 2 + TRAFFIC.box_clear_s + 6; t += dt) D.step(dt, t, [car], [], stand);
  assert.ok(D.stateOf("box").d > sNode + 10, `out of the junction: ${D.stateOf("box").d.toFixed(1)} vs ${sNode}`);
  // A stalled car (nothing holds it, it just is not going) with another bearing down on it.
  const r2 = S.route(S.nearest(0, 120, "drive"), S.nearest(600, 120, "drive"), "drive");
  const stalled = { id: "a", key: "a:1", route: r2, sched: () => 50, unsched: () => 0, limit: 12, cruise: 0, length: 4.6, width: 1.85 };
  const fast = { id: "b", key: "b:1", route: r2, sched: () => 41, unsched: () => 0, limit: 12, cruise: 12, length: 4.6, width: 1.85 };
  const D2 = new Drivers(S);
  D2.step(dt, 0, [stalled, fast], []);
  D2.stateOf("a").v = 0; D2.stateOf("b").v = 10;
  for (let k = 0; k < 10; k += 1) D2.step(dt, k * dt, [stalled, fast], []);
  assert.ok(D2.stateOf("a").d > 50.05, "the one in front moved on");
  assert.ok(D2.stateOf("b").d < D2.stateOf("a").d - 4.6, "never into it");
});

test("a round at work is driven one whole way after another, from where the last one ended, back home at the end", () => {
  const S = avenues(), places = [];
  for (let k = 0; k < 6; k += 1) {
    const b = { id: `b${k}`, x: 60 + k * STEP, z: 60, archetype: "office", floors: 3, area: 300, shops: [], name: `${k} Test`, tag: "office" };
    const pl = placeFromBuilding(b, S, R);
    if (pl) places.push(pl);
  }
  const roster = new Roster(R, { seed: "roam" });
  roster.add(places);
  const city = new City(R, roster, S, { seed: "roam", timeAt: () => ({ day: 1, minute: 0 }) });
  const place = places[2], p = { id: "cop", role: "police" };
  const seg = { place: place.id, drive: true, t0: 600, t1: 600 + 30, act: { kind: "work", outdoor: "patrol" } };
  const legs = [];
  for (let m = 600; m < 630; m += 1) {
    const L = city.roamDrive(p, seg, { day: 1, minute: m + 0.5 });
    if (L && !legs.some((x) => x.key === L.key)) legs.push(L);
  }
  assert.ok(legs.length >= 5, `${legs.length} legs`);
  const home = S.nearest(place.x, place.z, "kerb", 200);
  assert.equal(legs[0].route.ids[0], home, "out from the workplace");
  assert.equal(legs[legs.length - 1].route.ids.at(-1), home, "back to it at the end");
  for (let k = 0; k + 1 < legs.length; k += 1) {
    assert.equal(legs[k].route.ids.at(-1), legs[k + 1].route.ids[0], "each from where the last ended");
    assert.ok(legs[k].t1 <= legs[k + 1].t0 + 1e-9, "each driven to its end before the next");
  }
  // Never out and back along the same way (the turning round in the street it did before).
  for (const L of legs) assert.notEqual(L.route.ids[0], L.route.ids.at(-1));
});

test("a bus pulls in to the kerb only at its stop, where there is a parking lane, and straight back out", () => {
  const half = 8;
  assert.equal(busSide(0)(half, "primary", true), LANE(half, "primary", true), "in its lane between stops");
  assert.equal(busSide(1)(half, "primary", true), half - BUS_KERB_M, "at the kerb at the stop");
  assert.equal(busSide(1)(half, "primary", false), LANE(half, "primary", false), "no parking lane: it stands in its lane");
  assert.ok(busSide(0.5)(half, "primary", true) < half - BUS_KERB_M && busSide(0.5)(half, "primary", true) > LANE(half, "primary", true));
  assert.equal(R.transit_lines.pull_m, 18);
});

test("everyone is a player of the city from the start: no Join the city to press; cars drawn in their own lanes", () => {
  assert.ok(!VIEW.includes('act("Join the city"') && !VIEW.includes('label: "Join the city"'));
  assert.ok(VIEW.includes("    district.cameras = speedCameras([...district.allWays.values()], data);\n    ensureJoined();"));
  assert.ok(VIEW.includes('const name = party.session?.me?.name || lib?.account?.()?.name || "You";'));
  assert.ok(VIEW.includes("alongRoute(route, r0.d, D.stateOf(r0.id)?.side || DRIVE_LANE)"));
  assert.ok(VIEW.includes("A rider at the end of the way rides on"));
});
