// The close lock (docs/city/close-lock.mjs): inside the full ring nothing appears, vanishes or is
// put ahead to where its day says -- and the ground ahead of each one is looked along so no foot
// is set into a kerb or a slope.
import test from "node:test";
import assert from "node:assert/strict";
import { CLOSE, byWall, closeLock, feetTracker, groundAhead, GROUND_AHEAD } from "../docs/city/close-lock.mjs";

const inClose = (x, z, share = 1) => Math.hypot(x, z) < CLOSE.ring.people * share;
const person = (id, x, z, extra = {}) => ({ id, x, z, yaw: 0, moving: true, speed: 1.3, person: { pace: 1.3 }, ...extra });
const run = (lock, frames, dt = 1 / 60, t0 = 0) => {
  let out = [], now = t0;
  for (const list of frames) { now += dt * 1000; lock.frame({ x: 0, z: 0 }, now); out = lock.step(list(now), dt, now); }
  return { out, now };
};

test("one put down inside the close ring is not drawn there, but is once it has come in from outside", () => {
  const lock = closeLock("people", { inClose });
  lock.frame({ x: 0, z: 0 }, 0); lock.step([], 1 / 60, 0);   // the scene round you, taken as it is
  // Then someone is put down 20 m from you, in the open: withheld.
  let now = 16;
  lock.frame({ x: 0, z: 0 }, now);
  assert.deepEqual(lock.step([person("a", 20, 0)], 1 / 60, now), []);
  assert.equal(lock.stats.withheld, 1);
  // Their day takes them out past the ring: drawn there, and they walk in from it.
  now += 16; lock.frame({ x: 0, z: 0 }, now);
  assert.equal(lock.step([person("a", 100, 0)], 1 / 60, now).length, 1);
  now += 16; lock.frame({ x: 0, z: 0 }, now);
  assert.equal(lock.step([person("a", 80, 0)], 1 / 60, now).length, 1);
});

test("one may come out of a door, or a car beside them, inside the ring", () => {
  const lock = closeLock("people", { inClose, portal: (x, z, e) => Boolean(e.through) });
  lock.frame({ x: 0, z: 0 }, 0); lock.step([], 1 / 60, 0);
  lock.frame({ x: 0, z: 0 }, 16);
  assert.equal(lock.step([person("b", 10, 0, { through: true })], 1 / 60, 16).length, 1);
});

test("the scene round you when it is built (or after a jump) is taken as it is", () => {
  const lock = closeLock("people", { inClose });
  lock.frame({ x: 0, z: 0 }, 0);
  assert.equal(lock.step([person("c", 5, 0), person("d", 30, 0)], 1 / 60, 0).length, 2);
  // A jump across the map is a cut too.
  lock.frame({ x: 500, z: 0 }, 16);
  assert.equal(lock.step([person("e", 505, 0)], 1 / 60, 16).length, 1);
});

test("close by, one behind their day walks on at their own pace, never put ahead", () => {
  const lock = closeLock("people", { inClose });
  lock.frame({ x: 0, z: 0 }, 0); lock.step([person("f", 10, 0)], 1 / 60, 0);
  // Their day jumps them 30 m on (held at a kerb, then their time made up): drawn walking there.
  const { out } = run(lock, Array.from({ length: 60 }, () => () => [person("f", 40, 0)]));
  const f = out[0];
  assert.ok(f.x > 10 && f.x < 10 + 1.35 * CLOSE.catch_up + 0.15, `walked ${f.x - 10} m in a second`);
  assert.ok(f.lagM > 25, "still behind their day");
  assert.ok(Math.abs(f.yaw - Math.atan2(-30, 0)) < 1e-6, "facing the way they walk");
  // Out past the ring, their day has them again.
  const far = closeLock("people", { inClose });
  far.frame({ x: 0, z: 0 }, 0); far.step([person("g", 120, 0)], 1 / 60, 0);
  far.frame({ x: 0, z: 0 }, 16);
  assert.equal(far.step([person("g", 160, 0)], 1 / 60, 16)[0].x, 160);
});

test("close by, one whose day takes them indoors walks to the door and is gone only there", () => {
  const door = { x: 14, z: 0 };
  const lock = closeLock("people", { inClose, portal: (x, z) => Math.hypot(x - door.x, z - door.z) < 0.5 });
  lock.frame({ x: 0, z: 0 }, 0); lock.step([person("h", 10, 0)], 1 / 60, 0);
  // Last seen on their way to the door, then off the list (indoors by their day).
  lock.frame({ x: 0, z: 0 }, 16); lock.step([person("h", 10.02, 0)], 1 / 60, 16);
  lock.frame({ x: 0, z: 0 }, 32);
  assert.equal(lock.step([person("h", 14, 0)], 1 / 60, 32)[0].x < 10.2, true);
  let now = 32, out;
  for (let i = 0; i < 60; i += 1) { now += 16; lock.frame({ x: 0, z: 0 }, now); out = lock.step([], 1 / 60, now); }
  assert.equal(out.length, 1, "still walking to the door");
  assert.ok(out[0].ghost && out[0].moving && out[0].x > 10.5 && out[0].x < 14);
  for (let i = 0; i < 400 && out.length; i += 1) { now += 16; lock.frame({ x: 0, z: 0 }, now); out = lock.step([], 1 / 60, now); }
  assert.equal(out.length, 0, "in at the door");
  // One gone off the list in the open (not at a door): stays until out past the ring.
  const open = closeLock("people", { inClose });
  open.frame({ x: 0, z: 0 }, 0); open.step([person("i", 20, 0)], 1 / 60, 0);
  let o2;
  for (let i = 0, t = 0; i < 100; i += 1) { t += 16; open.frame({ x: 0, z: 0 }, t); o2 = open.step([], 1 / 60, t); }
  assert.equal(o2.length, 1);
  assert.equal(o2[0].moving, false);
});

test("one held back and walking into a wall goes in there, rather than standing at it", () => {
  const wall = (x) => x > 12;   // a wall at x = 12 between them and where their day has them
  const lock = closeLock("people", { inClose, portal: (x) => x > 11 });
  lock.frame({ x: 0, z: 0 }, 0); lock.step([person("k", 11.5, 0)], 1 / 60, 0);
  let now = 0, out = [];
  for (let i = 0; i < 200; i += 1) {
    now += 16; lock.frame({ x: 0, z: 0 }, now);
    out = lock.step([person("k", 40, 0)], 1 / 60, now);
    // (the view keeps them out of the wall, as keepOutside does)
    const r = lock.records.get("k");
    if (r?.drawn && wall(r.x)) { r.x = 12; if (out[0]) out[0].x = 12; }
  }
  assert.equal(out.length, 0, "gone in at the wall");
  assert.equal(lock.stats.wentIn, 1);
});

test("one whose day has gone on to another walk finishes its own way first, round the corner", () => {
  // An L-shaped way: 10 m along x, then 10 m up -z (the corner at (10, 0)).
  const pave = { length: 20 };
  const along = (w, d) => (d <= 10 ? { x: d, z: 0 } : { x: 10, z: -(d - 10) });
  const lock = closeLock("people", { inClose, along });
  const walker = (x, z, key, d) => person("m", x, z, { walk: { key, pave, d, pace: 1.3, dir: 1 } });
  lock.frame({ x: 0, z: 0 }, 0); lock.step([walker(2, 0, "w1", 2)], 1 / 60, 0);
  // Its day is now on another walk, 60 m off: it walks its own way, round the corner.
  let now = 0, out, wentRound = false;
  for (let i = 0; i < 1400; i += 1) {
    now += 16; lock.frame({ x: 0, z: 0 }, now);
    out = lock.step([walker(-40, -40, "w2", 0)], 1 / 60, now);
    const e = out[0];
    if (!e.ownWay) break;   // its own way walked: from here, on to its day
    assert.ok(!(e.x < 9.9 && e.z < -0.1), `cut the corner at ${e.x}, ${e.z}`);
    if (e.z < -5) wentRound = true;
  }
  assert.ok(wentRound, "went on up its own way");
  const r = lock.records.get("m");
  assert.ok(Math.hypot(r.x - 10, r.z + 10) < 1.5, `from its way's end: ${r.x}, ${r.z}`);
});

test("one well behind on its walk follows the walk to where its day is, and owes nothing once out past the ring", () => {
  const pave = { length: 20 };
  const along = (w, d) => (d <= 10 ? { x: d, z: 0 } : { x: 10, z: -(d - 10) });
  const released = [];
  const lock = closeLock("people", { inClose, along, release: (e) => released.push(e.id) });
  const at = (d) => ({ ...along(null, d), walk: { key: "w", pave, d, pace: 1.3, dir: 1 } });
  lock.frame({ x: 0, z: 0 }, 0); lock.step([person("n", 2, 0, at(2))], 1 / 60, 0);
  // Its day is suddenly at 18 m along the same walk (round the corner): it walks the way there.
  let now = 0;
  for (let i = 0; i < 900; i += 1) {
    now += 16; lock.frame({ x: 0, z: 0 }, now);
    const e = lock.step([person("n", 10, -8, at(18))], 1 / 60, now)[0];
    assert.ok(!(e.x < 9.9 && e.z < -0.1), `cut the corner at ${e.x}, ${e.z}`);
  }
  const r = lock.records.get("n");
  assert.ok(Math.hypot(r.x - 10, r.z + 8) < 0.1, `got there: ${r.x}, ${r.z}`);
  // Out past the ring: let go.
  now += 16; lock.frame({ x: 0, z: 0 }, now); lock.step([person("n", 10, -8, at(18))], 1 / 60, now);
  const far = { ...person("n", 200, 0), walk: { key: "w", pave, d: 0, pace: 1.3, dir: 1 } };
  lock.records.get("n").x = 120;
  now += 16; lock.frame({ x: 0, z: 0 }, now); lock.step([far], 1 / 60, now);
  assert.deepEqual(released, ["n"]);
});

test("one drawn out past the ring whose day puts it by you walks in -- it is not set down there", () => {
  const lock = closeLock("people", { inClose, portal: () => true });
  lock.frame({ x: 0, z: 0 }, 0); lock.step([person("p", 95, 0)], 1 / 60, 0);
  lock.frame({ x: 0, z: 0 }, 16);
  const e = lock.step([person("p", 3, 0, { indoors: "shop" })], 1 / 60, 16)[0];
  assert.ok(e.x > 94, `set down at ${e.x}`);
});

test("whatever moved them after the lock, nobody close by is drawn further on than they could go", () => {
  const lock = closeLock("people", { inClose });
  lock.frame({ x: 0, z: 0 }, 0); lock.step([], 1 / 60, 0); lock.settle([person("q", 10, 0)], 0);
  lock.frame({ x: 0, z: 0 }, 16); lock.step([], 1 / 60, 16);
  const e = person("q", 60, 0);   // put 50 m on by something else this frame
  lock.settle([e], 16);
  assert.ok(e.x < 11, `drawn at ${e.x}`);
  assert.equal(lock.stats.jumpsStopped, 1);
  // A jump of yours across the map is a cut: taken as it is.
  lock.frame({ x: 500, z: 0 }, 32); lock.step([], 1 / 60, 32);
  const f = person("q", 505, 0);
  lock.settle([f], 32);
  assert.equal(f.x, 505);
});

test("thrown or falling ones are followed as their own physics moves them", () => {
  const lock = closeLock("people", { inClose, free: (e) => Boolean(e.fall) });
  lock.frame({ x: 0, z: 0 }, 0); lock.step([person("j", 10, 0)], 1 / 60, 0);
  lock.frame({ x: 0, z: 0 }, 16);
  assert.equal(lock.step([person("j", 12, 0, { fall: 0.3 })], 1 / 60, 16)[0].x, 12);
});

test("a car close by is never put where the traffic has it, and a parked one gone stays parked", () => {
  const lock = closeLock("cars", { inClose: (x, z, s = 1) => Math.hypot(x, z) < CLOSE.ring.cars * s });
  lock.frame({ x: 0, z: 0 }, 0); lock.step([{ id: "car", x: 30, z: 0, speed: 0, moving: false }], 1 / 60, 0);
  lock.frame({ x: 0, z: 0 }, 16);
  const moved = lock.step([{ id: "car", x: 70, z: 0, speed: 0, moving: false }], 1 / 60, 16)[0];
  assert.ok(moved.x < 31, "a standing car does not jump 40 m");
  let out;
  for (let i = 0, t = 16; i < 30; i += 1) { t += 16; lock.frame({ x: 0, z: 0 }, t); out = lock.step([], 1 / 60, t); }
  assert.equal(out.length, 1);
});

test("a wall within reach is a door to come out of", () => {
  const wall = (x, z) => (x > 5 && x < 15 && z > 0 && z < 10 ? { id: "shop" } : null);
  assert.ok(byWall(wall, 4, 5, 1.6));
  assert.ok(!byWall(wall, 0, 5, 1.6));
  assert.ok(!byWall(null, 4, 5, 1.6));
});

// ---- the ground ahead ----------------------------------------------------------------------------
const kerb = (x, z) => (z < -2 ? 0.15 : 0);   // a 15 cm kerb two metres ahead (facing -z)
const flat = () => 1.234;
const slope = (x, z) => -z * 0.05;            // 5% up the way they face

test("ten feet of the way ahead is looked along, and a few millimetres of change marks it rough", () => {
  assert.ok(Math.abs(GROUND_AHEAD.ahead_m - 3.048) < 1e-9, "ten feet");
  assert.ok(GROUND_AHEAD.rough_m <= 0.005, "a few millimetres");
  assert.deepEqual(groundAhead(flat, 0, 0, 0), [false, 0]);
  const [rough, rise] = groundAhead(kerb, 0, 0, 0);
  assert.ok(rough && Math.abs(rise - 0.15) < 1e-9);
  // The kerb behind them is not ahead of them.
  assert.equal(groundAhead(kerb, 0, 0, Math.PI)[0], false);
  assert.ok(groundAhead(slope, 0, 0, 0)[0]);
});

test("where the way ahead is rough the ground is read every few millimetres, so no foot sinks", () => {
  const reads = [];
  const ground = (x, z) => { reads.push([x, z]); return kerb(x, z); };
  const feet = feetTracker(ground);
  // Walking at 1.4 m/s toward the kerb, 60 frames a second: the foot is never below the ground.
  let worst = 0;
  for (let i = 0; i < 180; i += 1) {
    const p = { id: "w", x: 0, z: -i * (1.4 / 60), yaw: 0 };
    const y = feet.at(p, i * 16.7, true);
    worst = Math.max(worst, kerb(p.x, p.z) - y);
  }
  assert.equal(worst, 0, "never set into the kerb");
  assert.ok(feet.stats.fine > 0, "read finely near the kerb");
  // On flat ground far fewer reads are made.
  const flatReads = [];
  const f2 = feetTracker((x, z) => { flatReads.push(1); return 0; });
  for (let i = 0; i < 180; i += 1) f2.at({ id: "v", x: 0, z: -i * (1.4 / 60), yaw: 0 }, i * 16.7, true);
  assert.ok(f2.stats.reads < 50, `flat: ${f2.stats.reads} reads`);
  // Out of the close ring nobody is looked ahead for.
  const f3 = feetTracker(() => 0);
  f3.at({ id: "u", x: 0, z: 0, yaw: 0 }, 0, false);
  assert.equal(f3.stats.looks, 0);
});
