# How sure the Marina's junctions and kerb islands are, 2026-11-26

Every intersection and every kerb island in City mode's area (module 30 `CITY_AREA`) has two
scores between 0 and 1:

- **its own confidence**: how much of what the page draws at that place is backed by sources
  that agree with each other;
- **its surroundings' confidence**: the same question for the ground within 25 m of it.

The page never counts its own drawing as evidence. A score lists each piece of evidence beside it,
so it can be checked by hand.

- Built by `smc.facts.marina_confidence`.
- Written by `tools/build_marina_confidence.py` to `docs/marina-confidence.json`.
- Shown in the game by `kerbsideConfidenceOverlay(true)` (module 30). It draws a ring at each place,
  coloured by its own score inside and by its surroundings' score outside: green high, amber medium,
  red low. `kerbsideConfidence()` returns the file.

The bands are **high** at 0.8 or more, **medium** from 0.55 to 0.8, and **low** below 0.55.

## Islands

**The prior** comes from how the island is known.

| How the island is known | Prior | Lidar read it raised |
|---|---|---|
| Confirmed by the owner's photograph (`CONFIRMED_SURVEY_ISLAND_LINES`) | 0.95 | — |
| Survey kerb, confirmed raised in the 0.25 m aerial photographs | 0.90 | 13 of 13 |
| Survey fragment the photographs could not confirm | 0.80 | 15 of 15 |
| Closed in the survey, not seen in the photographs | 0.75 | — |
| Photograph outline alone | 0.60 | 3 of 4 |

The priors sit a little under the measured rates. The islands the lidar did not read are smaller
and lie off the long medians it follows.

**The evidence**, added in log-odds:

| Evidence | Weight |
|---|---|
| The lidar read a raised median along the island | +1.6 |
| The lidar read it as paint and nowhere raised | −2.0 |
| A mapped crossing lands on it | +0.5 |
| A kerb ramp stands on it | +0.7 |
| The survey's kerb runs round a photograph-only outline | +0.6 |
| A sliver no one could stand on | −1.2 |
| Over 1,500 m² (a park or a block, not a traffic island) | −4.0 |

The first scoring gave the survey fragments 0.4, on the guess that the photographs' silence meant
they were wrong. The lidar showed the opposite: every one it read was raised. The fragments were
under trees or shadow, or their kerb was low. The priors above are the corrected ones.

## Intersections

**The prior** is one in four: OpenStreetMap's node alone.

**The evidence:**

| Evidence | Weight |
|---|---|
| The city's centreline network has a node within 4 m (half credit to 10 m) | +1.1 |
| The two networks agree on the number of legs | +0.7 |
| Stop signs on every approach (half credit for some) | +0.6 |
| The city's crosswalk inventory at the junction, within 15 m | +0.5 |
| The survey's kerb in each corner between legs | +1.0 |
| Kerb ramps at those corners | +0.6 |

At a 30 m reach every Marina junction had a crosswalk record, so that test said nothing. It is
15 m now.

## Surroundings

Four things within 25 m are combined:

| Part | Weight | What it measures |
|---|---|---|
| The kerb | 0.45 | The share of points 4 to 8 m either side of the streets that have a survey kerb within 3 m |
| The junctions | 0.25 | The mean of their scores |
| The islands | 0.15 | The weakest island's score |
| The crossings | 0.15 | The share of the city's crosswalks that OpenStreetMap also maps |

## How accurate the scores are

**Islands.** The lidar's reading on an island is the truth where there is one: raised, or flat.
For each such island, the score is recomputed without the lidar and checked against the truth.

- 32 islands were read: 31 raised, 1 flat.
- The scores without the lidar rank them with an AUC of 0.94.
- In the high band, 25 of 25 were raised; in the medium band, 5 of 6.

**Intersections.** There is no ground truth, so each source is held out in turn. The score from
the remaining sources must rank the junctions that source supports above those it does not:

| Source held out | AUC |
|---|---|
| The centreline network | 0.94 |
| The survey's kerbs | 0.88 |
| The crosswalk inventory | 0.97 |
| Traffic control | 0.69 |
| Kerb ramps | 0.67 |

These are well above 0.5, which is chance, so the sources agree with one another; the weights are
not taken on trust.

## The Marina today

**Intersections: 112.**

| Band | Count |
|---|---|
| High | 86 |
| Medium | 16 |
| Low | 10 |

The low ones are mostly where OpenStreetMap has a node the city does not: driveways into the
Marina Green lots, Yacht Road, and the Palace of Fine Arts loop.

**Islands: 81.**

| Band | Count |
|---|---|
| High | 72 |
| Medium | 3 |
| Low | 6 |

The low ones are the survey's closed outlines of park-sized areas (a block, the Green), which are
not traffic islands.

Rebuild after any source changes:

    .venv/bin/python tools/build_marina_confidence.py
