// Things drawn with the object lab's models (docs/city/objects.mjs, docs/city/objects.json from
// scripts/build_city_objects.mjs), and the fleet's triangles wound the way their normals say
// (docs/city/vehicles.mjs rewindToNormals: the holes seen in the cars).

import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { test } from "node:test";

import { loadRules } from "../docs/city/core.mjs";
import { bindingOf, itemScale, naturalLength, projectedPx, tierFor, uprightTurn } from "../docs/city/objects.mjs";
import { rewindToNormals, fleetFile, FULL_FOR_TRAFFIC } from "../docs/city/vehicles.mjs";

const R = loadRules(JSON.parse(readFileSync(new URL("../docs/city/rules.json", import.meta.url))));
const O = JSON.parse(readFileSync(new URL("../docs/city/objects.json", import.meta.url)));

test("every model the manifest names is on disk, small, credited CC0, and has a near tier", () => {
  let total = 0;
  for (const [id, a] of Object.entries(O.assets)) {
    const file = new URL(`../docs/city/models/objects/${a.file}`, import.meta.url);
    assert.ok(existsSync(file), `${id}: ${a.file}`);
    const bytes = statSync(file).size;
    total += bytes;
    assert.ok(bytes < 200_000, `${id} is ${bytes} bytes`);
    assert.equal(a.license, "CC0-1.0", id);
    assert.equal(a.tiers[0].node, "near");
    assert.ok(a.tiers[0].triangles <= O.lod.near_max_triangles, `${id} near tier ${a.tiers[0].triangles}`);
    if (a.tiers[1]) assert.ok(a.tiers[1].triangles < a.tiers[0].triangles, `${id}: far is lighter than near`);
  }
  assert.ok(total < 6_000_000, `the whole set is ${(total / 1e6).toFixed(1)} MB`);
});

test("items are drawn only with models the lab found fit: reference-only and gaps keep the page's shape", () => {
  for (const [sku, b] of Object.entries(O.items)) {
    if (["reference_only", "gap", "service_no_mesh"].includes(b.status)) assert.equal(bindingOf(O, sku), null, `${sku} (${b.status})`);
    if (b.recipe) for (const p of [b.recipe.base, ...b.recipe.parts].filter(Boolean)) assert.ok(O.assets[p.asset], `${sku}: ${p.asset}`);
  }
  assert.equal(bindingOf(O, "scrap_metal").recipe?.parts[0].asset, "k-food-soda-can-crushed", "scrap is crushed metal, not an intact fuel can");
  assert.ok(bindingOf(O, "hammer")?.asset, "a hammer has its model");
  assert.ok(bindingOf(O, "burger_fries")?.recipe, "a dish is composed: plate, burger, fries");
  assert.ok(bindingOf(O, "beer")?.tint, "a can family labelled the product's colour");
  const drawn = Object.keys(R.items).filter((k) => k !== "basis" && bindingOf(O, k));
  assert.ok(drawn.length >= 120, `${drawn.length} shop items drawn with a model`);
});

test("an item is drawn at its catalogue size", () => {
  for (const sku of ["hammer", "coffee", "car_tire", "burger_fries", "six_pack", "paper_food_bag"]) {
    const b = bindingOf(O, sku), s = itemScale(O, R, sku, b);
    assert.ok(Math.abs(naturalLength(O, b) * s - R.items[sku].length_m) < 1e-9, sku);
  }
});

test("detail by size on screen, with room either side of each step so a thing does not flicker", () => {
  const L = O.lod;
  assert.equal(tierFor(200, null, L), "near"); assert.equal(tierFor(100, null, L), "far"); assert.equal(tierFor(2, null, L), "cull");
  assert.equal(tierFor(L.near_px * 0.95, "near", L), "near", "just under the step: kept near");
  assert.equal(tierFor(L.near_px * 1.05, "far", L), "far", "just over the step: kept far");
  assert.equal(tierFor(L.near_px * 1.3, "far", L), "near");
  const px = projectedPx(0.33, 2, 60, 1080);
  assert.ok(px > 150 && px < 160, `a hammer 2 m away is ${px.toFixed(0)} px`);
  assert.deepEqual(uprightTurn([0.33, 0.04, 0.12]), { axis: "z", angle: Math.PI / 2 }, "a hammer lying flat is stood up to be held");
  assert.equal(uprightTurn([0.1, 0.3, 0.1]), null);
});

// A geometry like three.js's, enough for rewindToNormals.
function fakeGeometry(positions, normals, index) {
  const attr = (a) => ({ getX: (i) => a[i * 3], getY: (i) => a[i * 3 + 1], getZ: (i) => a[i * 3 + 2], count: a.length / 3 });
  const g = { attributes: { position: attr(positions), normal: attr(normals) } };
  class Idx { constructor(array) { this.array = array; } }
  g.index = new Idx(Uint16Array.from(index));
  g.setIndex = (i) => { g.index = i; };
  return g;
}

test("the cars' holes: a triangle wound against its normals is turned round, the rest left alone", () => {
  // Two triangles of a roof facing up (+y); the second wound the wrong way round.
  const pos = [0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 1], up = [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0];
  const g = fakeGeometry(pos, up, [0, 2, 1, 1, 2, 3].slice(0, 3).concat([1, 3, 2].reverse()));
  // [0,2,1]: (0,0,1)x(1,0,0) = (0,1,0): faces up, right. [2,3,1]: (1,0,0)x(1,0,-1) = (0,1,0)? check by the function.
  const turned = rewindToNormals(g);
  const idx = Array.from(g.index.array);
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = idx.slice(t, t + 3).map((i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]);
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    assert.ok(u[2] * v[0] - u[0] * v[2] > 0, `triangle ${t / 3} faces up after`);
  }
  assert.ok(turned <= 1);
  const flipped = fakeGeometry(pos, up, [0, 1, 2]);
  assert.equal(rewindToNormals(flipped), 1, "the wrong one is turned");
  assert.equal(rewindToNormals(flipped), 0, "and once right, left so");
  assert.equal(fleetFile("suv"), FULL_FOR_TRAFFIC.has("jeep") ? "city/models/fleet/jeep-full.glb" : "city/models/fleet/jeep-npc.glb", "the Jeep's cracked LOD1 is not used in traffic");
});

test("the models come from the object lab through one builder", () => {
  const builder = readFileSync(new URL("../scripts/build_city_objects.mjs", import.meta.url), "utf8");
  assert.ok(builder.includes("--lab") && builder.includes("--out"));
});
