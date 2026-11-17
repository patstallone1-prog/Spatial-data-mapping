# Memory and frame-time pass (2026-11-16)

What the City build held and threw away, what was changed, and what it measures now. Every
number is from this repository's own page on an Apple M4 with 16 GB (headless Chrome on the
real GPU, 1400x900, a fresh browser for each run, cache off): load City mode, let the Marina
settle, walk for 90 seconds. The server numbers are from `tools/city_load_test.mjs`.

## What was wrong

| Finding | Size |
| --- | --- |
| The traffic step made a small list for every person, for every car, every frame | 460 MB of garbage a second (of 780 MB/s in all) |
| The whole asset map (444,000 names) parsed before the first frame | 47 MB of JSON, about 85 MB of heap |
| The cell cache kept each cell parsed and gave every reader a `structuredClone` | two whole copies of every cell in use |
| Vertex data kept whole in the page after it was on the GPU (tiles, buildings, kerbs, landscape) | 740 MB |
| The grass's ground sampler: an object a triangle, in lists keyed by strings | 120 MB |
| Stores outgrown while the ground was refined, left for the collector | 860 MB at the load's peak |
| Server: every poll asked the store for the version, copied and rebuilt the world, in one queue with every action | 100 players: polls took 2-6 s |

The heap reached 4.1 GB while loading (the engine's ceiling is 4.19 GB) and swung between 1 and
3.8 GB while walking; the collector's pauses were the freezes.

## What changed

1. **Traffic and people, per frame** (`docs/city/fleet.mjs`, `view.mjs`, `transit.mjs`):
   the car-against-person loop makes nothing and passes over anyone out of reach on two
   subtractions; grid cells are keyed by numbers, not strings; `segGap` is plain functions;
   the vehicles a walker at a kerb looks for are listed once a frame; steps aside are updated
   in place; the task board's offers are worked out when you have moved ten metres or the slot
   turns, not every draw; a line's trips for the day are kept. Same decisions: a far crowd
   changes no car's position or speed (tests/memory_trim.test.mjs).
2. **Asset map by region** (`smc.renderer.pages.write_asset_shards`, module 00): the deploy
   writes `docs/asset-map/index.json` (8 KB) and a file a region; the page reads the index and
   the one region it is building, another region's names when that region is first needed.
   `docs/asset-map.json` stays the source the publishing tools write.
3. **Cells kept as text** (`docs/world-streaming.mjs`): a reader gets an object parsed from the
   text; nothing is cloned and nothing is held twice.
4. **Static geometry packed once it is on the GPU** (`docs/recoverable-geometry.mjs`, module
   28): the lossless packing that covered street surfaces now covers every static buffer of
   16 KB or more that has been uploaded and has been in the scene for two looks. A reader (a ray
   cast) gets the exact array back; it is let go again when nothing has read it for a few
   seconds. Buffers that keep changing are left whole. Nothing is taken out of ray casts.
5. **Grass ground sampler** (`docs/grass-strands.mjs`): nine numbers a triangle in one array.
6. **Refinement stores given back at once** (module 03): an outgrown store's buffer is emptied
   when it is replaced, not left for the collector.
7. **Server polls** (`server/city/authority.mjs`, `views.mjs`): the world is rebuilt once for
   each version and kept for polls; the store is asked for the version at most every 750 ms;
   the world is written out once for all the players shown it; other players' ids are looked
   up, not searched for one by one; polls have their own queue and do not wait behind actions.
   An action still runs on its own copy and commits by compare-and-swap.

## Before and after

| | Before | After |
| --- | --- | --- |
| Frames a second, walking | 50.5 | 57.1 to 57.9 (three runs) |
| Frame time: median / 95th / 99th percentile | 16.7 / 33.4 / 50 ms | 16.7 / 16.8 / 16.8 to 33.3 ms |
| Frames over 50 ms / 100 ms / 250 ms in 90 s | 24 / 7 / 5 | 9 / 6 / 3 |
| Garbage made while walking | 780 MB/s | 470 MB/s |
| JS heap after a collection (settled / after the walk) | 992 / 1,012 MB | 525 / 578 MB |
| Page memory, heap and buffers, after the walk | about 2,520 MB | 1,570 to 1,660 MB |
| Vertex data held in the page | 742 MB whole + 352 MB wrapped | 294 MB whole + 801 MB packed into 231 MB |
| Highest memory while loading | 4,113 MB | 3,349 MB |
| Highest memory while walking | 3,791 MB | 3,017 MB |
| Time to load City mode | 59 s | 56 s |
| Asset map read at start | 47 MB | 8 KB + the region's file |

Not fixed: three frames over 250 ms remain in a 90 second walk (the worst 0.7 s); 195 MB of far
tiles and 63 MB of canopy stand-ins that have not been drawn yet are still held whole (packing
them before their first draw would cost a pause when they come into view); the heap still
peaks at 3.3 GB during the load.

## Players the server carries

Each player polls every 4 s and acts every 20 s; the store answers in 35 ms (52 ms a commit).
"Holds": polls under 1 s and actions under 2.5 s at the 95th percentile, nothing turned away.

| Players, instances | Before: poll / action p95 | After: poll / action p95 |
| --- | --- | --- |
| 50, one | 0.25 s / 0.38 s | 0.04 s / 0.15 s |
| 100, one | 5.6 s / 5.6 s (does not hold) | 0.01 s / 0.46 s |
| 150, one | not measured | 0.02 s / 0.41 s |
| 200, one | 14.4 s / 14.5 s (does not hold) | 0.02 s / 1.9 s |
| 200, four | 6.1 s / 6.5 s (does not hold) | 0.10 s / 2.7 s (actions just over) |
| 400, four | 14.8 s / 16.5 s (does not hold) | 0.30 s / 17.7 s (does not hold) |

So: about 50 players before; about 150 comfortably and 200 at the edge now. Polls are no
longer the limit (15 ms at 200 players). Actions are: each one rewrites the whole world record
under one compare-and-swap, so the whole city does eight to ten actions a second however many
instances there are. Past 200 players that needs the record split (a row a player and an event
log) -- the audit's "stop rewriting the complete server world per action" -- which this pass
did not do. A poll's answer also grows with the players (58 KB at 100, 105 KB at 200).

## Not done from the audit

- GPU buffers split into 2-8 MiB spatial chunks; geometry built in workers; leaf textures
  baked ahead; predictive prefetch; offline packaging.
- Incremental sync (an event cursor and deltas) and the per-player record on the server.
- A standalone wrapper with more memory: not needed for 30 frames a second on this machine
  (57 measured), and the desktop app (desktop/) already asks for the engine's full heap.

## Measuring it again

`tools/city_load_test.mjs` for the server. For the page: a static server on `docs/`, headless
Chrome with `--use-angle=metal --enable-precise-memory-info`, City mode, and
`window.kerbsideStaticGeometry()`, `window.kerbsideStreaming()` and `window.kerbsideMemory()`
for what is packed, what cells are held and what the governor sees.
