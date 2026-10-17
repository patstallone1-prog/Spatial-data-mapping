# Detail-window regression audit — 17 October 2026

## Root causes and corrections

1. **Ground strips and missing context:** coarse roads were clipped by their sampled
   stations, buildings/crossings by their centres, and source cells by vertices only.
   A segment with both ends outside could cross through detailed streets; a large
   parcel with no vertex inside could disappear. Cells now index full feature bounds,
   window filtering retains intersecting/enclosing geometry, and complementary world-space
   shader masks give coarse and detailed surfaces one exact boundary. Background terrain,
   grass masks and park polygons are bounded to the data actually loaded, not a whole-city
   terrain box backed by partial ground classification.
2. **Failed handoffs:** a transient cell error silently fetched an entire city. This can
   exhaust a returning installed app's memory. Transient network/server errors now get
   bounded retries; a failed indexed cell propagates instead of allocating the whole file.
   The last ready world remains until the replacement's ground succeeds. Coarse tiles remain
   resident and update their ownership uniform rather than being discarded at each handoff.
   Viewer imports pin the streaming module's content hash, preventing old browser modules
   from being paired with a newer viewer.
3. **Running into the edge:** small arrivals grow to a rolling 700 m detail square. Work
   starts with 280 m of margin, leads movement by 160 m, and can warm source cells up to
   1 km farther out within the shared 48 MiB decoded-cell cache. Unexpected long jumps
   prioritize a 440 m arrival square. A 1.3 km background mesh build was tried and rejected:
   browser checks showed that its construction was too slow to stay ahead of movement.
   This is bounded preparation, not a claim that every arbitrary jump is instantaneous.
4. **Teleport snapping:** safe street destinations still used the initial world's road
   segments. Clicks now query their owning guest and transform both the request and result
   correctly. Unloaded distant points never snap back to the startup city. Street snapping
   within a ready window is bounded to 150 m. Exploration also uses destination-owned
   ground height.
5. **S address picking:** picking now ray-tests canonical building prisms in the correct
   coordinate frame, independently of merged/hidden facade meshes, with exact-centre priority
   and an eight-pixel edge tolerance. Streets and cross-street queries likewise use the owner.

## Evidence

- Executed regression fixtures cover crossing/enclosing geometry, cell indexing, source
  hashes, module versions, roof and facade rays, transformed guest teleports, distant-click
  preservation, transient errors, bounded growth, true region edges, and composed shaders.
- The full-page Node smoke tests execute the shipped script in addition to focused geometry
  and render-baseline checks. These are not a substitute for graphical checks.
- Local browser: SF detailed ground and markings loaded around the California/Buchanan area.
  S over a roof returned **2050 Buchanan St, San Francisco, CA**.
- After an in-page SF → Oakland jump, detailed road paint and textured buildings replaced
  coarse geometry. S over the roof returned **346 9th Street, Oakland, CA, 94607**.
- Three open-ground right clicks recorded distinct destinations. The clicked and final
  horizontal positions matched exactly in those checks (0 m safe-landing adjustment),
  including Oakland after the cross-region handoff. This checks picking, not survey accuracy.
- Two 20-second movement sweeps exercised proactive rebuilds in Oakland while detailed
  roads remained visible. The oversize-window experiment above was observed during this
  check and removed; subsequent release uses the smaller rolling-window policy.

## Boundaries

No measured curb policy, nature design, street-tree layout, sky implementation, photographic
fits or source geometry was replaced. All eight app viewers are generated from the same
renderer. Cell manifests include source SHA-256 and indexing version; CI rejects stale
indexes or mismatched runtime imports. Visual checks sample SF and Oakland, not every street
or device. Extremely fast travel or slow networking can still show the coarse fallback while
a destination builds. Required CI and the committed render baseline remain release gates.
