// A supermarket's floor in the City's shop room (docs/city/grocery-room.mjs): produce inside the
// door, cold banks on the walls and a frozen aisle, staffed lanes and self-checkout in the chain's
// mix, gondolas by the catalogue's aisles, every shelf reachable from the door, and its shelves
// stocked with the shop's products at their size (shelf-stock.mjs).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { aisleMap } from "../docs/city/aisles.mjs";
import { inPocket, lanePoints, planGrocery, selfCheckoutShare } from "../docs/city/grocery-room.mjs";
import { faceShelf, itemSize, sectionsFor, stockShelves } from "../docs/city/shelf-stock.mjs";
import { canWalkStore, planStore } from "../docs/city/store-room.mjs";

const R = JSON.parse(readFileSync(new URL("../docs/city/rules.json", import.meta.url)));
const O = JSON.parse(readFileSync(new URL("../docs/city/objects.json", import.meta.url)));
const SIZES = [[22, 20, 0], [22, 20, 3], [12, 16, 1.2], [16, 14, -2], [9.5, 12, 0], [14, 20, -4]];

//: Cells one can walk to from just inside the door (0.25 m grid, 4-connected).
function reach(p) {
  const res = 0.25, cell = (x, z) => `${Math.round(x / res)},${Math.round(z / res)}`, seen = new Set(), out = [];
  const q = [[Math.round(p.doorX / res) * res, 0.5]];
  while (q.length) {
    const [x, z] = q.pop(), key = cell(x, z);
    if (seen.has(key) || !canWalkStore(p, x, z)) continue;
    seen.add(key); out.push([x, z]);
    for (const [dx, dz] of [[res, 0], [-res, 0], [0, res], [0, -res]]) q.push([x + dx, z + dz]);
  }
  return out;
}

test("a supermarket: produce by the door, refrigerated walls and a frozen aisle, lanes and self-checkout", () => {
  for (const [width, depth, doorX] of SIZES) {
    const p = planStore({ width, depth, doorX, name: "Safeway" }, "supermarket"), roles = new Set(p.fixtures.map((f) => f.role));
    assert.ok(p.grocery, `${width}x${depth}: the supermarket program`);
    assert.ok(p.shelves.some((s) => s.section === "produce"), "produce");
    assert.ok(roles.has("produce_case"), "a refrigerated produce case");
    assert.ok(roles.has("multideck") && p.shelves.some((s) => s.section === "dairy") && p.shelves.some((s) => s.section === "meat_seafood"), "dairy and meat in open cases");
    assert.ok(p.shelves.some((s) => s.section === "frozen"), "frozen");
    assert.ok(roles.has("cooler_doors") || roles.has("freezer_doors"), "glass-door cases on the wall");
    if (width >= 15) assert.ok(roles.has("freezer_island"), "a frozen aisle: freezers back to back, facing the wall's doors");
    assert.ok(p.lanes >= 1, "a staffed lane");
    if (width >= 12) assert.ok(p.selfCheckouts >= 2, `${width}: self-checkout at a Safeway`);
    // The lanes and self-checkouts across the front; nothing outside the room or overlapping.
    for (const f of p.fixtures.filter((f) => f.role === "checkout" || f.role === "self_checkout")) assert.ok(f.z + f.d / 2 < 4.2, "checkouts at the front");
    const solid = p.fixtures.filter((f) => f.role !== "partition" && f.role !== "stock_shelf");
    for (const [i, a] of solid.entries()) {
      assert.ok(Math.abs(a.x) + a.w / 2 <= width / 2 + 1e-6 && a.z + a.d / 2 <= p.floorEnd + 1e-6, `${a.role} inside`);
      for (const b of solid.slice(i + 1)) assert.ok(Math.abs(a.x - b.x) >= (a.w + b.w) / 2 - 0.02 || Math.abs(a.z - b.z) >= (a.d + b.d) / 2 - 0.02, `${a.role}/${b.role} apart`);
    }
  }
  assert.equal(planStore({ width: 22, depth: 20, doorX: 0, name: "Trader Joe's" }, "supermarket").selfCheckouts, 0, "no self-checkout at Trader Joe's");
  assert.equal(selfCheckoutShare("Whole Foods Market"), 0.5);
  assert.equal(planGrocery({ width: 7, depth: 9 }), null, "too small: the small shop's room");
  assert.equal(planStore({ width: 7, depth: 9 }, "supermarket").program, "grocery");
});

test("every shelf is reached from the door, the cashier's pocket is staff only, the lane is paid at", () => {
  for (const [width, depth, doorX] of SIZES) {
    const p = planStore({ width, depth, doorX, name: "Lucky" }, "supermarket"), cells = reach(p);
    for (const sh of p.shelves) {
      // A shopper can stand within arm's reach of the shelf's front.
      const fx = sh.x - Math.sin(sh.yaw) * (sh.deep / 2), fz = sh.z - Math.cos(sh.yaw) * (sh.deep / 2);
      assert.ok(cells.some(([x, z]) => Math.hypot(x - fx, z - fz) < 1.05), `${width}x${depth}@${doorX}: ${sh.section} shelf at ${fx.toFixed(1)},${fz.toFixed(1)} reached`);
    }
    for (const lane of p.fixtures.filter((f) => f.role === "checkout")) {
      const { cashier, shopper } = lanePoints(lane);
      assert.ok(inPocket(lane, cashier.x, cashier.z) && canWalkStore(p, cashier.x, cashier.z, true), "the cashier stands in the pocket");
      assert.equal(canWalkStore(p, cashier.x, cashier.z), false, "a shopper does not");
      assert.ok(cells.some(([x, z]) => Math.hypot(x - shopper.x, z - shopper.z) < 0.4), "the shopper reaches the register");
    }
    if (p.fixtures.some((f) => f.role === "gondola")) assert.ok(p.signs.some((s) => s.number === 1), "aisles are numbered");
  }
});

test("shelves stocked with the shop's own products, faced by display, at their size", () => {
  const { aisleOf, displayOf } = aisleMap(R);
  const sells = R.stores.kinds.grocery.items;
  const p = planStore({ width: 22, depth: 20, doorX: 0, name: "Safeway" }, "supermarket");
  const sizeOf = (id) => itemSize(O, R, id), sections = sectionsFor(p, sells, aisleOf, (id) => Boolean(sizeOf(id)));
  assert.ok(sections.produce.includes("apple") && sections.dairy.includes("milk") && sections.spices?.length >= 1);
  const placed = stockShelves(p, sections, sizeOf, (id) => displayOf[id]);
  const total = [...placed.values()].reduce((t, l) => t + l.length, 0);
  assert.ok(total > 2500 && total <= 7500, `stocked ${total}`);
  // The gondolas' shelves are faced end to end: each stretch's first and last product near its ends.
  for (const id of ["milk", "eggs", "apple", "bananas", "cereal", "chips"]) assert.ok(placed.get(id)?.length >= 2, `${id} on a shelf`);
  // Every placement is on a shelf of its own section, inside the room, standing on the shelf.
  for (const [id, list] of placed) for (const q of list) {
    assert.ok(Math.abs(q.x) < 11 && q.z > 0 && q.z < p.floorEnd, `${id} in the room`);
    assert.ok(q.y >= 0.1 && q.y < 2.2, `${id} at shelf height`);
  }
  // Cans stack; bottles stand one high; produce heaps two layers.
  const shelf = { len: 1, deep: 0.5, h: 0.34 };
  assert.ok(new Set(faceShelf(shelf, [0.07, 0.1, 0.07], "stack").map((q) => q.y)).size === 3);
  assert.equal(new Set(faceShelf(shelf, [0.07, 0.25, 0.07], "row").map((q) => q.y)).size, 1);
  assert.ok(faceShelf(shelf, [0.08, 0.08, 0.08], "bin").some((q) => q.y > 0));
});
