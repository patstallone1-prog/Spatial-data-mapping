// Animals in the living city (docs/city/animals.mjs): pets as records that hunger, are hurt,
// healed and can die; how a pet near you moves; the neighbourhood's own; the birds' field.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { loadRules } from "../docs/city/core.mjs";
import { CityWorld } from "../docs/city/world.mjs";
import { AMBIENT, ANIMAL_COMMANDS, MOVE, PET, SPECIES, ambientCell, animalTier, birdAt, hurtPet, impactHarm, newPet, petMood, ratAt, settlePet, stepPet, stoopCat, vetQuote, walkedDog } from "../docs/city/animals.mjs";

const R = loadRules(JSON.parse(readFileSync(new URL("../docs/city/rules.json", import.meta.url))));
const HOUR = 3_600_000;

test("a pet is seen close and in full; a bird or a rat never is", () => {
  assert.equal(animalTier("dog", 5), 0);
  assert.equal(animalTier("dog", 50), 1);
  assert.equal(animalTier("dog", 150), 2);
  assert.equal(animalTier("dog", 400), -1);
  assert.equal(animalTier("cat", 10), 0);
  for (const bird of ["pigeon", "gull", "crow"]) { assert.equal(animalTier(bird, 2), 1, bird); assert.ok(SPECIES[bird].top >= 1); }
  assert.equal(animalTier("sparrow", 2), 2);
  assert.equal(animalTier("rat", 3), 2);
  assert.equal(animalTier("rat", 80), -1);
});

test("a pet hungers while you are about, starves unfed, mends a small hurt and dies of a great one untreated", () => {
  const pet = newPet("p1", "dog", "retriever", "Biscuit", 0);
  assert.equal(pet.name, "Biscuit");
  // A week away is not a week unfed: time passes only between looks close together.
  settlePet(pet, 7 * 24 * HOUR);
  assert.ok(pet.hunger < 40, `hunger ${pet.hunger} after a week away`);
  let now = pet.seen, died = null;
  for (let h = 0; h < 24 * 4 && !died; h += 2) { now += 2 * HOUR; died = settlePet(pet, now)?.died || null; }
  assert.equal(petMood(pet), "starving");
  assert.equal(died, null, "four days unfed it is starving, not dead");
  for (let h = 0; h < 24 * 6 && !died; h += 2) { now += 2 * HOUR; died = settlePet(pet, now)?.died || null; }
  assert.equal(died, "hunger");
  assert.ok(pet.dead && pet.health === 0);

  const cat = newPet("p2", "cat", "tabby", "Mog", 0);
  hurtPet(cat, 20, "a fall", 0);
  assert.equal(petMood(cat), "limping");
  let t = 0;
  for (let h = 0; h < 24 * 4; h += 2) { t += 2 * HOUR; cat.hunger = 10; settlePet(cat, t); }
  assert.equal(cat.injury, 0, "a small hurt mends by itself, fed");
  const r = hurtPet(cat, impactHarm(13.4, 4.5), "a car", t);
  assert.ok(r.died, "a car at 30 mph kills a cat");
  assert.ok(impactHarm(2) < 20 && impactHarm(13.4) >= 90);
  const dog = newPet("p3", "dog", "shepherd", "Rex", 0);
  hurtPet(dog, 55, "a car", 0);
  assert.equal(petMood(dog), "badly hurt");
  assert.ok(vetQuote(dog) > PET.treat_base + 300);
});

test("the world: adopt at a pet shop or online, feed from what you carry, tie up with a lead, the vet heals, the dead are laid to rest", () => {
  const w = new CityWorld(R, { now: Date.UTC(2026, 9, 28, 20) });
  w.cmd_join("a", { name: "Ada" });
  const p = w.player("a");
  p.x = 0; p.z = 0;
  w.ledger.mint(p.account, 500000, "external_trade");
  const petShop = { id: "ps", keys: ["shop:pet"], x: 2, z: 0 }, vet = { id: "vt", keys: ["shop:vet"], x: 3, z: 0 }, cafe = { id: "cf", keys: ["shop:cafe"], x: 1, z: 0 };
  for (const c of ANIMAL_COMMANDS) assert.equal(typeof w[`cmd_${c}`], "function", c);
  assert.throws(() => w.cmd_adopt_pet("a", { species: "dog", place: cafe }), /pet shop or a vet/);
  assert.throws(() => w.cmd_adopt_pet("a", { species: "pigeon", place: petShop }), /not an animal anyone keeps/);
  const before = w.ledger.balance(p.account);
  const { pet, fee } = w.cmd_adopt_pet("a", { species: "dog", breed: "retriever", name: "Biscuit", place: petShop });
  assert.equal(fee, SPECIES.dog.fee);
  assert.equal(w.ledger.balance(p.account), before - fee);
  const online = w.cmd_adopt_pet("a", { species: "cat", name: "Mog" });
  assert.equal(online.fee, Math.round(SPECIES.cat.fee * PET.online_fee), "brought to you costs more");
  assert.equal(w.pets("a").length, 2);
  // Food: its own kind, carried.
  assert.throws(() => w.cmd_feed_pet("a", { pet: pet.id, item: "dog_food" }), /not carrying/);
  w.cmd_buy("a", { item: "dog_food", place: petShop });
  assert.throws(() => w.cmd_feed_pet("a", { pet: online.pet.id, item: "dog_food" }), /does not eat that/);
  p.pets[pet.id].hunger = 90;
  const fed = w.cmd_feed_pet("a", { pet: pet.id, item: "dog_food" });
  assert.ok(fed.pet.hunger <= 10 && fed.left === 1, "a bag feeds more than once");
  // Tied up needs a lead; in the car and at home do not.
  assert.throws(() => w.cmd_pet_mode("a", { pet: pet.id, mode: "tied" }), /a lead/);
  w.cmd_buy("a", { item: "leash", place: petShop });
  assert.equal(w.cmd_pet_mode("a", { pet: pet.id, mode: "tied", at: { x: 4, z: 5 } }).pet.at.x, 4);
  assert.equal(w.cmd_pet_mode("a", { pet: pet.id, mode: "car", car: "vehicle:1" }).pet.car, "vehicle:1");
  w.cmd_pet_mode("a", { pet: pet.id, mode: "follow" });
  // Hurt, then the vet.
  const hurt = w.cmd_pet_hurt("a", { pet: pet.id, amount: 50, cause: "a car" });
  assert.equal(hurt.pet.mood, "badly hurt");
  assert.throws(() => w.cmd_vet_treat("a", { pet: pet.id, place: petShop }), /vet's surgery/);
  const bal = w.ledger.balance(p.account);
  const healed = w.cmd_vet_treat("a", { pet: pet.id, place: vet });
  assert.equal(healed.pet.injury, 0);
  assert.ok(healed.pet.health >= 85 && healed.price === hurt.pet.quote);
  assert.equal(w.ledger.balance(p.account), bal - healed.price);
  // Death, and the record gone only when you say so.
  const end = w.cmd_pet_hurt("a", { pet: online.pet.id, amount: 100, cause: "a car" });
  assert.ok(end.died);
  assert.throws(() => w.cmd_feed_pet("a", { pet: online.pet.id, item: "cat_food" }), /has died/);
  assert.throws(() => w.cmd_pet_farewell("a", { pet: pet.id }), /is alive/);
  assert.equal(w.cmd_pet_farewell("a", { pet: online.pet.id }).farewell, "Mog");
  assert.equal(w.pets("a").length, 1);
  assert.equal(w.cmd_name_pet("a", { pet: pet.id, name: "Sir <b>Woof</b>!" }).pet.name, "Sir bWoofb");
  // The shops and the online store carry the food.
  assert.ok(R.stores.kinds.pet.items.includes("dog_food") && R.stores.kinds.pet.items.includes("cat_food"));
  assert.equal(typeof w.cmd_buy_online, "function");
});

test("a pet follows at heel, goes round a wall, keeps out of the road, growls at a car bearing down and gets out of its way", () => {
  const pet = newPet("p1", "dog", "spaniel", "Fern", 0);
  const a = { x: 0, z: 6, yaw: 0, v: 0 };
  const owner = { x: 0, z: 0, yaw: 0, v: 1.4, inCar: false };
  // You walk north (-z) for twenty seconds: it keeps up, a step or two off.
  let far = 0;
  for (let t = 0; t < 20; t += 0.05) { owner.z -= owner.v * 0.05; stepPet(a, pet, { owner, dangers: [] }, 0.05); if (t > 5) far = Math.max(far, Math.hypot(a.x - owner.x, a.z - owner.z)); }
  assert.ok(far < 3, `fell ${far.toFixed(1)} m behind`);
  // A wall across its way: never inside it, and it gets round.
  const b = { x: 0, z: 5, yaw: 0, v: 0 }, wall = (x, z) => Math.abs(z - 2.5) < 0.4 && x > -3 && x < 1.2;
  const still = { x: 0, z: 0, yaw: 0, v: 0, inCar: false };
  for (let t = 0; t < 15; t += 0.05) { stepPet(b, pet, { owner: still, blocked: wall, dangers: [] }, 0.05); assert.ok(!wall(b.x, b.z), "in the wall"); }
  assert.ok(Math.hypot(b.x - still.x, b.z - still.z) < 2.5, `stuck ${Math.hypot(b.x, b.z).toFixed(1)} m off behind the wall`);
  // A road between it and where you stand on the pavement, with a car coming: it waits at the kerb.
  const c = { x: 0, z: 6, yaw: 0, v: 0 }, road = (x, z) => z > 2 && z < 5;
  for (let t = 0; t < 4; t += 0.05) stepPet(c, pet, { owner: still, onRoad: road, carNear: () => true, dangers: [] }, 0.05);
  assert.ok(c.z >= 5, "it stepped into the road in front of a car");
  for (let t = 0; t < 8; t += 0.05) stepPet(c, pet, { owner: still, onRoad: road, carNear: () => false, dangers: [] }, 0.05);
  assert.ok(c.z < 2.5, "with the road clear it comes over");
  // A car coming straight at it: a growl, then out of its line -- sideways, not ahead of it.
  const d = { x: 0, z: 0, yaw: 0, v: 0 }, sat = { ...pet, mode: "stay" }, seen = new Set();
  const car = { x: 0, z: 20, vx: 0, vz: -8, r: 1, kind: "car" };
  for (let t = 0; t < 2.4; t += 0.05) { car.z += car.vz * 0.05; for (const e of stepPet(d, sat, { owner: still, dangers: [car] }, 0.05)) seen.add(e); }
  assert.ok(seen.has("growl") && seen.has("back"));
  assert.ok(Math.abs(d.x) > 1.2, `it moved ${Math.abs(d.x).toFixed(1)} m aside`);
  // Tied up it stays on its lead whatever comes.
  const e = { x: 10, z: 10, yaw: 0, v: 0 }, tied = { ...pet, mode: "tied" }, post = { x: 10, z: 10 };
  const car2 = { x: 10, z: 30, vx: 0, vz: -8, r: 1, kind: "car" };
  for (let t = 0; t < 3; t += 0.05) { car2.z += car2.vz * 0.05; stepPet(e, tied, { owner: still, tether: post, dangers: [car2] }, 0.05); assert.ok(Math.hypot(e.x - 10, e.z - 10) <= PET.tether_m + 0.45); }
  // Hurt, it limps: slower. Dead, it does not move.
  const lame = { ...pet, injury: 60 }, f = { x: 0, z: 30, yaw: 0, v: 0 };
  for (let t = 0; t < 3; t += 0.05) stepPet(f, lame, { owner: still, dangers: [] }, 0.05);
  assert.ok(f.v <= SPECIES.dog.run * 0.3 && f.state === "limp");
  const g = { x: 0, z: 30, yaw: 0, v: 2 };
  stepPet(g, { ...pet, dead: { at: 0, cause: "a car" } }, { owner: still, dangers: [] }, 0.05);
  assert.equal(g.state, "dead"); assert.equal(g.v, 0); assert.equal(g.z, 30);
  // In the car before it: it comes to the door and is in.
  const h = { x: 3, z: 0, yaw: 0, v: 0 }, boarded = [];
  for (let t = 0; t < 4 && !boarded.length; t += 0.05) for (const ev of stepPet(h, pet, { owner: { x: 0, z: 0, yaw: 0, v: 0, inCar: true, boarding: true }, dangers: [] }, 0.05)) if (ev === "board") boarded.push(t);
  assert.ok(boarded.length, "it got to the car door");
  assert.ok(MOVE.growl_m > MOVE.back_m);
});

test("the neighbourhood's dogs and cats are the same every day; the birds' field is seeded, capped and by the hour", () => {
  let dogs = 0;
  for (let i = 0; i < 600; i += 1) { const d = walkedDog(`npc:${i}`, "out for a walk"); if (d) { dogs += 1; assert.deepEqual(d, walkedDog(`npc:${i}`, "out for a walk")); assert.ok(SPECIES.dog.breeds[d.breed]); } }
  assert.ok(dogs > 60 && dogs < 160, `${dogs} of 600 strollers with a dog`);
  assert.equal(walkedDog("npc:0", "to work"), null);
  let cats = 0;
  for (let i = 0; i < 900; i += 1) { const place = { id: `home:${i}`, x: i, z: 0 }; if (stoopCat(place, 13)) cats += 1; assert.equal(stoopCat(place, 2), null, "in at night"); assert.equal(stoopCat(place, 13, true), null, "in from the rain"); }
  assert.ok(cats > 15 && cats < 120, `${cats} cats out at one o'clock`);
  // The field: the same cell at the same hour has the same; gulls by the water; rats by night only.
  const shore = () => ({ water: 50, shops: 2, park: false }), inland = () => ({ water: null, shops: 0, park: false });
  assert.deepEqual(ambientCell(3, 4, 10, shore), ambientCell(3, 4, 10, shore));
  let gullsShore = 0, gullsInland = 0, ratsDay = 0, ratsNight = 0, birdsNight = 0;
  for (let i = 0; i < 40; i += 1) for (let j = 0; j < 40; j += 1) {
    gullsShore += ambientCell(i, j, 10, shore).filter((f) => f.species === "gull").length;
    gullsInland += ambientCell(i, j, 10, inland).filter((f) => f.species === "gull").length;
    ratsDay += ambientCell(i, j, 10, shore).filter((f) => f.species === "rat").length;
    ratsNight += ambientCell(i, j, 23, shore).filter((f) => f.species === "rat").length;
    birdsNight += ambientCell(i, j, 23, shore).filter((f) => SPECIES[f.species].kind === "bird").length;
  }
  assert.ok(gullsShore > gullsInland * 5);
  assert.equal(ratsDay, 0); assert.ok(ratsNight > 50); assert.equal(birdsNight, 0);
  // A pigeon pecks about its spot; flushed, it is up and round and down again. A gull keeps its height.
  const flock = { species: "pigeon", x: 100, z: 100, r: 10, alt: 0, seed: 77, n: 8 }, at = {};
  birdAt(flock, 2, 30, AMBIENT, at);
  assert.equal(at.air, false); assert.equal(at.y, 0); assert.ok(Math.hypot(at.x - 100, at.z - 100) < 4);
  flock.up = 30;
  birdAt(flock, 2, 34, AMBIENT, at);
  assert.ok(at.air && at.y > 2 && at.flap > 0);
  birdAt(flock, 2, 30 + AMBIENT.air_s + 1, AMBIENT, at);
  assert.equal(at.air, false);
  const gull = { species: "gull", x: 0, z: 0, r: 20, alt: 25, seed: 5, n: 2 };
  for (const t of [0, 10, 50]) { birdAt(gull, 0, t, AMBIENT, at); assert.ok(at.air && at.y > 20 && at.y < 30); }
  const rat = { species: "rat", x: 0, z: 0, seed: 12 }, r1 = ratAt(rat, 5, {}), far = Math.hypot(r1.x, r1.z);
  assert.ok(far < 10);
  assert.ok(AMBIENT.birds_most <= 400 && AMBIENT.rats_most <= 40);
});

test("the figures: three tiers, a pet's the finest; nothing drawn that is not finite; the page wires them in", async () => {
  const THREE = await import("../docs/vendor/three-0.160.0/three.module.min.js");
  const { animalFigures, ANIMAL_CAPS } = await import("../docs/city/animal-figures.mjs");
  const added = [], F = animalFigures({ THREE, add: (m) => added.push(m) });
  assert.ok(F.triangles.full > 5000, `a pet near you is ${F.triangles.full} triangles`);
  assert.ok(F.triangles.mid < F.triangles.full / 4 && F.triangles.low < F.triangles.mid / 2);
  F.begin(1);
  let k = 0;
  for (const species of ["dog", "cat", "rabbit"]) for (const breed of Object.keys(SPECIES[species].breeds)) for (const state of ["idle", "walk", "run", "sit", "limp", "dead", "alert", "flee"]) for (const tier of [0, 1, 2]) { F.quadruped({ x: k, y: 0, z: 0, yaw: k * 0.3, species, breed, tier, state, gait: k, v: /walk|run|limp|flee/.test(state) ? 2 : 0, seed: k }); k += 1; }
  for (const species of ["pigeon", "gull", "sparrow", "crow"]) for (const air of [true, false]) F.bird({ x: 1, y: 2, z: 3, yaw: 1, species, air, flap: 0.7, tier: SPECIES[species].top, k: 3 });
  F.rat({ x: 0, y: 0, z: 0, yaw: 2 }); F.lead(0, 1, 0, 1, 0.3, 0.4);
  F.end();
  const st = F.stats();
  assert.equal(st.full, ANIMAL_CAPS.full, "no more in full than there is room for");
  for (const m of added) { assert.ok(m.count <= m.instanceMatrix.count); for (let i = 0; i < m.count * 16; i += 1) assert.ok(Number.isFinite(m.instanceMatrix.array[i]), m.name); }
  // A dog stood: its feet at the ground, its head above its back.
  const box = new THREE.Box3(), v = new THREE.Vector3(), mm = new THREE.Matrix4();
  F.begin(0); F.quadruped({ x: 0, y: 0, z: 0, yaw: 0, species: "dog", breed: "retriever", tier: 0, state: "alert", gait: 0, v: 0 }); F.end();
  for (const m of added) for (let i = 0; i < m.count; i += 1) { m.getMatrixAt(i, mm); const p = m.geometry.attributes.position; for (let q = 0; q < p.count; q += 1) { v.fromBufferAttribute(p, q).applyMatrix4(mm); box.expandByPoint(v); } }
  assert.ok(Math.abs(box.min.y) < 0.06, `feet at ${box.min.y.toFixed(2)}`);
  assert.ok(box.max.y > SPECIES.dog.breeds.retriever.shoulder + 0.1 && box.max.y < 1.0);
  const view = readFileSync(new URL("../docs/city/view.mjs", import.meta.url), "utf8");
  assert.ok(view.includes('k: () => openSide("pets"), l: () => animals().leashKey(),'));
  assert.ok(view.includes("animals().frame(dt, now)") && view.includes("for (const o of animalsUI?.obstacles() || []) obstacles.push(o);"));
  assert.ok(view.includes("if (animals().draw(side, { close, status, w, p })) return;"));
});
