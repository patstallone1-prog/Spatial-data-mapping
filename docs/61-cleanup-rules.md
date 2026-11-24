# Rules against things that cannot be (2026-11-23)

A last pass over named faults. Each is fixed where it was made and, where it can come back from
new data, guarded by a rule and a count.

## Street

- **A tree beside a pole.** Trees were placed before the furniture record (lights, signs, meters,
  signals) was read. Both now read it once (`streetFurnitureOnce`). An opening within
  `TREE_POLE_CLEAR_M` (0.75 m) of a pole is slid along the walk like any other obstacle; with no
  slide clear, the tree is left out. A tree with no opening is stepped off the pole, or left out.
  `kerbsideTreeSquares.poleMoved / poleDropped`. Utility and trolley poles are not in that
  record and are not checked.
- **A kerb apart from its walk.** A surveyed (lidar) kerb was drawn wherever the page's pavement
  was within 1.5 m of it, so where the walk curved to a corner or the two lines disagreed the
  kerb stood alone. The walk stands its own kerb face along its whole edge; a surveyed kerb is
  now drawn only on that edge (`WORLD_KERB_SUPPORT_M`, pavement within 0.25 m), as its finer
  drawing. Off the edge there is only the walk's own kerb.
- **Loose furniture.** `furnitureMisplaced(x, z)`: not in the road or a junction's box, across a
  driveway, within 1.8 m of a crossing, or on an island (roadway within 3.2 m on two opposite
  sides). Asked of every bench not placed by a bus stop. `kerbsideFurnitureGuard()`.

## Vehicles

- **Turning in the junction.** A lane's corner curve began a metre before the lanes' corner. A
  vehicle now has a lead (`TURN_LEAD`: 4.5 m a car, 6.5 m a bus or lorry) and the curve begins
  that far back in its lane: gentle at first, sharpest half way round. Long vehicles take the
  turn at 0.7 of the turning speed.
- **A bus at its stop.** It pulls in over `BUS_PULL_M` (28 m, was 18) with its body along its
  path, not sideways square to the street.
- **Against its wheels.** A drawn car catches up with its place only the way it faces
  (`detail.mjs wheelStep`): never back unless reversing, across by at most 0.45 of what it moves
  along; standing, it stays where it was drawn.

## People and bicycles

- **Lights and gaps.** At a signal a walker sets out only if the street they cross is on red now
  and still at half and 85% of their own crossing time. Without a signal the gap they need is
  the walk out to the car's line plus two seconds, not a fixed four.
- **Bicycles.** At home: indoors, not drawn. Out: a rack within 60 m; else leant on the wall
  beside the door (`City.bikeLean`), 1.5 m or more from the doorway, never before a driveway.

## Not fixed

- Walkers crossing mid-block, and walkers leaving a crossing along an island: the cause was not
  found. Walk ends are drawn straight from a door or a stop to the pavement line, which can cut
  a corner of the road; the island case was not reproduced.

## Second pass (2026-11-23, PR after #235)

- **Walk routes.** `City.legalize` left any stretch of roadway under 16 m that no crossing
  covered: a path over a street, or the walk's line doubling out into the road and back
  through a staggered junction. Spurs are cut out; a path over a street is recorded as a
  crossing, so it is waited at for a gap. Planned positions on the roadway and not on a
  crossing, Marina: 9.4% -> 3.2% of 126,000 samples (1,157 spurs, about 13,000 path crossings).
  What is left is mostly runs over 16 m that could not be moved onto a pavement.
- **Frame rate.** `FPS_CAP` 40: the choices are 15, 30, 40; a saved 45, 60 or unlimited is 40.
  Kept to the beat on a 60 Hz screen (two refreshes, then one).
- **Camera.** `MAGIC_VIEWS`: 7 m behind and 0.36 rad down on foot, 13 m and 0.44 at the wheel,
  taken up on entering the city and on getting in or out of a car; yours once you turn or zoom.
- **Yard fences.** `fenceBeforeFront`: chain link is not laid between a street and a building's
  front (Marina Middle School on Chestnut). **Car parks:** stall lines in metre lengths and
  wheel stops in three, so they follow the ground; a 6.5 m gate noted at the entrance.
- **Furniture.** A bus stop's bench is asked of `furnitureMisplaced` too.
- **Walker.** `nudgeToOpening`: stopped at a wall with a door or a gate within 2.6 m ahead, the
  walker is carried along the wall to it. **Car.** `carBodyBlocked`: the player's car is tested
  at its corners and sides against solid things; it was moved as a 0.3 m walker.
- **Rooms.** `interiorsOnStop`: no house has rooms until you stand still 0.6 s on foot; then the
  three nearest within 26 m; walking on, those over 34 m off are taken down. Enter at a door
  swings it open while its rooms are built and its file (asked for as you reach the door)
  arrives; you go through at 1.15 rad. `kerbsideInteriorsOnStop()` has the counts and a log.
- **Tiers.** Past the moderate ring no person or vehicle is drawn (`DETAIL_FAR_DRAWN`). In the
  camera's view the rings reach half as far again (`DETAIL_CONE`), and what is out of sight is
  made ready 1.5 rings out (`LOCK.ahead`).

### Measured (headless Chrome, Metal, Marina, same fixed street-level camera)

| | main before | this pass | this pass + car models (#236) |
|---|---|---|---|
| triangles a frame | 11.9 M | 12.0 M | 14.1 M |
| draw calls a frame | 2,608 | 2,568 | 2,759 |
| JS heap | 3,441 MB | 3,207 MB (1,894 in another run) | 2,730 MB |
| processor, 30 s | 26.8 CPU-s | 26.1 CPU-s | 31.2 CPU-s |
| frames drawn a second | 25.6 | 25.6 | 22.1 |

The runs differ in the game's hour (13 to 204 people in view), and run-to-run heap varies by
more than the difference: no saving is shown. The frame is the world's geometry: the Marina's
ground is merged into pieces 400-1,600 m across (yards, roads, medians, terrain tiles), about
12 M triangles drawn whichever way the camera faces. Far buildings are 0.12 M of that, so flat
cards for them were not built. Cutting the ground into pieces small enough to cull is the work
that would lower it; `MERGE_TILE_M` does not reach the attached region's ground.
