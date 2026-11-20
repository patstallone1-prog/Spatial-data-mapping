# 51 · Near-ring people and surfaces

Three rings of detail, now with a photoreal near ring:

| Ring | People | Surfaces |
| --- | --- | --- |
| Near (FULL tier, the 16 nearest who walk, stand or jog) | Unreal characters, skinned and animated | Photo texture + normal map for asphalt, concrete, wood, painted wood, full strength to 32 m and gone by 58 m |
| Medium (the rest of FULL, plus MODERATE) | The jointed figures drawn before this change | As before |
| Far (LOW) | Two-part basic shapes | As before |

People who ride, lie down, gesture or fall keep the jointed figure. Until the Unreal models load, or
if they fail to load, every ring draws exactly what it drew before.

## People (`docs/city/npc-figures.mjs`)

- **Women:** Epic's MetaHuman *Ada*: body at LOD1, face at LOD1, outfit at LOD3, LOD3 hair cards.
  Ada is the only MetaHuman in the Unreal project that has been assembled.
- **Men and children:** the UE5 mannequin (Manny at LOD2), with a banded material
  (trousers, shirt, skin) that takes each person's colours.
- **Clips:** the mannequin's unarmed idle, walk and jog. On Ada they are retargeted in world space
  (`retarget`). Twist and corrective bones turn with the limb they are named for, and the fingers
  keep their rest pose. The clip is chosen by speed, and the playback rate follows the stride.
- **Dressing:** each person keeps the uniform, trousers, hair and skin they already have, as tints
  on the textures.

### Building the models

The models are Epic content, and this repo is public, so `docs/city/models/npc/` is gitignored.
Build them locally from the Unreal project (UE 5.8, `Kerbside.uproject`, on the HP drive):

```bash
KERBSIDE_NPC_OUT=/path/to/out UnrealEditor Kerbside.uproject -run=pythonscript \
  -script=tools/unreal/export_npc_characters.py -nullrhi -unattended
node tools/build_npc_characters.mjs /path/to/out docs/city/models/npc
python tools/publish_npc_characters.py docs/city/models/npc --store s3://<public bucket>
```

**Exporter bug:** Unreal's glTF exporter writes MetaHuman skin weights as uint8 holding the low
bytes of 16-bit weights, and pads unused slots with one bone (foot_r). Animated, this tears the
hands and feet. `reweight()` in the build tool keeps Unreal's list of bones for each vertex and
weights them again by the vertex's distance from each bone segment. A listed bone far beyond the
nearest gets nothing.

The page reads the models from the public store: `/store/npc/current.json` names the build, and
the files sit under `/store/npc/<build>/`. Build 95c2da3cb91d was published on 2026-11-19, with
the owner's OK. Without a build in the store, the page falls back to a local
`docs/city/models/npc/`.

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
