# Forest floor, far forest, globe and teleport map — 18 October 2026

## Forest floor (docs/forest-floor.mjs)
- Within 58 m of the walker, in 12 m cells built nearest-first, out of view from above 60 m:
  - Poly Haven CC0 scans (`docs/nature/models`): a fern, four shrubs, sorrel, a weed, nettle,
    dandelion, dry branches, a stump, a fallen trunk and mossy rocks. Each understorey kind maps
    to a scan; sedge and bunchgrass are drawn as wild grass.
  - Long wild grass in four kinds (wild oat with seed heads, needlegrass, forest grass, sedge),
    filling the gaps between bushes. Mown lawns are excluded.
  - Leaves, needles and bark, twigs and clods. Each is drawn from its own slot's seed, with a
    chance that rises with forest cover and under a crown. In a dense wood that is about 21
    leaves/m² in the open and 32/m² under crowns (tests/test_forest_floor.py).
- Detail falls off with distance:
  - Within 20 m the full scans and grass are drawn; beyond that, the scans' light versions.
  - Leaves fade out between 26 and 34 m; twigs and clods by 42 m.
  - Over 46–55 m the landscape's own plants fade in.
- Middle distance:
  - The light scans are drawn to 185 m and the cut-out cards past that.
  - Wild grass is drawn to 185 m.
  - The understorey is 1.8× denser.
  - The old stamped litter patches and sticks are gone.
- Everything here is inferred from habitat priors. None of it was observed.

## Far forest
Past 650 m the ground under the canopy is shaded as crowns, from the observed canopy fraction:
lit tops, shaded gaps and stands of one tone. The pattern fades to its average only once a
crown is smaller than a pixel.

## Globe (docs/globe.mjs)
- Zooming out goes to 18,000 km.
- The Earth is drawn as Natural Earth 1:50m land and lakes (`docs/world/land-mask.png`, public
  domain), as grass and water.
- The globe is flattened into a disc 30 m under the atlas, so the Bay keeps its single datum.
- The far plane reaches past the horizon, and the fog draws back with altitude.
- Above 100 km the sky is space, with an atmosphere rim visible from outside it.

## Teleport map (docs/teleport-map.mjs)
- A click, search or region hop of more than 700 m plays a trip of about 7 s:
  1. The view pulls away to black.
  2. A flat map of the atlas's land and water appears, scaled to the hop.
  3. A blue dot hops along a half-circle and lands.
  4. The map closes in on the landing and fades back into the world.
- The walker moves behind the black.
- The map waits after landing (at most 15 s from the click) until the world cells are loaded and
  the plants within 220 m are standing.

## Checked
Headless Chrome on the Sunset app page:
- the teleport to Mount Sutro;
- the ground at 5, 9 and 30 m;
- the middle distance at 250 m;
- the far view at 2.5 km;
- the globe at 60 km, 600 km and 15,000 km.
