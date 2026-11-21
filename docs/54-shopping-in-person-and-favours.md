# 54 · Shopping in person, people who find their way, and favours

Three parts of the City's gameplay, built on what was already there:

- **P0, physical shopping.** You pick things off the shelf, carry them, and pay at a till. The shop's stock really moves, and so does ownership.
- **P2, NPC spatial awareness.** NPCs find their way round interiors, keep clear of one another, queue, and replan around a blocked way before they reach it.
- **Favours.** You can ask NPCs for help. They weigh the request, and when they help it costs them time.

## What was there, and what is reused

| Already built | How it is used now |
| --- | --- |
| `world.mjs` `cmd_checkout` (the ledger, sales tax, `stockCheck`/`soldHere`, carry limits) | Every till payment goes through it. Its new `overflow: "bag"` option bags whatever will not fit and leaves it at the door; it no longer refuses. |
| `enterprise.mjs` `storesHere`/`priceAt`/`tillOf`, `b.stock` | Shelf availability for a player's business is `b.stock` minus what other shoppers have in their baskets. |
| `rules.json` `fixtures.shopping_basket` / `shopping_cart` containers | Basket: 15 kg, 20 things. Cart: 120 kg, 80 things. |
| `shelf-stock.mjs` placements, `grocery-room.mjs` `lanePoints`, self-checkout kiosks | Each drawn product is something you can take. The lanes and kiosks are the tills. |
| `store-room.mjs` `canWalkStore` | The walkable grid for NPCs indoors. |
| `temperament.mjs`, `social.mjs` standing, `fleet.mjs` `planOf` (read only) | The inputs a favour is weighed on. |
| `server/npc` ("a decision is never the model's") | DeepSeek voices the favour decision, as the banker voices a loan decision. |
| The view's `holdWalk` (walk lag) | The time an NPC spends on a favour is lost from their day, so they really arrive late. |

## Shopping in person

**World side: `docs/city/shopping.mjs`**, installed on CityWorld. Its commands:

- `shop_carrier`: take a basket or a cart.
- `shelf_take` and `shelf_return`.
- `pay_lane`: pay at a staffed lane or at self-checkout. Anything that needs ID wants a staffed lane.
- `trolley_leave`: walking out puts unpaid goods back.

**Stock and ownership:**

- A thing in your basket still belongs to the shop, but it is counted off the shelf, so nobody else can take it.
- When you pay, it becomes yours and goes into your inventory.
- A resident shop faces 24 of each item and restocks 8 an hour.
- A player's business sells only what it has on hand.
- Shelf state is saved with the world (`shelves`).

**Page side: `docs/city/shop-floor.mjs`:**

- **Taking:** the products drawn on the shelves are registered as you enter. G takes the one in front of you, and it disappears from the shelf. When the room is built again, what has already been taken is drawn as gone.
- **Baskets and carts:** taken by the door, then held in front of you (the imported basket and cart models).
- **Paying:** Enter pays at the till you are standing at.
  - Lane 1 is always staffed. More lanes open through the busy hours.
  - Self-checkouts are always open.
  - A small shop's counter works as a till too.
- **Codex's fitted interiors:** they register their shelves through `kerbsideStockShelf`, and their tills through a new `kerbsideTill` hook in `retail-fixtures.mjs`.

**Removing the shop button:**

- In a store you walk round, the clerk no longer links a catalogue. They point you to the baskets and the till.
- If the shop sells things with no shelf model, they are offered as "what's behind the counter".
- The shop panel drops its list of wares and its basket, but keeps services, jobs, deliveries and the business.
- Shops you cannot enter keep the panel.

## Finding the way: `docs/city/npc-steer.mjs`

- **`NavGrid` / `storeNav`:** the room's floor as 0.3 m squares, with an 8-way A* search, and paths pulled straight where they are clear and uncrowded.
- **`steer`:** moves NPCs toward their next waypoint and keeps them apart. Two walking head on each step a little to their right.
  - **Looking ahead:** an NPC slows behind someone standing or queuing in its way.
  - **Replanning:** every 0.7 s held, it plans again round everyone standing near.
  - **Giving up:** after 6 s it is marked `stuck`.
- **`task` / `runTask`:** multi-step tasks. A step that cannot be reached is tried again, then swapped for an alternative (another shelf, or another till with a shorter line), then skipped.
- **`Queue`:** a line a pace apart behind a till. It bends round where the floor runs out. You join the line when you stand at a till.
- **In your shop:**
  - Shoppers visit 2 to 4 shelves, reaching toward them, then queue, pay and leave, and start another round.
  - Staff go to the lanes' cashier spots. Any staff beyond those fetch stock from the back and stock shelves.
- **On the street (`swerveAhead`, `doorHolds`, in the view's people loop):**
  - Walkers step round someone standing within 3.2 m ahead, to the side with room. They never step into the road or into a building.
  - People going the same way through a door go one at a time.

## Favours: `docs/city/npc-favours.mjs` and `favour-run.mjs`

**What can be asked:**

| Favour | Size | Minutes |
| --- | --- | --- |
| step aside | 0.15 | 0.5 |
| hold the door | 0.1 | 0.3 |
| wait | 0.35 | 2 |
| carry | 1 | 6 (adds 25 kg to what you can carry) |
| come along | 1.2 | 8 |
| a lift | 2.2 | 15 (the ride is theirs, with no fare) |
| furniture | 3 | 30 (adds 45 kg) |

**How it is weighed: `weighFavour`.** The score starts at 0.18, and these move it:

- **Willingness**, from temperament:

  ```
  0.95 × (0.36·care + 0.3·civic + 0.2·patience + 0.14·(1 − temper))
  ```

- **How well they know you:** an acquaintance adds 0.07, a familiar face 0.16, a friend 0.32.
- **The size of the ask** costs `0.17 × size`. Momentary asks get 0.15 back.
- **What they are doing**, taken from their day plan (`onTheirWay`).
  - Being on shift outweighs anything but a moment's ask.
  - On the way to work, the cost grows when the ask would make them late.
  - Errands and leisure cost little.
- **Money offered** adds up to 0.42, against what their time is worth.
- **Fatigue:**
  - −0.13 for each favour they have done today.
  - −0.11 for each time you have asked again.
  - A grudge if you made them late.
- **Limits:** the old don't move furniture, and minors don't drive.

**Verdicts:**

- **help:** 0.55 or more.
- **argue:** 0.30 or more, with terms: a sum, or "only if it's shorter". "Offer ₡X" asks again with that sum.
- **refuse:** 0.10 or more.
- **ignore:** below that.

**In the world:**

- `cmd_ask_favour` decides and records the favour (`p.favour`). It pays any tip into the resident's account, and adds carry capacity for as long as the favour lasts.
- `cmd_favour_done` records the minutes held and works out the cost to them:
  - Late for work by more than 15 minutes: docked pay.
  - Late by 5 to 15 minutes: a word from the manager.
- Lateness over 10 minutes leaves a grudge against you that fades by half each day.

**On the page:**

- The talk box spots an ask in what you type, and has quick-ask buttons.
- `favour-run.mjs` walks the favour through:
  - They step aside, wait, or come along with you, carrying.
  - Their own walk is held meanwhile, which is what makes them late.
  - "That's all, thanks" ends it, and they walk back to their day.
- **A lift:** the taxi machinery brings their car, the ride is free, and getting out ends the favour.

**DeepSeek's part: `server/npc`.**

- The server reads the decision from its own world. Its task voices that decision and is told not to change it.
- When the model hears an ask the word rules missed, it tags its reply `[[favour:kind]]`. The page then puts that ask to the world.
- With no model, a set line in the character's tone says the decision.

## Checked

- **Unit tests:**
  - `tests/city_shopping.test.mjs`
  - `city_shop_floor.test.mjs`
  - `city_npc_steer.test.mjs`
  - `city_npc_favours.test.mjs`
  - `city_npc_talk.test.mjs` (a new favour test)
- **In a browser:** `docs/city/shop-floor-sheet.html`.
  - It ran the real room, stock, world, basket model and shoppers.
  - Three items came off the shelves, and ₡8.00 was paid at lane 1.
  - The shelf counts dropped, the shoppers moved through the aisles, and lines formed at the tills.

## Left

- **Not yet walked in the running game:** the page modules and the Marina regions are not in this worktree.
- **Shoplifting:** walking out returns the goods. Leaving with them unpaid is not yet theft.
- **The stockers:** NPC stockers walk to the shelves, but the restock itself is timed in the world. A stocker does not refill the exact gaps you made.
- **A lift** uses a taxi model for the NPC's car.
