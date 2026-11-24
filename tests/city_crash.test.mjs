// Crashes as they leave things (docs/city/crash.mjs), the clock held (docs/city/clock.mjs) and a
// divided street crossed in one go (docs/city/fleet.mjs joinDivided): 2026-11-23.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { CRASH, clearedUnseen, crumple, crushDepth, damageKey, damageLevel, damagePace, impactOn, impactZone, newDamage, personImpact, personPose, scuff, stretcherAt, towAt, workAt } from '../docs/city/crash.mjs';
import { CLOCK_SPEC, clockHeld, clockHoldState, clockTime, fleetTime, heldOffset, holdClock, makeClock, releaseClock, restoreClockHold } from '../docs/city/clock.mjs';
import { City, harmNow } from '../docs/city/fleet.mjs';
import { CityWorld } from '../docs/city/world.mjs';
import { loadRules } from '../docs/city/core.mjs';

const R = loadRules(JSON.parse(readFileSync(new URL('../docs/city/rules.json', import.meta.url), 'utf8')), JSON.parse(readFileSync(new URL('../docs/city/jurisdictions.json', import.meta.url), 'utf8')));
const DIMS = [1.84, 1.45, 4.92];
// A body's corners: a box of points over a sedan, a hand apart.
function box() {
  const out = [];
  for (let x = -0.92; x <= 0.921; x += 0.23) for (let y = 0; y <= 1.451; y += 0.29) for (let z = -2.46; z <= 2.461; z += 0.205) out.push(x, y, z);
  return Float32Array.from(out);
}

test('a blow marks a car by its speed: scraped, dented, then that end pushed in', () => {
  assert.equal(damageLevel(impactOn(null, { zone: 'front', speed: 0.5 })), 'new');
  assert.equal(damageLevel(impactOn(null, { zone: 'front', speed: 2 })), 'scratched');
  assert.equal(damageLevel(impactOn(null, { zone: 'left', speed: 5 })), 'dented');
  const head = impactOn(null, { zone: 'front', speed: 14 });
  assert.equal(damageLevel(head), 'crumpled');
  assert.ok(head.front > 0.5 && head.rear === 0 && head.left === 0);
  // Never less than it was, and a second blow adds to the first.
  const again = impactOn(head, { zone: 'front', speed: 6 });
  assert.ok(again.front > head.front && again.front <= 1);
  assert.equal(impactOn(head, { zone: 'rear', speed: 0.2 }).front, head.front);
  assert.notEqual(damageKey(head), damageKey(again));
  assert.equal(damageKey(newDamage()), '0.0.0.0.0.0.0.0.0.0');
  assert.ok(damagePace(impactOn(null, { zone: 'front', speed: 30 })) < 0.6 && damagePace(null) === 1);
});

test('where a blow lands is read in the car\'s own frame', () => {
  assert.equal(impactZone(0, -2.4, DIMS).zone, 'front');
  assert.equal(impactZone(0.2, 2.4, DIMS).zone, 'rear');
  assert.equal(impactZone(-0.9, 0.3, DIMS).zone, 'left');
  assert.equal(impactZone(0.9, -0.5, DIMS).zone, 'right');
  assert.ok(impactZone(0.7, -2.4, DIMS).bias > 0.5);
});

test('a head-on crash shortens the front and leaves the rest of the body where it was', () => {
  const pos = box(), damage = impactOn(null, { zone: 'front', speed: 18 }), bent = crumple(pos, DIMS, damage);
  assert.notEqual(bent, pos);
  let nose = Infinity, nose0 = Infinity, back = 0, rise = 0;
  for (let i = 0; i < pos.length; i += 3) {
    nose0 = Math.min(nose0, pos[i + 2]); nose = Math.min(nose, bent[i + 2]);
    if (pos[i + 2] > 0.3) back = Math.max(back, Math.abs(bent[i] - pos[i]) + Math.abs(bent[i + 1] - pos[i + 1]) + Math.abs(bent[i + 2] - pos[i + 2]));
    rise = Math.max(rise, bent[i + 1] - pos[i + 1]);
    assert.ok(bent[i + 1] >= 0, 'nothing is pushed under the road');
  }
  const depth = crushDepth(damage.front, DIMS);
  assert.ok(depth > 0.5 && depth <= CRASH.crush_m);
  assert.ok(nose - nose0 > depth * 0.6, `the bumper is ${(nose - nose0).toFixed(2)} m further back`);
  assert.equal(back, 0, 'behind the middle nothing has moved');
  assert.ok(rise > 0.05, 'the bonnet is kinked up');
  // The same corner goes the same way whichever part it is in: no cracks.
  const twice = crumple(Float32Array.from([...pos.slice(0, 30), ...pos.slice(0, 30)]), DIMS, damage);
  assert.deepEqual([...twice.slice(0, 30)], [...twice.slice(30, 60)]);
  // A scrape moves nothing; a dent in a side goes inward.
  assert.equal(crumple(pos, DIMS, impactOn(null, { zone: 'front', speed: 2 })), pos);
  const side = crumple(pos, DIMS, impactOn(null, { zone: 'left', speed: 6 }));
  let inward = 0;
  for (let i = 0; i < pos.length; i += 3) if (pos[i] < -0.9) inward = Math.max(inward, side[i] - pos[i]);
  assert.ok(inward > 0.05);
});

test('the marks show where it was struck, and nowhere on a car as new', () => {
  const pos = box();
  assert.equal(scuff(pos, DIMS, null), null);
  const marks = scuff(pos, DIMS, impactOn(null, { zone: 'front', speed: 16 }));
  let front = 0, rear = 0;
  for (let i = 0; i < pos.length / 3; i += 1) { if (pos[3 * i + 2] < -2) front = Math.max(front, marks[4 * i + 3]); if (pos[3 * i + 2] > 1 && Math.abs(pos[3 * i]) < 0.5) rear = Math.max(rear, marks[4 * i + 3]); }
  assert.ok(front > 0.3 && rear < 0.05);
  assert.ok(scuff(pos, DIMS, impactOn(null, { zone: 'front', speed: 2 })), 'a scrape leaves marks too');
});

test('someone hit is gone over, folded onto the bonnet and carried, or thrown, by the speed', () => {
  assert.equal(personImpact(3), 'run_over'); assert.equal(personImpact(8), 'fold'); assert.equal(personImpact(15), 'thrown');
  const over = personPose('run_over', 1, { speed: 3 });
  assert.ok(over.done && over.fall === 1 && over.lift < 0.01 && over.under);
  const on = personPose('fold', 0.6, { speed: 8, stop: 5 });
  assert.ok(on.carried && on.lift > 0.6 && on.fall > 0.2 && on.fall < 0.8, 'bent over the bonnet, off the road');
  const off = personPose('fold', 6, { speed: 8, stop: 5 });
  assert.ok(off.done && !off.carried && off.lift < 0.01 && off.fall === 1 && off.along > 1);
  const far = personPose('thrown', 5, { speed: 16 });
  assert.ok(far.done && far.along > 8 && far.lift < 0.01);
  assert.ok(personPose('thrown', 0.4, { speed: 16 }).lift > 0.5);
});

test('an ambulance loads each casualty in turn and a tow truck hooks, lifts and draws up', () => {
  assert.deepEqual(workAt(5, 0, 13), { i: 0, k: 1, phase: 'done', done: true });
  assert.equal(workAt(14, 2, 13).i, 1); assert.ok(workAt(27, 2, 13).done);
  assert.ok(!stretcherAt(0.2).carried && stretcherAt(0.2).reach > 0.5);
  assert.ok(stretcherAt(0.5).carried && stretcherAt(0.42).lift < 0.4, 'down for them, and they are on it');
  assert.ok(stretcherAt(0.7).reach < 0.6 && stretcherAt(0.97).in);
  assert.ok(!towAt(0.2).hooked && towAt(0.35).hooked && towAt(0.35).lift === 0);
  assert.ok(towAt(1).lift === 1 && towAt(1).draw === 1 && towAt(0.7).lift > 0.3);
  assert.ok(clearedUnseen({ far: CRASH.leave_m + 10, unseen: CRASH.unseen_s + 1 }) && !clearedUnseen({ far: 20, unseen: 100 }) && clearedUnseen({ age: CRASH.stale_s + 1 }));
});

test('a wreck stands until it is cleared, then is as new at the mechanic\'s; the hurt go to hospital', () => {
  const now = Date.parse('2026-11-23T20:00:00Z'), w = new CityWorld(R, { now });
  const vehicle = { id: 'veh:a', plate: '1ABC234', driver: 'npc:a', driverName: 'A', x: 10, z: 20, yaw: 0, where: { zone: 'front', bias: 0.4, at: 0 } };
  w.npcCollision({ id: 'c1', vehicle, target: { id: 'npc:p', name: 'Walker', kind: 'person', x: 10, z: 16 }, speed: 14 });
  const car = w.harm.get('veh:a'), person = w.harm.get('npc:p');
  assert.equal(harmNow(car, now).stays, true); assert.ok(harmNow(car, now).damage.scratch > 0);
  assert.ok(harmNow(person, now).down && harmNow(person, now).carried, 'down, to be carried');
  // (Nothing comes: they lie a few real minutes at most, the wreck ten.)
  assert.ok(harmNow(person, w.clock.after(now, (CRASH.down_s + 5) * 1000)).out);
  const done = w.clearCrash({ vehicles: ['veh:a', 'nobody'], people: ['npc:p'], shop: { x: 100, z: 200, yaw: 1, name: 'Marina Auto' } });
  assert.deepEqual(done, { vehicles: 1, people: 1 });
  const at = harmNow(car, now);
  assert.ok(at.stays && at.shop && at.condition === 100 && at.damage === null && at.at.x === 100);
  assert.equal(harmNow(car, now + R.harm.vehicle.repair_hours * 3_600_000 + 1), null, 'its owner has it again');
  assert.ok(harmNow(person, now).out && harmNow(person, now).state === 'hospital');
});

test('your own car keeps what a crash did to it until a mechanic mends the body', () => {
  const now = Date.parse('2026-11-23T20:00:00Z'), w = new CityWorld(R, { now });
  w.cmd_join('me', { name: 'Me' });
  const p = w.players.get('me');
  const a = w.registry.register('veh:mine', 'vehicle', p.account, { model: 'sedan', plate: 'MINE1', condition: 100 }, now);
  p.driving = { vehicle: 'veh:mine' };
  const r = w.cmd_collision('me', { kind: 'hit_object', speed: 15, where: { mine: { zone: 'front', bias: -0.5, at: 0 } } });
  assert.equal(damageLevel(r.mine.damage), 'crumpled');
  const mine = w.registry.get('veh:mine');
  assert.ok(mine.attrs.damage.front > 0.5 && !mine.attrs.in_shop_until, 'not taken to a body shop for you');
  w.step(now + 3 * 86_400_000);
  assert.ok(w.registry.get('veh:mine').attrs.damage.front > 0.5, 'three days on it is still as the crash left it');
});

test('the clock held: the hour stands still and each phase goes round its own window', () => {
  restoreClockHold(null);
  const clock = makeClock(CLOCK_SPEC), t0 = Date.parse('2026-11-23T20:00:00Z');
  assert.equal(clockTime(t0), t0); assert.equal(clockHeld(), false);
  holdClock(t0);
  assert.equal(clockHeld(), true);
  assert.equal(clockTime(t0 + 600_000), t0, 'ten minutes on, the same moment');
  assert.equal(clock.game(clockTime(t0 + 600_000)), clock.game(t0));
  // 48 phases of a six-minute window: spread evenly over it at any moment, each going round.
  const W = 360_000, offs = Array.from({ length: 48 }, (_, k) => heldOffset(t0 + 100_000, k, 48, W).offset).sort((a, b) => a - b);
  for (let k = 1; k < 48; k += 1) assert.ok(Math.abs(offs[k] - offs[k - 1] - W / 48) < 1, 'evenly spread');
  assert.ok(offs[0] >= 0 && offs[47] < W);
  assert.equal(heldOffset(t0 + W + 1000, 0, 48, W).turn, 1); assert.ok(Math.abs(heldOffset(t0 + W + 1000, 0, 48, W).offset - 1000) < 1e-6);
  // A resident's time while it is held: the held moment and their own way into the window.
  const tt = fleetTime(clock, clockTime(t0 + 999_999) + offs[10]);
  assert.equal(tt.ms, t0 + offs[10]);
  // Let go, it runs on from where it stood; and the hold is kept between visits.
  assert.deepEqual(clockHoldState(), { at: t0, skew: 0 });
  releaseClock(t0 + 600_000);
  assert.equal(clockTime(t0 + 600_000), t0); assert.equal(clockTime(t0 + 660_000), t0 + 60_000);
  assert.deepEqual(clockHoldState(), { at: null, skew: 600_000 });
  restoreClockHold({ at: t0 + 5, skew: 0 }); assert.equal(clockTime(t0 + 9e9), t0 + 5);
  restoreClockHold(null); assert.equal(clockHoldState(), null);
});

test('a street with an island in it is crossed in one go; two round a corner stay two', () => {
  const join = (pave) => City.prototype.joinDivided.call({ wallFixes: {} }, pave);
  // East along z = 0: a carriageway 0-7 m, an island 7-10 m, the other carriageway 10-17 m.
  const straight = { pts: [[-10, 0], [30, 0]], s: [0, 40], length: 40, crossings: [{ s0: 10, s1: 17, node: 1, bearing: 0, signal: true }, { s0: 20, s1: 27, node: undefined, bearing: 0, signal: false, path: true }] };
  const one = join(straight);
  assert.equal(one.crossings.length, 1);
  assert.deepEqual([one.crossings[0].s0, one.crossings[0].s1, one.crossings[0].signal, one.crossings[0].divided], [10, 27, true, true]);
  // Over one street, a turn at the corner, over the next: each its own, with its own light.
  const corner = { pts: [[0, 0], [12, 0], [12, 14]], s: [0, 12, 26], length: 26, crossings: [{ s0: 2, s1: 10, node: 1, bearing: 0, signal: true }, { s0: 14, s1: 24, node: 1, bearing: 1.57, signal: true }] };
  assert.equal(join(corner).crossings.length, 2);
  // Too far apart to be one street's two halves.
  const apart = { ...straight, crossings: [{ s0: 2, s1: 8, signal: false }, { s0: 25, s1: 32, signal: false }] };
  assert.equal(join(apart).crossings.length, 2);
});

test('the page waits at a kerb, never in a roadway, and cuts paving off a car park along its outline', () => {
  const view = readFileSync(new URL('../docs/city/view.mjs', import.meta.url), 'utf8');
  assert.ok(view.includes('for (const cr of list) if (walk.d > cr.s0 + 0.05 && walk.d < cr.s1 - 0.05) return false;'));
  assert.ok(view.includes('const room = other ? (walk.dir > 0 ? cr.s0 - other.s1 : other.s0 - cr.s1) - KERB_CLEAR_M : Infinity;'));
  assert.ok(view.includes('scenes.step(Math.min(dt, 0.1), now, tsec);') && view.includes('district.city.timeFor = clockHeld() ? timeFor : null;'));
  const trees = readFileSync(new URL('../src/smc/renderer/page/module/17-trees-a-trunk-limbs-and.js', import.meta.url), 'utf8');
  assert.ok(trees.includes('function cutCoverOffLots(mesh)') && trees.includes('if (lotCut) cut += cutCoverOffLots(mesh);'));
  // The cut itself, run on a triangle that straddles a square lot's edge: what is outside stays.
  const src = trees.slice(trees.indexOf('function triangleOutsideConvex'), trees.indexOf('//: A cover\'s triangles taken off the car parks exactly'));
  const outside = new Function(`${src}; return triangleOutsideConvex;`)();
  const ring = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const area = (poly) => { let a = 0; for (let k = 0; k < poly.length; k += 1) { const p = poly[k], q = poly[(k + 1) % poly.length]; a += p[0] * q[1] - q[0] * p[1]; } return Math.abs(a) / 2; };
  const tri = [[-4, 2, 1, 0, 0], [4, 2, 0, 1, 0], [-4, 8, 0, 0, 1]];
  const kept = outside(tri, ring);
  assert.ok(Math.abs(kept.reduce((a, poly) => a + area(poly), 0) - (area(tri) - 6)) < 1e-6, 'all of it but the part in the lot');
  for (const poly of kept) for (const q of poly) { assert.ok(q[0] <= 1e-9, 'nothing kept inside'); assert.ok(Math.abs(q[2] + q[3] + q[4] - 1) < 1e-9, 'weights on the corners'); }
  assert.equal(outside([[-5, 0, 1, 0, 0], [-1, 0, 0, 1, 0], [-3, 4, 0, 0, 1]], ring), null, 'one wholly outside is left as it is');
  assert.deepEqual(outside([[2, 2, 1, 0, 0], [6, 2, 0, 1, 0], [4, 6, 0, 0, 1]], ring), [], 'one wholly inside goes');
});
