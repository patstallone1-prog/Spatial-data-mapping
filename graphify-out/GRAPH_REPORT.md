# Graph Report - spatial-mapping-crowdsource  (2026-09-01)

## Corpus Check
- 148 files · ~3,529,704 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2298 nodes · 4543 edges · 124 communities (108 shown, 16 thin omitted)
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 285 edges (avg confidence: 0.95)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `deeee393`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- ScaleEstimator
- people.py
- LocalFrameStore
- StreetSegment
- TestRetrieval
- GlassesProfile
- PhotoJournal
- Plane
- LocalPhotoJournal
- distributions.py
- CompressionProfile
- TriggerEngine
- RenderResult
- TestKeylessAdapters
- providers.py
- kartaview.py
- ImageRef
- FeatureConfig
- build_destination
- affine.py
- measure_cross_section
- world.py
- WorldFact
- credentials.py
- calibrate.py
- 3. Layer C — Fusion engine
- photobank.py
- scenario.py
- RigConfig
- ConfidenceModel
- test_capture_pipeline.py
- curate
- MapillaryImagery
- TestVaryingPace
- geometry.py
- daily.py
- TestGeometryHelpers
- capture.py
- Camera-Only Fusion Mapping Network — Technical Re-Spec
- run_batch
- test_phone_pipeline.py
- phone.py
- test_distributions.py
- ImageryProvider
- run_capture_set.py
- Part B — Features still needing code
- Capture Rig v1 (Vehicle) & the Simulation Stack
- buildings.py
- pipeline.py
- ndarray
- Settings
- Mesh
- build_corridor
- TestFactsAndTruthAreDistinct
- load_photo
- seeding.py
- 2. Published prior art — the numbers that reset the targets
- UploadQueue.kt
- CoverageIndex
- ._pipeline
- test_anchoring.py
- GlassesSession.kt
- Suppression
- Build Order — Concept to Production
- profile.py
- imagery/panoramax.py
- TestFullStack
- TriggerEngine
- Region
- .anchor
- BBox
- manifest.json
- Measurement Extraction, Street Overlay & Full-Stack Results
- OpenCVMatcher
- Production Review — 2026-08-23
- units.py
- Kerbside
- TestGeo
- test_geometry.py
- Glasses System — Capture, Transfer, Accuracy
- Supabase storage
- project
- MotionState
- Spatial Mapping Crowdsource
- CARLA Harness
- ingest_sf_corridor.py
- UploadState
- MegaLocDescriptor
- cameraroll.py
- extract.py
- deploy.sh
- CaptureSession
- LevelChange
- BatchScheduler
- check_secrets.sh
- make_icons.py
- pwa/manifest.json
- build_site.py
- make_gallery.py
- smc
- The ultrawide result — 2026-08-30
- HttpClient
- Pose
- verify_mesh_fidelity
- coverage.py
- CLAUDE.md
- pose.py
- 20260902T023431Z/manifest.json
- main
- TestBaselineTrigger
- OvertureClient
- pose_at_station
- 12 · Installing it, and what the shutter refuses
- TriggerConfig
- degrade
- TestPose
- sf_corridor/README.md
- 13-sf-corridor-3d-seed.md
- docs/sw.js
- build_all.sh
- pwa/sw.js

## God Nodes (most connected - your core abstractions)
1. `LocalPhotoJournal` - 41 edges
2. `Pose` - 41 edges
3. `build_corridor()` - 30 edges
4. `LocalFrameStore` - 30 edges
5. `ReferenceFrame` - 30 edges
6. `FeatureConfig` - 29 edges
7. `RigConfig` - 27 edges
8. `detect()` - 25 edges
9. `run_batch()` - 24 edges
10. `load_photo()` - 24 edges

## Surprising Connections (you probably didn't know these)
- `provider_by_name()` --uses--> `HttpClient`  [INFERRED]
  scripts/ingest_sf_corridor.py → src/smc/imagery/http.py
- `provider_by_name()` --uses--> `KartaViewProvider`  [INFERRED]
  scripts/ingest_sf_corridor.py → src/smc/imagery/kartaview.py
- `bounded_sequences()` --uses--> `Region`  [INFERRED]
  scripts/ingest_sf_corridor.py → src/smc/imagery/region.py
- `collect_provider()` --uses--> `Region`  [INFERRED]
  scripts/ingest_sf_corridor.py → src/smc/imagery/region.py
- `summary()` --uses--> `Region`  [INFERRED]
  scripts/ingest_sf_corridor.py → src/smc/imagery/region.py

## Import Cycles
- None detected.

## Communities (124 total, 16 thin omitted)

### Community 0 - "ScaleEstimator"
Cohesion: 0.06
Nodes (35): disagreement_flag(), Flag a conflict between a measurement and a reference, keeping the measurement.…, from_camera_height(), from_gnss_baseline(), from_known_object(), from_metric_depth(), from_stereo_baseline(), Metric scale recovery — the load-bearing module. Monocular structure-from-… (+27 more)

### Community 1 - "people.py"
Cohesion: 0.11
Nodes (19): assess_people(), _cascade(), detect_people(), Detection, PeopleAssessment, PeopleConfig, _prepare(), ndarray (+11 more)

### Community 2 - "LocalFrameStore"
Cohesion: 0.10
Nodes (14): Capture ingest: the frame store and the simulated capture run., content_id(), FrameRecord, FrameStore, LocalFrameStore, datetime, Path, Protocol (+6 more)

### Community 3 - "StreetSegment"
Cohesion: 0.06
Nodes (22): Street-map overlay: putting captures and facts onto a flat map., corridor_street_map(), MapFrame, ndarray, Lateral offset of the kerb line from the centreline, signed by side. The hint…, A street-aligned basis: along the kerb, across the footway, up. Measurements…, ENU points into the street frame: +x along, +y across, +z up., Where a pose sits on the street network. (+14 more)

### Community 5 - "GlassesProfile"
Cohesion: 0.11
Nodes (16): GlassesProfile, ndarray, Where a walking wearer's camera is, and where it points. A wearer looks roughly…, Delivered camera characteristics for Meta AI glasses via the DAT. ``fov_deg``…, What the hardware captures, for the ratio that matters., wearer_pose(), _intrinsics_for(), ndarray (+8 more)

### Community 6 - "PhotoJournal"
Cohesion: 0.07
Nodes (24): Assessor, BatchOutcome, COMPLETE, DEFERRED, EMPTY, FAILED, PARTIAL, BatchPolicy (+16 more)

### Community 7 - "Plane"
Cohesion: 0.08
Nodes (18): estimate_kerb_offset(), fit_plane_ransac(), perpendicular_extent(), Plane, ndarray, Find the lateral position of the kerb line by scanning for the largest height…, A plane as unit normal and offset: ``n . x + d = 0``., Extent of a point set along a horizontal axis: (span, low, high). Percentile-… (+10 more)

### Community 8 - "LocalPhotoJournal"
Cohesion: 0.10
Nodes (10): LocalPhotoJournal, datetime, Path, Store a frame. Idempotent: re-adding the same bytes replaces the row, not the…, Update metadata without touching pixels., Overwrite the pixels in place, keeping the identity. Used by compression. The…, Delete pixels and rows. The only method that removes data. Returns how many…, Check that rows and blobs agree. Cheap, and worth running before a send. (+2 more)

### Community 9 - "distributions.py"
Cohesion: 0.12
Nodes (34): BlockFace, DrivewayApron, Obstruction, Hierarchical sampling of pedestrian right-of-way geometry. Sampling is…, Latent state shared by everything on one block face., Sample the latent state of one block face., Sample one run of sidewalk, conditioned on its block face., Displacement at panel joints, with root-heave clustering. Most joints are flat.… (+26 more)

### Community 10 - "CompressionProfile"
Cohesion: 0.14
Nodes (12): CompressionPlan, CompressionProfile, fits_budget(), frames_within_budget(), plan_compression(), Compression policy for the daily batch. No codec is written here and none…, Estimate the daily batch size before encoding any of it. Worth knowing in…, How many frames fit in a budget. Sets the curator's daily cap on a metered plan. (+4 more)

### Community 11 - "TriggerEngine"
Cohesion: 0.17
Nodes (10): ctx(), CaptureContext, parametrize, Suppression, Position noise is metres; differencing fixes 0.05 s apart would be pure noise., The premise of the shared trigger: a vehicle interior is not worth uploading., A flat battery must short-circuit before anything expensive is evaluated., TestSuppression (+2 more)

### Community 12 - "RenderResult"
Cohesion: 0.07
Nodes (31): Software rendering — turning simulated geometry into actual images., corridor_triangles(), ndarray, A z-buffered triangle rasteriser. CARLA renders far better images than this,…, Rasterise triangles into an image, depth buffer and world-position buffer.…, Split triangles until no edge exceeds ``max_edge_m``. Necessary because the…, Subdivide a uniformly coloured batch, keeping colours aligned., Flatten a corridor's meshes into triangles plus per-triangle colours. A road… (+23 more)

### Community 13 - "TestKeylessAdapters"
Cohesion: 0.07
Nodes (18): BoundingBox, _get(), NominatimClient, NtripMountpoint, OpenFreeMapTiles, OverpassClient, ProjectSidewalkClient, Any (+10 more)

### Community 14 - "providers.py"
Cohesion: 0.09
Nodes (20): AdapterUnavailable, AnchorImagerySource, LocalizationResult, MetricDepthSource, Protocol, RuntimeError, Provider-agnostic interfaces. Each capability is a Protocol with at least two…, Raised when an adapter is selected but its credential or dependency is missing. (+12 more)

### Community 15 - "kartaview.py"
Cohesion: 0.11
Nodes (24): ObservationUnavailable, RuntimeError, The provider no longer serves this observation's pixels., _f(), _i(), KartaViewProvider, _projection(), datetime (+16 more)

### Community 16 - "ImageRef"
Cohesion: 0.08
Nodes (23): ImageRef, A street-level image available for anchoring., focal_px_from_interior(), PanoramaxImage, PanoramaxImagery, _parse_feature(), Any, datetime (+15 more)

### Community 17 - "FeatureConfig"
Cohesion: 0.13
Nodes (19): The same statistics on simulated frames, for comparison. Printed beside the…, _render_baseline(), detect(), FeatureConfig, Features, _geometric_filter(), _grayscale(), match_features() (+11 more)

### Community 18 - "build_destination"
Cohesion: 0.12
Nodes (11): build_destination(), GcsConfig, GcsDestination, JournalEntry, Verify credentials and bucket before a batch depends on them. Worth running at…, Build a destination from a URL or a path. ``gs://bucket/prefix`` gives GCS;…, Parse ``gs://bucket/optional/prefix``., Google Cloud Storage. Authentication is Application Default Credentials —… (+3 more)

### Community 19 - "affine.py"
Cohesion: 0.16
Nodes (17): AffineView, _compose(), default_views(), detect_multi_view(), _invert(), ndarray, Affine view simulation — bridging the vantage gap. The measured failure this…, Compose two 2x3 affines: apply ``first``, then ``second``. (+9 more)

### Community 20 - "measure_cross_section"
Cohesion: 0.16
Nodes (11): measure_cross_section(), MeasurementConfig, ndarray, Measure kerb and footway from the reconstructed points around one station.…, kerb_cloud(), ndarray, Tests for measurement extraction, street overlay, gait, and the photo bank., The arithmetic behind Tier C: a 1.5% rise over 1.6 m is inside the fit noise. (+3 more)

### Community 21 - "world.py"
Cohesion: 0.14
Nodes (16): curb_height_bucket(), Assemble a simulated corridor and its ground truth. This is the bridge between…, Bucket a continuous height. The graded quantity is the bucket, not the…, The world-facts model — the thing the product actually sells., FactClass, datetime, The served world-fact. Two rules from the re-spec are enforced here as…, Accuracy tier. Sets what may be claimed about a fact (re-spec 8.3). (+8 more)

### Community 22 - "WorldFact"
Cohesion: 0.13
Nodes (9): BaseModel, model_validator, Record that this measurement disagrees with a reference, keeping the…, One assertion about one place, with everything needed to judge whether to trust…, WorldFact, PipelineResult, Score served facts against ground truth, per fact class. Matching is by class…, score() (+1 more)

### Community 23 - "credentials.py"
Cohesion: 0.11
Nodes (13): Capability, check(), Credential, CredentialReport, providers_for(), Every external service this system can talk to, and what it needs to…, What an adapter provides. One capability, many possible providers., One secret or setting the operator has to supply. (+5 more)

### Community 24 - "calibrate.py"
Cohesion: 0.10
Nodes (33): discover(), evaluate_directory(), evaluate_pair(), group_by_position(), load_image(), main(), PairResult, ndarray (+25 more)

### Community 25 - "3. Layer C — Fusion engine"
Cohesion: 0.11
Nodes (18): 0.1 The entire Google stack is off-limits for this business, 0.2 ODbL share-alike is survivable, but only by design, 0.3 The public segmentation datasets cannot train a commercial model, 0. Legal ground rules — read before choosing anything, 1. Layer A — Smart capture, 2. Layer B — Compression & upload, 3.1 Anchor reference data (replaces Google), 3.2 Image retrieval / place recognition (cross-contributor association, Step 4) (+10 more)

### Community 26 - "photobank.py"
Cohesion: 0.09
Nodes (26): Realistic walking pace. Nobody walks at a constant speed. Real pedestrian pace…, Layer A — deciding when to open the shutter., CaptureContext, CaptureDecision, MotionState, The capture trigger. Never stream. Open the shutter only when a frame is likely…, Everything the trigger sees at one instant., Stateful evaluator. One per capture session. Ordering is load-bearing. Device-… (+18 more)

### Community 27 - "scenario.py"
Cohesion: 0.06
Nodes (35): baseline_between_frames_m(), CaptureFrame, carla_available(), DriveConfig, plan_capture_stations(), Any, Path, CARLA runtime. ``carla`` is imported lazily and the module is usable without… (+27 more)

### Community 28 - "RigConfig"
Cohesion: 0.14
Nodes (16): contributor_pass(), ndarray, Drive a monocular contributor down the corridor, through the real capture…, Camera and driving parameters for a pass., Render once per station, reusing the flattened scene across the whole pass., Drive the RTK rig down the corridor at fixed spacing. Fixed spacing rather than…, _render_stations(), RigConfig (+8 more)

### Community 29 - "ConfidenceModel"
Cohesion: 0.13
Nodes (13): Provenance, ConfidenceModel, FusedValue, Observation, datetime, Confidence, corroboration, and freshness decay. The promotion rule from the re-…, Saturating in the number of independent contributors. Diminishing returns are…, One contributor's measurement of one fact. (+5 more)

### Community 30 - "test_capture_pipeline.py"
Cohesion: 0.15
Nodes (13): Runtime configuration, loaded from the environment and an optional local file.…, _chunk(), encode_png(), ndarray, Path, Minimal PNG writer. Written against zlib from the standard library rather than…, Encode an (H, W, 3) uint8 array as PNG bytes., write_png() (+5 more)

### Community 31 - "curate"
Cohesion: 0.09
Nodes (28): assess(), Assessment, curate(), CurationConfig, CurationResult, dhash(), hamming(), ndarray (+20 more)

### Community 32 - "MapillaryImagery"
Cohesion: 0.17
Nodes (11): build_anchor_imagery(), build_visual_positioning(), MapillaryImagery, ProviderChoice, Construct an anchor-imagery provider. ``allow_internal_only`` must be passed…, Mapillary API v4 — kept as a fallback, no longer the default. Imagery is CC BY-…, The query this adapter would issue. Separated so it can be asserted in tests., MonkeyPatch (+3 more)

### Community 33 - "TestVaryingPace"
Cohesion: 0.14
Nodes (11): GaitConfig, GaitSimulator, ndarray, Pedestrian pace parameters. Defaults are ordinary adult walking., Generates a speed trace for one walk., Advance and return the current speed., A full speed trace, for analysis and tests., parametrize (+3 more)

### Community 34 - "geometry.py"
Cohesion: 0.10
Nodes (16): CurbRamp, One run of sidewalk along a block face, with everything on it., Narrowest point — the number a wheelchair or robot actually has to fit through., A curb ramp with the geometry the robot API is asked to report., SidewalkSegment, build_segment_mesh(), cross_section_at(), CrossSection (+8 more)

### Community 35 - "daily.py"
Cohesion: 0.17
Nodes (12): Row, BatchReport, The nightly batch, fully implemented. Assess, delete rejects immediately,…, Destination, Protocol, Where the nightly batch goes. Every destination must **confirm receipt**, not…, EntryState, JournalEntry (+4 more)

### Community 36 - "TestGeometryHelpers"
Cohesion: 0.16
Nodes (10): baseline_for_depth_tolerance_m(), overlap_fraction(), perceptual_distance(), Normalised Hamming distance between two perceptual hashes. A hash rather than a…, Fraction of the frame footprint shared by consecutive captures. Multi-view…, Baseline needed to resolve depth at ``range_m`` to ``tolerance_m``. The same…, Capture rate needed to hold a minimum overlap. The inverse of…, required_capture_hz() (+2 more)

### Community 37 - "capture.py"
Cohesion: 0.10
Nodes (17): Environment, GnssErrorModel, GnssSimulator, mean_horizontal_deviation(), mix_mean_deviation(), ndarray, GNSS error simulation. CARLA's built-in GNSS sensor applies independent…, Advance by ``dt_s`` and return the ENU error vector in metres. (+9 more)

### Community 38 - "Camera-Only Fusion Mapping Network — Technical Re-Spec"
Cohesion: 0.11
Nodes (18): 0. The one-paragraph version, 10. Deferred (bracketed for this version, not solved), 11. Competitive reality to build against, 1. What each layer does — and who builds it, 2. Layer A — Smart Capture ("aware software"), 3. Layer B — Compression & Upload (use the commodity, don't build it), 4. Layer C — The Fusion Engine (your only real IP), 5. Layer D — Distribution (+10 more)

### Community 39 - "run_batch"
Cohesion: 0.25
Nodes (10): BatchPolicy, Run one night's batch., run_batch(), DirectoryDestination, Path, Write to a folder — a synced drive, an external disk, a mount point. Confirmed…, Path, The journal is the only copy until the far end confirms. (+2 more)

### Community 40 - "test_phone_pipeline.py"
Cohesion: 0.17
Nodes (13): decode(), encode(), ndarray, Re-encode through Pillow, falling back if a format is unavailable. On a phone…, new_entry(), Build an entry for a payload, with the content hash as its identity., photo(), png_bytes() (+5 more)

### Community 41 - "phone.py"
Cohesion: 0.19
Nodes (14): ImageFormat, Rough encoded size at the default quality. Conservative on purpose., next_window(), datetime, The next scheduled run after ``now``, in **local** time. The hour is local by…, _batch(), _ingest(), main() (+6 more)

### Community 42 - "test_distributions.py"
Cohesion: 0.07
Nodes (13): _curb_fields(), _noncompliance_rate(), Tests for the right-of-way sampling model. These assert the properties the…, Tier C exists because these are rare and small. Both properties are asserted., Recall on 'no ramp here' is unmeasurable if the sim never omits one., The corroboration claim is untestable if a repeat pass sees different geometry., A high-quality block face must depart from the standard less often than a poor…, TestCorners (+5 more)

### Community 43 - "ImageryProvider"
Cohesion: 0.09
Nodes (21): ImageAsset, ImageryProvider, License, Observation, Protocol, What a provider requires of anyone using its imagery. Kept per-observation…, A resolved, currently-valid way to fetch one observation's pixels., Metadata-first access to a street-imagery archive. (+13 more)

### Community 44 - "run_capture_set.py"
Cohesion: 0.22
Nodes (17): cluster(), fetch_streets(), Frame, _input_paths_and_metadata(), load(), main(), match_within(), Path (+9 more)

### Community 45 - "Part B — Features still needing code"
Cohesion: 0.12
Nodes (15): A1. Required. Nothing runs without these four., A2. Optional — Google. Free, and internal-build-only by your decision., A3. Optional — other, A4. Settings, not credentials — no account anywhere, A5. Wired in and needing nothing at all, B1. Blocking — the learned front end of anchoring, B2. Blocking — measurement extraction, B3. Blocking — SfM integration (+7 more)

### Community 46 - "Capture Rig v1 (Vehicle) & the Simulation Stack"
Cohesion: 0.13
Nodes (14): 1. Why vehicle-first is right — including an argument stronger than the speed one, 2. Target camera, 3.1 Vehicle: **CARLA**, 3.2 Glasses: **Meta Mock Device Kit** (official, part of the Wearables DAT), 3.3 The chain — one synthetic pipeline, both targets, 3.4 Checked and rejected, 3. Simulation stack, 4. What simulation can and cannot prove (+6 more)

### Community 47 - "buildings.py"
Cohesion: 0.18
Nodes (12): corridor_facades(), Facade, facade_triangles(), ndarray, Building facades along a corridor. Not scenery. The re-spec's Step 3 anchors a…, Every facade triangle in a corridor, with per-triangle colours., One building frontage along the block., Sample the frontages on one block face. Identity-seeded like everything else,… (+4 more)

### Community 48 - "pipeline.py"
Cohesion: 0.05
Nodes (44): distance_m(), enu_to_geodetic(), gaussian_radius_m(), geodetic_to_enu(), haversine_m(), Origin, Local tangent-plane geodesy. The simulator works in metres on a flat local…, Great-circle distance over long ranges. Retained for distances where earth… (+36 more)

### Community 49 - "ndarray"
Cohesion: 0.17
Nodes (8): ndarray, Camera position in world coordinates. Not ``translation``., World points to camera frame. Accepts (N, 3)., Rodrigues formula. A zero vector gives identity rather than a division by zero., Inverse of :func:`rotation_from_rotvec`, stable at 0 and pi., rotation_from_rotvec(), rotvec_from_rotation(), TestRotation

### Community 50 - "Settings"
Cohesion: 0.10
Nodes (15): load_env_file(), Path, Read ``KEY=value`` lines into the environment. Returns what it set., Render a config value safely for logs., Everything the pipeline reads from the environment., redact(), Settings, object_store_uri() (+7 more)

### Community 51 - "Mesh"
Cohesion: 0.18
Nodes (11): Mesh, A triangle mesh in a local frame: +x along the kerb, +y into the sidewalk, +z…, main(), Generate a corridor: meshes for the renderer, ground truth for the checker.…, Path, Wavefront OBJ export. OBJ rather than a CARLA-native format on purpose: CARLA…, Write meshes to a single OBJ, one named group per mesh. OBJ vertex indices are…, write_obj() (+3 more)

### Community 52 - "build_corridor"
Cohesion: 0.12
Nodes (13): build_corridor(), Corridor, CorridorSegment, export_ground_truth(), PlacedRamp, Lay out block faces along a corridor, with a corner at each block boundary., The exact answer key for the corridor., A simulated stretch of street with everything on it. (+5 more)

### Community 54 - "load_photo"
Cohesion: 0.09
Nodes (29): discover_photos(), load_photo(), _open(), PhotoMeta, ndarray, Path, Reading real photographs, including iPhone HEIC. Three things routinely go…, Load a photograph as RGB, with EXIF orientation applied.… (+21 more)

### Community 55 - "seeding.py"
Cohesion: 0.09
Nodes (27): main(), Namespace, Generate seed data and run the end-to-end simulation. python -m smc.ingest seed…, _seed(), build_descriptor(), FrameDescriptor, ndarray, Protocol (+19 more)

### Community 56 - "2. Published prior art — the numbers that reset the targets"
Cohesion: 0.14
Nodes (13): 1. Direct competitors, 2. Published prior art — the numbers that reset the targets, 3. What this means for targeting, Bee Maps (formerly Hivemapper) — the closest *business model* comparable, Commercial targeting, Comparables, Prior Art & What to Target, MapAnything (Carnot et al., arXiv 2509.14839, v3 Jul 2026), Niantic Spatial — the incumbent on *localization* (+5 more)

### Community 57 - "UploadQueue.kt"
Cohesion: 0.17
Nodes (8): Frame, BlobUploader, ByteArray, QueuedFrame, Redactor, TransferPolicy, UploadQueue, Frame

### Community 58 - "CoverageIndex"
Cohesion: 0.19
Nodes (6): CoverageCell, CoverageIndex, Server-pushed coverage state for one H3 cell. The novelty trigger cannot be…, Local mirror of the server's coverage bitmap. Small enough to hold a city at…, Failing safe costs one upload; failing the other way costs weeks of coverage., TestCoverageIndex

### Community 59 - "._pipeline"
Cohesion: 0.36
Nodes (3): A query cannot be better anchored than the references it stood on., Perceptual aliasing in repetitive streetscapes is the normal cause., TestAnchoringPipeline

### Community 60 - "test_anchoring.py"
Cohesion: 0.20
Nodes (8): Linear pose from >= 6 correspondences (Direct Linear Transform). Fast,…, solve_pnp_dlt(), _IdentityMatcher, ndarray, Tests for pose geometry, retrieval, and the anchoring pipeline. Pose recovery…, A refusal costs one unanchored frame; a wrong pose corrupts every fact from it., scene(), TestPnp

### Community 61 - "GlassesSession.kt"
Cohesion: 0.18
Nodes (6): CaptureContext, CaptureDecision, TriggerConfig, CameraSource, MockCameraSource, WearablesCameraSource

### Community 62 - "Suppression"
Cohesion: 0.14
Nodes (14): Suppression, MOTION_STATE, NO_BASELINE, NO_NOVELTY, NONE, POOR_FIX, POWER, PRIVACY_ZONE (+6 more)

### Community 63 - "Build Order — Concept to Production"
Cohesion: 0.17
Nodes (11): Build Order — Concept to Production, Critical path and where it breaks, Principles, Stage 0 — Foundations (weeks 1–3), Stage 1 — Fusion engine on borrowed imagery (weeks 3–14), Stage 2 — Capture client (weeks 10–20, parallel from Stage 1 exit gate), Stage 3 — Production pipeline (weeks 16–26), Stage 4 — Distribution (weeks 22–34) (+3 more)

### Community 64 - "profile.py"
Cohesion: 0.10
Nodes (15): audit(), BlockProfile, CurbHeightProfile, ProfileAudit, RampProfile, Sampling profiles for pedestrian right-of-way geometry. A simulation whose…, Sidewalk running surface: width, cross slope, condition, and joint displacement., Block-face level structure: construction era and build quality. (+7 more)

### Community 65 - "imagery/panoramax.py"
Cohesion: 0.19
Nodes (16): _f(), _i(), _link(), PanoramaxProvider, datetime, Observation, _rational(), Panoramax. Panoramax is street-level imagery run by IGN, the French national… (+8 more)

### Community 66 - "TestFullStack"
Cohesion: 0.15
Nodes (4): The rule most likely to be lost between layers. Checked at the far end., A loose bound on purpose. With strict matching only a handful of frames anchor…, Real feature matching, no oracle. Yield is materially below 1.0 and that is the…, TestFullStack

### Community 67 - "TriggerEngine"
Cohesion: 0.24
Nodes (5): CaptureDecision, CaptureContext, Suppression, TriggerEngine, TriggerConfig

### Community 68 - "Region"
Cohesion: 0.12
Nodes (16): The provider interface. Everything above this line knows about observations and…, exact_dedupe(), mark_eligibility(), Observation, Observation eligibility and deterministic lightweight deduplication., Quality tier from source pixels. Missing resolution stays reject-tier., Apply v1 source-quality gates without inventing missing provider facts., Collapse only definite duplicates: same provider instance and image id. (+8 more)

### Community 69 - ".anchor"
Cohesion: 0.31
Nodes (6): Anchor one capture, or return ``None`` if it cannot be anchored confidently.…, pose_covariance(), position_sigma_m(), 6x6 covariance of the pose parameters (rotvec, translation). Linearised at the…, Horizontal 1-sigma position uncertainty from a pose covariance. Uses the…, TestPoseUncertainty

### Community 70 - "BBox"
Cohesion: 0.12
Nodes (13): build_payload(), district_bands(), fetch_osm(), h3_boundary(), main(), overpass_query(), Any, Path (+5 more)

### Community 71 - "manifest.json"
Cohesion: 0.22
Nodes (8): count, created_at, max_width, mode, quality, records, skipped, source

### Community 72 - "Measurement Extraction, Street Overlay & Full-Stack Results"
Cohesion: 0.22
Nodes (8): 1. Full-stack run, 2. Measurement extraction, 3. Street overlay, 4. Varying pace — the crucial verification, 5. Photo bank at delivered resolution, 6. Bugs found and fixed in this pass, 7. What this does not show, Measurement Extraction, Street Overlay & Full-Stack Results

### Community 73 - "OpenCVMatcher"
Cohesion: 0.24
Nodes (5): OpenCVMatcher, A real :class:`~smc.mapping.anchoring.FeatureMatcher`. Holds the query image's…, Pixel coordinates the match indices refer to., An oracle-seeded frame cannot be matched against; skipping beats a silent zero., TestOpenCVMatcher

### Community 74 - "Production Review — 2026-08-23"
Cohesion: 0.22
Nodes (8): 1. The vantage break — resolved, with a caveat that only photographs can close, 2. The oracle is no longer in any default path, 3. Learned retrieval — still not present, and here is what it needs, 4. Integrations, 5. Stale documentation — corrected, 6. GCS destination — implemented, 7. A bug found while fixing these, Production Review — 2026-08-23

### Community 75 - "units.py"
Cohesion: 0.14
Nodes (9): build_dome_field(), Truncated-dome detectable warning field. Domes are 0.9 in across and 0.2 in…, inches(), ratio_from_slope(), Unit conversion. Every accessibility standard this project is measured against…, Slope as a fraction (0.0833 for 1:12). Raises on a zero run., Slope fraction to the run of a 1:N ratio. 0.0833 -> 12.0., slope_from_ratio() (+1 more)

### Community 76 - "Kerbside"
Cohesion: 0.22
Nodes (8): Documentation, Kerbside, Licence, Licensing discipline, Measured, not claimed, Running it, The open question, What is here

### Community 77 - "TestGeo"
Cohesion: 0.22
Nodes (3): The checker compares positions metres apart. There the metric must be exact., Documents why distance_m exists, so nobody 'simplifies' it back to haversine., TestGeo

### Community 78 - "test_geometry.py"
Cohesion: 0.16
Nodes (7): ndarray, Stations along the segment, refined around every feature that needs resolution.…, station_grid(), parametrize, Tests for mesh construction and the corridor build. The central assertion is…, TestCurbBuckets, TestStationGrid

### Community 79 - "Glasses System — Capture, Transfer, Accuracy"
Cohesion: 0.25
Nodes (7): 1. Capture (Layer A), 2. Transfer (Layer B), 3. Accuracy (the part that decides whether any of this works), 4. Testing against the simulator, 5. APIs to sync, 6. What is not built, Glasses System — Capture, Transfer, Accuracy

### Community 80 - "Supabase storage"
Cohesion: 0.25
Nodes (7): One statement you need to run, Reading it back, Supabase storage, The bucket is write-only, deliberately, What lands in the bucket, Which key goes where, Worth adding later

### Community 81 - "project"
Cohesion: 0.32
Nodes (6): project(), Project world points to pixels. Points behind the camera come back as NaN. NaN…, Per-correspondence pixel error. Points behind the camera get ``inf``., reprojection_errors(), Not a wrapped coordinate — a mirrored solution is how pose solvers go wrong., TestProjection

### Community 82 - "MotionState"
Cohesion: 0.29
Nodes (7): MotionState, CYCLING, RUNNING, STATIONARY, UNKNOWN, VEHICLE, WALKING

### Community 83 - "Spatial Mapping Crowdsource"
Cohesion: 0.29
Nodes (6): Founding document, graphify, Layer boundaries (do not blur these), Non-negotiable engine rules, Spatial Mapping Crowdsource, What this is

### Community 84 - "CARLA Harness"
Cohesion: 0.29
Nodes (6): 1. The constraint that shaped the design, 2. What was built, 3. Four design decisions worth defending, 4. Findings the code produced, 5. What is still open, CARLA Harness

### Community 85 - "ingest_sf_corridor.py"
Cohesion: 0.21
Nodes (18): Schema, bounded_sequences(), collect_provider(), main(), provider_by_name(), Observation, summary(), dataclass_rows() (+10 more)

### Community 86 - "UploadState"
Cohesion: 0.33
Nodes (6): UploadState, DONE, FAILED, PENDING, REDACTED, UPLOADING

### Community 87 - "MegaLocDescriptor"
Cohesion: 0.14
Nodes (11): available(), best_device(), MegaLocConfig, MegaLocDescriptor, ndarray, MegaLoc — the production global descriptor. DINOv2-base with a SALAD…, Resize, scale to [0, 1], and normalise. Batched to amortise the transfer., Describe several frames at once. The only sensible way to index a survey pass. (+3 more)

### Community 88 - "cameraroll.py"
Cohesion: 0.18
Nodes (13): _cell_for(), default_sources(), ingest(), IngestReport, photos_library_readable(), Path, Ingesting photographs from a folder into the journal. The stand-in for the…, Assign a coverage cell. Real captures get an H3 cell from GPS. Camera-roll… (+5 more)

### Community 89 - "extract.py"
Cohesion: 0.11
Nodes (18): utcnow(), CrossSection, KerbMeasurement, datetime, From a reconstruction to world-facts. This is the step between a solved pose…, Everything measurable at one place along the kerb., Serialise a measured cross-section into servable facts. Provenance is decided…, Whether the measurement sits clear of its bucket edges by more than its sigma. (+10 more)

### Community 90 - "deploy.sh"
Cohesion: 0.60
Nodes (4): die(), PATH, say(), deploy.sh script

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
Cohesion: 0.18
Nodes (10): HttpClient, PermanentError, Any, RuntimeError, A polite HTTP client for provider APIs. Both providers here are free public…, The request failed in a way that may succeed later: timeout, 5xx, rate limit., The request failed in a way that will not change: 404, malformed response., Retrying, rate-limited JSON client. (+2 more)

### Community 104 - "Pose"
Cohesion: 0.15
Nodes (6): ContributorFrame, One stored contributor capture, with the truth kept separate for scoring., Compass heading of the camera's optical axis, degrees clockwise from north. The…, Pose, World-to-camera rigid transform., Camera at ``eye`` looking at ``target``, with +z as the optical axis. Building…

### Community 105 - "verify_mesh_fidelity"
Cohesion: 0.20
Nodes (7): measure_curb_height(), Recover curb height from mesh vertices — the inverse of the generator. Used by…, FidelityReport, Whether the rendered geometry actually carries the sampled parameters., Recover curb height from the meshes and compare against what was sampled.…, verify_mesh_fidelity(), TestMeshFidelity

### Community 106 - "coverage.py"
Cohesion: 0.25
Nodes (10): assign_cells(), build_coverage_rows(), _heading_diversity(), Any, datetime, Observation, H3 coverage summaries for the SF corridor imagery catalog., Attach H3 cell ids in place. (+2 more)

### Community 108 - "pose.py"
Cohesion: 0.24
Nodes (8): _iterations_needed(), PnpResult, ransac_pnp(), Camera pose geometry: projection, PnP, and robust estimation. This is the…, Gauss-Newton refinement of reprojection error, Huber-weighted. Huber rather…, How many RANSAC samples are needed to see one all-inlier set, with…, Robust pose from noisy, partly wrong correspondences. Returns ``None`` rather…, refine_pose()

### Community 109 - "20260902T023431Z/manifest.json"
Cohesion: 0.22
Nodes (8): count, created_at, max_width, mode, quality, records, skipped, source

### Community 110 - "main"
Cohesion: 0.29
Nodes (10): _fetch(), main(), Path, Assemble the self-contained dataset the web map ships with. An Artifact runs…, Drop collinear vertices. Straight city blocks carry a lot of redundant nodes., Small JPEGs of the capture session, inlined as data URIs., road_query(), simplify() (+2 more)

### Community 111 - "TestBaselineTrigger"
Cohesion: 0.27
Nodes (6): MotionState, Tests for the capture trigger., The correction that clock-triggering got wrong., The property triangulation needs: frame spacing should not swing with speed., run(), TestBaselineTrigger

### Community 112 - "OvertureClient"
Cohesion: 0.22
Nodes (5): OvertureClient, Overture Maps — building footprints and road centrelines. Free, no key.…, Whether output derived from this theme carries ODbL obligations., A DuckDB SQL query reading the theme directly from open data., Buildings are the useful anchor theme and the share-alike one. Easy to forget.

### Community 113 - "pose_at_station"
Cohesion: 0.31
Nodes (4): pose_at_station(), The camera pose at a station along the corridor., Surface detail keyed on world position, so the same spot looks the same twice.…, TestRendering

### Community 114 - "12 · Installing it, and what the shutter refuses"
Cohesion: 0.33
Nodes (5): 12 · Installing it, and what the shutter refuses, A frame off the narrow lens, A frame with no position, The shutter refuses two things, What a "download" is here

### Community 115 - "TriggerConfig"
Cohesion: 0.33
Nodes (3): Thresholds. Deliberately explicit — every one of these is a battery/coverage…, TriggerConfig, A real limit worth knowing: above ~16 m/s a 4 Hz cap cannot hold the 4 m…

### Community 116 - "degrade"
Cohesion: 0.33
Nodes (4): DegradationReport, degrade(), ndarray, Turn a phone photograph into what the glasses would have delivered.

## Knowledge Gaps
- **199 isolated node(s):** `EMPTY`, `COMPLETE`, `PARTIAL`, `DEFERRED`, `FAILED` (+194 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **16 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `intrinsics()` connect `seeding.py` to `capture.py`, `GlassesProfile`, `pose.py`, `pipeline.py`, `ndarray`, `load_photo`, `photobank.py`?**
  _High betweenness centrality (0.035) - this node is a cross-community bridge._
- **Why does `Pose` connect `Pose` to `GlassesProfile`, `capture.py`, `.anchor`, `pose.py`, `RenderResult`, `test_anchoring.py`, `pipeline.py`, `pose_at_station`, `ndarray`, `project`, `TestPose`, `seeding.py`, `photobank.py`, `._pipeline`, `RigConfig`?**
  _High betweenness centrality (0.029) - this node is a cross-community bridge._
- **Why does `Settings` connect `Settings` to `phone.py`, `test_capture_pipeline.py`, `seeding.py`?**
  _High betweenness centrality (0.026) - this node is a cross-community bridge._
- **Are the 5 inferred relationships involving `LocalPhotoJournal` (e.g. with `ingest()` and `run_batch()`) actually correct?**
  _`LocalPhotoJournal` has 5 INFERRED edges - model-reasoned connections that need verification._
- **Are the 15 inferred relationships involving `Pose` (e.g. with `ContributorFrame` and `pose_at_station()`) actually correct?**
  _`Pose` has 15 INFERRED edges - model-reasoned connections that need verification._
- **Are the 7 inferred relationships involving `LocalFrameStore` (e.g. with `contributor_pass()` and `bank_summary()`) actually correct?**
  _`LocalFrameStore` has 7 INFERRED edges - model-reasoned connections that need verification._
- **Are the 8 inferred relationships involving `ReferenceFrame` (e.g. with `AnchoringPipeline` and `FeatureMatcher`) actually correct?**
  _`ReferenceFrame` has 8 INFERRED edges - model-reasoned connections that need verification._