# Graph Report - spatial-mapping-crowdsource  (2026-09-01)

## Corpus Check
- 118 files · ~3,246,026 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2063 nodes · 4101 edges · 116 communities (105 shown, 11 thin omitted)
- Extraction: 93% EXTRACTED · 7% INFERRED · 0% AMBIGUOUS · INFERRED: 275 edges (avg confidence: 0.94)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `64ad5d68`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- ScaleEstimator
- MegaLocDescriptor
- LocalFrameStore
- StreetSegment
- DescriptorIndex
- photobank.py
- PhotoJournal
- split_kerb_planes
- LocalPhotoJournal
- distributions.py
- CompressionProfile
- TriggerEngine
- RenderResult
- TestKeylessAdapters
- providers.py
- ScaleObservation
- PanoramaxImagery
- FeatureConfig
- build_destination
- affine.py
- measure_cross_section
- world.py
- pipeline.py
- credentials.py
- calibrate.py
- 3. Layer C — Fusion engine
- TriggerEngine
- StereoRig
- RigConfig
- ConfidenceModel
- capture.py
- curate
- TestProviderSelection
- TestVaryingPace
- cross_section_at
- journal.py
- trigger.py
- GnssSimulator
- Camera-Only Fusion Mapping Network — Technical Re-Spec
- run_batch
- Path
- daily.py
- test_distributions.py
- DriveConfig
- run_capture_set.py
- Part B — Features still needing code
- Capture Rig v1 (Vehicle) & the Simulation Stack
- buildings.py
- geo.py
- Pose
- Settings
- Mesh
- build_corridor
- GroundTruthFact
- load_photo
- seeding.py
- 2. Published prior art — the numbers that reset the targets
- UploadQueue.kt
- CoverageIndex
- AnchoringPipeline
- ransac_pnp
- GlassesSession.kt
- Suppression
- Build Order — Concept to Production
- audit
- scenario.py
- TestFullStack
- TriggerEngine
- MapillaryImagery
- anchoring.py
- AnchorImagerySource
- manifest.json
- Measurement Extraction, Street Overlay & Full-Stack Results
- ReferenceFrame
- Production Review — 2026-08-23
- geometry.py
- Kerbside
- test_simulation.py
- station_grid
- Glasses System — Capture, Transfer, Accuracy
- Supabase storage
- project
- MotionState
- Spatial Mapping Crowdsource
- CARLA Harness
- assess.py
- UploadState
- textured
- mapping/__init__.py
- to_world_facts
- deploy.sh
- CaptureSession
- LevelChange
- BatchScheduler
- check_secrets.sh
- build_landing.py
- build_app.py
- build_site.py
- make_gallery.py
- smc
- The ultrawide result — 2026-08-30
- .match
- CaptureSettings
- build_segment_mesh
- assess
- CLAUDE.md
- retrieval.py
- 20260902T023431Z/manifest.json
- SidewalkSegment
- archive
- FeatureMatcher
- rotation_from_rotvec
- disagreement_flag
- .quality

## God Nodes (most connected - your core abstractions)
1. `LocalPhotoJournal` - 41 edges
2. `Pose` - 41 edges
3. `build_corridor()` - 30 edges
4. `LocalFrameStore` - 30 edges
5. `ReferenceFrame` - 30 edges
6. `FeatureConfig` - 29 edges
7. `RigConfig` - 27 edges
8. `detect()` - 26 edges
9. `run_batch()` - 24 edges
10. `load_photo()` - 24 edges

## Surprising Connections (you probably didn't know these)
- `TestProviderSelection` --uses--> `AdapterUnavailable`  [INFERRED]
  tests/test_adapters.py → src/smc/adapters/base.py
- `fetch_streets()` --uses--> `BoundingBox`  [INFERRED]
  tools/run_capture_set.py → src/smc/adapters/free.py
- `fetch_streets()` --uses--> `OverpassClient`  [INFERRED]
  tools/run_capture_set.py → src/smc/adapters/free.py
- `main()` --uses--> `PanoramaxImagery`  [INFERRED]
  tools/build_map_data.py → src/smc/adapters/panoramax.py
- `TestProviderSelection` --uses--> `MapillaryImagery`  [INFERRED]
  tests/test_adapters.py → src/smc/adapters/providers.py

## Import Cycles
- None detected.

## Communities (116 total, 11 thin omitted)

### Community 0 - "ScaleEstimator"
Cohesion: 0.16
Nodes (14): from_camera_height(), from_known_object(), from_metric_depth(), from_stereo_baseline(), Robust inverse-variance fusion of scale observations., Scale from a rigid stereo pair of known separation. The vehicle rig's anchor., Scale from the camera's height above the fitted ground plane. The wearer's…, Scale from an object of standard dimensions — a curb face, a dome field, a… (+6 more)

### Community 1 - "MegaLocDescriptor"
Cohesion: 0.06
Nodes (31): RuntimeError, assess_people(), _cascade(), detect_people(), Detection, PeopleAssessment, PeopleConfig, _prepare() (+23 more)

### Community 2 - "LocalFrameStore"
Cohesion: 0.08
Nodes (20): Capture ingest: the frame store and the simulated capture run., content_id(), FrameRecord, FrameStore, LocalFrameStore, object_store_uri(), datetime, Path (+12 more)

### Community 3 - "StreetSegment"
Cohesion: 0.06
Nodes (22): Street-map overlay: putting captures and facts onto a flat map., corridor_street_map(), MapFrame, ndarray, Lateral offset of the kerb line from the centreline, signed by side. The hint…, A street-aligned basis: along the kerb, across the footway, up. Measurements…, ENU points into the street frame: +x along, +y across, +z up., Where a pose sits on the street network. (+14 more)

### Community 4 - "DescriptorIndex"
Cohesion: 0.15
Nodes (7): DescriptorIndex, ndarray, Candidates near ``(lat, lon)``, ranked by descriptor similarity. ``radius_m``…, Search radius that will contain the true position with high probability., Geographic prefilter, then cosine similarity over descriptors., RetrievalHit, TestRetrieval

### Community 5 - "photobank.py"
Cohesion: 0.08
Nodes (28): bank_summary(), BankFrame, build_photo_bank(), _decode_png(), export_contact_sheet(), GlassesProfile, datetime, ndarray (+20 more)

### Community 6 - "PhotoJournal"
Cohesion: 0.07
Nodes (24): Assessor, BatchOutcome, COMPLETE, DEFERRED, EMPTY, FAILED, PARTIAL, BatchPolicy (+16 more)

### Community 7 - "split_kerb_planes"
Cohesion: 0.06
Nodes (29): KerbMeasurement, Whether the measurement sits clear of its bucket edges by more than its sigma., Whether the measurement can distinguish compliant from not. Almost always false…, SidewalkMeasurement, Measurement extraction — turning a reconstruction into world-facts., estimate_kerb_offset(), fit_plane_ransac(), KerbPlanes (+21 more)

### Community 8 - "LocalPhotoJournal"
Cohesion: 0.13
Nodes (8): LocalPhotoJournal, Path, Store a frame. Idempotent: re-adding the same bytes replaces the row, not the…, Update metadata without touching pixels., Overwrite the pixels in place, keeping the identity. Used by compression. The…, Delete pixels and rows. The only method that removes data. Returns how many…, Filesystem plus SQLite. The phone's working set., _to_signed()

### Community 9 - "distributions.py"
Cohesion: 0.12
Nodes (32): BlockFace, DrivewayApron, Obstruction, Hierarchical sampling of pedestrian right-of-way geometry. Sampling is…, Latent state shared by everything on one block face., Sample the latent state of one block face., Sample one run of sidewalk, conditioned on its block face., Displacement at panel joints, with root-heave clustering. Most joints are flat.… (+24 more)

### Community 10 - "CompressionProfile"
Cohesion: 0.11
Nodes (16): CompressionPlan, CompressionProfile, fits_budget(), frames_within_budget(), plan_compression(), Estimate the daily batch size before encoding any of it. Worth knowing in…, How many frames fit in a budget. Sets the curator's daily cap on a metered plan., What to ask the platform encoder for. (+8 more)

### Community 11 - "TriggerEngine"
Cohesion: 0.12
Nodes (18): MotionState, MotionState, Straight from the OS activity classifier — not reimplemented. iOS…, ctx(), CaptureContext, parametrize, Suppression, Tests for the capture trigger. (+10 more)

### Community 12 - "RenderResult"
Cohesion: 0.10
Nodes (21): Software rendering — turning simulated geometry into actual images., ndarray, A z-buffered triangle rasteriser. CARLA renders far better images than this,…, Rasterise triangles into an image, depth buffer and world-position buffer.…, Split triangles until no edge exceeds ``max_edge_m``. Necessary because the…, Subdivide a uniformly coloured batch, keeping colours aligned., A rendered view and the buffers that make it useful as training or test data., Fraction of the frame showing geometry rather than sky. (+13 more)

### Community 13 - "TestKeylessAdapters"
Cohesion: 0.05
Nodes (33): BoundingBox, _get(), NominatimClient, NtripMountpoint, OpenFreeMapTiles, OverpassClient, OvertureClient, ProjectSidewalkClient (+25 more)

### Community 14 - "providers.py"
Cohesion: 0.18
Nodes (11): AdapterUnavailable, LocalizationResult, Provider-agnostic interfaces. Each capability is a Protocol with at least two…, Raised when an adapter is selected but its credential or dependency is missing., A refined camera pose from a visual positioning service., _require_env(), ArCoreGeospatial, OwnedAnchoring (+3 more)

### Community 15 - "ScaleObservation"
Cohesion: 0.12
Nodes (11): from_gnss_baseline(), Median-absolute-deviation rejection. MAD rather than a standard-deviation rule…, Scale from distance travelled between two fixes. Two fixes with independent…, One estimate of the metric scale factor, with its uncertainty. ``scale``…, ScaleObservation, parametrize, Tests for metric scale and the confidence model., With two observations there is no consensus to reject against. (+3 more)

### Community 16 - "PanoramaxImagery"
Cohesion: 0.11
Nodes (17): focal_px_from_interior(), PanoramaxImage, PanoramaxImagery, _parse_feature(), Any, datetime, Panoramax — the default anchor-imagery source. Panoramax is street-level…, Captures near a point, freshest-first. (+9 more)

### Community 17 - "FeatureConfig"
Cohesion: 0.13
Nodes (18): detect(), Detector, FeatureConfig, Features, _geometric_filter(), _grayscale(), match_features(), match_statistics() (+10 more)

### Community 18 - "build_destination"
Cohesion: 0.14
Nodes (10): build_destination(), GcsConfig, GcsDestination, Verify credentials and bucket before a batch depends on them. Worth running at…, Build a destination from a URL or a path. ``gs://bucket/prefix`` gives GCS;…, Parse ``gs://bucket/optional/prefix``., Google Cloud Storage. Authentication is Application Default Credentials —…, User ADC has no billing project; one must be attached or some APIs refuse. (+2 more)

### Community 19 - "affine.py"
Cohesion: 0.16
Nodes (17): AffineView, _compose(), default_views(), detect_multi_view(), _invert(), ndarray, Affine view simulation — bridging the vantage gap. The measured failure this…, Compose two 2x3 affines: apply ``first``, then ``second``. (+9 more)

### Community 20 - "measure_cross_section"
Cohesion: 0.24
Nodes (9): measure_cross_section(), MeasurementConfig, ndarray, Measure kerb and footway from the reconstructed points around one station.…, kerb_cloud(), ndarray, The arithmetic behind Tier C: a 1.5% rise over 1.6 m is inside the fit noise., A synthetic road-plus-footway cross-section with known geometry. (+1 more)

### Community 21 - "world.py"
Cohesion: 0.08
Nodes (30): BlockProfile, CurbHeightClass, CurbHeightProfile, RampProfile, Sampling profiles for pedestrian right-of-way geometry. A simulation whose…, Sidewalk running surface: width, cross slope, condition, and joint displacement., Block-face level structure: construction era and build quality., The buckets the product is graded on (respec 8.3, Tier B). (+22 more)

### Community 22 - "pipeline.py"
Cohesion: 0.11
Nodes (17): BaseModel, model_validator, Record that this measurement disagrees with a reference, keeping the…, One assertion about one place, with everything needed to judge whether to trust…, WorldFact, FrameOutcome, _intrinsics_for(), PipelineResult (+9 more)

### Community 23 - "credentials.py"
Cohesion: 0.11
Nodes (14): Capability, check(), Credential, CredentialReport, providers_for(), Every external service this system can talk to, and what it needs to…, What an adapter provides. One capability, many possible providers., One secret or setting the operator has to supply. (+6 more)

### Community 24 - "calibrate.py"
Cohesion: 0.11
Nodes (32): discover(), evaluate_directory(), evaluate_pair(), group_by_position(), load_image(), main(), ndarray, Path (+24 more)

### Community 25 - "3. Layer C — Fusion engine"
Cohesion: 0.11
Nodes (18): 0.1 The entire Google stack is off-limits for this business, 0.2 ODbL share-alike is survivable, but only by design, 0.3 The public segmentation datasets cannot train a commercial model, 0. Legal ground rules — read before choosing anything, 1. Layer A — Smart capture, 2. Layer B — Compression & upload, 3.1 Anchor reference data (replaces Google), 3.2 Image retrieval / place recognition (cross-contributor association, Step 4) (+10 more)

### Community 26 - "TriggerEngine"
Cohesion: 0.13
Nodes (11): Layer A — deciding when to open the shutter., CaptureDecision, Stateful evaluator. One per capture session. Ordering is load-bearing. Device-…, Why frames were skipped, over the session. The field diagnostic., Dead-reckon distance from speed. Speed is used rather than successive GNSS…, Why a frame was not taken. Ordered by how early the check runs., Thresholds. Deliberately explicit — every one of these is a battery/coverage…, Suppression (+3 more)

### Community 27 - "StereoRig"
Cohesion: 0.15
Nodes (10): CameraSpec, default_rig(), Sensor rig definitions. The rig mirrors the physical Tier 2 vehicle rig in…, Intrinsics and mounting for one camera, matching Arducam AR0234 on the vehicle…, Pinhole focal length in pixels — needed by every metric-depth conversion., A synchronised pair on a rigid baseline — the rig's source of metric scale.…, Range beyond which stereo can no longer meet a depth tolerance., StereoRig (+2 more)

### Community 28 - "RigConfig"
Cohesion: 0.14
Nodes (18): pose_at_station(), ndarray, Camera and driving parameters for a pass., The camera pose at a station along the corridor., Render once per station, reusing the flattened scene across the whole pass., _render_stations(), RigConfig, corridor_triangles() (+10 more)

### Community 29 - "ConfidenceModel"
Cohesion: 0.14
Nodes (12): Provenance, ConfidenceModel, FusedValue, Observation, datetime, Confidence, corroboration, and freshness decay. The promotion rule from the re-…, Saturating in the number of independent contributors. Diminishing returns are…, One contributor's measurement of one fact. (+4 more)

### Community 30 - "capture.py"
Cohesion: 0.10
Nodes (21): Runtime configuration, loaded from the environment and an optional local file.…, enu_to_geodetic(), Local east/north offsets to (lat, lon)., contributor_pass(), ContributorFrame, datetime, Simulated capture runs. Two kinds of pass, mirroring the two hardware tiers: *…, Drive a monocular contributor down the corridor, through the real capture… (+13 more)

### Community 31 - "curate"
Cohesion: 0.20
Nodes (10): curate(), CurationConfig, Decide the day's batch. Order matters and is not arbitrary. Quality gates run…, Thresholds. Every one is a trade between upload cost and coverage., blurred(), ndarray, Tests for phone-side photo handling, curation, and compression., An absolute threshold would drop a whole batch of a low-texture scene. (+2 more)

### Community 32 - "TestProviderSelection"
Cohesion: 0.25
Nodes (7): build_anchor_imagery(), build_visual_positioning(), ProviderChoice, Construct an anchor-imagery provider. ``allow_internal_only`` must be passed…, MonkeyPatch, It is a platform dependency, not a licensing upgrade: same CC BY-SA imagery., TestProviderSelection

### Community 33 - "TestVaryingPace"
Cohesion: 0.12
Nodes (14): GaitConfig, GaitSimulator, ndarray, Realistic walking pace. Nobody walks at a constant speed. Real pedestrian pace…, Pedestrian pace parameters. Defaults are ordinary adult walking., Generates a speed trace for one walk., Advance and return the current speed., A full speed trace, for analysis and tests. (+6 more)

### Community 34 - "cross_section_at"
Cohesion: 0.22
Nodes (6): cross_section_at(), CrossSection, Lateral profile at one station, as (offset from kerb line, height) pairs.…, Height of the curb face — the rise between the gutter and the top of the curb., Evaluate the lateral profile at one station. ``ramps`` are ``(centre station,…, TestCrossSection

### Community 35 - "journal.py"
Cohesion: 0.15
Nodes (12): Row, Destination, Protocol, Where the nightly batch goes. Every destination must **confirm receipt**, not…, EntryState, JournalEntry, mark(), datetime (+4 more)

### Community 36 - "trigger.py"
Cohesion: 0.16
Nodes (11): baseline_for_depth_tolerance_m(), overlap_fraction(), perceptual_distance(), The capture trigger. Never stream. Open the shutter only when a frame is likely…, Normalised Hamming distance between two perceptual hashes. A hash rather than a…, Fraction of the frame footprint shared by consecutive captures. Multi-view…, Baseline needed to resolve depth at ``range_m`` to ``tolerance_m``. The same…, Capture rate needed to hold a minimum overlap. The inverse of… (+3 more)

### Community 37 - "GnssSimulator"
Cohesion: 0.11
Nodes (15): Environment, GnssErrorModel, GnssSimulator, mean_horizontal_deviation(), mix_mean_deviation(), ndarray, GNSS error simulation. CARLA's built-in GNSS sensor applies independent…, Advance by ``dt_s`` and return the ENU error vector in metres. (+7 more)

### Community 38 - "Camera-Only Fusion Mapping Network — Technical Re-Spec"
Cohesion: 0.11
Nodes (18): 0. The one-paragraph version, 10. Deferred (bracketed for this version, not solved), 11. Competitive reality to build against, 1. What each layer does — and who builds it, 2. Layer A — Smart Capture ("aware software"), 3. Layer B — Compression & Upload (use the commodity, don't build it), 4. Layer C — The Fusion Engine (your only real IP), 5. Layer D — Distribution (+10 more)

### Community 39 - "run_batch"
Cohesion: 0.17
Nodes (10): BatchPolicy, BatchReport, Run one night's batch., run_batch(), DirectoryDestination, JournalEntry, Path, Write to a folder — a synced drive, an external disk, a mount point. Confirmed… (+2 more)

### Community 40 - "Path"
Cohesion: 0.18
Nodes (13): Find photographs, skipping paths the OS refuses., scan(), new_entry(), Build an entry for a payload, with the content hash as its identity., photo(), png_bytes(), Path, Tests for the journal, the nightly batch, and the privacy filter. (+5 more)

### Community 41 - "daily.py"
Cohesion: 0.11
Nodes (26): ImageFormat, Compression policy for the daily batch. No codec is written here and none…, Rough encoded size at the default quality. Conservative on purpose., _cell_for(), default_sources(), ingest(), IngestReport, photos_library_readable() (+18 more)

### Community 42 - "test_distributions.py"
Cohesion: 0.07
Nodes (13): _curb_fields(), _noncompliance_rate(), Tests for the right-of-way sampling model. These assert the properties the…, Tier C exists because these are rare and small. Both properties are asserted., Recall on 'no ramp here' is unmeasurable if the sim never omits one., The corroboration claim is untestable if a repeat pass sees different geometry., A high-quality block face must depart from the standard less often than a poor…, TestCorners (+5 more)

### Community 43 - "DriveConfig"
Cohesion: 0.18
Nodes (11): baseline_between_frames_m(), DriveConfig, plan_capture_stations(), Forward distance between consecutive captures — the multi-view triangulation…, Generate the capture record for a drive without rendering. Produces exactly the…, Stations at which frames will be captured, given speed and capture rate. Pure…, simulate_drive(), Why rigid stereo is for scale and motion stereo is for precision. (+3 more)

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

### Community 48 - "geo.py"
Cohesion: 0.15
Nodes (13): The same statistics on simulated frames, for comparison. Printed beside the…, _render_baseline(), distance_m(), gaussian_radius_m(), geodetic_to_enu(), haversine_m(), Origin, Local tangent-plane geodesy. The simulator works in metres on a flat local… (+5 more)

### Community 49 - "Pose"
Cohesion: 0.10
Nodes (13): Pose, ndarray, Camera pose geometry: projection, PnP, and robust estimation. This is the…, Camera position in world coordinates. Not ``translation``., World points to camera frame. Accepts (N, 3)., Gauss-Newton refinement of reprojection error, Huber-weighted. Huber rather…, Inverse of :func:`rotation_from_rotvec`, stable at 0 and pi., World-to-camera rigid transform. (+5 more)

### Community 50 - "Settings"
Cohesion: 0.18
Nodes (9): load_env_file(), Path, Read ``KEY=value`` lines into the environment. Returns what it set., Render a config value safely for logs., Everything the pipeline reads from the environment., redact(), Settings, MonkeyPatch (+1 more)

### Community 51 - "Mesh"
Cohesion: 0.18
Nodes (11): Mesh, A triangle mesh in a local frame: +x along the kerb, +y into the sidewalk, +z…, main(), Generate a corridor: meshes for the renderer, ground truth for the checker.…, Path, Wavefront OBJ export. OBJ rather than a CARLA-native format on purpose: CARLA…, Write meshes to a single OBJ, one named group per mesh. OBJ vertex indices are…, write_obj() (+3 more)

### Community 52 - "build_corridor"
Cohesion: 0.12
Nodes (13): build_corridor(), Corridor, CorridorSegment, export_ground_truth(), PlacedRamp, Lay out block faces along a corridor, with a corner at each block boundary., The exact answer key for the corridor., A simulated stretch of street with everything on it. (+5 more)

### Community 53 - "GroundTruthFact"
Cohesion: 0.17
Nodes (6): GroundTruthFact, An exact value at an exact place, from simulation, survey, or municipal record., Signed error for numeric facts; ``None`` for categorical ones (use ``matches``)., Exact match for categorical and boolean facts., Truth is a different type on purpose; it must not be confusable with a served…, TestFactsAndTruthAreDistinct

### Community 54 - "load_photo"
Cohesion: 0.15
Nodes (13): load_photo(), _open(), PhotoMeta, ndarray, Path, Reading real photographs, including iPhone HEIC. Three things routinely go…, Load a photograph as RGB, with EXIF orientation applied.…, Pull the few EXIF fields that matter. Absent EXIF is normal, not an error. (+5 more)

### Community 55 - "seeding.py"
Cohesion: 0.08
Nodes (32): Drive the RTK rig down the corridor at fixed spacing. Fixed spacing rather than…, survey_pass(), main(), Namespace, Generate seed data and run the end-to-end simulation. python -m smc.ingest seed…, _seed(), build_descriptor(), FrameDescriptor (+24 more)

### Community 56 - "2. Published prior art — the numbers that reset the targets"
Cohesion: 0.14
Nodes (13): 1. Direct competitors, 2. Published prior art — the numbers that reset the targets, 3. What this means for targeting, Bee Maps (formerly Hivemapper) — the closest *business model* comparable, Commercial targeting, Comparables, Prior Art & What to Target, MapAnything (Carnot et al., arXiv 2509.14839, v3 Jul 2026), Niantic Spatial — the incumbent on *localization* (+5 more)

### Community 57 - "UploadQueue.kt"
Cohesion: 0.17
Nodes (8): Frame, BlobUploader, ByteArray, QueuedFrame, Redactor, TransferPolicy, UploadQueue, Frame

### Community 58 - "CoverageIndex"
Cohesion: 0.19
Nodes (6): CoverageCell, CoverageIndex, Server-pushed coverage state for one H3 cell. The novelty trigger cannot be…, Local mirror of the server's coverage bitmap. Small enough to hold a city at…, Failing safe costs one upload; failing the other way costs weeks of coverage., TestCoverageIndex

### Community 59 - "AnchoringPipeline"
Cohesion: 0.17
Nodes (9): AnchoringConfig, AnchoringPipeline, Anchor one capture, or return ``None`` if it cannot be anchored confidently.…, Inverse-variance combination of the references' own uncertainties. Not the…, Compass heading of the camera's optical axis, degrees clockwise from north. The…, Retrieval, matching, PnP, and the conversion back to latitude and longitude., A query cannot be better anchored than the references it stood on., Perceptual aliasing in repetitive streetscapes is the normal cause. (+1 more)

### Community 60 - "ransac_pnp"
Cohesion: 0.16
Nodes (11): _iterations_needed(), PnpResult, ransac_pnp(), Linear pose from >= 6 correspondences (Direct Linear Transform). Fast,…, How many RANSAC samples are needed to see one all-inlier set, with…, Robust pose from noisy, partly wrong correspondences. Returns ``None`` rather…, solve_pnp_dlt(), ndarray (+3 more)

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

### Community 65 - "scenario.py"
Cohesion: 0.16
Nodes (12): CaptureFrame, carla_available(), Any, Path, CARLA runtime. ``carla`` is imported lazily and the module is usable without…, Write the ingest manifest — engine-visible fields only. The true pose is…, Run the drive in CARLA and write images. Requires a running CARLA server and…, Whether the CARLA Python API can be imported in this interpreter. (+4 more)

### Community 66 - "TestFullStack"
Cohesion: 0.15
Nodes (4): The rule most likely to be lost between layers. Checked at the far end., A loose bound on purpose. With strict matching only a handful of frames anchor…, Real feature matching, no oracle. Yield is materially below 1.0 and that is the…, TestFullStack

### Community 67 - "TriggerEngine"
Cohesion: 0.24
Nodes (5): CaptureDecision, CaptureContext, Suppression, TriggerEngine, TriggerConfig

### Community 68 - "MapillaryImagery"
Cohesion: 0.15
Nodes (10): ImageRef, A street-level image available for anchoring., MapillaryImagery, Download one image. Transient: used for anchoring, then discarded., Google Street View Static API — internal build only. Maps Platform terms forbid…, Mapillary API v4 — kept as a fallback, no longer the default. Imagery is CC BY-…, The query this adapter would issue. Separated so it can be asserted in tests., Fetch image metadata near a point. Returns metadata only. The imagery itself is… (+2 more)

### Community 69 - "anchoring.py"
Cohesion: 0.17
Nodes (9): AnchorResult, The anchoring stack — Step 3 of the fusion engine. Rough GPS puts a capture on…, Whether this pose is good enough to carry coarse geometry (re-spec 8.3 Tier B)., pose_covariance(), position_sigma_m(), 6x6 covariance of the pose parameters (rotvec, translation). Linearised at the…, Horizontal 1-sigma position uncertainty from a pose covariance. Uses the…, Tests for pose geometry, retrieval, and the anchoring pipeline. Pose recovery… (+1 more)

### Community 70 - "AnchorImagerySource"
Cohesion: 0.20
Nodes (7): AnchorImagerySource, MetricDepthSource, Protocol, Street-level imagery to anchor captures against., Refines a rough position using a camera frame. The load-bearing accuracy step., Per-pixel metric depth. Feeds the scale estimator., VisualPositioningSource

### Community 71 - "manifest.json"
Cohesion: 0.22
Nodes (8): count, created_at, max_width, mode, quality, records, skipped, source

### Community 72 - "Measurement Extraction, Street Overlay & Full-Stack Results"
Cohesion: 0.22
Nodes (8): 1. Full-stack run, 2. Measurement extraction, 3. Street overlay, 4. Varying pace — the crucial verification, 5. Photo bank at delivered resolution, 6. Bugs found and fixed in this pass, 7. What this does not show, Measurement Extraction, Street Overlay & Full-Stack Results

### Community 73 - "ReferenceFrame"
Cohesion: 0.16
Nodes (8): OpenCVMatcher, A real :class:`~smc.mapping.anchoring.FeatureMatcher`. Holds the query image's…, Pixel coordinates the match indices refer to., An already-anchored frame, with the 3D structure it observed. ``points_world``…, ReferenceFrame, _IdentityMatcher, An oracle-seeded frame cannot be matched against; skipping beats a silent zero., TestOpenCVMatcher

### Community 74 - "Production Review — 2026-08-23"
Cohesion: 0.22
Nodes (8): 1. The vantage break — resolved, with a caveat that only photographs can close, 2. The oracle is no longer in any default path, 3. Learned retrieval — still not present, and here is what it needs, 4. Integrations, 5. Stale documentation — corrected, 6. GCS destination — implemented, 7. A bug found while fixing these, Production Review — 2026-08-23

### Community 75 - "geometry.py"
Cohesion: 0.10
Nodes (12): CurbRamp, A curb ramp with the geometry the robot API is asked to report., build_dome_field(), Parametric geometry for sampled right-of-way features. CARLA cannot supply…, Truncated-dome detectable warning field. Domes are 0.9 in across and 0.2 in…, inches(), ratio_from_slope(), Unit conversion. Every accessibility standard this project is measured against… (+4 more)

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

### Community 85 - "assess.py"
Cohesion: 0.18
Nodes (8): Assessment, CurationResult, Deciding which captures are worth keeping, on the phone, before anything is…, Interleave by cell so a budget cut removes depth, not coverage., What one frame scored, and what is to be done with it., _round_robin_by_cell(), Verdict, On-device curation and compression.

### Community 86 - "UploadState"
Cohesion: 0.33
Nodes (6): UploadState, DONE, FAILED, PENDING, REDACTED, UPLOADING

### Community 87 - "textured"
Cohesion: 0.28
Nodes (8): Write a JPEG carrying iPhone-like EXIF, for testing the loader without a phone.…, write_synthetic_iphone_photo(), Path, An iPhone shoots eight times the pixels the toolkit hands over., A photo-like frame: low-frequency structure plus fine texture. Pure noise is…, The failure that looks like a broken matcher and is a broken loader., TestPhotoLoading, textured()

### Community 88 - "mapping/__init__.py"
Cohesion: 0.15
Nodes (8): 3D mapping accuracy: anchoring, metric scale, and the confidence model., Metric scale recovery — the load-bearing module. Monocular structure-from-…, Metric error contributed by scale uncertainty alone at a given range. Scale…, Range beyond which scale uncertainty alone breaches a tolerance., A fused scale, and everything needed to decide whether to trust it., Whether the sources agree within their stated uncertainties., ScaleEstimate, ScaleSource

### Community 89 - "to_world_facts"
Cohesion: 0.23
Nodes (6): CrossSection, datetime, Everything measurable at one place along the kerb., Serialise a measured cross-section into servable facts. Provenance is decided…, to_world_facts(), TestFactEmission

### Community 90 - "deploy.sh"
Cohesion: 0.60
Nodes (4): die(), PATH, say(), deploy.sh script

### Community 95 - "build_landing.py"
Cohesion: 0.29
Nodes (5): encode(), js_string(), Path, Assemble the landing page: demo frames plus the whole app, inlined., JSON-encode for embedding inside a <script> block. json.dumps escapes quotes…

### Community 102 - "The ultrawide result — 2026-08-30"
Cohesion: 0.40
Nodes (4): Reproducing, The ultrawide result — 2026-08-30, What it does not settle, What this settles

### Community 103 - ".match"
Cohesion: 0.40
Nodes (3): ndarray, Return indices into ``query_keypoints`` and into the reference's points.…, Pixel coordinates the match indices refer to.

### Community 105 - "build_segment_mesh"
Cohesion: 0.19
Nodes (9): build_segment_mesh(), measure_curb_height(), Loft a segment's cross-sections into a triangle mesh., Recover curb height from mesh vertices — the inverse of the generator. Used by…, FidelityReport, Whether the rendered geometry actually carries the sampled parameters., Recover curb height from the meshes and compare against what was sampled.…, verify_mesh_fidelity() (+1 more)

### Community 106 - "assess"
Cohesion: 0.23
Nodes (11): assess(), dhash(), hamming(), ndarray, Area-averaged downscale to a fixed size, as grayscale. Averaging, not sampling.…, Variance of the Laplacian, normalised by image contrast. Raw Laplacian variance…, 64-bit difference hash: each bit is one horizontal gradient sign. Robust to…, Score one frame. Cheap enough to run on every capture. (+3 more)

### Community 108 - "retrieval.py"
Cohesion: 0.20
Nodes (6): PairResult, Whether this pair would have produced a pose. Twelve geometrically consistent…, summarise(), Image retrieval — finding which captures show the same place. Step 4 of the…, Tests for real feature detection and matching., TestCalibrationHarness

### Community 109 - "20260902T023431Z/manifest.json"
Cohesion: 0.22
Nodes (8): count, created_at, max_width, mode, quality, records, skipped, source

### Community 110 - "SidewalkSegment"
Cohesion: 0.25
Nodes (5): One run of sidewalk along a block face, with everything on it., Narrowest point — the number a wheelchair or robot actually has to fit through., SidewalkSegment, cumulative_step_at(), Total vertical displacement accumulated by joint steps up to a station. Joint…

### Community 111 - "archive"
Cohesion: 0.57
Nodes (6): archive(), archived_hashes(), digest(), main(), Path, Archive new capture photos into a Git-friendly dataset folder. The default…

### Community 112 - "FeatureMatcher"
Cohesion: 0.33
Nodes (5): FeatureMatcher, ndarray, Protocol, Local feature matching between a query and a reference frame. Production…, Return ``(query_indices, reference_indices)`` of mutual matches.

### Community 113 - "rotation_from_rotvec"
Cohesion: 0.47
Nodes (3): Rodrigues formula. A zero vector gives identity rather than a division by zero., rotation_from_rotvec(), TestRotation

### Community 114 - "disagreement_flag"
Cohesion: 0.50
Nodes (3): disagreement_flag(), Flag a conflict between a measurement and a reference, keeping the measurement.…, TestDisagreement

## Knowledge Gaps
- **176 isolated node(s):** `EMPTY`, `COMPLETE`, `PARTIAL`, `DEFERRED`, `FAILED` (+171 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **11 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `intrinsics()` connect `seeding.py` to `photobank.py`, `Pose`, `load_photo`, `pipeline.py`, `mapping/__init__.py`, `capture.py`?**
  _High betweenness centrality (0.035) - this node is a cross-community bridge._
- **Why does `build_corridor()` connect `build_corridor` to `StreetSegment`, `photobank.py`, `distributions.py`, `build_segment_mesh`, `DriveConfig`, `geo.py`, `Mesh`, `world.py`, `seeding.py`, `calibrate.py`, `RigConfig`, `capture.py`?**
  _High betweenness centrality (0.032) - this node is a cross-community bridge._
- **Why does `TinyImageDescriptor` connect `seeding.py` to `RigConfig`, `pipeline.py`?**
  _High betweenness centrality (0.029) - this node is a cross-community bridge._
- **Are the 5 inferred relationships involving `LocalPhotoJournal` (e.g. with `ingest()` and `run_batch()`) actually correct?**
  _`LocalPhotoJournal` has 5 INFERRED edges - model-reasoned connections that need verification._
- **Are the 15 inferred relationships involving `Pose` (e.g. with `ContributorFrame` and `pose_at_station()`) actually correct?**
  _`Pose` has 15 INFERRED edges - model-reasoned connections that need verification._
- **Are the 7 inferred relationships involving `LocalFrameStore` (e.g. with `contributor_pass()` and `bank_summary()`) actually correct?**
  _`LocalFrameStore` has 7 INFERRED edges - model-reasoned connections that need verification._
- **Are the 8 inferred relationships involving `ReferenceFrame` (e.g. with `AnchoringPipeline` and `FeatureMatcher`) actually correct?**
  _`ReferenceFrame` has 8 INFERRED edges - model-reasoned connections that need verification._