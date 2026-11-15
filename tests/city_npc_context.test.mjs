import test from 'node:test';
import assert from 'node:assert/strict';
import { groupNpcs, buildNpcContext } from '../docs/city/npc-context.mjs';

const people = (n) => Array.from({ length: n }, (_, i) => ({ id: `p:${String(i).padStart(3, '0')}`, name: `Person ${i}`, age: 30, role: i < n / 2 ? 'barista' : 'mechanic' }));
const time = { day: 20000, minute: 600, weekday: 4 };
const city = {
  about(p) { return { career: { status: 'employed', role: p.role, title: p.role, history: [{ role: 'clerk' }] }, books: { balance: Number(p.id.slice(2)) * 100, lines: [{ kind: 'pay', amount: 100 }] }, travel: 'walk', milestones: [{ at: 650, place: 'work' }] }; },
  planOf() { return { segs: [{ kind: 'go', mode: 'bus', from: 'home', to: 'work', t0: 620, t1: 640 }] }; },
};

test('groups are deterministic, sized and favor matching occupations', () => {
  const list = people(80);
  const groups = groupNpcs({ people: list, city, time });
  assert.deepEqual(groups, groupNpcs({ people: [...list].reverse(), city, time }));
  assert.ok(groups.every((g) => g.memberIds.length >= 8 && g.memberIds.length <= 12));
  assert.equal(new Set(groups.flatMap((g) => g.memberIds)).size, list.length);
  assert.ok(groups.every((g) => new Set(g.memberIds.map((id) => list.find((p) => p.id === id).role)).size === 1));
  assert.ok(groups.every((g) => g.backstory.split(/[.!?]+/).filter((s) => s.trim()).length >= 2));
});

test('small remainders are explicit and previous groups survive growth', () => {
  const list = people(12).map((p) => ({ ...p, role: 'barista' }));
  const initial = groupNpcs({ people: list.slice(0, 5), city, time });
  assert.equal(initial[0].undersized, true);
  const expanded = groupNpcs({ people: list, city, time, previousGroups: initial });
  assert.equal(expanded[0].id, initial[0].id);
  assert.equal(expanded[0].backstory, initial[0].backstory);
  assert.equal(expanded[0].memberIds.length, 12);
  assert.equal(expanded[0].undersized, false);
  const awkward = groupNpcs({ people: people(13), city, time });
  assert.equal(awkward.reduce((s, g) => s + g.memberIds.length, 0), 13);
  assert.ok(awkward.some((g) => g.undersized));
});

test('context uses individual live balances, debt, history and planned routes', () => {
  const list = people(10), groups = groupNpcs({ people: list, city, time });
  const world = { billing: { owed(id) { return id === list[0].id ? 23 : 0; } }, harm: new Map([[list[0].id, { history: [{ t: 5, text: 'collision' }] }]]) };
  const a = buildNpcContext({ person: list[0], city, world, time, groups });
  const b = buildNpcContext({ person: list[1], city, world, time, groups });
  assert.equal(a.version, 1); assert.equal(a.group.backstory, b.group.backstory);
  assert.equal(a.finances.balance, 0); assert.equal(b.finances.balance, 100);
  assert.equal(a.finances.debt, 23); assert.equal(b.finances.debt, 0);
  assert.deepEqual(a.history.incidents, [{ t: 5, text: 'collision' }]);
  assert.deepEqual(a.history.career, [{ role: 'clerk' }]);
  assert.deepEqual(a.travel.routes, [{ mode: 'bus', from: 'home', to: 'work', start: 620, end: 640 }]);
  world.billing.owed = () => 12;
  assert.equal(buildNpcContext({ person: list[0], city, world, time, groups }).finances.debt, 12);
});

test('visitors and children share the schema without invented finance or itinerary', () => {
  for (const p of [{ id: 'v', visitor: true, name: 'Visitor', car: 'car' }, { id: 'c', infant: true, age: 2 }]) {
    const context = buildNpcContext({ person: p });
    assert.equal(context.finances.balance, null); assert.equal(context.finances.debt, null);
    assert.equal(context.travel.routes, null); assert.equal(context.history.incidents, null);
    assert.equal(context.identity.id, p.id); assert.equal(context.version, 1);
    assert.ok(context.hobbies.values.length);
  }
});

test('cohort partition uses as many full groups as possible', () => {
  for (const n of [13, 14, 15, 16, 25]) {
    const list = people(n).map((p) => ({ ...p, role: 'barista' }));
    const groups = groupNpcs({ people: list, city, time });
    assert.equal(groups.reduce((sum, g) => sum + g.memberIds.length, 0), n);
    assert.ok(groups.every((g) => g.memberIds.length <= 12));
    assert.equal(groups.filter((g) => g.undersized).length, n < 16 ? 1 : 0);
    if (n < 16) assert.ok(groups.some((g) => g.memberIds.length === 8));
  }
});

test('index chunks work, preserves cohorts, and reads live world on lookup', async () => {
  const { NpcContextIndex } = await import('../docs/city/npc-context.mjs');
  const list = people(25);
  const roster = { version: 1, people: new Map(list.map((p) => [p.id, p])), visitors: new Map() };
  const index = new NpcContextIndex({ ...city, roster });
  let yields = 0;
  assert.equal(await index.ensure(time, { chunkSize: 4, yieldControl: async () => { yields++; } }), true);
  assert.ok(yields >= 6);
  const before = index.byPerson.get(list[0].id);
  assert.equal(await index.ensure(time), true);
  assert.equal(index.byPerson.get(list[0].id), before);
  const extra = { id: 'p:extra', age: 30, role: 'barista' };
  roster.people.set(extra.id, extra); roster.version++;
  assert.equal(await index.ensure(time, { chunkSize: 50 }), true);
  assert.equal(index.byPerson.get(list[0].id).id, before.id);
  assert.equal(index.byPerson.get(list[0].id).backstory, before.backstory);
  assert.ok(index.groups.every((g) => g.memberIds.length <= 12));
  const world = { billing: { owed: () => 9 }, harm: new Map() };
  assert.equal(index.contextFor(list[0], time, world).finances.debt, 9);
  world.billing.owed = () => 4;
  assert.equal(index.contextFor(list[0], time, world).finances.debt, 4);
  roster.version++;
  let changed = false;
  assert.equal(await index.ensure(time, { chunkSize: 2, yieldControl: async () => { if (!changed) { roster.version++; changed = true; } } }), false);
});

test('real city and roster expose resident, child and visitor context consistently', async () => {
  const { readFileSync } = await import('node:fs');
  const { cityTime, loadRules } = await import('../docs/city/core.mjs');
  const { City, Roster } = await import('../docs/city/fleet.mjs');
  const { Streets, placeFromBuilding } = await import('../docs/city/people.mjs');
  const { NpcContextIndex } = await import('../docs/city/npc-context.mjs');
  const R = loadRules(JSON.parse(readFileSync(new URL('../docs/city/rules.json', import.meta.url))));
  const ways = [];
  for (let i = 0; i <= 4; i++) {
    const coords = Array.from({ length: 5 }, (_, j) => j * 100);
    ways.push({ kind: 'street', pts: coords.map((v) => [i * 100, v]), lanes: 2, oneway: 0, id: `v${i}` });
    ways.push({ kind: 'street', pts: coords.map((v) => [v, i * 100]), lanes: 2, oneway: 0, id: `h${i}` });
  }
  const streets = new Streets(ways), roster = new Roster(R, { seed: 'context-test' });
  const places = [];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    const k = 4 * i + j;
    const p = placeFromBuilding({ id: `b${k}`, x: i * 100 + 50, z: j * 100 + 50, archetype: 'residential', floors: 3, area: 300,
      shops: k % 4 === 0 ? [{ t: 'cafe', n: 'Cafe' }] : [], name: `${100 + k} Test Street`, tag: 'apartments' }, streets, R);
    if (p) places.push(p);
  }
  roster.add(places); roster.visitorsUpTo(3);
  const timeAt = (ms) => cityTime(ms, R.clock.zone);
  const t = timeAt(Date.UTC(2026, 9, 6, 19));
  const actualCity = new City(R, roster, streets, { seed: 'context-test', timeAt });
  const index = new NpcContextIndex(actualCity);
  assert.equal(await index.ensure(t, { chunkSize: 20, yieldControl: async () => {} }), true);
  const adult = [...roster.people.values()].find((p) => !p.infant && p.age >= 18);
  const child = [...roster.people.values()].find((p) => p.infant);
  const visitor = [...roster.visitors.values()][0];
  assert.ok(adult && child && visitor);
  const savedRoster = JSON.parse(JSON.stringify(roster.toJSON()));
  assert.ok(savedRoster.npcGroups.length);
  const reloadedRoster = new Roster(R, { seed: 'context-test', saved: savedRoster });
  reloadedRoster.add(places);
  reloadedRoster.visitorsUpTo(3);
  const reloadedCity = new City(R, reloadedRoster, streets, { seed: 'context-test', timeAt });
  const reloadPending = reloadedCity.characterContext(reloadedRoster.people.get(adult.id), t);
  assert.equal(await reloadPending.ready, true);
  const reloadedContext = reloadedCity.characterContext(reloadedRoster.people.get(adult.id), t).context;
  assert.equal(reloadedContext.group.id, index.byPerson.get(adult.id).id);
  assert.equal(reloadedContext.group.backstory, index.byPerson.get(adult.id).backstory);
  const pending = actualCity.characterContext(adult, t);
  assert.equal(pending.state, 'pending');
  assert.equal(await pending.ready, true);
  const runtimeWorld = { billing: { owed: () => 31 }, harm: new Map() };
  const ready = actualCity.characterContext(adult, t, runtimeWorld);
  assert.equal(ready.state, 'ready');
  assert.equal(ready.context.finances.debt, 31);
  assert.ok(ready.context.group?.backstory);
  runtimeWorld.billing.owed = () => 7;
  assert.equal(actualCity.characterContext(adult, t, runtimeWorld).context.finances.debt, 7);
  assert.equal(actualCity.characterContext(adult, { ...t, day: t.day + 1 }).state, 'pending');
  const adultContext = index.contextFor(adult, t);
  assert.equal(adultContext.finances.balance, actualCity.about(adult, t).books.balance);
  assert.equal(adultContext.finances.balanceState, 'current');
  assert.equal(adultContext.identity.age, adult.age);
  for (const p of [child, visitor]) {
    const c = index.contextFor(p, t);
    assert.equal(c.finances.balance, null); assert.equal(c.finances.balanceState, 'unavailable');
    assert.equal(c.identity.age, p.age ?? null); assert.ok(c.group?.backstory);
    assert.equal(c.identity.visitor, Boolean(p.visitor));
  }
});

test('saved cohorts survive partial loading and profile changes create a transition', async () => {
  const { NpcContextIndex } = await import('../docs/city/npc-context.mjs');
  const list = people(20).map((p) => ({ ...p, role: 'barista' }));
  const roster = { version: 1, people: new Map(list.map((p) => [p.id, p])), visitors: new Map(), saved: {} };
  const first = new NpcContextIndex({ ...city, roster });
  await first.ensure(time, { chunkSize: 100 });
  const original = first.byPerson.get(list[0].id);
  const saved = JSON.parse(JSON.stringify(roster.saved));
  const restoredRoster = { version: 1, people: new Map(list.slice(0, 5).map((p) => [p.id, p])), visitors: new Map(), saved };
  const restored = new NpcContextIndex({ ...city, roster: restoredRoster });
  await restored.ensure(time, { chunkSize: 100 });
  assert.equal(restored.byPerson.get(list[0].id).id, original.id);
  for (const p of list.slice(5)) restoredRoster.people.set(p.id, p);
  restoredRoster.version++;
  await restored.ensure(time, { chunkSize: 100 });
  assert.equal(restored.byPerson.get(list[0].id).id, original.id);
  assert.equal(restored.byPerson.get(list[0].id).backstory, original.backstory);
  const changed = { ...list[0], role: 'mechanic' };
  restoredRoster.people.set(changed.id, changed); restoredRoster.version++;
  await restored.ensure(time, { chunkSize: 100 });
  const context = restored.contextFor(changed, time);
  assert.notEqual(context.group.id, original.id);
  assert.deepEqual(context.group.transition, { from: original.id, to: context.group.id, reason: 'profile_changed' });
  assert.equal(context.job.role, 'mechanic');
});
