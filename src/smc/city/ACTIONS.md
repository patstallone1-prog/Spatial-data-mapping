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
  inventory (I), the task board, taxis, the online store and the controls (? or /), each a top-bar
  button; your task's card is in the Tasks list, your pets on your profile (Relationships › Family).
  A window closes with its × or its key again.
* **The City panel** (the "City" button) is for records and rare actions: money, job, car,
  bills, taxes, laws, people.

In City mode the map's own keys that would fight the game are off: E (the free view and the
exterior editor), R (back to where you are), a click to go there (teleporting), the pins (1, 2,
3, Delete) and Esc. They work as before in Explore mode. Still shared by both modes: F (first
person), S (what is under the pointer), Enter (doors), the arrows, Shift + Up / Down standing
still (levels; they were PageUp / PageDown).

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
  left) and the compass (top right; a reading only -- the game's time runs on its own clock, a day
  in 72 real minutes, and cannot be changed): first what you can do where you stand (highlighted: "Go in:
  …", "Board the 30 …", "Drive …"), then always You & wallet (the city panel: wallet, job, home,
  car, the laws), Inventory (I), Tasks (J), **Shop** (O), Sprint (Shift) and Controls (H). On a
  narrow screen it drops under them. The health bars are at the top left with **To do** under
  them: where your task takes you next (an arrow and the distance), its other steps, money owed,
  being hurt or tired, and the task board's offers with a Take button; the first three show, "All
  N" opens the whole list. Windows open on the right under the top bar; the bar of eight and the
  money, time and place line stay at the bottom. The view zooms out no further than 72 m (a fifth in from just
  under a block). Directions, the free view, pins and click-to-go are put away.
* **City mode is played in the Marina** (Greenwich Street to the water, Lyon Street to Laguna:
  Lombard, Chestnut, the Marina's blocks and the whole of the Marina Green and Moscone, 1.6 km²).
  Switching to it shows "Loading the Marina…" while the whole area is built once (about 40 s on
  a laptop; instant when it is still built from the last time). The window that was there before
  is let go first, so the two are never held at once; once the area is up, the world cells it
  was built from and the simple city's tiles it does not draw are let go too. After that nothing
  is loaded in the background: the area is not rebuilt as you walk, the memory watch does not
  rebuild it smaller, the tile tree does not fill in the region round it, and the view sees a
  few blocks (the far plane at 1.6 km, haze from 450 m). Walking or driving to its edge stops
  you there ("switch to Explore to go further"); tasks outside it are not offered (the
  Presidio's trees and the Marina walk's stops past Laguna are Explore's). Switching back to
  Explore streams the map as before. Everything in the area is drawn in full detail all the
  time: the trees every leaf (cut where they meet a house as they are drawn, one mesh a kind).
* **Where you start**: your device's location, wherever the map has a region, unless you have
  set a spawn point (the spawn point wins). In City mode only a location inside the Marina moves
  you; otherwise you start at Chestnut and Fillmore.

The people and the traffic are out in both modes.

## The keys (City mode)

| Key | Action | Bar button shown when |
|---|---|---|
| Arrows | Walk; at the wheel, accelerate, brake and steer. Climbing, reach for the next hold; on a top, walk along it; sat in a tree, Down climbs down. Hands on something you push (a click on it), Up pushes it along. Shift + Up / Shift + Down, standing still where there is another level (a bridge's deck, a lower deck): up or down to it (they were PageUp / PageDown) | always |
| Shift (hold) | Sprint, while stamina lasts | always ("Sprint", held) |
| Space | Jump: the height comes from your legs' push (leg length, body weight, strength) against your weight plus what you carry (`handling.mjs` `jumpOf`). Running, the jump carries on the way you are going. At a low wall or fence: onto its top, or over it (a vault). At anything higher that can be climbed -- a chain-link fence, a tree, a ladder, a wall with holds -- the first holds of a climb (by a jump if it needs one), then the arrows climb: up, sideways, two together diagonally, down; the route weighs each hold, a limb at a time. At the top, stand up if it is wide enough, or swing over. Climbing: push off. On a top: jump down, landing on the side you face (`climb-play.mjs`). It replaced E | hint strip at something climbable ("Climb the chain-link fence (then the arrows)", greyed with why when it cannot be), at a low wall ("Jump onto the wall"), on one ("Jump down") |
| Shift + X | Thrust instead of X's swing (it was C): drive in the point or head of what you hold, straight at what is in front -- a crowbar's jab, a sledgehammer's ram, a knife's stab, a spade's jab. Less than the swing (0.6 of its energy, 0.7 of its stamina); the notice says what the engine (`mechanics.mjs`, `strike-preview.mjs`) has it do. Empty-handed, the flat of the hand instead of a punch: a loose thing gets a shove (`mechanics-work.mjs` `push`), a person is shoved and rocks, staggers or falls by their balance (`shove`); a fall that is seen is battery. Sprinting (Shift held), X thrusts too | hint strip: holding a crowbar, sledgehammer, knife or spade with a thing (not a person) in front; empty-handed, something loose in front ("Push the log") |
| R (hold) | Work at what is in front with a tool, a stroke at a time while held: a saw saws wood, a crowbar pries, bolt cutters cut chain and wire (`cmd_strike` `mode: "work"`, 0.35 of a swing's energy at 0.4 of its stamina). A pocket knife carves wood: a press too light skates off, enough strokes cut initials. A spade digs the ground underfoot -- lawn, soil, sand, gravel, never pavement -- going in by your weight and levered out against the soil (`mechanics-work.mjs` `dig`, `carve`; `labour` for the stamina) | hint strip: holding a saw, crowbar, bolt cutters or knife with a thing in front, or a spade over open ground (greyed with why: "A saw cuts wood", "Too hard to dig") |
| R (tap) | On shift: do the task at the orange ring (it was V). With a hammer and nails, at wood -- or at a nail you set with a click, wherever you face: one blow on the nail each tap (`mechanics-work.mjs` `drive`). A steady second between blows lands square; rushed or tired, it lands off square and the nail bends or the face skids. A loose nail is used before a box is opened; a box of 50 opens when the loose ones run out (`labour` `start_nail`, `set_nail`) | hint strip: on shift at the task ("Restock the shelf"); holding a hammer with nails and wood in front, or a nail set |
| Y / N | Yes / No to the question at the top (clock in or out, hand over a parcel, an errand's shopping) | the question's own buttons |
| Click | In a shop or restaurant, on a chair, stool or booth: sit down (walk to get up). On a product on a shelf: a step to it and it is taken (it was G). On a courier's order at the door, or anything on the ground: walk over and pick it up (it was G). On someone who works where you are: they come over and the messages open with them asking if you need help; a waiter's or cashier's line links the menu (order from it), a clerk's the wares. On the food or drink in your hand: a bite or a sip, and held down, eat or drink on to the end. On a thing on the ground: walk over and pick it up into your hand; the next click on the ground walks you there and sets it down (placed, not dropped). Too heavy to lift, or something loose in the street (a log, a chair): walk up to it, hands on it, Up pushes it (`mechanics-work.mjs` `push`: strength and grip against rolling or sliding); into a wall or another thing it stops there and the two mark each other, and at a slant it slides along a wall, scraping its paint (`mechanics-collide.mjs`); a click lets go. With nails in your hand, on wood: a nail set there by hand, point in, held for the hammer (R tap); a click instead lets it drop. With the messages open, on a resident: talk. On another player: who they are. A click is never a blow (X swings) (`view.mjs` `click`, `pressDown`) | — |
| Right click | Use what is in your hand (it was U): eat, drink, take medicine, wear or take off. Food and drink a mouthful at a time (`eat-play.mjs`): a glass raised and tipped, a burger bitten, at a table the knife and fork, soup by the spoonful; held down, eat or drink on to the end (module 22 `useDown` / `useUp`). A click on the food or drink does the same. On a building with a home you own or rent, within 18 m: its property menu (edit the interior). Shift + right click: the exterior editor | holding something usable; hint strip: "Sip the pint of beer (hold: drink it)" |
| 1 – 8 | Choose a slot on the bar of eight: what is in it is in your hand; an empty slot is an empty hand | the bar is always shown |
| I | The inventory: a grid of 24 above the bar of 8. Click a thing, then another slot, to move it; its details say how it is held, its weight class, and whether it swings or throws | always ("Inventory" on the bar) |
| X | Swing what is in your hand at what is in front (a punch, empty-handed): a thing, a tree, a person. Tools by their kind; any other rigid thing long and light enough as a blunt blow by its mass and length; soft things, two-handed loads and things too small or too heavy for your strength do not swing (it says why). Glass breaks when it lands a blow. Striking a person is battery (a citation) | a breakable thing or a person within reach, and what you hold swings |
| Q | Throw what is in your hand, the way you face: speed from your strength and its weight (heavier goes slower, too heavy is no throw), flatter for long things, a heave from the chest for two-handed loads. It flies, lands and lies where it lands; glass breaks to shards, drinks spill; a hit on a person is battery | holding something you can throw |
| Enter | In and out, whichever is nearest: into your car beside it, and out of it (parking where you stop), or ride with a party member; onto the route bus standing at the stop (it waits for you 15 s at most), and aboard, ask for the next stop; into the shop in front of you, and inside, at the door, back out; your own garage door up and down (a home you own or rent, a building you own). Elsewhere, a building's door | beside your car ("Drive …"), driving ("Get out"), a bus at the stop ("Board the 30 … (leaves in N s)"), aboard ("Next stop"), a store ("Go in"), inside ("Leave by the door"), at your garage ("Open / Close your garage") |
| T | Unbound (PR #226). Taxis are the top bar's Taxi button (call one, choose where to); Enter gets into the taxi pulled up for you, and out early | — |
| Enter (bicycle) | Your bicycle (a bike shop sells one, ₡480): Enter gets on where you stand, out of doors and on foot, when nothing nearer is in reach; the arrows pedal, brake and steer (up to 8 m/s on the road, 5 off it); Enter to get off. It is wheeled, not carried. It was B | owning a bicycle ("Ride your bicycle"), riding ("Get off your bicycle") |
| Z | Lie down at a bed (in your own home, sleep); again, get up. Only beside a bed | beside a bed, or lying down |
| Tasks (top left) | The To do list. Click your task, delivery or errand: its card -- the steps, the pay, an arrow pointing the way and how far, Go there (walked there along the pavements; an arrow key takes over), Close (back to the list), Cancel (drops it). It stays up until closed or cancelled. The task board (courier work, flyers, dog walks, bus-stop counts, mystery shopping, Presidio forestry, the Marina walk, neighbours' errands) is the top bar's Task board button. J was its key | always ("Tasks") |
| O | Unbound (PR #226). The Shop is the top bar's green button: everything sold in the city, searchable, at twice the shop price; Real estate at the market's price | — |
| ? or / | The controls and what the bars mean (/ too, for when Shift is forgotten; H was its key) | always ("Controls") |
| F | First person (both modes) | — |

In the inventory (I), a thing's own uses are buttons under its details (docs/41,
`uses.mjs`): wear, read, place at home (comfort), fill, light, charge, lock a bike, mail, clean,
take apart, cook, open / pack / seal a box, test a device, mend with a repair kit, "Look it over"
(its condition, and what a closer look finds), and **Sell…**: the Selling window lists who here
buys it (a second-hand counter, a specialist, consignment, a recycler by the kilo), each with an
offer that holds for its hours, and anywhere a listing on the board or a shipped listing (8%
commission; the buyer pays the carrier and the tax). Buyers for a listing write in Messages
(Accept / Decline). At a car: "Take a wheel off" and, with bolt cutters, "Unlock it".

Gone: C (the car is Enter's now, with the bus: one key gets you in and out of anything; taxis
were on T, now the top bar). Gone on 2026-11-24: V (shift tasks: R), B (the bicycle: Enter), J (the
board: the top bar and the Tasks list's cards), K (pets: the profile's Family), E (climbing: Space),
H (? or /), PageUp / PageDown (Shift + Up / Down), then G (a click), U (a right click) and C
(Shift + X: C had come back in docs/63 as thrust and push). Gone from City mode: B (the shop counter: now Enter and the SHOP panel), Esc, K (errands: on
the task board; hand-over is a Yes / No), D (deliveries: take one in the shop window or on the
task board; pick up with G; hand over is a Yes / No), L (look), O as homes (now the online
store, with Real estate in it), the old J (clock in: now a Yes / No), click-to-go and the
pins. C, E, R, Y and N are back with new jobs (above; docs/63).

**The hint strip** (`affordances.mjs`): over the bar, at most four chips, one a key, of what is
particular to where you are and what you hold -- never walking or a plain jump, which you always
can. Each is shown in full for its first five showings, then as its key and verb, and is gone once
used twenty times (back for something new in front). Greyed chips say why not. A chip clicked is
its key pressed (touch screens). Controls (H) › Hints: in full, keys only, or off.

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
* Cars are solid to each other. A car never makes a move that would take it further into
  another car, a route bus, your taxi or your car (each a row of circles down its length);
  a queue that is let go no longer drives through the car it waited on. At a junction with a
  light or a stop sign, the first to come (on its green, or after its stop) goes first:
  a car waits at the line while an earlier car's way through crosses its own (sampled from
  how each is actually driven round the corner), and while anyone is on a crosswalk it would
  drive over. It waits with its nose short of the crosswalk, not on it or in the junction.
  Work rounds (police, cabs cruising, deliveries, the street cleaner) are driven by the same
  rules near you; they used to be drawn along their way regardless.
* Lanes keep clear of the parked cars: on a side of a street that is parked on, the lane is
  3.3 m in from the kerb (1.8 m where nobody parks), and every street is as wide as the kerbs
  the world draws (OpenStreetMap's widths were often metres out).
* Walkers keep to the pavement and cross only on crosswalks: at a junction, corner to corner
  along the line of the pavement, one street at a time, never diagonally and never mid-block.
  From a door (or a car, a bus stop) they step straight out to the pavement, and round the
  corner to a place on a side street. At the kerb they wait for the light where there is one
  (the street they cross has red) and for a gap: no car on the crossing or due there within
  4 s. Then they cross, and walk a third quicker until back where their day has them.
* Every car that is driving moves. One that reaches the end of its trip pulls into the parking
  lane and is parked at once (it used to stand in the lane until the next pass, holding up the
  street behind it). A queue held by nothing real (a ring of cars waiting on each other) creeps
  on after 8 s; a light, a stop sign or someone in the road is still waited for.
* Traffic is where and when it is in the city (rules.json `traffic`). Drivers keep to the main
  streets (a way's cost is its time times its class's preference, less on a named corridor).
  Through trips start and end at the edge of the streets, a gate on Lombard Street (US 101,
  weight 12), Richardson, Van Ness, Marina Boulevard, Divisadero and so on far likelier than a
  side street's; half of them run one corridor end to end. By the hour: commuters in the rush
  hours (7-9, 4-7), deliveries through the working day, ride-hail into the evening. At a
  signal where a main street crosses a lesser one, the main street has 60% of the 42 s cycle.
* Parked cars stand at the kerb as it is drawn, 15 cm off it, along the street, never in the
  lane: only on a side of the street SFMTA's block faces say is parked on (a side street with
  no record: yes; a main street with none: no); 20 ft clear of every corner's cross street;
  not across a driveway (a kerb cut); not on red or blue kerb, yellow only for a delivery,
  white only for a fare; and never in another car's spot. Cars ease out of the spot into the
  lane, and back in at the end of a trip. (There is no record of perpendicular or angled
  street parking in this data: street parking is parallel.)
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
| Call a yellow taxi to where you stand, choose where to (home, work, the errand or parcel's address, or any named place), ride there on the meter | Taxi (top bar) → Call a taxi | `board` / `alight` | Live |
| Hail a passing taxi | Enter at it, when it pulls up for you | `board` / `alight` | Live |
| Pay tolls: FasTrak or a mailed invoice | (automatic at gantries) | `toll` | Live |
| Use carpool and express lanes | (automatic) | `lane` | Live |
| Speeding and a carpool lane short of riders: fined only when seen -- in the field of view of one of the map's speed cameras (the poles along the arterials: each looks along its street, a 70° cone to 45 m), or with a patrol car within 60 m. Unseen, nothing | (automatic) | `speed_camera`, `lane` with `witness` | Live (`docs/city/enforcement.mjs`) |
| Open and shut your own garage (a home you own or rent, a building you own), in City mode or on the map | Enter at it | (client) | Live |
| Your garage opens as you drive your car up to it (within 9 m) and shuts once you have driven or walked away | (automatic) | (client) | Live |
| Pay a meter; refuel | City › Car | `pay_meter`, `refuel` | Live |
| Get a FasTrak tag; set Flex occupants | City › Car | `get_fastrak`, `set_flex` | Live |
| Lend, sell or lease a car to a party member | City › Car | `offer`, `accept`, `decline`, `return` | Live |
| Hurt in a crash | (automatic, by impact speed) | `hurt` | Live |
| Break what you crash into (the car's kinetic energy, ½mv²) | (automatic) | `strike` with `energy` | Live |

### 4. The economy

| Action | Control | Command | Status |
|---|---|---|---|
| Start with ₡2,000 and a room free for a week, then ₡120 a day | City › Join | `join` | Live |
| Money the backend grants your device's account (`supabase/kerbside_city_grants.sql`): into your wallet once, when you are in the city and hold the books (alone or as the party's host); never asked of a host by a guest | (automatic, on load) | `account_grant` | Live |
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
| Use, eat, drink, wear | A right click with it chosen on the bar (or a click on the food); I → its details | `use` | Live |
| Take something into your hand; put it away | 1 – 8 on the bar (an empty slot is an empty hand) | `hold`, `stow` | Live (drawn where it is held, arms posed) |
| Put down where you stand | I → Put down | `drop` | Live |
| Pick up dropped or found things (if you can lift it) | A click on it | `pick_up` | Live |
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
| What it breaks into: lumber (a saw or an axe on wood), scrap metal, glass shards, left on the ground | A click on it | — | Live |
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
