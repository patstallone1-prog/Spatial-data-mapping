# Road-paint regression release — 2026-10-03

Based on merged main `f9f77e16`, including PRs #9 and #10. PR #11's draft
reconstruction checkpoint is intentionally separate. No canonical city payload,
measured curb record, scan asset, or native physics implementation was changed.

## Causes and corrections

- Lane paint was independently terrain-lifted, while the rendered road uses its
  own refined triangles. The original SF pilot found 70 of 976 sampled marking
  triangles below asphalt, as much as 72.2 mm. Lane/centre/turn markings now settle
  onto the same road as crossings. Triangle-centre probes also catch higher road
  triangles between paint vertices, without uniformly subdividing the city again.
- Dashed paint formerly accepted/rejected an entire polyline segment using its
  midpoint. Coarse sampling could erase a stripe or produce one long strip. Paint
  now splits at exact 3.05 m stripe / 9.14 m gap boundaries, independent of sampling.
- A mapped footway's inherited `walk_m` bypassed fitting to the measured curb.
  Its inner edge could cover a crossing even though its centreline cleared the
  road. Recorded width stays in the data; all placed footways now undergo fitting.
- A 3.8 m ramp connector at Broadway/Telegraph could become an 8.4 m synthetic
  ladder through an acute corner. Width-only crossing fallback now requires the
  original mapped path to support at least 60% of the proposed span.
- Bike edge stripes were centred on their lane boundary and extended into the
  curb. Their full width is now inset within the lane, with a 20 mm margin.
- Final road paint is clipped locally against actual sidewalk/curb/island
  triangles. This does not compare crossing bounding boxes or delete a crossing
  because another crossing overlaps it. Genuine physical refuge islands remain
  gaps, not painted concrete. Parallel and perpendicular crossings have a dedicated
  independence regression test.

## Real-data inspection

`tools/road_paint_preview.py` retains whole neighbouring ways and uses the current
source renderer, published regional sidecars and full-resolution terrain. It is
an inspection tool, not a substitute slim deployment. Diagnostics use a bounded
triangle spatial index; initial unbounded diagnostic attempts were discarded.

Commands (serve repository root on port 8898):

```sh
.venv/bin/python tools/road_paint_preview.py --lon -122.41945 --lat 37.78881 --yaw 1.57 --pitch 0.40 --distance 90
.venv/bin/python tools/road_paint_preview.py --region oakland-downtown --lon -122.27172 --lat 37.8041 --radius 160
.venv/bin/python tools/road_paint_preview.py --region berkeley-downtown --lon -122.2683 --lat 37.8713 --radius 160
```

| Inspection area | Paint triangles sampled | Buried under asphalt or paving |
|---|---:|---:|
| SF Bush Street, near 1340 Bush | 1,843 | 0 |
| Oakland Broadway/14th neighbourhood | 2,008 | 0 |
| Berkeley downtown | 2,820 | 0 |

Visual inspection showed restored Bush Street lane stripes and independent
crossings, and visible lane/centre paint in Oakland and Berkeley. Saved local
screenshots and full sample diagnostics are in ignored
`build/road-paint-preview/<region>/{verified.jpg,audit.json}`. This is a sampled
rendering acceptance check, not proof that every source marking in every city is
survey-correct. Some road/bike lines still bend with inconsistent source profiles;
street furniture and unsupported procedural details are not a photographic survey.

149 focused renderer/geometry/synchronization/width tests passed. Lint passed.
The published modules pass Node syntax checks. Canonical payload hashes remain
unchanged. Full remote CI and CI-gated Pages promotion are required for release.

## Authoritative versions and release rules

- `main` is the stable release branch. Other worktrees/draft PRs are not consumers.
- `scripts/build_sf_corridor_3d.py:HTML` is the shared renderer source. Edit this,
  not a generated page or `build/app-viewer.html`. Regenerate the canonical SF
  page and run `python tools/build_app_worlds.py` after a source change.
- `docs/runtime-release.json` records the shared renderer hash, all eight app
  consumer hashes, the app shell hash, and current native plugin source hashes.
  Every app's **complete module**, not only selected functions, must match the
  source in CI. Existing regional website pages remain frozen legacy consumers.
- The committed payloads/sidecars and scan manifest are the data authority.
  Measurements remain intact; rendering corrections do not relabel visual fallback
  as a measurement. Native derived geometry carries its own renderer hash and
  requires an explicit re-export/import; this web-app release does not claim a new
  native Unreal executable.
- GitHub `main` protection requires an up-to-date PR and green `ruff`, `pytest`,
  and `render audit vs baseline`, including administrators; force-push/deletion
  are blocked. The policy is recorded in `tools/release/main-protection.json`.
  Pages publishes only the exact green main commit and refuses stale workflow runs.
- The installed-app service-worker version is regenerated from content hashes.
  No protection can guarantee all future bugs are impossible; these guards block
  known failures, stale generated runtime copies and ungated releases.

## Real scanned interior locations

- 171 Vernon Terrace, Oakland, CA 94610.
- 4000 Noriega Street, San Francisco, CA.
- 1366 27th Avenue, San Francisco, CA.

Each hosts a fitted copy of the genuine Redwood Apartment RGB-D scan. These are
explicitly labelled **borrowed surrogate interiors**, not scans of these addresses.
Only one actual apartment mesh is currently imported; the larger scan catalogue
does not mean hundreds of downloaded/scanned local houses.

## External Unreal drive

Save and quit Unreal Editor and Epic Games Launcher, allow any build/import/write
to finish, then eject the drive successfully in Finder before unplugging. Browser
app changes in this release do not depend on keeping the Unreal drive mounted.
