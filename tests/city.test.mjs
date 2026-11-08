// The living city's pure modules (docs/city/core.mjs, people.mjs, world.mjs): taxes as written,
// books that balance, tolls and lanes that charge, water told apart, and people whose days and
// whereabouts follow from a seed and the clock.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  Billing, LaneIndex, Ledger, LedgerError, Registry, applyExertion, applyUse, bracketTax, buoyancy, carryCapacity, cityTime,
  expressPrice, gantriesCrossed, incomeTax, jurisdictionAt, loadRules, newVitals, payrollTax, propertyTax, salesTax, storesAt,
  tenantKinds, tollAmount, tollPlaza, transferTax, vehicleFees, vitalsStep, walkFactor, waterClass, waterProperties, withholding,
} from "../docs/city/core.mjs";
import { Crowd, Streets, alongRoute, daySchedule, generatePopulation, placeFromBuilding, populationByRole, worksOn } from "../docs/city/people.mjs";
import { CityWorld } from "../docs/city/world.mjs";

const R = loadRules(JSON.parse(readFileSync(new URL("../docs/city/rules.json", import.meta.url))));
const m = R.money;
const SF = jurisdictionAt(R, -122.4194, 37.7749).chain;
const OAK = jurisdictionAt(R, -122.2711, 37.8044).chain;
// Wednesday 2026-11-04 08:00 and 13:00 in San Francisco (UTC-8).
const WED_8 = Date.UTC(2026, 10, 4, 16, 0);
const WED_13 = Date.UTC(2026, 10, 4, 21, 0);
const SAT_8 = Date.UTC(2026, 10, 7, 16, 0);

test("the clock keeps San Francisco's time", () => {
  const t = cityTime(WED_8);
  assert.equal(t.hour, 8); assert.equal(t.weekday, 3); assert.equal(t.minute, 480); assert.equal(t.label, "Wed 08:00");
});

test("places fall in their city and county", () => {
  assert.deepEqual(SF.slice(0, 2), ["city:san-francisco", "county:san-francisco"]);
  assert.equal(OAK[0], "city:oakland");
  assert.equal(jurisdictionAt(R, -122.08, 37.67).chain[0], "city:hayward");
  assert.equal(jurisdictionAt(R, -121.5, 37.0, "santa-clara-county").county, "county:santa-clara");
});

test("income tax follows the brackets as written", () => {
  assert.equal(bracketTax([[0, 0.1], [m(100), 0.2]], m(150)), m(20));
  // 2026 federal, single, 75,000 of wages: 58,900 taxable.
  const t = incomeTax(R, m(75000));
  assert.equal(t.federal, Math.round(m(12400) * 0.1 + m(50400 - 12400) * 0.12 + m(58900 - 50400) * 0.22));
  assert.ok(t.state > 0 && t.state < t.federal);
  const p = payrollTax(R, m(250000));
  assert.equal(p.social, Math.round(m(184500) * 0.062), "Social Security stops at the wage base");
  assert.equal(p.medicare, Math.round(m(250000) * 0.0145 + m(50000) * 0.009));
});

test("withholding by the cumulative method adds up to the year's tax", () => {
  let ytd = 0, held = 0;
  for (let i = 0; i < 52; i += 1) { const w = withholding(R, ytd, m(1923.08)); ytd += m(1923.08); held += w.total; }
  const year = incomeTax(R, ytd).total + payrollTax(R, ytd).total;
  assert.ok(Math.abs(held - year) <= 52, `${held} vs ${year}`);
});

test("sales, property, transfer and vehicle taxes by place", () => {
  assert.equal(salesTax(R, SF, m(100)), m(8.63));
  assert.equal(salesTax(R, OAK, m(100)), m(10.75));
  assert.equal(salesTax(R, SF, m(100), "groceries"), 0, "groceries are exempt");
  assert.equal(salesTax(R, SF, m(100), "taxable", { sales_rate_add: 0.01 }), m(9.63), "a passed measure adds to it");
  const pt = propertyTax(R, SF, m(1_000_000));
  assert.equal(pt.ad_valorem, m(11827)); assert.equal(pt.parcel, m(349));
  // San Francisco: the whole price at its tier's rate.
  assert.equal(transferTax(R, SF, m(1_500_000)).city, m(11250));
  assert.equal(transferTax(R, SF, m(12_000_000)).city, m(660000));
  assert.equal(transferTax(R, SF, m(1_500_000)).county, m(1650));
  assert.equal(transferTax(R, OAK, m(1_000_000)).city, m(15000));
  const v = vehicleFees(R, m(30000));
  assert.equal(v.license, m(195)); assert.equal(v.improvement, m(117));
});

test("the ledger balances, never overdraws and pays a repeated request once", () => {
  const l = new Ledger();
  l.open("a"); l.open("b");
  l.mint("a", m(100), "starter_grant");
  assert.throws(() => l.transfer("a", "b", m(101)), LedgerError);
  assert.throws(() => l.mint("a", 1, "a bonus"), LedgerError);
  const e1 = l.transfer("a", "b", m(30), { key: "k" }), e2 = l.transfer("a", "b", m(30), { key: "k" });
  assert.equal(e1, e2); assert.equal(l.balance("b"), m(30));
  l.check();
  const again = Ledger.fromJSON(JSON.parse(JSON.stringify(l)));
  assert.equal(again.balance("a"), m(70));
});

test("a bill unpaid becomes a notice with its penalty", () => {
  const l = new Ledger(); l.open("p"); l.open("bata"); l.mint("p", m(200), "starter_grant");
  const b = new Billing(l);
  const bill = b.issue({ payer: "p", payee: "bata", kind: "toll_invoice", amount: m(8.5), at: 0, due_days: 21, penalties: [m(25), m(70)] });
  b.sweep(20 * 86_400_000); assert.equal(bill.owed, m(8.5));
  b.sweep(22 * 86_400_000); assert.equal(bill.owed, m(33.5));
  b.sweep(44 * 86_400_000); assert.equal(bill.owed, m(103.5));
  b.pay(bill.id, "p", 45 * 86_400_000);
  assert.equal(bill.status, "paid"); assert.equal(l.balance("bata"), m(103.5));
});

test("theft moves possession, never title", () => {
  const l = new Ledger(); l.open("ana"); l.open("ben");
  const r = new Registry(l);
  r.register("car", "vehicle", "ana");
  r.take("car", "ben");
  assert.equal(r.get("car").owner, "ana"); assert.equal(r.get("car").custody, "stolen");
  assert.throws(() => r.sell("car", "ana", "ben", 1));
  r.recover("car", "police");
  r.lend("car", "ana", "ben", 10);
  assert.throws(() => r.giveBack("car", "ana"));
  r.giveBack("car", "ben");
  assert.deepEqual(r.get("car").history.map((h) => h.kind), ["grant", "theft", "recovered", "loan", "return"]);
});

test("bridge tolls: FasTrak, invoice, and carpools in the hours", () => {
  const bay = tollPlaza(R, "Bay Bridge Toll Plaza"), gg = tollPlaza(R, "Golden Gate Bridge Automated Toll Plaza");
  assert.equal(bay.name, "San Francisco-Oakland Bay Bridge"); assert.equal(gg.authority, "authority:ggbhtd");
  assert.equal(tollAmount(R, bay, { fastrak: true, occupants: 1, time: cityTime(WED_8) }).amount, m(8.5));
  assert.equal(tollAmount(R, bay, { fastrak: true, occupants: 3, time: cityTime(WED_8) }).amount, m(4.25));
  assert.equal(tollAmount(R, bay, { fastrak: true, occupants: 3, time: cityTime(WED_13) }).amount, m(8.5), "off-peak: full toll");
  assert.equal(tollAmount(R, bay, { fastrak: true, occupants: 3, time: cityTime(SAT_8) }).amount, m(8.5), "weekend: full toll");
  assert.equal(tollAmount(R, gg, { fastrak: false, occupants: 1, time: cityTime(WED_8) }).amount, m(10.75));
});

test("a gantry is crossed only in the direction that pays", () => {
  const g = [{ id: "g", x: 0, z: 0, bearing: 90, width: 20 }];  // traffic runs east (+x)
  assert.equal(gantriesCrossed(g, { x: -5, z: 1 }, { x: 5, z: 1 }, 14).length, 1);
  assert.equal(gantriesCrossed(g, { x: 5, z: 1 }, { x: -5, z: 1 }, 14).length, 0, "westbound does not pay");
  assert.equal(gantriesCrossed(g, { x: -5, z: 60 }, { x: 5, z: 60 }, 14).length, 0, "a road beside it does not");
});

test("which lane a car is in, and what the managed lane asks", () => {
  // A four-lane carriageway running east along z = 0; the leftmost lane (north, -z) is managed.
  const lanes = new LaneIndex(R, [{ id: "w", kind: "hov", lanes: 4, managed: [0], min: 2, hours: [[5, 9], [15, 19]], weekdays: true, p: [[0, 0], [1, 0]] }],
    (lon) => [lon * 1000, 0]);
  const east = -Math.PI / 2;   // yaw facing +x
  const left = lanes.at(500, -5.4, east), right = lanes.at(500, 5.4, east);
  assert.equal(left.lane, 0); assert.ok(left.managed);
  assert.equal(right.lane, 3); assert.ok(!right.managed);
  assert.equal(lanes.at(500, -5.4, Math.PI / 2), null, "the other carriageway");
  assert.ok(lanes.rule(left.seg, cityTime(WED_8)).active);
  assert.ok(!lanes.rule(left.seg, cityTime(WED_13)).active, "a carpool lane only in its hours");
  assert.ok(expressPrice(R, cityTime(WED_8), 10, 1, 2) > expressPrice(R, cityTime(WED_13), 10, 1, 2));
  assert.equal(expressPrice(R, cityTime(WED_8), 10, 2, 2), 0, "a carpool rides free where two is enough");
  assert.equal(expressPrice(R, cityTime(WED_8), 10, 3, 3), 0);
});

test("water is told apart and floats things by its salt", () => {
  assert.equal(waterClass(R, { lon: -122.52, lat: 37.78 }), "ocean");
  assert.equal(waterClass(R, { lon: -122.38, lat: 37.80 }), "bay");
  assert.equal(waterClass(R, { lon: -122.4, lat: 38.05 }), "brackish");
  assert.equal(waterClass(R, { lon: -122.48, lat: 37.73, inland: true }), "fresh_lake");
  assert.equal(waterClass(R, { lon: -122.4, lat: 37.79, inland: true, basin: true }), "fountain");
  const sea = waterProperties(R, "ocean"), lake = waterProperties(R, "fresh_lake"), pond = waterProperties(R, "salt_pond");
  assert.ok(sea.density > lake.density && pond.density > sea.density);
  assert.ok(sea.corrosion > lake.corrosion);
  // Something of 1010 kg/m3 sinks in a lake and floats in the sea.
  assert.equal(buoyancy(lake, 1010).floats, false); assert.equal(buoyancy(sea, 1010).floats, true);
  assert.ok(waterProperties(R, "brackish", { lon: -122.4, lat: 38.05 }).salinity === 20);
});

// A small grid district: streets every 100 m, buildings of every kind between them.
function district() {
  const ways = [];
  // Each street's points at every crossing, as a map's ways share their junctions' nodes.
  const line = (f) => Array.from({ length: 7 }, (_, k) => f(k * 100));
  for (let i = 0; i <= 6; i += 1) {
    ways.push({ kind: "street", pts: line((s) => [i * 100, s]), lanes: i % 3 ? 2 : 4, oneway: 0, road_m: i % 3 ? 10 : 16 });
    ways.push({ kind: "street", pts: line((s) => [s, i * 100]), lanes: 2, oneway: 0, road_m: 10 });
  }
  const streets = new Streets(ways);
  const kinds = [["residential"], ["residential"], ["residential"], ["office"], ["generic", "cafe"], ["restaurant", "restaurant"],
    ["generic", "bar"], ["civic"], ["school"], ["hotel"], ["retail", "grocery"], ["generic", "salon"], ["industrial"], ["parking"]];
  const places = [];
  for (let i = 0; i < 6; i += 1) for (let j = 0; j < 6; j += 1) {
    const [archetype, shop] = kinds[(i * 6 + j) % kinds.length];
    const p = placeFromBuilding({ id: `b${i}${j}`, x: i * 100 + 50, z: j * 100 + 50, archetype, shops: shop ? [{ t: shop }] : [], floors: 3, area: 300 }, streets);
    if (p) places.push(p);
  }
  return { streets, places };
}

test("routes follow the streets and keep to the right", () => {
  const { streets } = district();
  const a = streets.nearest(0, 0, "drive"), b = streets.nearest(300, 200, "drive");
  const route = streets.route(a, b, "drive");
  assert.equal(route.length, 500);
  const p = alongRoute(route, 50, 2);
  assert.ok(Math.abs(Math.hypot(p.x, p.z) - Math.hypot(50, 2)) < 1e-6 || Math.abs(p.x - 50) < 3 || Math.abs(p.z - 50) < 3);
});

test("a thousand people with jobs at real workplaces and twenty-four hour days", () => {
  const { places } = district();
  const people = generatePopulation(R, places, { seed: "test", size: 1000 });
  assert.equal(people.length, 1000);
  const roles = populationByRole(people);
  for (const role of ["barista", "cook", "bartender", "office_worker", "police", "teacher", "student", "retiree"]) assert.ok(roles[role] > 0, role);
  const place = new Map(places.map((p) => [p.id, p]));
  for (const p of people) {
    assert.equal(place.get(p.home).use, "residential");
    const spec = R.jobs.roles[p.role];
    if (p.work && !spec.at.includes("home")) assert.ok(spec.at.some((k) => place.get(p.work).keys.has(k)), `${p.role} at ${p.work}`);
  }
  const t = cityTime(WED_8);
  for (const p of people.slice(0, 200)) {
    const day = daySchedule(R, p, t.day, t.weekday, places);
    for (let i = 1; i < day.length; i += 1) assert.ok(day[i].start >= day[i - 1].end, `${p.role}: overlapping`);
    assert.ok(day.some((a) => a.kind === "sleep"), `${p.role} sleeps`);
  }
  const bartender = people.find((p) => p.role === "bartender");
  const shifts = daySchedule(R, bartender, t.day, t.weekday, places).filter((a) => a.kind === "work");
  assert.ok(shifts.some((a) => a.start >= 17 * 60 && a.end > 24 * 60), "bartenders work nights, past midnight");
  assert.ok(shifts.some((a) => a.start === 0 && a.end <= 3 * 60), "and finish last night's shift in the small hours");
  assert.ok(worksOn("weekdays", 3, 0) && !worksOn("weekdays", 6, 0));
});

test("the same seed and clock put everyone in the same place", () => {
  const make = () => { const { streets, places } = district(); const people = generatePopulation(R, places, { seed: "party", size: 400 });
    return new Crowd(R, streets, places, people, { seed: "party", timeAt: (ms) => cityTime(ms) }); };
  const a = make().at(WED_8 + 17 * 60_000, { x: 300, z: 300 }, 600), b = make().at(WED_8 + 17 * 60_000, { x: 300, z: 300 }, 600);
  assert.ok(a.people.length > 5, `${a.people.length} out and about at 08:17`);
  assert.ok(a.vehicles.length > 0, "traffic on the streets");
  assert.deepEqual(a.people.map((p) => [p.id, p.x.toFixed(2)]), b.people.map((p) => [p.id, p.x.toFixed(2)]));
  assert.deepEqual(a.vehicles.map((v) => v.id), b.vehicles.map((v) => v.id));
});

test("a player's day in the party's world", () => {
  const w = new CityWorld(R, { now: WED_8 });
  const { places } = district();
  const cafe = places.find((p) => p.keys.has("shop:cafe"));
  const home = places.find((p) => p.use === "residential");
  const at = { x: cafe.x, z: cafe.z, lon: -122.4194, lat: 37.7749 };
  assert.equal(w.submit("ana", "status").ok, false);
  const join = w.submit("ana", "join", { name: "Ana", home, at });
  assert.equal(join.balance, m(2000));
  assert.equal(w.submit("ana", "mint", {}).ok, false);
  // A job at the café, clocked in at its door, an hour's pay with tax held back.
  assert.equal(w.submit("ana", "take_job", { role: "barista", place: { ...cafe, keys: [...cafe.keys] } }).ok, true);
  assert.equal(w.submit("ana", "clock_in", { at }).ok, true);
  w.step(WED_8 + 3_600_000);
  const after = w.submit("ana", "status").balance;
  // The vision's basic job: 120 every 10 minutes (a barista a little more), net of payroll tax.
  assert.ok(after > m(2000 + 700) && after < m(2000 + R.jobs.roles.barista.pay / 100), `paid ${after - m(2000)} net of tax`);
  assert.ok(w.ledger.balance("authority:ssa") > 0 && w.ledger.balance("authority:edd") > 0);
  // Coffee with San Francisco's sales tax.
  const coffee = w.submit("ana", "buy", { item: "coffee", place: { ...cafe, keys: [...cafe.keys] } });
  assert.equal(coffee.tax, salesTax(R, SF, m(8), "prepared_food"));
  assert.equal(w.submit("ana", "status").inventory.coffee, 1, "carried, not yet drunk");
  // A car, a FasTrak tag, and a toll at the Bay Bridge.
  w.ledger.mint("player:ana", m(40000), "external_trade");
  const car = w.submit("ana", "buy_vehicle", { model: "economy" });
  assert.ok(car.ok, car.error);
  assert.equal(w.submit("ana", "toll", { name: "Bay Bridge", occupants: 1 }).ok, false, "not driving");
  w.submit("ana", "drive", { vehicle: car.vehicle });
  const invoice = w.submit("ana", "toll", { name: "Bay Bridge", occupants: 1, key: "t1" });
  assert.equal(invoice.paid_by, "invoice");
  w.submit("ana", "get_fastrak");
  const tagged = w.submit("ana", "toll", { name: "Bay Bridge", occupants: 1, key: "t2" });
  assert.equal(tagged.paid_by, "fastrak"); assert.equal(tagged.amount, m(8.5));
  // Solo in a carpool lane in its hours: a 490 notice. In an express lane: the price on the tag.
  const hov = w.submit("ana", "lane", { segment: "way/1", kind: "hov", minimum: 2, occupants: 1, km: 2, key: "l1" });
  assert.equal(hov.charged, m(490));
  const express = w.submit("ana", "lane", { segment: "way/2", kind: "express", minimum: 2, occupants: 1, km: 8, key: "l2" });
  assert.ok(express.charged > 0 && express.paid_by === "fastrak");
  const cam = w.submit("ana", "speed_camera", { over_mph: 18, mph: 43, camera: "c1", key: "s1" });
  assert.equal(cam.charged, m(100));
  // Bills to pay: the invoice and the notices.
  const bills = w.submit("ana", "status").bills;
  assert.equal(bills.length, 3);
  assert.equal(w.submit("ana", "pay_bill", { bill: bills[0].id }).ok, true);
  // Parking at a meter left unpaid: tickets, then the tow.
  w.submit("ana", "park", { metered: true, x: 0, z: 0, km: 12, litres: 1 });
  for (let h = 1; h <= 4; h += 1) w.step(WED_8 + 3_600_000 * (1 + h) + 1000);
  assert.equal(w.registry.get(car.vehicle).custody, "impounded");
  assert.equal(w.submit("ana", "drive", { vehicle: car.vehicle }).ok, false);
  w.ledger.check();
});

test("a car changes hands between players, and a party votes a measure in", () => {
  const w = new CityWorld(R, { now: WED_13 });
  const at = { lon: -122.4194, lat: 37.7749 };
  for (const id of ["ana", "ben", "cy"]) w.submit(id, "join", { name: id, at });
  w.ledger.mint("player:ana", m(30000), "external_trade");
  w.ledger.mint("player:ben", m(15000), "external_trade");
  const car = w.submit("ana", "buy_vehicle", { model: "economy" }).vehicle;
  assert.equal(w.submit("ben", "offer", { asset: car, to: "ben", price: m(10) }).ok, false, "only the owner offers it");
  const lend = w.submit("ana", "offer", { asset: car, to: "ben", kind: "loan", hours: 1 }).offer;
  w.submit("ben", "accept", { offer: lend });
  assert.equal(w.submit("ben", "drive", { vehicle: car }).ok, true, "a borrowed car may be driven");
  w.submit("ben", "park", { x: 0, z: 0 });
  w.submit("ben", "return", { asset: car });
  const sale = w.submit("ana", "offer", { asset: car, to: "ben", price: m(12000) }).offer;
  const before = w.ledger.balance("player:ana");
  assert.equal(w.submit("ben", "accept", { offer: sale }).ok, true);
  assert.equal(w.registry.get(car).owner, "player:ben");
  assert.equal(w.ledger.balance("player:ana"), before + m(12000));
  assert.equal(w.submit("ben", "accept", { offer: sale }).ok, false, "an offer is taken once");
  const measure = w.submit("ana", "propose", { key: "sales_rate_add", value: 0.0025 }).measure;
  assert.equal(w.submit("ana", "propose", { key: "sales_rate_add", value: 0.5 }).ok, false, "outside the platform's limits");
  w.submit("ben", "vote", { measure: measure.id, yes: true });
  w.step(WED_13 + 4 * 60_000);
  assert.equal(w.measures.get(measure.id).status, "passed");
  assert.equal(w.laws.sales_rate_add, 0.0025);
  const again = CityWorld.fromJSON(R, JSON.parse(JSON.stringify(w)));
  assert.equal(again.ledger.balance("player:ben"), w.ledger.balance("player:ben"));
  assert.equal(again.registry.get(car).owner, "player:ben");
});

test("real estate: a building bought with its transfer tax, rent coming in, property tax due", () => {
  const w = new CityWorld(R, { now: Date.UTC(2026, 9, 30, 18) });
  w.submit("ana", "join", { name: "Ana", at: { lon: -122.4194, lat: 37.7749 } });
  w.ledger.mint("player:ana", m(5_000_000), "external_trade");
  const building = { id: "b1", use: "residential", area: 120, floors: 3, lon: -122.42, lat: 37.77, name: "12 Example St" };
  const bought = w.submit("ana", "buy_building", { building });
  assert.ok(bought.ok, bought.error);
  assert.equal(bought.transfer_tax.city, transferTax(R, SF, bought.price).city);
  w.step(Date.UTC(2026, 10, 2, 18));
  const tax = w.submit("ana", "status").bills.find((b) => b.kind === "property_tax");
  assert.ok(tax, "the November installment");
  assert.equal(tax.amount, Math.round(propertyTax(R, SF, bought.price).total * 0.5));
  assert.ok(w.ledger.balance("player:ana") > m(5_000_000) - bought.price, "rent from the tenants");
});

test("the vision's prices: rent, a meal, a bus trip, a used car", () => {
  assert.equal(R.start.room_rent_per_day * 7, m(840), "a room is 800-2,000 a week");
  assert.equal(R.items.meal.price, m(35));
  assert.equal(R.transit.bus_fare, m(15));
  assert.equal(R.jobs.roles.laundry_attendant.pay, m(720), "the floor: 120 every ten minutes");
  const share = R.vehicles.used_share_by_age.filter(([age]) => age <= 5).at(-1)[1];
  assert.equal(Math.round(R.vehicles.models.economy.price * share / 100), 7920, "a used economy car about 8,000");
});

test("stamina runs down by day and comes back at night; health and strength wear slowly", () => {
  const v = newVitals(R, WED_8);
  const evening = vitalsStep(R, v, WED_8 + 12 * 3_600_000);   // 08:00 to 20:00, awake
  assert.ok(Math.abs(evening.stamina - (90 - 12 * 4.5)) < 1e-6, `stamina ${evening.stamina}`);
  const morning = vitalsStep(R, evening, WED_8 + 23 * 3_600_000, { home: true });   // the night at home
  assert.ok(morning.stamina > 95, `slept it back: ${morning.stamina}`);
  assert.ok(evening.health < 100 && evening.health > 98, "health wears a little by day");
  assert.ok(vitalsStep(R, { ...evening, health: 70 }, WED_8 + 23 * 3_600_000, { home: true }).health > 72, "and mends asleep");
  assert.ok(morning.strength < 20 && morning.strength > 18.5, "strength fades a little");
  // Two days without rest or food: stamina gone, then health with it.
  const spent = vitalsStep(R, { ...v, stamina: 5 }, WED_8 + 10 * 3_600_000);
  assert.equal(spent.stamina, 0);
  assert.ok(spent.health < 90, `exhausted: ${spent.health}`);
  // Food gives stamina back; a workout builds strength, capped a day; walking a little.
  const fed = applyUse(R, { ...v, stamina: 40 }, R.items.meal.use);
  assert.equal(fed.stamina, 80);
  let gym = { ...v };
  for (let i = 0; i < 5; i += 1) gym = applyUse(R, gym, R.items.day_pass.use, { workout: true, day: 1 });
  assert.equal(gym.strength, 20 + R.vitals.strength.workout_daily_cap, "a day's workouts are capped");
  const walked = applyExertion(R, v, { walked_m: 2000, day: 1 });
  assert.ok(Math.abs(walked.strength - (20 + 0.7)) < 1e-9);
  assert.ok(applyExertion(R, v, { walked_m: 50_000, day: 1 }).strength === 20 + R.vitals.strength.walk_daily_cap);
  assert.ok(applyExertion(R, v, { sprint_s: 20 }).stamina < v.stamina);
  // Spent, you are slowed and cannot sprint; strength carries more.
  assert.deepEqual(walkFactor(R, { stamina: 5 }, true), { factor: R.vitals.stamina.slow_factor, sprint: false });
  assert.equal(walkFactor(R, { stamina: 80 }, true).sprint, true);
  assert.ok(carryCapacity(R, 60) > carryCapacity(R, 20));
  assert.equal(carryCapacity(R, 20, { backpack: 1 }) - carryCapacity(R, 20), R.vitals.carry.backpack_kg);
});

test("stores sell by their kind, and clinics and gyms are told by name", () => {
  assert.ok(storesAt(R, ["shop:hardware"])[0].items.includes("hammer"));
  assert.ok(storesAt(R, ["shop:pharmacy"])[0].items.includes("pain_relief"));
  assert.deepEqual(storesAt(R, ["use:residential", "shop:cafe", "shop:salon"]).map((s) => s.kind), ["cafe", "salon"]);
  assert.deepEqual(tenantKinds(R, "Mission Street Fitness"), ["gym"]);
  assert.deepEqual(tenantKinds(R, "Sutter Health Urgent Care"), ["clinic"]);
  assert.deepEqual(tenantKinds(R, "Blue Bottle Coffee"), []);
  const streets = new Streets([{ kind: "street", pts: [[0, 0], [100, 0]], lanes: 2, oneway: 0 }]);
  const gym = placeFromBuilding({ id: "g", x: 10, z: 5, archetype: "retail", shops: [{ n: "24 Hour Fitness", t: "shop" }] }, streets, R);
  assert.ok(gym.keys.has("shop:gym"));
});

test("shopping, carrying, eating, the doctor and the gym", () => {
  const w = new CityWorld(R, { now: WED_13 });
  const at = { x: 0, z: 0, lon: -122.4194, lat: 37.7749 };
  w.submit("ana", "join", { name: "Ana", at });
  const shop = (kind) => ({ id: kind, x: 5, z: 0, keys: [`shop:${kind}`] });
  const hammer = w.submit("ana", "buy", { item: "hammer", place: shop("hardware"), at });
  assert.ok(hammer.ok, hammer.error);
  assert.equal(hammer.tax, salesTax(R, SF, m(25), "taxable"));
  assert.equal(w.submit("ana", "buy", { item: "hammer", place: shop("cafe") }).ok, false, "a café sells no hammers");
  assert.equal(w.submit("ana", "use", { item: "hammer" }).ok, false, "a tool is carried");
  assert.equal(w.submit("ana", "buy", { item: "ladder", qty: 3, place: shop("hardware") }).ok, false, "too heavy to carry");
  // Bread from the grocer is not taxed; eaten, it gives back stamina.
  w.players.get("ana").vitals.stamina = 30;
  const bread = w.submit("ana", "buy", { item: "bread", place: shop("grocery") });
  assert.equal(bread.tax, 0);
  const ate = w.submit("ana", "use", { item: "bread" });
  assert.equal(ate.effect.stamina, 15);
  // A meal eaten at the restaurant.
  const meal = w.submit("ana", "buy", { item: "meal", place: shop("restaurant"), use: true });
  assert.equal(meal.effect.stamina, 40);
  assert.equal(w.submit("ana", "status").inventory.meal, undefined);
  // Prescription medicine needs the doctor first; the doctor's visit mends.
  w.players.get("ana").vitals.health = 40;
  assert.equal(w.submit("ana", "buy", { item: "prescription", place: shop("pharmacy") }).ok, false);
  const doctor = w.submit("ana", "buy", { item: "doctor_visit", place: shop("clinic") });
  assert.equal(doctor.effect.health, 50);
  assert.equal(doctor.tax, 0, "medical care is not taxed");
  assert.equal(w.submit("ana", "buy", { item: "prescription", place: shop("pharmacy") }).ok, true);
  // A workout: strength, at the cost of stamina.
  const before = w.players.get("ana").vitals.strength;
  const work = w.submit("ana", "buy", { item: "day_pass", place: shop("gym") });
  assert.equal(w.players.get("ana").vitals.strength, before + 3);
  assert.equal(work.effect.stamina, -15);
  w.players.get("ana").vitals.stamina = 5;
  assert.equal(w.submit("ana", "buy", { item: "day_pass", place: shop("gym") }).ok, false, "too tired");
  // A hotel night pays the hotel tax, not sales tax.
  const night = w.submit("ana", "buy", { item: "hotel_night", place: { id: "h", x: 5, z: 0, keys: ["use:hotel"] } });
  assert.equal(night.tax, Math.round(m(220) * 0.14));
  w.ledger.check();
});

test("put down, picked up, handed over; a faint and its bill", () => {
  const w = new CityWorld(R, { now: WED_13 });
  const at = { x: 0, z: 0, lon: -122.4194, lat: 37.7749 };
  w.submit("ana", "join", { name: "Ana", at, home: { id: "h1", x: 0, z: 0 } });
  w.submit("ben", "join", { name: "Ben", at });
  w.submit("ana", "buy", { item: "umbrella", place: { id: "s", x: 0, z: 0, keys: ["shop:shop"] } });
  const dropped = w.submit("ana", "drop", { item: "umbrella" }).dropped;
  assert.equal(w.submit("ben", "pick_up", { id: dropped, at: { x: 30, z: 0 } }).ok, false, "too far");
  assert.equal(w.submit("ben", "pick_up", { id: dropped, at: { x: 1, z: 1 } }).ok, true);
  assert.equal(w.submit("ana", "pick_up", { id: dropped }).ok, false, "gone");
  const found = { id: "found:d:1:3", item: "book", x: 2, z: 0 };
  assert.equal(w.submit("ana", "pick_up", { found, at: { x: 1, z: 0 } }).ok, true);
  assert.equal(w.submit("ben", "pick_up", { found, at: { x: 1, z: 0 } }).ok, false, "a found thing is picked up once");
  assert.equal(w.submit("ben", "give_item", { to: "ana", item: "umbrella" }).ok, true);
  assert.equal(w.players.get("ana").inventory.umbrella, 1);
  // A crash bad enough: out cold, woken at home, billed for the ambulance.
  const hurt = w.submit("ana", "hurt", { amount: 40, cause: "crash", at: { x: 200, z: 0 } });
  assert.ok(hurt.vitals.health === 60);
  w.players.get("ana").vitals.health = 10;
  const out = w.submit("ana", "hurt", { amount: 30, cause: "crash" });
  assert.equal(out.fainted.place, "home");
  assert.equal(out.vitals.health, R.vitals.health.wake_health);
  assert.ok(w.billing.open("player:ana").some((b) => b.kind === "medical" && b.amount === R.vitals.health.hospital_bill));
});

test("a bus fare, a taxi meter and a delivery gig", () => {
  const w = new CityWorld(R, { now: WED_13 });
  const at = { x: 0, z: 0, lon: -122.4194, lat: 37.7749 };
  w.submit("ana", "join", { name: "Ana", at });
  const start = w.ledger.balance("player:ana");
  w.submit("ana", "board", { kind: "bus" });
  assert.equal(w.ledger.balance("player:ana"), start - m(15));
  assert.equal(w.submit("ana", "board", { kind: "taxi" }).ok, false, "riding already");
  w.submit("ana", "alight");
  w.submit("ana", "board", { kind: "taxi" });
  w.now += 10 * 60_000;
  const taxi = w.submit("ana", "alight", { km: 400 });
  assert.ok(taxi.km < 16, "no more kilometres than the time allows");
  assert.equal(taxi.fare, R.transit.taxi_flag + Math.round(R.transit.taxi_per_km * taxi.km));
  const cafe = { id: "c1", x: 5, z: 0, name: "Café", keys: ["shop:cafe"] };
  const to = { id: "r9", x: 505, z: 0, name: "9 Elm St" };
  const gig = w.submit("ana", "take_delivery", { place: cafe, to });
  assert.ok(gig.ok, gig.error);
  assert.equal(gig.delivery.pay, R.delivery.base_pay + Math.round(R.delivery.pay_per_km * 0.5));
  assert.equal(w.submit("ana", "drop", { item: "parcel" }).ok, false, "the parcel is not yours to drop");
  assert.equal(w.submit("ana", "deliver").ok, false, "not at the address");
  const before = w.ledger.balance("player:ana");
  const done = w.submit("ana", "deliver", { at: { x: 500, z: 3 } });
  assert.ok(done.ok && !done.late);
  assert.equal(w.ledger.balance("player:ana"), before + gig.delivery.pay);
  assert.equal(w.players.get("ana").inventory.parcel, undefined);
  w.ledger.check();
  // Saved and read back with the bag and the bars.
  const again = CityWorld.fromJSON(R, JSON.parse(JSON.stringify(w)));
  assert.deepEqual(again.players.get("ana").vitals, w.players.get("ana").vitals);
});

test("the viewer's city module loads without a page", async () => {
  const view = await import("../docs/city/view.mjs");
  assert.equal(typeof view.startCity, "function");
});
