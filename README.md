# Kerbside

A map of the walkable world, built from ordinary photographs and the city's own records.

Navigation systems know the roads to the centimetre and almost nothing about the three feet
beside them. This builds that missing layer — kerb height, footway width, surface, whether a
ramp is really passable — and renders one San Francisco corridor as a walkable 3D model you can
open in a browser: <https://patstallone1-prog.github.io/Curb-measurements/>

## What is here

| Layer | Where | State |
|---|---|---|
| 3D reconstruction | `scripts/build_sf_corridor_3d.py` | The corridor as a walkable model, published to `docs/` |
| Imagery catalogue | `src/smc/imagery/` | 386,624 observations from four providers, deduplicated |
| Official records | `src/smc/official/` | SFMTA and DataSF: curb lines, right of way, footway survey, signs, curb zones, crosswalk inventory |
| Enrichment | `src/smc/enrich/` | Every frame placed on a street; pair graph, pose correction |
| Photo facades | `src/smc/facades/` | Walls rectified out of street-level frames; building colours sampled per footprint |
| Aerial lidar | `src/smc/lidar/` | Kerb and building heights from Entwine tiles, cross-checked against Waymo |
| Measurement | `src/smc/measure/` | Kerb height, footway width, cross slope, with uncertainty |
| Anchoring | `src/smc/mapping/` | PnP with covariance, retrieval, metric scale, confidence |
| Capture and device | `src/smc/capture/`, `src/smc/ingest/`, `tools/app_template.html` | Distance-gated trigger, journal, nightly batch, browser capture loop |
| Simulated world | `src/smc/carla_gen/`, `src/smc/render/` | The right-of-way simulator the measurement was calibrated on |

## The corridor

Marina through the Financial District, about five square miles.

- Carriageways at the surveyed width between mapped kerbs (5,017 ways); footways laid from the
  kerb outward with a four-inch kerb tile that carries SFMTA's curb paint on its own vertices,
  and a corner piece at every junction where two of them meet.
- Lane paint that stops at every junction, continental crossings resolved so a junction's legs
  match (817 from the SFMTA inventory, 1,575 by junction), curb ramps with ADA dome pads.
- 24,603 official signs facing the road, 21,519 curb zones, bus zones in transit red.
- 15,984 buildings, 14,490 wearing a colour sampled from a photograph of that building, 220 walls
  wearing the photograph itself; heights from lidar medians over 12,262 footprints.
- 142 stone and brick walls, 75 tunnel bores with portals, 146 surface car parks, courts, parks,
  street furniture, trees.

## Measured, not claimed

Every figure came from running the code. Where something is a bound or unproven, it says so.

- The city's two footway records agree to 5 cm; our aerial lidar sits 0.93 m from both after
  being bounded by the right of way.
- Aerial and Waymo ground lidar agree on kerb height to 1 mm of median (126 vs 131 mm).
- Kerb height from photographs: 13 mm mean absolute error. Position after anchoring: 11 mm from
  a GNSS prior of several metres.
- Match threshold calibrated on 344 real pairs: at 15 inliers no accepted pair is the wrong place.
- Meta-glasses resolution (1440x1080) matches as well as full resolution; the 720p stream halves it.

**Still guessed:** building materials and window patterns are procedural except the 220
photographed walls; unmeasured building heights are drawn desaturated; curb heights come only
from our lidar because no city record publishes one.

**Still open:** the anchoring front end is a correct engine with an empty tank — a reference
index only anchors captures taken from its own vantage. See `docs/07-status.md`.

## Licensing discipline

- **Google data is flagged, not used.** Maps Platform terms forbid training or derived content.
  Providers carry a `commercial_safe` flag and an unsafe one warns at the call site.
- **Reference geometry stays reference.** OpenStreetMap and Overture are ODbL; they inform
  anchoring and the rendering and are never merged into the served facts.
- Waymo Open Dataset is non-commercial; anything derived from it inherits that
  (`data/waymo_sf/PROVENANCE.md`). The project is non-commercial.
- Anchor imagery defaults to [Panoramax](https://panoramax.fr).

## Running it

```bash
make install-dev
make check                                   # lint + 705 tests
.venv/bin/python scripts/build_sf_corridor_3d.py --reuse-osm   # rebuild docs/sf-corridor-3d.*
python tools/build_pages.py --map-only --out ../Curb-measurements/docs   # publish the map
```

`python -m smc.adapters check` reports which credentials are set. Keys live in `.env.local`
(gitignored); only Supabase's publishable key ships in client code.

## Documentation

`docs/` carries the research, the dependency and licensing audit, the build order, and
`docs/07-status.md`, the running record of what was measured, what was built and what is open.

## Licence

MIT for the code. Data sources carry their own terms; see `docs/01-dependency-stack.md`.
