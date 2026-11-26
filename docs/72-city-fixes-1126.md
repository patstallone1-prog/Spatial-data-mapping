# City fixes, 2026-11-26: kerbs, walkers, crashes, cars, glass, rooms behind windows

One round of fixes asked for together. Each part below says what was wrong, what changed, and where.

## The pavement at Chestnut & Pierce

OpenStreetMap maps a footway about 3 m wide on both sides of Chestnut at Pierce: kerbs about
6.7 m from the centreline, buildings 8.7–10.7 m. The game had a full block of pavement by the
corner, then a strip 0.5–0.7 m wide. Two building footprints standing 6.9 and 7.7 m from the
centreline cut each station's walk down to the room left in front of them.

`evenWalkAlongBlock` (module 09) now evens a side's walk:
- A station narrower than `WALK_EVEN_SHARE` (0.7) of the side's median is set to the median.
- This only happens where such stations are at most `WALK_EVEN_MOST` (35%) of the side, so a
  genuinely narrow block keeps its width.

The north side now measures 2.5–3.5 m.

## Two layers of kerb at the spawn

The derived pavement ran from the kerb to the property line. OpenStreetMap's own sidewalk way was
then drawn on top of it: 1 cm higher, fitted to 1.2 m, half of it laid, in a different texture.
That made two layers, and only the inner one had a kerb face.

Now a mapped sidewalk that runs along a street's walk (`mappedSidewalkIsStreetWalk`) is not drawn
again in module 15. The street lays it once, from kerb to property line. Where it is the walk, the
"gap:" width also counts the mapped way's own width.

## People walking into walls, then vanishing

There were three causes:
1. The close lock let a stuck walker vanish.
2. Pushing people out of buildings could carry them through thin ones.
3. A 2.5 s stall counted as a cut, which allowed a jump.

The fixes, in close-lock.mjs:
- `towards()` takes an `open(x, z)` wall test. A walker slides along a wall, or stands, and never
  steps into one, except within `portal_m` of the door they are heading for.
- A stuck walker stands and waits (`stuck_wait_ms` 3 s), facing where their day has them. Then it
  tries again. It never vanishes.
- `cut_gap_ms` is now 20 s, so a stall is not a cut.

## After a crash, cars take another way

`Drivers.crashedOn` (fleet.mjs) does three things:
- Marks the block the crash happened on as jammed for `crash_known_s` (150 s).
- Makes both cars in the crash avoid it at once (`avoidNext`).
- Has every car look at its route again on its next step (`nextRoute = 0`), so none repeats the
  collision.

## Car colours and models

`PAINTS` now has 23 colours:
- White and pearl.
- Black and blue-black.
- Silver and light silver.
- Three greys: light grey, grey, graphite.
- Gunmetal.
- Reds: red, candy, maroon.
- Blues: blue, sky blue, dark blue, navy.
- Dark green.
- A few rarer colours.

`CITY_MIX` follows Axalta's 2025 shares, leaned a little toward colour as asked: about 61%
neutrals, reds over 10%, blues over 14%.

The bought-in models are now most of the road: Civic, Sonata, GLK and Frontier, plus the fleet's
Cuore, Jeep, Porsche and truck. The imported share is at least 70% for sedans, SUVs, pickups and
economy cars. The far tier (LOW) draws the models' mid files. The code-built box cars (`lowCars`)
are gone.

## Office glass

Curtain-wall glass is lighter. It is now a light blue (`curtain_rgb` [0.2, 0.3, 0.4], body 0.78,
was 0.42) with a little less mirror. Each pane is a shade off its neighbours, and the wall leans
teal, green or violet with the angle, as coated glass does. Face on it shows the floor behind it
through interior mapping (`curtain_room`). Offices have no built rooms, so this is the only thing
behind their glass.

## Real rooms behind shop and house windows

A first try drew a room behind every window with a shader. It was dropped: what it showed was not
the room you then walk into, and nobody inside could be seen.

What replaced it:

**Shops** (view.mjs `previewShops`):
- The nearest four shops within 26 m of you on foot have their real rooms built at their own
  fronts. This is the same `buildRoom` you walk into, or the building's fitted interior
  (`ctx.showFittedShop`, module 30).
- One room is built every 400 ms. Rooms are taken down past 36 m, or once you drive.
- Going in drops the street copy and builds the room again for you inside it.

**People in a shop seen from the street** (`placeInShop`):
- They stand where its room has them: staff behind the counter, in the kitchen or at the till,
  facing the front; anyone else at the counter or on the floor.
- They are drawn within `INDOOR_SEEN_M` (22 m).
- The glass is plain see-through glass both ways: the walker on the pavement and the person at
  the counter see each other.

**Restaurant plans** (restaurant-room.mjs): a plan whose door was in no piece of the clipped
building outline took the first piece. That could be the back of the building, which put the room
15 m behind its own windows (Chubby Noodle, Chestnut St). It now takes the piece that reaches the
front, or else the whole rectangle.

**Houses** (module 24 `interiorsOnStop`):
- While walking, the nearest three houses ahead of the camera within 20 m get their real rooms,
  one every 1.2 s.
- Standing still keeps the old rule: the three nearest within 26 m.
- Rooms are now drawn with the camera within 24 m (`INTERIOR_DRAW_M`, was 15), so they show from
  the pavement and across a narrow street.
