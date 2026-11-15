// The city's people and the world's edges (docs/city/fleet.mjs, people.mjs, transit.mjs): a shop
// lets in no more than it holds and the rest wait at the door, go elsewhere, come later or give it
// up; those inside keep a lane of the floor each; nobody on foot is ever drawn inside a building
// they did not go into by its door; and a bus that leaves City mode's area sets you down at the
// last stop inside it and goes on along its real route.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { cityTime, loadRules } from "../docs/city/core.mjs";
import { City, Roster, inRing } from "../docs/city/fleet.mjs";
import { PAVE_M, PAVE_MIN_M, Streets, indoorSpot, paveOffset, placeFromBuilding, shopCapacity, shopLanes, shopRows, shopSeen } from "../docs/city/people.mjs";
import { drawWeights } from "../docs/city/routines.mjs";
import { BOUNDARY_MESSAGE, boundaryStop, buildLines, busesAt } from "../docs/city/transit.mjs";

const R = loadRules(JSON.parse(readFileSync(new URL("../docs/city/rules.json", import.meta.url))));
const timeAt = (ms) => cityTime(ms, R.clock.zone);
const DAY = Date.UTC(2026, 9, 6, 7, 0);   // midnight in San Francisco, a Tuesday
const N = 8, STEP = 100, HALF = 6, SET = 10, DEEP = 20, W = 10;

//: A town of 100 m blocks whose north and south sides are rows of attached buildings, 10 m wide
//: and 20 m deep, their fronts 10 m off the street's middle (a 4 m pavement), each door in the
//: middle of its front; one building in five a small shop.
function town({ kinds = ["cafe", "grocery", "bakery", "pharmacy", "restaurant"] } = {}) {
  const ways = [];
  for (let i = 0; i <= N; i += 1) {
    const along = Array.from({ length: N + 1 }, (_, j) => j * STEP);
    ways.push({ kind: "street", pts: along.map((v) => [i * STEP, v]), lanes: 2, oneway: 0, id: `v${i}`, name: `${i} Avenue`, road_m: 2 * HALF });
    ways.push({ kind: "street", pts: along.map((v) => [v, i * STEP]), lanes: 2, oneway: 0, id: `h${i}`, name: `${i} Street`, road_m: 2 * HALF });
  }
  const streets = new Streets(ways), places = [];
  let k = 0;
  for (let i = 0; i < N; i += 1) for (let j = 0; j < N; j += 1) for (const side of [-1, 1]) for (let q = 0; q < 8; q += 1) {
    k += 1;
    const x0 = i * STEP + SET + q * W, x1 = x0 + W;
    // South side (side -1): its front on the street at z = j*STEP, facing it; north: the next one.
    // (A block in three is built out to a metre from the kerb, as many of the Marina's fronts are
    // drawn: the pavement's walking line, 1.6 m out from the kerb, is inside them.)
    const set = (i + j) % 3 === 0 ? HALF + 1 : SET;
    const zf = side < 0 ? j * STEP + set : (j + 1) * STEP - set, zb = zf - side * DEEP;
    const ring = [[x0, zf], [x1, zf], [x1, zb], [x0, zb]];
    const kind = k % 5 === 0 ? kinds[(k / 5) % kinds.length] : null;
    const b = { id: `b${k}`, x: (x0 + x1) / 2, z: (zf + zb) / 2, archetype: "residential", floors: 3, area: W * DEEP, shops: kind ? [{ t: kind, n: "Corner" }] : [],
      name: `${k} Test Street`, tag: "apartments" };
    const pl = placeFromBuilding(b, streets, R);
    if (!pl) continue;
    const nz = -side;   // inward, from the front
    pl.ring = ring;
    pl.door = { x: (x0 + x1) / 2, z: zf, nx: 0, nz, from: "front" };
    pl.front = { x: (x0 + x1) / 2, z: zf, nx: 0, nz, half: W / 2, depth: DEEP };
    pl.inside = pl.shops.length ? pl.front : null;
    places.push(pl);
  }
  const roster = new Roster(R, { seed: "integrity" });
  roster.add(places);
  const city = new City(R, roster, streets, { seed: "integrity", timeAt });
  return { streets, roster, city, places };
}

//: Every customer's stay in a shop over the day: {place: [[t0, t1, lane]]}.
function stays(city, roster, t) {
  const out = new Map();
  for (const p of roster.people.values()) {
    for (const s of city.planOf(p, t).segs) {
      if (s.kind !== "stay" || !s.act || !["errand", "meal", "evening"].includes(s.act.kind)) continue;
      const pl = roster.places.get(s.place);
      if (!pl?.shops?.length) continue;
      if (!out.has(pl.id)) out.set(pl.id, []);
      out.get(pl.id).push([s.t0, s.t1, s.lane, p.id]);
    }
  }
  return out;
}
const peak = (list) => {
  const ev = list.flatMap(([a, b]) => [[a, 1], [b, -1]]).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  let n = 0, most = 0;
  for (const [, d] of ev) { n += d; most = Math.max(most, n); }
  return most;
};

test("a busy day: no shop has more customers in it at once than it holds, and the rest wait, go elsewhere or come later", (tc) => {
  // Busy: everyone out for coffee, lunch, errands and the evening far more than usual.
  const busy = { ...R, routine: { ...R.routine, meal_out_chance: 0.95, evening_out_chance: 0.9, errand_chance: 0.95, task_keep: 1 } };
  const { city, roster } = town();
  city.R = busy;
  const t = timeAt(DAY + 12 * 3_600_000);
  // Without the door (as it was): more in than the shop holds.
  city.admitting = false;
  const before = stays(city, roster, t);
  const over = [...before].filter(([id, list]) => peak(list) > shopCapacity(roster.places.get(id)));
  assert.ok(over.length > 0, "the busy day overfills some shop when nobody is turned away");
  // With it: never more than it holds, each in a lane of their own.
  city.admitting = true; city.plans.clear(); city.shopBooks.clear(); city.admitted.clear();
  const after = stays(city, roster, t);
  let checked = 0;
  for (const [id, list] of after) {
    const cap = shopCapacity(roster.places.get(id));
    assert.ok(peak(list) <= cap, `${id}: ${peak(list)} in at once, holds ${cap}`);
    for (const a of list) for (const b of list) {
      if (a === b || !(a[0] < b[1] && b[0] < a[1])) continue;
      assert.notEqual(a[2], b[2], `${id}: two customers in one lane at once`);
    }
    checked += 1;
  }
  assert.ok(checked > 10);
  const kinds = {};
  for (const d of city.admitted.values()) kinds[d.kind] = (kinds[d.kind] || 0) + 1;
  tc.diagnostic(`without the door: ${over.length} shops over capacity, worst ${Math.max(...over.map(([id, l]) => peak(l) / shopCapacity(roster.places.get(id)))).toFixed(1)}x; at the door: ${JSON.stringify(kinds)}`);
  assert.ok(kinds.in > 0 && (kinds.queue || 0) + (kinds.elsewhere || 0) + (kinds.later || 0) > 0, JSON.stringify(kinds));
  // Those waiting stand in a line at the door, each in their own place in it, outside.
  const waits = [];
  for (const p of roster.people.values()) for (const s of city.planOf(p, t).segs) if (s.mode === "wait" && s.queue !== undefined) waits.push(s);
  if (kinds.queue) {
    assert.ok(waits.length > 0);
    for (const w of waits) assert.ok(!city.footprintAt(w.at[0], w.at[1]), "the line is on the pavement");
    const byShop = new Map();
    for (const w of waits) { const l = byShop.get(w.place) || []; l.push(w); byShop.set(w.place, l); }
    for (const list of byShop.values()) for (const a of list) for (const b of list) if (a !== b && a.t0 < b.t1 && b.t0 < a.t1) assert.notEqual(a.queue, b.queue);
  }
  // A day planned again comes out the same (the decisions are kept).
  const p = [...roster.people.values()].find((q) => city.planOf(q, t).segs.some((s) => s.act?.redirected || s.queue !== undefined));
  if (p) {
    const once = JSON.stringify(city.planOf(p, t).segs.map((s) => [s.kind, s.t0, s.t1, s.place, s.lane]));
    city.plans.clear();
    assert.equal(JSON.stringify(city.planOf(p, t).segs.map((s) => [s.kind, s.t0, s.t1, s.place, s.lane])), once);
  }
});

test("inside a shop, the customers keep apart: never two within 0.4 m", () => {
  const { city, roster } = town();
  const busy = { ...R, routine: { ...R.routine, meal_out_chance: 0.95, errand_chance: 0.95, task_keep: 1 } };
  city.R = busy;
  const t0 = timeAt(DAY + 12 * 3_600_000);
  const ppl = [...roster.people.values()];
  for (const p of ppl) city.planOf(p, t0);
  let pairs = 0, close = 0;
  for (let s = 11 * 3600; s < 14 * 3600; s += 30) {
    const t = timeAt(DAY + s * 1000), inside = new Map();
    for (const p of ppl) {
      const pos = city.personAt(p, t, undefined, { x: 400, z: 400 });
      if (!pos?.indoors) continue;
      const l = inside.get(pos.indoors) || [];
      l.push(pos); inside.set(pos.indoors, l);
    }
    for (const l of inside.values()) for (let a = 0; a < l.length; a += 1) for (let b = a + 1; b < l.length; b += 1) {
      pairs += 1;
      if (Math.hypot(l[a].x - l[b].x, l[a].z - l[b].z) < 0.4) close += 1;
    }
  }
  assert.ok(pairs > 50, `pairs ${pairs}`);
  assert.equal(close, 0, `${close} of ${pairs} pairs inside a shop within 0.4 m`);
});

test("a shop holds what its floor has room for; only as many as its drawn front has places for are seen", () => {
  // A convenience store of 327 m² behind a 4 m front (the Marina's 272647181): by the first rule
  // it held two, one a lane across the door.
  const store = { id: "s", area: 327, shops: ["convenience"], inside: { x: 0, z: 0, nx: 0, nz: 1, half: 2, depth: 14 } };
  assert.equal(shopCapacity(store), 29);
  const seen = shopSeen(store);
  assert.equal(seen, shopLanes(store.inside) * shopRows(store.inside));
  assert.ok(seen >= 2 && seen < 29, `seen ${seen}`);
  // A café of 60 m²: twenty-one seats, never the old fourteen-or-fewer by lanes alone.
  assert.equal(shopCapacity({ id: "c", area: 60, shops: ["cafe"], inside: store.inside }), 21);
  assert.equal(shopCapacity({ id: "h", area: 5000, shops: ["grocery"] }), 40);
  assert.equal(shopCapacity({ id: "t", area: 4, shops: ["bank"] }), 1);
});

test("those drawn in a shop keep apart in lanes and rows; the rest are further in and not drawn", () => {
  const { city, roster } = town();
  // A deep shop behind a 4 m front: more inside than its drawn floor has places for.
  const base = roster.list.find((q) => q.shops.length && q.inside);
  const pl = { ...base, id: `${base.id}:deep`, area: 400, inside: { ...base.inside, half: 2 } };
  const seen = shopSeen(pl), cap = shopCapacity(pl);
  assert.ok(cap > seen, `the test shop holds more (${cap}) than its floor shows (${seen})`);
  const t = timeAt(DAY + 12 * 3_600_000), day = t.day;
  // Fill it: the first in take the drawn places, the rest go further in.
  const lanes = [];
  for (let k = 0; k < cap; k += 1) { const lane = city.roomIn(pl, day, 700, 760, `p${k}`); assert.ok(lane >= 0); city.shopBook(pl.id, day).push({ who: `p${k}`, t0: 700, t1: 760, lane }); lanes.push(lane); }
  assert.equal(new Set(lanes).size, cap, "a place each");
  assert.deepEqual(lanes.slice(0, seen).sort((a, b) => a - b), Array.from({ length: seen }, (_, k) => k), "the drawn floor fills first");
  assert.equal(city.roomIn(pl, day, 700, 760, "late"), -1, "full");
  // Everyone on the drawn floor, at any moment: half a step apart at least.
  const someone = [...roster.people.values()][0];
  for (let m = 700; m < 760; m += 0.3) {
    const at = [];
    for (let k = 0; k < seen; k += 1) at.push(indoorSpot({ ...someone, id: `c${k}` }, { kind: "errand" }, pl, timeAt(DAY + m * 60_000), { k }));
    for (let i = 0; i < at.length; i += 1) for (let j = i + 1; j < at.length; j += 1) {
      assert.ok(Math.hypot(at[i].x - at[j].x, at[i].z - at[j].z) >= 0.4, `places ${i} and ${j} within 0.4 m at ${m}`);
    }
  }
});

test("a shop is looked at as often as it has room: the big one draws more than the kiosk", () => {
  const list = [{ id: "kiosk", area: 12, shops: ["grocery"] }, { id: "market", area: 400, shops: ["grocery"] }, { id: "park", shops: [] }];
  const cum = drawWeights(list);
  assert.deepEqual([...cum], [1, 1 + 35, 1 + 35 + 1]);
  assert.equal(drawWeights(list), cum, "kept by the list");
});

test("on foot from door to door nobody is drawn inside a building they did not go into", (tc) => {
  const { city, roster } = town();
  const t0 = timeAt(DAY + 12 * 3_600_000);
  const walkers = [...roster.people.values()].filter((p) => city.planOf(p, t0).segs.some((s) => s.kind === "go" && s.mode === "walk")).slice(0, 400);
  assert.ok(walkers.length > 100);
  const count = (guard) => {
    city.guardWalls = guard;
    let samples = 0, inside = 0;
    for (const p of walkers) {
      for (const seg of city.planOf(p, t0).segs) {
        if (seg.kind !== "go" || seg.mode !== "walk" || seg.t0 < 6 * 60 || seg.t1 > 22 * 60) continue;
        for (let m = seg.t0; m < seg.t1; m += 2 / 60) {
          const t = timeAt(DAY + m * 60_000), pos = city.personAt(p, t, seg, { x: 400, z: 400 });
          if (!pos || pos.indoors) continue;
          samples += 1;
          // In the doorway of the place they leave or go into: theirs to be in.
          const f = city.footprintAt(pos.x, pos.z);
          if (f && !(pos.through && (f.pl.id === seg.from || f.pl.id === seg.to))) inside += 1;
        }
      }
    }
    return { samples, inside };
  };
  const before = count(false), after = count(true);
  tc.diagnostic(`without the wall check: ${before.inside} of ${before.samples} points inside a building; with it: ${after.inside} of ${after.samples}`);
  assert.ok(before.inside > 0, "without the check, the pavement's line runs through the fronts built out near the kerb");
  assert.ok(after.samples > 2000, `samples ${after.samples}`);
  assert.equal(after.inside, 0, `${after.inside} of ${after.samples} walkers' points inside a building`);
});

test("the pavement's line keeps to the room between the kerb and the fronts on each side", (tc) => {
  // The same town and walkers twice, the wall check off: the line a fixed 1.6 m from the kerb,
  // and the line set by the fronts along each side of each block (City.walkOffset).
  const run = (frontLines) => {
    const { city, roster } = town();
    city.frontLines = frontLines; city.guardWalls = false;
    const t0 = timeAt(DAY + 12 * 3_600_000);
    const walkers = [...roster.people.values()].filter((p) => city.planOf(p, t0).segs.some((s) => s.kind === "go" && s.mode === "walk")).slice(0, 400);
    let samples = 0, inside = 0, deep = 0;
    for (const p of walkers) for (const seg of city.planOf(p, t0).segs) {
      if (seg.kind !== "go" || seg.mode !== "walk" || seg.t0 < 6 * 60 || seg.t1 > 22 * 60) continue;
      for (let m = seg.t0; m < seg.t1; m += 2 / 60) {
        const pos = city.personAt(p, timeAt(DAY + m * 60_000), seg, { x: 400, z: 400 });
        if (!pos || pos.indoors) continue;
        samples += 1;
        const f = city.footprintAt(pos.x, pos.z);
        if (!f || (pos.through && (f.pl.id === seg.from || f.pl.id === seg.to))) continue;
        inside += 1;
        // Along a block, not at a door: well clear of both ends of the walk.
        if (m - seg.t0 > 0.4 && seg.t1 - m > 0.4) deep += 1;
      }
    }
    return { samples, inside, deep, narrowed: city.wallFixes?.narrowed || 0 };
  };
  const fixed = run(false), fitted = run(true);
  tc.diagnostic(`fixed line: ${fixed.inside} of ${fixed.samples} points inside a building (${fixed.deep} along a block); fitted: ${fitted.inside} of ${fitted.samples} (${fitted.deep}); ${fitted.narrowed} stretches brought in`);
  assert.ok(fixed.deep > 500, `the fixed line runs through the fronts built out near the kerb: ${fixed.deep}`);
  assert.ok(fitted.narrowed > 0);
  assert.ok(fitted.deep * 20 < fixed.deep, `along the blocks the fitted line is clear of the fronts: ${fitted.deep} against ${fixed.deep}`);
  assert.ok(fitted.inside * 4 < fixed.inside, `${fitted.inside} against ${fixed.inside}`);
});

test("the line is midway between the kerb and the wall, never past 1.6 m nor off the kerb stone", () => {
  assert.equal(paveOffset(6), 6 + PAVE_M);
  assert.equal(paveOffset(6, 10), 6 + PAVE_M);
  assert.equal(paveOffset(6, 2), 7);
  assert.equal(paveOffset(6, 0.4), 6.2);
  assert.equal(paveOffset(6, 0.1), 6 + PAVE_MIN_M);
  assert.equal(paveOffset(0, 1), 0);
});

test("a door on a party wall is not walked through: the step out is in the street, not next door", () => {
  const { city, roster } = town();
  const pl = [...roster.places.values()].find((q) => q.ring);
  const [[x0, zf], [x1]] = pl.ring;
  // The door put on the wall it shares with the next building along.
  pl.door = { x: x1, z: zf + (pl.ring[2][1] - zf) / 2, nx: -1, nz: 0, from: "front" };
  const a = city.anchor(pl.id, null);
  assert.ok(!city.footprintAt(a.x, a.z), "the step out is outside every building");
  assert.ok(inRing(pl.ring, a.door.x, a.door.z), "and the door is on this building's own wall");
  assert.ok(Math.abs(a.x - (x0 + x1) / 2) < W, "the front, the wall nearest the street");
});

test("riding a bus to the edge of City mode's area: set down at the last stop inside, told why, and the bus goes on", () => {
  const { streets } = town();
  // A line the length of 4 Street, out past the area's edge at x = 470 and back (each stop's bus
  // stands just past its corner: Stop 4's at x = 410, Stop 5's at 510).
  const stops = [50, 150, 250, 350, 450, 550, 650, 750].map((x, k) => ({ id: `s${k}`, name: `Stop ${k}`, lon: x, lat: 4 * STEP + 7, routes: ["22"], modes: ["bus"] }));
  const lines = buildLines(R, stops, streets, (lon, lat) => [lon, lat]);
  assert.equal(lines.length, 1);
  const line = lines[0], inArea = (x) => x < 470;
  // Aboard eastbound at the first stop, riding as the page does (view.mjs followRide): each
  // second, where the bus is; set down where boundaryStop says.
  const sec0 = DAY / 1000 + 9 * 3600;
  let bus = null, t = sec0;
  for (; t < sec0 + line.cycle; t += 1) {
    bus = busesAt(lines, t * 1000).find((b) => b.dwelling && b.stop === 0);
    if (bus) break;
  }
  assert.ok(bus, "a bus stands at the first stop");
  const id = bus.id;
  let off = null, rode = 0, maxX = -Infinity;
  for (let s = t; s < t + line.cycle; s += 1) {
    const b = busesAt(lines, s * 1000).find((q) => q.id === id);
    maxX = Math.max(maxX, b.x); rode += 1;
    const edge = boundaryStop(line, b, inArea);
    if (edge) { off = { ...edge, s, bus: b }; break; }
  }
  assert.ok(off, "set down before the bus left the area");
  assert.equal(off.message, BOUNDARY_MESSAGE);
  assert.match(BOUNDARY_MESSAGE, /^World boundary reached\. To keep exploring, switch modes/);
  assert.match(BOUNDARY_MESSAGE, /Explore/);
  assert.ok(off.here && off.bus.dwelling, "at a stop the bus stands at");
  assert.equal(line.stops[off.stop].name, "Stop 4", "the last stop inside the area");
  assert.ok(inArea(off.pole.x) && maxX < 470, "never carried past the edge");
  // The bus goes on along its route without you: out past the edge, the same bus.
  let beyond = false;
  for (let s = off.s; s < off.s + 600 && !beyond; s += 5) { const b = busesAt(lines, s * 1000).find((q) => q.id === id); if (b && b.x > 480) beyond = true; }
  assert.ok(beyond, "the bus carries on out of the area");
  // Already outside (put on a bus out there): back to the last stop inside it.
  const out = { dwelling: false, x: 600, z: 407, next: 6 };
  const back = boundaryStop(line, out, inArea);
  assert.ok(back && !back.here && inArea(back.pole.x), JSON.stringify(back));
  // A ride that stays inside is left alone.
  assert.equal(boundaryStop(line, { dwelling: true, stop: 1, next: 2, x: 150, z: 407 }, inArea), null);
});

test("Muni's real routes are not cut short for the edge (muni-routes.json is left whole)", () => {
  const json = JSON.parse(readFileSync(new URL("../docs/city/muni-routes.json", import.meta.url)));
  assert.ok(json.lines.length > 0);
  assert.ok(json.lines.every((l) => l.stops.length === l.minutes.length && l.stops.length >= 2));
});
