# Kerbside interior inference pilot

A complementary engine lives in `src/smc/interiors/inference/`. It reads a footprint in local
metres and explicit storey heights, then exports one house with distinct floors, connected
stairs, rooms, openings, coordinated materials and physically placed furniture. The existing
ResPlan/Swiss Dwellings source adapters and their observed-template contract remain separate.

The review build is in the `codex/interior-engine` worktree at
`/Users/elialbukerk/Projects/Applications/kerbside-interior-engine`.

## Review and run

From the worktree root:

```sh
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python -e '.[interiors,dev]'
.venv/bin/python scripts/build_inferred_interiors.py
.venv/bin/python -m http.server 8794 --bind 127.0.0.1 --directory docs
```

Open [Interior Lab](http://127.0.0.1:8794/inferred-interiors/). The viewer provides house
selection, individual floors, a separated multi-floor view, full-height walls, labeled plans,
room inventories, palettes and validation statistics. It loads actual textured GLTF/GLB assets;
parametric fixtures cover kitchen appliances, sanitaryware, storage and laundry equipment.
Beds and sofas use a coordinated parametric fallback when the library lacks a matching style.

To generate other houses, pass a JSON array with `--input path/to/houses.json --out path/to/output`.
The command limits each batch to twenty houses. Fixture selection occurs before inference;
it does not select only addresses the solver can handle.

```json
[{
  "id": "example-house",
  "units": "metres",
  "footprint": [[0,0],[12,0],[12,10],[0,10]],
  "entrance": [4,0],
  "storeys": [{"height_m": 2.9}, {"height_m": 2.7}],
  "total_height_m": 5.6,
  "bedrooms": 3,
  "office": true,
  "neighborhood_price_per_sqft": 650
}]
```

`footprint` also accepts a GeoJSON Polygon, including holes. A storey may override the
footprint for setbacks. Coordinates must already be in a local metre frame. Object positions
are `[x, elevation, y]`; floor polygons use `[x,y]`. Supplied entrances must lie on the outline.
The Python API is `infer_house(HouseInput.from_json(record))`.

## Layout and placement

The search tries the footprint's dominant orientations, circulation cuts, public-zone
orientations and centre/side stair positions. It preserves the polygon rather than stretching
a source drawing. Cuts must leave connected rooms with usable dimensions and access to a
connected hallway. The score penalizes circulation area, undersized bedrooms and separating
bedrooms onto the ground floor. Sleeping rooms are kept upstairs together when feasible.

Living, dining and kitchen zones connect without partition walls or door leaves. Bedrooms,
full bathrooms, WC-only bathrooms and offices receive private single doors. Utility and
closet access stays open. The opening contract supports full access, cabinet partitions,
doorways, single doors and double doors. The pilot emits the first four; double-door leaves
are represented in the contract but are not automatically chosen by this minimal-door policy.
Cabinet partitions record the blocking objects and remaining passable spans.

Closets are carved only when bed access survives. Oversized wet-room regions can become a
bathroom plus laundry/storage. Failed furnishing attempts cause a different layout or a
closet-free variant to be tried, without address-specific rules. A WC-only room has a toilet
and basin. A full bathroom has a toilet, basin and combined tub/shower.

Beds back onto a wall and reserve a foot aisle and one side aisle. Placement protects door
approaches and verifies connected walking space between portals and furniture interaction
points. Dining tables and chairs are placed as a group. Offices include a desk and reachable
chair. Tabletop objects have parent references, exact contact elevations and matching XY
centres. The renderer scales source meshes to the same boxes the validator checks, including
support heights, and orients backrests/headboards toward the planned wall.

One aligned U-shaped core connects all storeys. Storey elevations accumulate the supplied
heights; riser count, tread depth, flight width, landing and upper slab openings are explicit.
The map adapter selects floors and collision segments by the walker's elevation.

## Materials, economics and objects

SHA-256 of the stable house ID selects a whole-house palette. Rooms vary within it; walls,
wood, fabric, stone, metal and accents have separate assignments. The renderer adds timber
and tile patterns and preserves the source models' textured finishes.

An explicitly supplied USD/ft² neighbourhood value selects an illustrative economy,
standard or premium allowance. Floor area scales the furnishing budget; model selection
scores style, source dimensions and the allowance. These are editable proxy rules, not
observed product prices or an estimate of the occupants' wealth. Missing market data remains
missing in provenance. The eight mapped pilot houses use an unspecified market value;
prices on synthetic fixtures are deliberately illustrative.

The existing **44** local models are retained. The library now contains **78** assets:
32 additional Poly Haven models and two pinned Khronos models, alongside the existing Google
Scanned Objects. Every local asset has dimensions, bounds, triangle count, role, style,
allowance tier, source, license, attribution and file hashes. 29 downloaded models
are used by the pilot; unused library entries remain available for subsequent furnishing.

```sh
.venv/bin/python scripts/expand_interior_library.py
# Refresh library choices without solving room geometry again:
.venv/bin/python scripts/build_inferred_interiors.py --refresh-assets
# Offline metadata refresh without downloading more models:
.venv/bin/python scripts/expand_interior_library.py --measure-only
```

The importer resumes existing downloads, verifies Poly Haven upstream checksums, checkpoints
successful additions and records failures. Khronos models are pinned to commit
`15cd02d304e54cb42a4db4eefe719f76190f4b68`; their individual license metadata is stored locally.
The sofa retains both original and improvement credits.

Sources reviewed:

- [Infinigen Indoors](https://github.com/princeton-vl/infinigen/tree/indoors-stable): a strong
  free procedural reference. This pilot uses an independently implemented polygon solver
  to keep Kerbside's footprint and runtime contracts direct; it does not require Blender or
  downloaded inference weights.
- [Poly Haven license](https://polyhaven.com/license) and
  [official file API](https://github.com/Poly-Haven/Public-API): CC0 textured household models.
- [Google Scanned Objects](https://github.com/google-research-datasets/Google-scanned-objects):
  existing CC-BY household scans retained with their credits.
- [Khronos Sheen Chair](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/SheenChair)
  and [Sheen Wood Leather Sofa](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/SheenWoodLeatherSofa):
  a third source of detailed furniture, with model-specific rights and attribution.

## Kerbside integration

`build_inferred_interiors.py` selects eight published OSM house/detached footprints, ordered
by SHA-256 of OSM ID, plus eight fixed artificial shapes. Real fixtures preserve the existing
fitted entrance locations. The source shell height supplies an explicitly inferred storey
count and equal heights; these are not represented as a survey of the interior.

The batch writes `map-overlay.json`, keyed by OSM ID. Regenerate the existing viewer:

```sh
.venv/bin/python scripts/build_sf_corridor_3d.py --page-only
```

The map's `?inferredInteriors=1` option lazily loads the eight generated houses through
`renderer.mjs` and `kerbside-adapter.mjs`. Other addresses retain their existing fitted plans.
The adapter converts local east/north to Kerbside's scene frame, attaches per-storey collision
geometry, door leaves and stair standing surfaces, and loads textured assets on demand.

The standalone lab and adapter probes are verified. A full live-map walking acceptance run
remains open: the existing overview/region lifecycle produced a disposed-terrain callback
(`TERRAIN.data` null) and the browser stalled when switching to first person. This is recorded
rather than claiming an end-to-end walking pass. The overlay is opt-in for that reason.

## Validation and present bounds

The final sixteen-house batch passes serialized-geometry validation and contains **591**
objects. It covers compact, narrow, L, U, T, angled and one/two/three-storey cases, plus eight
real outlines. No room or object extends outside its floor. All rooms connect to the exterior
entrance, and usable polygon coverage is complete. Maximum hallway share in this batch is
**24.5%**. This is a scored search, not a proof of a globally optimal layout.

Thirteen new acceptance/corruption/integration checks pass. Seventy-one existing checks for
walking, interiors, rooms, storeys, object rendering and shell assets pass. The corruption
checks deliberately introduce floating objects, blocked doors, missing furniture and missing
stair slab openings. The adapter probe checks stair elevations and floor-specific room data.

The pilot supports one to three storeys, per-storey area of at least 48 m² and heights of
2.4–4.5 m. Infeasible narrow, disconnected or self-intersecting inputs fail explicitly. It
cannot infer a real interior accurately from the exterior alone: every generated room and
object is labeled inferred, with confidence, corroboration and provenance fields. No ground
truth interior survey was available for accuracy scoring. Apartments, mixed-use buildings,
code certification, real market-data ingestion and expansion beyond the bounded pilot are
future work.

The isolated Python 3.12 environment installs and runs. Whole-project `uv lock` still hits
an existing project-wide conflict: `scan-build` pins SciPy 1.18.1 while the project advertises
Python >=3.11, and that SciPy build requires >=3.12. The existing lockfile is preserved; use
the `uv pip install` command above for this worktree.

Graphify's AST graph was refreshed. Its existing Terraform extraction warning remains:
`tree_sitter_hcl` is absent for two `.tf` files; the interior Python/JS extraction is present.
