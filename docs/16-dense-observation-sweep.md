# 16 · Sweeping the corridor for every observation

The corridor catalogue was built sequence-first: ask each provider which sequences touch the
region, then read those sequences. It produced 1,628 observations — 1,379 from Panoramax and
249 from KartaView — and the KartaView number was wrong by two orders of magnitude.

## Why the sequence-shaped read failed

A sequence is a drive. On KartaView a drive routinely crosses a whole city, so reading one to
reach the four blocks of it inside a bounding box spends nearly every request on frames that
are then thrown away. The previous run hit its own safety cap and said so:

```
"errors": [
  "sequence 7235: stopped after 12 photo pages",
  "sequence 12109: stopped after 12 photo pages"
]
```

Twelve pages is 1,200 frames of a drive, and the drive was longer than that. Three sequences
survived the cap; the region has far more than three. Raising the cap does not fix the shape of
the problem — it makes each of a few long drives more expensive without reaching the drives the
sweep never got to.

## The place-shaped read

Both archives can answer "what is at this place", which is the question a bounded region
actually asks. The two answer it differently, and the difference decides the cost.

**Panoramax** returns whole STAC items from `/search`. The response that finds a frame already
describes it — geometry, EXIF, interior orientation, licence — so nothing further is fetched per
frame. Only the collection record is read separately, once each, and cached.

`api.panoramax.xyz` federates: the whole corridor comes back in a single request, and every
one of the 164 items `panoramax.openstreetmap.fr` holds for the same box is already among them.
Sweeping a second instance adds nothing, which is worth writing down because it is the sort of
thing that otherwise gets re-checked every few months.

**KartaView** splits it. `POST /1.0/list/nearby-photos/` locates frames but its rows carry no
width or height, so resolution has to be bought in a second pass. The endpoint that sells it,
`GET /2.0/photo/`, takes a comma-separated list of ids:

```
GET /2.0/photo/?id=6151752,6151753,...
```

It answers for a hundred at once and silently truncates above that — asking for two hundred
returns one hundred rows and no warning, which is why the batch size is pinned to what was
measured rather than to what seemed reasonable. A hundred at a time is the whole reason this is
affordable: sixty thousand frames cost about six hundred requests instead of sixty thousand.

The sweep grid is spaced 150 m with a radius of 120 m — four-fifths of the step, so neighbouring
samples overlap at the corners. At exactly half the step, four adjacent samples leave a
diamond-shaped hole between them and a street can run straight down it.

Sweep requests are issued six at a time. `HttpClient` cannot be shared to do that: its rate
limiter and its counters are plain attributes, and concurrent use would corrupt both while
quietly defeating the minimum interval it exists to enforce. Each worker thread gets its own
client, copied from the configured one, so the polite interval stays honest per connection.
Serial, the sweep ran at about fourteen seconds a point and would have taken over two hours;
parallel it finished in twenty minutes.

## What is kept

Four gates, all of them facts read from the provider rather than estimates:

- inside the bounding box, by the frame's own coordinates
- a real provider image id
- not withdrawn upstream
- no smaller than **1440 × 1080**, about 1.56 MP

That last one is the glasses' own delivered frame. An archive image below it cannot be reduced
to match what a wearer's camera produces, because it is already smaller, and upscaling it would
invent detail the photograph never held. The previous floor was a round 2 MP, which is stricter
than the thing it was standing in for; the constant now names what it is.

Deduplication stays exact — same provider, same instance, same image id. Near-duplicate
collapsing is a judgement about viewpoint and it belongs downstream of the catalogue, not inside
the thing that records what the providers hold.

## A note on neighbour links

`previous`/`next` now chain in-region frames only. Where a drive leaves the box and returns,
consecutive links span that absence. This is the neighbour order of the catalogue, not of the
original drive: a consumer walking the chain is walking coverage, and should not read the gap
between two links as a distance the camera travelled.

## The result

| | before | after |
|---|---|---|
| observations | 1,628 | **63,356** |
| eligible | 1,619 | 63,347 |
| sequences | 19 | **542** |
| coverage cells (h3 r10) | 171 | **711** |
| Panoramax | 1,379 | 1,379 |
| KartaView | 249 | **61,977** |
| errors | 2 | **0** |

Panoramax did not move, and that is the check that the method is sound rather than merely
bigger: the search route and the collection route independently return the same 1,379 frames, so
the corridor really is exhausted there. KartaView moved by a factor of 249 because the previous
number was never a measurement of the archive — it was a measurement of where the page cap fell.

What changed underneath the totals matters more than the totals. The best-covered cell used to
hold 26 frames from 3 sequences with a heading diversity of 0.375. It now holds 259 frames from
25 sequences at a heading diversity of 1.0 and a temporal diversity of 1.0 — every compass
octant, every time bucket, ten years apart. That is the difference between a place that has been
photographed and a place that can be corroborated: independent passes, different directions,
different days, different cameras.

Nine observations are ineligible, all Panoramax, all for the same reason — the provider reports
no pixel dimensions for them, and an unverified resolution is not treated as a passing one.

## Reproducing it

```bash
.venv/bin/python scripts/harvest_region_observations.py --provider panoramax \
  --out data/sf_corridor_panoramax_dense
.venv/bin/python scripts/harvest_region_observations.py --provider kartaview \
  --kartaview-step-m 150 --workers 6 --out data/sf_corridor_kartaview_dense
./tools/refresh_catalog.sh
```

The harvest is deliberately not inside `refresh_catalog.sh`. It takes half an hour and it leans
on two volunteer-run APIs, so it stays something a person chooses to do rather than something a
build script does on their behalf.
