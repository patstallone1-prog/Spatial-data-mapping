// What you can do here (docs/city/affordances.mjs): each control's key and when it applies, the
// hint strip's chips (never walking or a plain jump), and the world's strike modes behind C and R.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BOUND, CONTROLS, TOOLS, affordances, hintChips, steady } from "../docs/city/affordances.mjs";
import { loadRules } from "../docs/city/core.mjs";
import { CityWorld } from "../docs/city/world.mjs";

const R = loadRules(JSON.parse(readFileSync(new URL("../docs/city/rules.json", import.meta.url))));
const base = { mode: "walk", held: null, front: { thing: null, climb: null, jump: null }, ground: null, prompt: null, eating: null };
const at = (over) => ({ ...base, ...over, front: { ...base.front, ...(over.front || {}) } });
const ids = (s) => affordances(s).map((a) => a.id);

test("every control's key is one the city binds, and its ids are unique", () => {
  for (const c of CONTROLS) assert.ok(BOUND.includes(c.key), `${c.id}: ${c.key}`);
  assert.equal(new Set(CONTROLS.map((c) => c.id)).size, CONTROLS.length);
  // The tools' verbs are the strike kinds of rules.json's items.
  const kinds = new Set(Object.values(R.items).filter((i) => typeof i === "object" && i.strike).map((i) => i.strike));
  for (const k of Object.keys(TOOLS)) assert.ok(kinds.has(k), k);
});

test("walking about with nothing particular in front: no hints at all (never the arrows or Space)", () => {
  assert.deepEqual(affordances(base), []);
  assert.deepEqual(affordances(at({ mode: "inside" })), []);
  assert.deepEqual(affordances(at({ mode: "drive" })), []);
  // In the water, and riding: nothing out of the ordinary either.
  assert.deepEqual(affordances(at({ mode: "swim" })), []);
  for (const s of [base, at({ held: { name: "Brick", strike: null } })])
    for (const a of affordances(s)) assert.ok(a.key !== "arrows" && a.key !== " ", a.id);
});

test("a fence in front: E climbs it and Space jumps at it; climbing, the arrows and Space push off", () => {
  const s = at({ front: { climb: { name: "Chain-link fence", ok: true }, jump: { action: "catch_top", name: "Chain-link fence" } } });
  assert.deepEqual(ids(s), ["climb", "jump_at"]);
  assert.match(affordances(s)[0].label, /Climb the chain-link fence/);
  assert.match(affordances(s)[1].label, /Jump up the chain-link fence/);
  // Nothing to jump at (too high to reach): no Space chip.
  assert.deepEqual(ids(at({ front: { climb: { name: "Wall", ok: true }, jump: { action: "none" } } })), ["climb"]);
  // Too smooth to climb: greyed, with the reason.
  const no = affordances(at({ front: { climb: { name: "Glass wall", ok: false, reason: "Nothing to hold on to" } } }))[0];
  assert.equal(no.ok, false); assert.equal(no.reason, "Nothing to hold on to");
  assert.deepEqual(ids(at({ mode: "climb" })), ["climb_arrows", "jump_off", "let_go"]);
  assert.deepEqual(ids(at({ mode: "perch" })), ["jump_off", "walk_top"]);
});

test("tools on what is in front: the verbs by tool, and why not", () => {
  const post = { name: "Fence post", material: "lumber", wood: true };
  const saw = affordances(at({ held: { name: "Hand saw", strike: "saw" }, front: { thing: post } }));
  assert.deepEqual(saw.map((a) => a.id), ["work", "swing", "throw"]);
  assert.match(saw[0].label, /Saw the fence post/);
  const sawSteel = affordances(at({ held: { name: "Hand saw", strike: "saw" }, front: { thing: { name: "Bollard", material: "steel" } } })).find((a) => a.id === "work");
  assert.equal(sawSteel.ok, false); assert.match(sawSteel.reason, /cuts wood/);
  const bar = affordances(at({ held: { name: "Crowbar", strike: "crowbar" }, front: { thing: post } }));
  assert.deepEqual(bar.filter((a) => ["work", "thrust"].includes(a.id)).map((a) => a.label), ["Pry the fence post (hold)", "Jab the fence post"]);
  // An axe on wood chops; on steel, it swings at it.
  assert.match(affordances(at({ held: { name: "Axe", strike: "axe" }, front: { thing: post } })).find((a) => a.id === "swing").label, /^Chop/);
  assert.match(affordances(at({ held: { name: "Axe", strike: "axe" }, front: { thing: { name: "Sign", material: "steel" } } })).find((a) => a.id === "swing").label, /^Swing at/);
  // No thrust or work at a person.
  assert.deepEqual(ids(at({ held: { name: "Crowbar", strike: "crowbar" }, front: { thing: { name: "Sam", person: true } } })), ["swing", "throw"]);
});

test("food, drink, the ground and a question", () => {
  assert.deepEqual(ids(at({ held: { name: "Pint of beer", food: true, drink: true }, eating: { label: "A sip" } })), ["sip"]);
  assert.match(affordances(at({ held: { name: "Burger", food: true }, eating: { label: "A bite" } }))[0].label, /A bite of the burger/);
  assert.deepEqual(ids(at({ ground: { name: "Brick" } })), ["pick_up"]);
  assert.deepEqual(ids(at({ prompt: { yes: "Clock in", no: "No" } })), ["yes", "no"]);
});

test("the strip: one chip a key, four at most, shortened as learned, gone once well learned", () => {
  const s = at({ held: { name: "Crowbar", strike: "crowbar" }, front: { thing: { name: "Crate", material: "lumber", wood: true }, climb: { name: "Wall", ok: true } }, ground: { name: "Brick" }, prompt: { yes: "Clock in", no: "No" } });
  const list = affordances(s);
  const chips = hintChips(list);
  assert.equal(chips.length, 4);
  assert.equal(new Set(chips.map((c) => c.key)).size, 4);
  assert.equal(chips[0].id, "yes");
  // Five showings in, the verb only; twenty uses in, gone (unless what is in front is new).
  assert.equal(hintChips(list, { counts: { yes: 6 } })[0].text, "Yes");
  assert.ok(!hintChips(list, { counts: { yes: 25 }, seenKinds: new Set(["Clock in"]) }).some((c) => c.id === "yes"));
  assert.ok(hintChips(list, { counts: { yes: 25 }, seenKinds: new Set() }).some((c) => c.id === "yes"));
  assert.deepEqual(hintChips(list, { setting: "off" }), []);
  assert.equal(hintChips(list, { setting: "short" })[0].text, "Yes");
  // A greyed chip says why, whatever the setting.
  const why = hintChips(affordances(at({ front: { climb: { name: "Glass", ok: false, reason: "Too smooth" } } })), { setting: "short" })[0];
  assert.equal(why.text, "Climb: Too smooth"); assert.equal(why.ok, false);
});

test("steady: a chip stays at least its hold once shown", () => {
  const a = { id: "climb" }, b = { id: "jump_at" };
  let shown = steady([], [a, b], 0);
  shown = steady(shown, [a], 0.3);
  assert.deepEqual(shown.map((x) => x.chip.id), ["climb", "jump_at"]);
  shown = steady(shown, [a], 0.7);
  assert.deepEqual(shown.map((x) => x.chip.id), ["climb"]);
  assert.equal(shown[0].since, 0);
});

test("the world's strike modes: a thrust is less than a swing, a stroke of work less again and less tiring", () => {
  const run = (mode, item) => {
    const w = new CityWorld(R, { seed: "modes", now: Date.UTC(2026, 9, 6, 19, 0) });
    w.submit("me", "join", { name: "Tester", at: { x: 0, z: 0, lon: -122.4335, lat: 37.8006 } });
    const p = w.players.get("me"); p.inventory[item] = 1; p.hands = item;
    const before = p.vitals.stamina;
    const r = w.submit("me", "strike", { target: { key: "crate@1,1", archetype: "furniture.crate", x: 1, z: 1, spec: { name: "Crate", material: "lumber", break_j: 90000 } }, mode });
    return { r, tired: before - p.vitals.stamina };
  };
  const swing = run("swing", "crowbar"), thrust = run("thrust", "crowbar"), work = run("work", "crowbar");
  for (const x of [swing, thrust, work]) assert.ok(x.r.ok, x.r.error);
  assert.ok(thrust.r.joules < swing.r.joules && work.r.joules < thrust.r.joules, `${swing.r.joules} ${thrust.r.joules} ${work.r.joules}`);
  assert.ok(work.tired < swing.tired);
  // Work is for a tool that works: a hammer does not.
  const ham = run("work", "hammer");
  assert.equal(ham.r.ok, false); assert.match(ham.r.error, /not a tool to work with/);
});
