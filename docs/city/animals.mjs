// Animals in the living city (docs/56-animals-plan.md, built 2026-11-22).
//
// Three kinds of animal, by what each costs to keep:
//
//   kept      a pet of yours: a record on your account in the world (CityWorld, the server's), with
//             a name, health, hunger and an injury if it has one. It goes on existing when nobody
//             is looking, can be hurt and healed, and can die.
//   resident  the neighbourhood's own: the dogs the city's people walk, the cats on the stoops.
//             Each is made from a seed (the walker's id, the door's place) and is where its routine
//             has it; nothing is stored.
//   ambient   pigeons, gulls, sparrows, crows and rats: made from a seeded field of cells round
//             you, on set paths, gone when you are. Visual only.
//
// This file is pure: the species, the pet's record and its upkeep, how a pet near you moves
// (stepPet: follows, keeps out of walls and off the road, growls at danger and backs off from it,
// limps when hurt), the residents and the ambient field, and the world's commands
// (installAnimals). What is drawn is animal-figures.mjs; what joins it to the page is
// animals-view.mjs. Tests: tests/city_animals.test.mjs.
import { hash32 } from "./people.mjs";

const unit = (...k) => (hash32(...k) % 100003) / 100002;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const HOUR = 3_600_000, DAY = 24 * HOUR;

// ---- the species --------------------------------------------------------------------------------

//: How near an animal is ever drawn in full. A pet is seen from a step away; a bird never is.
//: ``top``: the finest tier it is ever given (0 full, 1 moderate, 2 low) -- detail.mjs's tiers.
//: ``rings``: [full within, moderate within, low within] (m): past the last it is not drawn.
export const SPECIES = {
  dog: { name: "Dog", kind: "pet", top: 0, rings: [30, 75, 190], food: ["dog_food", "pet_treats"], walk: 1.5, run: 6.5, fee: 180, years: 13, sound: "growls",
    breeds: {
      terrier: { name: "Terrier", shoulder: 0.3, length: 0.46, kg: 7, coat: [0xe8dcc6, 0x8a5a36], ears: "fold", tail: "up", snout: 0.5 },
      spaniel: { name: "Spaniel", shoulder: 0.4, length: 0.58, kg: 13, coat: [0x7a4a2a, 0xf1e9dc], ears: "drop", tail: "plume", snout: 0.6 },
      retriever: { name: "Retriever", shoulder: 0.58, length: 0.8, kg: 30, coat: [0xd9b46c, 0xd9b46c], ears: "drop", tail: "plume", snout: 0.7 },
      shepherd: { name: "Shepherd", shoulder: 0.62, length: 0.86, kg: 34, coat: [0x2b241c, 0xb07a3c], ears: "prick", tail: "low", snout: 0.8 },
      bulldog: { name: "Bulldog", shoulder: 0.36, length: 0.56, kg: 22, coat: [0xcab39a, 0xf4efe6], ears: "fold", tail: "stub", snout: 0.25 },
      husky: { name: "Husky", shoulder: 0.56, length: 0.78, kg: 24, coat: [0x555b63, 0xf4f4f1], ears: "prick", tail: "curl", snout: 0.7 },
    } },
  cat: { name: "Cat", kind: "pet", top: 0, rings: [22, 55, 140], food: ["cat_food", "pet_treats"], walk: 1.1, run: 7.5, fee: 120, years: 15, sound: "hisses",
    breeds: {
      tabby: { name: "Tabby", shoulder: 0.25, length: 0.42, kg: 4.5, coat: [0x8a7458, 0x3b3128], ears: "prick", tail: "long", snout: 0.18, stripes: true },
      black: { name: "Black cat", shoulder: 0.25, length: 0.42, kg: 4.5, coat: [0x1c1b1d, 0x1c1b1d], ears: "prick", tail: "long", snout: 0.18 },
      ginger: { name: "Ginger", shoulder: 0.26, length: 0.44, kg: 5, coat: [0xc9762f, 0xf2e6d2], ears: "prick", tail: "long", snout: 0.18, stripes: true },
      tuxedo: { name: "Tuxedo", shoulder: 0.25, length: 0.42, kg: 4.5, coat: [0x202024, 0xf4f4f1], ears: "prick", tail: "long", snout: 0.18 },
      siamese: { name: "Siamese", shoulder: 0.26, length: 0.44, kg: 4, coat: [0xe6dccb, 0x4a3a30], ears: "prick", tail: "long", snout: 0.2 },
    } },
  rabbit: { name: "Rabbit", kind: "pet", top: 0, rings: [18, 45, 110], food: ["pet_treats"], walk: 0.9, run: 5, fee: 70, years: 9, sound: "thumps",
    breeds: {
      lop: { name: "Lop rabbit", shoulder: 0.17, length: 0.34, kg: 2.2, coat: [0xb9a48a, 0xf2ece2], ears: "drop", tail: "stub", snout: 0.12 },
      dutch: { name: "Dutch rabbit", shoulder: 0.16, length: 0.32, kg: 2, coat: [0x2a2622, 0xf4f4f1], ears: "long", tail: "stub", snout: 0.12 },
    } },
  // Never drawn in full: a bird is a few pixels and stays away; a rat is a glimpse at the kerb.
  pigeon: { name: "Pigeon", kind: "bird", top: 1, rings: [0, 35, 150], span: 0.62, length: 0.32, ground: true, flock: [5, 18], coat: [0x7f8792, 0x4d5560] },
  gull: { name: "Gull", kind: "bird", top: 1, rings: [0, 45, 260], span: 1.35, length: 0.6, ground: false, flock: [1, 4], coat: [0xf1f2f1, 0x8a9198] },
  sparrow: { name: "Sparrow", kind: "bird", top: 2, rings: [0, 0, 55], span: 0.22, length: 0.15, ground: true, flock: [3, 9], coat: [0x8a6a4a, 0x5a4634] },
  crow: { name: "Crow", kind: "bird", top: 1, rings: [0, 40, 200], span: 0.9, length: 0.45, ground: true, flock: [1, 3], coat: [0x15151a, 0x15151a] },
  rat: { name: "Rat", kind: "vermin", top: 2, rings: [0, 0, 45], length: 0.22, coat: [0x5a5048, 0x5a5048] },
};
export const PET_SPECIES = Object.keys(SPECIES).filter((k) => SPECIES[k].kind === "pet");

//: The tier an animal of ``species`` is drawn at ``dist`` m from you (0 full .. 2 low), or -1:
//: not drawn. Never finer than the species' own top tier.
export function animalTier(species, dist) {
  const S = SPECIES[species];
  if (!S) return -1;
  for (let t = S.top; t < 3; t += 1) if (dist <= S.rings[t]) return t;
  return -1;
}

// ---- a pet: the record, and what time does to it ---------------------------------------------

export const PET = {
  most: 4,                      // pets on one account
  hunger_day: 60,               // hunger gained in a game day awake (0 fed .. 100 starving)
  starve_day: 30,               // health lost a game day at hunger 100
  bleed_day: 45,                // health lost a game day with a serious injury untreated
  mend_day: 12,                 // an injury under ``serious`` mends by this a game day, fed
  serious: 40,                  // an injury this bad does not mend alone
  gap_hours: 3,                 // time passes for a pet only while you are about: this much at most between two looks
  treat_base: 140, treat_per: 9,// the vet: a visit and so much a point of injury
  online_fee: 1.25,             // adopted through the online store: the rescue brings it to you
  food: { dog_food: 85, cat_food: 85, pet_treats: 22 },   // hunger taken off
  board_s: 2.5,                 // how long a pet takes to get into the car after you
  tether_m: 1.6,                // the lead's length tied up
  heel_m: 1.1,                  // where it walks: this far to your side and a little behind
};
export const PET_MODES = ["follow", "stay", "tied", "car", "home"];

//: A new pet of ``species`` and ``breed`` (a seed picks what was not chosen).
export function newPet(id, species, breed, name, now, seed = id) {
  const S = SPECIES[species];
  if (!S || S.kind !== "pet") throw new Error(`no pets of kind ${species}`);
  const breeds = Object.keys(S.breeds);
  const b = S.breeds[breed] ? breed : breeds[hash32(seed, "breed") % breeds.length];
  return { id, species, breed: b, name: String(name || S.breeds[b].name).slice(0, 24), born: now - Math.round((0.6 + unit(seed, "age") * 5) * 365 * DAY),
    health: 100, hunger: 20, injury: 0, cause: null, mode: "follow", at: null, car: null, seen: now, adopted: now, dead: null,
    temper: { nerve: +(0.2 + unit(seed, "nerve") * 0.7).toFixed(2), energy: +(0.3 + unit(seed, "energy") * 0.7).toFixed(2), bond: 0.3 } };
}

//: ``pet`` brought up to ``now``: hungrier, weaker if starving or bleeding, mending if fed. Time
//: passes for it only while its owner is about (``gap_hours`` at most between two looks), so a
//: week away is not a week unfed. Returns what happened: null, or {died: cause}.
export function settlePet(pet, now, P = PET) {
  if (pet.dead) return null;
  const hours = clamp((now - (pet.seen ?? now)) / HOUR, 0, P.gap_hours);
  pet.seen = now;
  if (hours <= 0) return null;
  const days = hours / 24;
  pet.hunger = clamp(pet.hunger + P.hunger_day * days, 0, 100);
  if (pet.hunger >= 100) pet.health -= P.starve_day * days;
  if (pet.injury >= P.serious) pet.health -= P.bleed_day * days * (pet.injury / 100);
  else if (pet.injury > 0 && pet.hunger < 80) pet.injury = Math.max(0, pet.injury - P.mend_day * days);
  if (pet.injury <= 0) { pet.injury = 0; if (pet.hunger < 60 && pet.health < 100) pet.health = Math.min(100, pet.health + 8 * days); }
  pet.health = clamp(pet.health, 0, 100);
  if (pet.health <= 0) { pet.dead = { at: now, cause: pet.hunger >= 100 ? "hunger" : pet.cause || "its injuries" }; pet.mode = "stay"; return { died: pet.dead.cause }; }
  return null;
}

//: A blow to ``pet`` of ``amount`` (0..100: a car at walking pace 15, at 30 mph 90). Returns
//: {injury, health, died}.
export function hurtPet(pet, amount, cause, now) {
  if (pet.dead) return { injury: pet.injury, health: 0, died: false };
  const a = clamp(Number(amount) || 0, 0, 100);
  pet.injury = clamp(pet.injury + a, 0, 100);
  pet.health = clamp(pet.health - a, 0, 100);
  pet.cause = String(cause || "an accident").slice(0, 40);
  if (pet.health <= 0) { pet.dead = { at: now, cause: pet.cause }; pet.mode = "stay"; return { injury: pet.injury, health: 0, died: true }; }
  return { injury: pet.injury, health: pet.health, died: false };
}

//: What a car going ``speed`` m/s does to an animal of ``kg`` it hits (0..100).
export function impactHarm(speed, kg = 10) {
  const v = Math.max(0, speed);
  return clamp(Math.round((v * v * 0.55 + v * 4) * (kg < 8 ? 1.25 : 1)), 0, 100);
}

//: What the vet asks to treat ``pet`` as it is.
export const vetQuote = (pet, P = PET) => (pet.injury > 0 || pet.health < 100 ? Math.round(P.treat_base + P.treat_per * pet.injury + (100 - pet.health) * 1.5) : P.treat_base);

//: How ``pet`` is, in a few words.
export function petMood(pet) {
  if (pet.dead) return "has died";
  if (pet.injury >= PET.serious) return "badly hurt";
  if (pet.injury > 0) return "limping";
  if (pet.hunger >= 90) return "starving";
  if (pet.hunger >= 65) return "hungry";
  if (pet.health < 60) return "poorly";
  return "well";
}

// ---- how a pet near you moves ----------------------------------------------------------------

export const MOVE = {
  growl_m: 9, back_m: 5.5, danger_speed: 3,       // something coming at it this fast, this near: growled at; nearer, backed away from
  look_m: 0.9,                                      // how far ahead it tries its step for a wall
  catch_up_m: 6, lost_m: 45,                        // further from you than this it runs; past ``lost`` it is put back beside you
  kerb_wait_m: 2.2,                                 // it does not step into a road you are not in, with a car this many seconds off
  turn: 7,                                          // how fast it turns (rad/s)
};

//: One step of a pet that is out with you. ``a``: what moves, kept by the page
//: {x, z, yaw, v, state, growl (s left), gait (phase)}. ``pet``: the record. ``w``: the world as
//: it needs it --
//:   owner {x, z, yaw, v, inCar}; blocked(x, z) -> a wall or a thing in the way; onRoad(x, z);
//:   dangers [{x, z, vx, vz, r, kind}] (cars, a fight); tether {x, z} when tied.
//: Returns the events of the step: [] or ["growl" | "back" | "arrived" | "board"].
export function stepPet(a, pet, w, dt, M = MOVE, P = PET) {
  const S = SPECIES[pet.species], ev = [];
  a.gait = (a.gait || 0) + dt * Math.max(0.2, a.v || 0) * 2.6;
  if (pet.dead) { a.v = 0; a.state = "dead"; return ev; }
  const limp = pet.injury >= P.serious ? 0.25 : pet.injury > 0 ? 0.55 : 1;
  const top = S.run * limp * (0.8 + 0.2 * pet.temper.energy), stroll = S.walk * Math.min(1, limp + 0.2);
  // Where it means to be.
  let tx = a.x, tz = a.z, want = 0, state = "idle";
  if (pet.mode === "follow" && w.owner && !w.owner.inCar) {
    // (Each of your pets has a place of its own: one to each side, the next pair a step behind.)
    const o = w.owner, slot = a.slot ?? hash32(pet.id, "side") % 2, side = P.heel_m * (slot % 2 ? 1 : -1) * (0.7 + 0.5 * (S.breeds[pet.breed]?.shoulder || 0.3)), back = 0.5 + Math.floor(slot / 2) * 0.9;
    const fx = -Math.sin(o.yaw), fz = -Math.cos(o.yaw);
    tx = o.x - fx * back + -fz * side; tz = o.z - fz * back + fx * side;
    const d = Math.hypot(tx - a.x, tz - a.z);
    if (d > M.lost_m) { a.x = tx; a.z = tz; a.v = 0; a.state = "idle"; ev.push("arrived"); return ev; }
    want = d < 0.35 ? 0 : d > M.catch_up_m ? top : Math.min(top, Math.max(stroll, (o.v || 0) * 1.05 + (d - 0.8) * 1.2));
    state = want > stroll * 1.6 ? "run" : want > 0 ? "walk" : "idle";
  } else if (pet.mode === "follow" && w.owner?.inCar && w.owner.boarding) {
    // You are in the car: it comes to the door and is in, a moment after you.
    tx = w.owner.x; tz = w.owner.z;
    const d = Math.hypot(tx - a.x, tz - a.z);
    want = d < 1.4 ? 0 : top; state = want ? "run" : "idle";
    if (d < 1.6) ev.push("board");
  } else if (pet.mode === "tied" && w.tether) {
    // On its lead: about the post, never past the lead's length.
    const d = Math.hypot(w.tether.x - a.x, w.tether.z - a.z);
    if (d > P.tether_m) { tx = w.tether.x; tz = w.tether.z; want = stroll; state = "walk"; }
    else state = "sit";
  } else state = pet.mode === "stay" || pet.mode === "tied" ? "sit" : "idle";
  // Danger: what comes at it fast and near. It growls (a cat hisses) and gives ground; the timid
  // sooner. Tied, it can only go to the end of its lead.
  let worst = null, wd = Infinity;
  for (const g of w.dangers || []) {
    const dx = a.x - g.x, dz = a.z - g.z, dist = Math.hypot(dx, dz) - (g.r || 0);
    if (dist > M.growl_m) continue;
    const sp = Math.hypot(g.vx || 0, g.vz || 0), closing = sp > 0.1 ? ((g.vx || 0) * dx + (g.vz || 0) * dz) / (Math.hypot(dx, dz) || 1) : 0;
    if (g.kind !== "threat" && closing < M.danger_speed) continue;
    if (dist < wd) { wd = dist; worst = g; }
  }
  a.growl = Math.max(0, (a.growl || 0) - dt);
  if (worst) {
    const dx = a.x - worst.x, dz = a.z - worst.z, d = Math.hypot(dx, dz) || 1;
    if (a.growl <= 0) { a.growl = 2.5; ev.push("growl"); }
    const nerve = pet.temper.nerve, back = M.back_m * (1.4 - nerve);
    if (wd < back) {
      // Out of its way: across its line, not along it (running ahead of a car is not out of its way).
      const sp = Math.hypot(worst.vx || 0, worst.vz || 0);
      let ax = dx / d, az = dz / d;
      if (sp > 0.5) { const ux = worst.vx / sp, uz = worst.vz / sp, side = dx * uz - dz * ux >= 0 ? 1 : -1; ax = uz * side; az = -ux * side; }
      tx = a.x + ax * 4; tz = a.z + az * 4; want = top; state = "flee"; ev.push("back");
    } else if (state === "idle" || state === "sit") { a.face = Math.atan2(-(worst.x - a.x), -(worst.z - a.z)); state = "alert"; }
  }
  // The step: toward there, round what is in the way, and not into a road it has no business in.
  const dx = tx - a.x, dz = tz - a.z, d = Math.hypot(dx, dz);
  if (want > 0 && d > 0.05) {
    const aim = Math.atan2(-dx, -dz), ownerOnRoad = w.owner && w.onRoad?.(w.owner.x, w.owner.z);
    let go = null;
    // (Round the side it last went round: not one way, then the other, in front of a wall.)
    const bias = a.bias || 1;
    for (const turn of [0, 0.5 * bias, -0.5 * bias, 1.0 * bias, -1.0 * bias, 1.5 * bias, -1.5 * bias, 2.2 * bias, -2.2 * bias]) {
      const y = aim + turn, sx = a.x - Math.sin(y) * M.look_m, sz = a.z - Math.cos(y) * M.look_m;
      // (All the way to there: a thin wall is not stepped over.)
      if (w.blocked && (w.blocked(sx, sz) || w.blocked(a.x - Math.sin(y) * M.look_m * 0.33, a.z - Math.cos(y) * M.look_m * 0.33) || w.blocked(a.x - Math.sin(y) * M.look_m * 0.66, a.z - Math.cos(y) * M.look_m * 0.66))) continue;
      // (Fleeing it goes anywhere clear; else it keeps to the pavement unless you are in the road.)
      // (At the kerb with a car coming it waits where it is: it does not run along the road's edge.)
      if (state !== "flee" && !ownerOnRoad && w.onRoad?.(sx, sz) && !w.onRoad?.(a.x, a.z) && w.carNear?.(sx, sz, M.kerb_wait_m)) { if (turn === 0) break; continue; }
      go = y; if (turn) a.bias = Math.sign(turn); break;
    }
    if (go === null) { a.v = 0; a.state = "idle"; return ev; }
    let turn = ((go - (a.yaw || 0) + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    a.yaw = (a.yaw || 0) + clamp(turn, -M.turn * dt, M.turn * dt);
    a.v = (a.v || 0) + clamp(want - (a.v || 0), -9 * dt, 6 * dt);
    const step = Math.min(d, a.v * dt);
    const nx = a.x - Math.sin(a.yaw) * step, nz = a.z - Math.cos(a.yaw) * step;
    const intoRoad = state !== "flee" && !ownerOnRoad && w.onRoad?.(nx, nz) && !w.onRoad?.(a.x, a.z) && w.carNear?.(nx, nz, M.kerb_wait_m);
    if (!w.blocked?.(nx, nz) && !intoRoad) { a.x = nx; a.z = nz; } else a.v = 0;
    if (pet.mode === "tied" && w.tether) {
      const td = Math.hypot(a.x - w.tether.x, a.z - w.tether.z);
      if (td > P.tether_m + 0.4) { a.x = w.tether.x + ((a.x - w.tether.x) / td) * (P.tether_m + 0.4); a.z = w.tether.z + ((a.z - w.tether.z) / td) * (P.tether_m + 0.4); }
    }
  } else {
    a.v = Math.max(0, (a.v || 0) - 8 * dt);
    if (a.face !== undefined && state === "alert") { const turn = ((a.face - (a.yaw || 0) + Math.PI * 3) % (Math.PI * 2)) - Math.PI; a.yaw = (a.yaw || 0) + clamp(turn, -M.turn * dt, M.turn * dt); }
  }
  a.state = pet.injury > 0 && (state === "walk" || state === "run") ? "limp" : state;
  return ev;
}

// ---- the neighbourhood's own: walked dogs and stoop cats -------------------------------------

export const RESIDENT = { dog_walkers: 6, stoop_cats: 9, cat_flee_m: 5 };   // one in so many strollers has a dog; one in so many homes a cat out front

//: The dog ``person`` (a resident out for a walk: {id}) has with them, or null. The same every day.
export function walkedDog(personId, activity, Rs = RESIDENT) {
  if (!/walk|stroll|run/.test(activity || "")) return null;
  if (hash32(personId, "dog") % Rs.dog_walkers !== 0) return null;
  const breeds = Object.keys(SPECIES.dog.breeds);
  return { id: `dog:${personId}`, species: "dog", breed: breeds[hash32(personId, "dog-breed") % breeds.length], side: hash32(personId, "dog-side") % 2 ? 1 : -1 };
}

//: The cat that sits out in front of home ``place`` ({id, x, z, door?}) at ``hour`` (0..24), or null.
//: Out in the day and the evening, in at night and in the rain.
export function stoopCat(place, hour, wet = false, Rs = RESIDENT) {
  if (wet || hour < 7 || hour > 21.5) return null;
  if (hash32(place.id, "cat") % Rs.stoop_cats !== 0) return null;
  // (Out for a part of the day of its own.)
  const from = 7 + (hash32(place.id, "cat-from") % 9), span = 3 + (hash32(place.id, "cat-span") % 6);
  if (hour < from || hour > from + span) return null;
  const breeds = Object.keys(SPECIES.cat.breeds), d = place.door;
  const x = (d?.x ?? place.x) - (d?.nx ?? 0) * 0.7 + (unit(place.id, "cx") - 0.5) * 1.2, z = (d?.z ?? place.z) - (d?.nz ?? 0) * 0.7 + (unit(place.id, "cz") - 0.5) * 1.2;
  return { id: `cat:${place.id}`, species: "cat", breed: breeds[hash32(place.id, "cat-breed") % breeds.length], x, z, yaw: unit(place.id, "cyaw") * 6.283, state: "sit" };
}

// ---- pigeons, gulls, sparrows, crows and rats: the ambient field ------------------------------

export const AMBIENT = { cell_m: 48, reach_cells: 4, birds_most: 260, rats_most: 14, flush_m: 7, flush_car_m: 9, air_s: 9 };

//: What lives in cell (i, j) at ``hour``: [{id, species, n, x, z, r, alt, perch}] -- flocks, each
//: on a path of its own. ``what(x, z)``: {water: m to the shore or null, shops: eating places
//: near, park: bool} -- where the page knows it. The same cell at the same hour has the same.
export function ambientCell(i, j, hour, what = null, A = AMBIENT) {
  const out = [], cx = (i + 0.5) * A.cell_m, cz = (j + 0.5) * A.cell_m, w = what?.(cx, cz) || {};
  const night = hour < 5.5 || hour > 20.5, slot = Math.floor(hour / 3);
  const put = (species, k, chance) => {
    if (unit("amb", species, i, j, k, slot) > chance) return;
    const S = SPECIES[species], n = S.flock ? S.flock[0] + (hash32("amb-n", species, i, j, k, slot) % (S.flock[1] - S.flock[0] + 1)) : 1;
    out.push({ id: `${species}:${i}:${j}:${k}`, species, n, x: cx + (unit("ax", species, i, j, k) - 0.5) * A.cell_m * 0.8, z: cz + (unit("az", species, i, j, k) - 0.5) * A.cell_m * 0.8,
      r: 6 + unit("ar", species, i, j, k) * 14, alt: S.ground ? 0 : 12 + unit("aalt", species, i, j, k) * 26, seed: hash32("amb-s", species, i, j, k) });
  };
  if (!night) {
    put("pigeon", 0, 0.16 + Math.min(0.5, (w.shops || 0) * 0.14) + (w.park ? 0.12 : 0));
    put("sparrow", 0, 0.1 + Math.min(0.3, (w.shops || 0) * 0.1) + (w.park ? 0.15 : 0));
    put("crow", 0, w.park ? 0.2 : 0.05);
    if (w.water !== undefined && w.water !== null && w.water < 220) { put("gull", 0, 0.55); put("gull", 1, 0.3); }
    else put("gull", 0, 0.04);
  } else put("rat", 0, 0.05 + Math.min(0.4, (w.shops || 0) * 0.12));
  return out;
}

//: Where bird ``k`` of flock ``f`` is at ``t`` s, flushed at ``f.up`` (s) or not: on the ground
//: pecking about its spot, or in the air on its circle. {x, y, z, yaw, flap (0..1), air}.
export function birdAt(f, k, t, A = AMBIENT, out = {}) {
  const S = SPECIES[f.species], a0 = ((hash32(f.seed, k) % 6283) / 1000), up = f.up !== undefined && f.up !== null ? t - f.up : -1;
  const flying = !S.ground || (up >= 0 && up < A.air_s);
  if (!flying) {
    // A hop every so often, a turn, a peck: within a couple of metres of where it stands.
    const hop = Math.floor(t / (2.2 + (k % 5) * 0.6) + k * 0.37), r = 0.4 + ((hash32(f.seed, k, hop) % 1000) / 1000) * Math.min(2.6, f.r * 0.3), ang = a0 + hop * 2.399;
    out.x = f.x + Math.cos(ang) * r; out.z = f.z + Math.sin(ang) * r; out.y = 0; out.yaw = ang + hop; out.flap = 0; out.air = false;
    return out;
  }
  // In the air: round a circle (a gull's is its beat; a flushed flock's takes it up, round and down).
  const rise = S.ground ? Math.sin(Math.min(1, up / A.air_s) * Math.PI) : 1, R0 = S.ground ? 6 + f.r * 0.6 : f.r + 10;
  const w = (S.ground ? 1.5 : 0.35 + (f.seed % 7) * 0.03) * (f.seed % 2 ? 1 : -1), ang = a0 * (S.ground ? 0.25 : 1) + t * w;
  out.x = f.x + Math.cos(ang) * R0 * (S.ground ? rise : 1); out.z = f.z + Math.sin(ang) * R0 * (S.ground ? rise : 1);
  out.y = S.ground ? 0.2 + rise * (5 + (k % 4)) : f.alt + Math.sin(t * 0.3 + k) * 1.5;
  out.yaw = Math.atan2(-(-Math.sin(ang) * w), -(Math.cos(ang) * w)); out.flap = S.ground ? 1 : 0.35 + 0.65 * Math.max(0, Math.sin(t * 0.21 + k)); out.air = true;
  return out;
}

//: Where the rat of ``f`` is at ``t``: along its bit of kerb and back, stopped still now and then;
//: bolting when ``f.up`` was just now. {x, z, yaw, v}.
export function ratAt(f, t, out = {}) {
  const L = 5 + (f.seed % 9), bolt = f.up !== undefined && f.up !== null && t - f.up < 3, sp = bolt ? 3.2 : 0.9;
  const phase = (t * sp + (f.seed % 100)) % (2 * L), s = phase < L ? phase : 2 * L - phase, dir = phase < L ? 1 : -1;
  const still = !bolt && Math.floor(t / 2.5 + f.seed) % 3 === 0, ang = ((f.seed % 628) / 100);
  out.x = f.x + Math.cos(ang) * (s - L / 2); out.z = f.z + Math.sin(ang) * (s - L / 2);
  out.yaw = Math.atan2(-Math.cos(ang) * dir, -Math.sin(ang) * dir); out.v = still ? 0 : sp;
  return out;
}

// ---- the world's commands (CityWorld, on the server and in the practice world) ----------------

export const ANIMAL_COMMANDS = ["adopt_pet", "feed_pet", "pet_mode", "pet_hurt", "vet_treat", "pet_tick", "pet_farewell", "name_pet"];

export function installAnimals(CityWorld, CityError, { storesAt = null } = {}) {
  const W = CityWorld.prototype, fail = (m) => { throw new CityError(m); };
  const petsOf = (p) => (p.pets ||= {});
  const one = (p, id) => petsOf(p)[String(id)] || fail("no pet of yours by that name");
  const sells = (world, place, kinds) => {
    const keys = place?.keys ? [...place.keys] : [];
    if (keys.some((k) => kinds.includes(k))) return true;
    // (What the place is by its tenant's name, where the world knows -- a vet's with no tag.)
    const stores = world.storesHere ? world.storesHere(place) : storesAt ? storesAt(world.R, keys) : [];
    return stores.some((s) => kinds.includes(`shop:${s.kind}`));
  };
  const near = (world, p, place) => !(place?.x !== undefined && p.x !== undefined && Math.hypot(p.x - place.x, p.z - place.z) > (world.R.stores?.reach_m ?? 12) * 2);
  const settleAll = (world, p) => {
    const news = [];
    for (const pet of Object.values(petsOf(p))) { const r = settlePet(pet, world.now); if (r?.died) { news.push({ pet: pet.id, name: pet.name, died: r.died }); world.log?.("pet_died", { player: p.id, pet: pet.id, cause: r.died }); } }
    return news;
  };
  const view = (pet) => ({ ...pet, mood: petMood(pet), quote: vetQuote(pet) });

  //: Your pets as they are now.
  W.pets = function (pid) { const p = this.player(pid); settleAll(this, p); return Object.values(petsOf(p)).map(view); };

  //: Taking one in: at a pet shop or a vet's (their adoption days), or through the online store
  //: (the rescue brings it to you, for more).
  W.cmd_adopt_pet = function (pid, { species = "dog", breed = null, name = "", place = null }) {
    const p = this.player(pid), S = SPECIES[species];
    if (!S || S.kind !== "pet") fail("that is not an animal anyone keeps");
    const mine = Object.values(petsOf(p)).filter((x) => !x.dead);
    if (mine.length >= PET.most) fail(`you have ${PET.most} already: that is as many as one home keeps`);
    let fee = S.fee, to;
    if (place) {
      if (!sells(this, place, ["shop:pet", "shop:vet"])) fail("animals are taken in at a pet shop or a vet's");
      if (!near(this, p, place)) fail("walk up to the shop first");
      to = this.ledger.open(`business:${place.id}`, "business");
    } else { fee = Math.round(fee * PET.online_fee); to = this.treasury ? this.treasury(this.where?.(p)?.city || this.where?.(p)?.county) : null; }
    if (to) this.ledger.pay(p.account, [[to, fee]], { kind: "purchase", memo: `adoption: ${S.name.toLowerCase()}`, at: this.now });
    const id = this.id ? this.id("pet") : `pet:${Object.keys(petsOf(p)).length + 1}:${this.now}`;
    const pet = newPet(id, species, breed, name, this.now);
    pet.at = p.x !== undefined ? { x: p.x, z: p.z } : null;
    petsOf(p)[id] = pet;
    this.log?.("pet_adopted", { player: pid, pet: id, species, breed: pet.breed, fee });
    return { pet: view(pet), fee };
  };
  W.cmd_name_pet = function (pid, { pet, name }) {
    const x = one(this.player(pid), pet), n = String(name || "").replace(/[^\p{L}\p{N} '\-]/gu, "").trim().slice(0, 24);
    if (!n) fail("a name, please");
    x.name = n;
    return { pet: view(x) };
  };
  //: Food from what you carry: its own kind, or treats.
  W.cmd_feed_pet = function (pid, { pet, item }) {
    const p = this.player(pid), x = one(p, pet);
    settleAll(this, p);
    if (x.dead) fail(`${x.name} has died`);
    const S = SPECIES[x.species];
    if (!S.food.includes(item)) fail(`${x.name} does not eat that`);
    if (!(p.inventory?.[item] > 0)) fail(`you are not carrying any ${this.R.items[item]?.name?.toLowerCase() || item}`);
    // (A bag feeds for days: one in six feeds empties it. Treats are one each.)
    const portion = item === "pet_treats" ? 1 : 1 / 6;
    x.fed = (x.fed || 0) + portion;
    if (x.fed >= 1 || item === "pet_treats") { p.inventory[item] -= 1; if (!(p.inventory[item] > 0)) delete p.inventory[item]; x.fed = 0; }
    x.hunger = Math.max(0, x.hunger - (PET.food[item] || 20));
    x.temper.bond = +Math.min(1, x.temper.bond + 0.03).toFixed(2);
    return { pet: view(x), left: p.inventory[item] || 0 };
  };
  //: Where it is to be: with you, waiting where it stands, tied up there, in your car, at home.
  W.cmd_pet_mode = function (pid, { pet, mode, at = null, car = null }) {
    const p = this.player(pid), x = one(p, pet);
    if (!PET_MODES.includes(mode)) fail("follow, stay, tied, car or home");
    if (x.dead) fail(`${x.name} has died`);
    if (mode === "tied" && !(p.inventory?.leash > 0)) fail("a lead to tie it up with: a pet shop has them");
    x.mode = mode;
    const spot = at && Number.isFinite(at.x) && Number.isFinite(at.z) ? { x: +at.x, z: +at.z } : p.x !== undefined ? { x: p.x, z: p.z } : x.at;
    x.at = spot; x.car = mode === "car" ? String(car || "") || null : null;
    return { pet: view(x) };
  };
  //: Hurt: by a car (yours or another's), a blow, a fall. Told by the page that saw it; the
  //: amount is the page's reckoning, bounded here.
  W.cmd_pet_hurt = function (pid, { pet, amount = 0, cause = "an accident" }) {
    const p = this.player(pid), x = one(p, pet);
    settleAll(this, p);
    const r = hurtPet(x, amount, cause, this.now);
    if (r.died) this.log?.("pet_died", { player: pid, pet: x.id, cause: x.cause });
    return { pet: view(x), ...r };
  };
  //: The vet: the injury treated, the animal made well, for what they quoted.
  W.cmd_vet_treat = function (pid, { pet, place }) {
    const p = this.player(pid), x = one(p, pet);
    settleAll(this, p);
    if (x.dead) fail(`${x.name} has died: there is nothing the vet can do`);
    if (!place || !sells(this, place, ["shop:vet"])) fail("a vet's surgery: take it to one");
    if (!near(this, p, place)) fail("walk up to the surgery first");
    if (x.mode === "home") fail(`${x.name} is at home: bring it with you`);
    const price = vetQuote(x), shop = this.ledger.open(`business:${place.id}`, "business");
    this.ledger.pay(p.account, [[shop, price]], { kind: "purchase", memo: `vet: ${x.name}`, at: this.now });
    const was = x.injury;
    x.injury = 0; x.cause = null; x.health = Math.max(x.health, 85); x.treated = this.now;
    this.log?.("pet_treated", { player: pid, pet: x.id, price, injury: was });
    return { pet: view(x), price, healed: was };
  };
  //: Time for your pets while you are about (the page asks every few minutes).
  W.cmd_pet_tick = function (pid) { const p = this.player(pid); return { news: settleAll(this, p), pets: Object.values(petsOf(p)).map(view) }; };
  //: A pet that has died, laid to rest: its record goes.
  W.cmd_pet_farewell = function (pid, { pet }) {
    const p = this.player(pid), x = one(p, pet);
    if (!x.dead) fail(`${x.name} is alive`);
    delete petsOf(p)[x.id];
    return { farewell: x.name };
  };
}
