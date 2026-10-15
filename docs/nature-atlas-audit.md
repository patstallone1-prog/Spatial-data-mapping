# Connecting landscape v1

The app's eight current regional viewers now share one continuous, source-backed
landscape rather than a flat green perimeter. This is an appearance/terrain layer,
not new surveyed city geometry or a photogrammetric reconstruction.

## Coverage and evidence

- Approximately 72.12 × 77.88 km (5,617 km² in the local serving frame), covering
  the existing regional perimeter, the land between cities and its surrounding margin.
- 3,514,192 shared 40 m vertices; all 1,443 near-ground cells published at 10 m
  sampling. Heights range from −10.10 to 1,168.73 m in the source raster.
- USGS [3DEP bare-earth elevation](https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer),
  [Annual NLCD 2024 Collection 1](https://api.water.usgs.gov/gdp/pygeoapi/stac/stac-collection/nlcd/nlcd-LndCov/Annual_NLCD_LndCov_2024_CU_C1V1?f=json),
  and [USFS tree-canopy cover](https://data.fs.usda.gov/geodata/rastergateway/treecanopycover/index.php).
  Source URLs, epoch, attribution, datums and hashes are in `nature/manifest.json`
  and `nature/elevation-sources.json`.
- 760,126 unique mapped OSM reference features supply trail geometry, natural-area
  refinements, building/road/court clearances and coastline direction. These remain
  a separate [ODbL-attributed](https://www.openstreetmap.org/copyright) visual layer.
  `nature/paths.json` records the Geofabrik extract hash and older coast snapshots.

## Rendering and safety

- Forest, scrub, grass, pasture/crops, wetlands, barren ground, beach and water use
  different source classes. World-space grain replaces repeated grass image stamps.
- Canopy samples continuously vary inferred tree density. Globally owned 8 m
  candidate slots carry jitter; neighbouring candidates compete across tile boundaries.
  Crown clearances do not depend on loading order. Density ownership is recorded
  in 100 m cells; draw batches cover four such cells, not square forest patches.
- Four tree shape families, shrubs and evidence-constrained rocks vary appearance.
  Species, individual positions, dimensions and sand microstructure are inferred.
  These are not measured trees or collision/robot-navigation truth.
- Actual mapped trails retain surface tags. Public steps have flat treads and
  matching walker heights. Roads, buildings, courts and water exclude vegetation.
- Mapped beach polygons and signed coastline distance remove the visibly stepped
  waterline produced by interpolating coarse land-cover colours alone.
- Water colour, roughness and metalness match the existing city water; soil grain
  is suppressed on water so regional ownership does not draw a rectangular colour seam.
- The near ground uses nine resident 2 km cells, shared source edges, an 80 m
  boundary blend and a 600 ms height transition. Physics uses the rendered triangle
  convention. Picking rejects coarse terrain already hidden by fine or city terrain.
- Distant city roads/buildings follow the new ground and rebase in place when it
  refines. Storey heights and triangle counts are retained; no city geometry download
  is repeated just to update its ground height.
- An empty, clamped SF lidar edge no longer returns sea level before consulting
  the atlas. Distant East Bay queries now retain their actual source height. The
  regression test checks agreement with source elevation, not just two mutually
  consistent but incorrectly flat renderer/physics implementations.
- Canonical city payloads and measured lidar are unchanged. Host/guest display
  coordinates use one planar orthometric reference instead of different cosmetic
  curvature drops. Boundary blends do not establish geodetic accuracy.

## Reproduction and regression gates

```sh
pip install -e '.[nature,dev]'
PYTHONPATH=src python scripts/build_nature_atlas.py
PYTHONPATH=src python scripts/build_nature_paths.py --pbf /path/to/norcal.osm.pbf
PYTHONPATH=src python tools/build_app_worlds.py
pytest -q tests/test_nature_atlas.py tests/test_terrain_viewer_frame.py \
  tests/test_tunnel_ground_safety.py tests/test_renderer_template_sync.py
```

The path builder can additionally reuse a provenance-preserving `--coast-cache`
of Overpass snapshots. Raw statewide extracts and TIFF caches remain under ignored
`build/nature`; only compressed, validated derivatives are published. Request hashes
prevent a changed extent/epoch from silently reusing a same-sized cached raster.
Manifests publish last; an interrupted fetch cannot advertise an empty measured cell.

Regression checks cover asset hashes, the complete fine-cell set, every shared DEM
edge, unknown canopy, invalid elevation rejection, lossless endian encoding, tree
non-overlap/load-order independence, coarse/fine triangle heights, city ownership
in picking, host/guest continuity and repeated LOD rebasing without stretched houses.
The renderer module and both data manifests are fingerprinted in `runtime-release.json`.
Eight viewers are generated from one authoritative template. Frozen website viewers
are not a source template and were not edited.

Visual fixtures: `tools/nature_preview.py` and `tools/nature_app_preview.py`.
Checks used the Presidio (−122.462, 37.796), Baker Beach (−122.484, 37.793),
East Bay hills (−122.217, 37.868) and Peninsula forest (−122.299, 37.429).
Local screenshots and raw browser audit reports live under ignored
`build/audits/nature-atlas`.

The live app fixture's 25 Presidio downward-ray stations agreed with walker heights
to 0.000019 m after accounting for the deliberate 35 mm display underlay. This is a
render/physics consistency check, not independent real-world accuracy evidence.
The corresponding East Bay and Peninsula checks passed 25 stations each, with
maximum numerical ray/physics differences of 0.000355 m and 0.000322 m respectively;
both had zero difference between the walker query and source-height interpolation.
The targeted terrain, city geometry, tunnel, pacing, bridge, template-sync and road
baseline test group passed all 175 tests. The CI suite remains an additional gate.

The actual app-renderer fixture measured 58.44 FPS / 3,046,521 triangles at the
Presidio before the final jitter/shoreline refinement, and 60.10 FPS / 4,196,435
triangles in the final Peninsula scene. Each uses 180 active frames in the local
desktop in-app browser, not a mobile or full-city stress benchmark. The Peninsula
scene retained 15,908 inferred trees, 7,462 shrubs, nine fine DEM tiles (1,454,436
decoded height bytes) and 4,761,449 decoded path bytes. Path "trails" counters are
generated quads, **not unique trails**. No browser shader/runtime errors were observed.

## Limits

- A 10 m serving grid and centimetre integer encoding do **not** imply 10 m or
  centimetre survey accuracy. Source datums include NAVD88 and unspecified overview
  records, retained explicitly in the catalogue.
- NLCD/canopy are 30 m classified/modelled products. They do not locate every
  garden, beach pebble, tree or small clearing. Visual density is approximate, not
  an exact recovered canopy footprint. Distant canopy uses aggregate proxies.
- Grade-separated trail bridges/tunnels are retained but not draped onto bare earth
  without vertical evidence. This pass does not fabricate those structures.
- Unmapped developed areas keep their developed cover; this does not invent a
  detailed suburb, complete every missing building/road, or replace existing city parks.
- This updates the installed web app runtime. No native Unreal package was rebuilt.
- GitHub's existing ruff, pytest and render-baseline checks still gate main/Vercel;
  this pass does not bypass them or weaken a baseline to make a release pass.
