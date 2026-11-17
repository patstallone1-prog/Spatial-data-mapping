// The memory pass (docs/47-memory-trim.md): what is kept is kept once and compactly, what is
// thrown away every frame is not made, and the city's server answers a poll without rebuilding
// the world -- each with the same answers as before.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { Drivers } from "../docs/city/fleet.mjs";
import { LANE, Streets, alongRoute } from "../docs/city/people.mjs";
import { triangleGroundSampler } from "../docs/grass-strands.mjs";
import { compressPending, coolRestored, makeRecoverable } from "../docs/recoverable-geometry.mjs";
import { deflateSync, inflateSync } from "../docs/vendor/fflate-0.8.2.mjs";
import { CellCache } from "../docs/world-streaming.mjs";
import { keyHash, playerId } from "../server/city/auth.mjs";
import { CityAuthority } from "../server/city/authority.mjs";
import { loadCity } from "../server/city/http.mjs";
import { MemoryStore } from "../server/city/storage.mjs";
import { leaks, viewFor } from "../server/city/views.mjs";
import { run as loadTest } from "../tools/city_load_test.mjs";

const text = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const codec = { deflateSync, inflateSync };

test("a cell is kept as its text: every reader has an object of its own, and nothing is fetched twice", async () => {
  let fetched = 0;
  const body = JSON.stringify({ rows: [[0, { id: 7, at: [1, 2] }]], n: 3 });
  const cache = new CellCache({ fetcher: async () => { fetched += 1; return { ok: true, status: 200, text: async () => body }; } });
  const a = await cache.load("https://site.test/cells/1_2.json"), b = await cache.load("https://site.test/cells/1_2.json");
  assert.deepEqual(a, JSON.parse(body));
  assert.notEqual(a, b, "two readers, two objects");
  a.rows[0][1].at.push(9); a.n = 0;
  assert.deepEqual(b, JSON.parse(body), "one reader's writing is not another's");
  assert.deepEqual(await cache.load("https://site.test/cells/1_2.json"), JSON.parse(body), "nor the cache's");
  assert.equal(fetched, 1);
  const snap = cache.snapshot();
  assert.equal(snap.textBytes, body.length, "what is held is the text");
  assert.equal(snap.residentBytes, body.length * 4, "budgeted as what a reader will hold");
  assert.ok(!text("../docs/world-streaming.mjs").includes("then(structuredClone)"), "no second whole copy is made for a reader");
});

test("a buffer already on the GPU is packed at once, read back exactly, and let go again when the reading stops", () => {
  const original = Float32Array.from({ length: 6000 }, (_, i) => (i % 40) * 0.5);
  const a = { array: original.slice(), version: 0, onUploadCallback() {}, onUpload(fn) { this.onUploadCallback = fn; return this; } };
  assert.equal(makeRecoverable(a, codec, { uploaded: true }), true);
  compressPending();
  assert.ok(a.recoverableHeld < original.byteLength / 2, "only the packed copy is held");
  assert.equal(a.recoverableLength, original.length);
  // A reader (a ray cast) gets the same numbers back: the whole array is held while it reads.
  assert.deepEqual(Array.from(a.array), Array.from(original));
  assert.ok(a.recoverableHeld > original.byteLength);
  coolRestored(); assert.deepEqual(Array.from(a.array), Array.from(original));   // still being read
  assert.ok(a.recoverableHeld > original.byteLength, "kept whole while it is read");
  for (let i = 0; i < 4; i += 1) coolRestored();
  assert.ok(a.recoverableHeld < original.byteLength / 2, "let go again once nothing reads it");
  assert.deepEqual(Array.from(a.array), Array.from(original), "and exact when next asked for");
});

test("a buffer that keeps changing is left whole: packing it after every change would cost more than it saves", () => {
  const a = { array: new Float32Array(4000).fill(1), version: 0, onUploadCallback() {}, onUpload(fn) { this.onUploadCallback = fn; return this; } };
  makeRecoverable(a, codec);
  for (let i = 0; i < 12; i += 1) { a.array[i] = i; a.version += 1; a.onUploadCallback(); compressPending(); }
  assert.equal(a.recoverableHeld, a.array.byteLength, "held whole, with no packed copy beside it");
  assert.equal(a.array[11], 11);
});

test("the grass's ground sampler gives the heights the triangles give, from one flat array", () => {
  // Two triangles of a tilted square and a second sheet above part of it.
  const P = new Float32Array([0, 0, 0, 8, 2, 0, 8, 4, 8, 0, 2, 8, 2, 9, 2, 6, 9, 2, 6, 9, 6]);
  const I = new Uint16Array([0, 1, 2, 0, 2, 3, 4, 5, 6]);
  const attr = (array, itemSize) => ({ array, itemSize, count: array.length / itemSize, getX: (i) => array[i * itemSize], getY: (i) => array[i * itemSize + 1], getZ: (i) => array[i * itemSize + 2] });
  const mesh = { geometry: { getAttribute: () => attr(P, 3), getIndex: () => attr(I, 1) } };
  const at = triangleGroundSampler([mesh]);
  // The plain reading: the highest triangle over the point, by barycentric weights.
  const plain = (x, z) => {
    let y = null;
    for (let t = 0; t < I.length; t += 3) {
      const [a, b, c] = [0, 1, 2].map((k) => [P[I[t + k] * 3], P[I[t + k] * 3 + 1], P[I[t + k] * 3 + 2]]);
      const den = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
      if (Math.abs(den) < 1e-10) continue;
      const u = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / den, v = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / den, w = 1 - u - v;
      if (Math.min(u, v, w) < -1e-7) continue;
      const h = a[1] * u + b[1] * v + c[1] * w; y = y === null ? h : Math.max(y, h);
    }
    return y;
  };
  for (const [x, z] of [[1, 1], [7, 1], [4, 4], [5, 3], [3, 7], [7.9, 7.9], [0.1, 7.5]]) assert.equal(at(x, z), plain(x, z), `${x},${z}`);
  assert.equal(at(-3, 2), null); assert.equal(at(40, 40), null);
  at.clear(); assert.equal(at(4, 4), null, "let go with its world");
  assert.ok(!/\$\{x\}:\$\{z\}/.test(text("../docs/grass-strands.mjs")), "no string keys, no object a triangle");
});

test("the traffic's frame makes nothing for each person it looks at, and brakes for the same people", () => {
  const src = text("../docs/city/fleet.mjs");
  assert.ok(!src.includes("? [0, 1] : [0]"), "no list made for every person, every car, every frame");
  assert.ok(!/grid\.get\(`\$\{i\},\$\{j\}`\)/.test(src), "cells are keyed by number");
  // The same street run three ways: empty, with a crowd too far off to matter (passed over on two
  // subtractions each), and with someone stood in the lane. The far crowd changes nothing at all;
  // the one in the lane is still braked for and gone round.
  const ways = [];
  for (let k = 0; k <= 6; k += 1) {
    const along = Array.from({ length: 7 }, (_, j) => j * 120);
    ways.push({ kind: "street", pts: along.map((v) => [k * 120, v]), lanes: 2, oneway: 0, id: `v${k}`, highway: "residential", road_m: 12 });
    ways.push({ kind: "street", pts: along.map((v) => [v, k * 120]), lanes: 2, oneway: 0, id: `h${k}`, highway: "residential", road_m: 12 });
  }
  const S = new Streets(ways), route = S.route(S.nearest(0, 240, "drive"), S.nearest(720, 240, "drive"), "drive");
  const dur = route.length / 9;
  const cars = () => [0, 5].map((t0, k) => ({ id: `c${k}`, key: `c${k}:1`, route, t0, sched: (ts) => Math.max(0, Math.min(1, (ts - t0) / dur)) * route.length,
    unsched: (d) => t0 + (d / route.length) * dur, limit: 11, cruise: 11, length: 4.6, width: 1.85 }));
  const drive = (people) => {
    const D = new Drivers(S), list = cars(), trace = [];
    let slowest = Infinity;
    for (let t = 0; t < 60; t += 0.05) {
      const r = D.step(0.05, t, list.filter((c) => t >= c.t0), people.map((q) => ({ ...q })));
      const lead = r.cars.find((c) => c.id === "c0");
      if (lead && t > 6 && !lead.arrived) slowest = Math.min(slowest, lead.v);
      if (Math.round(t * 20) % 100 === 0) trace.push(r.cars.map((c) => [c.id, +c.d.toFixed(6), +c.v.toFixed(6)]));
    }
    return { trace, slowest, tally: D.tally };
  };
  const empty = drive([]);
  const crowd = Array.from({ length: 400 }, (_, k) => ({ id: `far${k}`, x: 200 + (k % 20) * 17, z: 600 + Math.floor(k / 20) * 9 }));
  assert.deepEqual(drive(crowd).trace, empty.trace, "people nowhere near the street change nothing");
  assert.equal(empty.tally.dodges, 0, "nothing in the way: nothing gone round");
  const at = alongRoute(route, 300, (h, c, p) => LANE(h, c, p));
  const stood = drive([{ id: "you", x: at.x, z: at.z, player: true }]);
  assert.ok(stood.tally.dodges >= 1, "someone stood in the lane is still braked for and gone round");
  assert.notDeepEqual(stood.trace, empty.trace);
});

test("the city's server answers a poll from the world it keeps: no store call, no rebuild, the same view", async () => {
  const { R, canon } = loadCity();
  const homes = [...canon.places.values()].filter((p) => p.use === "residential");
  const store = new MemoryStore(), calls = { version: 0, load: 0 };
  const version = store.version.bind(store), load = store.load.bind(store);
  store.version = async (id) => { calls.version += 1; return version(id); };
  store.load = async (id) => { calls.load += 1; return load(id); };
  const clock = { t: Date.UTC(2026, 10, 20, 18) };
  const A = new CityAuthority({ R, canon, store, secret: "memory-trim-secret", now: () => clock.t });
  const people = [];
  for (let i = 0; i < 3; i += 1) {
    const key = `memory-trim-device-${i}-00000000`, token = (await A.handle({ op: "session", key })).token, at = { x: homes[i].x + 3, z: homes[i].z };
    const joined = await A.handle({ op: "cmd", token, command: "join", args: { name: `P${i}`, home: { id: homes[i].id }, at } });
    assert.equal(joined.result.ok, true);
    people.push({ token, at, pid: playerId(keyHash(key)) });
  }
  const first = await A.handle({ op: "sync", token: people[2].token, since: 0 });
  assert.ok(first.ok && first.state);
  // Twenty polls within the freshness window: the store is not asked again, the record is not read again.
  calls.version = 0; calls.load = 0;
  for (let i = 0; i < 20; i += 1) {
    clock.t += 25;
    const r = await A.handle({ op: "sync", token: people[i % 3].token, since: i % 2 ? first.version : 0 });
    assert.ok(r.ok);
    if (i % 2) assert.equal(r.unchanged, true); else assert.ok(r.state);
  }
  assert.equal(calls.version, 0, "no version asked of the store for polls a moment apart");
  assert.equal(calls.load, 0, "the record is not read again");
  // What a poll shows is what the stored world shows that player, and nothing of anyone else's.
  const { CityWorld } = await import("../docs/city/world.mjs");
  const stored = CityWorld.fromJSON(R, structuredClone(store.worlds.get("kerbside").state.world));
  const shown = (await A.handle({ op: "sync", token: people[2].token, since: 0 })).state;
  const fresh = viewFor(stored, people[2].pid);
  assert.deepEqual(new Map(shown.ledger.accounts), new Map(fresh.ledger.accounts));
  assert.deepEqual(shown.players.map((p) => p.id).sort(), fresh.players.map((p) => p.id).sort());
  assert.deepEqual(leaks(shown, people[2].pid, stored), []);
  // An action by another is seen at the next poll (the kept world is made again from the new record)...
  const paid = await A.handle({ op: "cmd", token: people[0].token, command: "give_money", args: { to: people[1].pid, amount: 700, at: people[0].at } });
  assert.equal(paid.result.ok, true);
  const after = await A.handle({ op: "sync", token: people[1].token, since: first.version });
  assert.equal(new Map(after.state.ledger.accounts).get(`player:${people[1].pid}`).balance, R.start.balance + 700);
  // ...and a refused action leaves nothing behind in it.
  const refused = await A.handle({ op: "cmd", token: people[2].token, command: "give_money", args: { to: people[0].pid, amount: 10 ** 12, at: people[2].at } });
  assert.equal(refused.result.ok, false);
  const still = await A.handle({ op: "sync", token: people[2].token, since: 0 });
  assert.equal(new Map(still.state.ledger.accounts).get(`player:${people[2].pid}`).balance, R.start.balance);
  // Another instance's commit is found once the freshness window has passed.
  const B = new CityAuthority({ R, canon, store, secret: "memory-trim-secret", now: () => clock.t });
  const tokenB = (await B.handle({ op: "session", key: "memory-trim-device-0-00000000" })).token;
  assert.equal((await B.handle({ op: "cmd", token: tokenB, command: "give_money", args: { to: people[2].pid, amount: 300, at: people[0].at } })).result.ok, true);
  clock.t += 1000;
  const seen = await A.handle({ op: "sync", token: people[2].token, since: still.version });
  assert.equal(new Map(seen.state.ledger.accounts).get(`player:${people[2].pid}`).balance, R.start.balance + 300);
});

test("the load test runs: players poll and act against a slow store, and every request is answered", async () => {
  const r = await loadTest({ players: 6, instances: 2, seconds: 1.2, storeMs: 2, actEveryS: 0.4, syncMs: 150 });
  assert.equal(r.errors, 0);
  assert.ok(r.requests_per_s > 10 && r.actions.done > 0 && r.actions.busy === 0, JSON.stringify(r));
  assert.ok(r.store_calls_per_request < 1.5, "polls do not each ask the store");
});
