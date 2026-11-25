// The shop floor as the page runs it (docs/city/shop-floor.mjs) against the world (shopping.mjs):
// a product drawn on a shelf is taken off it into your basket and is gone from the shelf; paid
// at a lane it is yours; and the other shoppers walk the aisles to a till and wait their turn.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as THREE from "../docs/vendor/three-0.160.0/three.module.min.js";

import { loadRules } from "../docs/city/core.mjs";
import { CityWorld } from "../docs/city/world.mjs";
import { planStore } from "../docs/city/store-room.mjs";
import { shopFloor } from "../docs/city/shop-floor.mjs";
import { storeNav } from "../docs/city/npc-steer.mjs";
import { canWalkStore } from "../docs/city/store-room.mjs";

const R = loadRules(JSON.parse(readFileSync(new URL("../docs/city/rules.json", import.meta.url))));
const T0 = Date.UTC(2026, 10, 9, 18, 0);
const MARINA = { lon: -122.4368, lat: 37.8003, county: "county:san-francisco" };
const place = { id: "g1", x: 0, z: 0, name: "Safeway", keys: ["use:retail", "shop:grocery"], area: 900, ...MARINA };
// A room frame like view.mjs shopFrame's, with its front on the x axis and in toward +z.
const F = { y: 0, I: { x: 0, z: 0, nx: 0, nz: 1 }, at: (u, v) => ({ x: v, z: u }), local: (x, z) => ({ u: z, v: x }) };
const sku = R.stores.kinds.grocery.items.find((id) => !R.items[id].needs && (R.items[id].kg || 0) > 0 && R.items[id].kg < 1);

function setup() {
  const w = new CityWorld(R, { now: T0, seed: "floor" });
  w.submit("ana", "join", { name: "Ana", at: { x: 0, z: 0, ...MARINA } });
  const plan = planStore({ width: 22, depth: 20, doorX: 0, name: "Safeway" }, "supermarket");
  const notes = [];
  const floor = shopFloor({ THREE, R, send: async (c, a) => w.submit("ana", c, a), notify: (t) => notes.push(t), getView: () => w, self: () => w.players.get("ana") });
  const parent = new THREE.Group(), g = new THREE.Group(); parent.add(g);
  floor.room(place, F, plan, g);
  // Six of the product faced on the first gondola shelf (an instanced stand-in).
  const sh = plan.shelves.find((s) => s.section !== "checkout");
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), new THREE.MeshBasicMaterial(), 6);
  const stock = { set: (i, m) => mesh.setMatrixAt(i, m), count: (n) => { mesh.count = n; } };
  const list = Array.from({ length: 6 }, (_, k) => ({ x: sh.x + k * 0.12, y: sh.y, z: sh.z, yaw: 0 }));
  floor.stocked(sku, stock, list, 6, g);
  return { w, floor, plan, notes, sh, mesh, list };
}

test("taken off the shelf it is gone from it; paid for at a lane it is yours", async () => {
  const { w, floor, plan, notes, list } = setup();
  const here = { x: list[0].x, z: list[0].z - 0.8 };
  const near = floor.near(here, Math.PI);   // facing +z, toward the shelf
  assert.ok(near, "the product within reach");
  let acts = floor.actions(here, Math.PI, 12);
  assert.ok(acts.some((a) => a.id === "shelf" && a.key === "Click"));
  const r = await floor.take(near.item);
  assert.equal(r.ok, true, r.error);
  assert.equal(floor.state().gone, 1);
  assert.equal(w.onShelf(place, sku), 24 - 1);
  // At the first lane's shopper place: pay.
  const lane = plan.fixtures.find((f) => f.role === "checkout" && f.lane === 1);
  assert.ok(lane);
  const tills = floor.state().tills;
  assert.ok(tills.some((t) => t.kind === "staffed") && tills.some((t) => t.kind === "self"));
  const shopper = { x: lane.x - lane.side * (lane.w / 2 + 0.45), z: lane.z - 0.34 * lane.len };
  acts = floor.actions(shopper, 0, 12);
  const pay = acts.find((a) => a.id === "pay");
  assert.ok(pay, `a till: ${acts.map((a) => a.label).join(" | ")}`);
  const paid = await pay.run();
  assert.equal(paid.ok, true, paid?.error);
  assert.equal(w.players.get("ana").inventory[sku], 1);
  assert.ok(notes.some((n) => /yours, in your inventory/.test(n)));
});

test("walking out with what is unpaid puts it back; the shelf drawn as the world has it", async () => {
  const { w, floor, list } = setup();
  const near = floor.near({ x: list[0].x, z: list[0].z - 0.8 }, Math.PI);
  await floor.take(near.item);
  await floor.close();
  assert.equal(w.onShelf(place, sku), 24);
  // Two bought by someone else: two drawn gone when the room is built again.
  w.submit("ben", "join", { name: "Ben", at: { x: 0, z: 0, ...MARINA } });
  w.submit("ben", "shop_carrier", { place, carrier: "basket" });
  w.submit("ben", "shelf_take", { place, item: sku, qty: 2 });
  const again = setup.call(null);
  void again;
  const plan = planStore({ width: 22, depth: 20, doorX: 0, name: "Safeway" }, "supermarket");
  const f2 = shopFloor({ THREE, R, send: async (c, a) => w.submit("ana", c, a), notify: () => {}, getView: () => w, self: () => w.players.get("ana") });
  const g = new THREE.Group(); new THREE.Group().add(g);
  f2.room(place, F, plan, g);
  const stock = { set: () => {}, count: () => {} };
  f2.stocked(sku, stock, list, 6, g);
  assert.equal(f2.state().gone, 2);
});

test("the other shoppers walk to the shelves and a till, in line, never through a shelf", () => {
  const { floor, plan } = setup();
  const entries = Array.from({ length: 6 }, (_, i) => ({ id: `npc:h${i}:0`, indoors: place.id, x: plan.doorX + (i - 3) * 0.4, z: 0.8, person: { work: "elsewhere" } }));
  const grid = new Map(), floorGrid = storeNav(plan, canWalkStore, 0.3);
  let lined = 0, moved = 0, inShelf = 0, steps = new Set();
  for (let k = 0; k < 30 * 90; k += 1) {
    for (const e of entries) floor.walk(e, { x: 0, z: -5 }, 1 / 30, 12);
    floor.step({ x: 50, z: 50, yaw: 0 }, 1 / 30);
    const st = floor.state();
    lined = Math.max(lined, ...st.tills.map((t) => t.line.length));
    for (const a of st.agents) { if (!floorGrid.freeAt(a.x, a.z)) inShelf += 1; steps.add(a.label); const key = a.id; if (grid.has(key) && Math.hypot(grid.get(key).x - a.x, grid.get(key).z - a.z) > 0.01) moved += 1; grid.set(key, { x: a.x, z: a.z }); }
  }
  assert.ok(moved > 100, "they walk");
  assert.ok(lined >= 1, "someone waited at a till");
  assert.equal(inShelf, 0, "nobody stood in a shelf");
  assert.ok(steps.has("looking along the shelves") && [...steps].some((l) => /paying|scanning|waiting in line/.test(l)), [...steps].join(", "));
});
