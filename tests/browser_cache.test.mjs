import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const worker = readFileSync(new URL('../tools/pwa/sw.js', import.meta.url), 'utf8');
const source = readFileSync(new URL('../scripts/build_sf_corridor_3d.py', import.meta.url), 'utf8');
const loadCode = source.slice(source.indexOf('const LOAD_MARK_KEY'), source.indexOf('//: The square:'));
const origin = 'https://kerbside.example/';
const oldName = 'kerbside-0123456789abcdef';
const currentName = 'kerbside-shell-__VERSION__';

function storage(entries = []) {
  const map = new Map(entries);
  return { map, getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)),
    removeItem: k => map.delete(k) };
}
function harness({ offline = false, initial = [], scope = origin, status = 200 } = {}) {
  const records = new Map(initial.map(k => [k, new Map()]));
  const handlers = {}, fetches = [];
  const url = key => new URL(typeof key === 'string' ? key : key.url, scope).href;
  const network = async (request, options) => {
    fetches.push({ url: url(request), options });
    if (offline) throw Error('offline');
    return new Response(`fresh:${url(request)}`, { status });
  };
  const bucket = name => {
    if (!records.has(name)) records.set(name, new Map());
    const map = records.get(name);
    return { add: async key => { const response = await network(key);
        if (!response.ok) throw Error('precache failed'); map.set(url(key), response); },
      put: async (key, response) => map.set(url(key), response),
      match: async key => map.get(url(key))?.clone() };
  };
  const caches = { open: async name => bucket(name), keys: async () => [...records.keys()],
    delete: async name => records.delete(name) };
  vm.runInNewContext(worker, { self: { location: { origin: new URL(scope).origin }, registration: { scope },
    addEventListener: (type, fn) => handlers[type] = fn, skipWaiting: async () => {},
    clients: { claim: async () => {} } }, caches, fetch: network, URL, Response, Set, Promise });
  const dispatch = async (type, request) => {
    const pending = [];
    let response;
    handlers[type]({ request, waitUntil: p => pending.push(p), respondWith: p => response = p });
    const result = response ? await response : null;
    // Includes cache puts scheduled by the fetch promise, not merely the initial event.
    while (pending.length) await Promise.all(pending.splice(0));
    return result;
  };
  return { records, fetches, bucket, caches, dispatch };
}
const request = (path, mode = 'cors', method = 'GET') => ({ url: new URL(path, origin).href, method, mode });

test('upgrade removes old runtime worlds but preserves captures and unrelated caches', async () => {
  const h = harness({ initial: [oldName, 'kerbside-shell-old', 'kerbside-captures', 'unrelated'] });
  await h.dispatch('install'); await h.dispatch('activate');
  assert.deepEqual([...h.records.keys()].sort(), [currentName, 'kerbside-captures', 'unrelated'].sort());
  assert.equal(h.records.get(currentName).size, 7);
});
test('world, cells, tiles, textures and regional pages bypass Cache Storage', async () => {
  const h = harness();
  for (const path of ['sf-corridor-3d.json', 'cells/world/c01.json', 'tiles/c13r04.json',
    'materials/wall.jpg', 'app-regions/sf-mission/app-model.html', 'app-regions/sf-mission/app-regions.json']) {
    assert.equal(await h.dispatch('fetch', request(path)), null, path);
  }
  assert.equal(h.records.size, 0); assert.equal(h.fetches.length, 0);
});
test('returning shell reads network and query variants never increase seven-file cache', async () => {
  const h = harness(); await h.dispatch('install');
  for (let i = 0; i < 10; i++) {
    const response = await h.dispatch('fetch', request(`app-model.html?at=${i},${i}`, 'navigate'));
    assert.match(await response.text(), /fresh:/);
  }
  assert.equal(h.records.get(currentName).size, 7);
  assert.equal(h.fetches.at(-1).options.cache, 'no-cache');
});
test('offline app shell works; offline regional model never gets a nested app or stale world', async () => {
  const h = harness({ offline: true, initial: [oldName, currentName] });
  await h.bucket(currentName).put(origin + 'app.html', new Response('offline app shell'));
  await h.bucket(oldName).put(origin + 'app-regions/sf-mission/app-model.html', new Response('stale model'));
  const app = await h.dispatch('fetch', request('app.html?from=home', 'navigate'));
  assert.equal(await app.text(), 'offline app shell');
  const model = await h.dispatch('fetch', request('app-regions/sf-mission/app-model.html', 'navigate'));
  assert.equal(model.status, 503);
  assert.match(await model.text(), /network connection/);
});
test('worker shell ownership respects deployment path and HTTP errors are not cached', async () => {
  const h = harness({ scope: origin + 'nested/' });
  await h.dispatch('install');
  assert.equal(await h.dispatch('fetch', request('app.html')), null);
  assert.equal(h.records.get(currentName).size, 7);
  assert.equal(await h.dispatch('fetch', request('app.html', 'cors', 'POST')), null);
  const missing = harness({ status: 404 });
  assert.equal((await missing.dispatch('fetch', request('app.html'))).status, 404);
  assert.equal(missing.records.size, 0);
});

async function loadCase({ chosen, mark, legacy, query = '', attached = false } = {}) {
  const local = storage(chosen === undefined ? [] : [['kerbside:light', chosen]]);
  if (legacy) local.setItem('kerbside:loading', JSON.stringify(legacy));
  const session = storage(mark ? [['kerbside:loading', JSON.stringify(mark)]] : []);
  const h = harness({ initial: [oldName, currentName, 'kerbside-captures', 'unrelated'] });
  const events = {}, timers = [];
  const window = { kerbsideReady: { streets: true, ground: false }, kerbsideBoot: { error: null } };
  const result = await vm.runInNewContext(`(async()=>{${loadCode}\nreturn {level:LIGHT_LEVEL,markLoadSurvived};})()`, {
    window,
    ATTACH: attached, navigator: { deviceMemory: 16, userAgent: 'Desktop', maxTouchPoints: 0 },
    localStorage: local, sessionStorage: session, caches: h.caches, location: { search: query },
    Date, Number, Math, JSON, Promise, URLSearchParams,
    addEventListener: (type, fn) => events[type] = fn,
    setTimeout: fn => timers.push(fn),
  });
  return { result, local, session, h, events, timers, window };
}
test('a second map tab or a legacy global mark cannot trigger false recovery', async () => {
  const r = await loadCase({ legacy: { at: Date.now(), level: 0 } });
  assert.equal(r.result.level, 0); assert.ok(r.h.records.has(oldName));
});
test('actual interrupted load recovers before fetches, scoped to obsolete world responses', async () => {
  const r = await loadCase({ mark: { at: Date.now(), level: 0 } });
  assert.equal(r.result.level, 1); assert.ok(!r.h.records.has(oldName));
  assert.ok(r.h.records.has(currentName) && r.h.records.has('kerbside-captures') && r.h.records.has('unrelated'));
  assert.ok(r.session.getItem('kerbside:loading'));
  r.events.pagehide(); assert.equal(r.session.getItem('kerbside:loading'), null);
});
test('a failed explicit whole/window build cannot override crash recovery forever', async () => {
  assert.equal((await loadCase({ query: '?full', mark: { at: Date.now(), level: 0 } })).result.level, 1);
  assert.equal((await loadCase({ query: '?light=1', mark: { at: Date.now(), level: 1 } })).result.level, 2);
});
test('future/expired marks and invalid persisted levels cannot create NaN build windows', async () => {
  for (const chosen of ['999', '-1', '2.9', 'not a number', 'Infinity']) {
    const r = await loadCase({ chosen, mark: { at: Date.now() + 60_000, level: 0 } });
    assert.ok(Number.isInteger(r.result.level) && r.result.level >= 0 && r.result.level <= 3);
    assert.ok(r.h.records.has(oldName));
  }
  assert.equal((await loadCase({ mark: { at: Date.now() - 16 * 60_000, level: 0 } })).result.level, 0);
  assert.equal((await loadCase({ query: '?light=2.9' })).result.level, 2);
});
test('guest region cannot write or delete the host load marker', async () => {
  const mark = { at: Date.now(), level: 2 };
  const r = await loadCase({ mark, attached: true });
  assert.equal(r.result.level, 0);
  assert.deepEqual(JSON.parse(r.session.getItem('kerbside:loading')), mark);
  assert.equal(Object.keys(r.events).length, 0);
});
test('first frame is not load success while asynchronous ground is still building', async () => {
  const r = await loadCase();
  r.result.markLoadSurvived(); assert.equal(r.timers.length, 0);
  r.window.kerbsideReady.ground = true;
  r.result.markLoadSurvived(); r.result.markLoadSurvived();
  assert.equal(r.timers.length, 1);
  r.window.kerbsideBoot.error = 'context lost'; r.timers[0]();
  assert.ok(r.session.getItem('kerbside:loading'), 'failed load remains marked');
});

test('app reports failed model load and retries only on an explicit click', () => {
  const app = readFileSync(new URL('../tools/app_template.html', import.meta.url), 'utf8');
  const code = app.slice(app.indexOf('const MODEL_STAGES'), app.indexOf('watchModel();') + 'watchModel();'.length);
  const timers = [], events = {}, nodes = {};
  for (const id of ['model', 'mapload', 'ml-fill', 'ml-pct', 'ml-stage', 'ml-retry'])
    nodes[id] = { style: {}, hidden: false, textContent: '',
      classList: { add() {}, remove() {} }, addEventListener: (type, fn) => events[id + type] = fn };
  let reloads = 0;
  nodes.model.contentWindow = { kerbsideReady: { streets: true, ground: true },
    kerbsideBoot: { error: 'Map resource failed' }, document: { getElementById: () => null },
    location: { reload: () => reloads++ } };
  vm.runInNewContext(code, { document: { getElementById: id => nodes[id] }, setTimeout: fn => timers.push(fn) });
  assert.equal(nodes['ml-pct'].textContent, 'Load stopped');
  assert.equal(nodes['ml-retry'].hidden, false); assert.equal(reloads, 0);
  events['ml-retryclick'](); assert.equal(reloads, 1);
  nodes.model.contentWindow.kerbsideBoot.error = null; timers.shift()();
  assert.equal(nodes['ml-stage'].textContent, 'Ready'); assert.equal(nodes['ml-retry'].hidden, true);
});
