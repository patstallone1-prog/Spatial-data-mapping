// Near you, people decide for themselves (docs/city/temperament.mjs): the same person the same
// way every time, different people differently; and a driver brakes for a car coming across.
import assert from "node:assert/strict";
import test from "node:test";
import { Drivers } from "../docs/city/fleet.mjs";
import { Streets } from "../docs/city/people.mjs";
import { REACT, STEADY_STYLE, drivingStyle, reactionFor, reactionTo, stepClear, temperamentOf, timeToMeet } from "../docs/city/temperament.mjs";

const person = (i, extra = {}) => ({ id: `p${i}`, age: 20 + (i * 7) % 55, base: { role: "clerk" }, ...extra });

test("a temperament is the same person's every time, within 0..1, and people differ", () => {
  const a = temperamentOf(person(1)), again = temperamentOf({ ...person(1) });
  assert.deepEqual(a, again);
  const all = Array.from({ length: 400 }, (_, i) => temperamentOf(person(i)));
  for (const t of all) for (const k of ["nerve", "temper", "patience", "care", "civic"]) assert.ok(t[k] >= 0 && t[k] <= 1, `${k} ${t[k]}`);
  for (const k of ["nerve", "temper", "patience", "care", "civic"]) {
    const v = all.map((t) => t[k]).sort((x, y) => x - y);
    assert.ok(v[360] - v[40] > 0.4, `${k} is spread: ${v[40]} .. ${v[360]}`);
  }
  // It is kept on the person without being written out with them.
  const p = person(9); temperamentOf(p);
  assert.equal(JSON.stringify(p).includes("_temperament"), false);
});

test("work and age tilt it: a patrol officer has more nerve than the same person as a clerk", () => {
  for (let i = 0; i < 40; i += 1) assert.ok(temperamentOf(person(i, { base: { role: "patrol" } })).nerve >= temperamentOf(person(i)).nerve);
  const young = Array.from({ length: 200 }, (_, i) => temperamentOf({ id: `y${i}`, age: 19 }).care), old = Array.from({ length: 200 }, (_, i) => temperamentOf({ id: `y${i}`, age: 72 }).care);
  assert.ok(old.reduce((a, b) => a + b) > young.reduce((a, b) => a + b) + 30);
});

test("nobody's driving breaks the law: never over their cruising speed, never closer than four fifths of the usual room", () => {
  for (let i = 0; i < 400; i += 1) {
    const s = drivingStyle(temperamentOf(person(i)));
    assert.ok(s.pace <= 1 && s.pace >= 0.86, `pace ${s.pace}`);
    assert.ok(s.headway >= 0.8 && s.headway <= 1.6, `headway ${s.headway}`);
    assert.ok(s.alert >= 1, `alert ${s.alert}`);
    assert.ok(s.patience >= 0.5 && s.patience <= 2.2);
  }
  const hot = drivingStyle({ nerve: 0.5, temper: 0.95, patience: 0.1, care: 0.1, civic: 0.5 }), calm = drivingStyle({ nerve: 0.5, temper: 0.1, patience: 0.9, care: 0.9, civic: 0.5 });
  assert.ok(hot.pace > calm.pace && hot.headway < calm.headway && hot.patience < calm.patience && hot.assertive && !calm.assertive);
});

test("a car bearing down: the timid step clear early, the bold late, and nobody moves for one that will miss", () => {
  const timid = { nerve: 0.1, temper: 0.5, patience: 0.5, care: 0.5, civic: 0.5 }, bold = { ...timid, nerve: 0.95 };
  // A car at the origin going +x at 10 m/s; someone 18 m ahead, a little to one side.
  assert.ok(stepClear(timid, 18, 0.4, 0, 0, 10, 0));
  assert.equal(stepClear(bold, 18, 0.4, 0, 0, 10, 0), null);
  const late = stepClear(bold, 8, 0.4, 0, 0, 10, 0);
  assert.ok(late && late.ttc < 1);
  // Out of it sideways, to the side they were already on, far enough to be clear of its flank.
  const step = stepClear(timid, 12, 0.4, 0, 0, 10, 0), other = stepClear(timid, 12, -0.4, 0, 0, 10, 0);
  assert.ok(Math.abs(step.dx) < 1e-9 && Math.abs(step.dz) > 1);
  assert.ok(Math.sign(step.dz) === 1 && Math.sign(other.dz) === -1);
  // Three metres to the side, behind it, or a car crawling: no danger.
  assert.equal(stepClear(timid, 12, 3.2, 0, 0, 10, 0), null);
  assert.equal(stepClear(timid, -4, 0, 0, 0, 10, 0), null);
  assert.equal(stepClear(timid, 4, 0, 0, 0, 2, 0), null);
});

test("at a crash people do different things, each the same thing about the same crash; far off, nothing", () => {
  const crash = { kind: "crash", id: "crash:1" }, fight = { kind: "fight", id: "fight:1" };
  const tally = {}, tallyFight = {};
  for (let i = 0; i < 600; i += 1) {
    const t = temperamentOf(person(i)), r = reactionTo(t, crash, 9, `p${i}`);
    assert.equal(r, reactionTo(t, crash, 9, `p${i}`));
    tally[r] = (tally[r] || 0) + 1;
    const f = reactionTo(t, fight, 9, `p${i}`); tallyFight[f] = (tallyFight[f] || 0) + 1;
    assert.equal(reactionTo(t, crash, REACT.notice_m + 1, `p${i}`), "carry_on");
    if (r !== "carry_on") assert.ok(reactionFor(t, r) > 2 && reactionFor(t, r) < 20);
  }
  for (const k of ["flee", "help", "call", "film", "watch", "carry_on"]) assert.ok(tally[k] > 12, `${k}: ${JSON.stringify(tally)}`);
  // A fight frightens more than a crash, and nobody walks into one to help.
  assert.ok(tallyFight.flee > tally.flee);
  assert.equal(tallyFight.help, undefined);
});

test("two things on straight ways meet when and only when they would", () => {
  // Head on, 20 m apart, 10 m/s each, a metre round each: 18 m to close at 20 m/s.
  assert.ok(Math.abs(timeToMeet(0, 0, 10, 0, 1, 20, 0, -10, 0, 1) - 0.9) < 1e-6);
  // Crossing at right angles and arriving together.
  assert.ok(timeToMeet(0, 0, 10, 0, 1, 15, -15, 0, 10, 1) > 0);
  // Crossing, but one is long gone by; going apart; too far ahead in time.
  assert.equal(timeToMeet(0, 0, 10, 0, 1, 15, -60, 0, 10, 1), -1);
  assert.equal(timeToMeet(0, 0, -10, 0, 1, 20, 0, 10, 0, 1), -1);
  assert.equal(timeToMeet(0, 0, 1, 0, 1, 60, 0, -1, 0, 1), -1);
});

// One straight street, a car driven along it by the rules.
function drive(style, blockerAt, seconds = 6) {
  const S = new Streets([{ kind: "street", pts: [[0, 0], [400, 0]], lanes: 2, oneway: 0, road_m: 10, id: "a" }]);
  const D = new Drivers(S), route = S.route(S.nearest(0, 0, "drive"), S.nearest(400, 0, "drive"), "drive");
  const car = { id: "c", key: "c:1", route, sched: () => 0, unsched: () => 1e9, limit: 11, cruise: 10, length: 4.5, width: 1.9, style };
  let d = 0, v = 0, minGap = Infinity, reason = null;
  for (let t = 0; t < seconds; t += 0.05) {
    const blockers = blockerAt ? [blockerAt(t)] : [];
    const out = D.step(0.05, 1000 + t, [car], [], blockers).cars[0];
    d = out.d; v = out.v; if (out.reason) reason = out.reason;
    if (blockerAt) { const b = blockerAt(t); minGap = Math.min(minGap, Math.hypot(b.x - d, b.z)); }
  }
  return { d, v, minGap, reason, yields: D.tally.yields || 0 };
}

test("the careful hold a slower pace than the pushy on the same empty street", () => {
  const hot = drive(drivingStyle({ nerve: 0.5, temper: 0.95, patience: 0.1, care: 0.1, civic: 0.5 }));
  const calm = drive(drivingStyle({ nerve: 0.5, temper: 0.1, patience: 0.9, care: 0.9, civic: 0.5 }));
  const plain = drive(undefined), steady = drive(STEADY_STYLE);
  assert.ok(hot.d > calm.d + 3, `${hot.d} against ${calm.d}`);
  assert.equal(plain.d, steady.d);
  assert.ok(hot.v <= 10 + 1e-9 && calm.v >= 8.5);
});

test("a car coming across is braked for, and not run into", () => {
  // It crosses the street 60 m on, from the side, timed to be there as this car is.
  const across = (t) => ({ x: 60, z: -50 + 8 * t, yaw: Math.PI, v: 8, length: 4.5, width: 1.9 });
  const calm = drive(drivingStyle({ nerve: 0.5, temper: 0.2, patience: 0.8, care: 0.8, civic: 0.5 }), across, 14);
  assert.ok(calm.yields >= 1, "it gave way");
  assert.ok(calm.minGap > 2.2, `never nearer than ${calm.minGap.toFixed(2)} m`);
  assert.ok(calm.d > 100, `and went on once it had gone by (${calm.d.toFixed(0)} m)`);
});

test("someone with no phone on them never calls or films an incident: they look on instead", () => {
  const ev = { id: "inc:1", kind: "crash" };
  let called = 0, calledWith = 0, calledAvg = 0;
  for (let i = 0; i < 3000; i += 1) {
    const t = temperamentOf({ id: `p${i}`, age: 20 + (i % 60) });
    const none = reactionTo(t, ev, 6, `p${i}`, { phone: false });
    assert.ok(none !== "call" && none !== "film", none);
    if (reactionTo(t, ev, 6, `p${i}`, { phone: true }) === "call") calledWith += 1;
    if (reactionTo(t, ev, 6, `p${i}`) === "call") calledAvg += 1;
    called += none === "watch" ? 1 : 0;
  }
  assert.ok(calledWith > calledAvg, `${calledAvg} -> ${calledWith}`);
  assert.ok(called > 0);
});

test("a siren going by turns heads for a moment and nothing more: nobody calls, films or runs from it", () => {
  const ev = { id: "siren:1", kind: "siren" };
  const seen = new Set();
  for (let i = 0; i < 2000; i += 1) seen.add(reactionTo(temperamentOf({ id: `s${i}`, age: 30 }), ev, 8, `s${i}`, { phone: true }));
  assert.deepEqual([...seen].sort(), ["carry_on", "glance"]);
  const t = temperamentOf({ id: "g", age: 40 }), s = reactionFor(t, "glance");
  assert.ok(s >= REACT.glance_s[0] && s <= REACT.glance_s[1]);
});
