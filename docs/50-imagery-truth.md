# 50. What the aerial photograph says: invisible buildings, paint that is not there, courts and gutters

2026-11-19. Three things: buildings that had doors and no walls; a pass that checks what the
page has only inferred against the aerial photograph; and what that pass can and cannot do.

## Buildings with doors and no walls

Found by measurement, not by eye: the shadows' top-down height map (docs/proxy-light.mjs) says
how high the world stands at every point, so each building's footprint can be asked whether
anything stands in it. Of some 1,500 footprints across the Marina, these did not:

| what | why | now |
| --- | --- | --- |
| 41 buildings outside the survey's coverage (`covered: false`): the houses of Casa Way and Rico Way, the park buildings at Moscone | the renderer drew a faint plate on the ground and no walls; the city put a door there all the same | drawn, at the city's lidar height |
| the Lombard Garage (4 storeys, 1,900 m2) and the Pierce Street Garage | archetype "parking" is drawn as a lot: a slab and bay lines | a car park measured over 5 m high is a building |
| footprints under 8 m2 (kiosks, slivers) | no walls are drawn for one, and it had a door | not a place; no door |

After: nothing missing round Moscone Park (497 footprints checked). One pair of overlapping
gap-fill footprints near Greenwich and Steiner still stands only in part.

## The pass (`smc.truth.imagery_truth`, `tools/build_imagery_truth.py`)

1. `tools/truth/export_candidates.mjs` dumps from a running page what is inferred or painted:
   the triangles of each such surface, the building footprints, the mapped courts, and a few
   hundred buildings both ways so the photograph can be laid over the page's frame.
2. `tools/build_imagery_truth.py` reads NOAA's 0.25 m 2025 mosaic (CC0, `smc.imagery.ortho`)
   under each thing and judges it. **Every result is appended to a journal and synced to disk
   as it is made** (`build/imagery-truth/<name>.jsonl`); stopped at any moment and run again, it
   goes on from where it was. The Marina takes two minutes on this Mac.
3. `docs/imagery-truth.json` (31 KB) is what the page reads: only what changes what is drawn,
   and one point both ways so a page of other ground ignores it.

The photograph only ever takes away what it can **see** is not there. Under a tree, a parked
bus or deep shade a thing is "unseen" and the page keeps what it had.

## What it found in the Marina, and how far to trust each

The page's frame fits the photograph to 0.7 cm (394 buildings); laid over the photograph, the
zones sit on the kerb lane.

| task | result | how it was checked |
| --- | --- | --- |
| **Bus zone red** | 27 zones: 0 red, 16 bare road, 10 a concrete bus pad, 1 unseen | the same test on Van Ness's real red bus lanes reads 53-75% red in six of six windows; the Marina's zones read 0% |
| **Road legends** | 270: 173 there, 21 not, 76 unseen | paint share is 0.18 (median) where judged there and under 0.011 where judged not; judged by eye on a sheet of the 21 |
| **Courts** | 7 rectangles of line on paved ground, 3 of them the Marina Middle School yard's basketball courts | on the school yard and Moscone's courts directly: all six big painted courts found; before building footprints were excluded it "found" 75, nearly all roof parapets |
| **Gutters** | 2,385 pieces along the kerbs become 311 straight strips (median 0.46 m wide; pieces were 0.22 m off the line at the median, 0.93 m at worst); the pale gutter pan shows under 137 | not checked against a survey |
| **Inferred ground** (first pass) | 866 patches: 386 told by shape, 381 "concrete", 93 mixed | **not trusted**: roofs lean over yards. Replaced by the second pass below |

Drawn now from this: no red box where there is none, a pale pad where there is one, and no
word or stop box where the photograph shows bare road.

Not drawn yet: the courts it found (the school's own were already mapped).

## Second pass, 2026-11-19: gutters and pavement, with more than the one photograph

### Gutters (no photograph needed: a gutter is a straight strip along a block)

`docs/waterworks-renderer.mjs` laid the pan sample by sample at each street's nominal half-width,
keeping or dropping each sample by whether the roadway happened to stop just there; wherever the
drawn kerb stood a little off the nominal line the pan came and went every metre or two. Now, for
each run of street that goes straight on (a block), the kerb's real distance out is measured
every three metres, the middle one taken for the block, the pan laid on that one line, breaks of
up to nine metres closed (a driveway) and scraps under five left out.

| the Marina's gutter strips | before | now |
| --- | --- | --- |
| pieces | 1,464 | 657 |
| a piece's length, the middle one | 5.9 m | 66 m |
| scraps under 5 m | 668 | 86 |
| total length | 43.3 km | 43.9 km |

The photograph agrees where it can see: the pale gutter pan shows under 137 of the 311 lines the
pieces fall on (most of the rest are in shade or under parked cars).

### Pavement, ring by ring (`run_cover`, `judge_cover`, `by_neighbours`)

The first pass failed on roofs leaning over yards. This one reads the ground-cover file's own
rings (`docs/app-sf-corridor-ground.json`: commercial and public lots, service yards, the
inferred fill) and uses four things, in order:

1. **the photograph with the roofs and the shade left out**: every building footprint, grown a
   metre and a half for the lean, is not ground; a lot is judged on the open ground beside its
   building (15 m2 of it is enough);
2. **a second photograph**: USDA's NAIP of May 2022 (0.6 m; another year, season and sun), asked
   the one thing it can answer at its grain -- growing, or hard. The two agree on 141 of the
   160 rings both could see; where they disagree the ring is not called;
3. **shape**: a strip under 3 m wide or a patch under 60 m2 keeps the page's own inference
   (2,553 of the inferred cells' patches);
4. **the neighbours**: a ring neither photograph could call takes the kind of the rings of the
   same list within 70 m when three or more of them are 70% one thing (45 lots).

| in the Marina | called | of which by neighbours | not called |
| --- | --- | --- | --- |
| commercial and public lots (244) | 77 asphalt, 16 concrete, 6 grass | 45 | 145 (108 unseen, 37 mixed) |
| service yards (279) | 7 concrete, 4 asphalt, 2 grass | 0 | 266 |
| inferred fill, patches over 60 m2 (57) | 23 concrete, 6 asphalt, 3 grass | 0 | 25 |

Drawn from it: 77 lots in asphalt instead of the footway's concrete (the Marina Middle School
yard among them: 26,000 m2), 6 lots and 2 service yards in grass, 7 service yards and 22 fill
patches as paving, 5 fill patches as asphalt.

Still not called: most service yards (the rings are the whole parcel and nearly all roof).
Other sources looked at: the city's lidar (its heights are in already; its intensity would tell
asphalt from concrete, but the point cells are archived off this machine); Waymo's open data
does not cover these streets as a map; street-level photographs would settle the lots hidden
from above and are the next source to add.

## What a quarter of a metre a pixel cannot do

- Read letters: a legend is "paint here" or "none", not which word.
- See a chain-link fence, a hoop or a post: a court is told by its lines.
- See under trees, parked vehicles or the deep blue shade on the north side of every block:
  a quarter of the legends are unseen for this reason.
- Tell a roof from a yard where a building leans over it.

A finer source (OpenAerialMap's 2-5 cm drone mosaics, where there are any) would lift the first
two; none covers the Marina.
