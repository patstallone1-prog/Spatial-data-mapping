# 51 · Near-ring people and surfaces

Three rings of detail, now with a photoreal near ring:

| Ring | People | Surfaces |
| --- | --- | --- |
| Near (everyone FIGURE_MIN_PX tall on screen, or near you, up to 80) | MakeHuman people, instanced and skinned on the GPU (docs/55) | Photo texture + normal map for asphalt, concrete, wood, painted wood, full strength to 32 m and gone by 58 m |
| Medium (the rest of FULL, plus MODERATE) | The jointed figures drawn before this change | As before |
| Far (LOW) | Two-part basic shapes | As before |

People who ride, lie down, gesture or fall keep the jointed figure. Until the near-ring models load, or
if they fail to load, every ring draws exactly what it drew before.

## People (`docs/city/npc-figures.mjs`)

**Replaced on 2026-11-21.** The Unreal characters (MetaHuman Ada and the UE5 mannequin), their
exporter (`tools/unreal/export_npc_characters.py`), their packer (`tools/build_npc_characters.mjs`)
and their publisher (`tools/publish_npc_characters.py`) have been removed. The near ring is now
MakeHuman people, drawn as an instanced crowd: see
[55 · The MakeHuman crowd](55-makehuman-crowd.md). The old build is still in the store under
`/store/npc/`, but nothing reads it.

## Surfaces (`NEAR_SURFACE`, page module 02)

- **One reference per material:** a CC0 photo and normal map for each kind, in
  `docs/textures/near/` (ambientCG Asphalt031, Concrete047A, Planks037A, PaintedWood009C).
- **Scaling:** every surface of that kind samples the same reference in world-space planar
  coordinates, in metres (`tile_m`). A second, rotated sample hides the repeat.
- **Blending:** the photo is divided by its own mean, so a surface keeps its existing colour and
  gains the photo's grain and relief.
- **Marking:** a material gets a kind through its texture (`NEAR_SURFACE.mark(texture, kind)`) or
  through `material.userData.nearSurface`. Marked so far:
  - roads and dividers;
  - sidewalks;
  - wood paths and boardwalks;
  - concrete, painted and wood facades.
- **Distance:** the shader samples only within the near ring. Beyond 58 m it costs a uniform test.
