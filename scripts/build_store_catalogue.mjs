// Everything in the living city that can be bought, in one list: the shops' items (what each costs,
// its tax class, which kinds of shop sell it, and what it is drawn with), the cars, homes and
// storefronts, the services, the licences a business buys and the ingredients a kitchen buys
// wholesale -- and, for the stores a player walks through, a survey of the staples a US grocery
// and a corner store carry against what the city has, with each store item's aisle and how it is
// displayed (the first data for aisle, stacking and display logic: docs/52-store-catalogue.md).
//
//   node scripts/build_store_catalogue.mjs        -> docs/city/catalogue.json
//
// It reads docs/city/rules.json and docs/city/objects.json only; nothing here is invented that the
// rules do not say, except the aisle and display of each store item and the staples list, which
// are this file's (below).

import { readFileSync, writeFileSync } from "node:fs";

const R = JSON.parse(readFileSync(new URL("../docs/city/rules.json", import.meta.url)));
const O = JSON.parse(readFileSync(new URL("../docs/city/objects.json", import.meta.url)));
const items = Object.fromEntries(Object.entries(R.items).filter(([k]) => k !== "basis"));
const kinds = Object.fromEntries(Object.entries(R.stores.kinds));

//: Aisles a walk-in store is laid out by, and what is in each. ``display``: how a shelf holds it --
//: stack (boxes and cans in columns, faces out), row (bottles and jars side by side, one deep row
//: behind another), bin (loose produce heaped), cooler / freezer (behind glass doors, in rows),
//: peg (hung from hooks: cards of batteries, razors), floor (heavy or big: on the bottom shelf or a
//: pallet), rack (magazines, papers), counter (behind or at the till).
const AISLES = {
  produce: { display: "bin", items: ["apple", "bananas", "oranges", "lemons", "limes", "avocados", "tomatoes", "onions", "potatoes", "carrots", "lettuce", "pears", "strawberries", "grapes", "garlic", "bell_peppers", "cucumbers", "vegetables"] },
  bakery: { display: "row", items: ["bread", "tortillas", "hamburger_buns", "bagel", "pastry", "donut", "cake"] },
  dairy: { display: "cooler", items: ["milk", "eggs", "cheese", "butter", "cream_cheese", "sour_cream", "half_and_half", "yogurt", "orange_juice"] },
  meat_seafood: { display: "cooler", items: ["chicken_breast", "ground_beef", "bacon", "deli_meat", "hot_dogs", "fresh_fish"] },
  frozen: { display: "freezer", items: ["frozen_pizza", "ice_cream_tub", "ice_cream_bar", "frozen_vegetables", "frozen_meals", "bag_of_ice"] },
  breakfast: { display: "stack", items: ["cereal", "oatmeal", "coffee_beans", "instant_coffee", "tea_box", "hot_cocoa", "peanut_butter", "jam", "honey", "pancake_mix", "maple_syrup"] },
  pantry: { display: "stack", items: ["dry_pasta", "rice", "flour", "sugar", "salt", "cooking_oil", "canned_soup", "canned_beans", "canned_tuna", "canned_tomatoes", "pasta_sauce", "broth", "black_pepper", "baking_soda", "instant_noodles"] },
  condiments: { display: "row", items: ["ketchup", "mustard", "mayonnaise", "hot_sauce", "soy_sauce", "salad_dressing", "vinegar"] },
  snacks: { display: "stack", items: ["chips", "crackers", "cookies", "candy_bar", "snack_bar", "nuts", "pretzels", "popcorn", "gum"] },
  drinks: { display: "cooler", items: ["water", "sparkling_water", "soda", "iced_tea", "sports_drink", "energy_drink", "juice_box", "protein_shake"] },
  alcohol: { display: "row", items: ["six_pack", "beer", "wine_bottle", "spirits"] },
  household: { display: "stack", items: ["toilet_paper", "paper_towels", "tissues", "dish_soap", "laundry_detergent", "sponges", "bleach", "aluminium_foil", "plastic_wrap", "zip_bags", "trash_bag", "light_bulbs"] },
  personal_care: { display: "row", items: ["toothpaste", "toothbrush", "bar_soap", "shampoo", "deodorant", "razor", "sunscreen", "feminine_care", "diapers"] },
  pets: { display: "stack", items: ["cat_food", "dog_food", "pet_treats"] },
  pharmacy: { display: "row", items: ["pain_relief", "cold_medicine", "vitamins", "bandage", "first_aid_kit", "prescription", "reading_glasses"] },
  checkout: { display: "counter", items: ["batteries", "lighter", "phone_charger", "newspaper", "magazine", "greeting_card", "grocery_tote"] },
};
//: An item displayed otherwise than its aisle's way.
const DISPLAY = {
  bread: "stack", tortillas: "stack", orange_juice: "cooler", cooking_oil: "row", honey: "row", jam: "row", peanut_butter: "row",
  instant_coffee: "row", laundry_detergent: "floor", bleach: "floor", toilet_paper: "floor", paper_towels: "floor", bag_of_ice: "freezer",
  batteries: "peg", razor: "peg", phone_charger: "peg", lighter: "counter", newspaper: "rack", magazine: "rack", greeting_card: "rack",
  six_pack: "cooler", beer: "cooler", maple_syrup: "row", pasta_sauce: "row", diapers: "floor", juice_box: "stack", grocery_tote: "peg", vegetables: "bin", gum: "counter", candy_bar: "counter",
};

//: Staples a US grocery carries (and a corner store, the ``corner`` ones), by aisle: a common
//: shopping list, not a store's full range. The survey is what the city has of them.
const STAPLES = {
  produce: [["apple", 1], ["bananas", 1], ["oranges", 0], ["lemons", 1], ["limes", 1], ["avocados", 1], ["tomatoes", 0], ["onions", 1], ["potatoes", 0], ["carrots", 0], ["lettuce", 0], ["strawberries", 0], ["garlic", 0], ["grapes", 0], ["bell_peppers", 0], ["cucumbers", 0]],
  bakery: [["bread", 1], ["tortillas", 1], ["bagel", 0], ["hamburger_buns", 0]],
  dairy: [["milk", 1], ["eggs", 1], ["cheese", 1], ["butter", 1], ["yogurt", 1], ["cream_cheese", 0], ["orange_juice", 1], ["sour_cream", 0], ["half_and_half", 0]],
  meat_seafood: [["chicken_breast", 0], ["ground_beef", 0], ["bacon", 0], ["fresh_fish", 0], ["deli_meat", 0], ["hot_dogs", 1]],
  frozen: [["frozen_pizza", 1], ["ice_cream_tub", 1], ["frozen_vegetables", 0], ["bag_of_ice", 1], ["frozen_meals", 1]],
  breakfast: [["cereal", 1], ["oatmeal", 0], ["coffee_beans", 1], ["instant_coffee", 1], ["tea_box", 1], ["peanut_butter", 1], ["jam", 1], ["honey", 0], ["pancake_mix", 0], ["maple_syrup", 0]],
  pantry: [["dry_pasta", 1], ["rice", 1], ["flour", 0], ["sugar", 1], ["salt", 1], ["black_pepper", 0], ["cooking_oil", 1], ["canned_soup", 1], ["canned_beans", 1], ["canned_tuna", 1], ["canned_tomatoes", 0], ["pasta_sauce", 0], ["instant_noodles", 1], ["broth", 0], ["baking_soda", 0]],
  condiments: [["ketchup", 1], ["mustard", 1], ["mayonnaise", 1], ["hot_sauce", 1], ["soy_sauce", 0], ["salad_dressing", 0], ["vinegar", 0]],
  snacks: [["chips", 1], ["crackers", 1], ["cookies", 1], ["candy_bar", 1], ["snack_bar", 1], ["gum", 1], ["nuts", 1], ["popcorn", 0], ["pretzels", 0]],
  drinks: [["water", 1], ["sparkling_water", 1], ["soda", 1], ["iced_tea", 1], ["sports_drink", 1], ["energy_drink", 1], ["juice_box", 0]],
  alcohol: [["six_pack", 1], ["wine_bottle", 1], ["spirits", 1]],
  household: [["toilet_paper", 1], ["paper_towels", 1], ["tissues", 1], ["dish_soap", 1], ["laundry_detergent", 1], ["sponges", 1], ["bleach", 0], ["aluminium_foil", 1], ["trash_bag", 1], ["light_bulbs", 1], ["plastic_wrap", 0], ["zip_bags", 0]],
  personal_care: [["toothpaste", 1], ["toothbrush", 1], ["bar_soap", 1], ["shampoo", 1], ["deodorant", 1], ["razor", 1], ["sunscreen", 0], ["feminine_care", 1], ["diapers", 0]],
  pharmacy: [["pain_relief", 1], ["cold_medicine", 1], ["vitamins", 0], ["bandage", 1]],
  pets: [["dog_food", 0], ["cat_food", 1], ["pet_treats", 0]],
};

// ---- the items ------------------------------------------------------------------------------------
const sellers = {};
for (const [k, s] of Object.entries(kinds)) if (k !== "basis" && s.items) for (const id of s.items) (sellers[id] ||= []).push(k);
const aisleOf = {};
for (const [a, v] of Object.entries(AISLES)) for (const id of v.items) aisleOf[id] ||= a;
//: What an item is drawn with: the model, its source and how good a match it is.
function model(id) {
  const b = O.items?.[id];
  if (!b) return { status: "none", note: "not in the object manifest: the page draws it" };
  const asset = b.asset ? O.assets[b.asset] : null;
  const parts = b.recipe ? [...new Set([b.recipe.base?.asset, ...b.recipe.parts.map((p) => p.asset)].filter(Boolean))] : [];
  const providers = [...new Set((asset ? [asset] : parts.map((p) => O.assets[p]).filter(Boolean)).map((a) => a.provider))];
  return {
    status: b.status, asset: b.asset || null, parts: parts.length ? parts : undefined, variants: b.variants,
    providers, license: asset?.license || (parts.length ? [...new Set(parts.map((p) => O.assets[p]?.license))].join(" + ") : null),
    source_kind: b.source_kind, tint: b.tint,
    drawn: Boolean((b.asset && asset) || b.recipe),
    // A model that is the product as a shopper would know it: an import, a scan, the lab's fit match.
    recognisable: b.status === "imported" || b.status === "representative" || b.status === "generic_match",
  };
}
const catItems = Object.entries(items).map(([id, it]) => ({
  id, name: it.name, price: it.price, kind: it.kind, service: Boolean(it.service || it.kind === "service"),
  sold_at: (sellers[id] || []).sort(), aisle: aisleOf[id] || null, display: aisleOf[id] ? (DISPLAY[id] || AISLES[aisleOf[id]].display) : null,
  kg: it.kg, length_m: it.length_m, adult: it.adult || undefined, device: it.device || undefined, container: it.container ? true : undefined,
  model: model(id),
}));

// ---- the rest that is bought ----------------------------------------------------------------------
const share = R.vehicles.used_share_by_age;
const vehicles = Object.entries(R.vehicles.models).map(([id, v]) => ({ id, name: v.name, new_price: v.price, kind: v.kind, fuel: v.fuel, seats: v.seats, used_5y: Math.round(v.price * (share.find((s) => s[0] === 5)?.[1] || 1)), model: "the fleet (docs/city/fleet.json, scripts/build_city_fleet.mjs): skipped here" }));
const homes = {
  basis: R.real_estate.basis, per_m2: R.real_estate.per_m2, county_scale: R.real_estate.county_scale, rent_yield: R.real_estate.rent_yield,
  example: { a_90_m2_home_in_sf: Math.round(90 * R.real_estate.per_m2.residential), its_monthly_rent: Math.round((90 * R.real_estate.per_m2.residential * R.real_estate.rent_yield) / 12) },
  model: "the building itself (the region's houses and their inferred interiors): skipped here",
};
const business = {
  storefront_lease_per_week: R.business.storefront_lease_per_week, lease_deposit_weeks: R.business.lease_deposit_weeks,
  licences: Object.entries(R.business.licences).filter(([k]) => k !== "basis").map(([id, l]) => ({ id, name: l.name, fee_base: l.fee_base, for: l.for })),
};
const ingredients = Object.entries(R.kitchen.ingredients).map(([id, g]) => ({ id, name: g.name, unit: g.unit, cost: g.cost, kept: g.kept }));

// ---- the survey -----------------------------------------------------------------------------------
const survey = {};
for (const [aisle, list] of Object.entries(STAPLES)) {
  survey[aisle] = list.map(([id, corner]) => {
    const it = items[id], m = it ? model(id) : null;
    return {
      id, corner_store: Boolean(corner), in_city: Boolean(it),
      grocery: Boolean(it && sellers[id]?.includes("grocery")), corner: Boolean(it && sellers[id]?.includes("convenience")),
      model: m ? (m.status === "imported" ? "imported" : m.drawn ? (m.tint ? "labelled stand-in" : "kit model") : "none") : "missing item",
    };
  });
}
const flat = Object.values(survey).flat();
const count = (f) => flat.filter(f).length;
const summary = {
  staples: flat.length,
  in_city: count((s) => s.in_city), at_grocery: count((s) => s.grocery),
  corner_staples: count((s) => s.corner_store), at_corner_store: count((s) => s.corner_store && s.corner),
  imported_model: count((s) => s.model === "imported"), other_model: count((s) => s.model === "kit model" || s.model === "labelled stand-in"),
  needed_items: flat.filter((s) => !s.in_city).map((s) => s.id),
  needed_models: flat.filter((s) => s.in_city && s.model !== "imported").map((s) => `${s.id} (${s.model})`),
};

const store = Object.values(catItems).filter((i) => i.aisle);
const out = {
  schema: "kerbside.city_catalogue/1",
  basis: "scripts/build_store_catalogue.mjs from docs/city/rules.json and docs/city/objects.json: everything that can be bought in the living city. Aisles, displays and the staples list are the script's own (docs/52-store-catalogue.md).",
  counts: {
    items: catItems.length, goods: catItems.filter((i) => !i.service).length, services: catItems.filter((i) => i.service).length,
    sold_somewhere: catItems.filter((i) => i.sold_at.length).length, drawn_with_model: catItems.filter((i) => i.model.drawn).length,
    imported: catItems.filter((i) => i.model.status === "imported").length, store_items_with_aisle: store.length,
    store_items_imported: store.filter((i) => i.model.status === "imported").length,
    vehicles: vehicles.length, licences: business.licences.length, kitchen_ingredients: ingredients.length, fixtures: Object.keys(R.fixtures || {}).filter((k) => k !== "basis").length,
  },
  aisles: Object.fromEntries(Object.entries(AISLES).map(([a, v]) => [a, { display: v.display, items: v.items.filter((id) => items[id]) }])),
  items: catItems,
  fixtures: Object.fromEntries(Object.entries(R.fixtures || {}).filter(([k]) => k !== "basis").map(([k, f]) => [k, { ...f, model: (O.items?.[k] || O.fixtures?.[k])?.asset || null }])),
  vehicles, homes, business, kitchen_ingredients: ingredients,
  grocery_survey: { summary, by_aisle: survey },
};
writeFileSync(new URL("../docs/city/catalogue.json", import.meta.url), `${JSON.stringify(out, null, 1)}\n`);
console.log(JSON.stringify(out.counts));
console.log(JSON.stringify(summary));
