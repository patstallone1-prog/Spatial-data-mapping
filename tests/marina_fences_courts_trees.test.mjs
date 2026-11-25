// Fences, courts and trees in the Marina (2026-11-24): a fence's end is never joined onto another
// owner's fence, no fence stands on a public path, paving stops at a fence, a park's hard court
// is a slab to its fence, and a tree touching a lawn stands wholly on it.
// src/smc/renderer/page/module/17 and 18, run on their own with the page's world stubbed.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import * as THREE from "../docs/vendor/three-0.160.0/three.module.min.js";

const read = (name) => readFileSync(new URL(`../src/smc/renderer/page/module/${name}`, import.meta.url), "utf8");
const trees = read("17-trees-a-trunk-limbs-and.js"), parks = read("18-inside-the-parks-playgrounds-dog.js");
function fn(source, name) {
  const at = source.indexOf(`\nfunction ${name}(`), gen = source.indexOf(`\nfunction* ${name}(`);
  const start = (at >= 0 ? at : gen) + 1;
  assert.ok(start > 0, `${name} is in the page`);
  let depth = 0, i = source.indexOf("{", start);
  for (; i < source.length; i += 1) { if (source[i] === "{") depth += 1; else if (source[i] === "}") { depth -= 1; if (!depth) break; } }
  return source.slice(start, i + 1);
}
const line = (source, start) => { const i = source.indexOf(start); assert.ok(i >= 0, start); return source.slice(i, source.indexOf("\n", i)); };

//: The fence-laying part of module 17, in a world of the caller's: buildings, roads, footways, paths.
function fenceWorld({ buildings = [], paths = [] } = {}) {
  const names = ["fenceOwnedBy", "noteFenceLine", "noteFenceGate", "fenceLinesNear", "fenceAlreadyThere", "inFenceGate", "fencePaths",
    "pathThroughFence", "onPublicPath", "fencePieces", "layFence", "groundedFencePanel", "closeFenceEnds", "fenceLinesAcross", "cutCoverBy",
    "treeOntoGrass"];
  const consts = ["const FENCE_LINE_CELL_M", "const FENCE_DOUBLE_M", "const FENCE_PIECE_STEP_M", "const FENCE_GATE_REACH_M", "const FENCE_CLOSE",
    "const fenceCloseStats", "const fenceLayStats", "const FENCE_BITE", "const TREE_ON_GRASS", "const FENCE_GROUND_STEP_M"];
  const body = `
    const fenceGateGrid = new Map();
    var fenceOwnerNow = null, fencePanelsLaid = [], fencePathGrid = null;
    ${consts.map((c) => line(trees, c)).join("\n")}
    ${names.map((n) => fn(trees, n)).join("\n")}
    return { fenceOwnedBy, layFence, closeFenceEnds, fencePieces, onPublicPath, fenceLinesAcross, cutCoverBy, treeOntoGrass,
      fenceLineGrid, stats: fenceCloseStats, get panels() { return fencePanelsLaid; } };`;
  const inBox = (x, z, [x0, z0, x1, z1]) => x >= x0 && x <= x1 && z >= z0 && z <= z1;
  const world = {
    THREE, groups: { ground: new THREE.Group() },
    buildingAt: (x, z) => buildings.find((b) => inBox(x, z, b)) || null,
    insideCarriageway: () => false, pavementTopAt: () => undefined, inDriveway: () => false, parkPavementAt: () => false,
    groundLiftAt: () => 0,
    // Paths: [x0, z0, x1, z1] in page metres, 2.4 m wide, as DATA's ways would make them.
    DATA: { ways: paths.map(([ax, az, bx, bz]) => ({ kind: "path", points: [[ax, -az], [bx, -bz]] })) },
    xy: (lon, lat) => [lon, lat],
  };
  return new Function(...Object.keys(world), body)(...Object.values(world));
}
const sink = () => ({ positions: [], uvs: [], indices: [] });

test("a fence's free end is not joined onto another owner's fence in line with it", () => {
  // A court's fence running east to x = 0, and 8 m on, a school's fence across its line.
  const W = fenceWorld();
  W.fenceOwnedBy("court:1"); W.layFence(sink(), -20, 0, 0, 0, 0, 3, 1);
  W.fenceOwnedBy("property:2"); W.layFence(sink(), 8, -10, 8, 10, 0, 1.8, 1);
  W.fenceOwnedBy(null);
  W.closeFenceEnds();
  assert.equal(W.stats.closed, 0, "nothing laid between the two fences");
  assert.ok(W.stats.other >= 1, "the other fence was what it would have run to");
});

test("a fence's free end is still carried on to its own fence and to a wall", () => {
  // One owner's fence in two runs with a gap, and another fence ending a step from a house.
  const W = fenceWorld({ buildings: [[30, -5, 40, 5]] });
  W.fenceOwnedBy("property:7");
  W.layFence(sink(), -20, 0, 0, 0, 0, 1.8, 1);
  W.layFence(sink(), 6, -10, 6, 10, 0, 1.8, 1);
  W.fenceOwnedBy("property:8"); W.layFence(sink(), 10, 0, 26, 0, 0, 1.8, 1);
  W.fenceOwnedBy(null);
  W.closeFenceEnds();
  assert.ok(W.stats.closed >= 2, `closed ${W.stats.closed}: onto its own fence, and onto the wall`);
});

test("no fence is closed across a park path, nor laid along one", () => {
  // A school fence ending 10 m short of its own fence, a path across the gap between them.
  const W = fenceWorld({ paths: [[4, -20, 4, 20]] });
  W.fenceOwnedBy("property:3");
  W.layFence(sink(), -20, 0, 0, 0, 0, 1.8, 1);
  W.layFence(sink(), 10, -10, 10, 10, 0, 1.8, 1);
  W.fenceOwnedBy(null);
  W.closeFenceEnds();
  assert.equal(W.stats.closed, 0, "the path stays open");
  // A fence drawn down the middle of a path is not laid on it; one beside the path is.
  const V = fenceWorld({ paths: [[0, 0, 40, 0]] });
  assert.deepEqual(V.fencePieces(0, 0, 40, 0), [], "nothing on the path's tread");
  assert.equal(V.fencePieces(0, 2.5, 40, 2.5).length, 1, "beside it, the whole fence");
});

test("paving that pokes under a fence into the next lawn is cut off along the fence line", () => {
  const W = fenceWorld();
  W.layFence(sink(), 0, -10, 0, 10, 0, 1.8, 1);
  // A paving square from x = -6 to x = +0.8: 0.8 m of it is past the fence (x = 0).
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute([-6, 0, -3, 0.8, 0, -3, 0.8, 0, 3, -6, 0, 3], 3));
  geom.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  geom.setIndex([0, 1, 2, 0, 2, 3]);
  const mesh = new THREE.Mesh(geom); mesh.updateMatrixWorld();
  const tri = (t) => [0, 1, 2].map((k) => { const i = geom.index.getX(t + k); return [geom.attributes.position.getX(i), geom.attributes.position.getZ(i)]; });
  const across = new Map();
  for (let t = 0; t < geom.index.count; t += 3) { const l = W.fenceLinesAcross(tri(t)); if (l.length) across.set(t, l); }
  assert.equal(across.size, 2, "both triangles lie across the fence");
  let current = null;
  const beyond = (x, z) => current.some((f) => { const a = (x - f.ax) * f.ux + (z - f.az) * f.uz; return a > -0.05 && a < f.L + 0.05 && f.side * (f.ux * (z - f.az) - f.uz * (x - f.ax)) > 0.03; });
  W.cutCoverBy(mesh, (x, z) => beyond(x, z), 0.12, (t) => { current = across.get(t) || null; return Boolean(current); });
  let most = -Infinity, area = 0;
  for (let t = 0; t < geom.index.count; t += 3) {
    const [a, b, c] = tri(t);
    for (const p of [a, b, c]) most = Math.max(most, p[0]);
    area += Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
  }
  assert.ok(most < 0.25, `nothing left past the fence: the furthest corner is at x = ${most.toFixed(2)}`);
  assert.ok(area > 6 * 6 * 0.95, `the paving this side kept (${area.toFixed(1)} m²)`);
  // A cover that runs well on through a gap (3 m past) is not a bit, and is left alone.
  assert.equal(W.fenceLinesAcross([[-6, -3], [3, -3], [3, 3]]).length, 0);
  // The pass runs once every fence is laid, closings too.
  assert.ok(parks.indexOf("cutPavingAtFences()") > parks.indexOf("closeFenceEnds();"));
});

test("a tree whose base touches a lawn is moved wholly onto it; one in paving stays", () => {
  const W = fenceWorld();
  const lawn = (x) => x > 0;      // grass east of x = 0, paving west
  const moved = W.treeOntoGrass(0.2, 0, (x) => lawn(x));
  assert.ok(Array.isArray(moved), "moved");
  assert.ok(moved[0] - 0.6 >= -1e-9, `the whole base on grass (x = ${moved[0].toFixed(2)})`);
  assert.ok(Math.hypot(moved[0] - 0.2, moved[1]) <= 0.75, "the least way");
  assert.equal(W.treeOntoGrass(-3, 0, (x) => lawn(x)), null, "a tree in paving keeps its place");
  assert.equal(W.treeOntoGrass(3, 0, (x) => lawn(x)), null, "a tree on the lawn keeps its place");
  assert.equal(W.treeOntoGrass(0.2, 0, (x) => lawn(x), () => false), false, "nowhere allowed: left, and counted");
});

test("a hard court in a park stands on a concrete slab toned to the court, out to its fence", () => {
  const courtSlabColour = new Function(`${line(trees, "const COURT_SLAB_GREY")}\n${fn(trees, "courtSlabColour")}\nreturn courtSlabColour;`)();
  const tennis = courtSlabColour({ play: 0x28503b }), grey = 0xb3b0a8;
  const rgb = (c) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
  const [r, g, b] = rgb(tennis);
  assert.ok(g > r && g > b, "greener than the plain grey");
  assert.ok(rgb(grey).every((v, i) => Math.abs(v - rgb(tennis)[i]) < 70), "still concrete, not paint");
  assert.ok(trees.includes("const variant = inPark === -1 ? -1 : inPark !== null ? `slab:${courtSlabColour(style)}` : `hard:${style.surround}`;"));
});
