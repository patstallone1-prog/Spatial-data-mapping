// A walker's plan for the next few seconds (docs/city/walk-plan.mjs): the route read in 3D (its
// slope, its kerbs), the line taken and the alternative, and a stop planned with its length.
import assert from "node:assert/strict";
import { test } from "node:test";
import { PLAN, paceAt, planWalk, readAhead, slopePace, stepLift } from "../docs/city/walk-plan.mjs";

// A straight walk east along z = 0 from x = 0.
const east = (m) => ({ x: m, z: 0 });
const flat = () => 0;

test("the pace is Tobler's: slower uphill, a little quicker gently down, slower down a steep one", () => {
  assert.equal(+slopePace(0).toFixed(3), 1);
  assert.ok(slopePace(0.1) < 0.8);
  assert.ok(slopePace(-0.05) > 1);
  assert.ok(slopePace(-0.3) < 0.7);
});

test("a kerb ahead is a step, found before the foot is over it, and the body is raised to it in a stride", () => {
  // A kerb 15 cm up at x = 3.
  const kerb = (x) => (x >= 3 ? 0.15 : 0);
  const { pts, steps } = readAhead(east, kerb, 6);
  assert.equal(steps.length, 1);
  assert.ok(Math.abs(steps[0].m - 2.75) < 0.3 && Math.abs(steps[0].rise - 0.15) < 1e-6, JSON.stringify(steps));
  // The kerb is not read as a slope.
  assert.ok(pts.every((p) => p.grade === 0));
  // Raised over the approach, never popped: the lift goes up smoothly to the rise at the kerb.
  const s = steps[0].m, lifts = [];
  for (let m = s - 0.6; m <= s; m += 0.05) lifts.push(stepLift(steps, m));
  for (let i = 1; i < lifts.length; i += 1) assert.ok(lifts[i] >= lifts[i - 1] - 1e-9 && lifts[i] - lifts[i - 1] < 0.05);
  assert.equal(stepLift(steps, s + 0.2), 0);
  // Down a kerb: let down after it.
  const down = readAhead(east, (x) => (x >= 3 ? -0.15 : 0), 6).steps;
  assert.ok(stepLift(down, down[0].m + 0.05) > 0.1 && stepLift(down, down[0].m + PLAN.step_ease_m + 0.01) === 0);
});

test("a wall is not a step: the route is read no further", () => {
  const { pts } = readAhead(east, (x) => (x >= 2 ? 3 : 0), 6);
  assert.ok(pts[pts.length - 1].m < 2.1);
});

test("a slope slows the walk through it", () => {
  const hill = readAhead(east, (x) => x * 0.12, 6).pts;
  assert.ok(hill.slice(1).every((p) => p.pace < 0.8));
  assert.ok(paceAt({ pts: hill }, 3) < 0.8 && paceAt({ pts: readAhead(east, flat, 6).pts }, 3) === 1);
});

test("someone standing in the way: the plan goes round them, the side chosen early, and there is an alternative", () => {
  const plan = planWalk({ speed: 1.4 }, { along: east, ground: flat, people: [{ x: 4, z: 0, vx: 0, vz: 0 }] });
  assert.notEqual(plan.side, 0);
  assert.notEqual(plan.alt, plan.side);
  assert.equal(plan.stop, null);
  // With nobody about, straight on.
  assert.equal(planWalk({ speed: 1.4 }, { along: east, ground: flat }).side, 0);
});

test("a step aside into a wall is not taken", () => {
  const plan = planWalk({ speed: 1.4 }, { along: east, ground: flat, people: [{ x: 4, z: 0 }], free: (x, z) => z <= 0.1 });
  // (z grows to the walker's right going east here: the right is the wall's side.)
  assert.ok(plan.side <= 0, JSON.stringify(plan.lines));
});

test("a car coming across their way: a stop planned short of it, for as long as the car takes to go by", () => {
  // A car crossing their line at x = 5, coming from the side at 6 m/s, reaching it in about 3 s.
  const car = { x: 5, z: -18, vx: 0, vz: 6, half: 2.2 };
  const plan = planWalk({ speed: 1.4 }, { along: east, ground: flat, cars: [car] });
  assert.ok(plan.stop, JSON.stringify(plan.lines));
  assert.ok(plan.stop.m < 5 - PLAN.stop_short_m + 1e-6 && plan.stop.m > 2, JSON.stringify(plan.stop));
  assert.ok(plan.stop.for_s > 0.5 && plan.stop.for_s <= PLAN.stop_most_s);
  assert.equal(plan.stop.kind, "car");
});

test("a car going by in its lane, or parked at the kerb, is no reason to stop on the pavement", () => {
  // Walking east along z = 0; the lane's middle 2.6 m off, a car coming along it the other way.
  const passing = { x: 12, z: 2.6, vx: -8, vz: 0, half: 2.2 };
  const parked = { x: 4, z: 2.1, vx: 0, vz: 0, half: 2.2 };
  const plan = planWalk({ speed: 1.4 }, { along: east, ground: flat, cars: [passing, parked] });
  assert.equal(plan.stop, null, JSON.stringify(plan.lines));
});
