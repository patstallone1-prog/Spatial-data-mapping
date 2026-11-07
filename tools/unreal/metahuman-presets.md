# Epic MetaHuman acquisition (UE 5.8)

`metahuman_presets.py` copies Epic's installed Core presets, requests full facial
blendshape rigs and source skin textures from Epic, then assembles Optimized / High
runtime Blueprints. Preset definitions alone are not a completed download.

Run in the editor with a GPU and the MetaHumanCharacter/PythonScriptPlugin plugins
enabled. Keep Epic's normal authentication available; the pipeline returns to editor
frames while cloud requests run, so the account portal can operate. It does not
store credentials or accept new agreements. Each cloud phase times out after 20 minutes.

On a 16 GB Mac, run **one name per editor process**. Point the project's `Content/Characters`,
`Saved` (SavePackage temporary files), DDC, Zen and TMPDIR at a mounted external drive.
Copy and verify existing Saved files before replacing its directory with a symlink.
Keep at least 12 GiB on the content and staging volumes and monitor internal swap space.
Do not remove unique source assets to make room. Cap compilation concurrency with:

```
-asyncassetcompilationmaxconcurrency=1
-asynctexturecompilationmaxconcurrency=1
-asyncskeletalmeshcompilationmaxconcurrency=1
-asyncgroomcompilationmaxconcurrency=1
-ini:Engine:[DevOptions.Shaders]:PercentageUnusedShaderCompilingThreads=85
```

Set `KERBSIDE_MH_PRESETS=Bo` (or another name from the script),
`KERBSIDE_MH_REPORT=/absolute/path/report.json`, and `KERBSIDE_MH_QUIT=1`.
Launch UnrealEditor with the project, `/Engine/Maps/Entry`, and
`-ExecCmds="py /absolute/path/tools/unreal/metahuman_presets.py"`.
Do not use `-ExecutePythonScript`: that option exits before asynchronous callbacks finish.
Logs can contain account identifiers; keep them private.

Repeat for Bo, Celeste, Isaiah, Jorge, Lani, Omari, Sunita, Trey and Vivian. Existing
valid Blueprints are reused. Failed source assets are never automatically deleted.
Set `KERBSIDE_MH_VERIFY_ONLY=1` in a **fresh editor process** to reload the resulting
Blueprint classes without acquiring or assembling anything. Check every name is ready
in the report; a process exit code alone does not establish success.

Finally run `characters_setup.py` inside the editor with `KERBSIDE_REQUIRE_METAHUMANS=1`.
It discovers both the original `Unpacked/Ada` and the new `Built/<Name>` directories,
refuses an incomplete ten-MetaHuman roster, and writes the native player's config.
No mannequin substitution is allowed in this strict mode. Binary assets remain in
the Unreal project, outside Git. This does not convert native assets into browser avatars.

For a resumable one-process-at-a-time batch, use `batch_metahumans.py` with `--project`,
`--engine`, `--xcode`, `--volume` and `--reports` paths. It verifies each preset in a fresh
process and installs the strict native roster only after all nine additions pass. Reports
and logs belong on the external volume and stay private. An already launched first preset
can be followed with `--adopt-pid`; never pass an unrelated editor PID.

For an interrupted source save whose texture-ready flag was persisted too early, set
`KERBSIDE_MH_REFRESH_TEXTURES=Bo` (a comma-separated preset list) for one recovery run.
This refreshes texture sources without deleting the saved character or replacing its rig.
Readiness now waits for Unreal's assembly gate as well as the texture flag. On a failure
with pending callbacks, the editor is retained and the batch stops for attention; it does
not tear down registered character data or start a second editor over the same project.

The batch driver allows four hours per cold assembly phase by default (`--phase-timeout`
sets an explicit bound). Adopting an already running editor only waits; the full 8 GiB
internal swap reserve is checked again before every subsequent editor launch.
