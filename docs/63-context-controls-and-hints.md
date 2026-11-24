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

As built on branch `claude/material-physics` (2026-11-24, second pass the same day). City mode's keys are in
`docs/city/view.mjs` (`KEYS`, `driveKey`); F, S, Shift + ↑ / ↓ for levels, the right click and Explore
mode's keys are in `src/smc/renderer/page/module/22-explore-the-view-without-the.js`. What each key
offers where you stand comes from `docs/city/affordances.mjs`, which feeds the hint strip and the
buttons along the bottom.

### City mode, on foot

| Key | Every use, by situation |
|---|---|
| **↑** | Walk the way you face. Climbing: reach for the next hold up. On a wall or fence top: walk along it. Hands on something you push: push it along ahead of you, at the pace the engine gives. On a bicycle: pedal. |
| **←  →** | Standing or slow: step round where you stand, a quarter turn a step. Walking: turn round a curve (tighter the slower). Climbing: reach sideways; two arrows together reach diagonally. On a top: turn. |
| **↓** | Turn round: one step when slow, two at a sprint. Climbing: reach down. Sat in a tree's fork: climb down. On a bicycle: brake. |
| **Shift (hold)** | Sprint while stamina lasts (not while pushing something). |
| **Shift + ↑ / ↓** | Standing still where there is another level above or below (a bridge's deck, a freeway's lower deck): up or down to it. This replaced PageUp / PageDown. Anywhere else, or while walking, Shift + ↑ is the usual sprint and Shift + ↓ the usual turn round. |
| **Space** | Jump, as high as your legs push against your weight and load; running, the jump carries forward. At a low wall or fence: onto it or over it (a vault). At anything climbable that is higher (a chain-link fence, a tree, a ladder, a wall with holds): the first holds of a climb, by a jump if it needs one, and then the arrows climb. Climbing: push off. On a top: jump down. This replaced E. |
| **Click** | See "The mouse" below. A click is never a blow. |
| **Right click** | Use what is in your hand (it was U): with food, one bite (at a table the knife cuts and the fork carries; soup by the spoonful); with a drink, one sip; held down, eat or drink on to the end. With medicine: take it. With clothes: wear or take off. With anything else that has a use: use it. On a building with a home you own or rent, within 18 m: its property menu, to edit the interior (`ownedInteriorContext`). Shift + right click: the exterior editor. |
| **1 – 8** | Choose a slot on the bar of eight. What is in it is in your hand; an empty slot is an empty hand. |
| **I** | The inventory: a grid of 24 above the bar. Click a thing, then a slot, to move it. |
| **X** | Swing what you hold at what is in front: a thing, a tree, a window, a person. Tools strike by their kind (axe, hatchet, sledgehammer, crowbar, hammer, spade, knife…). Any other rigid thing long and light enough strikes as a blunt blow by its mass and length. Empty-handed it is a punch, and the hand is hurt by what it hits. Glass breaks when it lands a blow. Soft things, two-handed loads and things too small or too heavy do not swing, and it says why. Striking a person is battery. |
| **Shift + X** (holding a tool) | Thrust instead of a swing (it was C): drive the point or head straight in. A crowbar jabs, a sledgehammer rams, a knife stabs, a spade jabs. It does less than a swing (0.6 of the energy, 0.7 of the stamina). The notice gives the engine's result: how far the point went in, whether it stuck, bent or would not bite. (Sprinting with Shift held, X is a thrust too.) |
| **Shift + X** (empty hand) | The flat of the hand instead of a punch (it was C). One shove at a loose thing in front (a log, a chair, a crate): it moves a step if your push (300–500 N by strength, capped by your shoes' grip) beats its resistance on that ground and slope. Facing a person, it is a shove: they rock, stagger or fall by their balance. A fall that is seen is battery. To keep pushing something along, click it (below). |
| **R (hold)** | Work at what is in front, a stroke at a time while held. Saw: saws wood. Crowbar: pries. Bolt cutters: cut chain and wire. Pocket knife: carves wood (a press too light skates off; enough strokes cut your initials into a bench). Spade: digs the ground underfoot (lawn, soil, sand, gravel; never pavement), in by your weight and levered out against the soil. |
| **R (tap)** | On shift: do the task at the orange ring (this replaced V; away from it, R says where it is). With a hammer: one blow on a nail per tap -- on the nail you set with a click, wherever you face, or else on a new nail from the box into the wood in front. A steady second between blows lands square; a rushed or tired blow lands off square, so the nail bends or the face skids (hammer rash). The nail stops when its head is home. A loose nail picked up is used before a box is opened, and a box of 50 opens when the loose nails run out. |
| **Q** | Throw what you hold the way you face. Heavier goes slower, and something too heavy is no throw. Long things fly flatter; a two-handed load is a heave. Glass breaks to shards and drinks spill. A hit on a person is battery. |
| **Enter** | In and out, whichever is nearest. Your car: get in; when driving, get out (parking where you stop); or ride with a party member. The taxi pulled up for you: get in; in it, get out early and pay. The bus at the stop: board (it waits up to 15 s); aboard, ask for the next stop. A shop's door: go in, or back out from inside. Your garage: door up or down. At a checkout: pay. Your bicycle: get on when nothing nearer is in reach, and get off (this replaced B). Elsewhere, a building's door. |
| **Z** | At a bed: lie down (in your own home, sleep); again, get up. |
| **L** | With a lead: tie up the pet beside you, or have it stay; again, it follows. At the wheel: leave them in the car. |
| **Y / N** | Yes / No to the question at the top: clock in or out, hand over a parcel, an errand's shopping. |
| **? or /** | The controls window: every key, the bars, and the Hints setting (In full / Keys only / Off). / works too, for when Shift is forgotten. This replaced H. |
| **F** | First person, or back out (both modes). |
| **S** | What is under the pointer: a building's address, a street's name. |
| **Escape** | Close the window over the screen (the profile, a menu or shop window, the kitchen, the bay). |

**Removed** (their jobs went elsewhere): **V** (shift tasks: R), **B** (bicycle: Enter), **J** (the
task board: the Task board button and the Tasks list, top left), **K** (pets: your profile,
Relationships › Family), **E** (climbing: Space; letting go: Space pushes off, Down out of a tree),
**H** (? or /), **PageUp / PageDown** (Shift + ↑ / ↓), **G** (picking up: a click, on the ground, a
shelf or a courier's order), **U** (using: a right click, or a click on the food; held, either eats
on), **C** (thrust and shove: Shift + X, the point or the flat of the hand instead of X's swing).
**T** and **O** went in PR #226 (Taxi and Shop on the top bar).

### The mouse

`docs/city/view.mjs` `click` and `pressDown` / `pressUp`, wired from module 22. In order:

| What is clicked | What happens |
|---|---|
| A chair, stool or booth in a shop or restaurant | Sit down. Walk to get up. |
| A product on a shop's shelf | A step to it, and it is taken into your hands or basket (it was G). |
| Anything, while your hands are on something you push | Let go of it. |
| Anything, while you hold a nail on the wood | Let go: the nail drops where it was, one nail on the ground. |
| Someone who works where you are (indoors, at their workplace) | They stop, walk over to you and the messages open with them asking whether you need help. A waiter's, cashier's or barista's line carries the menu link and a clerk's the wares; ordering from it is the same as at the counter. |
| One of the city's people, with the messages open | A conversation with them. |
| Another player | Who they are: add as a friend, or write to them. |
| Wood, with nails (a box or a loose nail) in your hand | Walk within reach; a nail is set on the wood where you clicked, point in, and the left hand holds it there. Choose the hammer and tap R to drive it; walk off and it drops. |
| The ground, holding what a click picked up | Walk over, bend down and set it there (a large thing too: placed, not dropped). |
| A thing on the ground (yellow ring) you can lift, or a courier's order at the shop door | Walk over and pick it up; it goes into your hand (it was G). |
| A thing on the ground too heavy to lift, or something loose in the street (a log, a chair, a crate) | Walk up to it with your hands out: ↑ pushes it along ahead of you at the engine's pace (by your strength and grip, against its rolling or sliding resistance on that ground and slope). If it will not budge, you strain on the spot. Something fixed down says so. Pushed into a wall or another thing, it is stopped there and the two mark each other by the collision laws (`mechanics-collide.mjs`, docs/62 "Object on object"). Square on, you strain against it. At a slant, it slides along the wall and scrapes it: the paint is scratched or cut through, and the render under it is marked only by something harder than its sand. A click lets go. |
| A press held on the food or drink in your hand | A bite or a sip; held down, eating or drinking goes on to the end (as the right button held). |

### The Tasks list (top left)

Your task, delivery or errand, clicked, opens its card in the list: the steps (ticked as done), the
pay, the next place, an arrow pointing the way you need to go from where you face, and how far.
**Go there** walks you there along the pavements (the streets' walking route, `pavementRoute`),
stopping if something blocks the way; an arrow key takes over. **Close** shuts the card and shows
the list again. **Cancel** drops the task. The card stays up until one of these: you are taken to
be on your way. The task board (work to take) is the top bar's Task board button, or the word
Tasks.

### Your profile: Family

Your pets are under Relationships › Family: each one's breed, how it is (well, hungry, limping,
hurt), where it is (with you, waiting, tied up, in the car, at home, and how far), how lonely it is
(content, missing you, lonely, very lonely, by how long it has been left: a dog sooner than a cat,
`petLonely`), its health and hunger bars, feeding, Follow / Stay / Tie up / Send home, the vet when
you are at one, and taking one in.

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

**Free in City mode:** M, W (W walks in the kitchen game and stands you up from a seat, so leave
it alone), and now B, C, E, G, H, J, K, O, T, U and V. The keys left: the arrows, Shift, Space, 1–8,
I, X (and Shift + X), Q, R, Z, L, Y / N, Enter, ? or /, F, S and Escape.

## The controls

There are three ways to use a held thing on the world. Each matches a different kind of physics
in the engine:

* **Swing (X).** An impact along an arc, with its energy from strength and the tool's swing.
* **Thrust (C).** An impact along the tool's point.
* **Work (R).** A steady force kept up over time: prying, sawing, carving, digging.

"Use on yourself" (eat, drink, wear) was U; it is the right click now.

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
| **Stab** | Shift + X (was C) | Holding a knife, screwdriver, ice axe or anything pointed; something in reach | `strike` with the tip (grip-limited thrust). It sticks in wood (pull out with Shift + X again), pierces canvas and skin, cracks ice, and bends on steel. |
| **Push / shove** | Shift + X (was C), or a click to keep pushing | Empty hand; a person, door or loose thing in front | An open-hand push: a door swings, a cart rolls, a person staggers (a shove counts as battery only if they fall). |
| **Pry** | R (hold) | Holding a crowbar or screwdriver; a door, window, crate, drain cover or kerb stone in front | A steady force at the tool's tip against the gap. It opens when the force beats the latch or the friction. This is the engine's withdrawal and wedge terms, used slowly. |
| **Saw** | R (hold) | Holding a saw; wood or a branch in front | Drawn slicing cuts. The depth builds over time, not per blow. |
| **Carve / whittle** | R (hold) | Holding a knife plus a stick or branch in the other slot, or a carving block in front | Thin slicing cuts along the grain that shape the piece. Mostly a craft and repair action. |
| **Dig** | R (hold) | Holding a shovel or trowel; soil, turf, sand or gravel underfoot | Cone-index soil resistance (`soils`), so turf is slow and sand quick. Can bury and dig up things. |
| **Hammer in** | R (tap) | Holding a hammer, with nails in the bag; wood in front | Repeated face strikes on a nail's head (`nail` implement). It goes in until withdrawal grip and length match. |
| **Sip / bite** | Right click, or a click on it (was U tap) | Holding a drink or food | One sip or bite: a share of it, with its effect scaled. The item is lighter and shows what is left. |
| **Finish it** | Either held down (was U held) | Holding a drink or food | Drink or eat the rest. |
| **Climb** | Space (was E) | Facing a wall, fence, tree, ladder, rock or pole within reach, where the climbing engine finds holds that hold (`climb().holds`) | You take the holds. Arrows move up, down and across, each step a release test (`releases`). A limb that cannot let go stays, and the chip says why. Stamina drains with `effort`. If `holds` turns false (rain, sweat, tiredness, a pack) you slip and fall, hurt by the height. Space pushes off. |
| **Mantle / vault** | Space | Facing an edge between waist and chin height (a low wall, a fence top, a ledge) | Space still means "go up": a jump that ends on top. Hands press down (the climbing engine's press share), so strength and the edge's depth decide whether you make it. |
| **Hang and drop** | Arrows down at the edge (not built) | At a ledge or roof edge | Lower yourself by the hands before dropping, so the fall is a body length less. |
| **Chalk up** | Right click | Holding chalk (sold at sports shops) | Hands become `skin_chalked` for a few minutes, so slopers hold where sweaty hands slip. |
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
| Stucco, glass, polished stone | No holds. The chip shows "Nothing to hold on to". |
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
  `[X] Chop the oak`, `[Shift+X] Stab`, `[Space] Climb the fence`, `[Right click] Sip the coffee`. Each chip is
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
4. **Use, tap and hold** (built on U, now the right click). Sip and bite against finish. Chalk.
5. **Climbing** (built on E, moved to Space). Holds from fences, trees, ladders and sills first; brick and rock later.
   Mantle on Space. Falls.
6. **Y / N** for Yes / No questions, and the greyed-reason chips everywhere.

Each step ends with ACTIONS.md updated (the keys table and "Bar button shown when").

**Where it stands (2026-11-24, branch claude/material-physics, local commits, not pushed or
deployed):**

* **1 done.** `docs/city/affordances.mjs` declares every particular control. The hint strip is on
  screen, and H lists the keys with a Hints setting. H is still written by hand, not generated.
* **3 done.** Shift + X (was C) thrusts (crowbar jab, sledgehammer ram, knife stab, spade jab) and, empty-handed,
  pushes and shoves (`mechanics-work.mjs` `push`, `shove`). R held saws, pries, cuts, carves (knife)
  and digs (spade); R tapped hammers in a nail (`drive`). The engine's words say what each blow does
  (`strike-preview.mjs`).
* **4 done.** A right click (was U) or a click on the food takes a mouthful, and held eats on (`eat-play.mjs`). The dish is drawn as the cook
  made it (`plated.mjs`).
* **5 done.** Space climbs (`climb-play.mjs`): onto, over, up and off walls, or the first holds of a
  climb, then the arrows. E is gone.
* **6 done.** Y / N, and greyed chips.
* **2 not done.** The world's damage still comes from `rules.json`; the engine only describes the
  blow. The hole a spade digs and a carved mark are drawn on this device only.

* **Second pass (same day).** The mouse does what keys did: a click picks things up and sets them
  down, sets a nail by hand, pushes what is too heavy to carry, calls staff over to chat and order,
  and a held press eats. The Tasks list opens a card per task with Go there. Pets moved to the
  profile. V, B, J, K, E, H and PageUp / PageDown were removed, then G, U and C (a click, a right
  click, Shift + X) -- see "Every control today".
* **Third pass (same day).** A pushed thing is stopped by building walls and by things in the
  street. The first touch is a blow, and after that a press, or a scrape along the wall at a slant
  (`mechanics-collide.mjs`). Each object is a coat over a body, and each layer is marked by its own
  laws.

**Not built from the table above:**

* Chop, Split and Hack as X's labels: X says "Swing" with the engine's result.
* The charged swing (hold X).
* Hang and drop.
* Chalk.
* Sharpen.
* Look at a mark (S still names buildings and streets).
* Push for doors and carts: Shift + X and a click push loose things and people only.
* What a pushed thing does to what it hits stays on this device: the marks are drawn here, and
  the struck thing's damage is not sent to the world. A pushed thing does not shove another one
  along, and room walls indoors do not stop it yet.
