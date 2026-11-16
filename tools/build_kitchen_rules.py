"""Write the kitchen's rules into docs/city/rules.json (the "kitchen" block).

The restaurant game (docs/city/kitchen.mjs) reads what each kitchen has: its ingredients (what a
unit costs the restaurant, where it is kept, what it tastes of and what it does to the bars), its
stations (what each can do to an ingredient, and how long that takes), and the recipe of every
dish a food shop sells, in the order it is built.

Costs are wholesale, in whole Credits (at par with the dollar), set so a dish's ingredients come
to about 28-38% of its menu price -- the usual food-cost share of a US restaurant (approx.).

Run: python3 tools/build_kitchen_rules.py   (rewrites the one line; idempotent)
"""
from __future__ import annotations

import json
import re
from pathlib import Path

RULES = Path(__file__).resolve().parents[1] / "docs" / "city" / "rules.json"

# ---- ingredients ---------------------------------------------------------------------------------
# id: (name, unit, cost, kept, role, stamina, health, taste, tags, raw_ok, times)
# taste: sw sweet, sa salty, so sour, bi bitter, um umami, fa fat, sp spice, fr fresh (0-3)
# kept: dry (the shelf), fridge, freezer.  raw_ok: safe to serve without heat.
def T(**k):
    return k

ING = {
    # breads and starches
    "bun": ("Burger bun", "bun", 0.35, "dry", "starch", 6, 0, T(sw=1, fa=1), ["american"], True, {}),
    "bread": ("Sliced bread", "slice", 0.12, "dry", "starch", 3, 0, T(sw=1), ["american", "cafe", "breakfast"], True, {}),
    "baguette": ("Baguette", "roll", 0.4, "dry", "starch", 6, 0, T(sa=1), ["vietnamese", "cafe"], True, {}),
    "bagel": ("Bagel", "bagel", 0.5, "dry", "starch", 8, 0, T(sa=1), ["cafe", "breakfast"], True, {}),
    "tortilla": ("Tortilla", "tortilla", 0.15, "dry", "starch", 4, 0, T(sa=1), ["mexican"], True, {}),
    "pita": ("Pita", "pita", 0.3, "dry", "starch", 5, 0, T(), ["mediterranean"], True, {}),
    "pizza_dough": ("Pizza dough", "ball", 0.6, "fridge", "starch", 14, 0, T(sa=1), ["italian"], False, {"bake": 14}),
    "pizza_slice_baked": ("Pizza slice, baked", "slice", 1.4, "fridge", "starch", 12, 0, T(sa=2, fa=2, um=2), ["italian"], True, {"bake": 6}),
    "naan_dough": ("Naan dough", "piece", 0.25, "fridge", "starch", 8, 0, T(fa=1), ["indian"], False, {"bake": 8}),
    "pastry_dough": ("Pastry dough", "piece", 0.7, "freezer", "starch", 8, 0, T(sw=1, fa=2), ["cafe", "dessert"], False, {"bake": 12}),
    "dumpling_wrappers": ("Dumpling wrappers", "dozen", 0.3, "fridge", "starch", 6, 0, T(), ["chinese", "korean"], False, {}),
    "pasta": ("Dry pasta", "portion", 0.8, "dry", "starch", 14, 0, T(), ["italian"], False, {"boil": 12}),
    "arborio": ("Arborio rice", "portion", 0.5, "dry", "starch", 14, 0, T(), ["italian"], False, {"boil": 14}),
    "rice": ("Rice", "portion", 0.2, "dry", "starch", 12, 0, T(), ["chinese", "japanese", "korean", "thai", "indian", "mexican"], False, {"steam": 9}),
    "noodles": ("Egg noodles", "portion", 0.35, "dry", "starch", 12, 0, T(), ["chinese"], False, {"boil": 8}),
    "rice_noodles": ("Rice noodles", "portion", 0.35, "dry", "starch", 12, 0, T(), ["thai", "vietnamese"], False, {"boil": 6}),
    "ramen_noodles": ("Fresh ramen noodles", "portion", 0.45, "fridge", "starch", 13, 0, T(), ["japanese"], False, {"boil": 6}),
    "flour": ("Flour", "cup", 0.08, "dry", "starch", 4, 0, T(), ["dessert", "breakfast", "cafe", "seafood"], False, {}),
    "potato": ("Potato", "potato", 0.35, "dry", "starch", 8, 0, T(), ["american", "seafood", "breakfast"], False, {"fry": 10, "bake": 14, "boil": 12, "saute": 9}),
    "nori": ("Nori", "sheet", 0.2, "dry", "veg", 1, 1, T(sa=1, um=1), ["japanese", "korean"], True, {}),
    "chips_bag": ("Bag of chips", "bag", 0.5, "dry", "starch", 7, 0, T(sa=2, fa=2), ["american"], True, {}),
    # meat, fish, eggs, tofu
    "beef_patty": ("Beef patty", "patty", 1.6, "freezer", "protein", 16, 0, T(um=2, fa=2, sa=1), ["american"], False, {"grill": 12}),
    "steak": ("Steak", "steak", 7.0, "fridge", "protein", 22, 1, T(um=3, fa=2), ["american"], False, {"grill": 14}),
    "chicken": ("Chicken breast", "piece", 1.3, "fridge", "protein", 16, 1, T(um=1), ["american", "mexican", "indian", "thai", "chinese", "japanese"], False, {"grill": 12, "wok": 7, "boil": 10, "saute": 8, "bake": 14}),
    "chicken_half": ("Half chicken", "half", 3.5, "fridge", "protein", 24, 1, T(um=2, fa=1), ["american"], False, {"bake": 16}),
    "chicken_wings": ("Chicken wings", "portion", 2.4, "freezer", "protein", 14, 0, T(um=1, fa=2), ["american"], False, {"fry": 11}),
    "pork": ("Pork shoulder", "portion", 1.2, "fridge", "protein", 16, 0, T(um=2, fa=2), ["mexican", "chinese", "vietnamese", "japanese"], False, {"grill": 11, "bake": 14, "steam": 9}),
    "bacon": ("Bacon", "rasher", 0.35, "fridge", "protein", 5, -1, T(sa=3, fa=3, um=1), ["american", "breakfast"], False, {"grill": 7, "saute": 6}),
    "ham": ("Ham", "slice", 0.45, "fridge", "protein", 5, 0, T(sa=2, um=1), ["american", "cafe"], True, {}),
    "turkey": ("Turkey", "slice", 0.5, "fridge", "protein", 5, 1, T(sa=1, um=1), ["american", "cafe"], True, {}),
    "beef_slices": ("Sliced beef", "portion", 1.8, "fridge", "protein", 16, 0, T(um=3, fa=2), ["korean", "vietnamese"], False, {"grill": 7, "saute": 6}),
    "lamb": ("Shawarma lamb", "portion", 2.5, "fridge", "protein", 16, 0, T(um=2, fa=2, sp=1), ["mediterranean"], False, {"grill": 10}),
    "shrimp": ("Shrimp", "portion", 2.4, "freezer", "protein", 10, 1, T(sa=1, um=2, sw=1), ["thai", "seafood", "chinese"], False, {"wok": 5, "fry": 7, "grill": 6}),
    "fish_fillet": ("Cod fillet", "fillet", 3.0, "fridge", "protein", 14, 2, T(um=1), ["seafood"], False, {"fry": 10}),
    "salmon": ("Salmon", "portion", 2.5, "fridge", "protein", 12, 3, T(fa=2, um=2), ["japanese", "seafood"], True, {"grill": 9}),
    "tuna": ("Tuna", "portion", 3.0, "fridge", "protein", 12, 3, T(um=2), ["japanese"], True, {"grill": 6}),
    "oysters": ("Oysters", "half dozen", 4.5, "fridge", "protein", 8, 3, T(sa=2, um=1, fr=2), ["seafood"], True, {}),
    "crab": ("Dungeness crab", "crab", 9.0, "fridge", "protein", 20, 3, T(sw=1, sa=1, um=2), ["seafood"], False, {"steam": 14, "boil": 12}),
    "clams": ("Clams", "portion", 2.5, "fridge", "protein", 8, 2, T(sa=2, um=2), ["seafood"], False, {"boil": 9, "steam": 8}),
    "tofu": ("Tofu", "block", 0.6, "fridge", "protein", 10, 2, T(), ["chinese", "japanese", "korean", "thai"], True, {"wok": 6, "fry": 8}),
    "egg": ("Egg", "egg", 0.25, "fridge", "protein", 6, 1, T(fa=1, um=1), ["breakfast", "dessert", "korean", "chinese", "japanese", "thai"], False, {"saute": 5, "boil": 9, "wok": 4}),
    "chickpeas": ("Chickpeas", "cup", 0.3, "dry", "protein", 9, 2, T(), ["mediterranean", "indian"], False, {"fry": 8, "boil": 10}),
    "beans": ("Pinto beans", "cup", 0.3, "dry", "protein", 9, 2, T(sa=1), ["mexican"], False, {"boil": 10}),
    # dairy
    "cheese": ("Cheese slice", "slice", 0.25, "fridge", "dairy", 5, 0, T(sa=2, fa=2, um=1), ["american", "mexican", "cafe"], True, {}),
    "mozzarella": ("Mozzarella", "handful", 0.8, "fridge", "dairy", 6, 0, T(fa=2, sa=1), ["italian"], True, {}),
    "parmesan": ("Parmesan", "spoon", 0.8, "fridge", "dairy", 3, 0, T(sa=3, um=3), ["italian"], True, {}),
    "cream_cheese": ("Cream cheese", "spoon", 0.2, "fridge", "dairy", 3, 0, T(fa=2, so=1), ["cafe", "breakfast"], True, {}),
    "butter": ("Butter", "pat", 0.15, "fridge", "dairy", 3, -1, T(fa=3, sa=1), ["american", "italian", "breakfast", "dessert", "seafood", "indian"], True, {"micro": 3}),
    "milk": ("Milk", "cup", 0.2, "fridge", "dairy", 3, 1, T(sw=1, fa=1), ["cafe", "breakfast", "dessert"], True, {"steam": 4}),
    "cream": ("Cream", "pour", 0.4, "fridge", "dairy", 4, -1, T(fa=3, sw=1), ["dessert", "indian", "seafood", "italian"], True, {}),
    "yogurt": ("Yogurt", "cup", 0.3, "fridge", "dairy", 3, 2, T(so=2, fa=1), ["cafe", "indian", "mediterranean"], True, {}),
    "sour_cream": ("Sour cream", "spoon", 0.2, "fridge", "dairy", 2, 0, T(so=2, fa=2), ["mexican"], True, {}),
    "ice_cream": ("Ice cream", "scoop", 0.45, "freezer", "sweet", 5, -1, T(sw=3, fa=2), ["dessert", "american"], True, {}),
    # vegetables, herbs, fruit
    "lettuce": ("Lettuce", "leaf", 0.15, "fridge", "veg", 1, 2, T(fr=3), ["american", "mediterranean", "korean", "cafe"], True, {}),
    "tomato": ("Tomato", "tomato", 0.25, "fridge", "veg", 1, 2, T(so=1, sw=1, fr=2, um=1), ["american", "italian", "mediterranean", "mexican"], True, {}),
    "onion": ("Onion", "onion", 0.12, "dry", "veg", 1, 1, T(sw=1, sp=1), ["american", "mexican", "mediterranean", "indian", "seafood"], True, {"saute": 6, "grill": 6, "boil": 8}),
    "pickles": ("Pickles", "slices", 0.1, "fridge", "veg", 0, 1, T(so=3, sa=2), ["american", "mediterranean"], True, {}),
    "cucumber": ("Cucumber", "cucumber", 0.2, "fridge", "veg", 1, 2, T(fr=3), ["vietnamese", "mediterranean", "cafe"], True, {}),
    "carrot": ("Carrot", "carrot", 0.1, "fridge", "veg", 1, 2, T(sw=1, fr=1), ["vietnamese", "korean", "chinese", "cafe"], True, {"wok": 5, "boil": 8}),
    "cabbage": ("Cabbage", "wedge", 0.15, "fridge", "veg", 1, 2, T(fr=1), ["chinese", "korean"], True, {"wok": 5, "steam": 6}),
    "bell_pepper": ("Bell pepper", "pepper", 0.3, "fridge", "veg", 1, 2, T(sw=1, fr=2), ["chinese", "thai", "mexican"], True, {"wok": 5, "boil": 6, "grill": 6}),
    "chili": ("Chili", "chili", 0.08, "fridge", "veg", 0, 1, T(sp=3), ["thai", "chinese", "mexican", "vietnamese", "indian", "korean"], True, {"wok": 4}),
    "mushroom": ("Mushrooms", "handful", 0.35, "fridge", "veg", 2, 2, T(um=2), ["italian", "chinese", "japanese"], True, {"saute": 6}),
    "garlic": ("Garlic", "clove", 0.05, "dry", "veg", 0, 1, T(sp=1, um=1), ["italian", "chinese", "korean", "indian", "american"], True, {"saute": 4}),
    "ginger": ("Ginger", "knob", 0.08, "dry", "veg", 0, 1, T(sp=2, fr=1), ["chinese", "japanese", "thai", "indian", "korean"], True, {}),
    "scallion": ("Scallion", "stalk", 0.08, "fridge", "herb", 0, 1, T(fr=2, sp=1), ["chinese", "japanese", "korean", "vietnamese"], True, {}),
    "cilantro": ("Cilantro", "sprig", 0.08, "fridge", "herb", 0, 1, T(fr=3), ["mexican", "vietnamese", "thai", "indian"], True, {}),
    "basil": ("Basil", "sprig", 0.1, "fridge", "herb", 0, 1, T(fr=3, sw=1), ["italian", "thai", "vietnamese"], True, {}),
    "bean_sprouts": ("Bean sprouts", "handful", 0.1, "fridge", "veg", 1, 2, T(fr=2), ["vietnamese", "thai", "korean"], True, {"boil": 4}),
    "spinach": ("Spinach", "handful", 0.2, "fridge", "veg", 1, 3, T(fr=1, bi=1), ["korean", "italian", "cafe"], True, {"saute": 4}),
    "broccoli": ("Broccoli", "head", 0.3, "fridge", "veg", 2, 3, T(bi=1, fr=1), ["american", "chinese", "japanese"], True, {"steam": 6}),
    "peas": ("Peas", "handful", 0.1, "freezer", "veg", 2, 2, T(sw=1), ["chinese", "indian"], False, {"wok": 4, "boil": 5}),
    "avocado": ("Avocado", "avocado", 0.6, "fridge", "veg", 3, 3, T(fa=2, fr=1), ["mexican", "cafe"], True, {}),
    "lime": ("Lime", "lime", 0.15, "fridge", "fruit", 0, 1, T(so=3, fr=2), ["mexican", "thai", "vietnamese"], True, {}),
    "lemon": ("Lemon", "lemon", 0.15, "fridge", "fruit", 0, 1, T(so=3, fr=2), ["seafood", "mediterranean", "cafe"], True, {}),
    "peanuts": ("Peanuts", "handful", 0.15, "dry", "protein", 4, 1, T(fa=2, sa=1), ["thai", "chinese"], True, {"wok": 4}),
    "oranges": ("Orange", "orange", 0.4, "fridge", "fruit", 3, 2, T(sw=2, so=2, fr=3), ["cafe", "breakfast"], True, {}),
    "banana": ("Banana", "banana", 0.2, "dry", "fruit", 5, 2, T(sw=2), ["cafe", "dessert"], True, {}),
    "berries": ("Berries", "handful", 0.6, "freezer", "fruit", 2, 3, T(sw=2, so=1, fr=2), ["cafe", "dessert"], True, {}),
    "coconut_milk": ("Coconut milk", "can", 0.5, "dry", "dairy", 4, 0, T(sw=1, fa=3), ["thai"], True, {}),
    # sauces, seasoning
    "ketchup": ("Ketchup", "squeeze", 0.03, "dry", "sauce", 1, 0, T(sw=2, so=1, sa=1), ["american"], True, {}),
    "mustard": ("Mustard", "squeeze", 0.03, "dry", "sauce", 0, 0, T(so=2, sp=1, sa=1), ["american", "cafe"], True, {}),
    "mayo": ("Mayonnaise", "spoon", 0.05, "fridge", "sauce", 2, -1, T(fa=3, so=1), ["american", "vietnamese", "cafe"], True, {}),
    "hot_sauce": ("Hot sauce", "dash", 0.05, "dry", "sauce", 0, 0, T(sp=3, so=1, sa=1), ["american", "mexican", "seafood"], True, {}),
    "bbq_sauce": ("Barbecue sauce", "spoon", 0.06, "dry", "sauce", 1, 0, T(sw=2, sa=1, um=1), ["american"], True, {}),
    "salsa": ("Salsa", "spoon", 0.2, "fridge", "sauce", 1, 1, T(so=1, sp=2, fr=2), ["mexican"], True, {}),
    "soy_sauce": ("Soy sauce", "dash", 0.05, "dry", "sauce", 0, 0, T(sa=3, um=2), ["chinese", "japanese", "korean"], True, {}),
    "fish_sauce": ("Fish sauce", "dash", 0.05, "dry", "sauce", 0, 0, T(sa=3, um=3), ["thai", "vietnamese"], True, {}),
    "teriyaki_sauce": ("Teriyaki sauce", "spoon", 0.15, "dry", "sauce", 1, 0, T(sw=2, sa=2, um=1), ["japanese"], True, {}),
    "curry_paste": ("Green curry paste", "spoon", 0.35, "fridge", "sauce", 1, 1, T(sp=3, fr=1, sa=1), ["thai"], False, {"boil": 8}),
    "tikka_sauce": ("Tikka masala sauce", "ladle", 0.6, "fridge", "sauce", 2, 0, T(sp=2, fa=2, sw=1, um=1), ["indian"], False, {"boil": 8}),
    "tomato_sauce": ("Tomato sauce", "ladle", 0.5, "fridge", "sauce", 2, 1, T(so=1, sw=1, um=2), ["italian"], True, {"boil": 7}),
    "olive_oil": ("Olive oil", "drizzle", 0.08, "dry", "sauce", 1, 1, T(fa=2, bi=1), ["italian", "mediterranean", "cafe"], True, {}),
    "broth": ("Stock", "ladle", 0.35, "fridge", "sauce", 3, 1, T(sa=2, um=2), ["vietnamese", "italian", "american", "chinese"], False, {"boil": 9}),
    "ramen_broth": ("Tonkotsu broth", "ladle", 0.7, "fridge", "sauce", 4, 0, T(sa=2, um=3, fa=2), ["japanese"], False, {"boil": 9}),
    "tahini": ("Tahini", "spoon", 0.2, "dry", "sauce", 2, 1, T(fa=2, bi=1), ["mediterranean"], True, {}),
    "gochujang": ("Gochujang", "spoon", 0.2, "fridge", "sauce", 1, 0, T(sp=2, sw=1, um=2), ["korean"], True, {}),
    "tartar_sauce": ("Tartar sauce", "spoon", 0.15, "fridge", "sauce", 2, -1, T(fa=2, so=2), ["seafood"], True, {}),
    "wasabi": ("Wasabi", "dab", 0.1, "fridge", "sauce", 0, 0, T(sp=3), ["japanese"], True, {}),
    "maple_syrup": ("Maple syrup", "pour", 0.25, "dry", "sweet", 3, -1, T(sw=3), ["breakfast"], True, {}),
    "chocolate": ("Chocolate", "square", 0.3, "dry", "sweet", 3, -1, T(sw=2, bi=1, fa=2), ["dessert", "cafe"], True, {"micro": 3}),
    "chocolate_syrup": ("Chocolate syrup", "pour", 0.15, "dry", "sweet", 2, -1, T(sw=3), ["dessert"], True, {}),
    "sugar": ("Sugar", "spoon", 0.02, "dry", "sweet", 2, -1, T(sw=3), ["dessert", "cafe", "breakfast"], True, {}),
    "salt": ("Salt", "pinch", 0.01, "dry", "spice", 0, 0, T(sa=3), ["american", "italian", "seafood"], True, {}),
    "spice_mix": ("Spice mix", "pinch", 0.05, "dry", "spice", 0, 1, T(sp=2, um=1), ["mexican", "indian", "mediterranean"], True, {}),
    # drinks
    "coffee_beans": ("Espresso shot", "shot", 0.45, "dry", "drink", 6, 0, T(bi=3), ["cafe", "breakfast"], False, {"brew": 5}),
    "tea_leaves": ("Tea", "bag", 0.2, "dry", "drink", 4, 1, T(bi=1, fr=1), ["cafe", "chinese", "japanese", "thai"], False, {"brew": 5}),
    "soda_syrup": ("Soda", "cup", 0.4, "dry", "drink", 4, 0, T(sw=3), ["american", "mexican", "mediterranean", "italian"], False, {"pour": 2}),
    "ice": ("Ice", "scoop", 0.02, "freezer", "drink", 0, 0, T(fr=1), ["cafe", "american"], True, {}),
    "water_bottle": ("Bottled water", "bottle", 0.4, "dry", "drink", 4, 1, T(fr=1), ["cafe", "american"], True, {}),
    "beer_keg": ("Draft beer", "pint", 1.4, "fridge", "drink", 4, -1, T(bi=2), ["american", "mexican", "japanese", "korean", "indian", "seafood", "thai"], False, {"pour": 3}),
    "wine": ("House wine", "glass", 2.2, "fridge", "drink", 3, -1, T(so=1, bi=1), ["italian", "seafood"], False, {"pour": 2}),
}

# ---- stations ------------------------------------------------------------------------------------
# what each can do, and the ideal real seconds of each process (an ingredient may say otherwise)
PROCESSES = {
    "chop": {"name": "Chop", "verb": "chopped", "taps": 5},
    "grill": {"name": "Grill", "verb": "grilled", "seconds": 10, "taste": T(um=1, bi=0.3), "health": 0},
    "fry": {"name": "Deep fry", "verb": "fried", "seconds": 9, "taste": T(fa=1.5, sa=0.3), "health": -2, "stamina": 1.15},
    "boil": {"name": "Boil", "verb": "boiled", "seconds": 10, "taste": T(), "health": 0},
    "saute": {"name": "Sauté", "verb": "sautéed", "seconds": 7, "taste": T(fa=0.6, um=0.4), "health": -0.5},
    "bake": {"name": "Bake", "verb": "baked", "seconds": 13, "taste": T(sw=0.3, um=0.4), "health": 0},
    "micro": {"name": "Microwave", "verb": "microwaved", "seconds": 5, "taste": T(), "health": 0, "quality_cap": 0.8},
    "toast": {"name": "Toast", "verb": "toasted", "seconds": 4, "taste": T(sw=0.3, bi=0.2), "health": 0},
    "steam": {"name": "Steam", "verb": "steamed", "seconds": 8, "taste": T(), "health": 0.5},
    "wok": {"name": "Wok", "verb": "stir-fried", "seconds": 6, "taste": T(fa=0.6, um=0.6), "health": -0.5},
    "blend": {"name": "Blend", "verb": "blended", "seconds": 4, "taste": T(), "health": 0},
    "mix": {"name": "Mix", "verb": "mixed", "seconds": 3, "taste": T(), "health": 0},
    "brew": {"name": "Brew", "verb": "brewed", "seconds": 5, "taste": T(), "health": 0},
    "pour": {"name": "Pour", "verb": "poured", "seconds": 2, "taste": T(), "health": 0},
}
HEAT = ["grill", "fry", "boil", "saute", "bake", "micro", "toast", "steam", "wok", "brew"]

STATIONS = {
    "board": {"name": "Cutting board", "does": ["chop"], "slots": 1},
    "bowl": {"name": "Mixing bowl", "does": ["mix"], "slots": 4, "batch": True},
    "grill": {"name": "Flat-top grill", "does": ["grill", "toast"], "slots": 4},
    "fryer": {"name": "Deep fryer", "does": ["fry"], "slots": 2},
    "stove": {"name": "Stove", "does": ["boil", "saute"], "slots": 4},
    "oven": {"name": "Oven", "does": ["bake"], "slots": 3},
    "pizza_oven": {"name": "Pizza oven", "does": ["bake"], "slots": 3},
    "tandoor": {"name": "Tandoor", "does": ["bake", "grill"], "slots": 3},
    "microwave": {"name": "Microwave", "does": ["micro"], "slots": 1},
    "toaster": {"name": "Toaster", "does": ["toast"], "slots": 2},
    "wok": {"name": "Wok burner", "does": ["wok"], "slots": 2},
    "steamer": {"name": "Steamer and rice cooker", "does": ["steam"], "slots": 3},
    "blender": {"name": "Blender", "does": ["blend"], "slots": 4, "batch": True},
    "espresso": {"name": "Espresso machine", "does": ["brew", "steam"], "slots": 2},
    "kettle": {"name": "Kettle", "does": ["brew"], "slots": 2},
    "drinks": {"name": "Drinks fountain and taps", "does": ["pour"], "slots": 2},
}
BASE = ["board", "bowl", "microwave"]
KITCHENS = {
    "restaurant": BASE + ["grill", "fryer", "stove", "oven", "steamer", "drinks"],
    "american": BASE + ["grill", "fryer", "stove", "oven", "blender", "drinks"],
    "diner": BASE + ["grill", "fryer", "stove", "toaster", "blender", "espresso", "drinks"],
    "mexican": BASE + ["grill", "fryer", "stove", "steamer", "drinks"],
    "japanese": BASE + ["grill", "fryer", "stove", "steamer", "kettle", "drinks"],
    "chinese": BASE + ["wok", "steamer", "stove", "fryer", "kettle"],
    "thai": BASE + ["wok", "stove", "steamer", "kettle", "drinks"],
    "vietnamese": BASE + ["stove", "grill", "toaster", "steamer", "wok", "kettle"],
    "indian": BASE + ["tandoor", "stove", "steamer", "grill", "drinks"],
    "korean": BASE + ["grill", "stove", "steamer", "wok", "drinks"],
    "italian": BASE + ["stove", "oven", "grill", "drinks"],
    "mediterranean": BASE + ["grill", "fryer", "stove", "drinks"],
    "seafood": BASE + ["fryer", "stove", "steamer", "grill", "toaster", "drinks"],
    "pizza": BASE + ["pizza_oven", "fryer", "drinks"],
    "ice_cream": BASE + ["blender", "drinks"],
    "deli": BASE + ["toaster", "stove", "espresso", "drinks", "grill"],
    "cafe": BASE + ["espresso", "kettle", "blender", "toaster", "oven", "drinks"],
    "bakery": BASE + ["oven", "fryer", "toaster", "espresso"],
}

# ---- recipes -------------------------------------------------------------------------------------
# dish: (ordered, vessel, [(ingredient, qty, process chain, side?)]) -- in the order it is built.
# process "-" is as it comes; "chop>fry" is chopped, then fried. A side is plated beside the build.
def c(ing, qty=1, p="-", side=False):
    return [ing, qty, p] + ([1] if side else [])

FRIES = [c("potato", 2, "chop>fry", True), c("salt", 1, "-", True)]
RECIPES = {
    "burger_fries": (True, "plate", [c("bun", 1, "toast"), c("beef_patty", 1, "grill"), c("cheese"), c("lettuce", 1, "chop"), c("tomato", 1, "chop"), c("pickles"), c("ketchup")] + FRIES),
    "fries": (False, "basket", [c("potato", 2, "chop>fry"), c("salt")]),
    "wings": (False, "basket", [c("chicken_wings", 1, "fry"), c("hot_sauce", 1, "mix"), c("butter", 1, "mix")]),
    "roast_chicken": (False, "plate", [c("chicken_half", 1, "bake"), c("potato", 1, "chop>bake"), c("garlic", 1, "chop"), c("butter")]),
    "steak_frites": (False, "plate", [c("steak", 1, "grill"), c("butter")] + FRIES),
    "salad": (False, "bowl", [c("lettuce", 2, "chop"), c("tomato", 1, "chop"), c("cucumber", 1, "chop"), c("carrot", 1, "chop"), c("olive_oil"), c("lemon", 1, "chop")]),
    "milkshake": (False, "cup", [c("ice_cream", 2, "blend"), c("milk", 1, "blend"), c("chocolate_syrup", 1, "blend")]),
    "soda": (False, "cup", [c("ice"), c("soda_syrup", 1, "pour")]),
    "beer": (False, "glass", [c("beer_keg", 1, "pour")]),
    "glass_of_wine": (False, "glass", [c("wine", 1, "pour")]),
    "water": (False, "cup", [c("water_bottle")]),
    "breakfast_plate": (False, "plate", [c("egg", 2, "saute"), c("bacon", 2, "grill"), c("bread", 1, "toast"), c("potato", 1, "chop>saute"), c("butter")]),
    "pancakes": (True, "plate", [c("flour", 1, "mix>grill"), c("egg", 1, "mix>grill"), c("milk", 1, "mix>grill"), c("butter"), c("maple_syrup")]),
    "sandwich": (True, "plate", [c("bread"), c("ham"), c("cheese"), c("lettuce", 1, "chop"), c("tomato", 1, "chop"), c("mustard"), c("bread")]),
    "coffee": (False, "cup", [c("coffee_beans", 1, "brew")]),
    "deli_coffee": (False, "cup", [c("coffee_beans", 1, "brew")]),
    "latte": (True, "cup", [c("coffee_beans", 1, "brew"), c("milk", 1, "steam")]),
    "tea": (False, "cup", [c("tea_leaves", 1, "brew")]),
    "iced_tea": (False, "cup", [c("tea_leaves", 1, "brew"), c("sugar"), c("ice")]),
    "juice": (False, "cup", [c("oranges", 3, "chop>blend"), c("ice")]),
    "smoothie": (False, "cup", [c("banana", 1, "blend"), c("berries", 1, "blend"), c("yogurt", 1, "blend"), c("ice", 1, "blend")]),
    "pastry": (False, "plate", [c("pastry_dough", 1, "bake")]),
    "bagel": (True, "plate", [c("bagel", 1, "toast"), c("cream_cheese")]),
    "bread": (False, "bag", [c("flour", 3, "mix>bake"), c("salt", 1, "mix>bake"), c("butter", 1, "mix>bake")]),
    "donut": (True, "bag", [c("flour", 1, "mix>fry"), c("sugar", 1, "mix>fry"), c("egg", 1, "mix>fry"), c("sugar")]),
    "cake": (True, "plate", [c("flour", 3, "mix>bake"), c("sugar", 2, "mix>bake"), c("egg", 2, "mix>bake"), c("butter", 2, "mix>bake"), c("cream", 2), c("berries", 2)]),
    "dessert": (True, "cup", [c("ice_cream", 2), c("berries", 1), c("chocolate_syrup"), c("cream")]),
    "ice_cream": (False, "cup", [c("ice_cream", 2)]),
    "chips": (False, "bag", [c("chips_bag")]),
    "burrito": (True, "wrap", [c("tortilla", 1, "grill"), c("rice", 1, "steam"), c("beans", 1, "boil"), c("chicken", 1, "chop>grill"), c("salsa"), c("cheese"), c("sour_cream")]),
    "tacos": (True, "plate", [c("tortilla", 2, "grill"), c("pork", 1, "chop>grill"), c("onion", 1, "chop"), c("cilantro", 1, "chop"), c("salsa"), c("lime", 1, "chop")]),
    "quesadilla": (True, "plate", [c("tortilla", 1, "grill"), c("cheese", 2, "grill"), c("chicken", 1, "chop>grill"), c("tortilla", 1, "grill"), c("sour_cream", 1, "-", True)]),
    "ramen": (True, "bowl", [c("ramen_broth", 1, "boil"), c("ramen_noodles", 1, "boil"), c("pork", 1, "boil>chop"), c("egg", 1, "boil"), c("scallion", 1, "chop"), c("nori")]),
    "sushi_set": (False, "board", [c("rice", 2, "steam"), c("salmon", 1, "chop"), c("tuna", 1, "chop"), c("nori"), c("wasabi", 1, "-", True), c("soy_sauce", 1, "-", True)]),
    "teriyaki": (True, "plate", [c("rice", 1, "steam"), c("chicken", 1, "grill"), c("teriyaki_sauce"), c("broccoli", 1, "steam", True)]),
    "dumplings": (False, "basket", [c("dumpling_wrappers", 1, "steam"), c("pork", 1, "chop>steam"), c("cabbage", 1, "chop>steam"), c("soy_sauce", 1, "-", True)]),
    "fried_rice": (False, "plate", [c("rice", 1, "steam>wok"), c("egg", 1, "wok"), c("peas", 1, "wok"), c("carrot", 1, "chop>wok"), c("soy_sauce", 1, "wok"), c("scallion", 1, "chop")]),
    "chow_mein": (False, "plate", [c("noodles", 1, "boil>wok"), c("chicken", 1, "chop>wok"), c("cabbage", 1, "chop>wok"), c("carrot", 1, "chop>wok"), c("soy_sauce", 1, "wok")]),
    "kung_pao": (False, "plate", [c("chicken", 1, "chop>wok"), c("peanuts", 1, "wok"), c("chili", 2, "chop>wok"), c("bell_pepper", 1, "chop>wok"), c("soy_sauce", 1, "wok"), c("rice", 1, "steam", True)]),
    "soup": (False, "bowl", [c("broth", 2, "boil"), c("carrot", 1, "chop>boil"), c("onion", 1, "chop>boil"), c("potato", 1, "chop>boil"), c("salt")]),
    "pad_thai": (False, "plate", [c("rice_noodles", 1, "boil>wok"), c("shrimp", 1, "wok"), c("egg", 1, "wok"), c("fish_sauce", 1, "wok"), c("bean_sprouts"), c("peanuts", 1, "chop"), c("lime", 1, "chop")]),
    "green_curry": (False, "bowl", [c("curry_paste", 1, "boil"), c("coconut_milk", 1, "boil"), c("chicken", 1, "chop>boil"), c("bell_pepper", 1, "chop>boil"), c("basil"), c("rice", 1, "steam", True)]),
    "pho": (True, "bowl", [c("rice_noodles", 1, "boil"), c("beef_slices"), c("broth", 2, "boil"), c("bean_sprouts"), c("basil"), c("lime", 1, "chop")]),
    "banh_mi": (True, "plate", [c("baguette", 1, "toast"), c("mayo"), c("pork", 1, "grill"), c("carrot", 1, "chop"), c("cucumber", 1, "chop"), c("chili", 1, "chop"), c("cilantro")]),
    "tikka_masala": (False, "bowl", [c("chicken", 1, "chop>grill"), c("tikka_sauce", 1, "boil"), c("cream"), c("rice", 1, "steam", True)]),
    "naan": (True, "basket", [c("naan_dough", 1, "bake"), c("butter"), c("garlic", 1, "chop")]),
    "bibimbap": (True, "bowl", [c("rice", 1, "steam"), c("beef_slices", 1, "saute"), c("spinach", 1, "saute"), c("carrot", 1, "chop"), c("bean_sprouts", 1, "boil"), c("egg", 1, "saute"), c("gochujang")]),
    "korean_bbq": (False, "plate", [c("beef_slices", 2, "grill"), c("lettuce", 2), c("garlic", 1, "chop"), c("gochujang"), c("rice", 1, "steam", True)]),
    "pasta_dish": (True, "plate", [c("pasta", 1, "boil"), c("tomato_sauce", 1, "boil"), c("garlic", 1, "chop>saute"), c("parmesan"), c("basil")]),
    "risotto": (True, "bowl", [c("arborio", 1, "boil"), c("broth", 1, "boil"), c("mushroom", 1, "chop>saute"), c("butter"), c("parmesan")]),
    "pizza": (True, "board", [c("pizza_dough", 1, "bake"), c("tomato_sauce", 1, "bake"), c("mozzarella", 2, "bake"), c("basil")]),
    "pizza_slice": (False, "plate", [c("pizza_slice_baked", 1, "bake")]),
    "shawarma": (True, "wrap", [c("pita", 1, "grill"), c("lamb", 1, "grill"), c("tomato", 1, "chop"), c("onion", 1, "chop"), c("pickles"), c("tahini")]),
    "falafel": (True, "wrap", [c("pita", 1, "grill"), c("chickpeas", 2, "mix>fry"), c("lettuce", 1, "chop"), c("tomato", 1, "chop"), c("tahini")]),
    "oysters": (False, "plate", [c("oysters", 1, "chop"), c("lemon", 1, "chop"), c("hot_sauce", 1, "-", True)]),
    "fish_and_chips": (False, "basket", [c("fish_fillet", 1, "fry"), c("flour", 1, "mix>fry"), c("tartar_sauce", 1, "-", True), c("lemon", 1, "chop", True)] + FRIES),
    "clam_chowder": (False, "bowl", [c("clams", 1, "boil"), c("potato", 1, "chop>boil"), c("onion", 1, "chop>boil"), c("cream", 1, "boil"), c("butter", 1, "boil")]),
    "crab": (False, "plate", [c("crab", 1, "steam"), c("butter", 1, "micro", True), c("lemon", 1, "chop", True)]),
    "meal": (False, "plate", [c("chicken", 1, "grill"), c("potato", 1, "chop>bake"), c("broccoli", 1, "steam"), c("butter"), c("salt")]),
}

# The costs above are what a unit sells for wholesale; a kitchen pays about twice that once
# delivery, spoilage, trim and San Francisco's markups are in (approx.).
COST_SCALE = 2.2

RULES_BLOCK = {
    "basis": "the restaurant game (docs/city/kitchen.mjs): a food shop's kitchen, worked by its staff. An ingredient's cost is wholesale, set so a dish's ingredients come to about 28-38% of its menu price (the usual US restaurant food-cost share, approx.). Process seconds are real seconds of play, kept short on purpose; doneness is right within ±15-20% of a process's time, raw well under it and burnt well over it. Tips are a share of the ticket by how well it was made (US restaurant norms of 15-20% for good service, approx.), and a little more for something on the house; the house pays for what it gives away.",
    "processes": PROCESSES,
    "heat": HEAT,
    "stations": STATIONS,
    "kitchens": KITCHENS,
    "ingredients": {k: {"name": v[0], "unit": v[1], "cost": round(v[2] * COST_SCALE, 2), "kept": v[3], "role": v[4], "stamina": v[5], "health": v[6], "taste": v[7], "tags": v[8], "raw_ok": v[9], **({"times": v[10]} if v[10] else {})} for k, v in ING.items()},
    "recipes": {k: {"ordered": v[0], "vessel": v[1], "build": v[2]} for k, v in RECIPES.items()},
    "doneness": {"raw_below": 0.5, "right": [0.82, 1.2], "burnt_above": 1.65},
    "score": {"weights": {"ingredients": 34, "processes": 20, "doneness": 20, "order": 10, "portions": 8, "speed": 8}},
    "tips": {"by_score": [[0, 0], [40, 0.03], [60, 0.1], [75, 0.15], [88, 0.2], [96, 0.25]], "comp_lift": 0.05, "comp_lift_max": 0.12, "generosity": [0.7, 1.35]},
    "tickets": {"open_most": 5, "every_s": [30, 80], "patience_s": [80, 150], "per_item_s": 30, "items_most": 3, "mod_chance": 0.3, "player_patience_s": 240},
    "pantry": {"month_buffer": [1.1, 1.3], "player_start_portions": 30, "order_lead_hours": 12},
    "rating": {"start": 70, "warn_below": 45, "let_go_below": 30, "after_tickets": 12, "comp_share_ok": 0.06, "waste_share_ok": 0.05},
    "npc_cover": {"skill": [0.55, 0.85], "seconds_per_ticket": [25, 45]},
    "lab": {"max_components": 10, "markup": [2.6, 3.6], "accept_taste": 66, "decide_game_hours": 2, "proposals_most": 6, "menu_most": 6},
    "pairs_basis": "flavour pairs that lift a dish (tomato-basil, lime-chili...) and clashes that sink it (sweet desserts with fish); a test customer tastes these on top of the dish's balance",
    "pairs": [["tomato", "basil"], ["tomato", "mozzarella"], ["lime", "chili"], ["lime", "cilantro"], ["garlic", "butter"], ["beef_patty", "cheese"], ["bacon", "egg"], ["soy_sauce", "ginger"], ["soy_sauce", "scallion"], ["lemon", "fish_fillet"], ["lemon", "salmon"], ["chocolate", "berries"], ["banana", "chocolate"], ["coconut_milk", "curry_paste"], ["rice", "soy_sauce"], ["potato", "salt"], ["avocado", "lime"], ["mushroom", "parmesan"], ["cream_cheese", "salmon"], ["peanuts", "lime"], ["gochujang", "egg"], ["honey", "yogurt"], ["chili", "pork"], ["tahini", "lemon"], ["ice_cream", "chocolate_syrup"], ["coffee_beans", "milk"], ["maple_syrup", "bacon"]],
    "clashes": [["dessert", "seafood"], ["dessert", "korean"], ["dessert", "indian"], ["drink", "protein"]],
}


def main() -> None:
    text = RULES.read_text()
    line = '  "kitchen": ' + json.dumps(RULES_BLOCK, ensure_ascii=False, separators=(", ", ": ")) + ",\n"
    lines = text.splitlines(keepends=True)
    lines = [x for x in lines if not x.startswith('  "kitchen": ')]
    at = next(i for i, x in enumerate(lines) if x.startswith('  "real_estate": '))
    lines.insert(at, line)
    out = "".join(lines)
    json.loads(out)
    RULES.write_text(out)
    # Checks: every food shop's dish has a recipe its kitchen can make, with known ingredients.
    R = json.loads(out)
    K = R["kitchen"]
    food = [k for k, g in R["business"]["curve_by_kind"].items() if g == "food"]
    problems = []
    for kind in food:
        does = {p for s in K["kitchens"][kind] for p in K["stations"][s]["does"]}
        for dish in R["stores"]["kinds"][kind]["items"]:
            r = K["recipes"].get(dish)
            if not r:
                problems.append(f"{kind}: no recipe for {dish}")
                continue
            for ing, qty, proc, *side in r["build"]:
                if ing not in K["ingredients"]:
                    problems.append(f"{dish}: unknown ingredient {ing}")
                for p in proc.split(">"):
                    if p != "-" and p not in does:
                        problems.append(f"{kind}/{dish}: no station for {p}")
    for dish, r in K["recipes"].items():
        cost = sum(K["ingredients"][i]["cost"] * q for i, q, *_ in r["build"])
        price = R["items"][dish]["price"]
        share = cost / price
        low = 0.03 if K["ingredients"][r["build"][0][0]]["role"] == "drink" else 0.12
        if not low <= share <= 0.5:
            problems.append(f"{dish}: food cost {share:.0%} of {price}")
    print("\n".join(problems) or f"kitchen rules written: {len(ING)} ingredients, {len(RECIPES)} recipes, {len(KITCHENS)} kitchens")


if __name__ == "__main__":
    main()
