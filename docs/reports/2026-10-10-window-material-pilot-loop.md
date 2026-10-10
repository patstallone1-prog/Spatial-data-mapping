# Window/material pilot loop — 2026-10-10

## Changes

- Corrected asynchronous photographic-material repainting: each cached facade keeps its own recorded variant, rather than every building taking the last downloaded image. Temporary repaint textures are disposed after transferring their canvas.
- Removed invented dark floor-height trim from bare photographic home walls. Source colour bands remain independent; unknown materials remain inferred fallback, not a newly measured classification.
- Kept clear, neutral 12% glass in close-up shells in both directions. Distant designed-window decals now also contain a neutral glass layer, with no photographed curtains/blinds baked into panes.
- Added conservative image-space curved-window proposals. The crown requires orientation-aware edge support across three arc sectors plus jamb support; a straight lintel, rectangular frame or blind pattern alone cannot pass. These proposals explicitly need shape review and cannot silently become high certainty.
- Added matching arched glass, framed borders, clipped mullions and wall spandrels. Pane and spandrel partitions share one 32-segment crown, retaining the opening area without uncovered rectangle corners. Frames have depth and remain visible from inside. Partial bay-face fragments retain conservative rectangular geometry pending a general split-curve implementation.
- Photo windows exceeding their registered roof envelope are withheld instead of cut in half.
- The private pilot now uses the actual glass-opacity and photographic-material helpers, source-hash cache busting and individual house/source comparison views. Its former 80% glass and untextured wall stubs were not representative of the app.

The implementation follows [OpenCV edge/shape primitives](https://docs.opencv.org/4.5.5/d3/dc0/group__imgproc__shape.html) and [Three.js shape geometry](https://threejs.org/docs/pages/ShapeGeometry.html). Material references are the existing CC0 library, not textures independently measured from these houses. Physical texture sampling scale is still unknown in that library and is not represented as measured.

## Three-house comparison

Source photographs and low-certainty fits remain under ignored `build/frontage-accuracy-audit/pilot/`; no restricted pixels are committed or published.

| Source house | Verified improvement | Still unresolved |
| --- | --- | --- |
| 4153 20th Street, SF | Four observed upper windows retain clear glazing and source frame divisions; no unsupported floating entry is added | Pebble-dash inset panels, gated entrance and photo-to-ground alignment |
| 652 Guerrero Street, SF | Six upper window objects retain separate framing; yellow source blinds are not baked into glass | Central bay/parcel-depth conflict, ornament, entrance and ground-floor material boundary |
| 2332 Taraval Street, SF | Eight source windows map onto 16 canonical face fragments, not 16 invented windows; the top-left arch is detected and rendered; both canonical bay returns remain without an additional extrusion | Bay depth/pose validation, ground-level truck occlusion and shop/entry alignment |

All three remain **low certainty**, based on image-space registration and canonical height/footprint priors. The visual loop does not prove inch accuracy, solved poses, lidar agreement or three promotable houses. A conservative bay/property refusal is retained rather than hiding the conflict by expanding geometry into the street.

## Private processing and release boundary

The latest user request authorizes full-pace **private proposals**: 256-photo batches rather than 24. This is separate from three-house approval and public publication. The launchd supervisor was reloaded with the explicit private-processing flag; it still never publishes automatically, pauses on battery/unknown power and preserves a 4 GiB free-space reserve. At inspection the Mac reported battery power and approximately 4.7 GiB free, so the service was waiting for AC rather than actively processing. Approximately 22 GiB of private frontage evidence remains; unresolved evidence is not deleted merely to increase throughput. A rejected-pixel cleanup found no additional rejected files to remove.

All eight generated app viewers and the service-worker/release fingerprints are rebuilt from `scripts/build_sf_corridor_3d.py`. Deployment remains gated on the PR's ruff, pytest and render-audit checks; the low-certainty pilot facts are not a public asset promotion.

Verification at this checkpoint: **60 focused tests passed**, including material-variant isolation, roof-envelope guards, curved-pane/spandrel area conservation, blind rejection, cross-region renderer synchronization and the private worker approval boundary. The CI blocking lint command passed. The source/render browser loop reported no JavaScript errors. Graphify's AST update produced 14,579 nodes and 21,610 edges without model extraction; it warned that 99 community labels changed, so semantic relabeling remains deferred.
