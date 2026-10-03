# Existing Unreal project — native runtime checkpoint

Native work is isolated on `codex-unreal-world-runtime`, based on the committed renderer
checkpoint. The preceding renderer branch/PR remains unchanged by native runtime edits.

## Status

The renderer pass was committed and pushed as `f7695970`; its draft PR #9 CI passed
all three jobs. The borrowed scan limitations and deployment deferral are recorded in
[the interior checkpoint](2026-10-03-interior-handoff.md).

The user's existing project is
`/Users/elialbukerk/Documents/Unreal Projects/Kerbside/Kerbside.uproject`, engine association
5.8. Despite the C++ project description it had no `Source/` or runtime modules. The
installer added a minimal host and repo-owned `KerbsideWorld` plugin without deleting any
existing content or copying EOS credentials. Original project/config files are recoverable
under the project's `Saved/KerbsideInstall/original/`. Its source hashes are registered in
`Saved/KerbsideInstall/manifest.json`; repeat installation rejects user-modified source.

**Compiled successfully in UE 5.8.3; not visually accepted, packaged or deployed.**
The earlier locked-Mac/engine-drive build failure was superseded by successful native
arm64 Editor builds using Xcode 26.3 and the engine-selected Mac SDK 26.2. Use
`-NoHotReload -NoUBA`; automatic IDE hot-reload detection failed with an empty process path.
The already-open user editor remains unresponsive and CPU-heavy. It has not been killed
or had its unsaved content overwritten. Save/close/reopen it before graphical acceptance.

## Versioned wiring

- `unreal/Plugins/KerbsideWorld`: native CharacterMovement capsule, seven-foot height,
  gravity, 20 cm maximum step, 12 mph first-person baseline, independent camera look.
- Static imported world collision uses Chaos triangle geometry, double-sided contact and
  `BlockAll`. The city itself is not a simulated dynamic body. Roads, terrain, sidewalks,
  ramps, curbs, medians, buildings and fences block the player. Paint, visual-only detail,
  foliage and borrowed scans do not acquire factual collision from this change.
- Native SkyAtmosphere, movable atmospheric sun (110,000 lux), real-time captured skylight,
  volumetric height fog, Lumen software GI/reflections and virtual shadow maps. Sun bearing
  and elevation are editable controlled daylight, **not live weather or a live ephemeris**.
- Existing renderer/native source is authoritative; the desktop project is a generated
  consumer, not another place to maintain a fork of the city.
- Exporter now consumes the current full app renderer, including regional app directories,
  and uses its bbox coordinate frame rather than assuming the lidar origin matches it.
  It hashes the renderer and every tile. The initial 799,354-triangle pilot was rejected:
  281,412 final triangles had zero area. Sampling the stalled native importer located the
  expensive overlap processing in `FStaticMeshOperations::FindOverlappingCorners`.
  Export now honors active draw ranges, excludes zero-area placeholders, and uses exact
  Float32 attribute indexing instead of millimetre-tolerance welding. No canonical data
  or measured coordinates are rewritten by this correction.
  A second sample and decoded-face audit found exact repeated faces: a road vertex appeared
  in 283,052 corners. Face deduplication now runs within each exact surface/material bucket,
  preserving UV/colour differences and reverse winding. The deduplicated diagnostic contains
  181,856 triangles versus 517,942 before deduplication (same nonzero surface coverage).
- `tools/unreal/setup_world.py`: dedicated, separately saved city map; no stale release
  archive fallback; checksum/source-version checks; per-surface collision policies; an
  axis/units calibration GLB to determine the installed Interchange basis before placement.
  Unknown semantics, unexpected axes, mixed collision policies and empty imports fail closed.
  Existing saved maps are not replaced. `KERBSIDE_WORLD_REVISION` selects an isolated map
  and tile namespace; invalid revision names and legacy buffer exports are rejected.
  Default city map is selected only after successful import.

## Verification available now

Twelve focused Python tests pass: reversible/idempotent installer, anti-overwrite protection,
source camera/physics contracts, current export paths/frame/hashes, calibration GLB structure,
axis/scale rejection, collision semantics and corrupt/path-escaping tile rejection.
Reinstalling the plugin preserves an accepted default city map rather than reverting to OpenWorld.
Ruff and Node syntax checks pass. Three real native `Kerbside.World` automation tests pass:
sky defaults, walker defaults, and isolated-world collision acceptance. The latter simulates
gravity to floor contact (capsule centre Z=108.830 cm, nominal half-height 106.68 cm; standard
engine floor clearance), walking into a wall (stops at X=257.899 cm against a wall at X=290 cm
with a 32 cm capsule radius), and camera rotation without translation. These prove fixture
physics, **not** imported-city walking or graphical quality. The fixture cleanup now calls
EndPlay; all three tests also pass in the final v4 native run.

`check_automation.py` inspects actual test states rather than the engine process status:
Unreal returned exit 0 even for the earlier failing acceptance runs. Missing/failed tests
now produce a failing validation result.

The next pilot export contained 518,108 triangles, but independent GLB decoding rejected
166 faces collapsed by the old tolerance-based weld. A separately saved **diagnostic-only**
recovery removed those zero-area faces: 78 meshes, 517,942 triangles, zero degenerates. It
retains the original GLB SHA and explicitly does not restore the lost small faces. Never
publish this recovery as the final native world: perform a fresh exact-index export first.
The cleaned/deduplicated diagnostic import is used only to test the native import path. Canonical
payloads and the preceding renderer worktree were not modified.

The diagnostic map `/Game/KerbsideRuntime/Maps/City_diagnostic_ready_v2` is now saved with
78 mesh actors, 33 static colliders, the physical sky rig, native game mode and road spawn.
Interchange slot normalization (`awning:band` → `awning_band`, numeric counters) is checked
against the manifest; unknown or ambiguous names still fail. Commandlet placement uses
explicit StaticMeshActor creation because asset actor factories were unavailable there.
Diagnostic retries can reuse an explicitly selected imported revision only after checking
every mesh's recorded source filename against the checksum-validated input. This reuse path
is prohibited for production manifests. Default-map selection is conditional on map-save success.
The actual imported spawn floor trace now passes in a separate UE commandlet, with zero
errors/warnings. The contact audit waits for async collider mesh compilation before tracing;
an immediate post-load query previously returned no hit. Python's optional HitResult return
is handled explicitly. Visual acceptance and actual in-city walking remain outstanding.
Nanite fallback collision has not been benchmarked against the original canonical surfaces;
the passing contact test is not a centimeter-accuracy claim.

## Resume / acceptance / deployment

Save any unsaved editor work before restarting to load the compiled plugin. From the repo root:

```sh
.venv/bin/python tools/unreal/install_runtime.py '/Users/elialbukerk/Documents/Unreal Projects/Kerbside/Kerbside.uproject'
'/Volumes/HP P700 1/UnrealEngine/UE_5.8/Engine/Build/BatchFiles/Mac/Build.sh' KerbsideEditor Mac Development -Project='/Users/elialbukerk/Documents/Unreal Projects/Kerbside/Kerbside.uproject' -WaitMutex -architecture=arm64 -NoHotReload -NoUBA
```

After a successful build, run the native automation tests and run `tools/unreal/setup_world.py`
in a separate UE Python commandlet against the same project (absolute script path). The default
pilot manifest is `build/unreal-pilot/manifest.json`; `KERBSIDE_TILE_MANIFEST` can select another
fresh export. Independently check `node tools/unreal/audit_tiles.mjs <manifest>` and
`python tools/unreal/check_automation.py <automation-index.json>`; neither a source assertion
nor a successful engine process exit establishes acceptance. Run commandlet startups serially
to avoid shared AutoSDK/log races. Check importer slot names, probe conversion, actual floor traces, walls/fences,
curb/ramp stepping, dynamic primitive contacts, gravity, stationary feet during camera look,
shadow contact and sky exposure in the editor and packaged game. Then export/import additional
cells and verify coverage and frame alignment before calling this an entire-city deployment.

The existing importer claims World Partition streaming but does not actually create a
partitioned level. This baseline deliberately does **not** claim World Partition/HLOD streaming,
full regional coverage, imported photographic textures, working house interiors, animation/IK,
live weather, cloud GPU service or a shipped native build. These require subsequent acceptance.

A native Mac package and a hosted Pixel Streaming game are different deployments. The target
choice was requested from the user; no paid cloud infrastructure is inferred or provisioned.
The existing installable web app cannot become an Unreal runtime merely by redeploying HTML.
Keep the download site/previous live app intact until the native package passes acceptance.

## Primary implementation references

- [Epic: macOS requirements and UE 5.8 rendering support](https://dev.epicgames.com/documentation/en-us/unreal-engine/macos-development-requirements-for-unreal-engine)
- [Epic: physical sky atmosphere](https://dev.epicgames.com/documentation/en-us/unreal-engine/sky-atmosphere-component-in-unreal-engine)
- [Epic: static complex collision versus simulated bodies](https://dev.epicgames.com/documentation/en-us/unreal-engine/simple-versus-complex-collision-in-unreal-engine)
- [Epic: skylight real-time capture](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/Engine/USkyLightComponent)

The detected machine is Apple M4 with Xcode 26.3. Software Lumen is the initial conservative
path; virtual shadows/Nanite require supported Apple Silicon. Hardware Lumen is experimental
on supported Macs in UE 5.8, not categorically unavailable. The native Editor target has
compiled successfully against the installed SDK. Packaged Game-target and graphical/device
acceptance are separate outstanding checks.
