// Fences on property lines and their gates (docs/property-fences.mjs).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { GATE, cutGates, fenceRuns, placeGates } from "../docs/property-fences.mjs";

const square = (w, h) => [[0, 0], [w, 0], [w, h], [0, h], [0, 0]];
const length = (pts) => pts.slice(1).reduce((a, p, i) => a + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);

test("a property line carries fence only where nothing else is the barrier", () => {
  // A school yard 60 x 40 with its building along the whole north side (z = 40).
  const runs = fenceRuns([square(60, 40)], { blocked: (x, z) => z > 39.2 });
  assert.equal(runs.length, 1, "one fence: down one side, along the street, up the other");
  assert.ok(Math.abs(length(runs[0].points) - (40 + 60 + 40)) < 4);
  assert.equal(runs[0].whole, false);
  // Its corners are the line's corners.
  assert.ok(runs[0].points.some((p) => p[0] === 60 && p[1] === 0));
  // Nothing in the way: the whole line, as one ring.
  const all = fenceRuns([square(60, 40)]);
  assert.equal(all.length, 1); assert.equal(all[0].whole, true);
  // A doorway-sized gap between two stretches is closed; a stub is not a fence.
  const gap = fenceRuns([[[0, 0], [30, 0]]], { blocked: (x) => x > 14.4 && x < 15.6 });
  assert.equal(gap.length, 1);
  const stub = fenceRuns([[[0, 0], [30, 0]]], { blocked: (x) => x > 1.2 });
  assert.equal(stub.length, 0);
});

test("gates: a recorded one stays; inferred ones face the approach, never side by side, never too far apart", () => {
  const runs = fenceRuns([square(60, 40)], { blocked: (x, z) => z > 39.2 });
  // The street is along z = 0: the nearer a spot is to it, the better.
  const score = (x, z) => -z;
  const one = placeGates(runs, { score });
  assert.equal(one.filter((g) => g.basis === "inferred_best_approach").length, 1);
  assert.ok(Math.abs(one[0].z) < 0.01, "on the street side");
  assert.ok(one[0].x > GATE.corner_m && one[0].x < 60 - GATE.corner_m, "clear of the corners");
  // 138 m of fence with the gate in the middle: no stretch is too long, so one way in is enough.
  assert.equal(one.length, 1);
  // A campus 200 m along the street: more than one way in, none nearer than the least apart, no
  // stretch of fence longer than the most allowed.
  const longRuns = fenceRuns([square(200, 40)], { blocked: (x, z) => z > 39.2 });
  const many = placeGates(longRuns, { score });
  assert.ok(many.length >= 3);
  assert.equal(many.filter((g) => g.basis === "inferred_max_fence_between").length, many.length - 1);
  for (const a of many) for (const b of many) if (a !== b) assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= GATE.min_apart_m);
  const cuts = many.map((g) => g.at).sort((a, b) => a - b), marks = [0, ...cuts, length(longRuns[0].points)];
  for (let i = 1; i < marks.length; i += 1) assert.ok(marks[i] - marks[i - 1] <= GATE.max_between_m + 1, `${marks[i] - marks[i - 1]} m of fence between ways in`);
  // A recorded gate is kept where it was recorded, and no inferred one is put beside it.
  const known = placeGates(runs, { score, known: [{ x: 30, z: 0.8, w: 1.8, src: "rpd:1" }] });
  assert.equal(known[0].basis, "recorded"); assert.equal(known[0].src, "rpd:1");
  assert.ok(Math.abs(known[0].x - 30) < 0.6 && known[0].z === 0);
  assert.ok(known.slice(1).every((g) => Math.hypot(g.x - 30, g.z) >= GATE.min_apart_m));
  // Two recorded side by side: one gate.
  const twins = placeGates(runs, { score, known: [{ x: 30, z: 0, w: 1.2 }, { x: 31, z: 0, w: 1.2 }] });
  assert.equal(twins.filter((g) => g.basis === "recorded").length, 1);
  // One recorded far from any fence is not this fence's.
  assert.equal(placeGates(runs, { score, known: [{ x: 30, z: 20 }] })[0].basis, "inferred_best_approach");
  // A short fence all round a small yard: one way in; a scrap of fence: none.
  const small = placeGates(fenceRuns([square(12, 10)]), { score });
  assert.equal(small.length, 1);
  assert.equal(placeGates(fenceRuns([[[0, 0], [4, 0]]]), { score }).length, 0);
  // A car park's is a driveway's width.
  assert.equal(placeGates(runs, { score, drive: true })[0].w, GATE.drive_w);
  // Where the page says never (a spot in a roadway), no gate goes.
  const never = placeGates(fenceRuns([[[0, 0], [40, 0]]]), { score: (x) => (x < 30 ? -Infinity : 1) });
  assert.ok(never.every((g) => g.x >= 30));
});

test("a gate is an opening in the fence with a post each side", () => {
  const run = { points: [[0, 0], [40, 0], [40, 30]], whole: false };
  const { panels, openings } = cutGates(run, [{ at: 20, w: 2, basis: "recorded" }, { at: 55, w: 1.5, basis: "inferred_best_approach" }]);
  assert.equal(openings.length, 2); assert.equal(panels.length, 3);
  assert.deepEqual(openings[0].a, [19, 0]); assert.deepEqual(openings[0].b, [21, 0]);
  const fence = panels.reduce((a, p) => a + length(p), 0);
  assert.ok(Math.abs(fence - (70 - 3.5)) < 1e-6, "the fence is the line less the openings");
  assert.ok(panels[1].some((p) => p[0] === 40 && p[1] === 0), "the corner is kept");
});

test("the built record: verdicts with what they rest on, parks fenced only where surveyed", () => {
  const D = JSON.parse(readFileSync(new URL("../docs/property-fences.json", import.meta.url)));
  assert.equal(D.schema, 1);
  assert.equal(D.rules.gate_max_between_m, GATE.max_between_m);
  assert.equal(D.rules.gate_min_apart_m, GATE.min_apart_m);
  const by = (name) => D.properties.find((p) => p.name === name);
  // Moscone: fenced where the parks department surveyed a fence, not round its whole line.
  const moscone = by("Moscone Playground");
  assert.equal(moscone.verdict, "evidence"); assert.ok(moscone.runs.length >= 5); assert.equal(moscone.fence, undefined);
  assert.ok(moscone.runs.every((r) => /^(rpd|osm):/.test(r.src)));
  // A school is fenced round its yard; a fire station is its building.
  const school = by("Marina Middle School");
  assert.equal(school.verdict, "fenced"); assert.equal(school.fence.style, "chain_link"); assert.ok(school.ring.length >= 4);
  assert.ok(D.decided_open.some((p) => p.name === "Fire Station #16" && p.verdict === "building_only"));
  assert.ok(D.decided_open.some((p) => p.kind === "parking" && p.verdict === "open"));
  assert.ok(D.properties.some((p) => p.kind === "parking" && p.verdict === "fenced" && /access_private/.test(p.basis)));
  // No fence line is drawn with two properties.
  const seen = new Set();
  for (const p of D.properties) for (const r of p.runs || []) { assert.ok(!seen.has(r.src), r.src); seen.add(r.src); }
});

test("records of one tree a little apart are one tree, at their average, abreast of its kerb", async () => {
  const { CLUMP_M, mergeClumps } = await import("../docs/sf-tree-placement.mjs");
  const lat = 37.8, kx = 111320 * Math.cos(lat * Math.PI / 180), ky = 111320;
  const at = (x, y) => [-122.43 + x / kx, lat + y / ky];
  const trees = [
    // The same plane tree three times, re-surveyed a pace apart, beside a kerb running east.
    { id: "a", p: at(0, 0), d: 20, site: "cutout", plot: [0.9, 0.9], curb: [...at(0.2, -1), 0], obstacles: [[...at(3, 0), "hydrant"]] },
    { id: "b", p: at(1.2, 0.3), d: 35, site: "cutout", plot: [1.2, 1.2], curb: [...at(1.2, -1), 0] },
    { id: "c", p: at(0.6, -0.3), d: 0, src: "lidar_canopy" },
    // Its neighbour down the street, five metres on: its own tree.
    { id: "d", p: at(6.5, 0), d: 12, site: "cutout", plot: [0.9, 0.9], curb: [...at(6.5, -1), 0] },
    // A row of saplings a pace and a half apart: a row, not one tree.
    ...[0, 1, 2, 3, 4, 5].map((k) => ({ id: `s${k}`, p: at(40 + k * 2.2, 0), d: 3 })),
  ];
  const out = mergeClumps(trees);
  const one = out.find((t) => t.merged);
  assert.equal(out.filter((t) => t.merged).length >= 1, true);
  assert.equal(one.id, "b", "the thickest trunk is the tree");
  assert.equal(one.merged, 3);
  const x = (one.p[0] + 122.43) * kx, y = (one.p[1] - lat) * ky;
  assert.ok(Math.abs(x - 0.6) < 0.01 && Math.abs(y) < 0.01, "at the average of the three");
  // Its kerb point is abreast of it on the same kerb line, so the setback is the city's.
  assert.ok(Math.abs((one.curb[0] + 122.43) * kx - 0.6) < 0.01 && Math.abs((one.curb[1] - lat) * ky + 1) < 0.01);
  assert.equal(one.curb[2], 0);
  assert.equal(one.obstacles.length, 1, "what its records knew stood near is kept");
  assert.ok(out.some((t) => t.id === "d" && !t.merged));
  // The saplings: never one tree for the whole row (no clump wider than the span).
  const row = out.filter((t) => /^s/.test(t.id));
  assert.ok(row.length >= 2);
  assert.ok(CLUMP_M <= 4.572, "nearer than the city plants trees");
  // Nothing to merge: the same list.
  assert.equal(mergeClumps([trees[3]]).length, 1);
});

test("the page: fences from the record, a dark frame round each way in, trees merged and cut out of paving", () => {
  const PAGE = readFileSync(new URL("../src/smc/renderer/page/module/18-inside-the-parks-playgrounds-dog.js", import.meta.url), "utf8");
  assert.match(PAGE, /api\.fenceRuns\(\[ring\], \{ blocked: lineBlocked \}\)/);
  assert.match(PAGE, /api\.placeGates\(runs, \{ known, score: gateScore, drive: prop\.kind === "parking"/);
  // No fence where a building is on the line, across a roadway, or where a court's own fence is.
  assert.match(PAGE, /const lineBlocked = \(x, z, ux, uz\) => insideCarriageway\(x, z, 0\.15\) \|\| buildingAt\(x, z\)/);
  assert.match(PAGE, /alreadyFenced\(x, z\)/);
  // A way in is a clear opening with dark posts and a bar over it.
  assert.match(PAGE, /surface: "fence:gate_frame\|property"/);
  assert.match(PAGE, /color: 0x14171a/);
  // Trees: clumps merged, none on the roadway's edge or in a junction, an opening in any paving.
  assert.match(PAGE, /clumps\.mergeClumps\(ground\.trees\.filter\(\(t\) => !notThere\.has\(t\)\)\)/);
  assert.match(PAGE, /if \(insideCarriageway\(tx,tz,-TREE_ROAD_CLEAR_M\)\) \{ treeSquareStats\.kerbEdge \+= 1; return false; \}/);
  assert.match(PAGE, /if \(top === undefined\) \{ hardOpening\(tree, tx, tz\); continue; \}/);
  assert.doesNotMatch(PAGE, /if \(tree\.src\?\.startsWith\("lidar_canopy"\)\) continue;/);
});

test("plain light declares the view position once (a second declaration stopped those materials drawing)", () => {
  const PAGE = readFileSync(new URL("../src/smc/renderer/page/module/02-reconstructed-world-objects.js", import.meta.url), "utf8");
  assert.match(PAGE, /THREE\.ShaderChunk\.lights_lambert_pars_fragment\.replace\(\/varying\\s\+vec3\\s\+vViewPosition\\s\*;\/, ""\)/);
});
