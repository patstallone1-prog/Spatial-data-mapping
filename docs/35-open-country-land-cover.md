# 35 · Open country: classifying it, drawing it, generating it cell by cell

Most of the Bay outside the cities is not forest. It is coastal scrub, grassland, marsh,
beach and bare rock. The hills you cross the Golden Gate toward, the Marin Headlands, are
mostly coyote brush and sage scrub over grass, with a few planted groves in the valleys. This
pass makes the app draw them as that.

Everything here is **inferred visual vegetation**. The class evidence constrains it; no plant
is a surveyed individual.

## What was wrong

Measured from the atlas (`docs/nature/manifest.json`, 40 m cells):

| Place | NLCD 2024 | USFS tree canopy in its scrub cells |
|---|---|---|
| Marin Headlands | 48% shrub/scrub, 21% water, 9% developed low | 21.5% |
| San Bruno Mountain | 51% shrub/scrub | 23.1% |
| Ocean Beach | 44% developed medium, 24% water, 10% barren | — |

The renderer took the tree-canopy percentage at its word and planted trees for it, so the
Headlands were tall eucalyptus and pine scattered over bare khaki ground. The near shrubs fade
out between 234 and 338 m, and only trees had a distant ground pattern, so beyond about 300 m
a scrub hillside had nothing on it at all. Ocean Beach's sand was labelled developed or barren.

## A definitive way to classify the land

The question that separates scrub from forest is **how tall the woody plants are**. NLCD's own
definitions turn on it: forest is trees over 5 m on more than 20% of a cell; shrub/scrub is
woody cover under 5 m. Satellite tree-canopy models can't see height and count tall shrub as
canopy. So the definitive classifier measures height, then names what is there:

1. **Lidar canopy height (USGS 3DEP).** First-return height above the bare-earth DEM, binned by
   NLCD's own thresholds: over 5 m is tree, 0.5 to 5 m is shrub, under 0.5 m is herb or bare.
   This settles tree versus shrub everywhere the Bay has lidar. `src/smc/lidar/canopy.py`
   already builds the canopy height model per region; the step left is to tile it to the atlas.
2. **Fine-scale vegetation maps, for what the shrubs and grasses are:**
   - Marin County's fine-scale vegetation map (One Tam, mapped from lidar and aerial imagery to
     the alliance level: coyote brush, coastal sage, chaparral, annual grassland, coastal prairie).
   - Comparable county and park maps elsewhere.
   - The state's VegCAMP layers.
   These set the species mix and each alliance's cover statistics.
3. **ESA WorldCover 10 m** (shrubland, grassland, bare/sparse, wetland), where neither of the
   first two exists, three times NLCD's resolution.
4. **NAIP 0.6 m imagery** (greenness and texture) to sharpen edges inside a cell: the line
   between a scrub slope and a grass saddle, a beach and the dune behind it.
5. **OSM `natural=*` polygons** for beaches, dunes, rock and scree, as mapped edges.
6. **NLCD 2024 plus USFS tree canopy** as the fallback everywhere, which is what the app had.

Each cell keeps which source decided it, and how sure that source is, so a later, better source
replaces a worse one without guesswork.

**Shipped now** (no new download): NLCD's class definitions applied as hard bounds on the
fallback. A cell NLCD calls scrub or grass cannot be mostly trees, or it would be forest. So
`treeShare` keeps 15% of its satellite canopy as trees in scrub and 50% in grass, and gives the
rest to shrubs. Forest keeps all of it.

## Renders for each kind of land

- **Scrub (NLCD 52):** near-continuous shrub. Near: coyote brush, California sagebrush and
  toyon meshes up to 2.6 m across. Past 234–338 m: a ground-shader layer of shrub crowns at the
  class's cover. Each 3 m crown is brush or sage, shaded lit on top and dark between, and
  averages smoothly once a crown is under a pixel.
- **Grass (71, 81, 82):** herb ground with sparse shrubs (about 6%); dry annual grass keeps its
  golden floor colour.
- **Beach:** sand where a beach is mapped, and also where NLCD says barren (31: under 15%
  vegetation) within 100 m of the coastline and under 12 m up (`beachAt`). No shrubs on sand.
- **Barren and rock (31):** about 3% shrubs; rocks only on steep barren ground or mapped rock.
- **Desert:** the Bay has none. The same table takes a desert scrub alliance (sparse, low,
  widely spaced shrubs over bare ground) as one more row, with no code change.

## Cell by cell, matched to statistics

`COVER_STATS` (`docs/nature-ecology.mjs`) gives each NLCD class a mean and range for tree,
shrub and herb cover, plus the shrubs' heights and crown radii. The bounds are NLCD's
definitions; the means follow the Bay Area alliances the CNPS Manual of California Vegetation
describes. Coyote brush and coastal sage scrub, for example, have 30 to 90% shrub cover, 0.5 to
3 m tall.

Generation is deterministic and needs no stored layout (`scrubAt`):

1. Each 4 m slot (16 m²) may hold one shrub. The crown radius comes from the class's range,
   seeded by the slot's position.
2. The shrub is there with probability `target × 16 / (π r²)`. Over a cell, the expected crown
   cover then equals the target.
3. In a thicket, where one crown can't cover enough, the crown grows (clumps run together) up
   to a fifth past the widest single crown.
4. The target swings with a 60 m patch field whose mean is one. That gives thickets and glades
   without moving the cell's total.

The same rule feeds the near meshes and the distant shader (the shrub texture is the same
target, per atlas cell), so near and far agree.

Measured on a 2 km square (`tests/test_nature_ecology.py`):

| Class | Target shrub cover | Realised | 40 m cells, 10th–90th percentile |
|---|---|---|---|
| Scrub, canopy 21% (Headlands) | 0.763 | 0.735 | 0.50–0.96 |
| Scrub, canopy 0 | 0.620 | 0.603 | 0.40–0.79 |
| Grass | 0.080 | 0.078 | 0.05–0.11 |
| Barren | 0.030 | 0.029 | 0.02–0.04 |

When lidar heights and the fine-scale maps arrive, they change the targets per cell (measured
shrub cover, the alliance's own heights and species). The generator stays as it is.

## Still open

- The cell-by-cell targets are class priors until the lidar canopy-height tiles are built.
- Grass colour does not follow the season (green in spring, gold by summer).
- Marsh (95) is drawn as green herb ground; pickleweed and cordgrass have their own colours.
