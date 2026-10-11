# Multisource frontage, storefront names and recoverable geometry

## What actually runs

The existing all-eight-region workers process 256-photo private batches on the verified HP700 volume. The supervisor allows AC operation and battery operation strictly above 30%, maintains a 4 GiB external reserve, prevents idle sleep while eligible, and pauses if power readings or the expected volume are unavailable. It cannot override shutdown or closed-lid sleep. Publication remains an explicit reviewed release, not an automatic background action.

At the October 10 evening checkpoint, the same filter/matcher/storefront processes had been alive for more than eight hours while this chat was idle. Earlier in this pass they were deliberately stopped for upgrades; startup errors in rank handling and the PandaSet member path were corrected before resuming. This was not uninterrupted operation throughout the entire pass. Filter progress advanced from 95 to 152 processed items in the current batch during the resumed verification.

This is **image screening and facade-parameter fitting on canonical priors**, not a validated dense city photogrammetry mesh. The previous checkpoint held 1,171 buildings and 1,227 private proposals. These counts are snapshots, not completed high-certainty houses; source changes require a safe matcher restart and revalidation. Unreviewed fits cannot enter the public app.

## Multiple imagery sources

- Fair, persisted queues now balance region and provider instead of allowing one provider/city to consume every batch. They retain all distinct source views and acquisition relationships.
- A central pixel adapter supports Mapillary, KartaView, Panoramax and PandaSet. Panoramax clients are keyed by both provider and instance.
- PandaSet frames are extracted from their proper `sequence/camera/name/frame.jpg` archive member. A live camera frame decoded to 1920 × 1080 RGB, with 179,993 JPEG bytes; approximately 10.1 MB of archive/index range reads were needed, not a 44.5 GB archive download.
- Archive reads now require the exact requested 206 byte range and reject ignored, truncated or oversized responses before reading an entire archive into memory.
- An immutable-selection compatibility receipt prevents unrelated pixel-reader/scheduler fixes from repeating hours of unchanged catalogue indexing. Reuse requires matching world, catalogues, poses, terrain, policy and date; the narrowly audited legacy selector and database/run hashes are recorded. It grants no pose/privacy/accuracy approval.
- Non-Mapillary image acquisition does not automatically establish solved cameras. Accepted views lacking suitable calibration/georeferencing stay in review rather than becoming measured geometry.

## Requested research datasets: boundaries, not a completed import

[SF-XL's official repository](https://github.com/gmberton/CosPlace) reports approximately 1 TB for the full dataset, 360 GB for the training subset and 5 GB for its debug version. Its StreetView-derived database and software licensing must not be confused with permission to publish image-derived buildings. Access/derivative rights remain unapproved; the earlier no-Google-imagery policy still applies. Flickr query images would need individual rights checks.

[3D Street View](https://github.com/amir32002/3D_Street_View) combines Google imagery with **manually generated, georegistered** city models. Those models are not independent photogrammetric/lidar ground truth. Its [dataset license](https://github.com/amir32002/3D_Street_View/blob/master/LICENSE) restricts commercial derivatives and redistribution.

Both sources are registered as disabled for production and benchmarks pending explicit rights review. Tested metadata parsers preserve image/patch/target/StreetView identities and partner lists; SF-XL preserves filename geolocation/heading fields without fabricating missing epochs, CRS or panorama identity. No restricted images or meshes were downloaded, no agreement was accepted, and **the requested block-by-block reference-mesh comparison has not run**.

A private 250 m cell audit instead reports current-fit review signals and excludes stale-world fits. Its cells are not official city blocks, and its flags are not metric accuracy scores. It is ready to support an authorized reference comparison once assets and suitable rights exist.

## Storefront names

Recovered **2,775 additional source-matched tenant-name records** across eight regions: SF corridor +2,762; Mission +1; Sunset +1; Oakland +4; Berkeley +2; San Jose +5; Haight/Castro and Palo Alto unchanged. The SF audit withheld 2,004 lower-confidence/rights-unconfirmed place records. There are still **78 mapped retail/restaurant buildings without a matched name**; this is not a claim that every store is named.

New names require exact building identity, approved source terms and confidence ≥0.8. Geometry hashes are unchanged. The explicit release produces name-only sidecars bound to building footprints and heights. Names are searchable and shown on the building address card. A tenant inside a footprint does **not** establish a ground-floor sign position, photographed storefront or business interior; this release does not invent those geometries.

The final Berkeley sweep caught a lookup gap outside the high-detail render window. The shared search index now reads the current app payloads and hash-bound tenant-name sidecars, retaining those names outside the loaded window and across regions. The installed-app build refreshes that index and includes it in the service-worker fingerprint. No additional geometry is loaded to supply a search hit.

An additional **27 targeted search/runtime tests passed** for that correction. After the safe restart, the filter refreshed its UTC-date eligibility index and progressed past 5,700 SF buildings while the matcher processed independently; this phase is not a pause and does not reset prior review receipts.

## Long-running renderer fault

The old ground-memory optimization set uploaded geometry arrays to `null`. A long-running preview subsequently raised Three.js `byteLength` errors on buffer uploads. Static buffers now retain lossless compressed snapshots using pinned MIT [fflate](https://github.com/101arrowz/fflate); synchronous access restores the original typed-array bytes whenever an upload needs them. Shared attributes are wrapped once, changed versions invalidate snapshots, unsupported/incompressible data stays resident, and codec failure falls back to original arrays.

No vertices, triangles, normals, UVs or index precision are reduced. This is not video compression or an approximation. Dynamic curb buffers remain outside this static-ground optimization. A real WebGL fixture preserved **19,200 triangles** and bit-identical attributes through two forced context-loss/restoration cycles with no console errors. Unit tests also cover repeated uploads, changed arrays/versions, offset buffers, all used index precisions and unavailable/failing codecs.

All eight installed-app viewers, the runtime manifest (including codec hashes) and service-worker fingerprints are rebuilt from the authoritative renderer source. The frozen website's map pages are not used as templates. Only targeted local tests are run; production remains blocked on the PR's required ruff, pytest and render-audit checks.

Verification: **73 targeted tests passed**, blocking lint and diff-whitespace checks passed. Graphify's AST-only update used no model tokens and produced 14,725 nodes, 21,870 edges and 615 communities. Its >5,000-node visualization is aggregated; 91 community labels changed and semantic relabeling is deferred.

## Deferred

Written rights for the two named datasets; actual reference-asset import and block comparison; solved multiview evidence for additional providers; validated dense reconstruction and lidar accuracy promotion; photographed sign placement and business interiors; the remaining unmatched stores; and proof that the installed Safari app cannot reload under every possible memory condition. The recoverable-buffer test fixes a reproducible fault, not a universal claim about all reload causes.
