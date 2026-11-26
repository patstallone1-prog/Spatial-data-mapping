// A vehicle's turns are planned (docs/city/people.mjs planTurn): the index -- a turn's sharpness
// goes with where it starts and how much room its lane leaves to the inside kerb -- then the
// body driven round in advance and the turn replanned where it would go over a kerb
// (2026-11-25: a car turned over the kerb). And a route's jogs (a node passed and come back to a
// metre on) are not driven as turns on the spot.
import assert from "node:assert/strict";
import { test } from "node:test";

import { Streets, TURN_PLAN, alongRoute, planTurn, turnIndexLegs, turnOverKerb } from "../docs/city/people.mjs";

// A two-lane street turning a right angle at (0, 0): in along -z (north), out along +x (east).
function corner(half = 3, lanes = 2) {
  const pts = [[0, 60], [0, 0], [60, 0]];
  return { pts, s: [0, 60, 120], length: 120, halves: [half, half], classes: ["residential", "residential"], parks: [null, null], lanes: [lanes, lanes] };
}

test("the index: a turn from a lane further from the kerb is wider and begins earlier; a sharper one later", () => {
  const right = Math.PI / 2;
  assert.ok(turnIndexLegs(right, 3) > turnIndexLegs(right, 1), "more room to the kerb, longer legs");
  assert.ok(turnIndexLegs(right, 1) > turnIndexLegs(Math.PI / 4, 1), "a slight bend needs less curve than a right angle");
  // A right angle: the curve's middle where an arc of radius kerb_r + gap would be.
  const R = TURN_PLAN.kerb_r + 1.2;
  assert.ok(Math.abs(turnIndexLegs(right, 1.2) - 2 * R * (Math.SQRT2 - 1) / Math.SQRT1_2) < 1e-9);
});

test("a right turn from the kerb lane is planned to keep the body off the kerb", () => {
  const route = corner(3.2);
  const off = 1.6;   // right of the line: the kerb lane, 1.6 m from the kerb
  // What the old fixed lead did here (4.5 m for a car, plus the offset): over the inside kerb.
  const old = turnOverKerb(route, 1, off, off, 4.5 + off, 4.5, 1.9);
  assert.ok(old > 0.3, `the old curve went ${old} m over the kerb`);
  const legs = planTurn(route, 1, off, off, 4.5, 1.9);
  assert.ok(legs > 0);
  assert.equal(turnOverKerb(route, 1, off, off, legs, 4.5, 1.9), 0, `planned legs ${legs} keep to the road`);
  // And the car drives that plan: alongRoute with a vehicle's lane side.
  const side = Object.assign(() => off, { lead: 4.5, bodyLength: 4.5, bodyWidth: 1.9 });
  const mid = alongRoute(route, 60, side);
  assert.ok(mid.x > 0 && mid.z > 0, "round the inside of the corner");
  assert.ok(Math.hypot(mid.x, mid.z) < legs, "not swung out past the lanes' corner");
});

test("plans are kept per corner and lane", () => {
  const route = corner(3.2);
  const a = planTurn(route, 1, 1.6, 1.6, 4.5, 1.9);
  assert.equal(route.turnPlans.size, 1);
  assert.equal(planTurn(route, 1, 1.6, 1.6, 4.5, 1.9), a);
  assert.equal(route.turnPlans.size, 1);
  planTurn(route, 1, -1.6, -1.6, 4.5, 1.9);
  assert.equal(route.turnPlans.size, 2);
});

test("a lane that moves across at a bend gets the length of curve to move in", () => {
  // A wide avenue (half 12 m, a lane 10 m out) bending 30 degrees into a narrow street (half 3).
  const a = Math.PI / 6, pts = [[0, 80], [0, 0], [80 * Math.sin(a), -80 * Math.cos(a)]];
  const route = { pts, s: [0, 80, 160], length: 160, halves: [12, 3], classes: ["primary", "residential"], parks: [null, null], lanes: [4, 2] };
  const legs = planTurn(route, 1, 10, 1.6, 4.5, 1.9);
  assert.ok(legs >= (10 - 1.6) * TURN_PLAN.shift_per_m - 1e-6, `legs ${legs}`);
});

test("a route's jog -- past a node and back a metre -- is not driven as a turn on the spot", () => {
  // A street whose line runs a metre and a half past where it turns and comes back (a spike in
  // the map's line: a node a step off the corner), then goes on east.
  const ways = [
    { kind: "street", pts: [[0, 60], [0, -1.5], [0.3, -0.2], [40, -0.2]], lanes: 2, oneway: 0, id: "a", road_m: 8 },
  ];
  const S = new Streets(ways);
  const route = S.route(S.nearest(0, 60, "drive"), S.nearest(40, -0.2, "drive"), "drive");
  assert.ok(route, "a route");
  const p = route.pts;
  for (let v = 1; v < p.length - 1; v += 1) {
    const ax = p[v][0] - p[v - 1][0], az = p[v][1] - p[v - 1][1], bx = p[v + 1][0] - p[v][0], bz = p[v + 1][1] - p[v][1];
    const ang = Math.abs(Math.atan2(ax * bz - az * bx, ax * bx + az * bz));
    assert.ok(ang < 2.6, `doubles back at ${p[v]} (${(ang * 57.3).toFixed(0)} deg)`);
  }
  // Every per-edge list still one entry per edge.
  for (const k of ["halves", "classes", "parks", "lanes"]) assert.equal(route[k].length, p.length - 1, k);
});
