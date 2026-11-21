// Shops fitted to their trade and their space (docs/city/store-room.mjs), every shop's front
// (docs/city/storefronts.mjs), and restaurants' crews, corners and tiers (restaurant-room.mjs).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadRules } from "../docs/city/core.mjs";
import { STORE_PROGRAMS, canWalkStore, planStore, storeProgramOf } from "../docs/city/store-room.mjs";
import { TRADE_SIGNS, tradeSignage, windowDisplayOf } from "../docs/city/storefronts.mjs";
import { planRestaurant, restaurantService, restaurantStaff, SERVICE_TIERS } from "../docs/city/restaurant-room.mjs";
import { normalizeSignage } from "../docs/interior-lab/signage.mjs";

const R = loadRules(JSON.parse(readFileSync(new URL("../docs/city/rules.json", import.meta.url))));
const KINDS = ["supermarket", "convenience", "clothes", "shoes", "books", "pharmacy", "hardware", "electronics", "florist", "hairdresser", "nail_salon", "laundry", "bank", "bar", "gifts", "general"];

test("every trade's room: its fixtures, a till, a clear way in from the door to the back, and the stock room kept for staff", () => {
  for (const kind of KINDS) for (const size of [{ width: 5, depth: 7 }, { width: 8, depth: 12 }, { width: 12, depth: 20 }]) for (const doorX of [0, 1.2, -1.5]) {
    const p = planStore({ ...size, doorX }, kind), P = STORE_PROGRAMS[p.program] || { wall: "multideck", island: "gondola" };
    assert.ok(p.fixtures.some((f) => f.role === "till" || f.role === "bar" || f.role === "checkout"), `${kind} has a till`);
    assert.ok(p.fixtures.some((f) => f.role === P.wall || f.role === P.island), `${kind} has its trade's fixtures`);
    // Nothing overlaps, and everything is inside the room.
    const solid = p.fixtures.filter((f) => f.role !== "partition" && f.role !== "stocked" && f.role !== "stock_shelf");
    for (const [i, a] of solid.entries()) {
      assert.ok(Math.abs(a.x) + a.w / 2 <= size.width / 2 && a.z + a.d / 2 <= size.depth, `${kind} ${a.role} inside`);
      for (const b of solid.slice(i + 1)) assert.ok(Math.abs(a.x - b.x) >= (a.w + b.w) / 2 || Math.abs(a.z - b.z) >= (a.d + b.d) / 2, `${kind} ${a.role}/${b.role} apart`);
    }
    const rear = Math.max(0, ...p.fixtures.filter((f) => f.back).map((f) => f.d));
    for (let z = 0.3; z < p.floorEnd - 1.3 - rear; z += 0.2) assert.ok(canWalkStore(p, doorX, z), `${kind} ${JSON.stringify(size)} door ${doorX}: blocked at ${z.toFixed(1)}`);
    const part = p.fixtures.find((f) => f.role === "partition");
    if (size.depth >= 8.5) {
      assert.ok(part, "a deep shop keeps a stock room");
      assert.equal(canWalkStore(p, part.door, part.z + 1), false, "not for customers");
      assert.equal(canWalkStore(p, part.door, part.z + 1, true), true, "staff go in");
    }
  }
  assert.equal(storeProgramOf("supermarket"), "grocery");
  assert.equal(storeProgramOf("convenience"), "corner");
  assert.equal(storeProgramOf("something_new"), "shop");
});

test("every shop has a front in its trade's look, varied by shop, and a window display where it shows goods", () => {
  for (const kind of [...KINDS, ...Object.keys(R.stores.kinds)]) {
    const s = normalizeSignage(tradeSignage(kind, "x1", { tagline: "Fresh flowers" }));
    assert.ok(s && s.name.colour && s.tagline.text === "Fresh flowers", kind);
  }
  assert.equal(tradeSignage("cafe", "a").awning.type === "striped" || tradeSignage("cafe", "a").awning.type === "sloped", true);
  const looks = new Set(Array.from({ length: 20 }, (_, i) => JSON.stringify(tradeSignage("shop", `s${i}`))));
  assert.ok(looks.size >= 2, "two shops of a trade are not all alike");
  assert.equal(tradeSignage("restaurant", "r", { style: "counter" }).medium, "board", "fast food: a bright board");
  assert.ok(TRADE_SIGNS.dining.every((l) => l.name.style === "serif"), "fine dining: serif lettering");
  assert.equal(windowDisplayOf("florist"), "flowers");
  assert.equal(windowDisplayOf("clothes"), "forms");
  assert.equal(windowDisplayOf("bank"), null, "a bank shows nothing in its window");
  assert.equal(windowDisplayOf("restaurant", "dining"), null);
});

test("a restaurant's crew from its seats and prices, and a kitchen as deep as that crew needs", () => {
  const fast = restaurantService(R, "american"), fine = restaurantService(R, "seafood");
  const a = restaurantStaff(60, fast), b = restaurantStaff(60, fine);
  assert.ok(b.front > a.front && b.cooks > a.cooks, "fine dining takes more hands for the same seats");
  assert.ok(b.host === 1 && a.host === 0);
  assert.ok(restaurantStaff(120, fast).total > a.total);
  for (const [kind, size] of [["american", { width: 12, depth: 14 }], ["diner", { width: 16, depth: 20 }], ["seafood", { width: 16, depth: 20 }]]) {
    const p = planRestaurant(size, restaurantService(R, kind));
    assert.ok(p.staff.total >= 2 && p.kitchenDepth >= 2.5, kind);
    // A hand sink at every kitchen, the dish pit past twenty seats, the pass and tills at the counter.
    const stations = p.fixtures.flatMap((f) => f.stations || []);
    assert.ok(stations.includes("handsink"), kind);
    if (p.seats.length > 20) assert.ok(stations.includes("dish"), kind);
    assert.ok(p.fixtures.find((f) => f.role === "counter")?.tills >= 1, kind);
  }
});

test("corner tables, booths along the walls and each tier's own furniture", () => {
  const diner = planRestaurant({ width: 12, depth: 14 }, restaurantService(R, "diner"));
  assert.ok(diner.fixtures.filter((f) => f.corner).length >= 2, "tables pushed into the corners");
  assert.ok(diner.fixtures.some((f) => f.role === "booth"), "cushioned booths at a diner");
  for (const f of diner.fixtures.filter((f) => f.corner)) assert.ok(Math.abs(f.x) + f.w / 2 > 12 / 2 - 0.2, "against the wall");
  const fine = planRestaurant({ width: 7, depth: 18 }, restaurantService(R, "seafood"));
  assert.ok(fine.fixtures.some((f) => f.role === "banquette"), "a banquette in fine dining");
  assert.ok(fine.fixtures.some((f) => f.role === "host"), "a host stand by the door");
  assert.ok(fine.fixtures.some((f) => f.role === "office"), "the manager's desk");
  assert.equal(SERVICE_TIERS.counter.finish, "metal");
  assert.equal(SERVICE_TIERS.casual.finish, "wood");
  const scene = readFileSync(new URL("../docs/city/restaurant-scene.mjs", import.meta.url), "utf8");
  assert.match(scene, /const top=tier==="counter"\?metalTop:tier==="dining"\?darkWood:wood;/, "metal tops at a counter place, wood at a diner");
  assert.match(scene, /const cushion=tier==="counter"\?plastic:banquette\?velvet:vinyl/, "booths in vinyl, banquettes upholstered");
});
