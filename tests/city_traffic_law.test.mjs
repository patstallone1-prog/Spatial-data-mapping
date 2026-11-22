// The law at a junction as the city's drivers keep it (docs/city/fleet.mjs Drivers; people.mjs
// lanePlan): no car comes into sight already running a red light, a left turn waits for a gap in
// what comes the other way, and a short one-way piece of a two-way street keeps that street's lanes.
import assert from "node:assert/strict";
import { test } from "node:test";

import { Drivers, TRAFFIC, signalAt, junctionAt, turnOf } from "../docs/city/fleet.mjs";
import { ONEWAY_STUB_M, Streets, lanePlan, laneOffset, leftOf } from "../docs/city/people.mjs";

const N = 6, STEP = 120;
function avenues() {
  const ways = [];
  for (let i = 0; i <= N; i += 1) {
    const along = Array.from({ length: N + 1 }, (_, j) => j * STEP);
    ways.push({ kind: "street", pts: along.map((v) => [i * STEP, v]), lanes: 4, oneway: 0, id: `v${i}`, highway: "primary", road_m: 16 });
    ways.push({ kind: "street", pts: along.map((v) => [v, i * STEP]), lanes: 4, oneway: 0, id: `h${i}`, highway: "primary", road_m: 16 });
  }
  return new Streets(ways);
}
const at = (S, x, z) => S.nearest(x, z, "drive");
const bearingIn = (route, i) => Math.atan2(route.pts[i][0] - route.pts[i - 1][0], route.pts[i][1] - route.pts[i - 1][1]);

test("a car that comes into sight short of a red light is not already going through it", () => {
  const S = avenues(), D = new Drivers(S);
  const route = S.route(at(S, 360, 0), at(S, 360, 720), "drive");
  const P = D.passages(route)[0], node = route.ids[P.i0];
  assert.equal(junctionAt(S, node), "signal");
  const c = { id: "late", key: "late:1", route, limit: 12, cruise: 12, length: 4.6, width: 1.85 };
  const line = P.s0 - D.stopLine(node, c);
  // A moment the light has just gone red for it, and stays red.
  let t0 = -1;
  for (let t = 0; t < TRAFFIC.signal_cycle_s && t0 < 0; t += 0.25) {
    if (signalAt(S, node, bearingIn(route, P.i0), t) === "red" && signalAt(S, node, bearingIn(route, P.i0), t + 6) === "red") t0 = t;
  }
  assert.ok(t0 >= 0);
  // Its day has it eight metres short of the line at its cruising speed.
  const d0 = line - 8;
  c.sched = (ts) => d0 + Math.max(0, ts - t0) * 12; c.unsched = (d) => t0 + (d - d0) / 12;
  let far = 0;
  for (let t = t0; t < t0 + 6; t += 0.05) {
    const res = D.step(0.05, t, [c], []);
    if (t === t0) assert.ok(D.stateOf("late").v <= Math.sqrt(2 * TRAFFIC.brake * 8) + 0.5, `came in at ${D.stateOf("late").v.toFixed(1)} m/s`);
    far = Math.max(far, res.cars[0].d);
  }
  assert.ok(far <= line + 0.6, `went ${(far - line).toFixed(1)} m over its line on red`);
});

test("a left turn waits for a gap in what comes the other way, then goes; nobody is hit", () => {
  const S = avenues();
  // Northbound to the junction at (360, 360) and left there; southbound straight through it.
  let turner = null;
  for (const [x, z] of [[240, 360], [480, 360], [120, 360], [600, 360]]) {
    const r = S.route(at(S, 360, 240), at(S, x, z), "drive");
    if (!r || Math.abs(r.pts[1][0] - 360) > 1 || Math.abs(r.pts[1][1] - 360) > 1) continue;
    const u = (a, b) => { const L = Math.hypot(b[0] - a[0], b[1] - a[1]); return [(b[0] - a[0]) / L, (b[1] - a[1]) / L]; };
    if (turnOf(u(r.pts[0], r.pts[1]), u(r.pts[1], r.pts[2])) === "L") { turner = r; break; }
  }
  assert.ok(turner, "a route that turns left at the junction");
  const through = S.route(at(S, 360, 480), at(S, 360, 240), "drive");
  const node = turner.ids[1], bearing = bearingIn(turner, 1);
  let t0 = -1;
  for (let t = 0; t < TRAFFIC.signal_cycle_s && t0 < 0; t += 0.25) {
    let green = true;
    for (let k = 4; k <= 15 && green; k += 0.5) green = signalAt(S, node, bearing, t + k) === "green";
    if (green) t0 = t;
  }
  assert.ok(t0 >= 0, "a green long enough for both");
  const car = (id, route, lead) => {
    const d0 = 25 + lead, dur = (route.length - d0) / 10;
    return { id, key: `${id}:1`, route, limit: 12, cruise: 12, length: 4.6, width: 1.85,
      sched: (ts) => d0 + Math.max(0, Math.min(1, (ts - t0) / dur)) * (route.length - d0), unsched: (d) => t0 + ((d - d0) / (route.length - d0)) * dur };
  };
  const D = new Drivers(S), cars = [car("left", turner, 0), car("on", through, 0)];
  let waited = false, hits = 0, arrivedLeft = false;
  for (let t = t0; t < t0 + 120; t += 0.05) {
    const res = D.step(0.05, t, cars, []);
    hits += res.hits.length;
    const l = res.cars.find((x) => x.id === "left");
    if (l?.reason === "giving way to oncoming") waited = true;
    if (l?.arrived) arrivedLeft = true;
  }
  assert.equal(hits, 0);
  assert.ok(waited, "it waited for the car coming the other way");
  assert.ok(arrivedLeft, "and then made its turn");
  assert.ok(TRAFFIC.left_wait_s > TRAFFIC.left_gap_s, "it does not wait for ever");
});

test("a short one-way piece of a two-way street keeps that street's lanes; a one-way street its own", () => {
  const route = (len) => ({ pts: [[0, 0], [0, 100], [0, 100 + len], [0, 200 + len]], s: [0, 100, 100 + len, 200 + len], lanes: [4, 2, 4], oneways: [false, true, false],
    halves: [8, 8, 8], classes: ["arterial", "arterial", "arterial"], parks: [false, false, false], twins: [null, null, null], ids: [0, 1, 2, 3], length: 200 + len });
  const stub = route(20), plan = lanePlan(stub);
  assert.deepEqual(plan.n, [2, 1, 2]);
  assert.equal(leftOf(8, "arterial", false, 1, stub), 1.7);
  // (Every lane of it right of the middle line.)
  for (const j of [0, 1]) assert.ok(laneOffset(8, "arterial", false, 1, stub, j) >= 1.7);
  const street = route(ONEWAY_STUB_M + 60);
  assert.deepEqual(lanePlan(street).n, [2, 2, 2]);
  assert.ok(leftOf(8, "arterial", false, 1, street) < 0, "its left lane is by the left kerb");
});

test("a large place's people do not all take their break at its door, and a round on foot has a patch of its own", async () => {
  const { City, BREAK_OUTSIDE_OF, BREAK_OUTSIDE_MOST, BEAT_M } = await import("../docs/city/fleet.mjs");
  const people = new Map();
  for (let i = 0; i < 400; i += 1) people.set(`d${i}`, { id: `d${i}`, work: "depot" });
  for (let i = 0; i < 10; i += 1) people.set(`s${i}`, { id: `s${i}`, work: "shop" });
  const city = { roster: { people } }, out = (work) => [...people.values()].filter((p) => p.work === work && City.prototype.breakOutside.call(city, p, { day: 3 })).length;
  assert.ok(out("depot") <= BREAK_OUTSIDE_MOST * 2, `${out("depot")} of the depot's 400 outside`);
  assert.ok(out("depot") >= 1);
  assert.ok(out("shop") <= Math.ceil(10 / BREAK_OUTSIDE_OF) + 3);
  assert.ok(BEAT_M[0] >= 100 && BEAT_M[1] > BEAT_M[0]);
  const src = (await import("node:fs")).readFileSync(new URL("../docs/city/fleet.mjs", import.meta.url), "utf8");
  assert.match(src, /if \(!drive && seg\.act\.kind !== "stroll"\) \{\s*\n\s*const ang = \(\(hash32\(p\.id, "beat"\)/);
});
