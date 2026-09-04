# Graph Report - spatial-mapping-crowdsource  (2026-09-03)

## Corpus Check
- 202 files · ~1,647,000 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2658 nodes · 5264 edges · 139 communities (121 shown, 18 thin omitted)
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 309 edges (avg confidence: 0.95)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `90e267c4`
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
- split_kerb_planes
- test_phone_pipeline.py
- distributions.py
- surfaces.py
- TriggerEngine
- curb.py
- TestKeylessAdapters
- providers.py
- kartaview.py
- PanoramaxImagery
- FeatureConfig
- build_destination
- affine.py
- load_photo
- assess.py
- release_shards.py
- credentials.py
- calibrate.py
- 3. Layer C — Fusion engine
- assess
- capture.py
- pipeline.py
- ConfidenceModel
- daily.py
- world.py
- TestProviderSelection
- TestVaryingPace
- extract.py
- LocalPhotoJournal
- TestGeometryHelpers
- GnssSimulator
- Camera-Only Fusion Mapping Network — Technical Re-Spec
- run_batch
- curate
- match_within
- test_distributions.py
- ImageryProvider
- run_capture_set.py
- Part B — Features still needing code
- Capture Rig v1 (Vehicle) & the Simulation Stack
- buildings.py
- test_capture_pipeline.py
- waymo_mirror.py
- Settings
- geometry.py
- SequenceRecord
- StereoRig
- photos.py
- measure_cross_section
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
- build_corridor
- BoundingBox
- manifest.json
- Measurement Extraction, Street Overlay & Full-Stack Results
- LocalFrameStore
- Production Review — 2026-08-23
- units.py
- Kerbside
- test_simulation.py
- KerbMeasurement
- Glasses System — Capture, Transfer, Accuracy
- Supabase storage
- pack_release_assets
- MotionState
- Spatial Mapping Crowdsource
- CARLA Harness
- _get
- UploadState
- MegaLocDescriptor
- cameraroll.py
- SidewalkSegment
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
- OvertureClient
- photobank.py
- harvest_region_observations.py
- CLAUDE.md
- archive
- 20260902T023431Z/manifest.json
- OverpassClient
- Scalable Observation Storage
- waymo.py
- 17 · Measured kerbs, and where the lidar actually is
- 12 · Installing it, and what the shutter refuses
- encode_png
- WorldFact
- DriveConfig
- sf_corridor/README.md
- 13-sf-corridor-3d-seed.md
- docs/sw.js
- build_all.sh
- pwa/sw.js
- storage/__init__.py
- OpenCVMatcher
- scenario.py
- PhotoMeta
- CV/Depth Storage
- CaptureSettings
- depth/__init__.py
- refresh_catalog.sh
- AnchorImagerySource
- LocalizationResult
- TestMapillaryParsing
- Waymo Open Dataset — provenance of access
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
9. `measure_cross_section()` - 27 edges
10. `MapillaryProvider` - 25 edges

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

## Communities (139 total, 18 thin omitted)

### Community 0 - "ScaleEstimator"
Cohesion: 0.06
Nodes (35): disagreement_flag(), Flag a conflict between a measurement and a reference, keeping the measurement.…, from_camera_height(), from_gnss_baseline(), from_known_object(), from_metric_depth(), from_stereo_baseline(), Metric scale recovery — the load-bearing module. Monocular structure-from-… (+27 more)

### Community 1 - "people.py"
Cohesion: 0.11
Nodes (18): assess_people(), _cascade(), detect_people(), Detection, PeopleAssessment, PeopleConfig, _prepare(), ndarray (+10 more)

### Community 2 - "TriggerEngine"
Cohesion: 0.12
Nodes (14): Layer A — deciding when to open the shutter., CaptureDecision, MotionState, The capture trigger. Never stream. Open the shutter only when a frame is likely…, Stateful evaluator. One per capture session. Ordering is load-bearing. Device-…, Why frames were skipped, over the session. The field diagnostic., Dead-reckon distance from speed. Speed is used rather than successive GNSS…, Straight from the OS activity classifier — not reimplemented. iOS… (+6 more)

### Community 3 - "StreetSegment"
Cohesion: 0.06
Nodes (23): Street-map overlay: putting captures and facts onto a flat map., corridor_street_map(), MapFrame, ndarray, Overlaying captures onto a standard street map. The anchoring stack returns a…, Lateral offset of the kerb line from the centreline, signed by side. The hint…, A street-aligned basis: along the kerb, across the footway, up. Measurements…, ENU points into the street frame: +x along, +y across, +z up. (+15 more)

### Community 4 - "ReferenceFrame"
Cohesion: 0.06
Nodes (30): AnchoringConfig, AnchoringPipeline, AnchorResult, FeatureMatcher, ndarray, Protocol, The anchoring stack — Step 3 of the fusion engine. Rough GPS puts a capture on…, Inverse-variance combination of the references' own uncertainties. Not the… (+22 more)

### Community 5 - "build_sf_corridor_3d.py"
Cohesion: 0.28
Nodes (15): annotate_osm_features(), build_payload(), _building_height(), _cell_resolution(), _centroid(), district_bands(), _feature_is_covered(), fetch_osm() (+7 more)

### Community 6 - "PhotoJournal"
Cohesion: 0.07
Nodes (24): Assessor, BatchOutcome, COMPLETE, DEFERRED, EMPTY, FAILED, PARTIAL, BatchPolicy (+16 more)

### Community 7 - "split_kerb_planes"
Cohesion: 0.08
Nodes (22): Measurement extraction — turning a reconstruction into world-facts., estimate_kerb_offset(), fit_plane_ransac(), perpendicular_extent(), Plane, ndarray, Plane fitting for the road and the walking surface. The two planes are the…, Find the lateral position of the kerb line by scanning for the largest height… (+14 more)

### Community 8 - "test_phone_pipeline.py"
Cohesion: 0.18
Nodes (11): new_entry(), Build an entry for a payload, with the content hash as its identity., photo(), png_bytes(), ndarray, Tests for the journal, the nightly batch, and the privacy filter., Computed in UTC it landed at 19:00 local — the opposite of the intent., SQLite INTEGER is signed; a 64-bit perceptual hash is not. (+3 more)

### Community 9 - "distributions.py"
Cohesion: 0.11
Nodes (34): BlockFace, DrivewayApron, LevelChange, Obstruction, Hierarchical sampling of pedestrian right-of-way geometry. Sampling is…, Latent state shared by everything on one block face., A vertical discontinuity. ``cause`` is retained so the exporter can explain a…, Sample the latent state of one block face. (+26 more)

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
Cohesion: 0.12
Nodes (9): NominatimClient, NtripMountpoint, OpenFreeMapTiles, Services that need no credential at all. Everything here is wired end to end…, OpenStreetMap geocoding. Free, no key, ODbL, 1 request/second maximum. The rate…, Vector basemap tiles. Free, no key, unlimited, MIT, OSM data. Chosen over…, An RTK correction stream on the RTK2go community caster. Free, no rover…, The caster's list of available base stations. (+1 more)

### Community 14 - "providers.py"
Cohesion: 0.16
Nodes (12): AdapterUnavailable, ImageRef, RuntimeError, Provider-agnostic interfaces. Each capability is a Protocol with at least two…, Raised when an adapter is selected but its credential or dependency is missing., A street-level image available for anchoring., _require_env(), Panoramax — the default anchor-imagery source. Panoramax is street-level… (+4 more)

### Community 15 - "kartaview.py"
Cohesion: 0.09
Nodes (26): License, ObservationUnavailable, RuntimeError, The provider no longer serves this observation's pixels., What a provider requires of anyone using its imagery. Kept per-observation…, _f(), _i(), KartaViewProvider (+18 more)

### Community 16 - "PanoramaxImagery"
Cohesion: 0.10
Nodes (16): focal_px_from_interior(), PanoramaxImage, PanoramaxImagery, _parse_feature(), Any, datetime, Captures near a point, freshest-first., Download one capture. Transient: used for anchoring, then discarded. (+8 more)

### Community 17 - "FeatureConfig"
Cohesion: 0.12
Nodes (21): The same statistics on simulated frames, for comparison. Printed beside the…, _render_baseline(), detect(), Detector, FeatureConfig, Features, _geometric_filter(), _grayscale() (+13 more)

### Community 18 - "build_destination"
Cohesion: 0.11
Nodes (13): build_destination(), Destination, GcsConfig, GcsDestination, JournalEntry, Protocol, Verify credentials and bucket before a batch depends on them. Worth running at…, Build a destination from a URL or a path. ``gs://bucket/prefix`` gives GCS;… (+5 more)

### Community 19 - "affine.py"
Cohesion: 0.19
Nodes (14): AffineView, _compose(), default_views(), detect_multi_view(), _invert(), ndarray, Affine view simulation — bridging the vantage gap. The measured failure this…, Compose two 2x3 affines: apply ``first``, then ``second``. (+6 more)

### Community 20 - "load_photo"
Cohesion: 0.25
Nodes (11): load_photo(), ndarray, Load a photograph as RGB, with EXIF orientation applied.…, Write a JPEG carrying iPhone-like EXIF, for testing the loader without a phone.…, write_synthetic_iphone_photo(), Path, An iPhone shoots eight times the pixels the toolkit hands over., A photo-like frame: low-frequency structure plus fine texture. Pure noise is… (+3 more)

### Community 21 - "assess.py"
Cohesion: 0.18
Nodes (8): Assessment, CurationResult, Deciding which captures are worth keeping, on the phone, before anything is…, Interleave by cell so a budget cut removes depth, not coverage., What one frame scored, and what is to be done with it., _round_robin_by_cell(), Verdict, On-device curation and compression.

### Community 22 - "release_shards.py"
Cohesion: 0.14
Nodes (26): main(), build_storage_manifest(), CaptureAsset, _dataset_name(), load_capture_assets(), plan_capture_release_assets(), Any, Path (+18 more)

### Community 23 - "credentials.py"
Cohesion: 0.11
Nodes (14): Capability, check(), Credential, CredentialReport, providers_for(), Every external service this system can talk to, and what it needs to…, What an adapter provides. One capability, many possible providers., One secret or setting the operator has to supply. (+6 more)

### Community 24 - "calibrate.py"
Cohesion: 0.13
Nodes (23): discover(), evaluate_directory(), evaluate_pair(), group_by_position(), main(), PairResult, Path, Calibrating the feature front end against real photographs. The simulator can… (+15 more)

### Community 25 - "3. Layer C — Fusion engine"
Cohesion: 0.11
Nodes (18): 0.1 The entire Google stack is off-limits for this business, 0.2 ODbL share-alike is survivable, but only by design, 0.3 The public segmentation datasets cannot train a commercial model, 0. Legal ground rules — read before choosing anything, 1. Layer A — Smart capture, 2. Layer B — Compression & upload, 3.1 Anchor reference data (replaces Google), 3.2 Image retrieval / place recognition (cross-contributor association, Step 4) (+10 more)

### Community 26 - "assess"
Cohesion: 0.19
Nodes (13): assess(), dhash(), hamming(), ndarray, Area-averaged downscale to a fixed size, as grayscale. Averaging, not sampling.…, Variance of the Laplacian, normalised by image contrast. Raw Laplacian variance…, 64-bit difference hash: each bit is one horizontal gradient sign. Robust to…, Score one frame. Cheap enough to run on every capture. (+5 more)

### Community 27 - "capture.py"
Cohesion: 0.06
Nodes (46): CaptureContext, Everything the trigger sees at one instant., Environment, mix_mean_deviation(), GNSS error simulation. CARLA's built-in GNSS sensor applies independent…, distance_m(), enu_to_geodetic(), gaussian_radius_m() (+38 more)

### Community 28 - "pipeline.py"
Cohesion: 0.09
Nodes (22): bank_summary(), BankFrame, A banked capture. ``render`` and the ``true_*`` fields are simulation-only and…, FrameOutcome, _intrinsics_for(), ndarray, The full stack, end to end. corridor -> survey pass -> reference index ->…, Per-frame intrinsics, from the capture record where available. (+14 more)

### Community 29 - "ConfidenceModel"
Cohesion: 0.16
Nodes (9): ConfidenceModel, Observation, datetime, Saturating in the number of independent contributors. Diminishing returns are…, One contributor's measurement of one fact., Turns a set of observations into a confidence and a provenance., Observation, 40 frames from one wearer is one observer, not 40. (+1 more)

### Community 30 - "daily.py"
Cohesion: 0.17
Nodes (15): ImageFormat, Compression policy for the daily batch. No codec is written here and none…, Rough encoded size at the default quality. Conservative on purpose., BatchReport, next_window(), datetime, The nightly batch, fully implemented. Assess, delete rejects immediately,…, The next scheduled run after ``now``, in **local** time. The hour is local by… (+7 more)

### Community 31 - "world.py"
Cohesion: 0.08
Nodes (25): build_segment_mesh(), measure_curb_height(), Mesh, Loft a segment's cross-sections into a triangle mesh., Recover curb height from mesh vertices — the inverse of the generator. Used by…, A triangle mesh in a local frame: +x along the kerb, +y into the sidewalk, +z…, main(), Generate a corridor: meshes for the renderer, ground truth for the checker.… (+17 more)

### Community 32 - "TestProviderSelection"
Cohesion: 0.15
Nodes (12): build_anchor_imagery(), build_visual_positioning(), MapillaryImagery, ProviderChoice, Download one image. Transient: used for anchoring, then discarded., Construct an anchor-imagery provider. ``allow_internal_only`` must be passed…, Mapillary API v4 — a first-class source since the project went non-commercial.…, The query this adapter would issue. Separated so it can be asserted in tests. (+4 more)

### Community 33 - "TestVaryingPace"
Cohesion: 0.13
Nodes (11): GaitConfig, GaitSimulator, ndarray, Realistic walking pace. Nobody walks at a constant speed. Real pedestrian pace…, Pedestrian pace parameters. Defaults are ordinary adult walking., Generates a speed trace for one walk., Advance and return the current speed., A full speed trace, for analysis and tests. (+3 more)

### Community 34 - "extract.py"
Cohesion: 0.12
Nodes (22): The world-facts model — the thing the product actually sells., FactClass, Provenance, datetime, The served world-fact. Two rules from the re-spec are enforced here as…, Accuracy tier. Sets what may be claimed about a fact (re-spec 8.3)., Tier, tier_for_class() (+14 more)

### Community 35 - "LocalPhotoJournal"
Cohesion: 0.08
Nodes (18): Row, Where the nightly batch goes. Every destination must **confirm receipt**, not…, EntryState, JournalEntry, LocalPhotoJournal, mark(), datetime, Path (+10 more)

### Community 36 - "TestGeometryHelpers"
Cohesion: 0.16
Nodes (10): baseline_for_depth_tolerance_m(), overlap_fraction(), perceptual_distance(), Normalised Hamming distance between two perceptual hashes. A hash rather than a…, Fraction of the frame footprint shared by consecutive captures. Multi-view…, Baseline needed to resolve depth at ``range_m`` to ``tolerance_m``. The same…, Capture rate needed to hold a minimum overlap. The inverse of…, required_capture_hz() (+2 more)

### Community 37 - "GnssSimulator"
Cohesion: 0.12
Nodes (12): GnssErrorModel, GnssSimulator, mean_horizontal_deviation(), ndarray, Advance by ``dt_s`` and return the ENU error vector in metres., Mean 2D error magnitude — the statistic the literature reports for crowdsourced…, Parameters of the error process, per horizontal axis unless noted., Stateful error generator. One instance per receiver per drive. (+4 more)

### Community 38 - "Camera-Only Fusion Mapping Network — Technical Re-Spec"
Cohesion: 0.11
Nodes (18): 0. The one-paragraph version, 10. Deferred (bracketed for this version, not solved), 11. Competitive reality to build against, 1. What each layer does — and who builds it, 2. Layer A — Smart Capture ("aware software"), 3. Layer B — Compression & Upload (use the commodity, don't build it), 4. Layer C — The Fusion Engine (your only real IP), 5. Layer D — Distribution (+10 more)

### Community 39 - "run_batch"
Cohesion: 0.25
Nodes (10): BatchPolicy, Run one night's batch., run_batch(), DirectoryDestination, Path, Write to a folder — a synced drive, an external disk, a mount point. Confirmed…, Path, The journal is the only copy until the far end confirms. (+2 more)

### Community 40 - "curate"
Cohesion: 0.27
Nodes (7): curate(), CurationConfig, Decide the day's batch. Order matters and is not arbitrary. Quality gates run…, Thresholds. Every one is a trade between upload cost and coverage., An absolute threshold would drop a whole batch of a low-texture scene., A budget cut must not spend the whole day on one street., TestCuration

### Community 41 - "match_within"
Cohesion: 0.14
Nodes (15): load_image(), ndarray, Load a photograph with EXIF orientation applied. Orientation is not optional.…, DegradationConfig, DegradationReport, degrade(), estimated_fov_deg(), fov_gap() (+7 more)

### Community 42 - "test_distributions.py"
Cohesion: 0.06
Nodes (13): _curb_fields(), _noncompliance_rate(), Tests for the right-of-way sampling model. These assert the properties the…, Tier C exists because these are rare and small. Both properties are asserted., Recall on 'no ramp here' is unmeasurable if the sim never omits one., The corroboration claim is untestable if a repeat pass sees different geometry., A high-quality block face must depart from the standard less often than a poor…, TestCorners (+5 more)

### Community 43 - "ImageryProvider"
Cohesion: 0.11
Nodes (17): ImageryProvider, Observation, Protocol, Metadata-first access to a street-imagery archive., Sequences with any presence in the region. Metadata only -- no pixels., One sequence's metadata, by provider-native id., Every frame of a sequence, in capture order. Metadata only -- no pixels., Where this observation's pixels live *now*. Deliberately not a stored URL… (+9 more)

### Community 44 - "run_capture_set.py"
Cohesion: 0.27
Nodes (14): cluster(), Frame, _input_paths_and_metadata(), load(), main(), Path, Score real capture folders, save audit artifacts, and build a map payload.…, Group places by GPS when available, otherwise by capture time. (+6 more)

### Community 45 - "Part B — Features still needing code"
Cohesion: 0.12
Nodes (15): A1. Required. Nothing runs without these four., A2. Optional — Google. Free, and internal-build-only by your decision., A3. Optional — other, A4. Settings, not credentials — no account anywhere, A5. Wired in and needing nothing at all, B1. Blocking — the learned front end of anchoring, B2. Blocking — measurement extraction, B3. Blocking — SfM integration (+7 more)

### Community 46 - "Capture Rig v1 (Vehicle) & the Simulation Stack"
Cohesion: 0.13
Nodes (14): 1. Why vehicle-first is right — including an argument stronger than the speed one, 2. Target camera, 3.1 Vehicle: **CARLA**, 3.2 Glasses: **Meta Mock Device Kit** (official, part of the Wearables DAT), 3.3 The chain — one synthetic pipeline, both targets, 3.4 Checked and rejected, 3. Simulation stack, 4. What simulation can and cannot prove (+6 more)

### Community 47 - "buildings.py"
Cohesion: 0.18
Nodes (12): corridor_facades(), Facade, facade_triangles(), ndarray, Building facades along a corridor. Not scenery. The re-spec's Step 3 anchors a…, Every facade triangle in a corridor, with per-triangle colours., One building frontage along the block., Sample the frontages on one block face. Identity-seeded like everything else,… (+4 more)

### Community 48 - "test_capture_pipeline.py"
Cohesion: 0.09
Nodes (14): Runtime configuration, loaded from the environment and an optional local file.…, build_descriptor(), ndarray, Frame descriptors. Production is **MegaLoc** — DINOv2-base with a SALAD…, Downsampled greyscale, mean-centred and L2-normalised. Mean-centring before…, Select a global descriptor by name. ``auto`` prefers MegaLoc when PyTorch is…, TinyImageDescriptor, corridor() (+6 more)

### Community 49 - "waymo_mirror.py"
Cohesion: 0.07
Nodes (40): main(), Every kerb this frame can see, both sides, along the vehicle's travel., slices_from_frame(), first_length_delimited(), _get(), iter_records(), load_protos(), RuntimeError (+32 more)

### Community 50 - "Settings"
Cohesion: 0.18
Nodes (9): load_env_file(), Path, Read ``KEY=value`` lines into the environment. Returns what it set., Render a config value safely for logs., Everything the pipeline reads from the environment., redact(), Settings, MonkeyPatch (+1 more)

### Community 51 - "geometry.py"
Cohesion: 0.08
Nodes (18): CurbRamp, A curb ramp with the geometry the robot API is asked to report., build_dome_field(), cross_section_at(), CrossSection, Parametric geometry for sampled right-of-way features. CARLA cannot supply…, Truncated-dome detectable warning field. Domes are 0.9 in across and 0.2 in…, Lateral profile at one station, as (offset from kerb line, height) pairs.… (+10 more)

### Community 52 - "SequenceRecord"
Cohesion: 0.15
Nodes (23): _dedupe_sequences(), _license_rows(), main(), _observation(), Path, _rows(), _sequence(), _summary() (+15 more)

### Community 53 - "StereoRig"
Cohesion: 0.15
Nodes (10): CameraSpec, default_rig(), Sensor rig definitions. The rig mirrors the physical Tier 2 vehicle rig in…, Intrinsics and mounting for one camera, matching Arducam AR0234 on the vehicle…, Pinhole focal length in pixels — needed by every metric-depth conversion., A synchronised pair on a rigid baseline — the rig's source of metric scale.…, Range beyond which stereo can no longer meet a depth tolerance., StereoRig (+2 more)

### Community 54 - "photos.py"
Cohesion: 0.28
Nodes (8): discover_photos(), _open(), Path, Reading real photographs, including iPhone HEIC. Three things routinely go…, Pull the few EXIF fields that matter. Absent EXIF is normal, not an error., Latitude, longitude and accuracy from the GPS IFD. EXIF stores position as…, _read_exif(), _read_gps()

### Community 55 - "measure_cross_section"
Cohesion: 0.15
Nodes (12): measure_cross_section(), MeasurementConfig, ndarray, Measure kerb and footway from the reconstructed points around one station.…, kerb_cloud(), ndarray, parametrize, Tests for measurement extraction, street overlay, gait, and the photo bank. (+4 more)

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
Cohesion: 0.10
Nodes (17): CompressionPlan, CompressionProfile, fits_budget(), frames_within_budget(), plan_compression(), Estimate the daily batch size before encoding any of it. Worth knowing in…, How many frames fit in a budget. Sets the curator's daily cap on a metered plan., What to ask the platform encoder for. (+9 more)

### Community 60 - "Pose"
Cohesion: 0.05
Nodes (39): Anchor one capture, or return ``None`` if it cannot be anchored confidently.…, Compass heading of the camera's optical axis, degrees clockwise from north. The…, _iterations_needed(), PnpResult, Pose, pose_covariance(), position_sigma_m(), project() (+31 more)

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
Cohesion: 0.09
Nodes (17): audit(), BlockProfile, CurbHeightProfile, ProfileAudit, RampProfile, RampStyle, Sampling profiles for pedestrian right-of-way geometry. A simulation whose…, Sidewalk running surface: width, cross slope, condition, and joint displacement. (+9 more)

### Community 65 - "imagery/panoramax.py"
Cohesion: 0.16
Nodes (20): _f(), _i(), _link(), PanoramaxProvider, datetime, Observation, _rational(), Panoramax. Panoramax is street-level imagery run by IGN, the French national… (+12 more)

### Community 66 - "TestFullStack"
Cohesion: 0.15
Nodes (4): The rule most likely to be lost between layers. Checked at the far end., A loose bound on purpose. With strict matching only a handful of frames anchor…, Real feature matching, no oracle. Yield is materially below 1.0 and that is the…, TestFullStack

### Community 67 - "TriggerEngine"
Cohesion: 0.24
Nodes (5): CaptureDecision, CaptureContext, Suppression, TriggerEngine, TriggerConfig

### Community 68 - "Region"
Cohesion: 0.13
Nodes (21): bounded_sequences(), collect_provider(), main(), provider_by_name(), Observation, summary(), The provider interface. Everything above this line knows about observations and…, exact_dedupe() (+13 more)

### Community 69 - "build_corridor"
Cohesion: 0.18
Nodes (9): build_corridor(), CorridorSegment, export_ground_truth(), PlacedRamp, Lay out block faces along a corridor, with a corner at each block boundary., The exact answer key for the corridor., A corner with no ramp must be an assertable fact, not a gap in the data., TestCorridor (+1 more)

### Community 70 - "BoundingBox"
Cohesion: 0.22
Nodes (12): BoundingBox, _fetch(), main(), Path, Assemble the self-contained dataset the web map ships with. An Artifact runs…, Drop collinear vertices. Straight city blocks carry a lot of redundant nodes., Small JPEGs of the capture session, inlined as data URIs., road_query() (+4 more)

### Community 71 - "manifest.json"
Cohesion: 0.22
Nodes (8): count, created_at, max_width, mode, quality, records, skipped, source

### Community 72 - "Measurement Extraction, Street Overlay & Full-Stack Results"
Cohesion: 0.22
Nodes (8): 1. Full-stack run, 2. Measurement extraction, 3. Street overlay, 4. Varying pace — the crucial verification, 5. Photo bank at delivered resolution, 6. Bugs found and fixed in this pass, 7. What this does not show, Measurement Extraction, Street Overlay & Full-Stack Results

### Community 73 - "LocalFrameStore"
Cohesion: 0.08
Nodes (20): Capture ingest: the frame store and the simulated capture run., content_id(), FrameRecord, FrameStore, LocalFrameStore, object_store_uri(), datetime, Path (+12 more)

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

### Community 78 - "KerbMeasurement"
Cohesion: 0.22
Nodes (5): KerbMeasurement, Whether the measurement sits clear of its bucket edges by more than its sigma., Whether the measurement can distinguish compliant from not. Almost always false…, SidewalkMeasurement, test_metric_cross_section_promotes_to_measured_surface_rows()

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

### Community 85 - "_get"
Cohesion: 0.22
Nodes (5): _get(), ProjectSidewalkClient, Any, Project Sidewalk — independent human accessibility labels. Free, no key. 50+…, Fetch and parse JSON. The single network entry point for this module.

### Community 86 - "UploadState"
Cohesion: 0.33
Nodes (6): UploadState, DONE, FAILED, PENDING, REDACTED, UPLOADING

### Community 87 - "MegaLocDescriptor"
Cohesion: 0.14
Nodes (11): available(), best_device(), MegaLocConfig, MegaLocDescriptor, ndarray, MegaLoc — the production global descriptor. DINOv2-base with a SALAD…, Resize, scale to [0, 1], and normalise. Batched to amortise the transfer., Describe several frames at once. The only sensible way to index a survey pass. (+3 more)

### Community 88 - "cameraroll.py"
Cohesion: 0.18
Nodes (13): _cell_for(), default_sources(), ingest(), IngestReport, photos_library_readable(), Path, Ingesting photographs from a folder into the journal. The stand-in for the…, Assign a coverage cell. Real captures get an H3 cell from GPS. Camera-roll… (+5 more)

### Community 89 - "SidewalkSegment"
Cohesion: 0.14
Nodes (9): One run of sidewalk along a block face, with everything on it., Narrowest point — the number a wheelchair or robot actually has to fit through., SidewalkSegment, cumulative_step_at(), ndarray, Stations along the segment, refined around every feature that needs resolution.…, Total vertical displacement accumulated by joint steps up to a station. Joint…, station_grid() (+1 more)

### Community 90 - "deploy.sh"
Cohesion: 0.60
Nodes (4): die(), PATH, say(), deploy.sh script

### Community 92 - "mapillary.py"
Cohesion: 0.07
Nodes (26): ImageAsset, A resolved, currently-valid way to fetch one observation's pixels., _f(), _i(), MapillaryCredentialMissing, MapillaryProvider, _point(), _projection() (+18 more)

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

### Community 104 - "OvertureClient"
Cohesion: 0.20
Nodes (5): OvertureClient, Overture Maps — building footprints and road centrelines. Free, no key.…, Whether output derived from this theme carries ODbL obligations., A DuckDB SQL query reading the theme directly from open data., Buildings are the useful anchor theme and the share-alike one. Easy to forget.

### Community 105 - "photobank.py"
Cohesion: 0.05
Nodes (53): build_photo_bank(), GlassesProfile, datetime, A photo bank matching what a phone app actually receives from Meta glasses. The…, Where a walking wearer's camera is, and where it points. A wearer looks roughly…, Walk a contributor down the corridor and bank what the glasses would deliver.…, Delivered camera characteristics for Meta AI glasses via the DAT. ``fov_deg``…, What the hardware captures, for the ratio that matters. (+45 more)

### Community 106 - "harvest_region_observations.py"
Cohesion: 0.17
Nodes (19): build_provider(), collect(), _journal_path(), main(), Observation, Path, Whatever a previous run got as far as writing., read_journal() (+11 more)

### Community 108 - "archive"
Cohesion: 0.57
Nodes (6): archive(), archived_hashes(), digest(), main(), Path, Archive new capture photos into a Git-friendly dataset folder. The default…

### Community 109 - "20260902T023431Z/manifest.json"
Cohesion: 0.22
Nodes (8): count, created_at, max_width, mode, quality, records, skipped, source

### Community 110 - "OverpassClient"
Cohesion: 0.29
Nodes (3): OverpassClient, OpenStreetMap Overpass API — sidewalk, crossing and kerb tags. Free, no key.…, Overpass QL for pedestrian infrastructure in a bounding box.

### Community 111 - "Scalable Observation Storage"
Cohesion: 0.33
Nodes (5): Byte Policy, Current SF Manifest, Preservation Tiers, Repository Roles, Scalable Observation Storage

### Community 112 - "waymo.py"
Cohesion: 0.19
Nodes (17): main(), AccessReport, active_account(), check_access(), component_path(), _filesystem(), RuntimeError, Waymo Open Dataset: access, and the terms that come with it. Waymo drove San… (+9 more)

### Community 113 - "17 · Measured kerbs, and where the lidar actually is"
Cohesion: 0.09
Nodes (21): 16 · Sweeping the corridor for every observation, A note on neighbour links, Reproducing it, The place-shaped read, The result, What is kept, Why the sequence-shaped read failed, 17 · Measured kerbs, and where the lidar actually is (+13 more)

### Community 114 - "12 · Installing it, and what the shutter refuses"
Cohesion: 0.33
Nodes (5): 12 · Installing it, and what the shutter refuses, A frame off the narrow lens, A frame with no position, The shutter refuses two things, What a "download" is here

### Community 115 - "encode_png"
Cohesion: 0.12
Nodes (15): _decode_png(), export_contact_sheet(), ndarray, Path, Tile a sample of the bank into one image, for eyeballing what was captured., Minimal decoder for the images this project writes (filter 0, 8-bit RGB)., Software rendering — turning simulated geometry into actual images., _chunk() (+7 more)

### Community 116 - "WorldFact"
Cohesion: 0.08
Nodes (15): BaseModel, model_validator, Record that this measurement disagrees with a reference, keeping the…, One assertion about one place, with everything needed to judge whether to trust…, WorldFact, GroundTruthFact, An exact value at an exact place, from simulation, survey, or municipal record., Signed error for numeric facts; ``None`` for categorical ones (use ``matches``). (+7 more)

### Community 117 - "DriveConfig"
Cohesion: 0.18
Nodes (11): baseline_between_frames_m(), DriveConfig, plan_capture_stations(), Forward distance between consecutive captures — the multi-view triangulation…, Generate the capture record for a drive without rendering. Produces exactly the…, Stations at which frames will be captured, given speed and capture rate. Pure…, simulate_drive(), Why rigid stereo is for scale and motion stereo is for precision. (+3 more)

### Community 125 - "OpenCVMatcher"
Cohesion: 0.24
Nodes (5): OpenCVMatcher, A real :class:`~smc.mapping.anchoring.FeatureMatcher`. Holds the query image's…, Pixel coordinates the match indices refer to., An oracle-seeded frame cannot be matched against; skipping beats a silent zero., TestOpenCVMatcher

### Community 126 - "scenario.py"
Cohesion: 0.16
Nodes (12): CaptureFrame, carla_available(), Any, Path, CARLA runtime. ``carla`` is imported lazily and the module is usable without…, Write the ingest manifest — engine-visible fields only. The true pose is…, Run the drive in CARLA and write images. Requires a running CARLA server and…, Whether the CARLA Python API can be imported in this interpreter. (+4 more)

### Community 127 - "PhotoMeta"
Cohesion: 0.29
Nodes (3): PhotoMeta, What a photograph tells us about the camera that took it., Pinhole focal length in pixels, from the 35 mm equivalent. ``focal_px =…

### Community 128 - "CV/Depth Storage"
Cohesion: 0.50
Nodes (3): CV/Depth Storage, Promotion Path, Provenance

### Community 134 - "AnchorImagerySource"
Cohesion: 0.20
Nodes (7): AnchorImagerySource, MetricDepthSource, Protocol, Street-level imagery to anchor captures against., Refines a rough position using a camera frame. The load-bearing accuracy step., Per-pixel metric depth. Feeds the scale estimator., VisualPositioningSource

### Community 135 - "LocalizationResult"
Cohesion: 0.24
Nodes (6): LocalizationResult, A refined camera pose from a visual positioning service., ArCoreGeospatial, OwnedAnchoring, ARCore Geospatial VPS — internal build only. Solves anchoring outright: sub-…, The commercial-safe anchoring stack: retrieval, matching, and pose against…

### Community 139 - "Waymo Open Dataset — provenance of access"
Cohesion: 0.33
Nodes (5): How to make this clean, Waymo Open Dataset — provenance of access, What it does and does not change, What the mirror is, What was decided

## Knowledge Gaps
- **226 isolated node(s):** `EMPTY`, `COMPLETE`, `PARTIAL`, `DEFERRED`, `FAILED` (+221 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **18 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `intrinsics()` connect `photobank.py` to `ReferenceFrame`, `Pose`, `photos.py`, `capture.py`, `pipeline.py`?**
  _High betweenness centrality (0.028) - this node is a cross-community bridge._
- **Why does `content_id()` connect `LocalFrameStore` to `test_phone_pipeline.py`, `LocalPhotoJournal`, `capture.py`, `photobank.py`?**
  _High betweenness centrality (0.027) - this node is a cross-community bridge._
- **Why does `LocalFrameStore` connect `LocalFrameStore` to `ReferenceFrame`, `photobank.py`, `encode_png`, `capture.py`, `pipeline.py`?**
  _High betweenness centrality (0.025) - this node is a cross-community bridge._
- **Are the 5 inferred relationships involving `LocalPhotoJournal` (e.g. with `ingest()` and `run_batch()`) actually correct?**
  _`LocalPhotoJournal` has 5 INFERRED edges - model-reasoned connections that need verification._
- **Are the 15 inferred relationships involving `Pose` (e.g. with `ContributorFrame` and `pose_at_station()`) actually correct?**
  _`Pose` has 15 INFERRED edges - model-reasoned connections that need verification._
- **Are the 7 inferred relationships involving `LocalFrameStore` (e.g. with `contributor_pass()` and `bank_summary()`) actually correct?**
  _`LocalFrameStore` has 7 INFERRED edges - model-reasoned connections that need verification._
- **Are the 8 inferred relationships involving `ReferenceFrame` (e.g. with `AnchoringPipeline` and `FeatureMatcher`) actually correct?**
  _`ReferenceFrame` has 8 INFERRED edges - model-reasoned connections that need verification._