// The game's hands and body (docs/city/handling.mjs), the bar of eight and the inventory grid
// (docs/city/inventory.mjs), the world's checks behind them (world.mjs: pick up, throw, swing,
// checkout, rest at a bed), and people going in and out by doors (fleet.mjs).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { cityTime, loadRules } from "../docs/city/core.mjs";
import { City, DOOR_STEP_M, Roster } from "../docs/city/fleet.mjs";
import { canLift, jumpOf, liftKg, physOf, swingOf, throwOf, weightClass } from "../docs/city/handling.mjs";
import { BAR, SLOTS, arrange, barSlotOf, swap } from "../docs/city/inventory.mjs";
import { Streets, placeFromBuilding } from "../docs/city/people.mjs";
import { CityWorld } from "../docs/city/world.mjs";

const R = loadRules(JSON.parse(readFileSync(new URL("../docs/city/rules.json", import.meta.url))));
const timeAt = (ms) => cityTime(ms, R.clock.zone);
const NOON = Date.UTC(2026, 9, 6, 19, 0);

test("every thing has a material, a way to be held and a length", () => {
  for (const [id, it] of Object.entries(R.items)) {
    if (typeof it !== "object" || it.service) continue;
    assert.ok(R.handling.materials[it.material_of], `${id}: material ${it.material_of}`);
    assert.ok(["hand", "two_hands", "shoulder", "tool"].includes(it.hold), `${id}: hold ${it.hold}`);
    assert.ok(it.length_m > 0, `${id}: length`);
  }
});

test("lifting by strength: a cinder block is heavy, an 80 lb bag too heavy for the untrained", () => {
  assert.equal(liftKg(R, 20), 24);
  assert.equal(weightClass(R, 0.4, 20), "light");
  assert.equal(weightClass(R, 16, 20), "very heavy");
  assert.equal(weightClass(R, 36, 20), "too heavy to lift");
  assert.equal(weightClass(R, 36, 60), "very heavy");
  assert.equal(canLift(R, "concrete_mix", 20).ok, false);
  assert.match(canLift(R, "concrete_mix", 20).reason, /too heavy for you to lift/);
  assert.equal(canLift(R, "brick", 20, 14, 15).ok, false);   // liftable, but more than you can carry
});

test("throws: light things fly, heavy ones are heaved or refused; glass breaks, drinks spill", () => {
  const ball = throwOf(R, "apple", 20), brick = throwOf(R, "brick", 20), block = throwOf(R, "cinder_block", 20);
  assert.ok(ball.ok && brick.ok && block.ok);
  assert.ok(ball.speed > brick.speed && brick.speed > block.speed, `${ball.speed} > ${brick.speed} > ${block.speed}`);
  assert.ok(ball.range > 8 && block.range < 2.5, `apple ${ball.range} m, block ${block.range} m`);
  assert.equal(throwOf(R, "car_door", 20).ok, false);          // 25 kg: too heavy for you to lift
  assert.equal(throwOf(R, "car_door", 100).ok, true);          // the strong heave it
  assert.equal(throwOf(R, "ladder", 100).ok, false);           // unwieldy
  assert.equal(throwOf(R, "beer", 20).lands, "breaks");
  assert.equal(throwOf(R, "coffee", 20).lands, "spills");
  assert.ok(throwOf(R, "axe", 100).range > throwOf(R, "axe", 0).range);
});

test("swings: tools as tools, rigid things as a blunt blow, soft things and lumps not at all", () => {
  assert.equal(swingOf(R, null, 20).kind, "fists");
  assert.equal(swingOf(R, "axe", 20).kind, "axe");
  const plank = swingOf(R, "lumber", 20), bottle = swingOf(R, "glass_bottle", 20);
  assert.ok(plank.ok && plank.kind === "blunt" && plank.joules > bottle.joules);
  assert.ok(bottle.ok && bottle.breaks);
  assert.equal(swingOf(R, "t_shirt", 20).ok, false);
  assert.equal(swingOf(R, "cinder_block", 100).ok, false);    // both arms to hold
  assert.equal(swingOf(R, "nails", 20).ok, false);             // too small to swing
});

test("jumps by strength, against body and load", () => {
  const plain = jumpOf(R, 20), strong = jumpOf(R, 100), loaded = jumpOf(R, 20, 20), tall = jumpOf(R, 20, 0, { height_m: 1.95 });
  assert.ok(plain.height > 0.25 && plain.height < 0.45, `${plain.height} m`);
  assert.ok(strong.height > 0.6 && strong.height < 0.9, `${strong.height} m`);
  assert.ok(loaded.height < plain.height * 0.7);
  assert.ok(tall.height > plain.height);
  assert.ok(Math.abs(plain.flight - (2 * plain.speed) / 9.81) < 1e-9);
});

test("the bar and the grid keep where things are; new things go to the bar first", () => {
  let slots = arrange([], { apple: 2, axe: 1 });
  assert.equal(slots.length, SLOTS);
  assert.deepEqual(slots.slice(0, 2).sort(), ["apple", "axe"]);
  slots = swap(slots, 0, 12);
  const moved = slots[12];
  slots = arrange(slots, { apple: 2, axe: 1, water: 1 });
  assert.equal(slots[12], moved);              // kept where it was put
  assert.equal(slots[0], "water");             // the new thing in the first free bar slot
  slots = arrange(slots, { water: 1 });
  assert.equal(slots.filter(Boolean).length, 1);
  assert.equal(barSlotOf(slots, "water"), 0);
  // Full bar: the next thing goes into the grid.
  const many = Object.fromEntries(["a", "b", "c", "d", "e", "f", "g", "h", "i"].map((k) => [k, 1]));
  const full = arrange([], many);
  assert.equal(full.slice(0, BAR).filter(Boolean).length, BAR);
  assert.equal(full[BAR], "i");
});

function world() {
  const w = new CityWorld(R, { seed: "controls", now: NOON });
  w.submit("me", "join", { name: "Tester", at: { x: 0, z: 0, lon: -122.4335, lat: 37.8006 } });
  return w;
}

test("the world: too heavy to pick up, a throw lands (or breaks), a swing with a soft thing is refused", () => {
  const w = world(), p = w.players.get("me");
  w.items.set("bag1", { id: "bag1", item: "concrete_mix", qty: 1, x: 1, z: 0 });
  const heavy = w.submit("me", "pick_up", { id: "bag1" });
  assert.equal(heavy.ok, false);
  assert.match(heavy.error, /too heavy for you to lift/);
  w.items.set("b1", { id: "b1", item: "brick", qty: 1, x: 1, z: 0 });
  const got = w.submit("me", "pick_up", { id: "b1" });
  assert.ok(got.ok, got.error);
  assert.equal(got.class, "medium");
  w.submit("me", "hold", { item: "brick" });
  const r = w.submit("me", "throw", { to: { x: 4, z: 0 } });
  assert.ok(r.ok, r.error);
  assert.equal(p.inventory.brick, undefined);
  assert.equal(p.hands, null);
  assert.equal(w.items.get(r.dropped).item, "brick");
  // Too far for the throw: it lands where the throw goes.
  p.inventory.brick = 1; p.hands = "brick";
  const far = w.submit("me", "throw", { to: { x: 500, z: 0 } });
  assert.ok(far.ok && far.at.x < 15, `${far.at.x}`);
  // A bottle breaks where it lands: shards there, not the bottle.
  p.inventory.glass_bottle = 1; p.hands = "glass_bottle";
  const bottle = w.submit("me", "throw", { to: { x: 3, z: 1 } });
  assert.equal(bottle.lands, "breaks");
  assert.equal(w.items.get(bottle.dropped).item, "glass_shards");
  // A T-shirt does not swing.
  p.inventory.t_shirt = 1; p.hands = "t_shirt";
  const soft = w.submit("me", "strike", { target: { key: "bench@1,1", archetype: "furniture.bench", x: 1, z: 1, spec: { name: "Bench", material: "lumber", break_j: 900 } } });
  assert.equal(soft.ok, false);
  assert.match(soft.error, /too soft to swing/);
});

test("a thrown thing that hits someone hurts them, and is battery", () => {
  const w = world(), p = w.players.get("me");
  p.inventory.brick = 1; p.hands = "brick";
  const r = w.submit("me", "throw", { to: { x: 5, z: 0 }, hit: { id: "npc:x:1", name: "Sam", x: 5, z: 0 }, witnesses: 2 });
  assert.ok(r.ok, r.error);
  assert.ok(r.hit.injury.type);
  assert.ok(r.hit.fine > 0);
  assert.ok(w.harm.get("npc:x:1").health < 100);
});

test("the shop's checkout: the whole basket with tax, or nothing", () => {
  const w = world(), p = w.players.get("me");
  const place = { id: "shop1", x: 0, z: 0, keys: ["shop:hardware"] };
  const before = w.ledger.balance(p.account);
  const r = w.submit("me", "checkout", { place, cart: [{ item: "hammer", qty: 1 }, { item: "nails", qty: 2 }] });
  assert.ok(r.ok, r.error);
  assert.equal(p.inventory.hammer, 1);
  assert.equal(p.inventory.nails, 2);
  assert.ok(r.tax > 0);
  assert.equal(before - w.ledger.balance(p.account), r.total);
  // Not sold here; more than you can pay for: nothing bought.
  assert.equal(w.submit("me", "checkout", { place, cart: [{ item: "coffee", qty: 1 }] }).ok, false);
  const rich = w.submit("me", "checkout", { place, cart: [{ item: "drill", qty: 20 }, { item: "ladder", qty: 20 }] });
  assert.equal(rich.ok, false);
  assert.equal(p.inventory.drill, undefined);
});

test("rest only at a bed", () => {
  const w = world();
  const none = w.submit("me", "rest", { on: true });
  assert.equal(none.ok, false);
  assert.match(none.error, /bed/);
  assert.ok(w.submit("me", "rest", { on: true, bed: { building: "b1" } }).ok);
  assert.ok(w.submit("me", "rest", { on: false }).ok);
});

test("people leave and enter by the door: out along its line, never through the wall", () => {
  const ways = [];
  for (let i = 0; i <= 4; i += 1) {
    const along = Array.from({ length: 5 }, (_, j) => j * 100);
    ways.push({ kind: "street", pts: along.map((v) => [i * 100, v]), lanes: 2, oneway: 0, id: `v${i}`, name: `${i} Avenue` });
    ways.push({ kind: "street", pts: along.map((v) => [v, i * 100]), lanes: 2, oneway: 0, id: `h${i}`, name: `${i} Street` });
  }
  const streets = new Streets(ways), roster = new Roster(R, { seed: "doors" }), places = [];
  for (let i = 0; i < 4; i += 1) for (let j = 0; j < 4; j += 1) {
    // A 30 m square building in each block, its door in the middle of the wall facing z = j*100.
    const cx = i * 100 + 50, cz = j * 100 + 50;
    const b = { id: `b${i}${j}`, x: cx, z: cz, archetype: (i + j) % 3 ? "residential" : "office", floors: 3, area: 900, shops: (i * 4 + j) % 5 ? [] : [{ t: "cafe", n: "Cup" }], name: `${i}${j} Test St`, tag: "apartments",
      door: { x: cx, z: cz - 15, nx: 0, nz: 1 } };
    const pl = placeFromBuilding(b, streets, R);
    if (pl) places.push(pl);
  }
  roster.add(places);
  const city = new City(R, roster, streets, { seed: "doors", timeAt });
  const inside = (P, x, z) => Math.abs(x - P.x) < 14.9 && Math.abs(z - P.z) < 14.9;
  const dayStart = Date.UTC(2026, 9, 6, 7, 0);
  let doorways = 0, checked = 0;
  for (const p of [...roster.people.values()].slice(0, 60)) {
    for (let s = 6 * 3600; s < 21 * 3600; s += 4) {
      const pos = city.personAt(p, timeAt(dayStart + s * 1000), undefined, { x: 200, z: 200 });
      if (!pos || pos.indoors || pos.mode !== "walk") continue;
      checked += 1;
      if (pos.through) doorways += 1;
      for (const P of places) {
        if (!inside(P, pos.x, pos.z)) continue;
        // Inside a building only on its threshold, in the doorway.
        assert.ok(pos.through && Math.hypot(pos.x - P.door.x, pos.z - P.door.z) < 1, `${p.id} inside ${P.id} at ${pos.x.toFixed(1)},${pos.z.toFixed(1)} (${pos.activity})`);
      }
    }
  }
  assert.ok(checked > 300, `${checked} samples`);
  assert.ok(doorways > 0, "nobody went through a door");
  assert.equal(DOOR_STEP_M, 1.6);
});
