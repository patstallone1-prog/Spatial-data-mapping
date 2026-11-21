// Who is drawn as an Unreal character (docs/city/npc-figures.mjs figurePlan): everyone in view big
// enough on the screen to be told from a jointed figure, or near you, however many -- and, ahead
// of time and out of sight, everyone on their way into that, so a person walking up is already a
// character when they arrive. Only those further off than a character shows are lower-detail
// figures. Run here on a crowd the fleet itself moves, past a camera that turns.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { loadRules } from "../docs/city/core.mjs";
import { clockOf, fleetTime } from "../docs/city/clock.mjs";
import { City, Roster } from "../docs/city/fleet.mjs";
import { Streets, hash32, placeFromBuilding } from "../docs/city/people.mjs";
import { FIGURE_MIN_PX, FIGURE_NEAR_YOU_M, FIGURE_PREP_S, NEAR_FIGURES_MAX, figurePlan, figureReach } from "../docs/city/npc-figures.mjs";

const R = loadRules(JSON.parse(readFileSync(new URL("../docs/city/rules.json", import.meta.url))));
const clock = clockOf(R);

function town(n = 8, step = 90) {
  const ways = [];
  for (let i = 0; i <= n; i += 1) {
    const along = Array.from({ length: n + 1 }, (_, j) => j * step);
    ways.push({ kind: "street", pts: along.map((v) => [i * step, v]), lanes: 2, oneway: 0, id: `v${i}`, name: `${i} Avenue` });
    ways.push({ kind: "street", pts: along.map((v) => [v, i * step]), lanes: 2, oneway: 0, id: `h${i}`, name: `${i} Street` });
  }
  const streets = new Streets(ways), places = [];
  for (let i = 0; i < n; i += 1) for (let j = 0; j < n; j += 1) {
    const k = i * n + j, kind = k % 5 === 0 ? "cafe" : k % 7 === 0 ? "supermarket" : null;
    const b = { id: `b${k}`, x: i * step + step / 2, z: j * step + step / 2, archetype: "residential", floors: 4, area: 600,
      shops: kind ? [{ t: kind, n: kind === "cafe" ? "Blue Cup" : "Corner Market" }] : [], name: `${100 + k} Test Street`, tag: "apartments" };
    const pl = placeFromBuilding(b, streets, R);
    if (pl) places.push(pl);
  }
  return { streets, places };
}
function msAt(hour) {
  for (let ms = Date.UTC(2026, 10, 20, 12), k = 0; k < 6000; k += 1, ms += 30_000) {
    const t = fleetTime(clock, ms);
    if (t.weekday >= 1 && t.weekday <= 5 && Math.abs(t.gameMinute - hour * 60) < 2) return ms;
  }
  throw new Error(`no moment for ${hour}:00`);
}

test("a character is anyone tall enough on the screen to be told apart, or near you", () => {
  const reach = figureReach(50, 1080);
  assert.ok(reach > 70 && reach < 85, `${reach.toFixed(1)} m on a 1080-pixel screen`);
  assert.ok(figureReach(50, 700) < reach, "a smaller screen shows them smaller");
  // A person at the reach is FIGURE_MIN_PX tall.
  const px = (1.75 / reach) / (2 * Math.tan(25 * Math.PI / 180)) * 1080;
  assert.ok(Math.abs(px - FIGURE_MIN_PX) < 1e-9);
  assert.ok(NEAR_FIGURES_MAX >= 48, "no longer the nearest twenty");
  assert.ok(FIGURE_NEAR_YOU_M >= 20 && FIGURE_PREP_S >= 3);
  // However many there are near you, every one of them (up to the most).
  const crowd = Array.from({ length: 40 }, (_, i) => ({ id: `p${i}`, x: i * 0.7, z: 3, vx: 0, vz: 0, fits: true, inView: true, female: i % 2 === 0 }));
  const plan = figurePlan(crowd, { x: 0, z: 0 }, { x: 0, z: 0 }, reach);
  assert.equal(plan.draw.length, 40); assert.equal(plan.spilled, 0);
  assert.deepEqual(plan.want, { ada: 20, manny: 20 });
  // Out of view but within it: held, hidden, for when you turn round.
  const behind = figurePlan([{ id: "b", x: -5, z: 0, vx: 0, vz: 0, fits: true, inView: false }], { x: 0, z: 0 }, { x: 0, z: 0 }, reach);
  assert.equal(behind.ready.length, 1);
  // Walking in from further off: readied while still out of it.
  const coming = figurePlan([{ id: "c", x: reach + 6, z: 0, vx: -1.4, vz: 0, fits: true, inView: true }], { x: 0, z: 0 }, { x: 0, z: 0 }, reach);
  assert.equal(coming.ready.length, 1); assert.equal(coming.draw.length, 0);
  const leaving = figurePlan([{ id: "c", x: reach + 15, z: 0, vx: 1.4, vz: 0, fits: true, inView: true }], { x: 0, z: 0 }, { x: 0, z: 0 }, reach);
  assert.equal(leaving.ready.length, 0, "walking away: not held");
});

test("on the fleet's own crowd, past a camera turning round, everyone who walks into view big enough is a character already given one", () => {
  // (Every walk seen, and the visitors all through: a crowd thicker than the Marina's, to load it.)
  const RX = { ...R, density: { ...R.density, walks_seen: 1 } };
  const { streets, places } = town(), roster = new Roster(RX, { seed: "figures" });
  roster.add(places);
  roster.visitorsUpTo(1500);
  const city = new City(RX, roster, streets, { seed: "figures", timeAt: (ms) => fleetTime(clock, ms) });
  city.through = 1;
  const you = { x: 360, z: 360 }, eye = 1.62, reach = figureReach(50, 900);
  const ms0 = msAt(17.5);
  const scan = city.scan(ms0, you, 400);
  const half = Math.atan(Math.tan(25 * Math.PI / 180) * 16 / 9);
  let held = new Set(), lastIn = new Set(), missed = [], drawnMost = 0, inViewChecked = 0, frames = 0;
  for (let f = 0; f < 240; f += 1) {
    const ms = ms0 + f * 250, t = city.timeAt(ms);
    const yaw = f * 0.25 * (Math.PI / 6);                   // turning 30 degrees a second
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const list = [];
    for (const { p, seg } of scan.people) {
      const pos = city.personAt(p, t, undefined);
      if (!pos || pos.indoors) continue;
      const dx = pos.x - you.x, dz = pos.z - you.z, d = Math.hypot(dx, dz);
      const ang = Math.acos(Math.max(-1, Math.min(1, (dx * fx + dz * fz) / Math.max(1e-6, d))));
      const v = pos.moving ? (p.pace || 1.3) : 0;
      list.push({ id: p.id, x: pos.x, z: pos.z, vx: -Math.sin(pos.yaw || 0) * v, vz: -Math.cos(pos.yaw || 0) * v, fits: !pos.down, inView: d > 0.5 && ang < half && Math.atan2(eye, d) < 0.9, female: hash32(p.id) % 2 === 0 });
    }
    const plan = figurePlan(list, you, you, reach, { has: (id) => held.has(id) });
    frames += 1;
    drawnMost = Math.max(drawnMost, plan.draw.length);
    assert.equal(plan.spilled, 0, "nobody left a jointed figure for want of characters");
    // Everyone in view within reach is drawn as a character.
    const drawn = new Set(plan.draw.map((q) => q.id));
    for (const q of list) if (q.fits && q.inView && Math.hypot(q.x - you.x, q.z - you.z) <= reach) { inViewChecked += 1; assert.ok(drawn.has(q.id), `${q.id} in view ${Math.hypot(q.x - you.x, q.z - you.z).toFixed(0)} m off, not a character`); }
    // Each one newly drawn had a character held for them the frame before -- unless they were not
    // out of doors to be seen then (stepping out of a door).
    if (f > 0) for (const q of plan.draw) if (!held.has(q.id) && lastIn.has(q.id)) missed.push(q.id);
    held = new Set([...plan.draw, ...plan.ready].map((q) => q.id));
    lastIn = new Set(list.map((q) => q.id));
  }
  assert.ok(inViewChecked > 200, `${inViewChecked} people in view checked over ${frames} frames`);
  assert.ok(drawnMost > 3, `as many as ${drawnMost} drawn at once`);
  assert.deepEqual(missed, [], `${missed.length} walked or turned into view without a character held for them`);
});
