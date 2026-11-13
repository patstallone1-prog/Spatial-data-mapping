// The city's people getting about and the law seeing it (docs/city/fleet.mjs, people.mjs,
// transit.mjs, enforcement.mjs, repair.mjs): residents without a car take a taxi or the bus on a
// long trip, play at the parks' courts and look round the shops; a garage door is up as its car
// goes out or comes in; a bus waits a little for you and no longer; a moving violation is fined
// only where a camera or a patrol car saw it; what breaks is boarded up and then mended.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { cityTime, loadRules } from "../docs/city/core.mjs";
import { cameraSees, witnessOf } from "../docs/city/enforcement.mjs";
import { City, Roster } from "../docs/city/fleet.mjs";
import { Streets, counterLine, indoorSpot, placeFromBuilding } from "../docs/city/people.mjs";
import { boardedPlanks, placePlanks, repairStage } from "../docs/city/repair.mjs";
import { buildLines, busesAt } from "../docs/city/transit.mjs";

const R = loadRules(JSON.parse(readFileSync(new URL("../docs/city/rules.json", import.meta.url))));
const timeAt = (ms) => cityTime(ms, R.clock.zone);
const DAY = Date.UTC(2026, 9, 6, 7, 0);   // midnight in San Francisco, a Tuesday
const N = 18, STEP = 100;

function town() {
  const ways = [];
  for (let i = 0; i <= N; i += 1) {
    const along = Array.from({ length: N + 1 }, (_, j) => j * STEP);
    ways.push({ kind: "street", pts: along.map((v) => [i * STEP, v]), lanes: 2, oneway: 0, id: `v${i}`, name: `${i} Avenue`, road_m: 10 });
    ways.push({ kind: "street", pts: along.map((v) => [v, i * STEP]), lanes: 2, oneway: 0, id: `h${i}`, name: `${i} Street`, road_m: 10 });
  }
  const streets = new Streets(ways), places = [];
  for (let i = 0; i < N; i += 1) for (let j = 0; j < N; j += 1) {
    const k = i * N + j, kind = k % 7 === 0 ? "cafe" : k % 11 === 0 ? "office" : k % 13 === 0 ? "supermarket" : null;
    const b = { id: `b${k}`, x: i * STEP + STEP / 2, z: j * STEP + STEP / 2, archetype: kind === "office" ? "office" : "residential", floors: 3, area: 300,
      shops: kind && kind !== "office" ? [{ t: kind, n: "Corner" }] : [], name: `${k} Test Street`, tag: k % 3 ? "apartments" : "house" };
    const pl = placeFromBuilding(b, streets, R);
    if (pl) { pl.front = { x: b.x, z: b.z - 40, nx: 0, nz: 1, half: 5, depth: 12 }; pl.inside = pl.shops.length ? pl.front : null; places.push(pl); }
  }
  // Two courts in the park at the middle.
  for (const [s, x, z] of [["basketball", 905, 905], ["tennis", 300, 1500]]) {
    places.push({ id: `court:${s}`, x, z, node: streets.nearest(x, z, "walk", 160), use: "park", shops: [], keys: new Set(["use:park", `sport:${s}`]), name: s,
      area: 300, floors: 0, door: null, inside: null, court: { x, z, a: 0.3, l: 24, w: 12, s } });
  }
  const roster = new Roster(R, { seed: "npc" });
  roster.add(places);
  // A bus line along 9 Street, the length of the town.
  const stops = [0, 300, 600, 900, 1200, 1500, 1800].map((x, k) => ({ id: `s${k}`, name: `Stop ${k}`, lon: x + 30, lat: 9 * STEP + 6, routes: ["22"], modes: ["bus"] }));
  const lines = buildLines(R, stops, streets, (lon, lat) => [lon, lat]);
  const city = new City(R, roster, streets, { seed: "npc", timeAt });
  city.setLines(lines);
  return { streets, roster, city, lines };
}

test("a moving violation is seen only by a camera that has the car in view, or a patrol car near", () => {
  const W = R.enforcement.witness;
  const cam = { id: "cam:1", x: 0, z: 0, yaw: 0 };              // looks toward -z
  assert.ok(cameraSees(cam, 0, -30, W), "ahead of it, in range");
  assert.ok(!cameraSees(cam, 0, 30, W), "behind it");
  assert.ok(!cameraSees(cam, 0, -80, W), "out of range");
  assert.ok(!cameraSees(cam, 30, -10, W), "off to the side, out of its cone");
  const patrol = { id: "veh:p", model: "patrol", x: 200, z: 0 };
  assert.equal(witnessOf(R, { x: 0, z: -20 }, { cameras: [cam], vehicles: [patrol] }).kind, "camera");
  assert.equal(witnessOf(R, { x: 170, z: 20 }, { cameras: [cam], vehicles: [patrol] }).kind, "police");
  assert.equal(witnessOf(R, { x: 0, z: 30 }, { cameras: [cam], vehicles: [patrol, { id: "veh:s", model: "sedan", x: 0, z: 31 }] }), null, "nobody saw");
});

test("a bus waits for you at the stop, so long and no longer, and makes the time up", () => {
  const { lines } = town();
  assert.equal(lines.length, 1);
  const ms = DAY + 9 * 3_600_000, lag = new Map([["bus:22:0", 12]]);
  const held = busesAt(lines, ms, lag).find((b) => b.id === "bus:22:0");
  const was = busesAt(lines, ms - 12_000).find((b) => b.id === "bus:22:0");
  assert.deepEqual([held.x, held.z, held.dwelling], [was.x, was.z, was.dwelling], "held 12 s: where it was 12 s ago");
  assert.ok(R.transit_lines.bus_hold_s > 0 && R.transit_lines.bus_hold_s <= 30);
  assert.ok(R.transit_lines.taxi_max_wait_s > 0 && R.transit_lines.taxi_max_wait_s <= 180);
});

test("residents without a car take a taxi or the bus on a long trip, and the cab and the bus are there", () => {
  const { roster, city, lines } = town();
  const t = timeAt(DAY + 12 * 3_600_000);
  let taxis = 0, buses = 0;
  for (const p of roster.people.values()) {
    const segs = city.planOf(p, t).segs;
    for (let i = 0; i < segs.length; i += 1) {
      const s = segs[i];
      if (s.taxi && s.rider) {
        taxis += 1;
        // Out to the kerb, waited there while the cab came in, then the ride, then in on foot.
        const wait = segs[i - 1], comeIn = wait.cabLegs[0];
        assert.equal(wait.mode, "wait");
        assert.equal(comeIn.t1, s.t0, "the cab pulls up as the fare gets in");
        assert.ok(comeIn.cab === s.cab && city.legRoute(comeIn) && city.legRoute(s), "one cab, on the streets");
        const [x, z] = wait.at, end = city.legRoute(comeIn).pts.at(-1);
        assert.ok(Math.hypot(end[0] - x, end[1] - z) < 8, "it stops where the fare waits");
        assert.ok(t.minute < wait.t0 || segs[i + 1].fromXZ, "and lets them out at the other end");
      }
      if (s.mode === "bus") {
        buses += 1;
        const wait = segs[i - 1];
        assert.equal(wait.mode, "wait");
        // At the moment they get on, a bus of their route is standing at their stop.
        const ms = DAY + s.t0 * 60_000;
        const there = busesAt(lines, ms).filter((b) => b.dwelling && Math.hypot(b.x - wait.at[0], b.z - wait.at[1]) < 60);
        assert.ok(there.length, `${p.id}: no bus at the stop when boarding at ${s.t0.toFixed(2)}`);
        const off = busesAt(lines, DAY + s.t1 * 60_000).filter((b) => b.dwelling && Math.hypot(b.x - segs[i + 1].fromXZ[0], b.z - segs[i + 1].fromXZ[1]) < 5);
        assert.ok(off.length, `${p.id}: no bus where they get off`);
      }
    }
  }
  assert.ok(taxis > 0, "some take a taxi");
  assert.ok(buses > 0, "some take the bus");
  // The cab is in the traffic while the fare rides, and the fare is not on the pavement.
  const p = [...roster.people.values()].find((q) => city.planOf(q, t).segs.some((s) => s.taxi && s.rider));
  const ride = city.planOf(p, t).segs.find((s) => s.taxi && s.rider);
  const mid = timeAt(DAY + ((ride.t0 + ride.t1) / 2) * 60_000);
  const A = roster.places.get(ride.from);
  const scan = city.scan(mid.ms, { x: A.x, z: A.z }, 3000);
  assert.ok(scan.vehicles.some((e) => e.v.id === ride.cab.id && e.s.state === "driving"), "the cab is driving");
  assert.equal(city.personAt(p, mid), null, "the fare is in it");
});

test("some go to play at the parks' courts, and play on the court", () => {
  const { roster, city } = town();
  const t = timeAt(DAY + 12 * 3_600_000);
  let players = 0;
  for (const p of roster.people.values()) {
    const seg = city.planOf(p, t).segs.find((s) => s.act?.kind === "sport");
    if (!seg) continue;
    players += 1;
    const court = roster.places.get(seg.place).court;
    for (let m = seg.t0 + 1; m < seg.t1; m += 3.7) {
      const pos = city.personAt(p, timeAt(DAY + m * 60_000), seg);
      assert.ok(pos && /^playing/.test(pos.activity));
      // On the court: within its length and width (in the court's own axes).
      const dx = pos.x - court.x, dz = pos.z - court.z, ux = Math.cos(court.a), uz = -Math.sin(court.a);
      const du = dx * ux + dz * uz, dv = dx * -Math.sin(court.a) + dz * -Math.cos(court.a);
      assert.ok(Math.abs(du) <= court.l / 2 + 0.01 && Math.abs(dv) <= court.w / 2 + 0.01, `off the court: ${du.toFixed(1)}, ${dv.toFixed(1)}`);
    }
  }
  assert.ok(players > 0, "somebody plays");
});

test("shoppers look round the shop, then pay at the counter", () => {
  const inside = { x: 0, z: 0, nx: 0, nz: 1, half: 5, depth: 12 }, place = { id: "s", inside, shops: ["supermarket"] }, L = counterLine(inside);
  const seen = new Set();
  for (let s = 0; s < 3600; s += 18) {
    const pos = indoorSpot({ id: "npc:x:0", role: "student" }, { kind: "errand" }, place, timeAt(DAY + 10 * 3_600_000 + s * 1000));
    seen.add(pos.activity);
    assert.ok(pos.z < L.counter, "never behind the counter");
  }
  assert.ok(seen.has("looking round the shop") && seen.has("at the counter"), [...seen].join(", "));
});

test("a garage door is up as its car goes out and comes home, and down the rest of the time", () => {
  const { roster, city } = town();
  const t0 = timeAt(DAY + 12 * 3_600_000);
  const v = [...roster.vehicles.values()].find((x) => x.garage && city.planOf(roster.people.get(x.owner), t0).drives.some((s) => s.kind === "go" && s.from === x.home));
  assert.ok(v, "a resident who drives from a garage");
  const out = city.planOf(roster.people.get(v.owner), t0).drives.find((s) => s.kind === "go" && s.from === v.home);
  const at = (m) => city.garageOpen(v, timeAt(DAY + m * 60_000));
  assert.ok(at(out.t0 - 0.2), "up before the car drives out");
  assert.ok(at(out.t0 + 0.1), "still up as it leaves");
  assert.ok(!at(out.t0 + 3), "down after");
  assert.ok(!at(out.t0 - 30), "down before");
});

test("what breaks stays broken half a day, is boarded up, and is mended within three days", () => {
  const H = 3_600_000, at = DAY;
  assert.equal(repairStage(R, "win:1", at, at + 6 * H).stage, "broken");
  const boarded = repairStage(R, "win:1", at, at + 13 * H);
  assert.equal(boarded.stage, "boarded");
  assert.equal(boarded.boardAt, at + 12 * H);
  assert.ok(boarded.restoreAt > boarded.boardAt && boarded.restoreAt <= at + 72 * H);
  assert.equal(repairStage(R, "win:1", at, at + 72 * H).stage, "restored");
  assert.equal(repairStage(R, "win:1", at, at + 13 * H).restoreAt, boarded.restoreAt, "the same break, the same day mended");
  // The planks go up one after another.
  const fake = fakeThree();
  const g = boardedPlanks(fake, 1.2, 1.0, { seed: "win:1", k: 0 });
  assert.ok(g.children.length >= 4);
  assert.equal(g.children.filter((c) => c.visible).length, 0);
  placePlanks(g, 0.5);
  const half = g.children.filter((c) => c.visible).length;
  assert.ok(half > 0 && half < g.children.length);
  placePlanks(g, 1);
  assert.ok(g.children.every((c) => c.visible && c.children[0].rotation.z === 0));
});

function fakeThree() {
  class Obj { constructor() { this.children = []; this.position = { set: (x, y, z) => Object.assign(this.position, { x, y, z }), x: 0, y: 0, z: 0 }; this.rotation = { x: 0, y: 0, z: 0 }; this.visible = true; this.userData = {}; }
    add(...o) { this.children.push(...o); return this; } }
  class Geo { rotateX() { return this; } }
  return { Group: Obj, Mesh: class extends Obj {}, BoxGeometry: Geo, CylinderGeometry: Geo, MeshLambertMaterial: class {} };
}

test("riders do not jump: out to the kerb or the stop, waiting there, and on from where they got off", () => {
  const { roster, city } = town();
  const t0 = timeAt(DAY + 12 * 3_600_000);
  const riders = [...roster.people.values()].filter((p) => city.planOf(p, t0).segs.some((s) => s.mode === "wait"));
  assert.ok(riders.length > 0);
  for (const p of riders.slice(0, 40)) {
    let prev = null;
    for (let s = 6 * 3600; s < 22 * 3600; s += 5) {
      const pos = city.personAt(p, timeAt(DAY + s * 1000), undefined, { x: 900, z: 900 });
      const out = pos && !pos.indoors && pos.mode === "walk" && (pos.moving || /waiting/.test(pos.activity));
      // (A brisk walk round a corner of the test grid can be 16 m in 5 s; a pop is 30 and more.)
      if (out && prev) assert.ok(Math.hypot(pos.x - prev.x, pos.z - prev.z) < 18, `${p.id} jumped at ${s} s (${prev.activity} → ${pos.activity})`);
      prev = out ? pos : null;
    }
  }
});

test("a car's way from a spot with no street way beside it is still a way (the streets seen again)", () => {
  const { roster, city, streets } = town();
  const [a, b] = [...roster.places.values()].filter((p) => !p.court);
  const cab = { id: "cab:test", model: "taxi", cab: true };
  const n = streets.nodes[a.node];
  city.spots.set(`${cab.id}:${a.id}`, { garage: false, node: a.node, x: n.x, z: n.z, yaw: 0, door: { x: n.x, z: n.z }, place: a.id });
  const route = city.legRoute({ kind: "go", mode: "drive", t0: 0, t1: 1, from: a.id, to: b.id, vehicle: cab.id, cab });
  assert.ok(route && route.length > 0);
});

test("on foot the city's cars are solid: the walker's step checks them, except while driving or riding", () => {
  const view = readFileSync(new URL("../docs/city/view.mjs", import.meta.url), "utf8");
  const walk = readFileSync(new URL("../src/smc/renderer/page/module/23-pins-1-2-and-3.js", import.meta.url), "utf8");
  assert.match(view, /function carsNear\(x, z, r = 0\.3\) \{\n\s+const out = \[\];\n\s+if \(!ctx\.enabled\(\) \|\| car\.active \|\| car\.riding \|\| transit\.ride\) return out;/);
  const body = view.slice(view.indexOf("function carsAt"), view.indexOf("function hitInTraffic"));
  for (const list of ["drawnCars", "routeBuses", "taxi.at", "...parked", "...peerCars"]) assert.ok(body.includes(list), list);
  // Already inside one car (a row of parked cars), a step into the next is still refused.
  assert.match(body, /return next\.some\(\(id\) => !now\.includes\(id\)\);/);
  assert.match(view, /drawnCars: \(\) => drawnCars, walkerBlocked, walkerSlide, carsAt,/);
  assert.match(walk, /cars\(toX, toZ, WALKER_RADIUS_M, p\.x, p\.z\)/);
  assert.match(walk, /livingCity\.walkerSlide\?\.\(p\.x, p\.z, toX, toZ, WALKER_RADIUS_M\)/);
});

test("a gap between two cars is walked through: rounded footprints, a walker side on between bumpers", async () => {
  const { carClearance, CAR_SQUEEZE_M } = await import("../docs/city/view.mjs");
  // Two sedans (1.85 x 4.8) nose to tail along z, 0.6 m between bumpers: the gap's middle is clear.
  const A = [0, 0], B = [0, 4.8 + 0.6];
  const clear = (x, z) => Math.min(carClearance(x, z, ...A, 0, 1.85, 4.8), carClearance(x, z, ...B, 0, 1.85, 4.8));
  for (let x = -1.5; x <= 1.5; x += 0.1) assert.ok(clear(x, 2.7) >= CAR_SQUEEZE_M, `stuck in the gap at x ${x.toFixed(1)}`);
  // Beside a car's door: blocked; just off its rounded corner on the diagonal: clear.
  assert.ok(carClearance(1.0, 0, 0, 0, 0, 1.85, 4.8) < CAR_SQUEEZE_M);
  assert.ok(carClearance(0.925 + 0.2, 2.4 + 0.2, 0, 0, 0, 1.85, 4.8) >= CAR_SQUEEZE_M);
  // Turned with its yaw: the same footprint.
  assert.ok(Math.abs(carClearance(3, 0, 0, 0, Math.PI / 2, 1.85, 4.8) - (3 - 2.4)) < 1e-9);
});

test("rounds: flyers in any order, a dog walk in turn, paid by the rules on the last stop", async () => {
  const { CityWorld } = await import("../docs/city/world.mjs");
  const w = new CityWorld(R, { now: DAY + 12 * 3600_000, seed: "rounds" });
  const at = (lat, lon) => ({ x: 0, z: 0, lat, lon });
  w.submit("me", "join", { name: "Sam", at: at(37.8, -122.44) });
  const K = R.tasks.rounds;
  assert.ok(K.kinds.flyers && K.kinds.dog_walk && K.kinds.bus_survey && K.kinds.mystery_shopper);
  // Three letterboxes 100 m apart along a street.
  const stops = [0, 1, 2].map((i) => ({ name: `${10 + i} Elm St`, at: [37.8, -122.44 + i * 0.00114] }));
  const took = w.submit("me", "take_task", { task: { kind: "flyers", title: "Flyers on Elm St", stops }, at: at(37.8, -122.44) });
  assert.ok(took.ok, took.error);
  const pay = took.task.pay;
  assert.equal(took.task.steps[0], "Post a flyer at 10 Elm St");
  // Too far from a stop: not counted.
  assert.equal(w.submit("me", "task_visit", { stop: 2, at: at(37.8, -122.44) }).ok, false);
  // Any order: the last first.
  assert.ok(w.submit("me", "task_visit", { stop: 2, at: at(...stops[2].at) }).ok);
  assert.ok(w.submit("me", "task_visit", { stop: 0, at: at(...stops[0].at) }).ok);
  const before = w.ledger.balance("player:me");
  const last = w.submit("me", "task_visit", { stop: 1, at: at(...stops[1].at) });
  assert.ok(last.ok && last.done && last.pay === pay, JSON.stringify(last));
  assert.ok(Math.abs(w.ledger.balance("player:me") - before - pay) < 1e-6);
  // A dog walk goes in turn: the park before the dog is fetched does not count.
  const walk = [{ name: "Fetch the dog at 5 Oak St", at: [37.8, -122.44] }, { name: "Walk it to the park", at: [37.801, -122.44] }, { name: "Bring it home to 5 Oak St", at: [37.8, -122.44] }];
  assert.ok(w.submit("me", "take_task", { task: { kind: "dog_walk", title: "Walk the dog", stops: walk }, at: at(37.8, -122.44) }).ok);
  assert.equal(w.submit("me", "task_visit", { stop: 1, at: at(...walk[1].at) }).ok, false);
  for (const i of [0, 1, 2]) assert.ok(w.submit("me", "task_visit", { stop: i, at: at(...walk[i].at) }).ok);
  assert.equal(w.players.get("me").task, null);
  // Nonsense is refused: one stop, or stops kilometres apart.
  assert.equal(w.submit("me", "take_task", { task: { kind: "flyers", stops: stops.slice(0, 1) }, at: at(37.8, -122.44) }).ok, false);
  assert.equal(w.submit("me", "take_task", { task: { kind: "flyers", stops: [stops[0], { name: "far", at: [37.9, -122.3] }] }, at: at(37.8, -122.44) }).ok, false);
});

test("adults average 5 ft 10 (men) and 5 ft 5 (women), spread as the CDC's reference is", async () => {
  const { ADULT_HEIGHT, bodyFor } = await import("../docs/city/view.mjs");
  const cache = new Map(), men = [], women = [];
  for (let i = 0; i < 40000; i += 1) {
    const b = bodyFor({ id: `person:${i}`, age: 20 + (i % 60) }, cache);
    (b.female ? women : men).push(b.height);
  }
  const mean = (xs) => xs.reduce((t, x) => t + x, 0) / xs.length;
  const sd = (xs) => { const m = mean(xs); return Math.sqrt(xs.reduce((t, x) => t + (x - m) ** 2, 0) / xs.length); };
  assert.ok(Math.abs(men.length / (men.length + women.length) - 0.5) < 0.01, "about as many women as men");
  assert.ok(Math.abs(mean(men) - 1.778) < 0.002, `men ${mean(men).toFixed(4)} m`);
  assert.ok(Math.abs(mean(women) - 1.651) < 0.002, `women ${mean(women).toFixed(4)} m`);
  assert.ok(Math.abs(sd(men) - 0.071) < 0.003 && Math.abs(sd(women) - 0.066) < 0.003, "spread as measured");
  // Weighted to the middle: about two in three within one spread, about one in twenty past two.
  const within = (xs, m, s, k) => xs.filter((x) => Math.abs(x - m) <= k * s).length / xs.length;
  assert.ok(Math.abs(within(men, 1.778, 0.071, 1) - 0.683) < 0.015 && Math.abs(within(women, 1.651, 0.066, 2) - 0.954) < 0.01);
  // Held: nobody past the hold either way.
  const hold = ADULT_HEIGHT.hold;
  assert.ok(Math.min(...men) >= 1.778 - hold * 0.071 - 1e-9 && Math.max(...men) <= 1.778 + hold * 0.071 + 1e-9);
  assert.ok(Math.min(...women) >= 1.651 - hold * 0.066 - 1e-9 && Math.max(...women) <= 1.651 + hold * 0.066 + 1e-9);
  // The same person is the same height every time.
  assert.equal(bodyFor({ id: "person:7", age: 30 }, new Map()).height, bodyFor({ id: "person:7", age: 30 }, new Map()).height);
});
