# Native relaunch cleanup — 17 October 2026

The existing regional/foliage pass is preserved in commit `0879666a`, atop
`claude-region-parity`'s committed municipal detail and sky/weather work. No older
tree, grass, sky, map or renderer implementation was restored. The release branch
integrates that checkpoint rather than rebuilding its design.

The installed Unreal project contains the weather/wind revision `49f3c3d9`.
Its existing five required native automation cases passed with no warnings.
Those are automation results, not proof of a graphical foliage acceptance pass.

## Relaunch

Use `tools/unreal/launch_macos.py --project PROJECT.uproject --engine UE_5.8
--xcode Xcode.app --cache-dir EXTERNAL_CACHE --log EXTERNAL_LOG`.
Additional Unreal flags follow `--`; `--check-only` verifies SDK and Metal without
starting the game. The helper uses the project's existing default map and makes
no global `xcode-select`, source, map, material, collision or geometry changes.

Xcode 26.3 and its separately installed Metal compiler resolve successfully.
The graphical runtime initialized Metal SM6. The original failure was followed
by internal-disk exhaustion, including Zen HTTP 507 and shader-transfer ENOSPC.
Both Zen and filesystem DDC now use explicit external-drive command-line paths;
embedded quotes must not be added to subprocess arguments (Unreal quotes them).
Missing external cache mounts fail closed instead of creating an internal fallback.

The old generated DDC is retained on HP700 in
`Kerbside/unreal-ddc-backup-20261017`, not deleted. Shader-transfer intermediates
are relocated to `Kerbside/sky-build-2026-10-17/ProjectIntermediate`, linked from
the installed project's original Intermediate path. Source/content remain intact.

## Explicit remaining native limitation

`docs/foliage-motion.mjs` is the saved web foliage implementation, including wind
and walker response. The described native UV2 export, masked leaf master material,
material-parameter collection and native grass hookup were not present in any
active checkout or the installed plugin at handoff. The current exporter explicitly
omits canvas textures. Do not label the existing native city as having completed
or visually verified those hookups; a successful Metal launch alone cannot prove
them. Web production and an installed Unreal project are separate consumers:
a Vercel release does not distribute a newly packaged native application.
