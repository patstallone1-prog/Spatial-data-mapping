# Kerbside V2 — every player action, and its control

This is the full list of what a player does in the V2 vision, section by section. For each
action it gives the control that does it in the viewer, the world command behind it
(`docs/city/world.mjs`, `CityWorld.submit`), and whether it is built yet.

**How controls are chosen**

* **A key** is for something done often, or while moving: walking, sprinting, the car, shopping,
  picking up.
* **An action-bar button** is shown for each of those keys, but only when the action is
  possible where you stand. "Shop: Café" appears beside a café; "Board the bus" appears when a
  bus is within reach. This makes everything playable on a touch screen too.
* **A window** is for choosing between several things: the shop counter (B), your things (I),
  buses and taxis (T), errands (K), homes on the market (O), the controls (H).
* **The City panel** (the "City" button, or the money pill at the bottom) is for records and
  rare actions: money, job, car, bills, taxes, laws, people.

The keys avoid what the viewer already uses:

* F: first person
* E: edit the exterior
* S: what is under the pointer
* R: back to where you are
* Enter: doors
* Arrows: walk
* PageUp / PageDown: levels
* 1 / 2 / 3: pins
* Delete / Backspace: delete a pin
* Esc: close a window

Status:

* **Live**: in the viewer now.
* **Core**: in the rules and world code, without its own control yet.
* **Planned**: not built.

## The two modes

A switch at the top left, beside the menu button, sets the mode. The choice is remembered on
this device.

* **Explore:** the map. The sidebar ("☰ Map") holds search, directions, first person, the free
  view (E), Reset view and Play together. The city's bars, its action buttons and its keys are
  off.
* **City:** the game. The sidebar ("☰ City") holds the city panel (you, your wallet, job, home,
  car, the laws). The bars and action buttons show, and the keys below act. Directions and the
  free view are put away. Pressing E switches back to Explore.

The people and the traffic are out in both modes.

## The keys

| Key | Action | Bar button shown when |
|---|---|---|
| Arrows | Walk; at the wheel, accelerate, brake and steer | always |
| Shift (hold) | Sprint, while stamina lasts | always ("Sprint", held) |
| Click | Go there; on a bridge, onto the deck you clicked | — |
| PageUp / PageDown | The level above or below the same spot | — |
| B | Go into the shop beside you (its room: counter, shelves, staff); inside, the counter | within 30 m of a store ("Go in"); inside ("The counter") |
| Esc | Close a window; inside a shop, leave it (or walk out of the front) | inside a shop ("Leave the shop") |
| G | Pick up what lies at your feet (it has a yellow ring) | within 3 m of something |
| I | Your things: in your hands, bag (hold, use, wear, put down, give), vehicles, homes, money | always ("Bag") |
| X | Strike what is in front of you with what is in your hands (fists if nothing) | a breakable thing within 2.4 m |
| C | Get in or out of your car (parking where you stop); ride with a party member; take a car (theft, after a confirm) | beside your car, or driving |
| T | At a stop, board the route bus standing there; on board, ask for the next stop; elsewhere, call a taxi to where you stand and choose where to | a bus at the stop, your taxi at the kerb, or always ("Call a taxi" / "Bus stop") |
| J | Clock in or out | at your workplace, or at work |
| V | Do the task in front of you on a shift (the orange ring) | on shift, with a task |
| K | Neighbours' errands: take one; at their door, hand the shopping over | always; at the address |
| D | Take a delivery gig at a shop; hand the parcel over at the address | at a shop that sends deliveries, or at the address |
| O | Homes for sale and to rent this week | — |
| Z | Rest; at home, sleep; walk on to get up | always |
| H or ? | The controls and what the bars mean | always ("Controls") |

## The bars: health, stamina, strength

Each bar runs from 0 to 100. The figures are in `rules.json` → `vitals`, and the functions are
`vitalsStep`, `applyUse`, `applyExertion`, `walkFactor` and `carryCapacity` in `core.mjs`.

| Bar | Goes down | Comes back | What it does |
|---|---|---|---|
| Stamina | 4.5 an hour through the waking day, 3 an hour more at work; sprinting 0.35 a second; workouts | 7 an hour at night (22:00–07:00), 12 asleep at home, 10 resting; food and drink (a meal +40, a coffee +8) | Below 15 you are slowed to 60% and cannot sprint |
| Health | 3 a day; 4 an hour once stamina is 0; car crashes, by speed | 0.6 an hour asleep; medicine (+6 to +45); a doctor's visit +50; a check-up +20 | At 0 you faint: you wake at home with 35, your car is left where it stopped, and an ambulance bill of ₡450 arrives |
| Strength | 1.2 a day, never below 5 | Gym workouts (+1.5 to +6, at most +8 a day); walking +0.35 a km (at most +2 a day) | Sets what you can carry: 8 kg + 0.35 kg per point, plus 10 kg with a backpack |

Time away from the game is lived as a normal day would be: awake by day, asleep at home by
night, up to 14 days.

## By vision section

### 2. The world and its population

| Action | Control | Command | Status |
|---|---|---|---|
| See the district's 1,000 people at work, on errands and at home, each on a 24-hour schedule | (in view) | — | Live |
| See who works at a building and their shift | City › Here | — | Live |
| See who lives here, by role | City › People | — | Live |

### 3. Transportation

| Action | Control | Command | Status |
|---|---|---|---|
| Buy a car (new or used) | City › Car | `buy_vehicle` | Live |
| Get in, drive, park | C, arrows | `drive`, `park` | Live |
| Ride in a party member's car | C beside it | (client) | Live |
| Take a bus on a real route: wait at its stop (the red flag; the times of the next buses in the T window), board while it stands there, ask for the next stop, get off there | T | `board` (₡15) / `alight` | Live: SFMTA routes' stops (docs/transit-stops.json), a timetable out and back (docs/city/transit.mjs) |
| Call a yellow taxi to where you stand, choose where to (home, work, the errand or parcel's address, or any named place), ride there on the meter | T → Call a taxi | `board` / `alight` | Live |
| Hail a passing taxi | T at it | `board` / `alight` | Live |
| Pay tolls: FasTrak or a mailed invoice | (automatic at gantries) | `toll` | Live |
| Use carpool and express lanes | (automatic) | `lane` | Live |
| Pass speed cameras | (automatic) | `speed_camera` | Live |
| Pay a meter; refuel | City › Car | `pay_meter`, `refuel` | Live |
| Get a FasTrak tag; set Flex occupants | City › Car | `get_fastrak`, `set_flex` | Live |
| Lend, sell or lease a car to a party member | City › Car | `offer`, `accept`, `decline`, `return` | Live |
| Hurt in a crash | (automatic, by impact speed) | `hurt` | Live |
| Break what you crash into (the car's kinetic energy, ½mv²) | (automatic) | `strike` with `energy` | Live |

### 4. The economy

| Action | Control | Command | Status |
|---|---|---|---|
| Start with ₡2,000 and a room free for a week, then ₡120 a day | City › Join | `join` | Live |
| Earn at a basic job: ₡120 every 10 minutes (₡720/h); other roles by their wage ratio | J, City › You | `take_job`, `clock_in`, `clock_out` | Live |
| Work the shift: a task every 35–80 s (serve at the counter, restock from the back, sweep the kerb…), done at its spot by staying there till the bar fills; tips on top; 10 minutes with nothing done is unpaid, 30 and you are sent home | V | `task` | Live |
| Errands for neighbours: buy what they ask and bring it to their door; paid back what it cost and ₡25 + ₡30/km | K | `take_errand`, `deliver_errand`, `cancel_errand` | Live |
| Delivery gigs: ₡40 + ₡45/km, half pay if late | D | `take_delivery`, `deliver`, `cancel_delivery` | Live |
| Give money to a party member | City | `give_money` | Core |
| Pay bills; contest citations | City › Bills | `pay_bill`, `contest` | Live |
| See taxes withheld, brackets and the rates where you stand | City › Taxes | — | Live |

Prices are on the vision's scale:

* bus ₡15
* meal ₡35
* clothing ₡100–320
* room ₡840 a week
* used economy car about ₡7,900; new economy car ₡22,000
* a house about ₡60,000–200,000 by floor area

Real tax rates, tolls and fines are kept.

### 5. Businesses and jobs: shops and their wares

Each store kind sells its own goods. The kind comes from the map's tenant tag; a clinic or gym
is recognised by its name.

| Store | Sells | Does |
|---|---|---|
| Café, bakery, restaurant, pizzeria, bar | coffee, tea, pastries, sandwiches, meals, soup, pizza, beer… | stamina |
| Grocery, corner store, gas-station shop | groceries (no sales tax), bread, water, snacks | stamina |
| Pharmacy | bandages, pain relief, cold medicine, vitamins, first aid kit; prescriptions (after a doctor) | health |
| Clinic | a doctor's visit (₡150, +50 health, writes a prescription); a check-up | health |
| Gym | a day pass, personal training, a yoga class; protein shakes | strength, costs stamina |
| Hardware store | hammer, screwdriver set, wrench, nails, drill, tape measure, paint, ladder, work gloves, flashlight, toolbox | tools, kept for building (§7) |
| Clothing | T-shirt, jeans, jacket, raincoat, shoes, backpack | worn; a backpack carries 10 kg more |
| Bookshop, florist, general shop | books, maps, bouquets, plants, umbrellas, chargers | — |
| Salon, laundromat, hotel | haircut, wash and dry, a night's stay (hotel tax, +70 stamina) | services |

| Action | Control | Command | Status |
|---|---|---|---|
| Buy to carry (weight-limited), or eat or use on the spot | B → Buy / Eat or drink here | `buy` | Live |
| Use, eat, drink, wear | I → Use / Wear | `use` | Live |
| Take something into your hand; put it away | I → Hold / Put away | `hold`, `stow` | Live (drawn in the walker's hand) |
| Put down where you stand | I → Put down | `drop` | Live |
| Pick up dropped or found things | G | `pick_up` | Live |
| Hand something to a party member | I → Give | `give_item` | Live |
| Take a job at a shop that is hiring | B (Hiring), City › Here | `take_job` | Live |
| Own and run a business: prices, stock, staff | — | — | Planned (business layer; storefront lease ₡3,000/week is in the rules) |

### 6. Property ownership and land

| Action | Control | Command | Status |
|---|---|---|---|
| See a building's value, owner, property and transfer tax | City › Here | — | Live |
| Buy a building from its NPC landlord; sell it back | City › Here | `buy_building`, `sell_building` | Live |
| Collect rent; pay property tax at its installments | (automatic) | — | Live |
| Homes on the market this week: the real share of houses and flats for sale and to rent, priced by the square foot for the neighbourhood (13 SF neighbourhoods; other cities by jurisdiction) | O, City › Homes | — (`market.mjs`: `homeListings`) | Live; For Sale / For Rent signs out front |
| Buy a home with a mortgage (20% down, 2% closing, 6.3% over 30 years) or outright; move in | O → Mortgage / Outright | `buy_home` | Live |
| Rent a home (a month ahead and a month's deposit); give notice | O → Rent | `rent_home`, `end_lease` | Live |
| Sell a home back into the market (the mortgage paid off from the price) | O | `sell_home` | Live |
| Missed mortgage payments foreclose (3); missed rent evicts (2) | (automatic) | — | Live |
| Offers between players for homes, shared ownership, leases of whole buildings | — | — | Planned |

### 7. Construction and destruction

| Action | Control | Command | Status |
|---|---|---|---|
| Edit a building's exterior | E (exterior editor) | — | Live (separate editor) |
| Buy tools and materials | B at a hardware store | `buy` | Live; they wait in the bag for building |
| Clear a parcel, design, permit, build | — | — | Planned |
| Strike things with what is in your hands: each tool's energy (fists 25 J … sledgehammer 420 J), scaled by strength, against the thing's material; it breaks once the energy taken reaches its break energy (object-catalogue.json) | X | `strike` | Live |
| What it breaks into: lumber (a saw or an axe on wood), scrap metal, glass shards, left on the ground | G | — | Live |
| Vandalism, seen: a ₡400 fine and the repair as restitution | (automatic) | — | Live |
| The city repairs what is broken (a window in a day, a tree in three) | (automatic) | — | Live |
| Demolish and build | — | — | Planned |

### 8. Government and lawmaking

| Action | Control | Command | Status |
|---|---|---|---|
| Propose a measure within the platform's limits | City › Laws | `propose` | Live |
| Vote on it | City › Laws | `vote` | Live |
| Elect a mayor and a five-seat council; 2-week terms; 7-day residency | — | — | Core in Python (`smc.city.government`); viewer Planned |

### 9. Crime, policing and courts

| Action | Control | Command | Status |
|---|---|---|---|
| Steal a car (witnesses and the alarm report it) | C at someone else's car, then confirm | `take` | Live |
| Fines for tolls, lanes, speed and parking; contest them at a hearing | City › Bills | `contest` | Live |
| The police recover stolen cars | (automatic) | — | Live |
| Courts with three rotating judges; restitution; privileges suspended | — | — | Planned |

### 13. Launch scope: up to one full party

| Action | Control | Status |
|---|---|---|
| Play together: one host keeps the books, the others see them | Play together | Live |
| See party members' cars and ride with them | (in view), C | Live |
