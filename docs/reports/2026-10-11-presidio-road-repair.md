# Presidio/Masonic road paint and warning-panel repair

## Cause, not a coordinate patch

The failing render combined three incompatible geometry policies:

1. Uniform roads/curbs were drawn at a single width, while `xs` used independently
   sampled surveyed profiles. Presidio way **1090200059**, tagged four lanes,
   contains a **43.8 m / eight-lane** junction sample; way **680243312**, tagged
   three lanes, contains samples up to **31.9 m / six lanes**. These widths include
   other intersection geometry, not verified travel-lane boundaries. The renderer
   accepted their inferred lane counts and, when they did not fit, expanded paint
   back to the section's own width. This produced offset jumps and clipped paint.
2. Crosswalk endpoints continued consulting the alternative surveyed curb-return
   grid even though the app's selected curb policy is uniform. One Masonic crossing
   with a 13.0 m mapped desire line became a 30.2 m, split surveyed span.
3. Yellow warning fields had an independent dark-grey ramp decal. The concrete
   landing and warning rectangle separately moved away from the roadway, so their
   footprints could diverge and leave bare asphalt underneath a warning panel.

An additional ingestion defect was verified: Presidio way **254396717**, tagged
two lanes in each direction, matched city **sfcnn:10493000 / PINE ST** and inherited
its **WB** one-way designation. The city index stored only vertices rather than
the intervening segments, and whole-way matching voted by vertex density rather
than distance along the street. With segment indexing, uniform arc-length votes
and normalized named-street matching, the same way matches
**sfcnn:10766000 / PRESIDIO AVE**, not Pine. Missing named records now remain
unmatched rather than borrowing a cross street's facts.

There are real separate slip-road crossings here. They are not parking-space paint
and must not be merged into a single oversized main-road crosswalk. SFMTA's
[2019 project proposal](https://www.sfmta.com/reports/october-1-2019-proposed-parking-traffic-changes-3333-california-sfmta-board-meeting-document)
also describes channelized right-turn lanes along Presidio/Masonic; this historical
proposal is context, not a claim that every proposed design is today's as-built truth.

## Shared correction

- Uniform-road mode selects one compatible resolved lane topology per way. It
  checks tagged lane count, section span and plausible lane widths against the
  actual rendered width. Invalid sections cannot widen paint past the drawn kerb.
  Where none fits, mapped/inferred road-level lane guidance remains the fallback.
  The selection is cached per row-array/width/count, not recomputed every frame.
- In uniform mode, crossing resolution uses the drawn road boundary rather than
  surveyed curb returns. Survey mode remains available and independently tested.
  Closed physical islands/dividers can still divide a crossing into separate legs.
- The grey decal is removed. Concrete under and around every accepted yellow
  field is derived from that same field, uses the sidewalk material and stays on
  the pavement side. An unsafe flare shrinks without losing the field's underside.
- Original `xs`, curb profiles, mapped road tags and provenance are unchanged.
  This is a visual policy correction, not a claim that inferred paint is measured.
- Road direction is normalized consistently for the producer and renderer. An
  explicit `oneway=no` is not truthy one-way traffic. A legacy city direction
  cannot suppress a mapped opposing lane pair; cardinal directions must align
  with the road. This also repairs direction-dependent signs, medians and lane
  counts. Future official ingestion restricts named roads to their own records.
- All eight regional app modules are generated from the authoritative shared
  source, with release hashes and a new service-worker version. Frozen website
  viewers and unrelated agents' checkouts are not rewritten.

## Verification

Story: choose the reported map point → load its real regional data → resolve lane,
crossing and warning geometry → render it on the same roads/pavement the app draws.

The existing inspection tool had itself regressed: it replaced an obsolete literal
`fetch()` but not the new window-loader URL constants, silently loading the full
city instead of its advertised local fixture. The tool now sets both URL constants,
retains surrounding ways/rings and emits explicit lane/coverage diagnostics.

Fixed-camera visual checks and rendered-triangle probes:

| Location | Warning fields | Probe samples | Missing concrete beneath yellow | Covered yellow | Grey ramp meshes |
|---|---:|---:|---:|---:|---:|
| Presidio/California (-122.44680, 37.78727) | 40 | 248 | 0 | 0 | 0 |
| Presidio/Masonic (-122.44663, 37.78630) | 26 | 247 | 0 | 0 | 0 |
| Oakland, Broadway/17th (-122.26974, 37.806652) | 12 | 248 | 0 | 0 | 0 |

All three inspected areas have zero sampled buried lane/crossing triangles. At
Presidio/California the double yellow no longer changes lateral offset at each
junction sample. Masonic's erroneous 30.2 m survey span is no longer used for the
uniform road. These are representative visual/probe checks, not a claim of surveyed
dimensional accuracy or exhaustive validation of every city corner.

194 focused ingestion/section/geometry/paint/sign/bridge/baseline tests pass. Regression coverage
executes the actual renderer against the three bad Presidio records, checks stable
lane count and in-road offsets, verifies source sections are not changed, checks
default crossings ignore incompatible survey returns, and proves the sidewalk
landing contains the complete yellow panel. Existing survey and island fixtures
continue passing. The corridor-wide baseline also passes; the default crossing
audit now exposes its policy and requires at least 93% drawn-kerb attachment,
instead of incorrectly demanding surveyed endpoints in uniform mode.
Producer/renderer direction-parity tests cover the false WB record, explicit no,
true/reverse one-way and a valid westbound geometry. Centreline tests cover missing
named streets, abbreviated names, extra junction vertices and sparse long segments.

Local proof images/diagnostics live in ignored `build/road-paint-preview/`; the
test cases and this report are committed. Production promotion uses the existing
protected-main checks, never a direct deployment bypass.

## Navigation

The requested future navigation design is documented in
[3d-navigation-plan.md](../3d-navigation-plan.md). No navigation engine, blue
route layer, API key, live transit ingestion or navigation controls were implemented.

Remaining accuracy boundary: uniform curbs and inferred lane arrangements are
visual fallbacks. A routing system must use a separately validated legal network,
not treat these paint shapes or procedural home stairs as travel permissions.
