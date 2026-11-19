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
| **Inferred ground** | 866 patches: 386 told by shape (narrow or small), 381 "concrete", 93 mixed | **not trusted**: back yards read as concrete where roofs lean over them; not used |

Drawn now from this: no red box where there is none, a pale pad where there is one, and no
word or stop box where the photograph shows bare road.

Not drawn yet: the courts it found, the straightened gutters, and any change to inferred ground.

## What a quarter of a metre a pixel cannot do

- Read letters: a legend is "paint here" or "none", not which word.
- See a chain-link fence, a hoop or a post: a court is told by its lines.
- See under trees, parked vehicles or the deep blue shade on the north side of every block:
  a quarter of the legends are unseen for this reason.
- Tell a roof from a yard where a building leans over it.

A finer source (OpenAerialMap's 2-5 cm drone mosaics, where there are any) would lift the first
two; none covers the Marina.
