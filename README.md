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

- Carriageways drawn between the city's kerb lines, read every few metres along each way
  (1,639 of 1,728 street ways with kerbs nearby); the recorded right of way, the lane count
  and the room to the next street are fallbacks for the rest, and a right of way twice what
  the kerbs allow is rejected as another street's record (51 ways).
- Footways from the kerb outward, held to the building line, with a four-inch kerb tile that
  carries the city's curb paint on its own vertices, and a corner piece at every junction.
- Lane paint that stops at every junction and is spaced over the travel lanes, with the
  parking lanes read from SFMTA's parking block faces (1,131 of 2,169 named street ways have one); crossings painted
  kerb to kerb in legs, one each side of a median or refuge island (99.8% of legs end on a
  drawn carriageway; 27 crossings parted for islands; no mapped crossing displaced by the
  stand-in a sidewalk drawn through the junction gets); curb ramps with ADA dome pads; bike
  lanes between the parked cars and the traffic, eased to meet across a split.
- 24,603 official signs facing the road; 12,499 curb policy zones and 4,275 Color Curb Program
  assets painted in the five colours the city paints; bus zones in transit red.
- 15,985 buildings, 14,490 wearing a colour sampled from a photograph of that building, 220
  walls wearing the photograph itself; heights from lidar medians over 12,262 footprints.
- Two road tunnels (Broadway, Stockton) with mouths, cover and portal width read from the
  lidar and the city's kerbs; 142 stone and brick walls, 146 surface car parks with angled
  bays, courts, parks, street furniture, trees.

## Measured, not claimed

Every figure came from running the code. Where something is a bound or unproven, it says so.
The corridor-wide figures below are the `widthVsKerb` audit
(`scripts/audit_corridor_render.py`), held to a baseline in `data/sf_corridor/audits/` by
`tests/test_width_vs_kerb.py`, so a change that makes them worse fails.

- Rendered carriageway width against the city's kerb lines: median error 5 cm; 190 of 1,728
  ways are drawn more than 3 m narrower than kerb to kerb and 13 more than 3 m wider (the
  narrow ones are mostly halves of divided roads where the kerb file has no island lines, so
  the comparison spans the whole street).
- Crossings ending on the local kerb: 59%; crossing legs ending on a drawn carriageway: 99.8%,
  with 11 of 2,558 falling back to the whole desire line; mapped crossings displaced by a
  sidewalk's stand-in crossing: 0 (was 39). Footway laid of footway asked: 91%. Kerb sides with
  no pavement at all: 2.5%. Streets drawn through a building facade: 96; buildings with two or
  more footprint corners on a carriageway: 780.
- Tunnel mouths within 14 m of OpenStreetMap's nodes (Broadway east is that far inside),
  except the Stockton Tunnel's south mouth, moved 18 m past the Bush Street junction that
  stands on it; covered lengths 560 m and 258 m; headwall cover 2.7-13.6 m, all from the
  lidar. Each bore is swept the whole way between its mouths, with a walkway along each wall
  and lights at the crown, and the walker goes in one end and out the other; the open
  approach outside a mouth is a street between the walls of the cut the city's kerbs draw.
- The city's two footway records agree to 5 cm; our aerial lidar sits 0.93 m from both after
  being bounded by the right of way.
- Aerial and Waymo ground lidar agree on kerb height to 1 mm of median (126 vs 131 mm).
- Kerb height from photographs: 13 mm mean absolute error. Position after anchoring: 11 mm from
  a GNSS prior of several metres.
- Match threshold calibrated on 344 real pairs: at 15 inliers no accepted pair is the wrong place.
- Meta-glasses resolution (1440x1080) matches as well as full resolution; the 720p stream halves it.

**Still guessed:** building materials and window patterns are procedural except the 220
photographed walls; unmeasured building heights are drawn desaturated; curb heights come only
from our lidar because no city record publishes one; lane lines divide the travel lanes by
OpenStreetMap's lane count, and the parking lanes come from the city's parking policies rather
than a survey of where cars stand (OpenStreetMap's `parking:lane` tags are absent here); the
halves of a divided road with no island kerb in the city file are drawn from the right of way;
Broadway's twin bores come
from the width of its cut, not from a record; the model is flat, so a bore goes down under
the ground at 15% from each mouth to 8 m below and runs there to the far mouth, and the hill
is drawn only over that descent -- Russian Hill's streets and houses sit at grade over a
tunnel that is really 40 m beneath them.

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
make check                                   # lint + 751 tests
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
