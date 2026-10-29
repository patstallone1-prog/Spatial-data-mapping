# Interior performance and apartment floor programs

The house and restaurant engines reuse exact geometry work within one inference request.
They still evaluate the original candidate layouts, in the original order, with the same
scores, furniture requirements, clearances and final validation. No measurements, source
windows, balconies or per-floor outlines are replaced by rectangular approximations.

## Where the time went

Profiles showed repeated subdivision of identical home regions, repeated rotation of the
same furniture footprints, and repeated obstacle unions and buffers for different approach
points to the same furniture. Restaurant seating also rebuilt previously rejected table
assemblies after each accepted table.

`inference/memo.py` provides bounded, request-local caches for immutable calculations.
Nested apartment solves share the parent request; subsequent requests start empty. The
cache resets on success and failure and is isolated across threads. Each function keeps
at most 4,096 entries, except the larger obstacle-free-space shapes, which keep 32.
Subdivision returns a fresh list so callers cannot mutate cached results.

Room insets, window clearance zones and furniture padding are calculated once where their
inputs stay fixed. Restaurant seating retains exact candidate assemblies and can discard
positions permanently blocked by walls, doors, the queue or accepted furniture: these
obstacles only grow during the search. Accessibility-only and route failures are retried;
they are not treated as permanently blocked positions.

Apartment floor allocations enumerate feasible integer compositions directly, rather than
enumerating every possible count tuple and rejecting most of them. The ranking and three
selected allocations remain the same.

See the [benchmark report](reports/2026-10-28-interior-performance.md) for measured results
and complete-output equivalence checks.

## Explicit apartments across floors

`HouseInput.from_json` accepts `units_by_floor`, an ordered list of household labels for
each supplied floor. `households` is the number of distinct labels across the building.
Different labels represent independent homes; a repeated label on contiguous floors is
one home with private stairs. Each home retains its own kitchen, full bathroom, living,
dining and sleeping program. Shared corridors and stairs belong to the building.

For example, three independent homes stacked vertically:

```json
{
  "households": 3,
  "apartment_layout": "shared_hall",
  "units_by_floor": [["ground"], ["middle"], ["top"]]
}
```

Four independent homes on each of two floors, with two homes on each side of the hall:

```json
{
  "households": 8,
  "apartment_layout": "shared_hall",
  "units_by_floor": [["A", "B", "C", "D"], ["E", "F", "G", "H"]]
}
```

A private duplex alongside a separate home on each floor:

```json
{
  "households": 3,
  "apartment_layout": "shared_hall",
  "units_by_floor": [["duplex", "lower"], ["duplex", "upper"]]
}
```

These are program fields to add to a complete house input, including its local-metre
footprint, storeys/heights and any supplied entrance, envelope or garage measurements.
The fixtures in `tests/fixtures/apartment-configurations.json` are complete examples.

The contract allows 1–20 homes across the existing maximum of six floors. Labels use
letters, numbers, hyphens or underscores, and cannot repeat on one floor or skip a floor
within a private multi-floor home. If `units_per_floor` is also given, it must agree with
the lengths of the label lists. Without labels, the existing count-based allocation
continues to work. A single apartment can use the same explicit program and keep an
irregular outline.

`apartment_layout` accepts `auto` (default), `perimeter`, `compact` or `shared_hall`.
Automatic inference tries the existing strategies first, then the new shared hall when
they cannot produce a validated building. Existing successful automatic layouts keep
their prior output. Explicit floor programs also work with those existing strategies.

## Geometry and access

The shared-hall partition clips each home from the supplied floor polygon. It supports
different floor outlines, setbacks, different home counts by floor, and apartments on
both sides of the corridor. It aligns the communal stair core through the common area
of the supplied floors. A one-home floor receives a compact landing rather than a hall
that divides the home. Ground-level entry connectors reach the supplied entrance.

Household labels follow the deterministic order of the clipped regions. Repeated labels
must leave enough overlapping area for private stairs; a program that cannot fit rooms,
stairs, entries or furniture is rejected. The engine does not guarantee that every
requested count fits every shell. Source geometry is retained and the proposed internal
layout remains explicitly inferred.

Validation checks private services, ownership on every floor, private entrance doors,
common egress, geometry coverage, furniture clearances and stairs. Tests additionally
exercise the actual JavaScript tour engine across the new room and stair configurations.

## Reproducing the comparison

The benchmark script reads the existing house/residential cohorts and the last restaurant
cohort. Its separate held-out pool includes unseen dimensions, a rotated restaurant and
an additional duplex. It writes only to `build/` by default.

```sh
.venv/bin/python scripts/benchmark_interior_inference.py --repeat 3 --out build/interior-performance/current
.venv/bin/python scripts/benchmark_interior_inference.py --held-out --repeat 3 --out build/interior-performance/heldout
```

Use `--source-root` with a read-only checkout/archive of the reference source, then
`--compare` with its result folder. The script compares a SHA-256 of every serialized
field, including geometry, materials, furnishing, diagnostics and rejection messages.
`--profile` creates separate profiles outside the wall-clock measurements. Run benchmarks
without concurrent test workloads. Every inference starts with empty request caches;
module import time is outside the measurement and catalog loading is inside it.

This pass changes engine code and adds local test/report artifacts. It does not publish
new layouts, change map overlays, restart the preview server or deploy anything. The
explicit programs are available through the Python/JSON input contract and the local
residential rebuild endpoint after a future server restart. That endpoint accepts the
program fields while keeping the stored shell, heights and opening evidence. The existing
preview's controls are unchanged.
