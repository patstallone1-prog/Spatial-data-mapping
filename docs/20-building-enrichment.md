# Building Enrichment

`scripts/build_building_enrichment.py` creates the compact metadata layer consumed by the SF
3D page at `data/sf_building_enrichment/buildings.json`.

The layer is deliberately source-separated:

- OSM tags seed stable building IDs, addresses, building tags, and simple business hints.
- DataSF parcel records add parcel IDs, address ranges, zoning, planning district, and
  neighborhood for every matched footprint.
- DataSF building footprints (`ynuv-fyni`) add lidar-derived median heights
  (`hgt_median_m`) when the city footprint safely matches the renderer footprint.
- Overture buildings can add height/floor/building-part hints when DuckDB is installed.
- Google Places can add business names, formatted addresses, primary place type, and place IDs,
  but only behind an explicit request limit. Those fields carry `expires_at`; keep the place ID
  as the durable join key.

Example:

```bash
.venv/bin/python scripts/build_building_enrichment.py --google-limit 25 --overture-limit 5000
.venv/bin/python scripts/build_sf_corridor_3d.py --reuse-osm
```

The renderer currently has scalable archetypes for `gas_station`, `park`, `mini_golf`, and
`parking`, and shows building/place metadata when clicking an enriched building. Other classes
still fall back to ordinary extruded massing until their archetype models are added.

Height priority is conservative:

1. DataSF lidar median height (`datasf_lidar_median_height`).
2. Explicit OSM `height`.
3. Overture `height`.
4. OSM or Overture floor/level estimates.
5. Renderer default height, flagged as `inferred_default`.

Google Places is not used for building height. It can name businesses and place types,
but it does not provide roof height or measured geometry.
