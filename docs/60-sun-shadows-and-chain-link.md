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
