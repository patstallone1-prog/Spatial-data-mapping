# 53 · Store catalogue and imported store products

What can be bought in the living city, in one list, and the store products redrawn with real models
imported from outside sources (not made by hand). It lays the groundwork for walk-in shopping: aisles,
stacked and displayed stock, a cart, the checkout, leaving.

- **The list:** `docs/city/catalogue.json`, written by `node scripts/build_store_catalogue.mjs` from
  `rules.json` and `objects.json`. Re-run it after either changes.
- **The models:** `docs/city/objects.json` and `docs/city/models/objects/imp-*.glb`, written by
  `scripts/build_city_objects.mjs` from the object lab (`~/Documents/Kerbside-object-lab-2026-11-13`).
- **A look at them:** `docs/city/objects-sheet.html` draws every imported item the way the city draws
  it (catalogue size, near tier). `?only=milk,eggs`, `?tier=far` and `?all=1` (every item with a
  model) narrow or widen it.

## What can be bought (catalogue.json)

| | count | where |
|---|---:|---|
| Shop items (goods) | 302 | `items` (price, tax class, shops that sell it, aisle, display, model) |
| Services | 20 | `items` with `service` (haircut, oil change, hotel night, …) |
| Sold in at least one kind of shop | 308 | `items[].sold_at` |
| Drawn with a model | 205 | 102 of them imported here |
| Vehicles | 11 | `vehicles` (new price and a five-year-old's) — **skipped for models**, the fleet draws them |
| Homes and premises | per m² by use and county | `homes` (a 90 m² SF home ≈ 972,000, rent ≈ 3,645 a month) — **skipped**, the buildings are the model |
| Business licences, storefront lease | 3 licences, 3,000 a week | `business` |
| Kitchen ingredients (wholesale) | 113 | `kitchen_ingredients` — restaurant food is **skipped** for models |
| Shop fixtures (never sold) | 3 | `fixtures`: shopping cart, basket, checkout counter |

Each item has a `model.status`. `imported` means the product's own model, brought in here.
`generic_match` and `representative` are the lab's kit models (Kenney, Poly Haven). `composed` items
are built from kit pieces. `label_required` is a kit can or carton tinted the product's colour.
`gap`, `reference_only` and `none` are drawn by the page's own shape.

## Staples added

80 new items in `rules.json`, at late-2026 San Francisco prices. Food is `groceries` (untaxed);
household and personal care, and carbonated drinks, are `taxable`.

- **Produce:** oranges, lemons, limes, avocados, tomatoes, onions, potatoes, carrots, lettuce, pears,
  strawberries, garlic, grapes, bell peppers, cucumbers.
- **Dairy and meat:** butter, cream cheese, sour cream, half and half, ground beef, bacon, deli meat,
  hot dogs.
- **Bakery and pantry:** tortillas, hamburger buns, rice, flour, sugar, salt, black pepper, olive
  oil, canned soup, beans, tuna and tomatoes, pasta sauce, broth, baking soda.
- **Breakfast:** peanut butter, jam, honey, oatmeal, pancake mix, maple syrup, tea, hot cocoa,
  instant coffee.
- **Condiments:** ketchup, mustard, mayonnaise, hot sauce, soy sauce, salad dressing, vinegar.
- **Snacks:** crackers, cookies, nuts, popcorn, pretzels.
- **Drinks:** orange juice, sparkling water, juice boxes.
- **Frozen:** ice cream (pint), frozen vegetables, frozen meals.
- **Household:** toilet paper, paper towels, dish soap, laundry detergent, sponges, bleach, foil,
  plastic wrap, zip bags.
- **Personal care:** toothbrush, bar soap, deodorant, pads and tampons, diapers.

All of them are on the grocery's shelves, and the corner store carries the usual corner-store
subset. Liquor stores, pharmacies and general stores picked up a few each.

`rules.json` also has a new `fixtures` table: the shopping cart (120 kg, 80 slots), the basket
(15 kg, 20 slots) and the checkout counter. Fixtures are filled and left behind, never sold. The
cart and basket carry `container` data in the same shape as an item's.

Loose produce (`apple`, `oranges`, …) is now sold by the few. Two to six real-size pieces are set
out together, and `length_m` is the span of that group, so an apple is apple-sized. The old single
"Apples" model scaled one apple up to 20 cm.

## Grocery survey (catalogue.json `grocery_survey`)

The survey checks 119 staples a US grocery carries; 74 of them are typical corner-store stock. All
119 are now in the city and on the grocery's shelves. The 74 corner-store staples are all at the
corner store. 91 are drawn with an imported model and 4 more with a kit model. These 28 still need a
model:

| aisle | imported | still to find |
|---|---:|---|
| produce | 16 / 16 | — |
| dairy | 7 / 9 | sour cream, half and half |
| bakery | 2 / 4 | tortillas, bagel |
| meat & seafood | 2 / 6 | chicken breast (kit), ground beef, deli meat, hot dogs |
| frozen | 1 / 5 | ice cream pint, frozen vegetables, bag of ice, frozen meals |
| breakfast | 9 / 10 | maple syrup |
| pantry | 11 / 15 | rice, flour, pasta sauce, baking soda |
| condiments | 4 / 7 | soy sauce, salad dressing, vinegar |
| snacks | 5 / 9 | gum, nuts, popcorn, pretzels |
| drinks, alcohol, personal care, pharmacy | all | — |
| household | 10 / 12 | plastic wrap, zip bags |
| pets | 1 / 3 | dog food, pet treats |

Packaged meat, frozen boxes and the dry-goods bags were searched for and nothing usable was found.
The search covered all of Objaverse's 800k model names and tags, plus Google Scanned Objects, YCB
and Poly Haven. For these, a clean generic package model (a tray, a carton, a bag) with a printed
label texture is the next step. Unlike a scan, that label could carry the city's own brand.

## Where the models come from

109 imported models. Licences: 100 CC-BY 4.0 and 9 CC0. Sources:

- **Objaverse (Sketchfab), 85.** Picked by eye from contact sheets of up to 16 candidates per product.
  Only CC-BY and CC0 models were considered, and no animated ones.
- **Poly Haven, 9 (CC0).** Apple, banana, lemon, lime, avocado, onion, bleach, trash bag, hamburger buns.
- **Google Scanned Objects, 8.** Cereal, Nesquik, Nescafé, iced tea, sponges, light bulbs, vitamins,
  milk of magnesia.
- **YCB, 7.** Orange, strawberry, sugar, tomato soup, tuna, mustard, crackers.

Every CC-BY model is credited in `objects.json` `attributions` with its title, author, page and
licence; a test checks this. Before release, those attributions need to appear somewhere players can
see them, such as a credits screen.

**Trademarks.** Many scans and models show real packaging: Tide, Monster, Lay's, Doritos, Oreo,
Snickers, Chobani, Quaker, PG Tips, Duracell, Philips, Colgate, Axe, Tylenol, Nescafé, Brisk, iPhone,
and others. The licences cover the 3D models, not the brands printed on them. That is fine for
development; before a commercial release, these should be relabelled with the city's own brands or
cleared.

## How they were made to fit

`tools/optimize_imports.mjs` in the lab:

- **Scale and pivot:** metres, Y up, bottom-centre pivot, scaled so the longest side is the product's
  real size.
- **Triangles:** near tier ≤ 2,000, mid ≤ 700, far ≤ 220 (the source models ran up to 205,000).
  Faceted sources are welded without normals before simplifying. Pieces too loose to simplify (leaf
  heaps, wire baskets) get a sloppy pass.
- **Colour, one policy for the whole shop:**
  - Only the base-colour texture is kept. Normal, occlusion, metal/rough and emissive maps are dropped.
  - A texture whose used area is dark (HSV value under 0.36, sampled at the model's own UVs, so atlas
    margins don't count) is lifted toward 0.52. Things that really are dark are exempt: avocados,
    cucumbers, black bags, dark bottles, phones, deodorant.
  - A texture with saturation over 0.9 is toned down 10%.
- **Finish:** never metallic, because with the city's light a metal can goes black. Roughness is set
  by what the thing is: glass 0.18, can 0.35, plastic 0.42, food 0.65, paper 0.85.
- **Glass:** no transmission (it doubles the draw); see-through glass is alpha-blended instead.
- **Other conversions:**
  - Specular-glossiness materials are converted to metal-rough.
  - Spare UV sets, tangents and skins are removed.
  - Ground planes and display boards are dropped (`drop` per model).
  - A bottle modelled lying down is stood up (`turn`).
- **City build:** `build_city_objects.mjs` halves textures to 256 px WebP and meshopt-compresses.

The result is 5.6 MB for the imports and 8.9 MB for the whole object set. Each model is fetched the
first time it's drawn, never at start. The test budget for the set rose from 6 to 9 MB.

Files in the lab:

- `raw/imports/<asset>/`: each source, with `source.json` (download URL, licence, author, sha256).
- `source/import-sources.json`: the picks.
- `source/import-sizes.json`: sizes, finishes, drops and turns.
- `store-imports.json`: which item draws with which model, plus variants (a second chip brand, a
  milk carton next to the gallon) and the rejects with the reason for each.
- `tools/acquire_imports.py`: re-fetches the sources.

## Toward walk-in shopping

`catalogue.json` gives each of the 138 store items an **aisle** and a **display**:

- **Aisles:** produce, bakery, dairy, meat & seafood, frozen, breakfast, pantry, condiments,
  snacks, drinks, alcohol, household, personal care, pharmacy, pets, checkout.
- **Displays:**
  - `stack`: boxes and cans in columns
  - `row`: bottles and jars
  - `bin`: heaped produce
  - `cooler` / `freezer`: behind glass doors
  - `peg`: hung cards
  - `floor`: heavy jugs and multipacks
  - `rack`: papers
  - `counter`: at the till

`objectKit.instanced(sku, n)` already draws n of one product as one instanced mesh per part, so a
shelf facing of 12 is one draw call. The inferred retail interiors already have gondolas, produce
bins, coolers, freezer cases and checkout lanes (`docs/inferred-interiors/retail-fixtures.mjs`).
What is left:

1. Map aisles to those fixtures.
2. Fill each facing by its display type: stack heights from the model's `dims`, rows one deep and
   several back.
3. Let the player pick an item up into the cart's `container`.
4. Run the cart through `checkout`. `world.mjs cmd_checkout` already takes a cart of lines.
