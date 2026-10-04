# Background tasks: what runs, where it journals, how to resume

`python tools/background_status.py` reads every journal below and prints one line per task
(and writes `build/background-status.json`). It runs nothing.

| Task | Runner | Journal | Resumes by |
| --- | --- | --- | --- |
| Photographed facades | `scripts/run_facades_background.sh` (launchd `com.kerbside.facades`) driving `scripts/build_facades.py --chunk` | `build/facades-background.log`, `build/facades-background.status.json`, and each chunk's `docs/facades/<chunk>/manifest.json` | skipping every chunk that already has a manifest |
| Facade re-render (finer) | `scripts/build_facades.py --chunk K --rerender` with `FACADE_PIXELS_PER_M` / `FACADE_MAX_EDGE_PX` | the chunk's manifest (unchanged); a wall that fails the gates keeps its old texture | re-running the chunk |
| Photo objects (openings per building) | `scripts/build_photo_world_objects.py --region R` | `data/regions/R/world/photo_objects.journal.jsonl` (fsynced per building) and `photo_objects.summary.json` | the journal's source hash: an unchanged building is not redone |
| Window sidecar | `scripts/build_home_openings.py` | `docs/sf-corridor-home-openings.json` (merged from every region's journal) | re-running it |
| Street furniture & electrical | `build/furniture-refresh.sh` driving `scripts/build_street_furniture.py --region R --refresh` | `build/furniture-refresh.log` | re-running a region (an empty Overpass answer is now a failure, not cached) |
| Interior scan levels | `scripts/build_redwood_detail.py --level detail|full` | `docs/interior-scans/<level>/<level>.json` and the scan manifest | re-running a level |
| Photogrammetric mesh | `src/smc/reconstruction/colmap_runner.py` | `docs/photogrammetry-audit-2026-09.md` | blocked: COLMAP is not installed and the source frame corpus is not on this machine |

## State on 2026-10-04

- Facades: every chunk with buildings in the SF corridor is textured, 13,567 walls in 200
  chunks, published as WebP and streamed near the walker (`updateFacadeStreaming`).
- Photo objects: all eight regions journaled; 8,869 buildings accepted, 8,089 with
  photographed windows in the shared sidecar.
- Electrical: poles, power lines, transmission towers and communication masts are fetched for
  every region. Mapped lines hang on their supports; poles no line joins are strung pole to
  pole by inference (spans 15-65 m, catenary a = 200 m: about 1 m of sag over 40 m).
- Signals: one head per approach of each signalised junction (SFMTA in San Francisco,
  OpenStreetMap elsewhere). Stop and give-way points become one plate per governed approach.

## Unreal

None of these tasks needs Unreal Editor. The Unreal export (`docs/22-unreal-nvidia-world-runtime.md`)
does; the editor lives on the external drive (`/Volumes/HP P700/UE_5.8`).
