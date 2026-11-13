// The imported fleet (scripts/build_city_fleet.mjs -> docs/city/models/fleet): small enough for the
// web, each kind at its true size, the Porsche simplified for the traffic, and the page given what
// it needs to load them.
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { test } from "node:test";

import { FLEET_DIMS, FLEET_FOR, VEHICLE_DIMS, fleetFile } from "../docs/city/vehicles.mjs";

const ROOT = new URL("../", import.meta.url);
const FLEET = new URL("docs/city/models/fleet/", ROOT);
const manifest = JSON.parse(readFileSync(new URL("fleet.json", FLEET), "utf8"));

//: A GLB's JSON chunk.
function glbJson(path) {
  const b = readFileSync(path);
  assert.equal(b.toString("utf8", 0, 4), "glTF");
  const len = b.readUInt32LE(12);
  return JSON.parse(b.toString("utf8", 20, 20 + len));
}

test("the fleet's record matches the sizes the city drives and parks by", () => {
  assert.ok(existsSync(new URL("scripts/build_city_fleet.mjs", ROOT)), "the build that made them");
  for (const [kind, id] of Object.entries(FLEET_FOR)) {
    const v = manifest.vehicles[id];
    assert.ok(v, id);
    assert.equal(v.kind, kind);
    v.dims.forEach((d, i) => assert.ok(Math.abs(d - FLEET_DIMS[id][i]) < 0.005, `${id} ${["width", "height", "length"][i]} ${d} vs ${FLEET_DIMS[id][i]}`));
    assert.deepEqual(VEHICLE_DIMS[kind], FLEET_DIMS[id], `${kind} is drawn as ${id} and sized as it`);
  }
  // A Muni 40-footer, not the pack's 9 m midibus.
  assert.ok(Math.abs(VEHICLE_DIMS.bus[2] - 12.2) < 0.05 && Math.abs(VEHICLE_DIMS.bus[0] - 2.59) < 0.02);
});

test("the files are small, compressed, and the traffic's are lighter than yours", () => {
  let total = 0;
  for (const [kind, id] of Object.entries(FLEET_FOR)) {
    for (const tier of ["npc", "full"]) {
      const file = new URL(`docs/${fleetFile(kind, tier)}`, ROOT);
      assert.ok(existsSync(file), `${kind} ${tier}`);
      const json = glbJson(file);
      assert.ok(json.extensionsRequired.includes("EXT_meshopt_compression"), `${id}-${tier} meshopt`);
      for (const image of json.images || []) assert.equal(image.mimeType, "image/webp", `${id}-${tier} textures are WebP`);
      total += statSync(file).size;
    }
    const v = manifest.vehicles[id];
    assert.ok(v.npc.triangles <= v.full.triangles, `${id}: the traffic's is no finer than yours`);
  }
  // The Porsche: never its full 200,000 triangles in the traffic.
  assert.ok(manifest.vehicles.porsche.full.triangles > 150000 && manifest.vehicles.porsche.npc.triangles < 20000, "the Porsche simplified for the traffic");
  // The bicycle: the pack's LOD3 only.
  assert.ok(manifest.bike.triangles < 15000);
  total += statSync(new URL(manifest.bike.file, FLEET)).size;
  assert.ok(total < 20 * 1024 * 1024, `${(total / 1048576).toFixed(1)} MB`);
});

test("the page loads them with the meshopt decoder, from the site", () => {
  const boot = readFileSync(new URL("src/smc/renderer/page/module/00-boot.js", ROOT), "utf8");
  assert.match(boot, /import \{ MeshoptDecoder \} from "https:\/\/esm\.sh\/three@0\.160\.0\/examples\/jsm\/libs\/meshopt_decoder\.module\.js"/);
  assert.ok(existsSync(new URL("docs/vendor/three-0.160.0/examples/jsm/libs/meshopt_decoder.module.js", ROOT)));
  const city = readFileSync(new URL("src/smc/renderer/page/module/30-the-living-city.js", ROOT), "utf8");
  assert.match(city, /new GLTFLoader\(\)\.setMeshoptDecoder\(MeshoptDecoder\)\.loadAsync\(url\)/);
});
