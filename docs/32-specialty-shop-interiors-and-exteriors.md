# Jewelry, barber/salon and self-service laundry programs

`smc.interiors.specialty.infer_specialty_shop` builds a paired interior and exterior
from an actual tenant polygon, source height and frontage ledger. Its four programs are
`jewelry`, `barber`, `salon` and `laundry`; the two hair-service programs share coordinated
station geometry but use different chair finishes and storefront details.

## Input and output

Input extends the existing `ExteriorInput` JSON contract with a matching top-level
`kind`. Required fields are `id`, `footprint` (GeoJSON Polygon in local metres),
`height_m`, and one `tenants` entry. Supply `ground_height_m` for a ground-floor tenant
in a taller building and `frontages` with actual exterior edge indices. A polygon with
multiple independent tenants needs a supplied boundary for the selected tenant.

```python
from shapely.geometry import box, mapping
from smc.interiors.specialty import infer_specialty_shop

plan = infer_specialty_shop({
    "id": "example-jeweler", "kind": "jewelry",
    "footprint": mapping(box(0, 0, 9, 13)),
    "height_m": 3.8, "ground_height_m": 3.8,
    "tenants": [{"id": "A", "name": "Example Jeweler", "category": "jewelry"}],
    "frontages": [{"edge": 3, "tenant_id": "A", "role": "public"}],
})
assert plan["validation"]["passed"]
```

Observed apertures use `frontages[].openings` (`kind`, `u`, `v`, `w`, `h`, plus source
ID/date, measured status and optional `leaf_count`/`operation`). `openings_complete`
prevents invention of additional doors or windows. The original source records are
retained. Measured openings are never moved to make a furnishing scheme fit.

The result uses `kerbside.inferred_specialty_shop/1`. It contains the original exterior,
one shared `envelope` for entrances/windows, `storeys`, room polygons/materials, internal
walls, openings with selected hinge/swing geometry, fixture assemblies and their physical
collision polygons, interaction targets, source geometry/content digests and validation.
The full shell height is retained. This program occupies the ground-floor tenant; it
does not invent upstairs tenants from a building's floor count.

## Rooms and fixture detail

The engine cuts the inset of the source polygon into a connected public area, staff
room and furnished toilet, trying four layout orientations. This preserves concave and
rotated geometry without replacing it with a rectangle. There are no hall stubs. Jewelry
staff space contains a safe and, where space allows, a jeweler's bench; hair and laundry
staff rooms have utility sinks and storage. Fixtures reduce in number or size where
needed; a program that cannot fit its required equipment rejects explicitly.

| Program | Interior | Exterior |
| --- | --- | --- |
| Jewelry | Glass island and wall showcases, brass frames, lit shelves, velvet trays, ring/gem forms, necklace busts, watches, consultation seats/table, checkout and safe | Raised display-window sills, controlled display glazing, framed secure glazed entry, lock/closer details and entrance-centered identity |
| Barber / salon | Coordinated hydraulic chairs, footrests/arms, counters, storage pulls, framed illuminated mirrors, product bottles, tools, shampoo bowls/recliners/taps/hoses, waiting and reception | Framed display windows, lower privacy panes where inferred, a timber/glass barber door, salon glazed entry, barber pole only on an unobstructed solid pier |
| Laundry | Front-loading washers, stacked dryers, glass drums, controls/displays/handles/vents, folding tables with supported towel stacks, wheeled wire carts, payment/soap kiosks and waiting | Low-sill glazing for visibility, paired cart-friendly glazed doors where the frontage fits, awning or fascia identity |

Room finishes cover the complete wall behind equipment and stop at shared apertures.
Colors coordinate ivory/sage/walnut/brass for jewelry, walnut/burgundy for barbers, oak/sage
for salons and teal/stainless finishes for laundry. Floor maps, skirting, door frames,
wood panels, handles and ceiling luminaires are procedural. These are representative
kits rather than exact manufacturer product meshes. One mirror per active hair-service
scene uses a live planar reflection; remaining mirrors use environment-lit materials.

The existing catalog, style selection, furnishing/clearance solver, polygon/partition
utilities, wall/entry generator, storefront profiles, batching and `TourWorld` are reused.
Specialty fixture geometry supplies details that the existing catalog did not contain.
No unrelated external asset library was copied into the repository.

## Validation and navigation

The planner checks source identity, the current exterior digest, shared aperture ledger,
room coverage, object height/containment/overlap, clear door approaches, physical assembly
bounds and connected fixture interaction points. Customer furnishing reserves a 0.4 m
walk radius; staff rooms reserve 0.32 m. These are visualization clearances, not a claim
of accessibility or construction approval.

Door hinge and swing candidates are tested against fittings and reachable room space.
The renderer and walking collision system consume the selected open-leaf segment.
`specialty/tour.mjs` reuses the existing 0.25 m `TourWorld` walking body, replacing reserved
assembly envelopes with actual chair/counter parts. Closed and open door poses both
block movement at their actual positions. Area teleports use a clear standing position
and face the fittings; walking from the public entrance retains its near-entry start.

## Local review and reproduction

```sh
.venv/bin/python scripts/build_specialty_shops.py \
  --world docs/sf-corridor-3d.json --limit 12 --out build/specialty-shops
.venv/bin/python -m http.server 8800 --bind 127.0.0.1 --directory build/specialty-shops
```

Open [the local specialty preview](http://127.0.0.1:8800/specialty.html). It provides
Exterior, Interior overview, Walk inside, area destinations, ceiling, staff-door and
evening-light controls. It loads pinned Three.js r160 through esm.sh and copies existing
archived artwork locally. The builder refuses to write into published `docs/` snapshots.

The default cohort has 24 fixed synthetic identities: all four programs in standard,
narrow, concave, rotated, corner and measured-opening variants. With `--world`, the
builder additionally selects a fixed SHA-ranked set before validation, retains every
rejection, and uses the existing Kerbside coordinate/height/frontage adapter. Whole-ground-
floor tenancy remains explicitly unverified. Large shells need a tenant boundary;
coarse nail/spa/massage and cleaners classifications need a more specific service program.
No machine-filled laundromat is asserted solely from a business named “Cleaners.”

See the [dated verification report](reports/2026-10-31-specialty-shops.md) and
[reference index](reports/2026-10-31-specialty-reference-index.md). The published map,
canonical world and earlier interior previews are unchanged. Nothing was deployed.
