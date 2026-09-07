# Kerbside

A map of the walkable world, built from ordinary photographs.

Navigation systems know the roads to the centimetre and almost nothing about the three feet
beside them. This builds that missing layer — kerb height, footway width, surface, whether a
ramp is really passable — from imagery captured by people already walking past.

## What is here

Two halves. The first builds a world model from photographs and city records; the second is the
original simulation and capture stack the measurement was calibrated on.

| Layer | Where | State |
|---|---|---|
| Imagery catalogue | `src/smc/imagery/` | 386,624 observations from four providers, deduplicated across all of them |
| Official records | `src/smc/official/` | SFMTA and DataSF: curb lines, right of way, footway survey, lane counts, crosswalks |
| Enrichment | `src/smc/enrich/` | Every frame placed on a street; pair graph, pose correction, semantic fractions |
| Photo facades | `src/smc/facades/` | Walls rectified out of street-level frames and merged |
| Aerial lidar | `src/smc/lidar/` | Kerb heights from Entwine point tiles, cross-checked against Waymo |
| 3D reconstruction | `scripts/build_sf_corridor_3d.py` | The corridor as a walkable model, published to `docs/` |
| Simulated world | `src/smc/carla_gen/` | Hierarchical right-of-way geometry with modelled non-compliance |
| Renderer | `src/smc/render/` | Software rasteriser; world-anchored surface detail, exact ground truth |
| Capture policy | `src/smc/capture/` | Distance-gated trigger, verified against varying gait |
| Curation | `src/smc/curate/` | Sharpness, perceptual hash, exposure, people-as-subject |
| Anchoring | `src/smc/mapping/` | PnP with covariance, retrieval, metric scale, confidence |
| Measurement | `src/smc/measure/` | Kerb height, footway width, cross slope, with uncertainty |
| Street overlay | `src/smc/overlay/` | Snapping, stable feature identity, station-dependent cross-section |
| Device pipeline | `src/smc/ingest/` | Journal, nightly batch, destinations |
| Web app | `tools/app_template.html` | The whole capture loop in a browser |

`make check` runs lint and the suite.

## The corridor

One region — Marina through the Financial District, about five square miles — carried far
enough to be checked against reality.

| | |
|---|---|
| Observations | 386,624 (Mapillary 307,986 · KartaView 61,977 · PandaSet 15,282 · Panoramax 1,379) |
| Eligible after one uniform resolution floor | 338,893 |
| Placed on a named street, with station and side | 368,035 |
| Streets with a carriageway measured between mapped kerbs | 5,017 ways, 1,136 segments |
| Kerbs with their own measured height | 4,926 ways, 651 distinct heights, 60–445 mm |
| Walls wearing a photograph rather than a texture | 220, in one 250 m chunk of Chinatown |
| Frames with measured intrinsics, pose and co-fired lidar | 15,282 |

## What the sources say about each other

The useful number is not any one source's answer. It is how far apart two independent ones sit.

- **The city's own two footway records agree to 5 cm** — a 2014 consultant survey against a
  dimension in feet and inches off a named sheet, median error zero, 98% within half a metre.
- **Our aerial lidar sits 0.93 m from both**, mean absolute, after being bounded by the right of
  way. Before the bound it was 1.16 m with a long tail: the ground-plane fit follows flat
  walkable ground past the property line and into forecourts.
- **Mapped kerb geometry and the recorded right of way agree on the footway allowance to about
  6 cm** across the Chinatown chunk — two sources with nothing in common.
- **Aerial lidar and Waymo's ground-level lidar agree on kerb height to 1 mm of median**
  (126 mm against 131 mm).

## Measured, not claimed

Every figure below came from running the code, most from real photographs rather than
simulation. Where something is an upper bound or unproven, it says so.

- **Kerb height: 13 mm mean absolute error**, flat across resolutions.
- **Position after anchoring: 11 mm** against a footway-surveyed reference, from a GNSS prior of
  several metres.
- **Match threshold calibrated on 344 real pairs.** At 12 inliers, 29% of accepted pairs are the
  wrong place; at 15, none are. Different-place pairs top out at 13.
- **Glasses resolution costs nothing.** Degraded to the 1440x1080 the Meta toolkit delivers,
  matching is slightly *better* than the full-resolution source. The 720p stream halves it, so
  anchoring should use still capture.
- **Capture spacing holds under varying pace**: a 38% coefficient of variation in walking speed
  produces 2.8% variation in frame spacing, because the trigger is distance-gated rather than
  timed.

## What is still guessed

Stated because the model does not look like it. Building heights are OpenStreetMap's where it
has them and a 10.5 m default on 3,536 of 15,984 buildings, which are drawn desaturated.
Building materials, colours and window patterns are procedural everywhere except the 220
photographed walls. Curb heights come from our lidar because no San Francisco record publishes
one: top-of-curb and flow-line elevations exist only on scanned improvement plans behind a
viewer with no bulk interface.

## The open question

A reference index only anchors captures taken from its own vantage. A roadway survey anchors
roadway captures at 34 mm and footway captures **not at all** — retrieval works and surface
overlap is 43%, but local descriptors do not survive the viewpoint change. Surveying both
vantages resolves it; whether real surfaces need that is settled by
`python -m smc.calibrate vantage`.

## Licensing discipline

Two constraints shape the dependency list and are enforced in code:

- **No Google data path.** Maps Platform terms forbid using Maps Content to train ML systems,
  forbid creating content based on it, and forbid caching. Providers carry a `commercial_safe`
  flag and selecting an unsafe one requires an explicit argument at the call site.
- **Reference geometry stays reference.** OpenStreetMap and Overture are ODbL. They inform
  anchoring and are never merged into the served facts, which keeps the product a Produced Work.

Anchor imagery defaults to [Panoramax](https://panoramax.fr) — no account, self-hostable, and
not operated by a company that also sells wearable cameras.

## Running it

```bash
make install-dev     # includes lint, type checking, GCS and PyTorch extras
make check
python -m smc.ingest seed --out build/seed --blocks 2
python -m smc.phone ingest --journal build/phone
python -m smc.phone batch --journal build/phone --out gs://your-bucket
```

`python -m smc.adapters check` reports which credentials are set and which of them are not
commercial-safe.

## Documentation

`docs/` carries the research, the dependency and licensing audit, the comparables, the build
order, and a running record of what was measured and what was not.

## Licence

MIT for the code. Data sources carry their own terms; see `docs/01-dependency-stack.md`.
