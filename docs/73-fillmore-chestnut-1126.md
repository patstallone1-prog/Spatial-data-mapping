# Fillmore & Chestnut, 2026-11-26: signs, the bus island, the median, angled parking, plain rooms

This is a targeted fix of one junction, checked against the owner's street photograph looking
north up Fillmore from Chestnut. The photograph shows:

- a narrow, rounded bus island at the crosswalk;
- a median under 2 m wide;
- cars parked at an angle along the median's east side;
- no yellow line beside the median.

Each part below says what was wrong, why, and what changed. Most causes are not specific to this
corner; the end of this doc lists where else they reach.

## Signs

**Three flags at one bus stop, in two colours.** Within 8 m of the stop's corner stood three flags:

- **The city's own record.** SFMTA's sign inventory lists the Muni stop flag itself as a sign:
  "MUNI LOCAL (FLAG) BLUE" (310 of them in the corridor), "MUNI LANDOR FLAG - TYPE 6/2", and
  others. Those words were set on a green guide plate.
- **The transit stop's flag.** The stop's own flag (module 19) was a blank blue rectangle, with the
  pole through its middle.
- **The living city's flag.** The living city drew its own red-and-yellow flag on another pole a
  metre away (docs/city/view.mjs).

Now each stop has one flag:

- The inventory's Muni flags are drawn as the Muni flag. It is a white plate with a blue band, MUNI
  in it, and the routes of the nearest Muni stop under it (style `muni_flag`).
- A transit stop with an inventory flag within 9 m has no second pole. Every other stop's flag is
  the same plate, on the face of its pole (`addStopFlags`, module 20).
- The living city draws its red flag only where the region has no flag up (`ctx.stopFlags`).

**A sign in the middle of a pole.** A plate on a traffic signal's pole stood 5 cm in front of the
pole's axis. That was right for a 2.6 cm sign post. The signal pole is 7.5 cm, so it ran down the
middle of the plate. Plates on a signal pole now stand off the pole's face (`SIGNAL_POLE_R_M`), and
street-name blades clamp round it.

**Symbol signs with the record's shorthand on them.** The double arrow on the island's nose
("DOUBLE ARROW-LEFT & RIGHT (SYM)", "(45 LA-DN/45 RA-DN) (SYM)") is now drawn as the MUTCD W12-1
symbol: two arrows, down to the left and down to the right.

## The bus island and the median

**The island.** OpenStreetMap maps the island as a Muni platform (route 22). The survey has its
kerb as line 4137, which the aerial pass marked unconfirmed, so the page left it out. The owner's
photograph confirms it, and `CONFIRMED_SURVEY_ISLAND_LINES` (module 15) now keeps it.

What stood there instead was a slab 10 m by 8 m. Three passes built it:

- **The inferred twin median.** Between Fillmore's two halves the page infers a median from the gap
  and raises it wherever it is wide enough: 5 to 8 m here.
- **The corner passes.** `addJunctionSquares` and `addPavementCorners` treated the island's paving as
  a block's corner and grew 4 m squares out from it.
- **The clean-up pass.** `settleStreetShapes` redraws any small island as its bounding rectangle, and
  it took all of these in.

The fixes:

- **The survey's island comes first.** Where the survey has an island in the gap between two halves,
  the inferred median is not raised, nor are the two stations either side of it (the choppy start).
  The rest of the gap is roadway (`surveyedIslandAcross`).
- **No corner pieces on a surveyed island** (`cornerOnSurveyedIsland`).
- **The clean-up pass trims instead of redrawing.** An island the survey drew keeps its own outline,
  and any piece laid over it that reaches past its kerb is trimmed off at the kerb.
- **Crossing pads stay on the island.** A crossing's tactile pad and landing on a surveyed island
  stay on it, narrowed if need be, or are not laid.

**The road divide.** Each half of a divided street laid its pavement on the median side as well.
OpenStreetMap says that side has none, but the page believes that only where a mapped footway
stands there. North of Chestnut this was 4 m of paving either side of the median, over the angled
parking. The frontage fill then carried it on.

Where the survey has an island beside a half's median side, that side now gets no pavement. The
frontage fill never carries on from a median side or from a surveyed island.

**The yellow lines.** Two of them were wrong:

- **The median-edge line.** The yellow line a divided half paints along its median side is not
  painted where a surveyed island lies within 9 m. San Francisco paints no edge line along a raised
  median's kerb, and here the line ran down the asphalt beside it.
- **The double yellow between the southbound lanes.** The gap fill (module 16) painted a double
  yellow between any two parallel one-way ways. It never asked whether they ran opposite ways, and
  Fillmore's southbound lanes and its right-turn lane got one. It now paints double yellow only for
  opposing traffic, and nothing where an island parts the two ways.

## Angled parking

OpenStreetMap maps the parking along the median as a car park: a strip about 6 m wide and 500 m
long between the median kerb and the northbound lanes. The layout only knew rows of square bays
with an aisle, which needs at least 9.5 m, so the strip had no stalls and no cars.

It also kept none for two other reasons:

- **A wedge at the lot's south end** made its rectangle frame 34.8 m deep, so the layout took it
  for a lot with two rows of bays.
- **The lot is mapped over the median and 3 m into the northbound ribbon.** That ribbon includes
  its left parking lane. Stalls kept out of the lane had about 3 m left, too shallow for any stall.

A thin lot (under 8.8 m on average: twice its area over its perimeter) with a lane along a long
edge now gets 45° stalls along that edge, each edge in its own frame (`angledStripStallsOnRing`,
module 14):

- The stall's head is at the strip's far side: the median's kerb, or the lot's far edge.
- The stall reaches a stall's depth out toward the lane. It may stand up to 2.5 m past the lot's
  mapped edge, on the lane's parking lane, but never on the survey's island or a footway.
- Stalls lean the way that lane's traffic runs, so a car turns in nose first.
- They are painted, and the city's cars park in them (`cityParkingStalls`).
- A thin lot with no lane along it keeps its rows of square bays, as before.

## The island's south end

With the inferred median no longer raised, nothing covered the gap between the slip lane, the
southbound lanes and Chestnut round the island's nose, and the ground showed through as a pale
patch. Road surface is now laid under every short surveyed island (under 45 m across), out to
2.5 m round it, wherever that is within 3 m of a carriageway. It sits just below the junction
boxes, so it shows only where nothing else is drawn (`addSurveyedIslandSkirts`, module 16).

The slip-lane crossing is mapped to end 3 m short of the island, and its tactile pad and landing
stood on their own in the road. A crossing whose line runs on to a surveyed island within 6 m
now lands on that island: its pad steps on to it, or is not laid. The crossing ends 4–5 m short of the island, and the reach is 6 m (`padOnSurveyedIsland`, module 09).

Note for anyone calling `insideCarriageway(x, z, slack)`: a positive slack shrinks the test inward
from the ribbon's edge. To ask "within 3 m of a carriageway", pass `-3`.

## Plain rooms behind the windows

A house's rooms are built only for the nearest few (module 24). Its shell (walls cut round the
real openings, glass in them) stands for the nearest eight. A shell with no rooms behind it showed
the far walls and the ground.

Every shell now has a plain room on each storey (module 25, `plainRoomsFor`):

- a wooden floor (the houses' own plank floors);
- a white ceiling;
- the outside walls' lining in one colour for the house, picked from four: light blue, light green,
  rose or white (`PLAIN_ROOM_PAINTS`).

The lining is the walls' own inner face with every door and window cut out of it, so a window on
the outside is a window from inside, on every side. The plain floors stand down as soon as the
house's real rooms are built.

## Where the same causes reach elsewhere (not changed this pass)

- **Every SFMTA inventory record that names an asset rather than a legend** is drawn as a plate
  with the record's words: "MUNI SOLAR LANDOR SIGN" now reads as a flag, but there are others.
  Symbol-only warnings still print shorthand: "PEDESTRIAN (SYM) XING/(45 LA-DN)" (27),
  "SCHOOL (SYM)/ 45 LEFT DN ARROW (COMBO)", "(45 LA) REVERSE CURVE (SYM)", "LANE REDUCTION (SYM)".
- **Islands the aerial pass left unconfirmed** (157 in the corridor) are still not drawn. Any of
  them may be a real island like the one here; only 4137 is confirmed.
- **The inferred twin median** is still raised wherever the survey has nothing in the gap. Where a
  street's median is narrower than its gap (parking, a turn pocket beside it), it is still too wide.
- **One-way halves with no survey island beside them** still lay pavement on their median side.
  Divided streets elsewhere with a parking strip or a planted gap will show the same paved divide.
- **Car parks mapped over roadway**, like this one, now get angled stalls only when they are a
  narrow strip with a lane along one side. Lots mapped over parking lanes in other shapes still
  get none. The rows-of-bays layout also still judges a lot by its rectangle frame: any lot with a
  wedge or spur that widens its frame is still laid out as a bigger lot than it is.
- **OSM carriageway ribbons that include a parking lane** overlap whatever is mapped beside them
  (lots, plazas, kerb islands). Any rule that keeps a thing "out of the carriageway" loses those
  metres wherever the ribbon is wider than the moving lanes.
- **Crossings mapped to end short of an island** are only snapped on to surveyed islands. Where the
  island is only in OSM, or unconfirmed, the pad can still stand in the road.
- **Crossing landings** are still sized to the crossing and laid wherever they are off the
  carriageway. Off a surveyed island, at a channelised turn, they can still stand in the gap
  between two carriageways.
- **Office buildings** have no built rooms. Their curtain walls show the floor behind the glass by
  interior mapping (docs/72), and plain rooms do not apply. Shops beyond 26 m show glass only until
  their preview room is built.
