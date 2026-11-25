// A kerb island (module 16, islandRingOffRoadway) is drawn only off the roadway the page draws:
// where the survey's island and the page's streets disagree, white concrete lay across lanes the
// cars drove through -- Fillmore's median nose in the Chestnut crossroads at the bus stop
// (2026-11-21). Run from the page's own source on a made-up street.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const M16 = readFileSync(new URL("../src/smc/renderer/page/module/16-the-rest-of-the-roadway.js", import.meta.url), "utf8");
const M09 = readFileSync(new URL("../src/smc/renderer/page/module/09-where-openstreetmap-says-there-is.js", import.meta.url), "utf8");
const slice = (src, from, to) => src.slice(src.indexOf(from), src.indexOf(to, src.indexOf(from)));
const pip = slice(M09, "function pointInRing(", "\n}\n") + "\n}\n";
const body = slice(M16, "const ISLAND_TRIM_STEP_M", "function addClosedOfficialIslandSurfaces");
// The roadway: a street along x, z in [-5, 5]; no junction boxes.
const make = new Function(`
  const insideCarriageway = (x, z) => Math.abs(z) <= 5;
  const insideJunctionBox = () => false;
  ${pip}
  ${body}
  return { islandRingOffRoadway, islandStats };`);
const box = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
const area = (r) => Math.abs(r.reduce((a, [x, z], i) => { const [u, w] = r[(i + 1) % r.length]; return a + x * w - u * z; }, 0)) / 2;

test("an island off the roadway is kept as it is", () => {
  const { islandRingOffRoadway, islandStats } = make();
  const ring = box(0, 8, 20, 10);
  assert.equal(islandRingOffRoadway(ring), ring);
  assert.equal(islandStats.kept, 1);
});

test("an island mostly on the roadway is not drawn", () => {
  const { islandRingOffRoadway, islandStats } = make();
  // A long thin strip down the middle of a lane (the 27 cm "island" near Lombard).
  assert.equal(islandRingOffRoadway(box(0, -0.15, 119, 0.12)), null);
  // A median whose nose and half its length lie on the street.
  assert.equal(islandRingOffRoadway(box(0, 0, 4, 12)), null);
  assert.equal(islandStats.dropped, 2);
});

test("an island partly on the roadway loses the part that is", () => {
  const { islandRingOffRoadway, islandStats } = make();
  // A median running up a side street with its nose 2 m into the crossroads (z < 5).
  const ring = box(-1, 3, 1, 40);
  const kept = islandRingOffRoadway(ring);
  assert.ok(kept, "kept");
  assert.equal(islandStats.trimmed, 1);
  assert.ok(kept.every(([, z]) => z > 5), "nothing left on the street");
  assert.ok(area(kept) > area(ring) * 0.9 && area(kept) < area(ring), `area ${area(kept).toFixed(1)} of ${area(ring)}`);
});

test("a sliver left after the trim is not drawn", () => {
  const { islandRingOffRoadway } = make();
  assert.equal(islandRingOffRoadway(box(0, 0, 2, 5.4)), null);
});

test("every island the page lays goes through the trim", () => {
  assert.match(M16, /\.map\(\(ring\) => \(ring \? islandRingOffRoadway\(ring\) : null\)\)/);
});

test("a median down the street it divides is kept, cut only out of the junction box", () => {
  // The street along x (z in [-5, 5]) with a junction box for x < 10; a median 2 m wide down its
  // middle from x = 4 to x = 60: kept, its nose out of the box (2026-11-25, Fillmore between
  // Chestnut and Bay: it had been dropped, leaving its crossings' paint unconnected).
  const withAxis = new Function(`
    const insideCarriageway = (x, z) => Math.abs(z) <= 5;
    const insideJunctionBox = (x) => x < 10;
    const nearestCarriagewaySegment = () => [0, 0, 100, 0];
    ${pip}
    ${body}
    return { islandRingOffRoadway, islandStats };`);
  const { islandRingOffRoadway, islandStats } = withAxis();
  const kept = islandRingOffRoadway(box(4, -1, 60, 1));
  assert.ok(kept, "the median is drawn");
  assert.equal(islandStats.medians, 1);
  assert.ok(kept.every(([x]) => x >= 10), "nothing left in the junction box");
  // Across the street it is no median: still not drawn.
  assert.equal(islandRingOffRoadway(box(20, -5, 24, 7)), null);
});

test("an island a crossing lands on keeps the part under the crossing's end", () => {
  // A refuge on the street's edge (z 3..8, its road part z <= 5) with a crossing coming up x = 10
  // that ends on it at z = 4 (2026-11-25: Bay and Fillmore's ramps stood on bare road beside a
  // trimmed refuge).
  const withCrossing = new Function(`
    const insideCarriageway = (x, z) => Math.abs(z) <= 5;
    const insideJunctionBox = () => false;
    const CROSSING_DEDUPE_CELL_M = 4;
    const crossingDrawGrid = new Map([["2:-3", [{ x: 10, z: -6, bearing: Math.PI / 2, length: 20, width: 3 }]]]);
    ${pip}
    ${body}
    return { islandRingOffRoadway, islandCrossingLanding };`)();
  assert.equal(withCrossing.islandCrossingLanding(10, 4), true);
  assert.equal(withCrossing.islandCrossingLanding(20, 4), false);
  const kept = withCrossing.islandRingOffRoadway(box(0, 3, 20, 8));
  assert.ok(kept, "kept");
  assert.ok(kept.some(([x, z]) => z < 5 && Math.abs(x - 10) < 2), "the landing stays");
  assert.ok(!kept.some(([x, z]) => z < 5 && Math.abs(x - 10) > 3), "the rest of the road part is cut");
});
