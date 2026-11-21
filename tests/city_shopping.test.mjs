// Shopping in person (docs/city/shopping.mjs): a thing taken off the shelf is the shop's until it
// is paid for at a till; paid for, the money, the tax and the stock move as the world's checkout
// moves them; walked out with unpaid, it goes back on the shelf.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { loadRules } from "../docs/city/core.mjs";
import { CityWorld } from "../docs/city/world.mjs";
import { SHELF_UNITS, carrierSpec, checkoutLines, roomFor } from "../docs/city/shopping.mjs";

const R = loadRules(JSON.parse(readFileSync(new URL("../docs/city/rules.json", import.meta.url))));
const T0 = Date.UTC(2026, 10, 9, 18, 0);
const MARINA = { lon: -122.4368, lat: 37.8003, county: "county:san-francisco" };
const grocer = { id: "g1", x: 0, z: 0, name: "Marina Grocer", keys: ["use:retail", "shop:grocery"], area: 400, ...MARINA };
const at = (pl) => ({ x: pl.x, z: pl.z, lon: pl.lon, lat: pl.lat, county: pl.county });
const sells = R.stores.kinds.grocery.items.filter((id) => !R.items[id].service && !R.items[id].needs && (R.items[id].kg || 0) > 0 && R.items[id].kg < 1.5);
function world() {
  const w = new CityWorld(R, { now: T0, seed: "shopping-test" });
  w.submit("ana", "join", { name: "Ana", at: at(grocer) });
  w.submit("ben", "join", { name: "Ben", at: at(grocer) });
  return w;
}

test("carriers: hands hold two things, a basket and a cart what the rules give them", () => {
  assert.equal(carrierSpec(R, "hands").units, 2);
  assert.equal(carrierSpec(R, "basket").max_kg, R.fixtures.shopping_basket.container.max_kg);
  assert.equal(carrierSpec(R, "cart").units, R.fixtures.shopping_cart.container.slots);
  assert.match(roomFor(R, "hands", { [sells[0]]: 2 }, sells[1]), /hands are full/);
  assert.equal(roomFor(R, "basket", { [sells[0]]: 2 }, sells[1]), null);
  assert.deepEqual(checkoutLines({ a: 45, b: 3 }), [{ item: "a", qty: 20 }, { item: "a", qty: 20 }, { item: "a", qty: 5 }, { item: "b", qty: 3 }]);
});

test("off the shelf into a basket, paid at a lane: the money, the stock and the goods move", () => {
  const w = world(), [a, b] = sells;
  assert.equal(w.submit("ana", "shop_carrier", { place: grocer, carrier: "basket" }).ok, true);
  const before = w.ledger.balance(w.players.get("ana").account);
  let r = w.submit("ana", "shelf_take", { place: grocer, item: a, qty: 2 });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.left, SHELF_UNITS - 2);
  assert.equal(w.submit("ana", "shelf_take", { place: grocer, item: b }).ok, true);
  // Still the shop's: not in her inventory, and counted off the shelf for everyone else.
  assert.equal(w.players.get("ana").inventory[a] || 0, 0);
  assert.equal(w.onShelf(grocer, a), SHELF_UNITS - 2);
  // Put one back: on the shelf again.
  assert.equal(w.submit("ana", "shelf_return", { place: grocer, item: b }).ok, true);
  assert.equal(w.onShelf(grocer, b), SHELF_UNITS);
  r = w.submit("ana", "pay_lane", { place: grocer, lane: "self" });
  assert.equal(r.ok, true, r.error);
  const ana = w.players.get("ana");
  assert.equal(ana.inventory[a], 2);
  assert.equal(w.ledger.balance(ana.account), before - r.total);
  assert.ok(r.total >= 2 * R.items[a].price);
  // Sold: still off the shelf until it is filled again.
  assert.equal(w.onShelf(grocer, a), SHELF_UNITS - 2);
  assert.deepEqual(ana.trolley.lines, {});
  assert.equal(w.submit("ana", "pay_lane", { place: grocer }).ok, false);
});

test("walking out with unpaid goods puts them back; shelves fill again through the day", () => {
  const w = world(), [a] = sells;
  w.submit("ana", "shop_carrier", { place: grocer, carrier: "cart" });
  assert.equal(w.submit("ana", "shelf_take", { place: grocer, item: a, qty: 5 }).ok, true);
  assert.equal(w.submit("ana", "trolley_leave", { place: grocer }).returned, 5);
  assert.equal(w.onShelf(grocer, a), SHELF_UNITS);
  // Bought out: nobody else gets one till the shelf is filled.
  for (let k = 0; k < SHELF_UNITS; k += 10) w.submit("ben", "shop_carrier", { place: grocer, carrier: "cart" }), w.submit("ben", "shelf_take", { place: grocer, item: a, qty: Math.min(10, SHELF_UNITS - k) });
  assert.equal(w.onShelf(grocer, a), 0);
  const r = w.submit("ana", "shelf_take", { place: grocer, item: a });
  assert.equal(r.ok, false);
  assert.match(r.error, /shelf is empty/);
  assert.equal(w.submit("ben", "pay_lane", { place: grocer }).ok, true);
  w.now += 3 * 3600_000;
  assert.ok(w.onShelf(grocer, a) > 0);
});

test("hands hold two; what will not fit in what you carry is bagged at the door, yours", () => {
  const w = world(), heavy = R.stores.kinds.grocery.items.filter((id) => !R.items[id].needs && R.items[id].kg >= 1 && R.items[id].kg <= 3)[0];
  assert.ok(heavy, "a grocery item of a kilo or more");
  w.submit("ana", "shelf_take", { place: grocer, item: sells[0] });
  w.submit("ana", "shelf_take", { place: grocer, item: sells[1] });
  assert.match(w.submit("ana", "shelf_take", { place: grocer, item: sells[2] }).error, /hands are full/);
  w.submit("ana", "trolley_leave", {});
  w.ledger.mint(w.players.get("ana").account, R.money(5000), "account_grant", { at: T0 });
  w.submit("ana", "shop_carrier", { place: grocer, carrier: "cart" });
  let n = 0;
  while (n < 60 && w.submit("ana", "shelf_take", { place: grocer, item: heavy, qty: 10 }).ok) n += 10;
  const r = w.submit("ana", "pay_lane", { place: grocer });
  assert.equal(r.ok, true, r.error);
  assert.ok(r.bags?.length, "some of it bagged at the door");
  const bag = w.items.get(r.bags[0].id);
  assert.equal(bag.by, "ana");
  assert.equal((w.players.get("ana").inventory[heavy] || 0) + r.bags.reduce((t, x) => t + x.qty, 0), n);
});

test("a player's business sells off its own stock, less what is in other baskets", () => {
  const w = world();
  w.ledger.mint(w.players.get("ana").account, R.money(90_000), "account_grant", { at: T0 });
  const vacant = { id: "g2", x: 10, z: 0, name: "2001 Chestnut St", keys: ["use:retail"], area: 200, ...MARINA };
  assert.equal(w.submit("ana", "lease_storefront", { place: vacant, at: at(vacant) }).ok, true);
  const reg = w.submit("ana", "register_business", { place: vacant, kind: "grocery", name: "Ana's Market", rivals: 1, at: at(vacant) });
  assert.equal(reg.ok, true, reg.error);
  const id = reg.business.id, item = sells[0];
  // Three on hand (an order arrives at the next delivery hour: set here as delivered).
  w.biz.get(id).stock[item] = 3;
  const shop = { ...vacant, keys: [...vacant.keys] };
  w.submit("ben", "join", { name: "Ben", at: at(shop) });
  w.ledger.mint(w.players.get("ben").account, R.money(500), "account_grant", { at: T0 });
  const stock = w.biz.get(id).stock[item];
  assert.equal(w.onShelf(shop, item), stock);
  w.submit("ben", "shop_carrier", { place: shop, carrier: "basket" });
  assert.equal(w.submit("ben", "shelf_take", { place: shop, item, qty: stock }).ok, true);
  assert.equal(w.onShelf(shop, item), 0);
  const r = w.submit("ben", "pay_lane", { place: shop });
  assert.equal(r.ok, true, r.error);
  assert.equal(w.biz.get(id).stock[item], 0);
  assert.equal(w.players.get("ben").inventory[item], stock);
});

test("anything that needs ID wants a staffed lane, and the world keeps the shelves", () => {
  const w = world(), carded = R.stores.kinds.grocery.items.find((id) => R.items[id].needs) || Object.values(R.stores.kinds).flatMap((s) => s.items).find((id) => R.items[id].needs);
  const kinds = Object.values(R.stores.kinds).filter((s) => s.items.includes(carded));
  if (carded && kinds[0]?.at?.length) {
    const shop = { id: "l1", x: 0, z: 0, name: "Liquor", keys: ["use:retail", kinds[0].at[0]], area: 120, ...MARINA };
    w.submit("ana", "shop_carrier", { place: shop, carrier: "basket" });
    const t = w.submit("ana", "shelf_take", { place: shop, item: carded });
    if (t.ok) assert.match(w.submit("ana", "pay_lane", { place: shop, lane: "self" }).error, /cashier/);
  }
  w.submit("ana", "shelf_take", { place: grocer, item: sells[0] });
  const again = CityWorld.fromJSON(R, JSON.parse(JSON.stringify(w)));
  assert.equal(again.onShelf(grocer, sells[0]), SHELF_UNITS - 1);
});
