// Riders out on an errand lock their bicycles to the city's racks (docs/city/fleet.mjs
// setRacks/rackSlot): the nearest with a place free within a walk of the door, one bicycle a place.

import assert from "node:assert/strict";
import { test } from "node:test";

import { City } from "../docs/city/fleet.mjs";

const slot = (x, z, yaw) => ({ x, z, yaw, lock: { x, y: 0.67, z, yaw } });
const rack = (id, x, z) => ({ id, x, z, yaw: 0, slots: [slot(x, z - 0.16, Math.PI / 2), slot(x, z + 0.16, -Math.PI / 2)] });

function city(racks) {
  const c = Object.create(City.prototype);
  c.spots = new Map(); c.plans = new Map();
  c.setRacks(racks);
  return c;
}

test("a rider takes a place at the nearest rack, and no two bicycles share a place", () => {
  const c = city([rack("far", 50, 0), rack("near", 10, 0), { id: "bad", x: NaN, z: 0, slots: [slot(0, 0, 0)] }]);
  const door = { x: 0, z: 0 };
  const a = c.rackSlot({ id: "a" }, door), b = c.rackSlot({ id: "b" }, door), d = c.rackSlot({ id: "d" }, door);
  assert.equal(a.rack, "near"); assert.equal(b.rack, "near"); assert.equal(d.rack, "far");
  assert.notDeepEqual([a.x, a.z], [b.x, b.z]);
  assert.ok(a.lock && Number.isFinite(a.lock.y), "the place carries its lock");
  c.rackSlot({ id: "e" }, door);
  assert.equal(c.rackSlot({ id: "f" }, door), null, "every place within reach is taken");
});

test("a rack beyond a short walk is not used, and new racks free every place", () => {
  const c = city([rack("r", 80, 0)]);
  assert.equal(c.rackSlot({ id: "a" }, { x: 0, z: 0 }), null);
  assert.equal(c.rackSlot({ id: "a" }, { x: 30, z: 0 }).rack, "r");
  c.spots.set("a:shop", { rack: true }); c.spots.set("b:home", { rack: false });
  c.setRacks([rack("r", 80, 0)]);
  assert.ok(!c.spots.has("a:shop") && c.spots.has("b:home"), "spots at racks are found again");
  assert.equal(c.rackSlot({ id: "b" }, { x: 30, z: 0 }).rack, "r");
  assert.equal(city([]).rackSlot({ id: "a" }, { x: 0, z: 0 }), null);
});
