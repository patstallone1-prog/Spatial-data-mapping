# Visual-world implementation checkpoint

This branch is a visual-detail workstream based on `main` commit `48ee3303`. It is not a production deployment. The canonical road, curb, building footprint, and collision data remain separate from photo-derived or inferred appearance.

## Current source of truth

- `scripts/build_sf_corridor_3d.py` embeds the renderer template; `docs/sf-corridor-3d.html` is the served copy. Keep both identical when editing the renderer. `tests/test_renderer_template_sync.py` fails on drift so a rebuild cannot silently restore an older UI or geometry rule.
- `data/regions/sf-corridor/world/photo_objects.journal.jsonl` is the resumable SF photo-object journal. Its accepted opening proposals are image-backed, but heights and wall geometry still inherit canonical priors. They are not a surveyed mesh or collision truth.
- `docs/sf-corridor-materials.json` contains high-confidence material assignments; `docs/materials/manifest.json` records the license, source, and checksums of the CC0 texture assets. Unknown, glass, and metal assignments do not receive a guessed masonry texture.
- `docs/sf-corridor-furniture.json` is the current furniture sidecar. Sign-face aliases retain source asset IDs after dense duplicate collapse. Signal lamp colour is visual only; real-time phase is unknown.
- `docs/sf-corridor-interiors.json` fits external dwelling-plan templates to buildings. Room details, furnishings, and most doors are inferred, not scans of those addresses. `data/scans/` currently has catalogues, not usable imported house meshes.

## Deployment gate still open

Transparent, bidirectional windows are not implemented: window artwork is still part of opaque facade textures. The recessed entrance is a depth-portal approximation, not a cut solid wall. The fire-station block's large gray/green patches include land-use-classified public-parcel paving, which needs independent imagery review before being relabelled. A street-level check at 2026 California Street found a residential wall classified as glass and rendered as a generic grid; its material evidence needs review before overriding that classification. The SF corridor's current OSM extract has no mapped utility-pole or overhead-wire records, so the pole/wire path has only synthetic test coverage. These issues must not be represented as complete in a release.
