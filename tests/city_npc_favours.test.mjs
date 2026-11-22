// Favours (docs/city/npc-favours.mjs): small asks are mostly done, big ones take a friend, a reason
// or money; a worker on shift stays at work; nobody can be asked all day; what it cost them is
// theirs, and the world, not the model, decides.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { loadRules } from "../docs/city/core.mjs";
import { CityWorld } from "../docs/city/world.mjs";
import { FAVOURS, askedFavour, favourCost, favourLine, favourTag, onTheirWay, weighFavour } from "../docs/city/npc-favours.mjs";

const R = loadRules(JSON.parse(readFileSync(new URL("../docs/city/rules.json", import.meta.url))));
const T0 = Date.UTC(2026, 10, 9, 18, 0);
const people = Array.from({ length: 300 }, (_, i) => ({ id: `npc:h${i}:0`, age: 20 + (i % 50), base: { role: "clerk" } }));
const share = (kind, opts = {}) => people.filter((who) => weighFavour({ kind, who, ...opts }).verdict === "help").length / people.length;

test("the words for each favour", () => {
  assert.equal(askedFavour("Could you give me a hand with these bags?"), "carry");
  assert.equal(askedFavour("can you help me move my couch"), "move_house");
  assert.equal(askedFavour("Excuse me, you're blocking my car"), "make_way");
  assert.equal(askedFavour("could you give me a lift downtown"), "ride");
  assert.equal(askedFavour("wait here a minute"), "wait");
  assert.equal(askedFavour("what's the weather like"), null);
  assert.deepEqual(favourTag("Sure, I'll grab the other end. [[favour:carry]]"), { kind: "carry", text: "Sure, I'll grab the other end." });
  assert.equal(favourTag("[[favour:steal]] no").kind, null);
});

test("small asks most people do; big ones few strangers do, more friends, more for money", () => {
  const idle = { kind: "leisure", spare: 60 };
  const small = share("make_way", { on: idle }), carry = share("carry", { on: idle }), big = share("move_house", { on: idle });
  assert.ok(small > 0.9, `stepping aside: ${small}`);
  assert.ok(carry > big, `carrying ${carry} > furniture ${big}`);
  assert.ok(big < 0.2, `furniture for a stranger: ${big}`);
  assert.ok(share("move_house", { on: idle, standing: "friend" }) > big, "a friend more often");
  assert.ok(share("move_house", { on: idle, offer: R.money(60), money: R.money(1) }) > big, "for money more often");
});

test("on their way to work with no time to spare, or on shift: they stay on task", () => {
  const free = share("carry", { on: { kind: "leisure", spare: 60 } });
  const late = share("carry", { on: { kind: "work", spare: 1 } });
  const shift = share("carry", { on: { kind: "shift", spare: 0 } });
  assert.ok(late < free, `late for work ${late} < free ${free}`);
  assert.ok(shift < 0.05, `on shift: ${shift}`);
  // ...but a worker still steps aside.
  assert.ok(share("make_way", { on: { kind: "shift", spare: 0 } }) > 0.6);
});

test("asked again and again, and helped already today: less willing; argue names its terms", () => {
  const who = people.find((p) => weighFavour({ kind: "carry", who: p, on: { kind: "leisure", spare: 60 } }).verdict === "help");
  const fresh = weighFavour({ kind: "carry", who, on: { kind: "leisure", spare: 60 } });
  const tired = weighFavour({ kind: "carry", who, on: { kind: "leisure", spare: 60 }, today: { done: 3, asked: 4 } });
  assert.ok(tired.score < fresh.score - 0.4);
  const argue = people.map((p) => weighFavour({ kind: "ride", who: p, on: { kind: "errand", spare: 30 }, money: R.money(1) })).find((d) => d.verdict === "argue");
  assert.ok(argue && (argue.terms.pay > 0 || argue.terms.shorter));
  if (argue.terms.pay) {
    const who2 = people.find((p) => weighFavour({ kind: "ride", who: p, on: { kind: "errand", spare: 30 }, money: R.money(1) }) === argue) || null;
    assert.equal(who2, null);   // (decisions are fresh objects)
  }
  assert.match(favourLine("argue", { kind: "ride", terms: argue.terms, tone: "direct", seed: "x" }), /\w/);
});

test("what's on their way: from the day plan", () => {
  const plan = { segs: [{ kind: "stay", t0: 0, t1: 480, act: { kind: "home", label: "At home" } }, { kind: "go", t0: 480, t1: 500 }, { kind: "stay", t0: 500, t1: 1000, act: { kind: "work", start: 510, label: "Work at Safeway" } }] };
  assert.deepEqual(onTheirWay(plan, 490), { kind: "work", label: "Work at Safeway", spare: 10, at: false });
  assert.equal(onTheirWay(plan, 600).kind, "shift");
  const c = favourCost({ held: 30, on: { kind: "work", spare: 10, label: "Work at Safeway" }, wage: R.money(24), name: "Maya Chen" });
  assert.equal(c.late, 20);
  assert.ok(c.docked > 0 && /Maya was 20 minutes late/.test(c.text));
  assert.equal(favourCost({ held: 5, on: { kind: "leisure", spare: 60 } }).late, 0);
});

test("in the world: a yes is a favour you have of them, carrying more; done, it is counted", () => {
  const w = new CityWorld(R, { now: T0, seed: "favours" });
  w.submit("ana", "join", { name: "Ana", at: { x: 0, z: 0 } });
  const ana = w.players.get("ana"), before = w.carry(ana).capacity;
  const helper = people.find((p) => weighFavour({ kind: "carry", who: p, on: { kind: "leisure", spare: 60 }, day: Math.floor(T0 / 86_400_000) }).verdict === "help");
  const r = w.submit("ana", "ask_favour", { npc: { id: helper.id, name: "Sam Lee", age: helper.age, role: "clerk" }, kind: "carry", on: { kind: "leisure", spare: 60 } });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.verdict, "help");
  assert.equal(w.carry(ana).capacity, before + FAVOURS.carry.kg);
  w.now += 8 * 60_000;
  const done = w.submit("ana", "favour_done", { id: r.favour.id, held: 8 });
  assert.equal(done.ok, true, done.error);
  assert.equal(w.carry(ana).capacity, before);
  assert.equal(w.favourRecord(helper.id).done, 1);
  // A stranger on shift will not leave the till to carry your shopping.
  const s = w.submit("ana", "ask_favour", { npc: { id: "npc:x:1", name: "Kim", age: 30, role: "clerk" }, kind: "carry", on: { kind: "shift", spare: 0 } });
  assert.notEqual(s.verdict, "help");
  assert.equal(w.players.get("ana").favour, null);
  // The world keeps who has helped today.
  const again = CityWorld.fromJSON(R, JSON.parse(JSON.stringify(w)));
  assert.equal(again.favourRecord(helper.id).done, 1);
});

test("a lift: no fare", () => {
  const w = new CityWorld(R, { now: T0, seed: "favours" });
  w.submit("ana", "join", { name: "Ana", at: { x: 0, z: 0 } });
  const p = w.players.get("ana");
  p.favour = { id: "favour:1", npc: "npc:a:1", name: "Lee", kind: "ride", since: w.now, until: w.now + 600_000, on: { kind: "leisure", spare: 60 } };
  const bal = w.ledger.balance(p.account);
  assert.equal(w.submit("ana", "board", { kind: "taxi", vehicle: "taxi:ana:1", lift: true }).ok, true);
  w.now += 300_000;
  const r = w.submit("ana", "alight", { km: 3 });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.fare, 0);
  assert.equal(w.ledger.balance(p.account), bal);
});
