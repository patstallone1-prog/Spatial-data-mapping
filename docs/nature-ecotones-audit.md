# Nature ecotones and ground-material pass

## Scope and invariants

The app's shared nature renderer now uses continuous habitat mixtures, not visible
100 m generation squares. No DEM, surveyed kerb, building footprint, city tree
record, or street-tree placement was edited. The frozen website viewers and
other worktrees are not part of this change. All eight app viewers are generated
from `scripts/build_sf_corridor_3d.py`; their release hashes are checked.

This is **inferred visual vegetation**, not a new survey of individual plants.
NLCD/USFS cover evidence constrains placement; species, heights, materials,
undergrowth and individual plants remain inferred. The existing 40 m overview
and 10 m near-field elevation sources retain their original accuracy limits.

## Changes

- A continuous, globally anchored habitat field controls forest edges,
  stragglers, species groves and understory density. Loading/draw-batch borders
  do not seed placement or colour. Water, mapped paths, courts and buildings
  remain hard exclusions.
- Forest floors are brown soil/needle litter. Scrub, dry grass, wetland mud,
  sand and rock have distinct substrates. Developed **open** space is treated
  as predominantly vegetation rather than universally grey paving. Canopy
  supports litter under wooded parks without changing NLCD classifications.
- Coarse and fine terrain share one floor-colour field. World-space grain,
  centimetre-scale mottling and randomly oriented leaf litter avoid repeated
  texture stamps. Fine grain is filtered with pixel footprint to avoid shimmer.
  Mapped beach/rock polygons refine the ground both near and in overview.
- Nine region-conditioned tree families replace nature's spheres/cones:
  coast live oak, bay, Monterey cypress, Monterey pine, eucalyptus, acacia,
  redwood, Douglas-fir and willow. Branched forms and foliage have bounded
  dimensions and seeded variations. Nearby plants share species more often,
  with immigrants breaking up monocultures.
- Moist forest, dry woodland, scrub, wetland and grassland use different
  undergrowth forms. Moisture is a labelled qualitative habitat prior, **not**
  a measured soil-moisture product. Dry woodland does not get redwood sorrel
  and fern blankets by default.
- Nearby branch geometry transitions into matching-position silhouettes,
  then full-extent canopy proxies. Sub-pixel forest cover remains visible
  through canopy averaging rather than revealing bare brown ground when
  individual crowns can no longer be resolved. Transition dithers are
  complementary; there is no intentionally empty zoom band.
- Fine vegetation is culled in small spatial batches without modifying its
  geometry. Overview attributes are packed; positions remain float32. The
  8 m conservative clearance raster uses one bit per cell, not a byte.
  Work yields during generation so map input is not held for a whole forest.
- City tree geometry is subtracted from building volumes. Tree anchors,
  diameter-derived scale, record order and seeded rotations are unchanged.
  Geometry above a roof is not incorrectly removed merely because the tree's
  plan-view crown overlaps the building.
- New modules and the ecology manifest are included in the installed app's
  runtime fingerprint. Asset checksums and source hashes fail closed.

## Reproduction

Install the existing `nature` optional dependencies and use the project Python:

```sh
PYTHONPATH=src python scripts/build_nature_ecology.py
PYTHONPATH=src python tools/build_app_worlds.py
PYTHONPATH=src pytest tests/test_nature_atlas.py tests/test_nature_ecology.py tests/test_terrain_viewer_frame.py tests/test_tunnel_ground_safety.py tests/test_tunnel_app_release.py tests/test_renderer_template_sync.py tests/test_park_rendering_safety.py
python tools/nature_app_preview.py --region sf-corridor --name nature-ecotone --lon -122.41868 --lat 37.78891 --radius 170 --distance 100
python -m http.server 8910 --bind 127.0.0.1
```

Open `/build/road-paint-preview/nature-ecotone/index.html`. Its buttons exercise
the production renderer and real atlas, not a replacement geometry demo.
`tools/nature_preview.py` provides an additional isolated scene and closer views.
Audit interfaces are generated under ignored `build/`; they are not deployed UI.

## Recorded checks

The focused base-environment run passed **76 checks**, with one optional
geospatial check skipped. The nature environment passed **all 12 ecology tests**,
including the optional floor compiler check. Tests cover continuous transitions,
stragglers, species clustering, tree bounds/non-overlap, unknown/water exclusion,
dry versus moist understory, exact building-prism subtraction, colour/checksum
integrity, complete LOD weights and installed-app fingerprints. The existing
terrain, tunnel, park and consumer-template checks passed.

Actual app fixtures inspected:

| Site | Coordinates | Ground rays | Largest render/query difference |
|---|---|---:|---:|
| Presidio | -122.462, 37.796 | 25/25 | 0.000024 m |
| Baker Beach | -122.484, 37.793 | 25/25 | 0.000043 m |
| East Bay hills | -122.217, 37.868 | 25/25 | 0.000232 m |
| Peninsula forest | -122.299, 37.429 | 25/25 | 0.000150 m |

These are **numerical agreement between rendered terrain and its ground query**,
not absolute geospatial accuracy measurements. Source-height agreement at the
non-water test stations was zero difference. Visual inspections included paths,
coast/soil transitions, grove margins, near detail and overview. Runtime warning
and error logs were empty at the inspected fixtures.

The downtown SF fixture retained 376 mapped tree anchors. A triangle-centroid
audit tested 111,217 rendered tree triangles and found **zero** centroids inside
the corresponding building volumes. Pure clipping tests separately cover
crossing triangles, fully enclosed triangles, roof clearance, interpolated
attributes and coplanar wall faces.

Performance is not a universal 60 FPS claim. An early dense-forest trial submitted
13.0 million triangles and ran at about 18 FPS. After spatial culling and the
middle representation, the isolated forest fixture ran at about 58 FPS with
1.06 million submitted triangles. The actual app forest fixture measured about
41 FPS with 1.23 million triangles, roughly 1.01 million submitted points and
21,108 resident inferred trees. Camera, loaded city content and system activity
affect these numbers. Full-extent overview generation completed in about 25 s
in the recorded app run while yielding to input; terrain was already present.
Mobile performance and a new native Unreal build were **not** verified here.

## Evidence and limitations

`nature/ecology.json` retains source IDs, checksums, attribution and uncertainty.
The Presidio composition weights come from the historical **2001** vegetation
management plan's forested-area composition, not a current stem census. Other
regional probabilities and all understory densities are inferred rendering
priors grounded in local plant-community descriptions. They must not be exported
as measured individual species, stems, heights or botanical ground truth.

Primary references:

- [Presidio sustainable forest](https://presidio.gov/about/sustainability/creating-a-sustainable-forest)
- [Presidio forest renewal](https://presidio.gov/about/presidio-forward/restoring-green-space)
- [UC ANR account of the historical vegetation plan](https://ucanr.edu/node/136950/printable/print)
- [NPS Bay Area forest communities](https://home.nps.gov/goga/learn/nature/forests.htm)
- [East Bay Regional Parks wildland policies](https://www.ebparks.org/sites/default/files/WildlandManagementPolicies.pdf)
- [USFS coast live oak species review](https://research.fs.usda.gov/feis/species-reviews/queagr)
- [Midpen ferns](https://www.openspace.org/where-to-go/nature/plant-life/ferns)

The trees are procedural botanical approximations, not photogrammetric tree
scans. Canopy/land-cover inputs are coarse and modelled; unmapped narrow trails,
current seasonal differences, recent forestry work, exact species and individual
tree heights remain possible deviations. Beach/coast refinements are limited by
mapped boundaries and terrain sampling. No claim of fault-free global botanical
reconstruction or centimetre-accurate natural terrain is made.

Graphify's code graph was updated after code changes. Deployment must retain the
existing required `ruff`, `pytest` and `render audit vs baseline` gates and the
Vercel merged-PR gate; this pass does not weaken or bypass them.
