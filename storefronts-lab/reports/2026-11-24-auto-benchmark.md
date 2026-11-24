# Automatic reading vs the reviewed five (2026-11-24): not there yet

The five restaurants were rebuilt by a reviewer reading rectified photos. The point of
`kerbfront auto` is to do the same with no reviewer, so it scales. `kerbfront score` checks
the automatic model against the reviewed one, part by part. There are 111 checks over the walls
the reviewer read, each against a tolerance a person would accept. The tolerances are listed
in `kerbfront/auto/score.py`.

**Result: the automatic reader does not match the reviewed models.** It agrees on 19 of 111
checks (17%). The pipeline alone, with no photo reading at all, agrees on 21 of 112 (19%).

| check | auto | what goes wrong |
|---|---|---|
| height | 4/5 | sky line on the registered elevation; Balboa's 3.05 m front is under a taller rear wing |
| storeys | 1/5 | follows from the band top and the window rows |
| wall colour | 1/9 | the fused median of shaded frames is darker and greyer than the paint the reviewer picked; ornate fronts (Tacolicious) have no dominant "wall" colour |
| material | 2/9 | CLIP on the upper wall: brick read as siding or render |
| upper windows | 1/9 | Grounding DINO finds them (all 8 on A16), but the elevation's anchor puts them 0.25–0.45 m off along the wall, under the IoU 0.4 tolerance |
| storefront band | 1/9 | the band top is a judgement (fascia, belt, awning top); 0.45 m tolerance |
| doors, awnings, signs | 1/24 | blades and channel letters are off the wall plane or thin; awnings are found but split differently |
| seating, trees | 2/12 | parking-lane and kerb planes, from ADE20K labels re-projected; few frames register |

## What was built

* `kerbfront/auto/camera.py`: Mapillary's solved poses (`computed_rotation`, OpenSfM lenses).
  Headings agree with the photo headings exactly. Pitch of 4–11° explains the stretched
  heights seen earlier.
* `elevation.py`: each frame is rectified onto the wall, then registered to the others by a
  pose-guided feature vote. A plain ratio test fails on repeated fins and windows. The set is
  then pinned to the LiDAR corners and to the pavement line. Tacolicious registers 8 of 10
  frames, the others 1–3 of 6.
* `segment.py`: ADE20K labels read in each photo's own geometry, then carried onto the wall.
  On the fused elevation itself the parser calls everything "building".
* `detect.py`: Grounding DINO prompted with "window. door. awning. sign." on the elevation.
  This is the step that works: ADE20K has no outdoor window class.
* `read.py` / `run.py`: from those to observations in the reviewer's format
  (`observations/auto/<id>.json`, each with frames and method), then to `models/auto/<id>.json`.
* `score.py`: the part-by-part check, and a second check against the photo's own labels.
* `sheet.py`: the registered photo with the reviewed parts over one copy and the automatic
  parts over the other (`out/auto/<id>/sheet-w<edge>.jpg`).

## What would close the gap, in order of payoff

1. **The anchor.** Most window, door and sign misses are placement errors of 0.2–0.5 m.
   Registering to the reviewed models' own photo alignment would show how much is left.
   Alternatively, anchor on the detected windows' symmetry about the wall's centre.
2. **Reading like the reviewer.** The reviewed readings were made by a vision-language model
   (Claude) looking at these same elevations with a metric grid. The same step run through the
   API, followed by the image-measured snapping built here, is the most direct route to
   matching them. It needs an API key and the owner's go-ahead for the spend: a few cents a
   building.
3. **Colour from the best-lit frame**, with the wall chosen as what the detected windows sit
   in. This is half built (`Wall.lit_colour`, `ring_colour`).

## Fabric

The app's photo cladding reader took awnings for wood siding in the awning's colour. That is
fixed separately, on branch `claude/facade-fabric-materials` (commit e999323f7, not pushed).
CLIP now has fabric and smeared answers, works per tile, and leaves fabric pixels out of the
colour. In the studio, awnings, umbrellas and fabric parklet roofs use a `canvas` finish, and
the awning inspector has a Cover field.

## Qwen flow (`kerbfront qwen-run`), same day

Item 2 above is now built. The owner supplied an OpenRouter key, kept in `.env.local`, which is git-ignored. The model is `qwen/qwen4-max`, with reasoning off.

**Filtering before any call.** A wall reaches Qwen only if it passes all of these:
* the business renders as a restaurant;
* it is open, or its status is unknown;
* it has a storefront face (likelihood ≥ 0.5) on a building;
* it is not on an upper floor or in a suite;
* at least two Mapillary frames were picked for it;
* the fused elevation covers at least 40% of the shop band;
* the detector found something on the wall;
* no other business on the queue already claims that wall.

That leaves 140 walls. Filtered out:

| reason | walls |
|---|---|
| no frames | 73 |
| shared wall | 22 |
| no storefront wall | 9 |
| upper floor | 3 |

**What one call carries.** Each wall gets one call:
* two JPEGs, at most 1100 px wide: the registered elevation with a metric grid, and the best-lit frame;
* the record facts and the detector boxes as short text;
* a fixed example object.

The answer is capped at 900 tokens. Answers are cached by the hash of the request, so a rerun costs nothing. A spend ledger (`out/qwen/spend.jsonl`) stops the run at `--budget`.

**Cost.** The first 9 walls cost $0.046, about $0.002–0.0055 a wall and 11–35 s each. The whole queue should cost about $0.50.

**Accuracy on the reviewed five's storefront walls:**

| reader | checks matched |
|---|---|
| Qwen | 25/70 (36%) |
| pipeline alone | 14/70 (20%) |
| CV-only reader | 17% |

| check | Qwen |
|---|---|
| height | 3/5 |
| material | 4/5 |
| glazing | 3/5 |
| wall colour | 3/5 |
| doors | 0/5 |
| belts | 0/5 |
| upper windows | 1/5 |

Upper windows still fail because of the anchor offset.

**Verdict:** better, but it does not match the reviewed readings yet.
