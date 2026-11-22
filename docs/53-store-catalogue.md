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

The survey checks 126 staples a US grocery carries, with salt, pepper and seven everyday spices;
75 of them are typical corner-store stock. All 126 are in the city and on the grocery's shelves,
and the 75 corner-store staples are at the corner store. 112 are drawn with an imported model and
3 with a kit model. These 14 still have no usable model anywhere searched:

| aisle | still to find |
|---|---|
| bakery | tortillas |
| meat & seafood | chicken breast (kit model) |
| frozen | ice cream pint, frozen vegetables, bag of ice |
| breakfast | maple syrup |
| pantry | rice, flour, baking soda |
| condiments | vinegar |
| snacks | gum (a labelled stand-in) |
| household | plastic wrap, zip bags |
| pets | dog food (a labelled stand-in) |

A second search ran over every Objaverse name, tag *and description* (800k models) with 24 sets
of terms (spice jars, shakers, tubs, cartons, meat trays, sacks, sauce jars, snack bags, pet
food). It found the hot-dog pack, salami, a film-covered meat tray (its contents painted raw
beef), a black frozen-dinner tray, a pretzel bag, a popcorn bucket, loose peanuts and a can of
nuts, a dog biscuit, a sauce jar (painted red), a cream-cheese tub (sour cream), a pint carton
(half and half), a soy-sauce-style bottle, a dressing bottle and a bagel. Bags of rice and
flour, a pint of ice cream, gum packs and plastic wrap turned up nothing usable: scans of the
contents (a heap of flour), toys or game props. For these, a generic package with the city's own
printed label is still the way.

**Spices.** The kitchen's 29 spices (rules items `jar_*`, sold by the jar at every grocery: salt
and pepper at the corner store too) are one imported glass shaker jar (CC-BY, Objaverse), its
contents painted the spice's own colour (`paint` in objects.json: paprika red, turmeric yellow,
oregano green, garlic powder cream...) and its cap white. Salt is a round canister and pepper a
grinder, their own imports. A spice aisle on the gondolas holds them.

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

The result is about 7 MB for the imports with their shelf tier and 10.4 MB for the whole object
set. Each model is fetched the first time it's drawn, never at start: a store's products when
you walk into it. The test budget for the set is 11 MB.

Files in the lab:

- `raw/imports/<asset>/`: each source, with `source.json` (download URL, licence, author, sha256).
- `source/import-sources.json`: the picks.
- `source/import-sizes.json`: sizes, finishes, drops and turns.
- `store-imports.json`: which item draws with which model, plus variants (a second chip brand, a
  milk carton next to the gallon) and the rejects with the reason for each.
- `tools/acquire_imports.py`: re-fetches the sources.

## Grocery rooms: produce, refrigerated aisles, checkouts (grocery-room.mjs)

A supermarket in the City (a `supermarket`, `grocery` or `greengrocer` at least 9 m wide with 9 m
of floor) is laid out as Codex's retail engine lays one out (`src/smc/interiors/stores/engine.py`,
docs/28), fitted to the City's shop room:

- **Checkouts across the front** on the side with more room beside the door: a self-checkout
  bank nearest the door (two kiosks a bay, an attendant's podium) and staffed lanes out to the
  wall, in the chain's mix (Codex's priors: Safeway 45% self-service, Whole Foods 50%, Trader
  Joe's none, an independent 25%). A lane is a belt counter with its divider rail, scanner glass,
  register screen and card terminal, a bagging well with a bag carousel, the lane light's pole
  and number, and the cashier's pocket behind it (staff stand there, shoppers do not). Its
  impulse rack faces the next lane's queue. The queue and a cross aisle run behind them.
- **Produce inside the door** on the other side: farm-stand tables with two stepped tiers each
  face, and a refrigerated produce case down the wall.
- **Refrigerated walls and a frozen aisle:** dairy in open multidecks down the produce side's
  wall, meat and seafood across the back (a gap at the stock room's door), drinks behind glass
  doors down the other wall and, in a room 15 m wide or more, an island of back-to-back glass-door
  freezers facing them (the frozen aisle); narrower, freezer doors on the wall.
- **Gondolas** front to back between them, packed from the walls, the way in from the door kept
  clear to the back and a cross aisle through long runs. Each aisle's sections follow the
  catalogue's (`aisles.mjs`): bakery, breakfast, pantry, spices, condiments, snacks, beer and
  wine, household, personal care, pharmacy, pets, shared out by how much shelf each wants. A
  numbered sign hangs over each aisle, department signs over the walls, strip lights down every
  aisle.
- **Stocked with the shop's own products** (`shelf-stock.mjs`): every shelf slot gets its section's
  products at their catalogue size, faced as a store faces them -- cans and small boxes stacked
  up to three, bottles and jars in a row, produce heaped two layers deep -- up to 7,500
  placements a room. They are drawn at each model's lowest tier (`low`, about 220 triangles,
  added to the store imports for this), one instanced mesh per product. A player's business
  shows only what it has in stock.
- Smaller groceries and corner stores keep the small shop's room (till by the door, glass-door
  drink coolers, gondolas, a fruit table) and now get the same real stock on those shelves.

Codex's fitted interiors (a shop with a published site layout, drawn by
`inferred-interiors/retail-fixtures.mjs`) get the same: the lane and kiosk as above, produce
bins as stepped farm-stand tiers, and their gondolas, cases and bins stocked with real products
through `globalThis.kerbsideStockShelf` (set by the City when its object kit runs; the engine's
coloured packs otherwise).

`docs/city/store-sheet.html` (`?w=22&d=20&door=0&name=Safeway&view=aisle|produce|checkout|cold|frozen|front|over`)
and `docs/city/fitted-sheet.html` draw them for checking by eye; `tests/city_grocery_room.test.mjs`
checks the program, that every shelf is reached from the door, the cashier's pocket and the stock.

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

1. ~~Map aisles to those fixtures.~~ Done (grocery-room.mjs, retail-fixtures.mjs).
2. ~~Fill each facing by its display type.~~ Done (shelf-stock.mjs).
3. Let the player pick an item up into the cart's `container` (each placement is already a known
   product at a known shelf spot).
4. Run the cart through `checkout`. `world.mjs cmd_checkout` already takes a cart of lines.
