// Each material meets the sun as it does on a street: its own roughness and mirrored share, from
// the object catalogue (docs/reflectance.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createCatalogue } from "../docs/object-catalogue.mjs";
import { CAR_PAINT, createReflectance, fresnel0, opticsFor } from "../docs/reflectance.mjs";

const DATA = JSON.parse(readFileSync(new URL("../docs/object-catalogue.json", import.meta.url), "utf8"));
const catalogue = createCatalogue(DATA);

test("every material that is anything says how it meets light, within what a material can", () => {
  for (const [id, m] of Object.entries(DATA.materials)) {
    if (id === "none") { assert.equal(m.optics, undefined); continue; }
    const o = m.optics;
    assert.ok(o, id);
    assert.ok(o.roughness >= 0.02 && o.roughness <= 1 && o.albedo >= 0 && o.albedo <= 0.9, id);
    // A non-metal mirrors 2-6% head on (water to bitumen); a bare metal most of the light.
    assert.ok(o.metal ? o.specular >= 0.5 && o.specular <= 1 : o.specular >= 0.02 && o.specular <= 0.06, `${id} ${o.specular}`);
  }
  assert.ok(Math.abs(DATA.materials.water.optics.specular - fresnel0(1.333)) < 0.002);
  assert.ok(Math.abs(DATA.materials.glass.optics.specular - fresnel0(1.52)) < 0.002);
  assert.ok(Math.abs(CAR_PAINT.specular - fresnel0(1.5)) < 0.012);
});

test("the spread is the street's: glass tightest, paint and leaves between, asphalt and soil widest", () => {
  const r = (id) => DATA.materials[id].optics.roughness;
  assert.ok(r("glass") < r("aluminium") && r("aluminium") < r("steel") && r("steel") < r("lumber") && r("lumber") < r("concrete") && r("concrete") < r("asphalt") && r("asphalt") < r("soil"));
  assert.ok(r("foliage") < r("green_wood"), "a leaf is glossier than bark");
  assert.ok(DATA.materials.asphalt.optics.albedo < DATA.materials.concrete.optics.albedo);
});

test("a drawn surface is given its material's figures once; what says nothing keeps the drawn ones", () => {
  assert.equal(opticsFor(catalogue, "road").material, "asphalt");
  assert.equal(opticsFor(catalogue, null), null);
  const given = new Map();
  const R = createReflectance({ catalogue, set: (m, roughness, specular) => given.set(m, [roughness, specular]) });
  const mesh = (surface, material = {}) => ({ isMesh: true, material, userData: surface ? { surface } : {}, children: [] });
  const road = mesh("road"), unknown = mesh("no-such-thing-at-all"), later = mesh(null), leaves = mesh("tree:street", { alphaTest: 0.5 }), trunk = mesh("tree:street");
  const all = [road, unknown, later, leaves, trunk], root = { traverse: (f) => all.forEach(f) };
  const n = R.apply(root);
  assert.deepEqual(given.get(road.material), [DATA.materials.asphalt.optics.roughness, DATA.materials.asphalt.optics.specular]);
  assert.ok(!given.has(unknown.material) && !given.has(later.material));
  if (given.has(leaves.material) && given.has(trunk.material)) assert.ok(given.get(leaves.material)[0] < given.get(trunk.material)[0], "leaves, not bark");
  assert.equal(R.apply(root), 0, "nothing is given twice");
  later.userData.surface = "road";
  assert.equal(R.apply(root), 1, "what says what it is later is given then");
  assert.equal(R.stats().given, n + 1);
});

test("a drawn colour outside what its material scatters back is tinted into its range, once", async () => {
  const { tintFor } = await import("../docs/reflectance.mjs");
  const asphalt = DATA.materials.asphalt.optics, turf = DATA.materials.turf.optics;
  // Visible light: a road and a lawn each send back about a tenth, concrete about a third.
  assert.ok(asphalt.albedo_range[1] <= 0.15 && turf.albedo_range[1] <= 0.16 && DATA.materials.concrete.optics.albedo_range[0] >= 0.2);
  for (const [id, m] of Object.entries(DATA.materials)) {
    const o = m.optics; if (!o?.albedo_range) continue;
    assert.ok(o.albedo_range[0] >= 0.02 && o.albedo_range[1] <= 0.85 && o.albedo >= o.albedo_range[0] && o.albedo <= o.albedo_range[1], id);
  }
  assert.equal(tintFor(0.1, asphalt.albedo_range), 1);
  assert.ok(Math.abs(0.3 * tintFor(0.3, asphalt.albedo_range) - asphalt.albedo_range[1]) < 1e-9, "a pale road is brought down to the top of the range");
  assert.ok(Math.abs(0.03 * tintFor(0.03, turf.albedo_range) - turf.albedo_range[0]) < 1e-9);
  assert.equal(tintFor(0.9, asphalt.albedo_range), 0.25, "never by more than four times");
  assert.equal(tintFor(0, asphalt.albedo_range), 1);

  const tints = new Map(), light = new Map();
  const R = createReflectance({ catalogue, set: () => {}, drawn: (m) => light.get(m), tint: (m, k) => tints.set(m, k) });
  const mesh = (surface, y) => { const o = { isMesh: true, material: {}, userData: { surface }, children: [], parent: {} }; light.set(o.material, y); return o; };
  const pale = mesh("road", 0.3), right = mesh("road", 0.09), unknown = mesh("road", null), late = mesh("road", undefined);
  const all = [pale, right, unknown, late], root = { traverse: (f) => all.forEach(f) };
  R.apply(root);
  assert.ok(Math.abs(tints.get(pale.material) - 0.5) < 1e-9);
  assert.ok(!tints.has(right.material) && !tints.has(unknown.material) && !tints.has(late.material));
  assert.equal(R.stats().waiting, 1, "a surface whose picture has not arrived waits");
  light.set(late.material, 0.6); R.apply(root); R.apply(root);
  assert.equal(tints.get(late.material), 0.25);
  assert.deepEqual([R.stats().tinted, R.stats().kept, R.stats().untold, R.stats().waiting], [2, 1, 1, 0]);
});
