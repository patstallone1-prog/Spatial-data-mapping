# Advertising in the street, and bicycles locked to the city's racks

2026-11-14. Two things were added: the city's other advertising, and its bicycle racks.

## Where the advertising comes from

| Medium | Source | What the world does with it |
|---|---|---|
| Billboards, rooftop and wall signs | SF Planning, General Advertising Sign Program ([map](https://sfplanninggis.org/gasp/)), read by `scripts/build_ad_media.py` | 557 standing permits (of 558). A permit within 30 m of a billboard OpenStreetMap already maps is that board, and the permit is only noted on it. Otherwise a new sign is added (`sfplanning:gas:<record>`). Two permits within 6 m are one sign with two faces. |
| Bus shelters and transit panels | SFMTA shelters already in the world (Muni stops, mapped shelters) | Each shelter's end panel is now a two-faced light box with an ad on each side. |
| Kiosks and street furniture | OSM `advertising=column/board/poster_box` already in the furniture sidecars | Columns are drawn as a round drum with the picture wrapped round it. Boards and poster boxes are two-faced light boxes on legs, set square to the kerb. |
| On-premise business signs | DBI building permits | **Not used for ads.** These are businesses' own signs, and storefront signs are already drawn by the storefront programmes. |

A permit records where a sign is, but not its size, mount or facing. Those are inferred where
the sign is drawn (module 19 `autoBillboardMount`):

- **No building within 12 m:** the sign stands on poles, facing the road.
- **Next to a building:**
  - A low building gets the sign on its roof, on posts.
  - A taller building gets it high on the wall that faces the street.
  - A second face goes on another wall that faces a street, or else back to back.
  - A sign that would be buried in a taller neighbour moves onto that taller building.
- **Size:** each face is a standard 30-sheet poster, 12 × 25 ft (`dimensions_basis` is
  `inferred_standard_poster_for_permitted_sign`).

Only the record id, status, address, description and point are kept. The planners' names and
contact details in the layer are not copied.

## The pictures, fitted to each shape

Every medium shows the three approved billboard pictures (`data/billboard-creatives.json`,
`rotation`). A board with no picture of its own gets one by a hash of its id, so it always shows
the same picture. Each picture has a `focus` point, where its subject is. `composeAdFace` lays a
picture out for the face's shape:

- **Wide faces and faces near the picture's own shape:** a blurred, enlarged copy fills the
  face, and the whole picture sits on top of it, uncropped.
- **Tall faces (shelter and kiosk light boxes, columns):** the focus area fills the top. A dark
  band at the foot holds the whole picture at 92% of the width.

Textures are cached by shape, in steps of an eighth of an octave of aspect.

**Material:**

- The faces are satin (roughness 0.32).
- At night they light up from inside (`nightLitFace`, driven by the game clock's night
  uniform). Billboards are lit at 0.45 unless tagged `lit=no`.
- The shelter frame is dark metal.
- Columns are green (`0x1f3a33`) with a plinth, a lid and a dome.

## Bicycle racks

`scripts/build_bike_racks.py` reads DataSF *Bicycle Parking (Public)*
([hn4j-6fx5](https://data.sf.gov/d/hn4j-6fx5), ODC-PDDL-1.0) and writes `bike-racks.json` beside
each world's furniture sidecar. It keeps only racks placed on the sidewalk, in the roadway or in
a parklet, and drops those in garages and inside buildings.

| World | Sites | Racks |
|---|---|---|
| Corridor | 1,105 | 1,787 |
| Mission | 1,025 | 1,601 |
| Sunset | 373 | 555 |
| Haight–Castro | 150 | 209 |

**Placement** (module 21 `placeCityBikeRacks`). A site's racks are placed in a row at the
nearest kerb within 30 m:

- **Pavement racks** stand about a metre in from the kerb, 2.4 m apart, with each U along the
  kerb. They are kept clear of the carriageway, of buildings (and 1.5 m in front of them) and of
  doors.
- **Roadway and parklet racks** form a corral in the parking lane, 0.9 m apart, with each U
  across the kerb.
- Placements that fail are counted by reason in `bikeRacks().placing`. In the Mission, 1,315 of
  1,601 were placed; most failures had a building or a junction in the way.
- The racks are galvanised steel: two legs and a bent top, instanced.

**Two places per rack**, one each side of the U. Each place has a bicycle facing along the U and
a lock point at the rear leg.

## Riders lock up

The city gets the racks through `ctx.bikeRacks()` (module 30, guest regions transformed).
`City.setRacks` puts them on a 25 m grid.

When a rider goes anywhere but home, `spotOf` asks `rackSlot` for the nearest free place within
60 m of the door. The place is held for that bicycle, and the spot is marked
`{rack: true, locked: true, lock}`. The ride starts and ends at the place. A parked bicycle
there is drawn with a U-lock through the frame and the rack (`view.mjs`, steel shackle and a
black rubber-sleeved bar, instanced, at the full detail tier). If no rack is near enough, the
bicycle is left by the door as before.

No freely licensed bike-lock model was found, so the lock is modelled in code.

## Tests

- `tests/test_ad_media_and_bike_racks.py` covers:
  - merging permits into mapped boards, two-faced signs, and idempotent reruns;
  - dropping removed signs;
  - the rack filter;
  - rack orientation on the pavement and in a corral;
  - ad-face layout for wide and tall faces.
- `tests/city_bike_racks.test.mjs` covers nearest-rack choice, one bicycle per place, the
  walking reach, and resetting spots when the racks change.
