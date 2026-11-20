import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { loadRules } from "../docs/city/core.mjs";
import { CityWorld } from "../docs/city/world.mjs";
import { CIRCUITS, MOUNTS, REPAIRS, totalBill, visitingCars, isWorkshop } from "../docs/city/workshop.mjs";
import { Roster, harmNow } from "../docs/city/fleet.mjs";
import { viewFor } from "../server/city/views.mjs";

const R = loadRules(JSON.parse(readFileSync(new URL("../docs/city/rules.json", import.meta.url))));
const at = { x: 0, z: 0, lon: -122.43, lat: 37.8, county: "county:san-francisco" };
const place = { ...at, id: "shop-17", name: "Marina Auto", keys: ["shop:auto_parts"] };
function setup() {
  const w = new CityWorld(R, { now: Date.UTC(2026, 10, 11, 20), seed: "workshop" });
  for (const id of ["driver", "tech", "other"]) assert.ok(w.submit(id, "join", { name: id, at }).ok);
  assert.ok(w.submit("tech", "take_job", { role: "mechanic", place }).ok);
  assert.ok(w.submit("tech", "clock_in", { at }).ok);
  return w;
}
function action(w, vehicle, action, extra = {}, pid = "tech") {
  const o = w.workOrders.get(vehicle);
  return w.submit(pid, "workshop_action", {
    place,
    vehicle,
    orderId: o.id,
    revision: o.revision,
    action,
    ...extra,
  });
}
const ok = (r) => (assert.ok(r.ok, r.error), r);
test("a player authorizes their own parked car, a mechanic fits a fender, and the shop can collect exactly one invoice", () => {
  const w = setup(),
    v = "private-sedan";
  const car = w.registry.register(
    v,
    "vehicle",
    "player:driver",
    { ...at, model: "sedan", plate: "BAY401", condition: 60 },
    w.now,
  );
  assert.ok(isWorkshop(R, { keys: new Set(place.keys) }, null));
  assert.equal(w.submit("other", "workshop_intake", { place, vehicle: v }).ok, false);
  assert.equal(w.submit("driver", "workshop_intake", { place: { ...place, x: 1000 }, vehicle: v }).ok, false);
  ok(w.submit("driver", "workshop_intake", { place, vehicle: v }));
  assert.equal(w.submit("driver", "drive", { vehicle: v }).ok, false);
  assert.equal(viewFor(w, "other").workOrders.length, 0);
  assert.equal(viewFor(w, "tech").workOrders.length, 1);
  assert.equal(action(w, v, "check", { site: "wing", check: "inspect" }, "other").ok, false);
  assert.equal(action(w, v, "check", { site: "load", check: "inspect" }).ok, false);
  ok(action(w, v, "check", { site: "wing", check: "inspect" }));
  assert.equal(action(w, v, "check", { site: "wing", check: "inspect", revision: 0 }).ok, false);
  assert.equal(action(w, v, "diagnose", { part: "ground" }).ok, false);
  ok(action(w, v, "diagnose", { part: "fender" }));
  assert.equal(action(w, v, "fit", { site: "wing", part: "fender", orientation: "reversed" }).ok, false);
  ok(action(w, v, "fit", { site: "wing", part: "fender", orientation: REPAIRS.fender.orientation }));
  assert.equal(action(w, v, "attach", { site: "rail", tool: "Trim clip pliers" }).ok, false);
  assert.equal(action(w, v, "verify").ok, false);
  for (const site of REPAIRS.fender.mounts)
    ok(action(w, v, "attach", { site, tool: MOUNTS[site], circuit: CIRCUITS[site] }));
  ok(action(w, v, "verify"));
  const { order } = ok(action(w, v, "release"));
  assert.equal(totalBill(order), R.money(208));
  const bill = w.billing.bills.get(order.bill);
  assert.equal(bill.amount, totalBill(order));
  assert.equal(bill.payer, "player:driver");
  assert.equal(bill.payee, "business:" + place.id);
  ok(w.submit("driver", "pay_bill", { bill: bill.id }));
  assert.equal(w.ledger.balance(bill.payee), bill.amount);
  assert.equal(action(w, v, "release").ok, false);
  assert.ok(car.attrs.condition > 60);
  assert.equal(w.player("tech").experience.mechanic, 1);
  ok(w.submit("driver", "drive", { vehicle: v }));
});
for (const fault of ["ground", "relay"])
  test(fault + " diagnosis, partial invoice, resumed repair and persisted functional check on an NPC car", () => {
    let w = setup();
    const roster = new Roster(R, { seed: "sf-corridor" });
    roster.visitorsUpTo(4);
    const driver = roster.visitors.get("visitor:0"),
      vehicle = roster.vehicles.get(driver.car);
    const fleet = { roster, vehicleAt: () => ({ state: "parked", spot: { place: place.id } }) };
    assert.deepEqual(visitingCars([{ person: driver, indoors: "other" }], fleet, {}, place), []);
    assert.deepEqual(
      visitingCars(
        [{ person: driver, indoors: place.id }],
        { ...fleet, vehicleAt: () => ({ state: "driving" }) },
        {},
        place,
      ),
      [],
    );
    const [visitor] = visitingCars([{ person: driver, indoors: place.id }], fleet, {}, place);
    const v = visitor.vehicle,
      spec = REPAIRS[fault],
      intake = { place, vehicle: v, visitor };
    w.harmed(v, "vehicle", vehicle.plate).serviceFault = fault;
    assert.equal(
      w.submit("tech", "workshop_intake", { ...intake, visitor: { ...visitor, parkedAt: "elsewhere" } }).ok,
      false,
    );
    ok(w.submit("tech", "workshop_intake", intake));
    assert.equal(harmNow(w.harm.get(v), w.now).out, true);
    ok(action(w, v, "check", { site: fault === "ground" ? "ground" : "load", check: spec.test }));
    ok(action(w, v, "diagnose", { part: fault }));
    ok(action(w, v, "fit", { site: spec.seat, part: fault, orientation: spec.orientation }));
    const paid = totalBill(ok(action(w, v, "withdraw")).order);
    w = CityWorld.fromJSON(R, JSON.parse(JSON.stringify(w.toJSON())));
    const reopened = ok(w.submit("tech", "workshop_intake", intake)).order;
    assert.ok(reopened.seated);
    w = CityWorld.fromJSON(R, JSON.parse(JSON.stringify(w.toJSON())));
    assert.equal(w.workOrders.get(v).id, reopened.id);
    assert.equal(totalBill(reopened), 0);
    const first = spec.mounts[0];
    assert.equal(action(w, v, "attach", { site: first, tool: MOUNTS[first], circuit: "wrong feed" }).ok, false);
    for (const site of spec.mounts)
      ok(action(w, v, "attach", { site, tool: MOUNTS[site], circuit: CIRCUITS[site] }));
    ok(action(w, v, "verify"));
    const { order } = ok(action(w, v, "release"));
    const invoice = w.billing.bills.get(order.bill);
    assert.equal(invoice.status, "paid");
    assert.equal(w.ledger.balance(invoice.payee), paid + invoice.amount);
    assert.equal(invoice.payer, visitor.id);
    assert.equal(order.plate, vehicle.plate);
    assert.equal(
      paid + invoice.amount,
      R.money(8 + 10 + spec.price + spec.materials.reduce((n, c) => n + c + 6, 0) + 12),
    );
    assert.equal(w.harm.get(v).serviceFault, undefined);
    assert.equal(w.harm.get(v).serviceBay, undefined);
  });
