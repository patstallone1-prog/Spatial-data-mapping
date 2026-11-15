// The object lab's plan, sections 3-6, as the world does it: things as themselves, what each is
// for, believable outcomes drawn once, and selling again (docs/city/things.mjs, uses.mjs,
// outcomes.mjs, resale.mjs, commerce.mjs). The acceptance examples of the plan's section 7 are
// each a test here.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { loadRules } from "../docs/city/core.mjs";
import { CityWorld } from "../docs/city/world.mjs";
import { Things, MAX_DEPTH, conditionBand, latentOf } from "../docs/city/things.mjs";
import { droppedPackage, reclaim, wheelRemoval, pickWeighted, drawWithout, containerContents, Outcomes } from "../docs/city/outcomes.mjs";
import { eligibility, offerFor, shippingQuote, shippedReceipt, resaleGroup, conditionShare } from "../docs/city/resale.mjs";
import { verbsOf, comfortOf, repairKit } from "../docs/city/uses.mjs";
import { rng } from "../docs/city/people.mjs";

const R = loadRules(JSON.parse(readFileSync(new URL("../docs/city/rules.json", import.meta.url))));
const m = R.money;
const NOON = Date.UTC(2026, 10, 4, 20, 0);
const AT = { x: 0, z: 0, lon: -122.437, lat: 37.80 };
const world = () => {
  const w = new CityWorld(R, { now: NOON, seed: "t" });
  w.submit("ana", "join", { name: "Ana", at: AT });
  w.ledger.mint("player:ana", m(5000), "external_trade");
  return w;
};
const buy = (w, pid, item, keys, qty = 1) => { const r = w.submit(pid, "buy", { item, qty, place: { id: `s:${keys[0]}`, x: 0, z: 0, keys } }); assert.ok(r.ok, r.error); return r; };

// ---- the pure parts ---------------------------------------------------------------------------------

test("a thing's latent condition is its own and the same every time; bands read plainly", () => {
  const a = latentOf("thing:1", R.commerce.latent.steel, "s"), b = latentOf("thing:1", R.commerce.latent.steel, "s");
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, latentOf("thing:2", R.commerce.latent.steel, "s"));
  assert.equal(conditionBand(1), "like new"); assert.equal(conditionBand(0.5), "worn"); assert.equal(conditionBand(0), "broken");
});

test("containers: weight, size, depth and no box inside itself (lab plan 4)", () => {
  const B = new Things(R);
  const tote = B.make("grocery_tote", { owner: "a", at: { kind: "held", holder: "a" } });
  const bag = B.make("paper_food_bag", { owner: "a", at: { kind: "held", holder: "a" } });
  const meal = B.make("sealed_meal_box", { owner: "a", at: { kind: "held", holder: "a" } });
  const soup = B.make("soup", { owner: "a", at: { kind: "held", holder: "a" } });
  B.move(soup, { kind: "in", parent: meal.id });
  B.move(meal, { kind: "in", parent: bag.id });
  assert.throws(() => B.move(bag, { kind: "in", parent: tote.id }), /bag in a bag in a bag/, `no deeper than ${MAX_DEPTH}`);
  assert.throws(() => B.move(bag, { kind: "in", parent: meal.id }), /inside itself/);
  const ladder = B.make("ladder", { owner: "a", at: { kind: "held", holder: "a" } });
  assert.throws(() => B.move(ladder, { kind: "in", parent: tote.id }), /too long/);
  const bricks = Array.from({ length: 6 }, () => B.make("brick", { owner: "a", at: { kind: "held", holder: "a" } }));
  for (const b of bricks.slice(0, 4)) B.move(b, { kind: "in", parent: tote.id });
  assert.throws(() => B.move(bricks[4], { kind: "in", parent: tote.id }), /too heavy/);
  assert.ok(Math.abs(B.massOf(tote) - (R.items.grocery_tote.kg + 4 * R.items.brick.kg)) < 1e-9, "a bag weighs what is in it");
  const v = soup.v;
  assert.throws(() => B.move(soup.id, { kind: "held", holder: "b" }, { expect: v - 1 }), /got there first/, "two hands on one thing: the second is refused");
});

test("outcome tables: a moderate drop is 75 / 20 / 5, reclaimed wood 55 / 30 / 15, the wheel formula as the lab gives it", () => {
  const counts = { intact: 0, package_damaged: 0, spilled: 0 };
  const r = rng("drop-test");
  const N = 20000;
  for (let i = 0; i < N; i += 1) counts[droppedPackage({ height: 1, sealed: true }, r()).result] += 1;
  const near = (k, p) => Math.abs(counts[k] / N - p) < 0.012;
  assert.ok(near("intact", 0.75) && near("package_damaged", 0.2) && near("spilled", 0.05), JSON.stringify(counts));
  assert.equal(droppedPackage({ height: 0.1 }, 0.99).result, "intact", "set down, not dropped");
  const high = { intact: 0, spilled: 0, package_damaged: 0 };
  for (let i = 0; i < 4000; i += 1) high[droppedPackage({ height: 3, sealed: true }, r()).result] += 1;
  assert.ok(high.spilled / 4000 > 0.2, "higher, more spills");
  const wood = reclaim({ portions: 20000, quality: 0.7, corrosion: 0, tool: 0.5, care: 0.5 }, rng("wood"));
  assert.ok(Math.abs(wood.usable / 20000 - 0.55) < 0.015 && Math.abs(wood.unusable / 20000 - 0.15) < 0.012, JSON.stringify(wood));
  assert.ok(Math.abs(wheelRemoval({ wheelsLeft: 4, condition: 0.9, skill: 0.6, tool: 1, corrosion: 0.1 }, 0.5, 0).p_usable - 0.9) < 1e-9);
  assert.equal(wheelRemoval({ wheelsLeft: 0, condition: 1, skill: 1, tool: 1, corrosion: 0 }, 0, 0).result, "none", "no wheel left: nothing, whatever the sum");
  assert.equal(pickWeighted([{ id: "a", w: 0 }, { id: "b", w: 0 }], 0.5), null);
  const pool = ["w1", "w2", "w3", "w4"], got = drawWithout(pool, 6, rng("x"));
  assert.equal(new Set(got).size, 4, "drawn without replacement: never a fifth wheel from four");
});

test("an outcome is drawn once: the same event replays, a new event is a new draw", () => {
  const O = new Outcomes();
  let calls = 0;
  const a = O.once("ev1", () => ({ n: ++calls }));
  const b = O.once("ev1", () => ({ n: ++calls }));
  assert.equal(a.n, 1); assert.equal(b.n, 1); assert.ok(b.replay);
  assert.equal(O.once("ev2", () => ({ n: ++calls })).n, 2);
});

test("resale: groups, eligibility by the thing, offers from a buyer's means, the carrier's quote and a balanced receipt", () => {
  assert.equal(resaleGroup(R, "burger_fries"), "blocked_food");
  assert.equal(resaleGroup(R, "hammer"), "tools");
  assert.equal(resaleGroup(R, "car_tire"), "vehicle_parts");
  assert.equal(resaleGroup(R, "smartphone"), "electronics");
  assert.equal(resaleGroup(R, "scrap_metal"), "scrap");
  const B = new Things(R);
  const meal = B.make("burger_fries", { owner: "p", at: { kind: "held", holder: "p" } });
  assert.equal(eligibility(R, meal, "p", "pawn").ok, false, "prepared food is not resold");
  const hammer = B.make("hammer", { owner: "p", at: { kind: "held", holder: "p" } });
  assert.equal(eligibility(R, hammer, "q", "pawn").ok, false, "not yours to sell");
  assert.equal(eligibility(R, { ...hammer, reserved: "listing:1" }, "p", "pawn").ok, false, "promised to a buyer");
  assert.ok(eligibility(R, hammer, "p", "specialist").ok);
  const pawn = offerFor(R, hammer, "pawn", { hour: 1, seed: "s" }), spec = offerFor(R, hammer, "specialist", { hour: 1, seed: "s" });
  assert.ok(pawn.amount > 0 && spec.amount > pawn.amount, "a specialist pays more than the second-hand counter");
  assert.equal(offerFor(R, hammer, "pawn", { hour: 1, seed: "s" }).amount, pawn.amount, "asked again in the hour: the same quote");
  assert.ok(offerFor(R, hammer, "pawn", { hour: 1, seed: "s", bought: 3 }).amount < pawn.amount, "the buyer has bought three today: it pays less");
  assert.equal(offerFor(R, hammer, "pawn", { hour: 1, seed: "s", budget: 10 }).amount, 10, "no more than its cash");
  assert.ok(conditionShare(R, 0.5) < conditionShare(R, 0.9));
  // The lab's worked example: 120.00, 2 kg in 0.40 x 0.30 x 0.20 m, 5 km: 4.8 kg chargeable, 8.00.
  assert.equal(shippingQuote(R, { kg: 2, dims_m: [0.4, 0.3, 0.2], km: 5 }), m(8));
  const rc = shippedReceipt(R, { price: m(120), taxRate: 0.08625, ship: m(8) });
  assert.deepEqual([rc.seller, rc.commission, rc.carrier, rc.tax, rc.total], [m(110.4), m(9.6), m(8), m(10.35), m(138.35)]);
  assert.equal(rc.seller + rc.commission + rc.carrier + rc.tax, rc.total, "the five lines are the buyer's total");
});

// ---- the world -----------------------------------------------------------------------------------

test("a car collision never grants a tyre, and one incident is one bill however often it is sent", () => {
  const w = world();
  assert.equal(R.found.debris, undefined, "no car parts are loot");
  const take = w.submit("ana", "pick_up", { id: "debris:1", found: { id: "debris:1", item: "car_tire", x: 0, z: 0 } });
  assert.equal(take.ok, false, "a tyre from a crash is not there to take");
  const bills = () => [...w.billing.bills.values()].length;
  w.ledger.mint("player:ana", m(40000), "external_trade");
  const car = w.submit("ana", "buy_vehicle", { model: "economy" });
  assert.ok(car.ok, car.error);
  w.submit("ana", "drive", { vehicle: car.vehicle?.id || car.id || [...w.registry.assets.values()].find((a) => a.kind === "vehicle").id });
  const hit = { kind: "hit_vehicle", speed: 9, other: 0, vehicle: { id: "veh:npc1", plate: "1AAA111", x: 1, z: 0 } };
  const a = w.submit("ana", "collision", hit), n = bills(), health = w.players.get("ana").vitals.health;
  const b = w.submit("ana", "collision", hit);
  assert.ok(a.ok && b.ok);
  assert.equal(bills(), n, "the same crash reported again bills nothing more");
  assert.equal(w.players.get("ana").vitals.health, health, "and hurts no more");
  assert.deepEqual(b.items, [], "nothing to pick up");
  w.ledger.check();
});

test("taking a wheel off your own car: the car loses that wheel, cannot be driven so, and has it back when fitted", () => {
  const w = world();
  w.ledger.mint("player:ana", m(40000), "external_trade");
  w.submit("ana", "buy_vehicle", { model: "economy" });
  const car = [...w.registry.assets.values()].find((a) => a.kind === "vehicle");
  car.attrs.x = 1; car.attrs.z = 0;
  assert.equal(w.submit("ana", "remove_part", { vehicle: car.id }).ok, false, "needs a wrench");
  buy(w, "ana", "wrench", ["shop:hardware"]);
  let r, tries = 0;
  do { r = w.submit("ana", "remove_part", { vehicle: car.id }); tries += 1; assert.ok(r.ok, r.error); } while (r.result === "stuck" && tries < 20);
  assert.equal(car.attrs.wheels, 3);
  assert.equal(w.players.get("ana").inventory.car_tire, 1, "that wheel, and only it");
  const tyre = w.thingBook().heldBy("player:ana", "car_tire")[0];
  assert.equal(tyre.from, car.id, "it knows which car it came off");
  assert.equal(w.submit("ana", "drive", { vehicle: car.id }).ok, false, "not on three wheels");
  const fit = w.submit("ana", "apply", { item: "car_tire", verb: "install", vehicle: car.id });
  assert.ok(fit.ok, fit.error);
  assert.equal(car.attrs.wheels, 4);
  assert.equal(w.submit("ana", "apply", { item: "wrench", verb: "install", vehicle: car.id }).ok, false, "a wrench is not a car part");
  w.ledger.check();
});

test("a delivery: the shop's own goods in their packaging, sealed, paid once on handing over; tampered refused; cancelled refunded once", () => {
  const w = world();
  const cafe = { id: "c1", x: 5, z: 0, name: "Café", keys: ["shop:cafe"] };
  const to = { id: "r9", x: 505, z: 0, name: "9 Elm St" };
  const gig = w.submit("ana", "take_delivery", { place: cafe, to });
  assert.ok(gig.ok, gig.error);
  const B = w.thingBook(), parcel = B.get(gig.delivery.package);
  const sold = new Set(R.stores.kinds.cafe.items);
  const walk = (t) => t.box ? t.box.contents.flatMap((c) => walk(B.get(c))) : [t.sku];
  assert.ok(walk(parcel).every((s) => sold.has(s)), "nothing in it the café does not sell");
  assert.equal(parcel.owner, "resident:r9", "the customer's from checkout; the courier has custody");
  assert.ok(w.carry(w.players.get("ana")).kg >= B.massOf(parcel) - R.items.parcel.kg, "the order weighs what is in it");
  assert.equal(w.submit("ana", "apply", { item: "parcel", verb: "open" }).ok, false, "the courier does not open it");
  assert.equal(w.submit("ana", "use", { item: "parcel" }).ok, false);
  const before = w.ledger.balance("player:ana");
  const done = w.submit("ana", "deliver", { at: { x: 500, z: 3 } });
  assert.ok(done.ok, done.error);
  assert.equal(w.ledger.balance("player:ana"), before + gig.delivery.pay);
  assert.equal(w.submit("ana", "deliver", { at: { x: 500, z: 3 } }).ok, false, "paid once");
  // Tampered: the seal broken on the way is refused, and the pay goes back.
  const g2 = w.submit("ana", "take_delivery", { place: cafe, to, at: { x: 5, z: 0 } });
  assert.ok(g2.ok, g2.error);
  w.thingBook().get(g2.delivery.package).box.seal = "broken";
  const b2 = w.ledger.balance("player:ana");
  const r2 = w.submit("ana", "deliver", { at: { x: 500, z: 3 } });
  assert.ok(r2.ok && r2.pay === 0 && /refused/.test(r2.verdict));
  assert.equal(w.ledger.balance("player:ana"), b2);
  // Cancelled: the order back to the shop, the held pay refunded once.
  const g3 = w.submit("ana", "take_delivery", { place: cafe, to, at: { x: 5, z: 0 } });
  assert.ok(g3.ok, g3.error);
  const esc = g3.delivery.escrow;
  assert.ok(w.ledger.balance(esc) > 0);
  assert.ok(w.submit("ana", "cancel_delivery").ok);
  assert.equal(w.ledger.balance(esc), 0);
  assert.equal(w.thingBook().get(g3.delivery.package).at.kind, "gone");
  w.ledger.check();
});

test("a found box shows the same contents to whoever opens it, after any number of reloads", () => {
  const seen = new Set();
  for (let k = 0; k < 100; k += 1) {
    let w = world();
    w.submit("bo", "join", { name: "Bo", at: AT });
    if (k % 2) w = CityWorld.fromJSON(R, JSON.parse(JSON.stringify(w)));
    const who = k % 3 ? "ana" : "bo";
    const r = w.submit(who, "pick_up", { id: "found:d:1:7", found: { id: "found:d:1:7", item: "storage_box", x: 0, z: 0, box: true } });
    assert.ok(r.ok, r.error);
    const box = w.thingBook().get("found:found:d:1:7");
    seen.add(box.box.contents.map((c) => w.thingBook().get(c).sku).join(","));
  }
  assert.equal(seen.size, 1, `the same basket every time: ${[...seen].join(" | ")}`);
});

test("nested bags cannot hide weight; a backpack's carry is not counted twice", () => {
  const w = world();
  const p = w.players.get("ana");
  buy(w, "ana", "grocery_tote", ["shop:grocery"]);
  buy(w, "ana", "brick", ["shop:hardware"], 3);
  const kg0 = w.carry(p).kg;
  for (let i = 0; i < 3; i += 1) assert.ok(w.submit("ana", "apply", { item: "grocery_tote", verb: "pack", what: "brick" }).ok);
  assert.equal(p.inventory.brick, undefined, "the bricks are in the tote now");
  assert.ok(Math.abs(w.carry(p).kg - kg0) < 0.02, "and still weigh what they weigh");
  buy(w, "ana", "backpack", ["shop:clothing"], 2);
  assert.equal(w.carry(p).capacity - w.carry({ ...p, inventory: { ...p.inventory, backpack: 1 } }).capacity, 0, "two backpacks carry no more than one");
  assert.ok(w.submit("ana", "apply", { item: "grocery_tote", verb: "unpack" }).ok);
  assert.equal(p.inventory.brick, 3);
});

test("selling: one identity, one buyer, at the counter that knows it; the offer holds, the second sale is refused", () => {
  const w = world();
  buy(w, "ana", "hammer", ["shop:hardware"]);
  const hw = { id: "hw1", x: 3, z: 0, name: "Hardware", keys: ["shop:hardware"] };
  const q = w.submit("ana", "sell_quote", { item: "hammer", channel: "specialist", place: hw });
  assert.ok(q.ok, q.error);
  assert.equal(w.submit("ana", "sell_quote", { item: "hammer", channel: "specialist", place: hw }).quote.amount, q.quote.amount, "asking again: the same quote");
  assert.equal(w.submit("ana", "sell_quote", { item: "hammer", channel: "pawn", place: hw }).ok, false, "a hardware store has no second-hand counter");
  const before = w.ledger.balance("player:ana");
  const s = w.submit("ana", "sell", { quote: q.quote.id });
  assert.ok(s.ok, s.error);
  assert.equal(w.ledger.balance("player:ana"), before + q.quote.amount);
  const th = w.thingBook().get(q.quote.thing);
  assert.equal(th.at.kind, "shelf"); assert.equal(th.owner, "business:hw1");
  assert.equal(w.submit("ana", "sell", { quote: q.quote.id }).ok, false, "the same thing is not sold twice");
  assert.equal(w.players.get("ana").inventory.hammer, undefined);
  buy(w, "ana", "burger_fries", ["shop:american"]);
  assert.equal(w.submit("ana", "sell_quote", { item: "burger_fries", channel: "pawn", place: { id: "g", x: 1, z: 0, keys: ["shop:shop"] } }).ok, false, "prepared food is not resold");
  w.ledger.check();
});

test("a listing waits for a buyer; shipped, the buyer's money is held and paid out in five parts once it is sealed and handed over", () => {
  const w = world();
  buy(w, "ana", "book", ["shop:books"]);
  buy(w, "ana", "padded_envelope", ["shop:print_ship"]);
  const l = w.submit("ana", "list_item", { item: "book", channel: "shipped", price: m(18) });
  assert.ok(l.ok, l.error);
  assert.equal(w.submit("ana", "sell_quote", { item: "book", channel: "pawn", place: { id: "g", x: 1, z: 0, keys: ["shop:shop"] } }).ok, false, "listed: promised to a buyer");
  let hours = 0;
  while (w.listingsOf("ana")[0].status === "listed" && hours < 24 * 7) { hours += 6; w.step(NOON + hours * 3_600_000); }
  const listing = w.listingsOf("ana")[0];
  assert.equal(listing.status, "buyer", "a buyer within the week at a fair price");
  const inbox = w.inbox("ana").tabs.npc.find((t) => t.kind === "market");
  assert.ok(inbox && inbox.msgs.at(-1).choices.length === 2, "the buyer's offer is a message with Sell / Not to them");
  const acc = w.submit("ana", "accept_buyer", { listing: listing.id });
  assert.ok(acc.ok && acc.receipt, acc.error);
  const ps = { id: "ps", x: 1, z: 0, name: "Print and ship", keys: ["shop:print_ship"] };
  assert.equal(w.submit("ana", "ship_listing", { listing: listing.id, place: ps }).ok, false, "pack it first");
  assert.ok(w.submit("ana", "apply", { item: "padded_envelope", verb: "pack", what: "book" }).ok);
  assert.ok(w.submit("ana", "apply", { item: "padded_envelope", verb: "seal" }).ok);
  const before = w.ledger.balance("player:ana");
  const sh = w.submit("ana", "ship_listing", { listing: listing.id, place: ps });
  assert.ok(sh.ok, sh.error);
  assert.equal(w.ledger.balance("player:ana"), before + acc.receipt.seller);
  assert.equal(w.ledger.balance(listing.escrow), 0, "the buyer's money paid out whole");
  assert.equal(w.ledger.balance("business:platform"), acc.receipt.commission);
  w.ledger.check();
});

test("consignment sells for you, less the shop's share, or comes back to collect", () => {
  const w = world();
  buy(w, "ana", "framed_print", ["shop:gallery"]);
  const gal = { id: "gal", x: 2, z: 0, name: "Gallery", keys: ["shop:gallery"] };
  const c = w.submit("ana", "consign", { item: "framed_print", place: gal });
  assert.ok(c.ok, c.error);
  assert.equal(w.players.get("ana").inventory.framed_print, undefined, "left at the shop");
  w.step(NOON + 15 * 86_400_000);
  const rec = w.consignedOf("ana")[0] || [...w._commerce.consigned.values()][0];
  assert.ok(["sold", "returned"].includes(rec.status), rec.status);
  if (rec.status === "sold") assert.equal(rec.paid, rec.price - Math.round(rec.price * R.commerce.resale.channels.consignment.commission));
  else { assert.ok(w.submit("ana", "collect_consigned", { consignment: rec.id, at: { x: 2, z: 0 } }).ok); assert.equal(w.players.get("ana").inventory.framed_print, 1); }
  w.ledger.check();
});

test("uses: read, put up at home (it rests you better), give, cook, freshen up, fill and drink, light, charge, lock, take apart", () => {
  const w = world();
  w.players.get("ana").home = { room: "room:h", building: "h", x: 0, z: 0, paid_until: NOON + 7 * 86_400_000 };
  const p = w.players.get("ana");
  buy(w, "ana", "book", ["shop:books"]);
  const rd = w.submit("ana", "apply", { item: "book", verb: "read" });
  assert.ok(rd.ok && rd.first && rd.reading > 0, rd.error);
  assert.equal(w.submit("ana", "apply", { item: "book", verb: "read" }).first, false, "read again: less from it");
  buy(w, "ana", "lamp", ["shop:home"]); buy(w, "ana", "house_plant", ["shop:home"]);
  assert.ok(w.submit("ana", "apply", { item: "lamp", verb: "place" }).ok);
  const pl = w.submit("ana", "apply", { item: "house_plant", verb: "place" });
  assert.ok(pl.comfort.rest_bonus > 0);
  assert.equal(comfortOf(R, ["lamp", "lamp"]).points, comfortOf(R, ["lamp"]).points, "two lamps light a room no better than one");
  buy(w, "ana", "bouquet", ["shop:florist"]);
  assert.equal(w.submit("ana", "apply", { item: "bouquet", verb: "gift" }).ok, false, "to whom?");
  const gift = w.submit("ana", "apply", { item: "bouquet", verb: "gift", npc: { id: "npc:7", name: "Lee", x: 1, z: 0 } });
  assert.ok(gift.ok && w.rapportOf("ana", "npc:7") > 0, gift.error);
  buy(w, "ana", "dry_pasta", ["shop:grocery"]); buy(w, "ana", "vegetables", ["shop:grocery"]);
  const cook = w.submit("ana", "apply", { item: "dry_pasta", verb: "cook" });
  assert.ok(cook.ok && p.inventory.pasta_dish === 2 && !p.inventory.dry_pasta, cook.error);
  buy(w, "ana", "toothpaste", ["shop:grocery"]);
  assert.ok(w.submit("ana", "apply", { item: "toothpaste", verb: "groom" }).ok && p.fresh_until > NOON);
  buy(w, "ana", "bucket", ["shop:hardware"]);
  assert.ok(w.submit("ana", "apply", { item: "bucket", verb: "fill" }).ok, "filled at home");
  const drink = w.submit("ana", "apply", { item: "bucket", verb: "drink_fill" });
  assert.ok(drink.ok, drink.error);
  assert.equal(w.submit("ana", "apply", { item: "bucket", verb: "drink_fill" }).ok, false, "empty now");
  buy(w, "ana", "candle", ["shop:home"]);
  assert.equal(w.submit("ana", "apply", { item: "candle", verb: "light" }).ok, false, "a candle needs a lighter");
  buy(w, "ana", "lighter", ["shop:convenience"]);
  assert.ok(w.submit("ana", "apply", { item: "candle", verb: "light" }).lit);
  buy(w, "ana", "flashlight", ["shop:hardware"]);
  const torch = w.thingBook().ensure("player:ana", "flashlight", 1);
  torch.charge = 0;
  assert.equal(w.submit("ana", "apply", { item: "flashlight", verb: "light" }).ok, false, "flat");
  buy(w, "ana", "batteries", ["shop:hardware"]);
  const ch = w.submit("ana", "apply", { item: "batteries", verb: "charge", device: "flashlight" });
  assert.ok(ch.ok && ch.charge === 1, ch.error);
  assert.ok(w.submit("ana", "apply", { item: "flashlight", verb: "light" }).lit);
  buy(w, "ana", "small_table", ["shop:home"]);
  assert.equal(w.submit("ana", "apply", { item: "small_table", verb: "disassemble" }).ok, false, "needs a tool");
  buy(w, "ana", "hammer", ["shop:hardware"]);
  const apart = w.submit("ana", "apply", { item: "small_table", verb: "disassemble" });
  assert.ok(apart.ok, apart.error);
  assert.ok((p.inventory.lumber || 0) <= R.commerce.uses.disassemble.yields.small_table.lumber, "no more wood than the table held");
  // Verbs only where they make sense.
  const verbs = (sku) => w.verbsFor("ana", sku).map((v) => v.verb);
  assert.ok(verbs("hammer").includes("repair") && !verbs("hammer").includes("read"));
  assert.ok(verbs("candle").includes("gift") && verbs("candle").includes("light"));
  const kit = repairKit(R, "glass", { screwdriver: 1 });
  assert.match(kit.missing, /caulk/);
  w.ledger.check();
});

test("a lock on your car stops a thief without bolt cutters; with them, the lock is cut", () => {
  const w = world();
  w.submit("bo", "join", { name: "Bo", at: AT });
  w.ledger.mint("player:ana", m(40000), "external_trade");
  w.ledger.mint("player:bo", m(500), "external_trade");
  w.submit("ana", "buy_vehicle", { model: "economy" });
  const car = [...w.registry.assets.values()].find((a) => a.kind === "vehicle");
  car.attrs.x = 1; car.attrs.z = 0;
  buy(w, "ana", "padlock", ["shop:hardware"]);
  assert.ok(w.submit("ana", "apply", { item: "padlock", verb: "lock", vehicle: car.id }).ok);
  assert.equal(w.submit("bo", "take", { asset: car.id }).ok, false, "locked");
  buy(w, "bo", "bolt_cutters", ["shop:hardware"]);
  w.submit("bo", "hold", { item: "bolt_cutters" });
  const t = w.submit("bo", "take", { asset: car.id });
  assert.ok(t.ok, t.error);
  assert.equal(car.attrs.locked, null, "the lock was cut");
});

test("vandalism yields litter, not goods; mending what you broke clears the court's repair bill", () => {
  const w = world();
  w.R = { ...R, objects: { "building.window": { name: "Window", material: "glass", break_j: 60 } } };
  const win = { key: "building.window@1,0", archetype: "building.window", x: 1, z: 0 };
  let r, n = 0;
  do { r = w.submit("ana", "strike", { target: win, witnesses: 1 }); n += 1; } while (!r.broken && n < 50);
  assert.ok(r.broken);
  assert.equal(r.salvage, undefined); assert.equal(r.litter, "glass_shards");
  const bill = [...w.billing.bills.values()].find((b) => b.key === `restitution:${win.key}`);
  assert.ok(bill && bill.status === "open");
  buy(w, "ana", "screwdriver", ["shop:hardware"]); buy(w, "ana", "caulk", ["shop:hardware"], 3);
  let fix;
  for (let i = 0; i < 3; i += 1) { fix = w.submit("ana", "apply", { item: "screwdriver", verb: "repair", target: win }); assert.ok(fix.ok, fix.error); if (fix.mended) break; }
  assert.ok(fix.mended);
  assert.equal(bill.status, "dismissed", "mended by the one who broke it");
  // The glass on the pavement: swept into a trash bag, for the street-cleaning pay.
  buy(w, "ana", "broom", ["shop:hardware"]); buy(w, "ana", "trash_bag", ["shop:hardware"]);
  const litter = [...w.items.values()].filter((x) => x.by === "litter").map((x) => x.id);
  const sw = w.submit("ana", "apply", { item: "broom", verb: "clean", litter });
  assert.ok(sw.ok && sw.swept === litter.length && sw.pay > 0, sw.error);
  w.ledger.check();
});

test("hit by a car with an order in your arms: what is inside takes the fall, drawn once", () => {
  const w = world();
  const cafe = { id: "c1", x: 5, z: 0, name: "Café", keys: ["shop:restaurant"] };
  const gig = w.submit("ana", "take_delivery", { place: cafe, to: { id: "r9", x: 505, z: 0 } });
  assert.ok(gig.ok, gig.error);
  const hit = { kind: "hit_by_car", speed: 6, vehicle: { id: "veh:z", plate: "1ZZZ999", x: 0, z: 0, yaw: 0 } };
  assert.ok(w.submit("ana", "collision", hit).ok);
  const B = w.thingBook();
  const states = (t) => (t.box?.contents || []).flatMap((c) => [JSON.stringify([B.get(c).spilled || false, B.get(c).condition.integrity]), ...states(B.get(c))]);
  const once = states(B.get(gig.delivery.package)).join();
  assert.ok(w.submit("ana", "collision", hit).ok);
  assert.equal(states(B.get(gig.delivery.package)).join(), once, "the same incident does not fall twice");
});

test("the books survive a save: records, listings and skills come back as they were", () => {
  const w = world();
  buy(w, "ana", "toolbox", ["shop:hardware"]);
  w.submit("ana", "apply", { item: "toolbox", verb: "inspect" });
  const again = CityWorld.fromJSON(R, JSON.parse(JSON.stringify(w)));
  assert.equal(again.thingBook().heldBy("player:ana", "toolbox").length, 1);
  assert.deepEqual(again.thingBook().heldBy("player:ana", "toolbox")[0].latent, w.thingBook().heldBy("player:ana", "toolbox")[0].latent);
  again.ledger.check();
});
