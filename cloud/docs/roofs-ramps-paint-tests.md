# Roofs, ramps, stairs, entrances and street paint: test results (2026-11-08)

What was measured, against what, and how often it was right. Only one of these changes what the
viewer draws: hipped roofs. Lanes and crossings are **not** changed by the paint test.

## Roof shapes from the lidar (`src/smc/lidar/roofs.py`, `scripts/measure_roof_shapes.py`)

Planes are fitted to each roof's returns (RANSAC, one plane after another), then the roof is
called flat, shed, gable, hip or unknown. The fitter abstains on small roofs (under 45 m²),
roofs under canopy (over 15% vegetation returns), complex outlines (rectangularity under 0.92),
too many planes, or planes that explain too little of the roof.

Truth: labels made by eye from NOAA's 0.25 m aerial photographs, Berkeley.

| Set | Flat | Hip | Gable |
|---|---|---|---|
| Tuning (135 roofs) | 28/29 (97%) | 12/12 (100%) | 0/2 |
| Held out (128 roofs, other cells) | 15/16 (94%) | 14/22 (64%) | 0/3 |

* Hip precision on both sets is about 76%. The misses were complex roofs with several wings.
* No flat roof was ever called hip.
* Gables are not reliable, so only hips are drawn.
* OpenStreetMap `roof:shape` tags are almost absent: about 1 per 1,800 buildings in the
  sampled areas.
* Google Solar's terms restrict storing its data, so it is not used.

The production run published hipped roofs where a building had no shape of its own:

| Region | Hipped roofs drawn |
|---|---|
| Berkeley | 258 |
| Palo Alto | 129 |
| Haight-Castro | 160 |
| Mission | 217 |

The output is in `docs/(app-)regions/<r>/sf-corridor-roof-shapes.json`.

## Kerb ramps from the lidar (`src/smc/lidar/ramps.py`, `scripts/test_access_lidar.py`)

At each end of every crossing, the method takes the sharpest rise over 0.3 m in the ground
profile along the crossing:

* ramp: rise of 4.5 cm or less;
* kerb: rise of 10 cm or more;
* unknown: anything in between.

Truth: SF Public Works' curb ramp inventory (DataSF), corner by corner. Haight-Castro, 620
crossing ends:

| Answer | Right | Precision | Recall |
|---|---|---|---|
| ramp | 207 / 208 | **99.5%** | 37% |
| kerb | 6 / 88 | 7% | — |
| answered | 51% | | |

**Use the "ramp" answers only, as candidates.** Most "kerb" answers fall on corners the
inventory records as having a ramp. The mapped crossing end is often a metre or two off the
ramp itself, so the profile catches the kerb beside it.

Not done:

* Mapillary curb-cut classes. Earlier tests found Mapillary point features imprecise: only
  30–46% fell within 8 m.
* Project Sidewalk's Bay Area coverage. Neither source was downloaded.

## Stairs from the lidar

A footway steeper than 0.45 sustained over 2 m. Truth: OpenStreetMap `highway=steps`.
Haight-Castro, 232 footways:

* 63 of 85 mapped flights were found (recall 74%).
* 23 candidates are not mapped (73% precision against the map). Some may be real stairs that
  are missing from the map.

## Entrances (`scripts/test_entrance_snap.py`)

The method:

1. Take the outline edge facing the addressed street.
2. Put the door at that edge's middle, or where a front walk meets it.

Truth: 244 OpenStreetMap entrances on building outlines. 186 of them are on buildings whose
addressed street is in the payload.

| | Right street front | Door within 3 m | Median error |
|---|---|---|---|
| Addressed street, facade midpoint | 59% (78% on buildings under 600 m²) | 16% | 10.4 m |
| Front walk contact (found for 5%) | | 17% | 11.2 m |
| Baseline: the wall nearest any street | 43% | 13% | 15.7 m |

* The address picks the right wall for most houses.
* It does not place the door along that wall. That needs the opening detector on the
  photographed facade (83% of doors in the HABS test), which was not run here.
* Nothing is drawn from this test.

## Accessibility published by businesses

OpenStreetMap's `wheelchair=*` is the open copy of what businesses publish under the ADA (step-free
entrance, accessible toilet). Google's and Yelp's listings carry the same attributes, but their
terms forbid storing them.

`scripts/fetch_access_osm.py` wrote `docs/sf-corridor-access.json` for the corridor:

* 323 entrances (250 on a building);
* 1,377 places with `wheelchair`: 903 yes, 350 no, 78 limited;
* 462 flights of steps;
* 1,276 kerbs: 879 lowered, 172 flush, 26 raised.

The viewer's building card (S) shows a building's entrances and its places' wheelchair access,
marked as published to OpenStreetMap and not checked.

## Street paint: crosswalks (`src/smc/imagery/crosswalks.py`, `scripts/test_paint_crosswalks.py`)

**A test bench only. Lanes and crossings are not changed.**

The method reads NOAA's 0.25 m photograph along each mapped crossing and answers paint,
no_paint or unknown.

* **Pattern:** continental bars are read as a 0.9–1.6 m period in the red-and-green channel, so
  white and yellow paint both count. Edge lines are read as bright ridges along the walk.
* **Quality gates:** canopy (NDVI), shadow, glare, and "not road surface" (building lean in an
  ordinary orthophoto).
* **Geometry gates:** the bars must agree across both halves of the walk.

Truth: OpenStreetMap `crossing:markings`, and SFMTA's continental crosswalk inventory (an
independent record). 3,082 crossings, all at 0.25 m. Thresholds were tuned for 99% precision
on one half (split by hash) and measured on the other.

| | Paint precision | Recall |
|---|---|---|
| Tuning half | 99.0% | 31% |
| Test half, all | 97.9% (321/328) | 32% |
| Test half vs SFMTA's inventory | 100% (94/94) | |
| Test half vs OpenStreetMap | 97% (227/234) | |

* **Disagreements:** all 7 on the test half were painted crosswalks that OpenStreetMap marks
  "no". A visual check confirmed paint on every one, so against the photographs it is 328/328.
* **"No paint":** cannot reach 99% (36–52%), so it is turned off. The method answers paint or
  unknown.
* **Gated to unknown:** 369 in shadow, 350 under canopy, 85 not road surface, 4 glare.
* **Imagery:** NAIP (0.6 m) is too coarse for either style and is always answered unknown.
  Oakland's NOAA cover was NAIP-grade, so held-out cells came from Berkeley instead.

Not done:

* Lidar intensity as a second opinion.
* Storing paint as "confirmed" (a second independent source agrees) or "candidate". Until that
  exists, nothing from this reader may override the inferred lanes.
