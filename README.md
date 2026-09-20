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
- Every street as measured cross-sections (`smc.facts.cross_section`): a station every 4 m
  with the two kerbs from the city's curb-line profile, the parking band from SFMTA's parking
  block faces (1,131 of 2,169 named street ways) or assumed where the map's lane count cannot
  otherwise close the width, the bike lane and its arrangement from the map, and the travel
  lanes chosen from hypotheses against width priors -- never a width divided by a count. 53,771
  stations: 78% resolved, 20% partial (the map's count and the widths disagree, or parking was
  assumed), 1.7% unresolved and painted with nothing. Lane paint, the double yellow, arrows
  and bike lanes are drawn from those bands and stop at every junction; crossings are painted
  kerb to kerb in legs, one each side of a median or refuge island (99.8% of legs end on a
  drawn carriageway; 34 crossings parted for islands; no mapped crossing displaced by the
  stand-in a sidewalk drawn through the junction gets); curb ramps with ADA dome pads.
- Medians from the lidar (`scripts/measure_medians_lidar.py`): 196 pairs of divided halves read
  every 5 m across the whole road; a raised plateau becomes island kerb lines (1,248 stations,
  300 lines), a painted centre a median line the kerb envelope alone reads (999 stations). A
  one-way street with one mapped footway is a half of a divided road only when its other half
  runs beside it.
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

- Rendered carriageway width against the city's kerb lines: median error 4 cm; 111 of 1,755
  ways are drawn more than 3 m narrower than kerb to kerb (was 190) and 24 more than 3 m wider
  (was 13). Divided halves, against the outer kerb and the lidar's median: median error 7 cm
  (was 1.13 m), 26 of 186 over 3 m (was 119 of 286). What remains wide is the Van Ness BRT
  lanes, whose OpenStreetMap line runs on the platform edge and reads no island of its own.
- Crossings ending on the kerb the model drew: 90.5% (was 59%: the end now walks back onto the
  drawn carriageway rather than stopping on the map's node); crossing ends standing at a corner
  where SFMTA's curb-ramp inventory has a ramp: 86.9% of 5,118 ends (237 at a corner with no
  ramp recorded, 431 where the inventory has no record); crossing legs ending on a drawn
  carriageway: 99.8%, with 10 of 2,596 falling back to the whole desire line; mapped crossings
  displaced by a sidewalk's stand-in crossing: 0 (was 39). Footway laid of footway asked: 91%. Kerb sides with
  no pavement at all: 2.5%. Streets drawn through a building facade: 96; buildings with two or
  more footprint corners on a carriageway: 780.
- Tunnel mouths where the lidar's cover over the road first reaches 3.5 m for two samples
  running (Broadway's east mouth is 40 m inside OpenStreetMap's way end: the first 26 m of
  "cover" there is the top of the approach cut's walls, not a roof); covered lengths 508 m
  and 256 m; headwall cover 2.7-13.6 m, all from the lidar. The floor of each bore runs
  between the road levels the lidar fitted at its two mouths, and Bush Street is drawn on
  the deck over the Stockton Tunnel's south portal with the mouth beneath it. Each bore is
  swept the whole way, with a walkway along each wall and lights at the crown, and the walker
  goes in one end and out the other; the open approach outside a mouth is a street between
  the walls of the cut the city's kerbs draw, held to the cut's road line where the terrain
  grid has no ground returns under the deck.
- Sidewalk width, three ways against each other on 6,141 footways: the city's two records
  (survey and segment) agree to 5 cm MAE; our aerial lidar, read as a run of ground from the kerb
  riser and bounded by the right of way (`smc.lidar.curb.walk_run`), sits 1.24 m MAE from the
  survey with a median error of -3 cm. The MAE is a tail, not a bias: the survey records the
  legal sidewalk to the property line and the lidar reads the paved one, and where trees,
  stairs and parked cars stand on the pavement the run stops short. The 0.35 m target was not
  met and is not reachable against a legal-width record; the lidar figure is reported as what
  it is. Kerb lines are delivered at 7 decimals (1 cm) and simplified at 2 cm, not the 10 cm
  and 6 decimals before.
- Terrain: the ground is a 2 m grid of the city's lidar ground returns
  (`scripts/build_terrain.py`, `docs/sf-corridor-terrain.bin`, 1,938,904 cells with
  returns, 1,486,601 filled from neighbours, the rest open water). Its accuracy is
  measured against 5,529,190 ground returns held out of the gridding: overall RMSE
  0.125 m, MAE 0.031 m, median 1 mm, bias
  0 mm; on the roadway (within 4 m of a centreline) RMSE 0.037 m,
  MAE 0.014 m, 90th percentile 2.6 cm; off the roadway RMSE
  0.146 m, MAE 0.038 m; by slope, under 5% RMSE 0.040 m,
  5-15% 0.052 m, over 15% 0.331 m (a 2 m cell
  straddling a retaining wall or a stair is where the tail is). Those are the grid's own error
  on top of the lidar's, which USGS states as about 0.10 m RMSEz for this collection; the two
  are independent, so the roadway ground stands within roughly 0.11 m RMSE of the true surface.
  Every street, pavement, kerb, crossing, building, tree and post stands on it; a building on
  the lowest ground under its footprint, a crossing on the line between its two kerbs.
- Aerial and Waymo ground lidar agree on kerb height to 1 mm of median (126 vs 131 mm).
- Kerb height from photographs: **not yet measured against the lidar**. The 13 mm figure quoted
  here until September 2026 came from a simulated run scored with an oracle matcher; the
  real-photograph benchmark (`data/curb_measurement/photo_vs_lidar_run.json`) ran on the twelve
  best-covered footways and paired no near-field kerb with a lidar slice. Position after
  anchoring: 11 mm from a GNSS prior of several metres, in the same simulated run.
- Match threshold calibrated on 344 real pairs: at 15 inliers no accepted pair is the wrong place.
- Meta-glasses resolution (1440x1080) matches as well as full resolution; the 720p stream halves it.

**Still guessed:** building materials and window patterns are procedural except the 220
photographed walls and the buildings whose facade fingerprint (`scripts/build_facade_fingerprints.py`,
read off their own photographs: glazing, texture, hue, storey rhythm) has been matched to the
closest of the six renders the page has (`smc.facades.match`) -- a background job still
running through the corridor. The fingerprints are the record; the catalogue's prototypes
are not yet fitted to labelled walls, and the first pass called far more concrete and glass
than the city has, so the page believes a match only at 0.75 confidence and above until
they are; unmeasured building heights are drawn desaturated; curb heights come only
from our lidar because no city record publishes one; the parking bands are the city's
policies plus a 2.3 m prior -- the estimator that measures them from parked cars in imagery
(`smc.measure.parking_band`) is written and tested and has no crawl feeding it yet, so
`crossSectionParkingMeasured` is 0 in the baseline; lane counts are the map's where it has
one and a width-prior hypothesis where it does not, with no painted-line detection behind
either; Broadway's twin bores come
from the width of its cut, not from a record; the tunnel's floor follows the ground less the
lidar's cover, so the bore is as deep as the hill is high, but its grade between the stations
where the cover was read is interpolated, not measured.

**Still open:** the anchoring front end is a correct engine with an empty tank — a reference
index only anchors captures taken from its own vantage. See `docs/07-status.md`.

## Any region, the same way

`scripts/ingest_region.py <name>` builds a region from `data/regions/regions.json` through
the same stages the corridor went through -- discover, osm, terrain, imagery, official,
build, audit -- with a journal that resumes, and a capability vector found by probing the
sources (`docs/23-ingestion-at-scale.md`). Downtown Oakland was the first region outside
San Francisco: no municipal records, kerbs from the lidar, 3,066 buildings and 1,412
streets with cross-sections on class priors, and the page says which rungs it stands on.

## The same world in Unreal

`tools/unreal/export_tiles.mjs` runs the page's own build headless and writes the corridor as
343 glTF tiles of 250 m (25 M triangles, 502 MB; published as the `unreal-tiles-v1` release,
160 MB compressed and checksummed). `unreal/Kerbside` is the UE 5.4 project that imports them
(`Content/Kerbside/import_tiles.py`: Interchange import, Nanite, materials by surface name,
World Partition) with Epic Online Services configured from `.env.local`, never from git. See
`unreal/README.md`.

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
make check                                   # lint + 785 tests
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
