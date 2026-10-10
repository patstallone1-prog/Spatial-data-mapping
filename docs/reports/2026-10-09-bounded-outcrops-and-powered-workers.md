# Bounded outcrops, clear glazing and AC workers — 2026-10-09

This follows the private facade pipeline audit from the same date. It supersedes that checkpoint's source-coloured glazing: photographed blinds/curtains are now retained only as evidence metadata, not rendered into glass. The earlier pipeline and this renderer upgrade are one isolated, unpromoted branch.

## Renderer and extractor

Four supported visual families are **canted three-sided bay**, **square box bay**, **rounded bay** and **upper-storey oriel**. Reviewed source-image boxes preserve horizontal/vertical placement on the explicit canonical facade prior. Depth and side-face proportions may be inferred; they are not independently measured. Oriel support does not certify cantilever structure, and no single photograph certifies physical load-bearing safety.

`src/smc/facades/outcrops.py` requires an image-hash-bound visible shape review and a provenance-bound property ring. Depth is capped at 1.2 m and 45% of bay width, then restricted to the parcel. Concave boundaries check crossings as well as vertices/midpoints. A non-unit/nonfinite normal cannot bypass the physical depth cap. Missing boundary information suppresses projection; clipping marks it low certainty. Canonical geometry and collision are unchanged. A source window triplet can request bay review, but does **not** create an outcrop or claim measured depth.

The house-shell renderer cuts the supporting wall behind a permitted projection, generates its face panels and top/bottom caps, and places the same windows on the resulting faces. Windows that span faces are split without adding fabricated mullions at tessellation seams. Glazing is neutral/clear from either side, at a consistent 0.12 display opacity; photographed yellow blinds do not colour it. Trim and detected pane divisions remain. This is a display material, not a measured optical property. The general tall-building/far photographic facade paths do not gain a new complete photogrammetric shell in this pass.

All eight installed-app viewer modules were regenerated from the authoritative source. Generated/source equality and syntax checks remain mandatory. No raw photo pixels entered Git or a deployment.

## Three real fronts and the unresolved gate

The same three source fronts were rebuilt and inspected using actual house-shell functions on explicit diagnostic massing:

- **4153 20th Street, San Francisco:** correctly remains a flat-front negative example, not a randomly invented bay. Seven opening proposals; pebble inset panels and exact gate detailing are still missing.
- **652 Guerrero Street, San Francisco:** the reviewed three-sided bay requests 0.6 m depth. The current canonical facade plane and cached parcel disagree; the property guard therefore allows **zero outward projection** and labels it low certainty. Drawing the photograph's apparent depth over the property boundary would violate the requested rule. Full metric facade/parcel registration must resolve this instead of silently moving canonical geometry.
- **2332 Taraval Street, San Francisco:** a fresh official active subdivision parcel query recovered parcel **2362019**, absent from the yard-only sidecar (which omits some fully built parcels). The left bay is restricted to approximately **0.107 m**; the right bay is suppressed by the boundary. This is a low-certainty geometry conflict, not a claim that the real bays are that shallow. The arched window, detailed bay returns and occluded ground shop still need correction.

The cadastral source for the recovered parcel is [DataSF's active subdivision parcel endpoint](https://data.sf.gov/resource/acdm-wktn.json), queried with the building point and retaining exact returned coordinates/locator in the pilot manifest. The Guerrero boundary comes from the existing ground sidecar and has six-decimal quantization. Neither is magically centimetre-certified by storing more digits.

The requested **three good real-life matches are not achieved**. Therefore the full-speed run and production deployment are held. Improving the render and passing a software smoke test do not approve the remaining photo/metric mismatches.

## Persistent power-aware jobs

`scripts/run_frontage_workers.py` now supervises the private filter and matcher. A user LaunchAgent named `com.kerbside.frontage-proposals` was installed at:

`/Users/elialbukerk/Library/LaunchAgents/com.kerbside.frontage-proposals.plist`

A portable placeholder template is committed in `config/launchd/frontage-proposals.plist.example`. It requires paths to this checkout, the existing Python environment, catalogue root and private env file. It does not commit credentials. If this worktree is moved/archived, update those paths before expecting the local service to run.

The supervisor waits on battery, resumes automatically on AC, retains the 4 GiB disk reserve and restarts workers that stop. `caffeinate -s -w <supervisor-pid>` holds an **AC-only system-sleep assertion**, without keeping the screen awake. The user plugged in during validation: `pmset` reported AC/charging; both children resumed and macOS reported `PreventSystemSleep = 1` for the supervisor's caffeinate process. Battery waiting and AC resume were both observed live.

The existing midnight repeating wake and AC `sleep 0` settings were preserved, not overwritten. **No new arbitrary wake-from-sleep mechanism was installed.** A sleeping process cannot wake itself; closed-lid sleep, shutdown, FileVault/login and loss of power can still stop work. Keep the Mac plugged in, lid open and logged in for continuous local processing. macOS scheduled power events are separate from sleep prevention; the local `pmset(1)`/`caffeinate(8)` manuals and [Apple's power-event API](https://developer.apple.com/documentation/iokit/1557076-iopmschedulepowerevent?language=objc) describe that distinction.

Current status is `build/frontage-supervisor/status.json`; private logs are alongside it. The supervisor survives the Codex terminal session through launchd and starts at user login. It is not an unattended cloud service.

## Full-speed gate and validation

Default processing remains 24 new photo candidates per cycle. A 256-candidate batch is enabled only by `build/frontage-supervisor/approved-pilot.json` after at least three distinct **high-certainty reviewed** fact artifacts pass source comparison, outcrop alignment, openings, materials and privacy/rights. The gate binds exact fact bytes and the current renderer source hash. Changing the renderer invalidates the bulk approval. No such approval was created because the real pilot still fails. The supervisor never auto-publishes.

**95 focused tests passed**, including all eight generated viewer modules, source/release synchronization, outcrop bounds, concave parcels, source-image binding, clear glazing/cache behavior, seam framing, AC detection and bulk gate invalidation. Owned-file lint passed. These are focused checks, not a newly completed full CI run. Graphify was updated using AST-only extraction and warned about changed community labels.

The concurrent final audit showed why timing promises need caution: one cold pilot sample took about 98 s while indexing, background model work and graph extraction competed; subsequent samples took 2.7–3.4 s. Earlier uncontended warm measurements remain useful component baselines, but they are not proof of a 12-hour end-to-end production run.

That loaded audit also exposed a supervisor fault: `pmset` exceeded its 10 s timeout, and cleanup timed out waiting for a child. The supervisor now treats unavailable power information as a pause rather than crashing, and retains still-exiting child handles instead of spawning duplicates. Timeout/slow-exit regression tests pass; launchd was asked to restart onto that corrected version.

Render-only proof: `build/frontage-accuracy-audit/pilot/render-proof.jpg`. Public promotion remains blocked on the actual remaining geometry/material mismatches, not on whether the process runs.
