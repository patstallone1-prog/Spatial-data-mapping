# Measurement Extraction, Street Overlay & Full-Stack Results

Built 2026-08-20. 280 tests, lint clean.

```bash
python -m smc.ingest seed --out build/seed --blocks 2
```

---

## 1. Full-stack run

Corridor → RTK survey → reference index → wearer photo bank → anchoring → street snap →
measurement → world-facts, scored against ground truth.

```
survey 23 frames | reference sigma 0.030 m | bank 40 frames
anchored 40/40 (100%)
position: prior 4.15 m -> posterior mean 0.070 m, median 0.059 m, max 0.197 m
facts emitted: 240
  curb_height_mae_m       0.0112      curb_height_p90_m       0.0137
  sidewalk_width_mae_m    0.2257      sidewalk_width_p90_m    0.4678
```

**Curb height: 11.2 mm MAE, 13.7 mm p90.** Comfortably inside the Tier B bucket requirement,
and close enough to matter — the bucket boundaries are 3 in and 7 in, so a 13 mm error almost
never puts a kerb in the wrong bucket.

**Sidewalk width: 0.226 m MAE, 0.468 m p90.** This meets the re-spec's original ±0.3 m Tier B
target and **misses the revised ±0.15 m** target set after UrbanVGGT.

That asymmetry is the most interesting result here, and it is the opposite of the intuitive
guess. From a wearer's vantage the kerb is roughly a metre away, fills a large part of the
frame, and is seen from a good angle; the footway's *far* edge is against the building line,
often outside the frame or occluded, and is what sets the width. So the wearer measures the
near feature very well and the far one poorly. The vantage, not the sensor, is the limit.

**Superseded.** Every figure above was scored with `OracleMatcher` and is an upper bound.
Real SIFT matching has since replaced it as the default everywhere; see
`docs/09-production-review.md` for measured figures.

## 2. Measurement extraction

`smc/measure/`. Two planes are the skeleton of everything: kerb height is the step between
them, cross slope is the tilt of the upper one, width is its lateral extent.

**The failure that shaped the design.** Fitting the dominant plane first and splitting
afterwards does not work. The carriageway spans ten metres laterally while the kerb step is
0.15 m, so a plane tilted **two percent** — well inside any plausible slope limit — reaches
across both surfaces and wins on inlier count. Measured: 1101 inliers for the spurious plane
against ~900 for either real surface. No amount of iteration recovers, because RANSAC is
finding the genuinely most-supported plane.

The fix is to locate the kerb line *first* by scanning for the largest height discontinuity,
then fit each side independently. A flush kerb is not a failure of this method — the largest
step found is simply near zero, which is the right answer at a driveway apron.

**Facades win otherwise.** A shopfront is large, flat, densely sampled and vertical. In a
wearer's frame it beat the footway outright (1500 inliers vs 252) and then reported a footway
width of zero, because a vertical plane has no horizontal extent. Surfaces are now constrained
to a maximum 20% slope — far above the 8.33% ramp limit, far below a wall.

**Two corrected biases.** The 20 mm plane threshold sits just above the ¼-inch hazard limit so
genuine defects stay outliers rather than being absorbed. And percentile-trimmed extents read
systematically narrow — a 2% trim covers 96% of the true span, which is 6 cm on a 1.5 m footway,
a third of the tolerance being claimed. It is divided back out; no amount of corroboration
would ever have revealed it, because every contributor makes it identically.

**Cross slope is reported as undecidable, and that is the honest answer.** A 1.5% rise over a
1.6 m footway is smaller than the fit residual: measured 0.0147 ± 0.0055 against a 0.0208 limit.
The measurement cannot tell compliant from non-compliant. That is the arithmetic behind Tier C
being advisory rather than a rule someone chose, and the flag says so explicitly.

## 3. Street overlay

`smc/overlay/street.py`. Snapping an anchored pose to the street network does three jobs:

- **Makes measurement well posed.** The map supplies which lateral direction is across the
  footway and where the roadway edge is, so plane splitting does not have to search.
- **Gives facts a stable identity.** `way1:00035:L` — segment, 5 m station bucket, side. Two
  contributors measuring the same kerb months apart produce the same id, which is what lets
  their observations corroborate instead of accumulating as near-duplicates. Verified: observers
  2 m apart share an id; opposite sides of the street never do.
- **Puts everything in one frame.** The along/across/up basis is per street, so passes composite
  into one surface instead of a fan of slightly rotated copies. Round-trips to 1e-16 m.

Off-network captures are refused rather than forced onto the nearest street: a capture in a
plaza has no kerb its measurements belong to.

Reference geometry is OSM/Overture — **ODbL**. Segment ids may be recorded; segment geometry may
not be copied into the facts table. That boundary is what keeps the product a Produced Work.

## 4. Varying pace — the crucial verification

`smc/capture/gait.py` models pace as an Ornstein-Uhlenbeck process around a preferred speed
plus Poisson stops, because real pedestrians drift continuously, slow at kerbs, and stop dead
at crossings. Correlated rather than white noise, since a person walking slowly now is likely
still walking slowly a second from now — independent noise would average out and hide the
problem entirely.

| | speed | frame spacing | spacing CV |
|---|---|---|---|
| Constant 1.35 m/s | sd 0.00 | 0.810 m | **0.000** |
| Varying pace | mean 1.36, **sd 0.51**, stopped 12% of the time | 0.784 m (0.75–0.85) | **0.028** |

**A 38% coefficient of variation in walking speed produces a 2.8% variation in frame spacing.**
The distance gate absorbs pace variation almost entirely, spacing never leaves the 0.75–0.85 m
band, and nothing is captured while stopped. This is the property the distance trigger was
chosen for, now measured rather than asserted, and held across four independent walks.

Had capture stayed on a clock, baselines would have swung with every stride — and degraded worst
exactly where people slow down, which is at the kerbs and crossings the product is about.

## 5. Photo bank at delivered resolution

`smc/ingest/photobank.py`. The conventions are what a phone app *receives*, not what the sensor
captures, and the gap changes what can be claimed:

| | Sensor | Delivered via the toolkit |
|---|---|---|
| Still | 3024×4032 (12.2 MP) | **1440×1080 (1.56 MP)** — photo capture during streaming |
| Video | — | **1280×720 @ 30 fps** — capped, attributed to Bluetooth |

**Roughly an eighth of the pixels.** Angular resolution sets how finely a kerb edge can be
localised at range, so generating the bank at sensor resolution would have quietly overstated
every downstream number.

The wearer viewpoint differs from the rig in two ways that matter as much: eye height rather
than dash height, and *on the footway* rather than in the carriageway — one to three metres
from the kerb, not eight to twelve. Gaze is roughly level with head yaw, so a large fraction of
every frame is sky and shopfront. That is reproduced rather than framed away; it is a genuine
limitation of the wearer vantage.

`fov_deg` is **[UNVERIFIED]** — Meta does not publish the field of view of the delivered 4:3
crop, and it materially affects scale. Measure it against a real device before quoting any
accuracy figure derived from this bank.

## 6. Bugs found and fixed in this pass

| Bug | How it presented |
|---|---|
| Tilted plane bridges both surfaces | Kerb height wrong by ~130 mm; RANSAC "working correctly" |
| Facade wins the walking-surface fit | `span_m must be positive` — a vertical plane has no width |
| `np.cross` on 2-D vectors | Removed in NumPy 2; street snapping crashed |
| `kerb_offset_hint_m` subtracted the observer's own offset | Negative hints; would have split the cloud on the wrong side |
| Percentile-trim width bias | Systematic −67 mm, invisible to corroboration |
| `BankFrame` carried no render | Full-stack run could not reach the matcher |

## 7. What this does not show

`OracleMatcher` reads correspondences from the world buffer instead of earning them from pixels.
It exercises PnP, covariance, sigma propagation, retrieval, snapping, plane fitting, and fact
emission — all of which are now known to work. It says nothing about whether real feature
matching survives a repetitive streetscape at 1440×1080, which remains the open question that
decides the product.
