// The restaurant game (docs/city/kitchen.mjs): every food shop's dish has a recipe its own
// stations can make; a plate is scored on what is in it, how it was cooked and in what order; the
// tip follows the score; the pantry is what the owner ordered, and the shop's NPC customers eat
// from it too; waste, comps and lab tests are logged against the cook and in the books; an NPC
// covers the line; a tested dish put to the owner goes on the menu and is sold.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { loadRules } from "../docs/city/core.mjs";
import { batchSeconds, buildCost, cookedPart, displayAmount, doneness, makeable, needs, processesAt, ratingOf, recipeOf, recognizeDish, scorePlate, serviceWindow, tasteOf, targetOf, tipFor } from "../docs/city/kitchen.mjs";
import { doughDimensions, validShape, workableDough } from "../docs/city/dough.mjs";
import { sanitize } from "../server/city/guard.mjs";
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

test("service pace, course workload, shrinking tips and walkouts use the ticket clock", () => {
  const window = (kind, service, dish) => serviceWindow(R, kind, [{ dish }], [], service);
  assert.ok(window("american", "Takeout", "water").target_s < window("american", "Takeout", "burger_fries").target_s);
  assert.ok(window("american", "Takeout", "burger_fries").target_s < window("restaurant", "Takeout", "burger_fries").target_s);
  assert.ok(window("restaurant", "Takeout", "meal").target_s < window("restaurant", "Sit-down", "meal").target_s);
  assert.ok(batchSeconds(R, [{ ing: "flour", qty: 3 }], "bake") > batchSeconds(R, [{ ing: "flour", qty: 1 }], "bake"));
  function serveAt(fraction) {
    const w = world(), k = w.kitchenAt(diner), t = w.cmd_kitchen_open("ana", { place: diner }).kitchen.tickets[0];
    assert.ok(["Takeout", "Sit-down"].includes(t.service));
    assert.ok(t.target_s > 0 && t.real_s > t.target_s);
    const plates = t.lines.map(l => perfect(R, l));
    takeFor(w, plates);
    w.now = t.at + (t.due - t.at) * fraction;
    const res = w.submit("ana", "kitchen_serve", { ticket: t.id, place: diner, plates, elapsed: 0, at: at(diner) });
    if (fraction > 1) {
      assert.equal(res.ok, false);
      assert.equal(k.staff.ana.walkouts, 1);
      return 0;
    }
    assert.equal(res.ok, true, res.error);
    return res.tip;
  }
  const early = serveAt(0.2), late = serveAt(0.85), last = serveAt(0.98);
  assert.ok(early > late && late > last && last > 0);
  serveAt(1.01);
});

test("counted and weighed withdrawals share the existing pantry and fail atomically", () => {
  const w = world(), k = w.kitchenAt(diner);
  Object.assign(k.pantry, { egg: 24, flour: 1 });
  const cmd = (type, items) => w.submit("ana", type, { place: diner, items, at: at(diner) });
  assert.equal(displayAmount(R, "egg", 2), "2 × egg");
  assert.equal(displayAmount(R, "lettuce", 3), "3 × leaf");
  assert.equal(displayAmount(R, "flour", 0.25), "30 g");
  for (const items of [{ egg: 0.5 }, { egg: 1, flour: 2 }, { egg: -1 }, { flour: NaN }]) {
    assert.equal(cmd("kitchen_take", items).ok, false);
    assert.equal(k.pantry.egg, 24);
    assert.equal(k.pantry.flour, 1);
  }
  assert.equal(cmd("kitchen_take", { egg: 15, flour: 0.25 }).ok, true);
  assert.equal(cmd("kitchen_return", { flour: 0.125 }).ok, true);
  assert.equal(cmd("kitchen_bin", { flour: 0.125 }).ok, true);
  assert.deepEqual(k.held.ana, { egg: 15 });
  assert.equal(k.pantry.flour, 0.875);
});

test("bibimbap recognizes garnish and scaled portions, distinguishes cooking, and estimates its whole serving", () => {
  const banana = { ing: "banana", qty: 1, p: "-" }, blended = cookedPart(R, { ...banana, p: "blend" });
  assert.equal(blended.kcal, cookedPart(R, banana).kcal);
  assert.ok(blended.flavour.sw > cookedPart(R, banana).flavour.sw);
  const plate = perfect(R, { dish: "bibimbap" });
  const result = tasteOf(R, plate);
  assert.equal(result.kcal, 609);
  assert.equal(result.grams, 514.2);
  assert.equal(recognizeDish(R, [...plate, { ing: "garlic", qty: 1, p: "chop" }]).id, "bibimbap");
  const half = plate.map(c => ({ ...c, qty: c.qty / 2 }));
  const target = targetOf(R, { dish: "bibimbap" });
  assert.equal(scorePlate(R, target, [...half, ...half]).score, 100);
  const lightlyChopped = plate.map(c => c.ing === "beef_slices" ? { ...c, p: "chop>saute" } : c);
  assert.equal(recognizeDish(R, lightlyChopped).id, "bibimbap");
  assert.ok(Math.abs(tasteOf(R, half).kcal - result.kcal / 2) <= 0.5);
  assert.equal(recognizeDish(R, half).id, "bibimbap");
  const raw = plate.map(c => ({ ...c, p: "-" }));
  assert.equal(recognizeDish(R, raw), null);
  assert.ok(tasteOf(R, raw).taste < result.taste);
  assert.ok(cookedPart(R, { ing: "potato", qty: 1, p: "fry" }).kcal > cookedPart(R, { ing: "potato", qty: 1, p: "bake" }).kcal);
});

test("a baked, cooled and chilled berry cake retains energy and ordered stages through the lab", () => {
  const w = world(), k = w.kitchenAt(diner);
  const cake = perfect(R, { dish: "cake" }).map(c => ({ ...c, ratios: c.p.split(">").map(() => 1) }));
  Object.assign(k.pantry, needs(cake));
  takeFor(w, [cake]);
  const { test: sample, ok, error } = w.submit("ana", "lab_test", { name: "New cake?", place: diner, build: cake });
  assert.ok(ok, error);
  assert.equal(sample.family, "cake");
  assert.equal(sample.name, R.items.cake.name);
  assert.equal(sample.kcal, 1872);
  assert.deepEqual(sample.build[0].ratios, [1, 1, 1, 1]);
  assert.equal(cookedPart(R, cake[0]).temperature, "cold");
  const reversed = cake.map(c => ({ ...c, p: c.p.split(">").reverse().join(">") }));
  assert.equal(cookedPart(R, reversed[0]).temperature, "hot");
  assert.equal(recognizeDish(R, reversed), null);
  assert.equal(tasteOf(R, reversed).kcal, sample.kcal);
  assert.notDeepEqual(tasteOf(R, reversed).flavour, sample.flavour);
  const burned = cake.map(c => c.p.includes("bake") ? { ...c, ratios: [1, 2, 1, 1], q: 0.1 } : c);
  assert.ok(tasteOf(R, burned).taste < sample.taste);
  assert.ok(tasteOf(R, burned).flavour.bi > sample.flavour.bi);
  assert.deepEqual(k.held.ana, {});
});

test("a novel long preparation survives approval, save/load, NPC cover and serving a fractional portion", () => {
  const w = world(), k = w.kitchenAt(diner);
  const path = "blend>cool>chill>mix>bake>cool>chill>bake>cool>chill";
  const build = ["egg", "milk", "berries"].map(ing => ({ ing, qty: 0.5, p: path, q: 1, ratios: path.split(">").map(() => 1) }));
  Object.assign(k.pantry, { egg: 6, milk: 6, berries: 6 });
  takeFor(w, [[{ ing: "egg", qty: 1 }, ...build.slice(1)]]);
  const res = w.submit("ana", "lab_test", { place: diner, name: "Twice-baked berry cloud", build });
  assert.ok(res.ok, res.error);
  assert.equal(res.test.family, null);
  assert.equal(res.test.name, "Twice-baked berry cloud");
  const proposal = w.cmd_lab_propose("ana", { place: diner, test: res.test.id }).proposal;
  w.decideProposal(k, proposal, true, proposal.price, "On the menu");
  const saved = CityWorld.fromJSON(R, JSON.parse(JSON.stringify(w.toJSON()))), kitchen = saved.kitchenAt(diner);
  const d = kitchen.menu.at(-1), line = { dish: d.id, mods: [] };
  assert.equal(d.kcal, res.test.kcal);
  assert.deepEqual(recipeOf(R, d.id, kitchen.menu).build.map(c => c.p), build.map(c => c.p));
  assert.equal(recognizeDish(R, build, kitchen.menu).id, d.id);
  const before = kitchen.pantry.egg;
  saved.npcCook(kitchen, { id: "learned", who: "Pat", lines: [line] });
  assert.equal(kitchen.pantry.egg, before - 0.5);
  assert.equal(kitchen.log.at(-1).made[0].dish, d.id);
  const t = saved.cmd_kitchen_open("ana", { place: diner }).kitchen.tickets[0];
  t.lines = [line];
  takeFor(saved, [build.slice(1)]);
  const served = saved.submit("ana", "kitchen_serve", { place: diner, ticket: t.id, plates: [build] });
  assert.ok(served.ok, served.error);
  assert.equal(served.score, 100);
  assert.equal(served.analyses[0].kcal, res.test.kcal);
});

test("dough shapes conserve volume and change bake time, and measured portions survive multiplayer submission", () => {
  const grams = 200, factors = { ball: Math.PI / 6, circle: Math.PI / 4, triangle: 0.5, rectangle: 1 };
  for (const [form, factor] of Object.entries(factors)) {
    const shape = { form, span: 16, aspect: 1.5 };
    assert.ok(validShape(shape));
    const {width,length,height} = doughDimensions(grams,shape);
    assert.ok(Math.abs(width*length*height*factor*1.08 - grams) < 1e-8);
    assert.equal(width/length,1.5);
  }
  const thin = { ing: "flour",qty: 1,shape: {form:"rectangle",span:16,aspect:1} };
  const thick = {...thin,shape:{form:"ball",span:4,aspect:1}};
  assert.ok(batchSeconds(R,[thin],"bake") < batchSeconds(R,[thick],"bake"));
  assert.equal(validShape({...thin.shape,aspect:Infinity}),false);
  const mix = ["flour","water"].map(ing=>({ing,batch:2,chain:["mix"]}));
  assert.ok(workableDough(mix));
  assert.equal(workableDough(mix.map(i=>({...i,chain:["mix","bake"]}))),false);
  const plates = [[{...thin,qty:0.125}]];
  assert.deepEqual(sanitize({plates},"kitchen_serve").plates,plates);
  assert.deepEqual(sanitize({build:plates[0]},"lab_test").build,plates[0]);
  assert.equal(sanitize({qty:1.2},"buy").qty,1);
});
