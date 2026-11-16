// The game's clock (docs/city/clock.mjs): 48 real minutes of daylight, 24 of night, the sun on
// its real path for the game's date; one function of real time, invertible.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { loadRules, cityTime } from "../docs/city/core.mjs";
import { CLOCK_SPEC, clockOf, fleetTime, makeClock, sunTimes } from "../docs/city/clock.mjs";

const R = loadRules(JSON.parse(readFileSync(new URL("../docs/city/rules.json", import.meta.url))));
const C = clockOf(R), MIN = 60_000;

test("San Francisco's sunrise and sunset are where the almanac has them", () => {
  // 2026-06-21: about 05:48 and 20:35 PDT; 2026-12-21: about 07:22 and 16:55 PST.
  const hhmm = (ms) => { const t = cityTime(ms); return t.minute; };
  const j = sunTimes(Date.UTC(2026, 5, 21, 19), 37.77, -122.42), d = sunTimes(Date.UTC(2026, 11, 21, 20), 37.77, -122.42);
  assert.ok(Math.abs(hhmm(j.rise) - (5 * 60 + 48)) < 4 && Math.abs(hhmm(j.set) - (20 * 60 + 35)) < 4, "June");
  assert.ok(Math.abs(hhmm(d.rise) - (7 * 60 + 22)) < 4 && Math.abs(hhmm(d.set) - (16 * 60 + 55)) < 4, "December");
});

test("a game day is 72 real minutes: 48 from sunrise to sunset, 24 of night", () => {
  for (const start of [C.epoch, C.epoch + 5 * C.cycle, C.epoch + 200 * C.cycle, C.epoch - 3 * C.cycle]) {
    const k = Math.round((start - C.epoch) / C.cycle), s = C.sun(k), s1 = C.sun(k + 1);
    assert.ok(Math.abs(C.game(start) - s.rise) < 1, "the cycle starts at sunrise");
    assert.ok(Math.abs(C.game(start + 48 * MIN) - s.set) < 1, "sunset 48 minutes in");
    assert.ok(Math.abs(C.game(start + 72 * MIN) - s1.rise) < 1, "the next sunrise 24 minutes later");
    assert.ok(C.rate(start + MIN) > 8 && C.rate(start + MIN) < 22, `by day ${C.rate(start + MIN).toFixed(1)}x`);
    assert.ok(C.rate(start + 60 * MIN) > 20 && C.rate(start + 60 * MIN) < 50, `by night ${C.rate(start + 60 * MIN).toFixed(1)}x`);
  }
  // A year of game days goes by in about eighteen real days, the seasons with it.
  const june = C.game(C.epoch + 219 * C.cycle);
  assert.equal(cityTime(june).month, 6);
});

test("real and game time convert both ways, and only forward", () => {
  let last = -Infinity;
  for (let r = C.epoch - 2 * C.cycle; r < C.epoch + 30 * C.cycle; r += 7.3 * MIN) {
    const g = C.game(r);
    assert.ok(g > last, "the clock never runs back");
    last = g;
    assert.ok(Math.abs(C.real(g) - r) < 2, "real(game(r)) = r");
  }
  // A ride of ten real minutes, on the game's clock, from noon.
  const noon = C.sun(3).noon, after = C.after(noon, 10 * MIN);
  assert.ok(Math.abs(C.real(after) - C.real(noon) - 10 * MIN) < 2);
  assert.ok((after - noon) / MIN > 80 && (after - noon) / MIN < 220, `${((after - noon) / MIN).toFixed(0)} game minutes`);
});

test("the fleet's day is measured in real minutes, with the planned times carried across", () => {
  const r = C.epoch + 10 * C.cycle + 30 * MIN, t = fleetTime(C, r, R.clock.zone);
  assert.equal(t.ms, r);
  assert.ok(Math.abs(t.toFleet(t.gameMinute) - t.minute) < 1e-6, "now is now in both");
  assert.ok(Math.abs(t.toGame(t.minute) - t.gameMinute) < 1e-6);
  assert.ok(t.minute >= 0 && t.minute < 75, `${t.minute.toFixed(1)} real minutes into the game day`);
  const whole = t.toFleet(1440) - t.toFleet(0);
  assert.ok(Math.abs(whole - 72) < 0.5, `a whole game day is ${whole.toFixed(2)} real minutes`);
  // A same clock from the same rules in another browser: the same time.
  assert.equal(makeClock(R.clock).game(r), C.game(r));
});

test("the NPCs' days run by the game's hours and their journeys at real speed", async () => {
  const { City, Roster, tripMinutes } = await import("../docs/city/fleet.mjs");
  const { Streets, placeFromBuilding } = await import("../docs/city/people.mjs");
  const N = 12, STEP = 100, ways = [], places = [];
  for (let i = 0; i <= N; i += 1) {
    const along = Array.from({ length: N + 1 }, (_, j) => j * STEP);
    ways.push({ kind: "street", pts: along.map((v) => [i * STEP, v]), lanes: 2, oneway: 0, id: `v${i}`, name: `${i} Avenue`, road_m: 10 });
    ways.push({ kind: "street", pts: along.map((v) => [v, i * STEP]), lanes: 2, oneway: 0, id: `h${i}`, name: `${i} Street`, road_m: 10 });
  }
  const streets = new Streets(ways);
  for (let i = 0; i < N; i += 1) for (let j = 0; j < N; j += 1) {
    const k = i * N + j, kind = k % 7 === 0 ? "cafe" : k % 11 === 0 ? "office" : k % 13 === 0 ? "supermarket" : null;
    const b = { id: `b${k}`, x: i * STEP + STEP / 2, z: j * STEP + STEP / 2, archetype: kind === "office" ? "office" : "residential", floors: 3, area: 300,
      shops: kind && kind !== "office" ? [{ t: kind, n: "Corner" }] : [], name: `${k} Test Street`, tag: k % 3 ? "apartments" : "house" };
    const pl = placeFromBuilding(b, streets, R);
    if (pl) places.push(pl);
  }
  const roster = new Roster(R, { seed: "clock" });
  roster.add(places);
  const fleetAt = (ms) => fleetTime(C, ms, R.clock.zone);
  const city = new City(R, roster, streets, { seed: "clock", timeAt: fleetAt });
  // Real time at the game's noon on a weekday.
  let k = 3; while (cityTime(C.sun(k).noon).weekday % 6 === 0) k += 1;
  const t = fleetAt(C.real(C.sun(k).noon));
  let walks = 0, ontime = 0, workers = 0;
  for (const p of roster.people.values()) {
    const plan = city.planOf(p, t);
    for (const s of plan.segs) {
      if (s.kind === "go" && s.mode === "walk" && s.from && s.to) {
        const A = roster.places.get(s.from), B = roster.places.get(s.to);
        if (!A || !B) continue;
        walks += 1;
        // At least as long as it really takes on foot (a few seconds' rounding aside).
        assert.ok(s.t1 - s.t0 >= tripMinutes(Math.hypot(A.x - B.x, A.z - B.z), p.pace) - 1e-6, `${p.id} walks at real speed`);
      }
      if (s.kind === "stay" && s.act?.kind === "work" && s.act.gameStart > 300 && s.act.gameStart < 1200) {
        workers += 1;
        if (t.toGame(s.t0) <= s.act.gameStart + 60) ontime += 1;
      }
    }
  }
  assert.ok(walks > 50, `${walks} walks`);
  assert.ok(workers > 20 && ontime / workers > 0.8, `${ontime} of ${workers} at work within an hour of the shift's start`);
  // The day fits the 72 minutes: nothing planned past the next game midnight but a night shift.
  const end = t.toFleet(1440);
  assert.ok(end > 70 && end < 75);
});

test("the sky's clock and the city's are one clock", () => {
  for (const [k, v] of Object.entries(CLOCK_SPEC)) assert.equal(R.clock[k], v, k);
});
