// Kerbs followed along the block within limits, the road's edge one line for every reader,
// lanes that fit beside the parking the city meters, stall marks (2026-11-24):
// src/smc/renderer/page/module/06, 08, 19, 21.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

const read = (name) => readFileSync(new URL(`../src/smc/renderer/page/module/${name}`, import.meta.url), 'utf8');
const ramps = read('06-the-curb-ramps-the-inventory.js'), keeping = read('08-keeping-things-where-they-belong.js');
const kerbs = read('19-the-dropped-kerb-at-every.js'), furniture = read('21-the-electrical-network-poles-towers.js');
const view = readFileSync(new URL('../docs/city/view.mjs', import.meta.url), 'utf8');
//: The source of ``function name(...) {...}`` at the top level of a module.
function fn(source, name) {
  const start = source.indexOf(`\nfunction ${name}(`) + 1;
  assert.ok(start > 0, `${name} is in the page`);
  let depth = 0, i = source.indexOf('{', source.indexOf(')', start));
  for (; i < source.length; i += 1) { if (source[i] === '{') depth += 1; else if (source[i] === '}') { depth -= 1; if (!depth) break; } }
  return source.slice(start, i + 1);
}
//: ``const NAME = ...;`` as written (to the first ``;`` at the end of a line).
function constant(source, name) {
  const start = source.indexOf(`\nconst ${name} = `) + 1;
  assert.ok(start > 0, `${name} is in the page`);
  return source.slice(start, source.indexOf(';\n', start) + 1);
}

const profiles = () => new Function(`${constant(keeping, 'KERB_LINE_RULES')}\n${constant(keeping, 'kerbProfileStats')}\n${constant(keeping, 'kerbWaves')}
  ${fn(keeping, 'kerbProfileFrom')}\n${fn(keeping, 'kerbDeltaAt')}
  return { KERB_LINE_RULES, kerbProfileStats, kerbWaves, kerbProfileFrom, kerbDeltaAt };`)();
//: A 200 m block's stations, every 4 m, on a street 12 m kerb to kerb but for ``f(s)`` a side.
const stations = (f, length = 200) => { const out = []; for (let s = 0; s <= length; s += 4) out.push([s, 2 * (6 + f(s))]); return out; };

test('a street whose kerb keeps its line keeps its one width', () => {
  const P = profiles();
  assert.equal(P.kerbProfileFrom(stations(() => 0), 200, 6, []), null);
  // (Readings a few centimetres either way are the survey's, not the kerb's.)
  assert.equal(P.kerbProfileFrom(stations((s) => 0.05 * Math.sin(s * 1.7)), 200, 6, []), null);
  // Too few readings to say, or readings all over the place: the one width, and counted.
  assert.equal(P.kerbProfileFrom(stations(() => -0.3).filter((r, i) => i % 4 === 0), 200, 6, []), null);
  assert.equal(P.kerbProfileFrom(stations((s) => (Math.floor(s / 20) % 2 ? 1.2 : -1.2)), 200, 6, []), null);
  assert.equal(P.kerbProfileStats.uniform_cover, 1);
  assert.equal(P.kerbProfileStats.uniform_range, 1);
});

test('a kerb that stands in along a block is followed: subtly, never far, and not at the corners', () => {
  const P = profiles(), K = P.KERB_LINE_RULES;
  const narrow = P.kerbProfileFrom(stations((s) => (s > 60 && s < 150 ? -0.4 : 0)), 200, 6, []);
  assert.ok(narrow, 'followed');
  const at = (s) => P.kerbDeltaAt({ _kerbProfile: narrow }, s);
  assert.ok(Math.abs(at(104) + 0.4) < 0.03, `0.4 m in, in the middle of it: ${at(104)}`);
  assert.equal(at(0), 0); assert.equal(at(8), 0); assert.equal(at(196), 0);
  assert.equal(at(30), 0, 'the one width where the kerb is on it');
  // No turn of the line sharper than the slope: a taper, not a step.
  for (let i = 1; i < narrow.d.length; i += 1)
    assert.ok(Math.abs(narrow.d[i] - narrow.d[i - 1]) <= K.slope * K.station_m + 1e-9, `between ${narrow.s[i - 1]} and ${narrow.s[i]} m`);
  assert.ok(K.slope <= 1 / 16, 'a turn of the kerb is under four degrees');
  // A whole block standing 1.5 m out is not followed 1.5 m: most_m, and eased in from each corner.
  const wide = P.kerbProfileFrom(stations(() => 1.5), 200, 6, []);
  assert.ok(Math.max(...wide.d) <= K.most_m + 1e-9 && Math.max(...wide.d) === K.most_m);
  for (const [i, v] of wide.d.entries()) if (Math.min(i * 4, 200 - i * 4) < K.corner_m - K.station_m) assert.equal(v, 0, `at ${i * 4} m, a corner`);
  // Where another street meets it: a corner there too, as it was built.
  const met = P.kerbProfileFrom(stations(() => -0.4), 200, 6, [100]);
  for (const s of [92, 96, 100, 104, 108]) assert.equal(P.kerbDeltaAt({ _kerbProfile: met }, s), 0, `${s} m`);
  assert.ok(P.kerbDeltaAt({ _kerbProfile: met }, 50) < -0.3 && P.kerbDeltaAt({ _kerbProfile: met }, 150) < -0.3);
  // A change shorter than least_run_m is a driveway or a reading, not the kerb.
  assert.equal(P.kerbProfileFrom(stations((s) => (s >= 96 && s <= 100 ? -0.5 : 0)), 200, 6, []), null);
});

test('a kerb that goes out, in and out again is not followed, and is listed', () => {
  const P = profiles();
  const wave = P.kerbProfileFrom(stations((s) => 0.4 * Math.sin(s / 7)), 200, 6, [], 'Wavy Street');
  assert.equal(wave, null, 'it keeps the one width');
  assert.ok(P.kerbWaves.length >= 1 && P.kerbWaves[0].street === 'Wavy Street');
  assert.ok(P.kerbWaves[0].swing_m >= P.KERB_LINE_RULES.wave_m && P.kerbWaves[0].to_m > P.kerbWaves[0].from_m);
  assert.equal(P.kerbProfileStats.waves, P.kerbWaves.length);
  // One part waving does not stop the rest of the block being followed.
  const mixed = P.kerbProfileFrom(stations((s) => (s < 110 ? 0.4 * Math.sin(s / 7) : -0.35), 300), 300, 6, [], 'Half Wavy Street');
  assert.ok(mixed, 'followed where it does not wave');
  assert.equal(P.kerbDeltaAt({ _kerbProfile: mixed }, 60), 0);
  assert.ok(P.kerbDeltaAt({ _kerbProfile: mixed }, 220) < -0.3);
  // One step out along the block is not a wave.
  assert.ok(P.kerbProfileFrom(stations((s) => (s > 100 ? 0.35 : 0)), 200, 6, [], 'Step Street'));
  assert.ok(!P.kerbWaves.some((w) => w.street === 'Step Street'));
});

test('a street\'s one width is the middle of the city\'s readings along it, where they agree and the record does not', () => {
  const W = new Function(`${constant(keeping, 'KERB_LINE_RULES')}\n${constant(keeping, 'STREET_WIDTH_RULES')}\n${fn(keeping, 'streetWidthFromStations')}
    return { STREET_WIDTH_RULES, streetWidthFromStations };`)();
  // Webster Street north of Lombard: recorded 13.45 m, read 11.72 m along the block and wide
  // only by its corners and where Lombard Street meets it.
  const read = stations((s) => (s < 12 || s > 188 || Math.abs(s - 100) < 10 ? 1.6 : -0.14 + 0.02 * Math.sin(s)));
  const width = W.streetWidthFromStations(read, 200, [100], 13.45);
  assert.ok(Math.abs(width - 11.72) < 0.06, `the readings' middle: ${width}`);
  // A record the readings bear out is kept (within least_m); so is one they do not agree about
  // among themselves, one with too few readings, and one they are nowhere near (a blunder).
  assert.equal(W.streetWidthFromStations(read, 200, [100], 11.8), null);
  assert.equal(W.streetWidthFromStations(stations((s) => (Math.floor(s / 8) % 2 ? 0.5 : -0.5)), 200, [], 13.45), null);
  assert.equal(W.streetWidthFromStations(read.slice(0, 8), 200, [100], 13.45), null);
  assert.equal(W.streetWidthFromStations(read, 200, [100], 20), null);
  // In the page: asked before the kerb's line is read against the width, the old width kept
  // beside the new one, and each change listed.
  const settle = fn(keeping, 'settleKerbProfiles');
  assert.ok(settle.indexOf('settleStreetWidth(way, along, junctions)') < settle.indexOf('kerbProfileFrom(way._stations'));
  // The whole of it, on a street's record: changed, the old width kept; and left alone where
  // the width drawn would not change (a street at the widest any street is drawn).
  const S = new Function(`${constant(keeping, 'KERB_LINE_RULES')}\n${constant(keeping, 'STREET_WIDTH_RULES')}\n${constant(keeping, 'streetWidthsSettled')}
    const kerbProfileStats = { widths_settled: 0 }; const nominalRoadWidth = (way) => Math.min(24, way.road_m);
    ${fn(keeping, 'streetWidthFromStations')}\n${fn(keeping, 'settleStreetWidth')}
    return { settleStreetWidth, streetWidthsSettled, kerbProfileStats };`)();
  const webster = { name: 'Webster Street', road_m: 13.45, road_source: 'curb_geometry', _stations: read };
  assert.equal(S.settleStreetWidth(webster, 200, [100]), true);
  assert.ok(Math.abs(webster.road_m - 11.72) < 0.06 && webster.road_record_m === 13.45);
  assert.equal(webster.road_source, 'official_curbs'); assert.equal(webster.road_basis, 'official_curb_stations');
  assert.deepEqual(S.streetWidthsSettled.map((r) => [r.street, r.was_m]), [['Webster Street', 13.45]]);
  const bay = { name: 'Bay Street', road_m: 26, road_source: 'curb_geometry', _stations: stations(() => 8) };
  assert.equal(S.settleStreetWidth(bay, 200, []), false);
  assert.deepEqual([bay.road_m, bay.road_source, bay.road_record_m, bay.road_basis], [26, 'curb_geometry', undefined, undefined]);
  assert.equal(S.kerbProfileStats.widths_settled, 1);
  // A street meets another where their LINES come together, not only where a corner of one is.
  assert.match(settle, /const ux = bx - ax, uz = bz - az, l2 = ux \* ux \+ uz \* uz \|\| 1, t = Math\.max\(0, Math\.min\(1,/);
  assert.match(settle, /kerbWaves\[k\]\.at = where\(/);
});

const edges = () => new Function(`${constant(keeping, 'CARRIAGEWAY_CELL')}\n${constant(keeping, 'carriagewayGrid')}
  ${constant(kerbs, 'CURB_SNAP_REACH_M')}\n${constant(kerbs, 'CURB_ALIGN_DEG')}\nvar KERB_END_NEARER_M = ${/\nvar KERB_END_NEARER_M = ([\d.]+);/.exec(kerbs)[1]};
  ${['addCarriagewaySegment', 'carriagewayHalfAt', 'distanceToSegmentSquared', 'insideCarriageway'].map((n) => fn(keeping, n)).join('\n')}
  ${fn(kerbs, 'nearestKerbAt')}
  return { addCarriagewaySegment, carriagewayHalfAt, insideCarriageway, nearestKerbAt, carriagewayGrid };`)();

test('the roadway stops on one line for the road drawn and for everything laid to its edge', () => {
  const E = edges();
  // A street along x, 5.0 m a side at 0, 5.4 at 12, 5.4 at 24: two pieces, the first one tapering.
  E.addCarriagewaySegment(0, 0, 12, 0, 5.2, null, 5.0, 5.4);
  E.addCarriagewaySegment(12, 0, 24, 0, 5.4);
  for (const [x, half] of [[0.5, 5.017], [3, 5.1], [6, 5.2], [9, 5.3], [10.5, 5.35], [11.5, 5.383], [12.5, 5.4], [18, 5.4]]) {
    // (Asked from well inside the kerb: beside a corner of the line the next piece's round end
    // is the nearer edge there, and is not the kerb.)
    const k = E.nearestKerbAt(x, half - 0.9, 3);
    assert.ok(k && Math.abs(k.z - half) < 0.005 && Math.abs(k.x - x) < 1e-9, `the kerb beside ${x} m is ${half} out: ${k && k.z}`);
    assert.ok(E.insideCarriageway(x, half - 0.02, 0) && !E.insideCarriageway(x, half + 0.02, 0), `the roadway stops there, at ${x} m`);
    assert.ok(E.insideCarriageway(x, -(half - 0.02), 0) && !E.insideCarriageway(x, -(half + 0.02), 0));
  }
  // No step where one piece ends and the next begins (it was 0.2 m here on one width a piece).
  const before = E.nearestKerbAt(11.9, 5.2, 3), after = E.nearestKerbAt(12.1, 5.2, 3);
  assert.ok(Math.abs(before.z - after.z) < 0.01 && Math.abs(after.z - 5.4) < 0.01, `${before.z} then ${after.z}`);
  // Past the end of the street its round end is the kerb, and on the outside of a bend.
  const end = E.nearestKerbAt(26, 3, 6);
  assert.ok(end && Math.abs(Math.hypot(end.x - 24, end.z) - 5.4) < 1e-6 && end.x > 24, 'the end of the street');
  // A piece of one width is as it always was.
  const seg = [...E.carriagewayGrid.values()].flat().find((s) => s[0] === 12);
  assert.equal(seg[4], 5.4); assert.equal(seg[7], seg[8]);
  assert.equal(E.carriagewayHalfAt([0, 0, 10, 0, 4, 0, null], 5, 0), 4, 'a piece recorded before the ends were kept');
});

test('every piece of a street is recorded with the width at each of its ends', () => {
  assert.match(keeping, /addCarriagewaySegment\(ax, -ay, bx, -by, \(halfA \+ halfB\) \/ 2, way, halfA, halfB\)/);
  assert.match(keeping, /bucket\.push\(\[ax, az, bx, bz, half, bearing, source, halfA, halfB\]\)/);
  // And the three questions "is this roadway?" read the width at the point.
  assert.ok(keeping.split('carriagewayHalfAt(').length - 1 >= 5);
  // A street that follows its kerb has a corner of its line at every station, and its profile
  // is laid on the width everything else is drawn at.
  assert.match(keeping, /way\.points = densifyWay\(way\.points, KERB_LINE_RULES\.vertex_m\)/);
  assert.match(keeping, /if \(KERB_RENDER_UNIFORM\) return renderedRoadWidth\(way\) \/ 2 \+ kerbDeltaAt\(way, along\)/);
  assert.match(keeping, /vertex_m: 4,/);
  assert.match(keeping, /station_m: 4,/);
});

const lanes = () => new Function(`${constant(ramps, 'PARKING_STALL_M')}\n${constant(ramps, 'LANE_FIT_MIN_M')}\n${fn(ramps, 'fitLaneBands')}
  return { PARKING_STALL_M, LANE_FIT_MIN_M, fitLaneBands };`)();
const band = (kind, width, dir = 0) => ({ kind, width, dir, sub: '' });
const kinds = (bands) => bands.map((b) => (b.kind === 'travel' ? (b.dir > 0 ? '>' : '<') : b.kind === 'parking' ? 'P' : b.kind[0])).join('');

test('lanes of traffic are the ones that fit beside the parking at the kerbs', () => {
  const L = lanes();
  // Chestnut Street as it was drawn: 15 m kerb to kerb split into four equal lanes, with the
  // city's meters down both kerbs. A parking lane each side leaves room for one lane each way.
  const chestnut = [band('travel', 3.75, -1), band('travel', 3.75, -1), band('travel', 3.75, 1), band('travel', 3.75, 1)];
  L.fitLaneBands({ parking_sides: [1, -1] }, chestnut, 7.5);
  assert.equal(kinds(chestnut), 'P<>P');
  assert.equal(chestnut[0].width, L.PARKING_STALL_M); assert.ok(chestnut[0].fitted);
  // The same street with no parking known keeps its four lanes: 3.75 m each fits.
  const open = [band('travel', 3.75, -1), band('travel', 3.75, -1), band('travel', 3.75, 1), band('travel', 3.75, 1)];
  assert.equal(kinds(L.fitLaneBands({}, open, 7.5)), '<<>>');
  // Parking already in the bands is not put in twice, and a wide street keeps its lanes.
  const wide = [band('parking', 2.4), band('travel', 3.3, -1), band('travel', 3.3, -1), band('travel', 3.3, 1), band('travel', 3.3, 1), band('parking', 2.4)];
  assert.equal(kinds(L.fitLaneBands({ parking_sides: [1, -1] }, wide, 9)), 'P<<>>P');
  // Metered on one side only: the lane taken is from the kerbs inward, one each way at a time.
  const one = [band('travel', 3, -1), band('travel', 3, -1), band('travel', 3, 1), band('travel', 3, 1)];
  assert.equal(kinds(L.fitLaneBands({ parking_sides: [1] }, one, 6)), 'P<>');
  // A one-way street loses lanes one at a time, down to one; a turn lane is never the one taken.
  const oneway = [band('travel', 3, 1), band('travel', 3, 1), band('travel', 3, 1)];
  assert.equal(kinds(L.fitLaneBands({ parking_sides: [1, -1] }, oneway, 5)), 'P>P');
  const single = [band('travel', 4, -1), band('travel', 4, 1)];
  assert.equal(kinds(L.fitLaneBands({ parking_sides: [1, -1] }, single, 4)), 'P<>P', 'one each way is the least');
});

test('parking is known from the meters, the city drives the lanes that fit, and each metered space is marked', () => {
  assert.match(ramps, /fitLaneBands\(way, bands, half\);/);
  assert.match(ramps, /const PARKING_STALL_M = 2\.4;/);
  // A side is metered parking on a count and a density of the city's own meters, beside the street.
  assert.match(ramps, /n < PARKING_METERS\.least \|\| n < way\._parkLen \/ PARKING_METERS\.every_m/);
  assert.match(ramps, /way\.parking_basis \|\|= \{\}\)\[side\] = `sfmta_parking_meters:\$\{n\}`/);
  assert.match(ramps, /way\.parking_sides_tagged = tagged\.slice\(\)/);
  assert.match(read('09-where-openstreetmap-says-there-is.js'), /await settleParkingLanes\(\)/);
  assert.match(view, /lanes: way\.lanes_fit \|\| way\.lanes \|\| 2/);
  // The mark: a T in the road a stall's width off the kerb, at single-space meters, not where
  // the kerb is painted or a bike lane runs, recorded as inferred from the meters.
  assert.match(furniture, /parking_stall_marks: addParkingStallMarks\(official\.parking_meters \|\| \[\]\)/);
  const marks = fn(furniture, 'addParkingStallMarks');
  assert.match(marks, /record\.meter_type && record\.meter_type !== "single_space"/);
  assert.match(marks, /kerbParking\(k\.x, k\.z, k\.ax, k\.az, 0\.6\) !== null\) continue/);
  assert.match(marks, /insideBikeLane/);
  assert.match(marks, /kind: "parking_stall", source: "sfmta_parking_meters"/);
  assert.match(furniture, /const STALL_MARK = \{ out_m: 2\.4,/);
});
