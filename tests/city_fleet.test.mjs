// The district's people and vehicles kept, not made up where you look (docs/city/fleet.mjs):
// a roster per region, cars that are always somewhere (parked, in a garage, driving, away) and
// got there by a trip, traffic driven by the rules, injuries by impact, and the world's records.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { cityTime, loadRules } from "../docs/city/core.mjs";
import { City, Drivers, PARKING, Roster, TRAFFIC, harmNow, injuryFor, junctionAt, residentsIn, signalAt, vehicleDamage } from "../docs/city/fleet.mjs";
import { Streets, alongRoute, placeFromBuilding } from "../docs/city/people.mjs";
import { CityWorld } from "../docs/city/world.mjs";

const R = loadRules(JSON.parse(readFileSync(new URL("../docs/city/rules.json", import.meta.url))));
const timeAt = (ms) => cityTime(ms, R.clock.zone);
const NOON = Date.UTC(2026, 9, 6, 19, 0);   // 12:00 in San Francisco, a Tuesday

function grid(n = 8, step = 100) {
  const ways = [];
  for (let i = 0; i <= n; i += 1) {
    const along = Array.from({ length: n + 1 }, (_, j) => j * step);
    ways.push({ kind: "street", pts: along.map((v) => [i * step, v]), lanes: 2, oneway: 0, id: `v${i}`, name: `${i} Avenue` });
    ways.push({ kind: "street", pts: along.map((v) => [v, i * step]), lanes: 2, oneway: 0, id: `h${i}`, name: `${i} Street` });
  }
  return new Streets(ways);
}
//: A building in the middle of each block: homes, with a café, a shop and an office here and there.
function blocks(streets, n = 8, step = 100, only = null) {
  const out = [];
  for (let i = 0; i < n; i += 1) for (let j = 0; j < n; j += 1) {
    if (only && !only(i, j)) continue;
    const k = i * n + j, kind = k % 9 === 0 ? "cafe" : k % 11 === 0 ? "office" : k % 13 === 0 ? "supermarket" : null;
    const b = { id: `b${k}`, x: i * step + step / 2, z: j * step + step / 2, archetype: kind === "office" ? "office" : "residential", floors: 3, area: 300,
      shops: kind && kind !== "office" ? [{ t: kind, n: kind === "cafe" ? "Blue Cup" : "Corner Market" }] : [], name: `${100 + k} Test Street`, tag: k % 3 ? "apartments" : "house" };
    const pl = placeFromBuilding(b, streets, R);
    if (pl) out.push(pl);
  }
  return out;
}
function district() {
  const streets = grid(), roster = new Roster(R, { seed: "test" });
  roster.add(blocks(streets));
  roster.visitorsUpTo(60);
  const city = new City(R, roster, streets, { seed: "test", timeAt });
  return { streets, roster, city };
}

test("each home has its residents, made once: the same people however often the district is seen", () => {
  const streets = grid(), roster = new Roster(R, { seed: "test" });
  const west = blocks(streets, 8, 100, (i) => i < 4), all = blocks(streets);
  roster.add(west);
  const first = new Map([...roster.people].map(([id, p]) => [id, p]));
  assert.ok(first.size > 20, `${first.size} residents`);
  for (const p of first.values()) assert.match(p.id, /^npc:b\d+:\d+$/);
  // The same window again: nobody new. The rest of the district: residents for its homes only.
  roster.add(blocks(streets, 8, 100, (i) => i < 4));
  assert.equal(roster.people.size, first.size);
  roster.add(all);
  assert.ok(roster.people.size > first.size);
  for (const [id, p] of first) assert.equal(roster.people.get(id), p);
  // A home's size: a house one household, a block of flats by its floors.
  assert.ok(residentsIn(R, { id: "x", tag: "apartments", area: 600, floors: 5 }) > residentsIn(R, { id: "y", tag: "house", area: 120, floors: 2 }));
  // Who works where is kept (on this device, through a reload).
  const again = new Roster(R, { seed: "test", saved: roster.toJSON() });
  again.add(all);
  for (const p of again.people.values()) if (p.work) assert.equal(p.work, roster.people.get(p.id).work);
});

test("a car is always somewhere, and only moves by driving there: parked, in a garage, on the way, away", () => {
  const { roster, city } = district();
  const cars = [...roster.vehicles.values()].filter((v) => !v.visitor).slice(0, 25);
  assert.ok(cars.length >= 10);
  const dayStart = Date.UTC(2026, 9, 6, 7, 0);   // midnight in San Francisco
  let drives = 0;
  for (const v of cars) {
    let prev = null;
    for (let m = 0; m < 1440; m += 1) {
      const ms = dayStart + m * 60_000, t = timeAt(ms), s = city.vehicleAt(v, t);
      assert.ok(s && ["parked", "garage", "driving", "away"].includes(s.state), `${v.id} at ${m}: ${s?.state}`);
      if (s.state === "driving" && !s.roam) {
        drives += 1;
        const route = city.legRoute(s.leg);
        // It sets off from where it stood, and stands where it stops.
        if (prev?.state === "parked") {
          const start = alongRoute(route, 0, (half) => Math.max(1.7, half - 1.8));
          assert.ok(Math.hypot(start.x - prev.x, start.z - prev.z) < 2.5, `${v.id} left from ${Math.round(Math.hypot(start.x - prev.x, start.z - prev.z))} m off its spot`);
        }
      }
      if (prev?.state === "parked" && s.state === "parked") assert.ok(Math.hypot(s.x - prev.x, s.z - prev.z) < 0.01, `${v.id} moved while parked at ${m}`);
      if (prev?.state === "driving" && !prev.roam && s.state === "parked") {
        const route = city.legRoute(prev.leg), end = alongRoute(route, route.length, (half) => Math.max(1.7, half - 1.8));
        assert.ok(Math.hypot(end.x - s.x, end.z - s.z) < 2.5, `${v.id} parked ${Math.round(Math.hypot(end.x - s.x, end.z - s.z))} m from where it stopped`);
      }
      prev = s;
    }
    // Home by night.
    const late = city.vehicleAt(v, timeAt(dayStart + 1439 * 60_000));
    const owner = roster.people.get(v.owner);
    if (late.state === "parked" || late.state === "garage") assert.equal(late.spot.place, owner.home);
  }
  assert.ok(drives > 0, "nobody drove all day");
  // The record says how it got there.
  const v = cars.find((c) => city.planOf(roster.people.get(c.owner), timeAt(NOON)).drives.length);
  if (v) assert.ok(city.history(v.id, timeAt(dayStart + 1439 * 60_000)).some((line) => /drove from/.test(line)));
});

test("visitors' cars come in from the edge of the streets and go out again; nobody appears out of nowhere", () => {
  const { roster, city, streets } = district();
  const G = new Set(city.gateways);
  assert.ok(G.size >= 4);
  for (const v of [...roster.vehicles.values()].filter((x) => x.visitor).slice(0, 30)) {
    const plan = city.planOf(roster.visitors.get(v.owner), timeAt(NOON));
    for (const leg of plan.drives) {
      const route = city.legRoute(leg);
      if (typeof leg.from === "number") { const n = streets.nodes[leg.from]; assert.ok(Math.hypot(route.pts[0][0] - n.x, route.pts[0][1] - n.z) < 1); assert.ok(G.has(leg.from)); }
    }
  }
  // The same in every browser: the same seed, the same day.
  const other = district();
  const a = city.scan(NOON, { x: 400, z: 400 }, 300), b = other.city.scan(NOON, { x: 400, z: 400 }, 300);
  assert.deepEqual(a.vehicles.map((e) => e.v.id), b.vehicles.map((e) => e.v.id));
  assert.deepEqual(a.people.map((e) => e.p.id), b.people.map((e) => e.p.id));
  assert.ok(a.vehicles.some((e) => e.s.state === "parked"), "no parked cars");
});

test("traffic keeps the rules: stops for someone in the road, at a stop sign, and hits only what it cannot stop for", () => {
  const streets = grid();
  // Along 4 Avenue (x = 400) from z = 0 to z = 800, at 11 m/s.
  const route = streets.route(streets.nearest(400, 0, "drive"), streets.nearest(400, 800, "drive"), "drive");
  const car = (d0) => ({ id: "c", key: "c:1", route, sched: () => d0, unsched: (d) => d / 11, limit: 11.2, cruise: 11.2, length: 4.8, width: 1.85 });
  const drive = (drivers, d0, people, seconds, dt = 0.05) => {
    let r = null;
    for (let t = 0; t < seconds; t += dt) r = drivers.step(dt, 1000 + t, [car(d0)], people);
    return r;
  };
  // Someone in the lane 60 m ahead: the car stops short of them.
  const lane = alongRoute(route, 160, (half) => Math.max(1.7, half - 1.8));
  let D = new Drivers(streets);
  let out = drive(D, 100, [{ id: "p", x: lane.x, z: lane.z }], 14);
  assert.equal(out.cars[0].v, 0);
  assert.ok(out.cars[0].d < 160 - 2.4 - 0.3, `stopped at ${out.cars[0].d.toFixed(1)}`);
  // You stepping out 3 m ahead of a car at speed: it brakes, and hits you.
  D = new Drivers(streets);
  drive(D, 300, [], 0.1);
  D.stateOf("c").v = 11;
  const close = alongRoute(route, D.stateOf("c").d + 2.4 + 3, (half) => Math.max(1.7, half - 1.8));
  let hits = [];
  for (let t = 0; t < 2; t += 0.02) hits = hits.concat(D.step(0.02, 2000 + t, [car(300)], [{ id: "me", x: close.x, z: close.z, player: true }]).hits);
  assert.equal(hits.length, 1);
  assert.ok(hits[0].player && hits[0].speed > 3 && hits[0].speed < 11, `hit at ${hits[0].speed.toFixed(1)} m/s`);
  // One of the city's own walkers there instead: the driver stops dead, nobody is hit.
  D = new Drivers(streets);
  drive(D, 300, [], 0.1);
  D.stateOf("c").v = 11;
  hits = [];
  let last = null;
  for (let t = 0; t < 2; t += 0.02) { last = D.step(0.02, 2000 + t, [car(300)], [{ id: "q", x: close.x, z: close.z }]); hits = hits.concat(last.hits); }
  assert.equal(hits.length, 0);
  assert.equal(last.cars[0].v, 0);
  // A junction of residential streets is a stop sign; the car stops at it, then goes on.
  assert.equal(junctionAt(streets, streets.nearest(400, 400, "drive")), "stop");
  D = new Drivers(streets);
  let minV = Infinity, passed = false;
  for (let t = 0; t < 30; t += 0.05) {
    const r = D.step(0.05, 3000 + t, [car(330)], []);
    if (r.cars[0].d > 380 && r.cars[0].d < 400) minV = Math.min(minV, r.cars[0].v);
    if (r.cars[0].d > 420) passed = true;
  }
  assert.ok(minV < 0.4, `slowest at the stop line ${minV.toFixed(2)} m/s`);
  assert.ok(passed, "never went on past the stop sign");
});

test("injuries by impact speed, damage by crash speed, and what each means while it lasts", () => {
  assert.equal(injuryFor(R, { speed: 1 }).severity, 1);
  assert.equal(injuryFor(R, { speed: 5 }).severity, 3);
  assert.ok(R.harm.pedestrian[2].types.includes(injuryFor(R, { speed: 5, seed: "a" }).type));
  assert.equal(injuryFor(R, { speed: 12 }).severity, 5);
  assert.equal(injuryFor(R, { joules: 25 }).severity, 1);
  assert.equal(vehicleDamage(R, 100, 4).state, "dented");
  assert.equal(vehicleDamage(R, 100, 15).state, "wrecked");
  const h = { kind: "vehicle", condition: 20, state: "wrecked", tow_at: 1000, out_until: 5000, at: { x: 1, z: 2 } };
  assert.equal(harmNow(h, 500).stays, true);
  assert.equal(harmNow(h, 2000).out, true);
  assert.equal(harmNow({ kind: "person", down_until: 1000, out_until: 9000, hospital_until: 4000, at: { x: 0, z: 0 }, injuries: [{ type: "broken ankle" }] }, 2000).state, "hospital");
});

test("the world records harm: a car hits you, you hit someone, the online store at twice the price, a courier task", () => {
  const w = new CityWorld(R, { now: NOON, seed: "t" });
  w.submit("me", "join", { name: "Pat", at: { x: 0, z: 0, lon: -122.437, lat: 37.80 } });
  const hit = w.submit("me", "collision", { kind: "hit_by_car", speed: 6, vehicle: { id: "veh:x", plate: "1ABC234", x: 0, z: 0, yaw: 0 } });
  assert.ok(hit.ok, hit.error);
  assert.ok(hit.vitals.health < 100);
  assert.equal(w.players.get("me").injuries.length, 1);
  assert.equal(w.harm.get("veh:x").kind, "vehicle");
  // A blow to someone: hurt, and on the record with what happened.
  const blow = w.submit("me", "strike_person", { npc: { id: "npc:b1:0", name: "Sam Lee", role: "barista", x: 1, z: 0 }, witnesses: 2 });
  assert.ok(blow.ok, blow.error);
  assert.ok(w.harm.get("npc:b1:0").injuries.length === 1 && blow.fine === R.fines.battery);
  // The online store: twice the shop price, brought to you.
  const coffee = w.submit("me", "buy_online", { item: "coffee" });
  assert.ok(coffee.ok, coffee.error);
  assert.equal(coffee.price, R.items.coffee.price * 2);
  assert.equal(w.players.get("me").inventory.coffee, 1);
  assert.equal(w.submit("me", "buy_online", { item: "doctor_visit" }).ok, false);
  // A courier task: picked up at the shop (there, not from afar), delivered for the pay.
  const take = w.submit("me", "take_task", { task: { kind: "courier", title: "Courier", from: { id: "s1", name: "Blue Cup", x: 300, z: 0 }, to: { id: "h1", name: "12 Test Street", x: 300, z: 500 } } });
  assert.ok(take.ok, take.error);
  assert.equal(w.submit("me", "collect_delivery", { at: { x: 0, z: 0 } }).ok, false);
  assert.ok(w.submit("me", "collect_delivery", { at: { x: 300, z: 5 } }).ok);
  assert.equal(w.submit("me", "deliver", { at: { x: 300, z: 10 } }).ok, false);
  const done = w.submit("me", "deliver", { at: { x: 300, z: 498 } });
  assert.ok(done.ok, done.error);
  assert.equal(done.pay, take.task.pay);
  assert.equal(w.players.get("me").task, null);
  // Kept with the books.
  const back = CityWorld.fromJSON(R, JSON.parse(JSON.stringify(w.toJSON())));
  assert.equal(back.harm.get("npc:b1:0").injuries[0].type, w.harm.get("npc:b1:0").injuries[0].type);
});

test("felling the Presidio's dead trees for the forestry task: an axe, in the Presidio, three trees", () => {
  const w = new CityWorld(R, { now: NOON, seed: "t" });
  const at = { x: 0, z: 0, lon: -122.466, lat: 37.799 };
  w.submit("me", "join", { name: "Pat", at });
  w.ledger.mint("player:me", 500, "external_trade");
  assert.ok(w.submit("me", "take_task", { task: { kind: "forestry" }, at }).ok);
  assert.ok(w.submit("me", "buy_online", { item: "axe", at }).ok);
  assert.ok(w.submit("me", "hold", { item: "axe", at }).ok);
  let felled = 0, paid = null;
  for (let tree = 0; tree < 3; tree += 1) {
    for (let k = 0; k < 200; k += 1) {
      const r = w.submit("me", "strike", { target: { key: `nature:tree:${tree}:1`, archetype: "vegetation.tree", x: 1, z: 0, spec: { name: "Tree", material: "green_wood", break_j: 150000 } }, witnesses: 3, at });
      assert.ok(r.ok, r.error);
      assert.ok(!r.fine, "fined for the Presidio's own task");
      if (r.broken) { felled += 1; paid = r.task; break; }
      w.players.get("me").vitals.stamina = 90;
    }
  }
  assert.equal(felled, 3);
  assert.ok(paid.done && paid.pay === R.tasks.forestry.pay);
});

test("people out of doors move, they do not jump: a walk, a round at work, a stroll run on from where they were", () => {
  const { roster, city } = district();
  const dayStart = Date.UTC(2026, 9, 6, 7, 0);
  const focus = { x: 400, z: 400 };
  let outdoors = 0;
  for (const p of [...[...roster.people.values()].slice(0, 80), ...roster.visitors.values()]) {
    let prev = null;
    for (let s = 6 * 3600; s < 22 * 3600; s += 5) {
      const t = timeAt(dayStart + s * 1000), pos = city.personAt(p, t, undefined, focus);
      const out = pos && !pos.indoors && pos.mode === "walk" && pos.moving;
      if (out && prev) {
        // 5 s at a hurried walk is under 15 m (the plan's time for a walk is by the crow flies,
        // so a winding way is walked briskly); anything more is a jump.
        const d = Math.hypot(pos.x - prev.x, pos.z - prev.z);
        assert.ok(d < 15, `${p.id} jumped ${Math.round(d)} m at ${s} s (${prev.activity} → ${pos.activity})`);
      }
      if (out) outdoors += 1;
      prev = out ? pos : null;
    }
  }
  assert.ok(outdoors > 500, `${outdoors} outdoor samples`);
});

test("no car stands in the traffic for good: one that has arrived pulls in and the next drives on; a queue held by a light waits", () => {
  const streets = grid();
  const route = streets.route(streets.nearest(400, 0, "drive"), streets.nearest(400, 300, "drive"), "drive");
  const car = (id, d0) => ({ id, key: `${id}:1`, route, sched: () => d0, unsched: (d) => d / 11, limit: 11.2, cruise: 11.2, length: 4.8, width: 1.85 });
  // A arrives first (it starts near the end); B follows on the same leg 30 m behind.
  const D = new Drivers(streets);
  let r = null;
  for (let t = 0; t < 40; t += 0.05) r = D.step(0.05, 5000 + t, [car("a", route.length - 20), car("b", route.length - 50)], []);
  const a = r.cars.find((c) => c.id === "a"), b = r.cars.find((c) => c.id === "b");
  assert.ok(a.arrived && a.v === 0, "the first car did not pull in");
  assert.ok(b.arrived, `the next car stood behind it at ${b.d.toFixed(1)} of ${route.length.toFixed(1)} m`);
  // A queue of three behind a car stopped at a stop sign: nobody creeps into the one ahead.
  const D2 = new Drivers(streets), long = streets.route(streets.nearest(400, 0, "drive"), streets.nearest(400, 800, "drive"), "drive");
  const at = (id, d0) => ({ id, key: `${id}:2`, route: long, sched: () => d0, unsched: (d) => d / 11, limit: 11.2, cruise: 11.2, length: 4.8, width: 1.85 });
  D2.step(0.05, 7000, [at("x", 370), at("y", 360), at("z", 350)], []);
  for (const id of ["x", "y", "z"]) D2.stateOf(id).v = 0;
  D2.stateOf("x").reason = "stop sign";
  D2.stateOf("y").reason = "the car ahead"; D2.stateOf("y").leader = "x";
  D2.stateOf("z").reason = "the car ahead"; D2.stateOf("z").leader = "y";
  assert.equal(D2.heldAtHead("z"), true);
  // A ring of cars each waiting on the next is let go.
  D2.stateOf("x").reason = "the car ahead"; D2.stateOf("x").leader = "z";
  assert.equal(D2.heldAtHead("z"), false);
});

test("parked cars stand at the kerb, a hand's width off it, clear of junctions, driveways, red kerb and each other, on the sides parked on", () => {
  const { roster, city, streets } = district();
  // A kerb 4 m either side of every street's line (the grid's streets are 8 m wide), a
  // driveway at 3 Avenue z 150 on its east kerb, and red kerb at 5 Street x 250 on its north kerb.
  // (Asked along the street, as the page's nearestKerbAt is: the kerb running that way.)
  const kerbAt = (x, z, ax = 0, az = 1) => {
    const fx = Math.round(x / 100) * 100, fz = Math.round(z / 100) * 100;
    if (Math.abs(az) > Math.abs(ax)) { const sx = Math.sign(x - fx) || 1; return { x: fx + sx * 4, z, nx: sx, nz: 0, ax: 0, az: 1 }; }
    const sz = Math.sign(z - fz) || 1; return { x, z: fz + sz * 4, nx: 0, nz: sz, ax: 1, az: 0 };
  };
  const kerbParking = (x, z, ax, az, halfLen) => {
    const span = (c, at) => Math.abs(c - at) < halfLen + 1.5;
    if (Math.abs(x - 304) < 0.5 && span(z, 150)) return "driveway";
    if (Math.abs(z - 504) < 0.5 && span(x, 250)) return "red kerb";
    return null;
  };
  city.setKerbside({ kerbAt, kerbParking });
  const spots = [];
  // Residents' cars at home: their spots are held, one car to a spot.
  for (const v of [...roster.vehicles.values()].filter((x) => !x.garage && x.home).slice(0, 160)) {
    const s = city.spotOf(v, v.home);
    if (!s || s.garage || s.gateway) continue;
    spots.push({ v, s });
  }
  assert.ok(spots.length > 60, `${spots.length} spots`);
  for (const { v, s } of spots) {
    assert.ok(s.kerb, "not at the kerb");
    // Half the car and 15 cm off the kerb line.
    const off = Math.min(Math.abs(s.x - Math.round(s.x / 100) * 100), Math.abs(s.z - Math.round(s.z / 100) * 100));
    const w = { economy: 1.76, compact_ev: 1.8, sedan: 1.85, suv: 1.95, pickup: 2.0, delivery_van: 2.0, box_truck: 2.45, taxi: 1.85, patrol: 1.9 }[v.model] || 1.85;
    assert.ok(Math.abs(off - (4 - w / 2 - PARKING.kerb_gap_m)) < 0.02, `${v.model} ${off.toFixed(2)} m from the line`);
    // Not within the junction's clearance: every junction here is at a multiple of 100.
    const along = Math.abs(s.x - Math.round(s.x / 100) * 100) < 5 ? s.z : s.x, nearest = Math.abs(along - Math.round(along / 100) * 100);
    const L = { economy: 4.1, compact_ev: 4.3, sedan: 4.8, suv: 4.9, pickup: 5.6, delivery_van: 5.9, box_truck: 7.4, taxi: 4.7, patrol: 5.0 }[v.model] || 4.8;
    assert.ok(nearest - L / 2 >= PARKING.junction_clear_m + 3.4 - 0.01, `its end ${(nearest - L / 2).toFixed(1)} m from the junction's line (${s.x.toFixed(1)}, ${s.z.toFixed(1)}, along ${s.along.toFixed(1)} of ${s.edge.length})`);
    assert.ok(!(Math.abs(s.x - (304 - w / 2 - PARKING.kerb_gap_m)) < 0.1 && Math.abs(s.z - 150) < 4), "across a driveway");
  }
  // No two overlap.
  for (let i = 0; i < spots.length; i += 1) for (let j = i + 1; j < spots.length; j += 1) {
    const a = spots[i].s, b = spots[j].s;
    if (Math.abs(a.yaw - b.yaw) > 0.1 && Math.abs(Math.abs(a.yaw - b.yaw) - Math.PI) > 0.1) continue;
    assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > 4.1, "two cars in one spot");
  }
  // A street parked on one side only: nobody on the other.
  const one = new Streets([{ kind: "street", pts: [[0, 0], [0, 200]], lanes: 2, oneway: 0, id: "s", name: "Side Street", parking_sides: [-1] },
    { kind: "street", pts: [[-100, 0], [100, 0]], lanes: 2, oneway: 0, id: "a", name: "A" }, { kind: "street", pts: [[-100, 200], [100, 200]], lanes: 2, oneway: 0, id: "b", name: "B" }]);
  const fwd = one.edges[one.nearest(0, 0, "drive")].find((e) => e.name === "Side Street");
  const back = one.edges[one.nearest(0, 200, "drive")].find((e) => e.name === "Side Street");
  assert.equal(fwd.park, true); assert.equal(back.park, false);
});

test("traffic keeps to the main streets: Lombard's ends draw the through trips, its green is longer, and drivers take it", () => {
  // A grid whose 4 Street is Lombard Street, an arterial.
  const ways = [];
  for (let i = 0; i <= 8; i += 1) {
    const along = Array.from({ length: 9 }, (_, j) => j * 100);
    ways.push({ kind: "street", pts: along.map((v) => [i * 100, v]), lanes: 2, oneway: 0, id: `v${i}`, name: `${i} Avenue` });
    // Lombard runs on out of the grid at both ends, as it does out of the Marina.
    const pts = i === 4 ? [[-100, 400], ...along.map((v) => [v, 400]), [900, 400]] : along.map((v) => [v, i * 100]);
    ways.push({ kind: "street", pts, lanes: i === 4 ? 4 : 2, oneway: 0, id: `h${i}`, name: i === 4 ? "Lombard Street" : `${i} Street` });
  }
  const streets = new Streets(ways), roster = new Roster(R, { seed: "t" });
  roster.add(blocks(streets));
  const city = new City(R, roster, streets, { seed: "t", timeAt });
  const G = city.gateways;
  const lombard = G.filter((g) => city.gateInfo(g).name === "Lombard Street");
  assert.ok(lombard.length >= 2, "Lombard has no gates");
  // Drawn by weight, a Lombard gate comes up far more often than its share of the gates.
  let r = 1; const rand = () => ((r = (r * 16807) % 2147483647) / 2147483647);
  let hits = 0; for (let k = 0; k < 2000; k += 1) if (lombard.includes(city.pickGate(rand, G))) hits += 1;
  assert.ok(hits / 2000 > 3 * lombard.length / G.length, `${hits} of 2000`);
  const [a, b] = city.corridorTrip(rand, G);
  assert.equal(city.gateInfo(a).name, city.gateInfo(b).name);
  // From one side street to another across the grid, the way goes by Lombard.
  const route = streets.route(streets.nearest(100, 0, "drive"), streets.nearest(700, 800, "drive"), "drive");
  const along = route.pts.filter(([, z]) => Math.abs(z - 400) < 1).length;
  assert.ok(along >= 4, `${along} points on Lombard`);
  // At a junction on Lombard, Lombard has 60% of the cycle.
  const node = streets.nearest(300, 400, "drive"), T = { ...TRAFFIC, main_green_share: 0.6 };
  let main = 0, side = 0;
  for (let s = 0; s < T.signal_cycle_s; s += 0.25) { if (signalAt(streets, node, Math.PI / 2, s, T) === "green") main += 1; if (signalAt(streets, node, 0, s, T) === "green") side += 1; }
  assert.ok(main > side * 1.4, `green ${main / 4} s on Lombard, ${side / 4} s across`);
  // Commuters drive in the rush hours: the morning peak is more than twice the middle of the day.
  const H = R.traffic.by_hour.commute;
  assert.ok(H[8] > 2 * H[13] && H[17] > 2 * H[13]);
});
