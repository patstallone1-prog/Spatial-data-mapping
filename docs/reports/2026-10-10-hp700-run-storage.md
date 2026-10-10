# HP700 run storage — 2026-10-10

The active frontage run's scratch storage was moved to:

`/Volumes/HP P700 1/Kerbside/frontage-run-2026-10-10`

The actual APFS external volume is mounted at `HP P700 1`. The older `/Volumes/HP P700` directory is on the internal filesystem and was not used or removed.

## Verified migration

- Paused this run's launchd supervisor and confirmed both workers exited before copying.
- Copied 13 selected run paths: imagery/pixel store, facade facts, pilot/audit views, model caches, material reference cache and worker logs. Shared source catalogues in the other checkout and the repository/deployment files were not moved or deleted.
- Compared SHA-256 inventories before cutover, rechecked source/destination inventories during cutover, preserved model-cache links and empty directories, then flushed pending writes.
- Verified **12,743 files**, **13 internal links** and **25,717,374,656 bytes** (approximately 24 GiB).
- Replaced the old run paths with aliases to the verified external copies so existing absolute receipts and worker arguments still resolve correctly. Only the exact newly created local backups were removed; the external copies remain recoverable.
- Saved the full per-file receipt on the drive in `migration-manifest.json`. A small local pointer is retained at `build/frontage-supervisor/storage.json`.

Mac free space increased to approximately 27 GiB; the HP700 had approximately 159 GiB free after the copy. Processing can change these figures afterward.

## Processing policy

The installed service now validates the exact external volume UUID, actual mount status and external-device identity before starting workers. A stale directory or another drive with the same name cannot pass. The 4 GiB reserve is checked on the external volume, not the Mac. A disconnect/statvfs race pauses processing; log descriptors are reopened on resume instead of retaining an old drive descriptor. Tiny supervisor status/lock/launchd diagnostics remain local so a missing drive can still be reported.

Full private batches of 256 resumed successfully from the HP700 with one filter and one matcher. Battery processing is explicitly enabled strictly above 30%; at/below 30% or an unknown power reading the jobs pause. Automatic publication remains disabled. The controller prevents idle sleep while eligible but cannot override closed-lid sleep or shutdown.

Keep the drive connected while processing. If its mount name changes on reconnect, update the LaunchAgent's mount-point argument; the UUID guard still prevents selecting the wrong disk. Run storage is intentionally ignored by Git, whereas the transfer/guard code is versioned.

## Release and accuracy status

PR #32 merged as `9d53aa02`; GitHub's ruff, pytest and render-audit gates passed, and Vercel's production deployment succeeded. The live `runtime-release.json` renderer hash matches the committed release. The API credential supplied for diagnosis was not saved in the repository and should be rotated because it was pasted into chat.

The earlier three-house audit remains low certainty. The latest matcher checkpoint reported 522 buildings and 549 private proposals, not approved measured houses. No storage migration, processing-rate increase or software deployment overrides photographic alignment/privacy/material review.
