# Costs

`smc-cloud estimate` produces these figures. Stage times come from this repository's own
journals, measured on the owner's Mac (Apple silicon) across 43 cells. Prices are list prices,
checked 2026-10-18; Hetzner's are after its June 2026 increase, converted at €1 = $1.08.
Re-measure in the cloud before fixing pool sizes: the queue's ledger records the time, CPU,
bytes moved and cost of every attempt, and `estimate.from_attempts` turns that into the same
table.

## Measured stage times (Mac)

| stage | samples | median | per km² |
|---|---:|---:|---:|
| discover | 52 | 26 s | 6 s |
| osm | 48 | 44 s | 15 s |
| terrain | 16 | 1,506 s | 562 s |
| imagery | 10 | 322 s | 180 s |
| lidar | 9 | 1,213 s | 3,431 s |
| build | 7 | 32 s | – |
| official | 1 | 13 s | – |

Terrain, lidar and imagery spend most of their time waiting on USGS, Mapillary and the city.
That is why a worker runs several of them at once (`slots`) and the estimate divides those
stages by the slots. Build and audit are CPU-bound and are not divided.

## The plan: 337 gap cells, 1,578.5 km²

| CPU pool | slots | worker-hours | compute | per cell |
|---|---:|---:|---:|---:|
| **Hetzner CPX32** (4 vCPU shared, $0.0615/h), the default | 4 | 461 | **$28.31** | $0.084 |
| Hetzner CPX42 (8 vCPU shared, $0.120/h) | 8 | 232 | $27.90 | $0.083 |
| Hetzner CPX22 (2 vCPU shared, $0.034/h) | 2 | 919 | $30.95 | $0.092 |
| Hetzner CCX13 (2 vCPU dedicated, $0.074/h) | 2 | 919 | $68.35 | $0.203 |

CPX32 and CPX42 come out the same. CPX32 is the default because a failure or a straggler
holds a smaller server. Six CPX32 workers finish the plan in about 3–4 days of wall time and
cost about $8.90 a day at full use, well inside the $25 daily limit.

Fixed costs, a month:

| item | cost |
|---|---:|
| controller, Hetzner CPX22 (+20 % backups) | ≈ $29.50 |
| R2 storage: 44 GB uploaded once + releases ≈ 50 GB × $0.015 | ≈ $0.75 |
| R2 operations: migration ≈ 0.3 M Class A writes (free tier 1 M/month); viewer reads are Class B (free tier 10 M) | ≈ $0 |
| R2 egress | $0 (R2 has none) |
| GitHub Actions watchdog (public repository) | $0 |

The controller is the largest steady cost. It can be stopped between campaigns: the queue is
backed up to R2, and a new controller restores it.

## GPU: not measured yet

There is no CUDA measurement of the house pipeline. The Mac ran it on MPS, and that time is
not a CUDA estimate. These are the bounds until there is one:

- A batch is capped at 6 hours. On an RTX 4090 at $0.69/h (secure) that is at most $4.14 per
  batch, or $2.04 at the community price of $0.34/h. The daily and monthly limits apply either
  way.
- GPUs run only while a batch is leased. They stop 5 minutes after the last batch and have no
  persistent volume, so idle cost is zero. Pod disk is ephemeral, and the weights come from
  the private bucket's `frontage-models` checkpoint at each start. A persistent volume would
  only pay for itself if those downloads took longer than about 10 % of a batch; measure that
  before adding one.

**Benchmark first.** After setup, submit a single sampled batch:
`smc-cloud plan --cells none --house-batches 1 --house-sample 200`. Then read its attempt in
the dashboard (seconds, cost, houses fitted) and compare an L4 or A40 pool ($0.39–0.49/h)
against the 4090 by changing `instance_type` and `hourly_usd`. Keep whichever has the lowest
cost per accepted fit. Do the same for CPU with one cell on CPX32 and one on CPX42 before
running the whole plan.

## Limits that hold regardless

`[budget]` in `cloud/config/kerbside-cloud.toml` sets these:

- $25 a day
- $300 a month
- $400 a month as a hard stop: everything is stopped and the queue is paused

Limits set inside each provider's own account are a second line of defence. Set a spend limit
on RunPod and a project limit on Hetzner.
