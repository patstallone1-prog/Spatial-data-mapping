# Five Marina restaurants rebuilt from records and street photos (2026-11-24)

Each building below starts with Kerbside's pipeline (DataSF LiDAR footprint and height, the
app's wall material, colour, openings and roof colour, `smc.exteriors` for the storefront band,
the app's street record). Photo readings are layered on top as observations: each names its
Mapillary frames and how it was read. The check is the studio's elevation render stacked
under the rectified photos on a 1 m grid (`kerbfront stack`). A second check is the render
from each photo's own camera beside the photo (`out/five-restaurants.jpg`, not committed:
CC BY-SA pixels).

| Restaurant | Building | What made it recognisable | Seating | Observations |
|---|---|---|---|---|
| Tacolicious, 2250 Chestnut | 1-storey Art Deco corner, 6.45 m | 16 stepped, fluted green fins on a regular 3.30 m module, a fan frieze, diamond-leaded windows, a dark green shed awning, an orange half-sun blade | parklet on Avila (green rail, terracotta corrugated roof), sidewalk strip on Chestnut | 27 |
| Super Duper Burgers, 2201 Chestnut | 2-storey brick corner (1927), 9.8 m | cream canted bays with crests (one wraps the corner), a clerestory row, white channel letters on a grey fascia, three orange retractable awnings, red SUPER DUPER badge blade on the chamfer, fire escapes | grey plank parklet with string-light posts on Pierce; Muni wave-roof shelter and giant cone on the sidewalk | 35 |
| Balboa Cafe, 3199 Fillmore | 1-storey white corner (1909), 3.05 m, plus a 2-storey rear wing | dentil frieze and cornice, an L-shaped mint roof board (BALBOA CAFE / OFF SALE LIQUORS, Coca-Cola discs) facing both streets, BALBOA CAFE BAR & GRILL corner blade | roofed timber parklet on Fillmore; planter parklet, a roofed glazed bay and sidewalk tables on Greenwich; patio heaters | 28 |
| A16, 2355 Chestnut | 3-storey brick (1929), 9.45 m | two pairs of round-arched windows over two pairs of double-hung windows, a stone diamond, round green A16 blade and A 16 board | enclosed parklet: green plank panels, timber frame and rail, clear panels, grey corrugated roof, entrance on the door | 16 |
| Dragon Well, 2142 Chestnut | 1-storey shops under a 7.4 m siding false front | a projecting dark-brown box window over a cream DRAGON WELL board, among four tenants (teal awning, Marina Lounge's red MARINA neon) | café enclosure on the sidewalk: cream low walls, red posts and beam | 15 |

## What the data got right, and what the photos changed

* **Business type.** All five come out of the sweep as `render: restaurant` from the app's
  own tenant rules. The office rule (a legal suffix in the name) would have made Books Inc. and
  Williams-Sonoma plain buildings. That is overridden when a map POI or a specific category
  says the place is a shop.
* **Parklets.** The registry licence (`FIXED COMMERCIAL PARKLET`) was right for Tacolicious,
  Super Duper, Balboa and A16, but the default placement (in front of the storefront) was
  wrong twice:
  * Super Duper's parklet is on Pierce, because the Chestnut kerb holds a bus shelter.
  * Balboa has parklets on both streets.
  * Dragon Well has no seating licence at all, yet its photos show a sidewalk enclosure. Its
    depth comes from parallax: posts 2.5 m apart put the enclosure's street face 2.1 m off
    the facade.
* **Heights.** LiDAR height is the roof surface, so parapets and false fronts were short:
  * A16 is 9.45 m against 8.9 m from LiDAR;
  * Super Duper is 9.8 m against 9.28 m.

  Balboa's LiDAR height of 5.5 m is its rear wing; the corner itself is 3.05 m.
* **Tenants change.** The Tacolicious building's middle shop is ROLO in the 2021-22 frames,
  while the registry still lists La Fromagerie. The model draws what the photos show and
  records the mismatch.

## Photo alignment lessons

* Mapillary SfM positions put most frames within about 1 m along a wall. Anchor each frame
  on a LiDAR corner or a joint between buildings with `align --du`. Dragon Well's frames
  needed +1.35 m; its 2021 sequence drifted about 10 m and was dropped.
* Camera height is the other error. Balboa's 2021-22 panoramas sit about 1 m below the
  assumed 2 m: the wall base reads 1 m high and the cornice 1 m above the 2016 frontal frame.
  `align --dz -0.95` fixed both.
* Anything off the wall plane (awnings, blades, parklets) smears on a rectified elevation.
  Read those from a perspective view of the same frame, or from parallax between two frames.

## Mapillary undersampling

`/images?bbox=` returns a spatial sample, with no cursor, when a box holds more than one page.
An 0.00125° box returned 11 frames while holding 342. Boxes are now tiled at 0.000625°, and a
full first page with no cursor is split further. Commit 9069e1b76 on
`claude/mapillary-full-density` (main checkout code, `src/smc/imagery/mapillary.py`, 6 new tests).

## Not done

* Readings are a reviewer's, not automatic. Stage 5 (attributes read by a model) is still
  to build; the observation format is what it would write.
* Rear and party walls are unseen and kept at pipeline defaults.
* Interiors are out of scope.
* Lens distortion is ignored for perspective frames. Rectified 2016 phone frames bend at
  the edges.
