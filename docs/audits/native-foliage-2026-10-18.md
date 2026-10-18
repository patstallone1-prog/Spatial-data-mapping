# Native foliage hookup — 18 October 2026

Follows `native-relaunch-2026-10-17.md`, whose "explicit remaining native limitation" listed
the UV2 sway export, masked leaf master material, material-parameter collection and native
grass as absent. They now exist in source, build, and import; they are **not yet visually
verified in a running game**, for the reason below.

## What is in place

- `tools/unreal/export_tiles.mjs` writes each plant vertex's sway inputs (UV1 = height
  fraction, plant height m; UV2 = phase, kind 1 tree / 2 shrub / 3 grass), names leaf cards
  `foliage:<kind>`, and writes each tile's lawn grass as clump positions (`grass/*.json`,
  0.9 clumps/m² on upward park/yard faces not under a hard surface; deterministic per tile).
- `KerbsideCelestialSky` writes `MPC_KerbsideFoliage` every frame: `Wind` (toward x, toward y,
  m/s) from its weather, `Walker` (feet, press radius 55 cm).
- `AKerbsideGrassField`: one HISM per tile, no collision, no shadow, culled 48–60 m.
- `tools/unreal/foliage_setup.py`: leaf, needle, palm and litter textures; an 11-blade grass
  clump; `M_KerbsideFoliage` (masked, two-sided, texture × vertex colour × tint, WPO from the
  same law as `docs/foliage-motion.mjs`: 0.22 % of height per m/s, period ∝ 1/√height, leaf
  flutter, grass bend and walker press); a material instance per surface kind.
  `setup_world.py` applies them on import; `KERBSIDE_KEEP_DEFAULT_MAP=1` leaves the default map.
- `-KerbsideShotPose=x,y,z,pitch,yaw` stands the walker somewhere before `-KerbsideShot`.

## Trial import

Lafayette Park tiles `-3:2;-3:3` imported to `/Game/KerbsideRuntime/Maps/City_foliage2_20261018`
(default map unchanged): 170 meshes, 48 static colliders, 12 foliage material slots, 86,364
grass clumps, collision triangle audit passed. Its first launch loaded the map in 189 s on Metal
SM6 and rendered (spawn camera faced the sky; no foliage in frame).

## Why it is not visually verified

The installed project is `~/Documents/Unreal Projects/Kerbside`, and iCloud *Desktop &
Documents* is on. macOS evicted the project's files to iCloud under disk pressure: every
`.uproject`, `.ini`, `.umap` and `.uasset` is `compressed,dataless`. Unreal's reads of them time
out (`ReadFile failed … Error=60: Operation timed out`). The second launch hung an hour in
`LoadMap`, and the third could not open `Kerbside.uproject`. Native work cannot continue until
the project is local again: mark the folder *Keep Downloaded* in Finder, or move the project
out of `Documents` (e.g. onto the HP P700 beside its caches).
