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
