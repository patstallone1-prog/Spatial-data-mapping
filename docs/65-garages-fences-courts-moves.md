# Garages, fences, courts, trees and the body's moves (2026-11-24)

This round fixes things seen in the Marina: garages, fences, courts, trees, and the walker's jump and X swing. Each rule below has a test, and every number was measured in the running Marina City build (headless Chrome, guest realm).

## Garages and entrances

Rules:

- **Garages sit behind their kerb cuts.** A garage comes from the city's record of a dropped kerb.
  - `garageOnItsCut` (module 13) checks every fitted door. A door that has slid off its cut is drawn back within the cut's width, with 0.3 m of slack. It is narrowed if it must be, and dropped if that leaves less than 2.2 m.
  - A door can slide off when it is clamped off a wall's corner, merged over two cuts, or narrowed for the front door.
- **Nothing may be built in front of a garage.** `garageFrontBlocked` checks the ground 0.4 m and 1.2 m out across the door's width. If that ground is inside the building's own footprint (the door is at the back of an indent) or inside another building, there is no garage.
- **A photographed front entrance and a kerb garage cannot overlap.** On a fitted front, the photographed front entrance (`primary_entry`, at its recess width) replaces a kerb garage that overlaps it or comes within `DOOR_CLEAR_M`. The match is `openingsClash`, across collinear footprint edges.
- **A door under a garage moves beside it.** A door of any source (inferred, mapped or photographed) moves along its wall to clear wall beside the garage (`moveDoorOffGarages`). The rooms are unchanged: the door is set into the wall.
- **When there is no clear wall beside the garage:**
  - An inferred door is dropped.
  - A mapped or photographed door takes the kerb garage down instead (`takeDownGarage`). Its merged quad is folded to nothing and it no longer opens; the kerb cut stays.
  - If the photograph shows that garage too, the garage stays. The door goes, and the house falls back to `frontDoorSpot`.
- `window.kerbsideGarageDoors()` checks every settled door against every garage on its edge.

| Measure | Value |
|---|---|
| Garages dropped as off their cut | 160 |
| Garages dropped as blocked or indented | 47 |
| Doors moved | 682 (110 mapped or photographed) |
| Inferred doors dropped | 88 |
| Garages taken down | 1 |
| Doors under a garage | 0 (was 10) |
| Doors crowding a garage | 0 |

## Fences

- **No joins between owners.** Every fence is laid under an owner (`fenceOwnedBy`): a property, a block of courts, a park area, or one run of the ground's fences. `closeFenceEnds` carries a free end on only to a wall or to more of its own fence. Another owner's fence in its way leaves the end open. Joining a court's fence to a school's had shut the park path at Moscone.
  - Closings fell from 10,692 (75 km) to 1,933 (7.7 km).
- **Closings stay off paths.** The closing ray's path test used the ray's square rather than its run, so closings crossed the paths they were meant to avoid. It now passes the ray's own direction. A closing also stops at park paving and at any path tread (`onPublicPath`).
- **No fence on a path.** `fencePieces` never lays a fence on a mapped path's tread, whichever way the fence runs.
- **Gate leaves are not closed.** A gate's swung leaf (`sink.leaf`) is not a fence with ends.
- **Moscone result.** No fence or closing crosses a mapped Moscone path. The one remaining crossing is an open gate leaf, which stands beside its gate's opening.

## Paving under fences

The fault was a paved cover's triangle laid across a fence line with a bit of under 1.5 m on the lawn side. There were 1,018 of them.

`cutPavingAtFences` (module 17) now cuts the bit out exactly on the fence's line and only beside the fence. Paving past a fence's end is kept. It runs after every fence is laid.

Only a bite into lawn is cut. Paving that carries on beyond a fence keeps its triangle.

The page counts what is left: `kerbsideFenceBites.left` is 1 of 318.

## Courts

A hard court in a park used to stand on the park's grass. It now stands on one concrete slab out to its fence: unpainted concrete toned a third of the way to the court's colour (`courtSlabColour`). The courts' acrylic and paint are laid on top. A field (soccer) is still grass.

## Trees

A tree whose base (0.6 m round) touches lawn is moved the least way, up to 3 m, so that its whole base stands on lawn (`treeOntoGrass`). It also keeps off fences, driveways and poles. A tree in a kerbside opening keeps its opening.

In the Marina, 61 trees were moved and 1 had no room.

## Jump and X

`docs/city/body-moves.mjs` holds the poses, tested in `tests/city_body_moves.test.mjs`.

- **Jump:** a crouch first (0.2 s: knees and hips bend, arms back), then take-off at the bottom of it. In the air the arms swing up and the knees lift. On landing the knees give, then the body stands back up.
- **X, empty-handed:** a straight punch from a guard. It goes out fast to the target's height, with the shoulders turning into it, and comes back slower to the guard.
- **X, holding something:** a swing wound up over the shoulder with the shoulders turned away. It comes down and across through the target and follows on past it.
- **`jumpGrab`:** the arms reaching overhead for the top of a fence.

The climbing itself lives in PR #242's `climb-play.mjs`. Wiring the grab into it is a patch for that branch.
