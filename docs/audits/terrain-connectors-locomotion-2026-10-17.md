# Terrain, connector intake and locomotion — 17 October 2026

## Houses and storage

The publication cutoff adds **one** eligible facade, **49 Kearny Street**, to the
4,058 previously published records: **4,059 total**. The worker index at the
cutoff contained 4,043 accepted records; it is a current eligibility index, not a
cumulative completion counter. Every pre-existing published fit is retained.
These are photo-derived visual estimates, not dense scans or surveyed collision.

With the workers stopped, the explicit raw-pixel purge removed **35,499 files /
100,690,384,296 bytes** from the verified HP700 run directory. It removed crops,
review masks and decoded source pixels, not extracted facts, source aliases,
licenses, flight manifests, model weights, material textures or mixed reference
dataset archives. The local deletion plan and per-file receipt remain under
`build/hp700-raw-purge-2026-10-17.*`. Deleted pixels are not locally recoverable;
available remote observations may be downloaded again. The six house workers
were restarted. New downloads can grow storage again.

## Connector intake

The existing 337 bounded jobs (12 planning corridors) are now activated explicitly.
`scripts/run_gap_intake.py` interleaves corridors, runs discovery plus real OSM
geometry before bulk 3DEP terrain/curb work, journals each stage and retries
failures. The private acquisitions live on HP700 under
`Kerbside/connector-intake-2026-10-17`. The installed local LaunchAgent is
`com.kerbside.connector-intake`; it resumes from `build/gap-intake/status.json`.
It pauses at/below 30% battery, below 8 GiB free, or on wrong/missing volume UUID.
Interrupted child process groups cannot be marked successfully complete.

| Planning corridor | Connection |
| --- | --- |
| sf-central-gap | Main SF corridor ↔ Haight/Castro/Richmond/Mission |
| sf-south-gap | Southern SF ↔ Peninsula approach |
| daly-south-sf-gap | Daly City, South SF, San Bruno |
| millbrae-burlingame-gap | Peninsula south of SFO |
| san-mateo-foster-gap | San Mateo, Foster City, bay shore |
| belmont-san-carlos-gap | San Mateo ↔ Redwood City |
| redwood-menlo-gap | Redwood City/Menlo Park ↔ Palo Alto |
| mountain-view-gap | Palo Alto ↔ Mountain View |
| sunnyvale-santa-clara-gap | Mountain View ↔ San Jose |
| emeryville-north-oakland-gap | Oakland ↔ Berkeley |
| alameda-gap | Posey Tube approach ↔ Alameda |
| east-bay-south-gap | San Leandro/Hayward/Union City/Fremont ↔ South Bay |

These are planning envelopes, not precise municipal boundaries. Some include
water. `connector-intake-2026-10-17.json` is a checksummed **point-in-time** source
receipt, not a live counter or a claim of newly published coverage. Completed
intake still requires build, geometry/privacy/rights checks and promotion.
Existing app coverage is unchanged; unbuilt connectors are never advertised as
ready-to-visit cities. The dormant planning manifest remains the original plan;
the explicit runner journal is the current activation/completion authority.

The first real runs exposed the fixed 2,000-element dense-SF response floor rejecting
valid smaller cells. Connector OSM ingestion now uses a conservative floor from
an independent count probe with identical bounds. Unknown/mismatched probes keep
the old safety floor; any response remark fails; an empty response is never
accepted as successful measured geometry.

## Visual terrain and grass

- Existing near/middle botanical LOD transitions move **30% farther out**:
  180–260 m → 234–338 m, and 600–820 m → 780–1,066 m. This retains higher detail
  when zoomed out without moving trees or inflating inferred vegetation density.
  It does not claim a 30% improvement in source DEM accuracy.
- New `grass-strands.mjs` emits actual tapered, bent blade triangles. Height and
  green variation use six deterministic independent samples, concentrating near
  the centre; unusual tall/short or colour extremes are rare. Ordinary managed
  turf centres on 0.10 m; habitat-specific scaling remains inferred.
- Blade roots sample the actual drawn turf triangle plane after terrain lifting,
  not a differently interpolated source height. They are marked already grounded
  to prevent double lifting. The complete lean envelope must clear hard surfaces.
- City grass shares the authoritative hard mask and excludes carriageways,
  parking lots, walls, paths, courts, buildings and water. Natural grass uses
  habitat/land-cover and path-clearance evidence. Neither changes street-tree layout.
- Near-blade residency is bounded to 16 eight-metre cells, built one at a time.
  Distant grass retains the grain-level texture; invisible sub-pixel blades are
  not kept as millions of triangles. Host and attached regions use the same code.

The Fort Mason local sweep displayed grounded blades, verified no WebGL compile
errors, and caught/corrected initial hard-surface/retaining-wall clearance problems.
Existing coarse/angular turf/path edges remain visible in this area; this pass
does not certify every terrain boundary or source polygon as surveyed truth.

## Walking

Only rendered, evidence-backed recessed stairs are passable inside a footprint's
exterior recess. Body clearance and the end/side walls remain enforced; ordinary
doors do not enable walking through buildings. House rooms remain outside this
change. Public-stair queries now include neighbouring spatial-index cells so a
tread's width cannot disappear at a cell edge.

Climbing is capped at 1.35 m/s, nontrivial slopes at 2.2 m/s; unchanged flat-ground
and first-person base speeds remain in effect. The imported Walk clip is selected
on steps, the contact plane follows individual treads, hill lean is bounded, and
blocked movement returns to Idle instead of running in place. No whole-body bob
or camera interpolation is used as a substitute for walking.

Live ordinary-arrow-key check: mapped OSM stair **58525838**, ground heights
8.332 → 9.095 → 10.164 m, surface remained `stairs`, animation `Walk`. This is
observed local behavior, not an exhaustive device/animation-retargeting guarantee.

## Regional parity: not achieved

`regional-parity-2026-10-17.json` audits the app's actual payload selection and
its separately referenced ground/official sidecars, rather than assuming the
frozen website dataset is the live app. Photo-facade counts are reported separately
from canonical sampled-colour and lidar-height metadata. Some app payloads still
omit newer source-side height/colour evidence: further publication work is needed,
not more optimistic statistics. Curb evidence grades do not mean measured curb
shapes are rendered (the universal visual fallback policy remains unchanged).

- San Jose: 1,255 municipal sidewalk polygons and 476 curb-colour records are
  integrated; 52 controls/project records remain typed validation references.
- Oakland: 2,558 historical parking references are not current parking regulation.
- Palo Alto: 1,441 mixed-method road edges remain validation references, not a
  blanket surveyed-curb replacement.
- Berkeley lacks served ground-sidecar trees/yards; Oakland lacks ground-sidecar
  tree records. These counts do not include any separately loaded vegetation layer.
- Lidar-derived building-height and photographic appearance coverage remain
  substantially uneven. Even the Marina reference has source colours not yet
  represented in its canonical payload. **All regions equal: false.**

## Regression/release policy

Executed tests cover blade distributions and geometry, path clearance, triangle
grounding, exact 30% LOD thresholds, stair collision/climb speed, independent OSM
floors, connector ordering/storage safety, full viewer startup and authoritative
renderer synchronisation. Source/house/module hashes are carried by
`runtime-release.json`; service-worker revisions include house-only changes.
All eight app viewers are generated from the shared source. Existing protected
CI gates (ruff, pytest, render baseline) still block production release.
