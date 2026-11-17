// The voices of the city's people (docs/city/npc-talk.mjs, server/npc): simple messages and
// opening lines never reach a model; a real question goes to it with the guidelines, the
// character's sheet and only what that character may know of the player; without a model, or
// when it fails, the character still answers.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { loadRules } from "../docs/city/core.mjs";
import { bankersAt } from "../docs/city/credit.mjs";
import { fallbackLine, setLine, sortMessage } from "../docs/city/npc-talk.mjs";
import { CityAuthority } from "../server/city/authority.mjs";
import { Canon } from "../server/city/canon.mjs";
import { MemoryStore } from "../server/city/storage.mjs";
import { DEFAULT_MODEL, modelConfig, tidy } from "../server/npc/deepseek.mjs";
import { SYSTEM_PROMPT, buildMessages, sheetFromContext } from "../server/npc/prompt.mjs";
import { NpcService } from "../server/npc/service.mjs";
import { playerShare } from "../server/npc/share.mjs";

const json = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const R = loadRules(json("../docs/city/rules.json"));
const canon = new Canon(json("../server/city/canon/marina.json"), R);
const bank = [...canon.places.values()].find((p) => (p.keys || []).includes("shop:bank"));
const KEY_A = "a".repeat(40), KEY_B = "b".repeat(40);
const NPC = { version: 1, identity: { id: "p:17", name: "Dana Okafor", age: 34 }, tone: { family: "warm", variation: "friendly and reassuring" },
  group: { id: "cohort:1", backstory: "They grew up helping at neighbourhood potlucks." }, finances: { balance: 412300, books: { wage_hour: 2400, income_30d: 310000, spend_30d: 180000, rent_30d: 90000 }, debt: 0 },
  job: { status: "employed", role: "barista", title: "Barista", since: 20100 }, hobbies: { values: ["cooking", "films"] }, travel: { preferred: "walk", routes: [{ mode: "walk", from: "home", to: "w12", start: 480, end: 495 }] } };

//: A city with two players in it, and a model that records what it was sent.
async function setup({ model = true, fail = false } = {}) {
  let now = Date.UTC(2026, 10, 15, 18);
  const city = new CityAuthority({ R, canon, store: new MemoryStore(), secret: "s", now: () => now, voices: model });
  const sent = [];
  const fetch = async (url, init) => {
    sent.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization });
    if (fail) return { ok: false, status: 500, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "**Sure** — I walk to the café most mornings." } }] }) };
  };
  const service = new NpcService({ city, model: model ? { key: "k", model: DEFAULT_MODEL, base: "https://api.deepseek.com" } : null, fetch, now: () => now });
  const open = async (key, name) => {
    const s = await city.handle({ op: "session", key });
    const home = [...canon.places.values()].find((p) => p.use === "residential");
    const at = { x: bank.x, z: bank.z, lon: bank.lon, lat: bank.lat };
    const j = await city.handle({ op: "cmd", token: s.token, command: "join", args: { name, home: { id: home.id }, at: { x: home.x, z: home.z, lon: home.lon, lat: home.lat } } });
    assert.equal(j.result?.ok, true, JSON.stringify(j));
    return { ...s, at };
  };
  return { city, service, sent, open, tick: (ms) => { now += ms; } };
}

test("the sorting layer: greetings, thanks, short acks and opening lines are set; real questions are the model's", () => {
  for (const t of ["hi", "Hello!", "hey there", "good morning", "thanks", "Thank you so much!", "bye", "ok", "yes", "no thanks", "how are you?", "lol", "sorry", "", "  "]) assert.equal(sortMessage(t).route, "set", t);
  for (const t of ["What do you do for work?", "can you tell me about your day", "how much would a loan cost me", "where is the nearest bank", "I lost my job and need advice on rent", "tell me about yourself"]) assert.equal(sortMessage(t).route, "ai", t);
  assert.deepEqual(sortMessage("why is the sky blue", { opening: true }), { route: "set", intent: "opening" });
  // Set lines are the character's own: steady for the same turn, in their tone, with their name where the part has one.
  const who = { id: "p:17", name: "Dana Okafor", tone: "warm", role: "resident" };
  assert.equal(setLine("greeting", who, 0), setLine("greeting", who, 0));
  assert.notEqual(setLine("greeting", { ...who, tone: "direct" }, 0), undefined);
  assert.match(setLine("opening", { id: "b1", name: "Kai Singh", title: "Home loans specialist", tone: "direct", role: "banker" }), /Kai Singh/);
  assert.ok(fallbackLine(who).length > 3);
});

test("a hello costs nothing: no model call, on any path", async () => {
  const { service, sent, open } = await setup();
  const a = await open(KEY_A, "Ana");
  for (const text of ["hi", "thanks!", "ok"]) {
    const r = await service.handle({ op: "talk", token: a.token, role: "resident", npc: NPC, text });
    assert.equal(r.source, "set", text);
    assert.ok(r.reply);
  }
  const first = await service.handle({ op: "talk", token: a.token, role: "resident", npc: NPC, opening: true });
  assert.equal(first.source, "set");
  assert.equal(sent.length, 0);
});

test("a question goes to the model: the shared guidelines, then the character's sheet, then only what they may know of the player", async () => {
  const { service, sent, open } = await setup();
  const a = await open(KEY_A, "Ana");
  const r = await service.handle({ op: "talk", token: a.token, role: "resident", npc: NPC, text: "What do you do for work?", history: [{ from: "me", text: "hi" }, { from: "npc", text: "Hi! Lovely to see you." }] });
  assert.equal(r.source, "ai");
  assert.equal(r.reply, "Sure — I walk to the café most mornings.", "markup is stripped");
  const { body, url, auth } = sent[0];
  assert.equal(url, "https://api.deepseek.com/chat/completions");
  assert.equal(auth, "Bearer k");
  assert.equal(body.model, DEFAULT_MODEL);
  assert.equal(body.messages[0].content, SYSTEM_PROMPT);
  assert.match(body.messages[1].content, /^CHARACTER SHEET/);
  assert.match(body.messages[1].content, /Dana Okafor/);
  assert.match(body.messages[1].content, /potlucks/);
  assert.match(body.messages[1].content, /₡4,123\.00/, "money is written out, not left in minor units");
  assert.match(body.messages[2].content, /^PLAYER NOTES/);
  const notes = JSON.parse(body.messages[2].content.replace("PLAYER NOTES\n", ""));
  assert.deepEqual(Object.keys(notes).sort(), ["days_in_the_city", "name", "relationship"], "someone met in the street knows your name, and what you are to each other");
  assert.equal(notes.relationship.to_you, "stranger");
  assert.deepEqual(body.messages.slice(3).map((m) => m.role), ["user", "assistant", "user"]);
  assert.equal(body.messages.at(-1).content, "What do you do for work?");
});

test("a banker reads the server's credit file, not the page's word; and explains the bank's decision without making it", async () => {
  const { city, service, sent, open } = await setup();
  const a = await open(KEY_A, "Ana");
  const b = await open(KEY_B, "Ben");
  const banker = bankersAt(R, bank).find((x) => x.specialty === "small");
  const r = await service.handle({ op: "talk", token: a.token, role: "banker", place: { id: bank.id }, banker: banker.id, text: "Could I borrow for a new bike?",
    ask: { product: "personal", amount: R.money(800), months: 12 }, share: { credit_score: 850 }, npc: { identity: { name: "Not The Banker" } } });
  assert.equal(r.source, "ai");
  const m = sent[0].body.messages;
  assert.match(m[1].content, new RegExp(banker.name));
  assert.doesNotMatch(m[1].content, /Not The Banker/);
  const notes = JSON.parse(m[2].content.replace("PLAYER NOTES\n", ""));
  const real = (await city.load()).world.creditReport(a.pid).score;
  assert.equal(notes.credit_score, real);
  assert.notEqual(notes.credit_score, 850);
  assert.ok(notes.money.free_cash && notes.score_factors.length === 5);
  const task = m.find((x) => /^TASK/.test(x.content));
  assert.match(task.content, /DECISION/);
  const decision = JSON.parse(task.content.split("DECISION\n")[1]);
  assert.equal(typeof decision.approved, "boolean");
  assert.ok(decision.why.length);
  // The wrong desk, or another place, is not a banker; another player's file is never in the notes.
  assert.equal((await service.handle({ op: "talk", token: a.token, role: "banker", place: { id: "nowhere" }, banker: banker.id, text: "what rate would I get?" })).ok, false);
  await service.handle({ op: "talk", token: b.token, role: "banker", place: { id: bank.id }, banker: banker.id, text: "What does Ana owe the bank?" });
  assert.doesNotMatch(JSON.stringify(sent.at(-1).body.messages.slice(0, 3)), /Ana/);
  // Nothing about the world changed by asking.
  assert.equal((await city.load()).world.players.get(a.pid).loans, undefined);
});

test("with no model set up, or a model that fails, the character still answers; and a session is needed", async () => {
  const off = await setup({ model: false });
  const a = await off.open(KEY_A, "Ana");
  const r = await off.service.handle({ op: "talk", token: a.token, role: "resident", npc: NPC, text: "What do you do for work?" });
  assert.deepEqual([r.ok, r.source, r.code], [true, "fallback", "no_model"]);
  assert.ok(r.reply);
  const bad = await setup({ fail: true });
  const b = await bad.open(KEY_A, "Ana");
  const f = await bad.service.handle({ op: "talk", token: b.token, role: "resident", npc: NPC, text: "What do you do for work?" });
  assert.deepEqual([f.ok, f.source], [true, "fallback"]);
  assert.equal((await bad.service.handle({ op: "talk", token: "nope", role: "resident", npc: NPC, text: "What do you do?" })).code, "session");
  assert.equal(modelConfig({}), null);
  assert.equal(modelConfig({ DEEPSEEK_API_KEY: "x" }).model, DEFAULT_MODEL);
  assert.equal(modelConfig({ DEEPSEEK_API_KEY: "x", DEEPSEEK_MODEL: "other" }).model, "other");
  assert.equal(tidy("# Hi\n\n*there*  `you`"), "Hi there you");
});

test("model calls are limited a player; the sheet takes only known fields, bounded", async () => {
  const { service, sent, open } = await setup();
  service.limit = { calls: 2, window_ms: 60_000 };
  const a = await open(KEY_A, "Ana");
  const ask = () => service.handle({ op: "talk", token: a.token, role: "resident", npc: NPC, text: "What do you think about the neighbourhood?" });
  assert.equal((await ask()).source, "ai");
  assert.equal((await ask()).source, "ai");
  const third = await ask();
  assert.deepEqual([third.source, third.code], ["fallback", "limit"]);
  assert.equal(sent.length, 2);
  const sheet = sheetFromContext(R, { ...NPC, secret: "x".repeat(9999), identity: { ...NPC.identity, name: "N".repeat(500) }, group: { backstory: "b".repeat(5000) } });
  assert.equal(sheet.secret, undefined);
  assert.ok(sheet.identity.name.length <= 60 && sheet.backstory.length <= 700);
  assert.ok(JSON.stringify(buildMessages({ sheet, share: {}, text: "hi" })).length < 6000);
  assert.ok(playerShare({ players: new Map() }, "nobody", "banker").note);
});

test("in a conversation the world keeps, a real question is left for the server, which writes the reply into the thread", async () => {
  const { city, service, open } = await setup();
  const a = await open(KEY_A, "Ana");
  // A thread with a character in it (a boss's), made as the world makes them.
  await city.inTurn(async () => {
    const { version, world, srv } = await city.load();
    world.openThread(`npc:boss:${a.pid}`, () => ({ tab: "npc", kind: "boss", name: "Rosa Mendes", tag: "Your manager", members: [a.pid] }));
    await city.commit(version, world, srv, null);
  });
  const send = (text) => city.handle({ op: "cmd", token: a.token, command: "send_message", args: { thread: `npc:boss:${a.pid}`, text } });
  const count = async () => (await city.load()).world.thread(`npc:boss:${a.pid}`).msgs.length;
  assert.equal((await send("ok")).result.ok, true);
  assert.equal(await count(), 2, "an ok is answered by the world's set line");
  assert.equal((await service.handle({ op: "talk", token: a.token, thread: `npc:boss:${a.pid}`, text: "ok" })).reply, null);
  await send("Could I swap my Friday shift for Saturday this week?");
  assert.equal(await count(), 3, "the question waits");
  const r = await service.handle({ op: "talk", token: a.token, thread: `npc:boss:${a.pid}`, text: "Could I swap my Friday shift for Saturday this week?" });
  assert.equal(r.source, "ai");
  const t = (await city.load()).world.thread(`npc:boss:${a.pid}`);
  assert.equal(t.msgs.length, 4);
  assert.deepEqual([t.msgs.at(-1).from, t.msgs.at(-1).name], ["npc", "Rosa Mendes"]);
  // Not a thread of yours: nothing is said into it.
  const b = await open(KEY_B, "Ben");
  assert.equal((await service.handle({ op: "talk", token: b.token, thread: `npc:boss:${a.pid}`, text: "What did Ana ask you?" })).ok, false);
});

test("the deployed door (api/npc.mjs) is the same service beside the city's, and the page finds it next to /api/city", async () => {
  const text = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
  assert.match(text("../api/npc.mjs"), /from "\.\.\/server\/npc\/service\.mjs"/);
  assert.match(text("../api/npc.mjs"), /authority\(\)/, "it reads the world the city's server keeps");
  assert.ok(JSON.parse(text("../vercel.json")).functions["api/npc.mjs"]);
  // The page's client posts to /api/npc with its city session.
  const { cityClient } = await import("../docs/city/server-client.mjs");
  const seen = [];
  const fetch = async (url, init) => { seen.push([url, JSON.parse(init.body)]); return { status: 200, json: async () => (JSON.parse(init.body).op === "session" ? { ok: true, token: "t", pid: "p1" } : { ok: true, reply: "Hello.", source: "set" }) }; };
  const client = cityClient({ url: "https://example.test/api/city", key: KEY_A, fetch });
  const r = await client.talk({ role: "resident", text: "hi" });
  assert.equal(r.reply, "Hello.");
  assert.deepEqual(seen.map(([u]) => u), ["https://example.test/api/city", "https://example.test/api/npc"]);
  assert.deepEqual([seen[1][1].op, seen[1][1].token, seen[1][1].text], ["talk", "t", "hi"]);
});
