// A blow on a person, through the mechanics engine: where it lands, what it does to their body
// (flinch, stumble back, go down), and what their instinct makes them do next. And every material,
// every thing in the city and every layer of a person has its toughness listed for the engine.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createMechanics } from "../docs/city/mechanics.mjs";
import { BODY_ZONES, HIT, RESPONSE, ZONE_INJURIES, blowOn, hitZone, injuryAt, instinct, victimOf } from "../docs/city/hit-reaction.mjs";
import { temperamentOf } from "../docs/city/temperament.mjs";
import { loadRules } from "../docs/city/core.mjs";
import { CityWorld } from "../docs/city/world.mjs";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const C = read("../docs/object-catalogue.json"), M = createMechanics(C);
const R = loadRules(read("../docs/city/rules.json"));
const toughness = (id) => {
  const s = C.mechanics.substances[id];
  if (!s) return null;
  if (s.family === "fluid") return "fluid";
  const t = JSON.stringify(s);
  return /toughness|fracture_toughness/.test(t) ? "listed" : null;
};

test("every material, every thing in the city and every layer of a person has a substance with its toughness listed", () => {
  // The world's materials (catalogue materials; archetypes and surfaces name them).
  for (const [id, m] of Object.entries(C.materials)) if (id !== "none") assert.ok(toughness(m.mechanics), `material ${id} -> ${m.mechanics}`);
  for (const [id, a] of Object.entries(C.archetypes || {})) if (a.material && a.material !== "none") assert.ok(toughness(M.ofMaterial(a.material)), `archetype ${id}: ${a.material}`);
  // Every thing that can be held, thrown or struck (a service is not a thing).
  for (const [id, it] of Object.entries(R.items)) {
    if (!it || typeof it !== "object" || !it.material_of) continue;
    const sub = C.mechanics.item_materials[it.material_of];
    assert.ok(sub && toughness(sub), `item ${id}: ${it.material_of} -> ${sub}`);
  }
  // A person: each zone's skin, fat, muscle and bone.
  for (const [zone, z] of Object.entries(BODY_ZONES)) for (const [sub] of z.layers) assert.equal(toughness(sub), "listed", `${zone}: ${sub}`);
  // And what strikes them.
  for (const [id, t] of Object.entries(C.mechanics.implements)) if (typeof t === "object") assert.ok(toughness(t.substance), `implement ${id}: ${t.substance}`);
});

test("where a blow lands: by the height it was aimed at, a hand's breadth either way, now and then on a raised arm", () => {
  const H = 1.72, count = {};
  for (let i = 0; i < 2000; i += 1) { const z = hitZone(H * 0.88, H, `s${i}`).zone; count[z] = (count[z] || 0) + 1; }
  assert.ok(count.head > 300 && count.chest > 300, JSON.stringify(count));
  assert.ok((count.arm || 0) > 20 && (count.arm || 0) < 400, "a guard catches some");
  assert.ok(!count.leg && !count.belly, "a punch at the face does not land on the leg");
  assert.equal(hitZone(0.3, H, "x", 0).zone, "leg");
  assert.equal(hitZone(H * 0.6, H, "x", 0).zone, "belly");
});

test("the body's answer to a blow: a sway, a stumble a step at a time, or down -- harder blows, lighter and weaker bodies, the head", () => {
  const avg = victimOf({}), light = { kg: 55, height_m: 1.62, strength: 25, fat: 0.3 }, big = { kg: 95, height_m: 1.85, strength: 85, fat: 0.5 };
  const on = (v, joules, zone, tool = "fist") => blowOn(M, { joules, zone, tool }, v);
  // An ordinary punch to the chest: the average person steps back once, a big strong one sways.
  assert.equal(on(avg, 25, "chest").kind, "stumble");
  assert.equal(on(big, 25, "chest").kind, "flinch");
  assert.equal(on(avg, 15, "chest").kind, "flinch", "a light one is a flinch");
  // The push grows with the blow and falls with the body's mass.
  assert.ok(on(avg, 35, "chest").capture_m > on(avg, 25, "chest").capture_m);
  assert.ok(on(light, 25, "chest").capture_m > on(big, 25, "chest").capture_m);
  // Low blows hardly move the centre of mass; one to the head stuns a weaker person.
  assert.equal(on(avg, 25, "leg").kind, "flinch");
  assert.equal(on(light, 35, "head").kind, "fall");
  assert.ok(on(light, 35, "head").stunned);
  assert.notEqual(on(big, 35, "head").kind, "fall", "a strong neck holds the head");
  // A hammer to the head floors anyone; a sledgehammer breaks bone.
  assert.equal(on(avg, 50, "head", "claw_hammer").kind, "fall");
  assert.ok(on(avg, 400, "head", "sledgehammer").fracture);
  assert.ok(!on(avg, 25, "head").fracture, "a punch does not break a skull");
  // Every answer is the engine's: a contact force from the struck layers.
  const r = on(avg, 25, "chest");
  assert.ok(r.force_n > 100 && r.force_n < 2000 && r.layers.includes("skin"));
  assert.ok(r.capture_m > r.margin_m && r.steps >= 1 && r.steps <= HIT.max_steps);
});

test("what someone just hit does: their temperament, the odds against you, who is watching, the police near", () => {
  const hot = { nerve: 0.8, temper: 0.95, patience: 0.2, care: 0.3, civic: 0.2 };
  const timid = { nerve: 0.1, temper: 0.1, patience: 0.6, care: 0.6, civic: 0.3 };
  const civic = { nerve: 0.6, temper: 0.15, patience: 0.7, care: 0.85, civic: 0.95 };
  const base = { reaction: { kind: "stumble" }, attacker: 50, severity: 1, witnesses: 0, phone: true, seed: "a" };
  assert.equal(instinct(hot, { ...base, strength: 80 }).act, "fight");
  assert.equal(instinct(timid, { ...base, strength: 30 }).act, "run");
  assert.equal(instinct(civic, { ...base, strength: 50 }).act, "call_police");
  assert.equal(instinct({ ...timid, nerve: 0.35 }, { ...base, strength: 30, witnesses: 4 }).act, "call_help", "with people round, the timid call to them");
  assert.equal(instinct(hot, { ...base, role: "police" }).act, "arrest");
  assert.equal(instinct(hot, { ...base, reaction: { kind: "fall" } }).act, "down");
  assert.ok(instinct(civic, { ...base, police_near: true }).scores.call_police > instinct(civic, base).scores.call_police);
  assert.equal(instinct(civic, { ...base, phone: false }).scores.call_police, -Infinity, "no phone, no call");
  // Over a street of people: every act happens, freezing the rarest.
  const acts = {};
  for (let i = 0; i < 3000; i += 1) {
    const t = temperamentOf({ id: `p${i}`, age: 18 + (i % 60) });
    const a = instinct(t, { ...base, strength: 25 + (i % 60), witnesses: i % 5, severity: i % 4, seed: `s${i}` }).act;
    acts[a] = (acts[a] || 0) + 1;
  }
  for (const a of ["fight", "run", "call_police", "call_help"]) assert.ok(acts[a] > 150, JSON.stringify(acts));
  assert.ok((acts.freeze || 0) < 150, `freezing is rare: ${JSON.stringify(acts)}`);
});

test("the injury is one of the zone's", () => {
  for (const [zone, list] of Object.entries(ZONE_INJURIES)) {
    const band = R.harm.blow.flatMap((b) => b.types);
    const got = injuryAt({ type: "bruise", severity: 1 }, zone, band, "s");
    assert.ok(list.includes(got.type) && got.zone === zone, `${zone}: ${got.type}`);
  }
});

test("the city acts on the blow: knocked off their feet is down; a stumble leaves it to their instinct", () => {
  const AT = { x: 0, z: 0, lon: -122.437, lat: 37.80 };
  const responses = new Set(Object.values(RESPONSE));
  const w = new CityWorld(R, { now: Date.UTC(2026, 10, 25, 20), seed: "t" });
  w.submit("me", "join", { name: "Pat", at: AT });
  const down = w.submit("me", "strike_person", { npc: { id: "npc:a", name: "A", role: "barista", x: 1, z: 0 }, witnesses: 0, reaction: { kind: "fall", zone: "head", steps: 0 } });
  assert.ok(down.ok, down.error);
  assert.ok(down.down && down.response === "down" && ZONE_INJURIES.head.includes(down.injury.type), JSON.stringify(down.injury));
  const seen = new Set();
  for (let i = 0; i < 40; i += 1) {
    const r = w.submit("me", "strike_person", { npc: { id: `npc:b${i}`, name: "B", role: "barista", x: 1, z: 0, strength: 20 + i * 2 }, witnesses: i % 4, reaction: { kind: "stumble", zone: "chest", steps: 1 }, near: { police: i % 7 === 0 } });
    assert.ok(r.ok, r.error);
    assert.ok(responses.has(r.response), r.response);
    assert.equal(r.reaction.kind, "stumble");
    seen.add(r.response);
    w.players.get("me").vitals.health = 100;
  }
  assert.ok(seen.size >= 3, `more than one way to answer a blow: ${[...seen]}`);
  // A made-up reaction is not taken.
  const odd = w.submit("me", "strike_person", { npc: { id: "npc:z", name: "Z", role: "barista", x: 1, z: 0 }, reaction: { kind: "explode", zone: "spleen" } });
  assert.ok(odd.ok && odd.reaction === null);
});

test("someone hit with no phone on them never calls the police; one with a phone leans to it", () => {
  let withPhone = 0, without = 0;
  for (let i = 0; i < 2000; i += 1) {
    const t = temperamentOf({ id: `h${i}`, age: 30 });
    const ctx = { reaction: { kind: "flinch" }, strength: 50, attacker: 50, severity: 1, witnesses: 2, seed: `h${i}` };
    assert.notEqual(instinct(t, { ...ctx, phone: false }).act, "call_police");
    if (instinct(t, { ...ctx, phone: true }).act === "call_police") withPhone += 1;
    if (instinct(t, { ...ctx, phone: false }).act === "call_police") without += 1;
  }
  assert.equal(without, 0);
  assert.ok(withPhone > 0);
});
