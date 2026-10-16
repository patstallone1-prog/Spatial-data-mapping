# Multiview matching and honest placement validation — 16 October 2026

## Result and limit

The user's goal is **25% of attempted cases within the existing accuracy threshold**,
not quarter-inch placement. This pass implements the matching/refinement and evaluation
machinery, and demonstrates improvement on an explicitly analytic regression benchmark.
It does **not** establish that 25% of real streets meet the threshold. No canonical
geometry, renderer, house worker, measured-confidence label or production deployment
was changed.

The diagnostic benchmark freezes **0.15 m 3D landmark error** for all compared methods.
That is the existing controlled-camera median / facade P95 scale, not a relaxation of
the production visual-fusion gates, nor a claim about 13 mm kerb-height accuracy.
Future real benchmarks must freeze the threshold appropriate to their feature before
optimization and report it explicitly. A successful case requires every planned
checkpoint to be within that threshold; failures remain in the denominator.

## Implemented paths

1. `smc.reconstruction.matching`: camera proximity proposes candidates, mutual SIFT
   descriptors and undistorted epipolar RANSAC verify overlap. Verified graph components
   form processing sequences. Unsupported singleton frames are retained. Provider
   reconstruction components are never combined unless already independently aligned.
   Identical canonical-pixel aliases never count as extra views. Conflict-free feature
   tracks require at least three views and a cycle; a transitive cluster containing two
   different features from one camera is rejected.
2. Optional street-corner, building-edge and pole masks prioritize stationary landmarks.
   Required person/face/plate/car/sky exclusion masks are uncertainty-dilated before
   extraction. Descriptor-support margins stay away from redacted boundaries. This is
   not a claim that arbitrary detected poles/corners are surveyed control. Real source
   rights, source-byte checksums, canonical decoded-pixel checksums, and mask checksums
   are checked before the pilot reads images. EXIF orientation and colour normalization
   use the existing canonical pixel decoder.
3. `smc.reconstruction.multiview`: a bounded 3–12-camera pilot jointly optimizes camera
   translations and 3D landmarks using SciPy's robust least-squares solver. Calibrated
   intrinsics and rotations are **fixed**, not estimated here. Full camera/intrinsic BA
   remains the existing ALIKED/LightGlue/hLoc/COLMAP path. Each small window uses at most
   192 spatially spread tracks chosen before truth review; this is not photo/flight
   thinning or a renderer-detail reduction.
4. Triangulation refuses less than 1° usable ray parallax, ill-conditioning, behind-camera
   intersections, and unequal camera/pixel lists. The pilot checks the visual Jacobian
   for degeneracy beyond its four translation/scale gauge freedoms, then requires named,
   independent fitting controls to remove the remaining gauge. Neither damping nor
   camera-position priors manufacture rank. Missing support fails **before** optimization.
   Final rank, cheirality, every observation's reprojection error, and control residuals
   are checked again; failed candidates do not return geometry.
5. Existing `curbmeasure.registration.fit_camera` now checks rank before optimization:
   one straight curb and two parallel curbs no longer produce a plausible-looking
   candidate shift/scale. Outlier rejection can still remove apparent observability,
   so inlier rank is checked afterward too. This remains an **oracle diagnostic**, never
   the independent benchmark.
6. The COLMAP runner now rejects held-out UID/byte/pixel aliases, capture sequences and
   capture dates; duplicate source images; unsafe camera-group IDs that previously
   could collapse onto one shared-intrinsics folder; disconnected candidate graphs;
   and underconstrained metric alignment. Only registered cameras count toward the
   metric-alignment geometry check. Nearly coincident candidates cannot exhaust the
   nearest-neighbour budget. COLMAP's existing geometric verification/initialization
   and BA are retained, not replaced by the CPU pilot.
7. `smc.reconstruction.matching_benchmark`: named, independently reviewed survey/lidar
   checkpoint correspondences, separate fitting-control sources, immutable manifest
   hashes, conditional finite-point median/P90, reconstruction rate, and successful
   case rate. Missing predictions, failed geometry and cases without truth remain
   failed cases. All-attempt quantiles use **equal-case worst-checkpoint error**;
   failures/missing truth are infinite, serialized as `null` when the quantile is
   unbounded. A thousand good points on one street cannot conceal unsupported streets.
   Nearest-reference post-fit assignment is not accepted as independent correspondence.
8. The legacy lateral-smoothing script's noise-injection report is explicitly labelled
   synthetic self-consistency against its own output, not independent validation.

## Spatial relationships

The pilot accepts provenance-bearing horizontal **street-width** and
**curb-to-building-setback** relations, each with a measurement uncertainty and local
scope. Transferring a width from another block additionally requires nonzero transfer
uncertainty. Conflicts beyond four combined sigmas are retained for review and not used
to reshape the street. Duplicate endpoint relations are rejected to avoid overcounting.
These relations do not turn a standard street width or neighbouring house into measured
truth. Source/target scopes, effective sigma and inferred transfer status are reported.

## Reproducible analytic experiment

`scripts/curbmeasure/benchmark_multiview.py` freezes eight seeded cases, with three
absolute fitting controls and eleven held-out analytic checkpoints per case. Two cases
deliberately have near-identical viewpoints. The spatial ablation adds an independently
generated fitting-only width between two additional non-test landmarks. No held-out
coordinate is passed to either optimizer. These are simulated coordinates, explicitly
marked `analytic` / `synthetic_regression_only`, **not fabricated field survey records**.

| Method | Successful cases / all 8 | Finite-point median | Finite-point P90 |
| --- | ---: | ---: | ---: |
| Two-ray placement with seed poses | 1/8 (12.5%) | 0.334 m | 1.249 m |
| Joint camera/landmark refinement | 6/8 (75%) | 0.0134 m | 0.0332 m |
| Joint refinement + fitting-only width | 6/8 (75%) | 0.0134 m | 0.0332 m |

All-attempt P90 is **unbounded for every method**, because the deliberately ambiguous
cases remain failures. The width relation did not yield a material gain on this already
well-controlled synthetic scene; do not claim a field improvement from its tiny difference.
The output, seeds, case manifest and implementation fingerprint are committed in
`data/benchmarks/multiview-analytic-v1-results.json`.

```sh
PYTHONPATH=src python scripts/curbmeasure/benchmark_multiview.py \
  --output build/multiview/analytic-results.json
```

## Real evidence recheck: not a 25% success claim

Replayed the existing SF Mission cache without downloading imagery or altering its
inputs. Of 30 original photos: **23 ambiguous, 6 insufficient support, 1 identified**.
Only three configurations reached optimization; two then failed final identifiability/
bound checks. The identified fit is not held-out accuracy. Raw all-extracted-point
curb-to-reference median/P90 remain **2.865 m / 10.500 m**, from 8,050 correlated points.
The replay is committed as
`data/benchmarks/photo-curb-registration-preflight-2026-10-16.json`.

The 30 cached metadata records occupy 24 sequence/component groups; just one group has
at least three photos. The inspected curb-photo cache contains **zero image pixel
files**. The existing 300-photo pilot benchmark still has an empty
`truth.rtk_lidar_checkpoints` array and no image-byte hashes. COLMAP's CLI exists on this
machine, but the selected environment lacks PyCOLMAP and hLoc; the production dense
runner correctly fails closed without them. These constraints prevent a new independent
real-image placement test here. No synthetic score or fitted survey residual fills that gap.

Required before claiming the real 25% goal:

- Restore a licensed, calibrated, masked multiview subset with actual pixels; include
  all planned windows, even weak/unsupported ones, rather than selecting successes.
- Independently identify fitting controls and held-out survey/lidar landmarks in one
  explicit ENU frame/datum. Keep test coordinate values and control sources separate.
- Freeze the case list, track IDs, threshold, hashes and reviewed correspondences before
  fitting; run the same immutable manifest for the baseline, multiview and spatial ablations.
- Repeat on untouched streets after calibration is frozen. Do not tune against that test.

## Pilot entry point

`scripts/curbmeasure/refine_multiview.py` deliberately separates preparation from scoring:

```sh
PYTHONPATH=src python scripts/curbmeasure/refine_multiview.py \
  --manifest private/photo-windows.json --prepare \
  --output private/prepared-windows.json
# Independent review now assigns stable landmark IDs / fitting controls and test truth.
# Freeze the final prepared file hash as benchmark.fitting_manifest_sha256.
PYTHONPATH=src python scripts/curbmeasure/refine_multiview.py \
  --manifest private/prepared-windows.json --benchmark private/heldout-checkpoints.json \
  --output build/multiview/heldout-results.json
```

Both documents declare `coordinate_frame: local_ENU_m` and the same finite
`enu_origin_wgs84: [longitude, latitude, ellipsoid_height]`. Input `cases` have unique
`case_id`s. Preparation images carry `source_id`, `license_id`, `attribution`,
`observation_uid`, `captured_at`, `sequence_id`, already-aligned `component_id`,
`image_path`, `image_sha256`, canonical `pixel_sha256`, `masks_npz`, `masks_sha256`,
`reprojection_sigma_px`, and a calibrated `camera` containing `image_id`, `centre`,
world-to-camera `rotation`, `focal_px`, `principal`, `k1`, `k2`, `width`, `height`.
Optional NPZ landmark masks are `street_corner`, `building_edge`, `pole`.

Preparation emits verified overlap cases, retaining unsupported singletons and failures.
It must precede fitting-control annotation to avoid stale feature IDs. Each final case
has `tracks: [{track_id, pixels: {image_id: [x,y]}}]`,
`controls: [{track_id, xyz, sigma_m, source_id}]`, and optional `relations` matching the
typed `Relation` contract. The frozen benchmark includes `benchmark_id`, `threshold_m`,
`cases: [{case_id, checkpoints: [{track_id, xyz, source_id, method: survey|lidar,
independent: true, correspondence: independent_reviewed_id, evidence_sha256}]}]`, plus
any date/sequence-separated `held_out_observations`. Test coordinates never enter
`refine`. Output is private diagnostic geometry, always `publishable: false`.

## Verification and software choices

65 focused regression tests pass. They exercise real OpenCV feature extraction/matching on generated
multidepth images, privacy exclusion, duplicate views, unaligned components, three-view
cycles, missing descriptors, negative depth, parallax, pre-optimizer rank rejection,
controlled camera recovery, spatial conflicts, source/date/alias leakage and failure
denominators. Existing facade-multiview, visual-publication and photographic-curb tests
are also run. The repository's blocking Ruff check passes. Graphify is refreshed after
the code changes; its navigation identified the existing geometry and COLMAP paths.

The CPU pilot uses established OpenCV SIFT/RANSAC and SciPy rather than inventing a
feature matcher. Production continues to use the existing learned matcher and COLMAP:
[COLMAP guidance](https://colmap.github.io/faq.html),
[PyCOLMAP camera/reconstruction APIs](https://colmap.github.io/pycolmap/pycolmap.html),
[hLoc reconstruction implementation](https://github.com/cvg/Hierarchical-Localization/blob/master/hloc/reconstruction.py).
Existing license/privacy/promotion gates are not weakened. No unvalidated geometry is
sent to the live world, and no other agent's worktree is modified.
