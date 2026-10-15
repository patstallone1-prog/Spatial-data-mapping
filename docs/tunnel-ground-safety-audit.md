# Tunnel and fence ground-safety pass

## Scope

The authoritative app renderer is `scripts/build_sf_corridor_3d.py:HTML`.
All eight app viewers are regenerated from it; `runtime-release.json` and the
service-worker fingerprint identify the same release. Frozen website viewers,
canonical terrain/road/building datasets and native Unreal source are unchanged.

This is a rendered-world consistency pass, **not an independent survey of tunnel
dimensions, bridge clearances, retaining structures or fence locations**. The
immersed-tube vertical profiles and unmeasured approaches remain explicitly inferred.

## Root causes and corrections

- The walker selected the lowest surface at an XY coordinate, even when standing
  on the street above a bore. Occupied-height selection now distinguishes the
  upper street, lower approach, bore road and raised side walkway. Substepped
  movement enforces bore sides and portal transitions. Orbit cameras and ground
  picking respect the lining instead of reaching through it.
- Generic portal/maintenance buildings spawned house doors, floors and footprint
  collision across the tube. Their records remain intact; inferred residential
  features no longer occupy an actual bore or approach passage.
- Strict clipping planes on every short centreline segment left triangular
  uncut terrain wedges at bends. Clipping now bounds the whole bore at its two
  portals and uses clamped segment projections. All ground and street classes,
  including neutral parcel paving and tactile panels, receive the void cut.
  The lining has a separate outer shell and base. Canonical geometry is not edited.
- Cut-road height deltas were interpolated before subdivision and terrain was
  sampled again afterward. Approach and bridge profiles now survive merging and
  tiling and are evaluated after subdivision. Wide underlays and late corner
  covers no longer climb the retaining-wall boundary as white concrete teeth.
  Upper cross-street decks retain their separate level.
- Regions without SF-specific mouth levels lacked approach cuts. Local endpoint
  tangents and explicitly inferred graded approaches now connect those bores to
  the terrain. Inferred retaining caps follow a smooth upper envelope without
  lowering terrain evidence.
- Inferred overpass parapets/undersides used long endpoint chords even after the
  road profile was raised. They now sample the same interior profile, with piers
  kept away from lower roads. Abutments remain fixed. This does **not** establish
  a surveyed or universally achieved 4.8 m vehicle clearance.
- Released regions retained disposed bore references. Host and guest release
  now clear them, avoiding stale picking and collision after a region switch.
- Discrete GPS arrivals now select the destination surface explicitly, rather
  than inheriting the departure point's underground level. Continuous walking
  still retains its occupied level through a bore.
- Property, court and park/playground enclosure panels now sample ground at
  intervals of at most 0.75 m (about 2.5 ft). Bases overlap the ground by 35 mm;
  panel tops retain their intended height. Already-grounded panels cannot receive
  a second terrain lift.

No mesh decimation or detail-LOD reduction was used. The 4 mm simplification tolerance is
only for the shader's clipping lookup, not for the rendered tunnel mesh.

## Reproduction and checks

From the repository root, run `tools/tunnel_ground_preview.py` with:

| Region | OSM way | Fixture |
| --- | --- | --- |
| oakland-downtown | 22272045 | Posey Tube |
| oakland-downtown | 25966237 | Webster Street Tube |
| oakland-downtown | 75611235 | curved 11th Street underpass |
| sf-corridor | 417099350 | Stockton tunnel |
| sf-corridor | 8921175 | both Broadway bores |

Serve the repository root and open the printed fixture path. The visible panel
offers entrance, middle, exit, third-person and fence views, plus forward/reverse
whole-bore walking. Embedded JSON reports floor/ceiling ray checks, side escapes,
surface-above selection, portal transitions, fence-base agreement and sampled
unclipped fragments in pedestrian headroom. The obstruction probe is separate
from the floor check: a correct floor can still have a slab above it.

`tests/test_tunnel_ground_safety.py` adds 26 focused regressions. The selected
tunnel, walking/interior, terrain, bridge, movement and curb-width suites passed
201 tests locally, plus seven release-sync/recovery tests. Existing isolated
explore/GPS/gate harnesses also load their new dependencies and check actual
indexed fence panels; the cross-region check retains occupied-level semantics.
Extracted app JavaScript also passes Node syntax validation;
new/changed test and preview-tool Python passes Ruff. Full required CI remains
the release gate; it is not replaced by these local checks.

The committed `data/benchmarks/tunnel-ground-safety-v1.json` records the real-data
browser audit at geometry-pass commit `cbe3abfe` (before the GPS-only follow-up):
six bores, 1,468 stations, twelve forward/reverse routes, zero
route failures or sampled headroom fragments, and portal transition differences
below 7 mm in the digital model. These are not real-world accuracy claims. Screenshots
and raw diagnostic reports are generated under
`build/audits/tunnel-ground-safety/` (not deployment assets). Fence numerical
agreement is with the renderer's terrain sampler, not with independent lidar
checkpoints. These checks cannot prove the absence of every possible world fault.
