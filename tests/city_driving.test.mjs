// The city's drivers are good at it (docs/city/fleet.mjs Drivers): they do not come into sight
// already driving into a queue, they brake as hard as it takes for a car stopped dead ahead,
// they give way to a car coming across, a car facing the wrong way in the lane is stopped for
// and gone round, and two that have hit do not stand in the lane for good.
import assert from "node:assert/strict";
import test from "node:test";
import { Drivers, TRAFFIC } from "../docs/city/fleet.mjs";
import { Streets, alongRoute } from "../docs/city/people.mjs";

const dt = 0.05;
const street = (lanes = 2) => new Streets([{ kind: "street", pts: [[0, 0], [600, 0]], lanes, oneway: 0, road_m: 10, id: "a" }]);
const along = (S) => S.route(S.nearest(0, 0, "drive"), S.nearest(600, 0, "drive"), "drive");
const back = (S) => S.route(S.nearest(600, 0, "drive"), S.nearest(0, 0, "drive"), "drive");
const carOn = (id, route, at, extra = {}) => ({ id, key: `${id}:1`, route, sched: () => at, unsched: () => 1e9, limit: 12, cruise: 12, length: 4.6, width: 1.85, ...extra });

test("a car that comes into sight behind a standing queue comes in at a speed it can stop from, and does not hit it", () => {
  const S = street(), r = along(S), D = new Drivers(S);
  const queue = [0, 1, 2].map((k) => carOn(`q${k}`, r, 300 - k * 7, { cruise: 0 }));
  for (let t = 0; t < 1; t += dt) D.step(dt, t, queue, []);
  for (const q of queue) D.stateOf(q.id).v = 0;
  // Its day has it eight metres behind the last of them, at its cruising speed.
  const late = carOn("late", r, 300 - 14 - 8), hits = [];
  for (let t = 1; t < 9; t += dt) hits.push(...D.step(dt, t, [...queue, late], []).hits);
  assert.equal(hits.length, 0, JSON.stringify(hits.map((h) => [h.car, h.who, h.speed])));
  assert.equal(D.stateOf("late").hit, null);
  assert.ok(D.stateOf("late").d < 300 - 14 - 4.6 + 0.3, "stood behind them");
  assert.equal(D.tally.crashes || 0, 0);
});

test("the car ahead stops dead: the one behind brakes as hard as it takes and does not hit it", () => {
  const S = street(), r = along(S), D = new Drivers(S);
  const lead = carOn("lead", r, 200), next = carOn("next", r, 200 - 4.6 - 14);
  for (let t = 0; t < 2; t += dt) D.step(dt, t, [lead, next], []);
  assert.ok(D.stateOf("next").v > 8, "following at speed");
  D.stop("lead", { id: "stalled", kind: "vehicle", until: 1e9 });
  const hits = [];
  let hardest = 0, was = D.stateOf("next").v;
  for (let t = 2; t < 8; t += dt) { hits.push(...D.step(dt, t, [lead, next], []).hits); const v = D.stateOf("next").v; hardest = Math.max(hardest, (was - v) / dt); was = v; }
  assert.equal(hits.length, 0);
  assert.ok(hardest > TRAFFIC.brake + 0.5 && hardest <= TRAFFIC.emergency + 1e-6, `braked at ${hardest.toFixed(1)} m/s2`);
  // (And then goes round it, as round anything stood in the lane.)
});

test("two that have hit stand a while and then drive on: a bump is not a wall in the lane for the rest of the trip", () => {
  const S = street(), r = along(S), D = new Drivers(S);
  const a = carOn("a", r, 50, { cruise: 0 }), b = carOn("b", r, 44);
  D.step(dt, 0, [a, b], []); D.stateOf("a").v = 0; D.stateOf("b").v = 12;
  let t = dt;
  for (; t < 1; t += dt) D.step(dt, t, [a, b], []);
  assert.equal(D.stateOf("b").hit?.kind, "vehicle");
  const at = D.stateOf("a").d;
  a.cruise = 12;
  for (; t < TRAFFIC.wreck_hard_s - 2; t += dt) D.step(dt, t, [a, b], []);
  assert.ok(Math.abs(D.stateOf("a").d - at) < 0.01, "still standing");
  for (; t < TRAFFIC.wreck_hard_s + 12; t += dt) D.step(dt, t, [a, b], []);
  assert.ok(D.stateOf("a").d > at + 20 && D.stateOf("b").d > 60, "both gone on");
});

test("a car stood facing the wrong way in the lane is stopped for, not driven into", () => {
  const S = street(), r = along(S), D = new Drivers(S);
  const me = carOn("me", r, 100);
  D.step(dt, 0, [me], []);
  const spot = alongRoute(r, 160, D.stateOf("me").side);
  // Another of the city's cars, on the way back, stood in this one's lane (round something, shut in).
  const wrong = carOn("wrong", back(S), 600 - 160, { cruise: 0 });
  D.step(dt, dt, [me, wrong], []);
  const st = D.stateOf("wrong"); st.v = 0; st.side = () => -D.stateOf("me").side(5, "residential", null, 0, r);
  const hits = [];
  let nearest = Infinity;
  for (let t = 2 * dt; t < 12; t += dt) {
    const out = D.step(dt, t, [me, wrong], []);
    hits.push(...out.hits); D.stateOf("wrong").v = 0;
    const p = alongRoute(r, D.stateOf("me").d, D.stateOf("me").side), q = alongRoute(wrong.route, D.stateOf("wrong").d, D.stateOf("wrong").side);
    nearest = Math.min(nearest, Math.hypot(p.x - q.x, p.z - q.z));
  }
  assert.equal(hits.length, 0, JSON.stringify(hits.map((h) => [h.car, h.who, h.speed])));
  assert.ok(nearest > 1.9, `never nearer than ${nearest.toFixed(2)} m centre to centre`);
  assert.ok(Math.abs(spot.z) < 5);
});

test("of two of the city's cars whose ways cross, one gives way and neither is hit", () => {
  const S = new Streets([
    { kind: "street", pts: [[0, 0], [200, 0], [400, 0]], lanes: 2, oneway: 0, road_m: 10, id: "ew" },
    { kind: "street", pts: [[200, -200], [200, 0], [200, 200]], lanes: 2, oneway: 0, road_m: 10, id: "ns" },
  ]);
  const ew = S.route(S.nearest(0, 0, "drive"), S.nearest(400, 0, "drive"), "drive"), ns = S.route(S.nearest(200, -200, "drive"), S.nearest(200, 200, "drive"), "drive");
  let crashes = 0;
  for (const lag of [0, 3, 6, 9, 12]) {
    const D = new Drivers(S), a = carOn("a", ew, 110), b = carOn("b", ns, 110 - lag);
    for (let t = 0; t < 30; t += dt) crashes += D.step(dt, t, [a, b], []).hits.length;
    assert.ok(D.stateOf("a").d > 260 && D.stateOf("b").d > 260, `both through (${lag} m apart): ${D.stateOf("a").d.toFixed(0)}, ${D.stateOf("b").d.toFixed(0)}`);
  }
  assert.equal(crashes, 0);
});

test("only a share of the through traffic is driven in sight, the same trips every time; the residents' own all are", async () => {
  const { readFileSync } = await import("node:fs");
  const fleet = readFileSync(new URL("../docs/city/fleet.mjs", import.meta.url), "utf8"), view = readFileSync(new URL("../docs/city/view.mjs", import.meta.url), "utf8");
  // (Decided a trip at a time when it is planned -- the drive, the walk from the kerb and the hour
  // about the shops together: visitorPlan's ``unseen`` -- and by the leg for a plan without it.)
  assert.match(fleet, /if \(leg\.unseen \|\| \(leg\.unseen === undefined && v\.visitor && this\.through < 1 && hash32\(v\.id, Math\.round\(leg\.t0\)\) % 1000 >= this\.through \* 1000\)\) continue;/);
  assert.match(fleet, /seen = p\.commuter \|\| !\(this\.through < 1\) \|\| hash32\(p\.id, t\.day, "trip", k\) % 1000 < this\.through \* 1000/);
  assert.match(view, /district\.city\.through = R\.density\?\.through_driven \?\? THROUGH_DRIVEN/);
  const share = Number(/const THROUGH_DRIVEN = ([\d.]+);/.exec(view)[1]);
  assert.ok(share > 0.05 && share <= 0.3, `a share that leaves the streets moving: ${share}`);
});
