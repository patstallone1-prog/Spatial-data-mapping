// Residents' careers and books (docs/city/npc-economy.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadRules } from "../docs/city/core.mjs";
import { rng } from "../docs/city/people.mjs";
import { ECONOMY_ANCHOR, ECONOMY_RULES, ROLE_FAMILY, booksOf, careerOf, hoursOn, weekdayOfDay } from "../docs/city/npc-economy.mjs";

const R = loadRules(JSON.parse(readFileSync(new URL("../docs/city/rules.json", import.meta.url))));
const A = ECONOMY_ANCHOR;
const roles = R.jobs.roles;

const people = (n, seed = "econ-test") => {
  const r = rng(seed);
  const working = Object.entries(roles).filter(([k]) => !["student", "retiree"].includes(k)).map(([k, v]) => [k, v.share]);
  const total = working.reduce((s, [, w]) => s + w, 0);
  return Array.from({ length: n }, (_, i) => {
    let x = r() * total, role = working.at(-1)[0];
    for (const [k, w] of working) { x -= w; if (x <= 0) { role = k; break; } }
    return { id: `npc:w${i}:0`, name: `P${i}`, role, shift: i % 3, age: 22 + Math.floor(r() * 40), home: `w${i}` };
  });
};

test("every role in the rules has a family", () => {
  assert.equal(Object.keys(roles).length, 37);
  for (const k of Object.keys(roles)) assert.ok(ROLE_FAMILY[k], k);
  for (const g of Object.values(ECONOMY_RULES)) assert.equal(typeof g.basis, "string");
});

test("the same answer whatever order the days are asked in", () => {
  const p = { id: "npc:w77:1", name: "Ana", role: "barista", shift: 1, age: 31, home: "w77" };
  const twin = { ...p };
  const X = A + 900;
  const a = careerOf(R, p, X);
  careerOf(R, p, X - 400);
  const b = careerOf(R, p, X);
  assert.deepEqual(a, b);
  const ba = booksOf(R, p, X, weekdayOfDay);
  booksOf(R, p, X - 400, weekdayOfDay);
  assert.deepEqual(booksOf(R, p, X, weekdayOfDay), ba);
  // A fresh person with another id whose cache is cold, asked the other way round, then the twin.
  const other = { ...p, id: "npc:w78:1" };
  const late = careerOf(R, other, X + 300);
  careerOf(R, other, X);
  assert.deepEqual(careerOf(R, other, X + 300), late);
  assert.deepEqual(careerOf(R, twin, X), a);
  assert.deepEqual(booksOf(R, twin, X, weekdayOfDay), ba);
  assert.deepEqual(careerOf(R, p, A - 500), careerOf(R, p, A - 900));
});

test("spells tile the days and history repeats what was said before", () => {
  for (const p of people(60, "tile")) {
    let prev = careerOf(R, p, A);
    const seen = new Map([[prev.spell, prev]]);
    for (let d = A + 1; d < A + 4 * 365; d += 1) {
      const c = careerOf(R, p, d);
      assert.ok(c.since <= d && d < c.until, `${p.id} ${d}`);
      if (c.spell !== prev.spell) {
        assert.equal(c.spell, prev.spell + 1);
        assert.equal(c.since, prev.until);
        assert.equal(c.since, d);
        assert.equal(c.history[0].role, prev.role);
        assert.equal(c.history[0].since, prev.since);
        assert.equal(c.history[0].until, prev.until);
        seen.set(c.spell, c);
      } else {
        assert.equal(c.since, prev.since);
        assert.equal(c.until, prev.until);
      }
      for (let h = 1; h < c.history.length; h += 1) assert.equal(c.history[h].until, c.history[h - 1].since);
      prev = c;
    }
    for (const [i, c] of seen) {
      if (i === 0) continue;
      const back = careerOf(R, p, c.history[0].since);
      assert.equal(back.role, c.history[0].role);
      assert.equal(back.spell, i - 1);
    }
  }
});

test("people change jobs, sometimes look for work, mostly stay in their trade", () => {
  let changers = 0, gaps = 0, changes = 0, same = 0;
  const group = people(400, "changes");
  for (const p of group) {
    let prev = careerOf(R, p, A), lastJob = prev.status === "employed" ? prev.role : null, n = 0, gap = false;
    for (let d = A + 1; d < A + 3 * 365; d += 1) {
      const c = careerOf(R, p, d);
      if (c.spell === prev.spell) continue;
      if (c.status === "looking") { gap = true; assert.equal(c.pay, 0); assert.equal(c.role, "unemployed"); assert.ok(c.left); }
      if (c.status === "employed") {
        assert.ok(!["student", "retiree", "unemployed", "remote_worker"].includes(c.role));
        if (lastJob) { n += 1; changes += 1; if (ROLE_FAMILY[lastJob] === ROLE_FAMILY[c.role]) same += 1; }
        if (prev.status === "employed") {
          assert.equal(c.left.reason, "better_offer");
          assert.ok(c.pay >= prev.pay, `${p.id} offer pays less`);
        }
        lastJob = c.role;
      }
      prev = c;
    }
    if (n) changers += 1;
    if (gap) gaps += 1;
    assert.ok(n <= 8, `${p.id} changed ${n} times`);
  }
  assert.ok(changers >= 0.3 * group.length, `changers ${changers}`);
  assert.ok(gaps > 0);
  assert.ok(same >= changes / 2, `same family ${same}/${changes}`);
});

test("a new job is dealt only from the roles open in the district", () => {
  const open = ["barista", "cook", "clerk"];
  for (const p of people(80, "open")) {
    for (let d = A; d < A + 3 * 365; d += 30) {
      const c = careerOf(R, p, d, { open });
      if (c.spell > 0 && c.status === "employed") assert.ok(open.includes(c.role), c.role);
    }
  }
});

test("raises come with each completed year, up to two", () => {
  const p = people(200, "raise").find((q) => { const c = careerOf(R, q, A + 400); return c.status === "employed" && A + 400 - c.since > 2 * 365 + 10; });
  assert.ok(p);
  const c = careerOf(R, p, A + 400);
  assert.equal(c.level, 2);
  assert.equal(c.pay, Math.round(roles[c.role].pay * 1.12));
});

test("children, students and retirees never earn; a retiree still pays rent and spends", () => {
  const kid = { id: "npc:k1:2", role: "student", shift: 0, age: 3, home: "k1" };
  const pupil = { id: "npc:k1:3", role: "student", shift: 0, age: 12, home: "k1" };
  const student = { id: "npc:s1:0", role: "student", shift: 0, age: 20, home: "s1" };
  const old = { id: "npc:r1:0", role: "retiree", shift: 0, age: 72, home: "r1" };
  const aged = { id: "npc:r2:0", role: "teacher", shift: 0, age: 67, home: "r2" };
  assert.equal(careerOf(R, kid, A + 10).status, "child");
  assert.equal(careerOf(R, pupil, A + 10).status, "student");
  assert.equal(careerOf(R, student, A + 10).status, "student");
  assert.equal(careerOf(R, old, A + 10).status, "retired");
  assert.equal(careerOf(R, aged, A + 10).role, "retiree");
  for (const p of [kid, pupil, student, old, aged]) {
    const b = booksOf(R, p, A + 700, weekdayOfDay);
    assert.equal(b.income_30d, 0);
    assert.equal(b.last_pay, null);
    assert.equal(hoursOn(R, careerOf(R, p, A + 700), p, A + 700, weekdayOfDay(A + 700)), 0);
  }
  const b0 = booksOf(R, old, A + 600, weekdayOfDay), b1 = booksOf(R, old, A + 660, weekdayOfDay);
  assert.ok(b1.balance < b0.balance);
  assert.ok(b1.rent_30d > 0 && b1.spend_30d > 0);
  const k0 = booksOf(R, kid, A + 600, weekdayOfDay), k1 = booksOf(R, kid, A + 660, weekdayOfDay);
  assert.equal(k0.balance, k1.balance);
});

test("pay day steps the balance up by the fortnight's take-home", () => {
  const E = ECONOMY_RULES;
  const p = people(200, "payday").find((q) => {
    const c = careerOf(R, q, A + 700);
    return c.status === "employed" && c.since < A + 600 && c.until > A + 760;
  });
  assert.ok(p);
  let pd = E.payday.first + E.payday.every * Math.ceil((A + 720 - E.payday.first) / E.payday.every);
  let gross = 0, hours = 0;
  for (let d = pd - 14; d < pd; d += 1) {
    const c = careerOf(R, p, d);
    const h = hoursOn(R, c, p, d, weekdayOfDay(d));
    hours += h; gross += h * c.pay;
  }
  assert.ok(hours > 0);
  const net = Math.round(gross * (1 - E.tax.withholding));
  const before = booksOf(R, p, pd - 1, weekdayOfDay), on = booksOf(R, p, pd, weekdayOfDay);
  assert.deepEqual(on.last_pay, { day: pd, amount: net });
  assert.equal(before.next_pay, pd);
  assert.equal(on.next_pay, pd + 14);
  const payLine = on.lines.find((l) => l.kind === "pay" && l.day === pd);
  assert.equal(payLine.amount, net);
  const rentDay = (pd - A) % 30 === 0 ? R.start.room_rent_per_day * 30 : 0;
  const delta = on.balance - before.balance;
  assert.ok(delta < net && delta > net - rentDay - on.spend_30d / 5, `delta ${delta} net ${net}`);
  // Thirty days' income is about the pay for thirty days' hours, less withholding.
  let h30 = 0;
  const c = careerOf(R, p, pd);
  for (let d = pd - 29; d <= pd; d += 1) h30 += hoursOn(R, careerOf(R, p, d), p, d, weekdayOfDay(d));
  const expect = h30 * c.pay * (1 - E.tax.withholding);
  assert.ok(on.income_30d > 0.4 * expect && on.income_30d < 1.6 * expect, `${on.income_30d} vs ${expect}`);
  assert.equal(on.wage_hour, c.pay);
  for (const l of on.lines) assert.ok(Number.isInteger(l.amount));
  assert.ok(on.lines.length <= 8);
  const withCar = booksOf(R, p, pd, weekdayOfDay, { assets: [{ kind: "car", label: "2019 sedan", value: R.money(9000) }] });
  assert.equal(withCar.net_worth, on.balance + R.money(9000));
  assert.equal(withCar.assets[0].label, "2019 sedan");
});

test("through a spell of looking there is no pay and the balance falls, never below the floor", () => {
  let checked = 0, broke = 0;
  for (const p of people(300, "gap")) {
    let gap = null;
    for (let d = A + 60; d < A + 3 * 365 && !gap; d += 1) {
      const c = careerOf(R, p, d);
      if (c.status === "looking" && c.since === d && c.until - c.since >= 45) gap = c;
    }
    if (!gap) continue;
    const rent = R.money(1_000_000);
    const floor = -Math.round((rent * 7) / 30);
    const mid = gap.since + 44;
    const b = booksOf(R, p, mid, weekdayOfDay, { rent });
    assert.equal(b.income_30d, 0);
    assert.equal(b.wage_hour, 0);
    const start = booksOf(R, p, gap.since + 14, weekdayOfDay, { rent });
    assert.ok(b.balance <= start.balance);
    for (let d = gap.since; d < gap.until; d += 3) {
      const bal = booksOf(R, p, d, weekdayOfDay, { rent }).balance;
      assert.ok(bal >= floor, `${bal} below ${floor}`);
      if (bal < 0) broke += 1;
    }
    const plain0 = booksOf(R, p, gap.since + 14, weekdayOfDay), plain1 = booksOf(R, p, mid, weekdayOfDay);
    assert.ok(plain1.balance < plain0.balance);
    checked += 1;
    if (checked >= 10) break;
  }
  assert.ok(checked > 0);
  assert.ok(broke > 0, "the floor was never reached");
});
