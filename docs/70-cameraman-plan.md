# The cameraman (plan)

Status: plan only, nothing built. Kept on branch `claude/opus-wall-materials`, not merged.

## What it is for
In City mode the view should look after itself the way a good camera operator would:
- it keeps adjusting as you move;
- it cuts to a better shot when one is needed;
- it shows what you are doing in more detail.

When you take the view yourself, it keeps your choice of where to look, but pushes harder than
today's camera away from whatever is in the way, toward an angle that shows the same thing.

The measure of success is that the blue outline (module 32's `magicGhostMaterial`, you drawn
through a wall) is needed far less often, ideally only for the moment a cut is being prepared.

## What the camera does today, and why the outline shows
Taken from `src/smc/renderer/page/module/32-the-magic-camera.js` and `orbitBlockedAt` in module 21.

1. **Only buildings are seen as blockers.** The probe (`orbitBlockedAt`, `magicWallLean`) asks
   `orbitBuildingTop`, a footprint and roof height. Trees, poles, bus shelters, awnings, parked vans
   and buses, fences and stoops are invisible to it. The outline is drawn wherever anything nearer
   hides you (`depthFunc: GreaterDepth`), so a street tree between you and the camera shows the
   outline, and the camera does nothing about it.
2. **Yes or no, from one point.** The probe casts one line to one aim point. Half of you hidden
   behind a parked car counts as clear; a lamp post through the aim point counts as blocked.
3. **Only while you move.** It looks for a clear line every 120 ms, and only when you are going
   faster than 0.3 m/s. If you stand at a counter or talk to someone while a bus pulls up between
   you and the camera, nothing is checked.
4. **A small set of moves.** It tries 27 offsets: yaw up to ±1.05 rad and up to 0.3 rad higher.
   It never tries standing nearer, moving sideways (over the shoulder) or lower, and it never cuts.
   If none of the 27 clears, it zooms in and the outline covers the ease.
5. **Your drag switches it off.** For 1.8 s after a drag (`dragHoldMs`) nothing is checked. After
   that it only acts while you walk.

## How it would work

### 1. Visibility as a score, against everything that blocks
- **Subject points.**
  - On foot: head, chest, hands, feet.
  - In a car: the four corners and the roof.
  - Plus the thing you are dealing with: the door, counter or person you are talking to, the bay
    you are working in, or the junction ahead when driving. These come from the game's current
    interaction (the same state the To do and hint panels read).
- **A cheap occluder set beside the building heights.** A spatial hash, rebuilt as tiles load,
  holding:
  - tree crowns and trunks as spheres and cylinders (the tree survey tiers already know where they
    are and how big);
  - poles, shelters, kiosks and awnings as boxes, from the object catalogue (`docs/object-catalogue.json`),
    which already says what blocks a walker;
  - vehicles as boxes, taken from the fleet each check;
  - fences and walls as thin boxes.
  It holds no meshes and does no GPU readback, so the cost stays small and predictable.
- **Score.** The share of subject points seen, weighted: head and hands count most on foot, the car
  body at the wheel. A sparse tree crown counts as partly see-through rather than solid.

### 2. Shots chosen by score
Candidates are camera positions described by yaw, pitch, distance, a sideways shoulder offset and a
height offset. Each is scored on:
- **Visibility** (above).
- **Framing.** You on a third of the frame, with room ahead in the direction you are going; the
  thing you are dealing with in frame too.
- **Continuity.** A cost for how far it moves from the current shot, so the view does not wander.
- **Comfort.** No near-plane clipping, no standing in a wall, and limits on how fast it turns and climbs.
- **Detail.** Closer when you are still or busy with something; further back at speed.

Candidates come from two places:
- a neighbourhood of the current shot (for drifting);
- a few named shots (for cuts; section 4).

### 3. Drift: always adjusting
- The score is checked at about 8 Hz, standing still as well as moving, with about 150–250 rays per
  check on the CPU.
- The view eases toward the best candidate in its neighbourhood, with today's rate limits (yaw,
  pitch, pull-in time constants).
- Today's 27 tries become a scored search that also covers distance, shoulder and height. Most
  blockers are then cleared by a small sideways step or a slightly lower or nearer camera, not by
  swinging the view round.

### 4. Cuts
- **When it cuts.**
  - No candidate within reach of a drift scores well, and a named shot does. For example, you turn
    a corner into a narrow gap between buildings, or a bus stops on the camera's side.
  - An event: getting in or out of a car or bus, going through a door, starting a conversation, a
    crash nearby, arriving at a destination.
- **The rules a camera operator would keep.**
  - Keep screen direction: stay on the same side of your line of travel, so you still walk the same
    way across the screen after a cut.
  - Change angle by at least 30°, or the cut reads as a jump.
  - Hold a shot for at least about 2.5 s before cutting again.
  - Never cut while you are steering hard or in a crash's first second.
- **Pre-warm.** For one or two frames before a cut, the target shot's tiles and level of detail are
  asked for, so the new view does not open on grey or popping buildings.
- **Named shots.**
  - On foot: follow, over the shoulder (talking, shop counters), close on the hands (cooking,
    repair bay, climbing holds), and wide when entering a new block.
  - Driving: chase, low chase, and a side view at a junction.

### 5. When you hold the view: the prod
- Your drag is your intent: which way to look, and roughly how far.
- The cameraman keeps your yaw within a band around what you chose. Inside that band it solves for
  pitch, distance, shoulder and height, pushing harder than today's `pushMax` of 0.3 rad. It never
  turns against the direction you are dragging, and it lets go the moment you drag again.
- It never cuts while you hold the view. It can still slide or step closer to keep the same things in
  sight.
- A setting picks off, gentle or strong. This is a top-bar setting rather than a key, because most
  keys are already bound (docs/63's list of every control).

### 6. The outline as a last resort
- It is shown only when the score has been below a threshold for more than about 250 ms and no
  drift or cut clears it, or for the frames before a pull-in or cut lands.
- It is not shown for see-through occluders such as tree crowns or chain-link fences.
- How often it shows is measured (section 8) and is the headline number.

### 7. Better detail
- Close shots go with what the page can already do: fine sun-view shadows and real glass
  (`docs/` notes on fine shadows), and the near tiers of trees and people.
- The cameraman tells the level-of-detail system where the next shot will be, so the subject's
  surroundings are upgraded before the cut, not after it.
- Shot distances follow what is worth seeing: close enough to read a face or a sign on foot, and
  far enough back to see the junction at the wheel (today's `MAGIC_VIEWS`).

## Where the code would live
- **`docs/city/cameraman.mjs`**: the pure part, testable in node. Candidates, scoring, the drift
  ease, cut rules and shot memory. It takes a `blockers(rayFrom, rayTo)` query and the subject
  points, and knows nothing about three.js.
- **The page side** (module 32, or a new module 34 after the water module):
  - builds the occluder hash from the catalogue, the tree tiers and the fleet;
  - answers the ray queries;
  - gives the cameraman the subject and the current interaction;
  - applies the chosen shot.
  Module variables stay `var` and guarded, because the page draws frames before later parts run.
- **The outline** stays in module 32, gated by the cameraman's score instead of `orbitBlockedAt`.

## Measuring it
A headless harness, using the recorded-route recipe the traffic and frame-cost checks already use,
runs fixed Marina routes:
- walking Chestnut Street past the trees and shelters;
- standing at a counter while a bus pulls up;
- driving Lombard Street at rush hour;
- a shop interior;
- a climbing route.

For each route it records:
- the share of time the outline is on;
- the subject's mean visible share;
- the time the subject is off screen;
- cuts per minute;
- peak and mean turn rate (comfort);
- frame cost of the cameraman (target under 0.5 ms a frame).

First the baseline is recorded with today's camera. The aim is to cut outline time by at least
80% without raising the turn rate.

## Phases
1. Occluder hash, visibility score and the harness, with no change in behaviour. This gives the
   baseline numbers.
2. Drift: the scored search, checked while standing still too. The outline is gated on the score.
3. The prod while you hold the view, and the off, gentle or strong setting.
4. Cuts on events and on poor scores, with pre-warm.
5. Named detail shots (over the shoulder, hands, junction side view) and level-of-detail hand-off.

Each phase is measured against the baseline before the next starts.

## Questions for you
1. Should cuts be hard cuts, or a quick (about 0.3 s) swoop?
2. While you hold the view, should the default prod be gentle or strong?
3. At speed in a car, may it cut (for example to a side view at a junction), or only drift?
4. Should interiors (shops, kitchens, homes) be in the first version, or streets only?
