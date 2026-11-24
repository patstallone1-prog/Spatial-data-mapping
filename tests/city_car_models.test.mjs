// The bought-in cars (scripts/city_cars.json -> scripts/blender_city_cars.py ->
// scripts/build_city_cars.mjs -> docs/city/models/cars): each at three levels, drawn as often as
// California buys it, every part catalogued so it meets the light as its material does, and no
// car drawn from code any more.
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { test } from "node:test";

import * as THREE from "../docs/vendor/three-0.160.0/three.module.min.js";
import { BODY_MIX, CAR_MODELS, CA_REGISTRATIONS_2024, FLEET_FOR, KENNEY_FOR, PRIVATE_KIND_SHARE, bodyDims, bodyFile, bodyOf, carSurface, fleetFile, fleetMaterial } from "../docs/city/vehicles.mjs";
import { PRIVATE_MIX } from "../docs/city/fleet.mjs";

const ROOT = new URL("../", import.meta.url);
const CARS = new URL("docs/city/models/cars/", ROOT);
const record = JSON.parse(readFileSync(new URL("cars.json", CARS), "utf8"));
const config = JSON.parse(readFileSync(new URL("scripts/city_cars.json", ROOT), "utf8"));
const catalogue = JSON.parse(readFileSync(new URL("docs/object-catalogue.json", ROOT), "utf8"));

//: A GLB's JSON chunk.
function glbJson(path) {
  const b = readFileSync(path);
  assert.equal(b.toString("utf8", 0, 4), "glTF");
  return JSON.parse(b.toString("utf8", 20, 20 + b.readUInt32LE(12)));
}

test("the builds that made the cars are in the repository", () => {
  // (Also what tells CI's test selection that a change to either build is this file's to check.)
  assert.ok(existsSync(new URL("scripts/blender_city_cars.py", ROOT)), "the Blender pass");
  assert.ok(existsSync(new URL("scripts/build_city_cars.mjs", ROOT)), "the build that packs them");
});

test("the page's record of each car is the build's", () => {
  assert.deepEqual(Object.keys(CAR_MODELS).sort(), Object.keys(record.cars).sort());
  assert.deepEqual(Object.keys(CAR_MODELS).sort(), Object.keys(config.cars).sort());
  for (const [id, m] of Object.entries(CAR_MODELS)) {
    const r = record.cars[id];
    assert.equal(m.kind, r.kind, id);
    m.dims.forEach((d, i) => assert.ok(Math.abs(d - r.dims[i]) < 0.005, `${id} dims[${i}] ${d} vs ${r.dims[i]}`));
    assert.equal(m.registrations, r.popularity.registrations_2024, id);
    // Its length the maker's (to 5 cm: the model's own mirrors and bumpers).
    assert.ok(Math.abs(r.dims[2] - config.cars[id].dims[2]) < 0.05, `${id} length`);
    assert.match(r.source.url, /^https:\/\/www\.cgtrader\.com\//);
    assert.match(r.source.licence, /Royalty Free/);
  }
  // Each kind's share of the city's cars is fleet.mjs's.
  assert.deepEqual(PRIVATE_KIND_SHARE, Object.fromEntries(PRIVATE_MIX));
});

test("each model is as common in the traffic as in California's sales, the rest the bodies there were", () => {
  // A Civic: 53,049 of 1,759,200 (3.0%), over the sedans' 22% of the city's cars.
  const share = (kind, id) => BODY_MIX[kind].find(([k]) => k === id)[1];
  assert.ok(Math.abs(share("sedan", "civic") - 53049 / CA_REGISTRATIONS_2024 / 0.22) < 1e-9);
  assert.ok(share("sedan", "civic") > 0.13 && share("sedan", "civic") < 0.145);
  assert.ok(share("sedan", "sonata") > 0.012 && share("sedan", "sonata") < 0.02);
  assert.ok(share("suv", "glk") > 0.02 && share("suv", "glk") < 0.035);
  assert.ok(share("pickup", "frontier") > 0.04 && share("pickup", "frontier") < 0.055);
  // Counted over many cars: the shares, and no kind all one body.
  const N = 40000, counts = {};
  for (let i = 0; i < N; i += 1) {
    const shade = (i * 0.6180339887 + 0.137) % 1;
    for (const kind of ["sedan", "suv", "pickup", "economy", "compact_ev"]) {
      const b = bodyOf(kind, shade), key = `${kind}:${b.source}:${b.id}`;
      counts[key] = (counts[key] || 0) + 1;
    }
  }
  for (const [kind, list] of Object.entries(BODY_MIX)) for (const [id, s] of list) {
    assert.ok(Math.abs(counts[`${kind}:car:${id}`] / N - s) < 0.01, `${kind} ${id}: ${counts[`${kind}:car:${id}`] / N} vs ${s}`);
  }
  // The rest: the fleet's model for a kind it draws, the kit's variants (all of them) otherwise.
  assert.ok(counts["suv:fleet:jeep"] / N > 0.9);
  assert.equal(counts["economy:fleet:cuore"], N);
  for (const v of KENNEY_FOR.sedan) assert.ok(counts[`sedan:kit:${v}`] / N > 0.3, `sedan ${v}`);
  for (const v of KENNEY_FOR.compact_ev) assert.ok(counts[`compact_ev:kit:${v}`] / N > 0.3, `compact_ev ${v}`);
  assert.ok(counts["pickup:kit:truck"] / N > 0.9);
  // The same car the same body, whatever the tier or the visit.
  assert.deepEqual(bodyOf("sedan", 0.4242), bodyOf("sedan", 0.4242));
  assert.equal(bodyOf("sedan", 0).id, "civic", "a car of yours (number 0) is the commonest model");
  assert.equal(bodyOf("not-a-kind", 0.5).kind, "sedan");
});

test("three levels of each: the full one with its inside, the traffic's a fraction of it", () => {
  for (const [id, r] of Object.entries(record.cars)) {
    const { full, npc, mid } = r.lods;
    for (const lod of ["full", "npc", "mid"]) {
      const file = new URL(r.lods[lod].file, CARS);
      assert.equal(bodyFile({ source: "car", id }, lod), `city/models/cars/${id}-${lod}.glb`);
      assert.ok(existsSync(file), `${id} ${lod}`);
      const json = glbJson(file);
      assert.ok(json.extensionsRequired.includes("EXT_meshopt_compression"), `${id}-${lod} meshopt`);
      assert.ok(!(json.images || []).length, `${id}-${lod}: colours per vertex, no textures`);
      const names = json.materials.map((m) => m.name);
      for (const name of names) assert.ok(catalogue.surfaces.exact[carSurface(name)], `${id}-${lod} ${name} is catalogued`);
      assert.ok(names.includes("body") && names.includes("glass"), `${id}-${lod} body and glass`);
    }
    assert.ok("interior" in full.parts && full.parts.interior > 5000, `${id}: seats inside`);
    assert.ok("tyre" in full.parts || "metal" in full.parts, `${id}: wheels`);
    assert.ok(full.triangles < 125000 && npc.triangles < 16000 && mid.triangles < 2000, `${id} ${full.triangles}/${npc.triangles}/${mid.triangles}`);
    assert.ok(mid.triangles < npc.triangles / 5 && npc.triangles < full.triangles / 4, id);
    assert.ok(statSync(new URL(full.file, CARS)).size < 1.6 * 1024 * 1024 && statSync(new URL(npc.file, CARS)).size < 200 * 1024, id);
  }
  // The fleet's coarse files too, lighter than its traffic ones.
  const fleet = JSON.parse(readFileSync(new URL("docs/city/models/fleet/fleet.json", ROOT), "utf8")).vehicles;
  for (const [kind, id] of Object.entries(FLEET_FOR)) {
    assert.equal(fleetFile(kind, "mid"), `city/models/fleet/${id}-mid.glb`);
    assert.ok(existsSync(new URL(`docs/${fleetFile(kind, "mid")}`, ROOT)), `${id} mid`);
    assert.ok(fleet[id].mid.triangles < fleet[id].npc.triangles || fleet[id].mid.triangles < 10000, `${id} mid`);
  }
  assert.deepEqual(bodyDims({ source: "car", id: "glk" }), CAR_MODELS.glk.dims);
});

test("every part meets the light as its catalogued material does, and none is a second obstacle", () => {
  const want = { body: "steel", glass: "glass", trim: "plastic", metal: "chrome", tyre: "tyre_rubber", interior: "upholstery", lamp: "lens" };
  for (const [part, material] of Object.entries(want)) {
    const surface = carSurface(part), archetype = catalogue.archetypes[catalogue.surfaces.exact[surface]];
    assert.equal(archetype.material, material, part);
    // The car stops you (the city's own cars); its parts are mounted on it.
    assert.equal(archetype.collision.source, "host", part);
    const optics = catalogue.materials[material].optics;
    assert.ok(optics.roughness >= 0 && optics.specular >= 0, material);
  }
  assert.equal(carSurface("paint-atlas"), "car:body");
  assert.equal(carSurface("atlas-e6b5309a"), "car:body");
  assert.equal(catalogue.surfaces.prefix["car:"], "vehicle.body");
  assert.ok(catalogue.materials.chrome.optics.metal && catalogue.materials.chrome.optics.specular > 0.5);
  assert.ok(catalogue.materials.tyre_rubber.optics.albedo < 0.06);
  // The traffic's Lambert parts take the sun's lobe at their own figures (KB_PLAIN); the paint
  // keeps its clear coat (KB_GLOSS).
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(3), 3));
  const trim = fleetMaterial(THREE, { name: "trim", geometry, tint: false, glass: false });
  assert.ok(trim.isMeshLambertMaterial && "KB_PLAIN" in trim.defines && trim.defines.roughnessFactor);
  const paint = fleetMaterial(THREE, { name: "body", geometry, tint: true, glass: false });
  assert.ok("KB_GLOSS" in paint.defines && !("KB_PLAIN" in paint.defines));
  const near = fleetMaterial(THREE, { name: "metal", geometry, tint: false, glass: false }, { standard: true });
  assert.ok(near.isMeshStandardMaterial && !("KB_PLAIN" in (near.defines || {})), "the page's plain light gives the standard one its lobe");
});

test("no car is drawn from code; the view tags each part with its surface", () => {
  const VEHICLES = readFileSync(new URL("docs/city/vehicles.mjs", ROOT), "utf8");
  const VIEW = readFileSync(new URL("docs/city/view.mjs", ROOT), "utf8");
  assert.ok(!/export function (vehicleParts|vehicleGroup)\b/.test(VEHICLES));
  assert.ok(!/\bvehicleGroup\(|\bvehicleParts\(/.test(VIEW));
  assert.match(VIEW, /mesh\.userData\.surface = carSurface\(part\.name\);/);
  assert.ok(existsSync(new URL("CREDITS.md", CARS)), "credits for the bought-in models");
  const credits = readFileSync(new URL("CREDITS.md", CARS), "utf8");
  for (const r of Object.values(record.cars)) assert.ok(credits.includes(r.source.url), r.title);
});
