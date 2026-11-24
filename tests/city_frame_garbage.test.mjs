// The garbage pass (docs/50-frame-garbage.md): what the living city asked every frame no longer
// makes lists, strings or iterators to answer -- with the same answers as before.
import assert from "node:assert/strict";
import { test } from "node:test";

import { inRing, outOfRing, WALL_CLEAR_M } from "../docs/city/fleet.mjs";
import { createGrassStrands, grassStats } from "../docs/grass-strands.mjs";

// The answer as it was worked out before (a list of three-number lists, sorted).
function outOfRingBefore(ring, x, z, ok = () => true) {
  const cands = [];
  for (let i = 0; i < ring.length; i += 1) {
    const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length], ex = bx - ax, ez = bz - az, L2 = ex * ex + ez * ez;
    if (L2 < 1e-6) continue;
    const u = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / L2)), qx = ax + ex * u, qz = az + ez * u, L = Math.sqrt(L2);
    let nx = ez / L, nz = -ex / L;
    if (inRing(ring, qx + nx * 0.05, qz + nz * 0.05)) { nx = -nx; nz = -nz; }
    cands.push([Math.hypot(x - qx, z - qz), qx + nx * WALL_CLEAR_M, qz + nz * WALL_CLEAR_M]);
  }
  cands.sort((a, b) => a[0] - b[0]);
  for (const c of cands) if (!inRing(ring, c[1], c[2]) && ok(c[1], c[2])) return [c[1], c[2]];
  for (const c of cands) if (!inRing(ring, c[1], c[2])) return [c[1], c[2]];
  return null;
}
function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

test("a point is put out of a footprint where it was before, for rings of every shape", () => {
  const r = rng(7);
  for (let n = 0; n < 400; n += 1) {
    // A star-shaped ring round a centre (both windings), with a repeated corner now and then.
    const k = 3 + Math.floor(r() * 90), cx = r() * 100, cz = r() * 100, ring = [];
    for (let i = 0; i < k; i += 1) {
      const a = (i / k) * Math.PI * 2, rad = 4 + r() * 12;
      ring.push([cx + Math.cos(a) * rad, cz + Math.sin(a) * rad]);
      if (r() < 0.05) ring.push(ring[ring.length - 1].slice());
    }
    if (r() < 0.5) ring.reverse();
    const x = cx + (r() - 0.5) * 6, z = cz + (r() - 0.5) * 6;
    const ok = r() < 0.5 ? undefined : (px, pz) => (Math.floor(px * 3) + Math.floor(pz * 3)) % 3 !== 0;
    assert.deepEqual(outOfRing(ring, x, z, ok), outOfRingBefore(ring, x, z, ok), `ring ${n}`);
  }
});

test("a grass cell that came out empty is not built again when the focus comes back to it", () => {
  // Enough of three for the layer: a group that holds children, and the material it makes.
  class Group { constructor() { this.children = []; this.visible = true; } add(c) { this.children.push(c); } remove(c) { this.children = this.children.filter((x) => x !== c); } }
  const THREE = { Group, MeshStandardMaterial: class { dispose() {} }, Color: class { setHSL() { return this; } } };
  const parent = new Group();
  let samples = 0;
  const layer = createGrassStrands(THREE, { parent, sample: () => { samples += 1; return null; } });
  // Back and forth between two places 30 m apart, as the focus was seen to jump in the Marina.
  const realNow = performance.now;
  let t = 0;
  performance.now = () => (t += 100);
  try {
    for (let i = 0; i < 400; i += 1) layer.update(i % 2 ? 30 : 0, 0, 2);
  } finally { performance.now = realNow; }
  const stats = grassStats().at(-1);
  assert.equal(stats.meshes, 0);
  // Each cell round either place is built once (it came out empty) and then known to be empty.
  assert.ok(stats.builds <= 2 * 16, `built ${stats.builds} cells`);
  assert.ok(stats.emptyKnown > 100, `${stats.emptyKnown} empty cells known`);
  const before = samples;
  layer.invalidate();
  performance.now = () => (t += 100);
  try { layer.update(0, 0, 2); } finally { performance.now = realNow; }
  assert.ok(samples > before, "the ground changed: the cells are built again");
});
