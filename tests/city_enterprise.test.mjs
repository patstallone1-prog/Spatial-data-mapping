// Businesses, the law and careers (docs/city/enterprise.mjs; plan docs/37-business-legal-and-careers-plan.md):
// a business's week of books balances, demand answers to price, a shift is staffed or not,
// people quit when worked too hard for too little, an NPC's shop is bought on the seller's terms;
// the verdict's tilt follows the lawyer's skill, lawyers are never a real tenant's people, jail is
// a told time skip, an unpaid fine goes to court; experience, promotions and recruiters; a player
// can be another's employee but not their lawyer.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { cityTime, loadRules } from "../docs/city/core.mjs";
import { hourOf, lawyersAt, leastWage, nameKey, oddsLabel, rolesFor, verdictWeights } from "../docs/city/enterprise.mjs";
import { CityWorld, PLAYER_COMMANDS } from "../docs/city/world.mjs";

const R = loadRules(JSON.parse(readFileSync(new URL("../docs/city/rules.json", import.meta.url))));
const m = R.money;
const DAY = 86_400_000, HOUR = 3_600_000;
// Monday 2026-11-09 06:00 in San Francisco (UTC-8).
const MON_6 = Date.UTC(2026, 10, 9, 14, 0);
const MARINA = { lon: -122.4368, lat: 37.8003, county: "county:san-francisco" };
const vacant = { id: "w100", x: 0, z: 0, name: "2001 Chestnut St", keys: ["use:retail"], area: 120, ...MARINA };
const cafe = { id: "w200", x: 40, z: 0, name: "Corner Café", keys: ["use:retail", "shop:cafe"], area: 90, ...MARINA };
const lawOffice = { id: "w300", x: 80, z: 0, name: "Dolan Law Firm", keys: ["use:office", "shop:law_office"], ...MARINA };
const at = (pl) => ({ x: pl.x, z: pl.z, lon: pl.lon, lat: pl.lat, county: pl.county });

function world(now = MON_6) {
  const w = new CityWorld(R, { now, seed: "enterprise-test" });
  w.submit("ana", "join", { name: "Ana", at: at(vacant) });
  w.ledger.mint("player:ana", m(60_000), "account_grant", { at: now });
  return w;
}
function openCafe(w, { name = "Ana's Kitchen", fund = 20_000 } = {}) {
  assert.equal(w.submit("ana", "lease_storefront", { place: vacant, at: at(vacant) }).ok, true);
  const r = w.submit("ana", "register_business", { place: vacant, kind: "cafe", name, rivals: 1, at: at(vacant) });
  assert.equal(r.ok, true, r.error);
  const id = r.business.id;
  assert.equal(w.submit("ana", "fund_business", { business: id, amount: m(fund) }).ok, true);
  return id;
}
function runTo(w, t) { for (let x = w.now; x < t; x += HOUR) w.step(Math.min(t, x + HOUR)); w.step(t); }

test("the new commands are the world's, and the law office and staffing agency are store kinds told by name", () => {
  for (const c of ["register_business", "buy_business", "hire", "fire", "hire_lawyer", "attend_court", "headhunt", "take_offer", "expunge"]) assert.ok(PLAYER_COMMANDS.includes(c), c);
  assert.ok(R.stores.kinds.law_office && R.stores.kinds.staffing);
  // Money in the new rules is in minor units; shares and weights are not.
  assert.equal(R.business.licences.registration.fee_base, m(91));
  assert.equal(R.business.law.roles.criminal.fee_base, m(900));
  assert.equal(R.business.law.k, 2.4);
  assert.equal(R.business.buying.down_share, 0.3);
});

test("registering: premises first, a name of your own, the licences paid to the city", () => {
  const w = world();
  assert.equal(w.submit("ana", "register_business", { place: vacant, kind: "cafe", name: "Mine", at: at(vacant) }).ok, false, "no premises");
  assert.equal(w.submit("ana", "lease_storefront", { place: cafe, at: at(cafe) }).ok, false, "a let storefront");
  assert.equal(w.submit("ana", "lease_storefront", { place: vacant, at: at(vacant) }).ok, true);
  w.knowTenants(["Blue Bottle Coffee"]);
  const real = w.submit("ana", "register_business", { place: vacant, kind: "cafe", name: "blue bottle coffee", at: at(vacant) });
  assert.equal(real.ok, false); assert.match(real.error, /real business/);
  assert.equal(w.submit("ana", "register_business", { place: vacant, kind: "law_office", name: "Ana Law", at: at(vacant) }).ok, false, "no player law firms");
  const before = w.ledger.balance("player:ana");
  const r = w.submit("ana", "register_business", { place: vacant, kind: "cafe", name: "Ana's Kitchen", at: at(vacant) });
  assert.equal(r.ok, true);
  // Registration and a health permit, for a café.
  assert.ok(r.fees > m(91 + 380) && r.fees < m(91 + 1100));
  assert.equal(before - w.ledger.balance("player:ana"), r.fees);
  assert.ok(w.ledger.balance("treasury:city:san-francisco") >= r.fees);
  assert.equal(w.registry.get(r.business.id).owner, "player:ana");
  assert.equal(w.submit("ana", "status").businesses.length, 1);
});

test("a business's week: stock in the next morning, staff on shift, customers, and books that balance", () => {
  const w = world();
  const id = openCafe(w);
  const b = w.biz.get(id);
  const order = w.submit("ana", "order_stock", { business: id, items: { coffee: 300, latte: 200, pastry: 150, sandwich: 100, tea: 80, water: 80 } });
  assert.equal(order.ok, true, order.error);
  assert.equal(b.stock.coffee || 0, 0, "not on the shelves yet");
  const cands = w.submit("ana", "candidates", { business: id }).candidates;
  assert.equal(cands.length, R.business.staff.candidates);
  assert.ok(cands.every((c) => c.ask >= leastWage(R) && c.ask < m(40) && rolesFor(R, "cafe").includes(c.role)), "real San Francisco wages");
  const low = w.submit("ana", "hire", { business: id, candidate: cands[0].id, wage: cands[0].ask - 100 });
  assert.equal(low.ok, false); assert.match(low.error, /asks at least/);
  assert.equal(w.submit("ana", "hire", { business: id, candidate: cands[0].id, shifts: [{ days: [0, 1, 2, 3, 4, 5, 6], from: 7, to: 14 }] }).ok, true);
  assert.equal(w.submit("ana", "hire", { business: id, candidate: cands[1].id, shifts: [{ days: [0, 1, 2, 3, 4, 5, 6], from: 14, to: 21 }] }).ok, true);
  const funded = w.ledger.balance(b.account);
  runTo(w, MON_6 + 7 * DAY + 2 * HOUR);
  w.closeDay(b);
  assert.ok(b.stock.coffee < 300, "the coffee came, and sold");
  assert.ok(b.books.length >= 7);
  const sum = (k) => b.books.reduce((s, d) => s + (d[k] || 0), 0);
  assert.ok(sum("sales") > 0 && sum("wages") > 0 && sum("served") > 50, `sold ${sum("sales")} to ${sum("served")}`);
  // Every credit in or out is in the books: takings in, wages, rent and fees out (the order was before).
  assert.equal(w.ledger.balance(b.account) - funded, sum("sales") - sum("wages") - sum("rent") - sum("fees") - (sum("ordered") - order.cost));
  assert.ok(sum("rent") >= R.business.storefront_lease_per_week, "a week's rent, from the till");
  w.ledger.check();
  assert.ok(b.week && b.week.sales > 0, "Monday's summary of the week");
  // The staff's taxes were withheld.
  assert.ok(sum("withheld") > 0 && w.ledger.balance("authority:ssa") > 0);
});

test("demand answers to price: dearer sells fewer, and groceries more so than prepared food", () => {
  const t = cityTime(MON_6 + 6 * HOUR + HOUR / 2);   // noon
  const staff = [{ id: "s", wage: m(20), skill: 1, morale: 80, shifts: [{ days: [0, 1, 2, 3, 4, 5, 6], from: 0, to: 24 }] }, { id: "s2", wage: m(20), skill: 1, morale: 80, shifts: [{ days: [0, 1, 2, 3, 4, 5, 6], from: 0, to: 24 }] }];
  const units = (kind, item, pf) => {
    const b = { kind, status: "open", hours: [0, 24], prices: { [item]: pf }, stock: { [item]: 1e6 }, reputation: 60, rivals: 1, staff, chain: [] };
    let n = 0;
    for (let i = 0; i < 20; i += 1) n += hourOf(R, b, t).units[item] || 0;
    return n;
  };
  const cheap = units("cafe", "coffee", 0.8), dear = units("cafe", "coffee", 1.6);
  assert.ok(dear < cheap, `${dear} < ${cheap}`);
  const gCheap = units("grocery", "milk", 0.8), gDear = units("grocery", "milk", 1.6);
  assert.ok(gDear / gCheap < dear / cheap, "groceries fall off faster");
});

test("a shift is staffed or the customers walk out; an hour closed sells nothing", () => {
  const t = cityTime(MON_6 + 6 * HOUR + HOUR / 2);
  const base = { kind: "cafe", status: "open", hours: [7, 21], prices: {}, stock: { coffee: 999, pastry: 999 }, reputation: 60, rivals: 0, chain: [] };
  const staffed = hourOf(R, { ...base, staff: [{ id: "s", wage: m(20), skill: 0.7, morale: 80, shifts: [{ days: [0, 1, 2, 3, 4, 5, 6], from: 7, to: 15 }] }] }, t);
  assert.equal(staffed.on, 1);
  assert.ok(staffed.served > 1 && staffed.wages.s === m(20));
  const empty = hourOf(R, { ...base, stock: { coffee: 999, pastry: 999 }, staff: [] }, t);
  assert.equal(empty.served, 0); assert.ok(empty.lost > 1 && empty.understaffed);
  const night = hourOf(R, { ...base, staff: [] }, cityTime(MON_6 - 4 * HOUR));
  assert.equal(night.open, false); assert.equal(night.sales, 0);
});

test("worked too hard for too little, people give notice and go; firing pays what is owed", () => {
  const w = world();
  const id = openCafe(w);
  w.submit("ana", "order_stock", { business: id, items: { coffee: 400, latte: 300 } });
  const b = w.biz.get(id);
  const c = w.candidatesFor(b).sort((x, y) => x.ask - y.ask)[0];
  w.submit("ana", "hire", { business: id, candidate: c.id, shifts: [{ days: [0, 1, 2, 3, 4, 5, 6], from: 7, to: 21 }] });
  const s = b.staff[0];
  s.wage = leastWage(R); s.morale = 22;   // under the barista's going rate, alone at a busy counter
  runTo(w, MON_6 + 3 * DAY);
  assert.ok(s.morale < 22, `morale ${s.morale}`);
  assert.ok(s.notice, "gave a week's notice");
  runTo(w, s.notice + DAY + HOUR);
  assert.equal(b.staff.length, 0, "and left");
  // Firing someone else pays out the day and their holiday.
  const c2 = w.candidatesFor(b)[0];
  w.submit("ana", "hire", { business: id, candidate: c2.id, shifts: [{ days: [0, 1, 2, 3, 4, 5, 6], from: 7, to: 15 }] });
  runTo(w, w.now + 2 * DAY);
  const before = w.ledger.balance("business:residents");
  assert.equal(w.submit("ana", "fire", { business: id, staff: b.staff[0].id }).ok, true);
  assert.ok(w.ledger.balance("business:residents") > before);
  w.ledger.check();
});

test("orders to staff in the shop: a break lifts morale, go home ends the day", () => {
  const w = world(MON_6 + 3 * HOUR);   // 09:00
  const id = openCafe(w);
  const b = w.biz.get(id);
  const c = w.candidatesFor(b)[0];
  w.submit("ana", "hire", { business: id, candidate: c.id, shifts: [{ days: [0, 1, 2, 3, 4, 5, 6], from: 7, to: 15 }] });
  const s = b.staff[0], m0 = s.morale;
  assert.equal(w.submit("ana", "order_staff", { business: id, staff: s.id, order: "break", at: at(vacant) }).ok, true);
  assert.ok(s.morale > m0);
  assert.equal(w.submit("ana", "order_staff", { business: id, staff: s.id, order: "go_home", at: { ...at(vacant), x: 500 } }).ok, false, "from outside the shop");
  assert.equal(w.submit("ana", "order_staff", { business: id, staff: s.id, order: "go_home", at: at(vacant) }).ok, true);
  assert.equal(hourOf(R, b, cityTime(w.now + HOUR)).on, 0);
});

test("buying an NPC's shop: modelled books, 30% down, the seller paid monthly, and back to them after two missed", () => {
  const w = world();
  w.ledger.mint("player:ana", m(400_000), "account_grant", { at: w.now });
  const ap = w.submit("ana", "appraise_business", { place: cafe, rivals: 1 });
  assert.equal(ap.ok, true, ap.error);
  const a = ap.appraisal;
  assert.equal(a.kind, "cafe"); assert.equal(a.books.length, R.business.buying.books_weeks);
  assert.ok(a.asking > 0 && a.down === Math.round(a.asking * 0.3));
  assert.equal(a.asking, a.year_profit > 0 ? Math.round(a.year_profit * 2.5) + a.stock_cost : a.stock_cost + R.business.buying.key_fee.fee_base);
  const before = w.ledger.balance("player:ana");
  const r = w.submit("ana", "buy_business", { place: cafe, at: at(cafe) });
  assert.equal(r.ok, true, r.error);
  assert.equal(before - w.ledger.balance("player:ana"), a.down);
  const b = w.biz.get(r.business.id);
  assert.ok(b.staff.length >= 2 && Object.values(b.stock).some((n) => n > 0), "its people and its stock with it");
  assert.equal(b.loan.left, 24);
  // Nothing to pay with: two missed payments and it goes back.
  w.ledger.post([["player:ana", -w.ledger.balance("player:ana")], ["business:bank", w.ledger.balance("player:ana")]], { at: w.now });
  w.ledger.post([[b.account, -w.ledger.balance(b.account)], ["business:bank", w.ledger.balance(b.account)]], { at: w.now });
  b.staff = []; b.hours = [0, 0];
  b.loan.next_due = w.now + HOUR; b.loan.monthly = m(1_000_000);
  w.step(w.now + 2 * HOUR); assert.equal(b.loan.missed, 1);
  b.loan.next_due = w.now + HOUR; w.step(w.now + 2 * HOUR);
  assert.equal(b.status, "repossessed");
  assert.equal(w.registry.get(b.id).owner, "business:w200");
  w.ledger.check();
});

test("a player can work for another player's business, and is paid from its account", () => {
  const w = world();
  w.submit("bo", "join", { name: "Bo", at: at(vacant) });
  const id = openCafe(w);
  const offer = w.submit("ana", "hire", { business: id, player: "bo", role: "barista", wage: m(25), shifts: [{ days: [0, 1, 2, 3, 4, 5, 6], from: 6, to: 14 }] });
  assert.equal(offer.ok, true, offer.error);
  const bo = w.players.get("bo");
  assert.equal(bo.employment_offers.length, 1);
  assert.equal(w.submit("bo", "accept_employment", { offer: bo.employment_offers[0].id }).ok, true);
  assert.equal(bo.job.employer, `firm:${id}`);
  assert.ok(w.biz.get(id).staff.some((s) => s.player === "bo"));
  const till = w.ledger.balance(`firm:${id}`), supply = w.ledger.supply();
  assert.equal(w.submit("bo", "clock_in", { at: at(vacant), spots: { counter: at(vacant) } }).ok, true);
  assert.equal(bo.clocked.late, undefined, "on time for six");
  bo.clocked.done = 3;
  w.now += 30 * 60_000;
  assert.equal(w.submit("bo", "clock_out", { at: at(vacant) }).ok, true);
  assert.equal(till - w.ledger.balance(`firm:${id}`), m(25) / 2, "half an hour from the business");
  assert.equal(w.ledger.supply(), supply, "not minted");
  // But not their lawyer.
  const theft = w.fine(bo, "theft", "Took a bike", ["camera"]);
  const c = w.cases.get(theft.case);
  const r = w.submit("bo", "hire_lawyer", { place: lawOffice, player: "ana", case: c.id, at: at(lawOffice) });
  assert.equal(r.ok, false); assert.match(r.error, /can not be your lawyer/);
});

test("the verdict's weights: a better lawyer tilts toward a good result, evidence and priors back", () => {
  let prev = null;
  for (let skill = 0; skill <= 1.0001; skill += 0.1) {
    const ws = verdictWeights(R, { skill, evidence: 0.5, priors: 0, criminal: true });
    assert.ok(Math.abs(Object.values(ws).reduce((s, x) => s + x, 0) - 1) < 1e-9);
    if (prev) {
      assert.ok(ws.dismissed > prev.dismissed && ws.acquitted > prev.acquitted, "more good results");
      assert.ok(ws.record < prev.record && ws.jail < prev.jail, "fewer bad ones");
    }
    prev = ws;
  }
  // The plan's own figures: skill 0.9, even evidence: dismissed or acquitted about 38%.
  const good = verdictWeights(R, { skill: 0.9, evidence: 0.5, criminal: true });
  assert.ok(Math.abs(good.dismissed + good.acquitted - 0.39) < 0.03);
  const weak = verdictWeights(R, { skill: 0.3, evidence: 0.5, criminal: true });
  assert.ok(Math.abs(weak.dismissed + weak.acquitted - 0.12) < 0.03);
  const strong = verdictWeights(R, { skill: 0.9, evidence: 0.95, priors: 2, criminal: true });
  assert.ok(strong.dismissed < good.dismissed, "strong evidence and priors pull it back");
  assert.equal(verdictWeights(R, { skill: 0.5 }).jail, undefined, "no jail for a parking ticket");
  assert.equal(oddsLabel(R, good), "likely");
  assert.equal(oddsLabel(R, verdictWeights(R, { skill: 0.05, evidence: 0.9, priors: 3, criminal: true })), "unlikely");
});

test("a law office's lawyers are invented: never a real tenant's name, with an honest record", () => {
  const plain = lawyersAt(R, lawOffice);
  assert.ok(plain.length >= 3 && plain.length <= 5);
  for (const l of plain) {
    assert.ok(l.record.wins + l.record.pleas + l.record.losses === l.record.cases);
    assert.ok(l.price === 0 || l.price % m(25) === 0);
  }
  // Tell the office the tenants include those very names: they are drawn again.
  const tenants = new Set(plain.flatMap((l) => [nameKey(l.name), nameKey(l.firm)]));
  tenants.add(nameKey("Dolan Law Firm"));
  const again = lawyersAt(R, lawOffice, tenants);
  for (const l of again) { assert.ok(!tenants.has(nameKey(l.name)), l.name); assert.ok(!tenants.has(nameKey(l.firm)), l.firm); }
  // The record follows the skill: the best wins more often than the worst.
  const many = Array.from({ length: 40 }, (_, i) => lawyersAt(R, { id: `o${i}` })).flat().filter((l) => l.role !== "public");
  many.sort((a, b) => a.skill - b.skill);
  const rate = (ls) => ls.reduce((s, l) => s + l.record.wins, 0) / ls.reduce((s, l) => s + l.record.cases, 0);
  assert.ok(rate(many.slice(-15)) > rate(many.slice(0, 15)) + 0.1);
});

test("hiring a lawyer: the retainer to the firm, a court date, the verdict at the courthouse", () => {
  const w = world();
  const p = w.players.get("ana");
  const bill = w.fine(p, "speeding", "62 in a 25", ["camera"]);
  const c = w.cases.get(bill.case);
  assert.equal(c.class, "traffic"); assert.equal(c.evidence, 0.9);
  const list = w.submit("ana", "lawyers", { place: lawOffice, case: c.id }).lawyers;
  const l = list.find((x) => x.takes.includes("traffic")) || list.find((x) => x.takes.includes("criminal"));
  assert.ok(["likely", "even", "unlikely", null].includes(l.odds));
  assert.equal(l.skill, undefined, "skill is never shown");
  if (!l.takes.includes("traffic")) return;
  const r = w.submit("ana", "hire_lawyer", { place: lawOffice, lawyer: l.id, case: c.id, at: at(lawOffice) });
  assert.equal(r.ok, true, r.error);
  assert.equal(w.ledger.balance(`firm:law:${lawOffice.id}`), r.price);
  assert.ok(c.court >= w.now + 2 * DAY && c.court <= w.now + 16 * DAY);
  assert.equal(w.submit("ana", "attend_court", { case: c.id, at: at(lawOffice) }).ok, false, "not yet");
  w.now = c.court;
  const ch = R.business.law.courthouse;
  assert.equal(w.submit("ana", "attend_court", { case: c.id, at: at(lawOffice) }).ok, false, "at the courthouse");
  const v = w.submit("ana", "attend_court", { case: c.id, at: { x: 0, z: 0, lon: ch.lon, lat: ch.lat } });
  assert.equal(v.ok, true, v.error);
  assert.ok(R.business.law.outcomes.some((o) => o.id === v.verdict.outcome));
  assert.notEqual(v.verdict.outcome, "jail", "not for a traffic case");
  assert.ok(c.closed);
});

test("a hearing in a district away from the real courthouse is held at its civic building", () => {
  const w = world();
  const bill = w.fine(w.players.get("ana"), "speeding", "Fast", ["camera"]);
  const c = w.cases.get(bill.case);
  c.court = w.now; c.lawyer = { skill: 0.6 };
  const hall = { id: "civic1", x: 300, z: 0, name: "Marina branch library", keys: ["use:civic"] };
  assert.equal(w.submit("ana", "attend_court", { case: c.id, court: hall, at: at(vacant) }).ok, false, "go there");
  assert.equal(w.submit("ana", "attend_court", { case: c.id, court: hall, at: { x: 300, z: 10, lon: vacant.lon, lat: vacant.lat } }).ok, true);
});

test("jail is a time skip: a story of what happened inside, a changed body, and the record", () => {
  const w = world();
  w.submit("ana", "take_job", { role: "clerk", place: { ...cafe, keys: ["shop:shop"] } });
  const p = w.players.get("ana");
  const bill = w.fine(p, "battery", "A fight outside the bar", ["patrol officer"]);
  const c = w.cases.get(bill.case);
  const before = { ...p.vitals };
  const rel = w.jail(p, c);
  assert.ok(rel.days >= 7 && rel.days <= 30);
  assert.ok(rel.events.length >= 2 && rel.events.every((e) => e.day >= 1 && e.day <= rel.days && /^Day \d+:/.test(e.text)));
  const changed = ["health", "stamina", "strength"].some((k) => Math.abs(p.vitals[k] - before[k]) > 0.5);
  assert.ok(changed, "came out changed");
  assert.ok(p.record.some((l) => l.charge === "battery" && l.outcome === "jail"));
  assert.ok(p.record.some((l) => l.charge === "former_inmate"));
  assert.equal(p.former_inmate, true);
  assert.equal(p.job, null, "a week or more inside costs the job");
  assert.equal(w.submit("ana", "status").released.days, rel.days);
  // And the record is checked: no security job with a battery conviction.
  const sec = w.submit("ana", "take_job", { role: "security_guard", place: { id: "o1", x: 0, z: 0, keys: R.jobs.roles.security_guard.at } });
  assert.equal(sec.ok, false); assert.match(sec.error, /checks records/);
  assert.equal(w.submit("ana", "acknowledge_release").ok, true);
  assert.equal(w.players.get("ana").released, null);
});

test("a fine left unpaid past its late penalty becomes a summons, and is heard without you", () => {
  const w = world();
  const p = w.players.get("ana");
  const bill = w.fine(p, "theft", "Took a scooter", ["camera"]);
  const c = w.cases.get(bill.case);
  runTo(w, w.now + 22 * DAY);
  assert.equal(bill.stage, 1, "the late penalty");
  assert.equal(c.court, null);
  runTo(w, w.now + 22 * DAY);
  assert.ok(bill.collections && c.court && c.summons, "a summons");
  runTo(w, c.court + 4 * HOUR);
  assert.ok(c.verdict && c.verdict.absent, "heard in absentia");
  assert.ok(c.closed);
});

test("paying a criminal fine closes the case with a record line; a traffic one leaves none", () => {
  const w = world();
  const p = w.players.get("ana");
  const t = w.fine(p, "trespass", "Over the fence", []);
  const s = w.fine(p, "speeding", "Fast", ["camera"]);
  w.submit("ana", "pay_bill", { bill: t.id }); w.submit("ana", "pay_bill", { bill: s.id });
  w.step(w.now + 1000);
  assert.ok(w.cases.get(t.case).closed && w.cases.get(s.case).closed);
  assert.deepEqual(p.record.map((l) => l.charge), ["trespass"]);
  // On probation a second offence doubles.
  p.probation = { until: w.now + 30 * DAY };
  const again = w.fine(p, "trespass", "Again", []);
  assert.equal(again.amount, R.fines.trespass * 2);
});

test("careers: experience from tasks, on-time shifts, a promotion after twenty, and a recruiter's offers", () => {
  const w = world(MON_6 + 3 * HOUR);   // 09:00, a shop assistant's shift
  const shop = { id: "w400", x: 0, z: 0, name: "Gift shop", keys: ["shop:gifts", "use:retail"], ...MARINA };
  assert.equal(w.submit("ana", "take_job", { role: "clerk", place: shop }).ok, true);
  const p = w.players.get("ana");
  for (let i = 0; i < 20; i += 1) {
    const start = MON_6 + 3 * HOUR + i * DAY;
    w.now = start; w.lastStep = start;
    assert.equal(w.submit("ana", "clock_in", { at: at(shop), spots: { counter: at(shop) } }).ok, true);
    assert.ok(!p.clocked.late);
    p.clocked.task = { id: `t${i}`, label: "Serve", where: "counter", seconds: 1, tip: [0, 0], x: 0, z: 0, started: w.now - 5000 };
    assert.equal(w.submit("ana", "task", { done: true, at: at(shop) }).ok, true);
    w.now += 45 * 60_000;
    p.clocked.done = 1;
    w.submit("ana", "clock_out", { at: at(shop) });
  }
  assert.equal(p.experience.clerk, 20);
  assert.equal(p.reliability.shifts, 20);
  assert.equal(p.job.level, 1);
  assert.equal(p.job.title, "Senior shop assistant");
  assert.equal(p.job.pay, Math.round(R.jobs.roles.clerk.pay * 1.12));
  // A recruiter: the best-paying openings within 5 km, each at least 10% more.
  const places = [
    { id: "r1", x: 0, z: 0, keys: ["use:hotel", "shop:hotel"], km: 1.2, name: "Hotel" },
    { id: "r2", x: 0, z: 0, keys: ["use:office"], km: 2, name: "Offices" },
    { id: "r3", x: 0, z: 0, keys: ["use:office", "use:hotel"], km: 9, name: "Too far" },
    { id: "r4", x: 0, z: 0, keys: ["shop:cafe"], km: 0.5, name: "Café (pays less)" },
  ];
  const h = w.submit("ana", "headhunt", { places });
  assert.equal(h.ok, true);
  assert.ok(h.offers.length >= 1 && h.offers.length <= 3);
  assert.ok(h.offers.every((o) => o.pay >= Math.round(p.job.pay * 1.1) && !["r3", "r4"].includes(o.place.id)));
  for (let i = 1; i < h.offers.length; i += 1) assert.ok(h.offers[i].pay <= h.offers[i - 1].pay, "best first");
  // Taken: the job, and the fee out of the pay as it comes.
  const o = h.offers[0];
  assert.equal(w.submit("ana", "take_offer", { offer: o.id }).ok, true);
  assert.equal(p.job.pay, o.pay);
  assert.equal(p.job.fee_due.left, o.fee);
  w.ledger.check();
});

test("a late arrival is docked once and is not on time", () => {
  const w = world(MON_6 + 4 * HOUR);   // 10:00 -- the 09:00 shift started an hour ago
  const shop = { id: "w400", x: 0, z: 0, name: "Gift shop", keys: ["shop:gifts"], ...MARINA };
  w.submit("ana", "take_job", { role: "clerk", place: shop });
  w.submit("ana", "clock_in", { at: at(shop), spots: {} });
  const p = w.players.get("ana");
  assert.equal(p.clocked.late, true);
  assert.ok(w.events.some((e) => e.kind === "late"));
  p.clocked.done = 1; w.now += 40 * 60_000;
  w.submit("ana", "clock_out", { at: at(shop) });
  assert.equal(p.reliability.on_time, 0);
});

test("the world saves and loads its businesses, cases and openings", () => {
  const w = world();
  const id = openCafe(w);
  w.submit("ana", "post_opening", { business: id, role: "barista" });
  w.fine(w.players.get("ana"), "vandalism", "Bent a sign", ["witness"]);
  const back = CityWorld.fromJSON(R, JSON.parse(JSON.stringify(w.toJSON())));
  assert.equal(back.biz.get(id).name, "Ana's Kitchen");
  assert.equal(back.openings.size, 1);
  assert.equal(back.cases.size, 1);
  assert.equal(back.storefronts.size, 1);
  back.step(back.now + DAY);
  back.ledger.check();
});

test("a new hire's shift fills the hours the others leave", () => {
  const w = world();
  const id = openCafe(w);
  const b = w.biz.get(id);
  const [c1, c2] = w.candidatesFor(b);
  w.submit("ana", "hire", { business: id, candidate: c1.id });
  w.submit("ana", "hire", { business: id, candidate: c2.id });
  const [s1, s2] = b.staff.map((s) => s.shifts[0]);
  assert.equal(s1.from, b.hours[0]);
  assert.equal(s2.to, b.hours[1], "the second closes");
  assert.ok(s2.from > s1.from);
});
