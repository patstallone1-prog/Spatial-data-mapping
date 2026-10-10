# Architectural cross-checks and door access — private accuracy checkpoint

## Outcome

The photo-facade pass remains **unpromoted**. Three real buildings were regenerated and inspected from three viewpoints, but they are not yet three successful real-life matches. No bulk approval or production deployment was made. The AC-powered private filter and matcher remain running through the existing LaunchAgent.

The user story checked here is: registered street-front photo → opening/material proposals → architectural consistency/access checks → canonical-footprint render → visual comparison → conditional bulk approval. The first unmet acceptance boundary is the actual photo-to-render match, not whether the models or viewer execute.

## Changes

- Added an exact **0.1524 m (six inch)** maximum for an unstepped door. Unsupported raised entries are withheld rather than snapped down or supplied invented stairs. The displayed leaf is checked against the terrain outside its left, middle and right points. Existing inward stoop rendering also refuses a raised leaf without an actual stoop plan.
- Stair evidence must refer to the same opening and source image, identify a visible reviewed flight, match its rise to the threshold, fit physically plausible risers and inward depth, and provide a landing at least four 0.30 m tread depths long. A metadata-only stair flag cannot excuse a floating flat photo panel.
- Added one-to-one comparisons of visible, similarly sized opposite-end windows/projections. Similar forms retain separate identities; missing counterparts are not invented. Asymmetry is a review signal, not something automatically smoothed away.
- Added nearby entrance-pattern clues using distinct reviewed buildings/images, the same street/region, within 75 m and oriented fronts within 15 degrees. Supplied block IDs are respected. Without one, the result explicitly does not claim a verified block majority. At least three reviewed peers and a two-thirds majority are needed even to prioritize review; no neighbour creates stairs or upgrades certainty.
- Replaced global neighbour scans with conservative spatial buckets, retaining exact distance/orientation filtering and region separation.
- Fixed loss of photo windows on existing front-facing canonical bay returns. Windows split over their actual footprint edges while retaining opening identity and source pane positions; a face split does not introduce a new frame mullion. Side/party/back walls remain excluded.
- Suppressed additional photo-derived bay geometry over existing canonical front relief. The original projection proposal/depth and canonical hash are retained for review. Existing bay geometry is not removed or projected twice. The runtime also rejects residuals on offset faces and checks old fits against current footprint relief.
- Replaced the private pilot's rectangular smoke-test proxies with rigidly transformed canonical footprints and polygonal roofs. Fixed a leftover four-vertex edge modulus that broke buildings with more than four vertices. Unit/perpendicular basis validation now rejects a stretched/skewed coordinate conversion.
- Found and fixed an outward-normal assumption shared by photo panels, balconies/fire escapes, window mapping and front-material classification. Endpoint order is not the physical front direction. New facts retain `front_normal_enu`; the renderer verifies it against the actual bound footprint edge and supports either winding/endpoint order. Legacy fits can recover the normal from their exact footprint, while an unbound plane or contradictory normal is suppressed. Existing front-facing bay-return triangles are included without dropping any triangles.
- Added a corresponding canonical-front binding diagnostic to extracted facts. An offset/stale photo plane or inward normal stays low certainty and receives an explicit AI-review reason, even if a review checkbox says the facade looks acceptable. No automatic translation of the real footprint is attempted.
- Centralized the implementation fingerprint across matcher facts and bulk approval. A worker loaded against old source refuses to publish latest results after implementation changes and is restarted by the supervisor. Bulk approval binds both the current renderer and the full fitting implementation; old extractor facts cannot satisfy it.
- Regenerated all eight app consumers from the authoritative renderer. Updated stale regression expectations for intentional clear glazing and the newer storefront/bay interfaces; did not reinstate opaque windows merely to satisfy old tests.

These are render-only visual constraints. Canonical footprints, heights and collision were not changed into photo measurements. Every pilot remains LOW certainty and explicitly not inch-verified.

## Visual audit and remaining weaknesses

| Private trial | Verified improvement | Unresolved acceptance issue |
|---|---|---|
| 4153 20th Street, San Francisco | Four upper windows and two garage proposals preserved on the real footprint; unsupported elevated opening withheld | Pebble inset panels and gated-entry/ground alignment need review |
| 652 Guerrero Street, San Francisco | Window/entrance proposals and floor colour bands retained; parcel-limited additional bay suppressed | Front/parcel/bay-depth disagreement, ornament and entrance details remain unresolved |
| 2332 Taraval Street, San Francisco | Existing two bay returns now retain windows, without duplicate projections or invented seam frames | Arched upper window remains rectangular; ground shops/truck occlusion and materials need review |

Private screenshot: `build/frontage-accuracy-audit/pilot/render-proof.jpg`. Source photographs are not embedded in the public scene or committed. The diagnostic scene is not a complete in-city interior/lighting audit.

The pilot still uses manually reviewed image-space quadrilaterals, canonical height priors and inferred depth. It does not have independently solved metric poses/threshold controls. Photo-supported stairs also still need a connected, footprint-validated runtime stairwell consumer rather than a flat panel; certainty explicitly exposes this gap. These defects prevent bulk approval. Do not relabel these artifacts high certainty to force the gate open.

## Verification

**153 focused tests passed** in 7.93 seconds. Coverage includes door limits and rendered terrain, supported stairs/landing, separate repeated objects, neighbour independence/region/block/distance rules, rigid coordinate conversion, duplicate canonical relief, bay seam identities, source-bound publication, bulk version invalidation, retention, all eight module syntax checks and authoritative-source/release synchronization. The orientation tests additionally exercise 96 real footprints (12 per region), reverse their winding and facade endpoints, and check panel/balcony placement. Blocking Ruff checks passed with the repository's existing line-length exclusion; `git diff --check` passed. This is not a claim that the entire CI suite has run locally.

An additional audit of 316 existing private building proposals validated 311 front normals. For 13 of those, the old unconditional left-hand normal pointed in the opposite direction. Five registered planes were unbound/invalid against the current footprint and are withheld by the runtime guard; they are not silently repaired or certified. This is software/data orientation evidence, not a new photographic precision measurement.

Graphify was refreshed using AST-only extraction: 14,561 nodes, 21,576 edges, 614 communities, no model extraction cost. It warned that 109 community labels were renamed after the community set changed; semantic community relabeling was not run.

## Live processing snapshot

At this checkpoint the restarted matcher completed a cycle using the current implementation fingerprint: **298 buildings / 325 private fit proposals**, 380 processed view timings, 450 raised-opening render suppressions, 55 repeated-form pairs and **zero reviewed neighbouring-entry patterns**. The latter is expected: unreviewed proposals cannot reinforce each other. These counts are proposals/checks, not accepted houses, and view timings include cached work.

The filter has indexed 100,027 building-image candidate pairs across eight regions, for 9,296 buildings with candidates. These are not 100,027 unique photos or verified facades. Its latest review snapshot had 434 candidates awaiting privacy/identity review, 397 pixel rejections and 10 pose-review candidates. Catalogue status says `waiting_for_new_catalogues`, but the loop continues reviewing pending candidates in batches of 24. No automatically approved public photo fits exist.

The existing `com.kerbside.frontage-proposals` LaunchAgent is running one filter, one matcher and an AC-only `caffeinate` assertion. The Mac reported AC charging; approximately 10 GiB was free, with a 4 GiB processing reserve. The supervisor reports `full_run_approved: false` and `automatically_publishes: false`. Keep the machine plugged in, lid open and logged in; sleep prevention cannot override shutdown/closed-lid sleep. Existing raw-retention policy remains: rejected temporary photos are pruned, unresolved/low-certainty evidence stays private locally, and only finalized reviewed facts permit high-certainty raw removal.

## Before full-speed production

1. Resolve source-to-canonical/parcel alignment with trustworthy poses and ground controls; do not deform canonical facts to hide a weak registration.
2. Complete supported inward staircase runtime connections and preserve entrance styles/arched windows and observed material boundaries.
3. Review the actual three source/render pairs, privacy/rights, openings and materials; freeze their exact source/fact/implementation hashes.
4. Only after those three matches pass, produce the existing bulk-approval artifact. The supervisor can then raise its batch size. Publishing remains a separate validated action.

The current background work is a private, prior-constrained proposal run, not dense photogrammetry, a full-speed production run, or a deployment.
