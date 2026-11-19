// A gutter is one straight strip along a block (docs/waterworks-renderer.mjs): on the kerb's
// real line, its small breaks closed, its scraps left out.
import assert from "node:assert/strict";
import test from "node:test";
import { gutterRuns, kerbBlocks, kerbOffset } from "../docs/waterworks-renderer.mjs";

test("pieces of one street that go straight on are one block; a corner or a change of width begins another", () => {
  const segs = [[0, 0, 40, 0, 5], [40, 0, 80, 0.5, 5], [80, 0.5, 120, 0.5, 5], [120, 0.5, 120, 60, 5], [300, 0, 340, 0, 5], [340, 0, 380, 0, 8]];
  const blocks = kerbBlocks(segs);
  assert.deepEqual(blocks.map((b) => b.length), [3, 1, 1, 1]);
});

test("the kerb is found where the roadway stops, to a tenth of a metre, and not at a junction's mouth", () => {
  for (const edge of [3.4, 5.0, 6.35, 7.2]) assert.ok(Math.abs(kerbOffset((o) => o < edge, 5) - edge) <= 0.1, `kerb at ${edge}`);
  assert.equal(kerbOffset(() => true, 5), null, "roadway all the way out: a junction");
  assert.equal(kerbOffset(() => false, 5), null, "no roadway");
});

test("a driveway's break is closed, a junction's is not, and a scrap is not a gutter", () => {
  const run = (s) => gutterRuns([...s].map((c) => c === "#")).map((k) => (k ? "#" : ".")).join("");
  assert.equal(run("########...#####.######"), "#######################");
  assert.equal(run("######..............######"), "######..............######", "fourteen metres open: a street's mouth");
  assert.equal(run("...##...........#######"), "................#######", "two metres of pan on its own");
  assert.equal(run("....######"), "....######", "nothing is added before the first kerb or after the last");
});

test("along a kerb that wobbles the pan is laid on one line: what was thirty pieces is one", () => {
  // The drawn kerb stands 5.0 to 5.6 m out, in and out every few metres; the nominal half is 5.
  const edgeAt = (t) => 5.3 + 0.3 * Math.sin(t * 1.7);
  const found = [];
  for (let t = 1.5; t < 100; t += 3) found.push(kerbOffset((o) => o < edgeAt(t), 5));
  found.sort((a, b) => a - b);
  const out = found[Math.floor(found.length / 2)];
  assert.ok(Math.abs(out - 5.3) < 0.2, `the middle of them: ${out}`);
  // As it was: kept only where the roadway stopped within 0.35 m of the nominal line.
  const before = [], after = [];
  for (let t = 0; t <= 100; t += 1) { before.push(!(5.35 < edgeAt(t))); after.push(!(out + 0.45 < edgeAt(t)) && out - 0.6 < edgeAt(t)); }
  const pieces = (flags) => flags.reduce((n, k, i) => n + (k && !flags[i - 1] ? 1 : 0), 0);
  assert.ok(pieces(before) > 10, `${pieces(before)} pieces before`);
  assert.equal(pieces(gutterRuns(after)), 1);
});
