// Round 5 (2026-11-17): walkers keep off a divided street's median, lots park one car a stall.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Streets, pavementRoute } from '../docs/city/people.mjs';

//: A street drawn as two one-way lines 12 m apart (eastbound at z = 6, westbound at z = -6),
//: each 6 m wide to its kerbs: the strip between z = -3 and z = 3 is the median.
function divided() {
  return new Streets([
    { id: 'east', kind: 'street', name: 'Broad Street', oneway: 1, pts: [[-150, 6], [-50, 6], [50, 6], [150, 6]], road_m: 6 },
    { id: 'west', kind: 'street', name: 'Broad Street', oneway: 1, pts: [[150, -6], [50, -6], [-50, -6], [-150, -6]], road_m: 6 },
  ]);
}
const inMedian = (q) => Math.abs(q[1]) < 3;

test('nobody walks along the median of a street drawn as two one-way lines', () => {
  const S = divided();
  for (const [a, b] of [[[-150, 6], [150, 6]], [[150, 6], [-150, 6]], [[150, -6], [-150, -6]], [[-150, -6], [150, -6]]]) {
    const route = S.route(S.nearest(a[0], a[1], 'walk', 2), S.nearest(b[0], b[1], 'walk', 2), 'walk');
    assert.ok(route?.length > 250, 'a walk along the carriageway');
    for (const side of [1, -1]) {
      const walk = pavementRoute(S, route, { side });
      assert.ok(walk.pts.length >= 2);
      for (const q of walk.pts) {
        assert.ok(!inMedian(q), `side ${side} from ${a}: ${q} is on the median`);
        // On a pavement: past the outer kerb of one carriageway or the other.
        assert.ok(Math.abs(q[1]) > 9, `side ${side} from ${a}: ${q} is in the roadway`);
      }
    }
  }
});

test('an ordinary two-way street keeps a pavement on both sides', () => {
  const S = new Streets([{ id: 'main', kind: 'street', pts: [[-100, 0], [0, 0], [100, 0]], road_m: 10 }]);
  const route = S.route(S.nearest(-100, 0), S.nearest(100, 0), 'walk');
  const zs = [1, -1].map((side) => pavementRoute(S, route, { side }).pts[0][1]);
  assert.ok(zs[0] * zs[1] < 0, 'one line each side');
  for (const z of zs) assert.ok(Math.abs(z) > 5 && Math.abs(z) < 8);
});

// ---- City.legalize: a walk kept off the roadway as the world draws it ---------------------------
import { City, WALK_LEGAL } from '../docs/city/fleet.mjs';

//: A street along x, 10 m wide (|z| < 5), with pavements beyond.
const strip = {
  onRoad: (x, z) => Math.abs(z) < 5,
  kerbNear: (x, z, reach) => (Math.abs(Math.abs(z) - 5) <= reach ? { x, z: z >= 0 ? 5 : -5, nx: 0, nz: z >= 0 ? 1 : -1 } : null),
};
const legal = (pave, kerbside = strip) => City.prototype.legalize.call({ kerbside, pavementBy: City.prototype.pavementBy, wallFixes: {} }, pave);
const walkOf = (pts, crossings = []) => {
  const s = [0];
  for (let i = 1; i < pts.length; i += 1) s.push(s[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { pts, s, length: s[s.length - 1], halves: pts.map(() => 0), classes: pts.map(() => null), crossings, mode: 'walk' };
};
const inRoadShare = (pave) => {
  let n = 0, bad = 0;
  for (let d = 0; d <= pave.length; d += 0.5) {
    let k = 0; while (k + 2 < pave.pts.length && pave.s[k + 1] < d) k += 1;
    const t = (d - pave.s[k]) / (pave.s[k + 1] - pave.s[k] || 1), z = pave.pts[k][1] + (pave.pts[k + 1][1] - pave.pts[k][1]) * t;
    n += 1; if (Math.abs(z) < 4.9 && !pave.crossings.some((c) => d >= c.s0 && d <= c.s1)) bad += 1;
  }
  return bad / n;
};

test('a walk that ran along the roadway is moved onto the pavement beside it', () => {
  const before = walkOf([[-50, 7], [0, 7], [0, 2], [60, 2], [60, 7], [100, 7]]);
  assert.ok(inRoadShare(before) > 0.3);
  const after = legal(before);
  assert.ok(inRoadShare(after) < 0.03, `still ${inRoadShare(after)} of it in the road`);
  // On the side it came from: nobody is sent over the street to the far pavement.
  for (const q of after.pts) assert.ok(q[1] > 1.9, `${q} went over the road`);
  assert.deepEqual(after.pts[0], [-50, 7]);
  assert.deepEqual(after.pts.at(-1), [100, 7]);
});

test('a crossing is grown to the kerbs, so the wait is on the pavement', () => {
  // Over the street at x = 0, marked only for its middle six metres.
  const before = walkOf([[-30, 7], [0, 7], [0, -7], [30, -7]], [{ s0: 34, s1: 40, node: 1, bearing: 0, signal: false }]);
  const after = legal(before);
  const c = after.crossings[0];
  assert.ok(c.s0 <= 32.1 && c.s0 >= 31, `starts at ${c.s0}: the kerb is at 32`);
  assert.ok(c.s1 >= 41.9 && c.s1 <= 43, `ends at ${c.s1}: the far kerb is at 42`);
  assert.equal(inRoadShare(after), 0);
  assert.equal(before.crossings[0].s0, 34, 'the walk given is not changed');
});

test('the mouth of a side street is walked over, and an island is never a pavement', () => {
  // A 10 m mouth: left alone.
  const mouth = { onRoad: (x, z) => Math.abs(x) < 5, kerbNear: () => null };
  const over = walkOf([[-40, 0], [40, 0]]);
  assert.deepEqual(legal(over, mouth).pts, over.pts);
  // The nearest kerb is an island's (roadway again 4 m past it): no pavement there. The
  // pavement is the other way, over the lane: the far kerb's, never the island.
  const island = { onRoad: (x, z) => Math.abs(z) < 5 || (z > 7 && z < 20), kerbNear: (x, z) => ({ x, z: 5, nx: 0, nz: 1 }) };
  const by = City.prototype.pavementBy.call({ kerbside: island }, 0, 2);
  assert.ok(by && by.z < -5 && !island.onRoad(by.x, by.z), `beside a median the pavement found is ${JSON.stringify(by)}`);
  // ... and none at all where the other side is an island too.
  const two = { onRoad: (x, z) => Math.abs(z) < 5 || (z > 7 && z < 20) || (z < -7 && z > -20), kerbNear: island.kerbNear };
  assert.equal(City.prototype.pavementBy.call({ kerbside: two }, 0, 2), null);
  assert.ok(City.prototype.pavementBy.call({ kerbside: strip }, 0, 2));
  assert.ok(WALK_LEGAL.mouth_m >= 10);
});

test('roadway walked along up to a crossing is moved to the pavement, and the crossing leaves from there', () => {
  // Along the road at z = 2 for 40 m, then over it at x = 0.
  const before = walkOf([[-60, 7], [-40, 7], [-40, 2], [0, 2], [0, -7], [30, -7]], [{ s0: 65, s1: 72, node: 1, bearing: 0, signal: true }]);
  const after = legal(before);
  assert.ok(inRoadShare(after) < 0.03, `still ${inRoadShare(after)} in the road`);
  const c = after.crossings[0];
  let k = 0; while (k + 2 < after.pts.length && after.s[k + 1] < c.s0) k += 1;
  const t = (c.s0 - after.s[k]) / (after.s[k + 1] - after.s[k] || 1), z0 = after.pts[k][1] + (after.pts[k + 1][1] - after.pts[k][1]) * t;
  assert.ok(z0 > 4.9, `the wait is at z = ${z0}: in the road`);
  assert.ok(c.s1 > c.s0 + 9, 'the crossing spans the street');
  assert.ok(Math.abs(after.length - after.s.at(-1)) < 1e-9);
});

// ---- car parks: one car a stall -----------------------------------------------------------------
import { LOT_WALK_M } from '../docs/city/fleet.mjs';

test('cars park in a car park one to a stall, and never two in one at the same hour', () => {
  const city = { spots: new Map(), plans: new Map() };
  const stalls = [0, 1, 2].map((i) => ({ id: `lot:${i}`, lot: 'lot', x: 10 + i * 2.7, z: 20, yaw: 0 }));
  City.prototype.setLots.call(city, stalls);
  const park = (id, win = null, at = { x: 10, z: 24 }, model = 'sedan') => City.prototype.lotStall.call(city, { id, model }, at, win);
  const a = park('veh:a'), b = park('veh:b'), c = park('veh:c');
  assert.deepEqual([a.id, b.id, c.id], ['lot:0', 'lot:1', 'lot:2'], 'nearest free stall first');
  assert.equal(new Set([a, b, c].map((q) => `${q.x}:${q.z}`)).size, 3, 'three cars, three places');
  assert.equal(park('veh:d'), null, 'a full car park takes no more');
  // A visitor's stall is theirs for their hours only.
  City.prototype.setLots.call(city, stalls.slice(0, 1));
  const morning = { day: 3, t0: 540, t1: 600 }, noon = { day: 3, t0: 590, t1: 700 }, later = { day: 3, t0: 600, t1: 660 };
  assert.equal(park('visitor:1', morning).id, 'lot:0');
  assert.equal(park('visitor:2', noon), null, 'the stall is taken while the first car stands in it');
  assert.equal(park('visitor:3', later).id, 'lot:0', 'and free once it has gone');
  assert.equal(park('veh:far', null, { x: 10 + LOT_WALK_M + 20, z: 20 }), null, 'not from too far to walk');
  assert.equal(park('veh:bus', { day: 9, t0: 0, t1: 10 }, { x: 10, z: 24 }, 'bus'), null, 'a bus does not go in a stall');
});
