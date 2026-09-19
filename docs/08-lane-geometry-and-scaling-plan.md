# 08 — Lane geometry, storage, Unreal, and the build order

A review of the "Lane Geometry and Geographic Scaling Plan", corrected against what the code
does today, with the lane/parking design made concrete, the storage and Unreal questions
settled, and the work laid out in chunks. Numbers quoted here are the ones the repo measures
(`README.md`, `docs/07-status.md`, `data/sf_corridor/audits/width_vs_kerb.json`).

## 0. Where the plan is right, and where it needs correcting

Right, and adopted as written:

- The street is a sequence of measured cross-sections, not a centreline plus a width. The
  renderer already does half of this (`envelopeEdgesAt` / `halfWidthAt` read the city's kerb
  lines every 2–4 m along 1,639 of 1,728 ways, median error 5 cm); the other half — how the
  space between the kerbs is allocated — is still a centreline-and-count guess.
- Infer non-travel space before lanes. Parking today is a constant (`PARKING_LANE_M = 2.4`) on
  whichever side SFMTA's parking policies cover ≥30% of a block face. That is the right
  *side*, and a guessed *width*.
- Make the world model smarter, not the renderer. Everything in Part I of the plan belongs in
  `src/smc/`, published as facts; `build_sf_corridor_3d.py` should consume them.
- Unreal as a second consumer of the same facts, never a decider.

Needs correcting:

- **Tier names collide.** `src/smc/facts/schema.py` already defines `Tier` A/B/C meaning
  *what may be claimed* (A semantic presence, B coarse geometry, C hazard-grade fine geometry,
  advisory). The plan's Tier A–E means *source quality*. Both are needed; call the second one
  `SourceGrade` (survey / lidar / image / mapped / inferred) and never reuse the letters.
- **Divided roads are not a "comparison" problem.** The 13 m p90 on `divided_half` ways is
  real geometry error: where the kerb file has no island line, a half is drawn from the right
  of way (`row_minus_footways`) or from OSM's two centrelines. The plan's fix — resolve each
  carriageway between its outer kerb and a median kerb — needs a *median source* where the
  city drew none: the lidar cross-profile (a raised median is a step in the ground return,
  same reader as `measure_tunnel_portals.py` / `build_curb_profiles.py`), then imagery.
- **"Parking permitted ≠ parking present"** is stated but not designed. It needs two facts,
  not one: `ParkingRegulation` (from policies; time-bounded) and `ParkingLane` (physical band;
  measured or inferred). The renderer draws the second.
- **Lane-marking detection from imagery** is the largest new capability in the plan and is
  not free: there is no permissively licensed marking segmenter in the stack (`docs/07-status`
  B3), and Mapillary's own detections are licence-restricted for geometry tracing. It should
  be scheduled after the cheaper sources are exhausted, not first.
- **Storage** is treated in the plan as "R2 is cheap". Correct, but the real decision is
  *what is a release artefact and what is a cache*; the repo already has that split half-made
  (`data/sf_corridor/` and `build/` are gitignored, `docs/` is the release). See §3.
- **The immediate sequence** in the plan puts the cross-section schema before the benchmarks.
  Reverse that for lanes: without a lane benchmark, a solver that "looks right" is exactly the
  failure mode the plan warns about.

## 1. Lane width and parking lanes — the concrete design

### 1.1 The object

```
StreetCrossSection
  way_id, station_m, lon/lat of the station, bearing
  left_kerb_m, right_kerb_m           offsets from the reference line, signed
  kerb_source                          survey | lidar | image | mapped | row   (SourceGrade)
  components[]                         ordered left→right, each:
     kind        parking | bike | buffer | transit | travel | turn | median | shoulder |
                 loading | unresolved
     width_m, sigma_m
     source, grade, confidence, observed_at
     boundary_left/right → LaneBoundary id or null
  residual_m                           Σ components − (right_kerb − left_kerb); must be ~0
  status                               resolved | partial | unresolved
```

`LaneBoundary`: polyline in local metres, colour (white/yellow), pattern (solid/broken/
double), width, confidence, source; `ParkingLane`: side, band [inner, outer] m from kerb,
type (parallel/angled/perpendicular/loading/transit_stop), confidence, source, evidence
count; `ParkingRegulation`: side, policy, hours, source (SFMTA), never drawn directly.

All of these are `WorldFact`s (`smc.facts.schema`) with `Provenance` measured/inferred and
the claim `Tier`; the source grade is a new field, not a new tier.

### 1.2 Order of resolution (and why each step is before the next)

1. **Envelope.** Left/right kerb at every station from the existing kerb envelope
   (`recentreOnKerbEnvelope` logic, moved to Python so it is a fact, not a page pass). On a
   divided way: outer kerb + median edge. Median edge source ladder: city island kerb →
   lidar cross-profile step ≥ 0.08 m → imagery → none (then `status = partial`, half drawn to
   its recorded width, *and counted*). Exit: the `divided_half` bucket p90 falls from 13.05 m
   to under 1.5 m or is explicitly `partial`.
2. **Non-travel bands, outermost first.** Parking (§1.3), then bike lanes with their actual
   arrangement (kerb→bike→buffer→parking→traffic vs kerb→parking→bike→traffic — SFMTA's
   bikeway network layer says which; OSM `cycleway:*:separation` where present), then transit
   lanes (SFMTA transit-only lane layer), then medians/turn pockets from markings.
3. **Boundaries.** Where a marking source exists it overrides; where none exists the solver
   places boundaries and marks them `inferred`.
4. **Allocation.** Remaining width → travel lanes by hypothesis selection (§1.4), never by a
   hard-coded lane width.
5. **Longitudinal fit.** Each boundary is a polyline fitted along the way with a step penalty;
   every step > 0.6 m must be explained by a feature (parking start/end, bulb, bus bulb,
   pocket, drop, median opening) or the section is `partial`.
6. **Intersections.** Lane ends are matched across the junction box from turn arrows
   (`way.turn`, already used for arrow paint), continuation bearing and markings; nothing is
   extended through the box. The renderer's existing `markingRunsClearOfJunctions` and
   transition tapers become consumers of these matches.

### 1.3 Parking: measured, not assumed

Evidence, strongest first, each producing a candidate band with a sigma:

1. City parking-lane / angled-parking GIS where it exists (SF: parking regulations give the
   *policy*, not the band; treat as regulation only).
2. Painted stall lines and the parking "T"s from imagery (these are the one marking that is
   easy to see and hard to misread).
3. **Parked-vehicle envelope from imagery.** Project vehicle masks from the corridor's
   Mapillary/KartaView frames onto the ground plane (the plane-sweep ground is flat to 25 mm
   rms already), accumulate per block face across dates, drop moving vehicles (position
   changes between frames of one sequence) and take the 85th percentile of the outer edge.
   That is the band. Pitfall: a single day says nothing — require ≥ 3 dates and ≥ 8
   vehicles, else `inferred`.
4. Regulation says parking is permitted and geometry has room ≥ 2.0 m: `inferred`, width
   from the regional prior (2.1–2.4 m parallel, 5.0–5.5 m angled) with sigma 0.3 m.
5. Nothing: `none` with low confidence, and the travel span is kerb to kerb — but flagged,
   because kerb-to-kerb lanes on a residential street are almost always wrong.

Pitfalls the plan names, and the guard for each:

- *Permitted vs present*: two facts (§1.1). A street-cleaning window does not remove the
  band; a red zone (from the Color Curb inventory, already ingested) removes it locally.
- *Universal width*: the 2.4 m constant survives only as the last rung, with a sigma.
- *Bus zones / loading*: these are `transit_stop` / `loading` bands with their own extents
  from the curb-zone inventory, not parking and not travel.
- *Bulb-outs*: the kerb envelope already follows them; the parking band ends where the
  kerb comes out, which the longitudinal fit must treat as an explained step.

### 1.4 Allocation: hypotheses, not arithmetic

For each station the candidate set is small and enumerable: `T` travel lanes (1–4) × centre
treatment (none / double yellow / two-way left-turn / median) × per-side parking (from §1.3).
Score = marking disagreement (m) + Σ width-prior penalty (per-class priors: travel 2.9–3.7 m,
turn 2.7–3.4 m, bike 1.5–2.1 m, buffer 0.6–1.2 m, parking as above) + discontinuity from the
previous station + source-conflict penalty (OSM `lanes` disagreeing with markings costs
something, not everything). The winning hypothesis must close the width to within
`|residual| ≤ 0.15 m`; otherwise `status = unresolved` and the renderer paints **no** lane
lines there (it already knows how to paint nothing: unnamed connectors get no lanes today).

This replaces `laneMarkingProfile` / `travelSpan` / `laneOffsets` in the page with a
consumer of `components[]`; the three functions keep their tests only as the fallback rung
for ways with no cross-section facts.

### 1.5 Benchmark first

`data/sf_corridor/benchmarks/lanes/` — 60 block faces chosen by stratum (marked arterial,
unmarked residential, divided, bike-laned, angled parking, hill), each with hand-measured
truth from aerial imagery + the lidar cross-profile + a site visit where possible:
kerb-to-kerb, each band's width, boundary positions, lane count, bike arrangement. Metrics
per stratum: kerb error, parking MAE, travel-lane MAE, boundary lateral error, count
accuracy, arrangement accuracy, refusal rate. A `tests/test_lane_benchmark.py` holds the
numbers to a baseline the way `test_width_vs_kerb.py` does, and the audit prints them.

Exit criteria for Chunk A's lane work: parking MAE ≤ 0.25 m where imagery evidence exists,
travel-lane MAE ≤ 0.30 m on marked streets, refusal ≥ 90% on the sections the truth calls
ambiguous, and the divided-half p90 as in §1.2.

## 2. Unreal Engine: what it is for and what it gets

Decision: Unreal is a **consumer**, added after the world model is fact-based (Chunk D).
Not before — an exporter of today's page geometry would export the guesses.

What it gets, per cell: `RoadCell` (resolved cross-sections → lane/kerb/pavement meshes),
`Building` (footprint + height + facade classes), `Facade` (the 220 photographed walls as
textures with their provenance), `Tree`, `Furniture`, `Terrain` (§4 note), `Surface`
(material classes). All in local metres about the cell's origin, with the cell's
lon/lat/EPSG anchor so Unreal's georeferencing plugin maps it exactly; Large World
Coordinates for the whole metro.

What it gives that Three.js cannot cheaply: World Partition streaming that matches the H3
cell design one-to-one; Nanite so reconstructed facades keep their triangles; Lumen for time
of day/weather; and a physics world (vehicles, pedestrians, wheelchairs, delivery robots)
that turns a sidewalk from a thing you look at into a thing that can be walked, driven and
audited. The web viewer stays as the free, URL-reachable front door.

Pitfall: the terrain. The flat model draws Russian Hill's streets at grade and sinks the
tunnels under them. Unreal will make that lie obvious the moment there is a horizon, so the
exporter needs the terrain layer (aerial lidar DEM, already on disk) before the first Unreal
build, and the streets need elevation profiles (the same lidar reader that measured the
tunnel portals) — which is why terrain is in Chunk A.

## 3. Storage: the decision

Three classes of bytes, three homes:

| Class | What | Home | Size now / per city |
|---|---|---|---|
| Code, schemas, tests, city configs, benchmarks, audits, baselines | git | GitHub | 253 MB (should fall: the built page is in it) |
| Release cells: resolved facts + render shards + textures | object storage + CDN | Cloudflare R2 (free egress) | 72 MB corridor → 1–5 GB/city |
| Raw observations: frames, EPT tiles, parquet | cold object storage, deletable | Backblaze B2 (or R2 IA) | 32 GB corridor imagery → 0.25–1 TB/city if kept |

Rules: (1) GitHub Pages stays the *demo* host for one corridor and stops being the release
channel; the viewer loads cells from R2 by URL. (2) A raw observation is kept only while a
measurement cites it; after facts are published, keep the cited crops and descriptors, drop
the rest (the release pack in `src/smc/storage/release_pack.py` already distinguishes
pack from cache — extend it, do not invent a new layout). (3) One repo per town: no —
per-town *configs* in one repo, cells in object storage. (4) Budget: 100 cities × 5 GB =
500 GB ≈ $8/month on R2; raw imagery is the only line item that can reach hundreds of
dollars, and it is optional by rule (2).

Concrete first step (Chunk A.7): move `docs/sf-corridor-*.json` and the detail shards out of
git into R2 behind the same paths, with `tools/build_pages.py` uploading; the HTML stays in
git. That alone takes the repo under the 1 GB guidance for good.

## 4. Build order, in chunks

Each chunk ships to both sites at its end, with tests holding every number it changed.
Sizes are working-days at the current pace (one engineer + the agent).

### Chunk A — improvements to the current engine (≈ 4–5 weeks)

Order matters: each item removes a guess the next item would otherwise inherit.

1. **Benchmarks before solvers.** Populate the near-field photo-vs-lidar benchmark (or
   delete the 13 mm claim); build the lane benchmark of §1.5 with 60 block faces. 4 d.
2. **Sidewalk width MAE 1.16 m → ≤ 0.35 m.** The tail is the kerb-derived pavement meeting a
   mapped footway on the same side; resolve one pavement per side per station from the
   ladder (survey → lidar → mapped → derived) instead of drawing both. Holds in the audit.
   4 d.
3. **Cross-section facts.** `StreetCrossSection` / `LaneBoundary` / `ParkingLane` /
   `ParkingRegulation` in `smc.facts`, produced by a Python `build_cross_sections.py` from
   the kerb envelope + curb zones + parking policies + bikeway/transit layers; the page reads
   `components[]` and falls back to today's lane arithmetic where none exist. 6 d.
4. **Parking bands from imagery** (§1.3 step 3) and the **median source** for divided roads
   (§1.2 step 1). 6 d.
5. **Allocation solver + longitudinal fit + intersection matching** (§1.2 steps 4–6),
   refusal wired to "paint nothing". 6 d.
6. **Crossings to curb ramps.** Ramps (already ingested) become endpoint candidates in
   `crossingRoadSpanPoints`; target: kerb-attached share 59% → ≥ 85%. 3 d.
7. **Centimetre delivery + storage split.** Local-metre cell shards at full precision (drop
   the 0.10 m simplification and 6-decimal quantisation), served from R2 (§3). 3 d.
8. **Terrain.** Lidar DEM per cell, street elevation profiles, buildings on the ground they
   stand on; the tunnel "sink" becomes a real hill. 5 d.
9. **CI.** Lint + mypy + tests + `audit_corridor_render.py --baseline` check on every push;
   deploy only from green. Documentation metrics generated from the audit, not typed. 2 d.

Exit: every "still guessed" line in README either has a measured source or a refusal count.

### Chunk B — ingestion flows (≈ 3–4 weeks)

1. **Adapters, not scripts.** `OSMAdapter`, `OvertureAdapter` (reference only — ODbL),
   `MunicipalCurbAdapter`, `MunicipalCrosswalkAdapter`, `MunicipalParkingAdapter`,
   `LidarAdapter` (EPT), `MapillaryAdapter`, `PanoramaxAdapter` (the last three exist in
   `smc.adapters` / `smc.lidar` — normalise their outputs, do not rewrite them). Each:
   fetch → normalise to facts → provenance. No renderer behaviour inside. 6 d.
2. **Capability discovery.** A `region.yaml` per city and a `kerbside discover <bbox>` that
   fills the capability vector (curbs=official/lidar/none …) by probing the adapters. 3 d.
3. **Cells.** H3 res 9 as the unit of processing, caching, versioning and deployment;
   `kerbside build --region san-francisco-corridor --cells changed` recomputes only touched
   cells and neighbours. The audit runs per cell and aggregates. 6 d.
4. **Fallback ladders as code.** One table per property (kerb, width, height, parking …),
   consulted by the resolvers, printed in the audit as "source used" histograms. 3 d.
5. **Second region as the test.** A different SF district first (cheap: same adapters, new
   cells), then one non-SF city with lidar and no municipal kerbs, to prove the ladders drop a
   rung without breaking. 4 d.

Exit: SF is a config, and a city with a weaker capability vector builds to a lower-confidence
map rather than failing.

### Chunk C — expanding image intake (≈ 3 weeks)

1. **Uncertainty map.** Per block face: which facts are inferred, which sides have one
   viewing direction, stale dates, unresolved ramps/parking/markings. Rendered as the
   "Show gaps" layer the page already has, but from facts. 3 d.
2. **Capture planner.** Expected information gain per vantage; the capture app
   (`smc.capture`) receives a queue of vantages, not a route. 4 d.
3. **Intake at scale.** RTK-seeded anchoring finished; the PandaSet front-camera estimator
   fixed or that view excluded (17.47 m MAE says the assumption is wrong for it); dedupe by
   pose; retain-by-citation (§3 rule 2). 5 d.
4. **Marking detection.** Only now: accumulate white/yellow tracks from many frames onto the
   ground plane into `LaneBoundary` facts; licensing gate on the segmenter documented before
   the first model is run. 5 d.

Exit: a new capture measurably reduces the uncertainty map, and lane MAE on unmarked
residential streets moves.

### Chunk D — Unreal exporter (≈ 2–3 weeks, after A.8 and B.3)

Cell → Unreal Datasmith/USD with georeference; World Partition per cell; Nanite for
reconstructed facades; a physics pass (vehicle, pedestrian, wheelchair) that reports where
the geometry is impassable — which is itself a validation signal fed back to the
uncertainty map.

## 5. What not to do

- Do not add more classes of visual geometry to the page until A.3–A.5 exist; every new
  visual is another consumer to migrate.
- Do not keep the renderer's lane arithmetic as a silent fallback once cross-sections cover
  a way; `status = unresolved` must draw nothing, and the audit must count it.
- Do not run marking detection before its licence is settled and the benchmark exists.
- Do not put city cells in git.
