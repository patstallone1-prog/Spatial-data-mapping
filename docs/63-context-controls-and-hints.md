# 63 — Plan: context controls, and showing what you can do

A planning document, now mostly built (see "Every control today" just below, and "Where it stands" at the end). It proposes the controls that the material
engine (doc 62) makes worth having, the situation each one switches on in, and a way to show the
right commands on screen depending on where the character is, what they hold and what is in
reach, so that nobody has to remember a key.

It keeps the rules in `src/smc/city/ACTIONS.md`:

* **One key, one meaning.** A key's meaning never changes; only its label does.
* **Buttons only when possible.** An action's button shows only where you can do it.
* **Choices in windows.** Choosing between several things happens in a window, not on keys.

## Every control today, and all its uses

As built on branch `claude/material-physics` (2026-11-24). City mode's keys are in
`docs/city/view.mjs` (`KEYS`, `driveKey`); F, S, PageUp / PageDown, the right click and Explore
mode's keys are in `src/smc/renderer/page/module/22-explore-the-view-without-the.js`. What each key
offers where you stand comes from `docs/city/affordances.mjs`, which feeds the hint strip and the
buttons along the bottom.

### City mode, on foot

| Key | Every use, by situation |
|---|---|
| **↑** | Walk the way you face. Climbing: reach for the next hold up. On a wall or fence top: walk along it. On a bicycle: pedal. |
| **←  →** | Standing or slow: step round where you stand, a quarter turn a step. Walking: turn round a curve (tighter the slower). Climbing: reach sideways; two arrows together reach diagonally. On a top: turn. |
| **↓** | Turn round: one step when slow, two at a sprint. Climbing: reach down. On a bicycle: brake. |
| **Shift (hold)** | Sprint while stamina lasts. |
| **Space** | Jump, as high as your legs push against your weight and load. Running: the jump carries forward. At a wall or fence: onto it, over it (a vault) or up to its top or holds. On a top or climbing: jump down or push off, landing on the side you face. In Explore mode the walker jumps too. |
| **Click** | In a shop or restaurant, on a chair, stool or booth: sit down (walk to get up). With the messages open, on a resident: talk with them. On another player: their card, to add as a friend or write to. A click is never a blow. |
| **Right click** | Use what is in your hand, as U. On a building with a home you own or rent, within 18 m: its property menu, to edit the interior (`ownedInteriorContext`). Shift + right click: the exterior editor. |
| **1 – 8** | Choose a slot on the bar of eight. What is in it is in your hand; an empty slot is an empty hand. |
| **I** | The inventory: a grid of 24 above the bar. Click a thing, then a slot, to move it. |
| **U (tap)** | With food: one bite (at a table the knife cuts and the fork carries; soup by the spoonful). With a drink: one sip. With medicine: take it. With clothes: wear or take off. With anything else that has a use: use it. |
| **U (hold)** | With food or drink: eat or drink on to the end. |
| **X** | Swing what you hold at what is in front: a thing, a tree, a window, a person. Tools strike by their kind (axe, hatchet, sledgehammer, crowbar, hammer, spade, knife…). Any other rigid thing long and light enough strikes as a blunt blow by its mass and length. Empty-handed it is a punch, and the hand is hurt by what it hits. Glass breaks when it lands a blow. Soft things, two-handed loads and things too small or too heavy do not swing, and it says why. Striking a person is battery. |
| **C** (holding a tool) | Thrust: drive the point or head straight in. A crowbar jabs, a sledgehammer rams, a knife stabs, a spade jabs. It does less than a swing (0.6 of the energy, 0.7 of the stamina). The notice gives the engine's result: how far the point went in, whether it stuck, bent or would not bite. |
| **C** (empty hand) | Push a loose thing along, such as a log, a chair or a crate. The engine compares your push (300–500 N by strength, capped by your shoes' grip) with the thing's rolling or sliding resistance on its ground and slope. Facing a person, it is a shove: they rock, stagger or fall by their balance (extrapolated centre of mass against their footing). A fall that is seen is battery. |
| **R (hold)** | Work at what is in front, a stroke at a time while held. Saw: saws wood. Crowbar: pries. Bolt cutters: cut chain and wire. Pocket knife: carves wood (a press too light skates off; enough strokes cut your initials into a bench). Spade: digs the ground underfoot (lawn, soil, sand, gravel; never pavement). Each spade stroke goes in by your weight and is levered out against the soil. |
| **R (tap)** | With a hammer and nails, at wood: one blow on the nail per tap. A steady second between blows lands square. A rushed or tired blow lands off square, so the nail bends or the face skids (hammer rash). The nail stops when its head is home. A box of 50 opens itself when the loose nails run out. |
| **E** | Climb the fence, wall, tree, ladder or pole in front, a limb at a time. The arrows reach for holds, and E again lets go. When something in front cannot be climbed, the chip is greyed with the reason. |
| **Q** | Throw what you hold the way you face. Heavier goes slower, and something too heavy is no throw. Long things fly flatter; a two-handed load is a heave. Glass breaks to shards and drinks spill. A hit on a person is battery. |
| **G** | Pick up the nearest thing on the ground (yellow ring) that you can lift. A courier's order at the shop door. In a shop: take the item off the shelf. |
| **Enter** | In and out, whichever is nearest. Your car: get in; when driving, get out (parking where you stop); or ride with a party member. The taxi pulled up for you: get in; in it, get out early and pay. The bus at the stop: board (it waits up to 15 s); aboard, ask for the next stop. A shop's door: go in, or back out from inside. Your garage: door up or down. Elsewhere, a building's door. At a checkout: pay. Off a bicycle. |
| **V** | On shift: do the task in front of you (the orange ring). |
| **Z** | At a bed: lie down (in your own home, sleep); again, get up. |
| **B** | Your bicycle: get on (out of doors, on foot); B again (or Enter) to get off. |
| **J** | The task board, or your task's steps and Cancel. |
| **K** | Your pets: how each is, feed it, take one in, the vet when you are at one. |
| **L** | With a lead: tie up the pet beside you, or have it stay; again, it follows. At the wheel: leave them in the car. |
| **Y / N** | Yes / No to the question at the top: clock in or out, hand over a parcel, an errand's shopping. |
| **H or ?** | The controls window: every key, the bars, and the Hints setting (In full / Keys only / Off). |
| **F** | First person, or back out (both modes). |
| **S** | What is under the pointer: a building's address, a street's name. |
| **PageUp / PageDown** | The level above or below where you stand. |
| **Escape** | Close the window over the screen (the You panel, a menu or shop window, the kitchen, the bay). |
| **T, O** | Unbound since PR #226. Taxi and Shop are buttons on the top bar; Enter gets into a taxi that has pulled up. |

### At the wheel

| Key | Use |
|---|---|
| **Arrows** | Accelerate, brake and steer. An arrow also takes the wheel back from the helpers below. |
| **A / D** | Change a lane to the left or right, with a warning on a one-lane street. |
| **S** | Brake to a stop, at the line when the light is red or amber. |
| **P** | Park in the nearest free stall or kerb space (backing in if it must). With none free, pull up here. |
| **Enter** | Get out when stopped. |
| **L** | Leave your pets in the car. |

### The top bar and the buttons along the bottom

The top bar has Inventory, the Task board, the Shop (everything, from anywhere, at twice the shop
price; real estate at its own price), Taxi (call one to where you stand) and Controls. Money,
health, stamina and strength sit at the top right; a click opens your wallet. Every keyed action
is also a button along the bottom where it applies, for touch screens. The **hint strip** above
the bar shows at most four chips for what you can do just here. It shortens as you use each one and
goes once learned, and greys out what is close but impossible, with the reason.

### In the kitchen game (`kitchen-panel.mjs`; the city's keys stay quiet)

| Key | Use |
|---|---|
| W A S D / arrows | Walk the line |
| E or Space | Use what is in front: take, put down, start or stop a station |
| 1 – 9 over a bin | Take that many (pieces, or portions of what is weighed) |
| B (empty-handed) | The pantry |
| Q, Delete or Backspace | Bin what you hold |
| Escape | Close the pop-up, then the kitchen |
| Mouse | Click and drag items between stations, bins and the pass |

### In the mechanic bay (`workshop-panel.mjs`)

The mouse drags a part to its pins. Tab reaches the numbers, and Enter or Space picks a pin or a
part. Escape closes the picker, then drops what is held, then closes the bay.

### Explore mode (the map)

E is the free view, R goes back to where you are, a click goes there, and the pins and search go
further. Space jumps and Enter opens your own garage. F, S and PageUp / PageDown work as in City
mode.

**Free in City mode:** M and W (W walks in the kitchen game and stands you up from a seat, so leave
it alone), and T and O again.

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

**Where it stands (2026-11-24, branch claude/material-physics, local commits, not pushed or
deployed):**

* **1 done.** `docs/city/affordances.mjs` declares every particular control. The hint strip is on
  screen, and H lists the keys with a Hints setting. H is still written by hand, not generated.
* **3 done.** C thrusts (crowbar jab, sledgehammer ram, knife stab, spade jab) and, empty-handed,
  pushes and shoves (`mechanics-work.mjs` `push`, `shove`). R held saws, pries, cuts, carves (knife)
  and digs (spade); R tapped hammers in a nail (`drive`). The engine's words say what each blow does
  (`strike-preview.mjs`).
* **4 done.** U taps a mouthful and held eats on (`eat-play.mjs`). The dish is drawn as the cook
  made it (`plated.mjs`).
* **5 done.** E climbs (`climb-play.mjs`), and Space goes onto, over, up and off walls.
* **6 done.** Y / N, and greyed chips.
* **2 not done.** The world's damage still comes from `rules.json`; the engine only describes the
  blow. The hole a spade digs and a carved mark are drawn on this device only.

**Not built from the table above:**

* Chop, Split and Hack as X's labels: X says "Swing" with the engine's result.
* The charged swing (hold X).
* Hang and drop.
* Chalk.
* Sharpen.
* Look at a mark (S still names buildings and streets).
* Push for doors and carts: C pushes loose things and people only.
