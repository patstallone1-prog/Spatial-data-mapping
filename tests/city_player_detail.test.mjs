// Whatever the detail rings say, what the player rides or owns is drawn in full (docs/city/view.mjs
// carsInView, makeCar, drawBikes; detail.mjs byTier): the bus or cab ridden, first in the full
// tier's queue so its cap never pushes it down; your own car and your party's the fleet's full
// model, inside and all; and a bicycle of your own, were there one, at the full tier too.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import * as THREE from "../docs/vendor/three-0.160.0/three.module.min.js";
import { FULL, LOW, MODERATE, byTier } from "../docs/city/detail.mjs";
import { BUS_LIVERY, fleetMaterial } from "../docs/city/vehicles.mjs";

const VIEW = readFileSync(new URL("../docs/city/view.mjs", import.meta.url), "utf8");

test("the vehicle you ride is first in the full tier however many are nearer the camera", () => {
  // The camera pulled far back over a busy street: a hundred cars nearer it than your bus.
  const near = Array.from({ length: 100 }, (_, i) => ({ v: { id: `car:${i}` }, detail: FULL, d: i + 1 }));
  const ridden = { v: { id: "bus:22:x" }, detail: FULL, d: -1 };
  const [full, mid, low] = byTier([...near, ridden], [80, 170, 320]);
  assert.equal(full[0], ridden);
  assert.equal(full.length, 80);
  assert.ok(!mid.includes(ridden) && !low.includes(ridden));
  // As it was (by its distance like the rest), the cap had sent it to the moderate tier.
  const [full2, mid2] = byTier([...near, { ...ridden, d: 150 * 150 }], [80, 170, 320]);
  assert.ok(!full2.some((q) => q.v.id === "bus:22:x") && mid2.some((q) => q.v.id === "bus:22:x"));
  assert.ok(MODERATE > FULL && LOW > MODERATE);
});

test("the view gives what is yours the full tier and the full model", () => {
  assert.match(VIEW, /const yours = v\.id === transit\.ride\?\.vehicle \|\| v\.mine === true;/);
  assert.match(VIEW, /const detail = yours \? FULL :/);
  assert.match(VIEW, /out\.push\(\{ v, detail, d: yours \? -1 :/);
  // The ridden bus or cab takes the fleet's full file (hero), once loaded.
  assert.match(VIEW, /fleetOf\(v\.model, v\.shade, tier === MODERATE, v\.id === transit\.ride\?\.vehicle \|\| v\.mine === true\)/);
  assert.match(VIEW, /const model3d = coded \? null : \(hero && fleetModel\(kind, "full"\)\) \|\| fleetModel\(kind, "npc"\);/);
  // Your car, your party's and your parked ones: the full model always (makeCar -> dressFull).
  assert.match(VIEW, /if \(FLEET_FOR\[model\]\) fleetReady\(model, "full"\)\.then\(\(parts\) => \{ if \(parts\) dressFull\(g, model, parts, colour\); \}\);/);
  // A bicycle of yours: the full tier, its wheels and crank turning, and you on it in full.
  assert.match(VIEW, /const tier = b\.mine \? FULL : detailNow \? detailNow\.tier\("people", b\.x, b\.z\) : FULL;/);
  assert.match(VIEW, /\.\.\.\(b\.mine \? \{ detail: FULL \} : \{\}\)/);
});

test("the full model's paint is the traffic's colour, not washed out by the sky", () => {
  const geometry = new THREE.BufferGeometry();
  const atlas = fleetMaterial(THREE, { name: "paint-atlas", tint: true, glass: false, map: null, geometry }, { standard: true, livery: BUS_LIVERY });
  const trim = fleetMaterial(THREE, { name: "atlas-1", tint: false, glass: false, map: null, geometry }, { standard: true });
  assert.ok(atlas.isMeshStandardMaterial && atlas.envMapIntensity < 0.5 && atlas.metalness > trim.metalness);
  assert.equal(trim.envMapIntensity, 1);
  assert.ok(fleetMaterial(THREE, { name: "paint-atlas", tint: true, glass: false, map: null, geometry }).isMeshLambertMaterial, "the traffic's");
});
