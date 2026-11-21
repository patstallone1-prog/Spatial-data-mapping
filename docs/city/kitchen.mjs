// The restaurant game: a food shop's kitchen, worked by the people on its staff (docs/47-kitchen-game.md).
//
// Order tickets come in from the front. The cook takes what each dish needs from the pantry,
// chops, grills, fries, boils or bakes it on the kitchen's own stations, builds it in the right
// order and serves it. How well it was made sets the customer's tip, and the cook may slip in
// something on the house for a bigger one. What the house gives away is logged against the cook,
// as is what is spoiled and binned, and it all goes into the employee rating the owner sees.
//
// Nothing is endless. The pantry is what the owner ordered: a player owner orders by the
// ingredient, or by the dish, and a resident's shop orders a month's worth at the start of each
// month with a little to spare. The shop's NPC customers eat from the same pantry, hour by hour,
// so what is wasted on a redo or an experiment is gone for the month, and its cost is in the books.
//
// When it is quiet, or whenever the cook wants, an NPC colleague covers the line and the cook
// goes to the lab: the same pantry and stations, any ingredients in any amounts, cooked any way.
// A test dish is served free to a customer, who scores it and says what it does for the bars
// (stamina, health). The cook can put it to the owner, who decides whether it goes on the menu
// and at what price. A resident owner decides by the taste, after a couple of game hours. Once a
// dish is on the menu, the NPC cooks learn it: they cook it when they cover, and the customers
// order it.
//
// In the shared city the server reserves ingredients and times each station. Clients
// arrange the portions on the plate and name the server-issued lots they want to serve.
//
// Installed on CityWorld's prototype (installKitchen, from world.mjs); tests in
// tests/city_kitchen.test.mjs.

import { workableDough, validShape, doughDimensions } from "./dough.mjs";
import { cityTime, itemTax, storesAt } from "./core.mjs";
import { estimateWeek, groupOf, hoursFor, isOpen, itemsFor, priceDemand, unitCost } from "./enterprise.mjs";
import { FIRST, LAST, hash32, rng } from "./people.mjs";
import { menuDishes } from "./menu-dish.mjs";

const HOUR = 3_600_000, DAY = 86_400_000;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const pick = (r, list) => list[Math.floor(r() * list.length) % list.length];
const nameOf = (r) => `${pick(r, FIRST)} ${pick(r, LAST)}`;
const TASTES = ["sw", "sa", "so", "bi", "um", "fa", "sp", "fr"];

//: The commands this adds to the world's.
export const KITCHEN_COMMANDS = ["kitchen_prepare", "kitchen_open", "kitchen_state", "kitchen_take", "kitchen_return", "kitchen_bin", "kitchen_serve", "kitchen_cover",
  "kitchen_order", "kitchen_decide", "lab_test", "lab_propose", "tip_cook"];

// ---- the kitchen as data (pure) --------------------------------------------------------------------

//: Whether shops of ``kind`` have a kitchen to work in.
export function hasKitchen(R, kind) { return Boolean(R.kitchen?.kitchens?.[kind]); }
//: The stations a kitchen of ``kind`` has, each {id, name, does, slots, batch}.
export function stationsFor(R, kind) {
  return (R.kitchen.kitchens[kind] || []).map((id) => ({ id, ...R.kitchen.stations[id] }));
}
//: The processes a kitchen of ``kind`` can do.
export function processesAt(R, kind) { return new Set(stationsFor(R, kind).flatMap((s) => s.does)); }
//: The stations a kitchen has: its kind's, and any its real menu needs that the kind lacks (a diner
//: whose menu has a cappuccino has an espresso machine).
export function kitchenStations(R, k) {
  const own = stationsFor(R, k.kind);
  return [...own, ...(k.extra_stations || []).filter((id) => R.kitchen.stations[id] && !own.some((s) => s.id === id)).map((id) => ({ id, ...R.kitchen.stations[id] }))];
}
//: The stations ``kind`` lacks for ``builds``' processes: the first station of the house's that does each.
export function stationsNeeded(R, kind, builds) {
  const can = processesAt(R, kind), out = [];
  for (const b of builds) for (const c of b.map(part)) for (const proc of chain(c.p)) {
    if (can.has(proc)) continue;
    const id = Object.keys(R.kitchen.stations).find((s) => R.kitchen.stations[s].does.includes(proc));
    if (id && !out.includes(id)) { out.push(id); for (const d of R.kitchen.stations[id].does) can.add(d); }
  }
  return out;
}
//: Whether an ingredient is counted out in whole units (pieces, or shakes of a shaker).
export const wholeUnits = (spec) => spec?.measure === "count" || spec?.measure === "shake";
//: An ingredient's spec.
export const ingredient = (R, id) => Object.hasOwn(R.kitchen.ingredients, id) ? R.kitchen.ingredients[id] : undefined;
//: What ``qty`` of an ingredient costs the kitchen (minor units).
export function ingCost(R, id, qty = 1) { return Math.round(R.money(1) * (ingredient(R, id)?.cost || 0) * qty); }
//: A component as the rules write it ([ing, qty, "chop>fry", side?]) as an object.
export const part = (c) => (Array.isArray(c) ? { ing: c[0], qty: c[1], p: c[2] || "-", side: Boolean(c[3]) } : { side: false, p: "-", qty: 1, ...c });
//: A dish's recipe: the house's (rules.json) or one on this kitchen's own menu.
export function recipeOf(R, dish, menu = []) {
  const own = menu.find((d) => d.id === dish);
  if (own) return { ordered: false, vessel: "plate", build: own.build.map(part), name: own.name, custom: true };
  const r = R.kitchen.recipes[dish];
  return r ? { ordered: r.ordered, vessel: r.vessel, build: r.build.map(part), name: R.items[dish]?.name || dish } : null;
}
//: What one of a dish's portions takes from the pantry, by ingredient.
export function needs(build) {
  const out = {};
  for (const c of build.map(part)) out[c.ing] = (out[c.ing] || 0) + c.qty;
  return out;
}
//: What a build's ingredients cost (minor units).
export function buildCost(R, build) { return Object.entries(needs(build)).reduce((s, [id, n]) => s + ingCost(R, id, n), 0); }
//: How many portions of ``build`` the pantry holds.
export function makeable(pantry, build) {
  let n = Infinity;
  for (const [id, q] of Object.entries(needs(build))) n = Math.min(n, Math.floor((pantry[id] || 0) / q));
  return Number.isFinite(n) ? n : 0;
}
//: Takes ``need`` (by ingredient) from ``pantry``: false (and nothing taken) if it is not all there.
export function draw(pantry, need) {
  for (const [id, q] of Object.entries(need)) if ((pantry[id] || 0) < q - 1e-9) return false;
  for (const [id, q] of Object.entries(need)) { pantry[id] -= q; if (pantry[id] <= 1e-9) delete pantry[id]; }
  return true;
}
const addTo = (pantry, more) => { for (const [id, q] of Object.entries(more)) if (q > 0) pantry[id] = (pantry[id] || 0) + q; };
//: A ticket line's target: its dish's build with the customer's asks ("no onion", "extra cheese").
export function targetOf(R, line, menu = []) {
  const r = recipeOf(R, line.dish, menu);
  if (!r) return null;
  let build = r.build.map((c) => ({ ...c }));
  for (const m of line.mods || []) {
    if (m.no) build = build.filter((c) => c.ing !== m.no);
    if (m.extra) { const c = build.find((x) => x.ing === m.extra); if (c) c.qty += 1; }
  }
  return { ...r, build };
}
//: The process chain of a component: ["chop", "fry"], or [] for as it comes.
export const chain = (p) => (!p || p === "-" ? [] : String(p).split(">"));
//: How long a process takes an ingredient, in real seconds (the ingredient's own time, or the process's).
export function processSeconds(R, ing, proc) {
  const P = R.kitchen.processes[proc];
  return ingredient(R, ing)?.times?.[proc] ?? P?.seconds ?? 0;
}
// Pantry quantities stay in the original recipe denomination, including in older saves.
export function displayAmount(R, ing, qty) {
  const spec = ingredient(R, ing);
  const n = spec.measure === "g" ? qty * spec.grams : qty;
  if (spec.measure === "shake") return `${Number(n.toFixed(2))} ${n === 1 ? "shake" : "shakes"}`;
  return `${Number(n.toFixed(2))} ${spec.measure === "g" ? "g" : "× " + spec.unit}`;
}

export function batchSeconds(R, build, proc) {
  const grams = build.reduce((n, c) => n + ingredient(R, c.ing).grams * c.qty, 0);
  const base = Math.max(...build.map((c) => processSeconds(R, c.ing, proc)), 1);
  const shape = build.find(c => c.shape)?.shape;
  const thickness = proc === "bake" && shape ? clamp(Math.sqrt(doughDimensions(grams, shape).height / 2), 0.65, 1.8) : 1;
  return base * thickness * clamp(0.85 + Math.sqrt(grams / 200) * 0.22, 0.85, 3);
}

// Estimate hands-on time and concurrent station time separately. Each additional course adds work.
export function serviceWindow(R, kind, lines, menu, service, patience = 1) {
  let work = 0;
  for (const line of lines) {
    const build = targetOf(R, line, menu).build;
    const stages = new Map();
    for (const c of build) {
      const path = [];
      for (const step of chain(c.p)) {
        path.push(step);
        const key = path.join(">");
        const group = stages.get(key) || [];
        group.push(c);
        stages.set(key, group);
      }
    }
    work += 5 + build.length * 3;
    for (const [path, group] of stages) {
      const step = path.split(">").at(-1);
      work += step === "chop" ? group.length * 3 : batchSeconds(R, group, step);
    }
  }
  const tier = R.kitchen.service[kind]?.pace ?? 1;
  const seated = service === "Sit-down";
  const target_s = Math.ceil((20 + work) * tier * (seated ? 1.25 : 1));
  const real_s = target_s + Math.ceil((seated ? 45 : 25) * patience + work * 0.35);
  return { service, target_s, real_s };
}

export function waitTipShare(t, elapsed) {
  const target = t.target_s ?? t.real_s * 0.6;
  return clamp((t.real_s - elapsed) / Math.max(1, t.real_s - target), 0, 1);
}

// Evaluate each ingredient in order. Dry heat removes moisture, frying brings in oil,
// and cold service mutes aroma. Reheating reverses the cold effect on the final bite.
export function cookedPart(R, c) {
  const I = ingredient(R, c.ing), raw = I.grams * c.qty;
  let grams = raw, kcal = raw * I.kcal_100g / 100, temperature = "ambient";
  const flavour = { ...I.taste };
  const steps = chain(c.p);
  let hydrated = false, exposed = false;
  for (const [index, step] of steps.entries()) {
    const P = R.kitchen.processes[step];
    const ratio = c.ratios?.[index] ?? (index === steps.length - 1 ? c.ratio : null) ?? 1;
    const exposure = clamp(ratio, 0, 2);
    if (step === "chop" || step === "blend") {
      // Opening cells releases aromas. Repeated chopping cannot keep intensifying them.
      if (!exposed && ["fruit", "veg", "herb"].includes(I.role)) {
        for (const key of ["sw", "so", "sp", "fr"]) {
          if (flavour[key]) flavour[key] *= 1 + (step === "blend" ? 0.2 : 0.1) * Math.min(1, exposure);
        }
      }
      exposed = true;
    }
    if (R.kitchen.heat.includes(step)) {
      temperature = "hot";
      if (flavour.fr) flavour.fr *= Math.max(0.3, 1 - (exposed ? 0.4 : 0.2) * exposure);
    }
    if (step === "cool" && ratio >= 0.82) temperature = "ambient";
    if (step === "chill" && ratio >= 0.82) temperature = temperature === "hot" && ratio < 1.2 ? "ambient" : "cold";
    if (["bake", "toast", "grill", "wok", "saute", "fry"].includes(step)) {
      grams = Math.max(raw * 0.65, grams * (1 - 0.06 * exposure));
      if (ratio > 1.2) flavour.bi = (flavour.bi || 0) + Math.min(2, ratio - 1.2);
    }
    if (!hydrated && ["boil", "steam"].includes(step) && I.water_gain) {
      grams += raw * I.water_gain * Math.min(1, exposure);
      hydrated = true;
    }
    if (!hydrated && step === "brew" && I.brew_grams) {
      grams = c.qty * I.brew_grams;
      kcal *= 0.1;  // the spent leaves or grounds stay in the filter
      hydrated = true;
    }
    if (step === "fry") {
      const oil = raw * 0.06 * exposure;
      grams += oil; kcal += oil * 8.84;
    }
    for (const [key, v] of Object.entries(P.taste || {})) flavour[key] = Math.min(5, (flavour[key] || 0) + v * exposure);
  }
  if (temperature === "cold") {
    for (const key of ["sw", "um", "sp"]) if (flavour[key]) flavour[key] *= 0.85;
  }
  return { grams, kcal, flavour, temperature };
}

// Compare proportions independently of batch size. The second overlap compares ingredient
// AND ordered technique, so raw batter and a finished cake have different identities.
export function recognizeDish(R, build, menu = []) {
  function profile(parts) {
    const foods = new Map(), methods = new Map(), cooked = new Map();
    let total = 0;
    for (const c of parts.map(part)) {
      const mass = ingredient(R, c.ing).grams * c.qty;
      const method = c.ing + "|" + c.p;
      const mainMethod = c.ing + "|" + chain(c.p).filter(step => step !== "chop").join(">");
      cooked.set(mainMethod, (cooked.get(mainMethod) || 0) + mass);
      foods.set(c.ing, (foods.get(c.ing) || 0) + mass);
      methods.set(method, (methods.get(method) || 0) + mass);
      total += mass;
    }
    return { foods, methods, cooked, total };
  }
  const plate = profile(build);
  if (!plate.total) return null;
  const overlap = (a, b, other) => [...a].reduce((n, [k, v]) =>
    n + Math.min(v / plate.total, (b.get(k) || 0) / other), 0);
  let best = null, bestScore = 0;
  for (const id of [...Object.keys(R.kitchen.recipes), ...menu.map(d => d.id)]) {
    const recipe = recipeOf(R, id, menu), ref = profile(recipe.build);
    const coverage = [...ref.foods.keys()].filter(k => plate.foods.has(k)).length / ref.foods.size;
    const composition = overlap(plate.foods, ref.foods, ref.total);
    const exact = overlap(plate.methods, ref.methods, ref.total);
    const technique = exact * 0.2 + overlap(plate.cooked, ref.cooked, ref.total) * 0.8;
    const score = composition * 0.45 + technique * 0.45 + coverage * 0.1;
    if (coverage >= 0.75 && composition >= 0.82 && technique >= 0.76 && score > bestScore) {
      best = { id, name: recipe.name }; bestScore = score;
    }
  }
  return best;
}

//: How well a thing is done after ``ratio`` of its time on the heat: 1 is right, raw under, burnt over.
export function doneness(R, ratio, proc = null) {
  const D = R.kitchen.doneness, cap = R.kitchen.processes[proc]?.quality_cap ?? 1;
  let q;
  if (ratio < D.raw_below) q = 0.15 * ratio / D.raw_below;
  else if (ratio < D.right[0]) q = lerp(0.35, 0.95, (ratio - D.raw_below) / (D.right[0] - D.raw_below));
  else if (ratio <= D.right[1]) q = 1;
  else if (ratio < D.burnt_above) q = lerp(0.95, 0.3, (ratio - D.right[1]) / (D.burnt_above - D.right[1]));
  else q = Math.max(0.05, 0.3 - (ratio - D.burnt_above) * 0.3);
  return Math.min(cap, q);
}
//: The word for how a thing came out.
export function donenessWord(q, ratio) {
  if (q >= 0.95) return "just right";
  if (ratio !== undefined && ratio > 1) return q < 0.3 ? "burnt" : "overdone";
  return q < 0.3 ? "raw" : "underdone";
}
const isHeat = (R, p) => chain(p).some((x) => R.kitchen.heat.includes(x));
//: Whether a component would make someone ill: meat, fish or egg that needed heat and had none, or too little.
export function unsafe(R, c) {
  const I = ingredient(R, c.ing);
  if (!I || I.raw_ok) return false;
  if (I.role !== "protein" && I.role !== "starch") return false;
  if (c.ratios?.length) return !chain(c.p).some((step, i) => R.kitchen.heat.includes(step) && c.ratios[i] >= R.kitchen.doneness.right[0]);
  return !isHeat(R, c.p) || (c.q ?? 1) < 0.3;
}
// The longest increasing run (patience sorting): how much of the order was right.
function lisLength(seq) {
  const tails = [];
  for (const x of seq) { let lo = 0, hi = tails.length; while (lo < hi) { const m = (lo + hi) >> 1; if (tails[m] < x) lo = m + 1; else hi = m; } tails[lo] = x; }
  return tails.length;
}

//: A plate scored against what was asked for: 0-100 and the parts of it, with notes for the cook.
//: ``plate`` is the components in the order they were put on ({ing, qty, p, q, side}); ``target``
//: the recipe (targetOf). ``elapsed`` and ``patience`` are real seconds.
export function scorePlate(R, target, plate, { elapsed = 0, patience = 120, targetSeconds = patience * 0.5 } = {}) {
  const W = R.kitchen.score.weights, notes = [];
  const want = target.build.map((c, i) => ({ ...c, i }));
  const pieces = (plate || []).map((c, j) => ({ ...part(c), q: clamp(+c.q || 0, 0, 1), j }));
  const got = [];
  // Two separately cooked scoops can fill one portion. Preserve distinct layers (sandwich bread).
  const key = c => c.ing + "|" + c.p;
  const layers = new Set(), seen = new Set(), portionsByKey = new Map();
  for (const c of want) {
    if (seen.has(key(c))) layers.add(key(c));
    seen.add(key(c));
  }
  for (const c of pieces) {
    const id = key(c), prior = portionsByKey.get(id);
    if (prior && !layers.has(id)) {
      prior.q = (prior.q * prior.qty + c.q * c.qty) / (prior.qty + c.qty);
      prior.qty += c.qty;
    } else {
      const portion = { ...c };
      got.push(portion); portionsByKey.set(id, portion);
    }
  }
  const used = new Set(), pairs = [];
  // Each wanted component matched to the best unused one of the same ingredient (the right process first).
  for (const w of want) {
    let best = null, bs = -Infinity;
    for (const g of got) {
      if (used.has(g.j) || g.ing !== w.ing) continue;
      const s = (g.p === w.p ? 2 : 0) + (chain(g.p).at(-1) === chain(w.p).at(-1) ? 1 : 0) - Math.abs(g.qty - w.qty) * 0.1;
      if (s > bs) { bs = s; best = g; }
    }
    if (best) { used.add(best.j); pairs.push([w, best]); }
    else notes.push(`missing ${ingredient(R, w.ing)?.name.toLowerCase() || w.ing}`);
  }
  const extra = got.filter((g) => !used.has(g.j));
  for (const g of extra) notes.push(`${ingredient(R, g.ing)?.name.toLowerCase() || g.ing} does not belong`);
  const n = Math.max(1, want.length);
  const ing = clamp((pairs.length - 0.5 * extra.length) / n, 0, 1);
  let proc = 0, done = 0, done_n = 0, portions = 0, ill = false;
  for (const [w, g] of pairs) {
    const shaped = !w.shape || (g.shape?.form === w.shape.form && Math.abs(g.shape.span / w.shape.span - 1) < 0.15 && Math.abs(g.shape.aspect / w.shape.aspect - 1) < 0.15);
    if (!shaped) notes.push(`shape the dough into a ${w.shape.form} about ${w.shape.span} cm across`);
    const ok = g.p === w.p && shaped, last = chain(g.p).at(-1) === chain(w.p).at(-1);
    proc += ok ? 1 : last ? 0.5 : 0;
    if (!ok) notes.push(`${ingredient(R, w.ing).name.toLowerCase()} should be ${chain(w.p).map((x) => R.kitchen.processes[x].verb).join(" then ") || "as it comes"}`);
    if (isHeat(R, w.p)) {
      done += g.q; done_n += 1;
      if (g.q < 0.95) notes.push(`${ingredient(R, w.ing).name.toLowerCase()} ${donenessWord(g.q, g.ratio)}`);
    }
    portions += Math.max(0, 1 - Math.abs(g.qty - w.qty) / Math.max(w.qty, g.qty));
    if (Math.abs(g.qty - w.qty) > 1e-6) notes.push(`${ingredient(R, w.ing).name}: ${displayAmount(R, w.ing, g.qty)} (asked for ${displayAmount(R, w.ing, w.qty)})`);
  }
  for (const g of pieces) if (unsafe(R, g)) { ill = true; notes.push(`undercooked ${ingredient(R, g.ing).name.toLowerCase()}: not safe to eat`); }
  const np = Math.max(1, pairs.length);
  const parts = { ingredients: ing, processes: proc / np, doneness: done_n ? done / done_n : (pairs.length ? 1 : 0), portions: portions / np,
    speed: waitTipShare({ real_s: patience, target_s: targetSeconds }, elapsed) };
  // The order of the build (bun, patty, cheese...): the longest run in the right order.
  let weights = { ...W };
  if (target.ordered) {
    const seq = pairs.filter(([w]) => !w.side).sort((a, b) => a[1].j - b[1].j).map(([w]) => w.i);
    parts.order = seq.length > 1 ? (lisLength(seq) - 1) / (seq.length - 1) : seq.length ? 1 : 0;
    if (parts.order < 1) notes.push("built in the wrong order");
  } else delete weights.order;
  const total = Object.values(weights).reduce((s, x) => s + x, 0);
  let score = Object.entries(weights).reduce((s, [k, w]) => s + w * (parts[k] ?? 0), 0) / total * 100;
  if (ill) score = Math.min(score, 15);
  if (!pairs.length) score = 0;
  return { score: Math.round(score), stars: Math.round(score / 20 * 2) / 2, parts, notes: [...new Set(notes)].slice(0, 6), unsafe: ill };
}

//: The tip on a ticket worth ``price`` made to ``score``, with ``comps`` things on the house, by a
//: customer as generous as ``generosity`` (about 1).
export function tipFor(R, score, price, comps = 0, generosity = 1) {
  const T = R.kitchen.tips, by = T.by_score;
  let rate = 0;
  for (let i = 0; i < by.length; i += 1) {
    const [s, r] = by[i], next = by[i + 1];
    if (score >= s) rate = next ? lerp(r, next[1], clamp((score - s) / (next[0] - s), 0, 1)) : r;
  }
  if (score >= 40) rate += Math.min(T.comp_lift_max, comps * T.comp_lift);
  return Math.max(0, Math.round(price * rate * generosity));
}

//: A dish as a test customer tastes it: 0-100, what it does for the bars, what it costs, a fair
//: price, and what they say. ``build`` is the components as cooked ({ing, qty, p, q}).
export function tasteOf(R, build, { kind = null } = {}) {
  const K = R.kitchen, comps = (build || []).map((c) => ({ ...part(c), q: clamp(+(c.q ?? 1), 0, 1) })).filter((c) => K.ingredients[c.ing] && c.qty > 0);
  const flav = Object.fromEntries(TASTES.map((k) => [k, 0]));
  let stamina = 0, health = 0, q = 0, qn = 0, grams = 0, kcal = 0;
  const roles = new Set(), tags = {}, notes = [];
  for (const c of comps) {
    const I = K.ingredients[c.ing];
    let st = I.stamina * c.qty, he = I.health * c.qty;
    const cooked = cookedPart(R, c);
    grams += cooked.grams; kcal += cooked.kcal;
    for (const k of TASTES) flav[k] += (cooked.flavour[k] || 0) * cooked.grams;
    // A gram of seasoning can change the whole plate (rules.json ``potent``: salt, the spices, chili).
    if (I.potent) for (const [k, v] of Object.entries(I.potent)) flav[k] += v * cooked.grams;
    for (const p of chain(c.p)) {
      const P = K.processes[p];
      st *= P.stamina || 1; he += (P.health || 0) * c.qty;
    }
    if (c.p !== "-") { q += c.q * cooked.grams; qn += cooked.grams; }
    if (unsafe(R, c)) { he -= 10; notes.push(`the ${I.name.toLowerCase()} was undercooked`); }
    stamina += st; health += he;
    roles.add(I.role);
    for (const t of I.tags) tags[t] = (tags[t] || 0) + cooked.grams;
  }
  if (!comps.length) return { grams: 0, kcal: 0, taste: 0, stamina: 0, health: 0, cost: 0, price: 0, notes: ["there was nothing on the plate"], flavour: flav, verdict: "…" };
  // Balance: some savour or sweetness, salt in the right range, not all one thing, something fresh against the fat.
  const per = (k) => flav[k] / grams;
  let taste = 50;
  const savoury = per("um") + per("sa") * 0.6, sweet = per("sw");
  taste += clamp(Math.max(savoury, sweet) * 12, 0, 18);
  const salt = per("sa");
  if (savoury > sweet) taste += salt < 0.3 ? -8 : salt > 2.2 ? -14 * (salt - 2.2) - 4 : 6;
  if (per("fa") > 1.2 && per("fr") + per("so") < 0.4) { taste -= 8; notes.push("heavy: it wants something fresh or sharp"); }
  if (per("fa") > 0.4 && per("so") + per("fr") > 0.4) taste += 5;
  if (per("sp") > 2.2) { taste -= 18; notes.push("far too hot"); } else if (per("sp") > 1.3) { taste -= 9; notes.push("too hot"); } else if (per("sp") > 0.3) taste += 3;
  if (sweet > 0.9 && per("um") > 0.7) { taste -= 6; notes.push("sweet and savoury muddled together"); }
  if (per("bi") > 1.4) { taste -= 9; notes.push("bitter"); }
  // Variety of what is on the plate: a base, a protein, a vegetable, a sauce.
  const want = ["starch", "protein", "veg", "sauce", "dairy", "herb", "fruit"].filter((r) => roles.has(r)).length;
  taste += clamp((want - 1) * 3, 0, 12);
  const amounts = needs(comps);
  const top = Math.max(...Object.entries(amounts).map(([id, n]) => ingredient(R, id).grams * n)) /
    comps.reduce((sum, c) => sum + ingredient(R, c.ing).grams * c.qty, 0);
  if (Object.keys(amounts).length > 2 && top > 0.75) { taste -= 6; notes.push("too much of one thing"); }
  // Pairs that lift it, cuisines that agree, and clashes.
  const has = new Set(comps.map((c) => c.ing));
  let paired = 0;
  for (const [a, b] of K.pairs) if (has.has(a) && has.has(b)) paired += 1;
  taste += Math.min(12, paired * 4);
  const tagList = Object.entries(tags).sort((a, b) => b[1] - a[1]);
  const lead = tagList[0]?.[1] || 0;
  taste += clamp(lead / grams * 10 - 3, -3, 6);
  // A clash is between kinds of ingredient ("role" or "role:cuisine"): ice cream with fried fish.
  const isA = (spec) => { const [role, tag] = spec.split(":"); return comps.filter((c) => K.ingredients[c.ing].role === role && (!tag || K.ingredients[c.ing].tags.includes(tag))); };
  for (const [a, b] of K.clashes) {
    const A = isA(a), B = isA(b).filter((c) => !K.ingredients[c.ing].tags.some((t) => t === "dessert" || t === "breakfast"));   // eggs belong in cake
    if (A.length && B.some((x) => !A.includes(x))) { taste -= 16; notes.push(`${K.ingredients[A[0].ing].name.toLowerCase()} and ${K.ingredients[B.find((x) => !A.includes(x)).ing].name.toLowerCase()} fight each other`); }
  }
  // How well it was cooked, and portion size (a meal is 5-12 units here).
  const cooked = qn ? q / qn : 1;
  taste = taste * (0.55 + 0.45 * cooked);
  if (qn && cooked < 0.7) notes.push(cooked < 0.4 ? "badly cooked" : "not cooked quite right");
  const drink = comps.every((c) => ["drink", "dairy", "fruit", "sweet"].includes(K.ingredients[c.ing].role));
  if (drink && per("bi") > 1.4) taste += 9;   // coffee is meant to be bitter
  if (!drink && grams < 65) { taste -= 6; notes.push("a very small portion"); } else if (grams > 1200) { taste -= 6; notes.push("an enormous portion"); }
  if (kind && tagList.length && !(R.kitchen.kitchens[kind] || []).length) taste -= 2;
  if (comps.some(c => unsafe(R, c))) taste = Math.min(30, taste);
  taste = Math.round(clamp(taste, 0, 100));
  const cost = buildCost(R, comps);
  const [lo, hi] = K.lab.markup, unit = R.money(0.5);
  const price = Math.max(R.money(2), Math.round(cost * lerp(lo, hi, taste / 100) / unit) * unit);
  const verdict = taste >= 85 ? "Outstanding. I'd come back for this." : taste >= 72 ? "Really good. I'd order it again." : taste >= 60 ? "Pretty good, it needs a little something."
    : taste >= 45 ? "It's okay. I wouldn't order it again." : taste >= 30 ? "Not great, honestly." : "I couldn't finish it.";
  return { grams: Math.round(grams * 100) / 100, kcal: Math.round(kcal), taste, stamina: Math.round(clamp(stamina * (0.7 + 0.3 * cooked), 0, 80)), health: Math.round(clamp(health, -20, 15)), cost, price,
    flavour: Object.fromEntries(TASTES.map((k) => [k, Math.round(per(k) * 10) / 10])), notes: [...new Set(notes)].slice(0, 4), verdict, cuisine: tagList[0]?.[0] || null };
}

//: The employee rating, 0-100: how well they cook, how few customers walked, and what they gave
//: away and spoiled against what they sold.
export function ratingOf(R, rec) {
  const G = R.kitchen.rating;
  if (!rec || (rec.served || 0) + (rec.walkouts || 0) < 1) return G.start;
  const avg = rec.score_sum / Math.max(1, rec.served);
  const kept = rec.served / Math.max(1, rec.served + rec.walkouts);
  const sales = Math.max(1, rec.sales || 0);
  const compOver = Math.max(0, (rec.comps || 0) / sales - G.comp_share_ok), wasteOver = Math.max(0, (rec.waste || 0) / sales - G.waste_share_ok);
  return Math.round(clamp(0.62 * avg + 38 * kept - 160 * compOver - 160 * wasteOver, 0, 100));
}

// ---- installing ------------------------------------------------------------------------------------

export function installKitchen(CityWorld, CityError) {
  const W = CityWorld.prototype;
  const fail = (m) => { throw new CityError(m); };
  const KR = (w) => w.R.kitchen;
  const realMs = (w, s) => Math.max(1, w.afterReal(s * 1000) - w.now);   // real seconds as game ms, now

  W.kitchenInit = function () { this.kitchens = new Map(); };
  W.kitchenJSON = function () { return [...(this.kitchens || new Map()).values()]; };
  W.kitchenLoad = function (list = []) {
    this.kitchenInit();
    for (const k of list || []) { this.kitchens.set(k.id, k); seedRealMenu(this.R, k); for (const d of k.menu || []) registerDish(this.R, d); }
  };
  //: A restaurant whose real menu is known (rules.json ``menus``): its dishes are the real ones,
  //: each rebuilt from the menu's name and description (menu-dish.mjs dishFromMenu), in place of
  //: the house's own list. A dish put on the menu from the lab is kept beside them.
  function seedRealMenu(R, k) {
    const real = R.menus?.places?.[k.id];
    if (!real?.items?.length || (k.real && k.real.fetched === (real.fetched || null))) return;
    const own = (k.menu || []).filter((d) => !d.real);
    k.menu = [...menuDishes(R, k.id, real.items, { kind: k.kind }), ...own];
    k.real = { name: real.name || null, source: real.source || null, fetched: real.fetched || null, style: real.style || null };
    // The real recipes as they are cooked: a station the kind lacks is one this kitchen has.
    k.extra_stations = stationsNeeded(R, k.kind, k.menu.map((d) => d.build));
  }
  //: An approved dish, as one of the city's items (so it can be bought, carried and eaten).
  function registerDish(R, d) {
    if (R.items[d.id]) { Object.assign(R.items[d.id], { name: d.name, price: d.price, use: { stamina: d.stamina, health: d.health } }); return; }
    R.items[d.id] = { name: d.name, price: d.price, kg: d.grams ? d.grams / 1000 : 0.4, kind: "prepared_food", use: { stamina: d.stamina, ...(d.health ? { health: d.health } : {}) },
      material_of: "food", hold: "hand", length_m: 0.15, house_dish: d.place };
  }

  //: The kind of food shop at a place: a player's business's, or the resident's shop's.
  W.kitchenKind = function (place) {
    const b = this.bizAt(place?.id);
    if (b) return hasKitchen(this.R, b.kind) ? b.kind : null;
    // The shop's own kind (shop:american) before the building's use (use:restaurant).
    const keys = [...(place?.keys || [])], own = new Set(keys.filter((x) => x.startsWith("shop:")));
    const kinds = storesAt(this.R, keys).map((s) => s.kind).filter((k) => hasKitchen(this.R, k));
    return kinds.find((k) => (this.R.stores.kinds[k].at || []).some((a) => own.has(a))) || kinds[0] || null;
  };
  //: The kitchen at a place, set up the first time anyone works it.
  W.kitchenAt = function (place, make = true) {
    const id = String(place?.id ?? "");
    let k = this.kitchens.get(id);
    if (k || !make) return k || null;
    const kind = this.kitchenKind(place);
    if (!kind) return null;
    const b = this.bizAt(id), r = rng("kitchen", id);
    k = { id, kind, name: b?.name || place.name || this.R.stores.kinds[kind].name, business: b?.id || null, place: { id, x: place.x, z: place.z, name: place.name || null, keys: [...(place.keys || [])] },
      owner_name: b ? null : nameOf(rng("owner", id)), cooks: [nameOf(r), nameOf(r), nameOf(r)], pantry: {}, incoming: [], month: null, ordered: {}, menu: [], proposals: [], tests: [],
      lines: {}, held: {}, staff: {}, log: [], seq: 0, carry: {}, opened: this.now };
    this.kitchens.set(id, k);
    seedRealMenu(this.R, k);
    for (const d of k.menu) registerDish(this.R, d);
    if (b) {
      // A player's business: its shelves of ready dishes become the pantry they were made from.
      for (const dish of itemsFor(this.R, b.kind)) {
        const rec = recipeOf(this.R, dish);
        const n = b.stock[dish] || 0;
        if (rec && n > 0) addTo(k.pantry, Object.fromEntries(Object.entries(needs(rec.build)).map(([i, q]) => [i, q * n])));
      }
      this.syncStock(k);
    } else this.monthOrder(k, true);
    return k;
  };
  const monthKey = (t) => `${t.year}-${String(t.month).padStart(2, "0")}`;
  //: A resident owner's order for the month: what the shop's customers will eat (its typical week,
  //: a month of it) with a little to spare; on the first day the kitchen is worked, the rest of the
  //: month's. The pantry is filled up to it, not added to (what is left over is used first).
  W.monthOrder = function (k, partial = false) {
    const R = this.R, t = this.time, P = KR(this).pantry;
    k.month = monthKey(t);
    if (k.business) return;
    const wk = estimateWeek(R, k.place, k.kind, { rivals: this.shops.get(k.id)?.rivals ?? 1, week: Math.floor(t.day / 7) });
    const daysLeft = partial ? Math.max(3, 31 - t.date) : 30;
    const r = rng("thrift", k.id, k.month), buffer = lerp(P.month_buffer[0], P.month_buffer[1], r());
    const order = { water: daysLeft * 2, flour: daysLeft };
    for (const dish of k.real ? [] : itemsFor(R, k.kind)) {
      const rec = recipeOf(R, dish);
      if (!rec) continue;
      const units = Math.max(P.player_start_portions / 3, (wk.items?.[dish]?.[0] || 0) / 7 * daysLeft) * buffer;
      for (const [i, q] of Object.entries(needs(rec.build))) order[i] = (order[i] || 0) + q * units;
    }
    for (const d of k.menu) for (const [i, q] of Object.entries(needs(d.build))) order[i] = (order[i] || 0) + q * daysLeft * 4 * buffer;
    k.ordered = {};
    for (const [i, q] of Object.entries(order)) { const n = Math.ceil(q); k.ordered[i] = n; k.pantry[i] = Math.max(k.pantry[i] || 0, n); }
    this.kitchenLog(k, { kind: "order", memo: `${k.owner_name} ordered the month's ingredients`, cost: Object.entries(k.ordered).reduce((s, [i, n]) => s + ingCost(R, i, n), 0) });
  };
  W.kitchenLog = function (k, e) { k.log.push({ t: this.now, ...e }); if (k.log.length > 80) k.log.splice(0, k.log.length - 80); };
  //: A player's business's ready dishes: how many of each its pantry can make.
  W.syncStock = function (k) {
    const b = k.business ? this.biz.get(k.business) : null;
    if (!b) return;
    for (const dish of itemsFor(this.R, b.kind)) { const r = recipeOf(this.R, dish); if (r) b.stock[dish] = makeable(k.pantry, r.build); }
  };
  //: The day's books of the shop the kitchen is in: a player business's, or the resident shop's.
  W.kitchenBooks = function (k) {
    const b = k.business ? this.biz.get(k.business) : null;
    if (b) return b.today;
    return this.shopRecord(k.place, {})?.today || null;
  };
  const book = (w, k, field, amount) => {
    const d = w.kitchenBooks(k);
    if (!d || !amount) return;
    d.cogs += amount;
    d[field] = (d[field] || 0) + amount;
  };

  // ---- the hours going by: deliveries, the month's order, and what the NPC customers eat -----------
  //: Before an hour of a shop's model (enterprise.mjs runShop / runBusiness): what came in, the
  //: month's order, and the dishes it can sell. Returns the kitchen, or null when it has none.
  W.kitchenBeforeHour = function (b, t) {
    const k = this.kitchens?.get(String(b.place?.id ?? b.id));
    if (!k) return null;
    const at = t.ms ?? this.now;
    for (const inc of k.incoming) if (inc.at <= at + HOUR / 2) { addTo(k.pantry, inc.items); inc.done = true; }
    k.incoming = k.incoming.filter((x) => !x.done);
    if (!k.business && k.month !== monthKey(t)) this.monthOrder(k);
    b.stock ||= {};
    for (const dish of itemsFor(this.R, b.kind)) {
      const r = recipeOf(this.R, dish);
      b.stock[dish] = r ? makeable(k.pantry, r.build) : (k.business ? b.stock[dish] || 0 : 1e9);
    }
    return k;
  };
  //: After the hour: what was sold, taken from the pantry; and the house's own dishes, sold to the
  //: hour's customers by how good they are.
  W.kitchenAfterHour = function (k, b, o) {
    const R = this.R;
    for (const [dish, n] of Object.entries(o.units || {})) {
      const r = recipeOf(R, dish);
      if (r) draw(k.pantry, Object.fromEntries(Object.entries(needs(r.build)).map(([i, q]) => [i, q * n])));
    }
    if (o.served > 0 && k.menu.length) {
      const d = this.kitchenBooks(k);
      for (const dish of k.menu) {
        const want = o.served * 0.1 * Math.pow(dish.taste / 80, 2) / Math.max(1, k.menu.length * 0.6) + (k.carry[dish.id] || 0);
        let n = Math.floor(want);
        k.carry[dish.id] = want - n;
        n = Math.min(n, makeable(k.pantry, dish.build));
        if (n <= 0 || !d) continue;
        draw(k.pantry, Object.fromEntries(Object.entries(needs(dish.build)).map(([i, q]) => [i, q * n])));
        const price = dish.price * n, cost = buildCost(R, dish.build) * n;
        d.sales += price; d.cogs += cost; d.tax += itemTax(R, b.chain || [], R.items[dish.id], price, this.laws || {});
        const x = ((d.items ||= {})[dish.id] ||= [0, 0, 0]); x[0] += n; x[1] += price; x[2] += cost;
        dish.sold = (dish.sold || 0) + n;
      }
    }
    if (k.business) this.syncStock(k);
  };

  // ---- the shop's counter: what players buy comes out of the pantry too ---------------------------
  const storesHere = W.storesHere, stockCheck = W.stockCheck, soldHere = W.soldHere, orderStock = W.cmd_order_stock;
  W.storesHere = function (place) {
    const id = String(place?.id ?? "");
    // (A restaurant with a real menu has its kitchen, and so its real dishes, from the first look.)
    const out = storesHere.call(this, place), k = this.kitchens?.get(id) || (this.R.menus?.places?.[id] && place?.keys ? this.kitchenAt(place, true) : null);
    if (!k?.menu.length || !out.length) return out;
    const own = k.menu.filter((d) => makeable(k.pantry, d.build) > 0).map((d) => d.id);
    // Its real menu in place of the house's list for its kind (what has no recipe, a bottle of
    // water, is still sold).
    return out.map((s, i) => (i === 0 ? { ...s, items: [...(k.real ? s.items.filter((d) => !recipeOf(this.R, d)) : s.items), ...own] } : s));
  };
  W.stockCheck = function (place, lines) {
    stockCheck.call(this, place, lines);
    const k = this.kitchens?.get(String(place?.id ?? ""));
    if (!k) return;
    const need = {};
    for (const l of lines) { const r = recipeOf(this.R, l.item, k.menu); if (r) for (const [i, q] of Object.entries(needs(r.build))) need[i] = (need[i] || 0) + q * l.qty; }
    for (const [i, q] of Object.entries(need)) if ((k.pantry[i] || 0) < q) fail(`sold out: the kitchen has run out of ${ingredient(this.R, i).name.toLowerCase()}`);
  };
  W.soldHere = function (place, lines, pid = null) {
    soldHere.call(this, place, lines, pid);
    const k = this.kitchens?.get(String(place?.id ?? ""));
    if (!k) return;
    // A cook on the line makes it (the order goes to them as a ticket); otherwise the NPC cooks do.
    const cook = Object.entries(k.lines).find(([cpid, L]) => !L.covering && cpid !== pid && this.onLine(k, cpid));
    const dishes = lines.filter((l) => recipeOf(this.R, l.item, k.menu));
    if (cook && pid && dishes.length) {
      const p = this.players.get(pid), L = cook[1];
      const t = { id: `t:${k.id}:${++k.seq}`, at: this.now,
        who: p?.name || "A customer", player: pid, generosity: 1, paid: true,
        lines: dishes.flatMap((l) => Array.from({ length: Math.min(3, l.qty) }, () => ({ dish: l.item, mods: [] }))) };
      const window = serviceWindow(this.R, k.kind, t.lines, k.menu, "Takeout");
      Object.assign(t, window, { due: this.now + realMs(this, window.real_s) });
      L.tickets.push(t);
      return;
    }
    for (const l of dishes) {
      const r = recipeOf(this.R, l.item, k.menu);
      draw(k.pantry, Object.fromEntries(Object.entries(needs(r.build)).map(([i, q]) => [i, q * l.qty])));
    }
    this.syncStock(k);
  };
  //: An owner ordering ready dishes for a kitchen that is worked: the ingredients they are made of.
  W.cmd_order_stock = function (pid, args) {
    const k = this.kitchens?.get(String(this.biz.get(args?.business)?.place?.id ?? ""));
    if (!k) return orderStock.call(this, pid, args);
    const R = this.R, items = {};
    for (const [dish, n] of Object.entries(args.items || {})) {
      const r = recipeOf(R, dish);
      if (!r) fail(`${R.items[dish]?.name || dish} is not on the menu`);
      for (const [i, q] of Object.entries(needs(r.build))) items[i] = (items[i] || 0) + q * Math.max(0, Math.min(500, n | 0));
    }
    return this.cmd_kitchen_order(pid, { place: k.place, items, memo: "dishes" });
  };

  // ---- who works the line ---------------------------------------------------------------------------
  //: Whether ``p`` may work the kitchen at ``place``: its owner, or staff there on the clock.
  W.kitchenAccess = function (p, place) {
    const b = this.bizAt(place?.id);
    if (b && b.owner === p.account) return "owner";
    if (p.job?.place?.id === String(place?.id) || p.job?.place?.id === place?.id) {
      if (!p.clocked) fail("clock in first: the kitchen is for staff on shift");
      return "staff";
    }
    fail("staff only: work here (the Shop's Jobs) to get into the kitchen");
  };
  W.onLine = function (k, pid) {
    const p = this.players.get(pid);
    if (!p || this.now - (p.seen || 0) > 3 * 60_000) return false;
    const b = k.business ? this.biz.get(k.business) : null;
    return Boolean((p.clocked && String(p.job?.place?.id) === k.id) || (b && b.owner === p.account));
  };
  const kitchenFor = (w, p, place) => {
    if (!place?.id) fail("which kitchen?");
    if (!w.kitchenKind(place)) fail("there is no kitchen here");
    if (p.x !== undefined && place.x !== undefined && Math.hypot(p.x - place.x, p.z - place.z) > w.R.jobs.workplace_reach_m * 2) fail("go to the restaurant first");
    const role = w.kitchenAccess(p, place);
    return { k: w.kitchenAt(place), role };
  };
  const staffRec = (k, pid) => (k.staff[pid] ||= { served: 0, score_sum: 0, tips: 0, sales: 0, comps: 0, comps_n: 0, waste: 0, lab: 0, walkouts: 0, warned: 0, tests: 0, dishes: 0 });
  const worked = (p) => { if (p.clocked) p.clocked.done = (p.clocked.done || 0) + 1; };

  // ---- tickets --------------------------------------------------------------------------------------
  //: Whether the shop is taking customers now, and how busy it is (0-1).
  W.kitchenBusy = function (k) {
    const t = this.time, b = k.business ? this.biz.get(k.business) : null;
    const hours = b?.hours || hoursFor(this.R, k.kind);
    if (!isOpen(hours, t) || (b && b.status !== "open")) return 0;
    return this.R.business.hour_curves[groupOf(this.R, k.kind)][t.hour] ?? 0;
  };
  //: The dishes customers can order: the menu, less what the pantry cannot make.
  W.kitchenMenu = function (k) {
    const R = this.R;
    // (A restaurant with its real menu serves that, not the house's list for its kind.)
    const house = k.real ? [] : itemsFor(R, k.kind).filter((d) => recipeOf(R, d) && makeable(k.pantry, recipeOf(R, d).build) > 0);
    const own = k.menu.filter((d) => makeable(k.pantry, d.build) > 0).map((d) => d.id);
    return [...house, ...own];
  };
  //: A customer's ticket: a main, perhaps a side or a drink, perhaps an ask.
  W.newTicket = function (k, n, at) {
    const R = this.R, T = KR(this).tickets, r = rng("ticket", k.id, n);
    const b = k.business ? this.biz.get(k.business) : null;
    const menu = this.kitchenMenu(k);
    if (!menu.length) return null;
    const kindOf = (d) => { const v = recipeOf(R, d, k.menu)?.vessel; return v === "cup" || v === "glass" ? "drink" : (R.items[d]?.price || 0) < R.money(8) ? "side" : "main"; };
    const weighted = (list) => {
      const ws = list.map((d) => [d, priceDemand(R, d, b?.prices?.[d] ?? 1) * (k.menu.find((x) => x.id === d) ? 0.6 + (k.menu.find((x) => x.id === d).taste / 100) : 1)]);
      let x = r() * ws.reduce((s, [, w]) => s + w, 0);
      for (const [d, w] of ws) { x -= w; if (x <= 0) return d; }
      return ws.at(-1)[0];
    };
    const mains = menu.filter((d) => kindOf(d) === "main"), sides = menu.filter((d) => kindOf(d) === "side"), drinks = menu.filter((d) => kindOf(d) === "drink");
    const lines = [];
    const first = mains.length ? weighted(mains) : weighted(menu);
    lines.push({ dish: first, mods: [] });
    if (sides.length && lines.length < T.items_most && r() < 0.3) lines.push({ dish: weighted(sides), mods: [] });
    if (drinks.length && lines.length < T.items_most && r() < 0.45) lines.push({ dish: weighted(drinks), mods: [] });
    // An ask: leave something out, or extra of something.
    const main = recipeOf(R, first, k.menu);
    if (main && r() < T.mod_chance) {
      const can = main.build.filter((c) => ["veg", "sauce", "dairy", "herb"].includes(ingredient(R, c.ing)?.role));
      if (can.length) {
        const c = pick(r, can);
        lines[0].mods.push(r() < 0.6 ? { no: c.ing } : { extra: c.ing });
      }
    }
    const service = r() < (R.kitchen.service[k.kind]?.takeout ?? 0.35) ? "Takeout" : "Sit-down";
    const window = serviceWindow(R, k.kind, lines, k.menu, service, 0.8 + 0.4 * r());
    const G = KR(this).tips.generosity;
    return { id: `t:${k.id}:${n}`, at, due: this.clock.after(at, window.real_s * 1000), ...window, who: nameOf(r), generosity: Math.round(lerp(G[0], G[1], r()) * 100) / 100, lines };
  };
  //: The line brought up to now: customers who gave up, new tickets, and the NPC cook's.
  W.kitchenTick = function (k, pid) {
    const R = this.R, T = KR(this).tickets, L = (k.lines[pid] ||= { tickets: [], next_at: this.now, covering: false, since: this.now });
    const busy = this.kitchenBusy(k);
    // Walked out: the ticket's time ran out.
    for (const t of [...L.tickets]) {
      if (this.now < t.due) continue;
      L.tickets = L.tickets.filter((x) => x !== t);
      const rec = staffRec(k, pid);
      rec.walkouts += 1;
      if (t.player) { this.npcCook(k, t); continue; }   // paid already: the NPC cooks make it
      this.kitchenLog(k, { kind: "walkout", pid, memo: `${t.who} gave up waiting` });
      const b = k.business ? this.biz.get(k.business) : null;
      if (b) b.reputation = clamp(b.reputation - 0.3, 0, 100);
      this.reviewStaff(k, pid);
    }
    if (L.covering) { for (const t of L.tickets) this.npcCook(k, t); L.tickets = []; L.next_at = this.now; }
    // New tickets: one every so often, more often when it is busy; none when it is shut.
    if (L.next_at < this.now - realMs(this, 90)) L.next_at = this.now - realMs(this, 90);
    while (!L.covering && busy > 0.04 && L.next_at <= this.now && L.tickets.length < T.open_most) {
      const n = ++k.seq;
      const t = this.newTicket(k, n, L.next_at);
      const gap = lerp(T.every_s[1], T.every_s[0], clamp(busy, 0, 1)) * (0.75 + 0.5 * rng("gap", k.id, n)());
      L.next_at += realMs(this, gap);
      if (!t) break;
      if (t.due > this.now) L.tickets.push(t);
    }
    if (busy <= 0.04 || L.covering) L.next_at = Math.max(L.next_at, this.now);
    // The owner's decisions on what was put to them, when a resident owns it.
    if (!k.business) for (const pr of k.proposals) if (pr.status === "pending" && this.now >= pr.decide_at) this.npcDecide(k, pr);
    return L;
  };
  //: An NPC cook making a ticket: from the pantry, at their skill; the sale in the books, no tip to anyone here.
  W.npcCook = function (k, t) {
    const R = this.R, C = KR(this).npc_cover, r = rng("npc", t.id);
    let price = 0, cost = 0, tax = 0;
    const d = this.kitchenBooks(k), b = k.business ? this.biz.get(k.business) : null;
    const made = [], skill = lerp(C.skill[0], C.skill[1], r());
    for (const l of t.lines) {
      const target = targetOf(R, l, k.menu);
      if (!target || !draw(k.pantry, needs(target.build))) continue;
      const p = (b ? this.priceAt(b.place, l.dish) : R.items[l.dish]?.price) || 0;
      const prepared = target.build.map(c => {
        const steps = chain(c.p);
        const ratios = steps.map((step, i) => {
          const intended = c.ratios?.[i] ?? 1;
          const minimum = step === "cool" || step === "chill" ? 1 : 0;
          return Math.max(minimum, intended + (r() - 0.5) * (1 - skill));
        });
        const q = Math.min(1, ...steps.map((step, i) => R.kitchen.heat.includes(step) ? doneness(R, ratios[i], step) : 1));
        return { ...c, ratios, q };
      });
      const { taste, kcal } = tasteOf(R, prepared);
      made.push({ dish: l.dish, score: scorePlate(R, target, prepared).score, taste, kcal });
      cost += buildCost(R, target.build);
      if (!t.paid) { price += p; tax += itemTax(R, b?.chain || [], R.items[l.dish], p, this.laws || {}); }
    }
    if (d && !t.paid) {
      d.sales += price; d.tax += tax; d.cogs += cost;
    }
    this.kitchenLog(k, { kind: "npc", memo: `${pick(r, k.cooks)} filled ${made.length}/${t.lines.length} dishes for ${t.who}`,
      made, score: made.length ? Math.round(made.reduce((sum, x) => sum + x.score, 0) / made.length) : 0 });
    if (k.business) this.syncStock(k);
  };

  // ---- the commands ---------------------------------------------------------------------------------
  //: What the kitchen shows a cook (or its owner): the pantry, the stations, the menu, your tickets,
  //: what you are holding, your rating and the kitchen's log.
  W.kitchenView = function (k, p, role) {
    const R = this.R, L = k.lines[p.id], rec = k.staff[p.id];
    const b = k.business ? this.biz.get(k.business) : null;
    const owner = role === "owner";
    return {
      id: k.id, kind: k.kind, name: k.name, role, owner_name: b ? (this.players.get(b.owner_pid)?.name || "the owner") : k.owner_name, cooks: k.cooks,
      serverPrep: Boolean(this.authoritativeJobs), board: k.boards?.[p.id], stations: kitchenStations(R, k), pantry: k.pantry, ordered: k.ordered, incoming: owner ? k.incoming : k.incoming.map((x) => ({ at: x.at })),
      menu: this.kitchenMenu(k), house_menu: k.menu, held: k.held[p.id] || {}, tickets: L?.tickets || [], covering: Boolean(L?.covering), busy: this.kitchenBusy(k),
      rating: ratingOf(R, rec), record: rec || null, tests: k.tests.filter((x) => owner || x.pid === p.id).slice(-12),
      proposals: k.proposals.filter((x) => owner || x.pid === p.id).slice(-12),
      staff: owner ? Object.entries(k.staff).map(([id, s]) => ({ pid: id, name: this.players.get(id)?.name || id, rating: ratingOf(R, s), ...s })) : undefined,
      log: k.log.filter((e) => owner || !e.pid || e.pid === p.id).slice(-25), now: this.now, month: k.month,
      prices: Object.fromEntries(this.kitchenMenu(k).map((d) => [d, b ? this.priceAt(b.place, d) : R.items[d]?.price || 0])),
      balance: b ? this.ledger.balance(b.account) : null,
    };
  };
  W.cmd_kitchen_open = function (pid, { place }) {
    const p = this.player(pid), { k, role } = kitchenFor(this, p, place);
    if (!k.business) this.shopRecord(place, { pid });
    this.kitchenTick(k, pid);
    return { kitchen: this.kitchenView(k, p, role) };
  };
  W.cmd_kitchen_state = function (pid, { place }) { return this.cmd_kitchen_open(pid, { place }); };
  // Validate the whole plate before debiting anything. A divided mixture may legitimately
  // contain fractions of a counted ingredient. Only withdrawals require whole pieces.
  function cleanPlate(R, plate, k) {
    if (!Array.isArray(plate) || plate.length > R.kitchen.lab.max_components) fail("too many components on the plate");
    const allowed = new Set(kitchenStations(R, k).flatMap((s) => s.does));
    return plate.map(c => {
      if (!c || !ingredient(R, c.ing) || !Number.isFinite(c.qty) || c.qty <= 0) fail("invalid ingredient or quantity");
      if (c.shape && !validShape(c.shape)) fail("invalid dough shape");
      const steps = chain(c.p);
      if (steps.length > 128 || steps.some(p => !allowed.has(p))) fail("the kitchen cannot make that process chain");
      if (c.ratios != null && (!Array.isArray(c.ratios) || c.ratios.length !== steps.length ||
          c.ratios.some(r => !Number.isFinite(r) || r < 0))) fail("invalid step times");
      return { ing: c.ing, qty: c.qty, p: steps.join(">") || "-", q: clamp(+c.q || 0, 0, 1),
        ...(c.shape ? { shape: { form: c.shape.form, span: c.shape.span, aspect: c.shape.aspect } } : {}),
        ...(c.ratios ? { ratios: c.ratios.map(r => Math.min(10, r)) } : {}), ...(Number.isFinite(c.ratio) ? { ratio: c.ratio } : {}) };
    });
  }
  // Each lot belongs to one cook at one restaurant. Starting a station takes its
  // inputs out of circulation until the server finishes or discards the batch.
  function boardFor(k, pid) {
    return ((k.boards ||= {})[pid] ||= { lots: {}, jobs: {} });
  }
  function ingredientsFromBoard(w, k, pid, parts) {
    if (!Array.isArray(parts) || !parts.length || parts.length > w.R.kitchen.lab.max_components)
      fail("Choose ingredients on your board.");
    const board = boardFor(k, pid),
      held = (k.held[pid] ||= {});
    return parts.map((component) => {
      if (!component || typeof component !== "object") fail("Invalid portion.");
      const { ing, qty, lot, p } = component;
      if (!ingredient(w.R, ing) || !Number.isFinite(qty) || qty <= 0) fail("Invalid portion.");
      if (!lot) {
        if (p && p !== "-") fail("This preparation has no station record.");
        if (!(held[ing] >= qty)) fail("That raw portion is unavailable.");
        held[ing] -= qty;
        return { ing, qty, p: "-", q: 1, ratios: [], ratio: 1 };
      }
      const source = Object.hasOwn(board.lots, lot) && board.lots[lot];
      if (!source || source.ing !== ing || source.qty < qty - Number.EPSILON * Math.max(qty, source.qty))
        fail("That prepared portion is unavailable.");
      const taken = { ...source, qty: Math.min(qty, source.qty) };
      source.qty -= taken.qty;
      if (source.qty <= 0) delete board.lots[lot];
      return taken;
    });
  }
  function storeLots(w, board, parts) {
    return parts.map((part) => {
      const lot = w.id("portion");
      board.lots[lot] = part;
      return { ...part, lot };
    });
  }
  W.cmd_kitchen_prepare = function (pid, { place, parts, station, proc, job, action, shape }) {
    const { k } = kitchenFor(this, this.player(pid), place),
      board = boardFor(k, pid);
    const now = this.clock.real(this.now);
    if (action === "start" || action === "shape") {
      if (Object.keys(board.lots).length + Object.keys(board.jobs).length >= 256)
        fail("Clear some space on your board.");
      if (action === "shape") {
        const inputs = ingredientsFromBoard(this, k, pid, parts);
        if (!validShape(shape) || !workableDough(inputs.map((c) => ({ ...c, chain: chain(c.p) }))))
          fail("Shape workable dough first.");
        return {
          parts: storeLots(
            this,
            board,
            inputs.map((c) => ({ ...c, shape: { form: shape.form, span: shape.span, aspect: shape.aspect } })),
          ),
        };
      }
      const s = kitchenStations(this.R, k).find((s) => s.id === station && s.does.includes(proc));
      if (
        !s ||
        Object.values(k.boards)
          .flatMap((b) => Object.values(b.jobs))
          .filter((j) => j.station === station).length >= s.slots
      )
        fail("That station is unavailable.");
      const inputs = ingredientsFromBoard(this, k, pid, parts);
      if (inputs.some((c) => chain(c.p).length >= 128)) fail("Too many preparation steps.");
      const id = this.id("prep"),
        secs = batchSeconds(this.R, inputs, proc);
      board.jobs[id] = { station, proc, inputs, at: now, secs, taps: 0 };
      return { job: id, secs };
    }
    const j = Object.hasOwn(board.jobs, job) && board.jobs[job];
    if (!j) fail("This batch is no longer on the station.");
    if (action === "tap" && j.proc === "chop") {
      if (now - (j.lastTap ?? 0) < 100) fail("Finish the previous cut.");
      j.lastTap = now;
      j.taps++;
      return { taps: j.taps };
    }

    if (action !== "finish") fail("Unknown station action.");
    const ratio = j.proc === "chop" ? 1 : Math.min(10, Math.max(0, (now - j.at) / 1000 / j.secs));
    if (
      (["chill", "cool"].includes(j.proc) && ratio < 1) ||
      (j.proc === "chop" && j.taps < this.R.kitchen.processes.chop.taps)
    )
      fail("This step is still in progress.");
    const heat = this.R.kitchen.heat.includes(j.proc),
      mix = ["mix", "blend"].includes(j.proc);
    const partsOut = j.inputs.map((c) => {
      const out = {
        ...c,
        p: [...chain(c.p), j.proc].join(">"),
        ratios: [...c.ratios, ratio],
        q: Math.min(c.q, heat ? doneness(this.R, ratio, j.proc) : mix && ratio < 0.6 ? 0.6 : 1),
      };
      if (heat) out.ratio = ratio;
      if (mix) {
        out.batch = job;
        delete out.shape;
      }
      return out;
    });
    delete board.jobs[job];
    return { parts: storeLots(this, board, partsOut), ratio };
  };
  //: Taking ingredients from the pantry onto your board.
  W.cmd_kitchen_take = function (pid, { place, items = {} }) {
    const p = this.player(pid), { k, role } = kitchenFor(this, p, place);
    const want = {};
    for (const [id, n] of Object.entries(items)) {
      const spec = ingredient(this.R, id);
      if (!spec || !Number.isFinite(n) || n <= 0 ||
          (wholeUnits(spec) && !Number.isSafeInteger(n))) fail(spec?.measure === "shake" ? "shake out a whole number of shakes" : "enter a positive quantity in the bin's unit");
      want[id] = n;
    }
    if (!Object.keys(want).length) fail("take something");
    if (!draw(k.pantry, want)) fail("the pantry does not have that quantity");
    addTo((k.held[pid] ||= {}), want);
    this.syncStock(k);
    return { kitchen: this.kitchenView(k, p, role) };
  };
  //: Putting back what was taken and not yet touched.
  W.cmd_kitchen_return = function (pid, { place, items = {} }) {
    const p = this.player(pid), { k, role } = kitchenFor(this, p, place), held = (k.held[pid] ||= {});
    const back = Object.fromEntries(Object.entries(items).map(([i, n]) => [i, Math.min(held[i] || 0, Number.isFinite(n) ? Math.max(0, n) : 0)]).filter(([, n]) => n > 0));
    draw(held, back); addTo(k.pantry, back);
    this.syncStock(k);
    return { kitchen: this.kitchenView(k, p, role) };
  };
  //: Binning what was spoiled (burnt, dropped, made wrong): gone, its cost in the books as waste, and against you.
  W.cmd_kitchen_bin = function (pid, { place, items = {}, parts, why = "binned" }) {
    const p = this.player(pid), { k, role } = kitchenFor(this, p, place), held = (k.held[pid] ||= {});
    if (this.authoritativeJobs && parts) { items = needs(ingredientsFromBoard(this,k,pid,parts)); addTo(held,items); }
    const gone = Object.fromEntries(Object.entries(items).map(([i, n]) => [i, Math.min(held[i] || 0, Math.max(0, +n || 0))]).filter(([, n]) => n > 0));
    if (!Object.keys(gone).length) return { kitchen: this.kitchenView(k, p, role), cost: 0 };
    draw(held, gone);
    const cost = Object.entries(gone).reduce((s, [i, n]) => s + ingCost(this.R, i, n), 0);
    staffRec(k, pid).waste += cost;
    book(this, k, "waste", cost);
    this.kitchenLog(k, { kind: "waste", pid, cost, memo: `${p.name} binned ${Object.entries(gone).map(([i, n]) => `${n} ${ingredient(this.R, i).name.toLowerCase()}`).join(", ")} (${String(why).slice(0, 40)})` });
    this.reviewStaff(k, pid);
    return { kitchen: this.kitchenView(k, p, role), cost };
  };
  //: Serving a ticket: a plate a line, and anything on the house. Scored, sold, tipped.
  W.cmd_kitchen_serve = function (pid, { place, ticket, plates = [], extras = [] }) {
    const p = this.player(pid), R = this.R, { k, role } = kitchenFor(this, p, place);
    const L = this.kitchenTick(k, pid);
    const t = L.tickets.find((x) => x.id === ticket);
    if (!t) fail("that ticket has gone: the customer left, or it was served");
    if (!Array.isArray(plates) || plates.length !== t.lines.length) fail(`the ticket is for ${t.lines.length} ${t.lines.length === 1 ? "dish" : "dishes"}: plate each one`);
    // What is on the plates must be what you took from the pantry.
    const held = (k.held[pid] ||= {}), use = {};
    const clean = plates.map(pl => this.authoritativeJobs ? ingredientsFromBoard(this,k,pid,pl) : cleanPlate(R, pl, k));
    for (const pl of clean) for (const c of pl) use[c.ing] = (use[c.ing] || 0) + c.qty;
    if (!this.authoritativeJobs) for (const [i, n] of Object.entries(use)) if ((held[i] || 0) + 1e-9 < n) fail(`you have not got ${n} ${ingredient(R, i).name.toLowerCase()} on your board: take it from the pantry`);
    const menu = new Set(this.kitchenMenu(k));
    const comps = (Array.isArray(extras) ? extras : []).slice(0, 3).filter((d) => recipeOf(R, d, k.menu) && (menu.has(d) || makeable(k.pantry, recipeOf(R, d, k.menu).build) > 0));
    let compNeed = {};
    for (const d of comps) for (const [i, q] of Object.entries(needs(recipeOf(R, d, k.menu).build))) compNeed[i] = (compNeed[i] || 0) + q;
    for (const [i, q] of Object.entries(compNeed)) if ((k.pantry[i] || 0) < q) fail(`no ${ingredient(R, i).name.toLowerCase()} left for that on the house`);
    if (!this.authoritativeJobs) draw(held, use);
    draw(k.pantry, compNeed);
    const real = Math.max(0, (this.clock.real(this.now) - this.clock.real(t.at)) / 1000);
    const scores = t.lines.map((l, i) => scorePlate(R, targetOf(R, l, k.menu), clean[i], { elapsed: real, patience: t.real_s, targetSeconds: t.target_s }));
    const analyses = clean.map(pl => tasteOf(R, pl, { kind: k.kind }));
    const score = Math.round(scores.reduce((s, x) => s + x.score, 0) / scores.length);
    // The sale (a player customer paid at the counter), and the tip.
    const b = k.business ? this.biz.get(k.business) : null, d = this.kitchenBooks(k);
    const price = t.lines.reduce((s, l) => s + ((b ? this.priceAt(b.place, l.dish) : R.items[l.dish]?.price) || 0), 0);
    const cost = Object.entries(use).reduce((s, [i, n]) => s + ingCost(R, i, n), 0);
    const compCost = Object.entries(compNeed).reduce((s, [i, n]) => s + ingCost(R, i, n), 0);
    const here = this.where(p);
    if (d) {
      if (!t.paid) {
        d.sales += price; d.tax += t.lines.reduce((s, l) => s + itemTax(R, here.chain, R.items[l.dish], (b ? this.priceAt(b.place, l.dish) : R.items[l.dish]?.price) || 0, this.laws || {}), 0);
        for (const l of t.lines) { const x = ((d.items ||= {})[l.dish] ||= [0, 0, 0]); x[0] += 1; x[1] += (b ? this.priceAt(b.place, l.dish) : R.items[l.dish]?.price) || 0; }
      }
      d.cogs += cost;
      if (compCost) { d.cogs += compCost; d.comps = (d.comps || 0) + compCost; }
    }
    const tip = t.player ? 0 : tipFor(R, score, price, comps.length, t.generosity * waitTipShare(t, real));
    if (tip > 0) {
      const employer = role === "owner" ? b.account : this.ledger.open(p.job.employer, "business");
      this.ledger.mint(employer, tip, "npc_income", { at: this.now, memo: "tips" });
      this.ledger.transfer(employer, p.account, tip, { kind: "tip", memo: `tip from ${t.who}`, at: this.now });
    }
    const rec = staffRec(k, pid);
    rec.served += 1; rec.score_sum += score; rec.tips += tip; rec.sales += price; rec.comps += compCost; rec.comps_n += comps.length;
    if (compCost) this.kitchenLog(k, { kind: "comp", pid, cost: compCost, memo: `${p.name} gave ${t.who} ${comps.map((x) => R.items[x]?.name.toLowerCase()).join(" and ")} on the house` });
    this.kitchenLog(k, { kind: "served", pid, score, memo: `${p.name} served ${t.who}: ${t.lines.map((l) => R.items[l.dish]?.name).join(", ")}` });
    L.tickets = L.tickets.filter((x) => x !== t);
    if (b && score >= 80) b.reputation = clamp(b.reputation + 0.15 + 0.1 * comps.length, 0, 100);
    if (b && score < 40) b.reputation = clamp(b.reputation - 0.25, 0, 100);
    if (t.player) {
      const q = this.players.get(t.player);
      if (q) (q.meals ||= []).push({ id: t.id, place: k.id, name: k.name, cook: pid, cook_name: p.name, score, dishes: t.lines.map((l) => l.dish), at: this.now, tipped: false });
      if (q?.meals.length > 6) q.meals.splice(0, q.meals.length - 6);
    }
    worked(p);
    (p.experience ||= {}).kitchen = (p.experience.kitchen || 0) + 1;
    if (p.job?.role) p.experience[p.job.role] = (p.experience[p.job.role] || 0) + 1;
    this.syncStock(k);
    const review = this.reviewStaff(k, pid);
    return { score, scores, analyses, tip, price, comp_cost: compCost, rating: ratingOf(R, rec), review, kitchen: this.kitchenView(k, p, role) };
  };
  //: An NPC cook covering the line (and you to the lab), or the line back.
  W.cmd_kitchen_cover = function (pid, { place, on = true }) {
    const p = this.player(pid), { k, role } = kitchenFor(this, p, place);
    const L = (k.lines[pid] ||= { tickets: [], next_at: this.now, covering: false, since: this.now });
    L.covering = Boolean(on);
    if (!on) L.next_at = this.now + realMs(this, 6);
    this.kitchenTick(k, pid);
    return { covering: L.covering, cook: k.cooks[0], kitchen: this.kitchenView(k, p, role) };
  };
  //: The owner ordering ingredients: paid from the business's account, in the pantry within the lead time.
  W.cmd_kitchen_order = function (pid, { place, items = {}, memo = "ingredients" }) {
    const p = this.player(pid), R = this.R;
    const b = this.bizAt(place?.id);
    if (!b || b.owner !== p.account) fail("only the owner orders for the kitchen");
    const k = this.kitchenAt(b.place);
    const lines = Object.entries(items).map(([i, n]) => [i, Math.max(0, Math.min(5000, Math.round(+n || 0)))]).filter(([i, n]) => n > 0 && ingredient(R, i));
    if (!lines.length) fail("order something");
    const cost = lines.reduce((s, [i, n]) => s + ingCost(R, i, n), 0);
    if (this.ledger.balance(b.account) < cost) fail(`the order is ${R.fmt(cost)} and the business has ${R.fmt(this.ledger.balance(b.account))}: fund it first`);
    this.ledger.burn(b.account, cost, "external_supplier", { at: this.now, memo: `${memo} for ${b.name}'s kitchen` });
    const at = this.now + KR(this).pantry.order_lead_hours * HOUR;
    k.incoming.push({ at, items: Object.fromEntries(lines), cost });
    b.today.ordered = (b.today.ordered || 0) + cost;
    for (const [i, n] of lines) k.ordered[i] = (k.ordered[i] || 0) + n;
    this.kitchenLog(k, { kind: "order", pid, cost, memo: `${p.name} ordered ${lines.length} ingredients` });
    return { cost, arrives: at, kitchen: this.kitchenView(k, p, "owner") };
  };

  // ---- the lab --------------------------------------------------------------------------------------
  //: A dish of your own, served free to a customer as a test: tasted and scored, with what it does
  //: for the bars and what it costs. Its ingredients come out of the pantry like any other.
  W.cmd_lab_test = function (pid, { place, name = "", build = [] }) {
    const p = this.player(pid), R = this.R, { k, role } = kitchenFor(this, p, place), held = (k.held[pid] ||= {});
    const proposedName = String(name || "").trim().replace(/\s+/g, " ").slice(0, 40) || "Test dish";
    const comps = this.authoritativeJobs ? ingredientsFromBoard(this,k,pid,build) : cleanPlate(R, build, k);
    if (!comps.length) fail("put something in the dish first");
    const use = needs(comps);
    if (!this.authoritativeJobs) for (const [i, n] of Object.entries(use)) if ((held[i] || 0) + 1e-9 < n) fail(`you have not got ${n} ${ingredient(R, i).name.toLowerCase()} on your board`);
    if (!this.authoritativeJobs) draw(held, use);
    const res = tasteOf(R, comps, { kind: k.kind });
    const family = recognizeDish(R, comps, k.menu);
    const nm = family?.name || proposedName;
    const r = rng("taster", k.id, k.seq + 1), who = nameOf(r);
    const test = { id: `lab:${k.id}:${++k.seq}`, pid, by: p.name, name: nm, family: family?.id || null, build: comps.map(({ ing, qty, p, shape, ratios }) => ({ ing, qty, p, ...(shape ? {shape} : {}), ...(ratios ? { ratios } : {}) })), quality: comps.reduce((s, c) => s + c.q, 0) / comps.length,
      who, at: this.now, ...res };
    k.tests.push(test);
    if (k.tests.length > 30) k.tests.splice(0, k.tests.length - 30);
    const rec = staffRec(k, pid);
    rec.lab += res.cost; rec.tests += 1;
    book(this, k, "lab", res.cost);
    this.kitchenLog(k, { kind: "lab", pid, cost: res.cost, memo: `${p.name} tested "${nm}" on ${who}: ${res.taste}/100` });
    worked(p);
    return { test, kitchen: this.kitchenView(k, p, role) };
  };
  //: A tested dish put to the owner, at a price you suggest.
  W.cmd_lab_propose = function (pid, { place, test, price = null }) {
    const p = this.player(pid), R = this.R, { k, role } = kitchenFor(this, p, place), Lb = KR(this).lab;
    const x = k.tests.find((t) => t.id === test && t.pid === pid);
    if (!x) fail("test the dish on a customer first");
    if (x.family && (itemsFor(R, k.kind).includes(x.family) || k.menu.some(d => d.id === x.family))) fail("this dish is already on the menu");
    if (k.proposals.some((pr) => pr.test === test)) fail("you have put that one to the owner already");
    if (k.proposals.filter((pr) => pr.status === "pending").length >= Lb.proposals_most) fail("the owner has enough to taste: wait for an answer");
    const ask = Number.isFinite(+price) && +price > 0 ? Math.round(+price) : x.price;
    const pr = { id: `prop:${k.id}:${++k.seq}`, test, pid, by: p.name, name: x.name, kcal: x.kcal, grams: x.grams, family: x.family, build: x.build, taste: x.taste, stamina: x.stamina, health: x.health, cost: x.cost,
      price: clamp(ask, x.cost, x.cost * 8), status: "pending", at: this.now, decide_at: this.now + Lb.decide_game_hours * HOUR };
    k.proposals.push(pr);
    if (k.proposals.length > 30) k.proposals.splice(0, k.proposals.length - 30);
    this.kitchenLog(k, { kind: "proposal", pid, memo: `${p.name} put "${x.name}" to the owner at ${R.fmt(pr.price)}` });
    return { proposal: pr, kitchen: this.kitchenView(k, p, role) };
  };
  //: A resident owner's answer: on the menu if it tastes good enough and the menu has room, at the
  //: price asked if it is fair (between twice and five times what it costs), or their own.
  W.npcDecide = function (k, pr) {
    const Lb = KR(this).lab, R = this.R;
    const fair = clamp(pr.price, pr.cost * 2.2, pr.cost * 5);
    const accept = pr.taste >= Lb.accept_taste && k.menu.length < Lb.menu_most && !k.menu.some((d) => d.name.toLowerCase() === pr.name.toLowerCase());
    const why = accept ? (fair === pr.price ? "at your price" : `at ${R.fmt(Math.round(fair))}`) : pr.taste < Lb.accept_taste ? "it is not good enough yet" : "the menu is full";
    this.decideProposal(k, pr, accept, Math.round(fair), `${k.owner_name}: ${accept ? `"${pr.name}" goes on the menu ${why}.` : `not "${pr.name}", ${why}.`}`);
  };
  W.decideProposal = function (k, pr, accept, price, text) {
    const R = this.R;
    pr.status = accept ? "accepted" : "declined"; pr.decided = this.now; pr.final_price = accept ? price : null;
    if (accept) {
      const unit = R.money(0.5);
      const d = { id: `dish:${k.id}:${k.menu.length + 1}:${hash32(pr.id) % 1000}`, place: k.id, name: pr.name, build: pr.build, price: Math.max(unit, Math.round(price / unit) * unit),
        stamina: pr.stamina, health: pr.health, taste: pr.taste, kcal: pr.kcal, grams: pr.grams, family: pr.family, by: pr.pid, by_name: pr.by, at: this.now, sold: 0 };
      k.menu.push(d);
      registerDish(R, d);
      const rec = k.staff[pr.pid];
      if (rec) rec.dishes += 1;
    }
    const q = this.players.get(pr.pid);
    if (q) { (q.kitchen_news ||= []).push({ at: this.now, text, place: k.id }); if (q.kitchen_news.length > 8) q.kitchen_news.shift(); }
    this.kitchenLog(k, { kind: "decision", pid: pr.pid, memo: text });
  };
  //: A player owner deciding on a dish put to them.
  W.cmd_kitchen_decide = function (pid, { place, proposal, accept = false, price = null }) {
    const p = this.player(pid), b = this.bizAt(place?.id);
    if (!b || b.owner !== p.account) fail("only the owner decides what goes on the menu");
    const k = this.kitchenAt(b.place), pr = k.proposals.find((x) => x.id === proposal && x.status === "pending");
    if (!pr) fail("that has been decided");
    if (accept && k.menu.length >= KR(this).lab.menu_most) fail("the menu is full");
    const ask = Number.isFinite(+price) && +price > 0 ? Math.round(+price) : pr.price;
    this.decideProposal(k, pr, Boolean(accept), ask, `${p.name}: ${accept ? `"${pr.name}" goes on the menu at ${this.R.fmt(ask)}.` : `not "${pr.name}" for now.`}`);
    return { kitchen: this.kitchenView(k, p, "owner") };
  };
  //: A player tipping the cook who made their meal.
  W.cmd_tip_cook = function (pid, { meal, amount }) {
    const p = this.player(pid), m = (p.meals || []).find((x) => x.id === meal);
    if (!m || m.tipped) fail("no meal to tip for");
    const a = Math.round(+amount || 0);
    if (a <= 0) { m.tipped = true; return {}; }
    const cook = this.players.get(m.cook);
    if (!cook) fail("the cook has gone");
    this.ledger.transfer(p.account, cook.account, a, { kind: "tip", memo: `tip for ${R_name(this, m)}`, at: this.now });
    m.tipped = true;
    const k = this.kitchens.get(m.place);
    if (k) staffRec(k, m.cook).tips += a;
    return { tipped: a, balance: this.ledger.balance(p.account) };
  };
  const R_name = (w, m) => m.dishes.map((d) => w.R.items[d]?.name.toLowerCase() || d).join(", ");

  //: The owner's view of a cook: a warning when the rating falls, and (a resident owner) letting them
  //: go when it falls further. Returns what was said, if anything.
  W.reviewStaff = function (k, pid) {
    const G = KR(this).rating, rec = k.staff[pid], p = this.players.get(pid);
    if (!rec || !p || k.business || rec.served + rec.walkouts < G.after_tickets) return null;
    const rating = ratingOf(this.R, rec);
    const news = (text) => { (p.kitchen_news ||= []).push({ at: this.now, text, place: k.id }); if (p.kitchen_news.length > 8) p.kitchen_news.shift(); return text; };
    if (rating < G.let_go_below && rec.warned && rec.served + rec.walkouts >= (rec.warned_at || 0) + 6 && String(p.job?.place?.id) === k.id) {
      const said = news(`${k.owner_name}: I'm sorry, ${p.name.split(" ")[0]}, it isn't working out. Today was your last shift.`);
      p.let_go = { business: k.name, why: "the kitchen rating", at: this.now };
      if (p.clocked) this.cmd_clock_out(pid);
      p.job = null;
      return said;
    }
    if (rating < G.warn_below && (!rec.warned || rec.served + rec.walkouts >= (rec.warned_at || 0) + 10)) {
      rec.warned += 1; rec.warned_at = rec.served + rec.walkouts;
      const why = rec.comps / Math.max(1, rec.sales) > G.comp_share_ok ? "you're giving too much away" : rec.waste / Math.max(1, rec.sales) > G.waste_share_ok ? "too much is going in the bin"
        : rec.walkouts > rec.served * 0.2 ? "customers are walking out" : "the plates are coming back";
      return news(`${k.owner_name}: a word, ${p.name.split(" ")[0]}: ${why}. Your rating is ${rating}.`);
    }
    return null;
  };
  //: Clocking out leaves nothing on your board: what was taken and not used goes back if it was
  //: untouched (the page says which) or in the bin.
  const clockOut = W.cmd_clock_out;
  W.cmd_clock_out = function (pid, ...rest) {
    const p = this.players.get(pid);
    if (p) for (const k of this.kitchens.values()) {
      const board=k.boards?.[pid];
      if(board){
        const left=[...Object.values(board.lots), ...Object.values(board.jobs).flatMap(j=>j.inputs)];
        const cost=left.reduce((sum,c)=>sum+ingCost(this.R,c.ing,c.qty),0);
        if(cost){staffRec(k,pid).waste+=cost;book(this,k,"waste",cost);}
        delete k.boards[pid];
      }
      const held = k.held[pid];
      if (held && Object.keys(held).length) { addTo(k.pantry, held); k.held[pid] = {}; this.syncStock(k); }
      if (k.lines[pid]) { for (const t of k.lines[pid].tickets) this.npcCook(k, t); delete k.lines[pid]; }
    }
    return clockOut.call(this, pid, ...rest);
  };
}
