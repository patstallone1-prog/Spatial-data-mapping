# Interior performance and apartment configurations — 2026-10-28

Exact geometry reuse makes the tested successful home programs 1.44–2.75× faster and
restaurant programs 1.62–4.22× faster. All 15 comparison cases have identical complete
serialized outputs to reference commit `769cb1922`, including the existing rejected
restaurant. This verifies these cases; it is not a claim that every building takes the
same time or that every possible input has been exhaustively compared.

## Measurement

The fixed ten-case pool was selected before profiling: four single-family homes, three
two/three-family programs, and three mapped restaurant programs. Five additional caller
programs were held out from the initial profiling, including unseen house dimensions,
another duplex, pickup service, a rotated dining room and a narrow counter restaurant.
There are no building-ID or venue-specific optimizations.

Both source versions ran three sequential, unprofiled inferences per case on the same
local machine and asset catalog. Each inference starts with empty request caches. The
table reports the median wall time. Module imports are excluded; input construction,
catalog loading, inference, final validation and result serialization are included.
Profiles ran separately. Complete timings, environment and output hashes are in the
[machine-readable report](2026-10-28-interior-performance.json).

| Fixed case | Before (s) | After (s) | Speedup |
| --- | ---: | ---: | ---: |
| Compact home | 3.621 | 2.516 | 1.44× |
| Family home | 3.063 | 1.115 | 2.75× |
| L-shaped home | 1.877 | 1.128 | 1.66× |
| Mapped home 460228342 | 13.670 | 8.445 | 1.62× |
| Two homes, one floor | 1.280 | 0.866 | 1.48× |
| Three homes, two floors | 2.406 | 1.489 | 1.62× |
| Three homes with setback | 2.547 | 1.544 | 1.65× |
| Irregular restaurant 262585102 | 66.021 | 15.628 | 4.22× |
| Regular restaurant 151195275 | 5.993 | 2.164 | 2.77× |
| Rejected pickup shell 939458462 | 0.00345 | 0.00377 | 0.91× |

The sub-millisecond difference in the already rejected shell provides no useful speed
gain. Its rejection message and result hash remain identical; it was retained in the
comparison rather than removed from the cohort.

| Held-out case | Before (s) | After (s) | Speedup |
| --- | ---: | ---: | ---: |
| Single home | 0.872 | 0.538 | 1.62× |
| Duplex | 0.757 | 0.392 | 1.93× |
| Pickup restaurant | 0.079 | 0.049 | 1.62× |
| Rotated dining restaurant | 14.639 | 4.184 | 3.50× |
| Narrow counter restaurant | 1.928 | 0.735 | 2.62× |

Across these successful cases, summed median time fell by 40.1% for homes and 74.3% for
restaurants. These are cohort measurements, not a regional latency estimate. Cold worker
startup, network ingestion and browser rendering were not measured.

## Changes and quality checks

Profiles identified repeated polygon subdivision, rotated furniture footprints, window
and door zones, obstacle unions/buffers and table assembly construction. Bounded caches
reuse these immutable results only within a request. Restaurant candidates proven blocked
by permanent or growing obstacles are not rebuilt. Original candidate order, scoring,
search budgets, accessibility rules, furniture requirements and final validation remain.

The new shared-hall strategy cuts apartments from actual per-floor polygons and aligns
shared stairs across floors. Explicit household labels permit independent stacked homes,
two homes on either side of a corridor, uneven floor counts and private duplexes beside
single-level homes. It does not fill concavities or replace a home with its bounding box.
Invalid or physically infeasible programs still reject.

Eight fixed configuration fixtures cover an irregular single apartment, three stacked
homes, eight homes across two floors, a duplex beside single-level homes, one home below
two, an irregular/setback two-below-three building, three floors of pairs, and four homes
below two private duplex continuations. Additional tests rotate a floor program and
preserve supplied window positions and dimensions. Ownership checks verify each home's
services and floor ledger. The actual JavaScript tour engine checks room access and
walks communal and private stairs in both directions.

The rebuild endpoint accepts the new program fields while retaining the stored shell,
storey heights and opening evidence. Its test uses an isolated input tree and attempts
to replace the shell, confirming those changes are ignored.

See [the input contract and implementation notes](../29-interior-performance-and-apartment-programs.md)
for usage, limits and benchmark reproduction.

All 97 regression checks passed across houses, apartments, restaurants, stores, source
alignment, furnishing, publishing and the JavaScript tour. Python lint, formatting and
whitespace checks passed. The project knowledge graph was refreshed with AST extraction.

This pass is committed locally only. No layouts or map overlays were republished, no
preview server was restarted, and nothing was deployed.
