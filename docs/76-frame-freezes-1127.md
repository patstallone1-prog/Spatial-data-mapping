# Frame freezes and garbage, 2026-11-27

Since 25 November the frame rate had fallen and the freezes were back. This pass measured a 60 s
walk through the Marina in headless Chrome (Metal, precise memory) and cut what it found, using
the levers that worked before: less garbage made per frame, shaders compiled before anything is
drawn with them, and the same work not done twice.

## Measured before

| | Before |
|---|---|
| Frame rate | 27.9 fps (p95 67 ms) |
| Freezes over 250 ms | 6 in 60 s, 350–883 ms |
| Garbage | 412 MB/s (175 after the 11-21 pass) |
| Shader programs | 550 → 555 during the walk |

## What froze the page

**Shaders compiled in play.** The freezes of 0.7–1.2 s were native shader work, while the
programs count went up. Each new material compiled and linked in the frame that first drew it:

- the city's crash scenes, wrecks and their marks, police light bars, shop rooms;
- house shells streaming in;
- anything drawn into an off-screen picture (the stand-in the light is traced through, NPC
  portraits), which needs a second shader (linear colour, no tone mapping).

**The compile gate** (module 27). Anything added under a group marked `userData.compileGate` (the
living city, the house shells) whose materials have no shader yet:

1. is moved onto a layer the view does not draw;
2. has both its shaders compiled off the page's thread (`compileAsync`, once for the page and
   once into a 1×1 picture);
3. is drawn once into one pixel with the scene's own lights, which readies it for the card;
4. is put back where it was, a few frames late.

`kerbsideCompileGate()` reports the counts. A job already holding an object leaves it to that
job, so something moved between gated groups is never left on the gate's layer.

**Rehearsal.** What a crash brings is drawn once, out of sight, while the city warms up behind the
loading screen (`city-rehearsal`, view.mjs), so the first crash in play compiles nothing. The
marks' stand-in carries a four-channel colour, as the marks do: that is a shader of its own.

**Tile builds.** A host tile built in one go, 0.3–0.8 s:

- every vertex's ground was read twice (placed on it, then read again for `natureBases`): now read
  once a point while a tile builds (`tileGroundMemo`);
- every ground read looped over every bridge cut: a point outside the box round all of them now
  asks none.

## Garbage cut

- `nearRing` (parks and playgrounds, read by every walker's ground): 94 MB/s of iterators and
  hypot. Now a cached box and plain loops.
- `walkerFootprintBlocked`: a `Set` per check, replaced by a stamp.
- `publicStairAt`: the 3×3 cells joined once per cell, not per read.
- forest floor `ecoAt`: no arrays or closures per read (55 MB/s while the floor fills).
- leaf litter and close-lock feet: the ground read again only after moving or turning.

## Walkers keep their plans

Every walker looked again every two seconds, reading and weighing six seconds of route whatever
was ahead. Now a walker looks again only when:

- their walk changes;
- most of the route planned is walked;
- a look-again was asked for (someone stepped into the line, a stop is over);
- something is sensed a few feet ahead in their line, checked four times a second: a person
  stopped or lying there, or a car moving across it;
- or eight seconds have passed.

Drivers already look for another way only when a jam or a closed road is ahead (fleet.mjs
`reroute_every_s` is the most often, not a timer).

## Not done here

- Host tile builds still run whole in one frame (`tileLawns` is the most of what is left). They
  should be sliced across frames.
- A material whose variant changes after it is added (a house's glass switching between day and
  night patches, a side flipped) still compiles where it is first drawn, once per variant.
- The traffic's `vehicleAt` and `step` still make about 20 MB/s of result objects.
