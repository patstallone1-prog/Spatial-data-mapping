// The street's shapes settled, one kerb, fences closed, one walking pace (2026-11-24):
// src/smc/renderer/page/module/17, 18, 22, 26.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

const read = (name) => readFileSync(new URL(`../src/smc/renderer/page/module/${name}`, import.meta.url), 'utf8');
const parks = read('18-inside-the-parks-playgrounds-dog.js'), trees = read('17-trees-a-trunk-limbs-and.js');
const explore = read('22-explore-the-view-without-the.js'), rooms = read('26-rooms-laid-out-as-rooms.js');
//: The source of ``function name(...) {...}`` at the top level of a module.
function fn(source, name) {
  const start = source.indexOf(`\nfunction ${name}(`) + 1;
  assert.ok(start > 0, `${name} is in the page`);
  let depth = 0, i = source.indexOf('{', start);
  for (; i < source.length; i += 1) { if (source[i] === '{') depth += 1; else if (source[i] === '}') { depth -= 1; if (!depth) break; } }
  return source.slice(start, i + 1);
}
const shapes = new Function(`${['shapeConvexOutline', 'shapeRingArea', 'shapeTightRectangle', 'shapeThinnedOutline', 'shapeRoundedOutline'].map((n) => fn(parks, n)).join('\n')}
  return { shapeConvexOutline, shapeRingArea, shapeTightRectangle, shapeThinnedOutline, shapeRoundedOutline };`)();

test('a rectangle with a corner missing is its rectangle; a many-sided island is the curve round its points', () => {
  // 10 m by 6 m with a 2 m corner cut off and its long sides stepped: a hull, and its rectangle.
  const pts = [[0, 0], [10, 0], [10, 4], [8, 6], [0, 6], [3, 0.2], [6, 5.8], [5, 3]];
  const hull = shapes.shapeConvexOutline(pts);
  assert.equal(hull.length, 5, 'the points inside are not corners');
  const box = shapes.shapeTightRectangle(hull);
  assert.ok(Math.abs(box.area - 60) < 1e-6 && box.ring.length === 4);
  assert.ok(shapes.shapeRingArea(hull) / box.area > 0.8, 'it all but fills its rectangle');
  // The curve round an outline: inside it, every corner turned, nothing sharper than it was.
  const jagged = [[0, 0], [4, -0.3], [8, 0], [8.3, 3], [8, 6], [4, 6.4], [0, 6], [-0.3, 3]];
  const thin = shapes.shapeThinnedOutline(shapes.shapeConvexOutline(jagged), 0.35), round = shapes.shapeRoundedOutline(thin, 0.9);
  assert.ok(round.length >= thin.length * 5, 'each corner is an arc');
  assert.ok(shapes.shapeRingArea(round) < shapes.shapeRingArea(thin) && shapes.shapeRingArea(round) > shapes.shapeRingArea(thin) * 0.93);
  let sharpest = 0;
  for (let k = 0; k < round.length; k += 1) {
    const a = round[(k + round.length - 1) % round.length], p = round[k], b = round[(k + 1) % round.length];
    const ux = p[0] - a[0], uz = p[1] - a[1], vx = b[0] - p[0], vz = b[1] - p[1], m = Math.hypot(ux, uz) * Math.hypot(vx, vz);
    if (m > 1e-9) sharpest = Math.max(sharpest, Math.acos(Math.max(-1, Math.min(1, (ux * vx + uz * vz) / m))));
  }
  assert.ok(sharpest < 0.5, `the sharpest turn left is ${sharpest.toFixed(2)} rad`);
  // Steps a hand apart are one line.
  assert.equal(shapes.shapeThinnedOutline([[0, 0], [0.1, 0], [5, 0], [5, 5], [5, 5.1], [0, 5]], 0.35).length, 4);
});

test('only the walk\'s own kerb is drawn, and the city\'s kerb linework is measured against it', () => {
  assert.ok(parks.includes('const WORLD_KERB_DRAWN = false;'));
  assert.ok(parks.includes('if (curb && !WORLD_KERB_DRAWN) { worldSweepStats.withheld = (worldSweepStats.withheld || 0) + 1; continue; }'));
  assert.ok(parks.includes('window.kerbsideKerbSources = kerbSourceReport;') && parks.includes('offsets.push((x - k.x) * k.nx + (z - k.z) * k.nz);'));
  // A kerb with no walk beside it goes; so does a scrap of walk; the pass runs before the merge.
  assert.ok(parks.includes('for (const [dx, dz] of [[0, 0], [0.4, 0], [-0.4, 0], [0, 0.4], [0, -0.4]]) if (pavementTopAt(x + dx, z + dz) !== undefined) return false;'));
  assert.ok(parks.includes('if (area < S.sliver_m2) { gone.add(comp.id); streetShapeStats.slivers += 1; continue; }'));
  assert.ok(parks.indexOf('settleStreetShapes(); }') < parks.indexOf('flushMerged(groups.streets, (key) => !isBuilt(key));'));
  // One grid of squares, square to the streets, for everything that wears the sidewalk's texture.
  assert.ok(parks.includes('if (isBuilt(key) || bucket.material?.map !== SIDEWALK) continue;'));
  assert.ok(parks.includes('uv.setXY(v, (x * cs + z * sn) / WALK_UV_M, (z * cs - x * sn) / WALK_UV_M);'));
});

test('paving is cut off the roadway along its edge, and a fence\'s free end is carried on to a wall', () => {
  assert.ok(trees.includes('if (roads) cut += cutCoverBy(mesh, (x, z) => insideCarriageway(x, z, 0), ROAD_CUT_FINE_M);'));
  assert.ok(!trees.includes('on(a) + on(b) + on(c) >= 2'), 'no longer a whole triangle at a time');
  assert.ok(trees.includes('function closeFenceEnds()') && parks.includes('window.kerbsideFenceEnds = closeFenceEnds();'));
  assert.ok(parks.indexOf('window.kerbsideFenceEnds = closeFenceEnds();') > parks.indexOf('await runStepsSliced(buildFencesSteps(ground));'), 'after every fence is laid');
  // Never across a roadway, a pavement, a driveway, a gate or a path; a parted end is left.
  assert.ok(trees.includes('const publicWay = (x, z) => insideCarriageway(x, z, 0.1) || pavementTopAt(x, z) !== undefined'));
  // (The closing panel runs along the ray: a path across the ray is across the panel. The ray's
  // square was once passed here, and let closings cross the paths they were to keep clear of.)
  assert.ok(trees.includes('if (publicWay(px, pz) || inFenceGate(px, pz) || pathThroughFence(px, pz, ux, uz)) return null;'));
  assert.ok(trees.includes('|| (typeof parkPavementAt === "function" && parkPavementAt(x, z)) || (typeof onPublicPath === "function" && onPublicPath(x, z));'));
  // Only onto a wall or more of its own fence (marina_fences_courts_trees.test.mjs walks it).
  assert.ok(trees.includes('if (d > 0.5 && fenceAt(px, pz, own, 0.2, true)) return d;'));
  assert.ok(trees.includes('if (!sink.closing && !sink.leaf && typeof fencePanelsLaid !== "undefined") fencePanelsLaid.push({ sink, ax, az, bx, bz, baseY, height, tileU, tileV,'));
});

test('one walking pace at every zoom, a quarter slower; a sprint as fast as it was', () => {
  const consts = ['STREET_SPEED', 'FIRST_PERSON_SPEED', 'INDOOR_SPEED', 'WALK_PACE', 'WALK_CONSTANT_TO_M'].map((n) => explore.match(new RegExp(`const ${n} = [^;]+;`))[0]).join('\n');
  const speed = new Function('state', `${consts}\n${fn(explore, 'avatarMoveSpeed')}\nreturn { avatarMoveSpeed, STREET_SPEED, FIRST_PERSON_SPEED };`);
  const state = { indoors: false, firstPerson: false, dist: 7 }, S = speed(state);
  const near = S.avatarMoveSpeed();
  assert.ok(Math.abs(near - S.STREET_SPEED * 0.75) < 1e-9, 'a quarter slower than it was');
  for (const dist of [3, 7, 20, 45, 60, 90]) { state.dist = dist; assert.equal(S.avatarMoveSpeed(), near, `the same at ${dist} m`); }
  assert.equal(S.avatarMoveSpeed(true), S.STREET_SPEED, 'a sprint keeps the speed it had');
  state.dist = 900; assert.ok(S.avatarMoveSpeed() > near * 5, 'crossing the map in Explore is still by the map');
  state.dist = 7; state.firstPerson = true; assert.ok(Math.abs(S.avatarMoveSpeed() - S.FIRST_PERSON_SPEED * 0.75) < 1e-9);
  state.indoors = true; assert.ok(S.avatarMoveSpeed() < 1.5);
  assert.ok(rooms.includes('const scaled = avatarMoveSpeed(vitalsPace > 1);'));
});
