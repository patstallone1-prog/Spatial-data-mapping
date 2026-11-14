// Households (docs/city/households.mjs): the same building always holds the same people; sizes
// follow San Francisco's (mostly one and two people, few of five or more, none above seven); a
// household always fits its unit and is never cut to fit the cap; every adult drives or bikes,
// children live with an adult, a family shares a name, and about a third of adults drive.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { loadRules } from "../docs/city/core.mjs";
import { HOUSEHOLD_RULES, fitFor, householdStats, householdsFor } from "../docs/city/households.mjs";
import { unitsOf } from "../docs/city/market.mjs";
import { rng } from "../docs/city/people.mjs";

const R = loadRules(JSON.parse(readFileSync(new URL("../docs/city/rules.json", import.meta.url))));
const TAGS = R.housing.single_family_tags;

function homes(n = 1500) {
  const r = rng("households-test"), out = [];
  for (let i = 0; i < n; i += 1) {
    const house = r() < 0.45;
    out.push(house
      ? { id: `w${i}`, use: "residential", tag: TAGS[Math.floor(r() * TAGS.length)], area: 60 + r() * 160, floors: 1 + Math.floor(r() * 3), x: i, z: 0 }
      : { id: `w${i}`, use: "residential", tag: "apartments", area: 150 + r() * 750, floors: 2 + Math.floor(r() * 7), x: i, z: 0 });
  }
  return out;
}
const HOMES = homes();
const ALL = HOMES.flatMap((h) => householdsFor(R, h, { cap: Infinity }));
const CAPPED = HOMES.map((h) => householdsFor(R, h));

test("the same home always holds the same households", () => {
  for (const h of HOMES.slice(0, 40)) {
    assert.deepEqual(householdsFor(R, h), householdsFor(R, h));
    assert.deepEqual(householdsFor(R, h, { cap: Infinity }), householdsFor(R, { ...h }, { cap: Infinity }));
  }
});

test("household sizes follow San Francisco's, weighted to singles and small families", () => {
  const s = householdStats(ALL), n = s.households;
  const small = (s.by_size[1] || 0) + (s.by_size[2] || 0);
  const big = Object.entries(s.by_size).filter(([k]) => Number(k) >= 5).reduce((t, [, v]) => t + v, 0);
  assert.ok(small / n >= 0.6, `one and two: ${small / n}`);
  assert.ok(big / n <= 0.1, `five or more: ${big / n}`);
  assert.ok(Math.max(...Object.keys(s.by_size).map(Number)) <= 7);
  assert.ok(s.mean_size >= 1.8 && s.mean_size <= 2.8, `mean ${s.mean_size}`);
  assert.ok(HOUSEHOLD_RULES.size_share.basis && HOUSEHOLD_RULES.occupancy.basis);
});

test("no household is bigger than its unit allows", () => {
  const H = HOUSEHOLD_RULES;
  for (const hh of ALL) {
    assert.ok(fitFor(H, hh.beds)[hh.size] > 0, `${hh.size} in ${hh.beds} beds`);
    if (hh.beds === 0) assert.ok(hh.size <= 2);
  }
  // Units match the market's.
  const h = HOMES.find((x) => x.tag === "apartments");
  const ids = new Set(unitsOf(R, h).map((u) => u.id));
  for (const hh of householdsFor(R, h, { cap: Infinity })) assert.ok(ids.has(hh.unit));
});

test("the cap bounds a building's residents, households are whole and numbered without gaps", () => {
  for (const list of CAPPED) {
    assert.ok(list.length >= 1);
    const people = list.reduce((t, hh) => t + hh.size, 0);
    assert.ok(people <= 10 || list.length === 1, `${people} in ${list.length}`);
    const ks = list.flatMap((hh) => hh.members.map((m) => m.k));
    assert.deepEqual(ks, ks.map((_, i) => i));
    for (const hh of list) {
      assert.equal(hh.size, hh.members.length);
      for (const m of hh.members) assert.equal(m.hh, hh.id);
    }
  }
  const tall = HOMES.find((h) => h.tag === "apartments" && h.floors >= 6);
  assert.ok(householdsFor(R, tall, { cap: Infinity }).length > householdsFor(R, tall).length);
});

test("every adult drives or bikes, children live with an adult, families share a name", () => {
  for (const hh of ALL) {
    const adults = hh.members.filter((m) => m.adult);
    assert.ok(adults.length >= 1);
    for (const m of adults) assert.ok(m.mode === "drive" || m.mode === "bike");
    if (hh.travel === "bike") assert.equal(hh.cars, 0);
    if (hh.travel === "drive") assert.ok(hh.cars >= 1);
    for (const m of hh.members) {
      if (m.mode === "drive") assert.ok(m.adult && m.car !== null && m.car < hh.cars);
      else assert.equal(m.car, null);
      if (!m.adult) {
        assert.ok(m.age >= 0 && m.age <= 17);
        assert.equal(m.mode, m.age >= 12 && hh.travel === "bike" ? "bike" : "walk");
        assert.equal(m.surname, hh.surname);
        assert.ok(adults.some((a) => a.age >= m.age + 20));
      }
    }
    assert.equal(hh.bikes, hh.members.filter((m) => m.mode === "bike").length);
    assert.equal(hh.members.filter((m) => m.mode === "drive").length, hh.cars);
    if (hh.kind === "flatmates") assert.ok(hh.size <= 4 && hh.members.every((m) => m.adult));
    if (hh.kind === "single") assert.equal(hh.size, 1);
  }
});

test("about a third of adults drive", () => {
  const s = householdStats(ALL);
  const share = s.drivers / s.adults;
  assert.ok(share >= 0.2 && share <= 0.45, `drivers ${share}`);
  assert.equal(s.people, ALL.reduce((t, hh) => t + hh.members.length, 0));
});
