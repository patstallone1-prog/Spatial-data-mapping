# Street paint in its lane, parking from the census, medians that leave room to park, 2026-11-26

This pass covers the Marina's road surface:

- each piece of street paint in the lane it belongs to, never on another piece;
- every block's parking known, with the lanes rebuilt from the edge of the parked cars;
- one sign where two said the same thing;
- divided streets whose medians covered their parking;
- at Fillmore & Chestnut: the Muni flag off the road, and the crosswalk onto the island.

Confidence scores are in docs/74.

## Fillmore & Chestnut

**The Muni flag stood in the street.** The stop's pole was placed where the stop record put it,
and that point was in the slip lane. The flag is not laid on any of these:

- the carriageway;
- a junction box;
- a building;
- a crosswalk.

It goes on the nearest pavement or surveyed kerb island within 10 m of the stop, at least 0.3 m in
from the island's edge, or it is not put up at all (`stopFlagAnchor`, module 19). An inventory flag
on a traffic signal's pole moves to its own post on the same pavement (module 20).

Across the Marina, 17 flags moved and 7 were dropped because they had no pavement near.

**The crosswalk across the slip lane stopped 2 m short of the new island.** Two separate causes:

- **The mapped end.** The crossing is mapped to end in the lane. A crossing's end within 6 m of a
  surveyed island is now carried on to the island's kerb (`crossingReachesIslands`, module 14), and
  its bars are painted to it (`crossingPaintLegs`, module 05).
- **The trim.** The end then lands at the island's nose beside the Chestnut crosswalk, and the
  overlap trim (`trimCrossingClear`) cut it back 1.7 m, off the island and into the lane. An end
  landing on an island now keeps its place when it only shares the other crosswalk's corner, up to
  3 m² (`CROSSING_ISLAND_CORNER_M2`).

**Yellow tactile pads.** The island has one on each side, where each crosswalk meets it.

## Street paint: in its lane, one after another, never overlapping

**STOP words** were spaced evenly across the arriving half of the road, from the centre line to
the kerb. Where the kerb lane is a parking lane, the word nearest the kerb lay across the parked
cars.

Each STOP is now centred in an arriving lane the way's cross-section has at that point
(`arrivingLaneBands`, module 20). That cross-section is read after the parking is fitted, and it
leaves out the parking lane and any bike lane. A way with no section falls back on the even split.

**Turn arrows** were placed across the lanes of the street's middle section. They are now placed
across the lanes the section has near the street's end, where the arrows are painted
(`turnArrowLanes`, module 15). Each arrow is in the middle of its own measured lane.

**Bus zones.** A red zone's words are centred between its two lines, the kerb and the zone's white
edge (module 21). Before, they were centred across the zone's full width, white edge included.

**Bike lanes** are claimed on the paint plan as fixed paint, in pieces up to 8 m long, each the band
between the lane's two lines (`notePaintedBikeBand`, module 06; `bike` in `PAINT_KINDS`). No STOP,
bus box or word is laid in a bike lane.

**No overlap.** The paint plan (docs/street-paint.mjs) already settles every claim:

- paint already on the road first, then the better-sourced;
- a word that would touch other paint slides back along its lane, one step at a time, until it is
  clear (STOP after an arrow in the same lane);
- or it is not laid.

Two more kinds of paint now stay off other paint:

- **Angled stall lines** stop at crosswalks and junction boxes (`stallOverCrossingOrJunction`,
  module 14). Fillmore's median parking strip ran its stall lines through the Bay Street crosswalk
  and into the junction.
- **Crosswalks** were already trimmed off each other.

## Signs: no duplicates

Two plates with the same legend facing the same way, for the same street, are one sign:

- other signs count as the same within 15 m, facing within 35° of each other;
- speed limits count as the same within 60 m, and where two disagree the lower is kept.

A post left with no plates is removed, unless it is a signal's pole (`dropDuplicatePlates`,
module 20). In the Marina this took off 72 plates and 2 speed limits, and removed 55 empty posts.
`kerbsideSignDuplicates()` reports the counts.

## Parking: every block, from the census

OpenStreetMap tags the parking on fewer than half the streets. The meters cover only the metered
blocks.

SFMTA's On-Street Parking Census (DataSF `9ivs-nf5y`, public domain) counts the public spaces on
every block, both sides together. `tools/build_parking_census.py` works out which sides are parked
and writes `docs/sf-corridor-parking-census.json`:

- **Room.** Each side's room is the block's length, less 4 m at each corner, less the driveways cut
  into that side's kerb, at 17 ft (5.18 m) a space. The city's curb cuts are placed by their
  geometry. Their record's "side" field is E or W on every street, so it is not used.
- **Both sides** where the count is at least 40% of the room on both sides together.
- **One side** below that: the side with more kerb free of driveways.
- **None** where the count is nought.

The 40% was fitted on the 1,618 corridor blocks whose OpenStreetMap tags say which sides are
parked:

| Rule | Blocks called right |
|---|---|
| Both sides at 40% or more (used) | 77% |
| Both sides at 45% or more | 76% |
| Both sides at 50% or more | 72% |
| Every block both sides | 71% |

The room is an upper bound: hydrants, bus zones, loading zones and red kerbs are not in it. That
is why a two-sided block fills well under all of it.

**On the page** (module 06):

- Each census block is laid on the street way it runs along: the same name, parallel, its middle
  within 12 m, from the block's start to its end along the way (`applyParkingCensus`).
- A divided street's half takes the census side its outer kerb is on.
- `parkingSidesAt(way, along)` gives the parked sides at a point: the way's own sides from the map
  and the meters, plus the census block's there.
- The census never says which side a one-sided block is on, so where the map or the meters already
  park a side, that is taken as the one.
- The census adds parking only. A block it counts none on keeps what the map and meters say, since
  its zero is often a block it did not survey.

**The lanes are rebuilt from the edge of the parking** (`fitLaneBands`, now block by block):

1. A parked kerb with no parking band in its section gets a parking lane at SFMTA's standard
   parallel parking width, 8 ft (2.44 m; it was 2.4 m). A band the city's curb profile measured
   keeps its measured width.
2. The kerb travel lane it replaces is removed.
3. Lanes are taken out, a pair at a time on a two-way street, until each is at least 2.9 m.
4. The lane lines, centre line, arrows and STOP words are all laid across what is left.

**The city's traffic** reads one set of sides per way: the census's sides wherever they cover at
least half the way (`censusMajoritySides`), with `lanes_fit` refitted to match.

In the Marina:

- 286 census blocks were matched;
- 40 sides were added to ways that had no parking known.

`kerbsideParkingLanes()` gives the counts, and `kerbsideParkingBlocks(name)` gives the blocks of
each way.

## Divided streets: the median less what is parked in it

The raised median between a divided street's two halves was laid across the whole gap between
their lanes. Where a half parks along its median side, or a car park is mapped in the gap (angled
stalls along the median), the median covered the parked cars.

The median is now the gap less what is parked in it (`medianParkingTrim`, module 15):

- **Parking on a half's median side.** A parking lane's width is road, wherever that strip is not
  already carriageway.
- **A car park in the gap** is road out to its far side.
- **What is left** is raised only if it is at least 0.5 m wide.

**Median-side pavement.** A divided half whose other half is found beside it lays no pavement on
its median side. Before, it did so unless a mapped footway stood there, and that paved over parking
strips and planted strips between the halves. The frontage fill already never carries on from a
median side.

## Where the same causes reach elsewhere (not changed this pass)

- **The census's one-sided blocks are a guess** (the build's 77%). Where the map and meters say
  nothing, the side with fewer driveways is taken. Photographs or the city's parking regulations by
  side would settle it.
- **The census's zero blocks** (264 in the corridor that OpenStreetMap does not tag) are left as the
  map has them. Some are no-parking blocks, some unsurveyed.
- **The STOP fallback.** STOP words on ways with no cross-section still use the even split. So do
  turn arrows where the section's lane count differs from the turn tokens.
- **The bike-lane claims** cover the plain lane only. Its mixing zones (dashed, where cars cross)
  are not claimed, and a STOP may be laid there.
- **Planted medians wider than 9 m** are not raised by the median pass (they are "a park"). With
  the median-side pavement gone, what shows there is whatever the ground and the land-use layer
  draw.
