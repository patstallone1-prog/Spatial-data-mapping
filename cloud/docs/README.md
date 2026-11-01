# Kerbside in the cloud

The regional build runs without the Mac. A small controller, itself a RunPod CPU pod, owns a
durable queue. It starts CPU and GPU worker pods on RunPod only when there is work for them, and
deletes them when there is none. Each finished cell goes through the Marina parity gate. A cell
that passes is published to the public S3 bucket, behind CloudFront, as an immutable, versioned
release. A cell that does not pass is held for a named reviewer. The viewer keeps loading the app
and today's regions from Vercel, and cloud-published cells from CloudFront; nothing is
video-streamed from a GPU.

The diagram and tables below still show the first design (a Hetzner controller and CPU pool,
Cloudflare R2). That code path still works, but the configured deployment is RunPod + S3:
[setup-checklist.md](setup-checklist.md), [secrets.md](secrets.md) and
`smc-cloud runpod-controller`.

Nothing here is switched on. Every account, token and deploy step is in
[setup-checklist.md](setup-checklist.md) and needs the owner's action.

```
                 ┌──────────────── Hetzner (fsn1) ───────────────┐
  operator ──────▶ controller (cx23):  queue.sqlite, scheduler,   │
  smc-cloud       │ gate, publisher, dashboard  /  Caddy HTTPS    │
  dashboard       └──┬──────────────┬───────────────┬─────────────┘
                     │ lease/heartbeat (HMAC worker tokens)
          ┌──────────▼───┐   ┌──────▼────────┐      │ publish (controller only)
          │ CPU workers  │   │ GPU worker    │      ▼
          │ Hetzner cx43 │   │ RunPod A5000  │   R2 kerbside-public ──▶ assets.<domain>
          │ 8 cells each │   │ house batches │      (chunks/<sha>, releases/<v>.json,
          └──────┬───────┘   └──────┬────────┘       releases/current.json)
                 │ checkpoints (content-addressed)          ▲
                 ▼                                          │ /asset-map.json (viaStore)
          R2 kerbside-private: cas/, trees/, pointers/,     │
          queue/backups/, logs/                       viewer (Vercel)
                                         GitHub Actions watchdog (every 30 min, kills strays)
```

## Code

Everything is in `src/smc/cloud/` and is run by the `smc-cloud` command.

| module | what it does |
|---|---|
| `queue.py` | SQLite queue. Leases carry fencing tokens and heartbeats. Retries back off exponentially; a job that keeps failing is quarantined and the rest keep running. Gates can be held for review. Submission is idempotent, and every attempt is recorded with its time, CPU, bytes moved and cost. |
| `checkpoint.py`, `store.py` | Content-addressed trees on R2 (or a folder). Each file is sent once and checked by sha256 on the way back. Pointers move by conditional put. |
| `stages.py`, `plan.py` | The cell chain `discover → osm → terrain → lidar → imagery → official → build → audit → gate → publish`, the GPU house batches, and the plan: every gap cell in `data/regions/gap-plan.json` plus the named regions. |
| `gate.py` | Runs the real `scripts/audit_region_parity.py` on a finished cell. Every share must be at least 0.75 × Marina's, with no issues. The cell passes, or is held with its reasons. |
| `publish.py`, `site.py` | Incremental per-cell releases, verified on the public origin before the pointer moves, with rollback and per-cell withdrawal. `site.py` puts a release onto the site through a pull request (manual). |
| `providers.py`, `scheduler.py`, `budget.py` | Hetzner and RunPod REST, and a local fake provider. The scheduler launches for ready work, retires idle or over-age workers, deletes orphans and enforces the budget. |
| `worker.py`, `controller.py`, `dashboard.html` | The worker loop and the controller's HTTP API and dashboard. |
| `inventory.py`, `migrate.py`, `estimate.py` | The data inventory, the one-time upload, and cost estimates from measured stage times. |
| `selftest.py` | The whole lifecycle on one machine (below). |

Infrastructure and containers live under `cloud/`:

- `cloud/containers/{cpu,gpu}.Dockerfile`
- `cloud/config/kerbside-cloud.toml`, the controller's settings, which hold no secrets
- `cloud/infra/terraform`: the controller server, firewalls and R2 buckets
- `cloud/infra/cloud-init`, `cloud/infra/r2-cors.json`
- `cloud/deploy/push-secrets.sh`

The workflows are `.github/workflows/cloud.yml` (builds both images, runs the tests and the
lifecycle inside them, and pushes to GHCR from `main`) and `.github/workflows/cloud-watchdog.yml`.

## Workloads

| workload | where | why |
|---|---|---|
| discover, osm, terrain, lidar, imagery, official | CPU pool (Hetzner CX43, 8 slots per server) | Mostly waiting on USGS, Overpass, Mapillary and city services. The CX line is EU-only, so lidar crosses the Atlantic from us-west-2; the first cell measures whether that costs more than it saves. |
| build, audit | CPU pool | Python and node, single-threaded per cell. |
| colours, survey, ground, facades, rebuild, trees | CPU pool, after `audit` | What the Mac's facade and ground-cover runners added to a built region, now stages of every cell (`scripts/ingest_region.py`): sampled building colours, the facade survey, parks/yards/street trees from city portals and OpenStreetMap, facade textures, the page built again with them, then lidar trees planted where no city inventory has any (`scripts/enrich_region.py`). Each is optional: out of tries, it is skipped and the gate judges the cell without it. |
| gate, publish | controller | Small, and they need the public bucket's write key, which only the controller holds. |
| house filter → match → materials | GPU pool (RunPod, one at a time) | torch/LightGlue with `--device cuda`. The journals are one shared state (`build/frontage-live`, `build/facade-match`), so batches run serially. Fits stay in the private bucket (`KERBSIDE_HOUSES_PUBLISH=0`). |
| interior engine: house batches | CPU pool | `scripts/run_interior_engine.py --batch REGION:INDEX`, twenty houses a job, every batch independent (shapely and the engine's solver, no model). A region's batches are collected into `pointers/interiors-<region>.json` (a `collect` job on the controller). |
| interior engine: restaurant rounds | CPU pool, one at a time | `scripts/build_inferred_restaurants.py`: the rounds share one history, so they chain. Collected to `pointers/restaurants-latest.json`. |
| restaurant price ingest (Google Places) | **stays on the Mac** | Google's terms: no copies of Places content in other storage. The cloud rounds read no price cache (`data/restaurant-prices.json` is gitignored and not in the images). |
| ground-gap inference | **stays on the Mac** (manual) | `tools/ground_capture/capture.mjs` needs headless Chrome. `tools/infer_ground_gaps.py` now cuts the region's water out of what it fills (`tools/strip_ground_water.py`). |
| SF corridor imagery catalog | **stays on the Mac** | `scripts/update_sf_corridor.py`. Rebuilt rarely, and the corridor is not in the gap plan. |
| Unreal worlds, DDC | **stays on the Mac** | The editor is macOS/Windows only. Linux Unreal is not supported or tested here. |
| Google Street View reference | **stays on the Mac** | Restricted licence: no copies to other storage. It is never acquired in the cloud, and the workers get no Maps key. |
| photo kerb / photo mesh prototypes | **stays on the Mac** | Not canonical, and never published automatically. |
| contributor coordinator, Supabase | unchanged | Already hosted. |

## The parity gate: automatic pass, or hold for review

After a cell's last stage (`trees`), the controller runs `gate` (`smc/cloud/gate.py`):

1. It restores the cell's checkpoint and runs `audit_region(...)` from
   `scripts/audit_region_parity.py`, the same measurement the repository's tests use.
2. Each share's floor is **Marina's share × 0.6 × the cell's population factor**. The factor is
   √(cell's people per km² ÷ the Marina corridor's 12,801), between 0.4 and 1, from the 2020
   census blocks under the cell's box (TIGERweb; kept in the cell's `population.json`). A
   suburb with a fifth of the Marina's people is held to about 45 % of its bar; where the
   census can't be asked, the Marina's floor stands. The audit's own 0.75 screen ranks regions
   for more ingestion; it is not the publication bar.
3. **Pass** means every required stage (the base chain through `audit`) is done, no share is
   under its floor, and there is no publication fault (sampled colours not served, ground in
   the source missing from the page). A skipped enrichment stage, no tree or yard records, or
   up to 10 % of lidar cells still to read are *notes*, published with the cell. `publish`
   then runs.
4. **Hold** records the failing shares and faults as reasons. The cell's `publish` waits, and
   every other cell carries on.
5. A reviewer acts on the held cell from the dashboard or with
   `smc-cloud review approve|reject|rerun JOB --reviewer NAME --note WHY`. A name and a note are
   required. Approve publishes the cell. Reject keeps it unpublished. Rerun requeues it from its
   first stage.

The gate only reads. It never fills, infers or relabels geometry, and a held cell is never
published. Photo or inferred data keeps its labels (SourceGrade IMAGE/INFERRED), and the parity
metric counts only SURVEY and LIDAR, as it does locally.

You can run the gate on a local cell at any time with `smc-cloud gate <cell>`. It exits 0 on
pass and 3 on hold.

## Publication

- Each passed cell is published on its own. Its files are uploaded as `chunks/<sha24><ext>`,
  which are immutable and cached for a year.
- A new `releases/<version>.json` is written. It is the previous release plus this cell, and it
  is also a valid `kerbside.asset_map/1`.
- Before `releases/current.json` moves (by conditional put), every new chunk is checked with a
  HEAD request on the public origin. If any chunk is missing, the pointer stays where it was.
  Two publishers that race both land, because the loser re-reads and merges.
- `smc-cloud release rollback [--to V]` moves the pointer back. `withdraw_cell` removes one cell
  and keeps the rest. Nothing is ever republished Bay-wide for a single cell.
- **The live site changes only by pull request.** `smc-cloud promote` writes `docs/asset-map.json`,
  adds new regions to `docs/regions.json` and runs the documented page rebuild in a checkout,
  then stops so the diff can be reviewed. `smc-cloud promote --open-pr` commits the small files
  only (never cell data) and opens a PR with auto-merge. CI and Vercel's gate decide from there.
  The controller never does this on its own.

## Operating

```
smc-cloud plan --cells all --house-batches 50     # idempotent; resubmitting adds nothing
smc-cloud plan --cells none --interiors --restaurant-rounds 10   # the interior engine
smc-cloud status                                  # or open https://<controller>/ with the ops token
smc-cloud review list
smc-cloud requeue cell:<cell>:<stage>             # after fixing a quarantined job
smc-cloud defer <cell> [--undo]                   # set a stuck cell aside, or bring it back
smc-cloud release check | rollback
```

Recovery and limits:

- **Stuck cells are deferred** (`smc.cloud.stuck`, `[controller.defer]`): a cell with a stage
  quarantined for two hours, or past the worker time or wall time of the costliest finished
  cell by 25%, is set aside. Its jobs are not run, not counted as blocked and survive replans;
  `status` lists them under `deferred` with why. On 2026-10-31 that was 71 cells: bay water,
  salt ponds, collections with no ground, and streets whose lidar holds no kerbs.
- **Overpass down:** the map stage falls back to Overture Maps (`smc.regions.overture_osm`),
  the same streets and buildings as open GeoParquet; the cell's `osm_source.json` says which.
- **Publishing:** gates and publications run `control_slots` at once on the controller.

- **Crashes:** a worker that stops heartbeating loses its lease within two minutes. The job runs
  elsewhere from the last finished stage's checkpoint, and a late report from the old worker is
  refused by its fencing token.
- **Lost controller:** the queue is backed up to `queue/backups/` every five minutes. A
  controller that starts without a database restores the latest backup.
- **Budget:** the default limits are $10 a day, $40 a month for workers and storage, and a hard stop at $43.50. With the $6.49 controller that is $50 in all. New
  launches are refused if keeping the pool to midnight would pass the daily limit. At the hard
  limit every worker is stopped and the queue is paused.
- **Fail-safes:** the scheduler stops a worker after 10 minutes with no work (GPU after 5).
  If that stop never arrives, the worker stops itself 2 minutes later, or after 30 minutes
  without reaching the controller. Hetzner servers power off when their worker
  exits. RunPod pods self-terminate and have no persistent volume. The GitHub Actions watchdog
  deletes anything older than 30 hours, or everything if the controller has been silent for an
  hour.

## Tests

`pytest tests/test_cloud_*.py` runs 35 tests: queue, storage, scheduler and providers,
controller, gate, site and inventory. It includes the renderer's own `viaStore` reading a
release over HTTP.

`smc-cloud selftest` (also run as `tests/test_cloud_lifecycle.py` and inside both images in CI)
runs the full lifecycle locally:

1. submit
2. workers start for CPU and GPU work
3. jobs restore their inputs from checkpoints
4. stages run
5. a worker is killed mid-job and the job resumes elsewhere without redoing finished stages
6. the gate passes one cell and holds another, and a review approves it
7. a verified release is published
8. the viewer-style HTTP read checks every chunk
9. idle workers stop
10. the controller's database is deleted and a new controller restores from the private store
    and finishes a third cell

The workers run in empty work trees, so nothing on the Mac is reachable.

Not yet run, because they need accounts or tools this machine doesn't have:

- the real Hetzner, RunPod and R2 APIs (the request shapes are unit-tested against recorded
  bodies)
- `docker build` (CI does this)
- `terraform validate` (CI does this)
- a GPU benchmark (see [costs.md](costs.md))

## Known blockers

- **SFMTA ROW MapServer outage.** The `official` stage fails for SF cells until it is back. The
  queue's backoff rides it out (6 tries, up to 2 h apart) instead of failing the cells.
- **House batches are serial.** Their journals are one shared state. Splitting them per region
  would let several GPUs run at once, but that changes the house pipeline, so it is not done
  here.
- **Provider API shapes.** RunPod's REST API (`rest.runpod.io/v1/pods`) and Hetzner's must be
  checked on first use with one manual launch (see the checklist).
- **`uv.lock`.** It was not regenerated: `uv lock` fails on a scipy/py3.11 resolution issue that
  predates this work. The images install from `pyproject.toml` extras with exact pins for the
  CUDA stack.
- **Data inventory.** See [inventory.md](inventory.md). It counts 44 GB to upload once, 25 GB of
  re-fetchable caches, 11 GB that stays local (Unreal, prototypes, the shared sky build) and
  0.03 GB restricted (never uploaded: `migrate` refuses it).
