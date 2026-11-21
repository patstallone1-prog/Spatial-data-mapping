// The aisles a walk-in store is laid out by and how each thing is displayed on them: the one map
// the catalogue (scripts/build_store_catalogue.mjs -> catalogue.json) and the shop rooms
// (store-room.mjs, shelf-stock.mjs) share. Spices are every rules item ``jar_*`` with an
// ingredient (the kitchen's shakes), filled in by aisleMap().

//: Aisles a walk-in store is laid out by, and what is in each. ``display``: how a shelf holds it --
//: stack (boxes and cans in columns, faces out), row (bottles and jars side by side, one deep row
//: behind another), bin (loose produce heaped), cooler / freezer (behind glass doors, in rows),
//: peg (hung from hooks: cards of batteries, razors), floor (heavy or big: on the bottom shelf or a
//: pallet), rack (magazines, papers), counter (behind or at the till).
export const AISLES = {
  produce: { display: "bin", items: ["apple", "bananas", "oranges", "lemons", "limes", "avocados", "tomatoes", "onions", "potatoes", "carrots", "lettuce", "pears", "strawberries", "grapes", "garlic", "bell_peppers", "cucumbers", "vegetables"] },
  bakery: { display: "row", items: ["bread", "tortillas", "hamburger_buns", "bagel", "pastry", "donut", "cake"] },
  dairy: { display: "cooler", items: ["milk", "eggs", "cheese", "butter", "cream_cheese", "sour_cream", "half_and_half", "yogurt", "orange_juice"] },
  meat_seafood: { display: "cooler", items: ["chicken_breast", "ground_beef", "bacon", "deli_meat", "hot_dogs", "fresh_fish"] },
  frozen: { display: "freezer", items: ["frozen_pizza", "ice_cream_tub", "ice_cream_bar", "frozen_vegetables", "frozen_meals", "bag_of_ice"] },
  breakfast: { display: "stack", items: ["cereal", "oatmeal", "coffee_beans", "instant_coffee", "tea_box", "hot_cocoa", "peanut_butter", "jam", "honey", "pancake_mix", "maple_syrup"] },
  pantry: { display: "stack", items: ["dry_pasta", "rice", "flour", "sugar", "cooking_oil", "canned_soup", "canned_beans", "canned_tuna", "canned_tomatoes", "pasta_sauce", "broth", "baking_soda", "instant_noodles"] },
  //: Salt, pepper and the spice jars (rules items jar_*), filled in from rules.json below.
  spices: { display: "row", items: [] },
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
export const DISPLAY = {
  bread: "stack", tortillas: "stack", orange_juice: "cooler", cooking_oil: "row", honey: "row", jam: "row", peanut_butter: "row",
  instant_coffee: "row", laundry_detergent: "floor", bleach: "floor", toilet_paper: "floor", paper_towels: "floor", bag_of_ice: "freezer",
  batteries: "peg", razor: "peg", phone_charger: "peg", lighter: "counter", newspaper: "rack", magazine: "rack", greeting_card: "rack",
  six_pack: "cooler", beer: "cooler", maple_syrup: "row", pasta_sauce: "row", diapers: "floor", juice_box: "stack", grocery_tote: "peg", vegetables: "bin", gum: "counter", candy_bar: "counter",
};


//: { aisle by item, display by item } for the rules ``R`` (spices from its jar_* items).
export function aisleMap(R) {
  const aisles = Object.fromEntries(Object.entries(AISLES).map(([a, v]) => [a, { ...v, items: v.items.slice() }]));
  aisles.spices.items = Object.keys(R.items).filter((id) => id.startsWith("jar_") && R.items[id].ingredient);
  const aisleOf = {}, displayOf = {};
  for (const [a, v] of Object.entries(aisles)) for (const id of v.items) if (!aisleOf[id]) { aisleOf[id] = a; displayOf[id] = DISPLAY[id] || v.display; }
  return { aisles, aisleOf, displayOf };
}
