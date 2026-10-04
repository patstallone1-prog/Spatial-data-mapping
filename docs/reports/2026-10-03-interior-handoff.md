# Interior/rendering pass checkpoint — 2026-10-03

Branch: `codex-visual-world-objects`; draft PR #9. Not deployed at this checkpoint.

The prior exterior corrections (whole-window roof margins, inferred vehicle-access width,
grass/pavement masking and elevated crossing warnings) remain preserved. This pass adds
current-room ceiling cameras, correct regional terrain-frame sampling, and provenance-safe
placements of one real Redwood RGB-D apartment scan. This is a borrowed demonstration
layout, not a survey of any target address. The 347-entry scan catalogue is not 347 downloaded
meshes. Upper floors and entrance adaptations remain explicitly inferred.

Real doorway walking was checked in the local renderer at:

- 171 Vernon Terrace, Oakland: entered scanned room, ceiling camera enabled.
- 4000 Noriega Street, San Francisco: entered scanned room, ceiling camera enabled.
- 1366 27th Avenue, San Francisco: traversed four attached recessed steps and landing;
  entered the scan, ceiling camera enabled. Its per-instance scan cut yields to the existing
  inward stair recess without extending onto the sidewalk or editing the source GLB.

Focused checks: 75 renderer/interior tests and 17 template/terrain/width tests passed;
lint and whitespace checks passed. Canonical payload hashes and all placed scan vertex
containment checks passed. Graphify was updated.

Remaining: scan acquisition holes, soft vertex colour and incomplete rooms remain visible;
the borrowed scan is not a complete photographic house. Broad privacy/performance/region
acceptance, signal close-ups and real mapped pole/wire visual coverage are not complete.
PR CI and final release acceptance must pass before merge/deployment. The next requested
work is the existing Unreal project, not further unbounded scan polishing.
