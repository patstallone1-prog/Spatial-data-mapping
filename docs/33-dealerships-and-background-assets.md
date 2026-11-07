# Dealership render format and staged character/vehicle assets

The dealership planner uses a separate source parcel and canonical building shell. It fits
connected drive aisles, display and visitor spaces, an entrance approach, supplied service
openings, showroom cars and a reception counter. It does not turn a building's bounding box
into a parking lot. All unobserved fitout and vehicle placements remain explicitly inferred.

## Input and geometry

`smc.exteriors.dealerships.infer_dealership(row)` accepts:

- `id`, `name`, `units: "metres"`, and `site_polygon` (GeoJSON Polygon, including holes).
- `building`: the existing `ExteriorInput` JSON contract, with its measured height, real
  footprint vertices, tenants and explicit public frontage. Use category `car_dealership`
  for independents; known marque identity can be supplied with `brand`.
- `driveways`: supplied boundary-to-interior centerlines, `points` in the same metre frame,
  and `width_m`. Their geometry and source records are retained. No curb cuts are invented.
- Optional `requested_display_cars`, source `obstacles`, and observed `parking_stalls`.
  A source stall polygon is retained unchanged. Its center and orientation can be calculated
  from that polygon; a car is drawn only when its envelope fits the actual space.
- Optional garage/service openings on the building's supplied service frontages. Those get
  reserved aprons and vehicle connections rather than storefront windows.

`from_kerbside_dealership(site_way, building_way, driveways=..., streets=..., fit=...)` reads
an actual `shop=car` parcel plus the existing Kerbside shell adapter. Longitude/latitude
parcel and driveway vertices are converted into the **building's** local metre frame.
The building's source vertices, height, origin and reviewed opening records stay bound to it.
A building/canopy alone is rejected as a parcel. Retain invalid or conflicting observations
in the rejection ledger rather than moving them to make a prettier plan.

The parking search compares a bounded set of offsets anchored to both usable clearance and
parcel boundaries. It ranks actual fitted capacity, then circulation area. This avoids a
fixed grid phase skipping usable frontage on compact or irregular lots. Aisles retain a
6.5 m design clearance; inferred spaces retain 2.8 × 5.5 m, and the entrance approach is
1.8 m wide. These are rendering priors, not a surveyed design or a code-compliance finding.
The planner reduces capacity rather than narrowing circulation or placing cars in holes,
planters, the shell, service aprons or the entrance approach.

## Local 3D review

```sh
PYTHONPATH=src python scripts/build_store_exteriors.py \
  --dealerships tests/fixtures/dealerships.json \
  --inputs tests/fixtures/chains-20261105.json \
  --extra-inputs tests/fixtures/storefront-chains-expanded.json \
  --out build/dealership-review
python -m http.server 8797 --bind 127.0.0.1 --directory build/dealership-review
```

Open `/dealerships.html`. The bundle includes `dealership-scenes.json`, the dedicated
Three.js consumer, street/inside/service camera views, roof and display toggles, evening
lighting, source references and rejected identities. Coordinates follow Kerbside's x/y →
x/−z convention. The renderer cuts only replaced wall bands; original shell and courtyard
geometry remain intact. Doors, glazing, handles, garage panels and brand artwork reuse the
existing exterior renderer. Current display cars are unbranded procedural proxies.

The ten fixed cases cover a rectangle, trapezoid, L-shaped parcel, courtyard, rotated lot,
compact lot, deep lot, notched building, irregular boundary and tiny used-car site. A
separate twenty-four-case cohort covers every added chain profile. They are synthetic stress
cases, not claims to have surveyed ten real dealerships. Changing browser size preserves the
selected entrance/showroom view. Narrow screens stack controls above the scene.

This build command writes a review bundle only. It does not publish the map, rebuild all
regional viewers, deploy, or enable NPC/traffic simulation.

## Chain identities

The November 5 expansion adds Toyota, Honda, Ford, Nissan, Mazda, Kia, BMW, Lexus,
Mercedes-Benz, The UPS Store, The Home Depot, Petco, Sephora, Domino's, Wingstop, Daiso, Walmart, Dunkin’, Panera, Popeyes, Jersey Mike’s, Lowe’s,
Ace Hardware and Ulta. There are now 61 chain profiles.
`references.json` contains publisher/design-partner URLs and qualitative observations.
Colors are explicitly rendering approximations where an official specification is absent.
Program generation and local remodel status remain unknown until location evidence exists.

Eighteen additional supplied brand assets are archived with source URL, date and SHA256:
Toyota, Honda, Ford, Nissan, Mazda, Kia, Lexus, Mercedes-Benz, Petco, Sephora, Daiso, Walmart, Dunkin’, Popeyes, Jersey Mike’s, Lowe’s, Ace Hardware and Ulta.
Texture UV bounds exclude master-image margins and Honda’s separate campaign lockup;
source image bytes remain unchanged.
Icon/wordmark layout preserves the source icon aspect, and a missing icon falls back to one
legible text identity. Default identity placement remains centered over the entrance span.
The marque and the local dealership's name are separate, so a local dealer name does not
silently replace Toyota/Ford/etc. Branding remains identification, not evidence of a survey
or an affiliation with the asset owner.

## Background asset archive

`tools/assets/acquire_background_assets.py --root /mounted-volume/library` archives eight
publisher-hosted Kenney packs: Car Kit, Toy Car Kit, Racing Kit, Blocky Characters, Mini
Characters, and Animated Characters Protagonists/Survivors/Retro. It verifies the publisher's
CC0 declaration and bundled CC0 license, archive CRC/hash, safe extraction paths and external
storage reserves. A receipt keeps the original archive URL, checksum, source page, licenses
and model-file index. Re-running verifies existing archive bytes before reusing them.

The current archive contains 1,101 **model files across formats**, not 1,101 distinct vehicles
or people. These are stylized packs, separate from native high-detail MetaHumans. No runtime,
NPC behavior, traffic, Unreal import or browser import uses these staged files in this pass.

## Native MetaHuman queue

`tools/unreal/batch_metahumans.py` launches one preset per editor process, then cold-reloads
its Blueprint in a second process. It reuses the acquisition script's normal Epic sign-in,
external content/staging/cache paths and compilation limits. A missing volume or low reserve
stops work. The strict ten-MetaHuman roster is installed only after every requested preset
verifies. No mannequin is counted as a MetaHuman and no native asset is converted to a web
avatar by this workflow.

See `tools/unreal/metahuman-presets.md` for acquisition details. A timed-out cloud request
retains its editor object while callbacks may be pending. The property
`has_high_resolution_textures` alone is insufficient: Unreal sets it before native face/body
request callbacks finish. The pipeline also waits on `can_build_meta_human`, which checks
both request queues and rig state. Failed pending work remains inspectable rather than
releasing the character and racing Unreal's completion callbacks.
