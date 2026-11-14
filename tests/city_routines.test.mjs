// Everyone's day by the kind of day it is (docs/city/routines.mjs): the shape daySchedule gives
// (so docs/city/fleet.mjs walks it unchanged), its shifts to the minute, each kind of day its own,
// tasks only at places that do them, and the same plan for the same person and day.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { loadRules } from "../docs/city/core.mjs";
import { daySchedule, rng, workplacesByRole } from "../docs/city/people.mjs";
import { ROUTINE_TYPES, TASKS, dayPlan, milestonesOf, routineType } from "../docs/city/routines.mjs";

const R = loadRules(JSON.parse(readFileSync(new URL("../docs/city/rules.json", import.meta.url))));
const KINDS = new Set(["sleep", "home", "work", "break", "errand", "meal", "stroll", "sport", "evening"]);

// A small town: homes in rows, a school, shops of each kind, offices, a hotel, a park court.
function town({ school = true, staffing = true } = {}) {
  const places = [];
  const put = (id, use, shops = [], extra = {}) => {
    const k = places.length;
    places.push({ id, x: (k % 7) * 110, z: Math.floor(k / 7) * 110, use, shops,
      keys: new Set([`use:${use}`, ...shops.map((s) => `shop:${s}`)]), ...extra });
  };
  for (let i = 0; i < 16; i += 1) put(`home${i}`, "residential");
  if (school) put("school", "school");
  for (const [id, s] of [["cafe1", "cafe"], ["cafe2", "cafe"], ["cafe3", "bakery"], ["market", "grocery"], ["corner", "convenience"],
    ["pharmacy", "pharmacy"], ["bank", "bank"], ["bar", "bar"], ["rest1", "restaurant"], ["rest2", "italian"], ["rest3", "thai"],
    ["laundry", "laundry"], ["barber", "barber"], ["gym", "gym"], ["hardware", "hardware"], ["ups", "print_ship"]]) put(id, "retail", [s]);
  if (staffing) put("staffing", "office", ["staffing"]);
  for (const id of ["office1", "office2", "office3"]) put(id, "office");
  put("civic", "civic");
  put("hotel", "hotel");
  put("depot", "industrial");
  put("garage", "parking");
  put("court:basketball", "park", [], { court: { s: "basketball" } });
  return places;
}
const PLACES = town();
const WORK = workplacesByRole(R, PLACES);
const HOMES = PLACES.filter((p) => p.use === "residential");
const byId = (places) => new Map(places.map((p) => [p.id, p]));

function person(i, role, { age = 35, places = PLACES, work = undefined } = {}) {
  const spec = R.jobs.roles[role];
  const homes = places.filter((p) => p.use === "residential");
  const home = homes[i % homes.length].id;
  const at = workplacesByRole(R, places)[role] || [];
  const w = work !== undefined ? work : spec.at.includes("home") ? home : at.length ? at[i % at.length].id : null;
  return { id: `p:${role}:${i}`, role, shift: i % Math.max(1, spec.shifts.length), home, work: w, age,
    outgoing: i % 5 === 0 ? undefined : 0.5 + (i % 11) / 10, outdoor: spec.outdoor || null, pace: 1.15 + (i % 4) * 0.1 };
}
const KID = { members: [{ k: 0, age: 38, adult: true, relation: "head" }, { k: 1, age: 7, adult: false, relation: "child" }], size: 2 };

// The checks every plan has to pass.
function check(plan, p, places = PLACES, what = "") {
  const P = byId(places);
  const tag = `${p.id} ${what}`;
  assert.ok(plan.length > 0, `${tag}: a plan`);
  for (let i = 0; i < plan.length; i += 1) {
    const a = plan[i];
    assert.ok(KINDS.has(a.kind), `${tag}: kind ${a.kind}`);
    assert.ok(a.end > a.start, `${tag}: ${a.kind} ${a.start}-${a.end}`);
    assert.ok(P.has(a.place), `${tag}: ${a.kind} at ${a.place}`);
    assert.ok(typeof a.label === "string" && a.label.length, `${tag}: label`);
    assert.equal(a.by, a.start, `${tag}: by`);
    if (i) assert.ok(a.start >= plan[i - 1].end, `${tag}: ${plan[i - 1].kind}→${a.kind} overlap`);
    if (a.kind === "work") assert.equal(a.outdoor, p.outdoor, `${tag}: work outdoor`);
    if (a.kind === "break") { assert.equal(a.outside, true); assert.equal(a.place, p.work); }
    if (a.kind === "stroll") { assert.equal(a.outdoor, "stroll"); assert.ok(Number.isInteger(a.seed)); assert.equal(a.place, p.home); }
    if (a.task) {
      const t = TASKS[a.task], place = P.get(a.place);
      assert.ok(t, `${tag}: task ${a.task}`);
      assert.equal(a.kind, t.kind, `${tag}: ${a.task} kind`);
      const ok = t.home ? a.place === p.home : t.keys.some((k) => place.keys.has(k)) || (t.court && place.court) || (t.anyShop && place.shops.length);
      assert.ok(ok, `${tag}: ${a.task} at ${a.place}`);
    }
  }
  const first = plan[0], last = plan[plan.length - 1];
  assert.ok((first.kind === "sleep" && first.place === p.home) || first.kind === "work", `${tag}: starts ${first.kind}`);
  if (first.kind === "work") assert.ok(first.start <= 10, `${tag}: starts at work at ${first.start}`);
  assert.ok((last.kind === "sleep" && last.place === p.home && last.end === 1441) || (last.kind === "work" && last.end >= 1440),
    `${tag}: ends ${last.kind} ${last.end}`);
}

// People for each kind of day: [type, how to make the i-th, its options].
const GROUPS = {
  day_shift: (i) => [person(i, ["office_worker", "teacher", "teller", "civil_servant"][i % 4])],
  late_shift: (i) => [{ ...person(i, "server"), shift: 1 }],
  night_shift: (i) => [person(i, ["night_auditor", "bartender", "baker"][i % 3])],
  rounds: (i) => [person(i, ["police", "taxi_driver", "delivery_driver", "mail_carrier"][i % 4])],
  student: (i) => [person(i, "student", { age: 19 + (i % 6) })],
  school_child: (i) => (i % 2 ? [person(i, "student", { age: 6 + (i % 11) })] : [person(i, "barista", { age: 5 + (i % 12), work: null }), { career: { status: "child" } }]),
  parent: (i) => [person(i, ["remote_worker", "unemployed", "office_worker"][i % 3]), { household: KID }],
  retiree: (i) => [person(i, "retiree", { age: 66 + (i % 20) })],
  remote: (i) => [person(i, "remote_worker")],
  job_seeker: (i) => (i % 2 ? [person(i, "unemployed")] : [person(i, "barista"), { career: { status: "looking" } }]),
  day_off: (i) => [person(i, ["office_worker", "stylist", "teller"][i % 3])],
};

test("every kind of day keeps daySchedule's shape and invariants", () => {
  for (const [type, make] of Object.entries(GROUPS)) {
    let seen = 0;
    for (let i = 0; i < 60; i += 1) {
      const [p, opt = {}] = make(i);
      for (let day = 0; day < 7; day += 1) {
        const weekday = (day + 1) % 7;
        const plan = dayPlan(R, p, day, weekday, PLACES, opt);
        check(plan, p, PLACES, `${type} day ${day}`);
        if (routineType(R, p, { ...opt, day, weekday }) === type) seen += 1;
      }
    }
    assert.ok(seen >= 30, `${type} seen ${seen} times`);
  }
  assert.deepEqual(Object.keys(ROUTINE_TYPES).sort(), Object.keys(GROUPS).sort());
  for (const t of Object.values(ROUTINE_TYPES)) assert.ok(t.basis.length > 10);
});

test("shifts are daySchedule's to the minute", () => {
  const roles = ["office_worker", "barista", "grocer", "police", "bartender", "night_auditor", "nurse", "teacher", "security_guard", "taxi_driver", "remote_worker", "firefighter"];
  let compared = 0;
  for (const role of roles) for (let i = 0; i < 12; i += 1) {
    const p = person(i, role), q = person(i, role);
    for (let day = 10; day < 17; day += 1) {
      const weekday = day % 7;
      const old = daySchedule(R, q, day, weekday, PLACES).filter((a) => a.kind === "work");
      const now = dayPlan(R, p, day, weekday, PLACES).filter((a) => a.kind === "work");
      assert.equal(now.length > 0, old.length > 0, `${p.id} day ${day}: works`);
      if (!old.length) continue;
      assert.equal(now[0].start, old[0].start, `${p.id} day ${day}: start`);
      assert.equal(now[now.length - 1].end, old[old.length - 1].end, `${p.id} day ${day}: end`);
      compared += 1;
    }
  }
  assert.ok(compared >= 100, `compared ${compared}`);
});

test("each kind of day is its own", () => {
  const school = new Set(PLACES.filter((p) => p.keys.has("use:school")).map((p) => p.id));
  for (let i = 0; i < 60; i += 1) for (let day = 0; day < 7; day += 1) {
    const weekday = day, weekdayish = weekday >= 1 && weekday <= 5;
    // A retiree never works.
    assert.ok(!dayPlan(R, person(i, "retiree", { age: 70 }), day, weekday, PLACES).some((a) => a.kind === "work"));
    // A school child is at school on weekdays only.
    const [kid, opt] = GROUPS.school_child(i);
    const at = dayPlan(R, kid, day, weekday, PLACES, opt).filter((a) => a.kind === "work");
    if (weekdayish) { assert.equal(at.length, 1, `${kid.id} at school`); assert.ok(school.has(at[0].place)); assert.equal(at[0].start, 495); assert.equal(at[0].end, 900); }
    else assert.equal(at.length, 0, `${kid.id} no school at the weekend`);
    assert.ok(dayPlan(R, kid, day, weekday, PLACES, opt).at(-1).start <= 1260, "children in bed by nine");
    // A parent with a young child does the school run on a weekday.
    const mum = person(i, ["remote_worker", "unemployed"][i % 2]);
    assert.equal(routineType(R, mum, { household: KID, day, weekday }), "parent");
    const run = dayPlan(R, mum, day, weekday, PLACES, { household: KID }).filter((a) => /^school_/.test(a.task || ""));
    if (weekdayish) {
      assert.ok(run.length >= 1, `${mum.id} day ${day}: school run`);
      for (const a of run) assert.ok(school.has(a.place));
      const d = run.find((a) => a.task === "school_drop");
      if (d) assert.ok(d.start >= 480 && d.start <= 500, `drop-off at ${d.start}`);
    } else assert.equal(run.length, 0);
    // A job seeker looks for work on weekdays.
    const [js, jopt] = GROUPS.job_seeker(i);
    const hunts = dayPlan(R, js, day, weekday, PLACES, jopt).filter((a) => a.task === "job_hunt");
    if (weekdayish) assert.ok(hunts.length >= 2, `${js.id} day ${day}: ${hunts.length} job hunts`);
    assert.ok(!dayPlan(R, js, day, weekday, PLACES, jopt).some((a) => a.kind === "work"));
    // An office worker's weekend is a day off, without work.
    if (!weekdayish) {
      const w = person(i, "office_worker");
      assert.equal(routineType(R, w, { day, weekday }), "day_off");
      assert.ok(!dayPlan(R, w, day, weekday, PLACES).some((a) => a.kind === "work"));
    }
  }
});

test("the same person and day give the same plan", () => {
  for (const [type, make] of Object.entries(GROUPS)) for (let i = 0; i < 10; i += 1) {
    const [p, opt = {}] = make(i), [q] = make(i);
    for (let day = 0; day < 4; day += 1) {
      const a = dayPlan(R, p, day, day, PLACES, opt);
      assert.deepEqual(dayPlan(R, p, day, day, PLACES, opt), a);
      assert.deepEqual(dayPlan(R, q, day, day, PLACES, opt), a, `${type} ${p.id}`);
    }
  }
});

test("milestones are in time order, one per change of place", () => {
  for (const make of Object.values(GROUPS)) for (let i = 0; i < 10; i += 1) {
    const [p, opt = {}] = make(i);
    const plan = dayPlan(R, p, 3, 3, PLACES, opt), ms = milestonesOf(plan);
    let changes = 1;
    for (let k = 1; k < plan.length; k += 1) if (plan[k].place !== plan[k - 1].place) changes += 1;
    assert.equal(ms.length, changes);
    for (let k = 1; k < ms.length; k += 1) { assert.ok(ms[k].at >= ms[k - 1].at); assert.notEqual(ms[k].place, ms[k - 1].place); }
    assert.equal(ms[0].place, plan[0].place);
  }
  assert.deepEqual(milestonesOf([]), []);
});

test("random people never break it: no places, no school, no staffing agency", () => {
  const roles = Object.keys(R.jobs.roles), bare = town({ school: false, staffing: false });
  const statuses = [null, "employed", "looking", "retired", "student", "child"];
  for (let i = 0; i < 300; i += 1) {
    const r = rng("routines-test", i);
    const role = roles[Math.floor(r() * roles.length)], age = 4 + Math.floor(r() * 82);
    const status = statuses[Math.floor(r() * statuses.length)];
    const opt = { household: r() < 0.3 ? KID : null, career: status ? { status, role: roles[Math.floor(r() * roles.length)] } : null };
    for (let day = 0; day < 3; day += 1) {
      const weekday = Math.floor(r() * 7);
      assert.deepEqual(dayPlan(R, person(i, role, { age }), day, weekday, [], opt), []);
      const p = person(i, role, { age }), plan = dayPlan(R, p, day, weekday, PLACES, opt);
      assert.ok(Object.hasOwn(ROUTINE_TYPES, routineType(R, p, { ...opt, day, weekday })));
      check(plan, p, PLACES, "random");
      const q = person(i, role, { age, places: bare }), plain = dayPlan(R, q, day, weekday, bare, opt);
      check(plain, q, bare, "no school");
      assert.ok(!plain.some((a) => /^school_/.test(a.task || "")), "no school run without a school");
      assert.ok(!plain.some((a) => a.task === "job_hunt" && a.label !== TASKS.job_hunt.anyShop), "asking about work at a shop");
    }
  }
});

test("task keys are kinds the city knows", () => {
  const known = new Set([...Object.keys(R.stores.kinds).map((k) => `shop:${k}`),
    ...["residential", "office", "restaurant", "retail", "gas_station", "hotel", "civic", "school", "parking", "industrial", "park"].map((u) => `use:${u}`),
    ...Object.values(R.jobs.roles).flatMap((s) => s.at)]);
  for (const t of Object.values(TASKS)) {
    for (const k of t.keys) assert.ok(known.has(k), `${t.id}: ${k}`);
    assert.ok(t.minutes[1] >= t.minutes[0] && t.hours[1] > t.hours[0] && t.label);
  }
});
