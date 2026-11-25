# Storefronts read from photographs, on the live map

Code: `src/smc/exteriors/observed.py` (the bridge), `src/smc/exteriors/renderer.mjs` `drawObserved` (the
drawing), `scripts/publish_store_exteriors.py` (publishing). Tests: `tests/test_observed_storefronts.py`.

## What it carries
In the kerbfront lab (`storefronts-lab/`, docs in `storefronts-lab/`), Claude Opus 5.5 read the Marina's shop walls
from Mapillary frames: 245 walls of 158 buildings (`storefronts-lab/models/auto-opus/*.json`, schema
`kerbfront.building/1`). Until this change the readings were visible only in the lab. Now each reading becomes
that building's storefront plan on the live map. A plan built from a reading has
`replica_status: observed_storefronts_with_reference_backed_components` and cohort `observed`.

| Read in the lab | On the map |
|---|---|
| shop name, category, brand | the tenant (names such as "unknown (neighbour)" become "Storefront") |
| the shop's span of wall | the frontage, re-measured on the app's edge |
| glazing and doors on the storefront, and the wall's own ground-floor openings in its span | observed openings (`source_id: kerbfront-opus`, the reading's confidence and frame count) |
| signs (fascia, channel letters, ...) | observed signs; none are invented, because the walls were read for signs |
| band height, palette, finish, door style | the facade's band, colours, material and door style |
| awnings (dome, box, flat canopy, shed, retractable), boards, blades, gooseneck and string lights, pilasters and friezes in the band | `facade.observed`, drawn by `drawObserved` |

These are not carried: the upper floors' windows, bays, cornices and balconies (the app draws its own
building shells), seating, street objects and rooftop signs.

## Binding a lab wall to the app's shell
The lab models a building on the city's DataSF footprint. The app draws OpenStreetMap's outline. The two
differ by a metre or two, and sometimes split a block differently.
- A read wall goes to the canonical edge (`match_edge`) that meets all of these:
  - it runs within 12° of the read wall;
  - it faces the same way;
  - its middle lies within 3 m of the read wall's middle, and its ends within 4 m of the read wall's ends;
  - at least half of the read wall lies along it.
- Positions are re-measured along that edge. Edges are clipped inward to the millimetre.
- The canonical shell is never moved.
- If the wall lies on a neighbouring OpenStreetMap building, it goes to that building (`assign`), unless
  that building has a reading of its own.
- A shop read on two walls (a corner) becomes one tenant with a secondary frontage.

## When the reading is incomplete
- **No door read.** If no door was read and the glazing leaves no gap for one, the low window nearest the
  usual entry point (two thirds along) is shortened. It keeps `read_w` and `trimmed_for_inferred_entry`. The
  engine then infers a door, which is marked inferred.
- **A sliver of wall.** A shop the engine still cannot give a door is left out, and the rest of the
  building's reading is kept.
- **Validation fails.** If the plan fails validation, the building keeps its inferred plan.

## Results
- For the San Francisco corridor world, 121 buildings have an observed plan with 201 frontages.
- 177 of those frontages have awnings, boards, lights or band details.
- 14 readings were not placed. Their walls lie on no canonical edge.
- The publisher records a digest of the readings that land on each world (`readings_sha256`). A reading
  re-done in the lab republishes only the world it lands on.

## Storefronts on sloping lots were switched off
The page draws a building from its lowest ground corner and adds the ground's rise across the lot to
its height (`groundRiseFor`). It then compared the plan's height with that stretched height. On almost
every lot the two differed, so the page switched the storefront off.
- In the Marina guest realm, 150 of 159 plans were off, inferred and read alike.
- The page now compares the plan's height with the height before the rise (`boundHeight` in
  `src/smc/renderer/page/module/12-what-a-roof-is-made.js`). The rise only stretches the shell down to
  the low corner, and the plan's band stands on that corner.
- Checked in headless Chrome on Chestnut Street:
  - 8 of 257 plans are off now, the buildings with shaped roofs;
  - none of the 93 read plans in view is off;
  - 246 storefronts are mounted around the walker.

## Memory
Read sign art is drawn at 96 px per metre, and no canvas is larger than 640 px (`OBSERVED_PX_PER_M`,
`OBSERVED_MAX_PX`). The lab draws at 260 px/m, which would have cost hundreds of MB for 300 boards. Text,
stripe and motif materials are cached by their look.
