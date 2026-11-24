# From raw photos and records to recognisable Marina storefronts

This is the plan for the storefront lab (`storefronts-lab/`, package `kerbfront`). It is a
second system next to Kerbside's exterior engine. Its job is to make each Marina business
**unmistakable for what it is**. That means the right building theme, materials and colours,
the real sign text in roughly the real lettering and place, the actual awning, and the
sidewalk tables or parklet if there is one. Every claim must trace back to a photo or a
public record.

Stages 1–3 below are built and tested. Stages 4–8 are the path from there to finished
buildings, written so each one can be picked up and built.

## 0. What "recognisable" means, and how it is checked

Someone who knows Chestnut Street should name the business from the street in the game,
without a label. Concretely, each storefront is checked against a held-out photo (one not
used to build it) on six things:

| # | Check | Pass threshold (first cut) |
|---|-------|----------------------------|
| 1 | Sign text: OCR of the render matches OCR of the photo | normalized edit distance ≤ 0.2 |
| 2 | Sign placement and size in the rectified facade | box IoU ≥ 0.5 |
| 3 | Ground-storey openings (doors, windows, transoms, bulkheads) | IoU ≥ 0.7 per opening, none missing |
| 4 | Material and colour per region (bulkhead, storefront frame, wall, trim, upper storeys) | label match; CIEDE2000 ≤ 10 |
| 5 | Awning presence, shape and colour; lettering if any | exact for presence and shape; ΔE ≤ 12 |
| 6 | Outdoor seating kind and extent (sidewalk tables, parklet length) | kind exact; length ±1 m |

A vision-language model also gives a pairwise "same storefront?" judgement with a fixed
rubric. It is a second opinion, not the gate. A building whose storefronts all pass is
`verified`; any fail makes it `needs-review`, and it gets a contact sheet.

## 1. How it fits with what Kerbside already has

| Existing (`src/smc`, `docs/`) | What it does | How the lab uses it |
|---|---|---|
| `smc.exteriors` (docs/30–32) | Fits a source-backed facade program to a footprint: category priors, 21 chain families, sign/awning/opening renderer | **The renderer.** The lab writes its input contract, adding measured openings, signs, colours and bands. The lab never draws buildings itself. |
| `smc.facades` (`rectify`, `survey`, `coarse_openings`, `poses`) | Rectifies facade photos and finds openings, storeys and rooflines | Stage 4 calls it on the frames the lab selected, instead of the frames it picks for itself |
| `smc.truth` (PR #209) | Photo-verification journal | Stage 7 writes each storefront check into it as an observation |
| `docs/city/storefronts.mjs` | Awnings and window displays in the living city | Receives awning and seating props from stage 6 |
| `data/places/*.json` | Overture places joined to OSM buildings | Not reused: the lab rebuilds from the same parquet so every field keeps its provenance |

The lab reads the main checkout's `data/` but never writes to it. The hand-off to the
engine is `handoff.py`. It writes one program per building, in the docs/30 contract, plus a
`kerbfront` block that the engine ignores today.

## 2. Area and priority

* The Marina box is Marina Blvd to Lombard, Lyon to Van Ness (`config.MARINA`). The
  extended area `marina-union` adds the Union Street band in Cow Hollow.
* Corridors, in priority order: Chestnut (Fillmore–Divisadero), Lombard, Union
  (Van Ness–Steiner), Fillmore, then the side streets.
* Measured profile of the storefront buildings (assessor roll, 2025):

| Corridor | Buildings | Built | Storeys | Construction | Historic (CEQA A) |
|---|---|---|---|---|---|
| Chestnut | 71 | 49 in the 1920s–30s | 32 single-storey | 50 wood (D), 17 masonry/concrete (C) | 15 |
| Union | 140 | 93 in the 1900s | 2–3 | 127 wood | 8 |
| Lombard | 109 | spread; 1900s and 1950s peaks | 2–3 | 87 wood | 4 |
| Fillmore | 39 | 1900s–10s | 2–3 | 32 wood | 1 |

These numbers set the style families in stage 5. Chestnut's 1920s–30s single-storey
commercial blocks are the Period Revival, Mediterranean Revival and Art Deco/Moderne
storefronts the brief describes. Union Street is mostly Victorian and Edwardian houses
with shopfronts added on the ground floor. Lombard is the motor-court and motel strip.
The style families are a prior to confirm per building from photos (stage 5), not an
assignment.

## 3. Stage 1 — data sweep (built: `kerbfront sweep`)

Every source was checked live on 2026-11-23. Counts are for `marina-union`.

| Source | id / endpoint | Rows | Contributes |
|---|---|---|---|
| Registered Business Locations | DataSF `g8m3-pdis` (`6284-sbmj` is only its map view) | 3,825 | DBA and legal name, NAICS, location start date, corridor |
| Overture places | local parquet, release 2026-10-21.0 | 2,698 | name, category path, brand/Wikidata, website, open/closed |
| OpenStreetMap | Overpass (needs a User-Agent; Geofabrik pbf fallback) | 458 named businesses, 4,694 buildings, 432 named streets | shop/amenity tags, cuisine, outdoor_seating, hours, street centrelines |
| Shared Spaces tables and chairs | DataSF `dpch-7nr4` | 76 | sidewalk tables, display merchandise, sidewalk width, hours |
| Parklets | DataSF `bpc9-7sus` (Parklet permits) + `jczu-j2ku` | 2 + 2 | parklet length, kerb side, offset from the cross street (parsed) |
| Building footprints | DataSF `ynuv-fyni` (`asx6-3trm` is the 2017 FileGDB) | 4,673 | parcel-split outlines, LiDAR median height, ground level |
| Overture buildings | S3 GeoParquet via DuckDB | 4,696 | height on 97%, floors; roof shape and facade material essentially empty |
| Parcels | DataSF `acdm-wktn` | 6,848 | APN, address range, zoning |
| Assessor roll | DataSF `wv5m-vpq2` | 7,017 | year built, storeys, construction type, use, lot frontage |
| Historic status | DataSF `3tsw-4idn` | 4,742 | CEQA historic resource code |
| Historic context statements | DataSF `43um-8u7u` | 70 | architect, building type |
| Land use | DataSF `c5ge-t6pj` | 4,301 | retail and visitor floorspace per parcel |
| Building permits | DataSF `i98e-djp9`, filtered to exterior words | 8,385 | sign, awning, storefront and facade work with dates |
| Planning records | DataSF `qvu5-m3a2` | 2,469 | facade-alteration and formula-retail flags |

How the merge works (`merge.py`):

* **Linking.** Rows are linked by parsed address plus name similarity, by distance plus
  name, or by brand Wikidata id. Two rows from the same source are never chained into one
  business.
* **Field fusion.** Each field keeps every candidate value with its source and retrieval
  time. The chosen value's confidence is `support × (1 − 0.6 × opposition)`, using written
  per-source priors (`PRIORS`). Conflicts are kept, not dropped.
* **Storefront likelihood.** This is evidence that the business has a ground-floor
  shopfront: an OSM shop or amenity, an Overture street trade, a Shared Spaces or parklet
  permit, a storefront NAICS code, commercial zoning and retail floorspace. It is lowered
  for upper-floor or suite units and for closed businesses.
* **One occupant per shopfront.** Overture keeps old tenants at their address for years.
  When several businesses claim one number and unit, the one with the most current evidence
  is the occupant. The others are kept as `previous_or_upstairs`.
* **Placement.** Each business goes to a building: the containing footprint, or a nearby
  one whose parcel address range matches. Then to a street face: preferring the face on the
  street named in its address. Then to a tenant span along that face.

Result: 5,511 businesses, of which 851 are storefronts and 559 are confirmed by two or more
sources. 833 storefronts are placed on a face: 824 on a street face and 9 on a setback face
(rear-lot shops off Union Street courtyards, pier sheds). 75 have sidewalk tables or a
parklet on record. All outputs go to `out/<area>/`, which is uncommitted and can be rebuilt
from the cache.

Gaps to close in this stage:

* Tenant spans are currently split at the midpoints between businesses' projected
  positions (`span_inferred: true`). Stage 4 replaces them with pilaster positions measured
  from the facade.
* SF Enterprise Addressing System address points would place each business better than
  registry or Overture points. Find and verify that DataSF dataset before relying on it.
* The Overpass result is a single cached snapshot. Record the Geofabrik pbf date when it is
  used instead.

## 4. Stage 2 — face geometry (built: `faces.py`)

* Each DataSF footprint is simplified (0.3 m) and made counter-clockwise, so every edge
  has an outward normal.
* An edge is a **party wall** when points 0.6 m outside it fall inside a neighbouring
  footprint.
* An edge is a **street face** when a ray along its normal meets a named OSM street
  centreline within 45 m, running within 30° of parallel.
* An edge is a **recess** when rays along its normal re-enter its own footprint: the back of
  an entry notch or light well. Without this rule, 1–2 m notch edges were taken as
  frontages and every photo of them was "occluded" by the building itself.
* Result: 43,427 edges, of which 13,992 are street faces.
* A business's frontage is its tenant span of that face. Photo filters score against the
  span, not the whole building edge.

Kerbside's city draws OSM building outlines, and the lab uses DataSF's. Each lab building
records its best-IoU OSM way and Overture building, so programs can be re-targeted with
`smc.exteriors.kerbside.from_kerbside`.

## 5. Stage 3 — photo filters (built: `kerbfront photos`, `kerbfront pixels`)

### Frame source

* Mapillary Graph v4, swept in ~70 m tiles. The bbox endpoint returns a **sample** for
  larger boxes: one 0.0025° tile gave 650 frames, and sixteen 0.000625° tiles over the
  same ground gave 2,294.
* Positions and headings use the structure-from-motion solution where Mapillary has one.
* The main checkout's September catalogue (`data/sf_corridor_mapillary_dense`) is kept as
  an offline fallback, but it undersamples in the same way.

### Gates (a frame cannot show the face)

* camera behind the face plane;
* more than 40 m away, or less than 2 m;
* incidence above 72°;
* less than 60% of the span inside the lens's horizontal field of view;
* less than 40% of sight lines clear of other footprints (2D ray test);
* the tenant span would be narrower than 100 px in the image stage 2 fetches. A 2 m shop
  seen obliquely from 20 m is a sliver;
* a fisheye lens. Its crops cannot be aimed until the solved lens model is used.

### Scores

Each frame gets two scores, combined as weighted geometric means:

* **architecture**: resolution in pixels per facade metre, incidence, vertical coverage of
  the storefront band and the full height, share of the span in view, sight lines clear,
  recency, sun elevation, front lighting versus looking into the sun, Mapillary quality and
  SfM versus GPS pose;
* **signage**: needs about 25 px per metre (0.3 m letters) and decays with a 4-year
  half-life. It is **zero for frames taken before the tenant's registered start date**
  (they show the previous occupant), and zero before the last completed sign, awning or
  storefront permit at that address.

### Pixel checks (stage 2, on 2048 px thumbnails plus Mapillary segmentation)

* share of the storefront band occluded by cars, people, trees, poles or the capture
  vehicle;
* share of the face window segmented as building. If the window is sky or road instead,
  the pose or footprint is wrong for that frame and it is rejected as `misaligned`;
* store-sign, advertisement and banner pixels in the sign band, 2.4–5 m above grade;
* Laplacian sharpness and clipped highlights and shadows, measured on a perspective crop
  aimed at the face. Panoramas are re-projected at no more than their own angular
  resolution, so sharpness measures shake rather than range;
* whether the face is cut off by the edge of a perspective frame (`face_cut_by_frame_edge`
  when less than 70% of it is inside the central 92% of the frame), and its projected width
  (`face_too_small`).

The `sign` slot of a panorama is fetched at full resolution, because a 2048 px
equirectangular thumbnail spends only about 6 px per degree on the facade.

### Shot list

Each storefront gets a short list of slots, filled with a penalty for reusing a sequence:

* `sign`: the sharpest recent frontal shot;
* `elevation`: a square-on shot for proportions;
* `oblique-left` and `oblique-right`: for depth, such as awnings, blade signs and recesses;
* extras.

Measured results on Chestnut Street are in `reports/`.

Next steps for this stage:

* Use Mapillary's `computed_rotation` (pitch and roll; `smc.facades.poses` already fetches
  it) so crops sit level and window positions are not skewed.
* Add KartaView and Panoramax frames. They are already swept in the main data folders and
  need the same normalize step.
* Treat the owner's own phone captures (`smc.capture`) as gold-standard frames.
* **Google Street View is off** unless the owner agrees. Its terms forbid storing imagery
  or deriving content from it, so even then it could only appear in human review sheets,
  never as a measurement source.

## 6. Stage 4 — rectified, occluder-free facade images (to build)

For each storefront span, using the selected frames:

1. **Project the face into each frame.** Take the span corners at grade and at the LiDAR
   height, project them with the frame pose and lens, and refine with the rotation. Check
   the fit against the segmentation building mask, and against vertical and horizontal
   vanishing lines, so a pose more than about 0.5 m off is caught.
2. **Rectify** each frame to a facade-plane orthophoto at 50 px/m, using `smc.facades.rectify`
   with a known plane. Store its per-pixel resolution so near frames win.
3. **Fuse** the orthophotos. Mask out occluders (cars, people, trees, poles), register the
   frames to each other with ECC alignment, and take a resolution-weighted median. The
   result is one clean "elevation" image per span, plus per-pixel confidence and the frame
   ids each pixel came from.
4. **Measure** from the clean elevation with `smc.facades.survey` and `coarse_openings`:
   * pilaster and party-wall lines, which replace the inferred tenant spans;
   * doors, display windows, transoms, bulkheads and recessed entries. Recess depth comes
     from parallax between the oblique-left and oblique-right shots;
   * storey lines, cornice and parapet heights. These are checked against LiDAR height
     and assessor storeys.

Output: an opening ledger in the docs/30 contract's `u`/`v` metres, with `measured: true`
and a per-opening `source_id` pointing at the frame ids. `openings_complete` is set only
when the whole span was seen clearly in at least two frames.

## 7. Stage 5 — attributes from the facade images (to build)

Each attribute keeps its value, confidence and evidence (frame ids plus a crop), the same
way stage 1 fields do.

* **Sign text and identity.**
  * Run OCR on the `sign` slot and the elevation image's sign band: PaddleOCR locally,
    with a vision-language model as fallback for script and stylised lettering.
  * Fuzzy-match the result against the merged name. A match confirms the occupant; a
    different name means the business has changed, and the record goes back to stage 1.
  * Keep the exact capitalisation and line breaks. They are what people recognise.
* **Sign type and placement.**
  * Type: channel letters, fascia panel, lightbox, painted wall or window, blade or
    projecting sign, awning valance, neon, plaque or door vinyl. These are the planner
    types the engine already supports.
  * Box (`u`, `v`, `w`, `h`) on the elevation image.
  * Foreground and background colour from k-means inside the text mask.
  * Lettering class: serif, sans, slab, script or display, plus stroke weight and whether
    it is lit. Exact proprietary typefaces are not claimed, the same policy as docs/30.
* **Awning.**
  * Shape: shed, dome/round, waterfall, box, retractable flat, or fixed metal
    canopy/marquee.
  * Colour, and stripe pattern if any.
  * Valance text, read by OCR.
  * Span from the elevation image; projection depth and drop from the two obliques; height
    above the sidewalk.
* **Materials and colours by region.** Regions are bulkhead/kickplate, storefront frame,
  ground-storey wall, upper wall, trim/cornice and roof edge. Classes are stucco, painted
  wood (shiplap or clapboard), brick, cast stone or terra cotta, glazed tile, metal panel,
  curtain-wall glass and wood shingle. Colours are white-balanced with a grey-world check
  plus a sky reference, and sampled as medians on the fused image.
* **Style family.** One classifier output, combining:
  * the prior from year built, construction type, CEQA code and context statement
    (stage 1);
  * cues read from the photos: arched openings, clay-tile eaves or pent roofs, stepped or
    curved parapets, fluted pilasters and zigzag ornament, bay windows, false fronts,
    bracketed cornices, ribbon windows.

  The families are Mediterranean/Spanish Colonial Revival, Period Revival (Tudor, Norman),
  Art Deco/Streamline Moderne, Edwardian/Victorian house with an added shopfront,
  Italianate commercial, mid-century motel/modern, and contemporary infill. The family
  selects a **kit** of cornice profile, parapet, trim and window proportions. Those kit
  parts are what make a 1928 Chestnut Street block look like itself rather than like a
  generic box.
* **Outdoor seating.** The permits say whether there is seating and what kind (Shared
  Spaces sidewalk tables with sidewalk width; parklet length, kerb side and offset from
  the cross street). Photos confirm the current state and measure the layout: number of
  tables, barrier or planter line, parklet deck, roof and enclosure. A permit with nothing
  visible in recent frames is marked `permit_only`. Seating seen with no permit is marked
  `observed_unpermitted` and drawn only when two frames agree. Rear patios use the 0.25 m
  NOAA aerial imagery and OSM `outdoor_seating=garden`.

## 8. Stage 6 — assemble programs and props (to build)

* `handoff.py` already writes footprint, height, tenants, frontage spans and the
  `kerbfront` provenance block. Stage 6 adds:
  * measured `openings` and `signs`, with their `*_complete` flags;
  * `wall_colour`, `wall_material` and `bands`;
  * the style kit;
  * awnings: the engine has awning kinds, so the lab passes shape, colour, span and
    projection.
* Seating becomes city props. A parklet is placed in the parking lane on the permit's kerb
  side, from-to offsets along the street, deck height and barrier type. Sidewalk tables are
  placed in the furniture zone, sized from the sidewalk width.
* Chains still go through `smc.exteriors`' identity families. A measured sign always wins
  over a chain default, because a local franchise may differ from the brand guide.

## 9. Stage 7 — verify against photos (to build)

* Render each program in the exteriors preview from the pose of a held-out frame: a good
  frame from a different sequence, never used in stages 4–5.
* Score the six checks in §0, plus gradient-structure SSIM inside the face window.
* Write results to the `smc.truth` journal.
* Failures get a contact sheet: render and photo side by side with the failing checks
  marked.
* Track pass rates per corridor and per attribute, so effort goes to whatever fails most
  (for example, awning colour under shade).

## 10. Stage 8 — keep it current (to build)

Re-run monthly. These events invalidate a business's signage evidence and re-queue it:

* a new registry location start date;
* a completed sign or awning permit;
* a planning record with the facade-alteration flag;
* a newer Mapillary frame of the span.

Architecture evidence is invalidated only by structural permits.

## 11. Milestones

| Milestone | Scope | Done when |
|---|---|---|
| M1 (this branch) | Sweep, faces, photo stages 1–2, hand-off skeleton, tests | Chestnut shot lists and contact sheets reviewed |
| M2 | Rectified, fused elevation images for Chestnut's 148 storefronts | ≥ 80% have a clean elevation image |
| M3 | Sign OCR and identity confirmation, sign and awning attributes | ≥ 85% of occupants confirmed by sign text |
| M4 | Materials, colours, style family and kit mapping | Style labels reviewed on a 40-building sample |
| M5 | Programs with measured openings and signs, seating props, engine awning input | Chestnut renders in the review browser |
| M6 | Verification loop and dashboard | ≥ 70% of Chestnut verified |
| M7 | Lombard, Union and Fillmore, then the rest of SF | Same thresholds per corridor |

## 12. Known risks

* **Inferred spans.** They are midpoints between business positions until stage 4 measures
  pilasters. Narrow shops next to wide ones get the wrong share.
* **Overture staleness.** The occupancy contest settles a shared address, but a closed
  business at an otherwise empty address can still pass as a storefront. Stage 5's sign
  check is the backstop.
* **Upstairs offices on Union Street.** Suites without a floor number are only lightly
  penalised. The storefront count there (309) is probably high.
* **Pose error.** Frames with GPS-only positions (no SfM) can misplace a narrow span.
  The `misaligned` pixel check catches gross cases; stage 4's mask fit catches the rest.
* **Licences.** Mapillary imagery is CC BY-SA 4.0 and OSM is ODbL. The lab commits no
  pixels and no OSM-derived bulk data, only code and summary reports.
