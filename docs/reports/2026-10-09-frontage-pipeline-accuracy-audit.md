# Frontage pipeline accuracy audit — 2026-10-09

This records the first checkpoint. The follow-up `2026-10-09-bounded-outcrops-and-powered-workers.md` supersedes the glass rendering and local-worker lifecycle below.

## Outcome and deployment boundary

The private photo → fact proposal → renderer pipeline is runnable, with focused regression checks. It is **not finished to the requested three-house accuracy gate**. No facade proposals from this pass were promoted, merged into main, or deployed. Production's independent installed-app cache fix remains unchanged. No canonical footprints, heights, collision, roads or curbs were moved.

This pass is isolated on `codex-frontage-photo-filter`, draft PR #32. The authoritative renderer is `scripts/build_sf_corridor_3d.py`; all eight installed-app viewer modules are generated from it. Build/source hashes and module equality tests guard against stale generated consumers. These tests reduce regression risk; they cannot guarantee that future changes will never regress.

## Implemented

- Empty Grounding DINO results no longer crash when the tokenizer supplies one empty label. Nonempty output-length mismatches still fail explicitly, rather than silently truncating pairs. Errors are quarantined per view.
- Pinned UperNet and Grounding DINO can run on Apple MPS. UperNet's unsupported adaptive pooling runs that operation exactly on CPU, including upstream list aliases; the remaining model stays on MPS. No image resizing workaround changes the geometry to satisfy the GPU.
- Strict-house metadata screening requires predicted full frontage and centre/edge angles ≤35°. The ≥2 visible-storey and actual-full-front conditions require image-bound review; metadata alone cannot prove them. Existing date/rights/individual-landmark rules remain.
- Resolved pixels-per-metre is reduced when actual decoded imagery is smaller than camera metadata. Upsampling cannot create detail or pass the minimum-density gate. Low disk capacity pauses download work without falsely reporting an empty measurement or rejecting the source.
- Canny/Hough perimeter refinement changes an opening box only when all four nearby sides have support. Unsupported edges retain detector coordinates and uncertainty. A dark rectangle is not enough to classify a door or stairs.
- Ground-floor focused detection retries recover entrances missed at whole-facade scale. Their coordinates map back into the original image. They are the **same evidence**, never extra multiview corroboration. Ambiguous garage/door/gate identities still need review.
- Windows retain detected shape ratios, visible mullions, trim and glass/curtain image colour. Door/garage visual planes retain sampled colour and observed panel-line positions. Source openings are excluded from wall-colour sampling. These colours are image appearance, **not calibrated albedo**.
- Independent appearance bands, window trim and near/far glass colour are supported; material for an unresolved floor remains unknown. Viewed fronts do not gain extra procedural painted windows. Unseen walls retain inferred layouts. Partitioning a wall into front/other material batches preserves all triangles.
- Height/storey inference records both the prior division and its rounded 0.1 m visual value. Existing evidence-bound inward-stair rules retain a four-tread-depth landing and prohibit garage stairs. Hidden second-floor doors require reviewed ascending stair evidence. Neighbour and same-front comparisons flag discrepancies without normalizing anomalies to an ideal.
- Every fit has a categorical certainty tier, reasons, AI-review requirement and raw-retention decision. Tiers are not calibrated probability or inch-accuracy certification. The private AI queue contains locators/reasons; no new generative vision reviewer is executing automatically.
- Exact-byte finalized fact receipts allow deletion of reviewed high-certainty scratch pixels after facts are durably saved. Shared unresolved pixel blobs, aliases, catalogues, flights and fact files survive. Low-certainty photos remain local. Saved facts are recoverable after deletion, retaining their original world and implementation versions rather than silently acquiring new approval.
- Fact/detection caches include implementation/model versions. Workers use single-writer locks, resumable indexes, atomic outputs and source-change safe stops. Old image approvals cannot approve changed extraction or renderer code.

## Three real-house trial

`data/facade-pilot-2026-10-09.json` commits locators, source/derived hashes and reviewed image-space registration controls, not photographs. Registration uses canonical dimensions, does not solve a metric camera and does not move the canonical world. Derived image hashes prevent old quadrilateral controls being reused on a regenerated crop.

| Address (San Francisco) | Rules openings | Grounded before entrance retry | Grounded after retry | Remaining visible gaps |
| --- | ---: | ---: | ---: | --- |
| 4153 20th Street | 2 | 5 | 7 | Pebble inset panels and gate style are not faithfully modeled; body colour varies by band because illumination/panels are not fully isolated. |
| 652 Guerrero Street | 0 | 7 | 9 | Bay/trim depth and exact entry geometry are unresolved. Ground brick versus upper stucco needs independent material labeling; colour is the photographed lighting, not calibrated paint. |
| 2332 Taraval Street | 2 | 10 | 11 | The upper-left arch is still rectangular; bay returns are flat, and the truck-occluded shop is not trustworthy. |

All three are **LOW certainty**, source photos retained, zero promoted. Openings counted are proposals, not validated recall. The 3D diagnostic uses actual viewer shell/opening functions on explicitly labelled proxy massing, with intact roofs. Three views were inspected. The render-only screenshot is `build/frontage-accuracy-audit/pilot/render-proof.jpg`; private evidence and model weights stay outside Git. This is not a successful measured-city reconstruction or three perfect homes.

## Timing, honestly bounded

The user estimates 200k initial photos, 40k extraction inputs and 16k reconstructed fronts. Those are planning assumptions, not completed job counts. A broad candidate count is an image/building pair count, not necessarily that many unique downloaded photos.

On three existing crops, two rounds on MPS gave warm means of 0.222 s screening, 0.0152 s rule extraction, 0.841 s one Grounding DINO pass and 0.0140 s grounded fitting. The benchmark explicitly excludes downloading, decoding, compressed pixel storage, review, city compilation and retries. Rules-only screening/extraction of 40k is about **2.6 hours of compute**. One grounded pass per photo plus screening is about **12 hours of compute**, before overhead. The subsequent two-pass real-house trial took 1.96–3.16 s per house including screening/extraction; it is not a steady-state production benchmark. Applying that sample range to 40k would be approximately **22–35 hours**, not a promised completion date.

Two worker processes overlap indexing/network/extraction, but share one GPU; they do not double GPU throughput. A 12-hour initial hardcoded proposal pass may be feasible once downloading is measured, but a 12-hour **accurately reviewed and promoted** 16k-house result is not supported by these measurements. Current rules-only recall fails the pilot; count and speed cannot substitute for correctness.

About 18 GiB was free at restart. Workers preserve a 4 GiB reserve. Tens of thousands of full decoded RGB images can exceed the remaining space, especially while low-certainty evidence must remain local. The full job therefore needs monitored capacity or cloud storage; it is not safe to promise an unbounded local download.

## Research and next corrections

Use established components rather than inventing an unvalidated detector:

1. Grounded text/box detection with correctly paired source coordinates. [Grounding DINO's official Transformers documentation](https://huggingface.co/docs/transformers/model_doc/grounding-dino) documents class prompts and grounded post-processing.
2. Instance masks before contour/edge fitting, especially arches, gated openings, people/cars and trim versus glass. [SAM 2's official repository](https://github.com/facebookresearch/sam2) supplies image/video segmentation. **SAM 2 integration/checkpoint is deferred, not running in this pass.**
3. Restrained perimeter support and contour shape fitting, not fabricated standard rectangles. [OpenCV Hough documentation](https://docs.opencv.org/4.x/d9/db0/tutorial_hough_lines.html) and [contour documentation](https://docs.opencv.org/4.x/d4/d73/tutorial_py_contours_begin.html) supply the established primitives. Our four-side refinement is implemented; arched-window fitting/geometry is not.
4. Repeated registered source views and metric pose/lidar checks for bay/recess depth. Single-image prior scaling cannot certify inches. A larger AI model may resolve semantics, but cannot independently supply measured hidden depth.
5. Per-floor material labels and exposure/colour consistency across observations. Do not call a lit shopfront or shadow a new measured material.

Before deployment: correct the three visible shape/material mismatches, establish image-to-front registration beyond manual pilot controls, validate complete opening recall and absence of unsupported details, wire accepted recess geometry into physical shell cuts, then pass source rights/privacy, rendering and higher-accuracy comparisons. No high-confidence raw evidence should be purged merely to solve storage pressure.

## Running and repeatable

At restart, filter PID was **31211** and matcher PID **31231**. PIDs are snapshots; consult `build/frontage-live/status.json`, `worker.json`, and `build/facade-match/status.json` for current state. Strict metadata indexing covers eight regions; download batches are bounded to 24 new views per cycle with a 30 s interval. They are local jobs requiring this Mac to remain awake, not cloud jobs or reboot-persistent services. The matcher is operating on private retained inputs and does not auto-publish.

Reproduce the private pilot with the existing reviewed inputs/model caches:

```sh
PYTHONPATH=src python tools/build_frontage_pilot.py --device mps
PYTHONPATH=src python tools/preview_photo_fronts.py
```

Validation this pass: **84 focused tests passed**, including generated-viewer/source synchronization and JavaScript syntax across all eight app pages. Owned-file lint and `git diff --check` passed. This is targeted validation, not a new full-suite/CI result. Graphify's AST-only update completed with 14,457 nodes / 21,378 edges; it retained structural relationships but warned that 117 community labels were renamed after the community set changed.
