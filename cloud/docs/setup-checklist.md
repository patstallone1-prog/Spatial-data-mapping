# Account setup checklist (owner's actions)

RunPod for every machine, AWS S3 for storage. Each step creates a credential or spend, or
changes what is public. The owner does it, in this order. Steps marked **(spend)** start billing.
Nothing on RunPod is reserved in advance: pods bill only while they exist, and the controller
creates each worker when there is work for it.

## 1. AWS storage

- [ ] Pick one region (e.g. `us-west-2`, beside the USGS lidar) → `AWS_REGION`.
- [ ] Create two buckets, e.g. `kerbside-private` and `kerbside-public`, both with Block Public
  Access **on**. Default encryption (SSE-S3) is fine.
- [ ] Two IAM users, each with an access key and one inline policy,
  `cloud/infra/s3-iam-user-policy.json` with `BUCKET` replaced:
  - `kerbside-private` → `S3_PRIVATE_ACCESS_KEY_ID` / `_SECRET_ACCESS_KEY`;
  - `kerbside-public` → `S3_PUBLIC_ACCESS_KEY_ID` / `_SECRET_ACCESS_KEY`.
- [ ] CloudFront distribution in front of `kerbside-public` with Origin Access Control (let it
  update the bucket policy). Its `https://<id>.cloudfront.net` address → `S3_PUBLIC_BASE`.
- [ ] Apply `cloud/infra/s3-cors.json` to `kerbside-public`:

  ```
  aws s3api put-bucket-cors --bucket kerbside-public --cors-configuration file://cloud/infra/s3-cors.json
  ```

- [ ] Optionally an AWS Budgets alert at a few dollars a month.

## 2. RunPod

- [ ] Prepaid credit is the spend cap. Create an API key (read/write) → `RUNPOD_API_KEY`.
- [ ] Don't deploy a pod from RunPod's own templates for this; `runpod-controller create` does it.

## 3. The controller's settings

- [ ] `cp cloud/config/controller.env.example cloud/config/controller.env`, then fill it in.
  Generate `KERBSIDE_SECRET` with `openssl rand -hex 32` and `KERBSIDE_OPS_TOKEN` with
  `openssl rand -hex 24`. Leave `KERBSIDE_CONTROLLER_URL` empty.
- [ ] `set -a; source cloud/config/controller.env; set +a` in every terminal that runs
  `smc-cloud`.

## 4. The controller pod (spend: a small CPU pod while it runs)

- [ ] `smc-cloud runpod-controller plan`: the pod it would create, secrets masked, and both
  images present on GHCR for the build it runs (origin/main's commit). No network call to RunPod.
- [ ] `smc-cloud runpod-controller check`: the key works; lists your pods. Costs nothing.
- [ ] `smc-cloud runpod-controller create`: creates `kerbside-controller` and prints its `url`
  and hourly rate. Put the url into `KERBSIDE_CONTROLLER_URL` in `controller.env`.
- [ ] Open `<url>/healthz`. Then open `/` with the ops token: the dashboard should show no
  workers and $0.
- [ ] `smc-cloud runpod-controller stop` when nothing is queued; `start` to resume. The queue
  is backed up to the private bucket every 5 minutes and restored on start.
- [ ] The watchdog: add the GitHub Actions secrets and variables from `secrets.md`, set the
  repository variable `KERBSIDE_CLOUD_ENABLED=true`, and run `cloud-watchdog` once by hand.

## 5. First real use (spend: workers)

- [ ] **Upload the data once** from the Mac (plug in the HP P700 first):

  ```
  smc-cloud migrate --private s3://kerbside-private --cells all --shared all --house-run "/Volumes/HP P700 1/Kerbside/frontage-run-2026-10-10"
  ```

  This uses `S3_PRIVATE_*` and `AWS_REGION` in the shell. It refuses restricted data and leaves
  out point clouds unless you pass `--with-points`. Add `--interiors --restaurants` to upload
  the interior engine's finished batches and the restaurants' rounds, so the cloud does not
  redo them.
- [ ] **Check the provider APIs with one cell.** Run `smc-cloud plan --cells <one gap cell>` and
  watch the dashboard:
  - one RunPod CPU pod (`kw-cpu-…`) starts;
  - the cell's stages run;
  - the gate passes or holds the cell;
  - the pod is deleted about 10 minutes after the work runs out.
- [ ] **Benchmark the GPU** with `smc-cloud plan --cells none --house-batches 1 --house-sample 200`.
  Check that the pod starts, fits and is deleted, and read the cost per fit (see `costs.md`).
- [ ] **Check the interior engine with one region.** Run `smc-cloud plan --cells none --interiors`
  and watch the batches run on the CPU pool and each region's `interiors:<region>:collect-N` finish.
- [ ] Run everything with `smc-cloud plan --cells all --house-batches 50 --interiors --restaurant-rounds 10`.

## 6. Putting cells on the site (each time)

- [ ] Review held cells in the dashboard, or with `smc-cloud review list`. Approve or reject
  each one with your name and a reason.
- [ ] In a checkout, run `smc-cloud promote` and look at the diff. Then run
  `smc-cloud promote --open-pr` (needs `GITHUB_TOKEN`). The PR merges and deploys when CI passes.
- [ ] Interiors: `smc-cloud promote --interiors` (needs `KERBSIDE_PRIVATE_STORE` and `S3_PRIVATE_*`)
  restores each region's collected batches and runs `run_interior_engine.py --publish`, which
  puts only houses that passed validation into `docs/inferred-interiors`. It also copies the
  restaurants' rounds into `docs/inferred-restaurants`. Read the diff, then add `--open-pr`.
- [ ] Check https://spatial-data-mapping.vercel.app/. If anything is wrong, run
  `smc-cloud release rollback`, then `smc-cloud promote --open-pr` again.

## Moving off the Mac

When steps 1–5 are done, no recurring task reads a Mac-only file. These things stay on the Mac
by design:

- the Unreal worlds;
- the restricted Street View reference;
- the photo prototypes;
- the Google Places restaurant price ingest (Google's terms);
- the ground-gap capture (headless Chrome, run by hand);
- the SF corridor's imagery catalog refresh.

Stop the overnight interior driver (`build/inferred-interiors/overnight.sh`) once the cloud's
interiors are promoted: both publish into `docs/inferred-interiors`, and two writers would race.

The Mac's local pipeline keeps working as it does today. Stop the local runners only after the
cloud has finished the same cells.
