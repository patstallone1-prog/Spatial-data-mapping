# Mac courts, business interiors, grass and directions

Base: `main` at `16e3dd40`. This pass extends that state, not an earlier viewer or interior
engine. The installed Mac app is the desktop web-app consumer. Quest's `meta.html`,
`meta-xr.mjs`, manifest, budgets and controls are not rebuilt or edited. Unreal is unchanged.

## Courts and grass

The Moscone reproduction showed large green triangles on the basketball and tennis playing
surfaces. The sports surfaces were depth-tested against a differently tessellated terrain
backdrop. Hard-surface exclusion alone could not fix that depth relationship. On Mac, the
pad now replaces the backdrop, then the coloured surface replaces the pad, then paint is
drawn over the playing surface. Physical elevations are unchanged. The grass exclusion also
includes the actual oriented playing rectangle and its bleed, not just the source polygon.

Court fences keep their current routes, not a new guessed court layout. Shared joints and
divider ends receive terminal posts. Continuous top rails follow the same 0.75 m ground
samples as the mesh, rather than separate floating segments. Daylight visual inspection of
Moscone's eastern block showed the green intrusions removed and its shared apron continuous.

The distant-city lawn tiles now have world-space UVs at the full-detail turf's eight-metre
scale and use that same blade/grain texture. They no longer switch to a plain green material.
Normal texture filtering remains; grass blades smaller than a pixel are not multiplied into
unbounded geometry. The headset's lawn rendering is unchanged.

## Business interiors

Pizza Avellino is a mapped retail building, but a fitted domestic plan was still available to
the general interior path. Shops and commercial buildings now reject that fallback. This is
a semantic rule, not a special case for the address.

`scripts/publish_restaurant_interiors.py` indexes **42 existing accepted restaurant
hypotheses**, preserving the latest engine's room, equipment, finish and furniture data.
An index entry needs a passing inferred layout, one listed tenant with the same name, and
the same canonical building footprint. A renderer-side check rejects a changed footprint or
tenant. Multi-tenant buildings without tenant boundaries stay unresolved rather than being
filled with a house. Residential upper floors are not asserted to be a restaurant tenancy.

The Mac viewer loads the restaurant index alongside accepted house interiors and uses the
existing metre-based renderer/adapter. Pizza Avellino was entered through the real entry
function and displayed dining furniture. The adjacent shop-bearing footprints are excluded
from domestic fallback. `interiorStatus(id)` exposes the current generated source, room
kinds, pending/failure state, confidence and floor datum on attached windows for audits.

**These are inferred layouts, not scans or evidence of the actual tenants' private rooms.**
The single-food-tenant ground-floor extent is an explicit hypothesis. Appearance, layout
validation and measured-world accuracy remain different concepts.

## Continuing interior production and moving it to cloud workers

The former overnight run ended normally on October 22: **908 accepted / 1,088 attempted**.
It had no unfinished batches; it was not an active interior worker when this pass began.
The facade workers are separate and were not replaced or reset.

The continuation uses the existing `smc.cloud.Queue`, lease/fencing contract, `Worker`,
content-addressed checkpoint machinery and `JobSpec`, with a small local queue transport.
Commands and save paths are repository-relative. The same CPU job contracts can run through
the existing HTTP cloud workers; no paid infrastructure is started by this pass.

- Runner: `scripts/run_interior_jobs.py`; installed LaunchAgent
  `com.kerbside.interior-engine`.
- Compute, SQLite job history and logs: `build/interior-production/` in the Mac-polish
  checkout. Batch outputs are keyed by engine revision and input digest, not just row number.
- Completed checkpoints: `/Volumes/HP P700 1/Kerbside/interior-checkpoints`.
- Verified volume UUID: `65DF9122-13CE-4515-8C1A-73F608AB4171`.
- Order: Marina first within SF corridor, then the rest of SF corridor, Berkeley, Oakland,
  Palo Alto, San Jose, Haight-Castro, Mission and Sunset. New eligible houses are polled.
- Eligibility remains explicitly single-family OSM houses/detached houses, no shops. The
  continuation permits footprints up to 500 m² instead of the former pilot's 240 m² cap;
  each still passes the same engine validation. Apartments are not silently made houses.
- Initial continuation plan: 62 batches (SF 3, Berkeley 14, Oakland 9, Palo Alto 4,
  San Jose 21, Haight-Castro 1, Mission 1, Sunset 9).
- AC power or battery above 30% permits new jobs. A missing/wrong external volume prevents
  leasing and checkpoint writes; working batches remain local. A checkpoint failure retries
  through the normal queue instead of reporting success without a saved result.
- **No HP700 deletion or pruning is implemented or authorized.** Source photos and existing
  disk contents are not cleaned up by this runner.

A batch's successful execution is not an all-houses-pass claim: rejected houses stay in its
manifest and denominator. Only individually accepted outputs can be published. Background
jobs do not commit, push or deploy. The release includes the first SF continuation outputs:
**915 furnished houses**, seven more than before, plus refreshed accepted SF hypotheses.
The runner continues into other regions independently of deployment.

To move it: export `--plan-only --export-plan path.json`, submit the serialized JobSpecs to
the existing controller queue, transfer its SQLite state with a consistent SQLite backup,
and copy the checkpoint CAS to the private object store. Workers need this repository
revision and its committed canonical datasets/interior assets. No hard-coded HP700 path is
present in the exported commands. Automatic cloud provisioning and continuous production
promotion remain operator-controlled.

## Navigation

Alternatives are labelled Route A/B/etc., with a checkmark, “Selected”, a blue selection
border and keyboard selection. Get Directions folds the map sidebar and fits an overhead,
north-up view to the chosen line and all stops. It uses both viewport axes and padding;
the camera moves, not the walker. Reopening the controls and choosing another alternative
does not silently fetch and reset to A on the next Get Directions.

Search, user and From/To pins use 62% of their previous size while retaining distance
scaling. Pins are supported in any mapped region, not just the original host's rectangle.
The Mac route-width growth changes from 0.007 to 0.009 metres per metre of orbit distance;
near/first-person ground width stays the same. Quest retains the previous constant.

## Examples in this release

House hypotheses:

- 2455 Lombard Street, San Francisco (`460228342`).
- 2536 Francisco Street, San Francisco (`272838066`).
- 34 Harris Place, San Francisco (`258786939`).

Restaurant hypotheses:

- Pizza Avellino — 2769 Lombard Street (`262397369`).
- Marina Sushi Bar — 2020 Lombard Street (`263347504`).
- Mel's Drive-in — 2165 Lombard Street (`26135462`).

Existing mapped billboards/creatives, retained without changing their geometry:

- SIM: `10434421208`, longitude/latitude `-122.417465,37.790493`.
- Animal Brawl: `10869882888`, `-122.396635,37.792927`.
- Dylumio: `9465252311`, `-122.406581,37.788211`.

## Regression protection

Focused checks cover hard-court precedence, real Moscone rectangles, fence joints/rails,
grass UV/material parity, business-vs-house classification, restaurant acceptance and
envelope checks, overhead framing in three aspect ratios, selected-route preservation,
pin/route scaling, cloud job portability and local lease fencing. The existing renderer
sync tests still compare the complete Mac modules to the current source. The release
manifest now records the renderer revision per consumer so a Mac release cannot require
silently rebuilding Quest. Interior indexes and runtime modules participate in release and
installed-app fingerprints. Graphify was refreshed with AST extraction (no model API cost).
