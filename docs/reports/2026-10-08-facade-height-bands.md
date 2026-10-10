# Independent facade appearance bands — implementation and review

## Implemented

The facade fitter no longer has to express a building as one colour/material. `appearance.bands` carries independently bounded height intervals, colour, material, source/reviewer evidence and the explicit `inferred_same_height_band` basis for unobserved sides and back. Reviewed boundaries may be nonuniform: a taller shop floor need not be the same height as the apartments above it. Missing intervals retain the prior appearance; conflicting intervals fall back rather than painting competing layers.

Automatic sampling excludes detected openings and non-architectural semantic pixels. With known canonical storey count it samples each storey independently, without treating equal-height storey boundaries as measured elevations. Without storeys it can propose sustained, abrupt wall-colour transitions, explicitly **not measured floor boundaries**. Gradients and sparse wall evidence abstain. Material per interval remains **unknown** until reviewed; the whole-building material classifier is not repeated as floor-level truth. These are visual proposals, not measured geometry or calibrated albedo.

The shared app renderer clips wall triangles at the bands, retaining UVs, normals, the full footprint, terrain anchoring and roof. It does not reduce existing geometric detail. Each height band's material/colour wraps around every wall. The near-house shell uses the same intervals; openings keep their existing positions. Sampled colours use neutralised texture detail rather than being multiplied by an unrelated library albedo. Unobserved material choices remain fallback, not new evidence.

The procedural shopfront can no longer paint a solid invented backdrop over an observed ground-level band. Its placeholder window/door styling remains inferred; its backdrop is transparent, its frame uses the observed band colour when available, and its height does not extend through the next band. Source imagery has **not** yet supplied reliable commercial opening geometry.

White/off-white window-frame proposals carry their own image colour and inferred 0.06 m width. Decals and the close-up physical frame use the same trim. Trim-specific cache keys and disposal preserve consistency without accumulating per-shell materials. Automatic extraction currently targets white/off-white, not arbitrary decorative multicolour trim.

The private comparison diagram now displays band colours and trim rather than flattening them back into one averaged wall. Publication additionally requires the current implementation hash, independent band review and trim review. An old approval for the same photograph cannot approve a changed fitter automatically. The source-change watcher fingerprint includes this new module.

## Verification

- 108 focused checks passed: facade extraction and publication, frontend bands/trim, exact band clipping, privacy/retention policy, house windows/openings/shells, movement/interiors and all-eight-region source/syntax/release sync.
- The CI blocking lint command passed. `git diff --check` passed.
- A three-corner browser sweep of the synthetic scene extracted from the **actual** city-wall and near-shell functions showed continuous band boundaries, the same colour/material on side/back walls, white frames and intact roofs. Reproduce with `PYTHONPATH=src python tools/preview_facade_appearance.py`, then serve the generated `build/appearance-preview/index.html`. The fixture textures and camera are synthetic: this is rendering-regression evidence, **not photographic accuracy certification**.
- Real photographs inspected: 700 Filbert Street (cream upper walls, red trim, dark shop level obscured by a vehicle); 2116–2120 Leavenworth Street (white trim, incomplete bay-only frontage); 580 Green Street and 127 Grand View Avenue (false colour-band candidates described below).
- Canonical world payloads, footprints, heights and collision remain unchanged. Public frontage fits remain empty. Eight app consumers and their release/service-worker fingerprint were regenerated from the authoritative builder; website viewers were not hand-edited.
- Graphify was queried to reuse the existing material/facade paths, then updated using the AST-only update.

## Accuracy findings and deployment state

Current private matcher snapshot: 34 building specifications, two unreviewed colour-band proposals, 11 window-trim proposals, zero reviewed band materials and **zero promoted fits**. The two band proposals do not pass visual review: 580 Green Street's blue upper region is large glazing, not a different wall material; 127 Grand View Avenue's upper/lower variation appears to be lighting/shadow on the same wall. This is an important retained failure, not evidence that the detector has correctly identified two mixed-material houses. Neither proposal is published.

Remaining blockers: complete-front crop/pose registration, window/glass/awning isolation, independent per-floor material labels and repeated views to disambiguate shadow versus paint. Existing source colour and inferred metric placement are not centimetre/inch-certified. The new rendering capability is implemented, but the broader photo-derived facade accuracy gate remains unmet. Draft PR #32 is not merged or deployed; the production cache-policy fix from PR #31 remains independent.

## Running work and estimate

The frontage filter remains running across eight regions and checking for new catalogues hourly; the updated facade matcher watches retained candidates every five minutes. Both are local processes requiring this Mac to remain awake; neither is an OS-restart-persistent cloud worker. Rejected scratch pixels are pruned by the existing retention stage, while source aliases, licenses, acquisition/sequence metadata and shared retained blobs remain intact.

Filter snapshot: 199,706 candidate image/frontage pairs across 12,063 building records; 96 screened pixel examples, 32 retained candidates, 62 pixel rejections and two download/decode failures. These are not 199,706 downloaded/verified photographs or reconstructed homes.

This band/trim plumbing and its regression checks are finished. There is no defensible finish date for the full reconstruction rollout while the real-photo alignment and appearance checks fail. At the current deliberately bounded rate of 24 new pixel examples per hour, even one example per 12,063 candidate buildings would take about 21 days of continuous awake runtime; several views per building and human/metric validation would take longer. That is a throughput calculation, not a promise of successful reconstruction in 21 days. Increasing throughput should follow correction of these pilot failures, not hide them.
