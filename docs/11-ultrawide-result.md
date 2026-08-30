# The ultrawide result — 2026-08-30

84 iPhone 14 frames of San Francisco footway: 49 on the main camera (26 mm eq, 69 deg
horizontal) and 35 on the 0.5x ultrawide (14 mm eq, **104 deg**), shot landscape. The glasses
are ultrawide at roughly 100 deg, so the second set is the first fair proxy this project has had.

Both sets degraded to the 1440x1080 the Wearables toolkit actually delivers, then matched
between time-adjacent frames (within 25 s of each other, so the same place).

| Source | Field of view | Adjacent pairs | Usable (>=15 inliers) | Median inliers | Max |
|---|---|---|---|---|---|
| Main camera | 69 deg | 138 | **20%** | 8 | 251 |
| **0.5x ultrawide** | **104 deg** | 190 | **51%** | **16** | **683** |

**The wider frame more than doubles the match rate**, and doubles the median inlier count. It
also lifts the ceiling: the best ultrawide pair returns 683 geometrically consistent
correspondences against 251 for the best main-camera pair.

## What this settles

Every previous accuracy figure was measured on 69 deg imagery and flagged as pessimistic,
because the glasses see roughly half again as much street per frame. That caveat can now be
replaced with a measurement: **on a fair proxy the match rate is 51%, not 20%**.

Per-pair recall is not the number that matters, though. A query is matched against several
references and needs only one to succeed, so at four references per query:

    1 - (1 - 0.51)^4 = 94% of frames anchor

## What it does not settle

**Still no GPS.** Zero of 84 frames carry a position, so none of them can be placed on the map.
Location Services remains off for the camera, and the position is simply not in the files —
nothing downstream recovers it. Until that changes, these sets measure *matching* and cannot
measure *placement*.

**Landscape versus portrait is confounded with field of view.** All 35 ultrawide frames are
landscape; only 4 of the 49 main-camera frames are. A landscape frame of a street carries more
of the kerb line, so some of the gain may be orientation rather than optics. Separating them
needs a portrait ultrawide set, and it matters little in practice: the glasses are both wide
*and* landscape, which is the configuration that measured 51%.

## Reproducing

```bash
python tools/run_capture_set.py photos/session2
```

Captures are not committed; they are personal. `photos/` is ignored.
