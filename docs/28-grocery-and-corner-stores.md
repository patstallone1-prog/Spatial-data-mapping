# Grocery and corner-store interiors

The retail engine fits a plausible store to a supplied polygon, entrances and height.
It shares Kerbside's asset catalogue, material system, renderer, walking engine and map
adapter. It does not claim to reconstruct an observed interior from a chain's name.

Open [the local grocery and corner-store tour](http://127.0.0.1:8794/inferred-stores/).
The viewer supports cutaway/plan/walking views, floor and room visits, automatic sliding
entrances, chain-character rebuilding, and passenger/cart lift stops. Choose the lift in
“Visit room,” then its destination; stairs and vehicle ramps are also continuous surfaces.

## Geometry and programs

`smc.interiors.stores.StoreInput` accepts local metre coordinates. `infer_store` retains
polygon concavities and holes, divides selling space from the stockroom and staff toilet,
then checks fixtures and circulation. Every store has a cashier and queue, stock storage,
a toilet and a sink. Corner stores receive snack/pantry shelves and a drinks cooler.
Groceries add produce, bakery, pantry, household/beverages, dairy, meat/deli and frozen
sections, with banks of adjacent cold cases and staffed/self-service checkouts.

Shelves use footprint-derived frames, shorter modules in small premises and cross aisles
in longer runs. Both faces of central shelves need connected approaches. Fixtures cannot
block entrance clearances, queues, staff doors, stairs or window openings. Queues reserve
floor space before shelves are fitted. The independent validator checks object bounds,
overlap, floor support, stock heights, required departments, routes and isolated pockets.
Customer clearance heuristics are 0.96m in corner stores and 1.2m in groceries; these are
layout checks, not accessibility/building-code certification.

Product packages, bottles, produce bins, chilled glass doors, shelf rails, conveyors and
payment terminals use detailed parametric fixtures. Repeated products are instanced for
rendering. Existing Kerbside cars, bathroom fixtures and service equipment are reused.
The chain priors vary finishes, produce allocation and checkout mix. They are deliberately
labelled “inspired”; they are not surveyed Safeway, Whole Foods or Trader Joe's templates.

Mapped examples use Kerbside's actual polygon, canonical storey/window export and all
available fitted entry positions. Floor area is calculated directly from the polygon.
Single listed tenancy is still an assumption about the building's ground floor, not a
measured tenant boundary. Source entry widths are kept when given; a narrow recorded door
is not widened into a double door. Unsourced grocery entries default to a 2.4m automatic
sliding pair; the viewer opens these when approached.

## Parking contract

```json
{
  "id": "example-store",
  "kind": "grocery",
  "units": "metres",
  "footprint": {"type": "Polygon", "coordinates": []},
  "height_m": 3.8,
  "entrances": [{"point": [12, 0], "width_m": 2.4}],
  "chain": "safeway",
  "parking": {
    "kind": "garage",
    "levels": 2,
    "footprint": {"type": "Polygon", "coordinates": []},
    "storey_height_m": 3.2,
    "evidence": []
  }
}
```

Replace the empty coordinate arrays with actual rings. `parking.kind` is `unknown`, `none`,
`external`, `garage` or `mixed`. A garage level count can be null, or an explicit integer
1–4. The current garage program places those decks below the store; above-store parking
needs a different placement strategy. Unknown levels do not create a basement. Rendering requires a garage polygon, shared
stair/lift core, ramp and landings that fit. This version supports straight, two-way, 6m
ramps at a 12.5% design grade and 3m landings. It rejects shells that need a different ramp
strategy. Separate pedestrian stairs and a passenger/cart lift connect every deck to the
store. The street ramp landing has its own room, separated by walls from selling and
stockroom space; it cannot overlap staff equipment. Bays, clear drive aisles and a conceptual column grid avoid those connections.
Columns meet the slab underside; supports remain proposals requiring structural review.

An optional `parking.vehicle_entrance` with a source `segment`, `height_m`, source ID and
evidence fixes the street end and orientation of the ramp. Its width/height and evidence are
retained. The initial two-way strategy accepts source gates 6–12m wide; narrower gates are
rejected rather than widened. Without this evidence the ramp gate is explicitly inferred.
An unseen test covers a supplied gate on the opposite facade from the default proposal.
The upper ramp needs an exterior street landing within the supplied store/garage envelope.

Surface parking accepts `external_footprint` and `pedestrian_path` polygons. The path must
intersect the lot, the store's inside and an entrance. When that connection is supplied,
the viewer renders parked cars and a walkable path through the opening. A lot without a
pedestrian connection remains unresolved rather than being joined across unknown ground.

## Run, rebuild and publish

```sh
.venv/bin/python scripts/build_inferred_stores.py
.venv/bin/python scripts/build_inferred_stores.py --input /absolute/stores.json --out /absolute/output
.venv/bin/python scripts/serve_interior_lab.py --port 8794
```

Review batches accept 1–20 stores and retain failures. The fixed cohort has nine synthetic
programs and ten mapped shells chosen in SHA order before solving. **17/19 pass**: all nine
synthetic programs, all six mapped groceries and two of four mapped corner stores.
The two rejected corners cannot fit the current entry/checkout/staff program. They remain
visible with reasons. This is a sample result, not a city-wide success rate.

`--publish` merges accepted cases into the shared local map index. This pass adds eight
mapped stores and preserves all 908 previous references. An invalid retail record cannot
be published. Review overrides are separate and ignored by Git. The local rebuild endpoint
changes only the chain prior, keeping stored geometry, entrances, height and parking data.

## Parking research and inventory

```sh
.venv/bin/python scripts/ingest_grocery_inventory.py
# Optional public OSM refresh; no key required:
.venv/bin/python scripts/ingest_grocery_inventory.py --source osm --fetch
```

The default importer reads Kerbside's existing Overture 2026-10-21.0 Bay Area places file;
it never modifies it. It filters candidates using the nine [Census county polygons](https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/1),
retains upstream licences, source dates/confidence and existing building associations, and
writes `data/grocery-stores/inventory.json` plus a research queue. The Census query uses
0.001-degree geometry simplification, so borderline county assignment is approximate.

The resulting **3,185 candidates** include **1,901 broad grocery candidates** and **1,284
convenience stores**. Broad categories contain small markets and occasional mislabels;
these are not 1,901 verified supermarkets. Node/business identity and full tenancy still
need review. The source file's digest is recorded for reproducibility.

**Parking research is partial.** Four source-linked notes are supplied. Of the candidates,
3,184 still need parking type or garage-level research. A garage mentioned in a historical
proposal is not confirmation of today's as-built floor count. In particular:

- [Rainbow's operator page](https://rainbow.coop/contact/) confirms a garage at its 13th
  Street entrance and an additional surface lot; it does not supply a garage level count.
- A [2019 Planning memo](https://sfgov.legistar.com/View.ashx?GUID=2F1FEB4F-4BBD-4C0F-9ACD-D92680DAB4EA&ID=7148983&M=F)
  identifies the Marina Safeway lot. Its date and redevelopment uncertainty remain explicit.
- The [2008 housing inventory](https://archives.sfplanning.org/documents/2225-Housing_Inventory_2008.pdf)
  describes a Whole Foods proposal with two subsurface levels at 2001 Market. The proposed
  count is retained in evidence; the current level count remains null.
- [Trader Joe's Hayes Valley page](https://locations.traderjoes.com/ca/san-francisco/226/)
  gives a parking entrance on Fulton. Parking type and levels remain unknown from that note.

Observations match an explicit site identity/name, not every tenant sharing a building.
The full regional parking survey requested by the user is not complete. Public Overpass
refresh attempts returned 502/504 errors or timed out; the local Overture inventory is the
working fallback. No Google API calls or new paid services were used. Future verified
observations can be imported through `--observations`; nearby parking alone is not ownership.
