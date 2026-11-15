# Street paint: a second source and one plan

**Problem (2026-11-14).** Paint on the road was laid by four passes that knew nothing of each
other, from OpenStreetMap alone where it mattered most:

- stop lines and STOP were painted only where a crosswalk was mapped across the approach, and the
  same approach noted from two nodes of one junction was painted twice, a pace apart;
- a bus stop the city lists as a curb zone *and* an agency lists as painted got a red zone and a
  white BUS STOP box side by side; boxes ran on over crosswalks and under median islands;
- words and zones were cut by the edge of the detail window, and on hills the red zone rose
  through the letters laid on it.

**The second source.** SFMTA's stop signs (DataSF `4542-gpa3`, public domain): one row per
approach a sign governs, with the street and the way its traffic travels. `smc.paint.clean`
drops rows with no position, no facing, outside the city, or listed twice, and counts each
reason; `tools/build_street_paint.py` writes `docs/street-paint.json` (10,713 approaches from
11,179 rows; raw rows saved in `data/sf_public_works/stop_signs.json`). Refresh with
`--refresh`.

**The plan.** `docs/street-paint.mjs` (no three.js; tested in `tests/street_paint.test.mjs`):

- `matchApproach` finds the drawn approach a record means: by street name first (the city's
  facings are compass points on a grid that is not square to the compass), then by bearing, and
  never by a guess between two.
- `PaintPlan`: every pass *claims* the rectangle its paint would take (`kind`, `rank`, optional
  `slides`, `within`, `fixed`); `settle()` lays one paint per piece of road and reports what it
  refused and why (`duplicate`, `overlap`, `orphan`).

In the page (`renderStreetFurniture`): lane arrows are claimed as paint already down, then the
city's red zones, the stops' boxes and words (`claimStopZones`), the stop lines and STOP
(`paintRoadLegends`), and `layStreetPaint` lays what was settled, each piece carrying where it
stands (`clipAt`) so a window edge takes or leaves it whole. `window.kerbsideStreetPaint()`
returns the settlement for a page.

**Marina window, before → after:** stop lines 74 (with doubles) → 110, each once (38 doubles
refused); STOP 64 → 92 (39 doubles refused); 83 of 83 city records matched, 25 painted where no
crosswalk is mapped; bus stops: 10 white boxes beside 16 red zones → 5 stops' words inside the
city's zone, 5 boxes where the city marks none, 6 with no clear asphalt left unpainted.

**Not done.** Transit-only lanes (`tzh6-6j82`) and painted safety zones (`vtn2-q8ky`) are in the
same catalogue and would join the plan the same way. Lane lines and crosswalks are still laid by
their own passes (they do claim nothing yet). Cities other than San Francisco have no second
source.
