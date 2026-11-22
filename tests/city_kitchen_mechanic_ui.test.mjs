// The kitchen's and the repair bay's pieces: the cuts, the appliances' warming, the cook's work
// clips, the bay's model choice, points, tools and its detailed underside. (The practice launcher,
// docs/minigames/play.mjs, opens both games with a fresh shift.)
import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "../docs/vendor/three-0.160.0/three.module.min.js";
import { CUT_COUNTS, cutPieces } from "../docs/city/kitchen-cuts.mjs";
import { appliance, levels, applianceLabel } from "../docs/city/kitchen-appliances.mjs";
import { COUNTER_TOP } from "../docs/city/npc-figures.mjs";
import { kitchenChef } from "../docs/city/kitchen-chef.mjs";
import { COUNTER_Y } from "../docs/city/kitchen-3d.mjs";
import { bayModel, serviceGeometry } from "../docs/city/workshop-3d.mjs";
import { buildUnderbody } from "../docs/city/workshop-underbody.mjs";
import { SITE_INFO, TOOLS, workshopPanel } from "../docs/city/workshop-panel.mjs";
import { kitchenPanel } from "../docs/city/kitchen-panel.mjs";
import { MOUNTS, SITES } from "../docs/city/workshop.mjs";
import { FLEET_FOR } from "../docs/city/vehicles.mjs";

test("every cut makes its pieces, and they add up to the whole", () => {
  assert.deepEqual(CUT_COUNTS, { split: 2, slice: 6, dice: 16, mince: 25 });
  for (const [mode, n] of Object.entries(CUT_COUNTS)) {
    const pieces = cutPieces(mode, 0.3);
    assert.equal(pieces.length, n, mode);
    assert.ok(Math.abs(pieces.reduce((s, p) => s + p.share, 0) - 1) < 1e-9, mode);
  }
  // A half cut again is cut within its own footprint.
  const [left] = cutPieces("split", 0.4);
  for (const p of cutPieces("slice", 0.5, left.bounds)) assert.ok(p.bounds[1] <= 0.4 + 1e-9);
});

test("an appliance warms from cold toward its setting, and cooks less while it is cold", () => {
  assert.deepEqual(levels, ["off", "low", "medium", "high"]);
  const on = { level: "high", value: 21, at: 0, dose: 0 };
  const soon = appliance("stove", on, 2000), later = appliance("stove", on, 30000);
  assert.ok(soon.value > 21 && soon.value < later.value && later.value <= soon.target + 1e-9);
  // (Preheated, the same time does more.)
  const hot = appliance("stove", { level: "high", value: 240, at: 0, dose: 0 }, 2000);
  assert.ok(hot.dose > soon.dose);
  assert.match(applianceLabel("oven", { level: "low", value: 21, at: 0 }, 1000), /°C/);
  assert.equal(appliance("blender", { level: "high" }, 0).thermal, false);
});

test("the cook reaches the kitchen's own counter", () => {
  assert.equal(COUNTER_TOP, COUNTER_Y);
  assert.equal(typeof kitchenChef, "function");
  assert.equal(typeof kitchenPanel, "function");
});

test("the bay draws each kind as a full-detail fleet model, every point is explained and every fastener has its tool", () => {
  for (const kind of ["sedan", "taxi", "compact_ev", "pickup", "delivery_van", "economy", "suv", "sports"]) assert.ok(FLEET_FOR[bayModel(kind)], kind);
  for (const id of Object.keys(SITES)) assert.ok(SITE_INFO[id], id);
  const tools = new Set(TOOLS.map((t) => t.id));
  for (const tool of Object.values(MOUNTS)) assert.ok(tools.has(tool), tool);
  assert.ok(tools.has("light") && tools.has("meter") && tools.has("scan"));
  for (const kind of ["economy", "suv", "sports"]) assert.deepEqual(Object.keys(serviceGeometry(kind)).sort(), Object.keys(SITES).sort());
  assert.equal(typeof workshopPanel, "function");
});

test("the underside is built in detail, for an engine car and an electric one", () => {
  for (const model of ["sports", "compact_ev", "economy"]) {
    const root = new THREE.Group(), owned = new Set();
    const g = buildUnderbody(THREE, root, { dims: [1.9, 1.4, 4.5], model, own: (x) => (owned.add(x), x) });
    let meshes = 0;
    g.traverse((o) => { if (o.isMesh) meshes += 1; });
    assert.ok(meshes > 120, `${model}: ${meshes}`);
    assert.equal(Boolean(g.getObjectByName("battery")), model === "compact_ev");
    assert.equal(Boolean(g.getObjectByName("fuel-tank")), model !== "compact_ev");
    for (const x of owned) x.dispose();
  }
});
