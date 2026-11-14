# 38 · Photo-derived lanes: where they stand, and what may go to production (2026-11-13)

## 1. Where things stand

**No lane or parking geometry in production comes from photographs today.** The corridor
payload (`docs/sf-corridor-3d.json`) has 2,967 streets and 57,362 cross-section stations.

Every band carries its source grade (`smc.facts.cross_section.SourceGrade`):

| Band | Grade | Count |
|---|---|---|
| Travel lanes | mapped (OSM lane tags) | 79,915 |
| Parking | inferred (SFMTA policy prior) | 76,881 |
| Travel lanes | inferred (class prior) | 54,185 |
| Bike lanes | mapped | 4,872 |
| Unknown | inferred | 3,139 |
| Fixed (medians, islands) | inferred | 335 |
| **Any band** | **image** | **0** |

Kerbs come from three sources:

- the city survey: 20,861 stations;
- the mapped width: 15,235;
- inferred: 21,266.

Station status is resolved at 43,340 stations, partial at 10,883 and unresolved at 3,139.

The photo pipeline is built, but it has never been run on real data:

- **`scripts/measure_road_imagery.py`** reads *reviewed* ground masks, not raw photos.
  - Each frame needs a validated camera calibration, a privacy review and a source asset whose CV-processing rights are approved.
  - It never fills a gap from OSM.
  - It writes `parking_bands.json` and `lane_marks.json`. Neither file exists in the repo.
- **`smc.measure.parking_band`** gives a band a width only with at least 8 parked vehicles over at least 3 capture dates.
  - The outer edge is the 85th percentile of where the cars reach, so one crooked van cannot set it.
- **`smc.measure.road_image.extract_lane_paint`** keeps only white or yellow stripes, and only with a calibrated confidence.
- **The lane benchmark** (`data/sf_corridor/benchmarks/lane_faces.json`) has 60 block faces across 5 strata, with tolerances of 0.30 m for kerbs, 0.25 m for parking and 0.30 m for lanes.
  - None of the 60 faces has hand-checked truth filled in yet, so nothing photo-derived has been scored.
- **Rights** (`data/reconstruction/source_rights.json`):
  - approved for CV: Mapillary (CC-BY-SA), PandaSet and 3D Street View (non-commercial);
  - conditional: Panoramax and KartaView;
  - pending a contract: the oblique aerial pilot.

What we have learned elsewhere:

- Mapillary's own detected *points* are imprecise: 30–46% fall within 8 m.
- Rooftop solar detection from aerials was unreliable.
- The kerb-island work went best as "the survey ring gives the shape; the photo only confirms it."

## 2. Recommendation

**Do not put photo-measured lane counts or lane widths into production.** A lane count read from paint is exactly where a model hallucinates:

- worn paint;
- a shadow read as a stripe;
- a turn pocket taken for a through lane;
- half a lane of camera drift.

The map's lane tags plus the city's kerbs are already graded and auditable.

Production should take these, in this order:

1. **Parking bands, measured from parked cars, face by face.** This is the safest photo measurement.
   - It is physical: where cars actually stand.
   - It is self-checking across many vehicles and dates.
   - It falls back cleanly to the policy prior.
   - It is admitted only once the method has been proven against hand-checked truth (§3).
2. **Lane paint as confirmation only.** A stripe within 0.30 m of a boundary the map already implies marks that boundary as confirmed.
   - A stripe with no mapped boundary near it goes into a report to look at.
   - It is never drawn, and it never changes a count or a width.
3. **Not yet:**
   - photo kerbs (the city survey is better where it exists);
   - photo lane counts and widths;
   - any measurement from a source whose rights are conditional or pending.

## 3. Safeguards (built in this change)

`src/smc/measure/photo_gate.py` is the rule, and it is wired into `build_cross_sections`, so every caller passes through it.

- **The gate starts shut.** No photo band enters until the method has been scored against the lane benchmark. Scoring needs:
  - hand-checked parking truth on at least 12 faces, spread over at least 3 strata;
  - at least 90% of scored sides within 0.25 m;
  - no miss over 0.50 m.
- **Each band is sound on its own terms:**
  - status `measured`;
  - at least 8 vehicles over at least 3 dates;
  - a width between 1.7 m and 3.2 m;
  - a spread no wider than the tolerance;
  - named source assets, whose rights the measuring script has already checked.
- **A measured absence is held back too.** A photo can say "nothing parks here", which would remove a parking lane. That claim waits on the same terms, because deleting a lane that exists is as much a hallucination as inventing one.
- **Abstain, never guess.** A face that fails any check keeps its policy prior, graded *inferred*, so the payload always says what it does not know.
- **Provenance stays on every band.**
  - The page payload marks each band S, L, M, N or I.
  - The ground-truth view (`?truth=1`) shows measured against inferred.
- **Production test.** `tests/test_photo_gate.py` fails CI if any image-graded band appears in the production payload while the gate is shut. It also fails if any travel lane is ever graded image.
- **The build summary counts both outcomes.** It reports `photo parking admitted` and `photo parking held`, so a run that measured nothing usable says so.

## 4. To open the gate

1. Fill in the benchmark truth.
   - Measure kerb-to-kerb distance and each parking side on the 60 faces by hand, from NOAA 0.25 m orthophotos and a site visit.
   - Record the source and the date in each face's `truth` block.
   - Add the face's CNN, so it can be scored.
2. Run `measure_road_imagery.py` on reviewed masks from an approved source (Mapillary or PandaSet) covering those faces.
3. Commit `parking_bands.json`. The build scores it, and the gate opens only if the method holds.
4. Wire lane paint into the audit (`confirm_boundaries`) as a confirmation layer. It stays out of the geometry.
