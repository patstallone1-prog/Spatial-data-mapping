# Business Interior Studio

The existing local Interior Studio now includes houses and all business categories in
the city rules, plus the exterior library's institutional and automotive categories.
Use **Space category** and **Space library**, then select a floor/room and edit furniture,
room type, paint and partitions through the same house editing workflow. Search
the catalog or select **All furniture & equipment** to go beyond room recommendations.
Small props require a supporting surface; compound decorated table sets are distinguished
from plain tables so their full bounding box is not mistaken for a bare tabletop.

The library contains inferred restaurant/store engine outputs, detailed specialty-engine
examples, and 72 clearly labeled practice programs on rectangular, angled and L-shaped
synthetic tenancies. These are game hypotheses, not reconstructions of actual businesses.
The supplied footprint, source window/door positions, elevations and stairs stay fixed.
Vehicle parking, ramps, charging/fuel equipment and structural supports are protected.
Room splits and merges preserve existing holes, including holes for stairs and ramps.

Owned businesses expose **Customize interior** in their management panel. The world checks
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
