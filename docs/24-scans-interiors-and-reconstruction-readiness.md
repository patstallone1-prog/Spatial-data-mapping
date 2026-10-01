# 24 — Third-party scans, building interiors, and what the renderer needs before the mesh

Research and planning only. Nothing here has been implemented. Written 2026-09-28.

This covers two separate questions that arrived together:

- **Part A** — stitching highly accurate real-world scans (OpenHeritage3D/CyArk, Sketchfab CC
  collections, Polycam Explore, USGS Lidar Explorer) into the existing world, and giving
  buildings interiors.
- **Part B** — what has to change in the renderer *before* a photogrammetric mesh goes over
  everything, so that the mesh can actually improve accuracy rather than just sit on top of it.

The project is moving from facade to reconstruction. Part B is the more urgent of the two,
because it is the only part that is not blocked on acquiring pixels or a GPU.

---

## Three decisions taken before planning

These were put to the operator and answered, and the plan is built on the answers rather than
on a default.

**1. Licence posture: accept non-commercial.** CC BY, CC BY-SA and CC BY-NC scans are all in
scope. The pool is nearly everything on the three platforms. The cost is that
`commercial_safe = False` propagates and the non-commercial footing hardens; this is the
hardest of the three options to reverse, and every scan shipped makes it harder. The project
had already accepted a non-commercial footing for Waymo and Mapillary, so this is consistent
rather than new — but it is a ratchet, and §A1 says what it breaks.

**2. Interiors: walkable in first person.** Not parallax behind glass. The operator asked
specifically for door-opening controls, logic for going up stairs, and windows that show the
interior correctly from the angle they are viewed at. This is the largest item in the plan and
§A7 does not pretend otherwise: it is a second renderer problem, not a feature.

**3. Anchoring: automatic against our lidar.** Alignment score per scan, reject below a
threshold. Scales to thousands, at the risk of silently putting a real building in the wrong
place. §A5 sets out how the threshold gets chosen by measurement instead of by feel, which is
the only thing that makes the accepted risk manageable.

## Two further decisions (2026-09-29), which supersede the recommendations below

**Commercial use is recorded where the licence grants it.** The project is non-commercial
while it is a validation build and is meant to become commercial; at that point the
non-commercial sources are stripped and replaced with proprietary data, so the project is
built to be both. Accordingly: sources whose terms permit commercial use — CC0, CC BY, CC BY-SA,
etalab (so Panoramax, KartaView and most scans) — may carry `commercial_use` in
`data/reconstruction/source_rights.json`, truthfully. **Mapillary and Waymo stay
non-commercial** in the project's records, and so does any CC BY-NC scan; those are the sources
the commercial transition removes. One obligation survives the change: CC BY-SA permits
commercial use but its share-alike terms still attach to derived *imagery*, so the isolation
rule in §A1 (a share-alike scan is never merged into shared geometry) stays. Applied: the
`mapillary` row no longer lists `commercial_use`, and the two builds that demanded it
(`colmap_runner`, `rectified`) now ask through `contracts.build_uses`, which adds
`commercial_use` only when `SMC_COMMERCIAL_BUILD=1` declares a commercial build — so the
transition makes Mapillary fail the gate by name, which is the point. Panoramax and KartaView
are still per-observation rows; they gain uses when their per-image licences are read.

**A home someone has published is placed on that home.** If a person has uploaded a scan of
their own house under a free licence, it is used on their actual house, not stripped for a
layout and applied somewhere else. This replaces the "excluded regardless of its licence" rule
and the layout-template recommendation in §A4 and §A7. The filtering in §A4 still removes
single rooms and movable objects, and still needs the scan to resolve to the right building —
now so it can be placed there.

---

# Part A — real-world scans in the world

## A1. What the licence decision breaks, and the honest fix

The rights gate is real and it fails closed. `SourceRights.require()`
(`src/smc/reconstruction/contracts.py:87`) refuses unless `status == "approved"`, every named
use is in `allowed_uses`, and `attribution` is non-empty. Two call sites:

- `src/smc/reconstruction/colmap_runner.py:81` requires all six uses, **including
  `commercial_use`**.
- `src/smc/reconstruction/rectified.py:67` requires five (not `derived_mesh`), also including
  `commercial_use`.

So as written, **no CC BY-SA or CC BY-NC source can pass the reconstruction gate**, and no
honest rights row for a scan can grant `commercial_use`. This is not a hypothetical: it is why
`panoramax` and `kartaview` sit at `status: "conditional"` with empty `allowed_uses` today and
cannot pass either.

There is a wrong way and a right way to fix this.

- **Wrong:** grant `commercial_use` to the scan sources so the gate passes. This is the
  existing bug, not a precedent to copy — `data/reconstruction/source_rights.json` lists
  `mapillary` as `approved` for `commercial_use` despite CC BY-SA. That row should be
  corrected, and the correction will make the gate refuse Mapillary until the call site is
  fixed. That is the gate working.
- **Right:** stop asking for a right the build does not need. The call sites should require the
  uses their output actually exercises, and `commercial_use` should be demanded only by a build
  that is going to be sold. Concretely: a `commercial: bool` on the preflight, defaulting to
  the project's declared footing, so a non-commercial build asks for
  `cv_processing / texture_baking / derived_mesh / persistent_hosting / redistribution` and a
  commercial one adds `commercial_use`. The `status` Literal
  (`approved / conditional / restricted / unknown`) does not need a new value: an NC source is
  legitimately `approved` for the uses it permits.

Four further consequences of accepting NC and SA:

- **Licence is per scan, not per platform.** A Sketchfab collection mixes CC BY, CC BY-SA and
  CC BY-NC across models; Polycam varies per capture. This is the Panoramax situation exactly,
  and the existing answer applies — `License` (`src/smc/imagery/base.py:24`) is already
  per-observation, with `share_alike` defaulting to `True` as a fail-safe and a comment
  explaining that flattening a federated source into one provider-level claim "would be wrong
  the first time it mattered." Each scan carries its own licence row.
- **Attribution becomes a shipping deliverable.** `require()` raises on empty attribution, and
  CC BY needs author name and a link. Thousands of scans means a credits surface in the app
  that is generated from the manifests, not hand-written. Plan it in from the start; it is the
  kind of thing that is trivial at ten scans and a rewrite at ten thousand.
- **Share-alike scans must stay isolable.** If a CC BY-SA mesh is merged into shared geometry,
  the question of whether the surrounding world became a derivative stops having a comfortable
  answer. So a scan is never merged: it stays its own asset, with its own licence record, and
  its own draw. Conveniently, §B3 and §B8 want the same thing for performance reasons. Licence
  and renderer agree here, which is rare enough to be worth using.
- **No new `Capability` may be served only by scans.**
  `tests/test_adapters.py::test_every_unsafe_capability_has_a_safe_alternative` enforces that
  every capability with a restricted provider also has a commercial-safe one. Scans are a data
  source, not a capability in the adapter sense; keep them out of the `Capability` enum and the
  test stays satisfied.

**Schema change required.** There is no `kind` for a mesh. `SourceAsset.kind`
(`src/smc/reconstruction/provenance.py:97`) is
`aerial_frame | street_frame | orthomosaic | satellite | lidar | dem | gis`, and
`AcquisitionManifest.kind` (:131) has `point_cloud` but no mesh equivalent. Both Literals need
extending — `scan_mesh`, and `scan_point_cloud` for the cases that arrive as points. Because
`extra="forbid"` and the models are frozen, this is a deliberate schema change, and it is step
one of any ingest work.

## A2. What each source actually gives

**OpenHeritage3D / CyArk** — survey-grade, with metadata, terms per dataset (research use,
varying, mostly non-commercial). Few sites in the Bay Area, high value each. *Correction:* the
project's own FAQ says its data is often **not** georeferenced; georeferencing is a per-dataset
fact to be read from each dataset's metadata, not assumed of the archive. The datasets that
*are* georeferenced are still the validation set for the aligner (§A5): align them blind,
compare against their published position, and the error distribution sets the rejection
threshold for everything else. Downloads are by request (a form with the requester's name;
links arrive by email) and run to about 25 GB a site, so they arrive through the local inbox
(§A3), not a crawler. If too few of the Bay Area sites turn out georeferenced to measure a
distribution, that is the §A5 fallback case, stated as such.

**Sketchfab, "Scanning in San Francisco" and similar CC collections** — mesh plus baked
texture, curated, licences mixed across CC BY / BY-SA / BY-NC. No georeferencing beyond a title
and description. Download is account-gated and per-model terms apply. This is the corpus that
needs the filtering pass in §A4 hardest, because a curated collection of "scans in San
Francisco" contains storefronts, statues, a fire hydrant, and somebody's sofa, with nothing in
the metadata reliably separating them.

**Polycam Explore** — the largest volume, LiDAR and photogrammetry captures, licences per
capture. Overwhelmingly small objects and single rooms, with variable scale accuracy. This is
where movable-object and single-room rejection does most of its work, and where the private-home
question in §A4 actually bites.

**USGS Lidar Explorer (3DEP)** — **not a new source.** It is already read, via
`src/smc/lidar/ept.py`, out of the public Entwine octree with `laspy[lazrs]`, and it is used
heavily. Its role here is different: it is the **reference truth the aligner scores against**.
One trap is already documented in that module and must not be re-hit — the EPSG:3857 unit
error, 27% at San Francisco's latitude.

## A3. Ingest shape

Follow the established pattern rather than inventing one. A new stage, `scans`, in
`scripts/ingest_region.py`'s stage list, journalled like the others, writing
`data/regions/<name>/scans/`:

- `candidates.jsonl` — one row per scan considered, from the platform's own API, with its
  licence, author, attribution, URL, stated location text, and byte size. **Every row that is
  rejected keeps its reason**, in the vocabulary the project already uses for gaps
  (`scripts/build_ground_cover.py:1106` writes `"surveyed"` / `"no_data"` /
  `"no_data: <reason>"`). A scan missing from the world because it is a coffee table has to be
  distinguishable from one nobody has looked at.
- `anchors.json` — accepted anchors, written once and immutably (`Manifest.write_immutable`
  raises `ValueError("immutable manifest differs")` on any change). A re-run that produces a
  different anchor for the same scan is a finding, not an overwrite.
- `PROVENANCE.md` per platform, on the model of `data/waymo_sf/PROVENANCE.md` — which is the
  right document to imitate because it states its findings against the project's own interest
  ("the mirror's own existence is likely a breach by whoever uploaded it") and because it
  carries a standing instruction to be updated rather than deleted when the situation changes.

## A4. Filtering: stripping what must not be in the world

The operator's requirement is to strip single-room scans, private-home scans, and movable-object
scans. Metadata will not do this — titles lie and most captures are untitled. The tests that
work are geometric, and they are cheap.

**Extent.** Bounding box after scale is resolved. A movable object is under about 3 m in its
largest horizontal dimension. A single room is under about 10 m. A building exterior extends
above about 4 m. Coarse, and it disposes of most of Polycam on its own.

**Enclosure — the actual discriminator.** Sample the scan's footprint and cast upward. A
single-room scan is closed above, within 2–4 m, over most of its footprint; an exterior scan is
open to the sky. This one test separates "inside of a room" from "outside of a building" more
reliably than anything in the metadata, and it is a few rays per scan.

**Footprint match.** Does the scan's horizontal outline correspond to an OSM building footprint,
or a known landmark, within tolerance? A landmark does. A bicycle does not. This test doubles as
the coarse seed for anchoring (§A5), so it is not extra work.

**Private residence — two tests and one rule.** Geometrically: does the matched footprint fall
on a parcel whose land use is residential? Parcels are already ingested for Oakland
(`c3xp-qcgn`) and Palo Alto (`AssessorsParcels`), and DataSF covers San Francisco.
Textually: does the title or description name a residence. Then the rule:

> **A scan that resolves to an identifiable private residence is excluded from the published
> world regardless of its licence.** The licence is the uploader's to grant. The privacy of the
> person who lives there is not theirs to grant, and a CC BY tag on a stranger's house does not
> make publishing it at its real address acceptable.

This collides with the operator's own request to use fully-3D-scanned Polycam homes for
interiors, and the collision has a clean resolution worth taking: **a scanned home can be used
as an anonymised layout template and not as published geometry.** What gets extracted is the
room graph — how many rooms, their areas, their adjacency, how the circulation runs — which is
exactly what §A7 needs and which carries no address. The scan itself is never placed. Meanwhile
non-residential publicly-accessible interiors (a shop, a station concourse, a museum) can ship
as actual geometry, because they are places the public is already invited into. This is a
recommendation, and it is the operator's call to overrule.

## A5. Anchoring, and how to set the threshold by measurement

Automatic alignment against our lidar, per the decision. Four stages:

1. **Coarse locate.** The scan's own geotag if it has one; otherwise its place text, geocoded,
   giving a search region rather than a position.
2. **Up and scale.** Scans arrive in arbitrary units with arbitrary up. Fit the dominant ground
   plane by RANSAC and take up from its normal — `src/smc/curbmeasure/stereo.py` already does
   this and the numbers are good, a road plane flat to 25 mm rms over 4,825 inliers. Scale
   comes from the ratio that best fits the scan's 2D outline to the candidate footprint, which
   is better conditioned than fitting height.
3. **Fine align.** 2D outline to footprint for yaw and translation, then ICP of the scan's
   points against the 3DEP cloud for the final 6-DoF and a scale refinement.
4. **Score, three numbers.** Rms residual of scan points to 3DEP; 2D outline IoU against the
   footprint; fraction of scan points with a lidar return within tolerance. All three recorded,
   all three thresholded.

**The threshold comes from the georeferenced corpus, not from judgement.** Run the aligner blind
on the OpenHeritage3D and CyArk items, whose true position is published, and measure the error
distribution. That distribution sets the reject threshold, and it also gives an honest statement
of expected placement accuracy — which the project will need, because "automatically aligned"
without a measured error is the kind of claim this codebase does not make elsewhere. If the
georeferenced corpus turns out too small to characterise the distribution, that is itself the
finding, and the fallback is assisted anchoring for a small set rather than an unmeasured
threshold on a large one.

**Containing the accepted risk.** An auto-anchored scan never replaces measured geometry; it
sits beside it, and where they disagree the measurement wins for anything a consumer measures or
collides with. The reconstruction package already states this rule in its own docstring — "a
consumer must use the original geometry for measurements and collision" — and §B10 carries it
into the renderer.

## A6. Blending a scan into the rendered world

The operator's example is exact: the ground under a store should fade from detailed porous
concrete back into the rendered material rather than ending at a seam. A scan and the procedural
world disagree in four distinct ways, and each needs its own fix. Treating it as one problem is
why seams look like seams.

**Geometry** — the scan's ground is not at `terrainHeightAt`. Fix: a skirt. Take the scan's
boundary polygon and build a transition annulus, inner ring on the scan's own boundary vertices,
outer ring snapped to `terrainHeightAt` / `pavementTopAt`, refined with the existing
`refineForTerrain` machinery. One and a half to three metres wide. This is `walk_underlay`'s job
generalised, and `walk_underlay` already exists.

**Colour and exposure** — scans are baked with the sky of the day they were captured. Fix:
estimate the baked ambient from the scan's sky-facing surfaces, divide it out, then match the
histogram of the scan's ground against the world's ground material for that region.
`src/smc/reconstruction/fusion.py` already normalises exposure across views; the same code
applies.

**Material response** — a scan's albedo already contains its shading, and the world's PBR
pipeline will light it a second time. Fix: reduced `envMapIntensity` and a roughness floor on
scan materials. There is a precedent in the page already — the demo avatar's materials are
clamped to `roughness >= 0.62` on load, for the same reason.

**Detail frequency** — the scan is dense, the world is flat noise, and the eye reads the
boundary instantly. Fix: cross-fade the scan's texture into the procedural texture across the
annulus, driven by a vertex blend weight in a shader. **Not** by animating mesh opacity — the
lesson recorded at `FACADE_STANDOFF_M` is that two surfaces fighting for the same pixels
flicker, and the tile system's per-tile material cloning exists because "on a shared material
one tile fading in took every other tile on the map with it."

**And the rule that makes all four work:** whatever a scan covers, the procedural layers are
**suppressed, not overdrawn**. `tileOwnGround(lon, lat)` is the existing precedent — the tile
tree draws nothing inside the region the page draws in full. Generalise it to a per-scan
exclusion polygon evaluated at build time. A depth offset is not a substitute.

## A7. Interiors

Walkable in first person, with doors, stairs, and windows that stay honest from any angle. This
is the largest item here and it is a second renderer problem, not a feature of the first.

### The layout, unique to each building

Three inputs are already on disk and two of them are currently thrown away:

- `way.facade.storey_m` and `way.facade.bay_m` — **measured from photographs**
  (`src/smc/facades/match.py:86`), published into the page's payload by `Match.to_json()`, and
  never read. The renderer consumes only `facade.m` and `facade.conf` at
  `scripts/build_sf_corridor_3d.py:7612`. A measured storey rhythm and bay rhythm per building
  is exactly what interiors need, and it is already there.
- `building_levels` — parsed from OSM at `src/smc/buildings/enrichment.py:356`, not in the
  payload whitelist, never read by the page.
- Footprint, height, and archetype, all already used.

So: storey count from `round(height * storeys_per_m)` where measured, else OSM
`building_levels`, else `height / STOREY_M`, with the source recorded per building the way
`height_source` already is. Floor plates at the measured spacing.

**Room subdivision** by recursive binary partition of the footprint — a slicing tree — seeded
from the footprint's first corner. The seed convention already exists (`buildingMesh` derives
one from the corner coordinates "so a building keeps its material and colour between reloads")
and it gives the uniqueness the operator asked for for free: same building, same layout, every
load; different building, different layout. Constrain the partition by an archetype room
programme — a residential floor gets bedrooms, bath, kitchen, living in plausible area ratios;
an office floor gets a core and open floor. Circulation goes in first, and **stairs must stack**
across storeys, so their position is chosen once for the building rather than per floor.

**The constraint that makes an interior accurate rather than merely plausible:** the rooms are
fitted to the windows, not the windows to the rooms. `bay_m` is a measurement of where the
windows actually are. A layout that puts a wall through a window, or a bedroom behind a
shopfront, contradicts the exterior the viewer is looking at — and the viewer can see both at
once, which is the whole problem. Window positions come from the measurement; the partition
accommodates them; every room touches either an exterior wall or the corridor.

**Doors** at the real entrance where OSM has an `entrance=*` node, otherwise on the facade
nearest the pavement — which the renderer can already determine, since `furnitureAnchor` does
kerb-relative placement with `nearestKerbAt`.

### Walkability — the part with no precedent in the codebase

There is no interior geometry anywhere today. Buildings are `ExtrudeGeometry` shells; `grep -i
interior` across `src/smc` finds only camera interior orientation. So this is new, and the
cheap design is the right one:

- **Collision as a graph, not a mesh test.** Per storey, a 2D occupancy and portal graph. Walls
  block by segment intersection; the floor plate supports at a known height. Exact, and orders
  of magnitude cheaper than raycasting geometry. The renderer's existing `pavementTopAt` /
  `groundLiftAt` handle ground and nothing handles walls, so wall blocking is genuinely new.
- **Storey index becomes camera state.** This is a real change to the camera model, not an
  addition to it: the walker's height is now relative to a floor plate, and crossing a stair
  footprint changes which plate. Stairs are vertical portals between storey graphs.
- **Doors are portals with state** and a control binding. New input.
- **Interior LOD is mandatory, not an optimisation.** One building's interior resident at a time
  — the one you are in — plus window-visible shells for neighbours, budgeted against the
  existing `TILE_RESIDENT_BUDGET` of 48 MB. Fifteen thousand interiors do not coexist.

### Windows that show the interior correctly from the viewed angle

Three tiers, and the plan uses two of them:

1. Flat glass. What exists today.
2. **Interior mapping** — one quad per window, an interior box sampled by view direction with a
   depth offset. Correct-looking parallax from any angle, essentially free, no interior geometry
   at all. This is the right answer for every window the viewer is not standing next to, which
   is almost all of them.
3. Real geometry seen through the glass. Correct by construction, costs a draw of the interior.

Swap between 2 and 3 on the same screen-error rule the tile tree already uses — `selectTiles`
descends only when the drawn tile "would be visibly wrong", and refines only when every
on-screen child has its geometry, which is what makes the swap silent rather than a hole.

**The parameters for tier 2 must be derived from the same generated layout as tier 3.** If the
interior-mapped room behind a window is invented independently, then walking up to that window
changes the room — which is worse than flat glass, because it is a visible inconsistency rather
than an honest absence.

### Polycam homes

Layout templates only, per §A4: an anonymised room graph applied to a different building.
Non-residential public interiors may ship as geometry, under the §A6 blending rules.

## A8. Storage

Meshes and their textures are large, and the operator's P700 external SSD is the intended
backend. `LOD_BUDGET_BYTES` exists for cells (`{0: 500k, 1: 1.5M, 2: 8M}`) but there is no
budget for scan assets, and the `pixel_store` CAS is empty in this checkout. For scale:
`docs/photogrammetry-audit-2026-09.md` estimates 0.8–5.6 TB for the image corpus alone, before
any mesh. A scan budget and an eviction policy belong in the plan from the start, not after the
first drive fills.

---

# Part B — what the renderer needs before the mesh

Ordered by what unblocks what. Every item here is doable now, because none of it is blocked on
pixels or a GPU — which is the argument for doing it now, given that the mesh is (§B11).

## B1. Binary assets in the tile pipeline

`loadTile` (`scripts/build_sf_corridor_3d.py:4787`) does `await response.json()` on every asset.
There is no binary branch. `tile.assets[name] = {bytes, rows, url}` is already generic over the
asset name, so the seam exists — what is missing is a branch in `loadTile` on asset type and a
branch in `buildTile` (:4817) to add a parsed scene instead of dispatching to `tileMassing` /
`tileBuildings`.

`GLTFLoader` is imported (:2950) but used for exactly one thing: the Three.js demo soldier at a
fixed remote URL. No DRACO, KTX2 or meshopt decoder is wired in, and
`src/smc/reconstruction/glb.py` deliberately declines to claim `EXT_meshopt_compression`
("This writer itself does not claim that extension"). **Decide the compression before the
writer is built**, because it determines what the writer emits and retrofitting it means
rewriting every asset.

## B2. A tile-tree slot for the mesh

`LAYERS_AT_DEPTH` (`src/smc/tiles/tree.py:62`) is a closed set of eight layer names and
`ERROR_AT_DEPTH` is nine values. A mesh layer needs both a name and a geometric error **that its
measured accuracy justifies** — the tree's whole design is that "nothing in the tree is chosen
by zoom level", and a guessed error number would quietly break that. The tier comment also says
that inside a built region L6 is the page's own street renderer, so the mesh has to declare
where it sits relative to the renderer it is displacing.

## B3. Per-object identity — the structural blocker everything else waits on

**Today a building is not an object.** `buildingMesh` (:13996) slices its `ExtrudeGeometry`
material groups, bakes colour into a vertex attribute, pushes each slice into
`addMerged("roof" | "wall", ...)`, and returns `true` rather than a group. After `flushMerged`
there is no "that building" to address. This is a deliberate and well-justified trade — 15,700
buildings were 15,700 draw calls, and picking already works around it by raycasting footprints
instead, which is better anyway because it works when you click the roof.

But it means you cannot, today: replace one building's geometry with a mesh, texture one
building from a photograph, or give one building an interior. **Before the mesh, the renderer
needs a stable per-feature handle** — a way to exclude named features from the merge and draw
them individually, plus a registry from feature id to drawn geometry.

The stable-key discipline to copy is already in the codebase: `photo_facades()` keys a wall on
its two corner coordinates rather than an index, because "the building list is rebuilt from
OpenStreetMap on every run and its indices are not stable, while a wall's two corners are the
wall." Feature handles must be geometric, not ordinal.

Everything else in Part B depends on this one.

## B4. Suppression, not overdraw

Whatever the mesh covers, the procedural layer stops drawing there. Two precedents and one
warning: `tileOwnGround` already implements exactly this idea at region scale;
`FACADE_STANDOFF_M = 0.06` exists because coplanar surfaces "would fight for every pixel and
flicker". What is needed is a per-feature and per-area suppression mask evaluated at build time.
A depth offset is not a fix.

## B5. One material vocabulary — the highest-leverage item for photo-to-material

There are two vocabularies today and they disagree:

| Where | Entries |
|---|---|
| `MATERIALS`, the renderer (`build_sf_corridor_3d.py:7516`) | **6** — stucco, concrete, painted, brick, glass, metal |
| `FACADE_MATERIALS` (`reconstruction/contracts.py:31`) | **10** — adds stone, wood_siding, metal_panel, glass_curtain_wall, ceramic_tile, mixed, unknown |
| `GROUND_MATERIALS` (:35) | **9** — asphalt, concrete, brick_paver, stone_cobble, gravel_soil, grass_vegetation, paint_thermoplastic, rubber, unknown |
| `ROOF_MATERIALS` (:39) | **8** — membrane, shingle_bitumen, metal, tile, gravel, green_roof, glass, unknown |
| `CATALOGUE`, the matcher (`facades/match.py:35`) | **5**, and its comment says the names "match the renderer's `MATERIALS` table exactly" |

The renderer's six cannot express stone, wood siding, ceramic tile, brick paver, stone cobble or
a green roof. So a material classifier's output has nowhere to land, and "matching photos to
material types" cannot improve accuracy past six buckets no matter how good the classifier is.

**Growing the renderer's material table to the reconstruction vocabulary is a prerequisite, and
it is cheap.** Of everything in Part B, this is the largest accuracy gain per line changed.

## B6. Spend the measurements already on disk before taking new ones

- `way.facade.storey_m` and `bay_m` are measured and discarded (§A7). The one place a storey
  rhythm is drawn is a painted line at a fixed 64-pixel tile in `facadeTexture()` (:7649),
  unrelated to the measured value. Drive the floor line and the window spacing from the
  measurement instead.
- `building_levels` is parsed and never reaches the page — it is not even in the payload key
  whitelist at :19902.

Both are free accuracy. Neither needs a photograph fetched or a GPU.

## B7. A real texture path, and why there isn't one

The section header at :7486 is a policy, not an implementation detail:

> Textures are drawn into a canvas rather than shipped as images: the page is served from a
> repository where every megabyte of binary is a megabyte in every future clone.

Photogrammetric texture breaks that outright. **The app pivot is what makes it possible** — the
app is not the repository. So: photographic texture and mesh ship to the app; the site keeps the
canvas textures. The seam already exists and already works this way — `ASSET_BASE` and the
`asset()` helper (:2949) let one page source point at either, and the 220 facade JPEGs under
`docs/facades/c14r03/` are fetched through it today. This is a decision to record, not
machinery to build.

## B8. Draw-call arithmetic, decided before the baker runs

`materialKey` (:5571) fingerprints a material on fifteen pixel-affecting properties **including
`map.uuid`**. So every unique photographic texture becomes its own canonical material, its own
`MERGED` bucket, and — since the bucket is too small to tile — one un-cullable draw call plus a
texture upload. The 220 facade panels already demonstrate this exactly: each is its own mesh and
its own material, and `groups.facades` is never passed to `flushMerged` or `tileGroup`.

At 220 panels that is fine. At thousands it is not, and the numbers in the file say why:
unmerged, standing on one block drew "twenty-seven million triangles a frame, a few frames a
second on an ordinary laptop."

So either texture atlasing (many walls on one page, one material) or per-tile texture arrays.
**This has to be decided before the mesh baker is written, because it determines the atlas
layout the baker must produce.** Getting it wrong means re-baking everything.

## B9. Furniture from the mesh — the shortest path in the whole plan

This one is nearly open already. `furnitureAnchor` (:17870) handles projection and kerb snapping
— it exists because 14,000 of 24,600 SFMTA signs landed on the roadway of this model and were
being dropped. `furnitureBearing` (:17904) already treats a supplied bearing as a measurement
and uses it as it stands. **A detector writing
`{p: [lon, lat], bearing, kind, source, provenance, confidence, license, id}` into
`furniture.geometry_based` needs no renderer change at all.**

Three things are missing for "small variations taken from the mesh":

- **Per-instance dimensions.** Furniture is instanced with fixed measured constants —
  `BENCH_LENGTH_M 1.8`, `BENCH_DEPTH_M 0.52`, `BENCH_SEAT_Y_M 0.44`, measured off Market Street
  — one geometry for every bench. But `InstancedMesh` matrices already carry scale, so a
  measured length and height per bench is nearly free. **This is the cheapest real accuracy gain
  available:** every bench and lamp its own measured size, from a mesh, at no per-object draw
  cost.
- **A bearing convention per kind.** `addBenches` uses `furnitureBearing(...) + Math.PI / 2`
  because a bench sits along the kerb rather than facing it. A bearing measured from a mesh is
  the object's own long axis, so the convention has to be declared per kind or half the
  furniture will be ninety degrees out — and it will look deliberate.
- **Identity matching.** `SHELTER_CLUSTER_M` dedups by distance only. A mesh detection and an
  OSM tag for the same bench will both draw. An identity match is needed before the mesh adds a
  second source for objects the map already has.

## B10. The truth boundary has to reach the renderer

`src/smc/reconstruction/__init__.py` already states the rule: the package "deliberately produces
visual artifacts beside the canonical world. A consumer must use the original geometry for
measurements and collision." The renderer has one notion of a surface and no way to express
that distinction.

Once mesh and procedural coexist, the viewer needs to know which they are looking at, and
collision and measurement must stay on the canonical geometry. `Coverage` (IntEnum 0–5,
`DIRECT_OBSERVATION` through `GENERATIVE_VISUAL`) is the vocabulary for it, and it needs to
reach the page and drive the same kind of provenance surface the survey layers already have.
This is the measured-versus-inferred discipline the rest of the project runs on, applied to
geometry instead of to widths.

## B11. What is not a renderer problem

Stated plainly, because it changes what Part B is for.

- There are **no image pixels in this repository** outside `docs/facades/c14r03/` and `photos/`.
- COLMAP, PyCOLMAP and hloc are not installed. `which colmap` finds nothing.
- `patch_match_stereo` needs CUDA. The hardware is an Apple M4. `docs/21` records it: "No CUDA,
  so COLMAP's dense stereo is unavailable."
- `colmap_runner.reconstruct_cell` **has never run.** `build/visual/` does not exist. Every
  region journal lacks a `reconstruct` entry, and `DEFAULT_STAGES` excludes the stage.
- The four pilot cells hold blocked manifests and massing-only LOD0 GLBs built from OSM boxes.
  Geometric effect: none promoted.

So the mesh is blocked on **acquisition and a GPU, not on code** — which is exactly why Part B
is worth doing now. It is the work that can proceed.

One path *does* run locally and is the most promising near-term: `src/smc/curbmeasure/`
plane-sweep stereo on Metal, validated against sparse triangulation to about 6% at 37 m, with a
RANSAC road plane flat to 25 mm rms. Its honest status is 0 paired kerb measurements —
`data/curb_measurement/photo_vs_lidar.jsonl` is zero bytes — and the withdrawn 13 mm figure is
recorded as withdrawn. Error at 5–10 m, where a kerb is, is unknown.

---

## Suggested order

**Phase 1 — renderer readiness (no new data, nothing blocked).**
B5 material vocabulary, B6 spend existing measurements, B3 per-feature handles, B7 record the
app-versus-site texture decision. B5 and B6 are small and independently valuable; B3 is the one
everything waits on.

**Phase 2 — the asset path.**
B1 binary tile assets and the compression decision, B2 a tile-tree slot with a justified error,
B4 suppression masks, B8 the atlas decision. At the end of this phase the renderer can accept a
mesh, which it cannot today.

**Phase 3 — scans, smallest corpus first.**
A1 rights vocabulary fix (including correcting the Mapillary row), A1 schema `kind` extension,
A3 ingest stage, then **the georeferenced OpenHeritage3D/CyArk datasets only** — because
their published position lets A5's aligner be measured before it is trusted (which of them
are georeferenced is read per dataset; many are not). A6 blending, on a handful of sites.

**Phase 4 — the community corpus.**
A4 filtering with recorded reasons, A5 automatic anchoring with the threshold set by Phase 3's
measured error distribution. Sketchfab before Polycam; Polycam is where the private-home
question has to be settled in practice.

**Phase 5 — furniture from the mesh.**
B9, which needs a detector and almost no renderer change. Per-instance measured dimensions
first.

**Phase 6 — interiors.**
A7, in the order: read the measured storey and bay rhythm; storey plates; window-fitted room
partition; interior mapping behind glass (tier 2, cheap, ships early and alone); then collision,
stairs, doors and tier-3 geometry. Tier 2 is worth shipping by itself — it removes the
solid-block reading from every building in the city for a fraction of the cost of walkability.

---

## Risks worth naming

- **Automatic anchoring can put a real building in the wrong place**, and that is the accepted
  trade. The mitigation is not better code, it is the measured threshold from the georeferenced
  corpus, the rule that a scan never overrides measurement, and a visible provenance badge. If
  the georeferenced corpus is too small to set a threshold honestly, say so and fall back to
  assisted anchoring for a small set.
- **The non-commercial ratchet tightens with every scan shipped.** It was already turned for
  Waymo and Mapillary, so this is consistent — but it is worth being clear that this decision is
  progressively harder to reverse, not merely hard.
- **Interiors are a second renderer problem.** Collision, a storey-aware camera, portals, and
  interior LOD are not extensions of the current renderer, and the scope-creep risk is real.
  Tier-2 interior mapping is the hedge: it delivers most of the visible benefit and is
  independently shippable.
- **The Mapillary rights row was wrong** — `approved` for `commercial_use`. Fixed in the order
  this called for: the call sites stopped demanding `commercial_use` (they ask through
  `build_uses`, which adds it only for a declared commercial build), then the row lost it.
- **`docs/03-build-order.md` promises two CI licence gates that do not exist** — the
  non-commercial-weights assertion and the ODbL facts-table check. Neither appears in `tests/`.
  Adding a large NC corpus without them means the only thing standing between the project and a
  licence mistake is prose.

---

## Progress (2026-09-29): what the interior pass has put on disk

**Scans (Part A, A3 and A4).** `src/smc/scans/` and `scripts/ingest_scans.py`:

- *Sources as they really are.* Only Sketchfab has a public catalogue. Polycam's API is
  Enterprise-only and covers the account's own captures; OpenHeritage3D sends links by email.
  Nothing is scraped. `ingest_scans.py catalogue` searches Sketchfab per region and writes
  `data/scans/sketchfab/catalogue.json`: 694 downloadable results, 347 kept as candidates,
  each with its author, link, licence and the attribution line it must carry. Refused, with
  the reason recorded: 183 in a category that is never a place, 147 whose text does not name
  the place (the search matches words — "42 Berkeley Pl", "San José, Costa Rica"), 13
  no-derivatives licences (blending in is a derivative) and 4 store licences. None is placed:
  Sketchfab has no coordinates, so every candidate waits for the aligner. Real brands appear in
  the titles (a bank's ATM, named restaurants); the no-brands rule applies at placement — signage
  in a placed scan's texture is blanked like any other photograph's.
- *Download* needs the user's own `SKETCHFAB_API_TOKEN` in `.env.local`; none is set.
- *Local import*: files dropped in `data/scans/<source>/inbox/` with a sidecar giving licence and
  author are read (GLB/glTF with node transforms, OBJ, PLY ascii/binary, LAS/LAZ; Draco- or
  meshopt-compressed glTF refused by name) and classified on geometry, not titles: movable
  object (under 3 m every way), single room (closed above, room-sized), interior space (closed
  above, larger), exterior (open above). A file with no sidecar is recorded as unusable.
  Provenance kinds `scan_mesh` / `scan_point_cloud` (asset) and `scan` (acquisition) exist.

**Floor plans (A7).** `src/smc/interiors/` and `scripts/ingest_interiors.py`: Swiss Dwellings
(whole buildings, storeys) and ResPlan (single units; read through a restricted unpickler that
can run nothing but geometry, and scaled per plan from its drawn canvas to metres by a check on
wall thickness) into one layout-template schema. CubiCasa5k is catalogued but not downloaded
(CC BY-NC-SA).

**Observations for the renderer (B6).**
- Per-station lidar kerb positions: `data/regions/<r>/lidar/kerb_stations.jsonl`, 120,896 kerb
  points over seven regions; now written by the lidar stage itself.
- Fused points per 120 m cell (`data/regions/<r>/points/`, gitignored): full density to 6 m
  above ground, thinned above; `objects.jsonl` beside them — poles, trees, short posts and
  bench-shaped clusters, named as shapes because aerial lidar cannot tell a hydrant from a
  bollard.
- Facade offset samples: plane-sweep relief against the modelled wall, from solved Mapillary
  camera orientations. Its honest yield is small (about 2% of walls) — most walls are not seen
  from views wide enough apart for 10 cm of depth to move a pixel. That is the ceiling of
  street imagery at this density, not a bug to be tuned away.
- *A measurement bug found and fixed on the way.* Rectification clamps a texture to 48-640 px
  a side, which is right for a texture and wrong for a measurement: the survey read every wall
  at its requested 8 px/m, so the 17% of walls under 6 m long, or over 80 m long or tall, were
  measured stretched or squashed -- on towers, the roofline, window and storey figures. Survey
  and relief now rectify at exactly the scale they read (`rectify_wall(..., exact=True)`), the
  relief sweep runs in strips under a fixed pixel budget (the whole-wall cost volume had grown
  one worker to gigabytes), and results carry a method version so a changed method never
  resumes from the old one's output. The survey was rerun from scratch.
- *Network calls now have a wall-clock deadline* (`smc.net.fetch`): a connection that never
  answered held the survey in a single read for a quarter of an hour, twice, with the socket
  timeout set.
- Material labels in the reconstruction vocabulary: `<official>/material_labels.json`; an
  unfitted class is `unknown`, never guessed.
- Storeys: `<official>/building_storeys.json`, scored before it was trusted. Against the
  storey counts mappers have tagged (2,325 buildings over the eight regions), the photographs'
  own storey counts lost: spacing read from window rows was exactly right for 71 of 369
  corridor buildings where height over a flat 3.2 m was right for 110, and the photographed
  roofline for 11 of 104 (a street view of a tower is steep and far: its window rows are the
  podium's, a crown passes for the roof; only 40% of photographed rooflines came within 15%
  of the measured height). The flat 3.2 m was itself 30% high, because a measured height
  includes the roof and parapet. So the rule is now: a tagged count where there is one; else
  the measured height over a storey height *calibrated* by height band against the tagged
  buildings with lidar heights (about 4.07 m; 4.19 m above 90 m) -- leave-one-out, 49% exact
  and 88% within one storey with no bias, against 33% and 77% for the flat 3.2 m; else a
  photographed height over the same. The photographed figures stay in each record. No cap
  anywhere: the corridor's tallest is 61 storeys (Salesforce Tower, tagged).

## Progress (2026-09-30): solid buildings, doors, and an interior for every building

**Walls.** The walker is a 0.3 m circle and every footprint is solid: it slides along a facade
instead of passing through it (`moveWalker` in the renderer, stepped 15 cm at a time so no wall
is crossed between checks). Canopies on posts and stations under the street have no walls.

**Doors.** Each building's doors come from the best evidence for them: an `entrance=*` a mapper
put on its outline in OpenStreetMap; else a door or shopfront the facade survey photographed;
else one inferred at the middle of the wall nearest a street. A door must open onto open ground
-- one whose outside is another building is a party wall, and is dropped (747 in the corridor);
77 buildings walled in by neighbours on every side have none. Standing within 1.8 m of a door
and pressing Enter swings it open (a hint says so, and says which kind of door it is); the gap
is then passable and the rooms behind it are built. A building on a hill stands level with the
top of its footprint's ground -- the terrain cannot be cut, so a floor beneath it would have the
street running through the rooms -- and where the street at a door is lower the door has a
stoop of 18 cm steps, which the walker climbs.

**Interiors, every building.** `scripts/build_interiors_fit.py` gives every building of every
built region (63,515) a generic plan chosen for its proportions: a ResPlan dwelling for a house
(250 m² or less, three storeys or fewer), a Swiss Dwellings building otherwise. Each template is
reduced to its ground storey in its own enclosing rectangle and tried both ways round, tiled
along the building where it is several plans long, and the one with the least stretch wins:
median stretch 2%, 90th percentile 4-7%, 98% of the corridor within 10%. The plan's rooms are
clipped to the footprint, its doorways kept, its floors coloured by room. It is labelled as
what it is -- a stand-in from a named, CC BY 4.0 plan, not the building's interior -- in the
page and in `sf-corridor-interiors.json` (grade `inferred`).

**Seeing in.** The facades are merged, so an open doorway is a depth-only portal: the rooms are
drawn after the terrain and the plazas (which are drawn without a depth test) and before the
buildings, and the portal pane then hides the facade there.

**Not yet.** Upper storeys and stairs (the templates carry every storey; only the ground storey
is built), windows that show the rooms behind them, interior doors that swing (the plan's
doorways are open gaps), and driveways and garage doors.
