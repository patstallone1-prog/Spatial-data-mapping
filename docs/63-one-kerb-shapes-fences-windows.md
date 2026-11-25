# One kerb, plain shapes, closed fences, windows round the garage (2026-11-24)

What was asked for, what was found by looking, and what was changed. Seen in a headless browser
at Chestnut and Fillmore before and after.

## Kerbs: one, and where each line is measured from

- The separately drawn "measured" kerbs were not lidar. They are the city's digitised kerb
  linework (SFMTA), swept as a second kerb beside the one every walk already stands along its own
  edge. The walks' edges are laid from each street's kerb-to-kerb width (the city's kerb geometry
  where it has it, a lidar profile only where it has none) about the street's centreline, one
  width a street.
- Measured on the page (`kerbsideKerbSources()`, 3,199 points of 399 lines where the Marina
  opens): the linework lies a median 0.10 m to the pavement side of the drawn edge; half of it
  between 0.03 m inside and 0.44 m outside; 46% of points more than 0.3 m off. Two city records of
  the same kerb, measured from different points of it and one of them following every bay and
  bulb: drawn together, wherever they parted the second stood in the road by itself.
- So only one is drawn: the walk's own (`WORLD_KERB_DRAWN = false`). The linework is still read
  and its distance from the drawn kerb reported, with where each is measured from.
- A guard on everything paved, before it is merged (`settleStreetShapes`): a kerb with no walk
  beside it is taken out (96 triangles in the corridor), and a scrap of walk standing alone under
  2.5 m2 with it (90).
- Not done: laying the walks to the city's kerb line station by station. That is the root fix for
  the 0.44 m spread and needs the corner builder to take two lines that do not meet (module 01,
  "one kerb, everywhere").

## The zig-zag: paving cut off the roadway by whole triangles

The row of pale teeth down both sides of a curved service road off Chestnut Street was paving
taken off the carriageway a whole triangle at a time, the ones straddling its edge left. It is
cut along the edge now (`cutCoverBy`, to 0.3 m), as the car parks were in the last pass.

## Islands and odd outlines

The island at Chestnut and Fillmore was pieces of three walks, a median and their underlay
overlapping: its outline was whatever the overlaps left, stepped and many-sided, with a loose
sliver beside it. An island in the roadway (a piece of walk under 420 m2 with roadway round at
least 70% of it) is drawn again as one slab with one kerb round it: its rectangle where it fills
at least 80% of one (corners eased), else the curve drawn round its outermost points (corners
turned at 0.9 m). A long thin median is its rectangle or is left. Five were redrawn in the
corridor (four rectangles, one curve); 112 small pieces were left as they were, being neither.
Corners and bulbs that are part of a block's own pavement are not reshaped.

## Sidewalk squares

Each piece of sidewalk had its own squares, measured along its own run and stretched across its
own width, so at every join the lines of one stopped against the lines of the next. Everything
that wears the sidewalk's texture (2,043 pieces) is on one grid now, square to the district's
streets (9.17 degrees off north), measured from one place: the squares of one piece carry on into
the next.

## Fences

Once every fence is laid, each end that meets no wall and no other fence, and is not at a gate
or a path, is carried on: straight ahead to the first wall or fence within 25 m, else square off
its line to the nearer hand within 10 m. Never across a roadway, a pavement, a driveway, a gate
or a mapped path. Of 22,375 ends in the corridor: 5,521 met something already, 685 are at gates,
10,917 were closed (80.5 km of fence added to 150 km), 5,252 are still open -- nothing to close
onto within reach, or a public way between.

## Windows and garage doors

- No window is drawn within 0.55 m of a garage door's sides or 0.6 m above its head (0.3 m and
  0.35 m for a door), whichever source the window came from. It was 0.15 m.
- An inferred house's windows are composed round what the wall already has: on the storey of the
  door and the garage, each clear stretch takes its windows in its own middle; above, one window
  stands over the garage's middle and one over the door, the rest of the wall is shared out
  evenly between them, and every upper storey is the same.

## Walking pace

One pace at every zoom, 25% slower than it was at the nearest zoom (6.7 m/s on foot outdoors in
the follow view; 4.0 m/s first-person). It had doubled by the City's furthest zoom. A sprint is
as fast as it was. Past 90 m of zoom (the map view in Explore, beyond what the City allows) the
speed still grows with distance, since that is crossing the map.
