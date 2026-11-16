# Business Interior Studio

The existing local Interior Studio now includes houses and all business categories in
the city rules, plus the exterior library's institutional and automotive categories.
Open **Your space** to choose a practice home or business. Click the 3D floor, wall,
window or furniture to open a compact menu beside the pointer. Floors offer materials,
furniture, walls and area selection; drag a grid rectangle for carpet, a local finish or
a room. Furniture can be moved, replaced or removed. Walls accept artwork and shelves.
The Items catalog shows rendered thumbnails and names, recommended first, with search
and type filters. Small props require a supporting surface. Stairs stay fixed; use the
up/down triangles to change the cutaway floor.

The library contains inferred restaurant/store engine outputs, detailed specialty-engine
examples, and 72 clearly labeled practice programs on rectangular, angled and L-shaped
synthetic tenancies. These are game hypotheses, not reconstructions of actual businesses.
The supplied footprint, entrance positions, elevations and stairs stay fixed. Business windows
can be edited; house windows remain locked unless the city verifies them.
Vehicle parking, ramps, charging/fuel equipment and structural supports are protected.
Room splits and merges preserve existing holes, including holes for stairs and ramps.

Approach an owned house or business and right-click it, then choose **Edit interior**.
The cutaway opens inside the game. **Finished editing** offers Save, Discard or Keep editing;
Discard asks for confirmation. Save waits for the world to accept the design and rebuild
its render and walking barriers before returning to the game.
Owned businesses also expose **Customize interior** in their management panel. The world checks
the current owner and business state, saves the accepted design, and uses the same plan
for rendering and walking barriers. When no inferred commercial plan exists, a starter
uses the loaded Kerbside tenancy outline, available source windows, actual entrance and
bundled furniture catalog. A building with multiple
tenants needs a verified tenant boundary before one shop can be edited. A missing entrance
is reported rather than inventing one. A single tenant gets its ground-floor program;
upper tenancies are not inferred from the whole building height.

`scripts/import_business_assets.py --cache /path/to/cache` downloads the reviewed free
CC0 models and invokes `tools/business-assets/prepare.mjs`. Install the adjacent package
dependencies, or set `KERBSIDE_ASSET_NODE_MODULES` to an existing compatible dependency
cache. The pipeline records provenance/checksums, converts self-contained GLBs, limits
triangles/textures, validates geometry and normalizes scale/pivots. A failed import does
not replace the catalog manifest. `node tools/build_business_studio.mjs` refreshes the
practice library using the resulting catalog, preserving detailed engine examples.

The [spatial design rules](./design-rules.md) are game guardrails, not a
claim of permit, health-code, fire-code, accessibility or clinical design approval.
