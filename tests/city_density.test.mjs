// How many are out on the streets (docs/city/fleet.mjs, routines.mjs; rules.json density): on
// the game's clock (a 72-minute day, walks at walking speed) only a share of the residents' walks
// is seen, never one that would have them out in the small hours for the morning; a share of
// the people stay in all day; the redundant are not made; and commuters from outside drive
// through once a day, the length of the district.
//
// Calibrated on the real Marina (a dump of the page's district, 2026-11-20: 15,893 residents,
// 12,000 visitors, 2,400 commuters): the busiest 100 m block at its busiest hour had 31-34 out of
// doors and a busy one 8.6-9.3 (the user's count: "maybe 40 ... the average closer to 8-10"),
// from 280 and 33-42 before; 150 out at 3 a.m. (night shifts) from 2,724; 250-390 cars on Lombard
// in the rush hours. This town is a toy, so these hold the rules rather than those numbers.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { loadRules } from "../docs/city/core.mjs";
import { clockOf, fleetTime } from "../docs/city/clock.mjs";
import { City, Roster } from "../docs/city/fleet.mjs";
import { Streets, placeFromBuilding } from "../docs/city/people.mjs";
import { dayPlan, isHomebody } from "../docs/city/routines.mjs";

const R = loadRules(JSON.parse(readFileSync(new URL("../docs/city/rules.json", import.meta.url))));
const clock = clockOf(R);

function town(n = 10, step = 100) {
  const ways = [];
  for (let i = 0; i <= n; i += 1) {
    const along = Array.from({ length: n + 1 }, (_, j) => j * step);
    ways.push({ kind: "street", pts: along.map((v) => [i * step, v]), lanes: 2, oneway: 0, id: `v${i}`, name: i === 5 ? "Lombard Street" : `${i} Avenue`, cls: i === 5 ? "arterial" : "residential" });
    ways.push({ kind: "street", pts: along.map((v) => [v, i * step]), lanes: 2, oneway: 0, id: `h${i}`, name: `${i} Street` });
  }
  const streets = new Streets(ways), places = [];
  for (let i = 0; i < n; i += 1) for (let j = 0; j < n; j += 1) {
    const k = i * n + j, kind = k % 9 === 0 ? "cafe" : k % 11 === 0 ? "office" : k % 13 === 0 ? "supermarket" : null;
    const b = { id: `b${k}`, x: i * step + step / 2, z: j * step + step / 2, archetype: kind === "office" ? "office" : "residential", floors: 3, area: 300,
      shops: kind && kind !== "office" ? [{ t: kind, n: kind === "cafe" ? "Blue Cup" : "Corner Market" }] : [], name: `${100 + k} Test Street`, tag: k % 3 ? "apartments" : "house" };
    const pl = placeFromBuilding(b, streets, R);
    if (pl) places.push(pl);
  }
  return { streets, places };
}
// A real moment at which the game's clock reads ``hour`` on a weekday.
function msAt(hour) {
  for (let ms = Date.UTC(2026, 10, 20, 12), k = 0; k < 6000; k += 1, ms += 30_000) {
    const t = fleetTime(clock, ms);
    if (t.weekday >= 1 && t.weekday <= 5 && Math.abs(t.gameMinute - hour * 60) < 2) return ms;
  }
  throw new Error(`no moment for ${hour}:00`);
}

test("the rules carry the calibration and say what it is for", () => {
  const D = R.density;
  assert.ok(D.walks_seen > 0.05 && D.walks_seen < 0.5, `a share of walks seen: ${D.walks_seen}`);
  assert.ok(D.walk_early_max >= 60 && D.walk_early_max <= 360);
  assert.ok(D.resident_outgoing_max >= 1 && D.resident_outgoing_max < 2);
  assert.ok(D.trim.share > 0 && D.trim.share <= 1 && D.trim.roles.includes("office_worker"));
  assert.ok(D.commuters.count > 500);
  assert.match(D.walks_basis, /forty/);
  assert.ok(R.routine.homebody_share > 0.05 && R.routine.homebody_share < 0.5);
});

test("most walks are out of sight on the game's clock, and none sets out in the small hours for the morning", () => {
  const { streets, places } = town(), roster = new Roster(R, { seed: "density" });
  roster.add(places);
  const city = new City(R, roster, streets, { seed: "density", timeAt: (ms) => fleetTime(clock, ms) });
  const t = city.timeAt(msAt(12));
  let walks = 0, seen = 0;
  for (const p of roster.people.values()) {
    for (const s of city.planOf(p, t).segs) {
      if (s.kind !== "go" || s.mode !== "walk") continue;
      walks += 1;
      if (s.unseen) continue;
      seen += 1;
      // A seen walk leaves no more than walk_early_max game minutes before what it is for.
      const next = city.planOf(p, t).segs.find((x) => x.t0 >= s.t1 && x.kind !== "go");
      if (next?.act?.gameStart !== undefined) assert.ok(next.act.gameStart - t.toGame(s.t0) <= R.density.walk_early_max + 1e-6, `${p.id} out ${Math.round(next.act.gameStart - t.toGame(s.t0))} game minutes early`);
      const g = t.toGame(s.t0);
      assert.ok(!(g >= 60 && g < 240 && (next?.act?.gameStart ?? 0) >= 360), `${p.id} walking at ${Math.round(g)} for a morning start`);
    }
  }
  assert.ok(walks > 200, `${walks} walks`);
  const share = seen / walks;
  assert.ok(share > 0.03 && share < R.density.walks_seen + 0.05, `${seen} of ${walks} seen (${share.toFixed(3)})`);
  // The scan leaves the unseen out: nobody on an unseen walk is listed.
  city.through = 0.14;
  const out = city.scan(msAt(12), { x: 500, z: 500 }, 2000);
  for (const e of out.people) assert.ok(!e.seg?.unseen, `${e.p.id} listed on an unseen ${e.seg?.kind}`);
});

test("a share of people stay at home all day, the same ones every day", () => {
  const { places } = town();
  const homes = places.filter((p) => p.use === "residential");
  let n = 0, home = 0;
  for (let i = 0; i < 400; i += 1) {
    const p = { id: `npc:hb:${i}`, role: "retiree", age: 72, home: homes[i % homes.length].id, work: null, pace: 1.3 };
    if (!isHomebody(R, p)) continue;
    n += 1;
    for (let day = 0; day < 5; day += 1) {
      const plan = dayPlan(R, p, day, day, places);
      if (plan.every((a) => a.place === p.home)) home += 1;
      // Up in the morning and in bed at night, at home.
      assert.equal(plan[0].kind, "sleep");
      assert.equal(plan.at(-1).kind, "sleep");
    }
  }
  const share = n / 400;
  assert.ok(Math.abs(share - R.routine.homebody_share) < 0.07, `${n} homebodies of 400`);
  assert.equal(home, n * 5, "every homebody's every day is at home");
});

test("the redundant are not made: flatmates and childless partners in the big trades, never anyone with a part to play", () => {
  const { places } = town();
  const all = new Roster(R, { seed: "trim" }), none = new Roster({ ...R, density: { ...R.density, trim: null } }, { seed: "trim" });
  all.add(places); none.add(places);
  assert.ok(all.trimmed > 0, "some cut");
  assert.equal(none.people.size - all.people.size, all.trimmed);
  const roles = new Set(R.density.trim.roles);
  for (const [id, p] of none.people) {
    if (all.people.has(id)) continue;
    const hh = none.households.get(p.hh), m = hh.members.find((x) => `npc:${p.home}:${x.k}` === id);
    assert.ok(roles.has(p.role), `${id} cut as a ${p.role}`);
    assert.ok(m.relation === "flatmate" || m.relation === "partner", `${id} cut as a ${m.relation}`);
    assert.ok(p.age >= 18);
  }
  // What remains of each household is who is left in it.
  for (const p of all.people.values()) assert.ok(all.households.get(p.hh).members.some((m) => `npc:${p.home}:${m.k}` === p.id));
  // Nobody whose work serves the street is cut: the counters, the rounds, the vehicles.
  for (const p of none.people.values()) if (["cook", "server", "clerk", "barista", "police", "bus_driver", "teacher", "nurse"].includes(p.role)) assert.ok(all.people.has(p.id));
});

test("commuters drive through once a day, seen, from one side of the district to the other", () => {
  const { streets, places } = town(), roster = new Roster(R, { seed: "commute" });
  roster.add(places);
  roster.commutersUpTo(80);
  const city = new City(R, roster, streets, { seed: "commute", timeAt: (ms) => fleetTime(clock, ms) });
  city.through = 0.14;
  const t = city.timeAt(msAt(8));
  let driven = 0, worked = 0;
  for (const p of roster.commuters.values()) {
    assert.ok(p.commuter && p.visitor && roster.visitorOf(p.id) === p);
    const plan = city.planOf(p, t);
    assert.ok(p.partial && p.balance >= 800 && Array.isArray(p.bills), "a row in a table: a balance and no more");
    if (p.pattern === "works") {
      // In for the morning, the car at the kerb all day, out in the evening: to the same door every day.
      if (!plan.segs.length) continue;   // (no kerb free at their door that day)
      worked += 1;
      assert.deepEqual(plan.segs.map((s) => s.mode || s.kind), ["drive", "walk", "stay", "walk", "drive"], p.id);
      const stay = plan.segs[2];
      assert.equal(stay.act.label, "At work");
      assert.ok(stay.t1 - stay.t0 > 0 && plan.segs.every((s) => s.unseen === false), "seen, as every commuter is");
      assert.equal(city.planOf(p, city.timeAt(msAt(8) + 86_400_000)).segs[2]?.place ?? stay.place, stay.place, "the same workplace the next day");
      continue;
    }
    assert.ok(plan.segs.length <= 1, `${p.id}: ${plan.segs.length} trips`);
    for (const s of plan.segs) {
      driven += 1;
      assert.equal(s.mode, "drive"); assert.equal(s.unseen, false);
      const A = streets.nodes[s.from], B = streets.nodes[s.to];
      assert.ok(Math.hypot(A.x - B.x, A.z - B.z) >= 500, `${p.id} through ${Math.round(Math.hypot(A.x - B.x, A.z - B.z))} m`);
    }
    // Their car is theirs, and found by its owner.
    assert.equal(city.vehicleAt(roster.vehicles.get(p.car), t) !== null, true);
  }
  const through = [...roster.commuters.values()].filter((p) => p.pattern === "through").length;
  assert.ok(through >= 20 && through <= 60, `${through} of 80 drive through; the rest work here`);
  assert.ok(driven >= through * 0.75, `${driven} of ${through} drove through`);
  assert.ok(worked >= (80 - through) * 0.6, `${worked} of ${80 - through} found a kerb at their work`);
});

test("a partial person's money moves only when something makes it: a crash is billed to them", () => {
  const roster = new Roster(R, { seed: "bills" });
  roster.commutersUpTo(3);
  const p = roster.commuters.get("commuter:0"), had = p.balance;
  assert.deepEqual(roster.billPartial(p.id, 350, "collision repair", 12), { paid: 350, owed: 0, balance: had - 350 });
  assert.equal(p.bills.length, 1);
  const big = roster.billPartial(p.id, 10_000_000, "hospital");
  assert.equal(big.balance, 0);
  assert.equal(big.paid + big.owed, 10_000_000);
  assert.equal(roster.billPartial("npc:someone", 100, "x"), null, "only a partial person");
  assert.equal(roster.billPartial(p.id, 0, "nothing"), null);
});

test("a visitor's trip is seen or not whole: the drive, the walk from the kerb and the shops alike", () => {
  const { streets, places } = town(), roster = new Roster(R, { seed: "whole" });
  roster.add(places);
  roster.visitorsUpTo(200);
  const city = new City(R, roster, streets, { seed: "whole", timeAt: (ms) => fleetTime(clock, ms) });
  city.through = 0.14;
  const t = city.timeAt(msAt(13));
  let trips = 0, seen = 0;
  for (const p of roster.visitors.values()) {
    const segs = city.planOf(p, t).segs;
    for (let i = 0; i < segs.length; i += 1) {
      assert.equal(typeof segs[i].unseen, "boolean");
      // A walk from the kerb or an hour about the shops goes with the drive before it.
      if (segs[i].mode !== "drive") { const drove = segs.slice(0, i).reverse().find((s) => s.mode === "drive"); if (drove) assert.equal(segs[i].unseen, drove.unseen); }
      else { trips += 1; if (!segs[i].unseen) seen += 1; }
    }
  }
  assert.ok(trips > 200 && seen > 0 && seen < trips * 0.4, `${seen} of ${trips} drives seen`);
});
