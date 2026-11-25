# Building heights and roofs nobody measured: City3D, then 3dfier, then the atlas

Code: `src/smc/buildings/height_fill.py` (the ranking and the readings), `scripts/fill_building_heights.py`
(measure a region, then patch its payloads), `scripts/fetch_gba_heights.py` (cut the atlas down to the
regions), `scripts/install_building_tools.sh` (the two programs). The builder runs the same fill
(`annotate_height_fill` in `scripts/build_sf_corridor_3d.py`), right after the region's own lidar heights.
Tests: `tests/test_height_fill.py`.

## Which buildings
Only buildings whose height is a guess are filled: `inferred_default` (a flat 10.5 m), `regional_median_estimate`,
or no height at all (`FILLABLE`). A height a mapper stated, a storey count, the region's lidar, the city's
records and Overture's heights are all kept. Before this change the 8 regions in the repository had 1,588 such
buildings: 647 in the root corridor (the Pier 39 garage among them), 703 in Oakland, 94 in the Mission, and a
few dozen elsewhere.

## The order
| Rank | Source | What it is | Gives |
|---|---|---|---|
| 1 | **City3D** (Huang, Stoter, Peters, Nan 2022; TU Delft) | LoD2 reconstruction: roof planes found in the 3DEP returns inside the footprint, faces chosen by an integer programme (SCIP) | height (model top over the ground at the foot) and roof shape |
| 2 | **3dfier** 1.5.0 (Ledoux et al. 2021; TU Delft) | LoD1.2 block: the roof's 90th percentile over the ground's 10th | height; flat or pitched from the roof's percentile spread |
| 3 | **GlobalBuildingAtlas** (Zhu et al. 2025; TUM) | LoD1 heights estimated from 3 m PlanetScope images; 1.5-8.9 m RMSE by continent | height only |

A reading is used only if it is plausible (`plausible`: 2-330 m, or from 1 m on a footprint under 40 m², a shed
or a kiosk; and no more than 8 times the footprint's width). Otherwise the next source is tried. If no source gives a plausible height, the guess stays.
`height_source` records which source was used: `city3d_lod2`, `3dfier_lod12` or `gba_lod1`. The region
activation counts City3D and 3dfier heights as lidar heights.

## Licences
- City3D and 3dfier are GPL-3.0 programs. They run as separate processes and are never linked into this code.
- 3DEP lidar is public domain.
- **The atlas's heights are CC BY-NC 4.0 (non-commercial).** Every building filled from the atlas carries
  `height_licence` saying so, so those heights can be found and removed if the project needs commercial terms.
- The atlas cut is kept under `data/gba/`, which is gitignored.
- The atlas's polygons are ODbL (taken from OpenStreetMap and Microsoft's footprints).

## Roof shapes
Roofs are added to `sf-corridor-roof-shapes.json` only for buildings with no shape, meaning none from
OpenStreetMap and none from the lidar roof measurer (`scripts/measure_roof_shapes.py`):
- **City3D's** roof is read from its model's upward faces (`city3d_reading`):
  - less than 20% of the roof area pitched → flat;
  - one pitched side → skillion;
  - two opposite sides → gabled;
  - four sides in two opposite pairs → hipped;
  - anything else → complex.
  Gabled, hipped and skillion roofs are published when they rise at least 0.8 m (capped at half the
  building's height). Flat roofs are not published, since the page draws flat already. Complex roofs are
  not published either.
- **3dfier** can only say flat or pitched. A pitched reading is drawn as hipped, which is how the lidar
  measurer draws the pitched roofs it cannot tell apart. This applies only in regions the lidar measurer
  never read: where it has, it has already judged every roof, and published only the hips it trusts.

The roof classes are **not yet checked against photographs**, the way the lidar measurer's hips were
(cloud/docs/roofs-ramps-paint-tests.md). They come from geometry thresholds (`FLAT_DEG`, `SIDE_DEG`,
`PITCHED_SHARE`).

## Trees
The San Francisco (CA_SanFrancisco_1_B23) and Alameda surveys label only ground and "unclassified", so trees
and roofs share a class. Santa Clara's survey labels buildings (class 6) and vegetation separately.
- Where a cell's survey labels buildings, only building returns are used as roofs (`roof_classes`).
- Elsewhere, a 3dfier reading whose roof spreads more than 3 m and more than 60% of its height is rejected
  as canopy.
- City3D is given ground returns only outside the outline. They pin the model's foot, and a yard inside a
  footprint is never read as its roof.

## Running it
```bash
bash scripts/install_building_tools.sh        # ~/.kerbside-tools: 3dfier release, City3D + core OpenCV built
python scripts/fetch_gba_heights.py           # streams 3.6 GB once; keeps 847k buildings, 60 MB
python scripts/fill_building_heights.py sf-corridor oakland-downtown ...   # measure, then patch payloads
python scripts/fill_building_heights.py sf-corridor --roofs --limit 500    # roofs for unshaped buildings too
```
- City3D runs on one building at a time, on returns thinned to one per 0.3 m column (`THIN_M`). It takes
  roughly 1-60 s per building, with a 90 s limit.
- 3dfier runs on a whole 120 m cell in about a second.
- Readings are journalled in `data/regions/<name>/lidar/height_fill.json`, so a run can be resumed.
- `--roofs` on a whole region means City3D on every unshaped building, which takes many hours. Use
  `--limit`, or run it on the cloud.
- The 269 cloud-released regions have not been filled yet. Their payloads live in the bucket, not in
  this repository.
