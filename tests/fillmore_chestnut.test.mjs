// Fillmore & Chestnut, 2026-11-26 (docs/73): the Muni stop flag read from the sign inventory, the
// survey's islands ahead of the inferred median, the median-edge line, angled stalls in a strip
// lot, and the plain rooms' paint. Run from the page's own source.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (name) => readFileSync(new URL(`../src/smc/renderer/page/module/${name}`, import.meta.url), "utf8");
const M07 = read("07-materials.js");
const M09 = read("09-where-openstreetmap-says-there-is.js");
const M14 = read("14-public-stairways.js");
const M15 = read("15-interchanges-every-deck-s-height.js");
const M16 = read("16-the-rest-of-the-roadway.js");
const M20 = read("20-station-entrances-a-stair-down.js");
const M25 = read("25-one-physical-visual-shell-shared.js");
const slice = (src, from, to) => {
  const i = src.indexOf(from);
  assert.ok(i >= 0, `missing ${from}`);
  return src.slice(i, src.indexOf(to, i));
};
const fn = (src, name) => slice(src, `function ${name}(`, "\n}\n") + "\n}\n";

test("the inventory's Muni flags are the stop's flag, not a guide plate with the record's words", () => {
  const make = new Function(`${slice(M20, "//: The inventory's names for the Muni stop flag itself.", "//: The stop flags drawn")}
    ${fn(M20, "plateStyleFor")} return plateStyleFor;`);
  const style = make();
  const sign = (label, category = "OTHER GUIDE", klass = "GUIDE") => ({ label, tags: { SIGN_CATEGORY: category, SIGN_CLASS: klass } });
  for (const label of ["MUNI LOCAL (FLAG) BLUE", "MUNI LANDOR FLAG - TYPE 6", "MUNI LOCAL (FLAG) T- LINE", "MUNI (E) EMBARCADERO", "MUNI SOLAR LANDOR SIGN"]) {
    assert.equal(style(sign(label)), "muni_flag", label);
  }
  // Signs that only mention Muni are what they were.
  assert.equal(style(sign("EXC MUNI", "OTHER REGULATORY", "REG")), "regulatory");
  assert.equal(style(sign("DO NOT ENTER EXC MUNI & GGT", "OTHER REGULATORY", "REG")), "do_not_enter");
  // The island nose's double arrow is the W12-1 symbol, not the record's shorthand.
  assert.equal(style(sign("DOUBLE ARROW-LEFT & RIGHT (SYM)", "OTHER WARNING", "WARNING")), "keep_either");
  assert.equal(style(sign("(45 LA-DN/45 RA-DN) (SYM)", "OTHER WARNING", "WARNING")), "keep_either");
});

test("a plate on a signal's pole stands off the pole's face, not through it", () => {
  assert.match(M20, /const SIGNAL_POLE_R_M = 0\.075;/);
  assert.match(M20, /post\.signal \? SIGNAL_POLE_R_M \+ PLATE_STANDOFF_M : PLATE_STANDOFF_M/);
  assert.match(M20, /addFurniturePostsAt\(rows\.map\(\(r\) => r\.anchor\), 4\.65, SIGNAL_POLE_R_M, 0x4b5051\)/);
});

// The survey's islands (module 15), on a made-up ring: x along the street, a strip 1.8 m wide.
const islands = (records) => new Function("ORTHO_ISLANDS", `
  const xy = (lon, lat) => [lon, lat], window = {};
  ${fn(M09, "pointInRing")}
  ${slice(M15, "const CONFIRMED_SURVEY_ISLAND_LINES", "const DRAW_ORDER")}
  return { surveyedIslandKept, surveyedIslandAt, surveyedIslandAcross, clearOfSurveyedIslands, medianSurveyStats, SURVEYED_ISLANDS };`)(
  { schema: "kerbside.islands/1", islands: records });
// (z is -y: the ring's y is north; this strip is at y 10..11.8, so z -11.8..-10.)
const strip = { basis: "survey_aerial_confirmed", lines: [1], p: [[0, 10], [40, 10], [40, 11.8], [0, 11.8]] };

test("an island confirmed from a photograph is kept with the aerial ones", () => {
  const { surveyedIslandKept } = islands([]);
  assert.equal(surveyedIslandKept({ basis: "survey_unconfirmed", lines: [4137] }), true);
  assert.equal(surveyedIslandKept({ basis: "survey_unconfirmed", lines: [12] }), false);
  assert.equal(surveyedIslandKept({ basis: "survey_unconfirmed", closed_in_survey: true, lines: [12] }), true);
  assert.equal(surveyedIslandKept({ basis: "survey_aerial_confirmed", lines: [12] }), true);
  const { SURVEYED_ISLANDS } = islands([strip, { basis: "survey_unconfirmed", lines: [7], p: strip.p }]);
  assert.equal(SURVEYED_ISLANDS.length, 1);
});

test("a gap with a surveyed island across it is the survey's island, not an inferred median", () => {
  const { surveyedIslandAcross, surveyedIslandAt } = islands([strip]);
  assert.equal(surveyedIslandAt(20, -11), true);
  assert.equal(surveyedIslandAt(20, -9), false);
  // From one half's inner edge (z -6) across the gap to the other's (z -16): the strip is in it.
  assert.equal(surveyedIslandAcross(20, -6, 20, -16), true);
  // Past its end, no island in the gap.
  assert.equal(surveyedIslandAcross(45, -6, 45, -16), false);
});

test("no median-edge line beside a surveyed island; the line runs on where there is none", () => {
  const { clearOfSurveyedIslands, medianSurveyStats } = islands([strip]);
  // A half running east (+x) at y 6 (z -6): its left is north (+y), where the strip is.
  const line = Array.from({ length: 31 }, (_, i) => [i * 2, 6]);
  const pieces = clearOfSurveyedIslands(line, 9);
  assert.ok(medianSurveyStats.edgeLinesCut > 0);
  for (const piece of pieces) for (const [x] of piece) assert.ok(x >= 40, `painted at x ${x}, beside the island`);
  assert.ok(pieces.some((piece) => piece.length >= 2), "painted past the island's end");
  // Running west it has the island on its right: the line is painted all along.
  assert.equal(clearOfSurveyedIslands(line.slice().reverse(), 9).flat().length, line.length);
});

test("two one-way ways running the same way are not opposing traffic", () => {
  const travelAlong = new Function(`const xy = (lon, lat) => [lon, lat];
    ${fn(M20, "onewaySign")}
    ${fn(read("08-keeping-things-where-they-belong.js"), "distanceToSegmentSquared")}
    ${fn(M16, "travelAlong")}
    return travelAlong;`)();
  const south = (x) => ({ oneway: "yes", points: [[x, 20], [x, -20]] });
  const a = travelAlong(south(0), 0, 0), b = travelAlong(south(4), 4, 0);
  assert.ok(a[0] * b[0] + a[1] * b[1] > 0.99);
  const north = { oneway: "yes", points: [[8, -20], [8, 20]] };
  const c = travelAlong(north, 8, 0);
  assert.ok(a[0] * c[0] + a[1] * c[1] < -0.99);
  assert.equal(travelAlong({ points: [[0, 0], [1, 1]] }, 0, 0), null);
});

test("a strip lot along a one-way lane gets angled stalls leaning with its traffic", () => {
  // The lot: u along x from 0 to 60, v across from z 0 to 5.8 (the lane is at z < 0, running +x).
  const make = (laneDir) => new Function(`
    const PARKING_BAY_W_M = 2.7, PARKING_BAY_L_M = 5.5, PARKING_EDGE_M = 0.3;
    const insideCarriageway = (x, z) => z < 0 && z > -6;
    const carriagewaySourceAt = () => ({ source: {} });
    const travelAlong = () => [${laneDir}, 0];
    ${slice(M14, "const PARKING_ANGLE_DEG", "function parkingLayout(")}
    return angledStripStalls;`)();
  const layout = { ox: 0, oz: 0, ex: 1, ez: 0, nx: 0, nz: 1, u0: 0, u1: 60, depth: 5.8 };
  const inside = (x, z) => x >= 0 && x <= 60 && z >= 0 && z <= 5.8;
  const usable = (corners) => corners.every(([x, z]) => inside(x, z));
  for (const lean of [1, -1]) {
    const out = make(lean)(layout, inside, usable);
    assert.ok(out && out.stalls.length >= 10, `stalls: ${out?.stalls.length}`);
    for (const q of out.stalls) {
      // Facing (fx, fz) from yaw = atan2(-fx, -fz): into the lot (+z) and ahead with the traffic.
      const fx = -Math.sin(q.yaw), fz = -Math.cos(q.yaw);
      assert.ok(fz > 0.6 && fz < 0.8, `into the lot at 45 deg: ${fz.toFixed(2)}`);
      assert.ok(fx * lean > 0.6, `leaning with the lane: ${fx.toFixed(2)}`);
      assert.ok(inside(q.x, q.z));
    }
    assert.equal(out.stripes.length, out.stalls.length * 2);
  }
  // A lot with no lane along it has none.
  const none = new Function(`
    const PARKING_BAY_W_M = 2.7, PARKING_BAY_L_M = 5.5, PARKING_EDGE_M = 0.3;
    const insideCarriageway = () => false;
    ${slice(M14, "const PARKING_ANGLE_DEG", "function parkingLayout(")}
    return angledStripStalls;`)();
  assert.equal(none(layout, inside, () => true), null);
});

test("a long thin lot with a wedge at one end is angled stalls along its lane edge, not rows", () => {
  // Fillmore's median lot: 6 m wide, 300 m long here, a wedge 30 m out at its south end; the lane
  // at x < 0 runs north (-z).
  const make = new Function(`
    const PARKING_BAY_W_M = 2.7, PARKING_BAY_L_M = 5.5, PARKING_EDGE_M = 0.3;
    const insideCarriageway = (x, z) => x < 0 && x > -7 && z < 0 && z > -300;
    const carriagewaySourceAt = () => ({ source: {} });
    const travelAlong = () => [0, -1];
    ${slice(M14, "//: A thin lot", "//: A lot's frame")}
    return { angledStripStallsOnRing, parkingStripWidth };`);
  const { angledStripStallsOnRing, parkingStripWidth } = make();
  const ring = [[0, 0], [0, -300], [6, -300], [6, -12], [30, 4], [0, 0]];
  const inside = (x, z) => {
    let hit = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, zi] = ring[i], [xj, zj] = ring[j];
      if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) hit = !hit;
    }
    return hit;
  };
  assert.ok(parkingStripWidth(ring) < 8.8, `width ${parkingStripWidth(ring)}`);
  const out = angledStripStallsOnRing(ring, inside, () => true);
  assert.ok(out && out.stalls.length >= 60, `stalls: ${out?.stalls.length}`);
  for (const q of out.stalls) {
    assert.ok(q.x > 0 && q.x < 6, `on the strip: ${q.x.toFixed(2)}`);
    const fx = -Math.sin(q.yaw), fz = -Math.cos(q.yaw);
    assert.ok(fx > 0.6 && fz < -0.6, "nosed in from the lane, leaning north with it");
  }
  // As mapped at Fillmore: the lane's ribbon runs 3 m into the lot, and the survey's median is its
  // far metre. The stalls' heads are at the median's kerb, and they stand out on the parking lane.
  const mapped = new Function(`
    const PARKING_BAY_W_M = 2.7, PARKING_BAY_L_M = 5.5, PARKING_EDGE_M = 0.3;
    const insideCarriageway = (x, z, slack = 0.4) => x < 3 + Math.max(0, -slack) && x > -7 && z < 0 && z > -300;
    const surveyedIslandAt = (x, z) => x >= 5 && x <= 6.5 && z < 0 && z > -300;
    const carriagewaySourceAt = () => ({ source: {} });
    const travelAlong = () => [0, -1];
    ${slice(M14, "//: A thin lot", "//: A lot's frame")}
    return angledStripStallsOnRing;`)();
  const onLane = mapped(ring, inside, () => true);
  assert.ok(onLane && onLane.stalls.length >= 60, `stalls on the parking lane: ${onLane?.stalls.length}`);
  for (const q of onLane.stalls) assert.ok(q.x > -2.5 && q.x < 5, `between the lane and the median: ${q.x.toFixed(2)}`);
  // A thin lot with no lane beside it keeps its rows (no angled stalls).
  const none = new Function(`
    const PARKING_BAY_W_M = 2.7, PARKING_BAY_L_M = 5.5, PARKING_EDGE_M = 0.3;
    const insideCarriageway = () => false;
    ${slice(M14, "//: A thin lot", "//: A lot's frame")}
    return angledStripStallsOnRing;`)();
  assert.equal(none(ring, inside, () => true), null);
  assert.match(M14, /if \(stripAngled\) rows\.length = 0;/);
});

test("plain rooms: every house one of light blue, light green, rose and white", () => {
  const make = new Function(`${fn(M07, "random")}
    ${slice(M25, "const PLAIN_ROOM_PAINTS", "function plainRoomsFor(")}
    return { plainRoomPaint, PLAIN_ROOM_PAINTS };`);
  const { plainRoomPaint, PLAIN_ROOM_PAINTS } = make();
  assert.deepEqual(PLAIN_ROOM_PAINTS, [0xcbdde9, 0xd0e4cb, 0xebcdd1, 0xf3f1ec]);
  const seen = new Map();
  for (let id = 1; id <= 4000; id += 1) {
    const paint = plainRoomPaint(id * 7919);
    assert.ok(PLAIN_ROOM_PAINTS.includes(paint));
    assert.equal(plainRoomPaint(id * 7919), paint, "the same house, the same paint");
    seen.set(paint, (seen.get(paint) || 0) + 1);
  }
  // A mix: each of the four between a sixth and a third of the houses.
  for (const paint of PLAIN_ROOM_PAINTS) assert.ok(seen.get(paint) > 4000 / 6 && seen.get(paint) < 4000 / 3, `${paint.toString(16)}: ${seen.get(paint)}`);
  // The shell's lining is in that paint, and the plain floors stand down for real rooms.
  assert.match(M25, /shellPlaster\.color\.setHex\(plainRoomPaint\(/);
  assert.match(M25, /entry\.homeShell\.plain\.visible = !entry\.interior/);
});
