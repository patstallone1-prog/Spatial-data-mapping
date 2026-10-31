# Storefront and institutional exterior inference

`smc.exteriors` fits a source-backed exterior program to the actual Kerbside building
polygon and tenant frontage. It generates windows, entrances, frames, material treatments
and business identity while keeping the canonical footprint and height unchanged.

The curated database contains 61 primary/reference sources, 25 category profiles, 21 chain
identity families and twelve archived official brand assets. Sources include municipal
elevations, original architect and sign-fabricator portfolios, merchant documentation and
brand guides. Bay Area examples include San Francisco, Oakland, South San Francisco,
Albany, Los Gatos and Lafayette. Out-of-region comparisons are labeled explicitly.

The database is at `src/smc/exteriors/references.json`; the readable
[source index](reports/2026-10-29-storefront-reference-index.md) links every source and
records the observations used. Original project photographs and plan sheets are referenced,
not redistributed. The logo manifest records source URLs, retrieval dates and SHA-256s.

## Research implications

The repeatable part of a chain is its identity and kit of components. Its entire building
is rarely a universal prototype. Starbucks describes local adaptation; its San Francisco
Reserve photographs show different materials from a standard green coffeehouse identity.
Whole Foods Oakland preserves a historic facade. The South San Francisco Safeway proposal
distinguishes glazed customer fronts from loading and service walls. These distinctions
are represented in the profiles, rather than applying a chain-colored box everywhere.

For example, the Chestnut Street Peet's proposal preserves its historic entry, tile and
glazing alignment, with its documented transparency percentage specific to that project.
It does not supply a measurement for every Peet's. Subway's published Fresh Forward 2.0
exterior is a prototype rendering, not proof that a given Bay Area franchise was remodeled.
Historical proposals, built projects and brand guidelines retain their different evidence
types in the database and review browser.

Glazing ranges, module widths and price-to-finish mappings are explicit engineering priors.
They are not measured prevalence statistics, current legal requirements or a calibrated
claim of visual accuracy. Observed geometry always takes priority. Full site replicas need
site-specific observations; the engine does not label an inferred facade an exact replica.
The official artwork masters retain their original bytes. Subway's white margin is
excluded with texture UVs, and the Siren receives an explicit display viewport without
altering its archived SVG paths. Other fallback lettering is not represented as exact
proprietary typography.

## Programs

Specific category profiles cover café, diner, restaurant, fast food, pizza, bakery, bar,
grocery, corner store, clothing, books, salon, pharmacy, bank, laundry, hardware, florist,
office, senior living, clinic, hotel, civic, school, industrial and generic shop. Unknown
trades receive the conservative generic profile. Detailed OSM care, medical and convenience
tags override older coarse shop classifications.

The chain families are Starbucks, Starbucks Reserve, Subway, Safeway, Whole Foods Market,
Trader Joe's, Peet's, Philz, 7-Eleven, Chipotle, Chase, CVS and Walgreens. Exact normalized
brand/alias matches are used; `Subway Electronics` does not become a sandwich franchise.
Chain identity does not establish a site's remodel date or facade dimensions.

The planner supports fascia panels, plastic lightboxes, channel-letter treatments, painted
names, fabric awning valances, projecting blade signs, door lettering, plaques, quiet
entrance lettering, canopy lettering and neon treatments. Narrow storefronts can put their
name on the door. Institutional identity is smaller and aligned with the entrance rather
than repeated across display windows. No operating hours, sale prices or discounts are
fabricated.

Wide groceries cluster broad glazing bays around customer entries, with solid wall areas
outside those clusters. Multiple entry clusters are unioned before fitting glass. A tall
entry can receive a fixed transom above its moving leaves. Service and party walls receive
no invented public display glazing or identity. Diners use broader booth-height panes;
restaurant and café modules differ. Caller observations or explicit glazing zones can
describe an extensively glazed urban market instead of the clustered prior.

Finish palettes keep wall, base, frame, accent and hardware distinct. An explicit fitout
tier, USD spend per person or price level 1–4 can influence finish treatment. Unknown
economics remain marked unknown with a neutral prior. A neighborhood or brand name does
not establish an observed construction budget.

## Input contract

Coordinates are local metres, with `u` measured from the start of a canonical footprint
edge and `v` measured above the facade base. A frontage belongs to one tenant. Several
tenants can share an edge using non-overlapping `u0`/`u1` spans; one tenant can occupy
several edges. The input does not need to be rectangular or axis-aligned.

```json
{
  "id": "example-cafe",
  "units": "metres",
  "footprint": {"type": "Polygon", "coordinates": [[[0,0],[14,0],[14,12],[0,12],[0,0]]]},
  "height_m": 9.1,
  "ground_height_m": 3.9,
  "tenants": [{"id": "A", "name": "Harbor Cafe", "category": "cafe",
               "average_spend_per_person": 24, "currency": "USD"}],
  "frontages": [{
    "edge": 0, "tenant_id": "A", "u0": 0, "u1": 14, "role": "public",
    "openings": [
      {"id":"existing-window","kind":"window","u":1,"w":2.4,"v":0.7,"h":2.0,
       "measured":true,"source_id":"caller-observation"},
      {"id":"existing-entry","kind":"door","u":6.4,"w":1.1,"v":0,"h":2.3,
       "measured":true,"source_id":"caller-observation"}
    ],
    "openings_complete": false,
    "protected_rectangles": [{"u":9,"w":3,"v":3.4,"h":1.1,"kind":"balcony"}]
  }]
}
```

Set `openings_complete: true` when the supplied opening ledger is complete. No additional
windows or doors will then be invented. `signs` and `signs_complete` do the same for signage.
`wall_colour`, `wall_material` and `bands` preserve observed appearance. A new brand band
cannot repaint a supplied wall appearance or cover protected details. Observed source
records are retained verbatim alongside any necessary coordinate conversion.

An optional `glazing_zones` list limits new glazing to `u`/`w` intervals. Overlapping zones
are merged. `role` is `public`, `secondary`, `service` or `party`. Observed garages and
loading doors occupy their actual spans; windows cannot be fitted over them.

The output includes heuristic confidence, measured/inferred status, freshness, corroboration
count and reference IDs. Missing observation dates stay unknown. Conflicting observations
are retained and reported rather than moved until the validation passes. Withheld source
openings cannot be promoted into a validated facade.

## Kerbside and interior alignment

`from_kerbside` uses the actual building polygon and source height. Road-facing edges are
preferred over a longest-edge fallback. A second street frontage is assigned only to a
single tenant, not by repeating every tenant name around a corner. Tenant subdivisions
without boundary evidence remain explicitly inferred.

Reviewed facade fits must match the exact canonical points and height. Their plane-local
openings are converted to the canonical edge frame, including reversed endpoint order,
without resizing them. Stale, conflicting or unreviewed fits reject. An observed
multi-tenant frontage requires explicit tenant spans instead of arbitrarily dividing a
measured window between neighbors.

A supplied `interior` in the same local frame protects professional kitchens, stockrooms,
toilets and other service rooms from new display glazing. Its known exterior entrances
are retained. A specified frontage on another side cannot silently acquire a replacement
door. Source windows at service rooms stay fixed and produce a reconciliation warning.
The paired interior footprint must match the exterior footprint.

`interior_envelope(plan, original)` exports the same window ledger for the existing
house, restaurant and store furnishing engines, retaining unrelated upper/side windows
and balconies. It also supplies entry centers, widths, thresholds and provenance.
Pairing is explicit; this pass does not rewrite previously generated interiors.

## Rendering and review

The renderer creates real apertures, frame returns, sills, mullions, transoms, door leaves,
pulls, kickplates, automatic-door headers, canopy geometry, material joints and sign
panels. Arch frames and glass follow an arched source opening when supplied. Source
appearance bands remain visible. Static pieces are batched by material within each
building. The source roof and upper shell stay intact when the ground wall band is cut.

The optional map consumer validates shell identity, origin, local coordinates and facade
bounds before suppressing original storefront details. Unavailable or stale bundles keep
the original renderer. An uninstrumented payload does no extra asset loading.

`instrument_viewer` applies the integration to a build copy with unique source-context
checks. The authoritative viewer file remains unchanged, preserving existing interior
source fingerprints. A changed upstream viewer requires a reviewed adapter update.

```sh
.venv/bin/python scripts/build_store_exteriors.py \
  --inputs tests/fixtures/storefront-exteriors.json \
  --world docs/sf-corridor-3d.json \
  --selected-ids tests/fixtures/storefront-mapped-cohort.json \
  --out build/storefront-exteriors
```

Serve that build directory locally to use `index.html`. The review browser supports street
and orbit views, alternate frontages, evening lighting, source opening bounds and linked
references. The current isolated review uses port 8798; the existing 8794 server is not
restarted or modified.

For an isolated copy of the full map integration, add `--viewer-copy --support-site docs`.
This writes the instrumented viewer and a separate opted-in world payload under the build
directory, with read-only aliases for existing support assets. It does not replace the
source world or public viewer. The CLI refuses output in the published `docs` tree.

No public release, push, map-overlay update or deployment is part of this pass.

Fuel/EV lot programs, attached corner stores and the added chain families are documented
in [Fuel and EV exteriors](31-fuel-and-ev-exteriors.md). The expanded local review uses
port 8799. The older report and port 8798 instructions describe the previous review build.

### Default entrance alignment

Inferred signs above a store now center on its customer entrance. Multiple customer
entrances on the same frontage use the midpoint of the complete entrance span. Signs
shrink symmetrically before shifting away from that center; protected architecture and
existing openings still constrain placement. Upper-floor/balcony and service/emergency
doors do not pull a customer sign away from its entrance. Supplied sign placements retain
their original coordinates. Plaques and door lettering retain their appropriate clear
pier/door placement when a sign cannot fit above an entry.
