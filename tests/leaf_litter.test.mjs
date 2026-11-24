// Fallen leaves as leaves (docs/leaf-litter.mjs): where they lie, what shifts them, what stops them.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { LEAF_FALL, LEAVES, gustAt, leafColour, leavesUnder, stepLeaf } from '../docs/leaf-litter.mjs';

const flat = { ground: () => 0, solid: () => false, feet: [], wind: [0, 0] };
const lying = (more = {}) => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, turn: 0, tilt: 0, spin: 0, h: 0, lift: 2, still: true, ...more });

test('leaves lie thick under the crown and thin beyond it, in heaps and singly, the same every visit', () => {
  const tree = { x: 100, z: -50, crown: 3, seed: 12345 }, leaves = leavesUnder(tree);
  assert.ok(leaves.length > 100 && leaves.length <= LEAVES.per_tree);
  assert.deepEqual(leavesUnder(tree), leaves, 'the same tree, the same leaves');
  const off = leaves.map((q) => Math.hypot(q.x - tree.x - 0.94 * 0.54, q.z - tree.z + 0.34 * 0.54));
  const inCrown = off.filter((d) => d <= 3.6).length, beyond = off.filter((d) => d > 3.6).length;
  assert.ok(inCrown > beyond * 2, `${inCrown} under the crown, ${beyond} beyond it`);
  assert.ok(Math.max(...off) < 3 * LEAVES.spread + 2.5, 'none far from its tree');
  // Heaps: leaves lying on leaves; and singles: nothing under them.
  const heaped = leaves.filter((q) => q.h > 0).length, single = leaves.filter((q) => q.h === 0).length;
  assert.ok(heaped > 10 && single > heaped);
  for (const q of leaves) assert.ok(q.size >= LEAVES.size_m[0] && q.size <= LEAVES.size_m[1] && q.lift >= LEAVES.lift_ms[0] && q.lift <= LEAVES.lift_ms[1]);
  // A bigger crown has more, a palm none, a conifer a few.
  assert.ok(leavesUnder({ ...tree, crown: 1.5 }).length < leaves.length);
  assert.equal(leavesUnder({ ...tree, share: LEAF_FALL.palm }).length, 0);
  assert.ok(leavesUnder({ ...tree, share: LEAF_FALL.conifer }).length < leaves.length / 3);
  for (const tone of [0, 0.3, 0.6, 0.9, 1]) for (const c of leafColour(tone)) assert.ok(c > 0 && c < 1);
});

test('a leaf lies still in a light wind and is shifted by a gust over its mark; one under others needs more', () => {
  const leaf = lying();
  assert.equal(stepLeaf(leaf, 0.016, { ...flat, wind: [1.5, 0] }), false);
  assert.deepEqual([leaf.x, leaf.z, leaf.still], [0, 0, true]);
  const buried = lying({ h: 3 });
  assert.equal(stepLeaf(buried, 0.016, { ...flat, wind: [2.6, 0] }), false, 'held down by the ones on it');
  for (let i = 0; i < 120; i += 1) stepLeaf(leaf, 0.016, { ...flat, wind: [3, 0] });
  assert.ok(leaf.x > 0.5 && Math.abs(leaf.z) < 0.01 && !leaf.still, `blown ${leaf.x.toFixed(2)} m downwind`);
  assert.ok(leaf.y >= 0, 'never under the ground');
  // The gust dies: it comes to rest again, on the ground.
  let live = true;
  for (let i = 0; i < 400 && live; i += 1) live = stepLeaf(leaf, 0.016, { ...flat, wind: [0.2, 0] });
  assert.equal(live, false); assert.ok(leaf.still && leaf.y === 0 && leaf.vx === 0);
});

test('a foot going through takes leaves with it; a foot standing still does not', () => {
  const leaf = lying({ x: 0.2, h: 2 });
  assert.equal(stepLeaf(leaf, 0.016, { ...flat, feet: [{ x: 0, z: 0, vx: 0, vz: 0 }] }), false);
  const walking = { x: 0, z: 0, vx: 1.4, vz: 0 };
  assert.equal(stepLeaf(leaf, 0.016, { ...flat, feet: [walking] }), true);
  assert.ok(leaf.vx > 0.5 && leaf.vy > 0 && leaf.h === 0, 'dragged along, and kicked up off the heap');
  for (let i = 0; i < 300; i += 1) stepLeaf(leaf, 0.016, flat);
  assert.ok(leaf.x > 0.3 && leaf.still, `it lies ${leaf.x.toFixed(2)} m on from where it was`);
  // Out of reach of the foot: left alone.
  const far = lying({ x: LEAVES.foot_m + 0.1 });
  assert.equal(stepLeaf(far, 0.016, { ...flat, feet: [walking] }), false);
});

test('a leaf never goes through a wall: it slides along it or stops against it', () => {
  const wall = (x) => x > 1;   // solid beyond x = 1
  const leaf = lying({ x: 0.9, still: false, vx: 0, vz: 0 });
  for (let i = 0; i < 300; i += 1) { stepLeaf(leaf, 0.016, { ...flat, wind: [4, 1.5], solid: (x) => wall(x) }); assert.ok(leaf.x <= 1 + 1e-9, 'not through it'); }
  assert.ok(leaf.z > 0.5, 'it goes along the wall with the wind');
  const boxed = lying({ still: false });
  for (let i = 0; i < 100; i += 1) stepLeaf(boxed, 0.016, { ...flat, wind: [5, 5], solid: (x, z) => Math.abs(x) > 0.05 || Math.abs(z) > 0.05 });
  assert.ok(Math.abs(boxed.x) <= 0.05 && Math.abs(boxed.z) <= 0.05, 'shut in on every side it stays');
});

test('the wind at the ground comes in gusts: less than the sky\'s, never still for long, along its way', () => {
  let most = 0, least = Infinity, along = 0, n = 0;
  for (let t = 0; t < 40; t += 0.5) for (let x = 0; x < 30; x += 5) { const [vx, vz] = gustAt(x, 7, t, 6, 1, 0), v = Math.hypot(vx, vz); most = Math.max(most, v); least = Math.min(least, v); along += vx / (v || 1); n += 1; }
  assert.ok(most < 6 && most > 2.5 && least < 1.2, `${least.toFixed(2)} to ${most.toFixed(2)} m/s for a 6 m/s wind`);
  assert.ok(along / n > 0.9, 'it blows the way the wind does');
});

test('the page draws leaves round the walker and no longer lays patches of leaf texture', () => {
  const trees = readFileSync(new URL('../src/smc/renderer/page/module/17-trees-a-trunk-limbs-and.js', import.meta.url), 'utf8');
  assert.ok(trees.includes('function leafLitterStep(at, now, viewHeight = 0)') && trees.includes('for (const patch of typeof leafLibrary !== "undefined" && leafLibrary ? [] : fall.patches) {'));
  assert.ok(trees.includes('return Boolean(buildingAt(x, z)) || Boolean(nearestFenceLine(x, z, LEAF_FENCE_M));'), 'solid to walls and fences');
  const guest = readFileSync(new URL('../src/smc/renderer/page/module/29-one-world-a-region-built.js', import.meta.url), 'utf8');
  assert.ok(guest.includes('leafLitterStep(at, performance.now(), camera.position.y - at.y);'));
  const boot = readFileSync(new URL('../src/smc/renderer/page/module/00-boot.js', import.meta.url), 'utf8');
  assert.ok(boot.includes('leaf-litter.mjs?rev=__LEAF_LITTER_HASH__'));
  assert.ok(readFileSync(new URL('../src/smc/renderer/tuning.py', import.meta.url), 'utf8').includes('("LEAF_LITTER", "leaf-litter.mjs")'));
});
