// The restaurant game (docs/city/kitchen.mjs): every food shop's dish has a recipe its own
// stations can make; a plate is scored on what is in it, how it was cooked and in what order; the
// tip follows the score; the pantry is what the owner ordered, and the shop's NPC customers eat
// from it too; waste, comps and lab tests are logged against the cook and in the books; an NPC
// covers the line; a tested dish put to the owner goes on the menu and is sold.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { loadRules } from "../docs/city/core.mjs";
import { buildCost, doneness, makeable, needs, processesAt, ratingOf, recipeOf, scorePlate, tasteOf, targetOf, tipFor } from "../docs/city/kitchen.mjs";
import { CityWorld, PLAYER_COMMANDS } from "../docs/city/world.mjs";

const R = loadRules(JSON.parse(readFileSync(new URL("../docs/city/rules.json", import.meta.url))));
const m = R.money;
const HOUR = 3_600_000;
// Wednesday 2026-11-11 12:00 in San Francisco (UTC-8): lunch.
const WED_NOON = Date.UTC(2026, 10, 11, 20, 0);
const MARINA = { lon: -122.4368, lat: 37.8003, county: "county:san-francisco" };
const diner = { id: "k1", x: 0, z: 0, name: "2100 Chestnut St", keys: ["use:restaurant", "shop:american"], area: 140, ...MARINA };
const vacant = { id: "k2", x: 30, z: 0, name: "2130 Chestnut St", keys: ["use:retail"], area: 120, ...MARINA };
const at = (pl) => ({ x: pl.x, z: pl.z, lon: pl.lon, lat: pl.lat, county: pl.county });
const perfect = (R, line, menu = []) => targetOf(R, line, menu).build.map((c) => ({ ...c, q: 1 }));

function world() {
  const w = new CityWorld(R, { now: WED_NOON, seed: "kitchen-test" });
  w.submit("ana", "join", { name: "Ana Cook", at: at(diner) });
  assert.equal(w.submit("ana", "take_job", { role: "cook", place: diner, at: at(diner) }).ok, true);
  assert.equal(w.submit("ana", "clock_in", { at: at(diner), spots: { counter: at(diner) } }).ok, true);
  return w;
}
function takeFor(w, plates, extra = {}) {
  const items = { ...extra };
  for (const pl of plates) for (const c of pl) items[c.ing] = (items[c.ing] || 0) + c.qty;
  const r = w.submit("ana", "kitchen_take", { place: diner, items, at: at(diner) });
  assert.equal(r.ok, true, r.error);
}

test("every food shop's dishes have a recipe its stations can make, with ingredients the rules know", () => {
  for (const c of ["kitchen_open", "kitchen_serve", "lab_test", "lab_propose", "kitchen_decide", "kitchen_cover"]) assert.ok(PLAYER_COMMANDS.includes(c), c);
  for (const [kind, g] of Object.entries(R.business.curve_by_kind)) {
    if (g !== "food") continue;
    const can = processesAt(R, kind);
    for (const dish of R.stores.kinds[kind].items) {
      const r = recipeOf(R, dish);
      assert.ok(r, `${kind}: ${dish}`);
      for (const c of r.build) {
        assert.ok(R.kitchen.ingredients[c.ing], c.ing);
        for (const p of c.p === "-" ? [] : c.p.split(">")) assert.ok(can.has(p), `${kind} cannot ${p} for ${dish}`);
      }
      const share = buildCost(R, r.build) / R.items[dish].price;
      assert.ok(share > 0.02 && share < 0.55, `${dish} food cost ${share}`);
    }
  }
});

test("a plate is scored on what is in it, how it was cooked and the order it was built in", () => {
  const line = { dish: "burger_fries", mods: [] }, target = targetOf(R, line);
  const good = scorePlate(R, target, perfect(R, line), { elapsed: 30, patience: 120 });
  assert.ok(good.score >= 98, `a perfect burger scores ${good.score}`);
  // Built upside down: the order is wrong, the rest right.
  const flipped = perfect(R, line).filter((c) => !c.side).reverse().concat(perfect(R, line).filter((c) => c.side));
  const upside = scorePlate(R, target, flipped, { elapsed: 30, patience: 120 });
  assert.ok(upside.score < good.score - 5 && upside.notes.includes("built in the wrong order"));
  // A burnt patty, and a raw one (not safe: capped low).
  const burnt = perfect(R, line).map((c) => (c.ing === "beef_patty" ? { ...c, q: doneness(R, 2.2), ratio: 2.2 } : c));
  assert.ok(scorePlate(R, target, burnt).score < good.score - 5);
  const raw = perfect(R, line).map((c) => (c.ing === "beef_patty" ? { ...c, p: "-", q: 0 } : c));
  const rs = scorePlate(R, target, raw);
  assert.ok(rs.unsafe && rs.score <= 15, `raw patty scores ${rs.score}`);
  // Missing the cheese, and an ask honoured: "no tomato".
  assert.ok(scorePlate(R, target, perfect(R, line).filter((c) => c.ing !== "cheese")).score < good.score);
  const noTomato = { dish: "burger_fries", mods: [{ no: "tomato" }] };
  assert.equal(targetOf(R, noTomato).build.some((c) => c.ing === "tomato"), false);
  assert.ok(scorePlate(R, targetOf(R, noTomato), perfect(R, line)).notes.some((n) => n.includes("tomato does not belong")));
  // Doneness: right in the window, raw under it, burnt over it.
  assert.equal(doneness(R, 1), 1);
  assert.ok(doneness(R, 0.3) < 0.2 && doneness(R, 2) < 0.4);
});

test("tips follow the score, and something on the house lifts them", () => {
  const price = m(22);
  assert.equal(tipFor(R, 20, price), 0);
  assert.ok(tipFor(R, 90, price) > tipFor(R, 65, price));
  assert.ok(tipFor(R, 90, price, 1) > tipFor(R, 90, price, 0));
  assert.ok(tipFor(R, 90, price, 9) <= Math.round(price * (0.25 + R.kitchen.tips.comp_lift_max)));
});

test("a shift on the line: tickets come in, plates are served and tipped, the pantry goes down", () => {
  const w = world();
  const open = w.submit("ana", "kitchen_open", { place: diner, at: at(diner) });
  assert.equal(open.ok, true, open.error);
  const k = w.kitchens.get("k1");
  assert.ok(Object.keys(k.pantry).length > 20, "a resident owner ordered the month's ingredients");
  assert.ok(k.pantry.beef_patty > 10);
  assert.ok(open.kitchen.tickets.length >= 1, "lunch: a ticket is up");
  const t = open.kitchen.tickets[0];
  const plates = t.lines.map((l) => perfect(R, l));
  const before = { ...k.pantry };
  takeFor(w, plates);
  const bal = w.ledger.balance("player:ana");
  const r = w.submit("ana", "kitchen_serve", { place: diner, ticket: t.id, plates, elapsed: 25, at: at(diner) });
  assert.equal(r.ok, true, r.error);
  assert.ok(r.score >= 95, `scored ${r.score}`);
  assert.ok(r.tip > 0 && w.ledger.balance("player:ana") === bal + r.tip, "tipped");
  for (const [i, n] of Object.entries(needs(plates.flat()))) assert.equal(k.pantry[i] || 0, before[i] - n, `${i} came out of the pantry`);
  assert.equal(k.staff.ana.served, 1);
  // Serving what you never took is refused.
  const t2 = w.submit("ana", "kitchen_state", { place: diner, at: at(diner) }).kitchen.tickets[0];
  if (t2) assert.equal(w.submit("ana", "kitchen_serve", { place: diner, ticket: t2.id, plates: t2.lines.map((l) => perfect(R, l)), at: at(diner) }).ok, false);
  // Only staff on shift get in.
  w.submit("bo", "join", { name: "Bo", at: at(diner) });
  assert.equal(w.submit("bo", "kitchen_open", { place: diner, at: at(diner) }).ok, false);
});

test("comps and waste are logged against the cook and in the books, and pull the rating down", () => {
  const w = world();
  const k0 = w.submit("ana", "kitchen_open", { place: diner, at: at(diner) }).kitchen;
  const t = k0.tickets[0], plates = t.lines.map((l) => perfect(R, l));
  takeFor(w, plates, { beef_patty: 2 });
  const books = w.kitchenBooks(w.kitchens.get("k1"));
  const cogs0 = books.cogs;
  const r = w.submit("ana", "kitchen_serve", { place: diner, ticket: t.id, plates, extras: ["fries", "soda"], elapsed: 20, at: at(diner) });
  assert.equal(r.ok, true, r.error);
  assert.ok(r.comp_cost > 0 && books.comps === r.comp_cost);
  const bin = w.submit("ana", "kitchen_bin", { place: diner, items: { beef_patty: 2 }, why: "burnt", at: at(diner) });
  assert.ok(bin.cost > 0 && books.waste === bin.cost);
  assert.ok(books.cogs >= cogs0 + r.comp_cost + bin.cost);
  const k = w.kitchens.get("k1");
  assert.equal(k.staff.ana.comps, r.comp_cost);
  assert.ok(k.log.some((e) => e.kind === "comp") && k.log.some((e) => e.kind === "waste"));
  const clean = ratingOf(R, { ...k.staff.ana, comps: 0, waste: 0 });
  assert.ok(ratingOf(R, k.staff.ana) <= clean);
  assert.ok(ratingOf(R, { ...k.staff.ana, comps: k.staff.ana.sales }) < clean - 20, "giving it all away sinks the rating");
});

test("the shop's NPC customers eat from the same pantry, and an NPC covers the line", () => {
  const w = world();
  w.submit("ana", "kitchen_open", { place: diner, at: at(diner) });
  const k = w.kitchens.get("k1");
  const patties = k.pantry.beef_patty;
  for (let i = 1; i <= 6; i += 1) w.step(WED_NOON + i * HOUR);
  assert.ok(k.pantry.beef_patty < patties, "the afternoon's burgers came out of the pantry");
  if (!w.players.get("ana").clocked) w.submit("ana", "clock_in", { at: at(diner) });   // sent home for idling meanwhile
  assert.ok(w.submit("ana", "kitchen_state", { place: diner, at: at(diner) }).kitchen.tickets.length > 0, "dinner: tickets are up");
  const r = w.submit("ana", "kitchen_cover", { place: diner, on: true, at: at(diner) });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.kitchen.tickets.length, 0, "the NPC cook took the tickets");
  assert.ok(k.log.some((e) => e.kind === "npc"));
});

test("the lab: a test dish is tasted, put to the resident owner, and goes on the menu at a fair price", () => {
  const w = world();
  w.submit("ana", "kitchen_open", { place: diner, at: at(diner) });
  w.submit("ana", "kitchen_cover", { place: diner, on: true, at: at(diner) });
  const build = [{ ing: "steak", qty: 1, p: "grill", q: 1 }, { ing: "lettuce", qty: 2, p: "chop", q: 1 }, { ing: "tomato", qty: 1, p: "chop", q: 1 },
    { ing: "cucumber", qty: 1, p: "chop", q: 1 }, { ing: "olive_oil", qty: 1, p: "-", q: 1 }, { ing: "lemon", qty: 1, p: "chop", q: 1 }];
  const taste = tasteOf(R, build);
  assert.ok(taste.taste >= 66, `a steak salad tastes ${taste.taste}: ${taste.notes}`);
  const bad = tasteOf(R, [{ ing: "ice_cream", qty: 2, p: "-", q: 1 }, { ing: "fish_fillet", qty: 1, p: "fry", q: 1 }, { ing: "chili", qty: 3, p: "-", q: 1 }]);
  assert.ok(bad.taste < taste.taste - 20, `ice cream with fried fish and chilies tastes ${bad.taste}`);
  takeFor(w, [build]);
  const k = w.kitchens.get("k1");
  const t = w.submit("ana", "lab_test", { place: diner, name: "Chestnut Steak Salad", build, at: at(diner) });
  assert.equal(t.ok, true, t.error);
  assert.ok(t.test.stamina > 0 && t.test.cost > 0 && t.test.price > t.test.cost);
  assert.ok(w.kitchenBooks(k).lab === t.test.cost, "the test's ingredients are in the books");
  const p = w.submit("ana", "lab_propose", { place: diner, test: t.test.id, price: t.test.price, at: at(diner) });
  assert.equal(p.ok, true, p.error);
  w.step(w.now + 3 * HOUR);
  w.submit("ana", "kitchen_state", { place: diner, at: at(diner) });
  assert.equal(k.proposals[0].status, "accepted", k.log.at(-1)?.memo);
  const dish = k.menu[0];
  assert.ok(R.items[dish.id] && R.items[dish.id].price === dish.price, "a real item, with its price");
  assert.ok(w.storesHere(diner)[0].items.includes(dish.id), "on sale at the counter");
  assert.ok(w.players.get("ana").kitchen_news.some((n) => n.text.includes("Chestnut Steak Salad")));
  // The NPC customers order it, and the NPC cooks make it.
  for (let i = 1; i <= 12; i += 1) w.step(w.now + HOUR);
  assert.ok((dish.sold || 0) > 0, "the house's own dish sold");
  // Saved and loaded, it is still on the menu.
  const back = CityWorld.fromJSON(R, JSON.parse(JSON.stringify(w.toJSON())));
  assert.equal(back.kitchens.get("k1").menu[0].name, "Chestnut Steak Salad");
});

test("a player owner's kitchen: ordered by the ingredient, decided by the owner", () => {
  const w = new CityWorld(R, { now: WED_NOON, seed: "kitchen-owner" });
  w.submit("ana", "join", { name: "Ana", at: at(vacant) });
  w.ledger.mint("player:ana", m(80_000), "account_grant", { at: w.now });
  assert.equal(w.submit("ana", "lease_storefront", { place: vacant, at: at(vacant) }).ok, true);
  const reg = w.submit("ana", "register_business", { place: vacant, kind: "american", name: "Ana's Grill", at: at(vacant) });
  assert.equal(reg.ok, true, reg.error);
  const id = reg.business.id;
  w.submit("ana", "fund_business", { business: id, amount: m(20_000) });
  const o = w.submit("ana", "kitchen_open", { place: vacant, at: at(vacant) });
  assert.equal(o.ok, true, o.error);
  assert.equal(o.kitchen.role, "owner");
  assert.equal(Object.keys(w.kitchens.get("k2").pantry).length, 0, "nothing until it is ordered");
  const ord = w.submit("ana", "order_stock", { business: id, items: { burger_fries: 40, soda: 40 } });
  assert.equal(ord.ok, true, ord.error);
  w.step(w.now + 13 * HOUR);
  const k = w.kitchens.get("k2"), b = w.biz.get(id);
  assert.ok(k.pantry.beef_patty > 0 || (b.today.items?.burger_fries?.[0] || 0) > 0, "the order came");
  assert.ok(makeable(k.pantry, recipeOf(R, "burger_fries").build) === b.stock.burger_fries, "the shelves are what the pantry can make");
});
