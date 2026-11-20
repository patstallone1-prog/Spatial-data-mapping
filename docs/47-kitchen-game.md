# The kitchen: Kerbside's restaurant game

This is how a player works in a food shop as an employee. It runs on the city's own systems:
- the shop's owner (a player, or a resident NPC);
- the shop's books;
- its NPC customers, and the players who buy at its counter.

| Piece | File |
| --- | --- |
| Rules as data | `docs/city/rules.json` → `kitchen` (written by `tools/build_kitchen_rules.py`) |
| World side (pure, on `CityWorld`) | `docs/city/kitchen.mjs` |
| The game in the page (controls, HUD) | `docs/city/kitchen-panel.mjs` |
| The 3D kitchen (room, counters, stations, cook, food models) | `docs/city/kitchen-3d.mjs` |
| Low-poly models (CC0) | `docs/city/models/kitchen/` |
| Tests | `tests/city_kitchen.test.mjs` |

## Getting in

Take a cook, server, barista or baker job at any food shop (the Shop's Jobs tab), then clock in there.

The action bar and the to-do list offer **Work the kitchen**. The owner of a player business can open their own kitchen at any time.

## The line

- **Tickets** come in from the front.
  - They come faster at rush hour, and none come while the shop is shut.
  - A ticket is a main dish, perhaps with a side and a drink, and sometimes with an ask ("NO TOMATO", "EXTRA CHEESE").
  - Each ticket shows takeout or sit-down service, a full-tip window and a walkout countdown. Its window accounts for components, batch sizes, shared preparation steps, extra courses and the pace of the restaurant. After the target time, tip potential falls continuously until the customer leaves.
  - A player who buys a dish at the counter while a cook is on the line becomes that cook's ticket. That player can tip the cook from their to-do list.
- **The room.** The kitchen is an animated 3D room. Your cook stands between two counters:
  - the **front counter** holds bins of the menu's ingredients, the work surface, the cutting board, the mixing bowl and the pass (left, under heat lamps);
  - the **back counter** holds the stations; the fridge and freezer stand on the left and the dry-goods rack on the right.
  - Its look follows the kind of restaurant: fast food (red and white tiles, steel), café (planks and wood), fine dining (slate, marble, brass pendants), Asian (dark wood, red lanterns) and Indian (terracotta and copper). The ingredients and stations give it the rest of its character.
- **Moving.** Click where to go, or walk with WASD or the arrows. A click on anything walks the cook there first, then acts.
- **Fetching.** Click a labeled bin, or walk up to it and press E. Enter a count for pieces such as eggs and lettuce leaves, or grams for loose ingredients such as flour and liquids such as water. The fridge, freezer and shelves list their stock. B opens the pantry list and selecting an ingredient walks you to it. You can return an untouched withdrawal.
- **Putting down.** Click the work surface. If you drop within 14 cm of food already there, it snaps onto that food and stacks on top; further away, it starts a new pile. You can keep several things going at once.
- **Selecting.** The first click on a pile selects the whole product; the second selects one thing inside it; the third takes that thing out. E or Space picks up what is selected, or puts down what you hold. Q or Delete bins it (logged as waste).
- **The stations** depend on the kind of restaurant (`kitchen.kitchens`).
  - An American kitchen has a flat-top grill, a deep fryer, a stove, an oven, a blender and drink taps. A Chinese kitchen has a wok, a steamer and a kettle. A pizzeria has a pizza oven.
  - Click a station while holding food to put it on. A station that does more than one thing (the grill toasts or grills) asks which.
  - A cooking bar floats over the food, with a green window (82–120% of the time) and a red burnt zone. The food changes colour and steams or sizzles as it cooks. One click takes it off.
  - On the board, each click is a chop; five chops and it is chopped.
  - Load ingredients into the bowl or blender, then click the station to start. A finished batch travels together and is weighed in grams. Set it on the work surface, select it and choose **Take a portion** to weigh out part of it. Each portion retains its share of every ingredient and all prior preparation steps. The cooling rack and chiller support successive stages, including baking, cooling, adding toppings, then chilling the assembled dish.
- **The plate** is the pile, bottom first. Put it on the pass, pick the ticket on the rail, and serve. The side card shows the recipe, ticks off what is already on the pass, and estimates the score.
- **On the house**: you can slip in up to three sides or drinks. Each one lifts the tip by 5 percentage points (12 at most), but its cost is logged against you.

### Scoring a plate (`scorePlate`)

| Part | Weight |
| --- | --- |
| Right ingredients | 34 |
| Right processes | 20 |
| Doneness | 20 |
| Build order (for built dishes) | 10 |
| Portions | 8 |
| Speed | 8 |

Raw meat, egg or dough caps the score at 15, because it isn't safe to eat.

### Tips (`tipFor`)

| Score | Share of the ticket |
| --- | --- |
| Under 40 | 0% |
| 40 | 2% |
| 60 | 10% |
| 75 | 15% |
| 88 | 20% |
| 96 and up | 25% |

Each customer's generosity scales the tip by 0.7–1.35. After the full-tip window, the remaining share decreases to zero at the walkout deadline. Paid player orders keep their manual tip.

## The pantry is finite

- **A resident's shop**: its owner orders the month's ingredients at the start of each month. The order is the shop's typical week as a month of sales, plus 10–30% to spare. The first month is prorated.
- **A player's business**: the owner orders by the ingredient in the Owner tab, or by the dish with `order_stock`, which becomes ingredients. It arrives within 12 game hours.
- **NPC customers**: the hourly shop model's customers eat from the same pantry. A dish the pantry can't make is sold out for everyone.
- **Losses**: waste, comps and lab tests all go into the shop's cost of goods (`today.waste`, `today.comps`, `today.lab`), so profit falls.

## Your employee rating (`ratingOf`)

The rating is built from:
- your average plate;
- the share of customers you kept;
- comps over 6% of your sales, which pull it down;
- waste over 5% of your sales, which pull it down.

A resident owner reacts after 12 tickets:
- below 45, they give you a warning;
- below 30 after a warning, they let you go.

A player owner sees each cook's record and rating in the Owner tab.

## Cover, and the lab

**Hand the line to an NPC cook.** The NPC cooks the open tickets at their own skill. You get no tip from those tickets, but the sales still count.

**The lab** works like this:
1. Use the same pantry and stations to make anything you like.
2. Serve it free to a customer as a test.
3. The test (`tasteOf`) returns a taste score and what the dish does for stamina and health, and suggests a fair price.
   - The lab reports estimated kcal and grams for the entire portion, a flavor profile and a taste score. It combines ingredient-specific energy densities and edible weights with the ordered techniques. For example, rice gains water as it steams, dry heat removes moisture, frying adds oil, and chilling a cooled dish mutes its sweetness. These are gameplay estimates.
   - The lab compares ingredient proportions and preparation with the 59 house recipes and this kitchen’s learned dishes. A small variation keeps its familiar name. Enter a name for a new creation before serving the test.
4. Put the dish to the owner, at a price you suggest.
   - A resident owner decides after 2 game hours. They accept a dish that tastes 66 or more, at your price if it falls between 2.2× and 5× its cost.
   - A player owner decides in their Owner tab.

An accepted dish becomes one of the city's items. From then on:
- it is sold at the counter;
- customers order it on tickets;
- NPC cooks make it when they cover;
- the hourly model sells it according to how good it is.

## The models

- The food (97 models) and the furniture-style appliances (stoves, oven, microwave, blender, espresso machine, toaster, fridges, sink, cabinets, shelves, bin, lamps, plants) are Kenney's Food Kit and Furniture Kit, CC0 (www.kenney.nl); their licences are in `docs/city/models/kitchen/*/License.txt`.
- No CC0 low-poly fryer, griddle, pizza oven, tandoor, wok burner or drinks fountain was found. These are built in code in the same flat-shaded style. Leads for later: OpenGameArt's CC0 cookware packs (opengameart.org/node/134200, /132508); paid models exist on CGTrader, Free3D and Fab.
- Food is drawn at 1.35× life size so a stack reads from the camera.

## Saving, and the server

- **Saving**: kitchens are saved in the world's JSON as `kitchens`.
- **Privacy**: the server's per-player view (`server/city/views.mjs`) shows a cook only their own tickets, board, tests and record. The owner sees everything.
- **Trust**: the cooking itself happens in the page. The world validates quantities and available techniques and measures service delay on the world clock. It takes the page’s word on station doneness.
