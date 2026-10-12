# 3D, mode-aware navigation — implementation plan only

Status: proposed, not implemented or enabled. Research checked October 11, 2026.

## Decision

Use established routing engines, not a pathfinder over rendered triangles:

- **Valhalla** for car, bicycle and pedestrian paths, ordered intermediate stops,
  turn instructions and alternative routes. Its costing API supports hill
  preferences and stair penalties. Validate the pinned release's defaults rather
  than relying on beta options. [Official route API](https://valhalla.github.io/valhalla/api/route/api-reference/).
- **OpenTripPlanner 2** for scheduled transit, transfers and first/last-mile
  walking. Build with OSM, GTFS and a DEM, and ingest GTFS-RT updates.
  [Official tutorial](https://docs.opentripplanner.org/en/latest/Basic-Tutorial/),
  [elevation configuration](https://docs.opentripplanner.org/en/latest/BuildConfiguration/).
- **511 SF Bay** for regional schedules, trip updates and service alerts. It
  offers regional and individual-agency feeds; access requires a token and has
  rate limits. Fetch centrally, never once per app user. Use HTTPS and keep keys
  server-side. [Official data portal](https://511.org/open-data/transit).

Use one Kerbside route contract across both engines. Start with their normal legal
street networks; add surveyed walking connections and local geometric refinements
only after explicit validation. OSM remains a separately attributed reference
database, not a silent merge into proprietary measured facts.

**3D helps only where elevations and connectivity are trustworthy.** A blue line
in a 3D scene does not itself make a route or ETA more accurate. Likewise, current
lane paint, uniform kerbs, inferred door stairs and synthetic home interiors are
not evidence of legal access or lane connectivity. Never route through them just
because the renderer drew them.

## 1. Freeze the routing inputs and build a connected network

Keep navigation as a separate versioned product from visual meshes. Record stable
edge/node IDs, XYZ geometry, horizontal/vertical datum, source versions, confidence,
timestamp, legal modes, direction, surface, slope, steps, accessible ramp evidence,
crossing control, bridge/tunnel level and turn restrictions. Preserve mode-specific
OSM exceptions and conditional restrictions; unknown is not permission.

Join regions with shared stable network IDs and a halo. Do not snap two roads
together because they cross in XY: Geary/Masonic's underpass must not join the road
above it. Inferred/procedural surfaces cannot introduce pedestrian shortcuts or
motor-vehicle connections. A measured connection's geometry and its legal access
are distinct pieces of evidence.

Serve the broader Bay Area legal network so routes between disjoint mapped regions
can be complete. Mark portions outside detailed-world coverage explicitly; if only
regional packages are available, return an honest unavailable route instead of a
straight line across an unmapped gap. Keep source attribution and licensing review
in the build manifest.

## 2. Derive reliable heights, hills and stair costs

Use canonical terrain/road deck and surveyed stair/ramp geometry, not the highest
visible triangle or roofs. Convert to a consistent vertical datum; attach datum
and uncertainty to every elevation profile. Sample no finer than the source's
actual resolution. Mask bridges/tunnels from a ground DEM and use their own deck
or bore evidence. Unknown deck heights remain unknown, with a safe display fallback.

Compute edge slope, ascent, descent and 3D length. A 3D length correction alone
usually matters less than the speed reduction and effort of climbing. Use the
routing engine's grade-aware costs first, then calibrate walking/cycling ETA with
held-out real trips. Stair ascent/descent needs its own travel-time model, not the
same speed as flat footway. Bike routes exclude stairs by default; optional
dismount/carry segments must be explicit. Add a separately validated step-free
mode, never an unsupported wheelchair-accessibility claim.

Keep **time** and **preference cost** separate. The least-hilly route may take
longer; show both ETA and ascent. "Fastest", "fewer hills" and "step-free" must not
be ambiguous versions of one route. Car ETA is a speed-limit/typical-time estimate
until a current traffic source is integrated. Transit ETA depends on departure
time, waits, transfers and feed freshness, not just the vehicle's path length.

## 3. Route API and place selection

Reuse the app's region/address/place search. Add origin, destination and reorderable
via stops; preserve the user's order by default. A separate opt-in stop-order
optimizer must not silently rearrange appointments.

Resolve a building to a verified entrance and public approach, not its centroid or
roof. Car endpoints snap to an eligible arrival/parking access; walking can finish
at a public entrance. If access is unknown, finish on the public sidewalk and say
so. Never route through private stairs or inferred home interiors.

Proposed request: ordered `waypoints`, `mode`, `depart_at`, `hill_preference`,
`step_free`, `alternatives`, `world_release`. Reject excessive waypoints, invalid
coordinates and unsafe combinations. Rate-limit requests; avoid retaining precise
personal origin/destination histories. Do not use the app's 20 mph avatar speed
as a walking-speed estimate.

Proposed response: itinerary ID, engine/network versions, per-leg distance and
duration, instructions, ascent/descent, mode segments, XYZ route with surface/level
IDs, confidence, source freshness, attribution and warnings. Return explicit
no-route/feed-unavailable errors. Transit waits and board/alight instructions remain
visible, even when its vehicle path is shown in the same world.

## 4. Draw the blue route without altering the world

Create a separate shared-renderer navigation group and a corresponding Unreal
consumer. Drape each route on its selected canonical surface/level. A route through
a tunnel stays below the overpass, and stairs follow the stair geometry. Do not use
the current global "highest surface" paint settlement for routes.

Use a thin ribbon/tube with an adjustable screen-readable width and a small visual
lift. Depth-test against buildings; do not fake x-ray routing through walls. Optional
overview/occluded-route hints can be a clearly different dashed treatment. Roads,
walkways and transit legs can use related but distinguishable styles and arrows.

Render only a chosen route and a small number of alternatives. Cache immutable
route buffers by network/world version, update only on a route change, and reuse
them through region unload/reload. Do not raycast thousands of road triangles every
frame. Offline walking/biking/car packages can follow later; transit without a
current connection is labelled schedule-only.

Lane-level car guidance is a later phase. It requires verified lane connections,
turn permissions and junction topology, not the apparent position of a painted
stripe. Until then draw on the appropriate carriageway and give road-level turns.

## 5. Promotion gates and rollout

1. **Network pilot:** snapshot inputs; audit mode permissions, one-way/turn
   restrictions, public entrances and cross-region joins on a small SF/Oakland area.
2. **Road routing:** integrate Valhalla car/bike/walk and ordered via stops; compare
   against manually reviewed legal routes before drawing guidance.
3. **3D display and hills:** add canonical surface binding, stair costs and hill
   preference; validate against held-out elevations and timed trips.
4. **Transit:** add OTP and regional GTFS/GTFS-RT with depart-at, feed-expiry and
   missed-transfer tests. Handle onward stops as time-dependent legs, not independent
   requests all departing at the same time.
5. **Offline and lane refinement:** only after the above gates pass; versioned local
   packages and measured lane topology, with automatic old-version fallback.

Required regression routes: a steep versus flatter SF alternative; a legal public
stairway excluded for cars; a bicycle contraflow permission that differs from car
permissions; Geary/Masonic overpass/underpass; Oakland divided-road turns; transit
with a walk transfer, delayed service and stale feed; a building with no public
entrance record; ordered three-stop navigation; a region boundary; an impossible
step-free trip. Require no illegal connections, no floating/buried route, and no
route-time benefit from uncertain visual geometry. Set ETA and latency thresholds
from the pilot's measured baseline, not arbitrary promises.

Deployment requires version-matched network, canonical geometry and renderer,
privacy/license review, route legality tests, elevation tests and performance gates.
This pass adds only this plan: no routing services, downloads, API keys or UI controls.
