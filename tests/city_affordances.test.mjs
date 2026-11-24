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

test("a fence in front: Space climbs it (the first holds, then the arrows); a low wall, Space jumps onto it; climbing, Space pushes off", () => {
  const s = at({ front: { climb: { name: "Chain-link fence", ok: true }, jump: { action: "catch_top", name: "Chain-link fence" } } });
  assert.deepEqual(ids(s), ["climb"]);
  assert.equal(affordances(s)[0].key, " ");
  assert.match(affordances(s)[0].label, /Climb the chain-link fence \(then the arrows\)/);
  // Too high to jump at: Space still climbs it from where you stand.
  assert.deepEqual(ids(at({ front: { climb: { name: "Wall", ok: true }, jump: { action: "none" } } })), ["climb"]);
  // A low wall: jumped onto, not climbed.
  const low = at({ front: { climb: { name: "Low wall", ok: true }, jump: { action: "land_top", name: "Low wall" } } });
  assert.deepEqual(ids(low), ["jump_at"]);
  assert.match(affordances(low)[0].label, /Jump onto the low wall/);
  // Too smooth to climb: greyed, with the reason.
  const no = affordances(at({ front: { climb: { name: "Glass wall", ok: false, reason: "Nothing to hold on to" } } }))[0];
  assert.equal(no.ok, false); assert.equal(no.reason, "Nothing to hold on to");
  assert.deepEqual(ids(at({ mode: "climb" })), ["climb_arrows", "jump_off"]);
  assert.deepEqual(ids(at({ mode: "perch" })), ["jump_off", "walk_top"]);
  // No control is on E any more.
  assert.ok(!CONTROLS.some((c) => c.key === "e"));
});

test("R on shift does the task in front; with a nail set by a click, R with the hammer drives it", () => {
  assert.deepEqual(ids(at({ task: { label: "Restock the shelf" } })).slice(0, 1), ["task"]);
  assert.equal(affordances(at({ task: { label: "Restock the shelf" } }))[0].key, "r");
  const set = affordances(at({ nail_set: true, held: { name: "Claw hammer", strike: "hammer", nails: 1 } }));
  assert.equal(set[0].id, "hammer_set"); assert.equal(set[0].key, "r");
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

test("C pushes empty-handed: a chip for something loose, never for a person (a shove is always there)", () => {
  assert.deepEqual(ids(at({ front: { thing: { name: "Log", material: "deadwood", wood: true, loose: true } } })).filter((x) => x === "push"), ["push"]);
  assert.ok(!ids(at({ front: { thing: { name: "Maria", person: true } } })).includes("push"));
  assert.ok(!ids(at({ front: { thing: { name: "Bench", material: "lumber", wood: true } } })).includes("push"));
  assert.equal(affordances(at({ front: { thing: { name: "Log", loose: true } } })).find((a) => a.id === "push").label, "Push the log");
});

test("R by tool: a spade digs the ground underfoot, a knife carves wood, a hammer drives nails -- and why not", () => {
  const spade = { name: "Garden spade", strike: "shovel" }, knife = { name: "Pocket knife", strike: "knife" };
  const dig = (under) => affordances(at({ held: spade, under })).find((a) => a.id === "dig");
  assert.equal(dig({ kind: "turf", name: "lawn", soil: true }).ok, true);
  assert.equal(dig({ kind: "turf", name: "lawn", soil: true }).label, "Dig the lawn (hold)");
  assert.equal(dig({ kind: "concrete", name: "pavement", soil: false }).reason, "A spade will not go into the pavement");
  const bench = { name: "Bench", material: "lumber", wood: true }, post = { name: "Sign post", material: "steel", wood: false };
  assert.equal(affordances(at({ held: knife, front: { thing: bench } })).find((a) => a.key === "r").id, "carve");
  assert.match(affordances(at({ held: knife, front: { thing: post } })).find((a) => a.id === "carve").reason, /A knife carves wood/);
  const ham = (nails, thing = bench) => affordances(at({ held: { name: "Hammer", strike: "hammer", nails }, front: { thing } })).find((a) => a.id === "hammer_in");
  assert.equal(ham(30).ok, true);
  assert.match(ham(0).reason, /No nails/);
  assert.equal(ham(30, post).reason, "Nails go into wood");
  // A knife thrusts (stabs); a spade jabs.
  assert.ok(ids(at({ held: knife, front: { thing: bench } })).includes("thrust"));
});

test("view.mjs declares each function once (a second declaration silently replaces the first)", () => {
  const src = readFileSync(new URL("../docs/city/view.mjs", import.meta.url), "utf8");
  const names = [...src.matchAll(/^\s*(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/gm)].map((m) => m[1]);
  const twice = names.filter((n, i) => names.indexOf(n) !== i);
  assert.deepEqual(twice, []);
});

test("the world's hand work: a stroke costs stamina, a nail comes from the box, a shove that fells is battery", () => {
  const w = new CityWorld(R, { seed: "labour", now: Date.UTC(2026, 9, 6, 19, 0) });
  w.submit("me", "join", { name: "Tester", at: { x: 0, z: 0, lon: -122.4335, lat: 37.8006 } });
  const p = w.players.get("me");
  assert.match(w.submit("me", "labour", { kind: "dig" }).error, /needs a garden spade/);
  p.inventory.shovel = 1; p.hands = "shovel";
  const s0 = p.vitals.stamina, dug = w.submit("me", "labour", { kind: "dig" });
  assert.ok(dug.ok && p.vitals.stamina < s0);
  p.inventory.hammer = 1; p.hands = "hammer";
  assert.match(w.submit("me", "labour", { kind: "hammer", start_nail: true }).error, /no nails/);
  p.inventory.nails = 1;
  const n = w.submit("me", "labour", { kind: "hammer", start_nail: true });
  assert.ok(n.ok); assert.equal(n.nails, 49); assert.equal(p.inventory.nails || 0, 0);
  assert.equal(w.submit("me", "labour", { kind: "hammer" }).nails, 49);
  const stay = w.submit("me", "shove", { npc: { id: "npc:1", name: "Sam", x: 0.5, z: 0 }, falls: false, witnesses: 2 });
  assert.ok(stay.ok); assert.equal(stay.fine, 0);
  const fell = w.submit("me", "shove", { npc: { id: "npc:2", name: "Ann", x: 0.5, z: 0 }, falls: true, witnesses: 2 });
  assert.ok(fell.ok); assert.ok(fell.fine > 0); assert.ok(fell.injury);
});

test("by click: set down where clicked within reach, a nail set and let drop lies there and is used first, a heavy thing pushed a stride at a time", () => {
  const w = new CityWorld(R, { seed: "click", now: Date.UTC(2026, 9, 6, 19, 0) });
  w.submit("me", "join", { name: "Tester", at: { x: 0, z: 0, lon: -122.4335, lat: 37.8006 } });
  const p = w.players.get("me");
  p.x = 0; p.z = 0; p.inventory.hammer = 1; p.hands = "hammer";
  // Set down: at the spot within reach, at your feet beyond it.
  const near = w.submit("me", "drop", { item: "hammer", spot: { x: 1.2, z: 0.4 } });
  assert.ok(near.ok, near.error); assert.deepEqual(near.spot, { x: 1.2, z: 0.4 });
  assert.equal(p.hands, null, "set down, the hand is empty");
  p.inventory.hammer = 1;
  assert.deepEqual(w.submit("me", "drop", { item: "hammer", spot: { x: 40, z: 0 } }).spot, { x: 0, z: 0 });
  // A nail set by hand comes from the box; let go, it lies there as one nail.
  assert.match(w.submit("me", "labour", { kind: "set_nail" }).error, /no nails/);
  p.inventory.nails = 1;
  assert.equal(w.submit("me", "labour", { kind: "set_nail" }).nails, 49);
  const dropped = w.submit("me", "drop_nail", { spot: { x: 0.5, z: 0 } });
  assert.ok(dropped.ok); assert.equal(w.items.get(dropped.dropped).item, "nail");
  assert.ok(w.submit("me", "pick_up", { id: dropped.dropped }).ok);
  assert.equal(p.inventory.nail, 1);
  // The loose nail is used before the box's.
  assert.equal(w.submit("me", "labour", { kind: "set_nail" }).nails, 49);
  assert.equal(p.inventory.nail || 0, 0);
  // Pushed along: no more than 1.5 m a step from where it lay.
  w.items.set("item:heavy", { id: "item:heavy", item: "cinder_block", qty: 1, x: 1, z: 0 });
  const m = w.submit("me", "move_item", { id: "item:heavy", to: { x: 5, z: 0 } });
  assert.ok(m.ok); assert.ok(Math.abs(m.x - 2.5) < 1e-9, `${m.x}`);
});

test("the keys that went: V, J, H, B, K, E, G, U, C and PageUp / PageDown are not bound; ? and / open the controls; a click does the rest", () => {
  const view = readFileSync(new URL("../docs/city/view.mjs", import.meta.url), "utf8");
  const keys = view.slice(view.indexOf("  const KEYS = {"), view.indexOf("  };", view.indexOf("  const KEYS = {")));
  for (const k of ["v", "j", "h", "b", "k", "e", "g", "u", "c"]) assert.ok(!new RegExp(`[{\\s,]${k}: \\(\\) =>`).test(keys), `${k} is still bound`);
  assert.ok(keys.includes('"?": () => openSide("help"), "/": () => openSide("help")'));
  const page = readFileSync(new URL("../src/smc/renderer/page/module/22-explore-the-view-without-the.js", import.meta.url), "utf8");
  assert.ok(!page.includes('e.key !== "PageUp"') && page.includes('e.key === "ArrowUp" ? levels.find'));
  assert.ok(page.includes("livingCity.pressDown(ray)") && page.includes("livingCity?.pressUp?.()"));
  // What a click does, in the city's own click: staff, things, setting down, nails, pushing.
  for (const fn of ["function staffClicked(", "function thingClicked(", "function placeAt(", "function setNailAt(", "function pushUp(", "function pressDown(", "function startNav("]) assert.ok(view.includes(fn), fn);
  // C's thrust and shove are Shift + X; U's use the right click (held: eat on); G's pick-up a click (shelves too).
  assert.ok(keys.includes('"shift+x": () => thrustKey()') && view.includes("function useDown()") && view.includes("floor.pickAt(ray, me())"));
  assert.ok(page.includes("livingCity?.useDown?.()") && page.includes("livingCity?.useUp?.()"));
  for (const c of CONTROLS) assert.ok(!["g", "u", "c"].includes(c.key), c.id);
  // Shift tasks are R's, the bicycle Enter's.
  assert.ok(view.includes('key: "R", run: taskKey') && view.includes('label: "Ride your bicycle", key: "Enter"'));
});
