# 33 · Viewer performance: walking and jumping without stalls

The goal: with a good connection, Kerbside is smooth while walking and while jumping across
the Bay, with every bit of the world's visible detail kept. Nothing here removes or thins what
is drawn. The work is in **when** things are built, and in not building anything twice.

## How it is measured

- Headless Google Chrome (`--use-angle=metal`, so the real GPU), driven over the DevTools
  protocol. A run is: boot, walk, then a set of jumps (`kerbside.goTo`, a click's travel).
- **Long Animation Frames** (`PerformanceObserver('long-animation-frame')`) give every frame
  over 200 ms with the scripts inside it, by function and source position, with exact durations.
- A CPU profile is started with a busy-wait mark, so profile time lines up with page time
  exactly. Lining it up by evaluate latency was off by hundreds of milliseconds and blamed the
  wrong functions.
- Keep the display awake while benchmarking. A page in a hidden or sleeping display has its
  timers throttled to once a second, and every sliced build then crawls.
- The sampling profiler alone misattributes. Every hot spot is confirmed with
  `performance.now()` before it is optimised.

## What was slow, and what changed

| Cause | Fix |
|---|---|
| Each region window compiled the 2 MB page module again from a new blob | One factory module, compiled once; a function per window |
| Releasing a window let three.js destroy its shader programs; the next window relinked 35–50 in one frame | `keepShaderPrograms` keeps compiled programs pinned |
| A window's release emptied the shared asset map | The shared map is never emptied |
| Top-level ground passes (nodata fill, inland water) ran unsliced after the 16 MB storefront data | Sliced, yielding between rows |
| Sign plates painted inside placement | Painted ahead, off the frame |
| Street tiling, refinement buffers, bounding spheres, frontage fill, parks, fences and settling ran as single tasks on a large jump | Each is a generator, sliced to a frame budget (`runStepsSliced`) |
| Background yields stalled in a hidden tab | `nextTask()` yields by message instead of by timer when the page is hidden |
| Region markers read a label constant before the module had declared it (an error on every boot, markers missing) | The region list waits for the module to finish (`regionStreamingReady`) |

## Results

| Measure | Before | After |
|---|---|---|
| Walking after 12 jumps | 19 fps | 50 fps |
| Walking alone | — | 57 fps, 95th-percentile frame 17 ms |
| Worst frame on a 500 m jump | 1.0–1.6 s | 0.23–0.58 s |
| Worst frame on a city jump (Oakland) | 2.8 s | 0.58 s |

## What is left

The remaining frames over 200 ms on a large jump, by cause:

- One very large vertex-buffer upload on first draw (about 0.3 s).
- Painting the leaf-card textures the first time a tree species appears (about 0.27 s).
- Garbage-collection pauses.
- Fence normals in the fence build.

The heap grows to about 4.5 GB over twelve large jumps. Retained window memory is the next
thing to cut.

The network side, how the cloud store sends files, is not the bottleneck on a good connection.
The stalls are main-thread build work, and every fix above is there.
