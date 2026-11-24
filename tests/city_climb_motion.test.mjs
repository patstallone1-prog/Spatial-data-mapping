// A climb played out over time: smooth, in turn, over the top and down the far side.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createMechanics } from "../docs/city/mechanics.mjs";
import { createClimbing } from "../docs/city/climbing.mjs";
import { createClimbMotion } from "../docs/city/climb-motion.mjs";

const M = createMechanics(JSON.parse(readFileSync(new URL("../docs/object-catalogue.json", import.meta.url))));
const C = createClimbing(M);
const climber = { kg: 75, strength: 30, hands: "skin", feet: "shoe_rubber" };

//: Run ``motion`` at 60 frames a second going ``dir`` until an event of ``kind`` (or ``seconds``),
//: checking every frame is a small step from the last.
function runUntil(motion, dir, kind, seconds = 40) {
  let prev = motion.frame(), seen = [];
  const dt = 1 / 60;
  for (let i = 0; i < seconds * 60; i += 1) {
    const ev = motion.step(dt, dir);
    seen.push(...ev);
    const f = motion.frame();
    const jump = (a, b) => (a && b ? Math.hypot(a.u - b.u, a.v - b.v, a.out - b.out) : 0);
    assert.ok(jump(f.hip, prev.hip) < 0.12, `hips jumped ${jump(f.hip, prev.hip)} at ${i}`);
    for (const k of ["lh", "rh", "lf", "rf"]) if (!(motion.phase === "top" || prev.phase === "top")) assert.ok(jump(f.limbs[k], prev.limbs[k]) < 0.25, `${k} jumped at frame ${i}`);
    prev = { hip: { ...f.hip }, limbs: Object.fromEntries(Object.entries(f.limbs).map(([k, v]) => [k, v && { ...v }])), phase: f.phase };
    if (ev.some((e) => e.kind === kind)) return { seen, frames: i };
  }
  return { seen, frames: Infinity };
}

test("up a chain-link fence, over the top, and down its far side to the ground", () => {
  const m = createClimbMotion({ face: { kind: "chainlink", height_m: 2.4, key: "yard" }, C, climber });
  const up = runUntil(m, { u: 0, v: 1 }, "over");
  assert.ok(up.frames < Infinity, `never got over: ${JSON.stringify(up.seen.slice(-3))}`);
  assert.ok(up.seen.filter((e) => e.kind === "moved").length >= 2);
  m.crossTo({ kind: "chainlink", height_m: 2.4 }, 0);
  const down = runUntil(m, { u: 0, v: -1 }, "off");
  assert.ok(down.frames < Infinity, `never got down: ${m.last.reason}`);
});

test("up a wall and onto its top, standing", () => {
  const m = createClimbMotion({ face: { kind: "wall", height_m: 2.2, thickness_m: 0.35, key: "garden" }, C, climber });
  const r = runUntil(m, { u: 0, v: 1 }, "stood");
  assert.ok(r.frames < Infinity, m.last.reason);
  assert.equal(m.phase, "standing");
  const f = m.frame();
  assert.ok(f.hip.v > 2.2 + 0.5 && f.limbs.lh === null, "stood up, hands free");
});

test("a move takes about half a second, and nothing moves with no arrow held", () => {
  const m = createClimbMotion({ face: { kind: "rock", height_m: 4, key: "crag" }, C, climber });
  const before = JSON.stringify(m.frame());
  for (let i = 0; i < 60; i += 1) m.step(1 / 60, { u: 0, v: 0 });
  assert.equal(JSON.stringify(m.frame()), before);
  const r = runUntil(m, { u: 0, v: 1 }, "moved", 3);
  assert.ok(r.frames > 0.3 * 60 && r.frames < 0.8 * 60, `${r.frames} frames`);
});

test("a stuck climber is told why", () => {
  const m = createClimbMotion({ face: { kind: "smooth", height_m: 3.5, substance: "stucco" }, C, climber });
  const r = runUntil(m, { u: 0, v: 1 }, "stuck", 10);
  assert.ok(r.frames < Infinity, "never stuck");
  assert.ok(r.seen.some((e) => e.kind === "stuck" && e.reason));
  assert.ok(!r.seen.some((e) => e.kind === "top" || e.kind === "stood" || e.kind === "over"));
});

test("a tree is climbed to its fork and sat in", () => {
  const m = createClimbMotion({ face: { kind: "tree", height_m: 3, thickness_m: 0.4, u0: -0.25, u1: 0.25, key: "elm" }, C, climber });
  const r = runUntil(m, { u: 0, v: 1 }, "sat");
  assert.ok(r.frames < Infinity, m.last.reason);
});
