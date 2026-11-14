// Households: who lives in each home of a residential building, as families, couples, flatmates
// or people living alone, each right-sized to a unit that fits them (docs/city/market.mjs ->
// unitsOf), weighted towards singles and small families as San Francisco is. Each household
// either drives (a garage, or a car kept at the kerb) or bikes, and everyone walks. Pure and
// seeded: the same building always holds the same people (tests/city_households.test.mjs).

import { unitsOf } from "./market.mjs";
import { FIRST, LAST, rng } from "./people.mjs";

//: The defaults; ``R.households`` overrides them key by key.
export const HOUSEHOLD_RULES = {
  size_share: { basis: "San Francisco households by number of people, approx. Census ACS 5-year: about 37% one person, 33% two, 13% three, 10% four, 4.5% five, 2% six, 0.5% seven; nothing above seven is simulated",
    1: 0.37, 2: 0.33, 3: 0.13, 4: 0.1, 5: 0.045, 6: 0.02, 7: 0.005 },
  fit_by_beds: { basis: "how many people a unit holds by its bedrooms, as a weight on each size (a household is never put in a unit it does not fit): a studio 1-2 (mostly 1), one bed 1-2 (three rare), two bed 1-4, three bed 2-5, four or more 3-7; an informed estimate of how SF homes are shared",
    0: { 1: 1, 2: 0.45 }, 1: { 1: 1, 2: 1, 3: 0.08 }, 2: { 1: 0.45, 2: 1, 3: 1, 4: 0.7 }, 3: { 2: 0.7, 3: 1, 4: 1, 5: 1 }, 4: { 3: 0.8, 4: 1, 5: 1, 6: 1, 7: 1 } },
  occupancy: { basis: "share of homes lived in, approx. Census ACS: about 93% of SF housing units are occupied", share: 0.93 },
  kind_by_size: { basis: "what kind of household each size is, approx. Census ACS household types for SF: most pairs are couples, some a parent and child, some flatmates; larger households mostly families (two adults and children, sometimes a grandparent), some a single parent, a few adult flatmates (at most four)",
    2: { couple: 0.72, single_parent: 0.08, flatmates: 0.2 }, 3: { family: 0.7, single_parent: 0.14, flatmates: 0.16 }, big: { family: 0.8, single_parent: 0.12, flatmates: 0.08 },
    flatmates_max: 4, grandparent_share: 0.12 },
  own_share: { basis: "owner-occupied share, approx. Census ACS: about 38% of SF homes overall; houses mostly owned, flats mostly rented", single_family: 0.7, apartment: 0.27 },
  garage: { basis: "chance a household has a garage space (the numbers docs/city/fleet.mjs uses): a house 0.6, a block of four or more floors 0.45, other flats 0.15", single_family: 0.6, tall: 0.45, tall_floors: 4, apartment: 0.15 },
  kerb_share: { basis: "chance a household with no garage still keeps a car at the kerb; picked so that about a third of adults drive, as R.routine.drive_share (0.32) has it", share: 0.15 },
  second_car: { basis: "chance a driving household with two or more adults has a second car, approx. SF vehicles-per-household from Census ACS", share: 0.3 },
};

const pick = (r, list) => list[Math.floor(r() * list.length) % list.length];
const between = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
function weighted(r, weights) {
  const keys = Object.keys(weights).filter((k) => k !== "basis" && weights[k] > 0);
  let x = r() * keys.reduce((s, k) => s + weights[k], 0);
  for (const k of keys) { x -= weights[k]; if (x <= 0) return k; }
  return keys[keys.length - 1];
}
//: How many people may live in a unit with ``beds`` bedrooms, as {size: weight} (0 = studio).
export function fitFor(H, beds) { return H.fit_by_beds[Math.max(0, Math.min(4, beds | 0))]; }
// The size of the household in a unit: the city's share of each size, kept to what the unit fits.
function sizeFor(H, unit, r) {
  const fit = fitFor(H, unit.beds), w = {};
  for (const s of Object.keys(fit)) w[s] = (H.size_share[s] || 0) * fit[s];
  return Number(weighted(r, w));
}
function kindFor(H, size, r) {
  if (size === 1) return "single";
  const K = H.kind_by_size, w = { ...(size === 2 ? K[2] : size === 3 ? K[3] : K.big) };
  if (size > K.flatmates_max) delete w.flatmates;
  return weighted(r, w);
}
// The people of one household, without their building-wide index yet.
function membersFor(H, hid, kind, size, r) {
  const surname = pick(r, LAST), out = [];
  const person = (relation, age, own = surname) => out.push({ hh: hid, relation, first: pick(r, FIRST), surname: own, age, adult: age >= 18 });
  if (kind === "single") person("head", r() < 0.8 ? between(r, 25, 60) : between(r, 22, 85));
  else if (kind === "flatmates") {
    person("head", between(r, 21, 38));
    for (let i = 1; i < size; i += 1) person("flatmate", between(r, 21, 38), pick(r, LAST));
  } else if (kind === "couple") {
    const head = r() < 0.8 ? between(r, 25, 60) : between(r, 22, 85);
    person("head", head);
    person("partner", Math.max(20, head + between(r, -6, 6)), r() < 0.2 ? pick(r, LAST) : surname);
  } else {
    const head = between(r, 25, 55);
    person("head", head);
    let kids = size - 1, youngest = head;
    if (kind === "family") {
      const partner = Math.max(22, head + between(r, -6, 6));
      person("partner", partner, r() < 0.2 ? pick(r, LAST) : surname);
      youngest = Math.min(head, partner); kids -= 1;
      if (kids >= 2 && r() < H.kind_by_size.grandparent_share) { person("parent", between(r, Math.min(88, Math.max(62, head + 20)), 88)); kids -= 1; }
    }
    const oldest = Math.max(0, Math.min(17, youngest - 20));
    for (let i = 0; i < kids; i += 1) person("child", between(r, 0, oldest));
  }
  return out;
}
// A whole household for a unit, its size decided by the unit alone (so the cap never changes it).
function householdFor(R, H, home, unit) {
  const hid = `hh:${unit.id}`, r = rng(unit.id, "household");
  const size = sizeFor(H, unit, r), kind = kindFor(H, size, r);
  const members = membersFor(H, hid, kind, size, r);
  const G = H.garage;
  const garageOdds = unit.type === "single_family" ? G.single_family : (home.floors || 1) >= G.tall_floors ? G.tall : G.apartment;
  const garage = r() < garageOdds;
  const travel = garage || r() < H.kerb_share.share ? "drive" : "bike";
  const adults = members.filter((m) => m.adult);
  const cars = travel === "drive" ? (adults.length >= 2 && r() < H.second_car.share ? 2 : 1) : 0;
  adults.forEach((m, i) => { m.car = i < cars ? i : null; m.mode = m.car !== null ? "drive" : "bike"; });
  for (const m of members) if (!m.adult) { m.car = null; m.mode = m.age >= 12 && travel === "bike" ? "bike" : "walk"; }
  return { id: hid, home: home.id, unit: unit.id, label: unit.label, beds: unit.beds, sqft: unit.sqft, type: unit.type, kind, size, surname: members[0].surname,
    tenure: r() < (H.own_share[unit.type] ?? 0.38) ? "own" : "rent", garage, travel, cars, bikes: members.filter((m) => m.mode === "bike").length, members };
}

//: The households living in ``home`` (a residential place): its units (market.mjs) taken in a
//: seeded order, each lived in or not (occupancy), each household whole and fitted to its unit.
//: ``cap`` bounds how many people the building simulates, for performance (a tall block can hold
//: hundreds): households are added until the next would take it over ``cap``, a smaller one
//: further on is still taken, and none is ever cut down; at least one household always lives
//: there. ``cap: Infinity`` fills every occupied unit. Members are numbered ``k`` 0..n-1 across
//: the building, in unit order.
export function householdsFor(R, home, { cap = 10 } = {}) {
  const H = { ...HOUSEHOLD_RULES, ...(R.households || {}) };
  const units = unitsOf(R, home), order = units.map((_, i) => i), r = rng(home.id, "households");
  for (let i = order.length - 1; i > 0; i -= 1) { const j = Math.floor(r() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const chosen = [];
  let people = 0, first = null;
  for (const i of order) {
    if (people >= cap) break;
    if (rng(units[i].id, "occupied")() >= H.occupancy.share) continue;
    const hh = householdFor(R, H, home, units[i]);
    first ??= [i, hh];
    if (people + hh.size > cap) continue;
    chosen.push([i, hh]); people += hh.size;
  }
  if (!chosen.length) chosen.push(first || [order[0], householdFor(R, H, home, units[order[0]])]);
  chosen.sort((a, b) => a[0] - b[0]);
  let k = 0;
  const out = chosen.map(([, hh]) => hh);
  for (const hh of out) hh.members = hh.members.map((m) => ({ k: k++, ...m }));
  return out;
}
//: Totals over a flat list of households: how many, their people, by size and kind, the mean
//: size, and how many adults, drivers and bikers.
export function householdStats(list) {
  const s = { households: list.length, people: 0, by_size: {}, by_kind: {}, mean_size: 0, adults: 0, drivers: 0, bikers: 0 };
  for (const hh of list) {
    s.people += hh.size;
    s.by_size[hh.size] = (s.by_size[hh.size] || 0) + 1;
    s.by_kind[hh.kind] = (s.by_kind[hh.kind] || 0) + 1;
    for (const m of hh.members) { if (m.adult) s.adults += 1; if (m.mode === "drive") s.drivers += 1; if (m.mode === "bike") s.bikers += 1; }
  }
  s.mean_size = list.length ? s.people / list.length : 0;
  return s;
}
