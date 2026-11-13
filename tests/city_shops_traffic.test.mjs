// Shops that sell what such a shop sells, services booked online at their own price, jobs on the
// to-do list, lanes taken for the turn ahead, bikes in the bike lanes, and buses boarded from
// the kerb (docs/city/core.mjs, world.mjs, people.mjs, view.mjs).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { loadRules, shopKinds, storesAt } from "../docs/city/core.mjs";
import { BIKE_LANE, DRIVE_LANE, LANE, Streets, alongRoute, lanePlan } from "../docs/city/people.mjs";
import { CityWorld } from "../docs/city/world.mjs";

const R = loadRules(JSON.parse(readFileSync(new URL("../docs/city/rules.json", import.meta.url))));
const VIEW = readFileSync(new URL("../docs/city/view.mjs", import.meta.url), "utf8");
const WED_13 = Date.UTC(2026, 10, 4, 21, 0);

test("a tenant is the kind of place its name says, where its map tag is too coarse or wrong", () => {
  assert.deepEqual(shopKinds(R, "restaurant", "Marcela's Taqueria"), ["mexican"]);
  assert.deepEqual(shopKinds(R, "restaurant", "Marufuku Ramen"), ["japanese"]);
  assert.deepEqual(shopKinds(R, "restaurant", "Ben Thai Cafe"), ["thai"], "the cuisine, not the café");
  assert.deepEqual(shopKinds(R, "pharmacy", "Presidio Dental"), ["dentist"]);
  assert.deepEqual(shopKinds(R, "pharmacy", "Walgreens"), ["pharmacy"]);
  assert.deepEqual(shopKinds(R, "convenience", "Marina Deli & Liquor").sort(), ["deli", "liquor"]);
  assert.deepEqual(shopKinds(R, "shop", "Feldman Architecture"), [], "an office is no shop");
  assert.deepEqual(shopKinds(R, "shop", "T-Mobile"), ["electronics"], "not a Mobil station");
  assert.deepEqual(shopKinds(R, "salon", "Golden Door Barber"), ["barber"]);
  assert.deepEqual(shopKinds(R, "cafe", "Philz Coffee"), ["cafe"]);
  assert.deepEqual(shopKinds(R, "restaurant", null), ["restaurant"]);
});

test("each kind of shop sells what such a shop has", () => {
  const sells = (kind) => storesAt(R, [`shop:${kind}`])[0].items;
  for (const id of ["candy_bar", "chips", "soda", "water", "gum", "snack_bar"]) assert.ok(sells("convenience").includes(id), id);
  for (const id of ["burrito", "tacos"]) assert.ok(sells("mexican").includes(id), id);
  for (const id of ["screws", "duct_tape", "light_bulbs", "hammer", "paint"]) assert.ok(sells("hardware").includes(id), id);
  assert.ok(!sells("hardware").includes("coffee") && !sells("convenience").includes("hammer"));
  assert.ok(sells("restaurant").every((id) => R.items[id].kind === "prepared_food" || ["soda", "water"].includes(id)), "a restaurant serves meals");
  // Every item every shop sells is a real item.
  for (const [kind, st] of Object.entries(R.stores.kinds)) for (const id of st.items) assert.ok(R.items[id], `${kind}: ${id}`);
});

test("a service booked online is paid at its own price and had at the place", () => {
  const w = new CityWorld(R, { now: WED_13 });
  const at = { x: 0, z: 0, lon: -122.4194, lat: 37.7749 };
  w.submit("ana", "join", { name: "Ana", at });
  const salon = { id: "s1", x: 400, z: 0, keys: ["shop:salon"], lon: -122.4194, lat: 37.7749 };
  const before = w.ledger.balance(w.players.get("ana").account);
  const b = w.submit("ana", "book_service", { item: "haircut", place: salon });
  assert.ok(b.ok, b.error);
  assert.equal(b.price, R.items.haircut.price, "not marked up");
  assert.equal(before - w.ledger.balance(w.players.get("ana").account), b.price + b.tax);
  assert.equal(w.submit("ana", "book_service", { item: "haircut", place: { ...salon, keys: ["shop:cafe"] } }).ok, false, "not given at a café");
  assert.equal(w.submit("ana", "use_booking", { booking: b.booking.id }).ok, false, "had there, not here");
  Object.assign(w.players.get("ana"), { x: 402, z: 1 });
  const had = w.submit("ana", "use_booking", { booking: b.booking.id });
  assert.ok(had.ok, had.error);
  assert.equal(w.submit("ana", "status").bookings.length, 0);
  // An eye exam lets prescription glasses be bought, as a doctor's visit lets medicine.
  const optician = { id: "o1", x: 402, z: 1, keys: ["shop:optician"] };
  assert.equal(w.submit("ana", "buy", { item: "glasses", place: optician }).ok, false);
  assert.ok(w.submit("ana", "buy", { item: "eye_exam", place: optician }).ok);
  assert.ok(w.submit("ana", "buy", { item: "glasses", place: optician }).ok);
});

test("the Shop lists services and jobs; a shop's panel points there; work is on the to-do list", () => {
  assert.ok(VIEW.includes('["services", "Services"], ["jobs", "Jobs"]'));
  assert.ok(VIEW.includes('send("book_service", { item: id, place: placeArg(pl) })'));
  assert.ok(VIEW.includes('send("take_job", { role, place: placeArg(pl) })'));
  assert.ok(VIEW.includes("store0.items.filter((id) => !R.items[id].service)"), "a shop's own panel lists goods");
  assert.ok(VIEW.includes("Go to work: ${p.job.title}") && VIEW.includes('"Clock in: you are at work"'));
  assert.ok(VIEW.includes('label: `Clock in: ${p.job.title}`, key: "", run: workKey'), "clock in on the action bar");
});

// A two-lane-each-way avenue running north (-z), a left turn onto a cross street at z = -200.
function avenue() {
  return new Streets([
    { kind: "street", pts: [[0, 0], [0, -100], [0, -200], [0, -300]], lanes: 4, road_m: 16, name: "Lombard" },
    { kind: "street", pts: [[-150, -200], [0, -200], [150, -200]], lanes: 2, road_m: 10, name: "Fillmore" },
  ]);
}

test("a car keeps to the lane for the turn ahead: the leftmost to turn left, the kerb lane to turn right", () => {
  const s = avenue();
  const left = s.route(s.nearest(0, 0, "drive"), s.nearest(-150, -200, "drive"), "drive");
  const right = s.route(s.nearest(0, 0, "drive"), s.nearest(150, -200, "drive"), "drive");
  const on = s.route(s.nearest(0, 0, "drive"), s.nearest(0, -300, "drive"), "drive");
  assert.ok(left && right && on);
  const plan = lanePlan(left);
  assert.equal(plan.n[0], 2, "two lanes each way");
  // Approaching the junction (the block before it), offsets right of the middle line.
  const offAt = (route, i) => DRIVE_LANE(route.halves[i], route.classes[i], route.parks[i], i, route);
  const kerb = LANE(left.halves[1], left.classes[1], left.parks[1]);
  assert.ok(offAt(left, 1) < kerb - 2, `left turn from the inner lane: ${offAt(left, 1).toFixed(2)} vs kerb ${kerb.toFixed(2)}`);
  assert.equal(offAt(right, 1), LANE(right.halves[1], right.classes[1], right.parks[1]), "right turn from the kerb lane");
  assert.equal(offAt(on, 1), LANE(on.halves[1], on.classes[1], on.parks[1]), "straight on: the kerb lane");
  // The car itself is in that lane: left of where a car going straight is.
  const pL = alongRoute(left, 150, DRIVE_LANE), pS = alongRoute(on, 150, DRIVE_LANE);
  assert.ok(pL.x < pS.x - 2, "further left (west) when turning left");
});

test("bikes ride in the bike lane, beside the kerb or outside the parked cars", () => {
  const route = { bikes: ["lane", null, "track"] };
  assert.ok(Math.abs(BIKE_LANE(8, "arterial", false, 0, route) - 7.05) < 1e-9, "a lane beside the kerb");
  assert.ok(BIKE_LANE(8, "residential", null, 0, route) < BIKE_LANE(8, "arterial", false, 0, route), "outside the parked cars");
  assert.equal(BIKE_LANE(8, "arterial", false, 2, route), 7.25, "a track at the kerb");
  assert.ok(VIEW.includes("function stepBikes(") && VIEW.includes('junctionAt(s, node) !== "signal"') && VIEW.includes('light === "red"'), "they stop at red lights");
  assert.ok(VIEW.includes("parking_sides: way.parking_sides, bike: bikeSides(way)"));
});

test("a bus is boarded from the kerb side and left onto the pavement", () => {
  assert.ok(VIEW.includes('if (d < reach && v.model === "bus" && !fromKerbSide(v, p)) { wrongSide = v; continue; }'));
  assert.ok(VIEW.includes("besideOf(at, v.pole).right > 0.5"), "the pole only where it is on the door side");
  assert.ok(VIEW.includes("ctx.moveAvatarTo(at.x + Math.cos(yaw) * out, at.z - Math.sin(yaw) * out)"), "else off the door side");
});

test("people are of many heights and builds, from their ids, and walk with a step", () => {
  // From the normal curve (city_npc.test.mjs measures the averages and the spread).
  assert.ok(VIEW.includes("height = adultHeight(female, g);") && VIEW.includes("g = normalDraw(r);"));
  assert.ok(VIEW.includes("parts.hair.setColorAt(n,"), "hair");
  assert.ok(VIEW.includes('legL: mk(legGeo, MAX_PEOPLE, { vertexColors: true })'), "shoes by vertex colour, no extra part");
});

test("the compass's open box opens under the compass, never over the profile card", () => {
  const pins = readFileSync(new URL("../src/smc/renderer/page/module/23-pins-1-2-and-3.js", import.meta.url), "utf8");
  assert.ok(pins.includes("if (open) placeSunDial();") && pins.includes("sunDialBox.style.top = `${top}px`;"));
  assert.ok(VIEW.includes('const dial = doc.getElementById("sun-dial");') && VIEW.includes("dial.style.top = `${Math.round(C.bottom + 8)}px`;"));
});
