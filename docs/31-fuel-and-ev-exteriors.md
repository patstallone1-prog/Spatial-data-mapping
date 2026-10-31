# Fuel forecourts, EV parking and attached convenience stores

`smc.exteriors.stations.infer_station` consumes a **lot polygon in local metres**, not a
building bounding box. It returns an explicitly inferred visual program with vehicle bays,
dispensers/chargers, canopies and supports, approach corridors, pedestrian entry approaches,
a price pylon and an optional attached shop. The source polygon and input ledger remain
unchanged. Its schema is `kerbside.inferred_station/1`.

`station-renderer.mjs` uses Kerbside's Three.js coordinate convention (local x/y becomes
scene x/-z). `createStationRenderer(THREE, exteriorRuntime).mount(scene, plan, origin)`
accepts a world placement without resizing its geometry. No existing map source or
published world is overwritten. The new module is an explicit consumer; this pass does
not automatically substitute generated sites into the deployed map.

## Layout contract

```python
from shapely.geometry import box, mapping
from smc.exteriors.stations import infer_station

plan = infer_station({
    "id": "example-fuel-lot",
    "name": "Chevron",
    "kind": "fuel",  # or "ev"
    "brand": "chevron",
    "units": "metres",
    "site_polygon": mapping(box(0, 0, 40, 40)),
    "heading_degrees": 0,
    "requested_bays": 8,
})
assert plan["validation"]["passed"]
```

The heading rotates the layout frame counterclockwise from local east. In the unrotated
frame the road-side entry is at the minimum-y edge, fuel vehicle axes run along x and EV
bays point along +y. Each pump has opposed dispensing faces linked to its adjacent lanes;
hoses and holsters are rendered on those faces. Source island positions can be supplied
as `fuel_islands` with `id`, `center`, `heading_degrees`, source ID/date and measured status.
The derived island, housing dimensions and vehicle spaces remain inferred even when the
pump position came from a measurement.

EV `parking_stalls` accept source IDs, centers, headings, `length_m` and `width_m`. Their
positions are retained, including irregular spacing and rotations. Optional `chargers`
refer to a single `bay_id` and retain supplied center/heading observations. Each inferred
charger faces its own stall and has a representative reachable vehicle port, wheel stop
and bollards. No diagonal vehicle placement is used to make an inferred row fit.
A source conflict is reported rather than repaired by shifting the observation.

The planner checks usable bay dimensions, equipment/parking overlap, lot containment,
canopy clearance/supports, and unobstructed approaches with neighboring bays occupied.
Requested capacity can be reduced with a warning. An impossible supplied layout rejects;
it is not replaced with a different successful test identity. Approach checks are planar
corridor checks, not steering-kinematics or construction certification. Cable reach
checks use a representative compatible port; they do not assert compatibility with every
vehicle model or every historic short-cable Supercharger.

`obstacles` retain supplied polygons. `entrances` can supply actual vehicle entry centers
and widths. Without them, entry positions are marked inferred. No measured curb cut or
street connection is asserted from a lot polygon alone. `canopies` can supply actual
polygons, underside heights, thicknesses and support positions; supplied values override
the generated canopy kit.

## Store pairing and price signs

`store` uses the existing `ExteriorInput` JSON contract with its own actual footprint,
height, tenants and frontage edges. The footprint must fit the lot. The same generated
window/entry ledger is passed to the existing `corner_store` interior engine. Shelves,
stock, drink coolers, checkout and staff partitions use that layout instead of placing
an arbitrary retail box beside a pump. Rendered snack packages rest on shelf plates;
beverages sit on cooler shelves. A store entry retains a clear pedestrian approach.

A supplied `prices` object requires `currency: "USD"`, `unit: "US_gallon"`, `source_id`
and `rows` containing `grade`, numeric `price` and `payment` (`cash`, `credit` or `all`).
Measured/source dates remain in the ledger. A supplied but unmeasured price is still
illustrative. The default board is explicitly **SAMPLE · USD / GAL**, with regular,
plus and premium rows and fractional 9/10-cent formatting. It is not a live fuel quote,
and no loyalty discount or invented cash/credit discount is added.

## Evidence and identities

The shared reference library now contains 61 sources, 21 storefront chain profiles,
eight branded station profiles and 12 archived official artwork assets. New storefront
families are Target, Costco, McDonald's, In-N-Out, Taco Bell, Best Buy, ExtraMile and ampm.
Safeway and the previous 12 storefront families remain available. Station families are
Chevron, Shell, ARCO, 76, Tesla, ChargePoint, Electrify America and EVgo.

The [2026-10-30 reference index](reports/2026-10-30-station-reference-index.md) records the
new sources. In particular, ChargePoint's Express 250 guide supplies product-specific
width/height/reach information; Tesla distinguishes historic short cables from V4 posts.
EVgo's 2026 announcement describes a future 2027 product, so the renderer uses a generic
current cabinet prior and does not claim to reconstruct that future product. A network
name never establishes the installed hardware generation.

Official logo bytes are retained with hashes and source URLs. Remaining lettering and
the parametric arches motif are explicitly approximate components. Whole sites are not
labeled exact replicas. Prototype proposals, historical standards and built examples stay
distinct in the reference database; the numerical layout/finish priors are not a survey
of prevalence or measured current site dimensions.

## Kerbside ingestion and local review

`from_kerbside_site` projects a fuel/charging **site boundary** using its original geographic
points and retains the origin/canonical points. It rejects building and canopy footprints.
The storefront adapter also refuses to wrap a fuel canopy in retail walls. Where the world
only supplies a canopy/building, obtain a separate lot/parking program before creating a
full site; do not expand the roof into an invented parcel.

```sh
.venv/bin/python scripts/build_store_exteriors.py \
  --inputs tests/fixtures/storefront-exteriors.json \
  --extra-inputs tests/fixtures/storefront-chains-expanded.json \
  --stations tests/fixtures/station-exteriors.json \
  --world docs/sf-corridor-3d.json \
  --selected-ids tests/fixtures/storefront-mapped-cohort.json \
  --out build/station-exteriors
```

Serve that build locally. `stations.html` provides overview, forecourt, dispenser detail,
price-sign and convenience-store views, cars/canopy/approach controls and evening light.
`index.html` provides the expanded chain review. The current isolated review is at
[127.0.0.1:8799/stations.html](http://127.0.0.1:8799/stations.html). The builder retains a
rejection ledger and reports station counts separately. It refuses output in public docs.
No deployment, push, original world rebuild or existing preview restart is required.

### Visible fuel-chain identity

Fuel canopy identity now appears on every usable canopy edge, rather than only the
first polygon edge. Chevron, Shell, ARCO and 76 retain their distinct color kits, with
readable identity on both dispenser faces and the price pylon. Archived official artwork
is used where available, alongside tightly framed lettering; Shell uses red lettering
on its yellow fascia. These are inferred identity treatments and do not alter lot shape,
vehicle-space ownership or supplied store identity. Attached-store signs use the same
entrance-centered placement rule as other storefronts.
