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
* **A window** is for choosing between several things: the shop (B), your bag (I), the controls
  (H).
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

## The keys

| Key | Action | Bar button shown when |
|---|---|---|
| Arrows | Walk; at the wheel, accelerate, brake and steer | always |
| Shift (hold) | Sprint, while stamina lasts | always ("Sprint", held) |
| Click | Go there; on a bridge, onto the deck you clicked | — |
| PageUp / PageDown | The level above or below the same spot | — |
| B | Open the shop beside you | within 30 m of a store |
| G | Pick up what lies at your feet (it has a yellow ring) | within 3 m of something |
| I | Your bag: eat, use, wear, put down, give | always ("Bag") |
| C | Get in or out of your car; ride with a party member; take a car (theft, after a confirm) | beside your car, or driving |
| T | Board a passing bus or hail a taxi; press again to get off | a bus or taxi within 9 m |
| J | Clock in or out | at your workplace, or at work |
| D | Take a delivery gig at a shop; hand the parcel over at the address | at a shop that sends deliveries, or at the address |
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
| Take a bus | T at a passing bus | `board` (₡15) / `alight` | Live |
| Take a taxi (metered by the km) | T at a passing taxi | `board` / `alight` | Live; the taxi follows its own fare's route, so a chosen destination is Planned |
| Pay tolls: FasTrak or a mailed invoice | (automatic at gantries) | `toll` | Live |
| Use carpool and express lanes | (automatic) | `lane` | Live |
| Pass speed cameras | (automatic) | `speed_camera` | Live |
| Pay a meter; refuel | City › Car | `pay_meter`, `refuel` | Live |
| Get a FasTrak tag; set Flex occupants | City › Car | `get_fastrak`, `set_flex` | Live |
| Lend, sell or lease a car to a party member | City › Car | `offer`, `accept`, `decline`, `return` | Live |
| Hurt in a crash | (automatic, by impact speed) | `hurt` | Live |

### 4. The economy

| Action | Control | Command | Status |
|---|---|---|---|
| Start with ₡2,000 and a room free for a week, then ₡120 a day | City › Join | `join` | Live |
| Earn at a basic job: ₡120 every 10 minutes (₡720/h); other roles by their wage ratio | J, City › You | `take_job`, `clock_in`, `clock_out` | Live |
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
| Listings, offers between players, leases of buildings, foreclosure, shared ownership | — | — | Planned |

### 7. Construction and destruction

| Action | Control | Command | Status |
|---|---|---|---|
| Edit a building's exterior | E (exterior editor) | — | Live (separate editor) |
| Buy tools and materials | B at a hardware store | `buy` | Live; they wait in the bag for building |
| Clear a parcel, design, permit, build | — | — | Planned |
| Damage, repair, demolish | — | — | Planned |

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
