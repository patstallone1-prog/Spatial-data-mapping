# Graph Report - spatial-mapping-crowdsource  (2026-09-03)

## Corpus Check
- 192 files · ~1,635,943 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2587 nodes · 5143 edges · 131 communities (114 shown, 17 thin omitted)
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 309 edges (avg confidence: 0.95)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `ac4195c9`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- ScaleEstimator
- people.py
- TriggerEngine
- StreetSegment
- ReferenceFrame
- build_sf_corridor_3d.py
- PhotoJournal
- extract.py
- LocalPhotoJournal
- distributions.py
- surfaces.py
- TriggerEngine
- curb.py
- TestKeylessAdapters
- providers.py
- kartaview.py
- ImageRef
- FeatureConfig
- build_destination
- affine.py
- textured
- assess.py
- release_shards.py
- credentials.py
- calibrate.py
- 3. Layer C — Fusion engine
- dhash
- RigConfig
- seeding.py
- ConfidenceModel
- next_window
- world.py
- TestProviderSelection
- TestVaryingPace
- facts/schema.py
- daily.py
- TestGeometryHelpers
- GnssSimulator
- Camera-Only Fusion Mapping Network — Technical Re-Spec
- run_batch
- curate
- BBox
- test_distributions.py
- ImageryProvider
- run_capture_set.py
- Part B — Features still needing code
- Capture Rig v1 (Vehicle) & the Simulation Stack
- rng_for
- TinyImageDescriptor
- Plane
- Settings
- cross_section_at
- main
- scenario.py
- load_photo
- OvertureClient
- 2. Published prior art — the numbers that reset the targets
- UploadQueue.kt
- CoverageIndex
- phone.py
- mapping/__init__.py
- GlassesSession.kt
- Suppression
- Build Order — Concept to Production
- CurbProfile
- imagery/panoramax.py
- TestFullStack
- TriggerEngine
- SequenceRecord
- Pose
- DeliveryMode
- manifest.json
- Measurement Extraction, Street Overlay & Full-Stack Results
- LocalFrameStore
- Production Review — 2026-08-23
- profile.py
- Kerbside
- TestGeo
- CurbRamp
- Glasses System — Capture, Transfer, Accuracy
- Supabase storage
- pack_release_assets
- MotionState
- Spatial Mapping Crowdsource
- CARLA Harness
- ingest/__main__.py
- UploadState
- MegaLocDescriptor
- cameraroll.py
- station_grid
- deploy.sh
- CaptureSession
- mapillary.py
- BatchScheduler
- check_secrets.sh
- make_icons.py
- pwa/manifest.json
- build_site.py
- make_gallery.py
- smc
- The ultrawide result — 2026-08-30
- HttpClient
- run_pipeline
- photobank.py
- main
- CLAUDE.md
- archive
- 20260902T023431Z/manifest.json
- _sample_level_changes
- Scalable Observation Storage
- waymo.py
- 17 · Measured kerbs, and where the lidar actually is
- 12 · Installing it, and what the shutter refuses
- SidewalkSegment
- pipeline.py
- TestSidewalkSegment
- sf_corridor/README.md
- 13-sf-corridor-3d-seed.md
- docs/sw.js
- build_all.sh
- pwa/sw.js
- storage/__init__.py
- OracleMatcher
- CV/Depth Storage
- depth/__init__.py
- refresh_catalog.sh
- lidar/__init__.py

## God Nodes (most connected - your core abstractions)
1. `LocalPhotoJournal` - 41 edges
2. `Pose` - 41 edges
3. `build_corridor()` - 30 edges
4. `LocalFrameStore` - 30 edges
5. `ReferenceFrame` - 30 edges
6. `FeatureConfig` - 29 edges
7. `SequenceRecord` - 27 edges
8. `RigConfig` - 27 edges
9. `measure_cross_section()` - 26 edges
10. `Region` - 25 edges

## Surprising Connections (you probably didn't know these)
- `overpass_query()` --uses--> `BBox`  [INFERRED]
  scripts/build_sf_corridor_3d.py → src/smc/imagery/region.py
- `fetch_osm()` --uses--> `BBox`  [INFERRED]
  scripts/build_sf_corridor_3d.py → src/smc/imagery/region.py
- `build_provider()` --uses--> `HttpClient`  [INFERRED]
  scripts/harvest_region_observations.py → src/smc/imagery/http.py
- `build_provider()` --uses--> `KartaViewProvider`  [INFERRED]
  scripts/harvest_region_observations.py → src/smc/imagery/kartaview.py
- `build_provider()` --uses--> `MapillaryProvider`  [INFERRED]
  scripts/harvest_region_observations.py → src/smc/imagery/mapillary.py

## Import Cycles
- None detected.

## Communities (131 total, 17 thin omitted)

### Community 0 - "ScaleEstimator"
Cohesion: 0.06
Nodes (35): disagreement_flag(), Flag a conflict between a measurement and a reference, keeping the measurement.…, from_camera_height(), from_gnss_baseline(), from_known_object(), from_metric_depth(), from_stereo_baseline(), Metric scale recovery — the load-bearing module. Monocular structure-from-… (+27 more)

### Community 1 - "people.py"
Cohesion: 0.11
Nodes (18): assess_people(), _cascade(), detect_people(), Detection, PeopleAssessment, PeopleConfig, _prepare(), ndarray (+10 more)

### Community 2 - "TriggerEngine"
Cohesion: 0.13
Nodes (14): Layer A — deciding when to open the shutter., CaptureContext, CaptureDecision, The capture trigger. Never stream. Open the shutter only when a frame is likely…, Everything the trigger sees at one instant., Stateful evaluator. One per capture session. Ordering is load-bearing. Device-…, Why frames were skipped, over the session. The field diagnostic., Dead-reckon distance from speed. Speed is used rather than successive GNSS… (+6 more)

### Community 3 - "StreetSegment"
Cohesion: 0.06
Nodes (22): Street-map overlay: putting captures and facts onto a flat map., corridor_street_map(), MapFrame, ndarray, Lateral offset of the kerb line from the centreline, signed by side. The hint…, A street-aligned basis: along the kerb, across the footway, up. Measurements…, ENU points into the street frame: +x along, +y across, +z up., Where a pose sits on the street network. (+14 more)

### Community 4 - "ReferenceFrame"
Cohesion: 0.11
Nodes (14): FeatureMatcher, ndarray, Protocol, Inverse-variance combination of the references' own uncertainties. Not the…, Local feature matching between a query and a reference frame. Production…, Return ``(query_indices, reference_indices)`` of mutual matches., OpenCVMatcher, A real :class:`~smc.mapping.anchoring.FeatureMatcher`. Holds the query image's… (+6 more)

### Community 5 - "build_sf_corridor_3d.py"
Cohesion: 0.28
Nodes (15): annotate_osm_features(), build_payload(), _building_height(), _cell_resolution(), _centroid(), district_bands(), _feature_is_covered(), fetch_osm() (+7 more)

### Community 6 - "PhotoJournal"
Cohesion: 0.07
Nodes (24): Assessor, BatchOutcome, COMPLETE, DEFERRED, EMPTY, FAILED, PARTIAL, BatchPolicy (+16 more)

### Community 7 - "extract.py"
Cohesion: 0.06
Nodes (42): CurbHeightClass, The buckets the product is graded on (respec 8.3, Tier B)., curb_height_bucket(), Bucket a continuous height. The graded quantity is the bucket, not the…, CrossSection, KerbMeasurement, measure_cross_section(), MeasurementConfig (+34 more)

### Community 8 - "LocalPhotoJournal"
Cohesion: 0.10
Nodes (14): LocalPhotoJournal, new_entry(), datetime, Path, Overwrite the pixels in place, keeping the identity. Used by compression. The…, Delete pixels and rows. The only method that removes data. Returns how many…, Build an entry for a payload, with the content hash as its identity., Filesystem plus SQLite. The phone's working set. (+6 more)

### Community 9 - "distributions.py"
Cohesion: 0.14
Nodes (25): BlockFace, DrivewayApron, Obstruction, Hierarchical sampling of pedestrian right-of-way geometry. Sampling is…, Latent state shared by everything on one block face., Sample the latent state of one block face., Sample one run of sidewalk, conditioned on its block face., Driveway aprons — a cross-slope spike that reads as a ramp to a naive… (+17 more)

### Community 10 - "surfaces.py"
Cohesion: 0.11
Nodes (38): CrossSection, main(), _measured_rows(), Path, Promote journalled lidar sections into measured surface rows. The journal…, Any, datetime, Path (+30 more)

### Community 11 - "TriggerEngine"
Cohesion: 0.13
Nodes (16): MotionState, ctx(), CaptureContext, parametrize, Suppression, Tests for the capture trigger., The correction that clock-triggering got wrong., The property triangulation needs: frame spacing should not swing with speed. (+8 more)

### Community 12 - "curb.py"
Cohesion: 0.05
Nodes (46): main(), segment_length_m(), _enu(), find_kerb_line(), _latlon(), measure_footway(), ndarray, Measure kerbs from a point cloud along a mapped footway. The measurement itself… (+38 more)

### Community 13 - "TestKeylessAdapters"
Cohesion: 0.07
Nodes (18): BoundingBox, _get(), NominatimClient, NtripMountpoint, OpenFreeMapTiles, OverpassClient, ProjectSidewalkClient, Any (+10 more)

### Community 14 - "providers.py"
Cohesion: 0.09
Nodes (20): AdapterUnavailable, AnchorImagerySource, LocalizationResult, MetricDepthSource, Protocol, RuntimeError, Provider-agnostic interfaces. Each capability is a Protocol with at least two…, Raised when an adapter is selected but its credential or dependency is missing. (+12 more)

### Community 15 - "kartaview.py"
Cohesion: 0.11
Nodes (21): _f(), _i(), KartaViewProvider, _projection(), datetime, Observation, KartaView. KartaView (formerly OpenStreetCam) is the OpenStreetMap community's…, ``"LGE LG-H815"`` -> ``("LGE", "LG-H815")``. One token means model only. (+13 more)

### Community 16 - "ImageRef"
Cohesion: 0.08
Nodes (23): ImageRef, A street-level image available for anchoring., focal_px_from_interior(), PanoramaxImage, PanoramaxImagery, _parse_feature(), Any, datetime (+15 more)

### Community 17 - "FeatureConfig"
Cohesion: 0.14
Nodes (18): The same statistics on simulated frames, for comparison. Printed beside the…, _render_baseline(), detect(), Detector, FeatureConfig, _geometric_filter(), _grayscale(), match_features() (+10 more)

### Community 18 - "build_destination"
Cohesion: 0.12
Nodes (11): build_destination(), GcsConfig, GcsDestination, JournalEntry, Verify credentials and bucket before a batch depends on them. Worth running at…, Build a destination from a URL or a path. ``gs://bucket/prefix`` gives GCS;…, Parse ``gs://bucket/optional/prefix``., Google Cloud Storage. Authentication is Application Default Credentials —… (+3 more)

### Community 19 - "affine.py"
Cohesion: 0.13
Nodes (17): AffineView, _compose(), default_views(), detect_multi_view(), _invert(), ndarray, Affine view simulation — bridging the vantage gap. The measured failure this…, Compose two 2x3 affines: apply ``first``, then ``second``. (+9 more)

### Community 20 - "textured"
Cohesion: 0.20
Nodes (11): Write a JPEG carrying iPhone-like EXIF, for testing the loader without a phone.…, write_synthetic_iphone_photo(), blurred(), ndarray, Path, Tests for phone-side photo handling, curation, and compression., An iPhone shoots eight times the pixels the toolkit hands over., A photo-like frame: low-frequency structure plus fine texture. Pure noise is… (+3 more)

### Community 21 - "assess.py"
Cohesion: 0.20
Nodes (7): Assessment, CurationResult, Deciding which captures are worth keeping, on the phone, before anything is…, Interleave by cell so a budget cut removes depth, not coverage., What one frame scored, and what is to be done with it., _round_robin_by_cell(), On-device curation and compression.

### Community 22 - "release_shards.py"
Cohesion: 0.14
Nodes (26): main(), build_storage_manifest(), CaptureAsset, _dataset_name(), load_capture_assets(), plan_capture_release_assets(), Any, Path (+18 more)

### Community 23 - "credentials.py"
Cohesion: 0.11
Nodes (13): Capability, check(), Credential, CredentialReport, providers_for(), Every external service this system can talk to, and what it needs to…, What an adapter provides. One capability, many possible providers., One secret or setting the operator has to supply. (+5 more)

### Community 24 - "calibrate.py"
Cohesion: 0.16
Nodes (20): discover(), evaluate_directory(), evaluate_pair(), group_by_position(), main(), PairResult, Path, Calibrating the feature front end against real photographs. The simulator can… (+12 more)

### Community 25 - "3. Layer C — Fusion engine"
Cohesion: 0.11
Nodes (18): 0.1 The entire Google stack is off-limits for this business, 0.2 ODbL share-alike is survivable, but only by design, 0.3 The public segmentation datasets cannot train a commercial model, 0. Legal ground rules — read before choosing anything, 1. Layer A — Smart capture, 2. Layer B — Compression & upload, 3.1 Anchor reference data (replaces Google), 3.2 Image retrieval / place recognition (cross-contributor association, Step 4) (+10 more)

### Community 26 - "dhash"
Cohesion: 0.24
Nodes (9): dhash(), hamming(), ndarray, Area-averaged downscale to a fixed size, as grayscale. Averaging, not sampling.…, Variance of the Laplacian, normalised by image contrast. Raw Laplacian variance…, 64-bit difference hash: each bit is one horizontal gradient sign. Robust to…, sharpness(), _thumbnail() (+1 more)

### Community 27 - "RigConfig"
Cohesion: 0.10
Nodes (23): pose_at_station(), ndarray, Camera and driving parameters for a pass., The camera pose at a station along the corridor., Render once per station, reusing the flattened scene across the whole pass., _render_stations(), RigConfig, Render a simulated corridor from a camera pose. (+15 more)

### Community 28 - "seeding.py"
Cohesion: 0.05
Nodes (46): GlassesProfile, Where a walking wearer's camera is, and where it points. A wearer looks roughly…, Delivered camera characteristics for Meta AI glasses via the DAT. ``fov_deg``…, What the hardware captures, for the ratio that matters., wearer_pose(), FrameDescriptor, Protocol, Camera at ``eye`` looking at ``target``, with +z as the optical axis. Building… (+38 more)

### Community 29 - "ConfidenceModel"
Cohesion: 0.16
Nodes (9): ConfidenceModel, Observation, datetime, Saturating in the number of independent contributors. Diminishing returns are…, One contributor's measurement of one fact., Turns a set of observations into a confidence and a provenance., Observation, 40 frames from one wearer is one observer, not 40. (+1 more)

### Community 30 - "next_window"
Cohesion: 0.33
Nodes (5): next_window(), datetime, The next scheduled run after ``now``, in **local** time. The hour is local by…, Computed in UTC it landed at 19:00 local — the opposite of the intent., TestSchedule

### Community 31 - "world.py"
Cohesion: 0.05
Nodes (43): build_dome_field(), build_segment_mesh(), cumulative_step_at(), measure_curb_height(), Mesh, Parametric geometry for sampled right-of-way features. CARLA cannot supply…, Total vertical displacement accumulated by joint steps up to a station. Joint…, Loft a segment's cross-sections into a triangle mesh. (+35 more)

### Community 32 - "TestProviderSelection"
Cohesion: 0.17
Nodes (11): build_anchor_imagery(), build_visual_positioning(), MapillaryImagery, ProviderChoice, Construct an anchor-imagery provider. ``allow_internal_only`` must be passed…, Mapillary API v4 — a first-class source since the project went non-commercial.…, The query this adapter would issue. Separated so it can be asserted in tests., MonkeyPatch (+3 more)

### Community 33 - "TestVaryingPace"
Cohesion: 0.13
Nodes (12): GaitConfig, GaitSimulator, ndarray, Realistic walking pace. Nobody walks at a constant speed. Real pedestrian pace…, Pedestrian pace parameters. Defaults are ordinary adult walking., Generates a speed trace for one walk., Advance and return the current speed., A full speed trace, for analysis and tests. (+4 more)

### Community 34 - "facts/schema.py"
Cohesion: 0.07
Nodes (29): BaseModel, model_validator, The world-facts model — the thing the product actually sells., FactClass, Provenance, datetime, The served world-fact. Two rules from the re-spec are enforced here as…, Record that this measurement disagrees with a reference, keeping the… (+21 more)

### Community 35 - "daily.py"
Cohesion: 0.11
Nodes (17): Row, BatchReport, The nightly batch, fully implemented. Assess, delete rejects immediately,…, Destination, Protocol, Where the nightly batch goes. Every destination must **confirm receipt**, not…, EntryState, JournalEntry (+9 more)

### Community 36 - "TestGeometryHelpers"
Cohesion: 0.16
Nodes (10): baseline_for_depth_tolerance_m(), overlap_fraction(), perceptual_distance(), Normalised Hamming distance between two perceptual hashes. A hash rather than a…, Fraction of the frame footprint shared by consecutive captures. Multi-view…, Baseline needed to resolve depth at ``range_m`` to ``tolerance_m``. The same…, Capture rate needed to hold a minimum overlap. The inverse of…, required_capture_hz() (+2 more)

### Community 37 - "GnssSimulator"
Cohesion: 0.11
Nodes (15): Environment, GnssErrorModel, GnssSimulator, mean_horizontal_deviation(), mix_mean_deviation(), ndarray, GNSS error simulation. CARLA's built-in GNSS sensor applies independent…, Advance by ``dt_s`` and return the ENU error vector in metres. (+7 more)

### Community 38 - "Camera-Only Fusion Mapping Network — Technical Re-Spec"
Cohesion: 0.11
Nodes (18): 0. The one-paragraph version, 10. Deferred (bracketed for this version, not solved), 11. Competitive reality to build against, 1. What each layer does — and who builds it, 2. Layer A — Smart Capture ("aware software"), 3. Layer B — Compression & Upload (use the commodity, don't build it), 4. Layer C — The Fusion Engine (your only real IP), 5. Layer D — Distribution (+10 more)

### Community 39 - "run_batch"
Cohesion: 0.25
Nodes (10): BatchPolicy, Run one night's batch., run_batch(), DirectoryDestination, Path, Write to a folder — a synced drive, an external disk, a mount point. Confirmed…, Path, The journal is the only copy until the far end confirms. (+2 more)

### Community 40 - "curate"
Cohesion: 0.22
Nodes (10): assess(), curate(), CurationConfig, Score one frame. Cheap enough to run on every capture., Decide the day's batch. Order matters and is not arbitrary. Quality gates run…, Thresholds. Every one is a trade between upload cost and coverage., Verdict, An absolute threshold would drop a whole batch of a low-texture scene. (+2 more)

### Community 41 - "BBox"
Cohesion: 0.14
Nodes (5): BBox, A latitude/longitude rectangle, in degrees., Width at the mid-latitude, which is what a person means by "how wide is it"., ``west,south,east,north`` — the order STAC and GeoJSON use., Sample points covering the box, spaced ``step_m`` apart. Providers that only…

### Community 42 - "test_distributions.py"
Cohesion: 0.08
Nodes (11): _curb_fields(), _noncompliance_rate(), Tests for the right-of-way sampling model. These assert the properties the…, Recall on 'no ramp here' is unmeasurable if the sim never omits one., The corroboration claim is untestable if a repeat pass sees different geometry., A high-quality block face must depart from the standard less often than a poor…, TestCorners, TestDeterminism (+3 more)

### Community 43 - "ImageryProvider"
Cohesion: 0.11
Nodes (18): ImageAsset, ImageryProvider, Observation, Protocol, A resolved, currently-valid way to fetch one observation's pixels., Metadata-first access to a street-imagery archive., One sequence's metadata, by provider-native id., Every frame of a sequence, in capture order. Metadata only -- no pixels. (+10 more)

### Community 44 - "run_capture_set.py"
Cohesion: 0.22
Nodes (17): cluster(), fetch_streets(), Frame, _input_paths_and_metadata(), load(), main(), match_within(), Path (+9 more)

### Community 45 - "Part B — Features still needing code"
Cohesion: 0.12
Nodes (15): A1. Required. Nothing runs without these four., A2. Optional — Google. Free, and internal-build-only by your decision., A3. Optional — other, A4. Settings, not credentials — no account anywhere, A5. Wired in and needing nothing at all, B1. Blocking — the learned front end of anchoring, B2. Blocking — measurement extraction, B3. Blocking — SfM integration (+7 more)

### Community 46 - "Capture Rig v1 (Vehicle) & the Simulation Stack"
Cohesion: 0.13
Nodes (14): 1. Why vehicle-first is right — including an argument stronger than the speed one, 2. Target camera, 3.1 Vehicle: **CARLA**, 3.2 Glasses: **Meta Mock Device Kit** (official, part of the Wearables DAT), 3.3 The chain — one synthetic pipeline, both targets, 3.4 Checked and rejected, 3. Simulation stack, 4. What simulation can and cannot prove (+6 more)

### Community 47 - "rng_for"
Cohesion: 0.17
Nodes (14): corridor_facades(), Facade, facade_triangles(), ndarray, Building facades along a corridor. Not scenery. The re-spec's Step 3 anchors a…, Every facade triangle in a corridor, with per-triangle colours., One building frontage along the block., Sample the frontages on one block face. Identity-seeded like everything else,… (+6 more)

### Community 48 - "TinyImageDescriptor"
Cohesion: 0.17
Nodes (7): build_descriptor(), ndarray, Frame descriptors. Production is **MegaLoc** — DINOv2-base with a SALAD…, Downsampled greyscale, mean-centred and L2-normalised. Mean-centring before…, Select a global descriptor by name. ``auto`` prefers MegaLoc when PyTorch is…, TinyImageDescriptor, TestDescriptors

### Community 49 - "Plane"
Cohesion: 0.18
Nodes (5): Plane, A plane as unit normal and offset: ``n . x + d = 0``., Surface height above the datum at a horizontal position., Steepest slope as a fraction. A level surface is 0., Signed slope in a horizontal direction — the cross slope, given the kerb normal.

### Community 50 - "Settings"
Cohesion: 0.17
Nodes (10): load_env_file(), Path, Runtime configuration, loaded from the environment and an optional local file.…, Read ``KEY=value`` lines into the environment. Returns what it set., Render a config value safely for logs., Everything the pipeline reads from the environment., redact(), Settings (+2 more)

### Community 51 - "cross_section_at"
Cohesion: 0.22
Nodes (6): cross_section_at(), CrossSection, Lateral profile at one station, as (offset from kerb line, height) pairs.…, Height of the curb face — the rise between the gutter and the top of the curb., Evaluate the lateral profile at one station. ``ramps`` are ``(centre station,…, TestCrossSection

### Community 52 - "main"
Cohesion: 0.29
Nodes (10): _fetch(), main(), Path, Assemble the self-contained dataset the web map ships with. An Artifact runs…, Drop collinear vertices. Straight city blocks carry a lot of redundant nodes., Small JPEGs of the capture session, inlined as data URIs., road_query(), simplify() (+2 more)

### Community 53 - "scenario.py"
Cohesion: 0.06
Nodes (35): baseline_between_frames_m(), CaptureFrame, carla_available(), DriveConfig, plan_capture_stations(), Any, Path, CARLA runtime. ``carla`` is imported lazily and the module is usable without… (+27 more)

### Community 54 - "load_photo"
Cohesion: 0.14
Nodes (14): discover_photos(), load_photo(), _open(), PhotoMeta, ndarray, Path, Reading real photographs, including iPhone HEIC. Three things routinely go…, Load a photograph as RGB, with EXIF orientation applied.… (+6 more)

### Community 55 - "OvertureClient"
Cohesion: 0.22
Nodes (5): OvertureClient, Overture Maps — building footprints and road centrelines. Free, no key.…, Whether output derived from this theme carries ODbL obligations., A DuckDB SQL query reading the theme directly from open data., Buildings are the useful anchor theme and the share-alike one. Easy to forget.

### Community 56 - "2. Published prior art — the numbers that reset the targets"
Cohesion: 0.14
Nodes (13): 1. Direct competitors, 2. Published prior art — the numbers that reset the targets, 3. What this means for targeting, Bee Maps (formerly Hivemapper) — the closest *business model* comparable, Commercial targeting, Comparables, Prior Art & What to Target, MapAnything (Carnot et al., arXiv 2509.14839, v3 Jul 2026), Niantic Spatial — the incumbent on *localization* (+5 more)

### Community 57 - "UploadQueue.kt"
Cohesion: 0.17
Nodes (8): Frame, BlobUploader, ByteArray, QueuedFrame, Redactor, TransferPolicy, UploadQueue, Frame

### Community 58 - "CoverageIndex"
Cohesion: 0.19
Nodes (6): CoverageCell, CoverageIndex, Server-pushed coverage state for one H3 cell. The novelty trigger cannot be…, Local mirror of the server's coverage bitmap. Small enough to hold a city at…, Failing safe costs one upload; failing the other way costs weeks of coverage., TestCoverageIndex

### Community 59 - "phone.py"
Cohesion: 0.09
Nodes (26): CompressionPlan, CompressionProfile, fits_budget(), frames_within_budget(), ImageFormat, plan_compression(), Compression policy for the daily batch. No codec is written here and none…, Estimate the daily batch size before encoding any of it. Worth knowing in… (+18 more)

### Community 60 - "mapping/__init__.py"
Cohesion: 0.06
Nodes (41): AnchorResult, The anchoring stack — Step 3 of the fusion engine. Rough GPS puts a capture on…, Anchor one capture, or return ``None`` if it cannot be anchored confidently.…, Whether this pose is good enough to carry coarse geometry (re-spec 8.3 Tier B)., 3D mapping accuracy: anchoring, metric scale, and the confidence model., intrinsics(), _iterations_needed(), PnpResult (+33 more)

### Community 61 - "GlassesSession.kt"
Cohesion: 0.18
Nodes (6): CaptureContext, CaptureDecision, TriggerConfig, CameraSource, MockCameraSource, WearablesCameraSource

### Community 62 - "Suppression"
Cohesion: 0.14
Nodes (14): Suppression, MOTION_STATE, NO_BASELINE, NO_NOVELTY, NONE, POOR_FIX, POWER, PRIVACY_ZONE (+6 more)

### Community 63 - "Build Order — Concept to Production"
Cohesion: 0.17
Nodes (11): Build Order — Concept to Production, Critical path and where it breaks, Principles, Stage 0 — Foundations (weeks 1–3), Stage 1 — Fusion engine on borrowed imagery (weeks 3–14), Stage 2 — Capture client (weeks 10–20, parallel from Stage 1 exit gate), Stage 3 — Production pipeline (weeks 16–26), Stage 4 — Distribution (weeks 22–34) (+3 more)

### Community 64 - "CurbProfile"
Cohesion: 0.17
Nodes (8): audit(), CurbProfile, ProfileAudit, A complete jurisdiction profile., Build a profile from measured data. The intended path off the estimates. Every…, Which parts of a profile are standards and which are guesses., Classify every numeric field of a profile by provenance., TestProfileAudit

### Community 65 - "imagery/panoramax.py"
Cohesion: 0.17
Nodes (18): ObservationUnavailable, RuntimeError, The provider no longer serves this observation's pixels., _f(), _i(), _link(), PanoramaxProvider, datetime (+10 more)

### Community 66 - "TestFullStack"
Cohesion: 0.15
Nodes (4): The rule most likely to be lost between layers. Checked at the far end., A loose bound on purpose. With strict matching only a handful of frames anchor…, Real feature matching, no oracle. Yield is materially below 1.0 and that is the…, TestFullStack

### Community 67 - "TriggerEngine"
Cohesion: 0.24
Nodes (5): CaptureDecision, CaptureContext, Suppression, TriggerEngine, TriggerConfig

### Community 68 - "SequenceRecord"
Cohesion: 0.10
Nodes (24): build_provider(), collect(), Observation, bounded_sequences(), collect_provider(), provider_by_name(), Observation, summary() (+16 more)

### Community 69 - "Pose"
Cohesion: 0.11
Nodes (7): Compass heading of the camera's optical axis, degrees clockwise from north. The…, Pose, Camera position in world coordinates. Not ``translation``., World points to camera frame. Accepts (N, 3)., World-to-camera rigid transform., The single easiest thing to get backwards in this whole module., TestPose

### Community 70 - "DeliveryMode"
Cohesion: 0.12
Nodes (16): load_image(), ndarray, Load a photograph with EXIF orientation applied. Orientation is not optional.…, DegradationConfig, DegradationReport, degrade(), DeliveryMode, estimated_fov_deg() (+8 more)

### Community 71 - "manifest.json"
Cohesion: 0.22
Nodes (8): count, created_at, max_width, mode, quality, records, skipped, source

### Community 72 - "Measurement Extraction, Street Overlay & Full-Stack Results"
Cohesion: 0.22
Nodes (8): 1. Full-stack run, 2. Measurement extraction, 3. Street overlay, 4. Varying pace — the crucial verification, 5. Photo bank at delivered resolution, 6. Bugs found and fixed in this pass, 7. What this does not show, Measurement Extraction, Street Overlay & Full-Stack Results

### Community 73 - "LocalFrameStore"
Cohesion: 0.08
Nodes (18): Capture ingest: the frame store and the simulated capture run., FrameRecord, FrameStore, LocalFrameStore, object_store_uri(), datetime, Path, Protocol (+10 more)

### Community 74 - "Production Review — 2026-08-23"
Cohesion: 0.22
Nodes (8): 1. The vantage break — resolved, with a caveat that only photographs can close, 2. The oracle is no longer in any default path, 3. Learned retrieval — still not present, and here is what it needs, 4. Integrations, 5. Stale documentation — corrected, 6. GCS destination — implemented, 7. A bug found while fixing these, Production Review — 2026-08-23

### Community 75 - "profile.py"
Cohesion: 0.11
Nodes (14): BlockProfile, CurbHeightProfile, RampProfile, Sampling profiles for pedestrian right-of-way geometry. A simulation whose…, Sidewalk running surface: width, cross slope, condition, and joint displacement., Block-face level structure: construction era and build quality., Curb height as a class mixture with per-class continuous spread. Height is…, Curb ramp geometry, modelled as compliant population plus a non-compliant tail. (+6 more)

### Community 76 - "Kerbside"
Cohesion: 0.22
Nodes (8): Documentation, Kerbside, Licence, Licensing discipline, Measured, not claimed, Running it, The open question, What is here

### Community 77 - "TestGeo"
Cohesion: 0.22
Nodes (3): The checker compares positions metres apart. There the metric must be exact., Documents why distance_m exists, so nobody 'simplifies' it back to haversine., TestGeo

### Community 78 - "CurbRamp"
Cohesion: 0.29
Nodes (4): CurbRamp, A curb ramp with the geometry the robot API is asked to report., RampStyle, Geometry families. Style drives flare presence and landing shape.

### Community 79 - "Glasses System — Capture, Transfer, Accuracy"
Cohesion: 0.25
Nodes (7): 1. Capture (Layer A), 2. Transfer (Layer B), 3. Accuracy (the part that decides whether any of this works), 4. Testing against the simulator, 5. APIs to sync, 6. What is not built, Glasses System — Capture, Transfer, Accuracy

### Community 80 - "Supabase storage"
Cohesion: 0.25
Nodes (7): One statement you need to run, Reading it back, Supabase storage, The bucket is write-only, deliberately, What lands in the bucket, Which key goes where, Worth adding later

### Community 81 - "pack_release_assets"
Cohesion: 0.24
Nodes (10): main(), load_manifest(), pack_release_assets(), Any, Path, Pack planned release assets from a storage manifest., Create tar files and checksum sidecars for every planned release asset., _sha256() (+2 more)

### Community 82 - "MotionState"
Cohesion: 0.29
Nodes (7): MotionState, CYCLING, RUNNING, STATIONARY, UNKNOWN, VEHICLE, WALKING

### Community 83 - "Spatial Mapping Crowdsource"
Cohesion: 0.29
Nodes (6): Founding document, graphify, Layer boundaries (do not blur these), Non-negotiable engine rules, Spatial Mapping Crowdsource, What this is

### Community 84 - "CARLA Harness"
Cohesion: 0.29
Nodes (6): 1. The constraint that shaped the design, 2. What was built, 3. Four design decisions worth defending, 4. Findings the code produced, 5. What is still open, CARLA Harness

### Community 85 - "ingest/__main__.py"
Cohesion: 0.11
Nodes (19): distance_m(), gaussian_radius_m(), haversine_m(), Origin, Local tangent-plane geodesy. The simulator works in metres on a flat local…, Great-circle distance over long ranges. Retained for distances where earth…, The tangent point of a local ENU frame., Gaussian radius of curvature at a latitude: sqrt(M*N). The sphere radius that… (+11 more)

### Community 86 - "UploadState"
Cohesion: 0.33
Nodes (6): UploadState, DONE, FAILED, PENDING, REDACTED, UPLOADING

### Community 87 - "MegaLocDescriptor"
Cohesion: 0.14
Nodes (11): available(), best_device(), MegaLocConfig, MegaLocDescriptor, ndarray, MegaLoc — the production global descriptor. DINOv2-base with a SALAD…, Resize, scale to [0, 1], and normalise. Batched to amortise the transfer., Describe several frames at once. The only sensible way to index a survey pass. (+3 more)

### Community 88 - "cameraroll.py"
Cohesion: 0.18
Nodes (13): _cell_for(), default_sources(), ingest(), IngestReport, photos_library_readable(), Path, Ingesting photographs from a folder into the journal. The stand-in for the…, Assign a coverage cell. Real captures get an H3 cell from GPS. Camera-roll… (+5 more)

### Community 89 - "station_grid"
Cohesion: 0.32
Nodes (4): ndarray, Stations along the segment, refined around every feature that needs resolution.…, station_grid(), TestStationGrid

### Community 90 - "deploy.sh"
Cohesion: 0.60
Nodes (4): die(), PATH, say(), deploy.sh script

### Community 92 - "mapillary.py"
Cohesion: 0.07
Nodes (26): License, What a provider requires of anyone using its imagery. Kept per-observation…, _f(), _i(), MapillaryCredentialMissing, MapillaryProvider, _point(), _projection() (+18 more)

### Community 95 - "make_icons.py"
Cohesion: 0.11
Nodes (19): Image, ImageDraw, Inline the map dataset into the capture app., encode(), Path, Assemble the landing page: demo frames plus the whole app, inlined., main(), need() (+11 more)

### Community 96 - "pwa/manifest.json"
Cohesion: 0.11
Nodes (17): minimal-ui, navigation, standalone, utilities, background_color, categories, description, display (+9 more)

### Community 102 - "The ultrawide result — 2026-08-30"
Cohesion: 0.40
Nodes (4): Reproducing, The ultrawide result — 2026-08-30, What it does not settle, What this settles

### Community 103 - "HttpClient"
Cohesion: 0.13
Nodes (11): HttpClient, PermanentError, Any, RuntimeError, A polite HTTP client for provider APIs. Both providers here are free public…, The request failed in a way that may succeed later: timeout, 5xx, rate limit., The request failed in a way that will not change: 404, malformed response., Retrying, rate-limited JSON client. (+3 more)

### Community 104 - "run_pipeline"
Cohesion: 0.10
Nodes (17): AnchoringConfig, AnchoringPipeline, Retrieval, matching, PnP, and the conversion back to latitude and longitude., DescriptorIndex, ndarray, Candidates near ``(lat, lon)``, ranked by descriptor similarity. ``radius_m``…, Search radius that will contain the true position with high probability., Geographic prefilter, then cosine similarity over descriptors. (+9 more)

### Community 105 - "photobank.py"
Cohesion: 0.08
Nodes (35): MotionState, Straight from the OS activity classifier — not reimplemented. iOS…, enu_to_geodetic(), geodetic_to_enu(), Local east/north offsets to (lat, lon)., (lat, lon) to local east/north offsets., contributor_pass(), ContributorFrame (+27 more)

### Community 106 - "main"
Cohesion: 0.11
Nodes (35): main(), main(), _dedupe_sequences(), _license_rows(), main(), _observation(), Path, _rows() (+27 more)

### Community 108 - "archive"
Cohesion: 0.57
Nodes (6): archive(), archived_hashes(), digest(), main(), Path, Archive new capture photos into a Git-friendly dataset folder. The default…

### Community 109 - "20260902T023431Z/manifest.json"
Cohesion: 0.22
Nodes (8): count, created_at, max_width, mode, quality, records, skipped, source

### Community 110 - "_sample_level_changes"
Cohesion: 0.33
Nodes (4): LevelChange, A vertical discontinuity. ``cause`` is retained so the exporter can explain a…, Displacement at panel joints, with root-heave clustering. Most joints are flat.…, _sample_level_changes()

### Community 111 - "Scalable Observation Storage"
Cohesion: 0.33
Nodes (5): Byte Policy, Current SF Manifest, Preservation Tiers, Repository Roles, Scalable Observation Storage

### Community 112 - "waymo.py"
Cohesion: 0.19
Nodes (17): main(), AccessReport, active_account(), check_access(), component_path(), _filesystem(), RuntimeError, Waymo Open Dataset: access, and the terms that come with it. Waymo drove San… (+9 more)

### Community 113 - "17 · Measured kerbs, and where the lidar actually is"
Cohesion: 0.10
Nodes (19): 16 · Sweeping the corridor for every observation, A note on neighbour links, Reproducing it, The place-shaped read, The result, What is kept, Why the sequence-shaped read failed, 17 · Measured kerbs, and where the lidar actually is (+11 more)

### Community 114 - "12 · Installing it, and what the shutter refuses"
Cohesion: 0.33
Nodes (5): 12 · Installing it, and what the shutter refuses, A frame off the narrow lens, A frame with no position, The shutter refuses two things, What a "download" is here

### Community 115 - "SidewalkSegment"
Cohesion: 0.33
Nodes (3): One run of sidewalk along a block face, with everything on it., Narrowest point — the number a wheelchair or robot actually has to fit through., SidewalkSegment

### Community 116 - "pipeline.py"
Cohesion: 0.13
Nodes (11): Spatial Mapping Crowdsource., Overlaying captures onto a standard street map. The anchoring stack returns a…, FrameOutcome, PipelineResult, The full stack, end to end. corridor -> survey pass -> reference index ->…, Score served facts against ground truth, per fact class. Matching is by class…, _reason_counts(), score() (+3 more)

### Community 127 - "OracleMatcher"
Cohesion: 0.20
Nodes (7): Simulation-only components. Never imported by production paths., OracleMatcher, ndarray, A matcher oracle for simulation. **This is not a feature matcher and must never…, Correspondences read from the query's world buffer., Return indices into ``query_keypoints`` and into the reference's points.…, Pixel coordinates the match indices refer to.

### Community 128 - "CV/Depth Storage"
Cohesion: 0.50
Nodes (3): CV/Depth Storage, Promotion Path, Provenance

## Knowledge Gaps
- **220 isolated node(s):** `EMPTY`, `COMPLETE`, `PARTIAL`, `DEFERRED`, `FAILED` (+215 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **17 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `content_id()` connect `photobank.py` to `LocalPhotoJournal`, `LocalFrameStore`, `daily.py`?**
  _High betweenness centrality (0.034) - this node is a cross-community bridge._
- **Why does `LocalPhotoJournal` connect `LocalPhotoJournal` to `cameraroll.py`, `phone.py`, `daily.py`, `run_batch`?**
  _High betweenness centrality (0.027) - this node is a cross-community bridge._
- **Why does `intrinsics()` connect `mapping/__init__.py` to `run_pipeline`, `photobank.py`, `pipeline.py`, `load_photo`, `seeding.py`?**
  _High betweenness centrality (0.026) - this node is a cross-community bridge._
- **Are the 5 inferred relationships involving `LocalPhotoJournal` (e.g. with `ingest()` and `run_batch()`) actually correct?**
  _`LocalPhotoJournal` has 5 INFERRED edges - model-reasoned connections that need verification._
- **Are the 15 inferred relationships involving `Pose` (e.g. with `ContributorFrame` and `pose_at_station()`) actually correct?**
  _`Pose` has 15 INFERRED edges - model-reasoned connections that need verification._
- **Are the 7 inferred relationships involving `LocalFrameStore` (e.g. with `contributor_pass()` and `bank_summary()`) actually correct?**
  _`LocalFrameStore` has 7 INFERRED edges - model-reasoned connections that need verification._
- **Are the 8 inferred relationships involving `ReferenceFrame` (e.g. with `AnchoringPipeline` and `FeatureMatcher`) actually correct?**
  _`ReferenceFrame` has 8 INFERRED edges - model-reasoned connections that need verification._