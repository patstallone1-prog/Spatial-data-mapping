# Graph Report - spatial-mapping-crowdsource  (2026-09-02)

## Corpus Check
- 182 files · ~1,625,773 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2445 nodes · 4869 edges · 133 communities (115 shown, 18 thin omitted)
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 294 edges (avg confidence: 0.95)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `470480d7`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- mapping/__init__.py
- people.py
- capture.py
- StreetSegment
- ReferenceFrame
- build_sf_corridor_3d.py
- PhotoJournal
- split_kerb_planes
- LocalPhotoJournal
- distributions.py
- surfaces.py
- TriggerEngine
- textured
- TestKeylessAdapters
- providers.py
- kartaview.py
- ImageRef
- FeatureConfig
- build_destination
- affine.py
- measure_cross_section
- extract.py
- release_shards.py
- credentials.py
- calibrate.py
- 3. Layer C — Fusion engine
- TriggerEngine
- RigConfig
- RenderResult
- ConfidenceModel
- daily.py
- curate
- MapillaryImagery
- TestVaryingPace
- WorldFact
- journal.py
- trigger.py
- GnssSimulator
- Camera-Only Fusion Mapping Network — Technical Re-Spec
- run_batch
- assess
- BBox
- test_distributions.py
- ImageryProvider
- run_capture_set.py
- Part B — Features still needing code
- Capture Rig v1 (Vehicle) & the Simulation Stack
- rng_for
- seeding.py
- ransac_pnp
- Settings
- CurbRamp
- world.py
- scenario.py
- load_photo
- photobank.py
- 2. Published prior art — the numbers that reset the targets
- UploadQueue.kt
- CoverageIndex
- CompressionProfile
- pose.py
- GlassesSession.kt
- Suppression
- Build Order — Concept to Production
- audit
- imagery/panoramax.py
- TestFullStack
- TriggerEngine
- SequenceRecord
- Pose
- DeliveryMode
- manifest.json
- Measurement Extraction, Street Overlay & Full-Stack Results
- test_phone.py
- Production Review — 2026-08-23
- units.py
- Kerbside
- TestGeo
- station_grid
- Glasses System — Capture, Transfer, Accuracy
- Supabase storage
- pack_release_assets
- MotionState
- Spatial Mapping Crowdsource
- CARLA Harness
- .anchor
- UploadState
- MegaLocDescriptor
- cameraroll.py
- ndarray
- deploy.sh
- CaptureSession
- imagery/schema.py
- BatchScheduler
- check_secrets.sh
- make_icons.py
- pwa/manifest.json
- build_site.py
- make_gallery.py
- smc
- The ultrawide result — 2026-08-30
- HttpClient
- test_anchoring.py
- profile.py
- main
- CLAUDE.md
- archive
- 20260902T023431Z/manifest.json
- main
- Scalable Observation Storage
- OvertureClient
- 16 · Sweeping the corridor for every observation
- 12 · Installing it, and what the shutter refuses
- TestSidewalkSegment
- pipeline.py
- test_measure_overlay.py
- sf_corridor/README.md
- 13-sf-corridor-3d-seed.md
- docs/sw.js
- build_all.sh
- pwa/sw.js
- storage/__init__.py
- SidewalkSegment
- score
- .match
- CV/Depth Storage
- LevelChange
- depth/__init__.py
- refresh_catalog.sh

## God Nodes (most connected - your core abstractions)
1. `LocalPhotoJournal` - 41 edges
2. `Pose` - 41 edges
3. `build_corridor()` - 30 edges
4. `LocalFrameStore` - 30 edges
5. `ReferenceFrame` - 30 edges
6. `FeatureConfig` - 29 edges
7. `RigConfig` - 27 edges
8. `detect()` - 25 edges
9. `KartaViewProvider` - 24 edges
10. `run_batch()` - 24 edges

## Surprising Connections (you probably didn't know these)
- `overpass_query()` --uses--> `BBox`  [INFERRED]
  scripts/build_sf_corridor_3d.py → src/smc/imagery/region.py
- `fetch_osm()` --uses--> `BBox`  [INFERRED]
  scripts/build_sf_corridor_3d.py → src/smc/imagery/region.py
- `build_provider()` --uses--> `HttpClient`  [INFERRED]
  scripts/harvest_region_observations.py → src/smc/imagery/http.py
- `build_provider()` --uses--> `KartaViewProvider`  [INFERRED]
  scripts/harvest_region_observations.py → src/smc/imagery/kartaview.py
- `provider_by_name()` --uses--> `HttpClient`  [INFERRED]
  scripts/ingest_sf_corridor.py → src/smc/imagery/http.py

## Import Cycles
- None detected.

## Communities (133 total, 18 thin omitted)

### Community 0 - "mapping/__init__.py"
Cohesion: 0.05
Nodes (39): disagreement_flag(), Flag a conflict between a measurement and a reference, keeping the measurement.…, 3D mapping accuracy: anchoring, metric scale, and the confidence model., ndarray, Candidates near ``(lat, lon)``, ranked by descriptor similarity. ``radius_m``…, RetrievalHit, from_camera_height(), from_gnss_baseline() (+31 more)

### Community 1 - "people.py"
Cohesion: 0.11
Nodes (18): assess_people(), _cascade(), detect_people(), Detection, PeopleAssessment, PeopleConfig, _prepare(), ndarray (+10 more)

### Community 2 - "capture.py"
Cohesion: 0.07
Nodes (26): Environment, mix_mean_deviation(), GNSS error simulation. CARLA's built-in GNSS sensor applies independent…, contributor_pass(), ContributorFrame, datetime, Simulated capture runs. Two kinds of pass, mirroring the two hardware tiers: *…, Drive a monocular contributor down the corridor, through the real capture… (+18 more)

### Community 3 - "StreetSegment"
Cohesion: 0.06
Nodes (22): Street-map overlay: putting captures and facts onto a flat map., corridor_street_map(), MapFrame, ndarray, Lateral offset of the kerb line from the centreline, signed by side. The hint…, A street-aligned basis: along the kerb, across the footway, up. Measurements…, ENU points into the street frame: +x along, +y across, +z up., Where a pose sits on the street network. (+14 more)

### Community 4 - "ReferenceFrame"
Cohesion: 0.13
Nodes (8): OpenCVMatcher, A real :class:`~smc.mapping.anchoring.FeatureMatcher`. Holds the query image's…, Pixel coordinates the match indices refer to., An already-anchored frame, with the 3D structure it observed. ``points_world``…, ReferenceFrame, TestRetrieval, An oracle-seeded frame cannot be matched against; skipping beats a silent zero., TestOpenCVMatcher

### Community 5 - "build_sf_corridor_3d.py"
Cohesion: 0.28
Nodes (15): annotate_osm_features(), build_payload(), _building_height(), _cell_resolution(), _centroid(), district_bands(), _feature_is_covered(), fetch_osm() (+7 more)

### Community 6 - "PhotoJournal"
Cohesion: 0.07
Nodes (24): Assessor, BatchOutcome, COMPLETE, DEFERRED, EMPTY, FAILED, PARTIAL, BatchPolicy (+16 more)

### Community 7 - "split_kerb_planes"
Cohesion: 0.08
Nodes (21): estimate_kerb_offset(), fit_plane_ransac(), perpendicular_extent(), Plane, ndarray, Plane fitting for the road and the walking surface. The two planes are the…, Find the lateral position of the kerb line by scanning for the largest height…, Find the road and walking surfaces, and the step between them. Splits laterally… (+13 more)

### Community 8 - "LocalPhotoJournal"
Cohesion: 0.10
Nodes (15): LocalPhotoJournal, new_entry(), datetime, Path, Overwrite the pixels in place, keeping the identity. Used by compression. The…, Delete pixels and rows. The only method that removes data. Returns how many…, Build an entry for a payload, with the content hash as its identity., Filesystem plus SQLite. The phone's working set. (+7 more)

### Community 9 - "distributions.py"
Cohesion: 0.14
Nodes (28): BlockFace, DrivewayApron, Obstruction, Hierarchical sampling of pedestrian right-of-way geometry. Sampling is…, Latent state shared by everything on one block face., Sample the latent state of one block face., Sample one run of sidewalk, conditioned on its block face., Displacement at panel joints, with root-heave clustering. Most joints are flat.… (+20 more)

### Community 10 - "surfaces.py"
Cohesion: 0.12
Nodes (35): CrossSection, main(), Any, datetime, Path, Schema, Parquet schemas for CV/depth outputs and simulation surfaces., read_depth_observations() (+27 more)

### Community 11 - "TriggerEngine"
Cohesion: 0.12
Nodes (18): MotionState, MotionState, Straight from the OS activity classifier — not reimplemented. iOS…, ctx(), CaptureContext, parametrize, Suppression, Tests for the capture trigger. (+10 more)

### Community 12 - "textured"
Cohesion: 0.28
Nodes (8): Write a JPEG carrying iPhone-like EXIF, for testing the loader without a phone.…, write_synthetic_iphone_photo(), Path, An iPhone shoots eight times the pixels the toolkit hands over., A photo-like frame: low-frequency structure plus fine texture. Pure noise is…, The failure that looks like a broken matcher and is a broken loader., TestPhotoLoading, textured()

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
Cohesion: 0.12
Nodes (20): The same statistics on simulated frames, for comparison. Printed beside the…, _render_baseline(), detect(), Detector, FeatureConfig, Features, _geometric_filter(), _grayscale() (+12 more)

### Community 18 - "build_destination"
Cohesion: 0.12
Nodes (11): build_destination(), GcsConfig, GcsDestination, JournalEntry, Verify credentials and bucket before a batch depends on them. Worth running at…, Build a destination from a URL or a path. ``gs://bucket/prefix`` gives GCS;…, Parse ``gs://bucket/optional/prefix``., Google Cloud Storage. Authentication is Application Default Credentials —… (+3 more)

### Community 19 - "affine.py"
Cohesion: 0.19
Nodes (14): AffineView, _compose(), default_views(), detect_multi_view(), _invert(), ndarray, Affine view simulation — bridging the vantage gap. The measured failure this…, Compose two 2x3 affines: apply ``first``, then ``second``. (+6 more)

### Community 20 - "measure_cross_section"
Cohesion: 0.13
Nodes (15): KerbMeasurement, measure_cross_section(), MeasurementConfig, ndarray, Measure kerb and footway from the reconstructed points around one station.…, Whether the measurement sits clear of its bucket edges by more than its sigma., Whether the measurement can distinguish compliant from not. Almost always false…, SidewalkMeasurement (+7 more)

### Community 21 - "extract.py"
Cohesion: 0.10
Nodes (26): The world-facts model — the thing the product actually sells., FactClass, Provenance, datetime, The served world-fact. Two rules from the re-spec are enforced here as…, Accuracy tier. Sets what may be claimed about a fact (re-spec 8.3)., Tier, tier_for_class() (+18 more)

### Community 22 - "release_shards.py"
Cohesion: 0.14
Nodes (26): main(), build_storage_manifest(), CaptureAsset, _dataset_name(), load_capture_assets(), plan_capture_release_assets(), Any, Path (+18 more)

### Community 23 - "credentials.py"
Cohesion: 0.11
Nodes (13): Capability, check(), Credential, CredentialReport, providers_for(), Every external service this system can talk to, and what it needs to…, What an adapter provides. One capability, many possible providers., One secret or setting the operator has to supply. (+5 more)

### Community 24 - "calibrate.py"
Cohesion: 0.16
Nodes (21): discover(), evaluate_directory(), evaluate_pair(), group_by_position(), main(), PairResult, Path, Calibrating the feature front end against real photographs. The simulator can… (+13 more)

### Community 25 - "3. Layer C — Fusion engine"
Cohesion: 0.11
Nodes (18): 0.1 The entire Google stack is off-limits for this business, 0.2 ODbL share-alike is survivable, but only by design, 0.3 The public segmentation datasets cannot train a commercial model, 0. Legal ground rules — read before choosing anything, 1. Layer A — Smart capture, 2. Layer B — Compression & upload, 3.1 Anchor reference data (replaces Google), 3.2 Image retrieval / place recognition (cross-contributor association, Step 4) (+10 more)

### Community 26 - "TriggerEngine"
Cohesion: 0.13
Nodes (11): Layer A — deciding when to open the shutter., CaptureDecision, Stateful evaluator. One per capture session. Ordering is load-bearing. Device-…, Why frames were skipped, over the session. The field diagnostic., Dead-reckon distance from speed. Speed is used rather than successive GNSS…, Why a frame was not taken. Ordered by how early the check runs., Thresholds. Deliberately explicit — every one of these is a battery/coverage…, Suppression (+3 more)

### Community 27 - "RigConfig"
Cohesion: 0.11
Nodes (17): Runtime configuration, loaded from the environment and an optional local file.…, pose_at_station(), ndarray, Camera and driving parameters for a pass., The camera pose at a station along the corridor., RigConfig, corridor(), fixture (+9 more)

### Community 28 - "RenderResult"
Cohesion: 0.09
Nodes (28): Software rendering — turning simulated geometry into actual images., corridor_triangles(), ndarray, A z-buffered triangle rasteriser. CARLA renders far better images than this,…, Rasterise triangles into an image, depth buffer and world-position buffer.…, Split triangles until no edge exceeds ``max_edge_m``. Necessary because the…, Subdivide a uniformly coloured batch, keeping colours aligned., Flatten a corridor's meshes into triangles plus per-triangle colours. A road… (+20 more)

### Community 29 - "ConfidenceModel"
Cohesion: 0.16
Nodes (9): ConfidenceModel, Observation, datetime, Saturating in the number of independent contributors. Diminishing returns are…, One contributor's measurement of one fact., Turns a set of observations into a confidence and a provenance., Observation, 40 frames from one wearer is one observer, not 40. (+1 more)

### Community 30 - "daily.py"
Cohesion: 0.15
Nodes (15): ImageFormat, Rough encoded size at the default quality. Conservative on purpose., BatchReport, next_window(), datetime, The nightly batch, fully implemented. Assess, delete rejects immediately,…, The next scheduled run after ``now``, in **local** time. The hour is local by…, _batch() (+7 more)

### Community 31 - "curate"
Cohesion: 0.23
Nodes (8): curate(), CurationConfig, Decide the day's batch. Order matters and is not arbitrary. Quality gates run…, Thresholds. Every one is a trade between upload cost and coverage., Verdict, An absolute threshold would drop a whole batch of a low-texture scene., A budget cut must not spend the whole day on one street., TestCuration

### Community 32 - "MapillaryImagery"
Cohesion: 0.17
Nodes (11): build_anchor_imagery(), build_visual_positioning(), MapillaryImagery, ProviderChoice, Construct an anchor-imagery provider. ``allow_internal_only`` must be passed…, Mapillary API v4 — kept as a fallback, no longer the default. Imagery is CC BY-…, The query this adapter would issue. Separated so it can be asserted in tests., MonkeyPatch (+3 more)

### Community 33 - "TestVaryingPace"
Cohesion: 0.12
Nodes (14): GaitConfig, GaitSimulator, ndarray, Realistic walking pace. Nobody walks at a constant speed. Real pedestrian pace…, Pedestrian pace parameters. Defaults are ordinary adult walking., Generates a speed trace for one walk., Advance and return the current speed., A full speed trace, for analysis and tests. (+6 more)

### Community 34 - "WorldFact"
Cohesion: 0.13
Nodes (8): BaseModel, model_validator, Record that this measurement disagrees with a reference, keeping the…, One assertion about one place, with everything needed to judge whether to trust…, WorldFact, PipelineResult, Truth is a different type on purpose; it must not be confusable with a served…, TestFactsAndTruthAreDistinct

### Community 35 - "journal.py"
Cohesion: 0.13
Nodes (14): Row, Destination, Protocol, Where the nightly batch goes. Every destination must **confirm receipt**, not…, EntryState, JournalEntry, mark(), The on-device photo journal — a real implementation, not an interface. SQLite… (+6 more)

### Community 36 - "trigger.py"
Cohesion: 0.16
Nodes (11): baseline_for_depth_tolerance_m(), overlap_fraction(), perceptual_distance(), The capture trigger. Never stream. Open the shutter only when a frame is likely…, Normalised Hamming distance between two perceptual hashes. A hash rather than a…, Fraction of the frame footprint shared by consecutive captures. Multi-view…, Baseline needed to resolve depth at ``range_m`` to ``tolerance_m``. The same…, Capture rate needed to hold a minimum overlap. The inverse of… (+3 more)

### Community 37 - "GnssSimulator"
Cohesion: 0.11
Nodes (13): GnssErrorModel, GnssSimulator, mean_horizontal_deviation(), ndarray, Advance by ``dt_s`` and return the ENU error vector in metres., Mean 2D error magnitude — the statistic the literature reports for crowdsourced…, Parameters of the error process, per horizontal axis unless noted., Stateful error generator. One instance per receiver per drive. (+5 more)

### Community 38 - "Camera-Only Fusion Mapping Network — Technical Re-Spec"
Cohesion: 0.11
Nodes (18): 0. The one-paragraph version, 10. Deferred (bracketed for this version, not solved), 11. Competitive reality to build against, 1. What each layer does — and who builds it, 2. Layer A — Smart Capture ("aware software"), 3. Layer B — Compression & Upload (use the commodity, don't build it), 4. Layer C — The Fusion Engine (your only real IP), 5. Layer D — Distribution (+10 more)

### Community 39 - "run_batch"
Cohesion: 0.25
Nodes (10): BatchPolicy, Run one night's batch., run_batch(), DirectoryDestination, Path, Write to a folder — a synced drive, an external disk, a mount point. Confirmed…, Path, The journal is the only copy until the far end confirms. (+2 more)

### Community 40 - "assess"
Cohesion: 0.15
Nodes (16): assess(), Assessment, CurationResult, dhash(), ndarray, Deciding which captures are worth keeping, on the phone, before anything is…, Area-averaged downscale to a fixed size, as grayscale. Averaging, not sampling.…, Variance of the Laplacian, normalised by image contrast. Raw Laplacian variance… (+8 more)

### Community 41 - "BBox"
Cohesion: 0.14
Nodes (5): BBox, A latitude/longitude rectangle, in degrees., Width at the mid-latitude, which is what a person means by "how wide is it"., ``west,south,east,north`` — the order STAC and GeoJSON use., Sample points covering the box, spaced ``step_m`` apart. Providers that only…

### Community 42 - "test_distributions.py"
Cohesion: 0.08
Nodes (11): _curb_fields(), _noncompliance_rate(), Tests for the right-of-way sampling model. These assert the properties the…, Recall on 'no ramp here' is unmeasurable if the sim never omits one., The corroboration claim is untestable if a repeat pass sees different geometry., A high-quality block face must depart from the standard less often than a poor…, TestCorners, TestDeterminism (+3 more)

### Community 43 - "ImageryProvider"
Cohesion: 0.14
Nodes (12): ImageAsset, ImageryProvider, License, Observation, Protocol, What a provider requires of anyone using its imagery. Kept per-observation…, A resolved, currently-valid way to fetch one observation's pixels., Metadata-first access to a street-imagery archive. (+4 more)

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

### Community 48 - "seeding.py"
Cohesion: 0.07
Nodes (33): Drive the RTK rig down the corridor at fixed spacing. Fixed spacing rather than…, survey_pass(), main(), Namespace, Generate seed data and run the end-to-end simulation. python -m smc.ingest seed…, _seed(), build_descriptor(), FrameDescriptor (+25 more)

### Community 49 - "ransac_pnp"
Cohesion: 0.21
Nodes (10): _iterations_needed(), ransac_pnp(), Linear pose from >= 6 correspondences (Direct Linear Transform). Fast,…, How many RANSAC samples are needed to see one all-inlier set, with…, Robust pose from noisy, partly wrong correspondences. Returns ``None`` rather…, solve_pnp_dlt(), ndarray, A refusal costs one unanchored frame; a wrong pose corrupts every fact from it. (+2 more)

### Community 50 - "Settings"
Cohesion: 0.10
Nodes (15): load_env_file(), Path, Read ``KEY=value`` lines into the environment. Returns what it set., Render a config value safely for logs., Everything the pipeline reads from the environment., redact(), Settings, object_store_uri() (+7 more)

### Community 51 - "CurbRamp"
Cohesion: 0.14
Nodes (8): CurbRamp, A curb ramp with the geometry the robot API is asked to report., cross_section_at(), CrossSection, Lateral profile at one station, as (offset from kerb line, height) pairs.…, Height of the curb face — the rise between the gutter and the top of the curb., Evaluate the lateral profile at one station. ``ramps`` are ``(centre station,…, TestCrossSection

### Community 52 - "world.py"
Cohesion: 0.06
Nodes (41): build_dome_field(), build_segment_mesh(), cumulative_step_at(), measure_curb_height(), Mesh, Parametric geometry for sampled right-of-way features. CARLA cannot supply…, Total vertical displacement accumulated by joint steps up to a station. Joint…, Loft a segment's cross-sections into a triangle mesh. (+33 more)

### Community 53 - "scenario.py"
Cohesion: 0.06
Nodes (35): baseline_between_frames_m(), CaptureFrame, carla_available(), DriveConfig, plan_capture_stations(), Any, Path, CARLA runtime. ``carla`` is imported lazily and the module is usable without… (+27 more)

### Community 54 - "load_photo"
Cohesion: 0.15
Nodes (13): load_photo(), _open(), PhotoMeta, ndarray, Path, Reading real photographs, including iPhone HEIC. Three things routinely go…, Load a photograph as RGB, with EXIF orientation applied.…, Pull the few EXIF fields that matter. Absent EXIF is normal, not an error. (+5 more)

### Community 55 - "photobank.py"
Cohesion: 0.07
Nodes (33): bank_summary(), BankFrame, build_photo_bank(), _decode_png(), export_contact_sheet(), GlassesProfile, datetime, ndarray (+25 more)

### Community 56 - "2. Published prior art — the numbers that reset the targets"
Cohesion: 0.14
Nodes (13): 1. Direct competitors, 2. Published prior art — the numbers that reset the targets, 3. What this means for targeting, Bee Maps (formerly Hivemapper) — the closest *business model* comparable, Commercial targeting, Comparables, Prior Art & What to Target, MapAnything (Carnot et al., arXiv 2509.14839, v3 Jul 2026), Niantic Spatial — the incumbent on *localization* (+5 more)

### Community 57 - "UploadQueue.kt"
Cohesion: 0.17
Nodes (8): Frame, BlobUploader, ByteArray, QueuedFrame, Redactor, TransferPolicy, UploadQueue, Frame

### Community 58 - "CoverageIndex"
Cohesion: 0.19
Nodes (6): CoverageCell, CoverageIndex, Server-pushed coverage state for one H3 cell. The novelty trigger cannot be…, Local mirror of the server's coverage bitmap. Small enough to hold a city at…, Failing safe costs one upload; failing the other way costs weeks of coverage., TestCoverageIndex

### Community 59 - "CompressionProfile"
Cohesion: 0.11
Nodes (17): CompressionPlan, CompressionProfile, fits_budget(), frames_within_budget(), plan_compression(), Compression policy for the daily batch. No codec is written here and none…, Estimate the daily batch size before encoding any of it. Worth knowing in…, How many frames fit in a budget. Sets the curator's daily cap on a metered plan. (+9 more)

### Community 60 - "pose.py"
Cohesion: 0.14
Nodes (13): PnpResult, pose_covariance(), position_sigma_m(), project(), Camera pose geometry: projection, PnP, and robust estimation. This is the…, Project world points to pixels. Points behind the camera come back as NaN. NaN…, Per-correspondence pixel error. Points behind the camera get ``inf``., 6x6 covariance of the pose parameters (rotvec, translation). Linearised at the… (+5 more)

### Community 61 - "GlassesSession.kt"
Cohesion: 0.18
Nodes (6): CaptureContext, CaptureDecision, TriggerConfig, CameraSource, MockCameraSource, WearablesCameraSource

### Community 62 - "Suppression"
Cohesion: 0.14
Nodes (14): Suppression, MOTION_STATE, NO_BASELINE, NO_NOVELTY, NONE, POOR_FIX, POWER, PRIVACY_ZONE (+6 more)

### Community 63 - "Build Order — Concept to Production"
Cohesion: 0.17
Nodes (11): Build Order — Concept to Production, Critical path and where it breaks, Principles, Stage 0 — Foundations (weeks 1–3), Stage 1 — Fusion engine on borrowed imagery (weeks 3–14), Stage 2 — Capture client (weeks 10–20, parallel from Stage 1 exit gate), Stage 3 — Production pipeline (weeks 16–26), Stage 4 — Distribution (weeks 22–34) (+3 more)

### Community 64 - "audit"
Cohesion: 0.18
Nodes (6): audit(), ProfileAudit, Build a profile from measured data. The intended path off the estimates. Every…, Which parts of a profile are standards and which are guesses., Classify every numeric field of a profile by provenance., TestProfileAudit

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
Nodes (25): build_provider(), collect(), Observation, bounded_sequences(), collect_provider(), provider_by_name(), Observation, summary() (+17 more)

### Community 69 - "Pose"
Cohesion: 0.15
Nodes (6): Pose, Gauss-Newton refinement of reprojection error, Huber-weighted. Huber rather…, World-to-camera rigid transform., refine_pose(), The single easiest thing to get backwards in this whole module., TestPose

### Community 70 - "DeliveryMode"
Cohesion: 0.12
Nodes (16): load_image(), ndarray, Load a photograph with EXIF orientation applied. Orientation is not optional.…, DegradationConfig, DegradationReport, degrade(), DeliveryMode, estimated_fov_deg() (+8 more)

### Community 71 - "manifest.json"
Cohesion: 0.22
Nodes (8): count, created_at, max_width, mode, quality, records, skipped, source

### Community 72 - "Measurement Extraction, Street Overlay & Full-Stack Results"
Cohesion: 0.22
Nodes (8): 1. Full-stack run, 2. Measurement extraction, 3. Street overlay, 4. Varying pace — the crucial verification, 5. Photo bank at delivered resolution, 6. Bugs found and fixed in this pass, 7. What this does not show, Measurement Extraction, Street Overlay & Full-Stack Results

### Community 73 - "test_phone.py"
Cohesion: 0.28
Nodes (5): hamming(), blurred(), ndarray, Tests for phone-side photo handling, curation, and compression., TestCurationSignals

### Community 74 - "Production Review — 2026-08-23"
Cohesion: 0.22
Nodes (8): 1. The vantage break — resolved, with a caveat that only photographs can close, 2. The oracle is no longer in any default path, 3. Learned retrieval — still not present, and here is what it needs, 4. Integrations, 5. Stale documentation — corrected, 6. GCS destination — implemented, 7. A bug found while fixing these, Production Review — 2026-08-23

### Community 75 - "units.py"
Cohesion: 0.12
Nodes (12): CurbHeightClass, The buckets the product is graded on (respec 8.3, Tier B)., curb_height_bucket(), Bucket a continuous height. The graded quantity is the bucket, not the…, inches(), ratio_from_slope(), Unit conversion. Every accessibility standard this project is measured against…, Slope as a fraction (0.0833 for 1:12). Raises on a zero run. (+4 more)

### Community 76 - "Kerbside"
Cohesion: 0.22
Nodes (8): Documentation, Kerbside, Licence, Licensing discipline, Measured, not claimed, Running it, The open question, What is here

### Community 77 - "TestGeo"
Cohesion: 0.22
Nodes (3): The checker compares positions metres apart. There the metric must be exact., Documents why distance_m exists, so nobody 'simplifies' it back to haversine., TestGeo

### Community 78 - "station_grid"
Cohesion: 0.32
Nodes (4): ndarray, Stations along the segment, refined around every feature that needs resolution.…, station_grid(), TestStationGrid

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

### Community 85 - ".anchor"
Cohesion: 0.12
Nodes (10): AnchorResult, FeatureMatcher, ndarray, Protocol, Anchor one capture, or return ``None`` if it cannot be anchored confidently.…, Inverse-variance combination of the references' own uncertainties. Not the…, Compass heading of the camera's optical axis, degrees clockwise from north. The…, Local feature matching between a query and a reference frame. Production… (+2 more)

### Community 86 - "UploadState"
Cohesion: 0.33
Nodes (6): UploadState, DONE, FAILED, PENDING, REDACTED, UPLOADING

### Community 87 - "MegaLocDescriptor"
Cohesion: 0.14
Nodes (11): available(), best_device(), MegaLocConfig, MegaLocDescriptor, ndarray, MegaLoc — the production global descriptor. DINOv2-base with a SALAD…, Resize, scale to [0, 1], and normalise. Batched to amortise the transfer., Describe several frames at once. The only sensible way to index a survey pass. (+3 more)

### Community 88 - "cameraroll.py"
Cohesion: 0.17
Nodes (14): _cell_for(), default_sources(), ingest(), IngestReport, photos_library_readable(), Path, Ingesting photographs from a folder into the journal. The stand-in for the…, Assign a coverage cell. Real captures get an H3 cell from GPS. Camera-roll… (+6 more)

### Community 89 - "ndarray"
Cohesion: 0.17
Nodes (9): ndarray, Camera position in world coordinates. Not ``translation``., World points to camera frame. Accepts (N, 3)., Rodrigues formula. A zero vector gives identity rather than a division by zero., Inverse of :func:`rotation_from_rotvec`, stable at 0 and pi., Camera at ``eye`` looking at ``target``, with +z as the optical axis. Building…, rotation_from_rotvec(), rotvec_from_rotation() (+1 more)

### Community 90 - "deploy.sh"
Cohesion: 0.60
Nodes (4): die(), PATH, say(), deploy.sh script

### Community 92 - "imagery/schema.py"
Cohesion: 0.18
Nodes (13): fetch_normalized(), normalize_image(), NormalizedAsset, Observation, Path, Ephemeral image normalization for external imagery., Correct orientation and downsample only when source exceeds the pixel budget., Resolve, download, normalize, and discard source bytes by default. (+5 more)

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
Cohesion: 0.15
Nodes (10): HttpClient, PermanentError, Any, RuntimeError, The request failed in a way that may succeed later: timeout, 5xx, rate limit., The request failed in a way that will not change: 404, malformed response., Retrying, rate-limited JSON client., Bytes from a URL, with retries. Raises Transient/PermanentError. (+2 more)

### Community 104 - "test_anchoring.py"
Cohesion: 0.23
Nodes (5): _IdentityMatcher, Tests for pose geometry, retrieval, and the anchoring pipeline. Pose recovery…, A query cannot be better anchored than the references it stood on., Perceptual aliasing in repetitive streetscapes is the normal cause., TestAnchoringPipeline

### Community 105 - "profile.py"
Cohesion: 0.17
Nodes (11): BlockProfile, CurbHeightProfile, RampProfile, RampStyle, Sampling profiles for pedestrian right-of-way geometry. A simulation whose…, Sidewalk running surface: width, cross slope, condition, and joint displacement., Block-face level structure: construction era and build quality., Geometry families. Style drives flare presence and landing shape. (+3 more)

### Community 106 - "main"
Cohesion: 0.11
Nodes (35): main(), main(), _dedupe_sequences(), _license_rows(), main(), _observation(), Path, _rows() (+27 more)

### Community 108 - "archive"
Cohesion: 0.57
Nodes (6): archive(), archived_hashes(), digest(), main(), Path, Archive new capture photos into a Git-friendly dataset folder. The default…

### Community 109 - "20260902T023431Z/manifest.json"
Cohesion: 0.22
Nodes (8): count, created_at, max_width, mode, quality, records, skipped, source

### Community 110 - "main"
Cohesion: 0.29
Nodes (10): _fetch(), main(), Path, Assemble the self-contained dataset the web map ships with. An Artifact runs…, Drop collinear vertices. Straight city blocks carry a lot of redundant nodes., Small JPEGs of the capture session, inlined as data URIs., road_query(), simplify() (+2 more)

### Community 111 - "Scalable Observation Storage"
Cohesion: 0.33
Nodes (5): Byte Policy, Current SF Manifest, Preservation Tiers, Repository Roles, Scalable Observation Storage

### Community 112 - "OvertureClient"
Cohesion: 0.22
Nodes (5): OvertureClient, Overture Maps — building footprints and road centrelines. Free, no key.…, Whether output derived from this theme carries ODbL obligations., A DuckDB SQL query reading the theme directly from open data., Buildings are the useful anchor theme and the share-alike one. Easy to forget.

### Community 113 - "16 · Sweeping the corridor for every observation"
Cohesion: 0.25
Nodes (7): 16 · Sweeping the corridor for every observation, A note on neighbour links, Reproducing it, The place-shaped read, The result, What is kept, Why the sequence-shaped read failed

### Community 114 - "12 · Installing it, and what the shutter refuses"
Cohesion: 0.33
Nodes (5): 12 · Installing it, and what the shutter refuses, A frame off the narrow lens, A frame with no position, The shutter refuses two things, What a "download" is here

### Community 116 - "pipeline.py"
Cohesion: 0.07
Nodes (33): distance_m(), enu_to_geodetic(), gaussian_radius_m(), geodetic_to_enu(), haversine_m(), Origin, Local tangent-plane geodesy. The simulator works in metres on a flat local…, Great-circle distance over long ranges. Retained for distances where earth… (+25 more)

### Community 125 - "SidewalkSegment"
Cohesion: 0.33
Nodes (3): One run of sidewalk along a block face, with everything on it., Narrowest point — the number a wheelchair or robot actually has to fit through., SidewalkSegment

### Community 126 - "score"
Cohesion: 0.50
Nodes (3): Score served facts against ground truth, per fact class. Matching is by class…, score(), TestScoring

### Community 127 - ".match"
Cohesion: 0.40
Nodes (3): ndarray, Return indices into ``query_keypoints`` and into the reference's points.…, Pixel coordinates the match indices refer to.

### Community 128 - "CV/Depth Storage"
Cohesion: 0.50
Nodes (3): CV/Depth Storage, Promotion Path, Provenance

## Knowledge Gaps
- **212 isolated node(s):** `EMPTY`, `COMPLETE`, `PARTIAL`, `DEFERRED`, `FAILED` (+207 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **18 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `intrinsics()` connect `seeding.py` to `mapping/__init__.py`, `capture.py`, `pipeline.py`, `load_photo`, `photobank.py`, `ndarray`, `pose.py`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **Why does `content_id()` connect `capture.py` to `LocalPhotoJournal`, `Settings`, `journal.py`, `photobank.py`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **Why does `Settings` connect `Settings` to `seeding.py`, `RigConfig`, `daily.py`?**
  _High betweenness centrality (0.021) - this node is a cross-community bridge._
- **Are the 5 inferred relationships involving `LocalPhotoJournal` (e.g. with `ingest()` and `run_batch()`) actually correct?**
  _`LocalPhotoJournal` has 5 INFERRED edges - model-reasoned connections that need verification._
- **Are the 15 inferred relationships involving `Pose` (e.g. with `ContributorFrame` and `pose_at_station()`) actually correct?**
  _`Pose` has 15 INFERRED edges - model-reasoned connections that need verification._
- **Are the 7 inferred relationships involving `LocalFrameStore` (e.g. with `contributor_pass()` and `bank_summary()`) actually correct?**
  _`LocalFrameStore` has 7 INFERRED edges - model-reasoned connections that need verification._
- **Are the 8 inferred relationships involving `ReferenceFrame` (e.g. with `AnchoringPipeline` and `FeatureMatcher`) actually correct?**
  _`ReferenceFrame` has 8 INFERRED edges - model-reasoned connections that need verification._