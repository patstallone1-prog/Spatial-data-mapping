# Restaurant interior inference and tours

The local viewer is at [Restaurant Lab](http://127.0.0.1:8794/inferred-restaurants/).
The [House Lab](http://127.0.0.1:8794/inferred-interiors/) shares its renderer and walking
geometry. Run both with:

```sh
.venv/bin/python scripts/serve_interior_lab.py --port 8794
```

Select **Walk inside**, use WASD to walk, drag to look, arrows to turn, and E to toggle
nearby internal doors. Room selection gives an explicit jump to a clear standing position;
floor selection is also available for houses. **Expand view** fills the browser; Escape
restores it. Stair walking uses the serialized treads, and walls, furnishings and centre
stair guards block movement. Glass stays impassable. A balcony without an evidenced door
is a visible exterior feature, rather than an invented walkable exit. The viewer loads its
Three.js modules from esm.sh; model files are local.

## Input and economics

`smc.interiors.restaurants.RestaurantInput` takes a connected tenant polygon in local
metres, height, optional entrance, service mode (`auto`, `pickup`, `counter`, `table`, `bar`),
optional bar, and average spend per person in USD. USD is the production input currency;
other currencies are rejected until the caller supplies a converted USD amount. Missing
spend remains missing in evidence and uses a neutral furnishing allowance. The test prices
are illustrative estimates, as authorized for this pilot; they are not observed menu prices.

Below $22, the furnishing policy uses metal and laminate; $22–54 uses timber and upholstered
seating; $55 and above uses solid timber, leather and stone. These configurable prototype
thresholds describe furnishing choices, not a financial valuation. Palette identity and wall
colours stay stable for a venue when spend changes. Richer finish budgets permit booths if
space allows. Commercial kitchen fixtures remain stainless and the kitchen floor is tile.

The browser's **Apply spend** control runs the actual Python solver through the local
`POST /api/infer-restaurant` endpoint, validates the result, and writes a separate
`inferred-restaurants/overrides/<id>.json`. It does not edit historical test rounds. It accepts
only already-selected pilot ids and uses their stored geometry. The server binds to
127.0.0.1 and serializes interactive inference. Resetting/reloading the venue opens its batch
record again; overrides are separate review artifacts.

For batch prices, supply a JSON mapping of venue id to USD spend:

```sh
.venv/bin/python scripts/build_inferred_restaurants.py --prices /absolute/path/prices.json
```

This starts the next test round. To infer a separate caller-owned tenant directly, call
`infer_restaurant(RestaurantInput.from_json(row))`. The current bound is one ground floor,
28–1000 m², 2.5–6 m high; feasibility is still required. No automatic tenant-boundary
measurement, additional restaurant storeys, exhaust-route engineering or code certification
is claimed.

## Layout and objects

The search rotates a footprint-derived frame and tries multiple back-of-house proportions
and WC sides. Pickup layouts also try 55% and 60% kitchen bands. Equipment packing tries
three deterministic station orders and compact equipment variants before rejecting a small
kitchen. It rejects disconnected, invalid or impractical cut polygons. Direct mask
intersections avoid floating residual edges after rotated cuts; the input outline is never
silently repaired. One exterior entrance must lead into customer space.

Required inventory comes before capacity:

- A professional range, overhead hood, preparation table, commercial refrigerator, three-bowl
  warewashing sink, separate handwash sink, dishwasher and dry storage.
- A restroom with WC and basin, and customer service counter with a payment terminal.
- Pickup circulation in small envelopes; atomic table/chair or booth assemblies in seated
  venues. Optional bars reserve staff space behind the counter. If an optional bar prevents
  the required program, it is omitted with a reason. Explicit `service_mode=bar` is strict.

Each candidate seat has an interaction approach. Chair envelopes include seated pull-back
space, and every existing approach must remain in one connected free-space component before
another assembly is accepted. A separate space audit counts disconnected clear-floor pockets
of at least 0.5 m² after equipment, seated envelopes and walking clearances. Candidate scoring
penalizes these unusable pockets while retaining required service routes and seated capacity.
Capacity comes from the actual chairs and booths, not a floor area multiplier.

Dining groups seat two, four or six people by joining one, two or three rectangular two-top
modules. The first placement pass reserves different party sizes before filling spare
capacity. Each restaurant has one stable dining-chair design and one booth family; venue
seeds and spend tiers vary those designs between restaurants. Booth lengths vary with their
capacity. Every booth back must follow a solid wall throughout its length; doors, open
transitions and glazed entrance frontage do not qualify. Restaurant wall caps and sanitary
tile use the room wall hue, including the sections behind equipment. Table props are centred, reference their support and contact its exact top.

The prototype uses 0.95 m continuous customer route and 0.90 m staff route checks. These are
geometric heuristics, not certification. The U.S. Access Board's [accessible routes guide](https://www.access-board.gov/ada/guides/chapter-4-accessible-routes/) describes further
requirements, including passing/turning provisions; its [ADA Standards](https://www.access-board.gov/guidelines-and-standards/buildings-and-sites/about-the-ada-standards/ada-standards/)
cover dining surfaces and other requirements this generator does not comprehensively verify.
Equipment utility connections, actual fire egress and full accessibility need independent
project evidence and review.

Kitchen, sanitary, counter and booth fixtures are parametric geometry with appropriate
materials; detailed table, seating and tabletop models reuse the existing library. Eight
additional Poly Haven CC0 hospitality assets were ingested with upstream checksum checks and
local dimensions: three metal stools, two wooden stools, a folding stool, carved plate and
coffee cart. The library now contains 86 local assets. Source, licence and file hashes are
in `interior-assets/manifest.json`; the [Poly Haven model library](https://polyhaven.com/models?c=food)
is the upstream source. A loaded model is sized to its physical placement box.

## Cohorts and evidence

`build_inferred_restaurants.py` selects before inference from Kerbside's published SF data:
one listed food tenant, a valid building polygon of 28–350 m², and geometry strata for small
pickup, narrow, irregular, large and regular envelopes. Candidates are ordered by SHA256(id).
There are no venue-specific geometry branches.

A single listed tenant does **not** establish that it occupies the entire ground floor.
The generated scenes explicitly retain this assumption, the source input, inferred status,
confidence, unknown freshness and zero corroboration. These are plausible test layouts,
not reproductions of the actual restaurants. Small polygons can be ancillary structures
associated with a venue rather than its complete tenant envelope.

`history.json` commits the five selected inputs before the solver starts and checkpoints
results. Every next round retains **all** prior failures and excludes **all** prior successes,
filling the remaining slots with new venues. An interrupted round resumes its pending
inputs. No success is recycled to manufacture an improving score. Historical results remain
historical; their scene files are never solved again by later rounds. Static material-layer
refreshes do not change the selected inputs or their geometry.

Seven rounds tested 25 unique venues. The final round passed 4/5:

| Venue | Outcome | Seated capacity |
| --- | --- | ---: |
| Scoma's Restaurant, mapped envelope 30.2 m² | Rejected: no reachable service counter with required kitchen/WC/routes | — |
| Nob Hill Cafe | Passed | 20 |
| Cafe Tiramisu | Passed | 12 |
| Hotpot Champ | Passed | 39 |
| Mayes Oyster House | Passed, including bar staff aisle | 54 dining seats, plus bar stools |

The Scoma's case remains in the next cohort. Its rejection is not evidence about the real
restaurant's adequacy: the input tenant envelope is unverified. No per-address exception,
missing station or reduced clearance was introduced to pass it. Twenty-four distinct
venues passed at least one round under the engine revision tested in that round. The final
round is independently revalidated against the current serialized contract.

Validation tests deliberately remove kitchen equipment, obstruct interaction targets, inflate
seat counts and float supported props. Additional fresh rectangular/rotated and compact
pickup cases exercise a bar and small-footprint handling independently of the mapped cohort.


## Google price ingestion and Kerbside dimensions (2026-10-22)

`ingest_restaurant_prices.py` uses Google Places API (New), not scraping Maps pages.
The existing `.env.local` / `GOOGLE_MAPS_API_KEY` configuration is reused. Normal runs
make **zero network calls**; opt in with an explicit request budget. Cached fresh prices
and existing Google enrichment are reused before requesting anything.

```sh
# Existing Google response/export; works without a key or network.
.venv/bin/python scripts/ingest_restaurant_prices.py --import-google /absolute/places.json
# Bounded live acquisition (20 mapped venues considered, at most 5 API calls).
.venv/bin/python scripts/ingest_restaurant_prices.py --limit 20 --max-requests 5
# The next rotating cohort automatically consumes data/restaurant-prices.json.
.venv/bin/python scripts/build_inferred_restaurants.py
# Both scripts also accept --region for another published Kerbside region.
```

`--input` restricts ingestion to a JSON array of mapped restaurant inputs. Imports accept
an array or `{ "places": [...] }`, with Google `displayName`, `location`, `id`, `priceLevel`
and/or `priceRange`; normalized enrichment field names also work. Preserve `fetched_at`
when importing an older response. Data without a timestamp is treated as imported now.
Records require a unique agreeing business name within 30 m of the building centroid;
ambiguous branches and unrelated neighbours remain unmatched. Price evidence expires after
30 days. The refreshable cache is gitignored. Explicit caller USD spend always wins.

Actual Google USD ranges take precedence. Otherwise the configurable default furnishing
bands are `$`: $1–20, `$$`: $20–40, `$$$`: $40–80, `$$$$`: $80+.
These are local **inferred furnishing bands**, not Google's universal dollar definitions or
observed menu prices. Midpoints drive furniture selection; open ranges use 1.25 times the
lower bound. `--usd-bands bands.json` can replace all four bands. Unknown/free/non-USD
prices without a usable level remain unspecified. The pilot's explicitly labelled illustrative
prices remain in use where no Google match exists; production can leave spend unset.

Google categorizes `priceLevel` and `priceRange` as Enterprise fields. The published global
Places Details/Text Search Enterprise allowance is 1,000 free events per SKU per month;
usage beyond that is billable and allowance is shared across the billing account. A local
request budget cannot establish the account's remaining free allowance. Ordinary existing
Nearby enrichment requests retain their original field mask and billing tier.
Sources: [Google fields](https://developers.google.com/maps/documentation/places/web-service/data-fields),
[Google pricing](https://developers.google.com/maps/billing-and-pricing/pricing),
[Google price range](https://developers.google.com/maps/documentation/places/web-service/reference/rest/v1/places#PriceRange).

`smc.interiors.kerbside.mapped_geometry` transforms the actual published polygon into local
metres. It never stretches a library rectangle to stand in for the shell. Gross square metres
and square feet are calculated from that polygon; template fit indices 9/10 supply Kerbside's
canonical storey count and floor height, and index 13 supplies the mapped/fitted entrance.
Absent floor data, equal storeys inferred from shell height are labelled as such. A source
polygon hash, region, building ID and height provenance accompany each restaurant input.
The full ground-floor tenancy assumption remains explicit: building area is not measured
restaurant lease area. House generation continues using the canonical Kerbside facade,
floor/window/balcony exporter; generated houses now record footprint/floor areas and heights.

Professional kitchens retain all required wall stations. A centre island uses a 1.6–2.4 m
long, 0.8 m deep stainless prep table, lower shelf and a centred flat cutting board resting
on its surface. Only kitchens at least 22 m² are considered. A 0.95 m equipment-free aisle
surrounds the island, and both long-side work points must remain connected to the kitchen
entrance and every existing workstation through the 0.9 m staff route. Independent validation
checks island clearance and collisions. Narrow pickup kitchens keep their circulation space.
