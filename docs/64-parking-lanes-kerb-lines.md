# Lanes beside the parking, kerbs followed along the block (2026-11-24)

Two things asked for: use what is known about parking at the kerb where a street has no lane
record, and draw the marks that show a parking space; and read the kerbs every few metres and
lay the walk to them, subtly, with nothing warped, looking for any stretch where the kerb goes
out, in and out again.

## Lanes that fit beside the parking (module 06, `settleParkingLanes`, `fitLaneBands`)

Chestnut Street by Fillmore was painted as four equal lanes, kerb to kerb, with the city's
parking meters down both kerbs. The street's bands came from a record that had no parking lane
in it, and nothing asked whether four lanes fit.

- **Where there is parking.** A side of a street is a parking lane where its tags say so, and
  now also where the city's own meters stand along it: two at least, and one to every 45 m of
  the street, each within 14 m of its line and beside it (not past its end, where it is the
  cross street's). `way.parking_sides` gains the side, `way.parking_basis` says
  `sfmta_parking_meters:<count>`, the tagged sides are kept in `way.parking_sides_tagged`.
- **What fits.** A parking lane is 2.4 m (`PARKING_STALL_M`). At every station the bands are
  made to agree: a parking lane is put in at a metered kerb that had a lane of traffic against
  it, then lanes of traffic are taken out, the ones nearest the kerbs, one from each direction
  at a time, until those left are 2.9 m wide or there is one each way.
- **The city's traffic** drives the lanes that fit (`way.lanes_fit`, read by `docs/city/view.mjs`).
- **The mark.** A white T in the road a space's width off the kerb at each single-space meter
  (`addParkingStallMarks`, module 21): none at a driveway, on a painted kerb or in a bike lane.
  The city publishes the meters, not the paint: the marks are recorded as inferred from the
  meter inventory, one at each meter, not surveyed.

In the Marina as loaded: 317 meters, all placed on a street; 229 sides with parking known, 5 of
them from the meters alone; one street's lanes refitted for the traffic (Lombard Street's
service stretch, 3 to 2). Seen in the browser: Chestnut Street by Fillmore with one double
yellow line down the middle and the T marks along the kerb, none in the bus zone.

## The kerb followed along the block (module 08, `kerbProfileFrom`, `settleKerbProfiles`)

A street was drawn at one width from end to end. The city's kerb lines are read across it
every 4 m (`way._stations`, the readings that already put the street on its kerbs' middle);
now the street follows them, within limits:

| limit | value | why |
|---|---|---|
| never further from the one width | 0.45 m a side | a bigger difference is a bulb, a bay or an error, not the kerb's line |
| no change under | 0.08 m | the survey's noise |
| no change shorter than | 12 m | a driveway's dip, a reading |
| no turn sharper than | 1 in 20 | under three degrees: a taper, never a step |
| nothing within | 12 m of a corner, eased in over 16 m more | the corners are built from the one width and stay as they are |
| readings wanted | half the stations away from corners | or the street keeps its one width |
| readings' spread | under 1.6 m (5th to 95th) | or the street keeps its one width |

A reading with none beside it takes its neighbour's; one odd reading in three is put aside
(the middle of each three), and the line is the mean of each three. Where the line changes at
one rate it is a straight taper; the street's line gets a corner every 4 m where it follows its
kerb, so the walk, the kerb and the roadway turn together.

**Out, in and out again.** The line's turning points are found (each a turn of 0.25 m or more
from the one before); any three of them within 80 m is a wave. A waving stretch keeps the one
width and is listed with its place: `kerbsideKerbProfiles().waves`
(`{ street, at: [x, z], from_m, to_m, swing_m, readings }`).

In the Marina as loaded: 140 streets read, 30 follow their kerb over 1.8 km of their length,
15 have too few readings and 3 readings too far apart to follow; 3 stretches (188 m) wave and
keep their width.

## What the waves were

Looked for in the raw readings of the Marina's 165 streets that have them (20.9 km): 27 streets
had such a stretch, 1,668 m in all. The largest were photographed from above: Retiro Way
(5.6 m out over 24 m), Webster Street at Lombard (2.5 m), Chestnut Street at Pierce (1.5 m).
Every one was a junction: the reading across the street runs on round the corner to the side
street's kerb. (The three the page still lists are these, where a street joins at a slant and
its mouth is longer than the 12 m kept clear of a corner.) So the guess was right -- they are errors of reading, not kerbs -- and there
were three faults behind them, each fixed at its cause:

1. **A junction was only known by a corner of the other street's line.** Two streets that
   cross between their corners, or whose shared corner moved when each was centred on its own
   kerbs, did not "meet", and the readings round that corner were taken for the block's own.
   Now the lines themselves are asked (`meets`, within 3.5 m).
2. **The kerb finder gave a point inside the road beside every corner of a street's line.**
   `nearestKerbAt` took the nearest edge of any piece of roadway, and each piece has a round
   end: a point a hand inside the kerb, within a metre or two of a corner of the line, was
   nearer the next piece's round end than the straight kerb beside it. The gutter laid on that
   stood up to 0.2 m into the road and came back, at every corner of the line -- on a street
   that follows its kerb, every few metres (Webster Street, seen and measured: the gutter's
   kerb side stood still for a metre, then jumped 0.3 m). The straight edges are now asked
   first; a round end is the kerb only where it is clearly nearer (the end of a street, the
   outside of a bend). This was in the page before this pass, at every original corner.
3. **A piece of roadway knew one width.** The road and walk are drawn tapering between
   stations; the record everything else asks (is this roadway? where is the kerb?) held the
   mean of a piece's two ends, so paving was cut and gutters laid on steps beside the drawn
   edge. Each piece now carries the width at both ends (`addCarriagewaySegment(..., halfA,
   halfB)`), and `insideCarriageway`, `insideStreetCarriageway`, `onAnotherCarriageway`,
   `insideMeasuredCarriageway` and `nearestKerbAt` read the width at the point
   (`carriagewayHalfAt`).

## One width a street, from the city's readings (`settleStreetWidth`)

Asking why so many streets sat at the 0.45 m limit for a whole block: the street's one width
was the middle of the readings taken round each corner of its *line* -- and a line with two or
three corners has them at its junctions, where the kerbs stand back -- or the width on the
street's record where that was within a metre and a half. Webster Street north of Lombard was
drawn 13.45 m kerb to kerb; 54 readings along it have their middle at 11.72 m. Each walk was
0.87 m short of the city's kerb for the whole block.

Now, where the readings away from corners agree among themselves (middle half within 0.5 m),
number six or more, and differ from the width by more than 0.2 m (and by less than 30% of it:
further is a blunder to look at, not to draw), the readings are the width. The old one is kept
in `way.road_record_m`, the basis in `way.road_basis = "official_curb_stations"`, and each
change is listed in `kerbsideKerbProfiles().widths`. A street already at the widest any street
is drawn (24 m) is left as it is.

In the Marina: Webster Street 13.45 to 11.70 m, Scott Street 12.33 to 11.59, Steiner Street
11.72 to 12.16, Divisadero Street 13.31 to 13.56, Buchanan Street 11.64 to 11.85. Of 165
streets with readings, 7 were more than 0.3 m a side from their readings' middle before and 5
after (the ones left do not agree among themselves, or are divided). Seen in the browser:
Webster Street's block with the roadway narrower, both walks out to the kerb line, the kerb
and the gutter straight, and the corners at its junction as they were.

## Guards

- `tests/kerb_lines.test.mjs`: a flat kerb keeps its width; a block standing in is followed
  within every limit, with nothing at corners or junctions; a wave is not followed and is
  listed; a short change is not followed; the roadway's edge is one line across a tapering
  piece and across the joint to the next (and a street's end is still its round end); the
  street's width from its readings; four lanes with parking both sides become one each way;
  the meters, the fit and the marks are wired in.
- `tests/test_page_loads.py` loads the built page (it caught a constant read before it was
  defined: `nearestKerbAt` is called by modules that run before module 19's own lines).

## Not done

- The T marks stand at the meters, which is the front of each space, not surveyed paint.
  Streets with unmetered parking and no parking tag are not found by this.
- A kerb more than 0.45 m off its street's width for a block (after the width is settled) is
  drawn 0.45 m off: bulbs and bays are the corner builder's and the bus zones' to draw.
- The kerb's line is not followed within 12 m of a corner.
