# CV/Depth Storage

This layer is the bridge from photos to simulation geometry.

It stores three different things separately:

- `depth/observations/depth_index.parquet`: one row per eligible observation,
  with slots for metric depth, segmentation, and point-cloud artifact URIs.
- `depth/surfaces/surface_measurements.parquet`: simulation surfaces across the
  corridor, including curbs, sidewalks, crossings, and facades.
- `depth/stats/summary.json`: measured-vs-inferred counts for product and
  simulation gating.

## Provenance

Surface rows use three provenance states:

- `measured`: produced from metric-depth planes or another metric survey source.
- `inferred`: useful for simulation, but not a measured real-world claim.
- `needs_depth`: geometry exists as an OSM/coverage seed, but needs metric depth
  before it can carry exact curb or sidewalk values.

The current SF build has `0` measured curb heights. That is correct: current
inputs include observation metadata and OSM geometry, not depth maps, semantic
segmentation, or fused point clouds.

## Promotion Path

When a metric point cloud exists, the pipeline should:

1. Segment road, curb, sidewalk, facade, and obstruction pixels.
2. Project depth into a metric local frame.
3. Fit road and sidewalk planes with `smc.measure.extract.measure_cross_section`.
4. Promote the result with
   `smc.depth.surfaces.measured_surface_rows_from_cross_section`.
5. Fuse repeated independent rows into served facts with confidence and
   corroboration gates.

This keeps simulations immediately usable while preventing inferred defaults
from being sold as measured geometry.

