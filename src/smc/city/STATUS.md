# The living city: what is built, and what is left

Status on 2026-11-08 (controls update after PR #176), after PR #172 (controls, bars, shops) and the follow-up PR (buses, taxis,
shop rooms, shift tasks, errands, striking, the housing market). Every key is listed in
[ACTIONS.md](ACTIONS.md). The figures are in `docs/city/rules.json`.

"Verified" means it was run in the real viewer (headless Chrome, SF corridor, noon) and the
result was read back from the page. "Tested" means a unit test in `tests/city.test.mjs` or
`tests/test_city_rules.py`.

## Since then (PR after #177): Enter for car and bus, waits, witnesses, garages, NPCs about

* **Keys:** C is gone. Enter is in and out of everything (your car, the bus at the stop and its
  next-stop request, a shop, your garage, a door), the nearest when several are here. T is taxis
  alone, so the two cannot be confused. On the map (Explore), Space jumps and Enter opens your
  own garage.
* **Waits:** a route bus holds at the stop for a player standing there 15 s at most
  (`transit_lines.bus_hold_s`), then goes and makes the time up on the road (`busesAt`'s
  `lag`). A called taxi waits 90 s (`taxi_max_wait_s`), counted down on its button, then leaves.
* **Fines only when seen:** speeding and a carpool lane short of riders are charged only with a
  witness: one of the map's speed cameras with the car in its field of view (70°, 45 m, along
  its street) or a patrol car within 60 m (`docs/city/enforcement.mjs`; the world refuses the
  notice without one). A patrol's is a court citation, a camera's an SFMTA notice. Parking
  tickets are unchanged (the parking officers').
* **NPCs:** residents without a car take a taxi (a real cab in the traffic, coming in, riding,
  driving away) or the route bus on trips over 1.1 km; some play at the parks' courts; shoppers
  look round the shop floor and then pay at the counter. Tested (`tests/city_npc.test.mjs`,
  including that nobody jumps getting on or off).
* **Garages:** every drawn garage door can open (page module 31: the door rolls up over its
  merged copy). A resident's goes up before their car leaves and comes down after; up as it
  comes home, down once in. Yours (a home you own or rent, a building you own): Enter.
* **Broken things (not triggered yet):** `docs/city/repair.mjs` -- broken for 12 hours, then
  planks nailed over it one by one (an animation), mended within 3 days (`rules.json repair`).
  Nothing in the city breaks windows or doors yet; when something does, it calls this.

## Since then (PR after #176): the controls, handling things, the shop panel, doors

* **One key, one meaning; City mode no longer shares the map's keys.** E, R, click-to-go, the
  pins and Esc are off in City mode (they still work in Explore). B, K, D, L and the old J and
  O are gone. Their work moved to Enter, G, the shop's SHOP panel, Yes / No prompts, the task
  board (J) and the online store (O, with Real estate as a category). The full list is in
  ACTIONS.md. Verified: a click in City mode moved the walker 0 m.
* **The bar of eight and the inventory.** 1 – 8 choose what is in your hand. I opens a grid of
  24 above the bar, and things can be moved between slots. The order is kept on this device
  (`docs/city/inventory.mjs`). Verified: 1 and 3 put the axe and the brick in the hand. Tested.
* **Handling.** Each item has a material, a way of being held and a length
  (`docs/city/handling.mjs`), which set:
  * lift limits and weight classes;
  * throws (Q), by speed, angle, range and how the thing lands;
  * swings (X), by tool kind or blunt joules, or a refusal with the reason;
  * a jump (Space), from leg push against body weight plus what you carry.
  The item is drawn where it is held: in the hand, between both hands, or on the shoulder.
  Pick-up, strain, swing, throw and jump are animated. Verified:
  * a brick was thrown 8 m;
  * a jump reached 0.3 m;
  * "too soft to swing" was refused;
  * the bag of groceries sat between both hands.
  Tested.
* **The shop panel.** Inside a shop, a blue SHOP panel beside the door (on the wall, not the
  window) opens the wares. You pick quantities, then Checkout shows the total after tax, and
  Confirm pays (`checkout`). Verified: a café panel was clicked, 2 coffees and a tea came to
  ₡23.90 with ₡1.90 tax, and they went onto the bar. Fixed along the way: in a streamed region
  the walker was pushed back out of the shop's room (`keepWalkerOutside`).
* **Yes / No prompts.** These cover clock in and out, parcel hand-over and errand hand-over.
  If you answer No, the prompt stays as an action button. Verified: No was answered, then the
  "Clock in" button was clicked, and the player was on shift.
* **Z only at a bed.** Verified: away from a bed, Z refuses with the reason. Tested.
* **People use doors.** Walks start and end at the step outside a building's door and cross
  its threshold; the page opens the door as they pass. Tested: no walker crosses a wall.

## Since then (PR after #175): kept people and cars, traffic law, crashes, tasks, the store

* **Nothing appears or vanishes.** Each district has a roster: residents per home, a job each,
  and their cars (`docs/city/fleet.mjs`). Visitors (ride-hail, taxis, deliveries, private
  cars) drive in from the district's edges and out again. A car is always parked, in a garage,
  driving or away, and only moves by driving there. Look (L) shows how it got there. Tested.
* **No popping.** Walkers no longer jump at corners, at the end of a round, or between one
  walk and the next. Anything left over is drawn as a step, not a jump (`glide` in view.mjs).
  Verified: 0 jumps over 23,000 samples near the Marina. Tested.
* **The grey flashes.** The memory governor rebuilt the detail window every few seconds round
  a walker standing still. It now rebuilds only to shrink, at most once a minute
  (module 28 `desktopMemoryPlan`). Tested.
* **Traffic law, collisions, injuries, Kenney cars (CC0).** See ACTIONS.md. Verified: a car
  braked from 8.5 m/s to a stop for you; a car that could not stop hit you at 23 mph (broken
  pelvis, debris, knock-back).
* **Tasks (Q), the online store (U), punching people (X).** Verified: courier task end to
  end; an axe online at ₡110 (₡55 in the shop); a dead tree felled in the Presidio.

## Since then (PR after #174): the streets filled, and two modes

* **Why the streets were empty.** Two bugs, both fixed:
  * Travelling into a region threw away the city's people-and-traffic group (it was not marked
    bay-wide, so the release of the page's own world disposed of it).
  * The district kept the streets of the square where the world was first built. A lighter
    build holds only a square round the walker. Walking on builds it again under the same
    region name, so the city kept putting its people on the first square's streets.
* **Dense streets.** Passers-by fill the pavements round you: 12 to a 150 m square of streets at
  noon, by the hour, and more in the rules' hotspots. The **Marina** is the test district
  (×3.2 walkers, ×2.4 traffic), and Union Square is another (×3, ×1.8). Residents now number
  one for every few buildings (1,000 to 4,000). Up to 700 people and 320 vehicles are drawn.
  * Verified: 474 people and 60 vehicles on Chestnut Street; 350 people and 40 vehicles at
    Powell and Post.
* **Vehicles** (`docs/city/vehicles.mjs`). Each of the ten kinds is built from its own
  profile:
  * glass you can see through, with seats, a dashboard and a steering wheel inside;
  * pillars, mirrors, lights and wheels with rims;
  * the bus has rows of seats; the pickup has a bed, the taxi a roof sign, the patrol car a
    light bar.
  * They were a painted box and a pale box. Tested; verified at Powell and Post.
* **Where you are.** The real county and town outlines from OpenStreetMap
  (`docs/city/jurisdictions.json`, `scripts/build_jurisdictions.py`). Mill Valley is Mill
  Valley and the Headlands are Marin County; before this, both were San Francisco. Tested.
* **Explore / City switch** at the top left (see ACTIONS.md).

## Part 1: what was asked, and what is built

### Cars: get in, drive, park, get out — yes (PR #172, still live)

* C beside your car gets in. The arrows are the pedals and the wheel.
* C again parks where you stopped and puts you on the kerb side. A meter is charged if you
  stop beside shops.
* The car stays where you left it. It shows in I → Vehicles with how far away it is and
  "Walk there".
* Tolls, carpool and express lanes, speed cameras, fuel and the odometer all apply.
* **New:** crashing into a street thing (bench, light, bin, sign) lands the car's kinetic
  energy on it (½·m·v², capped at the car's top speed). A hard enough crash breaks it.
* Verified: buying and entering a car (PR #172).

### Possessions: an inventory you can open — yes

* I opens **Your things**, which has five sections:
  * **In your hands:** what you hold. It is drawn in the walker's hand, on the right-hand
    bone where the model has one, or else beside the body.
  * **Bag:** each item with Hold / Put away, Eat / Use / Wear, Put down, and Give to a party
    member.
  * **Vehicles:** where each car is parked and how far away, with "Walk there".
  * **Homes:** each one owned or rented, with its mortgage or rent.
  * **Money:** balance, what you owe, mortgages and rent.
* Put down leaves the item on the street with a yellow ring. G picks it up again, as anyone
  in the party can. Things found on the pavement can be picked up too.
* Weight is limited by strength (8 kg + 0.35 kg per point; a backpack adds 10 kg).
* Verified: the window and its sections, holding a sledgehammer, and an errand shown in it.

### Tools that do something: the "PPI" breakage model — yes

* X strikes the nearest breakable thing within 2.4 m with what is in your hands, or fists
  if nothing.
* The energy of a blow is the tool's energy × strength scale × the tool-against-material
  factor:

  | Tool | Energy per blow |
  |---|---|
  | Fists | 25 J |
  | Hammer | 50 J |
  | Saw | 90 J |
  | Bolt cutters | 120 J |
  | Crowbar | 150 J |
  | Axe | 260 J |
  | Sledgehammer | 420 J |

  * The strength scale runs from 0.6 at strength 0 to 1.4 at strength 100.
  * Example factors: a saw against lumber 1.6, against steel 0.2; a sledgehammer against
    glass 1.4, against steel 0.5.
* Each thing has a **break energy** from `docs/object-catalogue.json` (42 archetypes from
  level 2 up). It breaks once the energy it has taken reaches that.
* A blow well under the break energy wears it by less than its energy, scaled by
  (blow ÷ break energy)^0.3. Tapping never breaks a bench; one big blow can.
* Each blow costs stamina. A tired body hits at 60%. Bare fists on glass or steel cost
  health.
* What it breaks into is left on the ground:
  * lumber, from a saw or axe on wood;
  * scrap metal;
  * glass shards.
* Seen by people within 25 m and not yours: a ₡400 vandalism fine plus the repair cost as
  restitution (a window ₡450, a bench ₡1,200, a street light ₡3,500).
* Broken things disappear for everyone in the party. The city mends them (a window in
  1 day, a tree in 3) and they come back.
* Verified:
  * A sledgehammer broke a glass tunnel light in one blow and left glass shards (G).
  * The same sledgehammer on a steel bike rack, with a strength-20 body: 80 blows ran stamina
    to 0 with the rack 43% broken. That is the model working as intended: a weak person can't
    smash steel.
* Tested: energies, wear, a bench broken with salvage, the vandalism fine and the repair.
  The same figures are checked in Python (`smc.city.rules.strike_energy` / `strike_wear`).

### Active work, not idle jobs — yes

* **Shift tasks.** Once clocked in (J), a task comes every 35–80 s, for example "Serve the
  customer at the counter", "Restock cups from the back", "Wipe down the tables outside".
  * Each is done at its spot (behind the counter, in the back, or at the kerb), marked by an
    orange ring and a diamond.
  * V there starts it, and you stay till the bar fills (3–20 s).
  * Tips are paid on top, from ₡0 to ₡10 depending on the task.
  * Ten minutes with nothing done is not paid. Thirty minutes idle and you are sent home.
  * Tasks inside the shop take you in (V at the door).
  * Verified: a barista's "Pull a shot and steam the milk" was done at the counter, earning a
    ₡1 tip.
* **Errands** (K): "go to a shop, buy X, bring it to Y's house".
  * Three neighbours an hour each want 1–3 things sold in the district.
  * Buy them, follow the orange light to their door, and K hands them over.
  * You are paid back what it cost plus sales tax, and a fee of ₡25 + ₡30/km.
  * Verified: offers listed with real names and addresses; one taken.
* **Delivery gigs** (D, PR #172): a parcel from a café or shop to a home, paid by distance,
  half pay if late. Verified.

### Shopkeepers with shifts, home and the counter — yes

* Every NPC has a home, a workplace and a shift. People go to work, then home or out on
  errands, on a 24-hour schedule.
* **New:** inside a shop, staff on shift stand behind the counter.
  * They step along it every 18 s and go to the back now and then, about 15% of the time.
  * Customers wait at the counter or sit at a table.
* **Shops now have rooms.** B outside goes in. You see the shop through your own eyes:
  * the counter with a till, shelves of stock along the back, tables in cafés and
    restaurants, and the shop's name over the counter;
  * a glass front onto the street.
* Customers can't go behind the counter. Staff, meaning you once you work there, go through
  the gap at the end.
* Walking out of the front, or Esc, leaves.
* Verified: inside 1800 Hyde St's café, four baristas and a cook behind the counter, and the
  counter window open.

### Real buses and yellow taxis — yes

* **Buses run the real SFMTA routes.**
  * Each route's stops in the district come from `docs/transit-stops.json` (GTFS). They are
    ordered along the route and joined by the streets.
  * Buses go out and back on a timetable, about 9 minutes apart and 6.5 m/s.
  * Each bus stands 22 s at each stop, at the kerb just past the corner.
  * Every party member sees the same buses at the same moment.
  * Stops have a red flag pole.
* Boarding and getting off:
  * T at a stop while the bus stands there boards it (₡15).
  * On board, T asks for the next stop, and you are let off at that stop's pole.
  * T away from a bus opens a window with the nearest stop and the next two buses on each
    route ("12: 3 min toward Jackson St & Van Ness Ave").
* **Taxis.**
  * In the same window, call a yellow cab to where you stand. It is a real car, driving from
    250–600 m away along the streets.
  * Choose where to go: home, work, the errand or parcel's address, or search any named
    place.
  * T gets in. It drives you there on the meter (₡10 + ₡6/km) and lets you out.
  * Passing taxis can still be hailed.
* Verified:
  * Boarded the 12 at Pacific Ave & Van Ness and got off at Jackson St & Van Ness 20 s
    later.
  * A taxi came in 94 s; the 0.6 km ride was charged ₡13.47.
  * In the SF corridor district: 8 routes (12, 19, 27, 45, 49, 90, 101, 120) and 22 stops.

### The real estate market — yes

* **Home types from the map.** A building tagged house/detached/semidetached is a
  single-family home. One tagged apartments/residential is flats. Untagged, a building of 2
  floors or fewer under 190 m² is a house.
* **Units.** A block of flats is split by its floor area into ~70 m² units, numbered by floor
  (#101, #102 … #201) and each a different size. Bedrooms follow the square feet.
* **Listed each week.** A seeded share of each type is on the market, the same for everyone
  in the party:
  * single-family: 1.2% for sale, 0.6% to rent;
  * flats: 0.4% for sale, 2.8% to rent.

  This mirrors SF's mostly-renter, mostly-flat market. In the corridor this week that is 248
  listings: 20 for sale and 228 to rent.
* **Prices.** Square feet × the neighbourhood's price per square foot. There are 13 SF
  neighbourhoods, for example:

  | Neighbourhood | Sale | Rent |
  |---|---|---|
  | Pacific Heights | ₡1,350/sq ft | ₡5.10/sq ft a month |
  | Marina | ₡1,250/sq ft | ₡4.90/sq ft a month |

  * Other cities use county and city fallbacks.
  * Price per square foot falls a little as homes get bigger.
  * A ±15% spread per home stands for condition and light.
  * Example: a 2-bed 890 sq ft flat on Russian Hill listed at ₡889,000.
* **Buying.**
  * With a mortgage: 20% down and 2% closing, 6.3% over 30 years. An ₡800,000 loan is about
    ₡4,952 a month.
  * Or outright.
  * The seller pays the transfer tax. The price becomes the assessed value, and property tax
    follows.
  * Three missed payments and the bank forecloses.
* **Renting.** A month ahead and a month's deposit. Two missed rents and you are evicted. Give
  notice to get the deposit back.
* **Selling.** Back into the market at today's price. The mortgage is paid off from it.
* Red **For Sale** and blue **For Rent** signs stand in front of listed buildings.
* O opens the listings (For sale / To rent, Houses / Flats, nearest first). The City panel
  has a Homes tab.
* Verified: bought the 890 sq ft Russian Hill flat with a mortgage (₡4,402/month); it showed
  under I → Homes and Money, and it left the listings.
* Tested: types, units, listing rates, prices, mortgage arithmetic, buying, renting and the
  bills that follow. The figures are checked in Python too.

## Part 2: what is left, from large to small

### Government, law and how it changes play

* **Elections in the viewer.** Mayor and a five-seat council, 2-week terms, 7-day residency.
  The rules are in Python (`smc.city.government`) but not yet in `world.mjs` or the panel.
* **Laws beyond four numbers.** Measures today can change four things:
  * the sales-tax add-on;
  * the residential speed limit;
  * the meter rate;
  * the carpool toll share.

  Still to add:
  * rent control and rent caps on the housing market;
  * zoning and what may be built where;
  * transit fares and frequency;
  * a minimum wage that moves NPC wages and shop prices;
  * curfews and opening hours;
  * the police budget, which would set how likely an offence is caught;
  * parking rules;
  * bans on items (fireworks, weapons);
  * business licences;
  * tax brackets.
* **Laws that act on NPCs.** NPC behaviour doesn't read the laws yet. It should, for example
  slower traffic under a lower limit, or fewer shops open under a curfew.
* **Courts.** Contesting a bill gets a hearing date, but not yet:
  * the three rotating judges;
  * a verdict screen;
  * appeals;
  * suspended privileges (driving licence, business licence);
  * jail or community service.
* **Policing.** Witnesses are counted, but police don't come, chase or arrest.
  * Stolen cars are recovered automatically.
  * Vandalism and theft are fined by mail.
  * Needed: patrols reacting to offences seen, red-light cameras, a wanted level.
* **Permits.** Building, business and events.
* **City budgets.** Treasuries collect taxes and fines, but nothing is spent from them on
  repairs, transit or police that a player could see.

### Economy and money

* **One book for NPCs and players.** NPC businesses mint their takings rather than earning
  them from NPC customers.
* **Business ownership.** Run a shop: set prices, buy stock, hire NPCs or players, pay rent
  (₡3,000/week is in the rules).
* **Banking.** Savings, personal loans, credit cards, a credit score that gates mortgages.
  Mortgages are approved without checking income.
* **Insurance.** Car, home, health and renters.
* **Utilities and bills of a home.** Electricity, water, internet, HOA fees.
* **Annual tax filing.** Withholding is cumulative, but there is no April return. Missing:
  * refunds or amounts due;
  * capital gains on a home sale;
  * the mortgage interest deduction.
* **Prices that move.** Market prices, rents and shop prices are fixed by the rules. They
  should respond to demand and to what players buy and sell. There is no inflation.

### Housing and homes

* **Going into your own home.** Buying or renting a flat sets it as home (sleep at home
  works). Not yet:
  * entering *that unit* in the inferred-interior engine;
  * the right floor in a block of flats;
  * keys, locks and who may enter.
* **Moving furniture and picking up house objects.** Interiors are static meshes from the
  interior engine. Needed:
  * each piece of furniture and each object as its own thing you can pick up, carry, put
    down and rotate;
  * persistence per home;
  * collisions;
  * buying furniture at shops and having it delivered.
* **Decorating.** Paint, flooring, renovation. Renovation should raise the home's value.
* **Players selling and renting to each other.** Offers on a player's home, a player as
  landlord, roommates, sublets.
* **Listings with more detail.** Photos or an interior preview, open houses, an appraisal,
  days on market, price cuts.
* **Market realism.**
  * The neighbourhood boxes are coarse (13 in SF).
  * Square feet are estimated from footprint × floors.
  * Unit counts are a heuristic.
  * Rates are weekly snapshots, not a flow of listings and sales.
  * SF rent control isn't modelled.
  * Prop 13 reassessment is done only at sale.

### Construction and destruction (§7)

* **Building walls, windows and doors aren't breakable.** Only the catalogue's street things
  are: lights, signs, benches, bins, racks, meters, shelters, trees, tunnel lights.
  Building facades need their own durability and damage states.
* **Breakage is instant.** There is no animation, falling debris, sound or fire. Mending is
  instant too.
* **No damage to cars** from crashes or blows, and no car repair.
* **Tools don't wear out**, and tool-specific actions are missing (unscrew, cut a lock, pry a
  door).
* **Lumber and tools can't be built with yet.** Missing: clearing a parcel, designing,
  permits and building.
* **No injuries to NPCs, and no fighting.** This is deliberately not modelled.

### Transport

* **Route geometry is approximate.**
  * Stops are put in order along each route's main axis, which is wrong for loops and
    L-shaped routes.
  * GTFS shapes and schedules aren't read; headways are uniform.
* **Other transit.** Muni Metro, cable cars, BART and ferries are drawn but can't be boarded.
* **No bus interior or seats.** You ride invisibly. There are no NPC passengers and no Clipper
  card or transfers.
* **Taxis.**
  * A called taxi is local to your browser; party members don't see it.
  * It stops at the nearest street node, sometimes across the road.
  * There is no ride-hail app, no NPC fares and no tipping.
* **Traffic.**
  * Buses and taxis pass through other cars and ignore signals.
  * NPC cars don't stop for the player.
  * Nothing collides with pedestrians.
* **Your car.**
  * No interior view, no horn or headlights switch, no parking garages.
  * Signals aren't enforced (no red-light cameras).
  * No visit-the-pump refuelling; fuel is a button near a station.

### Shops and their rooms

* **Shop rooms are generic.** The room is built from the building's real front and depth, but
  the layout is a template, not the shop's real plan.
* **Shops without an outline** (no front found) open the counter window without a room.
* **Buying is from the counter window.** Missing:
  * taking an item from a shelf and carrying it to the till;
  * shoplifting;
  * a queue that serves customers in turn.
* **Opening hours aren't enforced.** Every shop sells at any hour, though NPC staff keep
  their shifts.
* **The room is unlit.** It is drawn with flat colours (no scene lights, to avoid recompiling
  materials), so it looks the same day and night.

### NPCs

* **No conversation.** Missing: talking to a shopkeeper or a neighbour, a dialogue system,
  NPCs remembering you.
* **No reactions.** Missing:
  * people fleeing or calling the police when they see vandalism (they are only counted);
  * greeting a customer;
  * serving the player (the shopkeeper doesn't hand over the coffee).
* **Bodies.** NPCs are boxes with swinging limbs. Missing: real models and animation
  (sitting, carrying, working the till).
* **Indoors.** People simply vanish at home, except inside the shop you are in.
* **Schedules.** They don't vary by day of the week, holidays or weather.
* **Families and relationships.** Missing: households, children going to school, friends,
  pets.

### Jobs and work

* **Roles.** Only counter and kerb roles have tasks. Office, driving and trade jobs have no
  playable work.
* **Tasks are timed stays, not mini-games.** No pouring, ringing up or stocking actions.
* **No career.** No promotions, skills, performance reviews or firing for poor work (only
  being sent home).
* **Customers don't wait for you.** The "customer at the counter" in a task isn't one of the
  NPCs in the room.

### Your body and life

* **Health.** No hospital to walk into (a faint takes you home), no illness, no injuries by
  body part.
* **Needs.** No hunger and thirst as separate bars, no hygiene, no sleep debt beyond stamina.
* **Clothing.** It shows in the bag but doesn't change the walker's look.
* **No phone UI** for messages, a map with your markers, banking or the taxi app.

### Multiplayer and persistence

* **Who holds the books.** One party member's browser holds the books. If that browser
  closes, the next one takes over from the last snapshot. Nothing is kept on a server.
* **Solo play is saved in the browser** (localStorage), so it is lost if site data is
  cleared.
* **Shop rooms are drawn only for the player inside.** Others see that player's walker
  standing in the building.
* **Accounts and play across devices aren't wired** to the living city.

### Devices

* **Touch.** The action bar covers every key, but walking inside a shop needs the arrow
  keys. An on-screen stick is needed.
* **Meta Quest.** The headset build doesn't have the new mechanics.
* **Sound.** There is none: bus doors, the till, blows, street noise.

### Small things

* Moving furniture; picking up a cup, a book or a plate in a home.
* Opening and closing doors and cupboards in a shop.
* Sitting on a bench or at a café table.
* Throwing things.
* The held item has no grip pose; it hangs in the hand.
* A sign shows the bus route number on the bus.
* Shelf goods are coloured boxes, not real products.
* Listing addresses with ranges ("2418;2440") show only the first number. A listing's address
  and the bought home's record can differ when a building has several numbers.
* The taxi pulls up up to ~10 m away and doesn't turn to face you.
* Tooltips on the action bar for touch.
* A history of notices (each disappears after 7 s).
* Map pins for the task, the errand, your car, your home and listed homes.
