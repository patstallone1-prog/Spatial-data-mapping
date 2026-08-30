# Graph Report - spatial-mapping-crowdsource  (2026-08-28)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 1860 nodes · 3868 edges · 102 communities (90 shown, 12 thin omitted)
- Extraction: 93% EXTRACTED · 7% INFERRED · 0% AMBIGUOUS · INFERRED: 268 edges (avg confidence: 0.94)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `1f1a0b7b`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Community 0
- Community 1
- Community 2
- Community 3
- Community 4
- Community 5
- Community 6
- Community 7
- Community 8
- Community 9
- Community 10
- Community 11
- Community 12
- Community 13
- Community 14
- Community 15
- Community 16
- Community 17
- Community 18
- Community 19
- Community 20
- Community 21
- Community 22
- Community 23
- Community 24
- Community 25
- Community 26
- Community 27
- Community 28
- Community 29
- Community 30
- Community 31
- Community 32
- Community 33
- Community 34
- Community 35
- Community 36
- Community 37
- Community 38
- Community 39
- Community 40
- Community 41
- Community 42
- Community 43
- Community 44
- Community 45
- Community 46
- Community 47
- Community 48
- Community 49
- Community 50
- Community 51
- Community 52
- Community 53
- Community 54
- Community 55
- Community 56
- Community 57
- Community 58
- Community 59
- Community 60
- Community 61
- Community 62
- Community 63
- Community 64
- Community 65
- Community 66
- Community 67
- Community 68
- Community 69
- Community 70
- Community 71
- Community 72
- Community 73
- Community 74
- Community 75
- Community 76
- Community 77
- Community 78
- Community 79
- Community 80
- Community 81
- Community 82
- Community 83
- Community 84
- Community 85
- Community 86
- Community 87
- Community 88
- Community 89
- Community 90
- Community 91
- Community 92
- Community 93
- Community 94
- Community 95
- Community 96
- Community 97
- Community 98
- Community 100

## God Nodes (most connected - your core abstractions)
1. `Pose` - 41 edges
2. `LocalPhotoJournal` - 41 edges
3. `LocalFrameStore` - 30 edges
4. `ReferenceFrame` - 30 edges
5. `build_corridor()` - 30 edges
6. `FeatureConfig` - 27 edges
7. `RigConfig` - 27 edges
8. `detect()` - 25 edges
9. `measure_cross_section()` - 24 edges
10. `run_pipeline()` - 24 edges

## Surprising Connections (you probably didn't know these)
- `TestEncoding` --uses--> `ImageFormat`  [INFERRED]
  tests/test_phone_pipeline.py → src/smc/curate/compress.py
- `TestCompression` --uses--> `ImageFormat`  [INFERRED]
  tests/test_phone.py → src/smc/curate/compress.py
- `TestBaselineTrigger` --uses--> `MotionState`  [INFERRED]
  tests/test_capture.py → src/smc/capture/trigger.py
- `TestBaselineTrigger` --uses--> `Suppression`  [INFERRED]
  tests/test_capture.py → src/smc/capture/trigger.py
- `TestBaselineTrigger` --uses--> `TriggerConfig`  [INFERRED]
  tests/test_capture.py → src/smc/capture/trigger.py

## Import Cycles
- None detected.

## Communities (102 total, 12 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.05
Nodes (39): disagreement_flag(), Flag a conflict between a measurement and a reference, keeping the measurement.…, 3D mapping accuracy: anchoring, metric scale, and the confidence model., ndarray, Candidates near ``(lat, lon)``, ranked by descriptor similarity. ``radius_m``…, RetrievalHit, from_camera_height(), from_gnss_baseline() (+31 more)

### Community 1 - "Community 1"
Cohesion: 0.06
Nodes (32): RuntimeError, assess_people(), _cascade(), detect_people(), Detection, PeopleAssessment, PeopleConfig, _prepare() (+24 more)

### Community 2 - "Community 2"
Cohesion: 0.08
Nodes (20): Capture ingest: the frame store and the simulated capture run., content_id(), FrameRecord, FrameStore, LocalFrameStore, object_store_uri(), datetime, Path (+12 more)

### Community 3 - "Community 3"
Cohesion: 0.06
Nodes (22): Street-map overlay: putting captures and facts onto a flat map., corridor_street_map(), MapFrame, ndarray, Lateral offset of the kerb line from the centreline, signed by side. The hint…, A street-aligned basis: along the kerb, across the footway, up. Measurements…, ENU points into the street frame: +x along, +y across, +z up., Where a pose sits on the street network. (+14 more)

### Community 4 - "Community 4"
Cohesion: 0.08
Nodes (22): AnchoringConfig, AnchoringPipeline, FeatureMatcher, ndarray, Protocol, The anchoring stack — Step 3 of the fusion engine. Rough GPS puts a capture on…, Inverse-variance combination of the references' own uncertainties. Not the…, Local feature matching between a query and a reference frame. Production… (+14 more)

### Community 5 - "Community 5"
Cohesion: 0.08
Nodes (29): bank_summary(), BankFrame, build_photo_bank(), _decode_png(), export_contact_sheet(), GlassesProfile, datetime, ndarray (+21 more)

### Community 6 - "Community 6"
Cohesion: 0.07
Nodes (24): Assessor, BatchOutcome, COMPLETE, DEFERRED, EMPTY, FAILED, PARTIAL, BatchPolicy (+16 more)

### Community 7 - "Community 7"
Cohesion: 0.08
Nodes (21): estimate_kerb_offset(), fit_plane_ransac(), perpendicular_extent(), Plane, ndarray, Plane fitting for the road and the walking surface. The two planes are the…, Find the lateral position of the kerb line by scanning for the largest height…, Find the road and walking surfaces, and the step between them. Splits laterally… (+13 more)

### Community 8 - "Community 8"
Cohesion: 0.10
Nodes (15): LocalPhotoJournal, new_entry(), datetime, Path, Overwrite the pixels in place, keeping the identity. Used by compression. The…, Delete pixels and rows. The only method that removes data. Returns how many…, Build an entry for a payload, with the content hash as its identity., Filesystem plus SQLite. The phone's working set. (+7 more)

### Community 9 - "Community 9"
Cohesion: 0.12
Nodes (32): BlockFace, DrivewayApron, Obstruction, Hierarchical sampling of pedestrian right-of-way geometry. Sampling is…, Latent state shared by everything on one block face., Sample the latent state of one block face., Sample one run of sidewalk, conditioned on its block face., Displacement at panel joints, with root-heave clustering. Most joints are flat.… (+24 more)

### Community 10 - "Community 10"
Cohesion: 0.11
Nodes (17): CompressionPlan, CompressionProfile, fits_budget(), frames_within_budget(), plan_compression(), Compression policy for the daily batch. No codec is written here and none…, Estimate the daily batch size before encoding any of it. Worth knowing in…, How many frames fit in a budget. Sets the curator's daily cap on a metered plan. (+9 more)

### Community 11 - "Community 11"
Cohesion: 0.13
Nodes (16): MotionState, ctx(), CaptureContext, parametrize, Suppression, Tests for the capture trigger., The correction that clock-triggering got wrong., The property triangulation needs: frame spacing should not swing with speed. (+8 more)

### Community 12 - "Community 12"
Cohesion: 0.09
Nodes (22): Software rendering — turning simulated geometry into actual images., ndarray, A z-buffered triangle rasteriser. CARLA renders far better images than this,…, Rasterise triangles into an image, depth buffer and world-position buffer.…, Split triangles until no edge exceeds ``max_edge_m``. Necessary because the…, Subdivide a uniformly coloured batch, keeping colours aligned., A rendered view and the buffers that make it useful as training or test data., Fraction of the frame showing geometry rather than sky. (+14 more)

### Community 13 - "Community 13"
Cohesion: 0.11
Nodes (12): BoundingBox, _get(), NominatimClient, OverpassClient, ProjectSidewalkClient, Any, Services that need no credential at all. Everything here is wired end to end…, OpenStreetMap geocoding. Free, no key, ODbL, 1 request/second maximum. The rate… (+4 more)

### Community 14 - "Community 14"
Cohesion: 0.11
Nodes (18): AdapterUnavailable, AnchorImagerySource, LocalizationResult, MetricDepthSource, Protocol, Provider-agnostic interfaces. Each capability is a Protocol with at least two…, Raised when an adapter is selected but its credential or dependency is missing., A refined camera pose from a visual positioning service. (+10 more)

### Community 15 - "Community 15"
Cohesion: 0.10
Nodes (11): NtripMountpoint, OpenFreeMapTiles, OvertureClient, Overture Maps — building footprints and road centrelines. Free, no key.…, Whether output derived from this theme carries ODbL obligations., A DuckDB SQL query reading the theme directly from open data., Vector basemap tiles. Free, no key, unlimited, MIT, OSM data. Chosen over…, An RTK correction stream on the RTK2go community caster. Free, no rover… (+3 more)

### Community 16 - "Community 16"
Cohesion: 0.11
Nodes (17): focal_px_from_interior(), PanoramaxImage, PanoramaxImagery, _parse_feature(), Any, datetime, Panoramax — the default anchor-imagery source. Panoramax is street-level…, Captures near a point, freshest-first. (+9 more)

### Community 17 - "Community 17"
Cohesion: 0.17
Nodes (17): The same statistics on simulated frames, for comparison. Printed beside the…, _render_baseline(), detect(), FeatureConfig, Features, _geometric_filter(), _grayscale(), match_features() (+9 more)

### Community 18 - "Community 18"
Cohesion: 0.12
Nodes (11): build_destination(), GcsConfig, GcsDestination, JournalEntry, Verify credentials and bucket before a batch depends on them. Worth running at…, Build a destination from a URL or a path. ``gs://bucket/prefix`` gives GCS;…, Parse ``gs://bucket/optional/prefix``., Google Cloud Storage. Authentication is Application Default Credentials —… (+3 more)

### Community 19 - "Community 19"
Cohesion: 0.12
Nodes (22): AffineView, _compose(), default_views(), detect_multi_view(), _invert(), ndarray, Affine view simulation — bridging the vantage gap. The measured failure this…, Compose two 2x3 affines: apply ``first``, then ``second``. (+14 more)

### Community 20 - "Community 20"
Cohesion: 0.12
Nodes (15): KerbMeasurement, measure_cross_section(), MeasurementConfig, ndarray, Measure kerb and footway from the reconstructed points around one station.…, Whether the measurement sits clear of its bucket edges by more than its sigma., Whether the measurement can distinguish compliant from not. Almost always false…, SidewalkMeasurement (+7 more)

### Community 21 - "Community 21"
Cohesion: 0.16
Nodes (18): The world-facts model — the thing the product actually sells., FactClass, Provenance, datetime, The served world-fact. Two rules from the re-spec are enforced here as…, Accuracy tier. Sets what may be claimed about a fact (re-spec 8.3)., Tier, tier_for_class() (+10 more)

### Community 22 - "Community 22"
Cohesion: 0.11
Nodes (17): BaseModel, model_validator, Record that this measurement disagrees with a reference, keeping the…, One assertion about one place, with everything needed to judge whether to trust…, WorldFact, FrameOutcome, _intrinsics_for(), PipelineResult (+9 more)

### Community 23 - "Community 23"
Cohesion: 0.11
Nodes (13): Capability, check(), Credential, CredentialReport, providers_for(), Every external service this system can talk to, and what it needs to…, What an adapter provides. One capability, many possible providers., One secret or setting the operator has to supply. (+5 more)

### Community 24 - "Community 24"
Cohesion: 0.16
Nodes (20): discover(), evaluate_directory(), evaluate_pair(), group_by_position(), main(), PairResult, Path, Calibrating the feature front end against real photographs. The simulator can… (+12 more)

### Community 25 - "Community 25"
Cohesion: 0.13
Nodes (14): Row, Destination, Protocol, Where the nightly batch goes. Every destination must **confirm receipt**, not…, EntryState, JournalEntry, mark(), The on-device photo journal — a real implementation, not an interface. SQLite… (+6 more)

### Community 26 - "Community 26"
Cohesion: 0.13
Nodes (14): Layer A — deciding when to open the shutter., CaptureContext, CaptureDecision, The capture trigger. Never stream. Open the shutter only when a frame is likely…, Everything the trigger sees at one instant., Stateful evaluator. One per capture session. Ordering is load-bearing. Device-…, Why frames were skipped, over the session. The field diagnostic., Dead-reckon distance from speed. Speed is used rather than successive GNSS… (+6 more)

### Community 27 - "Community 27"
Cohesion: 0.12
Nodes (12): CameraSpec, CaptureSettings, default_rig(), Sensor rig definitions. The rig mirrors the physical Tier 2 vehicle rig in…, Intrinsics and mounting for one camera, matching Arducam AR0234 on the vehicle…, Pinhole focal length in pixels — needed by every metric-depth conversion., A synchronised pair on a rigid baseline — the rig's source of metric scale.…, Range beyond which stereo can no longer meet a depth tolerance. (+4 more)

### Community 28 - "Community 28"
Cohesion: 0.14
Nodes (16): pose_at_station(), ndarray, Camera and driving parameters for a pass., The camera pose at a station along the corridor., RigConfig, corridor_triangles(), Flatten a corridor's meshes into triangles plus per-triangle colours. A road…, Render a simulated corridor from a camera pose. (+8 more)

### Community 29 - "Community 29"
Cohesion: 0.17
Nodes (8): ConfidenceModel, Observation, datetime, Saturating in the number of independent contributors. Diminishing returns are…, One contributor's measurement of one fact., Turns a set of observations into a confidence and a provenance., 40 frames from one wearer is one observer, not 40., TestConfidence

### Community 30 - "Community 30"
Cohesion: 0.13
Nodes (18): MotionState, Straight from the OS activity classifier — not reimplemented. iOS…, contributor_pass(), ContributorFrame, datetime, Simulated capture runs. Two kinds of pass, mirroring the two hardware tiers: *…, Drive a monocular contributor down the corridor, through the real capture…, Render once per station, reusing the flattened scene across the whole pass. (+10 more)

### Community 31 - "Community 31"
Cohesion: 0.15
Nodes (16): assess(), Assessment, CurationResult, dhash(), ndarray, Deciding which captures are worth keeping, on the phone, before anything is…, Area-averaged downscale to a fixed size, as grayscale. Averaging, not sampling.…, Variance of the Laplacian, normalised by image contrast. Raw Laplacian variance… (+8 more)

### Community 32 - "Community 32"
Cohesion: 0.16
Nodes (12): build_anchor_imagery(), build_visual_positioning(), MapillaryImagery, ProviderChoice, Construct an anchor-imagery provider. ``allow_internal_only`` must be passed…, Mapillary API v4 — kept as a fallback, no longer the default. Imagery is CC BY-…, The query this adapter would issue. Separated so it can be asserted in tests., MonkeyPatch (+4 more)

### Community 33 - "Community 33"
Cohesion: 0.13
Nodes (11): GaitConfig, GaitSimulator, ndarray, Realistic walking pace. Nobody walks at a constant speed. Real pedestrian pace…, Pedestrian pace parameters. Defaults are ordinary adult walking., Generates a speed trace for one walk., Advance and return the current speed., A full speed trace, for analysis and tests. (+3 more)

### Community 34 - "Community 34"
Cohesion: 0.11
Nodes (12): One run of sidewalk along a block face, with everything on it., Narrowest point — the number a wheelchair or robot actually has to fit through., SidewalkSegment, cross_section_at(), CrossSection, cumulative_step_at(), Parametric geometry for sampled right-of-way features. CARLA cannot supply…, Total vertical displacement accumulated by joint steps up to a station. Joint… (+4 more)

### Community 35 - "Community 35"
Cohesion: 0.15
Nodes (15): ImageFormat, Rough encoded size at the default quality. Conservative on purpose., BatchReport, next_window(), datetime, The nightly batch, fully implemented. Assess, delete rejects immediately,…, The next scheduled run after ``now``, in **local** time. The hour is local by…, _batch() (+7 more)

### Community 36 - "Community 36"
Cohesion: 0.12
Nodes (16): load_image(), ndarray, Load a photograph with EXIF orientation applied. Orientation is not optional.…, DegradationConfig, DegradationReport, degrade(), DeliveryMode, estimated_fov_deg() (+8 more)

### Community 37 - "Community 37"
Cohesion: 0.13
Nodes (11): GnssErrorModel, GnssSimulator, mean_horizontal_deviation(), ndarray, Advance by ``dt_s`` and return the ENU error vector in metres., Mean 2D error magnitude — the statistic the literature reports for crowdsourced…, Parameters of the error process, per horizontal axis unless noted., Stateful error generator. One instance per receiver per drive. (+3 more)

### Community 38 - "Community 38"
Cohesion: 0.15
Nodes (16): Drive the RTK rig down the corridor at fixed spacing. Fixed spacing rather than…, survey_pass(), main(), Namespace, Generate seed data and run the end-to-end simulation. python -m smc.ingest seed…, _seed(), Build a reference index from a survey pass., Survey a corridor from every vantage class into one index. The practical answer… (+8 more)

### Community 39 - "Community 39"
Cohesion: 0.25
Nodes (10): BatchPolicy, Run one night's batch., run_batch(), DirectoryDestination, Path, Write to a folder — a synced drive, an external disk, a mount point. Confirmed…, Path, The journal is the only copy until the far end confirms. (+2 more)

### Community 40 - "Community 40"
Cohesion: 0.17
Nodes (10): load_env_file(), Path, Runtime configuration, loaded from the environment and an optional local file.…, Read ``KEY=value`` lines into the environment. Returns what it set., Render a config value safely for logs., Everything the pipeline reads from the environment., redact(), Settings (+2 more)

### Community 41 - "Community 41"
Cohesion: 0.17
Nodes (14): _cell_for(), default_sources(), ingest(), IngestReport, photos_library_readable(), Path, Ingesting photographs from a folder into the journal. The stand-in for the…, Assign a coverage cell. Real captures get an H3 cell from GPS. Camera-roll… (+6 more)

### Community 42 - "Community 42"
Cohesion: 0.11
Nodes (9): _curb_fields(), _noncompliance_rate(), Tests for the right-of-way sampling model. These assert the properties the…, Recall on 'no ramp here' is unmeasurable if the sim never omits one., A high-quality block face must depart from the standard less often than a poor…, TestCorners, TestHierarchy, TestSlopeMixture (+1 more)

### Community 43 - "Community 43"
Cohesion: 0.20
Nodes (11): baseline_between_frames_m(), DriveConfig, plan_capture_stations(), Forward distance between consecutive captures — the multi-view triangulation…, Generate the capture record for a drive without rendering. Produces exactly the…, Stations at which frames will be captured, given speed and capture rate. Pure…, simulate_drive(), Why rigid stereo is for scale and motion stereo is for precision. (+3 more)

### Community 44 - "Community 44"
Cohesion: 0.23
Nodes (8): curate(), CurationConfig, Decide the day's batch. Order matters and is not arbitrary. Quality gates run…, Thresholds. Every one is a trade between upload cost and coverage., Verdict, An absolute threshold would drop a whole batch of a low-texture scene., A budget cut must not spend the whole day on one street., TestCuration

### Community 45 - "Community 45"
Cohesion: 0.25
Nodes (11): load_photo(), ndarray, Load a photograph as RGB, with EXIF orientation applied.…, Write a JPEG carrying iPhone-like EXIF, for testing the loader without a phone.…, write_synthetic_iphone_photo(), Path, An iPhone shoots eight times the pixels the toolkit hands over., A photo-like frame: low-frequency structure plus fine texture. Pure noise is… (+3 more)

### Community 46 - "Community 46"
Cohesion: 0.16
Nodes (10): baseline_for_depth_tolerance_m(), overlap_fraction(), perceptual_distance(), Normalised Hamming distance between two perceptual hashes. A hash rather than a…, Fraction of the frame footprint shared by consecutive captures. Multi-view…, Baseline needed to resolve depth at ``range_m`` to ``tolerance_m``. The same…, Capture rate needed to hold a minimum overlap. The inverse of…, required_capture_hz() (+2 more)

### Community 47 - "Community 47"
Cohesion: 0.18
Nodes (12): corridor_facades(), Facade, facade_triangles(), ndarray, Building facades along a corridor. Not scenery. The re-spec's Step 3 anchors a…, Every facade triangle in a corridor, with per-triangle colours., One building frontage along the block., Sample the frontages on one block face. Identity-seeded like everything else,… (+4 more)

### Community 48 - "Community 48"
Cohesion: 0.15
Nodes (13): distance_m(), enu_to_geodetic(), gaussian_radius_m(), geodetic_to_enu(), haversine_m(), Origin, Local tangent-plane geodesy. The simulator works in metres on a flat local…, Great-circle distance over long ranges. Retained for distances where earth… (+5 more)

### Community 49 - "Community 49"
Cohesion: 0.15
Nodes (6): Pose, Gauss-Newton refinement of reprojection error, Huber-weighted. Huber rather…, World-to-camera rigid transform., refine_pose(), The single easiest thing to get backwards in this whole module., TestPose

### Community 50 - "Community 50"
Cohesion: 0.17
Nodes (10): build_dome_field(), Truncated-dome detectable warning field. Domes are 0.9 in across and 0.2 in…, curb_height_bucket(), Assemble a simulated corridor and its ground truth. This is the bridge between…, Bucket a continuous height. The graded quantity is the bucket, not the…, inches(), parametrize, Tests for mesh construction and the corridor build. The central assertion is… (+2 more)

### Community 51 - "Community 51"
Cohesion: 0.18
Nodes (11): Mesh, A triangle mesh in a local frame: +x along the kerb, +y into the sidewalk, +z…, main(), Generate a corridor: meshes for the renderer, ground truth for the checker.…, Path, Wavefront OBJ export. OBJ rather than a CARLA-native format on purpose: CARLA…, Write meshes to a single OBJ, one named group per mesh. OBJ vertex indices are…, write_obj() (+3 more)

### Community 52 - "Community 52"
Cohesion: 0.20
Nodes (9): build_corridor(), CorridorSegment, export_ground_truth(), PlacedRamp, Lay out block faces along a corridor, with a corner at each block boundary., The exact answer key for the corridor., A corner with no ramp must be an assertable fact, not a gap in the data., TestCorridor (+1 more)

### Community 53 - "Community 53"
Cohesion: 0.17
Nodes (6): GroundTruthFact, An exact value at an exact place, from simulation, survey, or municipal record., Signed error for numeric facts; ``None`` for categorical ones (use ``matches``)., Exact match for categorical and boolean facts., Truth is a different type on purpose; it must not be confusable with a served…, TestFactsAndTruthAreDistinct

### Community 54 - "Community 54"
Cohesion: 0.14
Nodes (13): discover_photos(), _open(), Path, Reading real photographs, including iPhone HEIC. Three things routinely go…, Pull the few EXIF fields that matter. Absent EXIF is normal, not an error., Latitude, longitude and accuracy from the GPS IFD. EXIF stores position as…, _read_exif(), _read_gps() (+5 more)

### Community 55 - "Community 55"
Cohesion: 0.17
Nodes (7): FrameDescriptor, ndarray, Protocol, Frame descriptors. Production is **MegaLoc** — DINOv2-base with a SALAD…, Downsampled greyscale, mean-centred and L2-normalised. Mean-centring before…, TinyImageDescriptor, TestDescriptors

### Community 56 - "Community 56"
Cohesion: 0.17
Nodes (9): ndarray, Camera position in world coordinates. Not ``translation``., World points to camera frame. Accepts (N, 3)., Rodrigues formula. A zero vector gives identity rather than a division by zero., Inverse of :func:`rotation_from_rotvec`, stable at 0 and pi., Camera at ``eye`` looking at ``target``, with +z as the optical axis. Building…, rotation_from_rotvec(), rotvec_from_rotation() (+1 more)

### Community 57 - "Community 57"
Cohesion: 0.19
Nodes (7): Frame, BlobUploader, ByteArray, QueuedFrame, Redactor, TransferPolicy, UploadQueue

### Community 58 - "Community 58"
Cohesion: 0.19
Nodes (6): CoverageCell, CoverageIndex, Server-pushed coverage state for one H3 cell. The novelty trigger cannot be…, Local mirror of the server's coverage bitmap. Small enough to hold a city at…, Failing safe costs one upload; failing the other way costs weeks of coverage., TestCoverageIndex

### Community 59 - "Community 59"
Cohesion: 0.16
Nodes (9): AnchorResult, Anchor one capture, or return ``None`` if it cannot be anchored confidently.…, Compass heading of the camera's optical axis, degrees clockwise from north. The…, Whether this pose is good enough to carry coarse geometry (re-spec 8.3 Tier B)., pose_covariance(), position_sigma_m(), 6x6 covariance of the pose parameters (rotvec, translation). Linearised at the…, Horizontal 1-sigma position uncertainty from a pose covariance. Uses the… (+1 more)

### Community 60 - "Community 60"
Cohesion: 0.25
Nodes (8): ransac_pnp(), Linear pose from >= 6 correspondences (Direct Linear Transform). Fast,…, Robust pose from noisy, partly wrong correspondences. Returns ``None`` rather…, solve_pnp_dlt(), ndarray, A refusal costs one unanchored frame; a wrong pose corrupts every fact from it., scene(), TestPnp

### Community 61 - "Community 61"
Cohesion: 0.18
Nodes (6): CaptureContext, CaptureDecision, TriggerConfig, CameraSource, MockCameraSource, WearablesCameraSource

### Community 62 - "Community 62"
Cohesion: 0.14
Nodes (14): Suppression, MOTION_STATE, NO_BASELINE, NO_NOVELTY, NONE, POOR_FIX, POWER, PRIVACY_ZONE (+6 more)

### Community 63 - "Community 63"
Cohesion: 0.19
Nodes (9): build_segment_mesh(), measure_curb_height(), Loft a segment's cross-sections into a triangle mesh., Recover curb height from mesh vertices — the inverse of the generator. Used by…, FidelityReport, Whether the rendered geometry actually carries the sampled parameters., Recover curb height from the meshes and compare against what was sampled.…, verify_mesh_fidelity() (+1 more)

### Community 64 - "Community 64"
Cohesion: 0.18
Nodes (6): audit(), ProfileAudit, Build a profile from measured data. The intended path off the estimates. Every…, Which parts of a profile are standards and which are guesses., Classify every numeric field of a profile by provenance., TestProfileAudit

### Community 65 - "Community 65"
Cohesion: 0.15
Nodes (11): CaptureFrame, carla_available(), Any, Path, Write the ingest manifest — engine-visible fields only. The true pose is…, Run the drive in CARLA and write images. Requires a running CARLA server and…, Whether the CARLA Python API can be imported in this interpreter., One captured frame and everything the ingest pipeline receives with it.… (+3 more)

### Community 66 - "Community 66"
Cohesion: 0.15
Nodes (4): The rule most likely to be lost between layers. Checked at the far end., A loose bound on purpose. With strict matching only a handful of frames anchor…, Real feature matching, no oracle. Yield is materially below 1.0 and that is the…, TestFullStack

### Community 67 - "Community 67"
Cohesion: 0.24
Nodes (5): CaptureDecision, CaptureContext, Suppression, TriggerEngine, TriggerConfig

### Community 68 - "Community 68"
Cohesion: 0.22
Nodes (6): ImageRef, A street-level image available for anchoring., Download one image. Transient: used for anchoring, then discarded., Google Street View Static API — internal build only. Maps Platform terms forbid…, Fetch image metadata near a point. Returns metadata only. The imagery itself is…, StreetViewImagery

### Community 69 - "Community 69"
Cohesion: 0.18
Nodes (7): intrinsics(), _iterations_needed(), PnpResult, Camera pose geometry: projection, PnP, and robust estimation. This is the…, How many RANSAC samples are needed to see one all-inlier set, with…, Pinhole intrinsics with square pixels and no skew., Tests for pose geometry, retrieval, and the anchoring pipeline. Pose recovery…

### Community 70 - "Community 70"
Cohesion: 0.29
Nodes (10): _fetch(), main(), Path, Assemble the self-contained dataset the web map ships with. An Artifact runs…, Drop collinear vertices. Straight city blocks carry a lot of redundant nodes., Small JPEGs of the capture session, inlined as data URIs., road_query(), simplify() (+2 more)

### Community 71 - "Community 71"
Cohesion: 0.20
Nodes (9): BlockProfile, CurbHeightProfile, RampProfile, Sampling profiles for pedestrian right-of-way geometry. A simulation whose…, Sidewalk running surface: width, cross slope, condition, and joint displacement., Block-face level structure: construction era and build quality., Curb height as a class mixture with per-class continuous spread. Height is…, Curb ramp geometry, modelled as compliant population plus a non-compliant tail. (+1 more)

### Community 72 - "Community 72"
Cohesion: 0.20
Nodes (4): Detector, Image retrieval — finding which captures show the same place. Step 4 of the…, Tests for real feature detection and matching., TestDetection

### Community 73 - "Community 73"
Cohesion: 0.24
Nodes (5): OpenCVMatcher, A real :class:`~smc.mapping.anchoring.FeatureMatcher`. Holds the query image's…, Pixel coordinates the match indices refer to., An oracle-seeded frame cannot be matched against; skipping beats a silent zero., TestOpenCVMatcher

### Community 74 - "Community 74"
Cohesion: 0.28
Nodes (5): hamming(), blurred(), ndarray, Tests for phone-side photo handling, curation, and compression., TestCurationSignals

### Community 75 - "Community 75"
Cohesion: 0.22
Nodes (5): ratio_from_slope(), Unit conversion. Every accessibility standard this project is measured against…, Slope as a fraction (0.0833 for 1:12). Raises on a zero run., Slope fraction to the run of a 1:N ratio. 0.0833 -> 12.0., slope_from_ratio()

### Community 76 - "Community 76"
Cohesion: 0.25
Nodes (6): corridor(), fixture, Tests for config, rendering, the frame store, seeding, and the end-to-end slice., The failure that silently deleted the road: too few passes, no error raised., rig(), TestSubdivision

### Community 77 - "Community 77"
Cohesion: 0.22
Nodes (3): The checker compares positions metres apart. There the metric must be exact., Documents why distance_m exists, so nobody 'simplifies' it back to haversine., TestGeo

### Community 78 - "Community 78"
Cohesion: 0.32
Nodes (4): ndarray, Stations along the segment, refined around every feature that needs resolution.…, station_grid(), TestStationGrid

### Community 79 - "Community 79"
Cohesion: 0.32
Nodes (5): Environment, mix_mean_deviation(), GNSS error simulation. CARLA's built-in GNSS sensor applies independent…, CARLA runtime. ``carla`` is imported lazily and the module is usable without…, Calibration target: ~5.5 m mean deviation for crowdsourced camera positions.

### Community 80 - "Community 80"
Cohesion: 0.29
Nodes (3): PhotoMeta, What a photograph tells us about the camera that took it., Pinhole focal length in pixels, from the 35 mm equivalent. ``focal_px =…

### Community 81 - "Community 81"
Cohesion: 0.32
Nodes (6): project(), Project world points to pixels. Points behind the camera come back as NaN. NaN…, Per-correspondence pixel error. Points behind the camera get ``inf``., reprojection_errors(), Not a wrapped coordinate — a mirrored solution is how pose solvers go wrong., TestProjection

### Community 82 - "Community 82"
Cohesion: 0.29
Nodes (7): MotionState, CYCLING, RUNNING, STATIONARY, UNKNOWN, VEHICLE, WALKING

### Community 83 - "Community 83"
Cohesion: 0.29
Nodes (4): CurbRamp, A curb ramp with the geometry the robot API is asked to report., RampStyle, Geometry families. Style drives flare presence and landing shape.

### Community 84 - "Community 84"
Cohesion: 0.29
Nodes (4): Corridor, A simulated stretch of street with everything on it., Corridor station to (lat, lon). **The corridor's local mesh frame is the ENU…, A point in the corridor's mesh frame to (lat, lon). The identity mapping, named.

### Community 85 - "Community 85"
Cohesion: 0.29
Nodes (5): CrossSection, Everything measurable at one place along the kerb., KerbPlanes, The road plane, the walking plane, and the step between them., Whether the two surfaces are close to parallel, as a sanity signal.

### Community 86 - "Community 86"
Cohesion: 0.33
Nodes (6): UploadState, DONE, FAILED, PENDING, REDACTED, UPLOADING

### Community 90 - "Community 90"
Cohesion: 0.60
Nodes (4): die(), PATH, say(), deploy.sh script

## Knowledge Gaps
- **40 isolated node(s):** `TransferPolicy`, `TriggerConfig`, `smc`, `COMPLETE`, `DEFERRED` (+35 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **12 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `intrinsics()` connect `Community 69` to `Community 0`, `Community 5`, `Community 38`, `Community 19`, `Community 54`, `Community 22`, `Community 56`, `Community 30`?**
  _High betweenness centrality (0.053) - this node is a cross-community bridge._
- **Why does `Pose` connect `Community 49` to `Community 0`, `Community 4`, `Community 5`, `Community 38`, `Community 69`, `Community 12`, `Community 60`, `Community 81`, `Community 19`, `Community 56`, `Community 59`, `Community 28`, `Community 30`?**
  _High betweenness centrality (0.038) - this node is a cross-community bridge._
- **Why does `build_corridor()` connect `Community 52` to `Community 3`, `Community 5`, `Community 38`, `Community 9`, `Community 43`, `Community 76`, `Community 48`, `Community 17`, `Community 50`, `Community 51`, `Community 84`, `Community 24`, `Community 28`, `Community 63`?**
  _High betweenness centrality (0.033) - this node is a cross-community bridge._
- **Are the 15 inferred relationships involving `Pose` (e.g. with `ContributorFrame` and `pose_at_station()`) actually correct?**
  _`Pose` has 15 INFERRED edges - model-reasoned connections that need verification._
- **Are the 5 inferred relationships involving `LocalPhotoJournal` (e.g. with `ingest()` and `run_batch()`) actually correct?**
  _`LocalPhotoJournal` has 5 INFERRED edges - model-reasoned connections that need verification._
- **Are the 7 inferred relationships involving `LocalFrameStore` (e.g. with `contributor_pass()` and `bank_summary()`) actually correct?**
  _`LocalFrameStore` has 7 INFERRED edges - model-reasoned connections that need verification._
- **Are the 8 inferred relationships involving `ReferenceFrame` (e.g. with `AnchoringPipeline` and `FeatureMatcher`) actually correct?**
  _`ReferenceFrame` has 8 INFERRED edges - model-reasoned connections that need verification._