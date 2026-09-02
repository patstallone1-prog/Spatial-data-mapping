# Graph Report - spatial-mapping-crowdsource  (2026-09-02)

## Corpus Check
- 172 files · ~1,604,615 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2412 nodes · 4791 edges · 133 communities (114 shown, 19 thin omitted)
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 290 edges (avg confidence: 0.95)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `bd6e2ed8`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- from_metric_depth
- people.py
- LocalFrameStore
- StreetSegment
- ReferenceFrame
- build_sf_corridor_3d.py
- PhotoJournal
- split_kerb_planes
- test_phone_pipeline.py
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
- DriveConfig
- capture.py
- ConfidenceModel
- encode_png
- curate
- MapillaryImagery
- TestVaryingPace
- WorldFact
- LocalPhotoJournal
- trigger.py
- GnssSimulator
- Camera-Only Fusion Mapping Network — Technical Re-Spec
- daily.py
- assess.py
- BBox
- test_distributions.py
- ImageryProvider
- run_capture_set.py
- Part B — Features still needing code
- Capture Rig v1 (Vehicle) & the Simulation Stack
- buildings.py
- pipeline.py
- ScaleEstimator
- Settings
- geometry.py
- world.py
- StereoRig
- load_photo
- photobank.py
- 2. Published prior art — the numbers that reset the targets
- UploadQueue.kt
- CoverageIndex
- CompressionProfile
- Pose
- GlassesSession.kt
- Suppression
- Build Order — Concept to Production
- profile.py
- imagery/panoramax.py
- TestFullStack
- TriggerEngine
- Region
- scenario.py
- DeliveryMode
- manifest.json
- Measurement Extraction, Street Overlay & Full-Stack Results
- dhash
- Production Review — 2026-08-23
- units.py
- Kerbside
- test_simulation.py
- station_grid
- Glasses System — Capture, Transfer, Accuracy
- Supabase storage
- pack_release_assets
- MotionState
- Spatial Mapping Crowdsource
- CARLA Harness
- SequenceRecord
- UploadState
- MegaLocDescriptor
- phone.py
- mapping/__init__.py
- deploy.sh
- CaptureSession
- Mesh
- BatchScheduler
- check_secrets.sh
- make_icons.py
- pwa/manifest.json
- build_site.py
- make_gallery.py
- smc
- The ultrawide result — 2026-08-30
- HttpClient
- ScaleObservation
- ScaleEstimate
- main
- CLAUDE.md
- archive
- 20260902T023431Z/manifest.json
- main
- Scalable Observation Storage
- OvertureClient
- TestFactsAndTruthAreDistinct
- 12 · Installing it, and what the shutter refuses
- TestSidewalkSegment
- smc/__init__.py
- CrossSection
- sf_corridor/README.md
- 13-sf-corridor-3d-seed.md
- docs/sw.js
- build_all.sh
- pwa/sw.js
- storage/__init__.py
- test_mapping.py
- from_stereo_baseline
- TestRetrieval
- CV/Depth Storage
- .step
- gaussian_radius_m
- depth/__init__.py
- .is_binary

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
- `overpass_query()` --uses--> `BBox`  [INFERRED]
  scripts/build_sf_corridor_3d.py → src/smc/imagery/region.py
- `fetch_osm()` --uses--> `BBox`  [INFERRED]
  scripts/build_sf_corridor_3d.py → src/smc/imagery/region.py
- `provider_by_name()` --uses--> `HttpClient`  [INFERRED]
  scripts/ingest_sf_corridor.py → src/smc/imagery/http.py
- `provider_by_name()` --uses--> `KartaViewProvider`  [INFERRED]
  scripts/ingest_sf_corridor.py → src/smc/imagery/kartaview.py
- `bounded_sequences()` --uses--> `Region`  [INFERRED]
  scripts/ingest_sf_corridor.py → src/smc/imagery/region.py

## Import Cycles
- None detected.

## Communities (133 total, 19 thin omitted)

### Community 0 - "from_metric_depth"
Cohesion: 0.19
Nodes (10): from_camera_height(), from_gnss_baseline(), from_known_object(), from_metric_depth(), Scale from the camera's height above the fitted ground plane. The wearer's…, Scale from an object of standard dimensions — a curb face, a dome field, a…, Scale from distance travelled between two fixes. Two fixes with independent…, Scale from a metric monocular depth model (DA3METRIC-LARGE and similar).… (+2 more)

### Community 1 - "people.py"
Cohesion: 0.11
Nodes (18): assess_people(), _cascade(), detect_people(), Detection, PeopleAssessment, PeopleConfig, _prepare(), ndarray (+10 more)

### Community 2 - "LocalFrameStore"
Cohesion: 0.07
Nodes (25): contributor_pass(), ContributorFrame, datetime, Drive a monocular contributor down the corridor, through the real capture…, One stored contributor capture, with the truth kept separate for scoring., Capture ingest: the frame store and the simulated capture run., content_id(), FrameRecord (+17 more)

### Community 3 - "StreetSegment"
Cohesion: 0.06
Nodes (22): Street-map overlay: putting captures and facts onto a flat map., corridor_street_map(), MapFrame, ndarray, Lateral offset of the kerb line from the centreline, signed by side. The hint…, A street-aligned basis: along the kerb, across the footway, up. Measurements…, ENU points into the street frame: +x along, +y across, +z up., Where a pose sits on the street network. (+14 more)

### Community 4 - "ReferenceFrame"
Cohesion: 0.08
Nodes (17): FeatureMatcher, ndarray, Protocol, Inverse-variance combination of the references' own uncertainties. Not the…, Local feature matching between a query and a reference frame. Production…, Return ``(query_indices, reference_indices)`` of mutual matches., An already-anchored frame, with the 3D structure it observed. ``points_world``…, ReferenceFrame (+9 more)

### Community 5 - "build_sf_corridor_3d.py"
Cohesion: 0.28
Nodes (15): annotate_osm_features(), build_payload(), _building_height(), _cell_resolution(), _centroid(), district_bands(), _feature_is_covered(), fetch_osm() (+7 more)

### Community 6 - "PhotoJournal"
Cohesion: 0.07
Nodes (24): Assessor, BatchOutcome, COMPLETE, DEFERRED, EMPTY, FAILED, PARTIAL, BatchPolicy (+16 more)

### Community 7 - "split_kerb_planes"
Cohesion: 0.06
Nodes (27): Whether the measurement can distinguish compliant from not. Almost always false…, SidewalkMeasurement, Measurement extraction — turning a reconstruction into world-facts., estimate_kerb_offset(), fit_plane_ransac(), KerbPlanes, perpendicular_extent(), Plane (+19 more)

### Community 8 - "test_phone_pipeline.py"
Cohesion: 0.15
Nodes (14): decode(), encode(), ndarray, Re-encode through Pillow, falling back if a format is unavailable. On a phone…, new_entry(), Build an entry for a payload, with the content hash as its identity., photo(), png_bytes() (+6 more)

### Community 9 - "distributions.py"
Cohesion: 0.10
Nodes (36): BlockFace, DrivewayApron, LevelChange, Obstruction, Hierarchical sampling of pedestrian right-of-way geometry. Sampling is…, Latent state shared by everything on one block face., A vertical discontinuity. ``cause`` is retained so the exporter can explain a…, Sample the latent state of one block face. (+28 more)

### Community 10 - "surfaces.py"
Cohesion: 0.12
Nodes (35): CrossSection, main(), Any, datetime, Path, Schema, Parquet schemas for CV/depth outputs and simulation surfaces., read_depth_observations() (+27 more)

### Community 11 - "TriggerEngine"
Cohesion: 0.12
Nodes (18): MotionState, MotionState, Straight from the OS activity classifier — not reimplemented. iOS…, ctx(), CaptureContext, parametrize, Suppression, Tests for the capture trigger. (+10 more)

### Community 12 - "textured"
Cohesion: 0.20
Nodes (11): Write a JPEG carrying iPhone-like EXIF, for testing the loader without a phone.…, write_synthetic_iphone_photo(), blurred(), ndarray, Path, Tests for phone-side photo handling, curation, and compression., An iPhone shoots eight times the pixels the toolkit hands over., A photo-like frame: low-frequency structure plus fine texture. Pure noise is… (+3 more)

### Community 13 - "TestKeylessAdapters"
Cohesion: 0.07
Nodes (18): BoundingBox, _get(), NominatimClient, NtripMountpoint, OpenFreeMapTiles, OverpassClient, ProjectSidewalkClient, Any (+10 more)

### Community 14 - "providers.py"
Cohesion: 0.09
Nodes (20): AdapterUnavailable, AnchorImagerySource, LocalizationResult, MetricDepthSource, Protocol, RuntimeError, Provider-agnostic interfaces. Each capability is a Protocol with at least two…, Raised when an adapter is selected but its credential or dependency is missing. (+12 more)

### Community 15 - "kartaview.py"
Cohesion: 0.13
Nodes (21): _f(), _i(), KartaViewProvider, _projection(), datetime, Observation, KartaView. KartaView (formerly OpenStreetCam) is the OpenStreetMap community's…, ``"LGE LG-H815"`` -> ``("LGE", "LG-H815")``. One token means model only. (+13 more)

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
Cohesion: 0.19
Nodes (14): AffineView, _compose(), default_views(), detect_multi_view(), _invert(), ndarray, Affine view simulation — bridging the vantage gap. The measured failure this…, Compose two 2x3 affines: apply ``first``, then ``second``. (+6 more)

### Community 20 - "measure_cross_section"
Cohesion: 0.16
Nodes (11): measure_cross_section(), MeasurementConfig, ndarray, Measure kerb and footway from the reconstructed points around one station.…, kerb_cloud(), ndarray, Tests for measurement extraction, street overlay, gait, and the photo bank., The arithmetic behind Tier C: a 1.5% rise over 1.6 m is inside the fit noise. (+3 more)

### Community 21 - "extract.py"
Cohesion: 0.12
Nodes (21): The world-facts model — the thing the product actually sells., FactClass, Provenance, datetime, The served world-fact. Two rules from the re-spec are enforced here as…, Accuracy tier. Sets what may be claimed about a fact (re-spec 8.3)., Tier, tier_for_class() (+13 more)

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

### Community 27 - "DriveConfig"
Cohesion: 0.20
Nodes (11): baseline_between_frames_m(), DriveConfig, plan_capture_stations(), Forward distance between consecutive captures — the multi-view triangulation…, Generate the capture record for a drive without rendering. Produces exactly the…, Stations at which frames will be captured, given speed and capture rate. Pure…, simulate_drive(), Why rigid stereo is for scale and motion stereo is for precision. (+3 more)

### Community 28 - "capture.py"
Cohesion: 0.06
Nodes (44): pose_at_station(), ndarray, Simulated capture runs. Two kinds of pass, mirroring the two hardware tiers: *…, Camera and driving parameters for a pass., The camera pose at a station along the corridor., Render once per station, reusing the flattened scene across the whole pass., _render_stations(), RigConfig (+36 more)

### Community 29 - "ConfidenceModel"
Cohesion: 0.16
Nodes (9): ConfidenceModel, Observation, datetime, Saturating in the number of independent contributors. Diminishing returns are…, One contributor's measurement of one fact., Turns a set of observations into a confidence and a provenance., Observation, 40 frames from one wearer is one observer, not 40. (+1 more)

### Community 30 - "encode_png"
Cohesion: 0.24
Nodes (8): _chunk(), encode_png(), ndarray, Path, Minimal PNG writer. Written against zlib from the standard library rather than…, Encode an (H, W, 3) uint8 array as PNG bytes., write_png(), TestPng

### Community 31 - "curate"
Cohesion: 0.22
Nodes (10): assess(), curate(), CurationConfig, Score one frame. Cheap enough to run on every capture., Decide the day's batch. Order matters and is not arbitrary. Quality gates run…, Thresholds. Every one is a trade between upload cost and coverage., Verdict, An absolute threshold would drop a whole batch of a low-texture scene. (+2 more)

### Community 32 - "MapillaryImagery"
Cohesion: 0.17
Nodes (11): build_anchor_imagery(), build_visual_positioning(), MapillaryImagery, ProviderChoice, Construct an anchor-imagery provider. ``allow_internal_only`` must be passed…, Mapillary API v4 — kept as a fallback, no longer the default. Imagery is CC BY-…, The query this adapter would issue. Separated so it can be asserted in tests., MonkeyPatch (+3 more)

### Community 33 - "TestVaryingPace"
Cohesion: 0.12
Nodes (14): GaitConfig, GaitSimulator, ndarray, Realistic walking pace. Nobody walks at a constant speed. Real pedestrian pace…, Pedestrian pace parameters. Defaults are ordinary adult walking., Generates a speed trace for one walk., Advance and return the current speed., A full speed trace, for analysis and tests. (+6 more)

### Community 34 - "WorldFact"
Cohesion: 0.13
Nodes (9): BaseModel, model_validator, Record that this measurement disagrees with a reference, keeping the…, One assertion about one place, with everything needed to judge whether to trust…, WorldFact, PipelineResult, Score served facts against ground truth, per fact class. Matching is by class…, score() (+1 more)

### Community 35 - "LocalPhotoJournal"
Cohesion: 0.09
Nodes (18): Row, Where the nightly batch goes. Every destination must **confirm receipt**, not…, EntryState, JournalEntry, LocalPhotoJournal, mark(), datetime, Path (+10 more)

### Community 36 - "trigger.py"
Cohesion: 0.16
Nodes (11): baseline_for_depth_tolerance_m(), overlap_fraction(), perceptual_distance(), The capture trigger. Never stream. Open the shutter only when a frame is likely…, Normalised Hamming distance between two perceptual hashes. A hash rather than a…, Fraction of the frame footprint shared by consecutive captures. Multi-view…, Baseline needed to resolve depth at ``range_m`` to ``tolerance_m``. The same…, Capture rate needed to hold a minimum overlap. The inverse of… (+3 more)

### Community 37 - "GnssSimulator"
Cohesion: 0.14
Nodes (13): Environment, GnssErrorModel, GnssSimulator, mean_horizontal_deviation(), mix_mean_deviation(), GNSS error simulation. CARLA's built-in GNSS sensor applies independent…, Mean 2D error magnitude — the statistic the literature reports for crowdsourced…, Parameters of the error process, per horizontal axis unless noted. (+5 more)

### Community 38 - "Camera-Only Fusion Mapping Network — Technical Re-Spec"
Cohesion: 0.11
Nodes (18): 0. The one-paragraph version, 10. Deferred (bracketed for this version, not solved), 11. Competitive reality to build against, 1. What each layer does — and who builds it, 2. Layer A — Smart Capture ("aware software"), 3. Layer B — Compression & Upload (use the commodity, don't build it), 4. Layer C — The Fusion Engine (your only real IP), 5. Layer D — Distribution (+10 more)

### Community 39 - "daily.py"
Cohesion: 0.12
Nodes (19): BatchPolicy, BatchReport, next_window(), datetime, The nightly batch, fully implemented. Assess, delete rejects immediately,…, Run one night's batch., The next scheduled run after ``now``, in **local** time. The hour is local by…, run_batch() (+11 more)

### Community 40 - "assess.py"
Cohesion: 0.20
Nodes (7): Assessment, CurationResult, Deciding which captures are worth keeping, on the phone, before anything is…, Interleave by cell so a budget cut removes depth, not coverage., What one frame scored, and what is to be done with it., _round_robin_by_cell(), On-device curation and compression.

### Community 41 - "BBox"
Cohesion: 0.14
Nodes (5): BBox, A latitude/longitude rectangle, in degrees., Width at the mid-latitude, which is what a person means by "how wide is it"., ``west,south,east,north`` — the order STAC and GeoJSON use., Sample points covering the box, spaced ``step_m`` apart. Providers that only…

### Community 42 - "test_distributions.py"
Cohesion: 0.08
Nodes (11): _curb_fields(), _noncompliance_rate(), Tests for the right-of-way sampling model. These assert the properties the…, Recall on 'no ramp here' is unmeasurable if the sim never omits one., The corroboration claim is untestable if a repeat pass sees different geometry., A high-quality block face must depart from the standard less often than a poor…, TestCorners, TestDeterminism (+3 more)

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
Nodes (57): distance_m(), enu_to_geodetic(), geodetic_to_enu(), Origin, Local tangent-plane geodesy. The simulator works in metres on a flat local…, The tangent point of a local ENU frame., Local east/north offsets to (lat, lon)., (lat, lon) to local east/north offsets. (+49 more)

### Community 49 - "ScaleEstimator"
Cohesion: 0.24
Nodes (5): Robust inverse-variance fusion of scale observations., ScaleEstimator, Two confident sources that contradict each other mean one is wrong., With two observations there is no consensus to reject against., TestScaleFusion

### Community 50 - "Settings"
Cohesion: 0.17
Nodes (10): load_env_file(), Path, Runtime configuration, loaded from the environment and an optional local file.…, Read ``KEY=value`` lines into the environment. Returns what it set., Render a config value safely for logs., Everything the pipeline reads from the environment., redact(), Settings (+2 more)

### Community 51 - "geometry.py"
Cohesion: 0.07
Nodes (23): CurbRamp, One run of sidewalk along a block face, with everything on it., Narrowest point — the number a wheelchair or robot actually has to fit through., A curb ramp with the geometry the robot API is asked to report., SidewalkSegment, build_segment_mesh(), cross_section_at(), CrossSection (+15 more)

### Community 52 - "world.py"
Cohesion: 0.09
Nodes (20): build_corridor(), Corridor, CorridorSegment, curb_height_bucket(), export_ground_truth(), PlacedRamp, Assemble a simulated corridor and its ground truth. This is the bridge between…, Lay out block faces along a corridor, with a corner at each block boundary. (+12 more)

### Community 53 - "StereoRig"
Cohesion: 0.12
Nodes (12): CameraSpec, CaptureSettings, default_rig(), Sensor rig definitions. The rig mirrors the physical Tier 2 vehicle rig in…, Intrinsics and mounting for one camera, matching Arducam AR0234 on the vehicle…, Pinhole focal length in pixels — needed by every metric-depth conversion., A synchronised pair on a rigid baseline — the rig's source of metric scale.…, Range beyond which stereo can no longer meet a depth tolerance. (+4 more)

### Community 54 - "load_photo"
Cohesion: 0.14
Nodes (14): discover_photos(), load_photo(), _open(), PhotoMeta, ndarray, Path, Reading real photographs, including iPhone HEIC. Three things routinely go…, Load a photograph as RGB, with EXIF orientation applied.… (+6 more)

### Community 55 - "photobank.py"
Cohesion: 0.07
Nodes (31): bank_summary(), BankFrame, build_photo_bank(), _decode_png(), export_contact_sheet(), GlassesProfile, datetime, ndarray (+23 more)

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
Cohesion: 0.14
Nodes (12): CompressionPlan, CompressionProfile, fits_budget(), frames_within_budget(), plan_compression(), Compression policy for the daily batch. No codec is written here and none…, Estimate the daily batch size before encoding any of it. Worth knowing in…, How many frames fit in a budget. Sets the curator's daily cap on a metered plan. (+4 more)

### Community 60 - "Pose"
Cohesion: 0.05
Nodes (41): AnchorResult, Anchor one capture, or return ``None`` if it cannot be anchored confidently.…, Compass heading of the camera's optical axis, degrees clockwise from north. The…, Whether this pose is good enough to carry coarse geometry (re-spec 8.3 Tier B)., _iterations_needed(), Pose, pose_covariance(), position_sigma_m() (+33 more)

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
Cohesion: 0.17
Nodes (17): ObservationUnavailable, RuntimeError, The provider no longer serves this observation's pixels., _f(), _i(), _link(), PanoramaxProvider, datetime (+9 more)

### Community 66 - "TestFullStack"
Cohesion: 0.13
Nodes (6): FrameOutcome, _reason_counts(), The rule most likely to be lost between layers. Checked at the far end., A loose bound on purpose. With strict matching only a handful of frames anchor…, Real feature matching, no oracle. Yield is materially below 1.0 and that is the…, TestFullStack

### Community 67 - "TriggerEngine"
Cohesion: 0.24
Nodes (5): CaptureDecision, CaptureContext, Suppression, TriggerEngine, TriggerConfig

### Community 68 - "Region"
Cohesion: 0.15
Nodes (13): The provider interface. Everything above this line knows about observations and…, exact_dedupe(), mark_eligibility(), Observation, Observation eligibility and deterministic lightweight deduplication., Quality tier from source pixels. Missing resolution stays reject-tier., Apply v1 source-quality gates without inventing missing provider facts., Collapse only definite duplicates: same provider instance and image id. (+5 more)

### Community 69 - "scenario.py"
Cohesion: 0.16
Nodes (12): CaptureFrame, carla_available(), Any, Path, CARLA runtime. ``carla`` is imported lazily and the module is usable without…, Write the ingest manifest — engine-visible fields only. The true pose is…, Run the drive in CARLA and write images. Requires a running CARLA server and…, Whether the CARLA Python API can be imported in this interpreter. (+4 more)

### Community 70 - "DeliveryMode"
Cohesion: 0.12
Nodes (16): load_image(), ndarray, Load a photograph with EXIF orientation applied. Orientation is not optional.…, DegradationConfig, DegradationReport, degrade(), DeliveryMode, estimated_fov_deg() (+8 more)

### Community 71 - "manifest.json"
Cohesion: 0.22
Nodes (8): count, created_at, max_width, mode, quality, records, skipped, source

### Community 72 - "Measurement Extraction, Street Overlay & Full-Stack Results"
Cohesion: 0.22
Nodes (8): 1. Full-stack run, 2. Measurement extraction, 3. Street overlay, 4. Varying pace — the crucial verification, 5. Photo bank at delivered resolution, 6. Bugs found and fixed in this pass, 7. What this does not show, Measurement Extraction, Street Overlay & Full-Stack Results

### Community 73 - "dhash"
Cohesion: 0.24
Nodes (9): dhash(), hamming(), ndarray, Area-averaged downscale to a fixed size, as grayscale. Averaging, not sampling.…, Variance of the Laplacian, normalised by image contrast. Raw Laplacian variance…, 64-bit difference hash: each bit is one horizontal gradient sign. Robust to…, sharpness(), _thumbnail() (+1 more)

### Community 74 - "Production Review — 2026-08-23"
Cohesion: 0.22
Nodes (8): 1. The vantage break — resolved, with a caveat that only photographs can close, 2. The oracle is no longer in any default path, 3. Learned retrieval — still not present, and here is what it needs, 4. Integrations, 5. Stale documentation — corrected, 6. GCS destination — implemented, 7. A bug found while fixing these, Production Review — 2026-08-23

### Community 75 - "units.py"
Cohesion: 0.22
Nodes (5): ratio_from_slope(), Unit conversion. Every accessibility standard this project is measured against…, Slope as a fraction (0.0833 for 1:12). Raises on a zero run., Slope fraction to the run of a 1:N ratio. 0.0833 -> 12.0., slope_from_ratio()

### Community 76 - "Kerbside"
Cohesion: 0.22
Nodes (8): Documentation, Kerbside, Licence, Licensing discipline, Measured, not claimed, Running it, The open question, What is here

### Community 77 - "test_simulation.py"
Cohesion: 0.18
Nodes (4): Tests for geodesy, GNSS error, the sensor rig, and drive planning., The checker compares positions metres apart. There the metric must be exact., Documents why distance_m exists, so nobody 'simplifies' it back to haversine., TestGeo

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

### Community 85 - "SequenceRecord"
Cohesion: 0.20
Nodes (20): bounded_sequences(), collect_provider(), main(), provider_by_name(), Observation, summary(), dataclass_rows(), Any (+12 more)

### Community 86 - "UploadState"
Cohesion: 0.33
Nodes (6): UploadState, DONE, FAILED, PENDING, REDACTED, UPLOADING

### Community 87 - "MegaLocDescriptor"
Cohesion: 0.14
Nodes (11): available(), best_device(), MegaLocConfig, MegaLocDescriptor, ndarray, MegaLoc — the production global descriptor. DINOv2-base with a SALAD…, Resize, scale to [0, 1], and normalise. Batched to amortise the transfer., Describe several frames at once. The only sensible way to index a survey pass. (+3 more)

### Community 88 - "phone.py"
Cohesion: 0.13
Nodes (22): ImageFormat, Rough encoded size at the default quality. Conservative on purpose., _cell_for(), default_sources(), ingest(), IngestReport, photos_library_readable(), Path (+14 more)

### Community 89 - "mapping/__init__.py"
Cohesion: 0.18
Nodes (7): 3D mapping accuracy: anchoring, metric scale, and the confidence model., PnpResult, ndarray, Candidates near ``(lat, lon)``, ranked by descriptor similarity. ``radius_m``…, RetrievalHit, Metric scale recovery — the load-bearing module. Monocular structure-from-…, ScaleSource

### Community 90 - "deploy.sh"
Cohesion: 0.60
Nodes (4): die(), PATH, say(), deploy.sh script

### Community 92 - "Mesh"
Cohesion: 0.14
Nodes (14): build_dome_field(), Mesh, Truncated-dome detectable warning field. Domes are 0.9 in across and 0.2 in…, A triangle mesh in a local frame: +x along the kerb, +y into the sidewalk, +z…, main(), Generate a corridor: meshes for the renderer, ground truth for the checker.…, Path, Wavefront OBJ export. OBJ rather than a CARLA-native format on purpose: CARLA… (+6 more)

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

### Community 104 - "ScaleObservation"
Cohesion: 0.24
Nodes (5): Median-absolute-deviation rejection. MAD rather than a standard-deviation rule…, One estimate of the metric scale factor, with its uncertainty. ``scale``…, ScaleObservation, parametrize, TestScaleObservation

### Community 105 - "ScaleEstimate"
Cohesion: 0.20
Nodes (5): Metric error contributed by scale uncertainty alone at a given range. Scale…, Range beyond which scale uncertainty alone breaches a tolerance., A fused scale, and everything needed to decide whether to trust it., Whether the sources agree within their stated uncertainties., ScaleEstimate

### Community 106 - "main"
Cohesion: 0.13
Nodes (21): _dedupe_sequences(), _license_rows(), main(), _observation(), Path, _rows(), _sequence(), _summary() (+13 more)

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

### Community 114 - "12 · Installing it, and what the shutter refuses"
Cohesion: 0.33
Nodes (5): 12 · Installing it, and what the shutter refuses, A frame off the narrow lens, A frame with no position, The shutter refuses two things, What a "download" is here

### Community 116 - "smc/__init__.py"
Cohesion: 0.32
Nodes (4): Spatial Mapping Crowdsource., Image retrieval — finding which captures show the same place. Step 4 of the…, Tests for pose geometry, retrieval, and the anchoring pipeline. Pose recovery…, Tests for real feature detection and matching.

### Community 117 - "CrossSection"
Cohesion: 0.25
Nodes (5): CrossSection, KerbMeasurement, Everything measurable at one place along the kerb., Whether the measurement sits clear of its bucket edges by more than its sigma., test_metric_cross_section_promotes_to_measured_surface_rows()

### Community 125 - "test_mapping.py"
Cohesion: 0.33
Nodes (4): disagreement_flag(), Flag a conflict between a measurement and a reference, keeping the measurement.…, Tests for metric scale and the confidence model., TestDisagreement

### Community 126 - "from_stereo_baseline"
Cohesion: 0.38
Nodes (4): from_stereo_baseline(), Scale from a rigid stereo pair of known separation. The vehicle rig's anchor., Scale error is multiplicative, so it decides how far Tier B can reach., TestScaleReach

### Community 128 - "CV/Depth Storage"
Cohesion: 0.50
Nodes (3): CV/Depth Storage, Promotion Path, Provenance

### Community 130 - "gaussian_radius_m"
Cohesion: 0.50
Nodes (4): gaussian_radius_m(), haversine_m(), Great-circle distance over long ranges. Retained for distances where earth…, Gaussian radius of curvature at a latitude: sqrt(M*N). The sphere radius that…

## Knowledge Gaps
- **205 isolated node(s):** `EMPTY`, `COMPLETE`, `PARTIAL`, `DEFERRED`, `FAILED` (+200 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **19 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `intrinsics()` connect `pipeline.py` to `Pose`, `load_photo`, `photobank.py`, `mapping/__init__.py`, `capture.py`?**
  _High betweenness centrality (0.032) - this node is a cross-community bridge._
- **Why does `build_corridor()` connect `world.py` to `StreetSegment`, `distributions.py`, `capture.py`, `pipeline.py`, `FeatureConfig`, `geometry.py`, `photobank.py`, `calibrate.py`, `DriveConfig`, `Mesh`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **Why does `content_id()` connect `LocalFrameStore` to `test_phone_pipeline.py`, `LocalPhotoJournal`, `capture.py`, `photobank.py`?**
  _High betweenness centrality (0.021) - this node is a cross-community bridge._
- **Are the 5 inferred relationships involving `LocalPhotoJournal` (e.g. with `ingest()` and `run_batch()`) actually correct?**
  _`LocalPhotoJournal` has 5 INFERRED edges - model-reasoned connections that need verification._
- **Are the 15 inferred relationships involving `Pose` (e.g. with `ContributorFrame` and `pose_at_station()`) actually correct?**
  _`Pose` has 15 INFERRED edges - model-reasoned connections that need verification._
- **Are the 7 inferred relationships involving `LocalFrameStore` (e.g. with `contributor_pass()` and `bank_summary()`) actually correct?**
  _`LocalFrameStore` has 7 INFERRED edges - model-reasoned connections that need verification._
- **Are the 8 inferred relationships involving `ReferenceFrame` (e.g. with `AnchoringPipeline` and `FeatureMatcher`) actually correct?**
  _`ReferenceFrame` has 8 INFERRED edges - model-reasoned connections that need verification._