# 3D grass, real glass, no random drops

## Grass (`docs/grass-strands.mjs`, `docs/foliage-motion.mjs`)

**Blades.** Near the walker (14 m), grass is drawn as tufts of 1–3 blades.
- Each blade is folded along its midrib into a shallow V and curves over.
- A blade has 7 points and 6 triangles.

**Colour.** The strand colours are kept: `GRASS_STRANDS` mixes green 68%, new growth 14%, straw 12% and dark 6%. Each blade varies a little in hue, saturation and lightness within its strand.

**Length.**
- Every blade's length is scattered on its own (`bladeLength`).
- On top of that, a gentle patch field about 1.6 m across (`patchLength`) makes some areas longer and some shorter, ±18%.

**Underfoot.**
- The ground you stand on is the drawn soil. The grass is only drawn, so a foot never sinks; the blades bend under it.
- The press-underfoot shader now takes the walker plus the 6 nearest people (`uFeet`, from `__kerbsideFeet` in the city view). Others' feet press the grass too.

**Not on paths.** No blades grow on a mapped path drawn over a lawn (`pathTreadAt`).

## Glass (module 02 `realGlass`)

`realGlass` is one shader patch shared by every glass in the world:
- house panes (inside and out);
- entry doors;
- shelters;
- storefronts;
- shop interiors;
- cars;
- the storefront renderer.

| | |
|---|---|
| Opacity | 0.05 face-on, rising to 0.65 at grazing angles (Fresnel exponent 4.5). Storefront privacy glass and cars start higher. |
| Highlight | Roughness 0.05; the sun's direct specular ×4, for sharp glints from the moving sun. |
| Reflection | A static 64 px procedural cube map (sky, a band of buildings, street), sampled along the reflection vector × Fresnel and added as emitted light. |
| Night | The page's `kbNight` scalar dims the reflection (0.9 by day, 0.12 at night). |
| Surface | A faint large-scale ripple normal (1.1 m); grime toward a pane's edges. |
| Off | Shadows are not cast, and there is no transmission or refraction. |

All the numbers are in `GLASS`. The tests are in `tests/glass_look.test.mjs`; they compile the shader alongside the night-window patch.

## Item drops (`docs/city/rules.json` `found.per_district = 0`)

- The city seeds nothing on the pavements any more: no stray soda cans.
- What is left to pick up:
  - tasks' things (courier pickups);
  - what people put down;
  - a crash's debris.
