# 55 · The MakeHuman crowd

The people nearest you are now MakeHuman people, drawn as an instanced crowd. They replace the
Unreal characters (MetaHuman Ada and the UE5 mannequin) of [51](51-near-ring-people-and-surfaces.md).
Those characters and their pipeline have been removed. Who is drawn this way is unchanged: anyone
in view at least `FIGURE_MIN_PX` tall on the screen, or within `FIGURE_NEAR_YOU_M` of you
(`figurePlan`). Up to 80 people are drawn at once. Further off are the jointed figures, and past
them the basic shapes.

## What a person is made of

There are two bodies: MakeHuman's low-poly proxies `male1591` and `female1605`, about 3,100
triangles each. On a body go parts from MakeHuman's CC0 library, each cut down to a crowd's
triangle budget:

| Slot | Parts | Triangles each |
| --- | --- | --- |
| top, bottom | 8 men's suits, 4 women's, each split into its top and its bottom | 1,300 |
| shoes | shoes01–06 | 420 |
| hair | short01–04, bob02, long01, ponytail01, braid01, afro01 | ≤ 1,800 |
| facial hair (men) | rehmanpolanski's viking beard and moustache | 1,200 / 600 |
| hat | fedora01 | 500 |
| eyebrows, eyes | eyebrow001/006, low-poly eyes | ~190 |

A person is roughly 8,000 triangles. 80 people is about 650,000 triangles.

**Splitting suits:** each suit is split at the waist by mesh piece. A shirt's hem stays with the
shirt. One-piece garments, like overalls, are cut by height. This means any top can go with any
bottom: 8 × 8 combinations for men and 4 × 4 for women.

**Hidden skin:** the skin under clothes is not drawn. Each part's delete group on the body becomes
a bit of the body's `_cover` attribute. A person's parts make a mask, and the skin under the mask
is pulled in and cut away.

## Who wears what (`crowdLook`)

Every choice comes from who the person is (view.mjs `lookOf`, which reads `wardrobe.mjs`
`dressFor`), seeded by their id, so it is the same every time:

- **Garment:**
  - a suit or a button-up → the elegant suit;
  - hi-vis, a work jacket, a chef's whites or scrubs → the work suit;
  - running gear → the sports suit;
  - anything else → any of the casual suits.
- **Colours:** the top and the bottom take the wardrobe's colours, and the shoes take its shoe
  colour. Each garment's fabric light and dark is baked per vertex as `_shade`.
- **Hair, from the wardrobe's cut:**
  - long → long, ponytail, braid or bob;
  - collar → bob, short02 or afro;
  - short → the short styles;
  - bald → none.
  - Curls are more common for people of Black heritage.
  - The hair colour also goes to the eyebrows and the beard.
- **Facial hair:** 12% of men have a beard and 9% a moustache.
- **Hats:** 6% wear a fedora, more over 45. Under a hat the hair is short.
- **Skin:** MakeHuman's young and old skin photographs, toned to the person's own skin, and mixed
  by age.
- **Body:** the city's height for the person, and its build mapped to the weight morph (thinner to
  heavier). Muscle and age are morphs too. The morphs were recorded in Blender for the body and
  every part, so clothes follow the body.

## Drawing

- **Draw calls:** each part is one `InstancedBufferGeometry` with room for 80 people, and one draw
  for everyone wearing it. A street of 24 people takes about 50 draws and 5 shader programs.
- **Skinning on the GPU:** the clips (Idle, Walk, Run) are baked once at load into a float texture
  per body, at 30 frames a second, three texels per bone. That takes about 50 ms.
- **Per-person animation:**
  - Each person has a frame, the next frame, and a blend of the two.
  - A change of clip is cross-faded over 0.3 s.
  - The playback rate follows the person's pace.
- **No per-person objects:** there are no clones, mixers or material copies. Each frame refills
  the instance buffers with whoever is drawn.
- **Idle pose:** the Soldier's own idle is a soldier's ready stance. The idle a pedestrian stands
  in is the walk's passing step (feet together, arms down), turned upright. On top of it go the
  idle's own small movements.
- **Shaders:** at load, one instance of every part is drawn below the ground, so every shader is
  compiled before anyone needs it. The proxy light (`__kerbsideProxyLight.patch`) applies as on
  the other materials.

## Building and publishing

The build runs in headless Blender with MPFB 2. The Soldier's clips come from three.js's
`Soldier.glb`, retargeted by `tools/avatars/build_makehuman_avatars.py retarget`.

```bash
~/Applications/Blender.app/Contents/MacOS/Blender -b --python tools/avatars/build_crowd_people.py -- \
  --out /path/to/crowd --soldier /path/to/Soldier.glb
python tools/avatars/publish_crowd_people.py /path/to/crowd --store s3://<public bucket>
```

The build comes to about 7.7 MB:

- `male.glb` and `female.glb`;
- the skins as JPEG;
- the hair, brow and eye textures as PNG with alpha.

**Where the page reads it:** a publish puts each build under `/store/crowd/<stamp>/`, then
writes `/store/crowd/current.json`. The page finds that folder beside the store's `npc/` folder.
Without a published build, the page reads `docs/city/models/crowd/` (gitignored, for local
checks). Without either, the jointed figures stand in.

## Checking

- **Unit tests:**
  - `tests/city_npc_figures.test.mjs`: looks are the same every time, a crowd has variety, and
    the garment and cut rules hold.
  - `tests/city_near_figures_plan.test.mjs`: who is drawn.
  - `tests/test_crowd_people_publish.py`: what a build holds, and that a publish is whole.
- **In a browser:** `docs/city/crowd-sheet.html` draws a crowd dressed by the real wardrobe.
  - Parameters: `?n=40&view=front|row|side|close&walk=0.5&run=1`.
  - The title reports people drawn, draw calls, triangles, programs and bake time.

## Later

- **Level of detail:** dynamic polygon counts for fine detail up close.
- **More clips:** carrying, a telephone and talking. People doing those still get the jointed
  figure.
- **More assets:** more suits, especially skirts and dresses for women, and more hats.
