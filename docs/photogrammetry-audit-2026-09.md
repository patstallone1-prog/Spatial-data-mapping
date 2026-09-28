# Photograph use and the route to a measured photo mesh (2026-09-27)

## What is actually in the published map

The eight published region JSON summaries contain 666,037 observation **rows**,
618,304 marked eligible. These are sums across regions, not a count of globally
unique, fetched, rights-cleared, stereo-ready images. The SF corridor accounts
for 386,624 rows (338,893 eligible). Its 249,297 depth-observation rows all have
status `needs_depth`; that is a work queue, not photo-derived metric depth.

The current photograph consumers are narrower than a city reconstruction:

| Consumer | Current output | Geometric effect |
| --- | --- | --- |
| `scripts/build_facades.py` | Fetches transient street frames, projects/rectifies candidate views onto existing wall planes, checks cross-view agreement, and bakes wall textures. `docs/facades/c14r03/manifest.json` reports 220 of 685 attempted walls textured, on 113 distinct buildings; 406 failures are view disagreement and 59 insufficient views. | None: wall planes are pre-existing. |
| `scripts/build_building_colours.py` | `data/sf_public_works/building_colours.json` stores colors for 14,534 buildings. | None: sampled color changes material appearance only. |
| `scripts/measure_road_imagery.py` | Road paint/parking extraction code requires calibrated, privacy-reviewed masks and registered source assets. | No published measured parking bands from this path in this checkout. |
| `scripts/build_surface_fusion.py` | Four pilot cells have blocked `cell.json` manifests and massing-only LOD0 GLBs. | None promoted. |

No image-frame JPEG/PNG/TIFF files were found under `data/` or `build/` in this
checkout; some observation Parquet catalogs exist, but the merged SF catalog is
absent. Thus image metadata/remote locators must not be called an acquired pixel
corpus. The held-out pilot manifest names 300 observations but has no image-byte
hashes, lidar/RTK checkpoints, reviewed masks, material labels, or fixed near-field
cameras. COLMAP, PyCOLMAP, hloc, and Torch are not installed in the local venv.
The reconstruction runner is guarded scaffolding, not an executed mesh build.

`data/reconstruction/source_rights.json` marks the Mapillary source approved
for the declared derivative uses; Panoramax and KartaView are conditional per
observation, and oblique aerial imagery still needs a contract. Recheck actual
provider terms and each alias before cloud retrieval, baking, or publication;
an `eligible` geometry row is not a license decision.

## Make the entire photo collection useful

The processing unit must be an ordered **flight or street sequence**, including
all original frames and temporal/overlap links. Do not subsample the archive to
isolated “best” facade photos. The existing immutable source/acquisition/flight
manifests and decoded-pixel deduplication are the starting point; retain each
source alias, license, original checksum, capture epoch, camera model, and
provenance even when identical decoded pixels share storage.

1. **Inventory and acquire:** Export globally unique observation IDs across
   region catalogs; join full sequence manifests. Validate source rights, URL
   availability, raw-byte hash, decoded-pixel hash, EXIF orientation, resolution,
   capture time, and camera metadata. Store original bytes and canonical decoded
   pixels in versioned cloud object storage, not the laptop. Publish counts for
   metadata-only, rights-cleared, fetched, calibrated, mask-reviewed, posed,
   stereo-usable, and withheld images separately. A planning range for 400–700k
   images at 2–8 MB each is 0.8–5.6 TB of compressed originals before masks,
   depth, and intermediate MVS data; measure actual byte histograms before
   reserving compute/storage.
2. **Calibrate and protect:** Group by camera/sequence; calibrate or solve
   intrinsics/distortion, then estimate pose with GNSS priors. Segment people,
   faces, plates, vehicles, bicycles, sky, moving construction, and reflections
   before feature matching and texture baking. Keep permanent poles, streetlights,
   wires, signs, trees, balconies, stairs, windows, and doors as distinct semantic
   candidates. Mask uncertainty halos so moving-object edges do not print into
   textures. Human-review privacy samples and difficult permanent/temporary
   decisions. Never use a single-image depth or generative fill as measurement.
3. **Solve sequences and neighboring sequences:** Retrieve overlapping pairs
   spatially and with image descriptors; match ALIKED/LightGlue; use
   COLMAP/PyCOLMAP bundle adjustment with shared intrinsics and GNSS priors.
   Solve whole sequences with 30 m cell halos, then cross-sequence loop closures
   and an area-wide pose graph. Reject disconnected/low-parallax/unstable camera
   groups, large reprojection residuals, and scale drift. Record accepted and
   rejected observations rather than silently dropping frames.
4. **Dense evidence and surface identity:** Run multi-view stereo and depth
   consistency on accepted poses; fuse points/depth into a mesh or surfels in
   local ENU with explicit horizontal/vertical datum. Separate building, roof,
   road, sidewalk, curb, vegetation, and street-object components. Assign each
   mesh region a canonical feature/face ID where possible. Crucially, keep an
   unmodified canonical geometry hash and store photo geometry as a separate
   measured-candidate layer. Use multiview photos for real upper-floor forms,
   recesses, stairs, windows, roof detail, materials, and colors—not just crude
   wall tinting. Windows/doors can be semantic detail even if depth is too weak
   to move a wall.
5. **Align to independent truth:** Use surveyed controls and held-out lidar
   checkpoints (roof/eave edges, facade planes, corners, ground, curb) to solve
   registration and quantify median/P95 horizontal, vertical, and point-to-plane
   errors by range, surface, city, camera family, and coverage. Use lidar for
   alignment only on a training subset; evaluate on independent checkpoints.
   Include the 5–10 m near-field regime and low-texture/occluded surfaces.
   Expose confidence/covariance and bias, not one aggregate MAE.
6. **Promote conservatively:** Permit high-confidence visual facade/roof detail
   while the canonical pedestrian/collision geometry remains fixed. A proposed
   geometry correction is a versioned review record with source views, lidar
   residuals, and survey/control evidence. Only a separate canonical-data change
   with regression tests may update physical features. In lidar-free regions,
   publish photo-only geometry as a confidence-tagged candidate, never as
   equivalent to a surveyed curb. Fill invisible regions visually with tagged
   same-surface/procedural completion, excluded from factual exports.
7. **Texture, stream, and test:** Fuse visible observations into rectified
   surface atlases at no more than 1.25× real source sampling density; track a
   coverage class and source IDs per texel. Compile LOD0/1/2 GLB/KTX2 cells and
   stream them separately from collision. Use held-out photos, independently
   measured geometry, privacy masks, cell seams, attribution, byte/FPS budgets,
   and canonical-hash equality as hard promotion gates. Shadow-publish a
   four-cell pilot before city-wide jobs. Existing gates are enumerated in
   `docs/geometry-guided-imagery-fusion.md` and
   `scripts/validate_visual_pilot.py`.

## Executable next milestone

The four adjacent SF cells `c13r03`, `c13r04`, `c14r03`, `c14r04` are the
smallest realistic end-to-end test. First acquire licensed pixels for **complete
overlapping sequences**, pinned camera metadata, reviewed masks, and independent
lidar/RTK truth in cloud storage. Install pinned COLMAP/PyCOLMAP/hloc on a GPU
worker and run the existing guarded runner there. Then inspect registered-camera
share, held-out reprojection, and lidar residuals before attempting a dense mesh
or texture promotion. This is a substantial data/compute/validation project;
neither the current 618k eligible rows nor the blocked pilot proves a working
photogrammetric city model.
