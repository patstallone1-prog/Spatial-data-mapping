// The city told of each change instead of asked every four seconds (docs/city/live.mjs,
// server/city/announce.mjs): the server says each committed version on the project's Realtime;
// a page hears it and asks for its own part then -- and, not hearing, asks as it did.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { HEARTBEAT_MS, RETRY_MS, cityLive, liveSocketUrl, readLive, syncPlan } from "../docs/city/live.mjs";
import { readLiveInfo } from "../docs/city/server-client.mjs";
import { liveInfo, liveTopic, realtimeAnnouncer } from "../server/city/announce.mjs";
import { CityAuthority } from "../server/city/authority.mjs";
import { SUPABASE, liveFrom, loadCity } from "../server/city/http.mjs";
import { MemoryStore } from "../server/city/storage.mjs";

const TOPIC = "kerbside-city:kerbside";

//: A WebSocket the test drives: what the page sent, and the server's side to answer with.
function fakeSockets() {
  const made = [];
  class FakeSocket {
    constructor(url) { this.url = url; this.sent = []; made.push(this); }
    send(text) { this.sent.push(JSON.parse(text)); }
    close() { this.closed = true; }
    // The server's side.
    open() { this.onopen?.(); }
    say(m) { this.onmessage?.({ data: JSON.stringify(m) }); }
    drop() { this.onclose?.(); }
  }
  return { FakeSocket, made };
}
//: Timers the test runs by hand.
function fakeTimers() {
  const T = { once: [], every: [] };
  return { T, setTimer: (f, ms) => { const t = { f, ms }; T.once.push(t); return t; }, clearTimer: (t) => { T.once = T.once.filter((x) => x !== t); },
    setRepeat: (f, ms) => { const t = { f, ms }; T.every.push(t); return t; }, clearRepeat: (t) => { T.every = T.every.filter((x) => x !== t); } };
}

test("the page listens on the project's Realtime, signed with the publishable key", () => {
  const url = liveSocketUrl(SUPABASE.url, SUPABASE.key);
  assert.match(url, /^wss:\/\/[a-z]+\.supabase\.co\/realtime\/v1\/websocket\?/);
  assert.equal(new URL(url).searchParams.get("apikey"), SUPABASE.key);
  assert.equal(new URL(url).searchParams.get("vsn"), "1.0.0");
  assert.equal(liveSocketUrl("ftp://x", "k"), null);
});

test("only a version on the city's own topic is heard; anything else is not", () => {
  const v = (version, topic = TOPIC) => ({ topic: `realtime:${topic}`, event: "broadcast", payload: { event: "version", payload: { version } } });
  assert.deepEqual(readLive(JSON.stringify(v(41)), TOPIC), { kind: "version", version: 41 });
  assert.equal(readLive(v(41, "someone-else"), TOPIC), null);
  for (const bad of [0, -3, 1.5, "7", null, 2 ** 60]) assert.equal(readLive(v(bad), TOPIC), null, String(bad));
  assert.equal(readLive("not json", TOPIC), null);
  assert.equal(readLive({ topic: `realtime:${TOPIC}`, event: "broadcast", payload: { event: "state", payload: { version: 3 } } }, TOPIC), null);
  assert.deepEqual(readLive({ topic: `realtime:${TOPIC}`, event: "phx_reply", ref: "join", payload: { status: "ok" } }, TOPIC), { kind: "joined" });
  assert.equal(readLive({ topic: `realtime:${TOPIC}`, event: "phx_reply", ref: "join", payload: { status: "error", response: { reason: "no public channels" } } }, TOPIC).kind, "refused");
});

test("joined, it hears each version; dropped, it tries again, longer each time; closed, it stops", () => {
  const { FakeSocket, made } = fakeSockets(), timers = fakeTimers(), heard = [], states = [];
  const live = cityLive({ url: SUPABASE.url, key: SUPABASE.key, topic: TOPIC, WebSocket: FakeSocket, onVersion: (v) => heard.push(v), onState: (s) => states.push(s), ...timers });
  assert.equal(made.length, 1);
  const s = made[0];
  s.open();
  assert.deepEqual(s.sent[0].event, "phx_join");
  assert.equal(s.sent[0].topic, `realtime:${TOPIC}`);
  assert.equal(s.sent[0].payload.config.private, false);
  assert.equal(timers.T.every[0].ms, HEARTBEAT_MS);
  timers.T.every[0].f();
  assert.deepEqual(s.sent[1].topic, "phoenix", "the heartbeat");
  assert.equal(live.state(), "connecting");
  s.say({ topic: `realtime:${TOPIC}`, event: "phx_reply", ref: "join", payload: { status: "ok" } });
  assert.equal(live.state(), "live");
  s.say({ topic: `realtime:${TOPIC}`, event: "broadcast", payload: { event: "version", payload: { version: 12 } } });
  s.say({ topic: `realtime:${TOPIC}`, event: "broadcast", payload: { event: "version", payload: { version: 13 } } });
  assert.deepEqual(heard, [12, 13]);
  // Nothing but joining and the heartbeat is ever sent.
  assert.ok(s.sent.every((m) => m.event === "phx_join" || m.event === "heartbeat"));
  // The connection drops: down, and tried again after the first wait, then longer.
  s.drop();
  assert.equal(live.state(), "down");
  assert.equal(timers.T.every.length, 0, "no heartbeat on a closed socket");
  assert.equal(timers.T.once[0].ms, RETRY_MS[0]);
  timers.T.once.shift().f();
  assert.equal(made.length, 2);
  made[1].drop();
  assert.equal(timers.T.once[0].ms, RETRY_MS[1]);
  live.close();
  assert.equal(timers.T.once.length, 0, "closed: no more tries");
  assert.deepEqual(states, ["connecting", "live", "down", "connecting", "down"]);
});

test("a page with no WebSocket, or nowhere to listen, is simply down (it asks as before)", () => {
  assert.equal(cityLive({ url: SUPABASE.url, key: SUPABASE.key, topic: TOPIC, WebSocket: null }).state(), "down");
  assert.equal(cityLive({ url: null, key: null, topic: null, WebSocket: class {} }).state(), "down");
});

test("hearing of a version, a page asks soon but not at once, and not more than once a second", () => {
  const r = () => 0.5;
  assert.equal(syncPlan({ heard: 5, have: 5, lastAsked: 0, now: 10_000, random: r }), null, "nothing new");
  assert.equal(syncPlan({ heard: 6, have: 5, lastAsked: 0, now: 10_000, random: r }), 10_200, "a moment after");
  assert.equal(syncPlan({ heard: 6, have: 5, lastAsked: 9_900, now: 10_000, random: r }), 10_900, "a second after the last ask");
  // A thousand pages hearing one version ask over the jitter, not in one instant.
  const at = Array.from({ length: 1000 }, (_, i) => syncPlan({ heard: 2, have: 1, lastAsked: -10_000, now: 0, random: () => i / 1000 }));
  assert.ok(Math.max(...at) - Math.min(...at) > 350);
});

test("the server says each committed version on the world's topic, and never waits long on it", async () => {
  const calls = [];
  const fetch = async (url, init) => { calls.push({ url, init }); return { ok: true }; };
  const say = realtimeAnnouncer({ url: `${SUPABASE.url}/`, key: SUPABASE.key, fetch });
  assert.equal(await say("kerbside", 7), true);
  assert.equal(calls[0].url, `${SUPABASE.url}/realtime/v1/api/broadcast`);
  assert.equal(calls[0].init.headers.apikey, SUPABASE.key);
  assert.deepEqual(JSON.parse(calls[0].init.body), { messages: [{ topic: liveTopic("kerbside"), event: "version", payload: { version: 7 } }] });
  // Unreachable, or slower than its time: let go, never thrown at the command.
  assert.equal(await realtimeAnnouncer({ url: SUPABASE.url, key: "k", fetch: async () => { throw new Error("down"); } })("kerbside", 8), false);
  const slow = realtimeAnnouncer({ url: SUPABASE.url, key: "k", timeout: 30, fetch: (u, init) => new Promise((ok, no) => init.signal.addEventListener("abort", () => no(new Error("aborted")))) });
  assert.equal(await slow("kerbside", 9), false);
});

test("every commit is announced, after it is made; signing in names where to listen", async () => {
  const { R, canon } = loadCity(), said = [];
  const info = liveInfo({ url: SUPABASE.url, key: SUPABASE.key }, "kerbside");
  const A = new CityAuthority({ R, canon, store: new MemoryStore(), secret: "test-signing-secret", now: () => Date.UTC(2026, 10, 20, 18),
    announce: async (world, version) => { said.push([world, version]); return true; }, liveInfo: info });
  const s = await A.handle({ op: "session", key: "ana-device-secret-000000000000" });
  assert.deepEqual(s.live, info);
  assert.deepEqual(readLiveInfo(s.live), info, "and the page reads it");
  const home = [...canon.places.values()].find((p) => p.use === "residential");
  const r = await A.handle({ op: "cmd", token: s.token, command: "join", args: { name: "ana", home: { id: home.id }, at: { x: home.x + 3, z: home.z } } });
  assert.equal(r.result.ok, true);
  assert.deepEqual(said.at(-1), ["kerbside", r.version], "the version the command made");
  // An announcement that fails changes nothing about the command.
  const B = new CityAuthority({ R, canon, store: new MemoryStore(), secret: "test-signing-secret", now: () => Date.UTC(2026, 10, 20, 18), announce: async () => { throw new Error("no"); } });
  const t = (await B.handle({ op: "session", key: "ben-device-secret-000000000000" })).token;
  assert.equal((await B.handle({ op: "cmd", token: t, command: "join", args: { name: "ben", home: { id: home.id }, at: { x: home.x + 3, z: home.z } } })).result.ok, true);
  assert.equal(s.live.key, SUPABASE.key, "the publishable key only");
});

test("deployed with the Supabase store it is on; with another store, or turned off, pages ask as before", () => {
  assert.ok(liveFrom({}).announce && liveFrom({}).liveInfo.topic === liveTopic("kerbside"));
  assert.deepEqual(liveFrom({ KERBSIDE_CITY_LIVE: "off" }), {});
  assert.deepEqual(liveFrom({ KERBSIDE_CITY_STORE: "memory" }), {});
  for (const bad of [null, {}, { url: "http://x", key: "k", topic: "t" }, { url: "https://x", key: "k", topic: "a b" }]) assert.equal(readLiveInfo(bad), null);
});

test("the City asks when told, and only now and then when not", () => {
  const view = readFileSync(new URL("../docs/city/view.mjs", import.meta.url), "utf8");
  assert.match(view, /const SYNC_LIVE_MS = 30_000;/);
  assert.match(view, /listenLive\(client\.live\);/);
  assert.match(view, /online\.live\?\.state\(\) === "live" \? SYNC_LIVE_MS : SYNC_MS/);
  assert.match(view, /if \(online\.state === "online" && syncDue\(performance\.now\(\)\)\)/);
  assert.doesNotMatch(view, /performance\.now\(\) - online\.lastSync > SYNC_MS\)/, "no fixed four-second poll");
});
