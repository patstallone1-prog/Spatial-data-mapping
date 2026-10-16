# Real-photo / lidar validation — 16 October 2026

Release decision: preserve the current results and stop accuracy tuning. The user
accepts the 7.95 cm development median as a prototype result. It is not a global
accuracy claim, and accepting it does not make failed geometry publishable.
This release ships the matching/validation machinery and numeric reports, not
candidate geometry into the canonical city. The existing verified world remains.

## What ran

Real calibrated PandaSet images passed through pinned ALIKED/LightGlue, static
semantic exclusion masks, three-view cycle matching, optional subpixel alignment,
triangulation and joint refinement. Separate lidar sweeps supplied fitting controls
and held-out checkpoints. Checkpoint IDs and coordinates were frozen before any
optimization. No nearest-reconstructed-point lookup, optimizer-selected truth,
synthetic labels presented as field evidence, or discarded failure cases.

Observability checks reject ambiguous scale/position/depth before optimization.
Default refinement keeps rotations and intrinsics fixed; the experimental variant
permits at most two degrees of rotation change and rejects saturated bounds. We
did not change that default after observing the untouched results.

Downloads: 117 selected source assets, 76,717,767 bytes, not the full 44.5 GB archive.
Raw photographs, calibrated poses, semantic labels and lidar remain private under
the ignored `build/photo-lidar-real-v1/` directory. The acquisition enforces a
10 GiB free-space reserve; HP700 was not mounted during this run. Checksummed
source/model receipts are committed; raw pixels and candidate geometry are not.

A bounded 30 × 30 m 2023 USGS SF control cell contains 74,734 returns. Requested
sampling spacing is not an accuracy claim. Its official horizontal 95% accuracy
is 12 cm, so this source alone cannot certify 5 cm absolute positioning.
[Official NOAA metadata](https://www.fisheries.noaa.gov/inport/item/73386/full-list).
The matched PandaSet benchmark is sensor-local: separate lidar sweeps still share
the dataset's calibration/pose system. It is not independent geodetic/RTK truth.
Local plane interpolation near surface boundaries is a further reference limitation.

## Results, including attrition

The original frozen test requested every planned checkpoint within 5 cm and at
least 25% of attempted cases passing. Those historical thresholds remain in the
reports; they were not loosened retrospectively. This is no longer a reason to
continue tuning this release. All failed or unsupported cases remain counted.

| Development: 8 cases / 64 planned checkpoints | Reconstructed cases | Finite points | Median | P90 |
|---|---:|---:|---:|---:|
| Two view | 2/8 | 16 | 12.66 cm | 57.27 cm |
| Joint translation/landmarks | 2/8 | 16 | 11.05 cm | 34.33 cm |
| Joint + subpixel | 2/8 | 16 | 10.03 cm | 35.66 cm |
| Experimental full pose + subpixel | 1/8 | 8 | 7.95 cm | 23.03 cm |

**The 7.95 cm subset has half as many predictions as the other variants. It must
not be described as an equal-sample improvement or accuracy across all houses.**
Two cases lack source semantic annotations; four more lack sufficient independent
support. One of the two remaining full-pose cases fails its quality gate.

| Untouched: 4 cases / 32 planned checkpoints | Reconstructed cases | Finite points | Median | P90 |
|---|---:|---:|---:|---:|
| Two view | 4/4 | 32 | 7.74 cm | 21.58 cm |
| Joint translation/landmarks | 0/4 | 0 | unavailable | unavailable |
| Joint + subpixel | 0/4 | 0 | unavailable | unavailable |
| Experimental full pose + subpixel | 1/4 | 8 | 11.23 cm | 228.19 cm |

Untouched cases use new sequences, cameras and frames, declared before acquisition.
No tuning followed these results. They demonstrate a serious tail and attrition,
not reliable 5 cm generalization. Zero complete cases pass the original 5 cm test
in either real batch. All-attempt errors retain failed cases as infinity.

The separate analytic 5 cm regression has 5/8 successful cases (62.5%) for joint
refinement, with conditional finite-point median 1.34 cm and P90 3.32 cm. This is
synthetic regression evidence only. Ambiguous cases still fail. The historical
SIFT v1 result in `data/benchmarks/photo-lidar-sift-v1-results.json` predates the
planned-checkpoint denominator correction; retain it as history, not the latest
accuracy/coverage result. The current real reports are v2 and untouched v3.

## Reproduction and regression protection

Install the optional `photo-matching` extra for the real learned matcher. LightGlue
is pinned to commit `eb42fee2d71449efb0aa5c10549752b5d75384d8`; ALIKED and LightGlue
weights have reviewed SHA-256 checksums and licenses in
`data/reconstruction/matching_models.json`. There is no silent SIFT fallback.

From the repository root, using an environment with that extra installed:

```sh
PYTHONPATH=src python scripts/curbmeasure/acquire_real_pilot.py --manifest data/benchmarks/real-photo-lidar-v2.json --usgs
PYTHONPATH=src python scripts/curbmeasure/acquire_real_pilot.py --manifest data/benchmarks/real-photo-lidar-v3-untouched.json
PYTHONPATH=src python scripts/curbmeasure/run_real_photo_lidar.py --learned --manifest data/benchmarks/real-photo-lidar-v2.json --frozen data/benchmarks/real-photo-lidar-v2-frozen.json --report docs/audits/photo-lidar-accuracy.json
PYTHONPATH=src python scripts/curbmeasure/run_real_photo_lidar.py --learned --manifest data/benchmarks/real-photo-lidar-v3-untouched.json --frozen data/benchmarks/real-photo-lidar-v3-frozen.json --report docs/audits/photo-lidar-untouched.json
PYTHONPATH=src python scripts/curbmeasure/benchmark_multiview.py --help
PYTHONPATH=src python scripts/curbmeasure/publish_accuracy_audit.py
PYTHONPATH=src pytest -q tests/test_photo_lidar_accuracy.py tests/test_multiview_geometry.py
```

The v2 acquisition reports a nonzero exit for the missing sequence-018 semantic
annotations; those two unsupported cases intentionally remain in the test.
Acquire the named v2 and v3 manifests before replaying. Frozen references cannot
be overwritten with different truth; use a new version for a changed benchmark.
Tests cover unequal fx/fy, stable IDs during subpixel matching, dynamic occlusion,
fixed-pixel lidar association, seven-degree gauge ambiguity, missing truth in the
denominator, frozen-report hashes, and strict lidar download failures. EPT cache
writes are atomic so disk-full/partial downloads cannot masquerade as measured
empty tiles. No renderer, worker configuration or other agent's files changed.

The existing CI/deployment gates are unchanged: lint, pytest and the committed
render baseline must pass before merge/release. Numeric real and synthetic
reports are available in [the audit viewer](photo-lidar-accuracy.html).

Attribution: Hesai and Scale AI, PandaSet (CC BY 4.0); USGS / NV5 Geospatial;
ALIKED (BSD-3-Clause), LightGlue (Apache-2.0).
