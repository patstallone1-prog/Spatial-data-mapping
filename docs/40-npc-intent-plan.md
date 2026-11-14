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

## Not in this pass

- The Valhalla route table (step 2 above).
- NPC bodies and seated cyclists (the earlier realism list, items 2 and 6).
- Children walking with a parent as a pair on the pavement.
