# Storefront lab run: marina-union, corridor `chestnut`

Sweep built 2026-11-24T08:26:28+00:00. Frames: 123,911 Mapillary images (mapillary-graph-v4, 880 tiles of 0.000625°, retrieved 2026-11-24T08:08:38+00:00).

## Sweep (whole area)

| | count |
|---|---|
| registry rows | 3,825 |
| overture rows | 2,698 |
| osm rows | 458 |
| shared_spaces rows | 76 |
| parklet rows | 4 |
| businesses | 5,511 |
| storefronts | 851 |
| storefronts with face | 833 |
| storefronts multi source | 559 |
| buildings | 4,673 |
| faces | 43,427 |
| street faces | 13,992 |
| storefronts by corridor | union 309, other 167, chestnut 142, lombard 139, fillmore 57, steiner 21, scott 15, divisadero 1 |
| outdoor seating on record | sidewalk 74, parklet 2 |

Storefront name confidence: median 0.75, 370 (43%) at or above 0.8.

Address contests: previous_or_upstairs 347, occupant 233.

## Stage 1: geometric frame filter (142 storefronts)

111,426 frame-and-storefront pairs within range were assessed.

| outcome | pairs |
|---|---|
| face_too_small | 37376 (34%) |
| grazing | 22275 (20%) |
| face_out_of_frame | 15485 (14%) |
| ok | 10540 (9%) |
| occluded_by_building | 9741 (9%) |
| too_far | 8643 (8%) |
| behind_face | 7366 (7%) |

* storefronts with at least one usable frame: 135 (95%)
* with a `sign` slot (current tenant, sign-grade resolution): 98 (69%)
* slots filled: extra 305, elevation 131, oblique-left 127, oblique-right 123, sign 98
* flags on picked frames: pre_tenancy 170, pre_alteration 133, night 68, into_sun 40, sign_text_unreadable 28
* sign-slot frame age: median 4.5 years
* no usable frame (7), dominant reason: face_too_small 7

## Stage 2: pixel checks (40 storefronts, top picks + one near-miss each)

| verdict | frames |
|---|---|
| ok | 170 (69%) |
| face_cut_by_frame_edge | 41 (17%) |
| street_occluded | 19 (8%) |
| bad_exposure | 13 (5%) |
| blurry | 2 (1%) |

Kept frames, medians: building share 0.80, storefront occlusion 0.09, sign cover 0.008, Laplacian variance 386, exposure 1.00.

Examples (business: final shot list):

* Body Temp Yoga (2425 CHESTNUT ST): sign 1324537558377509, elevation 646095133907824, oblique-left 853154406106313
* Fiori San Francisco (2314 CHESTNUT ST): sign 535124168174716, elevation 530040705692938, oblique-left 2311842266312269, oblique-right 1481322325538229, extra 153385853572117
* Books Inc. (2251 CHESTNUT ST): sign 829367578286923, elevation 249425490358382, oblique-left 346624963603958, oblique-right 836345557407020, extra 1673204761085565
* MUSE JUICE BAR (2220 CHESTNUT ST): elevation 157994929775723, oblique-left 187824540463390, oblique-right 1254798634976555, extra 274581891117773
* Popi's Oysterette (2095 CHESTNUT ST): elevation 692116948887693, oblique-left 510187490083568, oblique-right 1031936207613425, extra 460183042721890, extra 3247022665558278
* Boho Petite (2146 CHESTNUT ST): elevation 502171801973751, oblique-left 348640603566802, extra 369146888746505, extra 131701946381538
* Fiona McLaughlin Hair (1327 CHESTNUT ST): sign 1152253975426894, elevation 569693994037591, oblique-left 241142821095239, oblique-right 299951754953692, extra 361668565414896
* Timbuk2 (2128 CHESTNUT ST): elevation 460662906193994, oblique-left 348627583585845, extra 844665136442121, extra 551038003520876, extra 2315131125285274
* BeRadiant Salon Suites (1327 CHESTNUT ST): sign 139116258917115, elevation 241142821095239, oblique-left 484619292742014, oblique-right 569693994037591
* California Wine Merchant (2113 CHESTNUT ST): sign 855308155597139, elevation 4513367198673422, oblique-left 543243180161325, extra 544540416785055
* SF Optics (2248 CHESTNUT ST): sign 139204012241015, elevation 228394552376770, oblique-left 774526283210788, extra 1834059034268202
* American Giant (2076 CHESTNUT ST): sign 1545869115859177, elevation 203330638430420, oblique-left 149424067840590, oblique-right 956730251772791, extra 114895704635593

Imagery: Mapillary, CC BY-SA 4.0. Frame ids open at https://www.mapillary.com/app/?pKey=<id>.

## Other corridors, stage 1

| corridor | storefronts | with usable frames | with a sign shot |
|---|---|---|---|
| Lombard | 138 | 133 | 106 |
| Union | 309 | 277 | 190 |
| Fillmore | 57 | 56 | 38 |

## Hand review of contact sheets

I reviewed eight Chestnut sheets: Popi's Oysterette, Body Temp Yoga, Books Inc., SF Optics,
Réveille and three panorama spot checks. The images themselves are not committed.

**What the filters got right**

* Every kept crop landed on the intended building's ground storey.
* Panorama orientation (heading at the centre column) was confirmed: the Books Inc.
  panorama crop is centred on the Books Inc. facade.
* Rejected frames were correctly rejected:
  * a tree-blocked, dark elevation (`street_occluded`, `bad_exposure`);
  * a car-blocked oblique (occlusion 0.86);
  * a motion-blurred oblique (Laplacian 22);
  * a down-the-street view with the face at the frame edge (`face_cut_by_frame_edge`).

**What the records got wrong, which the photos exposed**

* **The named business's own sign is clearly visible for Books Inc. and Réveille.** For
  Réveille, the green awning and the blade sign appear in the oblique-left shot.
* **Body Temp Yoga:** the frames show the ground-floor laundromat, "The Missing Sock". The
  yoga studio is upstairs, and the records do not say so.
* **SF Optics:** the 2021–22 frames show "Project Juice", most likely the previous occupant.
* **Fiori:** one frame shows "Cut'N Curl 2320" next door, because the inferred span is off
  by one shop.

These are exactly the errors that stage 4 (measured spans) and stage 5 (reading sign text and
confirming identity) exist to catch. The photos see the true current state, and the records
are a prior.

**Bugs this review caught, now fixed**

* Recess faces (notch edges) are no longer taken as frontages.
* Frames where the face sits at the edge of the field of view are rejected.
* Sliver views are rejected.
* Panorama crops are no longer upsampled, so blur measures shake rather than distance.
* Panorama sign shots are fetched at full resolution.
* Occupancy runs from the earliest registration. Books Inc. has a 1998 registration and a
  2025 re-registration; using 2025 had zeroed every frame of it as "pre-tenancy".

## Hand-off check

* `tools/check_with_engine.py` ran Kerbside's own `smc.exteriors`
  (`ExteriorInput.from_json` → `infer_exterior` → `validate_exterior`) on the generated
  programs.
* All 71 Chestnut programs (142 tenants) passed.
* All 448 programs for the whole area passed.
