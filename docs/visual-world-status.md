# Visual-world release notes

This release combines the visual-detail and house-interior workstreams based on `main` commit `48ee3303`, through PR #8. The canonical road, curb, building footprint, and collision data remain separate from photo-derived or inferred appearance. GitHub's Pages deployment history identifies the live revision; local previews and historical checkpoints below do not establish deployment by themselves.

## Current source of truth

- `scripts/build_sf_corridor_3d.py` embeds the renderer template; `docs/sf-corridor-3d.html` is the served copy. Keep both identical when editing the renderer. `tests/test_renderer_template_sync.py` fails on drift so a rebuild cannot silently restore an older UI or geometry rule.
- `data/regions/sf-corridor/world/photo_objects.journal.jsonl` is the resumable SF photo-object journal. Its accepted opening proposals are image-backed, but heights and wall geometry still inherit canonical priors. They are not a surveyed mesh or collision truth.
- `docs/sf-corridor-materials.json` contains high-confidence material assignments; `docs/materials/manifest.json` records the license, source, and checksums of the CC0 texture assets. Unknown, glass, and metal assignments do not receive a guessed masonry texture.
- `docs/sf-corridor-furniture.json` is the current furniture sidecar. Sign-face aliases retain source asset IDs after dense duplicate collapse. Signal lamp colour is visual only; real-time phase is unknown.
- `docs/sf-corridor-interiors.json` fits external dwelling-plan templates to buildings. Room details, furnishings, and most doors are inferred, not scans of those addresses. `data/scans/` currently has catalogues, not usable imported house meshes.

## Interior implementation (October 2, 2026)

- Nearby houses now have real panelled wall holes rather than doorway depth masks. Eight nearby houses are detailed at a time; retiring one restores its exact batched wall indices. Distant city batching is retained. This is render-only geometry on the existing footprint and height.
- One shared opening registry drives the outside wall, inside lining, double-sided transparent glass and frames. The sidecar `docs/sf-corridor-home-openings.json` supplies accepted photographed windows for 3,897 buildings, with source hashes. Unsupported sides use explicitly procedural whole-window layouts; party-wall contacts suppress windows. No facade image is allowed to cover an active detailed shell.
- Raised entrances use inward, footprint-tested stairs and a four-tread-deep landing. Closed-door collision is at the recessed leaf, with stairwell return walls. Inferred flights require a local hill and at most three steps. First-person entry excludes the stair recess until the walker passes the landing.
- Fitted external plans have an open foyer and a safe connection toward a living/dining/circulation space, with the same cuts applied to visual partitions and collision. Floors have material patterns; coherent room palettes have subtle plaster texture. Kitchen/laundry fixtures remain inferred procedural furnishings.
- Four CC0 Poly Haven glTF assets (sofa, dining table, bed frame and armchair) are included in `docs/interior-assets/manifest.json`, with source URLs and verified checksums. Room bounds and clear entrance paths constrain placement. Shared imported geometry is not disposed when an individual house is unloaded.
- The app build now reads the canonical renderer directly, never an older `build/app-viewer.html`. Eight generated app viewers share the new functions, enforced by regression tests. Asset content participates in the installed-app cache version.
- The grass candidate uses the same early render precedence as mapped plazas so coarse hillside backdrop chords cannot cover fine grass. Its hard-surface mask also excludes road pixels. This must be visually reviewed; public parcels are not automatically relabelled as lawns.

## Final verification and deployment gate

The earlier preview failure was a stale connection-error document, not a browser security restriction. A normal HTTP preview works. Live entrance checks exercised SF building 288529259 (photographed entrance, five inward steps), Berkeley building 24025425 (mapped entrance, one step), and Oakland building 47387209 (mapped entrance, two steps), with 1.2 m landings. Berkeley and Oakland stayed in orbit view on the stair recess and switched to first person beyond the opened leaf. The Berkeley window showed exterior street geometry from inside. Final visual checks and the exact-green-main CI deployment remain required before promotion.

Address searches now land outside an available door rather than teleporting into a building centroid. Furniture placement retries clear positions away from entry circulation and checks its whole footprint, including partly clipped rooms. Kitchens have distinct sink/tap/cooktop/oven details. Upper floors repeat explicitly inferred room/furnishing layouts rather than remaining empty slabs; storey counts respect plausible mapped/inventory values. Upper-storey layouts are visual only: the walking surface remains the entrance floor, not an invented measured internal stair network.

The grass hard mask retains 0.75 m samples, but only evaluates conservative grass polygon bounds. On the committed SF source, including its 40 m halo, this reduces the raster predicate workload from 23,784,520 to 9,474,683 samples (60%); this is not a claimed FPS measurement. The same material/opening assets resolve from the shared app root in every region, while interior fits stay region-local.

The fire-station block was also compared with the public USGS NAIP orthophoto service; its rear yards contain both vegetation and paving, so public-parcel concrete is not arbitrarily relabelled as measured grass. The reference is an appearance check, not a current parcel-scale survey: https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer . A prior street-level check at 2026 California Street found uncertain glass classification; unknown material evidence must not be upgraded to measured masonry merely to improve appearance. The SF corridor's OSM extract has no mapped utility-pole or overhead-wire records, so that path has only synthetic test coverage. The fresh photo survey remains blocked by missing credentials/pose evidence; the append-only journal preserves existing results but no healthy continuing reconstruction job can presently be claimed.

These evidence limitations must remain visible in a release. Older implementations remain in Git history and the other isolated worktrees; they are not interchangeable sources for the current renderer. Template synchronization, cross-region function parity, interior-source validation, geometry/collision tests, asset checksum checks and exact-green-main CI deployment protect this work from stale generated-page/cache overwrites; no finite test suite guarantees that all future regressions are impossible.

## October 2 follow-up verification

The pavement CI failure was an audit defect: its copied service-width table lacked
`access`, producing non-finite widths and fictitious missing pavement. The audit now
extracts that table from the canonical renderer. All nine committed-baseline checks
pass without relaxing their thresholds: 23 of 3,340 required pavement sides are
bare (0.7%), and 91.3% of requested mapped footway length survives clipping.

The final SF closed-door walk stopped at depth 2.4 m behind the facade, before the
recessed leaf, and did not automatically enter first person on the landing. In
Oakland the opened entrance transitioned to first person beyond the two-step
flight/landing. Room checks showed the imported bed frame, kitchen sink/cooktop,
flooring and interior door leaves; the same physical windows showed the street
from inside. The storey inventory is six rather than the earlier thirteen-row guess.

SF building 288529259 exposed an empty furnishing result in an irregular fitted
plan. Placement now searches the clipped room/footprint intersection and tries
both axes rather than only vertex averages with one orientation. New executable
tests cover this real concave footprint and a narrow clipped bedroom. The final
preview showed four accepted furnishing groups and an imported sofa. Unsafe
placements are still omitted; this is not a claim that every clipped room has a
complete kitchen or that the inferred plan is the address's real interior.

The opt-in `?inspect=interiors` panel adds safe room viewpoints for manual checks,
alongside its ordinary swept walking/door controls. It is hidden in the normal app.
That preview's remaining camera-dependent checks were interrupted by the Mac
locking. They were resumed in the release acceptance sweep below.

## Release acceptance sweep — October 2

- Rechecked the fire-station block at 2150 California Street in the final app renderer: the former scattered hillside grass/pavement voids are gone in this view, the access fallback remains car-width, and window layouts do not clip a top row into the roof. Actual paved yards remain paved; this is not a blanket conversion of backyards to measured grass.
- Reviewed the assigned brick facade at 1355 Sansome, concrete at 1600 Powell and stucco at 1050 Sansome. Whole rows and material/window layering remain intact. These assignments are image-inferred, not measured material truth.
- Inspected crossing corners at Hyde/Jackson, Broadway/Front and the California block. Yellow warning pads remain above the pavement. At Broadway/Front, inspected all approaches and a close view of the three-aspect head, street-name faces and speed-limit face. Lamp phases remain explicitly unknown. Inventory points describe junctions, not surveyed individual pole installations.
- Signals now have a bounded 32 m pavement search rather than inheriting the 12 m sign limit. The fallback rejects building interiors and rechecks the final setback position for carriageways/junctions. A regression exercises a junction requiring more than 12 m to reach safe pavement. The final SF diagnostic renders all 363 records typed `SIGNAL`; 16 beacon/flasher/message/pending/future records are not misrepresented as ordinary traffic lights. Safe sign filtering renders 17,390 faces from 21,474 official inventory faces; inventory count must not be presented as placed count.
- Additional Berkeley entrance check: building 24025427, mapped two-step entry, 1.2 m landing, 37 inferred furnishing groups and two source storeys. Orbit view persists at entrance depth 1.5 m and first person starts by 2.5 m. Viewed flooring, interior door leaves and the street through a physical window. Previous SF and Oakland entrance/collision/window checks remain recorded above.
- The final SF browser reports no console errors. Its cold full-detail rebuild still takes several minutes in this desktop preview; the raster predicate reduction is not proof of fast startup or a measured FPS target. Performance remains an honest limitation.
- 49 focused tests pass after the signal follow-up. Before that follow-up, CI passed 1,061 tests (two skipped) plus nine baseline checks. Final promotion additionally requires all checks on the release revision, then exact-green-main CI and the Pages deployment workflow; no direct branch publishing or force-push deployment is used.
- Checked both live download-site buttons: Android and iPhone instructions link to `https://patstallone1-prog.github.io/Spatial-data-mapping/app.html`. This is a browser-installed app, not a newly published APK/IPA or App Store binary.

Rendered acceptance captures are retained locally under `build/visual-audit/`
(ignored build artifacts), including the California block, Oakland kitchen,
Berkeley interior, Broadway/Front signal and install site. No licensed source
photographs were newly committed for this sweep. Upper-floor navigation, complete
furnishing of every clipped room, a surveyed interior for each address, actual SF
utility-wire coverage and a new photogrammetric mesh are not claimed by this release.
