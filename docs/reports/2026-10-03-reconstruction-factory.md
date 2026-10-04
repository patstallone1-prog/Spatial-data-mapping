# Stabilized consumer and reconstruction factory checkpoint

## Landed and deployed

PR #9 merged at `6199532c`; PR #10 merged at `f9f77e16`. Both passed all three
PR checks. Main CI and its gated Pages deployment also passed. The existing
installable app and download site remain live:

- [Download/install site](https://patstallone1-prog.github.io/Spatial-data-mapping/)
- [Existing app](https://patstallone1-prog.github.io/Spatial-data-mapping/app.html)

The native plugin compiled in UE 5.8.3 and passed its three native automation
tests. The fresh one-cell import retained 146,357/146,357 blocking faces and passed
the separate floor trace. It is **not** a packaged native release or a full-city
graphical acceptance. See the [native checkpoint](2026-10-03-unreal-runtime.md).

## New isolated implementation

`codex-cell-reconstruction` is based on merged main, separate from the consumer
release. No candidate geometry, licensed imagery or new weights were published.

- Fixed the real HLoc path-based matching API: `matches=` must be explicit when
  `features` is a Path. Added a runner-control-flow regression test.
- Added `--dense-backend colmap|fvdb` to `build_surface_fusion.py`. Both use the
  same masked ALIKED/LightGlue/HLoc/COLMAP camera pipeline. The default remains
  COLMAP; fVDB is optional and refuses unsupported hosts before loading models.
- Pinned the fVDB 0.4.0 API and source revision, core 0.3.0+pt28.cu128, PyTorch
  2.8.0/CUDA 12.8, Linux/Ampere+. Uses upstream SfmScene, GaussianSplatReconstruction
  and `mesh_from_splats`; no new dense mesher. Camera optimization is disabled,
  no PCA normalization is performed and TSDF values use float32. This is an
  engineering evaluation backend, not an accuracy guarantee. The 0.12 m truncation
  margin is a TSDF integration setting, **not** a 12 cm/centimeter accuracy claim.
- Input preflight checks image/mask hashes, named privacy review, safe IDs,
  finite georeferencing/uncertainty, timezone-aware capture times, whole held-out
  dates/sequences, rights and source aliases. Existing work directories are
  immutable: changed input masks cannot silently reuse old HLoc caches.
- Added reviewed per-face instance splitting for all requested semantic classes.
  Unknown faces remain available for review. A face belongs to one instance;
  dynamic/unsupported labels fail. **The adapter consumes labels; it is not a
  trained automatic 3D semantic segmenter.**
- Existing geometry-family fitting handles regular objects; freeform objects keep
  the upstream dense faces, without the old custom voxel reconstruction. Facades
  require an anchored building prior and measured residual samples. Roofs cannot
  replace whole houses. Off-section/multi-part fits need separate object audits.
- `build_reconstruction_objects.py` makes an isolated, append-journalled candidate
  release using existing WorldObject JSONL/GLB interfaces. Failed candidates retain
  the exact prior. No direct writes to app/Unreal live assets. New detections without
  canonical IDs are review-only rather than silently added collision.
- Per-object promotion additionally requires independent lidar/residual samples,
  matching candidate/canonical hashes, >=3 independent sequence support, >=70%
  observed coverage, <=1 cm measured seam gap, provenance, rights, privacy,
  semantics, collision and performance checks. Family confidence still applies.
  Mean error must be <=0.05 m and P95 <=0.15 m. Audit IDs/locators and hashes persist
  with accepted objects. An audit document is necessary, not self-authenticating;
  validator jobs, not reconstruction generators, must produce it.
- Closed the global quality-gate NaN loophole. Scalar NaN/infinite/missing values
  cannot pass threshold comparisons.
- Each candidate build counts the complete supplied object inventory, including
  refused/unresolved/prior objects. Accepted dense objects retain a promotion tag
  across subsequent runs. Mixed prior/building residuals are distinguished from
  wholly reconstructed objects. Missing appearance provenance remains `unknown`.

## Honest baseline

Verification: 78 focused reconstruction/object-family tests pass, including
synthetic HLoc/fVDB API control-flow tests and fail-closed object/gate tests.
Blocking Ruff checks pass. These tests do not exercise CUDA kernels or establish
real reconstruction accuracy. Graphify's AST-only update refreshes the code graph
without model/API cost; documentation semantic refresh remains separate.

Run `python scripts/report_world_coverage.py --out <new-path.json>` to reproduce
the current SF source-inventory report. It is not a visibility or entire-world audit.

| SF building inventory (15,986) | Count | Share |
|---|---:|---:|
| Prior with image-backed/inferred opening detail | 4,240 | 26.52% |
| Other prior geometry | 11,746 | 73.48% |
| Buildings assigned generic photographic library material | 2,433 | 15.22% |
| Buildings without that library assignment | 13,553 | 84.78% |
| Promoted dense city geometry | 0 | 0% |
| Actual rectified wall-photo material in this compiler | 0 | 0% |

Geometry and appearance rows are separate axes, not additive. Photo-backed
openings do not turn prior footprints/heights into measured city geometry.
Poly Haven CC0 albedo is a photographic material library, **not** a photograph of
the assigned real building. The report preserves those distinctions.

The existing curb build produced 8,534 surveyed-plan objects from 9,441 input
lines. Its height summary has 3,382 lidar-height assignments and 5,152 median-height
assignments. This does not enumerate all fallback curbs or verify that measured
curbs are currently enabled in every renderer; no global measured-curb percentage
is claimed from these counts alone.

## Actual execution blocker and what remains

Host is macOS/Apple M4. COLMAP executable, HLoc, PyCOLMAP, Torch and fVDB are absent.
fVDB preflight correctly refuses this host. Searches including ignored data/build
files in this worktree and the primary checkout found rendered audit JPEGs, but
no ready city flight/input manifest or reviewed reconstruction mask bundles.
Capture folders contain metadata manifests. Catalog references are not image bytes.

**No real small-area photogrammetry/dense CUDA run was executed in this pass.**
Synthetic adapter tests do not substitute for it. No lidar MAE or real object
promotion is claimed. No paid GPU worker or new imagery license was procured.

Needed to continue:

1. An accessible existing Linux NVIDIA GPU worker (Ampere+), with sufficient RAM,
   VRAM and cloud scratch/object storage for the selected pilot; pin its runtime
   before importing optional dependencies. Do not fill this Mac with GPU packages.
2. At least 20 useful, overlapping city image frames from >=3 independent sequences,
   with their original flight/sequence manifests, calibration, epochs, WGS84
   ellipsoid positions, source rights and hashed, privacy-reviewed masks. Preserve
   acquisitions and aliases; do not invent camera heights or imagery rights.
3. Independent lidar/RTK samples and held-out real image bytes. The existing 300-photo
   benchmark currently has metadata hashes only; checkpoint/material/mask truth is
   missing. It is not promotion-ready.
4. Run both dense engines on the same aligned sparse model; compare with identical
   withheld truth, visibility and runtime budgets. Check fVDB raw splat-derived
   depth particularly carefully. DLNR is not selected: model license/checkpoint
   approval must precede any use. Upstream LPIPS/training dependencies also require
   a provisioned worker/model-cache review; they are not downloaded here.
5. Generate and review instance labels using the existing masking models plus
   multiview projection; then pass labelled meshes into the adapter. Automatic 3D
   segmentation, coloured PLY→bundle conversion, texture atlas compilation and
   native photo-material import are still integration work, not completed features.
6. Build independent collision/continuity/privacy/performance audit producers.
   Validate candidate GLBs/WorldObjects in app and Unreal and run visual acceptance.
   Only then bind an approved candidate release to live consumers. The current
   implementation intentionally stops at an isolated candidate release.
7. Repeat on neighboring cells with source-based invalidation and persistent stage
   checkpoints. Per-object attempts are journalled now; full GPU-stage resume,
   automatic neighbor invalidation/cost telemetry are not implemented here.

## Primary sources and version choice

- [HLoc matcher API](https://github.com/cvg/Hierarchical-Localization/blob/master/hloc/match_features.py)
- [Pinned fVDB runtime requirements](https://github.com/openvdb/fvdb-reality-capture/blob/b94d1c9bbdd9b41d1c6c7eb643d126d968c92c47/docs/installation.rst)
- [Pinned fVDB mesh API](https://github.com/openvdb/fvdb-reality-capture/blob/b94d1c9bbdd9b41d1c6c7eb643d126d968c92c47/fvdb_reality_capture/tools/_mesh_from_splats.py)
- [Upstream mesh tutorial and raw-depth limitations](https://github.com/openvdb/fvdb-reality-capture/blob/main/docs/tutorials/radiance_field_and_mesh_reconstruction.md)

The newer 0.6 package targets a newer/development core; pinning the documented
0.4 environment avoids mixing those APIs/dependency matrices. This is an explicit
evaluation version choice, not a claim that 0.4 is the newest release.
