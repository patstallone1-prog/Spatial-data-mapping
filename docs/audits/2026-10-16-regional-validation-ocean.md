# Regional validation, reconstruction restart and shared ocean — 16 October 2026

## Scope and outcome

This pass resumes the saved `6ae2517a` curb-calibration checkpoint on the latest
deployed nature implementation, rather than restoring an older renderer. No canonical
street, building, lawn or tree layout was replaced. The app-only generator updates all
eight regional consumers; the frozen website viewers remain untouched.

## HP700 and house workers

The external APFS volume UUID `65DF9122-13CE-4515-8C1A-73F608AB4171` is mounted at
`/Volumes/HP P700 1`. `/Volumes/HP P700` is a stale internal directory and was not used.
Reconstruction had stopped at its 4 GiB disk reserve despite reconnection: only 4.2 GB
decimal was available. It was not actively processing during that pause.

Following explicit user authorization to delete raw imagery, the launchd supervisor was
stopped and a complete target inventory validated before deletion. Exactly **104,057**
raw pixel/crop/mask files, **181,731,815,616 bytes** (169.25 GiB), were removed from the
named frontage-run directory. Extracted facts, certainty records, aliases, licenses,
flight/sequence metadata, model weights, wall-material assets, mixed reference-dataset
archives and reference geometry remain. Existing review records now explicitly say
`retention_basis=explicit_user_raw_purge`. This overrides the earlier low-certainty raw
retention policy for these existing files only. Deleted local pixels are not recoverable
from this run; re-download depends on their source still being available.

The local per-file plan/receipt is under `build/storage/raw-purge-2026-10-16*` in this
checkout. `scripts/purge_run_raw.py` is versioned, defaults to planning, verifies the
external disk identity, refuses changed/escaping/symlink targets, and preserves facts.
It is not an automatic deletion policy.

The original supervisor was restarted with its existing arguments: full private batches
of 256, battery allowed strictly above 30%, idle-sleep prevention and the same disk
reserve. Filter, matcher, material, contribution, storefront and reference workers were
observed running. The filter advanced past 1,100 of the corridor's 15,986 building
candidates after restart. Metadata selection precedes pixel screening; this is not a
claim that 1,100 houses were reconstructed. New processing can download new pixels.
Automatic photographic publication remains disabled. Previously extracted geometry/facts
must not be relabelled independently measured because the runner is active.

## Municipal ingestion before further photographic tuning

The new bounded, checksummed acquisitions are reproducible with
`scripts/ingest_regional_evidence.py`. ArcGIS ID enumeration and page completeness,
coordinate ranges, source edit stability and CRS are checked before recording success.
Socrata acquisitions are spatially bounded, count-checked and checked for dataset edits.
No truncated/error response is recorded as measured-empty.

| Source | Ingested features | Correct interpretation |
| --- | ---: | --- |
| Oakland Downtown curb/parking inventory | 2,558 | Historical December 2015 policy inventory, not current surveyed kerbs |
| Palo Alto RoadEdges | 1,441 | Mixed pavement/curb edges; individual SOURCE/INPUTMETHOD retained |
| San Jose Sidewalks | 1,255 | Sidewalk polygons; WIDTH units not assumed |
| San Jose Curbfaces | 564 | Curb colour/restriction records, not a complete kerb envelope |
| San Jose survey benchmarks | 32 | Control inventory; individual datum/height review still necessary |
| San Jose capital-project lines | 20 | Plan/project references, not proof of completed as-built geometry |

Berkeley's adapter was also re-run: 721 source ramp records, 606 reference crossing
records, and 623 in-bounds recognized existing ramp points in the official sidecar.
Physical-point ramps use a 2 m lookup, not SF's intersection-centre/corner radius.
No crossing paths or measured/default kerb design decisions were replaced.

Raw municipal snapshots are intentionally outside the served site and ignored by Git
until redistribution/geometry review. Committed acquisition receipts are in
`data/benchmarks/regional-municipal-acquisitions-2026-10-16.json`; they retain URLs,
checksums, counts, retrieval time, attribution and explicit non-promotion state.
Palo Alto's largest source cohorts are old stereodigitized/aerial and transferred
as-built records, not uniformly new field surveys. Do not call all 1,441 edges surveyed.

Authoritative catalogues:

- [Palo Alto Open GIS](https://opengis.cityofpaloalto.org/OpenGisData/)
- [San Jose public GIS service](https://geo.sanjoseca.gov/server/rest/services/OPN/OPN_OpenDataService/MapServer)
- [Oakland parking and mobility data](https://www.oaklandca.gov/Public-Safety-Streets/Transportation-Projects-Reports/Parking-and-Mobility-Related-Maps-and-Data)
- [Berkeley Public Works GIS](https://gis.cityofberkeley.info/arcgis/rest/services/PublicWorks/PubWorks/MapServer)

## Real lidar acquisition probes

`scripts/probe_regional_lidar.py` ingested 30 × 30 m control cells at 0.25 m requested
spacing, with native metadata, classified points, output hashes and true-metre horizontal
scale correction. Raw probe clouds are under `build/regional-evidence/lidar/`; the
committed receipt is `data/benchmarks/regional-lidar-probes-2026-10-16.json`.

| Region | 3DEP collection | Returns | Ground-class returns |
| --- | --- | ---: | ---: |
| Oakland | CA_AlamedaCo_2_2021 | 40,375 | 7,234 |
| Berkeley | CA_AlamedaCo_3_2021 | 69,730 | 5,845 |
| Palo Alto | CA_SantaClaraCounty_2020 | 19,726 | 3,274 |
| San Jose | CA_SantaClaraCounty_2020 | 21,867 | 764 |

These are source-access/classification probes, not full-region backfills, independently
validated curb correspondences or vertical-datum certification. Ground density is sparse
in the San Jose central probe because many returns belong to buildings/vegetation.
Do not turn missing ground at one point into a measured-empty city.

## Independent width/untouched-street validation

New code: `src/smc/curbmeasure/width_validation.py` and
`scripts/validate_sidewalk_holdout.py`. The current renderer's exact nominal ribbon-width
function is executed in Node and predictions frozen **before** scoring. The new San Jose
municipal sidewalk polygons are not inputs to that renderer. Whole normalized street names,
all their segments and both sides share a stable partition; there is no per-photo random
split or reference-fit correction. The manifest also freezes payload/rule/reference hashes.

Reference widths use even-odd polygon intersections normal to the street, preserve holes,
screen intersections by a 20 m endpoint exclusion, require three stable nearby cross-sections,
reject overlaps and retain source feature IDs. Missing support remains missing. Unverified
WIDTH attributes are never converted by assuming feet or metres. Station counts are not
independent sample counts: headline MAE averages street-level MAEs equally.

Frozen artifacts: `data/benchmarks/sidewalk-untouched-sj-v1{,-results}.json`.

- 10,406 attempted station sides, 6,920 supported.
- Development: 5,290 stations across 86 street groups; street-macro MAE **1.865 m**.
- Untouched test: 1,630 stations across 40 street groups; street-macro MAE **1.752 m**;
  P95 street MAE **2.615 m**. No tuning was applied to those streets afterward.

This is an **independent GIS agreement screen**, not certified physical or photographic
accuracy. It tests nominal ribbon width, not the eventual local clipping/underlay envelope.
Legal curb-to-property widths and the city's paved sidewalk polygons may describe different
quantities. Object correspondence, reference freshness/accuracy and explicit physical width
definitions must be reviewed before changing the world's geometry to match this score.
The large discrepancy remains unresolved rather than hidden by a narrower default.

The resumed photograph calibration checkpoint still has metre-scale raw registration error,
and legacy masks do not support independently validated sidewalk back edges. No fitted
training residual is promoted as held-out accuracy. A new photo rollout remains withheld
until paired reviewed masks, independent camera/scale control and surveyed width references
pass on streets excluded from calibration.

Regional parity audit refreshed at `data/benchmarks/region-parity-2026-10-16.json`.
Ingestion availability is improved, but served parity is **not achieved**: San Jose remains
13.6% explicit lidar building heights and 3.1% surveyed-facade availability; Berkeley/Palo
Alto measured curb-station shares remain 14.9%/13.5%. Oakland's source/served ground-cover
gap and sparse municipal trees remain. Other agents' park/ground artifacts were not overwritten.

## Ocean rendering

Root cause: city backdrop water multiplied its base colour by land/concrete grain, retained
roughness .99/metalness 0, and inherited shoreline triangle normals. Nature water used an
ungrained .62/.04 material. A region rectangle consequently remained visible despite equal
nominal RGB. Both now use the same linear water colour, .62 roughness, .04 metalness,
environment intensity .5 and upward water normal; grain still applies to dry city land.
Existing water/land classifications, coast heights, indoor cuts, guest-region masks and hard
land boundaries remain intact. Rectangular region-outline marker lines were also removed;
navigable region signposts remain.

The actual renderer audit fixture at `build/road-paint-preview/ocean-unified/` checks the
water shader parameters and provides the Bay overview. Regression tests assert map-grain
bypass, matching BRDF/normals and preservation of indoor/guest uniforms. No mesh-detail
reduction, altered city tree placement or restoration of older nature code was used.

## Optional Unreal sky — deferred, not claimed deployed

The installed Unreal 5.8 engine includes Epic's **Celestial Vault** day/night actor, with
location, timezone, DST rules, sun/moon/stars and volumetric clouds. It is a Beta feature.
The existing Kerbside native consumer currently uses a physical but manually positioned sun;
the live installed PWA is a different, Three.js renderer. Native integration, SF clock
synchronization, weather assets/control, packaging and graphical/performance acceptance are
not a drop-in web deployment. Under the user's explicit permission to drop this task if
substantial integration is needed, this pass leaves it unchanged rather than implementing
custom astronomy/weather or silently replacing the native project's sky.

Preferred next native integration: a separate versioned test world with Epic's actor,
SF origin, America/Los_Angeles clock/DST, checked cloud/weather presets, and dawn/noon/dusk/
night native acceptance before replacing current lighting. No paid sky asset was purchased.
[Epic's installed-system documentation](https://dev.epicgames.com/documentation/en-us/unreal-engine/celestial-vault-plugin-for-unreal-engine).

## Verification and release

Focused suites cover municipal ingestion/CRS/truncation, Berkeley ramps, raw retention,
whole-street splits, no cancellation in MAE, photographic projection/rank checks, terrain
frames, oceans, app source synchronization and tunnel safety. The existing required ruff,
pytest and renderer-baseline CI gates must pass on the exact PR head before merge. The
deployment gate is unchanged. No independent-accuracy or parity gate was falsified merely
to publish the ocean fix and new validation tools.

The first clean CI run caught a missing development dependency: SciPy was available on
the local measurement machine but not in the CI test install. It is now declared in the
development extra, rather than skipping the calibration tests. 98 focused local tests and
ruff pass. Local SF and Oakland ocean fixtures show matching water material parameters
and no warning/error console messages; the SF overview no longer has the ocean-colour box
or rectangular extent line. These limited checks do not assert perfect regional visuals.
