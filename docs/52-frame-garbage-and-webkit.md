# Frame garbage, held memory, and a plan for WebKit (2026-11-20/21)

What the City throws away every frame and what it holds that is never drawn; what was changed
for Chromium (the build players run); and what the same work would save in WebKit, planned
here and not yet done. Measured on an Apple M4 with 16 GB: headless Chrome on the real GPU
(1280x720), a fresh profile for each run, cache off, the store proxied from the deployed site,
City mode in the Marina with the game clock pinned to 17:30 on a weekday so every run sees the
same city.

## Where it started (the garbage-trim pass, measured 2026-11-20)

Standing still in the Marina with about 1,850 people out, the page made 959 MB of throwaway
objects a second against 1.7-1.8 GiB it actually needs. Chromium kept up by collecting all the
time -- 3,147 small and 54 full collections in two minutes, 70 ms of every second -- and its
heap reading swung between 1.85 and 3.34 GiB, half of it garbage (a forced collection took one
reading from 2.99 GiB to 1.51). The memory governor read that number, garbage and all, and
halved the tile and cell caches the view needs whenever garbage pushed it over the line. (Those
numbers come from that pass's own runs, with a bigger crowd out. The table under "Measured
after" measures the state before the fixes again on one harness, so the before and after are
on the same footing there.)

WebKit (from the 11-18 WebKit report, City mode): the JS object heap grew 2.27 -> 4.03 GB
between 181 and 301 s, typed arrays (Gigacage) stayed near 0.9 GB and graphics flat at 439 MB.
The growth is the object heap filling with garbage faster than WebKit clears or returns it. It
has no `performance.memory`, so the governor never runs there at all; the peak footprint was
10.2 GB.

## Changed for Chromium

### Garbage never made (per frame; none changes what is drawn)

| Source | Before | Fix |
| --- | --- | --- |
| `inRing` / `outOfRing` / `keepOutside` (people inside footprints) | 119 MB/s | index reads, reused scratch arrays, numeric grid keys |
| `dressAt` (people's colours) | 74 MB/s | each colour string parsed once |
| `storesAt` from `nearestShop` | 31 MB/s | "does this place sell anything" kept per place |
| grass `make` | 37 MB/s | cells that come out empty remembered until the ground changes |
| `alongRoute` `on()`, fleet `into`, `keepApart`, `waitsAtKerb`, figure clips, `floorSurface`, `guestUnder`, `roadAt` | 9-28 MB/s each | no destructuring; reused maps and lists; crossing ends kept; a house's steps listed once |
| `insideCarriageway` (the guest Marina's, from `roadAt`) | 179 MB/s | index reads: each segment destructured made an iterator |
| `alongRoute` and its `on()` (every car, bike, bus and walker on a route, several times a frame) | 37 + 30 MB/s | two closures and up to four points a call -> module-level helpers writing into three kept points; one new result |
| The route search's heap (`search`, `pop`) | 23 + 11 MB/s | three parallel arrays; no `[f, [p, n]]` tuple a push |
| Two cars closing: both routes looked ahead at three moments, for every pair | 21 MB/s | each car's bodies at those moments worked out once a step (a car is in many pairs); `into` without `Math.hypot` |
| The frame's record of each car (`frameCity`) | part of 22 MB/s | filled in, not copied with `{ ...base, ...pos }`; the step's `{ ...alongRoute(), c }` likewise |

### A bug: the grass layer driven from two places

The Marina's grass layer was moved by its host (guestTick, to where you stand) and again by its
own page's frame, whose focus in the follow view was its own unset target (0, 0): every frame
looked like a 1.5 km jump and, wherever there is real grass, the layer rebuilt without end
(84 MB/s at the first probe). An attached region's page no longer moves its grass itself.

### The governor reads what the page holds

`desktopMemoryTick` now decides on the heap at its lowest over the last 60 s (read every
second), which is what stays after a full collection, not the reading with its garbage. Only
near the engine's own limit (3.85 GiB) is the raw reading taken as it is.

### Held and never drawn

| What | Size | Fix |
| --- | --- | --- |
| The host world while the Marina runs as the guest | groups.streets 202 MB (and the rest of the host's groups) | released groups are emptied as well as freed on the GPU: `groups` still named them, and through them every mesh |
| The avatar files' GLTF parsers | 25 MB | let go once loaded (nothing reads them after) |

Left as they are, and why:

- **CPU copies of canvas textures after upload (~430 MB, likely WebKit's flat 439 MB graphics
  bucket).** Textures that share a canvas (clones, a second material) upload from it again
  later, and three.js re-uploads after a dispose or a lost context; dropping the canvas then draws
  them blank. It wants a per-site list of canvases that are used once and never redrawn, then a
  release after `onUpdate` for those only.
- **Park-grass sampler (40 MB).** It serves the yards' lawns as well as the parks, so it cannot
  simply be cut where the parks drew nothing; it should be built only for the cells near you.
- **Data loaded twice, host and guest (~70 MB), region markers (45 MB), sign plate atlas and font
  cache (36 MB).** Not traced to a safe single owner yet.

## Measured after (this branch, 2026-11-21)

Five runs on the harness described at the top: one run each, the same Marina at 16:00 game
time (about 325 people in view, 15,893 on the roster), standing in the follow view. Garbage is
counted from V8's own GC trace (`--trace-gc-nvp`: the bytes allocated before each collection),
over 60 s. The sampling heap profiler, with its collected objects included, agrees within 20%;
run for 30 s its report was too large for the debugging connection and the page stopped
answering, so it ran for 8 s at the end. "Kept" is the heap after two forced full collections.
"Realism" means the Unreal characters and the photographed near surfaces. Without them, their
files answered 404 (`store/npc/`, `city/models/npc/`, `textures/near/`): the page then draws
the old figures and the plain ground, with the same code running.

| | before the fixes, no realism | before the fixes, with realism | the fixes, no realism | **the fixes, with realism (this branch)** |
| --- | --- | --- | --- | --- |
| garbage made | 378 MB/s | 352 MB/s | 222 MB/s* | **175 MB/s** |
| small / full collections a minute | 750 / 1 | 707 / 0 | 450 / 2 | **357 / 2** |
| collecting, ms of every second | 10.8 | 11.0 | 11.2 | **9.2** |
| heap with its garbage: mean / max | 1.78 / 2.03 GiB | 1.97 / 2.22 GiB | 1.52 / 1.86 GiB | **1.61 / 2.04 GiB** |
| heap kept after a full collection | 1.51 GiB | 1.52 GiB | 1.25 GiB | **1.27 GiB** |
| old generation after the last collection | 1,062 MiB | 1,257 MiB | 624 MiB | **778 MiB** |
| governor sheds of the caches (in 4 min) | 1 | 2 | 0 | **0** |
| textures / geometries | 1,034 / 2,503 | 1,210 / 2,512 | 1,024 / 2,497 | **1,209 / 2,506** |
| page process footprint | 2,617 MB | 2,709 MB | 2,630 MB | **2,796 MB** |
| GPU process footprint | 3,736 MB | 3,790 MB | 3,737 MB | **3,784 MB** |
| frames a second | 59.1 | 59.7 | 59.8 | **60.0** |

\* Measured before the second round of fixes (alongRoute, the search heap, the paired look
ahead, the car records). Measured with that run, the branch with realism made 256 MB/s by the
sampler (210 after the second round), kept 1.28 GiB, and its page process footprint was 2,516 MB.

The process footprints move by ±150 MB between runs of the same build. 2,516 and 2,796 MB are
the same code with realism a round of fixes apart, so read them as "unchanged", not as a
difference.

What the garbage is now (sampler, 8 s): the fleet's step 21 MB/s, `frameCity` 19, the route
search 12, `vehicleAt` 10, the driver's look at the car ahead 8, `alongRoute` 7, `lanePlan` 6,
three.js's own uniform and buffer updates about 13. Nothing above 21 MB/s. What is left is
short-lived records each frame hands to the next (positions, plans, the vehicles list), not
leaks. Making those few hundred records a frame persistent is the next step towards zero; it
changes how the fleet and the view pass the city between them, so it was not done here.

## What the realism and the characters cost, after the savings

- **The realism on its own** (with the fixes: the third column against the fourth, measured as
  a pair the same hour): +37 MB of kept heap, +58 MB of mean heap, +99 MB of GPU memory (about
  200 more textures: the characters' and the near photographs), and no more garbage beyond the
  noise (256 against 240 MB/s by the sampler). Before the fixes the same pair was +10 MB kept and
  +54 MB GPU.
- **What the fixes save** (with realism: the second column against the fourth): 247 MB of kept
  heap (1.52 -> 1.27 GiB), 370 MB of mean heap (1.97 -> 1.61 GiB), half the garbage
  (352 -> 175 MB/s), half the collections, and no more cache sheds caused by garbage.
- **Net, against the city before both** (the first column against the fourth): the heap kept is
  240 MB *lower* (1.51 -> 1.27 GiB) and the mean heap 170 MB lower (1.78 -> 1.61 GiB). Garbage
  is down from 378 to 175 MB/s. The peak with garbage is the same (2.03 / 2.04 GiB). GPU memory
  is up about 50 MB, and the process footprints are within their noise.

So **after the savings, the realism and the Unreal characters do not add JS memory: the
branch holds about 240 MB less than the city did without them. What they still add is about
50-100 MB of GPU textures.**

## WebKit plan (not implemented)

Everything above is shared code, so WebKit gets it as it is; what follows is what WebKit would
need on top, with what each should save there. The savings are estimates from the Chromium
numbers above and the 11-18 WebKit report (docs/49), not measured in WebKit: the first step of
doing this is the same measuring run in the `desktop-webkit/` shell.

| Step | Why WebKit needs it | What it should save there |
| --- | --- | --- |
| 1. **Measure the shared fixes in the shell first** | WebKit's object heap grew 2.27 -> 4.03 GB in two minutes because garbage came faster than it cleared. The garbage rate is now half of what it was in the same runs (378 -> 175 MB/s) and the heap kept 240 MB lower, and the host world is let go | The object heap held near what the page keeps plus one collection's garbage: from 4.0 GB towards about 1.5-2 GB. Peak footprint from 10.2 GB to perhaps 5-6 GB. To be confirmed |
| 2. **A governor that counts its own bytes** | There is no `performance.memory` in WebKit, so `desktopMemoryTick` never runs and the caches grow until the machine swaps. The page already knows its big holdings: the cell cache (384 MiB counted), the tile cache (320 MiB), textures and geometry (three.js `renderer.info` plus the bytes of each upload), the people and the fleet | Caps the caches at their budget, the same as in Chromium: 0.5-1 GB of the WebKit growth that is not garbage |
| 3. **Drop the CPU copy of canvases drawn once** (signs, plates, labels, facade atlases) | WebKit's graphics bucket stayed at 439 MB. That is very likely these canvases, kept for re-uploads, which would also explain the ~430 MB of canvas copies seen in Chromium | Up to ~430 MB in both browsers. It needs a per-site list of single-use canvases first (see "Left as they are"), then a release after `onUpdate` |
| 4. **Typed arrays after upload** (Gigacage 0.9-1.2 GB) | Geometry buffers are kept on the CPU after upload: the walker's collision, the ground probe and the trees all read some of them, but not all | For buffers nobody reads after upload, `onUploadCallback` releasing `array`: a few hundred MB. Buffers that are read stay |
| 5. **Data loaded once for host and guest** | The Marina loaded as the guest reads some of the same region files the host did | ~70 MB, both browsers |
| 6. **Spread the arrival burst** | +4.7 GB in four seconds when the people and traffic arrive. WebKit returns memory slowly, so a burst becomes the peak | Most of the 10 GB peak is this burst. Spread over frames, the peak should come close to the steady state |
| 7. **Park-grass sampler for near cells only; region markers; sign atlas and font cache** | Held and never drawn, in both browsers | 40 + 45 + 36 MB |

Steps 1, 2 and 6 are what WebKit needs before it is worth playing there. Steps 3-5 and 7 save in
Chromium as well. None of this fixes WebKit's frame rate (4.7 fps in docs/49): that is the GPU
process waiting on WebGL calls, still unprofiled, and remains the first blocker.
