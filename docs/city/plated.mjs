// The dish as the cook made it, not as the recipe says (dish-models.mjs draws it): the plate's
// components in the order they went on -- what the kitchen game serves (kitchen.mjs plateOf and
// cmd_kitchen_serve's plate: {ing, qty, p, q, ratio, ratios}) -- read against the recipe it was
// meant to be, by the same matching and the same doneness the kitchen scores it with
// (kitchen.mjs scorePlate, doneness). So what went wrong shows:
//
//  * burnt or overdone: the browning goes on past golden to dark and then to char;
//  * raw or underdone: meat stays pink and wet, bread pale, batter runny;
//  * missing: not drawn;
//  * not in the recipe: drawn on top, where the cook put it;
//  * a different process (the potato boiled, not fried): drawn as that process makes it;
//  * the wrong amount: a bigger or smaller portion;
//  * the wrong order (a stacked dish): stacked the way it was built -- the patty under the bun.
//
// Pure, apart from the material tint, which takes three.js's material (tests/city_plated.test.mjs).

import { chain, doneness, donenessWord, ingredient, part, recipeOf } from "./kitchen.mjs";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

//: Which of the food materials (dish-models.mjs foodLook keys) each ingredient is drawn with: its
//: cooked state is put on them.
export const LOOK_OF = {
  bun: ["bun", "bun_cut"], bread: ["bread", "crust", "toast"], baguette: ["crust", "bread"], bagel: ["bagel", "bread"], tortilla: ["tortilla"], pita: ["tortilla", "naan"],
  pizza_dough: ["pizza_crust", "crust"], pizza_slice_baked: ["pizza_crust", "pizza_top"], naan_dough: ["naan"], pastry_dough: ["croissant"], dumpling_wrappers: ["dumpling"],
  flour: ["batter", "pancake", "pancake_edge", "dough_fried", "sponge"], potato: ["fries", "roast_potato"], rice: ["rice", "fried_rice", "sushi_rice"],
  noodles: ["noodles"], rice_noodles: ["rice_noodles"], ramen_noodles: ["noodles"], pasta: ["pasta"], arborio: ["risotto"],
  beef_patty: ["patty", "seared", "cut_meat"], steak: ["seared", "cut_meat"], lamb: ["seared", "cut_meat", "lamb"], chicken: ["chicken", "chicken_meat", "chicken_bits", "teriyaki_chicken"],
  chicken_half: ["chicken", "chicken_meat"], chicken_wings: ["wing"], pork: ["pork", "chashu"], bacon: ["bacon"], ham: ["cut_meat"], beef_slices: ["beef_slice", "beef_raw"],
  fish_fillet: ["batter", "chicken_meat"], salmon: ["salmon"], tuna: ["tuna"], shrimp: ["shrimp"], tofu: ["tofu"], egg: ["egg_white", "yolk", "half_egg"], crab: ["crab"],
  cheese: ["cheese"], mozzarella: ["mozzarella", "pizza_top"], chickpeas: ["falafel"], broccoli: ["broccoli", "broccoli_stem"], onion: ["onion"], mushroom: ["mushroom"],
  bell_pepper: ["pepper_red", "pepper_green"], garlic: ["garlic"], carrot: ["carrot"],
};

//: A surface that only cooking makes, and what is there instead when it was hardly cooked: no
//: grill marks or crust on a raw steak, no toast on bread that never saw the toaster.
export const RAW_SURFACE = { seared: "beef_raw", patty: "beef_raw", chicken: "chicken_meat", teriyaki_chicken: "chicken_meat", toast: "bread", crust: "bread",
  bun: "bun_cut", bacon: "ham_raw", chashu: "beef_raw", dough_fried: "batter", wing: "chicken_meat" };

//: How each kind of thing looks raw and burnt (a colour to go toward); browning darkens toward
//: the burnt colour, rawness toward the raw one.
const RAW = { protein: 0xd77a7a, starch: 0xf3ead2, veg: null, dairy: null };
const BURNT = 0x1d1410;
//: Ingredients whose rawness is pink (meat), not pale.
const PINK = new Set(["beef_patty", "steak", "lamb", "beef_slices", "pork", "bacon", "chicken", "chicken_half", "chicken_wings"]);

//: How a component came out: the doneness the kitchen gives it (q), the word for it, and how far
//: it is browned past right (0 none -> 1 char) or short of done (0 done -> 1 raw).
export function stateOf(R, c) {
  const steps = chain(c.p), heat = steps.map((s, i) => [s, i]).filter(([s]) => R.kitchen.heat.includes(s));
  if (!heat.length) return { q: 1, word: "as it comes", burnt: 0, raw: 0, heat: false };
  // The last time it was on the heat is what it looks like (fried after boiling: fried).
  const [step, i] = heat.at(-1);
  const ratio = c.ratios?.[i] ?? (i === steps.length - 1 ? c.ratio : null) ?? (c.q != null && c.q < 0.95 ? null : 1);
  const D = R.kitchen.doneness;
  if (ratio == null) {
    // Only a quality: read the word from it (a low one could be either; take it as overdone).
    const q = clamp(+c.q || 0, 0, 1);
    return { q, word: q >= 0.95 ? "just right" : q < 0.3 ? "burnt" : "overdone", burnt: q >= 0.95 ? 0 : clamp((1 - q) / 0.7, 0, 1), raw: 0, heat: true, step };
  }
  const q = doneness(R, ratio, step);
  const burnt = ratio <= D.right[1] ? 0 : clamp((ratio - D.right[1]) / (D.burnt_above - D.right[1]), 0, 1) * 0.75 + clamp((ratio - D.burnt_above) / 0.6, 0, 1) * 0.25;
  const raw = ratio >= D.right[0] ? 0 : clamp((D.right[0] - ratio) / D.right[0], 0, 1);
  return { q, word: donenessWord(q, ratio), burnt, raw, heat: true, step, ratio };
}

//: The plate as made, against ``dish`` (a house recipe or a menu's): { target, build (what to
//: draw, in recipe form, in the order it went on), states (ing -> stateOf), missing, extra,
//: changed (same ingredient, another process), portions (ing -> made qty / asked qty), misordered,
//: order (the made order of the recipe's stacked parts), notes }. ``plate`` null: as the recipe.
export function madeFrom(R, dish, plate, { menu = [] } = {}) {
  const target = recipeOf(R, dish, menu);
  if (!target) return null;
  const want = target.build.map((c, i) => ({ ...part(c), i }));
  const got = (plate || want).map((c, j) => ({ ...part(c), q: c.q, ratio: c.ratio, ratios: c.ratios, j }));
  const used = new Set(), pairs = [];
  for (const w of want) {
    let best = null, bs = -Infinity;
    for (const g of got) {
      if (used.has(g.j) || g.ing !== w.ing) continue;
      const s = (g.p === w.p ? 2 : 0) + (chain(g.p).at(-1) === chain(w.p).at(-1) ? 1 : 0) - Math.abs(g.qty - w.qty) * 0.1;
      if (s > bs) { bs = s; best = g; }
    }
    if (best) { used.add(best.j); pairs.push([w, best]); }
  }
  const missing = want.filter((w) => !pairs.some(([x]) => x === w)).map((w) => w.ing);
  const extra = got.filter((g) => !used.has(g.j)).map((g) => g.ing);
  const changed = pairs.filter(([w, g]) => chain(g.p).at(-1) !== chain(w.p).at(-1)).map(([w, g]) => ({ ing: w.ing, want: w.p, made: g.p }));
  const states = {}, portions = {};
  for (const g of got) {
    const s = stateOf(R, g), was = states[g.ing];
    // Two lots of one thing: it looks as the worse of them.
    if (!was || s.q < was.q) states[g.ing] = s;
  }
  for (const [w, g] of pairs) portions[w.ing] = g.qty / Math.max(w.qty, 1e-9);
  // The stacked order: the recipe's own parts (not its sides), by when each went on.
  const stacked = pairs.filter(([w]) => !w.side).sort((a, b) => a[1].j - b[1].j);
  const order = stacked.map(([w]) => w.ing);
  const misordered = Boolean(target.ordered) && stacked.some(([w], k) => k > 0 && w.i < stacked[k - 1][0].i);
  const notes = [];
  for (const [ing, s] of Object.entries(states)) if (s.heat && s.q < 0.95) notes.push(`${ingredient(R, ing)?.name.toLowerCase() || ing} ${s.word}`);
  for (const m of missing) notes.push(`no ${ingredient(R, m)?.name.toLowerCase() || m}`);
  for (const e of extra) notes.push(`${ingredient(R, e)?.name.toLowerCase() || e} added`);
  for (const c of changed) notes.push(`${ingredient(R, c.ing)?.name.toLowerCase() || c.ing} ${chain(c.made).at(-1) || "raw"} instead`);
  if (misordered) notes.push("stacked in the wrong order");
  // What to draw: what is on the plate, in the order it went on, in the recipe's own form.
  const build = got.map((g) => ({ ing: g.ing, qty: g.qty, p: g.p, side: Boolean(want.find((w) => w.ing === g.ing)?.side) }));
  return { dish, target: { vessel: target.vessel, ordered: Boolean(target.ordered), build: want.map(({ i, ...c }) => c) }, build, states, missing, extra, changed, portions, misordered, order, notes };
}

//: The state of the ingredient a food material belongs to (null when it is as it should be).
export function lookState(made, key) {
  if (!made) return null;
  for (const [ing, keys] of Object.entries(LOOK_OF)) {
    if (!keys.includes(key)) continue;
    const s = made.states[ing];
    if (s && (s.burnt > 0.02 || s.raw > 0.02)) return { ing, ...s };
  }
  return null;
}

//: A material tinted to a state: browned on toward char, or left raw (pink meat, pale dough). The
//: material is cloned; ``THREE`` gives its colour type.
export function tinted(THREE, material, st, R) {
  const m = material.clone();
  const role = ingredient(R, st.ing)?.role;
  const col = m.color ? m.color.clone() : new THREE.Color(0xffffff);
  if (st.burnt > 0) {
    // Browning first deepens the colour, then it chars: dark, dry and dull.
    const k = st.burnt;
    col.lerp(new THREE.Color(0x6b3a17), clamp(k * 1.6, 0, 1) * 0.55).lerp(new THREE.Color(BURNT), clamp((k - 0.45) / 0.55, 0, 1) * 0.92);
    if ("roughness" in m) m.roughness = Math.min(1, (m.roughness ?? 0.6) + 0.35 * k);
    if ("clearcoat" in m) m.clearcoat = (m.clearcoat ?? 0) * (1 - k);
  } else if (st.raw > 0) {
    const toward = PINK.has(st.ing) ? 0xd06b6b : RAW[role] ?? null;
    if (toward != null) col.lerp(new THREE.Color(toward), clamp(st.raw * 1.2, 0, 0.85));
    if (PINK.has(st.ing) && "clearcoat" in m) { m.clearcoat = Math.max(m.clearcoat ?? 0, 0.6 * st.raw); m.clearcoatRoughness = 0.2; }
  }
  // A texture's colours multiply the colour: set it so the map is darkened (or paled) as well.
  m.color = col;
  m.name = `${material.name || "food"}:${st.word}`;
  return m;
}

//: How an ingredient the recipe does not have is drawn on the plate: { shape: "dollop" | "bits" |
//: "slab" | "leaves" | "piece", colour } by what it is.
const EXTRA_COLOUR = { ketchup: 0xb3201a, mustard: 0xd9a21b, mayo: 0xf3ecd2, hot_sauce: 0xc1371b, bbq_sauce: 0x5a210f, salsa: 0xc8452a, soy_sauce: 0x2a1408, tahini: 0xdcc8a0,
  gochujang: 0xa8241a, tartar_sauce: 0xece3c5, teriyaki_sauce: 0x4a230e, tomato_sauce: 0xb7301e, olive_oil: 0xc9b13c, maple_syrup: 0x8a4a0c, chocolate_syrup: 0x3a1c0d,
  pickles: 0x7d9a3a, lettuce: 0x6aa83a, tomato: 0xc8261b, onion: 0xf1ead8, cucumber: 0x7fae5a, carrot: 0xee7f1e, chili: 0xc8261b, avocado: 0x8fb04a, spinach: 0x2f6a24,
  cheese: 0xf4c542, mozzarella: 0xf6efd9, parmesan: 0xf1e3b0, butter: 0xf5df7a, sour_cream: 0xf6f1e4, cream: 0xfbf7ec, cream_cheese: 0xf7f1e2, egg: 0xf7f3e8,
  bacon: 0x9a3b22, ham: 0xe39a96, chicken: 0xe9c48a, steak: 0x5a2a16, pork: 0xb07a52, shrimp: 0xf0845e, tofu: 0xf1e8cf, banana: 0xf3d36b, berries: 0x5a1f4a, lime: 0x5d9a2e, lemon: 0xf2cf2a,
  basil: 0x2f7d2a, cilantro: 0x3a8a2e, scallion: 0x5ea23a, peanuts: 0xc08f50, sugar: 0xfbfaf6, ice_cream: 0xf6ecd0 };
export function extraLook(R, ing) {
  const I = ingredient(R, ing), role = I?.role;
  const colour = EXTRA_COLOUR[ing] ?? { sauce: 0x8a4a2a, veg: 0x5e9a3a, herb: 0x2f7d2a, fruit: 0xe0a030, dairy: 0xf3e9c8, protein: 0xb57a4a, starch: 0xe6cf98, sweet: 0xf0e6d0, spice: 0x8a5a2a, drink: 0xa0c0d0 }[role] ?? 0x999999;
  const shape = role === "sauce" || ing === "maple_syrup" || ing === "chocolate_syrup" ? "dollop"
    : role === "spice" || ing === "sugar" || ing === "sesame_seeds" ? "dust"
      : role === "herb" ? "leaves" : role === "veg" || role === "fruit" ? "bits" : role === "protein" ? "slab" : "piece";
  return { shape, colour, name: I?.name || ing };
}
