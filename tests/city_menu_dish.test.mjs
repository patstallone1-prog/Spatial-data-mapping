// A real menu's dish cooked in the game (docs/city/menu-dish.mjs): the name and description read
// back into a build of the kitchen's ingredients and processes, profiled by tasteOf; the steps a
// cook follows (cookingSteps); a restaurant with a real menu serves it in place of the house's
// (kitchen.mjs); and the person serving's line by the kind of place (clerk.mjs).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { loadRules } from "../docs/city/core.mjs";
import { cookingSteps, dishFromMenu, menuDishes, templateFor } from "../docs/city/menu-dish.mjs";
import { clerkKind, clerkLine, clerkNear, lineParts } from "../docs/city/clerk.mjs";
import { CityWorld } from "../docs/city/world.mjs";

const rules = () => loadRules(JSON.parse(readFileSync(new URL("../docs/city/rules.json", import.meta.url))));
const R = rules();
const ings = (d) => d.build.map((c) => c[0]);
const of = (d, ing) => d.build.find((c) => c[0] === ing);

test("a burger with what the menu lists: the house burger's shape, its sauce made up, its fries on the side", () => {
  const d = dishFromMenu(R, { name: "Classic Burger", description: "lettuce, tomato, onions, pickles, house sauce on a brioche bun, with fries", price: 18 }, { kind: "american" });
  assert.equal(d.template, "burger_fries");
  for (const i of ["bun", "beef_patty", "lettuce", "tomato", "onion", "pickles", "mayo", "potato"]) assert.ok(ings(d).includes(i), `has ${i}`);
  assert.ok(!ings(d).includes("cheese"), "no cheese: the list does not name it");
  assert.equal(of(d, "beef_patty")[2], "grill");
  assert.equal(of(d, "potato")[2], "chop>fry"); assert.equal(of(d, "potato")[3], 1);
  assert.equal(d.build[0][0], "bun");      // built bottom first
  assert.equal(d.price, R.money(18));
  assert.ok(d.profile.taste > 50 && d.profile.kcal > 400 && d.profile.cuisine);
  assert.ok(d.basis.some((b) => /house sauce made from/.test(b)));
});

test("the named protein replaces the house one, cooked as the menu says", () => {
  const sandwich = dishFromMenu(R, { name: "Crispy Chicken Sandwich", description: "buttermilk fried chicken, slaw, pickles, spicy mayo" });
  assert.equal(of(sandwich, "chicken")[2], "fry");
  assert.ok(!ings(sandwich).includes("ham"));
  assert.doesNotMatch(of(sandwich, "pickles")[2], /fry/, "the cooking word before one item does not carry past the comma");
  assert.ok(ings(sandwich).includes("cabbage"), "the slaw is made of cabbage");
  const tacos = dishFromMenu(R, { name: "Shrimp Tacos", description: "grilled shrimp, cabbage, pico de gallo, corn tortillas" }, { kind: "mexican" });
  assert.equal(tacos.template, "tacos");
  assert.match(of(tacos, "shrimp")[2], /grill/);
  assert.equal(of(tacos, "cabbage")[2], "chop", "raw on a taco, as the house's own vegetables are");
});

test("what a menu says comes with it is a side; a dish with no house shape is built from its ingredients", () => {
  const curry = dishFromMenu(R, { name: "Chicken Tikka Masala", description: "served with basmati rice and garlic naan" });
  assert.equal(curry.template, "tikka_masala");
  assert.ok(ings(curry).includes("cream"), "rice and naan are sides, not a list of what is in it");
  assert.equal(of(curry, "naan_dough")[3], 1);
  const salmon = dishFromMenu(R, { name: "Pan Seared Salmon", description: "seasonal vegetables, lemon butter, mashed potatoes", price: 34 });
  assert.equal(salmon.template, null);
  assert.equal(of(salmon, "salmon")[2], "grill");
  assert.equal(of(salmon, "potato")[2], "chop>boil");
  assert.equal(templateFor(R, "Cappuccino").id, "latte");
});

test("a process the kitchen has no station for is done the nearest way it can", () => {
  const cafe = dishFromMenu(R, { name: "Cappuccino" }, { kind: "cafe" });
  const diner = dishFromMenu(R, { name: "Cappuccino" }, { kind: "american" });
  assert.equal(of(cafe, "coffee_beans")[2], "brew");
  assert.notEqual(of(diner, "coffee_beans")[2], "brew");
});

test("the steps: fetch it all, the longest on the heat first, chop while it cooks, build it in order", () => {
  const d = dishFromMenu(R, { name: "Classic Burger", description: "lettuce, tomato, onion, house sauce, with fries" }, { kind: "american" });
  const steps = cookingSteps(R, "american", { build: d.build, ordered: d.ordered, vessel: d.vessel });
  assert.equal(steps[0].kind, "fetch");
  assert.equal(steps.at(-1).kind, "serve");
  const heat = steps.filter((s) => s.kind === "heat");
  assert.ok(heat.length >= 2);
  for (let i = 1; i < heat.length; i += 1) assert.ok(heat[i - 1].seconds >= heat[i].seconds || /after the step before/.test(heat[i].text));
  assert.ok(steps.some((s) => /chop the lettuce, tomato and onion/i.test(s.text)), "the chopping together");
  const build = steps.find((s) => s.kind === "build");
  assert.match(build.text, /bottom first: burger bun/);
  assert.ok(steps.every((s, i) => s.n === i + 1));
  assert.ok(heat.every((s) => s.station), "each on its station");
});

test("a restaurant with a real menu serves its own dishes in place of the house's", () => {
  const R2 = rules();
  R2.menus = { places: { k9: { name: "Test Diner", source: "test", fetched: "2026-11-20", style: "board", items: [
    { name: "Classic Burger", description: "lettuce, tomato, onion, pickles", price: 15, section: "Burgers" },
    { name: "Fries", price: 5, section: "Sides" },
  ] } } };
  const place = { id: "k9", x: 0, z: 0, name: "2100 Chestnut St", keys: ["use:restaurant", "shop:american"], area: 140, lon: -122.4368, lat: 37.8003, county: "county:san-francisco" };
  const w = new CityWorld(R2, { now: Date.UTC(2026, 10, 11, 20), seed: "real-menu" });
  const items = w.storesHere(place)[0].items;
  assert.ok(items.includes("real:k9:1") && items.includes("real:k9:2"), items.join(","));
  assert.ok(!items.includes("burger_fries"), "the house's burger is not on a real menu");
  const k = w.kitchenAt(place, false);
  assert.equal(k.real.source, "test");
  assert.equal(R2.items["real:k9:1"].name, "Classic Burger");
  assert.equal(R2.items["real:k9:1"].price, R2.money(15));
  // Loaded again, the same menu is not rebuilt; a changed one is.
  const again = menuDishes(R2, "k9", R2.menus.places.k9.items, { kind: "american" });
  assert.deepEqual(again.map((d) => d.id), k.menu.map((d) => d.id));
});

test("the person serving asks as such a place does, and their line carries the link", () => {
  assert.equal(clerkKind("italian", "dining"), "fine_dining");
  assert.equal(clerkKind("american", "counter"), "counter");
  assert.equal(clerkKind("american", "casual"), "table");
  assert.equal(clerkKind("shoes"), "shoes");
  assert.equal(clerkKind("convenience"), "grocery");
  const fine = clerkLine({ storeKind: "italian", serviceStyle: "dining", name: "Trattoria", hour: 19, place: "p1" });
  assert.equal(fine.link.kind, "menu"); assert.equal(fine.link.style, "fine"); assert.equal(fine.who, "host");
  const fast = clerkLine({ storeKind: "american", serviceStyle: "counter", name: "Burgers", hour: 12, place: "p2" });
  assert.equal(fast.link.style, "board");
  const shoe = clerkLine({ storeKind: "shoes", name: "Shoe Shop", hour: 11, place: "p3" });
  assert.equal(shoe.link.kind, "shop"); assert.match(shoe.text, /size|styles/i);
  for (const l of [fine, fast, shoe]) {
    const parts = lineParts(l.text);
    assert.equal(parts.filter((x) => typeof x === "object").length, 1, l.text);
    assert.ok(!/\{|\}/.test(l.text), l.text);
  }
  // The clerk is someone at work there, indoors, within reach.
  const people = [{ id: "a", x: 1, z: 0, indoors: true, person: { work: "p3" } }, { id: "b", x: 0.5, z: 0, indoors: false, person: { work: "p3" } }, { id: "c", x: 0.4, z: 0, indoors: true, person: { work: "other" } }];
  assert.equal(clerkNear(people, "p3", 0, 0).id, "a");
  assert.equal(clerkNear(people, "p3", 9, 0), null);
});
