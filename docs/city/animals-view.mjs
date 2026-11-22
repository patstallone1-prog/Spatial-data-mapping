// Animals on the page: your pets beside you, the neighbourhood's dogs and cats, the birds and
// the rats -- where animals.mjs has them, drawn by animal-figures.mjs -- and what you do with a
// pet: the Pets panel (K), tying it up or leaving it in the car (L), feeding it, the vet.
// Kept out of view.mjs, which hands over what this needs.
import { AMBIENT, MOVE, PET, PET_SPECIES, RESIDENT, SPECIES, ambientCell, animalTier, birdAt, impactHarm, petMood, ratAt, stepPet, stoopCat, vetQuote, walkedDog } from "./animals.mjs";
import { animalFigures } from "./animal-figures.mjs";

export const ANIMALS_CSS = `
#city-side .pet{border:1px solid rgba(128,128,128,.3);border-radius:10px;padding:8px;margin:6px 0}
#city-side .pet h4{margin:0 0 4px;text-transform:none;letter-spacing:0;font-size:13px;color:inherit;display:flex;gap:6px;align-items:baseline}
#city-side .pet h4 small{font-weight:400;opacity:.7}
#city-side .pet .bar{height:6px;border-radius:3px;background:rgba(128,128,128,.25);overflow:hidden;margin:2px 0 5px}
#city-side .pet .bar i{display:block;height:100%;background:#2ea043}
#city-side .pet .bar i.warn{background:#d29922}#city-side .pet .bar i.bad{background:#da3633}
#city-side .pet .row{display:flex;gap:8px;font-size:12px}#city-side .pet .row span{flex:1}
`;

export function animalsView(env) {
  const { R, THREE, add, h, act, send, notify, self, me, getYaw, car, groundAt, blocked, onRoad, vehicles, people, places, gameHour, wet, camera } = env;
  const F = animalFigures({ THREE, add });
  const actors = new Map();          // pet id -> {x, z, yaw, v, state, gait, growl, ...}
  const flocks = new Map();          // ambient flock id -> flock (with ``up``: flushed at)
  let cellsAt = "", cellList = [], lastTick = 0, lastHurt = new Map(), lastSay = 0, boardAt = 0, leaveInCar = false, wasInCar = false, clock = 0, counts = { pets: 0, dogs: 0, cats: 0, birds: 0, rats: 0 };
  const BIRD = {}, RAT = {};
  const petsNow = () => Object.values(self()?.pets || {});
  const fmt = (v) => (R.fmt ? R.fmt(v) : `$${v}`);
  const say = (text, gap = 4000) => { const now = performance.now(); if (now - lastSay < gap) return; lastSay = now; notify(text); };
  const speedOf = (v) => (v.moving === false ? 0 : v.speed ?? v.v ?? 0);

  //: A car is within ``secs`` of (x, z) on its way: for a pet at the kerb.
  function carNear(x, z, secs) {
    for (const v of vehicles()) {
      const sp = speedOf(v); if (sp < 1.5) continue;
      const dx = x - v.x, dz = z - v.z, d = Math.hypot(dx, dz); if (d > sp * secs + 6) continue;
      const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw), along = dx * fx + dz * fz;
      if (along > -2 && Math.abs(dx * fz - dz * fx) < 2.6) return true;
    }
    if (car.active && Math.abs(car.speed) > 1.5 && Math.hypot(x - car.x, z - car.z) < Math.abs(car.speed) * secs + 6) return true;
    return false;
  }
  const dangers = [];
  function dangersNear(x, z) {
    dangers.length = 0;
    for (const v of vehicles()) {
      const sp = speedOf(v); if (sp < MOVE.danger_speed || Math.abs(v.x - x) > 14 || Math.abs(v.z - z) > 14) continue;
      dangers.push({ x: v.x, z: v.z, vx: -Math.sin(v.yaw) * sp, vz: -Math.cos(v.yaw) * sp, r: 1, kind: "car" });
    }
    if (car.active && Math.abs(car.speed) >= MOVE.danger_speed && Math.abs(car.x - x) < 14 && Math.abs(car.z - z) < 14) dangers.push({ x: car.x, z: car.z, vx: -Math.sin(car.yaw) * car.speed, vz: -Math.cos(car.yaw) * car.speed, r: 1, kind: "car" });
    for (const g of env.threats?.() || []) if (Math.abs(g.x - x) < 14 && Math.abs(g.z - z) < 14) dangers.push({ x: g.x, z: g.z, vx: 0, vz: 0, r: 0, kind: "threat" });
    return dangers;
  }
  //: A pet struck by a car: yours or one of the city's. Told to the world, once a few seconds.
  function struck(pet, a, now) {
    if (pet.dead || now - (lastHurt.get(pet.id) || 0) < 3000) return;
    const S = SPECIES[pet.species], kg = S.breeds[pet.breed]?.kg || 10;
    const hit = (x, z, yaw, sp, half, len, mine) => {
      if (sp < 2) return false;
      const dx = a.x - x, dz = a.z - z, fx = -Math.sin(yaw), fz = -Math.cos(yaw), along = dx * fx + dz * fz, side = Math.abs(dx * fz - dz * fx);
      if (Math.abs(along) > len / 2 + 0.25 || side > half + 0.2) return false;
      lastHurt.set(pet.id, now);
      const amount = impactHarm(sp, kg);
      send("pet_hurt", { pet: pet.id, amount, cause: mine ? "your car" : "a car" }).then((r) => {
        if (!r?.ok) return;
        notify(r.died ? `${pet.name} was hit by ${mine ? "your car" : "a car"} and has died.` : `${pet.name} was hit by ${mine ? "your car" : "a car"}: ${petMood(r.pet)}. A vet can treat it.`);
        env.drawSide?.();
      });
      env.noteIncident?.("crash", a.x, a.z, mine);
      return true;
    };
    if (car.active && hit(car.x, car.z, car.yaw, Math.abs(car.speed), 0.95, 4.5, true)) return;
    for (const v of vehicles()) if (Math.abs(v.x - a.x) < 6 && Math.abs(v.z - a.z) < 6 && hit(v.x, v.z, v.yaw, speedOf(v), 0.95, 4.5, false)) return;
  }
  const setMode = async (pet, mode, extra = {}) => { const r = await send("pet_mode", { pet: pet.id, mode, ...extra }); if (r?.ok === false) notify(r.error); env.drawSide?.(); return r; };

  // ---- a frame ---------------------------------------------------------------------------------
  const W = { owner: { x: 0, z: 0, yaw: 0, v: 0, inCar: false, boarding: false }, blocked: null, onRoad: null, carNear, dangers: null, tether: null };
  let prevMe = null;
  function frame(dt, nowMs) {
    clock += dt;
    const you = me(), yaw = getYaw(), hour = gameHour(), cam = camera?.() || you, inCar = Boolean(car.active);
    const vme = prevMe && dt > 0 ? Math.hypot(you.x - prevMe.x, you.z - prevMe.z) / dt : 0;
    prevMe = { x: you.x, z: you.z };
    F.begin(clock);
    counts.pets = counts.dogs = counts.cats = counts.birds = counts.rats = 0;
    // -- your pets
    const pets = petsNow();
    if (inCar && !wasInCar) { boardAt = clock + PET.board_s; leaveInCar = false; }
    if (!inCar && wasInCar) {
      // Out of the car: those that rode get out with you, unless you said they stay.
      for (const pet of pets) if (pet.mode === "car" && !pet.dead) { if (leaveInCar) continue; const a = actors.get(pet.id) || {}; a.x = you.x + 0.8; a.z = you.z + 0.6; actors.set(pet.id, a); setMode(pet, "follow"); }
      if (leaveInCar && pets.some((p) => p.mode === "car")) notify("Left in the car. L by the car lets them out.");
    }
    wasInCar = inCar;
    W.owner.x = inCar ? car.x : you.x; W.owner.z = inCar ? car.z : you.z; W.owner.yaw = yaw; W.owner.v = inCar ? Math.abs(car.speed) : Math.min(8, vme); W.owner.inCar = inCar; W.owner.boarding = inCar && Math.abs(car.speed) < 2.5;
    W.blocked = (x, z) => blocked(x, z, 0.22); W.onRoad = onRoad;
    let slot = 0;
    for (const pet of pets) {
      if (pet.mode === "home") continue;
      let a = actors.get(pet.id);
      if (!a) { const at = pet.mode === "follow" || !pet.at ? { x: you.x + 0.9, z: you.z + 0.7 } : pet.at; a = { x: at.x, z: at.z, yaw: 0, v: 0, state: "idle", gait: 0 }; actors.set(pet.id, a); }
      if (pet.mode === "car") {
        // Rides with the car; drawn on the seat when you look in (a head at the window).
        if (pet.car && car.vehicle && pet.car !== car.vehicle && !inCar) { /* in a car that is elsewhere */ }
        a.x = car.x; a.z = car.z; a.v = 0;
        continue;
      }
      a.slot = slot; slot += 1;
      W.tether = pet.mode === "tied" || pet.mode === "stay" ? pet.at || a : null;
      W.dangers = dangersNear(a.x, a.z);
      for (const ev of stepPet(a, pet, W, Math.min(dt, 0.1))) {
        if (ev === "growl") say(`${pet.name} ${SPECIES[pet.species].sound} ${W.dangers[0]?.kind === "threat" ? "at the trouble" : "at the car"}.`, 9000);
        if (ev === "board" && inCar && clock >= boardAt) { setMode(pet, "car", { car: car.vehicle || "" }); say(`${pet.name} is in the car.`, 500); }
      }
      // You drove off before it was in: it waits where it is.
      if (pet.mode === "follow" && inCar && Math.hypot(a.x - car.x, a.z - car.z) > 14 && Math.abs(car.speed) > 3) { setMode(pet, "stay", { at: { x: a.x, z: a.z } }); notify(`${pet.name} is waiting where you left it.`); }
      struck(pet, a, nowMs);
      const dist = Math.hypot(a.x - cam.x, a.z - cam.z), tier = animalTier(pet.species, dist);
      if (tier < 0) continue;
      const y = groundAt(a.x, a.z);
      F.quadruped({ x: a.x, y, z: a.z, yaw: a.yaw, species: pet.species, breed: pet.breed, tier, state: a.state, gait: a.gait, v: a.v, seed: pet.born });
      if (pet.mode === "tied" && pet.at && tier < 2) { const sh = SPECIES[pet.species].breeds[pet.breed].shoulder; F.lead(pet.at.x, groundAt(pet.at.x, pet.at.z) + 0.9, pet.at.z, a.x - Math.sin(a.yaw) * sh * 0.4, y + sh * 0.95, a.z - Math.cos(a.yaw) * sh * 0.4); }
      counts.pets += 1;
    }
    for (const id of actors.keys()) if (!self()?.pets?.[id]) actors.delete(id);
    // -- the neighbourhood's: dogs walked by the city's people, cats on the stoops
    const flee = [];   // what the birds and cats get out of the way of
    flee.push({ x: you.x, z: you.z, fast: vme > 2.8 || inCar });
    for (const p of people()) {
      if (p.indoors) continue;
      const dist = Math.hypot(p.x - cam.x, p.z - cam.z);
      if (dist > SPECIES.dog.rings[2]) continue;
      const dog = walkedDog(p.id ?? p.person?.id, p.activity);
      if (!dog) continue;
      const tier = animalTier("dog", dist); if (tier < 0) continue;
      const fx = -Math.sin(p.yaw || 0), fz = -Math.cos(p.yaw || 0), sh = SPECIES.dog.breeds[dog.breed].shoulder, off = 0.55 + sh * 0.5;
      const x = p.x + -fz * off * dog.side + fx * 0.5, z = p.z + fx * off * dog.side + fz * 0.5, y = groundAt(x, z), v = p.moving === false ? 0 : p.speed ?? p.pace ?? 1.3;
      F.quadruped({ x, y, z, yaw: p.yaw || 0, species: "dog", breed: dog.breed, tier, state: v > 0.2 ? "walk" : "sit", gait: clock * v * 2.6 + (dog.side > 0 ? 0 : 1.7), v, seed: x | 0 });
      if (tier < 2) F.lead(p.x + -fz * 0.25 * dog.side, y + 0.85, p.z + fx * 0.25 * dog.side, x + fx * sh * 0.4, y + sh * 0.95, z + fz * sh * 0.4);
      flee.push({ x, z, fast: true });
      counts.dogs += 1;
    }
    const rainy = wet();
    for (const place of places()) {
      if (place.use !== "residential" || Math.abs(place.x - cam.x) > SPECIES.cat.rings[2] || Math.abs(place.z - cam.z) > SPECIES.cat.rings[2]) continue;
      const cat = stoopCat(place, hour, rainy);
      if (!cat) continue;
      const dist = Math.hypot(cat.x - cam.x, cat.z - cam.z), tier = animalTier("cat", dist); if (tier < 0) continue;
      // A dog near, or you at a run: off the stoop and gone inside (not drawn) till they have passed.
      let gone = false;
      for (const f of flee) if (f.fast && Math.hypot(f.x - cat.x, f.z - cat.z) < RESIDENT.cat_flee_m) gone = true;
      if (gone) continue;
      F.quadruped({ x: cat.x, y: groundAt(cat.x, cat.z), z: cat.z, yaw: cat.yaw, species: "cat", breed: cat.breed, tier, state: "sit", gait: 0, v: 0, seed: cat.x | 0 });
      counts.cats += 1;
    }
    // -- pigeons, gulls, sparrows, crows; rats by night: the cells round you
    const ci = Math.floor(cam.x / AMBIENT.cell_m), cj = Math.floor(cam.z / AMBIENT.cell_m), key = `${ci}:${cj}:${Math.floor(hour / 3)}`;
    if (key !== cellsAt) {
      cellsAt = key; cellList = [];
      const what = (x, z) => env.whatAt?.(x, z) || {};
      for (let i = ci - AMBIENT.reach_cells; i <= ci + AMBIENT.reach_cells; i += 1) for (let j = cj - AMBIENT.reach_cells; j <= cj + AMBIENT.reach_cells; j += 1) {
        for (const f of ambientCell(i, j, hour, what)) {
          // (Not on the water, nor inside a building, for those that stand on the ground.)
          if (SPECIES[f.species].ground !== false && (env.waterAt?.(f.x, f.z) || blocked(f.x, f.z, 0.5))) continue;
          const was = flocks.get(f.id); if (was) f.up = was.up;
          cellList.push(f);
        }
      }
      flocks.clear(); for (const f of cellList) flocks.set(f.id, f);
    }
    for (const f of cellList) {
      const S = SPECIES[f.species], dist = Math.hypot(f.x - cam.x, f.z - cam.z), tier = animalTier(f.species, dist);
      if (tier < 0) continue;
      // Flushed by you, by a dog, by a car going by: up, round and down again.
      if (S.kind === "bird" && S.ground && !(f.up !== undefined && clock - f.up < AMBIENT.air_s)) {
        for (const g of flee) if (Math.hypot(g.x - f.x, g.z - f.z) < AMBIENT.flush_m + (g.fast ? 3 : 0)) { f.up = clock; break; }
        if (f.up !== clock && carNear(f.x, f.z, 0.6)) f.up = clock;
      }
      if (S.kind === "vermin") {
        if (counts.rats >= AMBIENT.rats_most) continue;
        if (Math.hypot(you.x - f.x, you.z - f.z) < 6 && !(f.up !== undefined && clock - f.up < 3)) f.up = clock;
        const r = ratAt(f, clock, RAT);
        F.rat({ x: r.x, y: groundAt(r.x, r.z), z: r.z, yaw: r.yaw });
        counts.rats += 1;
        continue;
      }
      const y0 = S.ground ? groundAt(f.x, f.z) : groundAt(f.x, f.z);
      for (let k = 0; k < f.n && counts.birds < AMBIENT.birds_most; k += 1) {
        const b = birdAt(f, k, clock, AMBIENT, BIRD);
        F.bird({ x: b.x, y: y0 + b.y, z: b.z, yaw: b.yaw, species: f.species, flap: b.flap, air: b.air, tier, k });
        counts.birds += 1;
      }
    }
    F.end();
    // -- time for your pets while you are about
    if (pets.length && nowMs - lastTick > 240_000) {
      lastTick = nowMs;
      send("pet_tick", {}).then((r) => { for (const n of r?.news || []) if (n.died) notify(`${n.name} has died of ${n.died}.`); if (r?.news?.length) env.drawSide?.(); });
      const hungry = pets.find((p) => !p.dead && p.hunger >= 65);
      if (hungry) say(`${hungry.name} is ${petMood(hungry)}. Feed it from the Pets panel (K).`, 500);
    }
  }
  //: What the city's drivers stop for: your pets out of doors.
  function obstacles() {
    const out = [];
    for (const pet of petsNow()) { const a = actors.get(pet.id); if (a && !pet.dead && pet.mode !== "car" && pet.mode !== "home") out.push({ id: pet.id, x: a.x, z: a.z }); }
    return out;
  }

  // ---- what you do ------------------------------------------------------------------------------
  const nearest = (mode = null) => {
    const you = me(); let best = null, bd = Infinity;
    for (const pet of petsNow()) { if (pet.dead || (mode && pet.mode !== mode)) continue; const a = actors.get(pet.id); if (!a) continue; const d = Math.hypot(a.x - you.x, a.z - you.z); if (d < bd) { bd = d; best = pet; } }
    return best ? { pet: best, d: bd, a: actors.get(best.id) } : null;
  };
  //: L: at the wheel, whether those in the car stay in it when you get out; by the car, lets them
  //: out; else ties up the pet beside you (a lead), or tells it to stay, or has it follow again.
  async function leashKey() {
    const pets = petsNow().filter((p) => !p.dead);
    if (!pets.length) { notify("No pet of yours. Take one in at a pet shop or a vet's, or on the online store (K)."); return; }
    if (car.active) {
      const riding = pets.filter((p) => p.mode === "car");
      if (!riding.length) { const waiting = pets.filter((p) => p.mode === "follow"); if (waiting.length) { boardAt = Infinity; for (const p of waiting) { const a = actors.get(p.id); await setMode(p, "stay", a ? { at: { x: a.x, z: a.z } } : {}); } notify(`${waiting.map((p) => p.name).join(" and ")} will wait here.`); } return; }
      leaveInCar = !leaveInCar;
      notify(leaveInCar ? `${riding.map((p) => p.name).join(" and ")} will stay in the car when you get out.` : "They get out with you.");
      return;
    }
    const you = me(), inCarPets = pets.filter((p) => p.mode === "car");
    if (inCarPets.length && Math.hypot(car.x - you.x, car.z - you.z) < 6) { for (const p of inCarPets) { const a = actors.get(p.id) || {}; a.x = you.x + 0.8; a.z = you.z + 0.6; actors.set(p.id, a); await setMode(p, "follow"); } notify("Out of the car."); return; }
    const n = nearest();
    if (!n) return;
    if (n.pet.mode === "follow" && n.d < 6) {
      const tie = (self()?.inventory?.leash || 0) > 0, r = await setMode(n.pet, tie ? "tied" : "stay", { at: { x: n.a.x, z: n.a.z } });
      if (r?.ok !== false) notify(tie ? `${n.pet.name} is tied up here.` : `${n.pet.name} will stay here. (With a lead from a pet shop it can be tied up.)`);
    } else if (n.d < 8) { await setMode(n.pet, "follow"); notify(`${n.pet.name} is with you.`); }
    else notify(`${n.pet.name} is ${Math.round(n.d)} m off: go to it.`);
  }
  //: A vet's or a pet shop within reach of you: {vet, pet} places (or null each).
  function shopsHere() {
    const you = me(), reach = (R.stores?.reach_m ?? 12) * 2; let vet = null, pet = null;
    for (const p of places()) {
      if (Math.abs(p.x - you.x) > reach || Math.abs(p.z - you.z) > reach || Math.hypot(p.x - you.x, p.z - you.z) > reach) continue;
      if (p.keys?.has("shop:vet")) vet ||= p;
      if (p.keys?.has("shop:pet") || p.keys?.has("shop:vet")) pet ||= p;
    }
    return { vet, pet };
  }
  const placeArg = (p) => (env.placeArg ? env.placeArg(p) : { id: p.id, keys: [...p.keys], x: p.x, z: p.z });
  const bar = (v, good = true) => { const pct = Math.max(0, Math.min(100, v)), bad = good ? pct < 30 : pct > 70, warn = good ? pct < 60 : pct > 45; return h("div", { className: "bar" }, h("i", { className: bad ? "bad" : warn ? "warn" : "", style: `width:${pct}%` })); };
  let adopt = { species: "dog", breed: "", name: "" };
  //: The Pets panel. Returns true if ``side`` was its to draw.
  function draw(side, { close, status, p }) {
    if (side.kind !== "pets") return false;
    const pets = Object.values(p.pets || {}), here = shopsHere(), inv = p.inventory || {};
    const rows = [h("h3", {}, h("span", { textContent: "Pets" }), close), status];
    if (!pets.length) rows.push(h("p", { className: "note", textContent: "No pet yet. Take one in below: at a pet shop or a vet's for the fee, or brought to you from the online store for a quarter more." }));
    for (const pet of pets) {
      const S = SPECIES[pet.species], B = S.breeds[pet.breed], a = actors.get(pet.id), you = me(), d = a ? Math.round(Math.hypot(a.x - you.x, a.z - you.z)) : null;
      const where = pet.dead ? `died of ${pet.dead.cause}` : { follow: "with you", stay: "waiting", tied: "tied up", car: "in the car", home: "at home" }[pet.mode] + (d !== null && pet.mode !== "follow" && pet.mode !== "car" && pet.mode !== "home" ? `, ${d} m off` : "");
      const box = h("div", { className: "pet" }, h("h4", {}, h("b", { textContent: pet.name }), h("small", { textContent: `${B.name} · ${petMood(pet)} · ${where}` })));
      if (!pet.dead) {
        box.append(h("div", { className: "row" }, h("span", { textContent: `Health ${Math.round(pet.health)}` }), h("span", { textContent: `Hunger ${Math.round(pet.hunger)}` })), bar(pet.health), bar(pet.hunger, false));
        if (pet.injury > 0) box.append(h("p", { className: "note", textContent: `Hurt by ${pet.cause || "an accident"} (${Math.round(pet.injury)} of 100)${pet.injury >= PET.serious ? ": this will not mend by itself, and it is getting worse. A vet." : ": it will mend with rest and food."}` }));
        const food = S.food.filter((id) => inv[id] > 0);
        for (const id of food) box.append(act(`Feed (${R.items[id]?.name || id}, ${inv[id]} left)`, async () => { const r = await send("feed_pet", { pet: pet.id, item: id }); if (r.ok) notify(`${pet.name} eats.`); return r; }, pet.hunger >= 50));
        if (!food.length) box.append(h("p", { className: "note", textContent: `Nothing for it to eat on you: ${S.food.map((id) => R.items[id]?.name?.toLowerCase() || id).join(" or ")}, from a pet shop, a grocer's or the online store.` }));
        for (const [mode, label] of [["follow", "Follow me"], ["stay", "Stay here"], ["tied", "Tie up here"], ["home", "Send home"]]) {
          if (pet.mode === mode || (mode === "tied" && !(inv.leash > 0))) continue;
          if (pet.mode === "car" && mode !== "follow") continue;
          box.append(act(label, () => setMode(pet, mode, a ? { at: { x: a.x, z: a.z } } : {})));
        }
        if (here.vet && pet.mode !== "home") box.append(act(`Vet: ${pet.injury > 0 || pet.health < 100 ? "treat" : "check-up"} (${fmt(vetQuote(pet))})`, async () => { const r = await send("vet_treat", { pet: pet.id, place: placeArg(here.vet) }); if (r.ok) notify(`${pet.name} is treated: ${fmt(r.price)}.`); return r; }, pet.injury >= PET.serious));
        else if (pet.injury > 0) box.append(h("p", { className: "note", textContent: "Take it to a vet's surgery and open this panel there." }));
      } else box.append(act("Lay to rest", async () => { const r = await send("pet_farewell", { pet: pet.id }); if (r.ok) notify(`Goodbye, ${r.farewell}.`); return r; }));
      rows.push(box);
    }
    // Taking one in.
    const alive = pets.filter((x) => !x.dead).length;
    if (alive < PET.most) {
      const S = SPECIES[adopt.species], fee = here.pet ? S.fee : Math.round(S.fee * PET.online_fee);
      const kind = h("select", { onchange: (e) => { adopt.species = e.target.value; adopt.breed = ""; env.drawSide?.(); } }, ...PET_SPECIES.map((k) => h("option", { value: k, textContent: SPECIES[k].name, selected: k === adopt.species })));
      const breed = h("select", { onchange: (e) => { adopt.breed = e.target.value; } }, h("option", { value: "", textContent: "Any" }), ...Object.entries(S.breeds).map(([k, b]) => h("option", { value: k, textContent: b.name, selected: k === adopt.breed })));
      const name = h("input", { placeholder: "Its name", maxLength: 24, value: adopt.name, oninput: (e) => { adopt.name = e.target.value; } });
      rows.push(h("h4", { textContent: here.pet ? "Take one in here" : "Take one in (online: brought to you)" }), h("div", {}, kind, " ", breed, " ", name),
        act(`Adopt for ${fmt(fee)}`, async () => { const r = await send("adopt_pet", { species: adopt.species, breed: adopt.breed || null, name: adopt.name, ...(here.pet ? { place: placeArg(here.pet) } : {}) }); if (r.ok) { notify(`${r.pet.name} is yours. L ties it up or tells it to stay; it gets in the car after you.`); adopt.name = ""; } return r; }, true));
    }
    rows.push(h("p", { className: "note", textContent: "L: tie up or stay / follow. At the wheel, L: leave them in the car. Drive off before one is in and it waits where it was. Food and leads: pet shops, vets, the online store." }));
    side.el.replaceChildren(...rows);
    return true;
  }
  return { frame, draw, leashKey, obstacles, counts: () => ({ ...counts, ...F.stats() }), figures: F, actors };
}
