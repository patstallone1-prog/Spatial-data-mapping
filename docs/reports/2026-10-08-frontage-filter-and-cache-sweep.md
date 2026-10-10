# Frontage photograph filter and installed-app cache sweep

## Cache finding

The production `https://spatial-data-mapping.vercel.app/sw.js` inspected during this pass still declares version `0cdc52f5b8d2939e`. It stores same-origin HTML/JSON in Cache Storage and serves other assets cache-first. Therefore local caching remains a plausible contributor to returning-visitor failures; it has **not** been excluded or established as the cause of the reported installed-app self-restart.

PR [31](https://github.com/patstallone1-prog/Spatial-data-mapping/pull/31) contains the seven-file shell-only policy, scoped obsolete-cache removal, and interrupted-load recovery. Its checks were green at inspection, but it was not merged or deployed. This pass additionally replaced the last mutable building-detail shard `force-cache` fetch with `no-cache`, regenerated all eight app consumers, and added regression coverage (commit `7bbdc5e5`). This fetch occurs during building inspection, so it is not independently a demonstrated explanation for a startup restart. HTTP caching/revalidation is distinct from service-worker Cache Storage. Capture IndexedDB and user settings are preserved.

## Implemented selection flow

Existing observation catalogues → camera/pose and public-street frontage matching → date/rights/geometry gates → ranked candidate index → bounded real-image download and semantic screen → private review gallery. Nothing in this pass publishes textures or modifies canonical geometry.

- Maximum facade-centre obliquity: **35°**; maximum edge obliquity: **55°**. These are geometric viewing angles, not just camera headings.
- Standoff: **3–55 m**, at least **12 source pixels/m**, at least **90%** predicted front coverage. Grouped facade envelopes include bay-window fragments and must span at least 80% of the footprint's projected width.
- Prefer full frontage, near-head-on angle bands, actual source sampling density, closer distance, then recency. Nearby buildings blocking any of three facade rays reject the pair.
- Capture date must fall within ten calendar years of the run date, not ten years from upload. Unknown/future dates fail; no level-assumed camera is promoted as measured evidence.
- Preserve every passing distinct observation/frontage pair, ordered sequence references, attribution, source aliases and licenses. Only exact decoded pixels deduplicate using the existing oriented/colour-normalized canonical pixel store. Source observations are never spatially thinned or rewritten.
- Approved free-source license identifiers and attribution are required. Share-alike obligations remain attached. Existing Mapillary, KartaView and Panoramax pixel adapters are reused.
- Official SF adopted individual-landmark polygons may bypass **recency only**, requiring the building centre and footprint corners to lie inside. District proximity, proposed status, unknown rights, missing date and poor geometry cannot receive an exemption. Historical observations remain explicitly non-current evidence. The 399-record inventory is fetched from the [SF Planning ArcGIS layer](https://sfplanninggis.org/arcgiswa/rest/services/PlanningData/MapServer/11). Its linked photographs are indexed for rights review, not treated as automatically reusable pixels.
- Pixel screen: pinned [OpenMMLab UperNet ConvNeXt tiny](https://huggingface.co/openmmlab/upernet-convnext-tiny), MIT-labelled, revision `876ffc56b819a829448f7e81e9f8606deef6fb65`, verified safetensors SHA256 `cd55b1d36c6602d34f8cd300d7f788ea0fa5c3ed928e9ac98f353ecb31c7fa1d`. Reject too little architecture, excess sky/trees/people/vehicles/ground or insufficient sharpness. This is selection evidence, **not** face/plate privacy certification.
- Retained candidates still need image-hash-bound identity, complete-front, opening-detail, occlusion and privacy review. Expanded context deliberately exposes upper-storey omissions caused by an inaccurate prior building height.

Graphify navigation helped reuse the existing camera/pose rectifier and canonical pixel store; the graph was updated after code changes rather than creating competing versions of those components.

## Verification

The frozen pilot attempted the first 100 SF buildings: 45 have 2,155 passing candidate pairs, including 959 provider-solved pairs. Eighteen real photographs were downloaded and screened: 11 retained review candidates, seven pixel rejections. Zero are certified for publication or measured geometry. Browser verification loaded all 18 images with no warning/error logs. A nearly head-on Union Street home visibly includes its roofline, bay windows, entrance and garages. Sky-heavy and tree-obscured negatives were visibly rejected. The Broadway example demonstrates why a semantic pass alone cannot certify full-height identity: its inaccurate canonical height requires human review.

Focused checks: **41 pytest tests**, **12 Node service-worker/startup behavioral tests**, Ruff, and `git diff --check` pass. Coverage includes angle limits, full-front clipping, panorama wrap, ten-year/leap-day boundaries, unknown dates, landmark restrictions, retained redundant viewpoints, building occlusion, invalid semantic fractions, image-hash-bound reviews and generated-app cache consistency. The whole suite was not run.

## First full indexing cycle

Eight existing regional catalogues contain 666,037 observation rows, with regional overlap; this is not a global unique-photo count. All 63,553 regional building records were scanned and 199,855 geometric candidate pairs retained across 12,061 building records:

| Region | Buildings | Buildings with candidates | Candidate pairs |
|---|---:|---:|---:|
| SF corridor | 15,986 | 5,184 | 146,199 |
| SF Mission | 8,313 | 1,637 | 15,873 |
| SF Haight–Castro | 5,293 | 1,085 | 8,255 |
| SF Sunset | 21,697 | 2,024 | 12,305 |
| Oakland | 3,564 | 736 | 5,099 |
| Berkeley | 2,669 | 234 | 1,202 |
| Palo Alto | 1,766 | 986 | 8,918 |
| San Jose | 4,265 | 175 | 2,004 |

These counts include non-residential buildings and overlapping regional records. Candidate pairs are not unique images, pixel-screen passes, measured facades, or proof that all Internet imagery has been harvested.

The full-cycle real-pixel sample completed at `2026-10-09 00:57:50 UTC`: five retained review candidates and 19 pixel rejections out of 24 downloads. The worker then entered `waiting_for_new_catalogues`. These are separate from the frozen 18-photo pilot results above. The high rejection rate illustrates why metadata/pose selection is not sufficient evidence of visible detail.

## Background worker and recovery

Worker PID at handoff: **97555**. Output root: `build/frontage-live/`. `worker.json` identifies the process; `status.json` reports current progress. Each region/run has `selection.sqlite`, an immutable `run.json` fingerprint and `summary.json`. The private gallery is written to `review/index.html` after the bounded image-screening stage.

The initial cycle indexes every passing catalogue pair, then downloads **24 best-first building examples per cycle**, not all 199,855 candidate pixels. This disk-conscious validation sample is explicit; unscreened pairs remain candidates. Per-building SQLite commits are resumable. A single-writer lock prevents overlapping jobs; below 4 GiB free space the watcher pauses rather than writing false empty results. Inputs, poses, geometry, policy and implementation are hashed. Changed source code stops the watcher safely and requires a restart. It checks for changed catalogues hourly while this Mac is awake; it is not a cloud job and does not survive an OS restart automatically.

Restart after confirming the old worker has exited, from this worktree:

```sh
PYTHONPATH=src /Users/elialbukerk/Projects/Applications/spatial-mapping-crowdsource/.venv/bin/python -u scripts/filter_frontage_photos.py \
  --data-root /Users/elialbukerk/Projects/Applications/spatial-mapping-crowdsource \
  --regions sf-corridor sf-mission sf-haight-castro sf-sunset oakland-downtown berkeley-downtown palo-alto-downtown san-jose-downtown \
  --landmarks --sample 24 --pixel-screen --watch-seconds 3600 \
  --model-cache /Applications/Spatial-data-mapping-returning-visitor-cache/build/frontage-pilot-v2/model-cache \
  --env-file /Users/elialbukerk/Projects/Applications/spatial-mapping-crowdsource/.env.local \
  --output /Applications/Spatial-data-mapping-returning-visitor-cache/build/frontage-live
```

Pilot review preview: `http://127.0.0.1:8904/index.html`. Licensed photographs/model weights remain in ignored private build storage, not Git. No other agent's files were changed; no deployment was performed in this pass.
