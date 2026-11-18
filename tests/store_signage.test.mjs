// A shop's sign: what the owner may choose (docs/interior-lab/signage.mjs), kept with the design
// by the world, and built for the street.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import * as THREE from '../docs/vendor/three-0.160.0/three.module.min.js';
import { AWNING_TYPES, NAME_SIZES, NAME_STYLES, SIGN_MEDIA, SIGNAGE_SCHEMA, TAGLINE_MAX, buildSignage, drawSign, normalizeSignage, sameSignage, signLayout } from '../docs/interior-lab/signage.mjs';

test('a sign is only ever what the editor offers', () => {
  assert.equal(normalizeSignage(null), null);
  assert.equal(normalizeSignage('awning'), null);
  const s = normalizeSignage({ medium: 'hologram', awning: { type: 'pagoda', colour: 'red', stripe: '#ABCDEF' }, name: { size: 'huge', colour: '#12345', style: 'comic' },
    tagline: { text: `  Beer \n Wine <b>Spirits</b> ${'x'.repeat(200)}`, colour: 'javascript:alert(1)' }, extra: { anything: true } });
  assert.equal(s.schema, SIGNAGE_SCHEMA);
  assert.ok(Object.hasOwn(SIGN_MEDIA, s.medium) && Object.hasOwn(AWNING_TYPES, s.awning.type) && Object.hasOwn(NAME_SIZES, s.name.size) && Object.hasOwn(NAME_STYLES, s.name.style));
  for (const c of [s.awning.colour, s.awning.stripe, s.board.colour, s.name.colour, s.tagline.colour]) assert.match(c, /^#[0-9a-f]{6}$/);
  assert.equal(s.awning.stripe, '#abcdef');
  assert.ok(s.tagline.text.length <= TAGLINE_MAX && !/[<>\n]/.test(s.tagline.text) && s.tagline.text.startsWith('Beer Wine'));
  assert.equal(s.extra, undefined);
  assert.deepEqual(normalizeSignage(s), s, 'kept as it is once it is clean');
  assert.ok(sameSignage(s, { ...s, extra: 1 }) && !sameSignage(s, { ...s, medium: 'painted' }));
});

test('every choice of medium, awning, size and lettering is offered and lays out', () => {
  assert.deepEqual(Object.keys(SIGN_MEDIA).sort(), ['awning', 'board', 'painted', 'standing']);
  assert.ok(['sloped', 'striped', 'dome', 'flat'].every((t) => Object.hasOwn(AWNING_TYPES, t)));
  assert.ok(NAME_SIZES.small < NAME_SIZES.medium && NAME_SIZES.medium < NAME_SIZES.large);
  const big = signLayout({ name: { size: 'large' } }, 'Bob’s Liquor', 6), small = signLayout({ name: { size: 'small' } }, 'Bob’s Liquor', 6);
  assert.ok(big.nameH > small.nameH);
  const plain = signLayout({}, 'Bob’s Liquor', 5), lined = signLayout({ tagline: { text: 'Beer · Wine · Spirits · Ice' } }, 'Bob’s Liquor', 5);
  assert.equal(plain.tagH, 0);
  assert.ok(lined.tagH > 0 && lined.tagH < lined.nameH && lined.height > plain.height, 'the line under the name is smaller, and makes room for itself');
  // A long name on a narrow front is lettered smaller, not off the end.
  const long = signLayout({ name: { size: 'large' } }, 'The Marina Fine Wines and Spirits Emporium', 3);
  assert.ok(long.nameH < NAME_SIZES.large && long.name.length * long.nameH * 0.6 <= long.width);
  assert.equal(signLayout({ name: { style: 'stencil' } }, 'corner shop').name, 'CORNER SHOP');
});

//: A canvas that records what is lettered on it.
const canvasOf = (w, h) => {
  const said = [];
  const ctx = new Proxy({ measureText: (t) => ({ width: t.length * 20 }), fillText: (t) => said.push(t) }, { get: (o, k) => (k in o ? o[k] : () => {}), set: () => true });
  return { width: w, height: h, said, getContext: () => ctx };
};

test('each kind of sign is built over the door with the name and its line on it', () => {
  for (const medium of Object.keys(SIGN_MEDIA)) for (const type of medium === 'awning' ? Object.keys(AWNING_TYPES) : ['-']) {
    const made = [];
    const g = buildSignage(THREE, { medium, awning: { type }, tagline: { text: 'Beer · Wine · Spirits' } }, { name: 'Bob’s Liquor', frontage: 5, canvasOf: (w, h) => { const c = canvasOf(w, h); made.push(c); return c; } });
    assert.ok(g.children.length >= 1, `${medium}/${type} has parts`);
    const lettered = g.children.filter((m) => m.userData.lettering);
    assert.ok(lettered.length >= 1, `${medium}/${type} carries the name`);
    const said = made.flatMap((c) => c.said);
    assert.ok(said.includes('Bob’s Liquor') && said.includes('Beer · Wine · Spirits'), `${medium}/${type} letters the name and the line`);
    const box = new THREE.Box3().setFromObject(g);
    assert.ok(box.min.y > -0.01 && box.max.y < 5 && box.min.z > -0.2 && box.max.z < 3, `${medium}/${type} stands on the front, over the pavement: ${JSON.stringify(box)}`);
    if (medium !== 'standing') assert.ok(box.min.y > 1.9, `${medium}/${type} clears the door`);
    assert.equal(g.userData.signage.medium, medium);
  }
  assert.equal(buildSignage(THREE, null, { canvasOf }).children.length, 0, 'no sign set: nothing is put up');
  const c = canvasOf(512, 128);
  drawSign(c.getContext('2d'), { medium: 'painted' }, signLayout({ medium: 'painted' }, 'Shop'), 512, 128);
  assert.deepEqual(c.said, ['Shop']);
});

test('the editor has the Signage window, and the world keeps the sign clean', () => {
  const html = readFileSync(new URL('../docs/interior-lab/index.html', import.meta.url), 'utf8'), lab = readFileSync(new URL('../docs/interior-lab/lab.mjs', import.meta.url), 'utf8');
  for (const id of ['signage', 'signage-dialog', 'signage-preview', 'signage-form', 'signage-remove', 'signage-done']) assert.ok(html.includes(`id="${id}"`), id);
  for (const word of ["'Where the name goes'", "'Awning type'", "'Awning colour'", "'Stripe colour'", "'Sign colour'", "'Lettering'", "'Name size'", "'Name colour'", "'Line under the name (optional)'", "'Line colour'"]) assert.ok(lab.includes(word), word);
  assert.ok(lab.includes("$('signage').hidden=!isBusiness(draft.house)"), 'only a business has a sign');
  const world = readFileSync(new URL('../docs/interior-lab/home-world.mjs', import.meta.url), 'utf8');
  assert.ok(world.includes('normalizeSignage(design.house.signage)'));
  const view = readFileSync(new URL('../docs/city/view.mjs', import.meta.url), 'utf8');
  assert.ok(view.includes('syncStoreSigns(now)') && view.includes('buildSignage(THREE, sign'));
});

// ---- through the world: a design that carries a sign ---------------------------------------------
import fs from 'node:fs';
import { createDraft } from '../docs/interior-lab/model.mjs';
import { targetForHome } from '../docs/interior-lab/world-bridge.mjs';
import { createHandoff, applyToWorld } from '../docs/interior-lab/storage.mjs';
import { CityWorld } from '../docs/city/world.mjs';
import { loadRules } from '../docs/city/core.mjs';

test('a sign set in the editor is applied with the design, kept clean, saved, and can be taken off again', () => {
  const read = (p) => JSON.parse(fs.readFileSync(new URL('../' + p, import.meta.url)));
  const R = loadRules(read('docs/city/rules.json')), world = new CityWorld(R), pid = 'owner';
  world.submit(pid, 'join', { name: 'Owner' });
  world.ledger.mint('player:owner', R.money(100000), 'account_grant');
  world.registry.register('building:store', 'building', 'player:owner', { name: 'Store' }, world.now);
  assert.equal(world.submit(pid, 'register_business', { place: { id: 'store', name: 'Store', area: 200 }, kind: 'cafe', name: 'Test Cafe' }).ok, true);
  const storage = { data: new Map(), get length() { return this.data.size; }, key(i) { return [...this.data.keys()][i]; }, getItem(k) { return this.data.get(k) ?? null; }, setItem(k, v) { this.data.set(k, v); }, removeItem(k) { this.data.delete(k); } };
  const baseline = read('docs/interior-lab/businesses/studio-cafe.json'), home = { id: 'biz:store', buildingId: 'store', propertyKind: 'business', businessKind: 'cafe', label: 'Test Cafe' };
  const access = { worldKey: 'sign-test', account: 'player:owner', homes: [home], designs: [] }, target = targetForHome(home, baseline, access), handoff = createHandoff(baseline, target, { storage });
  const draft = createDraft(baseline);
  // As the Signage window sets it -- with a part no choice offers, as a tampered request might send.
  draft.house.signage = { medium: 'awning', awning: { type: 'striped', colour: '#aa2211', stripe: '#ffffff' }, name: { size: 'large', colour: '#ffffff', style: 'serif' }, tagline: { text: 'Coffee · Pastries · Sandwiches' }, script: '<img onerror=x>' };
  const design = applyToWorld(handoff, draft, { storage });
  const done = world.submit(pid, 'customize_business', { business: home.id, baseline, design });
  assert.equal(done.ok, true, done.error);
  const kept = world.businessInteriors.get(home.id).house.signage;
  assert.deepEqual(kept, normalizeSignage(draft.house.signage));
  assert.equal(kept.script, undefined);
  assert.equal(kept.tagline.text, 'Coffee · Pastries · Sandwiches');
  const restored = CityWorld.fromJSON(R, JSON.parse(JSON.stringify(world.toJSON())));
  assert.deepEqual(restored.businessInteriors.get(home.id).house.signage, kept, 'saved with the world');
  // Taken off: the next design has none.
  const bare = createDraft(baseline), again = applyToWorld(createHandoff(baseline, target, { storage }), bare, { storage });
  assert.equal(world.submit(pid, 'customize_business', { business: home.id, baseline, design: again }).ok, true);
  assert.equal(world.businessInteriors.get(home.id).house.signage, undefined);
});
