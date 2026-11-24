# 63 — Plan: context controls, and showing what you can do

A planning document; nothing here is built yet. It proposes the controls that the material
engine (doc 62) makes worth having, the situation each one switches on in, and a way to show the
right commands on screen depending on where the character is, what they hold and what is in
reach, so that nobody has to remember a key.

It keeps the rules in `src/smc/city/ACTIONS.md`:

* **One key, one meaning.** A key's meaning never changes; only its label does.
* **Buttons only when possible.** An action's button shows only where you can do it.
* **Choices in windows.** Choosing between several things happens in a window, not on keys.

## What is bound today (City mode)

| Keys | Bound to |
|---|---|
| Walking and moving | Arrows (walk, or drive at the wheel), Shift (sprint), Space (jump) |
| Mouse | Click (sit in a shop, otherwise swing), Right click (use, as U) |
| The bar of eight | 1–8 |
| Things in hand | I (inventory), U (use), X (swing), Q (throw), G (pick up) |
| Going places | Enter (in and out of anything), T (taxi), B (bicycle) |
| Tasks and rest | V (task in front), Z (lie down), J (task board) |
| Windows and the view | O (shop), H or ? (controls), K (pets), L (leash), F (first person), S (what is under the pointer), PageUp / PageDown (levels) |
| At the wheel only | A, D, S, P |

**Free in City mode:** C, E, R, W, Y, N, M. E and R are map keys in Explore mode only. W, A,
S and D also walk in the kitchen game and stand you up from a seat, so leave W alone. The plan
uses **C, E, R, Y and N**.

## The controls

There are three ways to use a held thing on the world. Each matches a different kind of physics
in the engine:

* **Swing (X).** An impact along an arc, with its energy from strength and the tool's swing.
* **Thrust (C).** An impact along the tool's point.
* **Work (R).** A steady force kept up over time: prying, sawing, carving, digging.

U stays "use on yourself": eat, drink, wear.

The label of each comes from what is held and what is in front. The key's meaning does not
change.

| Control | Key | Switches on when | What it does (engine) |
|---|---|---|---|
| **Chop** | X | Holding an axe, hatchet or machete; a tree, log, post or wooden thing within reach | `strike` with the edge, across the grain, at the spot you face. Blows alternate tilt by themselves (from above, from below), so a notch opens by its own physics. The tree falls when `broken`. The mark is drawn as the kerf, then the notch. |
| **Split** | X | Holding an axe or maul; a log round standing on its end at your feet | An overhead swing into the end grain. The round splits or the bit sticks (`stuck`; a second X wiggles it free, from `withdraw_n`). |
| **Hack** | X | Holding a machete or large knife; brush, vines, a hedge, a rope, canvas | Slicing edge blows (`slice` > 0). Cuts through what is thin, scores what is not. |
| **Swing / club** | X | Holding anything rigid with no edge (club, bat, crowbar, bottle, a length of pipe); a thing, a window or a person in reach | A face strike. It dents, shatters, bruises or bounces by the engine. A bottle may break on the blow (its shell check). Striking a person is battery, as now. |
| **Punch** | X | Empty hand | A fist face strike. The hand is hurt by what it hits (fist versus brick, from the tool-damage terms). |
| **Charged swing** | hold X | Any swing | Holding X winds up to the full swing energy (0.6 s). A tap is a light blow, which wastes less stamina. The engine's energy scaling sets what more you get. |
| **Stab** | C | Holding a knife, screwdriver, ice axe or anything pointed; something in reach | `strike` with the tip (grip-limited thrust). It sticks in wood (pull out with C again), pierces canvas and skin, cracks ice, and bends on steel. |
| **Push / shove** | C | Empty hand; a person, door or loose thing in front | An open-hand push: a door swings, a cart rolls, a person staggers (a shove counts as battery only if they fall). |
| **Pry** | R (hold) | Holding a crowbar or screwdriver; a door, window, crate, drain cover or kerb stone in front | A steady force at the tool's tip against the gap. It opens when the force beats the latch or the friction. This is the engine's withdrawal and wedge terms, used slowly. |
| **Saw** | R (hold) | Holding a saw; wood or a branch in front | Drawn slicing cuts. The depth builds over time, not per blow. |
| **Carve / whittle** | R (hold) | Holding a knife plus a stick or branch in the other slot, or a carving block in front | Thin slicing cuts along the grain that shape the piece. Mostly a craft and repair action. |
| **Dig** | R (hold) | Holding a shovel or trowel; soil, turf, sand or gravel underfoot | Cone-index soil resistance (`soils`), so turf is slow and sand quick. Can bury and dig up things. |
| **Hammer in** | R (tap) | Holding a hammer, with nails in the bag; wood in front | Repeated face strikes on a nail's head (`nail` implement). It goes in until withdrawal grip and length match. |
| **Sip / bite** | U (tap) | Holding a drink or food | One sip or bite: a share of it, with its effect scaled. The item is lighter and shows what is left. |
| **Finish it** | U (hold) | Holding a drink or food | Drink or eat the rest (as U does today). |
| **Climb** | E | Facing a wall, fence, tree, ladder, rock or pole within reach, where the climbing engine finds holds that hold (`climb().holds`) | You take the holds. Arrows move up, down and across, each step a release test (`releases`). A limb that cannot let go stays, and the chip says why. Stamina drains with `effort`. If `holds` turns false (rain, sweat, tiredness, a pack) you slip and fall, hurt by the height. E again lets go. |
| **Mantle / vault** | Space | Facing an edge between waist and chin height (a low wall, a fence top, a ledge) | Space still means "go up": a jump that ends on top. Hands press down (the climbing engine's press share), so strength and the edge's depth decide whether you make it. |
| **Hang and drop** | E, then arrows down | At a ledge or roof edge | Lower yourself by the hands before dropping, so the fall is a body length less. |
| **Chalk up** | U | Holding chalk (sold at sports shops) | Hands become `skin_chalked` for a few minutes, so slopers hold where sweaty hands slip. |
| **Sharpen** | inventory button | Holding a whetstone or steel, with a blade in the bag | Restores the blade's edge radius (`edge_radius_m`) toward its sharpened value, a stroke at a time. |
| **Look at a mark** | S | Pointing at a struck thing | Says what the mark is ("a 16 mm V-shaped kerf; the trunk keeps 95% of its strength") and on a tool, its edge ("rolled", "dulled"). |
| **Yes / No** | Y / N | A Yes / No question is up | Answers it without the mouse. |

Swing, Thrust and Work are not limited to named tools. An item with no implement entry is
struck by its material's substance (`item_materials`) and its shape: a frying pan swings as a
face, a fork stabs as a point. Each such item needs a geometry entry, so the catalogue grows as
items are added.

### Climbing in the city: where the holds come from

`climb()` needs holds. Every hold is derived from geometry the city already has:

| Surface | Holds |
|---|---|
| Chain-link fences | The wire as jugs for hands, the mesh as toe edges (holdout case: climbable by an ordinary person) |
| Wooden fences and gates | The top rail as a jug, the cross-rails as edges. Pickets are too narrow to grip, so they give press holds only. |
| Low walls, kerb walls, planters | Mantle (Space) when within reach, no climb |
| Brick | Mortar joints as 10 mm recessed edges, which only the strong can use (and see doc 62's open case on foot capacity) |
| Stucco, glass, polished stone | No holds. E shows "Nothing to hold on to". |
| Window sills, cornices, balcony rails | Jugs at their heights from the facade data |
| Drainpipes and poles | Pinch holds with the feet smearing on the wall (a pinch hold type, to add to `capacity`) |
| Trees | Low branches as jugs, bark as a friction surface for the feet, the trunk's diameter for a hug (stem) |
| Ladders, scaffolding, playground frames | Rungs as jugs and edges, easy for everyone |
| Rock (Presidio, Lands End) | Edges and slopers from a seeded roughness of the rock surface, wet after rain |

Climbing onto private property, a roof or a bridge counts as trespass by the existing laws.
Falls hurt by height, as falls do now.

## Showing what you can do

### One list behind keys, buttons and hints

Today each key handler decides inside itself whether it can act (`swingKey` checks `swingOf`,
`useSelected` checks `it.use`, Enter's `here` list picks the nearest). The plan moves that
decision into one pure module, `docs/city/affordances.mjs`. Each action is declared once:

```js
{ id: "chop", key: "x", verb: "Chop", when: (s) => s.held?.implement?.edge && s.front?.kind === "wood",
  label: (s) => `Chop the ${s.front.name}`, priority: 30, run: "swing" }
```

`affordances(state)` returns what applies now, as `{ id, key, label, priority, ok, reason }`. The
state is built each frame from:

* **What is held:** the bar slot's item, its implement and its features (edge, tip, face), from
  `mechanics.strike_kinds` and `item_materials`.
* **What is in front:** the same `nearestHittable` and `strikeTarget` the swing uses, the
  nearest door, car, bus, shop and garage (Enter's list), and a climbable face (a ray to the
  nearest wall, fence or tree, and its holds).
* **Where you are:** in a shop, at home, at a bus stop, on the road, in water, beside a bed.
* **How you are:** driving, riding, swimming, sitting, carrying a two-handed load, hurt, tired,
  sweaty or chalked, wet.
* **What you are doing:** the task's next step (from To do).

The key handlers, the action-bar buttons and the on-screen hints all read this one list. So a
hint can never promise what the key will not do, and the controls window (H) is generated from
the same declarations, so it is never out of date. A test checks that every key in `KEYS` has at
least one affordance and every affordance's key is bound.

### The hint strip

* A row of at most four key-cap chips, bottom centre, just above the bar of eight:
  `[X] Chop the oak`, `[C] Stab`, `[E] Climb the fence`, `[U] Sip the coffee`. Each chip is
  also a button, so it works on touch screens like the top bar's buttons.
* Order: the thing in front first, then what is in hand, then the place, then the task. Actions
  always on the top bar (Inventory, Tasks, Shop, Controls) are not repeated.
* **Steady.** A chip stays at least 0.6 s once shown. The target in front changes only once
  another is 0.3 m nearer, so the strip does not flicker as you turn.
* **When an action is close but impossible**, its chip shows greyed with the engine's reason:
  "[E] Climb: too smooth to hold", "[X] Chop: the bit is stuck, pull it out first",
  "[C] Stab: the blade would bend". The engine already returns these reasons
  (`climb().limiting`, `strike().limit`, `tool_damage`). This is how players learn the physics
  without reading anything.
* **A preview from the engine.** Where it is cheap, a chip can say what will happen:
  "[X] Chop (about 16 mm a blow)". A plate or block strike costs about 0.02 ms and a round about
  3 ms, so one preview per target and held tool is cached until either changes.

### Learning, then getting out of the way

* The first five times an action is available, its chip is full ("[X] Chop the oak") and pulses
  once when it first appears.
* After you have used it five times it shortens to the key cap and the verb ("[X] Chop").
* After twenty uses it shows only while something new is in front (a new kind of target or
  tool).
* A **Hints** setting in Controls: Full, Short or Off. Counts and the setting are kept on this
  device (localStorage, read and written in try/catch, as the rest of the page does).
* Something you cannot do and have never tried shows its greyed reason once, then only when you
  press the key.

### Accessibility

* The strip is an `aria-live="polite"` toolbar. A new chip is announced once, not every frame.
* Chips use the top bar's contrast and size, and keep their order for keyboard focus.
* With reduced motion, chips never pulse.

### Testing the hints

* **Unit tests** of `affordances()` over a table of situations. For example:
  * axe in hand, oak in front → `chop`;
  * coffee in hand → `sip` and `finish`;
  * at a chain-link fence → `climb` ok;
  * at a glass wall → `climb` greyed "too smooth";
  * a knife facing a steel door → `stab` greyed;
  * in a car → only the wheel's actions.
* **A consistency test:** every `KEYS` entry has affordances and every affordance's key is
  bound. A key's affordances all share its one meaning (swing, thrust, work, use, in and out,
  …).
* **A headless page check** (the city's CDP recipe) that the strip shows the expected chips at
  a tree, a shop door and a bus stop in the Marina, and never more than four.

## Order of work

1. **`affordances.mjs`, for today's keys.** Re-express today's keys as affordances, put the hint
   strip on screen, and generate H from them. No new controls yet. Most of the "nothing to
   remember" win comes from this alone.
2. **Wire the engine into strikes.** `world.mjs` `strike` and the page's swing call `M.strike`
   instead of `rules.json` `vs` (doc 62, "Replacing the vs table"). The struck object keeps its
   body (marks, strength) and the tool keeps its edge. Chop, Split, Hack and Club become labels
   of X.
3. **C (thrust) and R (work).** Stab and push; pry, saw, dig and hammer in.
4. **U tap and hold.** Sip and bite against finish. Chalk.
5. **E: climbing.** Holds from fences, trees, ladders and sills first; brick and rock later.
   Mantle on Space. Falls.
6. **Y / N** for Yes / No questions, and the greyed-reason chips everywhere.

Each step ends with ACTIONS.md updated (the keys table and "Bar button shown when").
