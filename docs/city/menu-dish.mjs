// A real menu's dish, cooked in the game: the food algorithm run backwards.
//
// The kitchen (docs/city/kitchen.mjs) goes forwards: from what is on the plate and how each part
// was cooked to what it tastes of, what it does for the bars and what it is worth (tasteOf). A
// menu goes the other way: a name ("Classic burger"), sometimes what is in it ("lettuce, tomato,
// onion, house sauce, brioche bun") and a price. dishFromMenu reads those back into a build the
// kitchen can cook: the nearest house recipe as the shape of it, the ingredients the menu names
// put in (a chicken burger's chicken in place of the beef), the ones it leaves out of an explicit
// list left out, each cooked the way the menu says ("crispy", "grilled", "roasted") or the way the
// house recipes cook it, sauces the game has no single ingredient for made up from what it has
// (aioli is mayonnaise and garlic, guacamole avocado, lime, onion and coriander), and the result
// tasted with tasteOf for its profile. Every guess is written down (``basis``) so a dish can be
// read back.
//
// It is the real recipe that is rebuilt, not one fitted to the game: a dish is seasoned as such
// a dish is seasoned (a burger's patty with salt and pepper, a shawarma's lamb with cumin,
// coriander, paprika, turmeric and cinnamon), in shakes of each spice, every spice the menu names
// is that spice, and a process the kitchen has no station for is still the process -- the
// kitchen gets the station (kitchen.mjs stationsNeeded), as the real restaurant has it.
//
// cookingSteps turns any build into the steps a cook follows at a kitchen's own stations: the
// longest things on the heat first, the chopping while they cook, the plate built in order.
//
// Pure (tests/city_menu_dish.test.mjs).

import { chain, ingredient, part, processSeconds, recipeOf, stationsFor, tasteOf } from "./kitchen.mjs";

// Lower case, accents off, punctuation gone but for commas (which separate what a menu lists).
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[;/|\u2022\u00b7]+/g, ",").replace(/[^a-z0-9', ]+/g, " ")
  .replace(/\s*,\s*/g, " , ").replace(/\s+/g, " ").trim();

//: Words for each ingredient beyond its own name (singular; a plural is read as its singular).
export const INGREDIENT_WORDS = {
  bun: ["bun", "brioche", "brioche bun", "potato bun", "sesame bun", "roll"],
  bread: ["bread", "toast", "sourdough", "rye", "wheat bread", "multigrain", "ciabatta", "focaccia", "slice of bread"],
  baguette: ["baguette", "french roll", "hoagie"],
  bagel: ["bagel"],
  tortilla: ["tortilla", "flour tortilla", "corn tortilla", "wrap"],
  pita: ["pita", "pitta", "flatbread", "lavash"],
  pizza_dough: ["pizza dough", "crust", "neapolitan"],
  naan_dough: ["naan", "garlic naan"],
  pastry_dough: ["pastry", "puff pastry", "croissant", "pie crust"],
  dumpling_wrappers: ["dumpling", "gyoza", "potsticker", "wonton", "dim sum", "bao"],
  pasta: ["pasta", "spaghetti", "linguine", "fettuccine", "penne", "rigatoni", "pappardelle", "tagliatelle", "gnocchi", "ravioli", "lasagna", "lasagne", "orecchiette", "bucatini", "macaroni", "mac"],
  arborio: ["risotto", "arborio"],
  rice: ["rice", "jasmine rice", "basmati", "steamed rice", "brown rice", "sushi rice"],
  noodles: ["noodle", "egg noodle", "lo mein", "chow mein", "udon"],
  rice_noodles: ["rice noodle", "vermicelli", "pho noodle", "flat noodle"],
  ramen_noodles: ["ramen"],
  flour: ["batter", "breaded", "tempura", "beer battered", "flour"],
  potato: ["potato", "fries", "frites", "french fries", "chips", "hash brown", "hashbrown", "tots", "tater tots", "mashed potato", "home fries", "wedges"],
  nori: ["nori", "seaweed"],
  beef_patty: ["patty", "beef patty", "burger", "cheeseburger", "hamburger", "smash", "smashburger", "wagyu burger", "angus"],
  steak: ["steak", "ribeye", "rib eye", "new york strip", "strip loin", "sirloin", "filet", "filet mignon", "tenderloin", "flank", "skirt steak", "hanger", "tri tip", "carne asada", "beef"],
  chicken: ["chicken", "chicken breast", "chicken thigh", "poultry", "pollo", "tenders", "nuggets", "katsu"],
  chicken_half: ["half chicken", "rotisserie", "roast chicken"],
  chicken_wings: ["wing", "chicken wing", "buffalo wing"],
  pork: ["pork", "carnitas", "al pastor", "pork belly", "char siu", "chashu", "pulled pork", "pork chop", "tonkatsu", "chorizo", "sausage", "italian sausage"],
  bacon: ["bacon", "pancetta", "guanciale"],
  ham: ["ham", "prosciutto", "capicola"],
  turkey: ["turkey"],
  beef_slices: ["bulgogi", "brisket", "short rib", "galbi", "kalbi", "sliced beef", "rare beef", "beef slices", "pastrami", "corned beef", "meatball"],
  lamb: ["lamb", "gyro", "lamb shank", "lamb chop"],
  shrimp: ["shrimp", "prawn", "camaron", "scampi"],
  fish_fillet: ["fish", "cod", "halibut", "snapper", "sea bass", "branzino", "rockfish", "mahi", "tilapia", "catch"],
  salmon: ["salmon", "lox", "smoked salmon"],
  tuna: ["tuna", "ahi", "poke"],
  oysters: ["oyster"],
  crab: ["crab", "dungeness"],
  clams: ["clam", "mussel", "chowder"],
  tofu: ["tofu", "bean curd"],
  egg: ["egg", "fried egg", "omelette", "omelet", "scrambled", "eggs benedict", "frittata", "quiche"],
  chickpeas: ["chickpea", "garbanzo", "chana", "hummus", "falafel"],
  beans: ["bean", "black bean", "pinto", "refried bean", "frijoles", "lentil", "dal", "dhal"],
  cheese: ["cheese", "cheddar", "american cheese", "swiss", "pepper jack", "jack", "provolone", "gruyere", "monterey jack", "blue cheese", "gorgonzola", "feta", "goat cheese", "queso", "cotija", "brie"],
  mozzarella: ["mozzarella", "burrata", "fior di latte", "bocconcini"],
  parmesan: ["parmesan", "parmigiano", "pecorino", "grana padano", "reggiano"],
  cream_cheese: ["cream cheese", "schmear", "mascarpone", "ricotta"],
  butter: ["butter", "brown butter", "ghee"],
  milk: ["milk", "oat milk", "almond milk", "whole milk"],
  cream: ["cream", "heavy cream", "creme fraiche", "cream sauce", "alfredo", "whipped cream"],
  yogurt: ["yogurt", "yoghurt", "raita", "tzatziki", "labneh"],
  sour_cream: ["sour cream", "crema"],
  ice_cream: ["ice cream", "gelato", "sundae", "soft serve", "a la mode"],
  lettuce: ["lettuce", "romaine", "iceberg", "greens", "mixed greens", "arugula", "rocket", "kale", "spring mix", "butter lettuce", "little gem", "slaw", "coleslaw"],
  tomato: ["tomato", "heirloom tomato", "cherry tomato", "pico de gallo", "pico", "pomodoro"],
  onion: ["onion", "red onion", "pickled onion", "caramelized onion", "shallot", "onion ring"],
  pickles: ["pickle", "pickled", "gherkin", "dill pickle", "cornichon", "olive", "caper"],
  cucumber: ["cucumber"],
  carrot: ["carrot", "daikon"],
  cabbage: ["cabbage", "kimchi", "bok choy", "napa"],
  bell_pepper: ["bell pepper", "pepper", "peppers", "roasted pepper", "poblano", "pimento", "capsicum"],
  chili: ["chili", "chile", "jalapeno", "serrano", "chipotle", "habanero", "thai chili", "fresno", "spicy"],
  mushroom: ["mushroom", "shiitake", "portobello", "porcini", "truffle", "cremini", "enoki"],
  garlic: ["garlic", "roasted garlic", "aioli"],
  ginger: ["ginger"],
  scallion: ["scallion", "green onion", "spring onion", "chive"],
  cilantro: ["cilantro", "coriander"],
  basil: ["basil", "thai basil", "parsley", "mint", "herbs", "fresh oregano", "dill"],
  bean_sprouts: ["bean sprout", "sprout"],
  spinach: ["spinach", "chard", "greens"],
  broccoli: ["broccoli", "broccolini", "asparagus", "green bean", "zucchini", "vegetables", "seasonal vegetables", "brussels sprout", "cauliflower"],
  peas: ["pea", "edamame", "corn"],
  avocado: ["avocado", "guacamole", "guac"],
  lime: ["lime"],
  lemon: ["lemon"],
  peanuts: ["peanut", "cashew", "almond", "walnut", "pistachio", "pine nut", "nut"],
  oranges: ["orange", "citrus", "grapefruit"],
  banana: ["banana"],
  berries: ["berry", "berries", "strawberry", "blueberry", "raspberry", "blackberry", "acai", "fruit"],
  coconut_milk: ["coconut", "coconut milk"],
  ketchup: ["ketchup"],
  mustard: ["mustard", "dijon"],
  mayo: ["mayo", "mayonnaise", "special sauce", "house sauce", "secret sauce", "spread", "remoulade"],
  hot_sauce: ["hot sauce", "buffalo", "sriracha", "harissa", "salsa roja"],
  bbq_sauce: ["bbq", "barbecue", "bbq sauce"],
  salsa: ["salsa", "salsa verde", "pico de gallo"],
  soy_sauce: ["soy", "soy sauce", "teriyaki", "ponzu", "tamari"],
  fish_sauce: ["fish sauce", "nuoc cham", "nam pla"],
  tikka_sauce: ["tikka", "masala", "curry", "korma", "vindaloo", "makhani", "butter chicken"],
  tomato_sauce: ["marinara", "tomato sauce", "red sauce", "arrabbiata", "bolognese", "ragu", "pizza sauce", "vodka sauce", "puttanesca"],
  olive_oil: ["olive oil", "evoo", "vinaigrette", "dressing", "oil"],
  broth: ["broth", "stock", "soup", "consomme", "bisque"],
  ramen_broth: ["tonkotsu", "shoyu", "miso", "ramen broth"],
  tahini: ["tahini", "sesame paste"],
  gochujang: ["gochujang", "korean chili"],
  tartar_sauce: ["tartar", "tartare sauce"],
  wasabi: ["wasabi"],
  maple_syrup: ["maple", "syrup"],
  chocolate: ["chocolate", "cocoa", "fudge", "brownie"],
  chocolate_syrup: ["chocolate sauce", "chocolate syrup"],
  sugar: ["sugar", "caramel", "honey", "sweet"],
  salt: ["salt", "sea salt", "salted", "kosher salt", "flaky salt", "maldon"],
  black_pepper: ["black pepper", "cracked pepper", "cracked black pepper", "peppercorn", "pepper crusted", "au poivre", "ground pepper"],
  cumin: ["cumin", "cumin seed", "jeera"],
  paprika: ["paprika"],
  smoked_paprika: ["smoked paprika", "pimenton"],
  chili_powder: ["chili powder", "chile powder", "ancho chili powder"],
  cayenne: ["cayenne", "cayenne pepper"],
  red_pepper_flakes: ["red pepper flake", "chili flake", "chile flake", "crushed red pepper", "pepper flake", "gochugaru"],
  oregano: ["oregano", "dried oregano"],
  thyme: ["thyme"],
  rosemary: ["rosemary"],
  italian_seasoning: ["italian seasoning", "italian herb", "herbes de provence"],
  garlic_powder: ["garlic powder", "granulated garlic"],
  onion_powder: ["onion powder"],
  cinnamon: ["cinnamon"],
  nutmeg: ["nutmeg"],
  turmeric: ["turmeric", "haldi"],
  coriander_ground: ["ground coriander", "coriander seed", "coriander powder"],
  ground_ginger: ["ground ginger", "ginger powder"],
  garam_masala: ["garam masala"],
  curry_powder: ["curry powder", "madras"],
  five_spice: ["five spice", "5 spice", "star anise"],
  cajun_seasoning: ["cajun", "blackened", "creole"],
  jerk_seasoning: ["jerk"],
  seafood_seasoning: ["old bay", "seafood seasoning", "bay seasoning"],
  zaatar: ["za'atar", "zaatar", "zatar"],
  sesame_seeds: ["sesame", "sesame seed", "toasted sesame", "furikake"],
  everything_seasoning: ["everything seasoning", "everything spice"],
  bay_leaf: ["bay leaf", "bay leaves"],
  spice_mix: ["spice", "spiced", "spice blend", "house spice", "dukkah", "berbere", "ras el hanout", "shichimi", "togarashi"],
  coffee_beans: ["coffee", "espresso", "americano", "latte", "cappuccino", "macchiato", "cold brew", "mocha", "cortado", "flat white"],
  tea_leaves: ["tea", "chai", "matcha", "earl grey", "green tea", "oolong"],
  soda_syrup: ["soda", "cola", "coke", "sprite", "soft drink", "lemonade"],
  ice: ["iced", "ice", "on the rocks", "frozen"],
  water: ["water"],
  beer_keg: ["beer", "lager", "ipa", "ale", "pilsner", "stout", "draft", "draught"],
  wine: ["wine", "cabernet", "pinot", "chardonnay", "sauvignon", "merlot", "rose", "prosecco", "champagne", "sparkling"],
};

//: Sauces and mixes the game has no single ingredient for, made from the ones it has.
export const MIXTURES = {
  aioli: { name: "aioli", build: [["mayo", 1, "mix"], ["garlic", 0.3, "chop>mix"]] },
  "garlic aioli": { name: "garlic aioli", build: [["mayo", 1, "mix"], ["garlic", 0.5, "chop>mix"]] },
  "chipotle mayo": { name: "chipotle mayonnaise", build: [["mayo", 1, "mix"], ["chili", 0.3, "chop>mix"]] },
  "spicy mayo": { name: "spicy mayonnaise", build: [["mayo", 1, "mix"], ["hot_sauce", 0.3, "mix"]] },
  guacamole: { name: "guacamole", build: [["avocado", 1, "chop>mix"], ["lime", 0.3, "chop>mix"], ["onion", 0.3, "chop>mix"], ["cilantro", 0.3, "chop>mix"], ["salt", 3, "mix"]] },
  guac: { name: "guacamole", build: [["avocado", 1, "chop>mix"], ["lime", 0.3, "chop>mix"], ["onion", 0.3, "chop>mix"], ["cilantro", 0.3, "chop>mix"], ["salt", 3, "mix"]] },
  pesto: { name: "pesto", build: [["basil", 1, "blend"], ["parmesan", 0.5, "blend"], ["garlic", 0.3, "blend"], ["olive_oil", 0.5, "blend"], ["peanuts", 0.3, "blend"], ["salt", 1, "blend"]] },
  "pico de gallo": { name: "pico de gallo", build: [["tomato", 1, "chop>mix"], ["onion", 0.4, "chop>mix"], ["cilantro", 0.3, "chop>mix"], ["lime", 0.3, "chop>mix"], ["chili", 0.2, "chop>mix"], ["salt", 2, "mix"]] },
  tzatziki: { name: "tzatziki", build: [["yogurt", 1, "mix"], ["cucumber", 0.5, "chop>mix"], ["garlic", 0.2, "chop>mix"], ["lemon", 0.2, "chop>mix"], ["salt", 1, "mix"]] },
  hummus: { name: "hummus", build: [["chickpeas", 1, "boil>blend"], ["tahini", 0.5, "blend"], ["lemon", 0.3, "blend"], ["garlic", 0.2, "blend"], ["olive_oil", 0.3, "blend"], ["cumin", 1, "blend"], ["salt", 2, "blend"]] },
  coleslaw: { name: "coleslaw", build: [["cabbage", 1, "chop>mix"], ["carrot", 0.5, "chop>mix"], ["mayo", 0.5, "mix"]] },
  slaw: { name: "slaw", build: [["cabbage", 1, "chop>mix"], ["carrot", 0.5, "chop>mix"], ["mayo", 0.4, "mix"]] },
  vinaigrette: { name: "vinaigrette", build: [["olive_oil", 1, "mix"], ["lemon", 0.3, "chop>mix"], ["mustard", 0.2, "mix"], ["salt", 1, "mix"], ["black_pepper", 1, "mix"]] },
  "caesar dressing": { name: "Caesar dressing", build: [["mayo", 0.6, "mix"], ["parmesan", 0.4, "mix"], ["lemon", 0.2, "chop>mix"], ["garlic", 0.2, "chop>mix"], ["black_pepper", 2, "mix"]] },
  "ranch": { name: "ranch", build: [["mayo", 0.5, "mix"], ["sour_cream", 0.5, "mix"], ["basil", 0.2, "chop>mix"], ["garlic_powder", 1, "mix"], ["onion_powder", 1, "mix"], ["black_pepper", 1, "mix"], ["salt", 1, "mix"]] },
  "special sauce": { name: "special sauce", build: [["mayo", 0.6, "mix"], ["ketchup", 0.4, "mix"], ["pickles", 0.3, "chop>mix"], ["paprika", 1, "mix"]] },
  "house sauce": { name: "house sauce", build: [["mayo", 0.6, "mix"], ["ketchup", 0.3, "mix"], ["mustard", 0.2, "mix"]] },
  "secret sauce": { name: "secret sauce", build: [["mayo", 0.6, "mix"], ["ketchup", 0.4, "mix"], ["pickles", 0.3, "chop>mix"]] },
  "teriyaki": { name: "teriyaki", build: [["soy_sauce", 1, "boil"], ["sugar", 0.5, "boil"], ["ginger", 0.2, "chop>boil"]] },
  "peanut sauce": { name: "peanut sauce", build: [["peanuts", 1, "blend"], ["coconut_milk", 0.5, "blend"], ["soy_sauce", 0.3, "blend"], ["lime", 0.2, "blend"]] },
  "nuoc cham": { name: "nuoc cham", build: [["fish_sauce", 1, "mix"], ["lime", 0.4, "chop>mix"], ["sugar", 0.3, "mix"], ["chili", 0.2, "chop>mix"]] },
  "alfredo": { name: "Alfredo sauce", build: [["cream", 1, "saute"], ["butter", 0.5, "saute"], ["parmesan", 0.6, "saute"], ["nutmeg", 1, "saute"], ["black_pepper", 2, "saute"], ["salt", 1, "saute"]] },
  "bolognese": { name: "bolognese", build: [["tomato_sauce", 1, "boil"], ["beef_slices", 0.6, "chop>saute"], ["onion", 0.3, "chop>saute"], ["carrot", 0.3, "chop>saute"], ["salt", 2, "boil"], ["black_pepper", 1, "boil"], ["nutmeg", 1, "boil"], ["bay_leaf", 1, "boil"]] },
  "chimichurri": { name: "chimichurri", build: [["basil", 1, "chop>mix"], ["garlic", 0.3, "chop>mix"], ["olive_oil", 0.5, "mix"], ["chili", 0.2, "chop>mix"], ["oregano", 3, "mix"], ["red_pepper_flakes", 2, "mix"], ["salt", 2, "mix"]] },
  "gravy": { name: "gravy", build: [["broth", 1, "boil"], ["flour", 0.3, "mix>boil"], ["butter", 0.3, "boil"], ["salt", 1, "boil"], ["black_pepper", 2, "boil"]] },
  "hollandaise": { name: "hollandaise", build: [["egg", 0.5, "mix>boil"], ["butter", 0.6, "mix>boil"], ["lemon", 0.2, "chop>mix"], ["cayenne", 1, "mix"], ["salt", 1, "mix"]] },
  "everything bagel": { name: "everything bagel", build: [["bagel", 1, "toast"], ["everything_seasoning", 3, "-"]] },
  // Seasonings that go onto what they season, cooked with it (``season``: the main protein's process).
  "salt and pepper": { name: "salt and pepper", season: true, build: [["salt", 3, "-"], ["black_pepper", 2, "-"]] },
  "salt pepper": { name: "salt and pepper", season: true, build: [["salt", 3, "-"], ["black_pepper", 2, "-"]] },
  seasoned: { name: "seasoning", season: true, build: [["salt", 3, "-"], ["black_pepper", 2, "-"]] },
  "lemon pepper": { name: "lemon pepper", season: true, build: [["lemon", 0.2, "chop"], ["black_pepper", 3, "-"], ["salt", 2, "-"]] },
  "taco seasoning": { name: "taco seasoning", season: true, build: [["chili_powder", 4, "-"], ["cumin", 3, "-"], ["paprika", 2, "-"], ["garlic_powder", 1, "-"], ["onion_powder", 1, "-"], ["oregano", 2, "-"], ["salt", 2, "-"], ["black_pepper", 1, "-"]] },
  "dry rub": { name: "dry rub", season: true, build: [["paprika", 3, "-"], ["sugar", 0.3, "-"], ["garlic_powder", 2, "-"], ["black_pepper", 2, "-"], ["salt", 3, "-"], ["cayenne", 1, "-"]] },
  "bbq rub": { name: "barbecue rub", season: true, build: [["paprika", 3, "-"], ["sugar", 0.3, "-"], ["garlic_powder", 2, "-"], ["black_pepper", 2, "-"], ["salt", 3, "-"], ["cayenne", 1, "-"]] },
  "whipped cream": { name: "whipped cream", build: [["cream", 1, "mix"], ["sugar", 0.2, "mix"]] },
  croutons: { name: "croutons", build: [["bread", 1, "chop>toast"], ["olive_oil", 0.2, "-"]] },
  crouton: { name: "croutons", build: [["bread", 1, "chop>toast"], ["olive_oil", 0.2, "-"]] },
};

//: Words for how a thing is cooked, and the process they mean.
export const COOK_WORDS = [
  [/\b(deep fried|fried|crispy|crispy fried|crunchy|tempura|battered|breaded|katsu|nashville|popcorn)\b/, "fry"],
  [/\b(grilled|chargrilled|char grilled|charred|flame broiled|broiled|smash(ed)?|seared|pan seared|blackened|griddled|wood fired|tandoori|kebab|skewer(ed)?)\b/, "grill"],
  [/\b(roasted|roast|baked|oven roasted|braised|slow cooked|confit|rotisserie|gratin)\b/, "bake"],
  [/\b(sauteed|saute|pan fried|caramelized|sweated|buttered)\b/, "saute"],
  [/\b(stir fried|stir fry|wok tossed|wok fried|wok)\b/, "wok"],
  [/\b(steamed|steam)\b/, "steam"],
  [/\b(boiled|poached|simmered|stewed|braised in)\b/, "boil"],
  [/\b(toasted|toast)\b/, "toast"],
  [/\b(blended|whipped|pureed|smoothie|shake)\b/, "blend"],
  [/\b(chilled|cold|iced)\b/, "chill"],
];

//: Words naming the dish (the house recipe that is its shape), most specific first.
export const DISH_WORDS = [
  ["fish and chips", "fish_and_chips"], ["fish n chips", "fish_and_chips"], ["clam chowder", "clam_chowder"], ["chowder", "clam_chowder"],
  ["steak frites", "steak_frites"], ["steak and fries", "steak_frites"], ["roast chicken", "roast_chicken"], ["half chicken", "roast_chicken"], ["rotisserie", "roast_chicken"],
  ["fried rice", "fried_rice"], ["chow mein", "chow_mein"], ["lo mein", "chow_mein"], ["kung pao", "kung_pao"], ["pad thai", "pad_thai"], ["green curry", "green_curry"], ["red curry", "green_curry"],
  ["tikka masala", "tikka_masala"], ["butter chicken", "tikka_masala"], ["korma", "tikka_masala"], ["vindaloo", "tikka_masala"], ["curry", "tikka_masala"],
  ["banh mi", "banh_mi"], ["pho", "pho"], ["bibimbap", "bibimbap"], ["korean bbq", "korean_bbq"], ["bulgogi", "korean_bbq"], ["galbi", "korean_bbq"],
  ["ramen", "ramen"], ["sushi", "sushi_set"], ["roll", "sushi_set"], ["nigiri", "sushi_set"], ["sashimi", "sushi_set"], ["teriyaki", "teriyaki"], ["dumpling", "dumplings"], ["gyoza", "dumplings"], ["potsticker", "dumplings"], ["bao", "dumplings"],
  ["burrito", "burrito"], ["taco", "tacos"], ["quesadilla", "quesadilla"], ["nachos", "quesadilla"], ["enchilada", "burrito"],
  ["pizza", "pizza"], ["margherita", "pizza"], ["calzone", "pizza"], ["risotto", "risotto"],
  ["spaghetti", "pasta_dish"], ["linguine", "pasta_dish"], ["fettuccine", "pasta_dish"], ["penne", "pasta_dish"], ["rigatoni", "pasta_dish"], ["gnocchi", "pasta_dish"], ["ravioli", "pasta_dish"], ["lasagna", "pasta_dish"], ["pasta", "pasta_dish"], ["mac and cheese", "pasta_dish"],
  ["shawarma", "shawarma"], ["gyro", "shawarma"], ["kebab", "shawarma"], ["falafel", "falafel"],
  ["oyster", "oysters"], ["crab", "crab"],
  ["wings", "wings"], ["burger", "burger_fries"], ["cheeseburger", "burger_fries"], ["hamburger", "burger_fries"],
  ["steak", "steak_frites"], ["ribeye", "steak_frites"], ["filet", "steak_frites"],
  ["banana split", "ice_cream"], ["sundae", "ice_cream"], ["ice cream", "ice_cream"], ["gelato", "ice_cream"], ["milkshake", "milkshake"], ["shake", "milkshake"], ["smoothie", "smoothie"],
  ["pancake", "pancakes"], ["waffle", "pancakes"], ["french toast", "pancakes"], ["omelette", "breakfast_plate"], ["omelet", "breakfast_plate"], ["benedict", "breakfast_plate"], ["breakfast", "breakfast_plate"], ["scramble", "breakfast_plate"],
  ["sandwich", "sandwich"], ["club", "sandwich"], ["blt", "sandwich"], ["panini", "sandwich"], ["melt", "sandwich"], ["sub", "sandwich"], ["hoagie", "sandwich"], ["wrap", "burrito"], ["toast", "sandwich"],
  ["salad", "salad"], ["caesar", "salad"], ["bowl", "bibimbap"], ["poke", "sushi_set"],
  ["soup", "soup"], ["bisque", "soup"], ["stew", "soup"],
  ["cake", "cake"], ["cheesecake", "cake"], ["tiramisu", "cake"], ["brownie", "cake"], ["pie", "dessert"], ["tart", "dessert"], ["creme brulee", "dessert"], ["mousse", "dessert"], ["cookie", "dessert"], ["dessert", "dessert"],
  ["croissant", "pastry"], ["muffin", "pastry"], ["scone", "pastry"], ["pastry", "pastry"], ["donut", "donut"], ["doughnut", "donut"], ["bagel", "bagel"],
  ["latte", "latte"], ["cappuccino", "latte"], ["flat white", "latte"], ["cortado", "latte"], ["mocha", "latte"], ["espresso", "coffee"], ["americano", "coffee"], ["drip coffee", "coffee"], ["cold brew", "coffee"], ["coffee", "coffee"],
  ["iced tea", "iced_tea"], ["tea", "tea"], ["chai", "tea"], ["lemonade", "juice"], ["juice", "juice"], ["soda", "soda"], ["coke", "soda"], ["beer", "beer"], ["ipa", "beer"], ["lager", "beer"], ["wine", "glass_of_wine"], ["water", "water"],
  ["fries", "fries"], ["frites", "fries"], ["chips", "chips"], ["naan", "naan"],
];

//: Words for something served beside the dish, and what it is.
const SIDE_WORDS = [
  [/\b(with|and|side of|served with) (french )?(fries|frites|chips)\b/, [["potato", 2, "chop>fry", 1], ["salt", 3, "-", 1]]],
  [/\b(with|and|side of|served with) (steamed |jasmine |basmati )?rice\b/, [["rice", 1, "steam", 1]]],
  [/\b(with|and|side of|served with) (a )?(side )?(green |house |mixed )?salad\b/, [["lettuce", 1, "chop", 1], ["tomato", 0.5, "chop", 1], ["olive_oil", 0.3, "-", 1], ["salt", 1, "-", 1], ["black_pepper", 1, "-", 1]]],
  [/(\b(with|and|side of|served with)|,) (mashed potato|mash|potato puree|pomme puree)/, [["potato", 2, "chop>boil", 1], ["butter", 0.5, "-", 1], ["milk", 0.2, "-", 1], ["salt", 2, "-", 1]]],
  [/\b(with|and|side of|served with) (garlic )?naan\b/, [["naan_dough", 1, "bake", 1]]],
  [/\b(with|and|side of|served with) (house )?(slaw|coleslaw)\b/, [["cabbage", 1, "chop", 1], ["mayo", 0.4, "-", 1]]],
];

//: How each house dish's real recipe seasons it, in shakes for one portion, and what each goes on:
//: "protein" (the dish's main protein, whichever the menu has), an ingredient, or "-" (sprinkled
//: over to finish). A seasoning goes on before what it seasons is cooked and is cooked with it.
//: (Approx., from the common published recipe for each: a 1/4 lb patty takes about 1/8 tsp each of
//: salt and pepper; pasta water is salted to taste like the sea.)
export const SEASONINGS = {
  burger_fries: [["salt", 3, "protein"], ["black_pepper", 2, "protein"]],
  steak_frites: [["salt", 4, "protein"], ["black_pepper", 3, "protein"]],
  wings: [["salt", 2, "protein"], ["black_pepper", 1, "protein"], ["garlic_powder", 2, "protein"], ["paprika", 2, "protein"]],
  roast_chicken: [["salt", 5, "protein"], ["black_pepper", 3, "protein"], ["thyme", 3, "protein"], ["paprika", 2, "protein"], ["salt", 2, "potato"], ["rosemary", 2, "potato"]],
  salad: [["salt", 1, "-"], ["black_pepper", 2, "-"]],
  breakfast_plate: [["salt", 1, "egg"], ["black_pepper", 1, "egg"], ["salt", 2, "potato"], ["paprika", 1, "potato"]],
  pancakes: [["salt", 2, "flour"]],
  donut: [["salt", 1, "flour"], ["nutmeg", 1, "flour"]],
  cake: [["salt", 1, "flour"]],
  burrito: [["cumin", 2, "protein"], ["chili_powder", 2, "protein"], ["garlic_powder", 1, "protein"], ["salt", 2, "protein"], ["salt", 1, "rice"]],
  tacos: [["cumin", 2, "protein"], ["chili_powder", 2, "protein"], ["oregano", 2, "protein"], ["salt", 2, "protein"], ["black_pepper", 1, "protein"]],
  quesadilla: [["cumin", 1, "protein"], ["chili_powder", 2, "protein"], ["salt", 1, "protein"]],
  ramen: [["sesame_seeds", 2, "-"], ["black_pepper", 1, "-"]],
  teriyaki: [["sesame_seeds", 3, "-"]],
  dumplings: [["salt", 1, "protein"], ["black_pepper", 1, "protein"]],
  fried_rice: [["salt", 1, "rice"], ["black_pepper", 1, "rice"]],
  chow_mein: [["salt", 1, "noodles"], ["black_pepper", 1, "noodles"]],
  soup: [["black_pepper", 2, "broth"], ["thyme", 1, "broth"], ["bay_leaf", 1, "broth"]],
  pad_thai: [["red_pepper_flakes", 1, "-"]],
  pho: [["five_spice", 1, "broth"], ["cinnamon", 1, "broth"], ["coriander_ground", 1, "broth"]],
  banh_mi: [["five_spice", 1, "protein"], ["black_pepper", 1, "protein"]],
  tikka_masala: [["garam_masala", 3, "protein"], ["cumin", 2, "protein"], ["paprika", 2, "protein"], ["turmeric", 1, "protein"], ["salt", 2, "protein"]],
  bibimbap: [["salt", 1, "protein"], ["black_pepper", 1, "protein"], ["sesame_seeds", 3, "-"]],
  korean_bbq: [["black_pepper", 2, "protein"], ["sesame_seeds", 2, "-"]],
  pasta_dish: [["salt", 6, "pasta"], ["oregano", 1, "tomato_sauce"], ["black_pepper", 2, "-"]],
  risotto: [["salt", 2, "arborio"], ["black_pepper", 2, "-"]],
  pizza: [["oregano", 2, "tomato_sauce"]],
  shawarma: [["cumin", 2, "protein"], ["coriander_ground", 2, "protein"], ["paprika", 2, "protein"], ["turmeric", 1, "protein"], ["cinnamon", 1, "protein"], ["black_pepper", 1, "protein"], ["salt", 2, "protein"]],
  falafel: [["cumin", 2, "chickpeas"], ["coriander_ground", 2, "chickpeas"], ["cayenne", 1, "chickpeas"], ["salt", 2, "chickpeas"]],
  fish_and_chips: [["salt", 2, "flour"], ["black_pepper", 1, "flour"]],
  clam_chowder: [["salt", 2, "cream"], ["black_pepper", 2, "cream"], ["thyme", 1, "cream"], ["bay_leaf", 1, "cream"]],
  crab: [["seafood_seasoning", 3, "protein"]],
  meal: [["salt", 2, "protein"], ["black_pepper", 1, "protein"], ["rosemary", 1, "potato"]],
};
//: Spices put on at the end (a scatter over the top), not cooked in.
const TOPPING_SPICES = new Set(["sesame_seeds", "everything_seasoning", "red_pepper_flakes", "zaatar"]);

//: What the house recipes do with each ingredient: its usual process (most used) and amount
//: (the median), read from rules.json's recipes.
const HABITS = new WeakMap();
export function habitsOf(R) {
  let h = HABITS.get(R.kitchen);
  if (h) return h;
  const by = {};
  for (const r of Object.values(R.kitchen.recipes)) for (const c of r.build.map(part)) {
    if (c.side) continue;
    (by[c.ing] ??= { p: {}, q: [] }).p[c.p] = (by[c.ing].p[c.p] || 0) + 1;
    by[c.ing].q.push(c.qty);
  }
  h = {};
  for (const [ing, v] of Object.entries(by)) {
    const q = v.q.sort((a, b) => a - b);
    h[ing] = { p: Object.entries(v.p).sort((a, b) => b[1] - a[1])[0][0], qty: q[Math.floor(q.length / 2)] };
  }
  HABITS.set(R.kitchen, h);
  return h;
}

//: How a kind of ingredient is cooked when no recipe says (protein on the grill, veg chopped).
const ROLE_PROCESS = { protein: "grill", veg: "chop", herb: "chop", fruit: "chop", starch: "-", dairy: "-", sauce: "-", sweet: "-", drink: "pour" };

// The phrase table, longest first: each entry [phrase, ingredient].
const PHRASES = new WeakMap();
function phrasesOf(R) {
  let list = PHRASES.get(R.kitchen);
  if (list) return list;
  const seen = new Map();
  const put = (w, ing) => { const k = norm(w); if (k && !seen.has(k) && ingredient(R, ing)) seen.set(k, ing); };
  for (const [ing, words] of Object.entries(INGREDIENT_WORDS)) for (const w of words) put(w, ing);
  for (const [ing, I] of Object.entries(R.kitchen.ingredients)) { put(I.name, ing); put(ing.replace(/_/g, " "), ing); }
  list = [...seen.entries()].sort((a, b) => b[0].length - a[0].length);
  PHRASES.set(R.kitchen, list);
  return list;
}
// Every whole-word occurrence of a phrase (its plural too), earliest first, the longest taking
// precedence over the words inside it ("ice cream" before "cream", "green onion" before "onion").
function findAll(text, table) {
  const taken = new Array(text.length).fill(false), out = [];
  for (const [phrase, what] of table) {
    const re = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(e?s)?\\b`, "g");
    let m;
    while ((m = re.exec(text))) {
      let free = true;
      for (let i = m.index; i < m.index + m[0].length; i += 1) if (taken[i]) { free = false; break; }
      if (!free) continue;
      for (let i = m.index; i < m.index + m[0].length; i += 1) taken[i] = true;
      out.push({ at: m.index, end: m.index + m[0].length, phrase: m[0], what });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}
// How the words just before a found word say it is cooked ("crispy chicken", "grilled onions").
function cueBefore(text, at) {
  const before = text.slice(Math.max(0, at - 28), at);
  for (const [re, proc] of COOK_WORDS) if (re.test(before.split(/,| \. | and | with /).pop())) return proc;
  return null;
}

//: The house recipe a dish is shaped on, from its name first and then its description.
export function templateFor(R, name, description = "") {
  for (const text of [norm(name), norm(description)]) {
    let best = null;
    for (const [w, id] of DISH_WORDS) {
      if (!R.kitchen.recipes[id]) continue;
      const m = new RegExp(`\\b${w}(e?s)?\\b`).exec(text);
      // The last-named dish word in a name is the dish ("chicken burrito bowl" is a bowl); in
      // a description, the first.
      if (m && (!best || (text === norm(name) ? m.index > best.at : m.index < best.at))) best = { id, at: m.index, word: w };
    }
    if (best) return best;
  }
  return null;
}

//: A real menu's dish ({name, description?, price?, section?}) as a build the game can cook, with
//: its profile (tasteOf) and how each part was arrived at. ``kind``: the kitchen's kind (for its
//: cuisine); a process its stations lack stays as the recipe has it, and the kitchen is given the
//: station (kitchen.mjs stationsNeeded).
export function dishFromMenu(R, item, { kind = null } = {}) {
  const name = String(item?.name || "").trim(), desc = String(item?.description || "").trim();
  const nameN = norm(name), descN = norm(desc), text = `${nameN} . ${descN}`;
  const basis = [];
  const tpl = templateFor(R, name, desc);
  const recipe = tpl ? recipeOf(R, tpl.id) : null;
  if (tpl) basis.push(`shaped on the house's ${R.items[tpl.id]?.name || tpl.id} ("${tpl.word}")`);
  else basis.push("no house dish matches the name: built from the ingredients alone");
  const habits = habitsOf(R);
  const doable = (p) => chain(p).join(">") || "-";
  // What the menu names: mixtures first (aioli is not just garlic), then single ingredients.
  const mixTable = Object.entries(MIXTURES).map(([w, m]) => [norm(w), m]).sort((a, b) => b[0].length - a[0].length);
  const mixes = findAll(text, mixTable);
  const masked = mixes.reduce((s, m) => s.slice(0, m.at) + " ".repeat(m.end - m.at) + s.slice(m.end), text);
  const found = findAll(masked, phrasesOf(R));
  const named = new Map();
  for (const f of found) {
    if (named.has(f.what)) continue;
    named.set(f.what, { ing: f.what, cue: cueBefore(masked, f.at), phrase: f.phrase, inName: f.at < nameN.length });
  }
  // An explicit list ("lettuce, tomato, onion") or "with ..." in the description: what is not
  // named of the house recipe's extras is left off; the base and the main are kept.
  // (Counted over every mention in the description, a name's word included: "crispy chicken
  // sandwich -- fried chicken, slaw, pickles" lists three things. Breads and rice to go with it
  // alone are not a list of what is in it: "served with rice and naan".)
  const inDesc = new Set([...found.filter((f) => f.at > nameN.length).map((f) => f.what), ...mixes.filter((m) => m.at > nameN.length).map((m) => m.what.name)]);
  const listed = [...inDesc].filter((w) => !ingredient(R, w) || ingredient(R, w).role !== "starch").length >= 2;
  const base = new Set(["starch", "protein"]);
  let build = [];
  if (recipe) {
    const proteinsNamed = [...named.values()].filter((n) => ingredient(R, n.ing).role === "protein" && !recipe.build.some((c) => c.ing === n.ing));
    const starchNamed = [...named.values()].filter((n) => ingredient(R, n.ing).role === "starch" && !recipe.build.some((c) => c.ing === n.ing) && n.ing !== "potato" && n.ing !== "flour");
    let swappedProtein = false, swappedStarch = false;
    for (const c of recipe.build) {
      const I = ingredient(R, c.ing), n = named.get(c.ing);
      if (c.side) { if (!listed || named.has(c.ing) || I.role === "sauce" || c.ing === "salt") build.push({ ...c, why: "the house dish's side" }); continue; }
      if (I.role === "protein" && proteinsNamed.length && !n && !swappedProtein) {
        // "Chicken burger", "shrimp tacos": the named protein in the house dish's place.
        const s = proteinsNamed[0];
        build.push({ ing: s.ing, qty: c.qty, p: doable(s.cue || (c.ing === "beef_patty" ? "grill" : c.p)), side: false, why: `"${s.phrase}" in place of the ${I.name.toLowerCase()}` });
        named.delete(s.ing); swappedProtein = true; continue;
      }
      if (I.role === "starch" && starchNamed.length && !n && !swappedStarch && c.ing !== "flour") {
        const s = starchNamed[0];
        // (Both slices of a sandwich are the same bread.)
        for (const d of build) if (d.ing === c.ing && d.why === "the house dish's base") { d.ing = s.ing; d.why = `"${s.phrase}" in place of the ${I.name.toLowerCase()}`; }
        build.push({ ing: s.ing, qty: c.qty, p: doable(c.p), side: false, why: `"${s.phrase}" in place of the ${I.name.toLowerCase()}` });
        swappedStarch = true; continue;
      }
      if (swappedStarch && I.role === "starch" && recipe.build.filter((x) => x.ing === c.ing).length > 1) {
        const s = starchNamed[0];
        build.push({ ing: s.ing, qty: c.qty, p: doable(c.p), side: false, why: `"${s.phrase}" in place of the ${I.name.toLowerCase()}` });
        continue;
      }
      if (n) {
        build.push({ ...c, p: doable(n.cue && !["-"].includes(n.cue) ? (I.role === "veg" || I.role === "herb" ? `chop>${n.cue}` : n.cue) : c.p), why: `named ("${n.phrase}")` });
        named.delete(c.ing);
      } else if (!listed || base.has(I.role) || c.ing === "salt" || recipe.vessel === "cup" || recipe.vessel === "glass") build.push({ ...c, why: "the house dish's base" });
      else basis.push(`left out the house dish's ${I.name.toLowerCase()} (not on the menu's list)`);
    }
  }
  // The dish seasoned as its real recipe seasons it: the house dish's seasonings (a protein's on
  // whichever protein the menu has). (With no house dish, below, once the menu's own are in.)
  const heated = (c) => chain(c.p).some((x) => R.kitchen.heat.includes(x));
  const mainProtein = () => build.find((c) => !c.side && ingredient(R, c.ing)?.role === "protein" && heated(c)) || build.find((c) => !c.side && ingredient(R, c.ing)?.role === "protein");
  const seasonOn = (spice, qty, target, why) => {
    if (!ingredient(R, spice)) return;
    const on = target === "-" ? null : target === "protein" ? mainProtein() : build.find((c) => c.ing === target);
    if (target !== "-" && !on) return;
    // (In beside what it seasons, so a layered dish keeps its order.)
    let at = on ? build.indexOf(on) + 1 : build.length;
    while (on && at < build.length && build[at].on === on.ing) at += 1;   // after its other seasonings
    build.splice(at, 0, { ing: spice, qty, p: on && heated(on) ? on.p : "-", side: on?.side || false, why, on: on?.ing || null });
  };
  if (tpl && SEASONINGS[tpl.id]) for (const [spice, qty, target] of SEASONINGS[tpl.id]) seasonOn(spice, qty, target, `the real recipe's seasoning${target === "-" ? ", over the top" : ""}`);
  // Something beside it the menu promises ("with fries", "served with rice"): a side, not a
  // part of the dish.
  const sideParts = [];
  for (const [re, parts] of SIDE_WORDS) if (re.test(descN) || re.test(nameN)) {
    for (const c of parts.map(part)) if (!build.some((d) => d.ing === c.ing) && !sideParts.some((d) => d.ing === c.ing)) sideParts.push({ ...c, p: doable(c.p), why: "the side the menu says comes with it" });
  }
  // What else the menu names: put in at the house's usual amount, cooked as the menu says or as
  // the house recipes usually cook it.
  const extras = [];
  // (The spices last, so each goes on whatever the menu names it with: "blackened salmon". A
  // "-spiced" or "spices" beside a named spice is that spice, not another blend.)
  const spiceNamed = [...named.values()].some((n) => ingredient(R, n.ing)?.role === "spice" && n.ing !== "spice_mix") || mixes.some((m) => m.what.season);
  const order = [...named.values()].sort((a, b) => (ingredient(R, a.ing)?.role === "spice") - (ingredient(R, b.ing)?.role === "spice"));
  for (const n of order) {
    const I = ingredient(R, n.ing);
    if (build.some((c) => c.ing === n.ing) || sideParts.some((c) => c.ing === n.ing)) continue;
    if (n.ing === "spice_mix" && (spiceNamed || (tpl && SEASONINGS[tpl.id]))) { basis.push(`"${n.phrase}" read as the dish's own spices`); continue; }
    const habit = habits[n.ing];
    // (A vegetable the menu adds goes the way the dish's own vegetables do: raw cabbage on a
    // taco, not the boiled cabbage of a dumpling's filling.)
    const fresh = ["veg", "herb", "fruit"].includes(I.role);
    if (I.role === "spice") {
      // A spice the menu names goes on the main protein, cooked with it ("cumin-spiced lamb",
      // "blackened salmon"), or over the top where it is a topping or there is no protein.
      const on = TOPPING_SPICES.has(n.ing) ? null : (build.find((c) => !c.side && ingredient(R, c.ing)?.role === "protein") || extras.find((c) => ingredient(R, c.ing)?.role === "protein") || null);
      extras.push({ ing: n.ing, qty: I.measure === "shake" ? 3 : 1, p: on && chain(on.p).some((x) => R.kitchen.heat.includes(x)) ? on.p : "-", side: false, why: `named ("${n.phrase}")${on ? `, on the ${ingredient(R, on.ing).name.toLowerCase()}` : ", over the top"}`, on: on?.ing || null });
      continue;
    }
    const likeTpl = fresh && recipe ? recipe.build.map(part).filter((c) => !c.side && ["veg", "herb", "fruit"].includes(ingredient(R, c.ing).role)).map((c) => c.p) : [];
    const tplVeg = likeTpl.length ? likeTpl.sort((a, b) => likeTpl.filter((x) => x === b).length - likeTpl.filter((x) => x === a).length)[0] : null;
    let p = n.cue ? (fresh ? `chop>${n.cue}` : n.cue) : tplVeg || habit?.p || ROLE_PROCESS[I.role] || "-";
    if (n.ing === "flour" && /fry/.test(build.map((c) => c.p).join(" ") + (n.cue || "") + " fry")) p = "mix>fry";
    if (n.ing === "potato" && /\b(fries|frites|chips|tots|wedges)\b/.test(n.phrase)) p = "chop>fry";
    const qty = I.role === "sauce" || I.role === "herb" ? Math.min(1, habit?.qty || 1) : habit?.qty || 1;
    extras.push({ ing: n.ing, qty, p: doable(p), side: false, why: `named ("${n.phrase}")${n.cue ? `, ${n.cue} as the menu says` : habit ? ", cooked as the house usually does" : ""}` });
  }
  for (const m of mixes) {
    const onto = m.what.season ? (build.find((c) => !c.side && ingredient(R, c.ing)?.role === "protein") || extras.find((c) => ingredient(R, c.ing)?.role === "protein")) : null;
    for (const c of m.what.build.map(part)) {
      // A seasoning ("salt and pepper wings") goes on the protein and is cooked with it.
      const p = onto && ingredient(R, c.ing)?.role === "spice" && chain(onto.p).some((x) => R.kitchen.heat.includes(x)) ? onto.p : c.p;
      extras.push({ ...c, p: doable(p), side: false, why: `in the ${m.what.name}`, on: onto && ingredient(R, c.ing)?.role === "spice" ? onto.ing : null });
    }
    basis.push(`${m.what.name} made from ${m.what.build.map(([i]) => ingredient(R, i)?.name.toLowerCase()).join(", ")}`);
  }
  // With no house dish, what is cooked is seasoned as any cook seasons it: salt and pepper on a
  // protein the menu names no seasoning for.
  if (!tpl) for (const c of extras.filter((x) => !x.side && ingredient(R, x.ing)?.role === "protein" && chain(x.p).some((y) => R.kitchen.heat.includes(y)))) {
    if (extras.some((x) => x.on === c.ing)) continue;
    const at = extras.indexOf(c) + 1;
    extras.splice(at, 0, { ing: "salt", qty: 2, p: c.p, side: false, why: "seasoned, as any cook seasons meat or fish", on: c.ing }, { ing: "black_pepper", qty: 1, p: c.p, side: false, why: "seasoned, as any cook seasons meat or fish", on: c.ing });
  }
  // Layered dishes (a burger, a sandwich): the extras go in under the top of the bread.
  // (What is scattered over the top at the end stays the last thing done.)
  const finish = [];
  while (build.length && ingredient(R, build[build.length - 1].ing)?.role === "spice" && !build[build.length - 1].on && !build[build.length - 1].side) finish.unshift(build.pop());
  if (recipe?.ordered && build.length > 1 && ingredient(R, build[build.length - 1].ing)?.role === "starch" && !build[build.length - 1].side) {
    const top = build.pop();
    build.push(...extras, top, ...finish);
  } else {
    build.push(...finish);
    const sides = build.filter((c) => c.side);
    build = [...build.filter((c) => !c.side), ...extras, ...sides];
  }
  build.push(...sideParts);
  if (!build.length) return null;
  // The same ingredient named twice (a mixture's garlic and the menu's) is one portion of it.
  const merged = [];
  for (const c of build) {
    const same = merged.find((d) => d.ing === c.ing && d.p === c.p && d.side === c.side && !(recipe?.ordered && ingredient(R, c.ing).role === "starch"));
    if (same) same.qty = Math.round((same.qty + c.qty) * 100) / 100;
    else merged.push({ ...c, qty: Math.round(c.qty * 100) / 100 });
  }
  const cooked = merged.map((c) => ({ ing: c.ing, qty: c.qty, p: c.p, side: c.side, q: 1 }));
  const profile = tasteOf(R, cooked, { kind });
  const price = Number.isFinite(+item.price) && +item.price > 0 ? R.money(+item.price) : profile.price;
  const cost = profile.cost;
  if (Number.isFinite(+item.price) && +item.price > 0) basis.push(`the menu's price; the game's fair price for it would be ${R.fmt ? R.fmt(profile.price) : profile.price}`);
  return {
    name, description: desc || null, section: item.section || null, price, cost,
    template: tpl?.id || null, vessel: recipe?.vessel || (merged.every((c) => ["drink", "dairy"].includes(ingredient(R, c.ing).role)) ? "cup" : "plate"),
    ordered: Boolean(recipe?.ordered),
    build: merged.map((c) => [c.ing, c.qty, c.p, ...(c.side ? [1] : [])]),
    why: merged.map((c) => ({ ing: c.ing, why: c.why })),
    profile: { taste: profile.taste, kcal: profile.kcal, grams: profile.grams, stamina: profile.stamina, health: profile.health, flavour: profile.flavour, cuisine: profile.cuisine, verdict: profile.verdict },
    unread: unreadWords(descN, [...found, ...mixes]),
    basis,
  };
}
// The description's food words that matched nothing (for checking what a menu said that the
// game could not cook), leaving out the little words.
const STOP = new Set("a an and or with of the in on our house served side topped fresh choice your made daily style local organic seasonal classic signature homemade special all our w lb oz pc pcs piece pieces each per order plus add extra small large regular".split(" "));
function unreadWords(descN, found) {
  let s = descN;
  for (const f of found) if (f.at > 0) s = s.replace(f.phrase, " ");
  return [...new Set(s.split(" ").filter((w) => w.length > 2 && !STOP.has(w) && !/^\d/.test(w)))].slice(0, 12);
}

//: A menu's dishes as a kitchen's own menu (kitchen.mjs k.menu): each with an id at its place.
export function menuDishes(R, place, items, { kind = null } = {}) {
  const out = [];
  for (const [i, item] of (items || []).entries()) {
    const d = dishFromMenu(R, item, { kind });
    if (!d) continue;
    out.push({ id: `real:${place}:${i + 1}`, place, name: d.name, description: d.description, section: d.section, build: d.build, price: d.price,
      stamina: d.profile.stamina, health: d.profile.health, taste: d.profile.taste, kcal: d.profile.kcal, grams: d.profile.grams, family: d.template, real: true, vessel: d.vessel, ordered: d.ordered });
  }
  return out;
}

//: The steps to cook a target ({build, ordered, vessel}: kitchen.mjs targetOf) at a kitchen of
//: ``kind``: what to fetch, what to start first so it all comes out together (the longest time
//: on the heat first), what to chop while it cooks, the order to build it in and the sides.
//: Each step: {text, station, seconds}.
export function cookingSteps(R, kind, target) {
  if (!target?.build?.length) return [];
  const all = Object.entries(R.kitchen.stations).map(([id, s]) => ({ id, ...s }));
  const stations = kind ? stationsFor(R, kind) : all;
  // (A station the kind lacks is one this kitchen was given for its menu: kitchen.mjs stationsNeeded.)
  const stationFor = (proc) => stations.find((s) => s.does.includes(proc)) || all.find((s) => s.does.includes(proc)) || null;
  const P = R.kitchen.processes, heat = new Set(R.kitchen.heat);
  const iname = (id) => (ingredient(R, id)?.name || id).toLowerCase();
  const isSpice = (c) => ingredient(R, c.ing)?.role === "spice";
  const parts = target.build.map(part);
  const steps = [];
  const amount = (c) => {
    const I = ingredient(R, c.ing), n = Number(c.qty.toFixed(2));
    if (I?.measure === "shake") return `${n} ${n === 1 ? "shake" : "shakes"}`;
    return I?.measure === "g" ? `${Math.round(c.qty * I.grams)} g` : `${n} ${I?.unit ? (c.qty > 1 ? plural(I.unit) : I.unit) : ""}`.trim();
  };
  const listOf = (names) => (names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0]);
  const shakesOf = (list) => listOf(list.map((c) => `${amount(c)} of ${iname(c.ing)}`));
  // 1. Everything out of the pantry.
  steps.push({ text: `Fetch ${parts.map((c) => `${iname(c.ing)} (${amount(c)})`).join(", ")}.`, station: null, seconds: 0, kind: "fetch" });
  // 2. The chains with heat in them, longest first: each one's prep, its seasoning, then onto its
  // station. A spice cooked the same way as something on the plate is that thing's seasoning.
  const timed = parts.map((c, i) => {
    const ch = chain(c.p);
    const hot = ch.map((s, k) => ({ s, k })).filter(({ s }) => heat.has(s));
    const secs = hot.reduce((n, { s }) => n + processSeconds(R, c.ing, s), 0);
    return { c, i, ch, hot, secs };
  });
  const seasoning = new Map(), loose = [];
  for (const t of timed.filter((x) => isSpice(x.c) && x.hot.length)) {
    const on = timed.filter((x) => !isSpice(x.c) && x.c.p === t.c.p && x.c.side === t.c.side && x.i < t.i).pop() || timed.find((x) => !isSpice(x.c) && x.c.p === t.c.p && x.c.side === t.c.side);
    if (on) { if (!seasoning.has(on.i)) seasoning.set(on.i, []); seasoning.get(on.i).push(t.c); } else loose.push(t.c);
  }
  const cooking = timed.filter((t) => t.hot.length && !isSpice(t.c)).sort((a, b) => b.secs - a.secs);
  if (loose.length) steps.push({ text: `Season with ${shakesOf(loose)}.`, station: null, seconds: loose.length * 2, kind: "season" });
  for (const t of cooking) {
    const prep = t.ch.slice(0, t.hot[0].k);
    const verbs = prep.map((s) => P[s]?.name?.toLowerCase() || s);
    if (verbs.length) steps.push({ text: `${cap(verbs.join(" then "))} the ${iname(t.c.ing)}${prep.includes("chop") ? " on the cutting board" : ""}.`, station: stationFor(prep[prep.length - 1])?.name || null, seconds: prep.reduce((n, s) => n + processSeconds(R, t.c.ing, s), 0), kind: "prep" });
    const spices = seasoning.get(t.i);
    if (spices) steps.push({ text: `Season the ${iname(t.c.ing)} with ${shakesOf(spices)}${prep.includes("mix") ? ", mixed in" : ", all over"}.`, station: null, seconds: spices.reduce((n, c) => n + Math.max(1, c.qty * 0.5), 0), kind: "season" });
    for (const { s, k } of t.hot) {
      const st = stationFor(s);
      const sec = Math.round(processSeconds(R, t.c.ing, s));
      steps.push({ text: `${cap(P[s]?.name || s)} the ${iname(t.c.ing)}${st ? ` on the ${st.name.toLowerCase()}` : ""}, about ${sec} s${k > t.hot[0].k ? " (after the step before)" : ""}. Take it off when it is done, not before.`, station: st?.name || null, seconds: sec, kind: "heat" });
    }
    const after = t.ch.slice(t.hot[t.hot.length - 1].k + 1);
    for (const s of after) steps.push({ text: `Then ${P[s]?.verb ? (P[s].name || s).toLowerCase() : s} the ${iname(t.c.ing)}.`, station: stationFor(s)?.name || null, seconds: Math.round(processSeconds(R, t.c.ing, s)), kind: "finish" });
  }
  // 3. While it cooks: what is only chopped, mixed, blended or brewed, together where it is the
  // same work ("chop the lettuce, tomato and onion"; a sauce's parts mixed in one bowl, its spices
  // shaken in by the shake).
  const cold = timed.filter((t) => !t.hot.length && t.ch.length);
  const groups = new Map();
  for (const t of cold) { const k = t.ch.join(">"); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); }
  let first = true;
  for (const [k, list] of groups) {
    const ch = k.split(">"), st = stationFor(ch[ch.length - 1]);
    const what = listOf(list.map((t) => (isSpice(t.c) ? `${iname(t.c.ing)} (${amount(t.c)})` : iname(t.c.ing))));
    const verb = ch.map((s) => (P[s]?.name || s).toLowerCase()).join(" then ");
    const together = ch[ch.length - 1] === "mix" || ch[ch.length - 1] === "blend" ? (list.length > 1 ? " together" : "") : "";
    steps.push({ text: cap(`${cooking.length && first ? "while that cooks, " : ""}${verb} the ${what}${together}${st ? ` (${st.name.toLowerCase()})` : ""}.`), station: st?.name || null,
      seconds: Math.round(list.reduce((n, t) => n + t.ch.reduce((m, s) => m + processSeconds(R, t.c.ing, s), 0), 0)), kind: "prep" });
    first = false;
  }
  // 4. The plate: built in order (bottom first) where the order matters; what is scattered over
  // it last, and the sides seasoned as they come off.
  const raw = (c) => isSpice(c) && !chain(c.p).length;
  const main = parts.filter((c) => !c.side && !isSpice(c)), sides = parts.filter((c) => c.side && !isSpice(c));
  const over = parts.filter((c) => !c.side && raw(c)), sideOver = parts.filter((c) => c.side && raw(c));
  const vessel = target.vessel || "plate";
  if (target.ordered) steps.push({ text: `Build it on the ${vessel}, bottom first: ${main.map((c) => iname(c.ing)).join(", then ")}.`, station: null, seconds: main.length * 3, kind: "build" });
  else steps.push({ text: `Put it together in the ${vessel}: ${main.map((c) => iname(c.ing)).join(", ")}.`, station: null, seconds: main.length * 3, kind: "build" });
  if (over.length) steps.push({ text: `Finish with ${shakesOf(over)} over the top.`, station: null, seconds: over.length * 2, kind: "season" });
  if (sides.length) steps.push({ text: `On the side: ${sides.map((c) => iname(c.ing)).join(", ")}${sideOver.length ? `, seasoned with ${shakesOf(sideOver)} as ${sides.length > 1 ? "they come" : "it comes"} off` : ""}.`, station: null, seconds: sides.length * 2, kind: "build" });
  steps.push({ text: "Put it on the pass and serve.", station: null, seconds: 2, kind: "serve" });
  return steps.map((s, i) => ({ n: i + 1, ...s }));
}
const plural = (w) => (/(s|sh|ch|x|o)$/.test(w) ? `${w}es` : /[^aeiou]y$/.test(w) ? `${w.slice(0, -1)}ies` : `${w}s`);
const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
