// The dish as the cook made it (docs/city/plated.mjs), drawn (dish-models.mjs makeDish ``made``):
// burnt and raw parts look it, what is missing is not there, what does not belong is on top, a
// stacked dish is stacked in the order it was built -- and a plate made right looks as ordered.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "../docs/vendor/three-0.160.0/three.module.min.js";
import { madeFrom, stateOf, lookState, extraLook } from "../docs/city/plated.mjs";
import { makeDish } from "../docs/city/dish-models.mjs";
import { loadRules } from "../docs/city/core.mjs";

const R = loadRules(JSON.parse(readFileSync(new URL("../docs/city/rules.json", import.meta.url))));
//: The recipe as a plate, each heated step at ``k`` of its time (1 right).
const plateOf = (dish, k = 1) => R.kitchen.recipes[dish].build.map((c) => ({ ing: c[0], qty: c[1], p: c[2] || "-", ratios: (c[2] || "-").split(">").filter((x) => x !== "-").map((x) => (R.kitchen.heat.includes(x) ? k : 1)) }));
const meshes = (g) => { const out = []; g.traverse((o) => { if (o.isMesh && o.visible) out.push(o); }); return out; };
const mats = (g) => meshes(g).flatMap((m) => (Array.isArray(m.material) ? m.material : [m.material]));
const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

test("made right, the plate is the recipe: nothing missing, added, changed or out of order", () => {
  for (const dish of ["burger_fries", "breakfast_plate", "tacos", "pho", "pizza", "sandwich"]) {
    const m = madeFrom(R, dish, plateOf(dish));
    assert.deepEqual([m.missing, m.extra, m.changed, m.misordered], [[], [], [], false], dish);
    assert.deepEqual(m.notes, [], dish);
  }
});

test("doneness is the kitchen's: past the burn line it is burnt, short of done it is raw", () => {
  const D = R.kitchen.doneness;
  assert.equal(stateOf(R, { ing: "beef_patty", p: "grill", ratios: [1] }).word, "just right");
  const burnt = stateOf(R, { ing: "beef_patty", p: "grill", ratios: [D.burnt_above + 0.5] });
  assert.equal(burnt.word, "burnt"); assert.ok(burnt.burnt > 0.75, `${burnt.burnt}`);
  const over = stateOf(R, { ing: "beef_patty", p: "grill", ratios: [1.4] });
  assert.ok(over.burnt > 0 && over.burnt < burnt.burnt);
  const raw = stateOf(R, { ing: "beef_patty", p: "grill", ratios: [0.3] });
  assert.equal(raw.word, "raw"); assert.ok(raw.raw > 0.5);
  // Fried after boiling: what it looks like is the frying.
  assert.equal(stateOf(R, { ing: "noodles", p: "boil>wok", ratios: [1, 2.2] }).step, "wok");
  // Not cooked at all, by design: as it comes.
  assert.equal(stateOf(R, { ing: "lettuce", p: "chop" }).heat, false);
});

test("a burnt patty is drawn dark, a raw one pink with no grill marks", () => {
  const right = makeDish(THREE, R, "burger_fries", { made: madeFrom(R, "burger_fries", plateOf("burger_fries")) });
  const burnt = makeDish(THREE, R, "burger_fries", { made: madeFrom(R, "burger_fries", plateOf("burger_fries", 2.4)) });
  const pb = mats(burnt.group).filter((m) => /:burnt$/.test(m.name || ""));
  assert.ok(pb.length > 0, "burnt materials are marked");
  assert.ok(pb.every((m) => lum(m.color) < 0.15), pb.map((m) => lum(m.color)).join(" "));
  assert.equal(mats(right.group).filter((m) => /:/.test(m.name || "")).length, 0, "made right: no tint at all");
  const raw = madeFrom(R, "steak_frites", plateOf("steak_frites", 0.3));
  assert.ok(lookState(raw, "seared").raw > 0.5);
  const d = makeDish(THREE, R, "steak_frites", { made: raw });
  assert.ok(mats(d.group).some((m) => /:raw$/.test(m.name || "")));
});

test("what was left off is not drawn, and what does not belong is on top", () => {
  const noCheese = plateOf("burger_fries").filter((c) => c.ing !== "cheese");
  const m = madeFrom(R, "burger_fries", noCheese);
  assert.deepEqual(m.missing, ["cheese"]);
  const withCheese = makeDish(THREE, R, "burger_fries", { made: madeFrom(R, "burger_fries", plateOf("burger_fries")) });
  const without = makeDish(THREE, R, "burger_fries", { made: m });
  assert.ok(meshes(without.group).length < meshes(withCheese.group).length, "a layer fewer");
  const extra = [...plateOf("pancakes"), { ing: "mustard", qty: 1, p: "-" }, { ing: "pickles", qty: 1, p: "-" }];
  const me = madeFrom(R, "pancakes", extra);
  assert.deepEqual(me.extra.sort(), ["mustard", "pickles"]);
  const d = makeDish(THREE, R, "pancakes", { made: me });
  assert.deepEqual(d.extras.sort(), ["mustard", "pickles"]);
  const on = d.group.children.filter((o) => /^extra:/.test(o.name));
  assert.equal(on.length, 2);
  // On the food, not under it: above the plate's well.
  for (const o of on) assert.ok(o.position.y > 0.012, `${o.name} at ${o.position.y}`);
  assert.equal(extraLook(R, "mustard").shape, "dollop");
  assert.equal(extraLook(R, "pickles").shape, "bits");
});

test("a stacked dish is stacked as it was built: the patty put down before the bun is under it", () => {
  const b = plateOf("burger_fries");
  const bunFirst = madeFrom(R, "burger_fries", b);
  const bunLast = madeFrom(R, "burger_fries", [...b.filter((c) => c.ing !== "bun"), b.find((c) => c.ing === "bun")]);
  assert.equal(bunFirst.misordered, false);
  assert.equal(bunLast.misordered, true);
  assert.ok(bunLast.notes.includes("stacked in the wrong order"));
  // The layer order the burger is drawn from: bun first, the patty on the heel; bun last, under it.
  assert.deepEqual(bunFirst.order.slice(0, 2), ["bun", "beef_patty"]);
  assert.equal(bunLast.order.at(-1), "bun");
});

test("the same ingredient cooked another way is drawn that way (a potato boiled is not fries)", () => {
  const b = plateOf("steak_frites").map((c) => (c.ing === "potato" ? { ...c, p: "chop>boil", ratios: [1, 1] } : c));
  const m = madeFrom(R, "steak_frites", b);
  assert.deepEqual(m.changed.map((c) => c.ing), ["potato"]);
  const d = makeDish(THREE, R, "steak_frites", { made: m });
  assert.ok(!mats(d.group).some((x) => x.map && x === mats(makeDish(THREE, R, "fries").group).find((y) => y.map)), "no fries");
});

test("every dish still builds and is eaten to the end when made badly", () => {
  for (const dish of Object.keys(R.kitchen.recipes)) {
    for (const k of [0.3, 2.4]) {
      const made = madeFrom(R, dish, plateOf(dish, k));
      const d = makeDish(THREE, R, dish, { made });
      let guard = 0;
      for (const f of d.food) while (!f.done() && guard++ < 600) { if (f.kind === "bite") { if (!f.bite()) break; } else if (f.kind === "drink") { f.drink.v *= 0.5; if (f.drink.v < 1e-6) f.drink.v = 0; } else if (!f.take?.()) break; }
      assert.ok(guard < 600, `${dish} at ${k}`);
    }
  }
});
