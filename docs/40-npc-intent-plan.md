# 40 · NPCs that move with intent: plan (2026-11-13)

## What is there today

- **People** (`fleet.mjs` Roster/City, `people.mjs` daySchedule). Every home has residents; each has a role, a workplace, a seeded day (sleep, work, break, errand, meal, stroll, sport), and journeys between on foot, by car, bus or taxi. Where someone is follows from the time alone, so nobody spawns.
- **Traffic** (`fleet.mjs` Drivers). Cars near the player are simulated: lights, stop signs, right of way, lanes for the turn ahead, braking for people.
- **What goes wrong**, and why:

| Seen | Cause in the code |
|---|---|
| One person in the road freezes a street | A driver waits for "someone in the road" for ever, and the queue behind waits on that driver. Nothing goes round. |
| Jams grow until the junctions lock | Routes are fixed when the trip starts. A car never looks at the block ahead before turning into it, and never takes another way. |
| Cars pass through each other | Two escape hatches do it on purpose: a car stuck 5 s in a junction is driven out "through whatever held it", and a 20 s deadlock lets the lower id drive through the other. |
| Left turns everywhere | The router costs distance and street class only. A turn costs nothing. |
| Everyone is the same kind of household | A building gets a head-count (2–3 for a house, up to 10 for flats). There are no households, so no family sizes to get right. |
| NPCs have no money and never change jobs | A role and workplace are dealt once and kept. |
| Cyclists are scenery | Bikes are spawned near the player and dropped behind them. No resident owns one. |

## Godot, GitHub projects and Valhalla: what can honestly be used

- **Godot cannot run inside this app.** The city is a three.js page; a second engine would be a separate canvas with its own world. What is useful from Godot and open projects is their *methods*, ported into `docs/city` in plain JS with credit:
  - **IDM** (Treiber's Intelligent Driver Model) for following and inching in a queue;
  - **MOBIL** for lane changes (change when it helps you more than it hurts the car behind);
  - **SUMO**'s rules for strategic lane changes toward a turn, and its "teleport a vehicle stuck too long";
  - **A/B Street**'s gridlock handling (don't enter a block you can't leave; reroute around jams);
  - **Godot / GDQuest steering behaviours** (arrive, avoid, go round an obstacle) for the swerve round a person or a stopped car.
- **Valhalla cannot run in a browser either**, and there is no Docker on this Mac. Two steps:
  1. *This pass:* the city's own router gets Valhalla's costing rules: a cost for every manoeuvre (right turn cheap, left turn across traffic dear, U-turn dearest, a signal or stop sign a few seconds), on top of street class. Routes then prefer right turns and main streets, as Valhalla's do.
  2. *Next pass:* `pyvalhalla` installs here (checked). Build tiles from a Marina OSM extract, and write a route table the city loads; the city's router stays as the fallback. Not started in this pass.

## The work, in order of importance

### A. Traffic that copes (mine, first)

1. **Go round.** Anything standing in the lane for more than 2 s (a person, a stopped or crashed car, the player's car): change lane if there is one; otherwise swerve round it at walking pace when the other side is clear.
2. **Never through.** Remove both "drive through" hatches. A car that touches another is pushed back out, reverses a little, and takes another way.
3. **Look before turning in.** Before each junction a driver counts the stopped cars on the next block of its route. If it is jammed, it routes round (the rest of the trip is planned again with jammed blocks made dear).
4. **Inch and wait in a jam** (IDM), rather than stop-go or freeze.
5. **Lane choice by gain** (MOBIL): least-crowded lane when there is a gap; work across to the turn lane well before the turn.
6. **Right turns preferred** (manoeuvre costs in the router).
7. **Milestones.** Each trip has timed milestones (each junction, by when). Behind schedule: drive at up to +20%. Too far behind to catch up: put back on schedule by teleport, out of the player's sight where possible; a car deadlocked for 45 s is teleported even in sight.
8. **Braking warning.** Earlier reaction to a person or car coming into the lane (time-to-collision), not just what is dead ahead.

### B. Two ways to travel for every resident (mine)

- Walk plus **drive**, where the household has a garage or kerb space; walk plus **bike** otherwise.
- A resident's bike is a kept vehicle like a car: parked by the door, ridden in the bike lane by the same traffic rules, parked at the other end.
- The spawned scenery bikes go once residents ride.

### C. Households (subagent 1)

- `docs/city/households.mjs`: each building's units get households sized from San Francisco's census shares (most are one or two people; five or more are rare), fitted to the unit's bedrooms.
- Kinds: single, couple, family with children, single parent, flatmates. Families share a surname; children are students.
- Each household has its cars or bikes by garage and space, and rents or owns.

### D. Jobs, pay and balances (subagent 2)

- `docs/city/npc-economy.mjs`: each adult has a work history: spells in a job, some quit or are let go, a gap looking for work, then a new job, perhaps a new trade.
- Bank balance from the work actually scheduled: pay for shifts worked, less the household's rent share and daily spending. Assets: car, bike, home if owned.

### E. Routines by schedule type (subagent 3)

- `docs/city/routines.mjs`: the day by type, not one template: day shift, late shift, night shift, student (with a school run for young ones), parent, retiree, works-from-home, job-seeker, driver on rounds.
- Each stop is a task with a purpose (groceries, pharmacy, bank, gym, laundry, school run), so "what is this person doing" has an answer.

### F. Join-up (mine, last)

- Roster uses households, the work history and routines; the Look panel shows household, job, balance and the trip's next milestone.
- Tests for each rule; a jam test that must clear: a person standing in a one-lane street, a stalled car on a two-lane street, a full junction.

## What was built (2026-11-13)

All of A to F above, except where noted under "Still open".

- **Traffic** (`fleet.mjs` Drivers, `people.mjs` Streets): go round what stands in the lane; back up for room; over the middle line only with nothing coming; look at the next block and route round a jam; pass cyclists with room; corners at 4.5 m/s; right-turn-preferring routes; the two drive-through hatches removed; a car far behind its day and out of sight put back on it; as a last resort a car stood with nothing lawful holding it is put past what holds it.
- **A bug found on the way:** trips dropped their streets' lane data, so every resident and visitor trip drove in the kerb lane, on six-lane Lombard too. Fixed.
- **People:** households (`households.mjs`), work histories and balances (`npc-economy.mjs`), days by routine type with tasks (`routines.mjs`), a car or a bicycle per adult. The People tab opens anyone.

### Found only by running the real Marina

Unit scenarios passed while the live district still jammed. Three causes, each seen in the running app and fixed:

1. **Walkers and drivers waited for each other.** A walker at the kerb waited for any car near the crossing; the car, stopped, was waiting for the walker. Drivers now brake only for people in the roadway and in front of them, and skip those stood waiting; walkers walk in front of a stopped car; a driver held 6 s by people on foot gets the next gap.
2. **A stream of walkers reset the go-round timer.** Each passer-by restarted it. It now runs for anyone standing in the lane, whoever else walks by.
3. **Timers that never ran out.** An inch of movement or a red light restarted the "blocked" and "held" counts, so the last resort never came. One car stood nine minutes in a junction with every way through it queued behind.

### Measured (Marina, headless, the player left standing in a junction, 19:30–20:30)

| | Before this pass | After |
|---|---|---|
| Cars driven by the rules near the player, stopped | 21 of 39 at 3 min, 74 of 112 at 6 min, still rising | 12 of 38 at 2 min, 26 of 64 at 8 min |
| Cars stood over 30 s | not counted by the old build; the queue only grew | 0 at most readings; 7 at the worst |
| Frame rate | — | 59 fps; two frames over half a second in four minutes |
| Memory after a forced collection | 2.2–2.4 GB | 2.2 GB, flat over nine minutes |

## Second pass (2026-11-13, later): junctions, wrong-way traffic, cars and bicycles

### One junction, however many nodes

The map draws many streets block by block, with ends a metre short of the crossing and short links between them. Of the Marina's 608 junction nodes, 518 pairs stood within a box-length of each other; Chestnut at Fillmore was five nodes, some "stop signs" and some "lights", each with its own right of way.

- `Streets.junctions()` groups junction nodes joined by a link under 13 m (and street ends within 4 m) into one junction, at most 34 m across: 608 nodes became 261 junctions.
- One kind and one set of lights per junction; a driver stops once, has one turn, and is "in the box" from its first node to its last (`Drivers.passages`).
- A route goes straight through a junction's nodes, with the street's own width and lanes, not round by the links (each had been a two-lane "street" a metre long in the middle of an avenue).
- A car whose trip ends at a junction gives up its turn there. It had kept it, parked, and everyone after gave way to it for good.

### Lanes of a street drawn as two one-way lines

Each line spread its lanes over the whole road, so the two ways' inner lanes lay on top of each other. `Streets.twinOf` finds the line going the other way; each way's lanes now keep to their own side (169 of 1,060 one-way blocks in the Marina).

### Nobody drives a block the wrong way

Through traffic was started at any street end at the district's edge. From a one-way street's far end there is no lawful way in, and the router's fallback sent those cars the length of Lombard against its traffic. Trips now come in where traffic comes in and leave where it leaves, and a way may go against a one-way street for at most 40 m (the last steps to a kerb).

### Cars, bicycles and the bus

- A household has a car where it has a garage, or room at the kerb of a **side street** (55% of those without a garage). On a **main street** — an arterial, or a corridor of weight 2.5 or more such as Lombard, Van Ness or Chestnut — nobody keeps a car at the kerb.
- Of adults with no car, 14% keep a bicycle. The rest go by bus where one line serves both ends of a trip over 650 m, by cab one time in seven over 1.1 km (and for a long way no bus serves), otherwise on foot.
- In the Marina: 67% of side-street households have a car and 26% of main-street ones; of 14,493 adults, 7,184 drive, 998 keep a bicycle (it had been about two in three) and 6,311 take transit or walk.

### Measured after this pass (same spot, 22:30)

| | First pass | Now |
|---|---|---|
| Cars stood over 30 s | 0–7, spikes to 12–21 late | 1–5 |
| Head-on knots | most of 71 knots in 7 min | 0 |
| Cars put past a knot | about 7 a minute | about 3.5 a minute, all out of sight |
| The city's own work per frame | — | 1.9 ms |

The "90 s stall" of the first pass was the test browser marking the page hidden, which pauses its frames. The app's frame code ran without error throughout.

## Still open

- **Knots inside big junctions.** Cars that have both entered a wide junction can still end up across each other's way; out of sight they are untied after 5 s, in sight after 28 s. About 3.5 a minute around the busiest crossings.
- **The player in a junction.** Cars go round a standing player where there is room, and are put past after 10–28 s where there is not. In a junction that is still the common case.
- **Following is the old rule, not IDM.** The existing gap rule already inches in a queue, so it was kept.
- **Buses carry few.** A trip takes the bus only where one line serves both ends; about one transit resident in twenty rides one a day. Transfers are not modelled.
- **Balances are large.** Pay is on the game's scale (hundreds an hour) against real rents, so employed people save fast. `ECONOMY_RULES.spending` is the lever.
- **Both parents do the school run.** There is no turn-taking yet.

## Not in this pass

- The Valhalla route table (step 2 above).
- NPC bodies and seated cyclists (the earlier realism list, items 2 and 6).
- Children walking with a parent as a pair on the pavement.
