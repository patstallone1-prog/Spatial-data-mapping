# Park rendering and exterior walker repair

## Scope and preserved state

Based on main `0d2fa447`, including the recent routes, bus zones, hill movement,
Francisco photographic facades and HABS comparison. Shared renderer changes are
rebuilt into all eight app worlds. Frozen website pages and canonical terrain,
footprints, heights and utility source records are not replaced.

## Root causes and fixes

1. Electrical rendering paired unconnected poles by proximity, distance and
   heading. Photograph-detected park poles could therefore acquire invented
   conductors over a court. That entire pairing algorithm is removed. Poles,
   towers, masts and court lighting remain. A wire requires an explicitly
   identified OSM overhead-line way, its source, valid coordinates and supported
   power type; underground/submarine/indoor records are rejected. Ingestion now
   retains location and node identities. OSM is connectivity evidence, not proof
   of current centimetric survey accuracy; catenary sag/heights remain inferred.
2. The per-pixel 512-square grass generator had acquired seven broad radial
   stains, repeated with every eight-metre texture tile. Those stains are removed;
   deterministic pixel colour, blade detail and all twelve grass variants remain.
3. Park meshes only chased coarse terrain chords, and their normals still belonged
   to the flat sheet before lifting. Parks now subdivide against the survey grid
   (four-metre length cap, five-centimetre chord tolerance, two-metre minimum,
   grid snapping). Terrain-conforming cover normals are recomputed after lifting.
   The terrain binary is unchanged: no synthetic hills are claimed as measurements.
4. Open-door movement and GPS could place the visible character in a footprint.
   Canonical building footprints now block movement even at open doors, including
   radius clearance. Interior arrival points resolve to an exterior edge or safe
   street fallback. A per-frame guard also repairs stale saved/spawn positions.
   GPS uses the same rule; attached regions expose the same exterior/collision API.
   Existing room models and door inspection are retained, but the walker no longer
   traverses a house, as explicitly requested in this pass.

## Verification

- 217 focused tests passed, including the committed road-width/crossing baseline,
  terrain frame conversion, movement, furniture, app release and PWA checks.
- Six new park safety regressions exercise explicit connectivity, rejection of
  inferred/underground lines, exterior landings, open-door collision, shared GPS
  and guest-world guards, and grass/terrain rules.
- CI's blocking lint selection passed locally. Broad lint on the embedded renderer
  additionally reports pre-existing formatting findings; unrelated formatting
  was not rewritten.
- Real-data browser fixtures inspected at Moscone, Fort Mason and Oakland.
  Moscone's preview contains no overhead-wire meshes, uses 512-square grass maps,
  and reports the walker outside a building. Hills remain visible at Fort Mason.
- All eight app consumers and the installed-app release/worker fingerprint are
  regenerated from the shared source. Graphify updated AST-only, without API cost.

## Limits and observed separate defects

This is not a photographic survey of every park. Existing paved strips/path
fragments are still visible in the SF park fixtures, and irregular plaza paving
remains in Oakland; those are distinct ground-cover/path defects, not invented
electrical connectivity. No claim is made that this pass repairs all city geometry.

References: [Moscone facilities](https://www.sfrecpark.org/Facilities/Facility/Details/Moscone-Rec-Center-101),
[OSM pole connectivity](https://wiki.openstreetmap.org/wiki/Tag:power%3Dpole),
[OSM overhead distribution lines](https://wiki.openstreetmap.org/wiki/Tag:power%3Dminor_line).
