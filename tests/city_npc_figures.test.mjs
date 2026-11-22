// The near ring's MakeHuman people (docs/city/npc-figures.mjs): who wears what. Every person is
// their own -- the same every time, from their id -- and a crowd is many different people: tops
// and bottoms from different suits, hairstyles by the wardrobe's cut (everyone has hair), hats by
// how often each is worn, builds, heights and ages, ways of walking; a phone in a pocket.
import assert from "node:assert/strict";
import { test } from "node:test";

import { FACING_OFFSET, HATS, NEAR_FIGURES_MAX, NO_POCKETS, SLOTS, WALKS, crowdLook, slotsOf } from "../docs/city/npc-figures.mjs";
import { dressFor, looksOf } from "../docs/city/wardrobe.mjs";
import { temperamentOf } from "../docs/city/temperament.mjs";

// A body's parts as tools/avatars/build_crowd_people.py writes them into crowd.json.
const suits = { male: ["male_casualsuit01", "male_casualsuit02", "male_casualsuit03", "male_casualsuit04", "male_casualsuit05", "male_casualsuit06", "male_elegantsuit01", "male_worksuit01"],
  female: ["female_casualsuit01", "female_casualsuit02", "female_elegantsuit01", "female_sportsuit01"] };
const HAIR = ["short01", "short02", "short03", "short04", "bob02", "long01", "ponytail01", "braid01", "afro01"];
function partsOf(sex) {
  const p = [];
  for (const s of suits[sex]) { p.push({ id: `top__${s}`, slot: "top", asset: s }); p.push({ id: `bottom__${s}`, slot: "bottom", asset: s }); }
  for (let i = 1; i <= 6; i += 1) p.push({ id: `shoes__shoes0${i}`, slot: "shoes", asset: `shoes0${i}` });
  for (const h of HAIR) p.push({ id: `hair__${h}`, slot: "hair", asset: h });
  if (sex === "male") for (const f of ["rehmanpolanski_beard_viking", "rehmanpolanski_moustache_viking"]) p.push({ id: `facial_hair__${f}`, slot: "facial_hair", asset: f });
  for (const h of ["fedora01", "baseball_cap", "beanie"]) p.push({ id: `hat__${h}`, slot: "hat", asset: h });
  // (The finer face, the inside of the mouth: on every body.)
  p.push({ id: "head__basemesh", slot: "head", asset: "basemesh" }, { id: "mouth__back", slot: "mouth", asset: "back" });
  for (const e of ["eyebrow001", "eyebrow006"]) p.push({ id: `eyebrows__${e}`, slot: "eyebrows", asset: e });
  p.push({ id: "eyes__low-poly", slot: "eyes", asset: "low-poly" });
  return p;
}
const PARTS = { male: partsOf("male"), female: partsOf("female") };
const SL = { male: slotsOf(PARTS.male), female: slotsOf(PARTS.female) };
const ROLES = ["clerk", "cook", "nurse", "banker", "builder", null, null, null];
function person(i) {
  const p = { id: `npc:t${i}:0`, age: 18 + (i * 7) % 62, role: ROLES[i % ROLES.length], pace: 1.3 };
  const female = i % 2 === 0, looks = looksOf(p, { grey: p.age > 60 });
  const body = { female, hair: looks.hair, skin: looks.skin, heritage: looks.heritage, bald: p.age > 40 && i % 13 === 0 };
  const o = dressFor(p, body, temperamentOf(p));
  return { p, female, height: female ? 1.6 + (i % 5) * 0.03 : 1.7 + (i % 7) * 0.03, build: (female ? 0.9 : 1) + ((i % 9) - 4) * 0.03,
    look: { top: o.topColour, bottom: o.bottoms, shoes: o.shoes, hair: body.hair, skin: body.skin, garment: o.top, legs: o.legs, cut: o.hair, bald: body.bald, heritage: body.heritage, age: p.age } };
}
const lookOf = (q) => crowdLook(q.p.id, q.look, SL, { height: q.height, build: q.build, female: q.female, modelHeight: q.female ? 1.59 : 1.73 });
const assetOf = (sex, pick, slot) => { const x = pick.parts.find((p) => p.slot === slot); return x ? PARTS[sex][x.index].asset : null; };

test("the room and the facing", () => {
  assert.equal(NEAR_FIGURES_MAX, 80);
  assert.equal(FACING_OFFSET, Math.PI);
  for (const s of SLOTS) assert.ok(Array.isArray(SL.male[s]), s);
  assert.equal(SL.male.top.length, 8); assert.equal(SL.female.bottom.length, 4);
});

test("the same person is dressed the same every time; everyone dressed in a body, a face and a mouth, a top, a bottom, shoes, hair, brows and eyes", () => {
  for (let i = 0; i < 60; i += 1) {
    const q = person(i), a = lookOf(q), b = lookOf(q);
    assert.deepEqual(a, b);
    assert.equal(a.sex, q.female ? "female" : "male");
    for (const slot of ["body", "head", "mouth", "top", "bottom", "shoes", "hair", "eyebrows", "eyes"]) assert.equal(a.parts.filter((p) => p.slot === slot).length, 1, `${q.p.id} ${slot}`);
    // Each part is one of their own body's (an index into its parts), not the other's.
    for (const p of a.parts) if (p.slot !== "body") assert.equal(PARTS[a.sex][p.index].slot, p.slot);
    assert.ok(a.height > 0.85 && a.height < 1.2, `height ${a.height}`);
    assert.ok(a.weight >= -1 && a.weight <= 1 && a.muscle >= 0 && a.muscle <= 1 && a.old >= 0 && a.old <= 1);
  }
});

test("a crowd is many different people: outfits mixed and matched, every hairstyle, beards, hats, builds", () => {
  const outfits = new Set(), hair = new Set(), shoes = new Set(), weights = [], beards = { yes: 0, n: 0 }, hats = { yes: 0 }, hatKinds = {}, walks = new Set();
  const N = 400;
  for (let i = 0; i < N; i += 1) {
    const q = person(i), a = lookOf(q);
    outfits.add(`${a.sex}:${assetOf(a.sex, a, "top")}/${assetOf(a.sex, a, "bottom")}`);
    hair.add(assetOf(a.sex, a, "hair"));
    shoes.add(assetOf(a.sex, a, "shoes"));
    weights.push(a.weight);
    if (a.sex === "male" && q.p.age >= 18) { beards.n += 1; if (assetOf("male", a, "facial_hair")) beards.yes += 1; }
    const hat = assetOf(a.sex, a, "hat");
    if (hat) { hats.yes += 1; hatKinds[hat] = (hatKinds[hat] || 0) + 1; }
    walks.add(a.walk);
  }
  assert.ok(outfits.size >= 30, `${outfits.size} top-and-bottom pairs`);
  // A top over another suit's bottom happens.
  assert.ok([...outfits].some((o) => { const [t, b] = o.split(":")[1].split("/"); return t !== b; }));
  assert.ok(hair.size >= 8, `${hair.size} hairstyles`);
  assert.equal(shoes.size, 6);
  assert.ok(beards.yes / beards.n > 0.1 && beards.yes / beards.n < 0.35, `beards ${beards.yes}/${beards.n}`);
  assert.ok(hats.yes > 20 && hats.yes < 90, `hats ${hats.yes}`);
  // By how often each is worn: baseball caps most, then beanies; a fedora is rare.
  assert.ok((hatKinds.baseball_cap || 0) > (hatKinds.beanie || 0) && (hatKinds.beanie || 0) > (hatKinds.fedora01 || 0), JSON.stringify(hatKinds));
  assert.ok((hatKinds.fedora01 || 0) < hats.yes * 0.15, JSON.stringify(hatKinds));
  assert.deepEqual([...walks].sort(), [...WALKS].sort());
  assert.ok(Math.min(...weights) < -0.4 && Math.max(...weights) > 0.4, "thin and heavy both");
});

test("the wardrobe's garment and cut choose the parts: a suit is the elegant suit, work clothes the work suit, the bald a close crop", () => {
  const base = person(3);
  const as = (look, female = false) => crowdLook("npc:x:1", { ...base.look, ...look }, SL, { female, height: 1.75, build: 1, modelHeight: 1.73 });
  assert.equal(assetOf("male", as({ garment: "suit", legs: "suit_trousers" }), "top"), "male_elegantsuit01");
  assert.equal(assetOf("male", as({ garment: "suit", legs: "suit_trousers" }), "bottom"), "male_elegantsuit01");
  assert.equal(assetOf("male", as({ garment: "hi_vis", legs: "work_trousers" }), "top"), "male_worksuit01");
  assert.equal(assetOf("female", as({ garment: "running", legs: "running_shorts" }, true), "top"), "female_sportsuit01");
  assert.match(assetOf("male", as({ garment: "tee", legs: "jeans" }), "top"), /casualsuit/);
  // Everyone has hair: the bald a close crop.
  for (let i = 0; i < 30; i += 1) {
    const a = crowdLook(`npc:bald${i}:0`, { ...base.look, cut: "none", bald: true }, SL, { female: false, height: 1.75, build: 1, modelHeight: 1.73 });
    const h = assetOf("male", a, "hair");
    assert.ok(h, "hair");
    if (!assetOf("male", a, "hat")) assert.equal(h, "short04");
  }
  for (let i = 0; i < 40; i += 1) {
    const a = crowdLook(`npc:long${i}:0`, { ...base.look, cut: "long" }, SL, { female: true, height: 1.65, build: 0.9, modelHeight: 1.59 });
    const h = assetOf("female", a, "hair");
    if (!assetOf("female", a, "hat")) assert.ok(["long01", "ponytail01", "braid01", "bob02", "afro01"].includes(h), h);
  }
  // Their colours are theirs: the top the wardrobe's top colour, the hair their hair.
  const a = as({ garment: "tee", top: "#123456", hair: "#654321" });
  assert.equal(a.parts.find((p) => p.slot === "top").colour, "#123456");
  assert.equal(a.parts.find((p) => p.slot === "hair").colour, "#654321");
  assert.equal(a.parts.find((p) => p.slot === "eyebrows").colour, "#654321");
});

test("older is the older morph; a child is scaled to their height", () => {
  const young = crowdLook("npc:a:1", { age: 22 }, SL, { female: false, height: 1.75, modelHeight: 1.73 });
  const old = crowdLook("npc:a:1", { age: 78 }, SL, { female: false, height: 1.75, modelHeight: 1.73 });
  assert.equal(young.old, 0); assert.ok(old.old > 0.8);
  const kid = crowdLook("npc:k:1", { age: 9 }, SL, { female: null, height: 1.3, modelHeight: 1.73 });
  assert.ok(kid.height < 0.8);
  assert.equal(kid.parts.some((p) => p.slot === "facial_hair"), false);
});

test("a phone in a pocket, if there is one: left at home by those in a skirt, a dress, leggings or running shorts", () => {
  for (const legs of NO_POCKETS) assert.equal(crowdLook("npc:p:1", { age: 30, legs }, SL, { female: true }).phone, null, legs);
  for (let i = 0; i < 20; i += 1) {
    const a = crowdLook(`npc:p${i}:0`, { age: 30, legs: "jeans" }, SL, { female: i % 2 === 0 });
    assert.match(a.phone, /^#[0-9a-f]{6}$/);
  }
  assert.equal(crowdLook("npc:kid:0", { age: 9, legs: "jeans" }, SL, { female: null }).phone, null);
});

test("hats by how often they are worn: shares that add to under a fifth, the cap the commonest", () => {
  const total = HATS.reduce((a, [, w]) => a + w, 0);
  assert.ok(total < 0.2);
  assert.equal(HATS[0][0], "baseball_cap");
  assert.ok(HATS.every(([, w]) => w <= HATS[0][1]));
});
