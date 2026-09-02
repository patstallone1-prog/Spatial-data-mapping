# Graph Report - spatial-mapping-crowdsource  (2026-09-01)

## Corpus Check
- 117 files · ~636,726 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2054 nodes · 4093 edges · 108 communities (94 shown, 14 thin omitted)
- Extraction: 93% EXTRACTED · 7% INFERRED · 0% AMBIGUOUS · INFERRED: 275 edges (avg confidence: 0.94)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `fcbea03c`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- ScaleEstimator
- people.py
- LocalFrameStore
- StreetSegment
- ReferenceFrame
- GlassesProfile
- PhotoJournal
- split_kerb_planes
- LocalPhotoJournal
- distributions.py
- CompressionProfile
- TriggerEngine
- RenderResult
- TestKeylessAdapters
- providers.py
- MegaLocDescriptor
- PanoramaxImagery
- FeatureConfig
- test_phone_pipeline.py
- affine.py
- measure_cross_section
- extract.py
- pipeline.py
- credentials.py
- calibrate.py
- 3. Layer C — Fusion engine
- photobank.py
- StereoRig
- RigConfig
- ConfidenceModel
- test_capture_pipeline.py
- curate
- TestProviderSelection
- TestVaryingPace
- geometry.py
- daily.py
- load_image
- GnssSimulator
- Camera-Only Fusion Mapping Network — Technical Re-Spec
- run_batch
- Path
- phone.py
- test_distributions.py
- DriveConfig
- run_capture_set.py
- Part B — Features still needing code
- Capture Rig v1 (Vehicle) & the Simulation Stack
- buildings.py
- ingest/__main__.py
- Pose
- test_geometry.py
- Mesh
- world.py
- WorldFact
- load_photo
- TinyImageDescriptor
- 2. Published prior art — the numbers that reset the targets
- UploadQueue.kt
- CoverageIndex
- AnchoringPipeline
- test_anchoring.py
- GlassesSession.kt
- Suppression
- Build Order — Concept to Production
- audit
- scenario.py
- TestFullStack
- TriggerEngine
- MapillaryImagery
- mapping/__init__.py
- AnchorImagerySource
- manifest.json
- Measurement Extraction, Street Overlay & Full-Stack Results
- OpenCVMatcher
- Production Review — 2026-08-23
- units.py
- Kerbside
- test_simulation.py
- station_grid
- Glasses System — Capture, Transfer, Accuracy
- Supabase storage
- project
- MotionState
- Spatial Mapping Crowdsource
- CARLA Harness
- CrossSection
- UploadState
- TestSidewalkSegment
- export_contact_sheet
- TestFactEmission
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
- KerbMeasurement
- SidewalkMeasurement
- CLAUDE.md

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

## Communities (108 total, 14 thin omitted)

### Community 0 - "ScaleEstimator"
Cohesion: 0.06
Nodes (35): disagreement_flag(), Flag a conflict between a measurement and a reference, keeping the measurement.…, from_camera_height(), from_gnss_baseline(), from_known_object(), from_metric_depth(), from_stereo_baseline(), Metric scale recovery — the load-bearing module. Monocular structure-from-… (+27 more)

### Community 1 - "people.py"
Cohesion: 0.11
Nodes (18): assess_people(), _cascade(), detect_people(), Detection, PeopleAssessment, PeopleConfig, _prepare(), ndarray (+10 more)

### Community 2 - "LocalFrameStore"
Cohesion: 0.06
Nodes (26): load_env_file(), Path, Read ``KEY=value`` lines into the environment. Returns what it set., Render a config value safely for logs., Everything the pipeline reads from the environment., redact(), Settings, Capture ingest: the frame store and the simulated capture run. (+18 more)

### Community 3 - "StreetSegment"
Cohesion: 0.06
Nodes (22): Street-map overlay: putting captures and facts onto a flat map., corridor_street_map(), MapFrame, ndarray, Lateral offset of the kerb line from the centreline, signed by side. The hint…, A street-aligned basis: along the kerb, across the footway, up. Measurements…, ENU points into the street frame: +x along, +y across, +z up., Where a pose sits on the street network. (+14 more)

### Community 4 - "ReferenceFrame"
Cohesion: 0.15
Nodes (7): DescriptorIndex, Search radius that will contain the true position with high probability., An already-anchored frame, with the 3D structure it observed. ``points_world``…, Geographic prefilter, then cosine similarity over descriptors., ReferenceFrame, _IdentityMatcher, TestRetrieval

### Community 5 - "GlassesProfile"
Cohesion: 0.13
Nodes (15): GlassesProfile, Where a walking wearer's camera is, and where it points. A wearer looks roughly…, Delivered camera characteristics for Meta AI glasses via the DAT. ``fov_deg``…, What the hardware captures, for the ratio that matters., wearer_pose(), _intrinsics_for(), ndarray, Per-frame intrinsics, from the capture record where available. (+7 more)

### Community 6 - "PhotoJournal"
Cohesion: 0.07
Nodes (24): Assessor, BatchOutcome, COMPLETE, DEFERRED, EMPTY, FAILED, PARTIAL, BatchPolicy (+16 more)

### Community 7 - "split_kerb_planes"
Cohesion: 0.08
Nodes (22): Measurement extraction — turning a reconstruction into world-facts., estimate_kerb_offset(), fit_plane_ransac(), perpendicular_extent(), Plane, ndarray, Plane fitting for the road and the walking surface. The two planes are the…, Find the lateral position of the kerb line by scanning for the largest height… (+14 more)

### Community 8 - "LocalPhotoJournal"
Cohesion: 0.09
Nodes (17): Row, EntryState, JournalEntry, LocalPhotoJournal, mark(), datetime, Path, The on-device photo journal — a real implementation, not an interface. SQLite… (+9 more)

### Community 9 - "distributions.py"
Cohesion: 0.08
Nodes (43): BlockFace, DrivewayApron, Obstruction, Hierarchical sampling of pedestrian right-of-way geometry. Sampling is…, Latent state shared by everything on one block face., Sample the latent state of one block face., Sample one run of sidewalk, conditioned on its block face., Displacement at panel joints, with root-heave clustering. Most joints are flat.… (+35 more)

### Community 10 - "CompressionProfile"
Cohesion: 0.11
Nodes (17): CompressionPlan, CompressionProfile, fits_budget(), frames_within_budget(), plan_compression(), Compression policy for the daily batch. No codec is written here and none…, Estimate the daily batch size before encoding any of it. Worth knowing in…, How many frames fit in a budget. Sets the curator's daily cap on a metered plan. (+9 more)

### Community 11 - "TriggerEngine"
Cohesion: 0.06
Nodes (29): MotionState, baseline_for_depth_tolerance_m(), overlap_fraction(), perceptual_distance(), Normalised Hamming distance between two perceptual hashes. A hash rather than a…, Fraction of the frame footprint shared by consecutive captures. Multi-view…, Baseline needed to resolve depth at ``range_m`` to ``tolerance_m``. The same…, Capture rate needed to hold a minimum overlap. The inverse of… (+21 more)

### Community 12 - "RenderResult"
Cohesion: 0.12
Nodes (15): ContributorFrame, One stored contributor capture, with the truth kept separate for scoring., Software rendering — turning simulated geometry into actual images., ndarray, Rasterise triangles into an image, depth buffer and world-position buffer.…, A rendered view and the buffers that make it useful as training or test data., Fraction of the frame showing geometry rather than sky., Draw (world_point, pixel) pairs from surfaces actually visible in this view.… (+7 more)

### Community 13 - "TestKeylessAdapters"
Cohesion: 0.05
Nodes (33): BoundingBox, _get(), NominatimClient, NtripMountpoint, OpenFreeMapTiles, OverpassClient, OvertureClient, ProjectSidewalkClient (+25 more)

### Community 14 - "providers.py"
Cohesion: 0.18
Nodes (11): AdapterUnavailable, LocalizationResult, Provider-agnostic interfaces. Each capability is a Protocol with at least two…, Raised when an adapter is selected but its credential or dependency is missing., A refined camera pose from a visual positioning service., _require_env(), ArCoreGeospatial, OwnedAnchoring (+3 more)

### Community 15 - "MegaLocDescriptor"
Cohesion: 0.14
Nodes (11): available(), best_device(), MegaLocConfig, MegaLocDescriptor, ndarray, MegaLoc — the production global descriptor. DINOv2-base with a SALAD…, Resize, scale to [0, 1], and normalise. Batched to amortise the transfer., Describe several frames at once. The only sensible way to index a survey pass. (+3 more)

### Community 16 - "PanoramaxImagery"
Cohesion: 0.11
Nodes (17): focal_px_from_interior(), PanoramaxImage, PanoramaxImagery, _parse_feature(), Any, datetime, Panoramax — the default anchor-imagery source. Panoramax is street-level…, Captures near a point, freshest-first. (+9 more)

### Community 17 - "FeatureConfig"
Cohesion: 0.12
Nodes (19): The same statistics on simulated frames, for comparison. Printed beside the…, _render_baseline(), detect(), FeatureConfig, Features, _geometric_filter(), _grayscale(), match_features() (+11 more)

### Community 18 - "test_phone_pipeline.py"
Cohesion: 0.09
Nodes (16): RuntimeError, build_destination(), Destination, GcsConfig, GcsDestination, JournalEntry, Protocol, Where the nightly batch goes. Every destination must **confirm receipt**, not… (+8 more)

### Community 19 - "affine.py"
Cohesion: 0.19
Nodes (14): AffineView, _compose(), default_views(), detect_multi_view(), _invert(), ndarray, Affine view simulation — bridging the vantage gap. The measured failure this…, Compose two 2x3 affines: apply ``first``, then ``second``. (+6 more)

### Community 20 - "measure_cross_section"
Cohesion: 0.21
Nodes (10): measure_cross_section(), MeasurementConfig, ndarray, Measure kerb and footway from the reconstructed points around one station.…, kerb_cloud(), ndarray, Tests for measurement extraction, street overlay, gait, and the photo bank., The arithmetic behind Tier C: a 1.5% rise over 1.6 m is inside the fit noise. (+2 more)

### Community 21 - "extract.py"
Cohesion: 0.14
Nodes (17): The world-facts model — the thing the product actually sells., FactClass, datetime, The served world-fact. Two rules from the re-spec are enforced here as…, Accuracy tier. Sets what may be claimed about a fact (re-spec 8.3)., Tier, tier_for_class(), utcnow() (+9 more)

### Community 22 - "pipeline.py"
Cohesion: 0.20
Nodes (9): FrameOutcome, PipelineResult, The full stack, end to end. corridor -> survey pass -> reference index ->…, Score served facts against ground truth, per fact class. Matching is by class…, Push a set of captured frames all the way through to scored facts.…, _reason_counts(), run_pipeline(), score() (+1 more)

### Community 23 - "credentials.py"
Cohesion: 0.11
Nodes (14): Capability, check(), Credential, CredentialReport, providers_for(), Every external service this system can talk to, and what it needs to…, What an adapter provides. One capability, many possible providers., One secret or setting the operator has to supply. (+6 more)

### Community 24 - "calibrate.py"
Cohesion: 0.12
Nodes (26): discover(), evaluate_directory(), evaluate_pair(), group_by_position(), main(), PairResult, Path, Calibrating the feature front end against real photographs. The simulator can… (+18 more)

### Community 25 - "3. Layer C — Fusion engine"
Cohesion: 0.11
Nodes (18): 0.1 The entire Google stack is off-limits for this business, 0.2 ODbL share-alike is survivable, but only by design, 0.3 The public segmentation datasets cannot train a commercial model, 0. Legal ground rules — read before choosing anything, 1. Layer A — Smart capture, 2. Layer B — Compression & upload, 3.1 Anchor reference data (replaces Google), 3.2 Image retrieval / place recognition (cross-contributor association, Step 4) (+10 more)

### Community 26 - "photobank.py"
Cohesion: 0.07
Nodes (38): Layer A — deciding when to open the shutter., CaptureContext, CaptureDecision, MotionState, The capture trigger. Never stream. Open the shutter only when a frame is likely…, Everything the trigger sees at one instant., Stateful evaluator. One per capture session. Ordering is load-bearing. Device-…, Why frames were skipped, over the session. The field diagnostic. (+30 more)

### Community 27 - "StereoRig"
Cohesion: 0.15
Nodes (10): CameraSpec, default_rig(), Sensor rig definitions. The rig mirrors the physical Tier 2 vehicle rig in…, Intrinsics and mounting for one camera, matching Arducam AR0234 on the vehicle…, Pinhole focal length in pixels — needed by every metric-depth conversion., A synchronised pair on a rigid baseline — the rig's source of metric scale.…, Range beyond which stereo can no longer meet a depth tolerance., StereoRig (+2 more)

### Community 28 - "RigConfig"
Cohesion: 0.10
Nodes (23): pose_at_station(), ndarray, Camera and driving parameters for a pass., The camera pose at a station along the corridor., Render once per station, reusing the flattened scene across the whole pass., Drive the RTK rig down the corridor at fixed spacing. Fixed spacing rather than…, _render_stations(), RigConfig (+15 more)

### Community 29 - "ConfidenceModel"
Cohesion: 0.14
Nodes (12): Provenance, ConfidenceModel, FusedValue, Observation, datetime, Confidence, corroboration, and freshness decay. The promotion rule from the re-…, Saturating in the number of independent contributors. Diminishing returns are…, One contributor's measurement of one fact. (+4 more)

### Community 30 - "test_capture_pipeline.py"
Cohesion: 0.11
Nodes (15): Runtime configuration, loaded from the environment and an optional local file.…, _chunk(), encode_png(), ndarray, Minimal PNG writer. Written against zlib from the standard library rather than…, Encode an (H, W, 3) uint8 array as PNG bytes., Split triangles until no edge exceeds ``max_edge_m``. Necessary because the…, subdivide() (+7 more)

### Community 31 - "curate"
Cohesion: 0.07
Nodes (37): assess(), Assessment, curate(), CurationConfig, CurationResult, dhash(), hamming(), ndarray (+29 more)

### Community 32 - "TestProviderSelection"
Cohesion: 0.25
Nodes (7): build_anchor_imagery(), build_visual_positioning(), ProviderChoice, Construct an anchor-imagery provider. ``allow_internal_only`` must be passed…, MonkeyPatch, It is a platform dependency, not a licensing upgrade: same CC BY-SA imagery., TestProviderSelection

### Community 33 - "TestVaryingPace"
Cohesion: 0.13
Nodes (12): GaitConfig, GaitSimulator, ndarray, Realistic walking pace. Nobody walks at a constant speed. Real pedestrian pace…, Pedestrian pace parameters. Defaults are ordinary adult walking., Generates a speed trace for one walk., Advance and return the current speed., A full speed trace, for analysis and tests. (+4 more)

### Community 34 - "geometry.py"
Cohesion: 0.09
Nodes (16): CurbRamp, One run of sidewalk along a block face, with everything on it., Narrowest point — the number a wheelchair or robot actually has to fit through., A curb ramp with the geometry the robot API is asked to report., SidewalkSegment, build_segment_mesh(), cross_section_at(), CrossSection (+8 more)

### Community 35 - "daily.py"
Cohesion: 0.20
Nodes (7): BatchReport, next_window(), datetime, The nightly batch, fully implemented. Assess, delete rejects immediately,…, The next scheduled run after ``now``, in **local** time. The hour is local by…, Computed in UTC it landed at 19:00 local — the opposite of the intent., TestSchedule

### Community 36 - "load_image"
Cohesion: 0.18
Nodes (11): load_image(), ndarray, Load a photograph with EXIF orientation applied. Orientation is not optional.…, DegradationConfig, DegradationReport, degrade(), estimated_fov_deg(), ndarray (+3 more)

### Community 37 - "GnssSimulator"
Cohesion: 0.12
Nodes (13): GnssErrorModel, GnssSimulator, mean_horizontal_deviation(), mix_mean_deviation(), ndarray, Advance by ``dt_s`` and return the ENU error vector in metres., Mean 2D error magnitude — the statistic the literature reports for crowdsourced…, Parameters of the error process, per horizontal axis unless noted. (+5 more)

### Community 38 - "Camera-Only Fusion Mapping Network — Technical Re-Spec"
Cohesion: 0.11
Nodes (18): 0. The one-paragraph version, 10. Deferred (bracketed for this version, not solved), 11. Competitive reality to build against, 1. What each layer does — and who builds it, 2. Layer A — Smart Capture ("aware software"), 3. Layer B — Compression & Upload (use the commodity, don't build it), 4. Layer C — The Fusion Engine (your only real IP), 5. Layer D — Distribution (+10 more)

### Community 39 - "run_batch"
Cohesion: 0.27
Nodes (9): BatchPolicy, Run one night's batch., run_batch(), DirectoryDestination, Path, Write to a folder — a synced drive, an external disk, a mount point. Confirmed…, The journal is the only copy until the far end confirms., seed_journal() (+1 more)

### Community 40 - "Path"
Cohesion: 0.22
Nodes (9): new_entry(), Build an entry for a payload, with the content hash as its identity., photo(), png_bytes(), ndarray, Path, SQLite INTEGER is signed; a 64-bit perceptual hash is not., Retention measures time on the phone, not the age of the scene. (+1 more)

### Community 41 - "phone.py"
Cohesion: 0.13
Nodes (22): ImageFormat, Rough encoded size at the default quality. Conservative on purpose., _cell_for(), default_sources(), ingest(), IngestReport, photos_library_readable(), Path (+14 more)

### Community 42 - "test_distributions.py"
Cohesion: 0.08
Nodes (11): _curb_fields(), _noncompliance_rate(), Tests for the right-of-way sampling model. These assert the properties the…, Recall on 'no ramp here' is unmeasurable if the sim never omits one., The corroboration claim is untestable if a repeat pass sees different geometry., A high-quality block face must depart from the standard less often than a poor…, TestCorners, TestDeterminism (+3 more)

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

### Community 48 - "ingest/__main__.py"
Cohesion: 0.07
Nodes (37): distance_m(), enu_to_geodetic(), gaussian_radius_m(), geodetic_to_enu(), haversine_m(), Origin, Local tangent-plane geodesy. The simulator works in metres on a flat local…, Great-circle distance over long ranges. Retained for distances where earth… (+29 more)

### Community 49 - "Pose"
Cohesion: 0.09
Nodes (15): Pose, ndarray, Camera position in world coordinates. Not ``translation``., World points to camera frame. Accepts (N, 3)., Gauss-Newton refinement of reprojection error, Huber-weighted. Huber rather…, Rodrigues formula. A zero vector gives identity rather than a division by zero., Inverse of :func:`rotation_from_rotvec`, stable at 0 and pi., World-to-camera rigid transform. (+7 more)

### Community 50 - "test_geometry.py"
Cohesion: 0.18
Nodes (9): build_dome_field(), Truncated-dome detectable warning field. Domes are 0.9 in across and 0.2 in…, curb_height_bucket(), Bucket a continuous height. The graded quantity is the bucket, not the…, inches(), parametrize, Tests for mesh construction and the corridor build. The central assertion is…, TestCurbBuckets (+1 more)

### Community 51 - "Mesh"
Cohesion: 0.18
Nodes (11): Mesh, A triangle mesh in a local frame: +x along the kerb, +y into the sidewalk, +z…, main(), Generate a corridor: meshes for the renderer, ground truth for the checker.…, Path, Wavefront OBJ export. OBJ rather than a CARLA-native format on purpose: CARLA…, Write meshes to a single OBJ, one named group per mesh. OBJ vertex indices are…, write_obj() (+3 more)

### Community 52 - "world.py"
Cohesion: 0.09
Nodes (21): measure_curb_height(), Recover curb height from mesh vertices — the inverse of the generator. Used by…, build_corridor(), Corridor, CorridorSegment, export_ground_truth(), FidelityReport, PlacedRamp (+13 more)

### Community 53 - "WorldFact"
Cohesion: 0.16
Nodes (7): BaseModel, model_validator, Record that this measurement disagrees with a reference, keeping the…, One assertion about one place, with everything needed to judge whether to trust…, WorldFact, Truth is a different type on purpose; it must not be confusable with a served…, TestFactsAndTruthAreDistinct

### Community 54 - "load_photo"
Cohesion: 0.12
Nodes (20): discover_photos(), load_photo(), _open(), PhotoMeta, ndarray, Path, Reading real photographs, including iPhone HEIC. Three things routinely go…, Load a photograph as RGB, with EXIF orientation applied.… (+12 more)

### Community 55 - "TinyImageDescriptor"
Cohesion: 0.16
Nodes (9): build_descriptor(), FrameDescriptor, ndarray, Protocol, Frame descriptors. Production is **MegaLoc** — DINOv2-base with a SALAD…, Downsampled greyscale, mean-centred and L2-normalised. Mean-centring before…, Select a global descriptor by name. ``auto`` prefers MegaLoc when PyTorch is…, TinyImageDescriptor (+1 more)

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
Cohesion: 0.14
Nodes (11): AnchoringConfig, AnchoringPipeline, ndarray, Anchor one capture, or return ``None`` if it cannot be anchored confidently.…, Inverse-variance combination of the references' own uncertainties. Not the…, Compass heading of the camera's optical axis, degrees clockwise from north. The…, Return ``(query_indices, reference_indices)`` of mutual matches., Retrieval, matching, PnP, and the conversion back to latitude and longitude. (+3 more)

### Community 60 - "test_anchoring.py"
Cohesion: 0.18
Nodes (11): _iterations_needed(), ransac_pnp(), Linear pose from >= 6 correspondences (Direct Linear Transform). Fast,…, How many RANSAC samples are needed to see one all-inlier set, with…, Robust pose from noisy, partly wrong correspondences. Returns ``None`` rather…, solve_pnp_dlt(), ndarray, Tests for pose geometry, retrieval, and the anchoring pipeline. Pose recovery… (+3 more)

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

### Community 69 - "mapping/__init__.py"
Cohesion: 0.12
Nodes (11): AnchorResult, FeatureMatcher, Protocol, The anchoring stack — Step 3 of the fusion engine. Rough GPS puts a capture on…, Local feature matching between a query and a reference frame. Production…, Whether this pose is good enough to carry coarse geometry (re-spec 8.3 Tier B)., 3D mapping accuracy: anchoring, metric scale, and the confidence model., PnpResult (+3 more)

### Community 70 - "AnchorImagerySource"
Cohesion: 0.20
Nodes (7): AnchorImagerySource, MetricDepthSource, Protocol, Street-level imagery to anchor captures against., Refines a rough position using a camera frame. The load-bearing accuracy step., Per-pixel metric depth. Feeds the scale estimator., VisualPositioningSource

### Community 71 - "manifest.json"
Cohesion: 0.22
Nodes (8): count, created_at, max_width, mode, quality, records, skipped, source

### Community 72 - "Measurement Extraction, Street Overlay & Full-Stack Results"
Cohesion: 0.22
Nodes (8): 1. Full-stack run, 2. Measurement extraction, 3. Street overlay, 4. Varying pace — the crucial verification, 5. Photo bank at delivered resolution, 6. Bugs found and fixed in this pass, 7. What this does not show, Measurement Extraction, Street Overlay & Full-Stack Results

### Community 73 - "OpenCVMatcher"
Cohesion: 0.18
Nodes (7): OpenCVMatcher, A real :class:`~smc.mapping.anchoring.FeatureMatcher`. Holds the query image's…, Pixel coordinates the match indices refer to., Image retrieval — finding which captures show the same place. Step 4 of the…, Tests for real feature detection and matching., An oracle-seeded frame cannot be matched against; skipping beats a silent zero., TestOpenCVMatcher

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

### Community 81 - "project"
Cohesion: 0.18
Nodes (11): pose_covariance(), position_sigma_m(), project(), Project world points to pixels. Points behind the camera come back as NaN. NaN…, Per-correspondence pixel error. Points behind the camera get ``inf``., 6x6 covariance of the pose parameters (rotvec, translation). Linearised at the…, Horizontal 1-sigma position uncertainty from a pose covariance. Uses the…, reprojection_errors() (+3 more)

### Community 82 - "MotionState"
Cohesion: 0.29
Nodes (7): MotionState, CYCLING, RUNNING, STATIONARY, UNKNOWN, VEHICLE, WALKING

### Community 83 - "Spatial Mapping Crowdsource"
Cohesion: 0.29
Nodes (6): Founding document, graphify, Layer boundaries (do not blur these), Non-negotiable engine rules, Spatial Mapping Crowdsource, What this is

### Community 84 - "CARLA Harness"
Cohesion: 0.29
Nodes (6): 1. The constraint that shaped the design, 2. What was built, 3. Four design decisions worth defending, 4. Findings the code produced, 5. What is still open, CARLA Harness

### Community 85 - "CrossSection"
Cohesion: 0.29
Nodes (5): CrossSection, Everything measurable at one place along the kerb., KerbPlanes, The road plane, the walking plane, and the step between them., Whether the two surfaces are close to parallel, as a sanity signal.

### Community 86 - "UploadState"
Cohesion: 0.33
Nodes (6): UploadState, DONE, FAILED, PENDING, REDACTED, UPLOADING

### Community 88 - "export_contact_sheet"
Cohesion: 0.29
Nodes (6): _decode_png(), export_contact_sheet(), ndarray, Path, Tile a sample of the bank into one image, for eyeballing what was captured., Minimal decoder for the images this project writes (filter 0, 8-bit RGB).

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

## Knowledge Gaps
- **168 isolated node(s):** `EMPTY`, `COMPLETE`, `PARTIAL`, `DEFERRED`, `FAILED` (+163 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **14 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Pose` connect `Pose` to `mapping/__init__.py`, `GlassesProfile`, `RenderResult`, `test_anchoring.py`, `ingest/__main__.py`, `project`, `photobank.py`, `AnchoringPipeline`, `RigConfig`?**
  _High betweenness centrality (0.058) - this node is a cross-community bridge._
- **Why does `intrinsics()` connect `photobank.py` to `mapping/__init__.py`, `GlassesProfile`, `ingest/__main__.py`, `Pose`, `load_photo`, `pipeline.py`?**
  _High betweenness centrality (0.037) - this node is a cross-community bridge._
- **Why does `build_corridor()` connect `world.py` to `StreetSegment`, `GlassesProfile`, `distributions.py`, `DriveConfig`, `RenderResult`, `ingest/__main__.py`, `FeatureConfig`, `Mesh`, `calibrate.py`, `test_capture_pipeline.py`?**
  _High betweenness centrality (0.036) - this node is a cross-community bridge._
- **Are the 5 inferred relationships involving `LocalPhotoJournal` (e.g. with `ingest()` and `run_batch()`) actually correct?**
  _`LocalPhotoJournal` has 5 INFERRED edges - model-reasoned connections that need verification._
- **Are the 15 inferred relationships involving `Pose` (e.g. with `ContributorFrame` and `pose_at_station()`) actually correct?**
  _`Pose` has 15 INFERRED edges - model-reasoned connections that need verification._
- **Are the 7 inferred relationships involving `LocalFrameStore` (e.g. with `contributor_pass()` and `bank_summary()`) actually correct?**
  _`LocalFrameStore` has 7 INFERRED edges - model-reasoned connections that need verification._
- **Are the 8 inferred relationships involving `ReferenceFrame` (e.g. with `AnchoringPipeline` and `FeatureMatcher`) actually correct?**
  _`ReferenceFrame` has 8 INFERRED edges - model-reasoned connections that need verification._