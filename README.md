# Kerbside

A map of the walkable world, built from ordinary photographs.

Navigation systems know the roads to the centimetre and almost nothing about the three feet
beside them. This builds that missing layer — kerb height, footway width, surface, whether a
ramp is really passable — from imagery captured by people already walking past.

## What is here

| Layer | Where | State |
|---|---|---|
| Simulated world | `src/smc/carla_gen/` | Hierarchical right-of-way geometry with modelled non-compliance |
| Renderer | `src/smc/render/` | Software rasteriser; world-anchored surface detail, exact ground truth |
| Capture policy | `src/smc/capture/` | Distance-gated trigger, verified against varying gait |
| Curation | `src/smc/curate/` | Sharpness, perceptual hash, exposure, people-as-subject |
| Anchoring | `src/smc/mapping/` | PnP with covariance, retrieval, metric scale, confidence |
| Measurement | `src/smc/measure/` | Kerb height, footway width, cross slope, with uncertainty |
| Street overlay | `src/smc/overlay/` | Snapping, stable feature identity, shared map frame |
| Device pipeline | `src/smc/ingest/` | Journal, nightly batch, destinations |
| Web app | `tools/app_template.html` | The whole capture loop in a browser |

357 tests. `make check` runs lint and the suite.

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
