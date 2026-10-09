# Opening reasoning and pipeline status

## Implemented

The facade-fitting pipeline now combines projected opening dimensions, aspect,
panel-line structure, nearby pedestrian-door placement and image-bound tread
review. The 8 × 7 ft single-garage opening is a **soft reference**, not a rule
that resizes real geometry. Standard 9-ft and double-width garages are covered,
while unusual measured/observed entrances can override the prior. Reference:
[Clopay installation guide](https://www.clopaydoor.com/residential/buyingguide/how-to-install-garage-door).

- Garage-scale openings with repeated panel sections cannot turn into stairs
  solely because an object detector labelled them `stairs`.
- A narrow, tall leaf is a pedestrian-entry candidate, not automatic stair proof.
- A reviewed visible tread leading to the pedestrian door threshold rules out a
  vehicle opening **for that opening**, even if dimensions are unusual.
- A driveway/curb lip without a pedestrian door does not rule out a garage.
- Horizontal bands alone are not proof of stairs. Unknown/conflicting cases
  abstain and remain in the private review queue.
- Reasoning retains raw detections, dimensions and explicit reasons. Source
  proposal indices survive invalid-box filtering so another region's review
  cannot accidentally shift onto an unrelated proposal.
- The fitter refuses garage/stair combinations; all eight generated app
  consumers reject a reviewed-fit sidecar containing that contradiction.
- Visible steps do not independently provide recess depth, riser count, height,
  or property containment. Existing rise/depth/footprint and promotion gates
  still apply. No new canonical collision was inferred from these rules.

## Real-image checks

Reused the pinned detector's saved outputs against exact processed-image hashes;
no model weights or source photographs were republished. Three real examples
were inspected, not just synthetic fixtures:

| Photograph | Result | Remaining limitation |
|---|---|---|
| 550–556 Union Street | The right garage's false `stairs` label is now a garage candidate; the separate central stepped entrance is a stair-recess candidate after an image-bound visual annotation. | Exact rise/depth, full-front registration and crop edges remain unverified. |
| 700 Filbert Street | Narrow doorway remains a pedestrian-entry candidate. | Bus/vegetation obscure the ground; cannot certify an entrance flight. |
| 2116–2120 Leavenworth Street | Tiny partial `door` box remains unknown. | The complete front/entrance is not visible; no staircase invented. |

The Union annotation confirms **at least one visible tread**, not an exact
riser count. It is a single-image semantic review, not independent measured
ground truth. Its source/crop hashes, reviewed pixel box and attribution are
committed in `data/benchmarks/frontage-opening-annotations-v1.json`. Audit runner:
`scripts/audit_opening_rules.py`. Private outputs: `build/opening-rule-audit/`.

## Current filter

Latest completed live selection: **199,706 image/frontage candidate pairs** for
**12,063 building records**, across eight regions / 63,553 regional building
records. Regions overlap; these are not unique photograph counts or verified
full fronts. Existing regional catalogues contain 666,037 observation rows.

The bounded live pixel sample totals **96**: **32 retained review candidates**,
**62 rejected**, **2 download/decode failures**. Retained does not mean
privacy-certified, address-certified, or calibrated geometry. Rejected scratch
pixels are pruned after each batch; source catalogues/provenance survive.

The filter remains active, reviewing up to 24 unseen building/view examples per
hourly cycle. It does not thin or discard the source flight/sequence catalogue.
Failed downloads can retry. Local jobs require this Mac to remain awake and must
be resumed after an OS restart.

## Current reconstruction / matching

The updated matcher completed **34 distinct building specifications** from live
and pilot evidence. Across their selected views it recorded **11 garage
candidates**, **13 pedestrian-entry candidates**, **39 unknown opening
proposals**, and **10 quarantined stair proposals**. Counts describe proposals,
not independent physical features or certified accuracy.

This job is **prior-constrained visual facade fitting**, not a running dense
photogrammetry reconstruction. Canonical footprints/heights still supply metric
priors. Ground-camera height remains estimated, clipping/pose alignment remains
unresolved, and window recall/material colour still need improvement. No claim
of inch-scale accuracy is supported. **Zero new facade fits are promoted.**

The matcher runs every five minutes and consumes new retained evidence. Existing
detector outputs are reused by exact crop hash; new crops invoke the pinned model.
Opening rules are part of both the implementation fingerprint and the safe-stop
watcher fingerprint. Automated publication remains disabled.

## Verification / release state

**113 focused tests pass**: garage-size variants, one/two/five/six-step entrance
evidence, nonstandard observed openings, driveway lips, unknown/invalid cases,
proposal-index identity, fitter/renderer contradiction guards, all-region
generated-source synchronization, existing openings/windows/walking, filter,
retention, cache and grounding behavior. Ruff and whitespace checks pass.

Graphify is refreshed AST-only. Changes remain on the existing draft PR 32;
the preceding commit's full CI was green, and the new commit reruns CI. No new
house geometry or app deployment is promoted until the separately required real
3D/photo accuracy checks pass. This pass improves the semantic decision layer;
it does not imply the reconstruction pipeline is finished.
