# 42 · The game clock, a playable night, and the junction at Fillmore and Bay (2026-11-14)

## The decision

Real-world darkness made the evenings unplayable. The game now keeps its own time:

- **48 minutes of daylight and 24 of night.**
- **A moon that fades in through the evening** and brightens as the night deepens, every night.
- **Stars** in their real places over San Francisco.
- **A night you can play in:**
  - cool blues, not black;
  - moonlight at about a fifth of the sun;
  - shadows dark blue, not black;
  - warm light in house windows;
  - a rim of light on the player and the NPCs.

One clock drives everything that keeps the books. People, cars and buses still move at real
speed.

## The clock (`docs/city/clock.mjs`)

- **72 real minutes make one game day.**
  - Real minutes 0–48 run from sunrise to sunset of the game's date.
  - Real minutes 48–72 run from sunset to the next sunrise.
  - The sun keeps its real path at San Francisco (sunrise and sunset after suncalc). So by day
    a real second is 12–18 game seconds, and by night 30–40.
- **Settings:** `rules.json` `clock` holds the epoch, the first game date, the minutes and the
  place. `CLOCK_SPEC` in `clock.mjs` holds the same values for the sky outside the city; a test
  holds the two equal.
- **The same in every browser.** `game(realMs)` and its inverse `real(gameMs)` are pure functions
  of real time, so a party sees one clock.

### What reads the game clock

The sky, the clock shown, shop hours, shifts and pay, rent and bills, the week, the lanes' hours,
and the NPCs' plans.

### What moves in real time

Walking, driving, and buses along their routes.

- The fleet works in *fleet time*: real minutes counted from the moment the game day began
  (`fleetTime`).
- A resident's day is planned in game minutes and carried across with `toFleet`, so an errand at
  "09:00" starts when the clock reads 09:00 and the walk there takes real seconds.
- A courier's deadline is the ride's real minutes, shown in real minutes.

### City mode only

The game clock is the city's. In **City** mode the sky reads it (`setClock("game")`) and the
compass is a reading only: no click, no box, the time cannot be changed. In **Explore** the sky
is San Francisco's own, live, and the compass still opens the box to turn the walker and move
the sun (`compassForMode`, module 23). `kerbsideEnvironment.setTime(date)` remains for previews
and tests.

### Fixed on the way to production (2026-11-14)

- **The moon was never drawn.** Two causes: a released detail window emptied the one quad
  three.js draws every sprite with (`emptyOne`, module 29), and City mode's far plane (1.6 km)
  clipped a moon placed 20 km out. Sprites are now skipped by the release, and the moon stands
  inside the far plane at the same apparent size.
- **Parks glowed green at night.** Distant tree crowns are unlit points; they now go down to
  moonlit blue with the page's night (`uNatureNight`, nature-runtime).

## Night (`docs/environment-runtime.mjs`, module 02)

### Sky

- A night dome from deep indigo at the zenith to slate at the horizon. Fog follows it.
- **Stars:** 3,232 stars to magnitude 5.6 (`docs/sky-stars.json`), from d3-celestial's
  catalogue, BSD-3-Clause, after HYG / Yale BSC.
  - Each is sized by magnitude and tinted by colour index.
  - They are turned by local sidereal time for the game's moment at 37.8° N.
- **Moon:** rises opposite the sun's azimuth after sunset. It fades in over the evening and
  brightens as the sun sinks further; cloud dims it.

### Light

| Light | Daytime | Night |
|---|---|---|
| Directional | Sunlight | Moonlight: 22% of the sun, blue-grey, from the moon's direction |
| Hemisphere | Day colours | 1.35, sky 0x93a8dc, so shadows stay blue |

### Windows

House glass and window decals take a warm light from within.

- Some windows are lit and some are dark, by a hash of the window's cell.
- The share lit is 55% in the evening, falling after 22:00 to 12% between 01:00 and 05:00.

### Rim

A fresnel rim on the walker, other players and the NPCs, up to 0.38 at full dark.

### Two lessons

- **A guest region reruns the page's modules in the same realm.** The night's uniforms live on
  `globalThis.__kerbsideNight`, so every copy reads the same ones.
- **`Material.clone()` keeps userData but not `onBeforeCompile`.** Patches are recorded in a
  WeakMap, and a clone is patched again.

## Fillmore and Bay

### What was wrong

The pale wedge in the junction was not an island. It was *imagery-inferred paving*:
`tools/infer_ground_gaps.py` had filled a gap in the road surface at the mouth of the right-turn
slip from Fillmore onto Bay. Its nearest described neighbour was a walk-coloured surface, so the
gap became pavement. The cars and the bike lane crossed it because it was road.

### The fix

`tools/inferred_roadway_to_asphalt.py` redraws such fills as road.

- **The rule:** a piece of an inferred fill that can be reached from a street's centre line
  without crossing a kerb, within half the street's width plus 3 m, is road surface. It is
  redrawn as asphalt. The rest keeps its kind.
- **Kerbs** are the survey's curb lines and the drawn islands' rings.
- **Re-running is safe:** a second run moves nothing.

| Region | Whole fills turned to asphalt | Fills split at the kerb | Area (m²) |
|---|---|---|---|
| Corridor | 3,415 | 3,409 | 86,000 |
| Berkeley | 2,180 | 559 | 65,000 |
| Haight–Castro | 416 | 783 | 23,600 |
| Mission | 1,181 | 1,149 | 42,500 |
| Sunset | 566 | 1,486 | 43,500 |

### Feet in the islands

The raised islands (`addClosedOfficialIslandSurfaces`, and the kerbed strips of
`fillRoadwayToKerbs`) were drawn 13 cm above the road but never registered as standing ground,
so the walker stood at road height inside the slab. They are now stamped as paved at their top,
as the tree islands already were.

### Bus shelters

A shelter was placed when its middle was clear of buildings, so on a narrow pavement its back
half stood in the façade. Garage doors and shopfronts stand proud of the building outline by up
to 0.8 m.

- **The whole roof is now tested.** The back is checked against buildings with a 0.6 m pad, the
  ends likewise, and the road side at the roof's edge.
- **Search order:** first a little nearer the kerb, then up or down the kerb from the pole.
- **Where none fits, the stop gets a bench.** In the corridor, one shelter became a bench and
  one moved 3 m along its kerb.

## Tests

| Suite | Result |
|---|---|
| `tests/city_clock.test.mjs` | 6 tests: almanac, cycle, inverse, fleet minutes, NPC days at real speed, rules equal to `CLOCK_SPEC` |
| `tests/test_inferred_roadway_to_asphalt.py` | Lanes become asphalt, a footway is kept, a fill split at the kerb, a re-run changes nothing |
| City JS (`tests/city*.test.mjs`) | 229 passing |
| All JS (`tests/*.test.mjs`) | 248 passing |
| Related Python | 909 passing |
