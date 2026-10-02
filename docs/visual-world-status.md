# Visual-world implementation checkpoint

This branch is a visual-detail workstream based on `main` commit `48ee3303`. It is not a production deployment. The canonical road, curb, building footprint, and collision data remain separate from photo-derived or inferred appearance.

## Current source of truth

- `scripts/build_sf_corridor_3d.py` embeds the renderer template; `docs/sf-corridor-3d.html` is the served copy. Keep both identical when editing the renderer. `tests/test_renderer_template_sync.py` fails on drift so a rebuild cannot silently restore an older UI or geometry rule.
- `data/regions/sf-corridor/world/photo_objects.journal.jsonl` is the resumable SF photo-object journal. Its accepted opening proposals are image-backed, but heights and wall geometry still inherit canonical priors. They are not a surveyed mesh or collision truth.
- `docs/sf-corridor-materials.json` contains high-confidence material assignments; `docs/materials/manifest.json` records the license, source, and checksums of the CC0 texture assets. Unknown, glass, and metal assignments do not receive a guessed masonry texture.
- `docs/sf-corridor-furniture.json` is the current furniture sidecar. Sign-face aliases retain source asset IDs after dense duplicate collapse. Signal lamp colour is visual only; real-time phase is unknown.
- `docs/sf-corridor-interiors.json` fits external dwelling-plan templates to buildings. Room details, furnishings, and most doors are inferred, not scans of those addresses. `data/scans/` currently has catalogues, not usable imported house meshes.

## Interior candidate (October 2, 2026 — not deployed)

- Nearby houses now have real panelled wall holes rather than doorway depth masks. Eight nearby houses are detailed at a time; retiring one restores its exact batched wall indices. Distant city batching is retained. This is render-only geometry on the existing footprint and height.
- One shared opening registry drives the outside wall, inside lining, double-sided transparent glass and frames. The sidecar `docs/sf-corridor-home-openings.json` supplies accepted photographed windows for 3,897 buildings, with source hashes. Unsupported sides use explicitly procedural whole-window layouts; party-wall contacts suppress windows. No facade image is allowed to cover an active detailed shell.
- Raised entrances use inward, footprint-tested stairs and a four-tread-deep landing. Closed-door collision is at the recessed leaf, with stairwell return walls. Inferred flights require a local hill and at most three steps. First-person entry excludes the stair recess until the walker passes the landing.
- Fitted external plans have an open foyer and a safe connection toward a living/dining/circulation space, with the same cuts applied to visual partitions and collision. Floors have material patterns; coherent room palettes have subtle plaster texture. Kitchen/laundry fixtures remain inferred procedural furnishings.
- Four CC0 Poly Haven glTF assets (sofa, dining table, bed frame and armchair) are included in `docs/interior-assets/manifest.json`, with source URLs and verified checksums. Room bounds and clear entrance paths constrain placement. Shared imported geometry is not disposed when an individual house is unloaded.
- The app build now reads the canonical renderer directly, never an older `build/app-viewer.html`. Eight generated app viewers share the new functions, enforced by regression tests. Asset content participates in the installed-app cache version.
- The grass candidate uses the same early render precedence as mapped plazas so coarse hillside backdrop chords cannot cover fine grass. Its hard-surface mask also excludes road pixels. This must be visually reviewed; public parcels are not automatically relabelled as lawns.

## Deployment gate still open

The current browser refused access to the supplied localhost preview under its security policy. No workaround was attempted. The new shell, transparent glass, furnishings and grass precedence therefore have geometry/source checks, **not a completed live visual sweep**. Do not promote this candidate until inside/outside windows, stairs on flat and steep frontages, signals/sign faces, wall materials and the fire-station block have been visually reviewed.

The fire-station block's large gray/green patches include land-use-classified public-parcel paving, which needs independent imagery review before being relabelled. A prior street-level check at 2026 California Street found a residential wall classified as glass and rendered as a generic grid; its material evidence needs review before overriding that classification. Upper floors currently have visual slabs, not fully furnished accessible plans. The SF corridor's OSM extract has no mapped utility-pole or overhead-wire records, so that path has only synthetic test coverage. The fresh photo survey remains blocked by missing credentials/pose evidence; the append-only journal preserves existing results but no healthy continuing reconstruction job can presently be claimed.

These issues must not be represented as complete in a release. Older implementations remain in Git history and the other isolated worktrees; they are not interchangeable sources for the current renderer.
