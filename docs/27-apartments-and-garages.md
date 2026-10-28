# Small apartments and source-aligned garages

`HouseInput` and `infer_house` now accept one house or **2–5 independent households**, with
**1–4 garage spaces** behind recorded garage openings. The new residential composer reuses
the room/furniture engine and keeps its outputs explicitly inferred.

## Run and review

```sh
.venv/bin/python scripts/build_residential_examples.py
.venv/bin/python scripts/serve_interior_lab.py --port 8794
```

Open [Apartments & garages](http://127.0.0.1:8794/inferred-residential/). Each accepted case has
floor selection, a cutaway, room visits labelled by home, walking/stairs and interactive doors.
Local controls change the household count, garage capacity or attached-room/service-floor
program and run the engine again. The local endpoint keeps the stored shell, heights and
openings; program controls cannot replace their geometry. Review overrides stay separate
from the fixed cohort and are gitignored.

The fixed batch contains twelve synthetic programs and eight mapped shells selected by
SHA256 before inference. **14/20 passed** in this pass. All twelve synthetic cases passed;
two of the eight mapped cases passed. The six failures remain in the manifest with reasons.
The builder returns nonzero when any case fails, while retaining all accepted artifacts and
the rejection manifest. This is not a claim of a 70% city-wide acceptance rate.

For other inputs:

```sh
.venv/bin/python scripts/build_inferred_interiors.py --input /absolute/buildings.json \
  --out /absolute/output --include-garages
```

The input remains a JSON array of at most twenty metre-based records. Existing single-family
inputs continue to work. Add these fields as needed:

```json
{
  "households": 4,
  "units_per_floor": [2, 2],
  "garage_cars": 2,
  "garage_mode": "auto"
}
```

- `households` (or `families` in JSON): integer 1–5. A known count is caller data; a count
  assigned to a mapped test shell is labelled as an illustrative test program.
- `units_per_floor`: optional explicit counts, one per supplied floor, totalling the household
  count. Otherwise allocation is inferred. When there are more residential floors than homes,
  automatic allocation groups contiguous floors into duplex/triplex homes with private stairs.
- `garage_cars`: optional total 1–4. Per-opening `cars` values can give a more specific program.
  Multiple unspecified gates share an explicit total. Without a count, the opening width sets
  a conservative inferred capacity.
- `garage_mode`: `auto`, `room` or `floor`. Auto first tries an attached garage for a single
  home, then a service floor if necessary. A garage-only floor needs living floors above it.
- `entrance_level`: optional floor index, normally zero. This preserves an upper entry when
  a source garage threshold establishes a full lower floor.

A local garage record accepts `a`, `b` (the facade edge), `u` (opening start along it), `w`, `h`
and `v` (threshold relative to the ground living floor), or a GeoJSON `segment` instead of the
edge/offset. Include its source ID, basis, confidence and measured status. `--include-garages`
resolves mapped records through Kerbside's actual `normaliseGarages`, `addPhotoGarages` and
facade functions. It keeps photo-backed openings distinct from kerb-cut projections. The
legacy facade export stays unchanged when garage extraction is not requested.

## Independent homes and common space

Every home has its own furnished kitchen, living/dining space, sleeping room, full bathroom
and storage. Private entry doors connect to a common lobby/corridor. Full bathrooms cannot
satisfy another household's requirements. Units never connect directly to neighbouring units;
shared egress cannot require crossing a private home. Duplex homes can have private internal
stairs while the other homes retain the common stair route. Common mailboxes and stacked
laundry fit only where door and stair approaches remain clear.

Perimeter corridors, compact entrance cores and single-floor cross-corridor plans preserve
the actual polygon. Unit furniture uses the same building palette and economic allowance.
The room engine also supports a compact bathroom search for apartment programs, retaining
independent furniture, bed-aisle and circulation checks.

## Garages and navigation

Recorded door width, position, height and threshold are not moved to force parking to fit.
The interior can be asymmetric behind its door. Bays contain the car collision boxes, allow
pedestrian access and identify tandem rows explicitly. A narrow gate can serve tandem cars;
the viewer states when front cars must move before rear cars. Excessive tandem depth and
parking outside the shell are rejected.

Lower garage slabs have separate surface patches and short internal steps rather than
being raised to the living floor. Full lower storeys can be resolved from a sufficiently large
threshold offset without moving the world positions of windows and balconies. The local
tour and Kerbside map adapter use the same walking surfaces. Sectional garage doors open
vertically. Bedroom/bathroom doors remain detailed timber/privacy doors; apartment entry
doors are opaque and start closed.

Wide garages carry an inferred post-and-beam proposal, with supports outside bays, door
clearances and pedestrian routes. These are architectural plausibility objects requiring
structural review, not engineered beam sizes, foundations or an as-built structural survey.
No building-code certification is implied.

## Current limitations and checks

The six mapped rejections include garage thresholds on different floors, a garage-height/
storey conflict, overlapping parking envelopes, a common-core conflict and unit furniture
programs the current search cannot fit. Rejection preserves the source rather than hiding a
required kitchen/bathroom or shifting a door. More complex split-level parking and difficult
narrow mapped footprints need further layout support. The 908-house published catalogue
is preserved; the twenty-case review does not replace it.

71 distinct regression checks passed across houses, restaurants, room economy, source
openings, publishing, apartment privacy, garage geometry, API program overrides and the
real JavaScript walking engine. The walking checks visit every accepted occupied room and
ascend/descend the stairs, including private duplex flights and lower garage transitions.
Source opening extraction and the map adapter are tested separately. Python feature lint,
JavaScript parsing and whitespace checks pass.
