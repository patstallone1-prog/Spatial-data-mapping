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

**Not compiled, imported, visually accepted, packaged or deployed yet.** Native editor
inspection failed twice because the Mac was locked. Engine header/build-script reads from
`/Volumes/HP P700 1/UnrealEngine/UE_5.8` stalled; the first build attempt produced no UBT
result. These are not successful build results. Do not mark this version release-ready.
The stalled build was stopped (exit 130); it is not silently compiling in the background.

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
  It hashes the renderer and every tile. A fresh 250 m SF pilot exported 799,354 triangles
  in 8,883,044 bytes, including 12,017 curb triangles and 10,335 ramp triangles.
- `tools/unreal/setup_world.py`: dedicated, separately saved city map; no stale release
  archive fallback; checksum/source-version checks; per-surface collision policies; an
  axis/units calibration GLB to determine the installed Interchange basis before placement.
  Unknown semantics, unexpected axes, mixed collision policies and empty imports fail closed.
  Existing saved maps are not replaced. Default city map is selected only after successful import.

## Verification available now

Ten focused Python tests pass: reversible/idempotent installer, anti-overwrite protection,
source camera/physics contracts, current export paths/frame/hashes, calibration GLB structure,
axis/scale rejection, collision semantics and corrupt/path-escaping tile rejection.
Reinstalling the plugin preserves an accepted default city map rather than reverting to OpenWorld.
Ruff and Node syntax checks pass. Native `Kerbside.World` automation tests were added,
but **have not run**. Python/source assertions do not establish native physics or image quality.
The exported pilot was independently decoded with GLTFLoader: 78 meshes, 799,354 triangles,
with roads, sidewalks, curbs, buildings and ramps all present.

## Resume / acceptance / deployment

Unlock the Mac and restore responsive engine-drive access. Save any unsaved editor work
before restarting to load the newly enabled compiled plugin. From the repo root:

```sh
.venv/bin/python tools/unreal/install_runtime.py '/Users/elialbukerk/Documents/Unreal Projects/Kerbside/Kerbside.uproject'
'/Volumes/HP P700 1/UnrealEngine/UE_5.8/Engine/Build/BatchFiles/Mac/Build.sh' KerbsideEditor Mac Development -Project='/Users/elialbukerk/Documents/Unreal Projects/Kerbside/Kerbside.uproject' -WaitMutex -architecture=arm64
```

After a successful build, run the native automation tests and run `tools/unreal/setup_world.py`
in a separate UE Python commandlet against the same project (absolute script path). The default
pilot manifest is `build/unreal-pilot/manifest.json`; `KERBSIDE_TILE_MANIFEST` can select another
fresh export. Check importer slot names, probe conversion, actual floor traces, walls/fences,
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
on supported Macs in UE 5.8, not categorically unavailable. Compiler acceptance still needs
to be checked against the installed engine's SDK requirements.
