# 25 — The geometry compiler: from catalogue to measured shape

Written 2026-09-29, with phase 1 of the work it describes. Companion to
`docs/24-scans-interiors-and-reconstruction-readiness.md` (Part B of which this starts to
deliver).

## What was wrong

The renderer drew most things from a *kind*. A kerb was a road's width pushed out from its
centreline, a corner was whatever the corner rule produced, a bench was four boxes, a building
was an archetype and a height painted with one of a dozen window patterns. Anything the
catalogue did not have was drawn as its nearest entry: a curved bench became the straight one,
a rounded kerb return became a square corner, two houses of the same "type" had the same
windows.

More catalogue entries would not fix that — `bench_1 … bench_500` is still a catalogue. The fix
is to stop choosing shapes and start describing them.

## The pipeline, as it now exists

```
 survey lines · lidar · (photogrammetry, once it exists) · fixtures · existing Kerbside geometry
                                        │
             smc.reconstruction.object_cloud      every source asked what it saw of ONE object,
                                        │         in that object's own east/north/up frame,
                                        │         each point tagged with its evidence
                                        ▼
             smc.reconstruction.geometry_classifier   which family: by name where a name
                                        │             settles it, by measured shape where not
                                        ▼
             smc.geometry.{spline,extrusion,primitives,freeform,building}   the fitters
                                        │
             smc.reconstruction.geometry_fit      evidence → confidence → accept / simplify /
                                        │         refuse; never displace more-trusted geometry
                                        ▼
             smc.world.object.WorldObject         the canonical object: owns the geometry
                                        │
             smc.world.lod / smc.world.compile    levels of detail with measured error;
                              ┌─────────┼──────────┐   compiled per consumer
                              ▼         ▼          ▼
                      web sidecar     GLB       (robotics / measurement: the canonical JSON)
                    sf-corridor-world-objects.json
```

`scripts/build_world_objects.py --region <name>` runs it for a region's kerbs. The canonical
objects go to `data/regions/<region>/world/world_objects.jsonl`, the summary beside them, and the
compiled sidecar to the page's directory as `sf-corridor-world-objects.json`.

## The geometry families (`src/smc/geometry/`)

| Family | Class | For | Fitted from |
|---|---|---|---|
| Spline extrusion | `SplineExtrusion` | kerbs, medians, fences, rails, some benches | a fitted path (`spline.py`) and a measured section (`extrusion.profile_from_points`) |
| Parametric building | `ParametricBuilding` | buildings, facades | footprint + roof + per-facade `FacadeElement`s |
| Primitive assembly | `PrimitiveAssembly` | poles, bollards, hydrants, bins, cabinets | least-squares cylinders, boxes, frusta, stacked (`fit_vertical_stack`) |
| Freeform mesh | `FreeformMesh` | sculptures, rocks, ornate or irregular fixtures | voxel closing + naive surface nets (`freeform.py`) |
| Terrain patch | (enum only) | the lidar ground | the page's existing terrain grid |

Every family works in metres in an object-local east/north/up frame. Every dimension that
matters is a `Param` carrying its own grade (`survey`, `lidar`, `image`, `mapped`, `inferred`) —
a kerb's path can be surveyed while its height is the corridor median, and the object says so.

Only numpy is available in this environment. The fitters, surface extraction, ear clipping,
simplification and point-to-triangle distances are written against numpy alone.

### Kerbs: the arbitrary path fitter (`smc.geometry.spline`)

Two regimes, chosen by what the evidence is:

- **Exact data** (a surveyed line — `CurveSamples(exact=True)`): the fit is *interpolating*. It
  passes through every vertex; a vertex turning ≥ 35°, or ≥ 10° between two straight runs of
  2.5 m or more, is a sharp corner (a break); a straight run is exactly its two ends; a run of
  short segments is a digitised arc and is interpolated by cubic Hermite pieces through its
  vertices, tangent to the straights it joins. Smoothing a survey can only destroy detail —
  the metre-long jog of a driveway apron, the notch at a drain.
- **Sensor data** (lidar, photogrammetry, anything noisy and unordered): the fit is
  *approximating* and robust.
  1. *Ordering.* The points are thinned to about one per band-width, the backbone is the
     longest path of their minimum spanning tree, spur ends are pruned, and every point is
     projected onto a smoothed backbone. (Through all the points of a wide band — a bench seat
     seen from above — the tree's longest path snakes; thinned, it runs end to end.)
  2. *Robust weights.* Each sample is judged by a leave-one-out moving-least-squares fit of
     its neighbours (Tukey biweights, scale floored at 5 cm so extrapolation at a line's end
     is not called an outlier). For corner search the kindest of nine verdicts is kept —
     two-sided and eight half-planes — because a sample on a true corner lies on the line
     through the samples on one side of it, and a stray lies on none.
  3. *Corners, decided by model selection.* At each concentrated turn two models are fitted:
     two lines meeting at a vertex, and two lines joined by a fillet of free radius. The sharp
     model wins unless the fillet explains the points better by more than one parameter is
     worth (BIC) — **and** the evidence has to reach into the vertex: on a rounded corner of
     radius r the nearest sample stays r(sec(θ/2) − 1) off it. No corner type exists for a
     rounded return to collapse into.
  4. *Tracing.* The output is walked a quarter-metre at a time, each point a moving-least-
     squares projection onto its neighbours with a bandwidth set by the tightest bend in
     reach and never finer than 2.5 sample spacings — so five-metre lidar stations cannot
     pretend to resolve a three-metre return. A point with evidence on one side only is an
     extrapolation and ends the walk. Gaps up to 15 m are bridged with a cubic matched to
     two metres of curve either side and marked unobserved; wider gaps split the kerb in two.
  5. *Validation.* Out-and-back zigzags, reversals, self-crossings, and truncation (kept
     samples beyond the path's ends) are recorded as problems and halve the confidence.

The nine required synthetic cases, outliers over twelve seeds, noisy rings, and real surveyed
San Francisco lines are all in `tests/test_curb_path_fitting.py`.

### Buildings (`smc.geometry.building`)

A `ParametricBuilding` has a footprint, a base and eave, a roof (`flat` or any measured mesh),
optional measured storey heights, and one `Facade` per wall carrying its own `FacadeElement`s:
windows, doors, storefronts, recesses, bay windows (canted at their measured angle, with their
own openings), balconies (slab plus a rail swept round the free edges — a spline extrusion
inside a building), cornices (a section swept along the eave), stairs, and freeform patches.
There is no type field. The construction functions are shared; every number is the element's
own. `tests/test_building_model.py` builds two houses with completely different measured window
layouts and checks each pane is where it was measured and recessed by its own depth.

**Residuals against existing geometry.** `elements_from_residual` takes the measured surface's
offset from an existing, well-placed wall plane — not the raw reconstruction — and turns each
connected region deeper than the detail policy's threshold into an element sized by its own
extent and depth (a bay at +0.65 m, windows at −0.12 m, a cornice at +0.30 m). A noisy scan can
add a bay to a building without being trusted to move the building. What is shallower returns
as an `AppearanceField` for a displacement or normal map.

### Geometry versus appearance (`DetailPolicy`)

Triangles are for what changes silhouette, shadow, collision, measurement or navigation. A
relief shallower than 8 cm (or smaller than 0.05 m²) goes to texture. Two lists override the
depth rule: kerbs, stairs, railings, benches, bollards, ramps, balconies, bay windows and doors
are always geometry however shallow; paint, cracks, stains, brick pattern and graffiti are
always appearance.

## The world object (`smc.world.object`)

`WorldObject(id, semantic_type, geometry, basis, confidence, evidence, anchor, material,
detail, fit, flags, supersedes)`.

- **basis** — where the shape came from: `measured` (fitted to observations of this object),
  `inferred`, `prior` (the existing Kerbside geometry, retained), `legacy_archetype` (the
  renderer's catalogue model), `unresolved`.
- **detail** — how much is drawn: `full`, `conservative`, `none`.
- **evidence** — `EvidenceRef`s (kind, source id, locator, licence, optional `asset_id` into
  `smc.reconstruction.provenance.SourceAsset`, capture time, count) plus observation count,
  independent sources, fit rms/max, inlier fraction, coverage, and lidar and prior disagreement.
  This reuses the project's provenance rather than running beside it: `source_id`s are those of
  `data/reconstruction/source_rights.json`, licences follow the per-observation `License`
  convention, and a source with unstated terms says so (`unstated: SFMTA ArcGIS service`).
- **fit** — method, software (`smc <version> (<commit>)`), time, parameters.

Enforced at construction: geometry without evidence is refused; `measured` needs an
observational source, observations and a fit record; `legacy_archetype` is capped at 0.3
confidence, must be flagged, and may cite only the map and existing geometry; confidence never
exceeds the grade cap of its best source (survey 0.95, lidar 0.9, image 0.8, mapped 0.6,
inferred 0.35).

### Confidence and the decision (`smc.reconstruction.geometry_fit`)

confidence = cap(grade) × support × quality × inliers × coverage × lidar agreement × source
diversity × secondary factor, each between 0 and 1: support saturates with observation count
(a survey is one complete observation), quality is a Gaussian of rms against the family's
tolerance, an inferred secondary dimension (a kerb height from the corridor median) costs 15%
rather than capping the whole object at "inferred".

- ≥ 0.70 → `measured`, drawn in full;
- ≥ 0.40 → `measured`, drawn **conservatively** (path simplified to 5 cm, a mesh to 5 cm, a
  building without its low-confidence elements);
- below → not drawn: existing geometry is kept (flagged `refused_candidate`), or the object is
  recorded `unresolved` with its evidence.

A fit never replaces existing geometry at least as trusted (plus a 0.05 margin); where the two
disagree beyond tolerance the kept object is flagged `conflict:`.

## Levels of detail (`smc.world.lod`)

LOD2 is the full measured geometry; LOD1 a simplification (path to 1 cm, mesh to 5 cm, a
building with only elements standing ≥ 25 cm out of or into its wall); LOD0 the simplest honest
stand-in (path to 50 cm with a boxed section, an upright box, footprint and roof). Every
level's geometric error is **measured** — the distance from the full surface to that level's —
so it speaks the tile tree's language (`smc.tiles.tree`: error turned into pixels). LOD3 is
reserved for micro-detail from appearance fields and is not built. Nothing is tied to a render
resolution.

## The renderer (`scripts/build_sf_corridor_3d.py`)

The page fetches `sf-corridor-world-objects.json` beside its other data; absent, nothing changes.

- **Swept objects along the ground** (kerbs, medians, fences, rails) arrive as their LOD1 path
  and section, and the page runs the same sweep the Python defines (`sweepGeometryLocal` — a
  line-for-line port, checked vertex for vertex against the Python in
  `tests/test_world_object_renderer.py`). They join the street geometry before it is merged:
  merged by material, tiled at 400 m, culled at the kerb's range, and stood on the ground by the
  same per-vertex lift every street surface gets.
- **Rigid objects** (a curved bench, a fitted bollard, a scanned sculpture, a building) arrive
  as triangles per level and become a `THREE.LOD`. A level is shown from the distance at which
  its measured error falls below `TILE_MAX_SCREEN_ERROR_PX` — the tile tree's own rule.
- **Claims.** Each reconstructed object claims what it stands in for: a kerb the stretch of
  kerb line within 1.5 m of it and running within 35° of its direction; a bench a disc. The
  page's own drawing of the same thing is left out there — at all four legacy kerb emission
  sites and in `addBenches` — and only there. This is the priority order: measured object;
  otherwise the page's parametric/procedural drawing; otherwise the legacy archetype.
- **Drawn only where the pavement meets it.** Road and pavement surfaces are still laid from
  widths, so where the survey puts a kerb well out from the pavement edge those widths drew, the
  measured kerb would stand alone in the asphalt. A reconstructed kerb stretch is drawn only
  where the page's own pavement lies within 1.5 m on its footway side; the rest is counted and
  waits for surfaces bounded by the kerbs. In the corridor: **353 km drawn, 77 km (18%) held
  back** (the page logs both on load).
- **The uniform-kerb switch.** `KERB_RENDER_UNIFORM` (every kerb drawn at the corridor's default
  height, a standing decision) applies to reconstructed kerbs too: their *path* is the measured
  one, their drawn height follows the switch, and the measured height stays in the canonical
  object. Flip the switch and they draw their measured heights.

## Internal truth, public likeness (direction set 2026-09-29)

Two versions of every object, not one. **Internally** the object keeps everything the compiler
knows: its basis, every level down to full resolution, the per-vertex evidence, the fit residuals
and the points it was fitted to. **Publicly** the page gets a likeness: the fewest triangles that
look the same from anywhere a visitor can stand, textured and coloured to match, and nothing
else. A wall of hundreds of fitted triangles ships as its rectangle and a texture; a kerb as its
swept section; a bench as its box and seat.

This is the LOD machinery with a different stopping rule, not a second pipeline:

- "Looks the same" is the tile tree's own test, `TILE_MAX_SCREEN_ERROR_PX`, evaluated at the
  **closest** viewing distance the public page allows (street level, first person), not at the
  distance a level is swapped in. The public copy is the coarsest level whose measured error
  passes that test; where none does, the object ships its finest level, and that is counted.
- What the coarse level loses in shape it may carry as texture (relief baked to a normal map,
  facade detail in the photograph) — visual parity, not data parity.
- Stripped from the public copy: basis parameters, evidence, residuals, per-vertex confidence,
  source point indices. The provenance *grade* stays (the truth boundary, doc 24 §B10, reaches
  the renderer), the measurements behind it do not.
- The internal copy is the one every later fit, merge and measurement reads. The public copy is
  regenerated from it, never edited, so the two cannot drift.

## What is measured and what is not (San Francisco corridor, this build)

| | |
|---|---|
| Surveyed curb lines read | 9,441 (SFMTA `MTA.curbs`, thinned to 2 cm before publishing) |
| Kerb objects built | 8,534, all accepted in full (survey grade, exact fit) |
| Corners decided from the survey | 5,368 rounded, 4,808 sharp |
| Kerb path | **measured** (survey) |
| Kerb height | **lidar** on 3,382 kerbs (the street's measured kerb height); **inferred** (corridor median) on 5,152 |
| Which side the footway is on | **inferred** from the nearest street centreline |
| Skipped, with reasons | 513 shorter than 1 m; 282 with no street within 40 m to orient by; 97 closed island/median rings (already raised from the same ring); 15 with no usable geometry |
| Drawn by the page | 353 km of kerb in 11,316 swept pieces; 77 km held back where the drawn pavement does not meet the surveyed kerb |
| Sidecar | 5.2 MB (≈1 MB gzipped) |

## What still uses the legacy catalogue

Everything not listed above: kerbs outside surveyed curb lines; road and pavement *surfaces*
(still laid from widths — see limits); crossings and corner slabs; every building (archetype,
height and painted facade — the parametric model exists and is tested, but no building is fitted
yet, because no facade residuals exist); benches, shelters, signs, posts, trees and all other
furniture; tunnels. None of it is marked measured, and a reconstructed object always takes
precedence where one exists.

## Limits, stated

- **Pavement and road surfaces still follow the legacy widths.** A reconstructed kerb replaces
  the legacy kerb lip where it claims it, but the pavement slab behind it is still laid from the
  street's width, and 18% of the surveyed kerb length lies too far from that slab to be drawn
  without floating in the road (it is held back, not drawn). Bounding the road and pavement
  surfaces by the reconstructed kerbs is the next renderer step, and a larger one; it is also
  what turns those 77 km on.
- **No building, bench or sensor-sampled kerb in the live data is reconstructed yet.** The
  curved bench, buildings and noisy kerbs are proven on fixtures only. That is not a gap in the
  code; it is the absence of pixels documented in `docs/photogrammetry-audit-2026-09.md`.
- Closed traffic islands keep their existing raised-ring drawing.

## What the photogrammetry pipeline has to provide next

1. **Station-level lidar kerb positions.** `measure_footway` finds the riser's lateral offset at
   every 5 m station but only per-way heights are persisted (`kerb_heights.json`). Writing each
   station's riser position (lon, lat, z, height, point count) would give the sensor-regime
   fitter real samples everywhere lidar reached — the first non-survey reconstructed kerbs.
2. **Object-centric photogrammetry output.** The `PhotogrammetrySource` in
   `smc.reconstruction.object_cloud` currently answers "no reconstructed surfaces exist". A
   reconstruction run needs to emit fused points per cell in a known frame with per-point
   source ids, so `gather()` can cut an object's cloud out of it.
3. **Facade residual samples.** The facade rectifier already puts pixels onto known wall planes;
   dense matching against those planes should emit `(u, v, offset, weight)` samples per wall —
   exactly what `elements_from_residual` consumes.
4. **Semantic object detection with positions** — benches, poles, hydrants — as regions to ask
   `gather()` about, each with an `ObjectRegion`.
5. **Material labels** in the reconstruction vocabulary (`FACADE_MATERIALS`, etc.) so a
   `WorldObject.material` is measured, not defaulted — doc 24 §B5.
