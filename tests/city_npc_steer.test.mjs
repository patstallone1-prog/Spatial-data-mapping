// Finding the way (docs/city/npc-steer.mjs): round the aisles of a planned shop, apart from one
// another, in line at a till, round someone standing in the way, a task's steps given up or
// swapped when they cannot be reached.
import assert from "node:assert/strict";
import { test } from "node:test";

import { NavGrid, Queue, STEER, doorHolds, runTask, steer, storeNav, swerveAhead, task } from "../docs/city/npc-steer.mjs";
import { planStore, canWalkStore } from "../docs/city/store-room.mjs";

const wall = new NavGrid({ x0: 0, x1: 10, z0: 0, z1: 6, cell: 0.25, free: (x, z) => !(x > 4.5 && x < 5.5 && z < 5) });

test("the way round a wall: no point of it through the wall", () => {
  const path = wall.path(1, 1, 9, 1);
  assert.ok(path && path.length >= 2);
  let prev = { x: 1, z: 1 };
  for (const p of path) { assert.ok(wall.clear(prev.x, prev.z, p.x, p.z, false), `clear from ${JSON.stringify(prev)} to ${JSON.stringify(p)}`); prev = p; }
  assert.ok(path.some((p) => p.z >= 5), "round the end of the wall");
});

test("a supermarket's floor: a way from the door to the back past the shelves", () => {
  const plan = planStore({ width: 22, depth: 20, doorX: 0, name: "Safeway" }, "supermarket");
  const grid = storeNav(plan, canWalkStore);
  const lane = plan.fixtures.find((f) => f.role === "checkout"), shelf = plan.shelves.find((s) => s.section !== "checkout");
  const front = { x: shelf.x - Math.sin(shelf.yaw) * (shelf.deep / 2 + 0.5), z: shelf.z - Math.cos(shelf.yaw) * (shelf.deep / 2 + 0.5) };
  const way = grid.path(plan.doorX, 0.6, front.x, front.z);
  assert.ok(way, "a way to a shelf");
  let at = { x: plan.doorX, z: 0.6 };
  for (const p of way) { assert.ok(grid.clear(at.x, at.z, p.x, p.z, false)); at = p; }
  assert.ok(lane);
});

test("people keep apart and go round whoever stands in the corridor", () => {
  const open = new NavGrid({ x0: -5, x1: 5, z0: -2, z1: 2, cell: 0.25, free: () => true });
  const a = { id: "a", x: -3, z: 0, path: [{ x: 3, z: 0 }], goal: { x: 3, z: 0 } }, b = { id: "b", x: 0, z: 0, path: [] };
  let minD = Infinity;
  for (let k = 0; k < 400 && a.path?.length; k += 1) { steer([a, b], 1 / 30, open); minD = Math.min(minD, Math.hypot(a.x - b.x, a.z - b.z)); }
  assert.ok(Math.hypot(a.x - 3, a.z) < 0.4, `got there (${a.x.toFixed(2)}, ${a.z.toFixed(2)})`);
  assert.ok(minD > STEER.radius * 1.4, `never walked into them (${minD.toFixed(2)} m)`);
});

test("swerving early on the street, to the side with room", () => {
  const still = [{ x: 0, z: -2.5, moving: false }];
  const s = swerveAhead(0, 0, 0, still, { look: 3.2 });
  assert.notEqual(s, 0);
  const blocked = swerveAhead(0, 0, 0, still, { look: 3.2, free: (x) => x <= 0 });
  assert.ok(blocked <= 0, "not toward the wall");
  assert.equal(swerveAhead(0, 0, 0, [{ x: 0, z: -2.5, moving: true }]), 0);
});

test("a line at a till: a pace apart, served in turn; at a door, one at a time", () => {
  const q = new Queue({ x: 0, z: 0 }, { x: 0, z: -1 });
  ["a", "b", "c"].forEach((id) => q.join(id));
  assert.deepEqual(q.spot(2), { x: 0, z: -2 * STEER.queue_gap_m });
  q.leave("a");
  assert.equal(q.place("b"), 0);
  const holds = doorHolds([{ id: "x", x: 0, z: 0, yaw: 0, through: true }, { id: "y", x: 0, z: -0.7, yaw: 0, through: true }]);
  assert.ok(holds.has("x") && !holds.has("y"), "the one behind waits");
});

test("a task: a step that cannot be reached is swapped for another, then the rest go on", () => {
  // A shut room round (8, 3): free inside, but no way in.
  const shut = new NavGrid({ x0: 0, x1: 10, z0: 0, z1: 6, cell: 0.25, free: (x, z) => { const d = Math.hypot(x - 8, z - 3); return d < 0.6 || d > 1.1; } });
  const a = { id: "a", x: 1, z: 1 }, seen = [];
  const t = task([{ x: 8, z: 3, dwell: 0.1 }, { x: 2, z: 5.5, dwell: 0.2 }], (st) => (st.x === 8 ? { x: 6, z: 1, dwell: 0.1 } : null));
  for (let k = 0; k < 3000 && !t.done; k += 1) { const st = runTask(a, t, 1 / 30, shut); if (st) seen.push(st.x); steer([a], 1 / 30, shut); }
  assert.equal(t.done, true);
  assert.ok(t.log.some((l) => l.why === "no way there"), "the unreachable shelf was noticed");
  assert.ok(seen.includes(6), "the other shelf tried in its place");
  assert.ok(Math.hypot(a.x - 2, a.z - 5.5) < 0.6);
});
