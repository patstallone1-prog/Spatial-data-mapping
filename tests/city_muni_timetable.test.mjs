// Muni through the district as the timetable runs it (docs/city/muni-routes.json from
// scripts/build_muni_routes.py; docs/city/transit.mjs): each route and direction one way along
// its own stops, a bus for each trip leaving the first stop at its minute, as often as the
// timetable says at that hour of that day, and its number and destination on its sign.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { loadRules } from "../docs/city/core.mjs";
import { Streets } from "../docs/city/people.mjs";
import { arrivalsAt, buildLines, busPhases, busesAt, serviceDay } from "../docs/city/transit.mjs";
import { BUS_SIGN, drawBusSign } from "../docs/city/vehicles.mjs";

const ROOT = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");
const R = loadRules(JSON.parse(read("docs/city/rules.json")));
const MUNI = JSON.parse(read("docs/city/muni-routes.json"));
const TUESDAY = Date.UTC(2026, 9, 6, 7, 0) / 1000;   // midnight in San Francisco (PDT), a Tuesday
const SUNDAY = TUESDAY - 2 * 86400;
const N = 18, STEP = 100;

//: A grid of streets, a stop every 300 m along 9 Street (x as lon, z as lat).
function town() {
  const ways = [];
  for (let i = 0; i <= N; i += 1) {
    const along = Array.from({ length: N + 1 }, (_, j) => j * STEP);
    ways.push({ kind: "street", pts: along.map((v) => [i * STEP, v]), lanes: 2, oneway: 0, id: `v${i}`, name: `${i} Avenue`, road_m: 10 });
    ways.push({ kind: "street", pts: along.map((v) => [v, i * STEP]), lanes: 2, oneway: 0, id: `h${i}`, name: `${i} Street`, road_m: 10 });
  }
  return new Streets(ways);
}
const XS = [0, 300, 600, 900, 1200, 1500];
const every = (from, to, step) => Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, k) => from + k * step);
const TIMETABLE = {
  zone: "America/Los_Angeles",
  lines: [{
    route: "22", name: "Fillmore", direction: 1, headsign: "Bay Street", colour: null,
    stops: XS.map((x, k) => ({ id: `s${k}`, name: `Stop ${k}`, lon: x + 30, lat: 9 * STEP + 6 })),
    minutes: [0, 1.5, 3, 4.5, 6, 7.5],
    departs: { weekday: every(600, 660, 6), saturday: every(600, 660, 12), sunday: [] },
  }],
};
const STOPS = [
  ...XS.map((x, k) => ({ id: `s${k}`, name: `Stop ${k}`, lon: x + 30, lat: 9 * STEP + 6, routes: ["22"], modes: ["bus"] })),
  ...[0, 300, 600, 900].map((z, k) => ({ id: `t${k}`, name: `Avenue stop ${k}`, lon: 3 * STEP + 6, lat: z + 30, routes: ["28"], modes: ["bus"] })),
];
const lines = buildLines(R, STOPS, town(), (lon, lat) => [lon, lat], TIMETABLE);
const timed = lines.find((l) => l.schedule);

test("a timetabled route runs one way along its own stops; one without a timetable out and back", () => {
  assert.deepEqual(lines.map((l) => [l.route, Boolean(l.schedule)]).sort(), [["22", true], ["28", false]]);
  assert.equal(timed.stops.length, XS.length);
  assert.deepEqual(timed.stops.map((s) => s.name), XS.map((_, k) => `Stop ${k}`));
  const dwells = timed.timeline.filter((s) => s.kind === "dwell").map((s) => s.stop);
  assert.deepEqual(dwells, XS.map((_, k) => k), "each stop once, in the timetable's order: no way back");
  assert.deepEqual(timed.sign, { route: "22", name: "Fillmore", to: "Bay Street" });
});

test("a bus for each trip, leaving the first stop at its minute, and none when none is timetabled", () => {
  const Z = timed.schedule.zone;
  assert.equal(serviceDay(TUESDAY + 3600 * 13, Z).start, TUESDAY);
  assert.equal(serviceDay(TUESDAY + 3600 * 13, Z).weekday, 2);
  assert.equal(busPhases(timed, TUESDAY + 9 * 3600).length, 0, "before the first trip");
  // At 10:00 the first trip leaves its first stop: it has stood there the dwell before.
  const out = busesAt([timed], (TUESDAY + 600 * 60 - 5) * 1000);
  assert.equal(out.length, 1);
  assert.ok(out[0].dwelling && out[0].stop === 0 && out[0].leaves > 4 && out[0].leaves < 6);
  assert.deepEqual(out[0].sign, timed.sign);
  // Every six minutes on a weekday: at 10:19, the 10:12 and 10:18 are on the road (7.5 min to the end).
  assert.equal(busPhases(timed, TUESDAY + 619 * 60).length, 2);
  // Every twelve on a Saturday; none on a Sunday.
  assert.equal(busPhases(timed, TUESDAY + 4 * 86400 + 619 * 60).length, 1);
  assert.equal(busPhases(timed, SUNDAY + 620 * 60).length, 0);
  // After the last trip has run, nothing.
  assert.equal(busPhases(timed, TUESDAY + 680 * 60).length, 0);
});

test("it takes the timetable's time from the first stop to the last, and is at each stop when it says", () => {
  const first = timed.timeline[0], last = timed.timeline[timed.timeline.length - 1];
  const run = last.t0 - first.t1;
  assert.ok(Math.abs(run - 7.5 * 60) < 2, `run ${run} s`);
  const t = TUESDAY + 615 * 60;
  for (const seg of timed.timeline.filter((s) => s.kind === "dwell")) {
    const [next] = arrivalsAt(timed, seg, t, 1);
    assert.ok(next && next.at + (seg.t1 - seg.t0) > t);
    const there = busesAt([timed], (next.at + 1) * 1000).find((b) => b.id === next.id);
    assert.ok(there?.dwelling && there.stop === seg.stop, `stop ${seg.stop}`);
  }
  // At the end of the line: nothing next.
  const end = arrivalsAt(timed, last, t, 1)[0];
  assert.equal(busesAt([timed], (end.at + 1) * 1000).find((b) => b.id === end.id).next, null);
});

test("the timetable is Muni's, through the Marina: the 22 every few minutes at noon, the owl at night only", () => {
  assert.match(MUNI.basis, /GTFS/);
  const routes = new Set(MUNI.lines.filter((l) => l.agency === "sfmta").map((l) => l.route));
  for (const r of ["22", "28", "30", "43", "91", "30X"]) assert.ok(routes.has(r), r);
  // Golden Gate's commuter buses along Lombard run their own few trips, and their signs say the
  // town ("Novato"), not the feed's "Route 101 Northbound - Novato".
  const ggt = MUNI.lines.filter((l) => l.agency === "goldengate");
  assert.ok(ggt.some((l) => l.route === "101"));
  for (const l of ggt) assert.doesNotMatch(l.headsign, /^Route /);
  for (const l of MUNI.lines) {
    assert.ok(l.stops.length >= 3 && l.headsign && l.name, `${l.route} ${l.headsign}`);
    assert.equal(l.minutes.length, l.stops.length);
    for (let k = 1; k < l.minutes.length; k += 1) assert.ok(l.minutes[k] >= l.minutes[k - 1]);
    for (const day of ["weekday", "saturday", "sunday"]) assert.ok(Array.isArray(l.departs[day]));
  }
  const bay = MUNI.lines.find((l) => l.route === "22" && l.headsign === "Bay Street");
  assert.equal(bay.stops[bay.stops.length - 1].name, "Fillmore St & Bay St");
  const noon = bay.departs.weekday.filter((m) => m >= 720 && m < 780).length;
  assert.ok(noon >= 7 && noon <= 12, `${noon} an hour`);
  assert.ok(bay.departs.weekday.filter((m) => m >= 180 && m < 240).length < noon / 2, "fewer in the small hours");
  for (const owl of MUNI.lines.filter((l) => l.route === "91")) {
    assert.ok(owl.departs.weekday.every((m) => m % 1440 < 420 || m % 1440 >= 1320), "the owl runs at night");
  }
  for (const x of MUNI.lines.filter((l) => l.route === "30X")) assert.deepEqual([x.departs.saturday, x.departs.sunday], [[], []]);
});

test("the sign shows the route's number, its name and where it is going, each fitted to the sign", () => {
  const calls = [];
  let px = 0;
  const g = {
    set font(f) { px = +f.match(/(\d+)px/)[1]; }, get font() { return `${px}px`; },
    fillRect() {}, fillText(text, x, y) { calls.push({ text, x, y, px }); }, measureText: (text) => ({ width: text.length * px * 0.55 }),
  };
  const out = drawBusSign(g, { route: "22", name: "Fillmore", to: "UCSF Mission Bay" }, 512, 80);
  assert.deepEqual(calls.map((c) => c.text), ["22", "Fillmore", "to UCSF Mission Bay"]);
  for (const c of calls) assert.ok(c.x + c.text.length * c.px * 0.55 <= 512 + 0.5, c.text);
  assert.ok(calls[0].px > calls[2].px, "the number largest");
  assert.deepEqual(out, { number: "22", name: "Fillmore", to: "to UCSF Mission Bay" });
  assert.ok(BUS_SIGN.y > 2.5 && BUS_SIGN.y < 3.1 && BUS_SIGN.z < -5.5);
});

test("the page loads the timetable and puts each bus's sign on it", () => {
  const view = read("docs/city/view.mjs");
  assert.match(view, /ctx\.asset\("city\/muni-routes\.json"\)/);
  assert.match(view, /buildLines\(R, near, district\.streets, \(lon, lat\) => ctx\.fromLonLat\(lon, lat\), timetable\)/);
  assert.match(view, /if \(f && v\.sign && f\.n < f\.cap\)/);
  assert.match(view, /drawBusSign\(canvas\.getContext\("2d"\)/);
  assert.match(read("docs/city/fleet.mjs"), /arrivalsAt\(line, leg\.at, atStop \+ 6, 1\)/);
});
