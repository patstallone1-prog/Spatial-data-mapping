// The city's server (server/city, api/city.mjs): one world it alone decides, every command bound
// to the session that sent it, money that cannot be made twice, places and prices from its own
// record, each player shown only their own part, and one history whatever instances there are.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { cityClient, cityServerUrl } from "../docs/city/server-client.mjs";
import { CityWorld } from "../docs/city/world.mjs";
import { keyHash, openSession, playerId, readSession } from "../server/city/auth.mjs";
import { CityAuthority } from "../server/city/authority.mjs";
import { LIMITS, sanitize } from "../server/city/guard.mjs";
import { SUPABASE, handle, loadCity } from "../server/city/http.mjs";
import { FileStore, MemoryStore } from "../server/city/storage.mjs";
import { leaks, viewFor } from "../server/city/views.mjs";
import { buildCanon, fitProjection, project } from "../tools/build_city_canon.mjs";

const { R, canon } = loadCity();
const text = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const KEYS = { ana: "ana-device-secret-000000000000", ben: "ben-device-secret-000000000000", cy: "cy-device-secret-0000000000000" };
const homes = [...canon.places.values()].filter((p) => p.use === "residential");
const shop = [...canon.places.values()].find((p) => (p.keys || []).includes("shop:grocery")) || [...canon.places.values()].find((p) => p.shops?.length);
const near = (pl, d = 3) => ({ x: pl.x + d, z: pl.z });

//: A server on a clock the test turns, and people signed in to it.
function city({ store = new MemoryStore(), start = Date.UTC(2026, 10, 20, 18) } = {}) {
  const clock = { t: start };
  const make = () => new CityAuthority({ R, canon, store, secret: "test-signing-secret", now: () => clock.t });
  const A = make();
  const tokens = {};
  const as = async (who, server = A) => (tokens[who] ||= (await server.handle({ op: "session", key: KEYS[who] })).token);
  const cmd = async (who, command, args = {}, server = A, req = null) => server.handle({ op: "cmd", token: await as(who, server), command, args, req });
  const join = async (who, home = homes[0], server = A) => cmd(who, "join", { name: who, home: { id: home.id }, at: near(home) }, server);
  const fund = async (who, amount, server = A) => {
    store.grants.push({ id: store.grants.length + 1, key_sha256: keyHash(KEYS[who]), amount });
    return server.handle({ op: "grants", token: await as(who, server) });
  };
  const stored = () => store.worlds.get("kerbside");
  const balance = (who) => new Map(stored().state.world.ledger.accounts).get(`player:${playerId(keyHash(KEYS[who]))}`)?.balance;
  return { A, make, store, clock, as, cmd, join, fund, stored, balance, pid: (who) => playerId(keyHash(KEYS[who])) };
}

test("a command is the session's: the player is read from the token, never from what is sent", async () => {
  const c = city();
  assert.equal((await c.join("ana")).result.ok, true);
  assert.equal((await c.join("ben", homes[1])).result.ok, true);
  const before = c.balance("ana");
  // Ben names Ana as the player, every way a client might: it is still Ben who pays.
  const r = await c.A.handle({ op: "cmd", token: await c.as("ben"), pid: c.pid("ana"), command: "give_money",
    args: { to: c.pid("ana"), amount: 5000, pid: c.pid("ana"), from: c.pid("ana"), at: near(homes[1]) } });
  assert.equal(r.result.ok, true);
  assert.equal(c.balance("ana"), before + 5000, "Ana was paid");
  assert.equal(c.balance("ben"), R.start.balance - 5000, "by Ben");
  // No token, a made-up one, one signed with another secret, one altered.
  for (const token of [undefined, "abc.def", openSession("another secret", KEYS.ana).token, `${(await c.as("ana")).slice(0, -2)}xx`]) {
    assert.equal((await c.A.handle({ op: "cmd", token, command: "status", args: {} })).code, "session");
  }
  const s = openSession("test-signing-secret", KEYS.ana, 0);
  assert.equal(readSession("test-signing-secret", s.token, 1).pid, c.pid("ana"));
  assert.equal(readSession("test-signing-secret", s.token, s.exp + 1), null, "a session runs out");
  // A token whose player is not the account it was signed for is not a token.
  const body = Buffer.from(JSON.stringify({ pid: c.pid("ana"), kh: keyHash(KEYS.ben), exp: 9e15 })).toString("base64url");
  assert.equal(readSession("test-signing-secret", `${body}.${s.token.split(".")[1]}`, 1), null);
  assert.equal((await c.A.handle({ op: "session", key: "short" })).ok, false);
});

test("money is not made twice: no balance comes from a browser, and a grant is paid once", async () => {
  const c = city();
  await c.join("ana");
  const start = c.balance("ana");
  for (const [command, args] of [["import", { saved: { balance: 5_000_000_00 } }], ["account_grant", { grant: 1, amount: 5_000_000 }]]) {
    const r = await c.cmd("ana", command, { ...args, at: near(homes[0]) });
    assert.equal(r.result.ok, false, command);
  }
  assert.equal(c.balance("ana"), start);
  // The backend grants Ana money: the server pays it, once, whichever instance is asked and however often.
  const B = c.make();
  const paid = await c.fund("ana", 250_000);
  assert.deepEqual(paid.granted, [{ id: 1, amount: 250_000 }]);
  assert.deepEqual((await B.handle({ op: "grants", token: await c.as("ana") })).granted, []);
  assert.deepEqual((await c.A.handle({ op: "grants", token: await c.as("ana") })).granted, []);
  assert.equal(c.balance("ana"), start + 250_000);
  // Ben cannot take Ana's grant, and nobody who has not joined is paid one.
  c.store.grants.push({ id: 2, key_sha256: keyHash(KEYS.ana), amount: 100 });
  assert.deepEqual((await c.A.handle({ op: "grants", token: await c.as("ben") })).granted, []);
  c.store.grants.push({ id: 3, key_sha256: keyHash(KEYS.cy), amount: 100 });
  assert.equal((await c.A.handle({ op: "grants", token: await c.as("cy") })).waiting, true);
  // The page has no way left to bring a balance in, or to reconcile one on leaving a party.
  const view = text("../docs/city/view.mjs");
  for (const gone of ["savedSelf", "SAVE_SELF", '"import"', "electHost", "broadcastState", "ledger.mint(", "ledger.burn(", "account_grant"]) assert.ok(!view.includes(gone), gone);
  assert.ok(!text("../docs/kerbside-account.mjs").includes("kerbside_claim_city_grant"));
  assert.ok(!text("../docs/city/world.mjs").includes("cmd_import"));
});

test("movement is checked: on the map, and no further than could be travelled", async () => {
  const c = city();
  await c.join("ana");
  const far = homes.reduce((a, b) => (Math.hypot(b.x - homes[0].x, b.z - homes[0].z) > Math.hypot(a.x - homes[0].x, a.z - homes[0].z) ? b : a));
  const metres = Math.hypot(far.x - homes[0].x, far.z - homes[0].z);
  assert.ok(metres > 1000);
  c.clock.t += 1000;
  let r = await c.cmd("ana", "status", { at: near(far) });
  assert.deepEqual([r.result.ok, r.result.code], [false, "movement"]);
  // Where she was last seen has not moved; in the time the trip takes, it is allowed.
  c.clock.t += Math.ceil(metres / LIMITS.speed_mps) * 1000;
  assert.equal((await c.cmd("ana", "status", { at: near(far) })).result.ok, true);
  // Off the map; and a position whose longitude and latitude are not where (x, z) is.
  r = await c.cmd("ana", "status", { at: { x: canon.bounds[2] + 5000, z: 0 } });
  assert.equal(r.result.code, "bounds");
  r = await c.cmd("ana", "status", { at: { ...near(far), lon: -122.2711, lat: 37.8044 } });
  assert.equal(r.result.code, "map");
  // The server's own longitude and latitude are what the world keeps, whatever was sent.
  const [lon, lat] = canon.lonLat(far.x + 3, far.z);
  await c.cmd("ana", "status", { at: { ...near(far), lon: lon + 0.0001, lat, county: "alameda-county" } });
  const p = c.stored().state.world.players.find((x) => x.id === c.pid("ana"));
  assert.ok(Math.abs(p.lon - lon) < 1e-9 && p.county !== "alameda-county");
  // Too many commands at once is refused.
  let refused = 0;
  for (let i = 0; i < LIMITS.rate[0] + 5; i += 1) if ((await c.cmd("ana", "status", { at: near(far) })).result.code === "rate") refused += 1;
  assert.ok(refused >= 4);
});

test("what a client reports about itself is held to what can be, and to plain data", () => {
  const out = sanitize({ qty: 1e9, witnesses: -4, km: 1e6, litres: -3, walked_m: 5000, seconds: 5, item: "x".repeat(9000), nested: { occupants: 99 } });
  assert.deepEqual([out.qty, out.witnesses, out.km, out.litres, out.walked_m, out.nested.occupants], [99, 0, 300, 0, 50, 8]);
  assert.equal(out.item.length, LIMITS.string);
  assert.equal(sanitize(JSON.parse('{"__proto__": {"admin": true}, "a": 1}')).admin, undefined);
  assert.throws(() => sanitize({ a: "x".repeat(LIMITS.bytes + 1) }), /too large/);
  assert.throws(() => sanitize({ a: Array.from({ length: 500 }, () => 1) }), /too much/);
  let deep = {}; for (let i = 0; i < 12; i += 1) deep = { deep };
  assert.throws(() => sanitize(deep), /too deep/);
});

test("property is the server's record: ids from the client, everything else from the city", async () => {
  const c = city();
  const building = homes.reduce((a, b) => (a.area * Math.max(1, a.floors) < b.area * Math.max(1, b.floors) ? a : b));
  await c.join("ana", building);
  const honest = new CityWorld(R, { now: 0 }).appraise(canon.arg(building)).value;
  for (let i = 0; i < 6; i += 1) await c.fund("ana", 500_000_000);
  // The client says it is a 1 m2 shed in a cheaper county; it pays what the city's record says.
  const r = await c.cmd("ana", "buy_building", { building: { id: building.id, area: 1, floors: 1, use: "park", lon: -121.9, lat: 37.3, county: "santa-clara-county", x: 0, z: 0 }, at: near(building) });
  assert.equal(r.result.ok, true, r.result.error);
  assert.equal(r.result.price, honest);
  const record = c.stored().state.world.registry.find((a) => a.id === `building:${building.id}`);
  assert.equal(record.owner, `player:${c.pid("ana")}`);
  assert.deepEqual([record.attrs.area, record.attrs.floors, record.attrs.use, record.attrs.lon], [building.area, building.floors, building.use, building.lon]);
  // Selling it back: at the record's value again, not at the palace the client now describes.
  const sold = await c.cmd("ana", "sell_building", { building: { id: building.id, area: 90_000, floors: 60 }, at: near(building) });
  assert.equal(sold.result.price, honest);
  // A place the city has no record of cannot be bought or worked at.
  for (const [command, args] of [["buy_building", { building: { id: "made-up", area: 10, floors: 1, use: "residential", lon: building.lon, lat: building.lat, x: building.x, z: building.z } }],
    ["take_job", { role: "barista", place: { id: "made-up", x: building.x, z: building.z, keys: ["shop:cafe"] } }]]) {
    const no = await c.cmd("ana", command, { ...args, at: near(building) });
    assert.match(no.result.error, /no record of that place/, command);
  }
  // A home on the market: the listing is the server's (this week's, at its price), whatever is sent.
  const week = Math.floor(new CityWorld(R, { now: c.A.gameNow() }).time.day / 7);
  const listing = [...canon.listings(week).values()].find((l) => l.kind === "rent");
  const rent = await c.cmd("ana", "rent_home", { listing: { home: listing.home, kind: "rent", type: "single_family", sqft: 1, lon: -121.9, lat: 37.3, price: 1 }, at: near(building) });
  assert.equal(rent.result.ok, true, rent.result.error);
  assert.equal(rent.result.rent, listing.price);
  const notListed = await c.cmd("ana", "buy_home", { listing: { home: "nowhere:1", kind: "sale", type: "apartment", sqft: 800 }, at: near(building) });
  assert.match(notListed.result.error, /not on the market/);
  // Rivals are counted from the record, not taken from the client.
  assert.equal(canon.canonical("buy_business", { place: { id: shop.id }, rivals: 0 }, { week }).rivals, canon.rivals(shop));
});

test("each player is shown their own part: nobody else's money, bag, bills, cars or messages", async () => {
  const c = city();
  await c.join("ana"); await c.join("ben", homes[1]); await c.join("cy", homes[2]);
  await c.fund("ben", 9_000_000);
  assert.equal((await c.cmd("ben", "buy_vehicle", { model: "economy", at: near(homes[1]) })).result.ok, true);
  assert.equal((await c.cmd("ben", "send_message", { to: c.pid("cy"), text: "the code is 4417", at: near(homes[1]) })).result.ok, true);
  await c.cmd("ben", "give_money", { to: c.pid("ana"), amount: 1234, at: near(homes[1]) });
  const world = CityWorld.fromJSON(R, structuredClone(c.stored().state.world));
  const sync = await c.A.handle({ op: "sync", token: await c.as("ana"), since: 0 });
  const seen = JSON.stringify(sync.state);
  assert.deepEqual(leaks(sync.state, c.pid("ana"), world), []);
  const accounts = new Map(sync.state.ledger.accounts);
  assert.equal(accounts.get(`player:${c.pid("ana")}`).balance, c.balance("ana"), "her own balance");
  assert.ok(!accounts.has(`player:${c.pid("ben")}`) && !accounts.has(`player:${c.pid("cy")}`));
  assert.ok(!seen.includes("4417"), "a message between two others");
  assert.ok(!sync.state.registry.some((a) => a.kind === "vehicle"), "another's car");
  assert.ok(!seen.includes(String(c.balance("ben"))), "another's balance, anywhere");
  // What she is owed to see: the payment to her; and that the others exist by name.
  assert.ok(sync.state.ledger.journal.some((e) => e.lines.some(([a, v]) => a === `player:${c.pid("ana")}` && v === 1234)));
  assert.deepEqual(sync.state.players.map((p) => p.name).sort(), ["ana", "ben", "cy"]);
  // The books she is shown still balance, and load as a world on the page.
  const page = CityWorld.fromJSON(R, sync.state);
  assert.equal(page.ledger.balance(`player:${c.pid("ana")}`), c.balance("ana"));
  // Ben sees his own message, car and balance; Cy the message; someone not joined, no one's.
  const ben = (await c.A.handle({ op: "sync", token: await c.as("ben"), since: 0 })).state;
  assert.ok(JSON.stringify(ben).includes("4417") && ben.registry.some((a) => a.kind === "vehicle"));
  assert.ok(JSON.stringify(viewFor(world, c.pid("cy"))).includes("4417"));
  assert.deepEqual(leaks(viewFor(world, "nobody"), "nobody", world), []);
  // Nothing sent to a page is the whole world, and the page sends none to the room.
  assert.ok(!text("../docs/city/view.mjs").includes('t: "state"'));
});

test("a command happens whole or not at all", async () => {
  const c = city();
  await c.join("ana");
  const before = JSON.stringify(c.stored());
  // Refused by the world part-way (a mortgage is credited before the sale is found impossible):
  // nothing of it is kept.
  const week = Math.floor(new CityWorld(R, { now: c.A.gameNow() }).time.day / 7);
  const sale = [...canon.listings(week).values()].find((l) => l.kind === "sale");
  const r = await c.cmd("ana", "buy_home", { listing: { home: sale.home, kind: "sale" }, mortgage: true, at: near(homes[0]) });
  assert.equal(r.result.ok, false);
  assert.equal(JSON.stringify(c.stored()), before, "the stored world is untouched");
  assert.equal(r.state, undefined);
  // The store fails as the result is written: the answer is an error and nothing changed.
  const commit = c.store.commit.bind(c.store);
  c.store.commit = async () => { throw new Error("the disk is gone"); };
  await assert.rejects(c.cmd("ana", "buy", { item: "water", place: { id: homes[0].id }, at: near(homes[0]) }).then((x) => { if (!x.result?.ok) throw new Error("refused"); }));
  await assert.rejects(c.cmd("ana", "status", { at: near(homes[0]) }));
  c.store.commit = commit;
  assert.equal(JSON.stringify(c.stored()), before);
  // Through the door, that is a 500 with no detail -- and a server that is not set up is a 503.
  c.store.commit = async () => { throw new Error("secret detail"); };
  const out = await handle({ method: "POST", body: JSON.stringify({ op: "cmd", token: await c.as("ana"), command: "status", args: { at: near(homes[0]) } }) }, c.A);
  assert.deepEqual([out.status, out.body.code, /secret/.test(JSON.stringify(out.body))], [500, "server", false]);
  c.store.commit = commit;
  assert.equal((await handle({ method: "POST", body: "{}" }, null)).status, 503);
  assert.equal((await handle({ method: "POST", body: "{not json" }, c.A)).status, 400);
  // The same request sent again (its answer was lost) is answered, not done twice.
  await c.join("ben", homes[1]);
  const once = await c.cmd("ana", "give_money", { to: c.pid("ben"), amount: 700, at: near(homes[0]) }, c.A, "r:1");
  const twice = await c.cmd("ana", "give_money", { to: c.pid("ben"), amount: 700, at: near(homes[0]) }, c.make(), "r:1");
  assert.deepEqual([once.result.ok, twice.repeated, twice.result.ok], [true, true, true]);
  assert.equal(c.balance("ben"), R.start.balance + 700);
});

test("one world, one history: any number of server instances, restarts and rooms", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kerbside-city-"));
  const file = join(dir, "world.json");
  const c = city({ store: new FileStore(file) });
  await c.join("ana"); await c.join("ben", homes[1]); await c.join("cy", homes[2]);
  // Three instances that all loaded the same version act at once: each command lands exactly
  // once, on top of the others (a compare-and-swap that loses loads again and runs again).
  const servers = [c.A, c.make(), c.make()];
  const supply = () => -new Map(c.stored().state.world.ledger.accounts).get("system:issuer").balance;
  const before = supply(), v0 = c.stored().version;
  const pays = [];
  for (let i = 0; i < 12; i += 1) {
    const who = ["ana", "ben", "cy"][i % 3], to = ["ben", "cy", "ana"][i % 3];
    pays.push(c.cmd(who, "give_money", { to: c.pid(to), amount: 100 + i, at: near(homes[i % 3]) }, servers[i % 3], `pay:${i}`));
  }
  const done = await Promise.all(pays);
  assert.ok(done.every((r) => r.ok && r.result.ok), JSON.stringify(done.find((r) => !r.result?.ok)));
  assert.equal(c.stored().version, v0 + 12, "twelve commits, one after another");
  assert.equal(new Set(done.map((r) => r.version)).size, 12, "no two answers are the same version");
  assert.equal(supply(), before, "no money made or lost");
  const start = R.start.balance;
  assert.equal(c.balance("ana") + c.balance("ben") + c.balance("cy"), 3 * start);
  assert.equal(c.balance("ana"), start - (100 + 103 + 106 + 109) + (102 + 105 + 108 + 111));
  assert.deepEqual(c.store.journal.filter((e) => e.command === "give_money").map((e) => e.version).sort((a, b) => a - b), Array.from({ length: 12 }, (_, i) => v0 + 1 + i));
  // A stale writer is refused outright.
  assert.equal((await c.store.commit("kerbside", v0, c.stored().state)).ok, false);
  // The server restarts (a new process, the same store): the same world, to the cent.
  const again = new CityAuthority({ R, canon, store: new FileStore(file), secret: "test-signing-secret", now: () => c.clock.t });
  const r = await again.handle({ op: "cmd", token: await c.as("ana"), command: "status", args: { at: near(homes[0]) } });
  assert.equal(r.result.balance, c.balance("ana"));
  // There is no room in a command: two parties are two groups of walkers in the one economy.
  assert.equal(again.worldId, c.A.worldId);
  assert.ok(!/room/.test(text("../server/city/authority.mjs").replace(/\/\/.*$/gm, "")));
});

test("the world survives being loaded for every command: what was only in memory is saved", () => {
  const w = new CityWorld(R, { now: Date.UTC(2026, 10, 20, 18) });
  w.submit("a", "join", { name: "A" });
  const live = JSON.parse(JSON.stringify(w.toJSON()));
  assert.ok(Array.isArray(live.commerce.quotes) && live.commerce.quoted, "quotes and the day's asking are in the saved world");
  live.commerce.quotes.push(["quote:x", { id: "quote:x", amount: 5 }]); live.commerce.quoted["a:1"] = 2;
  const again = JSON.parse(JSON.stringify(CityWorld.fromJSON(R, live).toJSON()));
  assert.deepEqual(again.commerce.quotes, [["quote:x", { id: "quote:x", amount: 5 }]]);
  assert.equal(again.commerce.quoted["a:1"], 2);
});

test("the page's line to the server: its own origin, never an address a link could choose", async () => {
  assert.equal(cityServerUrl({ protocol: "https:", hostname: "spatial-data-mapping.vercel.app", origin: "https://spatial-data-mapping.vercel.app", search: "?cityServer=https://evil.example/api" }),
    "https://spatial-data-mapping.vercel.app/api/city");
  assert.equal(cityServerUrl({ protocol: "http:", hostname: "localhost", origin: "http://localhost:8783", search: "", href: "http://localhost:8783/" }), null);
  assert.equal(cityServerUrl({ protocol: "http:", hostname: "localhost", origin: "http://localhost:8783", search: "?cityServer=https://evil.example/api", href: "http://localhost:8783/" }), null);
  assert.equal(cityServerUrl({ protocol: "http:", hostname: "localhost", origin: "http://localhost:8783", search: "?cityServer=http://localhost:8790/api/city", href: "http://localhost:8783/" }), "http://localhost:8790/api/city");
  assert.equal(cityServerUrl({ protocol: "file:", hostname: "", origin: "null", search: "" }), null);
  // The client against the server's own door.
  const c = city();
  const fetch = async (url, init) => { const out = await handle({ method: init.method, body: init.body }, c.A); return { status: out.status, json: async () => out.body }; };
  const page = cityClient({ url: "x", key: KEYS.ana, fetch });
  assert.equal((await page.open()).pid, c.pid("ana"));
  const joined = await page.send("join", { name: "Ana", home: { id: homes[0].id }, at: near(homes[0]) });
  assert.equal(joined.result.ok, true);
  assert.equal((await page.sync()).unchanged, true);
  assert.equal((await page.sync(0)).state.players.length, 1);
  const down = cityClient({ url: "x", key: KEYS.ana, fetch: async () => { throw new Error("no network"); } });
  assert.equal((await down.open()).code, "offline");
  const unset = cityClient({ url: "x", key: KEYS.ana, fetch: async (url, init) => { const out = await handle({ method: init.method, body: init.body }, null); return { status: out.status, json: async () => out.body }; } });
  assert.equal((await unset.open()).code, "not_configured");
});

test("the city's record of its places is built from the page's district, and projects as the page does", () => {
  const district = { key: "d", county: null, places: [...canon.places.values()].slice(0, 200).map((p) => ({ ...p, ring: [[0, 0]], door: {}, keys: new Set(p.keys) })) };
  const built = buildCanon(district);
  assert.equal(built.schema, "kerbside.city_canon/1");
  assert.equal(built.places.length, 200);
  assert.ok(built.places.every((p) => !("ring" in p) && !("door" in p) && Array.isArray(p.keys)));
  assert.ok(built.projection_error_m < 1);
  const P = fitProjection(built.places), [x, z] = project(P, built.places[7].lon, built.places[7].lat);
  assert.ok(Math.hypot(x - built.places[7].x, z - built.places[7].z) < 1);
  const [lon, lat] = canon.lonLat(homes[0].x, homes[0].z);
  assert.ok(Math.hypot((lon - homes[0].lon) * 88_000, (lat - homes[0].lat) * 111_000) < 1);
  assert.ok(canon.places.size > 2000);
});

test("the store is closed to pages, and a commit is one compare-and-swap", () => {
  const sql = text("../supabase/kerbside_city_server.sql");
  assert.match(sql, /revoke all on kerbside_city_server, kerbside_city_world, kerbside_city_journal from anon, authenticated/);
  assert.match(sql, /where w\.id = world and w\.version = expect/);
  assert.match(sql, /revoke execute on function kerbside_claim_city_grant\(text, bigint\) from public, anon, authenticated/);
  for (const fn of ["kerbside_city_version", "kerbside_city_load", "kerbside_city_commit", "kerbside_city_pending_grants"]) {
    assert.match(sql, new RegExp(`function ${fn}\\(secret text[\\s\\S]*?if not kerbside_city_is_server\\(secret\\) then return jsonb_build_object\\('refused', true\\)`), fn);
  }
  // The same project the pages use; the function at /api/city is the server's door.
  assert.ok(text("../docs/kerbside-account.mjs").includes(SUPABASE.url) && text("../docs/kerbside-account.mjs").includes(SUPABASE.key));
  assert.match(text("../api/city.mjs"), /from "\.\.\/server\/city\/http\.mjs"/);
  assert.match(text("../server/city/serve.mjs"), /handle\(/);
  const vercel = JSON.parse(text("../vercel.json"));
  assert.ok(vercel.functions["api/city.mjs"].includeFiles.includes("server/city/canon"));
});
