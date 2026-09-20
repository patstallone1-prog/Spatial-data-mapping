# Ingestion at scale: regions, capabilities, and the ladder

The corridor was built by a dozen scripts run by hand in an order one person knew. Scaling
across San Francisco and the Bay Area means the order is code, a region is a line of data,
and what a region can know about itself is found by asking the sources -- never assumed.

## A region is data

`data/regions/regions.json` lists every region: a name, a bounding box, a city, a sentence.
The corridor stays where it is (`docs/`); every other region lives under
`data/regions/<name>/` with its own capability vector, journal, audit baseline and site.
A box can also be cut into cells (`scripts/ingest_region.py --grid S,W,N,E --cell-km 2.5
--prefix sf`), each cell registered as a region of its own: the unit the Bay Area is built in.

## Discovery: the capability vector

`scripts/discover_region.py <name>` probes the sources with the region's box and writes
`capabilities.json`:

| probe | what it asks | what it records |
|---|---|---|
| OpenStreetMap | Overpass `out count` for highway ways and buildings | counts |
| USGS 3DEP | the public Entwine index of every collection's boundary | collections covering the box, coverage share, newest first |
| Mapillary / Panoramax | images at the centre of the box | available, how many seen |
| municipal records | which city the box lies in | the adapters that apply (San Francisco: 11 record types; elsewhere: none) |

From those, one word per property for where its facts will come from -- the top rung the
region reaches:

```
kerbs            official | lidar | none
sidewalk_width   official | lidar | osm
kerb_height      lidar | imagery | none
terrain          lidar | none
building_height  lidar | osm
building_colour  imagery | none
parking          official | imagery | none
curb_ramps       official | osm
signs, crossings official | osm
```

Downtown Oakland, probed: 4,295 highway ways, 3,096 buildings, lidar `CA_AlamedaCo_2_2021`
covering the whole box, Mapillary present, no municipal records. Kerbs from the lidar,
parking from imagery, ramps and signs from the map. The Mission: the same lidar the corridor
used, and the city's records for everything the corridor has.

## The stages, journalled

`scripts/ingest_region.py <name>` runs, in order, skipping what is done:

1. `discover` -- above.
2. `osm` -- the builder's own fetch, standalone, with the guard that refuses an Overpass
   answer with too few elements (one such answer once built an empty world).
3. `terrain` -- `build_terrain.py --region`, on the collection discovery found; the roadway
   accuracy class uses the city's centrelines where it has them and the region's own OSM
   streets otherwise.
4. `imagery` -- `harvest_region_observations.py` for the box.
5. `official` -- `build_sf_official_geometry.py --region`; exits at once outside San Francisco.
6. `build` -- `build_sf_corridor_3d.py --region`: the page and its sidecars under the region's
   `site/`. Without a catalogue it builds from the map and the lidar and draws every building;
   without kerb profiles every cross-section's kerbs come from the mapped width or a class
   prior, graded inferred (`smc.facts.build_cross_sections.prior_width_m`).
7. `audit` -- the render audit over the region's payload, written as its first baseline.

Every stage's command, start, end, exit code and outputs go to `ingest.json`; its output to
`ingest.log`. A run that stops resumes at the stage that did not finish.

## What dropping a rung looks like

Downtown Oakland's first build, from OSM and the lidar alone: 9,152 ways, 3,066 buildings all
drawn (heights from OSM levels for 570, the default for the rest), 1,412 of 1,752 streets
with cross-sections -- 81% of stations resolved on class priors, none on a measured kerb --
and the page says which. That is the point: a city with a weaker capability vector builds
to a lower-confidence map rather than failing, and the vector is the honest label on it.

## Not yet

- Municipal adapters for cities other than San Francisco (Oakland and Berkeley publish some
  of the same records; each needs its own extractor and its own acceptance test).
- H3 cells as the unit of *incremental* rebuild (changed cells and neighbours); today a
  region rebuilds whole.
- Publishing region sites under `docs/regions/<name>/` -- the site is built; the deploy copy
  is a one-line addition to `tools/build_pages.py` once a region is worth showing.
