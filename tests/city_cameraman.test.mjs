// The cameraman (docs/city/cameraman.mjs, docs/70): it sees past what is in the way by drifting,
// cuts the way the user asked (swoops and fades on foot, hard cuts in the car and for a fight right
// round, gentle inside), bends a held view round blockers without turning it, and draws the outline
// only when nothing clears the view.
import test from "node:test";
import assert from "node:assert/strict";
import { createCameraman, createOccluders, segmentBox, segmentBall, shotPose, namedShot, CAMERAMAN } from "../docs/city/cameraman.mjs";

const you = { x: 0, y: 0, z: 0 };
const points = [
  { x: 0, y: 1.65, z: 0, w: 3 }, { x: 0, y: 1.25, z: 0, w: 2 },
  { x: 0.3, y: 1.0, z: 0, w: 2 }, { x: -0.3, y: 1.0, z: 0, w: 2 }, { x: 0, y: 0.15, z: 0, w: 1 },
];
const base = { yaw: 0, pitch: 0.36, dist: 7 };
const aim = { x: 0, y: 1.2, z: 0 };

function run(cm, occ, frames, extra = {}, t0 = 0) {
  let out = null, now = t0;
  for (let i = 0; i < frames; i += 1) {
    now += 1000 / 60;
    const more = typeof extra === "function" ? extra(i, now) : extra;
    out = cm.step({ now, dt: 1 / 60, base, aim, you, points, occlusion: (a, b) => occ.occlusion(a, b), ...more });
  }
  return { out, now };
}
const seen = (occ, shot) => {
  const { at } = shotPose(base, aim, shot);
  return points.reduce((s, p) => s + p.w * (1 - occ.occlusion(at, p)), 0) / points.reduce((s, p) => s + p.w, 0);
};

test("segment tests: a turned box and a ball", () => {
  const box = { cx: 0, cz: 3, hx: 1, hz: 0.2, y0: 0, y1: 3, yaw: 0 };
  assert.ok(segmentBox({ x: 0, y: 1, z: 6 }, { x: 0, y: 1, z: 0 }, box) > 0);
  assert.equal(segmentBox({ x: 2, y: 1, z: 6 }, { x: 2, y: 1, z: 0 }, box), -1);
  // Turned a quarter, the box is long along x... now along z: a line at x = 0.5 misses it.
  assert.equal(segmentBox({ x: 0.5, y: 1, z: 6 }, { x: 0.5, y: 1, z: 0 }, { ...box, yaw: Math.PI / 2 }), -1);
  assert.ok(segmentBall({ x: 0, y: 1, z: 6 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 3, r: 1 }) > 0.99);
  assert.equal(segmentBall({ x: 3, y: 1, z: 6 }, { x: 3, y: 1, z: 0 }, { x: 0, y: 1, z: 3, r: 1 }), 0);
});

test("in the open it stays on the view asked for", () => {
  const occ = createOccluders(); occ.set([]);
  const cm = createCameraman();
  const { out } = run(cm, occ, 120);
  assert.equal(out.ghost, false);
  for (const k of ["dYaw", "dPitch", "shoulder", "lift"]) assert.ok(Math.abs(out.shot[k]) < 1e-6, k);
  assert.ok(Math.abs(out.shot.distK - 1) < 1e-6);
});

test("a van between you and the camera: it drifts to see you, no cut, no outline", () => {
  const occ = createOccluders();
  occ.set([{ kind: "box", cx: 0, cz: 3.5, hx: 1, hz: 1.2, y0: 0, y1: 2.8, yaw: 0, opacity: 1 }]);
  assert.ok(seen(occ, { dYaw: 0, dPitch: 0, distK: 1, shoulder: 0, lift: 0, focusMix: 0 }) < 0.2);
  const cm = createCameraman();
  const { out } = run(cm, occ, 90);
  assert.ok(seen(occ, out.shot) > 0.9, `seen ${seen(occ, out.shot)}`);
  assert.equal(cm.stats.cuts, 0);
  assert.equal(out.ghost, false);
});

test("a tree crown is see-through: no outline for one", () => {
  const occ = createOccluders();
  occ.set([{ kind: "ball", x: 0, y: 2.2, z: 3, r: 2.5, opacity: 0.45 }]);
  const cm = createCameraman();
  const { out } = run(cm, occ, 120);
  assert.equal(out.ghost, false);
});

test("walled in on every side the outline shows, after a moment", () => {
  const occ = createOccluders();
  // A box round you, just outside arm's reach and taller than any shot.
  const ring = [];
  for (let k = 0; k < 16; k += 1) { const a = (k / 16) * Math.PI * 2; ring.push({ kind: "box", cx: Math.sin(a) * 1.2, cz: Math.cos(a) * 1.2, hx: 0.5, hz: 0.12, yaw: a, y0: 0, y1: 40, opacity: 1 }); }
  occ.set(ring);
  const cm = createCameraman();
  const early = run(cm, occ, 8).out;
  assert.equal(early.ghost, false, "not at once");
  const { out } = run(cm, occ, 60, {}, 200);
  assert.equal(out.ghost, true);
});

test("a held view keeps your direction and bends round the blocker instead", () => {
  const occ = createOccluders();
  occ.set([{ kind: "box", cx: 0, cz: 3.5, hx: 1, hz: 1.2, y0: 0, y1: 2.8, yaw: 0, opacity: 1 }]);
  const cm = createCameraman();
  const { out } = run(cm, occ, 60, { held: true, dragDir: 0 });
  assert.equal(out.shot.dYaw, 0);
  assert.ok(seen(occ, out.shot) >= 0.85, `seen ${seen(occ, out.shot)}`);
  // Dragged one way it may lead that way a little, never the other.
  const cm2 = createCameraman();
  const r2 = run(cm2, occ, 60, { held: true, dragDir: 1 }).out;
  assert.ok(r2.shot.dYaw >= 0);
});

function hiddenBehind() {
  // A long wall behind you (on the camera's side), and open in front.
  return [{ kind: "box", cx: 0, cz: 1.0, hx: 30, hz: 0.2, y0: 0, y1: 40, yaw: 0, opacity: 1 }];
}
function onlyInFront() {
  // In a lane open only ahead: the wall behind, and walls close either side from you back.
  return [...hiddenBehind(),
    { kind: "box", cx: 1.0, cz: 15, hx: 0.1, hz: 15.5, y0: 0, y1: 40, yaw: 0, opacity: 1 },
    { kind: "box", cx: -1.0, cz: 15, hx: 0.1, hz: 15.5, y0: 0, y1: 40, yaw: 0, opacity: 1 }];
}

test("on foot the smallest clear change is swooped to", () => {
  const occ = createOccluders(); occ.set(hiddenBehind());
  const cm = createCameraman();
  run(cm, occ, 120);
  assert.equal(cm.stats.swoops, 1);
  assert.ok(Math.abs(Math.abs(cm.current.dYaw) - Math.PI / 2) < 0.6, `turned ${cm.current.dYaw}`);
});

test("on foot a cut right round is a fade out and in, and is held", () => {
  const occ = createOccluders(); occ.set(onlyInFront());
  const cm = createCameraman();
  let cut = null;
  const { out, now } = run(cm, occ, 120, () => ({}), 0);
  void out;
  for (const k of ["fades", "swoops", "hard"]) cut ||= cm.stats[k] ? k : null;
  assert.equal(cut, "fades");
  const after = cm.current;
  assert.ok(Math.abs(Math.abs(after.dYaw) - Math.PI) < 1.1, `turned ${after.dYaw}`);
  // A second cut waits for the hold.
  const cuts = cm.stats.cuts;
  run(cm, occ, 30, {}, now);
  assert.equal(cm.stats.cuts, cuts);
});

test("at the wheel the same change is a hard cut", () => {
  const occ = createOccluders(); occ.set(onlyInFront());
  const cm = createCameraman();
  run(cm, occ, 60, { mode: "drive", speed: 10, travel: { x: 0, z: -1 } });
  assert.ok(cm.stats.hard >= 1);
  assert.equal(cm.stats.fades, 0);
});

test("inside it only swoops, gently, and keeps near the view asked for", () => {
  const occ = createOccluders(); occ.set(onlyInFront());
  const cm = createCameraman();
  run(cm, occ, 240, { mode: "inside" });
  assert.equal(cm.stats.fades + cm.stats.hard, 0);
  assert.ok(Math.abs(cm.current.dYaw) <= CAMERAMAN.reach.inside + 1e-6);
});

test("a fight right round cuts hard to a closer side view; talking swoops over the shoulder", () => {
  const occ = createOccluders(); occ.set([]);
  const cm = createCameraman();
  // The one you fight is behind the camera: the side view is a quarter turn round.
  run(cm, occ, 30, { activity: "fight", focus: { x: 0, y: 1.3, z: 1.2 } });
  const shot = cm.current;
  assert.ok(shot.distK < 0.8);
  const cm2 = createCameraman();
  run(cm2, occ, 90, { activity: "talk", focus: { x: 0, y: 1.5, z: -1.2 } });
  assert.ok(cm2.stats.swoops >= 1);
  assert.ok(cm2.current.distK < 0.6 && Math.abs(cm2.current.shoulder) > 0.3);
});

test("stopped at a light the car view cuts to the side, and back when moving", () => {
  const occ = createOccluders(); occ.set([]);
  const cm = createCameraman();
  const { now } = run(cm, occ, 60 * 5, { mode: "drive", speed: 0 });
  assert.ok(Math.abs(cm.current.dYaw) > 1);
  run(cm, occ, 60 * 3, { mode: "drive", speed: 8 }, now);
  assert.ok(Math.abs(cm.current.dYaw) < 0.2);
});

test("a cut keeps screen direction: the camera stays on your side of the line you walk", () => {
  // Walking along +x (the camera starts behind-right of the line); a wall blocks behind.
  const occ = createOccluders(); occ.set(hiddenBehind());
  const cm = createCameraman();
  run(cm, occ, 120, { speed: 1.4, travel: { x: 1, z: 0 } });
  const across = (dYaw) => Math.sin(base.yaw + dYaw - Math.atan2(1, 0));
  const now = across(cm.current.dYaw);
  // On the side it started (behind-right), or on the line itself -- never across it.
  assert.ok(Math.abs(now) < 0.42 || Math.sign(now) === Math.sign(across(0)), `across ${now}`);
  // And behind you, not ahead looking back.
  const yaw = base.yaw + cm.current.dYaw;
  assert.ok(Math.sin(yaw) * 1 <= 0.3, `ahead ${Math.sin(yaw)}`);
});

test("a phone shot is close, over the shoulder, looking at the hand", () => {
  const s = namedShot("phone", { base, side: 1 });
  assert.ok(s.distK <= 0.25 && s.dPitch > 0.2 && s.focusMix === 1);
});

test("the cameraman's check is cheap", () => {
  const occ = createOccluders();
  const list = [];
  for (let i = 0; i < 300; i += 1) list.push({ kind: i % 3 ? "box" : "ball", cx: (i % 20) * 3 - 30, cz: Math.floor(i / 20) * 3 - 20, x: (i % 20) * 3 - 30, z: Math.floor(i / 20) * 3 - 20, y: 4, r: 2, hx: 0.2, hz: 0.2, y0: 0, y1: 6, yaw: 0, opacity: i % 3 ? 1 : 0.45 });
  occ.set(list);
  const cm = createCameraman();
  const t = performance.now();
  run(cm, occ, 60 * 4);
  const ms = (performance.now() - t) / cm.stats.checks;
  assert.ok(ms < 3, `${ms.toFixed(2)} ms a check`);
});
