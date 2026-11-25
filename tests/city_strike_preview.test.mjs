// What a thrust or a stroke looks like (docs/city/strike-preview.mjs), from the mechanics engine.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createMechanics } from "../docs/city/mechanics.mjs";
import { IMPLEMENT, strikePreview, substanceOf } from "../docs/city/strike-preview.mjs";

const cat = JSON.parse(readFileSync(new URL("../docs/object-catalogue.json", import.meta.url)));
const M = createMechanics(cat);

test("every implement it names is one the engine has", () => {
  for (const id of Object.values(IMPLEMENT)) assert.ok(M.tool(id), id);
});

test("materials: the catalogue's pointer, else a likely substance; a tree is green oak", () => {
  assert.equal(substanceOf(M, "lumber"), "douglas_fir_dry");
  assert.equal(substanceOf(M, "steel"), "mild_steel");
  assert.equal(substanceOf(M, "painted wood"), "douglas_fir_dry");
  assert.equal(substanceOf(M, "", { tree: true }), "red_oak_green");
  assert.equal(substanceOf(M, "unobtainium"), null);
});

test("a crowbar's point goes into wood, not into steel; an axe sticks in a trunk", () => {
  const wood = strikePreview(M, { tool: "crowbar", material: "lumber", mode: "thrust", energy_j: 40 });
  assert.equal(wood.feature, "tip"); assert.ok(wood.depth_mm > 1, JSON.stringify(wood)); assert.match(wood.text, /point goes in/);
  const steel = strikePreview(M, { tool: "crowbar", material: "steel", mode: "thrust", energy_j: 40 });
  assert.ok(steel.depth_mm < 0.5); assert.match(steel.text, /will not bite|bounces/);
  const axe = strikePreview(M, { tool: "axe", material: "", tree: true, mode: "work", energy_j: 40 });
  assert.equal(axe.feature, "edge"); assert.ok(axe.stuck);
  // Nothing to say for a tool the engine does not model.
  assert.equal(strikePreview(M, { tool: "saw", material: "lumber", mode: "work" }), null);
});
