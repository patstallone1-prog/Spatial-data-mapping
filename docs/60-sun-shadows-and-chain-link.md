# Sun shadows near you, the sun's glint, and chain link

## Fine shadows (`docs/fine-shadows.mjs`)

The stand-in light (`docs/proxy-light.mjs`, doc 49) traces shadows through a map of heights seen
from above. A texel there is metres, so a person, a post or a kerb's edge is smaller than one,
and people and cars had a round blob under them instead.

Near you the square is now drawn from the sun's side, 112 m across at 5.5 cm a texel. A point
is in shadow when something stands between it and the sun, whichever way its surface faces: a
person's shadow is their own outline, and it runs across the pavement and up a wall.

- **Two maps of the same square.** What stands still is listed once (`casters`), cut to the
  sun's box and drawn `frame_tris` triangles a frame until the map is whole, then swapped in.
  It is drawn again when you have walked 10 m, the sun has moved 0.2 degrees, or streets have
  arrived. What moves (the city's people and cars, you) is drawn every frame.
- **The ground does not cast** (`GROUND`). Terrain lies under roads and underlays under walks,
  cut away in the picture by their shaders; drawn whole from the sun's side they shaded the
  surface above them (everything read as shadow until this was found). Kerbs do cast.
- **Wires, glows, paint, glass and chain-link fabric do not cast** (`castsNothing`,
  `userData.noShadow`).
- **No three.js shadow is switched on.** The sun light casts none, so no light count changes
  and no shader recompiles (the cause of the freezes found on 2026-11-22).
- The shader takes the nearer of the two maps, four texels about the point
  (`PROXY_LIGHT.patch`, module 02), and fades to the stand-in's shadow at the square's edge.
  Below 5 degrees of sun the fine shadows are off; the round blobs stay at night and far off.

Measured in Kerbside.app (Marina, 345 people, 529 vehicles): about 3.9 M triangles for the
still map over 5 frames, 0.8-1.4 ms of CPU in its worst frame, 1.0-1.4 ms a frame for what
moves, 60 fps with it on and off. `kerbsideFineShadows().stats()`.

## The sun's glint

Plain light (module 02) lights matt surfaces without the standard material's highlight. One
lobe is put back for the one sun, at the surface's own roughness, with the 4% a non-metal
mirrors head on and Fresnel's rise at a glancing angle, and it is cut by the shadow. Tarmac
glares towards a low sun; a wall seen square on does not.

## Chain link (`chainlinkMaterial`, module 17)

The fabric was a picture of wires on a sheet: no thickness, and nothing at all edge-on. The
wires are now worked out in the shader in the world's metres -- 50 mm diamonds, 4.8 mm wire in
black vinyl, a knuckle where two wires hook -- shaded round, and never drawn thinner than a
pixel, so along the fence the gaps close up as a real one's do. Property fences have posts
every 2.8 m, a top rail and a wire along the foot, all real geometry that casts.

## Not done

- Car paint has no gloss of its own beyond what its material already had.
- The fabric of a chain-link fence casts no shadow (only its posts, rails and gate frames).
- Roughness values were not re-surveyed material by material; the glint uses what each has.

## Each material's own reflectance, car paint, and skin (2026-11-23)

**Materials.** The sun's highlight used every surface's drawn roughness and one figure, 4%, for
what any of them mirrors. Each material in `docs/object-catalogue.json` now has `optics`:
`roughness` (0 a mirror, 1 chalk), `specular` (the share mirrored head on, from the refractive
index, or the bare metal's) and `albedo` (the share of daylight scattered back; for reference
only, the drawn colour is still the texture's). `docs/reflectance.mjs` reads a mesh's
`userData.surface`, finds its material, and sets one uniform on the mesh's material (`kbSOpt`),
so no shader is compiled again. `window.kerbsideReflectance()` says how many materials were
given figures and of what. Published values for the material as it stands on a street, not
measurements of these objects. A material whose shader hook calls `PROXY_LIGHT.patch(shader)`
without itself keeps the drawn roughness and 4%.

**Car paint.** Paint has a clear coat (`KB_GLOSS`, roughness 0.2, 5% head on): a tight glint of
the sun, and on the traffic's plain paint the sky mirrored along a panel seen at a glancing
angle. The full material (your own car) already mirrors the sky. Car glass is unchanged.

**Skin.** Each heritage has one anchor tone and a range about it (`wardrobe.mjs` `SKIN_ANCHORS`,
`skinTone`); a person is drawn somewhere in their heritage's range. The anchors' brightness is
skin's measured reflectance, not a swatch picked by eye. No tone is over 0.40 relative
luminance, and the crowd's shader holds what it draws to 0.44. The shader now takes the
person's tone and only the photograph's light and dark about its average (within 0.5 to 1.3):
before, the tone was divided by the photograph's average and multiplied back by the photograph,
which went to white wherever the two did not cancel.

**The pale see-through walker.** The "ghost" was the magic camera's outline of you (module 32):
when something stood between you and the view it drew all of you again in pale blue, over
everything, so the whole walker went pale and see-through, and the profile's portrait took it
as your face. It is now drawn only where you are actually hidden (`GreaterDepth`), fainter, and
is switched off while the portrait is taken.

## What a surface scatters back (2026-11-23)

**Albedo.** Each material's `optics` now has `albedo` and `albedo_range` for visible light
(asphalt 0.05-0.15, grass 0.06-0.16, concrete 0.22-0.45; a painted material's range is paint's,
black to white). `docs/reflectance.mjs` works out what each drawn material scatters back (its
colour times its picture's average, as light) and multiplies the colour into the range where it
is outside it (`tintFor`, never by more than four times). In the Marina 1,470 materials were
tinted, 717 were already in range and 682 could not be told (a colour for each point or
instance, or see-through). Roads were drawn at about 0.29 and are now about 0.15.
`window.kerbsideReflectance().tints` lists what was changed. `material.userData.keepColour`
leaves a material alone.

**Scatter.** A plain-lit rough surface is no longer evenly matt: Oren and Nayar's rough diffuse
(Fujii's form), by the surface's own roughness, so asphalt and stucco are brighter from the
sun's side and do not go black at a glancing sun. Paint and glass stay evenly matt.
