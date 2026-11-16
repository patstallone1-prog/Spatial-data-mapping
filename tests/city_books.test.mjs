// A business's books (docs/city/books.mjs, enterprise.mjs): the periods, the items, the costs and
// the balance sheet are sums of what the world recorded as it happened; only days before the
// records begin are estimated, and every total says how many.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { analyse, foldDay, weekOf } from "../docs/city/books.mjs";
import { cityTime, loadRules } from "../docs/city/core.mjs";
import { estimateWeek, modelWeek } from "../docs/city/enterprise.mjs";
import { CityWorld } from "../docs/city/world.mjs";
import { viewFor } from "../server/city/views.mjs";

const R = loadRules(JSON.parse(readFileSync(new URL("../docs/city/rules.json", import.meta.url))));
const m = R.money;
const DAY = 86_400_000, HOUR = 3_600_000;
const MON_6 = Date.UTC(2026, 10, 9, 14, 0);
const MARINA = { lon: -122.4368, lat: 37.8003, county: "county:san-francisco" };
const vacant = { id: "w100", x: 0, z: 0, name: "2001 Chestnut St", keys: ["use:retail"], area: 120, ...MARINA };
const cafe = { id: "w200", x: 40, z: 0, name: "Corner Café", keys: ["use:retail", "shop:cafe"], area: 90, ...MARINA };
const at = (pl) => ({ x: pl.x, z: pl.z, lon: pl.lon, lat: pl.lat, county: pl.county });
function runTo(w, t) { for (let x = w.now; x < t; x += HOUR) w.step(Math.min(t, x + HOUR)); w.step(t); }
function world() {
  const w = new CityWorld(R, { now: MON_6, seed: "books-test" });
  w.submit("ana", "join", { name: "Ana", at: at(vacant) });
  w.submit("ben", "join", { name: "Ben", at: at(vacant) });
  w.ledger.mint("player:ana", m(90_000), "account_grant", { at: MON_6 });
  return w;
}
function openCafe(w) {
  assert.equal(w.submit("ana", "lease_storefront", { place: vacant, at: at(vacant) }).ok, true);
  const r = w.submit("ana", "register_business", { place: vacant, kind: "cafe", name: "Ana's Kitchen", rivals: 1, at: at(vacant) });
  assert.equal(r.ok, true, r.error);
  const id = r.business.id;
  w.submit("ana", "fund_business", { business: id, amount: m(30_000) });
  const items = Object.fromEntries(R.stores.kinds.cafe.items.map((it) => [it, 400]));
  assert.equal(w.submit("ana", "order_stock", { business: id, items }).ok, true);
  for (const c of w.candidatesFor(w.biz.get(id)).slice(0, 3)) w.submit("ana", "hire", { business: id, candidate: c.id });
  return id;
}

test("a day's line folds into its week with what sold; the periods are sums of the recorded days", () => {
  const rec = {};
  for (let d = 700; d < 714; d += 1) foldDay(rec, { day: d, sales: 1000, cogs: 400, wages: 300, rent: 100, fees: 0, tax: 80, profit: 200, orders: 10, units: 25, served: 10, lost: 1, visits: 30 }, { coffee: [20, 800, 300], pastry: [5, 200, 100] });
  assert.equal(rec.since, 700);
  assert.equal(rec.weeks.reduce((s, w) => s + w.days, 0), 14);
  assert.equal(rec.weeks.reduce((s, w) => s + w.sales, 0), 14000);
  const a = analyse(rec, { today: 714 });
  const month = a.periods[0];
  assert.equal(month.sales, 14000);
  assert.equal(month.profit, 2800);
  assert.equal(month.estimated_days, 0);
  assert.equal(month.missing_days, 16, "the days before the records, with no estimate asked for, are left out");
  assert.equal(a.orders.average, 100);
  assert.equal(a.items[0].id, "coffee");
  assert.equal(a.items[0].share, 0.8);
  assert.equal(a.items[0].margin, 0.625);
  assert.equal(a.items[0].weekly.reduce((s, w) => s + w.units, 0), 280);
  assert.equal(a.costs[0].total, 14 * 800);
  assert.equal(a.weekly.reduce((s, w) => s + w.sales, 0), 14000);
  assert.equal(a.estimated, false);
});

test("days before the records begin are estimated from the typical week, counted, and never mixed in silently", () => {
  const rec = {};
  for (let d = 700; d < 710; d += 1) foldDay(rec, { day: d, sales: 1000, cogs: 400, wages: 300, rent: 100, fees: 0, tax: 0, profit: 200, orders: 10, units: 25 }, {});
  const est = (week) => ({ week, sales: 7000, cogs: 2800, wages: 2100, rent: 700, fees: 0, tax: 0, profit: 1400, orders: 70, units: 140, items: { coffee: [140, 7000, 2800] } });
  const a = analyse(rec, { today: 710, estimate: est });
  assert.equal(a.periods[0].estimated_days, 20);
  assert.equal(a.periods[0].sales, 10 * 1000 + 20 * 1000);
  assert.equal(a.periods[2].estimated_days, 355);
  assert.equal(a.estimated, true);
  assert.ok(a.weekly.some((w) => w.estimated) && a.weekly.some((w) => !w.estimated));
  // A week fully on record is not touched by the estimate.
  const full = a.weekly.find((w) => w.week === weekOf(701) && !w.partly_estimated);
  if (full) assert.equal(full.sales, full.days * 1000);
});

test("a business's books are the world's own record: customers by the hour and players at the counter, by item", () => {
  const w = world();
  const id = openCafe(w);
  runTo(w, MON_6 + 2 * DAY);
  w.submit("ben", "checkout", { place: vacant, cart: [{ item: "coffee", qty: 2 }], at: at(vacant) });
  runTo(w, MON_6 + 9 * DAY);
  const b = w.biz.get(id);
  assert.ok(b.books.length >= 7 && b.weeks.length >= 1);
  const a = w.businessBooks(b);
  const month = a.periods[0];
  const recorded = b.books.filter((d) => d.day >= w.time.day - 30);
  assert.ok(month.estimated_days > 0 && month.estimated_days < 30, "the days before it opened are the estimate");
  assert.ok(month.sales > recorded.reduce((s, d) => s + d.sales, 0));
  // The weeks' items add up to the days' units and sales: nothing sold is missing from the breakdown.
  const units = b.weeks.reduce((s, x) => s + Object.values(x.items || {}).reduce((n, i) => n + i[0], 0), 0);
  const sold = b.weeks.reduce((s, x) => s + Object.values(x.items || {}).reduce((n, i) => n + i[1], 0), 0);
  assert.equal(Math.round(units), b.books.reduce((s, d) => s + d.units, 0));
  assert.equal(sold, b.books.reduce((s, d) => s + d.sales, 0));
  assert.ok(b.books.some((d) => d.player_sales > 0), "Ben's coffees are in the day's line");
  assert.ok(a.items.length > 3 && a.items[0].units >= a.items[1].units);
  assert.ok(a.items.every((i) => i.margin > 0 && i.margin < 1));
  assert.ok(a.orders.average > 0 && a.orders.count > 0);
  assert.ok(a.recent.length > 10 && a.recent.length <= 60 && a.recent.some((t) => /takings/.test(t.memo)) && a.recent[0].t >= a.recent.at(-1).t, "newest first");
  // The balance sheet: what it has less what it owes.
  const bs = a.balance;
  assert.equal(bs.equity, bs.total_assets - bs.total_liabilities);
  assert.ok(bs.assets.some(([k]) => /till/.test(k)) && bs.assets.some(([k]) => /Stock/.test(k)));
  // Days differ: the same shop is not equally busy every day.
  assert.ok(new Set(b.books.map((d) => d.visits)).size > 3);
  w.ledger.check();
});

test("a resident's shop keeps books from the day a player first deals with it, and they pass to whoever buys it", () => {
  const w = world();
  assert.equal(w.shops.size, 0);
  const before = w.shopBooks(cafe, 1);
  assert.equal(before.recorded_since, null);
  assert.equal(before.periods[0].estimated_days, 30, "nothing on record yet: all estimated, and it says so");
  assert.equal(w.submit("ben", "checkout", { place: cafe, cart: [{ item: "coffee", qty: 1 }], at: at(cafe) }).ok, true);
  assert.equal(w.shops.size, 1);
  runTo(w, MON_6 + 5 * DAY);
  const s = w.shops.get("w200");
  assert.ok(s.books.length >= 4);
  assert.ok(s.books[0].player_sales > 0);
  const after = w.shopBooks(cafe, 1);
  assert.equal(after.recorded_since, s.since);
  assert.ok(after.periods[0].estimated_days < 30);
  // Only who dealt with it is shown its books; the buyer inherits them.
  assert.equal(viewFor(w, "ana").enterprise.shops.length, 0);
  assert.equal(viewFor(w, "ben").enterprise.shops.length, 1);
  const again = CityWorld.fromJSON(R, JSON.parse(JSON.stringify(w.toJSON())));
  assert.equal(again.shops.get("w200").books.length, s.books.length);
  const r = w.submit("ana", "buy_business", { place: cafe, financed: true, rivals: 1, at: at(cafe) });
  assert.equal(r.ok, true, r.error);
  assert.equal(w.shops.size, 0);
  assert.ok(w.biz.get(r.business.id).books.length >= 4);
  assert.equal(w.biz.get(r.business.id).since, s.since);
});

test("the estimate is the buying model's typical week, and an owner's books are not shown to anyone else", () => {
  const e = estimateWeek(R, cafe, "cafe", { rivals: 1, week: 3 }), mw = modelWeek(R, cafe, "cafe", { rivals: 1, week: 3 });
  assert.equal(e.sales, mw.sales);
  assert.equal(e.profit, mw.profit);
  assert.equal(Object.values(e.items).reduce((s, x) => s + x[1], 0) > 0, true);
  const w = world();
  const id = openCafe(w);
  runTo(w, MON_6 + 3 * DAY);
  const seen = viewFor(w, "ben").enterprise.biz.find((b) => b.id === id);
  assert.deepEqual([seen.books, seen.weeks, seen.tx], [[], [], []]);
  assert.ok(viewFor(w, "ana").enterprise.biz.find((b) => b.id === id).weeks.length);
  assert.equal(cityTime(w.now, R.clock.zone).day, w.time.day);
});
