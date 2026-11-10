# Kerbside V2 — every player action, and its control

This is the full list of what a player does in the V2 vision, section by section. For each
action it gives the control that does it in the viewer, the world command behind it
(`docs/city/world.mjs`, `CityWorld.submit`), and whether it is built yet.

**How controls are chosen**

* **One key, one meaning.** No key does two different things depending on where you stand,
  except Enter (in or out of a door, which is the same thing seen from either side). What a key
  acts on is what is in your hand (the bar of eight) or what is in front of you.
* **An action-bar button** is shown for each action, but only when the action is possible where
  you stand: "Go in: Café" beside a café, "Board the bus" when a bus is within reach. This makes
  everything playable on a touch screen too.
* **A Yes / No question** pops up where an action is obviously wanted and has no key: clocking in
  at your workplace (and out when you leave it), handing a parcel over at its address, the
  errand's shopping at the neighbour's door. Answer No and it stays as a button on the action bar
  while it applies.
* **A window** is for choosing between several things: a shop's wares (its SHOP panel), the
  inventory (I), buses and taxis (T), the task board (J), the online store (O), the controls (H).
  A window closes with its × or its key again.
* **The City panel** (the "City" button) is for records and rare actions: money, job, car,
  bills, taxes, laws, people.

In City mode the map's own keys that would fight the game are off: E (the free view and the
exterior editor), R (back to where you are), a click to go there (teleporting), the pins (1, 2,
3, Delete) and Esc. They work as before in Explore mode. Still shared by both modes: F (first
person), S (what is under the pointer), Enter (doors), the arrows, PageUp / PageDown (levels).

Status:

* **Live**: in the viewer now.
* **Core**: in the rules and world code, without its own control yet.
* **Planned**: not built.

## The two modes

A switch at the top left, beside the menu button, sets the mode. The choice is remembered on
this device.

* **Explore:** the map. The sidebar ("☰ Map") holds search, directions, first person, the free
  view (E), Reset view and Play together. A click goes there; 1 / 2 / 3 are pins; Esc closes.
  The city's bars, its buttons and its keys are off, but for two: Space jumps, and Enter at a
  garage of a home you own or rent opens it (and shuts it).
* **City:** the game. A bar of word buttons runs along the top, between the mode switch (top
  left) and the compass (top right): first what you can do where you stand (highlighted: "Go in:
  …", "Board the 30 …", "Drive …"), then always You & wallet (the city panel: wallet, job, home,
  car, the laws), Inventory (I), Tasks (J), **Shop** (O), Sprint (Shift) and Controls (H). On a
  narrow screen it drops under them. The health bars are at the top left with **To do** under
  them: where your task takes you next (an arrow and the distance), its other steps, money owed,
  being hurt or tired, and the task board's offers with a Take button; the first three show, "All
  N" opens the whole list. Windows open on the right under the top bar; the bar of eight and the
  money, time and place line stay at the bottom. The view zooms out no further than 90 m (just
  under a block). Directions, the free view, pins and click-to-go are put away.

The people and the traffic are out in both modes.

## The keys (City mode)

| Key | Action | Bar button shown when |
|---|---|---|
| Arrows | Walk; at the wheel, accelerate, brake and steer | always |
| Shift (hold) | Sprint, while stamina lasts | always ("Sprint", held) |
| Space | Jump: the height comes from your legs' push (leg length, body weight, strength) against your weight plus what you carry (`handling.mjs` `jumpOf`) | — |
| Click | Inside a shop, on its blue SHOP panel beside the door: the shop's wares. Anywhere else: swing (as X) | inside a shop ("Buy: the shop panel by the door") |
| Right click | Use what is in your hand (as U) | — |
| 1 – 8 | Choose a slot on the bar of eight: what is in it is in your hand; an empty slot is an empty hand | the bar is always shown |
| I | The inventory: a grid of 24 above the bar of 8. Click a thing, then another slot, to move it; its details say how it is held, its weight class, and whether it swings or throws | always ("Inventory" on the bar) |
| U | Use what is in your hand: eat, drink, take medicine, wear or take off | holding something usable |
| X | Swing what is in your hand at what is in front (a punch, empty-handed): a thing, a tree, a person. Tools by their kind; any other rigid thing long and light enough as a blunt blow by its mass and length; soft things, two-handed loads and things too small or too heavy for your strength do not swing (it says why). Glass breaks when it lands a blow. Striking a person is battery (a citation) | a breakable thing or a person within reach, and what you hold swings |
| Q | Throw what is in your hand, the way you face: speed from your strength and its weight (heavier goes slower, too heavy is no throw), flatter for long things, a heave from the chest for two-handed loads. It flies, lands and lies where it lands; glass breaks to shards, drinks spill; a hit on a person is battery | holding something you can throw |
| G | Pick up what lies at your feet (yellow ring), with a bend-and-lift; something too heavy for you is a strain and stays down. Also a courier task's order at the shop door | within 3 m of something ("Pick up" / "Too heavy") |
| Enter | In and out, whichever is nearest: into your car beside it, and out of it (parking where you stop), or ride with a party member; onto the route bus standing at the stop (it waits for you 15 s at most), and aboard, ask for the next stop; into the shop in front of you, and inside, at the door, back out; your own garage door up and down (a home you own or rent, a building you own). Elsewhere, a building's door | beside your car ("Drive …"), driving ("Get out"), a bus at the stop ("Board the 30 … (leaves in N s)"), aboard ("Next stop"), a store ("Go in"), inside ("Leave by the door"), at your garage ("Open / Close your garage") |
| T | Taxis only: into the taxi pulled up for you (it waits 90 s, then leaves) or a passing one; in one, out and pay; elsewhere, call a taxi to where you stand and choose where to | always ("Call a taxi" / "Get in your taxi (waits N s)" / "Hail the taxi") |
| V | Do the task in front of you on a shift (the orange ring) | on shift, with a task |
| Z | Lie down at a bed (in your own home, sleep); again, get up. Only beside a bed | beside a bed, or lying down |
| J | The task board: courier work, flyers on a street, a neighbour's dog to the park and back, rider counts at bus stops, a mystery shopper's calls, Presidio forestry, the Marina walk, neighbours' errands. With a task: its steps and Cancel. The next step is the first line of To do | always ("Tasks") |
| O | The Shop: everything sold in the city, searchable, in categories, sorted by name or price, at twice the shop price; Real estate is a category at the market's price (not doubled) | always ("Shop", green) |
| H or ? | The controls and what the bars mean | always ("Controls") |
| F | First person (both modes) | — |

Gone: C (the car is Enter's now, with the bus: one key gets you in and out of anything; taxis
stay on T so the two cannot be confused). Gone from City mode: B (the shop counter: now Enter and the SHOP panel), Esc, K (errands: on
the task board; hand-over is a Yes / No), D (deliveries: take one in the shop window or on the
task board; pick up with G; hand over is a Yes / No), L (look), O as homes (now the online
store, with Real estate in it), the old J (clock in: now a Yes / No), E, R, click-to-go and the
pins.

## A shop

Enter at a shop's front goes in: a room with its counter, shelves and staff, and beside the door
on the solid wall (not over the window) a blue SHOP panel. Click it: every item the shop sells,
its price and tax, with − / + for a quantity. Checkout, at the bottom, shows the lines, the
subtotal, the sales tax, the total and your balance after; Confirm pays (once, if you have the
credits, can lift each thing and carry it all) and puts the things in your inventory, on the bar
first. Enter at the door, or walking out through the front, leaves. (`checkout` command.)

## Handling things

Every item has a material, how it is held (`hand`, `two_hands`, `shoulder`, `tool`) and a
length, in `docs/city/rules.json`; `handling` there has the body, lift, throw and swing numbers
and each material's flags (soft, fragile, spills, breaks to). `docs/city/handling.mjs` turns
those into: can you lift it (base 12 kg + 0.6 kg a strength point), its weight class, the throw
(speed, angle, range, how it lands) and the swing (tool kind or blunt joules, or why not). The
held item is drawn where it is held — in the right hand, between both hands at the chest, or
on the shoulder — and the arms are posed for it; picking up, straining, swinging, throwing and
jumping are animated.

## People and doors

The city's people go in and out of buildings through their doors, not their walls: each place's
door is the page's own door for that building where there is one (`entry.doors`), else the
middle of its front. A walk to or from a building starts and ends at the step outside its door,
crosses the threshold in a doorway phase (the page swings the door open as they pass), and
leaves along the pavement. A break outside puts them on the pavement in front of the door.

* **Getting about:** a resident without a car on a trip too far to walk (over 1.1 km) takes a
  taxi about a third of the time -- out to the kerb, waiting while the cab comes in from a few
  hundred metres off, riding in it (the cab is in the traffic), out at the other end while it
  drives away -- or else the bus where one line serves both ends: walked to the stop, waiting at
  the pole for the next bus the timetable sends that way, on when it stands there, off at the
  stop nearest the other end (`fleet.mjs` `taxiTrip`, `busTrip`).
* **Sport:** some go to play at the parks' courts (tennis, basketball: `sf-corridor-parks.json`
  `court_layout`), an hour or so, running about the court.
* **Shopping:** a customer inside looks round the shop floor most of the time and pays at the
  counter (`people.mjs` `indoorSpot`).
* **Garages:** a resident whose car lives in the garage has the door up before the car drives
  out and down after it, up as it comes home and down once it is in (`fleet.mjs` `garageOpen`;
  the doors that open: page module 31).

## Traffic, collisions and injuries

* The city's drivers keep the law: the limit for the street, stop signs at junctions of
  residential streets, lights where an arterial crosses, distance to the car ahead. They brake
  for anyone in the road, hard if they must.
* Between the city's own people nobody is run down: a driver too close to a walker stops dead.
* Every car that is driving moves. One that reaches the end of its trip pulls into the parking
  lane and is parked at once (it used to stand in the lane until the next pass, holding up the
  street behind it). A queue held by nothing real (a ring of cars waiting on each other) creeps
  on after 8 s; a light, a stop sign or someone in the road is still waited for. A red light
  lasts 21 s of a 42 s cycle.
* On foot, cars are solid, in both modes: the traffic, parked cars (yours and the city's), the
  buses, your taxi and other players' cars. You slide along their sides rather than walk
  through (`walkerBlocked` in `view.mjs`, checked by the page's `moveWalker`). Not while you
  drive or ride.
* You can break the rules. Step out in front of a car and it brakes; if it cannot stop, it hits
  you. Drive into someone or into a car and that is a collision too.
* A hit is shown: the car stops with a jolt, parts fall in the road, the person is thrown and
  lies down for over a minute. The speed sets the injury (a bruise to a broken pelvis, by
  band) and the health lost. Cars take damage by speed: dented, then broken (in the body
  shop, not drivable, until repaired).
* Injuries are listed under You in the City panel. Their effects come in a later update.

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
| Get in, drive, park | Enter, arrows | `drive`, `park` | Live |
| Ride in a party member's car | Enter beside it | (client) | Live |
| Take a bus on a real route: wait at its stop (the red flag; the times of the next buses in the ride window), board while it stands there (it holds 15 s for you at most, then goes, and makes the time up), ask for the next stop, get off there | Enter | `board` (₡15) / `alight` | Live: SFMTA routes' stops (docs/transit-stops.json), a timetable out and back (docs/city/transit.mjs) |
| Call a yellow taxi to where you stand, choose where to (home, work, the errand or parcel's address, or any named place), ride there on the meter | T → Call a taxi | `board` / `alight` | Live |
| Hail a passing taxi | T at it | `board` / `alight` | Live |
| Pay tolls: FasTrak or a mailed invoice | (automatic at gantries) | `toll` | Live |
| Use carpool and express lanes | (automatic) | `lane` | Live |
| Speeding and a carpool lane short of riders: fined only when seen -- in the field of view of one of the map's speed cameras (the poles along the arterials: each looks along its street, a 70° cone to 45 m), or with a patrol car within 60 m. Unseen, nothing | (automatic) | `speed_camera`, `lane` with `witness` | Live (`docs/city/enforcement.mjs`) |
| Open and shut your own garage (a home you own or rent, a building you own), in City mode or on the map | Enter at it | (client) | Live |
| Pay a meter; refuel | City › Car | `pay_meter`, `refuel` | Live |
| Get a FasTrak tag; set Flex occupants | City › Car | `get_fastrak`, `set_flex` | Live |
| Lend, sell or lease a car to a party member | City › Car | `offer`, `accept`, `decline`, `return` | Live |
| Hurt in a crash | (automatic, by impact speed) | `hurt` | Live |
| Break what you crash into (the car's kinetic energy, ½mv²) | (automatic) | `strike` with `energy` | Live |

### 4. The economy

| Action | Control | Command | Status |
|---|---|---|---|
| Start with ₡2,000 and a room free for a week, then ₡120 a day | City › Join | `join` | Live |
| Earn at a basic job: ₡120 every 10 minutes (₡720/h); other roles by their wage ratio | Yes / No at the workplace (clock in / out), City › You | `take_job`, `clock_in`, `clock_out` | Live |
| Work the shift: a task every 35–80 s (serve at the counter, restock from the back, sweep the kerb…), done at its spot by staying there till the bar fills; tips on top; 10 minutes with nothing done is unpaid, 30 and you are sent home | V | `task` | Live |
| Errands for neighbours: buy what they ask and bring it to their door; paid back what it cost and ₡25 + ₡30/km | J (task board); hand-over is a Yes / No at the door | `take_errand`, `deliver_errand`, `cancel_errand` | Live |
| Delivery gigs: ₡40 + ₡45/km, half pay if late | Shop window, J; G picks up; hand-over is a Yes / No | `take_delivery`, `deliver`, `cancel_delivery` | Live |
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
| Buy to carry (weight-limited), or eat or use on the spot | Enter, then the SHOP panel → Checkout → Confirm | `buy`, `checkout` | Live |
| Use, eat, drink, wear | U (or a right click) with it chosen on the bar; I → its details | `use` | Live |
| Take something into your hand; put it away | 1 – 8 on the bar (an empty slot is an empty hand) | `hold`, `stow` | Live (drawn where it is held, arms posed) |
| Put down where you stand | I → Put down | `drop` | Live |
| Pick up dropped or found things (if you can lift it) | G | `pick_up` | Live |
| Throw what you hold | Q | `throw` | Live |
| Hand something to a party member | I → Give | `give_item` | Live |
| Take a job at a shop that is hiring | The SHOP panel (Hiring), City › Here | `take_job` | Live |
| Own and run a business: prices, stock, staff | — | — | Planned (business layer; storefront lease ₡3,000/week is in the rules) |

### 6. Property ownership and land

| Action | Control | Command | Status |
|---|---|---|---|
| See a building's value, owner, property and transfer tax | City › Here | — | Live |
| Buy a building from its NPC landlord; sell it back | City › Here | `buy_building`, `sell_building` | Live |
| Collect rent; pay property tax at its installments | (automatic) | — | Live |
| Homes on the market this week: the real share of houses and flats for sale and to rent, priced by the square foot for the neighbourhood (13 SF neighbourhoods; other cities by jurisdiction) | O (online store › Real estate) | — (`market.mjs`: `homeListings`) | Live; For Sale / For Rent signs out front |
| Buy a home with a mortgage (20% down, 2% closing, 6.3% over 30 years) or outright; move in | O › Real estate → Mortgage / Outright | `buy_home` | Live |
| Rent a home (a month ahead and a month's deposit); give notice | O › Real estate → Rent | `rent_home`, `end_lease` | Live |
| Sell a home back into the market (the mortgage paid off from the price) | O › Real estate (Yours) | `sell_home` | Live |
| Missed mortgage payments foreclose (3); missed rent evicts (2) | (automatic) | — | Live |
| Offers between players for homes, shared ownership, leases of whole buildings | — | — | Planned |

### 7. Construction and destruction

| Action | Control | Command | Status |
|---|---|---|---|
| Edit a building's exterior | E in Explore mode (exterior editor) | — | Live (separate editor) |
| Buy tools and materials | The SHOP panel at a hardware store | `buy`, `checkout` | Live; they wait in the bag for building |
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
| Steal a car (witnesses and the alarm report it) | Enter at someone else's car, then confirm | `take` | Live |
| Fines for tolls, lanes, speed and parking; contest them at a hearing. Moving violations need a witness: a camera with the car in view or a patrol car near (parking stays the parking officers') | City › Bills | `contest` | Live |
| The police recover stolen cars | (automatic) | — | Live |
| Courts with three rotating judges; restitution; privileges suspended | — | — | Planned |

### 13. Launch scope: up to one full party

| Action | Control | Status |
|---|---|---|
| Play together: one host keeps the books, the others see them | Play together | Live |
| See party members' cars and ride with them | (in view), C | Live |
