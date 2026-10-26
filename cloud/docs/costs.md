# Costs

`smc-cloud estimate` produces these figures. Stage times come from this repository's own
journals, measured on the owner's Mac (Apple silicon) across 43 cells. Prices are list prices,
checked 2026-10-18. Hetzner's are after its 2026 increase; the CX prices are its dollar list
prices, and the CPX prices are converted at €1 = $1.08.
Re-measure in the cloud before fixing pool sizes: the queue's ledger records the time, CPU,
bytes moved and cost of every attempt, and `estimate.from_attempts` turns that into the same
table.

## The configured deployment (RunPod + S3, $20 a month)

The budget in `cloud/config/kerbside-cloud.toml` is **$20 a month, everything counted**: workers,
storage, and the controller's own pod while it is up ($0.063/h). `daily_usd = 1.0` paces it: at
$1 spent the day's workers drain (finish what they hold, take nothing new) and the next UTC day
starts again; `monthly_usd = 19` stops launches; `hard_monthly_usd = 20` stops everything until
the month turns, then it resumes by itself. Up all month the controller alone would be $45, so
it stops its own pod after 20 minutes with nothing it could do, and the watchdog (GitHub
Actions, every 30 minutes) starts it again when its queue has work the budget allows.

The CPU pool is RunPod `cpu3g` pods at 8 vCPU (estimated at $0.32/h) with 12 slots: the first
cloud cell's lidar took 221 minutes of which 24 were CPU, so a worker carries twelve such jobs.
At about $0.25 a cell, $20 is roughly 55 worker-hours, some 60–70 gap cells a month. The GPU
pool is an RTX A5000 at $0.27/h. RunPod's prepaid balance is the final cap: keep it above the
month's $20. S3 Standard is $0.023 per GB-month; downloads from S3 to the pods are AWS egress
(100 GB a month free, then about $0.09/GB), and the viewer's reads go through CloudFront (1 TB a
month free). The Hetzner and R2 figures below are kept for comparison.

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

## The $50 month

This is the default configuration (`cloud/config/kerbside-cloud.toml`, `cloud/infra/terraform`).

| item | choice | month |
|---|---|---:|
| controller | Hetzner **CX23** (2 vCPU, 4 GB), Falkenstein, always on, no Hetzner backups (the queue is backed up to R2) | $6.49 |
| geographic CPU work | Hetzner **CX43** (8 vCPU, 16 GB, $0.0253/h, capped at $18.49 a month each), 8 cells at once, up to 3 servers, deleted when the work runs out | ≈ $6–12 |
| storage | R2: about 44 GB private (uploaded once) + 2–4 GB of published cells, less the 10 GB free | ≈ $0.60 |
| streaming | R2 has no egress fees; the viewer's reads are Class B (10 M a month free, then $0.36 per million), and Cloudflare's cache answers most of them | ≈ $0 |
| GPU house batches | RunPod **RTX A5000** Secure Cloud, $0.27/h, no persistent volume; about 110 hours fit in the budget | ≈ $27–30 |
| **total** | | **≈ $41–50** |

The budget makes this a limit, not just an estimate. Workers and storage get $40 a month,
with a hard stop at $43.50. With the controller that is $50 in all.

**The plan is bigger than 180 cells.** `data/regions/gap-plan.json` has **337 cells,
1,578.5 km²**, every gap between the Bay Area regions already built. The CPU cost is small
either way:

| CPU pool | slots | worker-hours | whole plan | per cell |
|---|---:|---:|---:|---:|
| **Hetzner CX43** (EU), the default | 8 | 232 | **$5.87** | $0.017 |
| Hetzner CPX32 (Hillsboro, US) | 4 | 461 | $28.31 | $0.084 |
| Hetzner CPX42 (Hillsboro, US) | 8 | 232 | $27.90 | $0.083 |

Billing is hourly, so one CX43 for ten days costs the same as three for three or four days.
Three finish the plan in about 3–4 days.

**The CPU figure assumes Mac-like network times.** The CX line is sold only in Germany and
Finland. The lidar and terrain stages read USGS's EPT tiles from AWS us-west-2, so from
Europe they cross the Atlantic. Even at twice the Mac's time, CPU stays under about $12.
Measure one cell first. If EU is more than about 4× slower, switch the pool to `cpx32` in
`hil`; that runs the plan for about $28 and leaves about 70 GPU-hours.

**The GPU is the swing.** No one has measured how many GPU-hours the remaining houses need.
At $0.27/h, 50 hours is $13.50, 100 hours is $27 and 250 hours is $67.50. The budget stops
work at the limit rather than overspending; whatever is left continues next month. Run the
benchmark below before assuming 100 hours is enough.

After the CPU work, the steady cost is the controller plus storage, about $7 a month. The
controller can be stopped between campaigns: the queue is in R2, and a new controller
restores it.

## GPU: not measured yet

There is no CUDA measurement of the house pipeline. The Mac ran it on MPS, and that time is
not a CUDA estimate.

- A batch is capped at 6 hours, which is at most $1.62 on an A5000.
- GPUs run only while a batch is leased and stop 5 minutes after the last one. They have no
  persistent volume, so idle cost is zero. The pod's 120 GB container disk is billed only
  while it runs, about $1.60 per 100 hours. The weights come from the private bucket at
  each start. A persistent volume would only pay for itself if those downloads took more than
  about 10 % of a batch; measure that before adding one.

**Benchmark first.** After setup, submit a single sampled batch:
`smc-cloud plan --cells none --house-batches 1 --house-sample 200`. Read its attempt in the
dashboard (seconds, cost, houses fitted). Compare the A5000 with a 4090 ($0.34 community,
$0.69 secure) by changing `instance_type` and `hourly_usd`, and keep the GPU with the lowest
cost per accepted fit. A faster card can cost less per house even at a higher hourly rate.

## Limits that hold regardless

`[budget]` in `cloud/config/kerbside-cloud.toml` sets these, for workers and storage:

- $10 a day
- $40 a month
- $43.50 a month as a hard stop: everything is stopped and the queue is paused

Limits set inside each provider's own account are a second line of defence. Set a spend limit
on RunPod and a project limit on Hetzner.
