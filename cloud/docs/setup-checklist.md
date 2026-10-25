# Account setup checklist (owner's actions)

Nothing in this list has been done. Each step creates an account, a credential or spend, or
changes what is public. The owner does it, in this order. Steps marked **(spend)** start billing.

## 1. Accounts and credentials

- [ ] **Hetzner Cloud**
  - Create a project named `kerbside` that holds nothing else.
  - Set a project spending alert.
  - Create an API token (Read & Write) → `HCLOUD_TOKEN`.
- [ ] **RunPod**
  - Create an account and set an account **spend limit** (e.g. $35, which is also the prepaid credit: about 120 A5000 hours).
  - Add credit, since RunPod is prepaid.
  - Create an API key with restricted permissions (pods only) → `RUNPOD_API_KEY`.
- [ ] **Cloudflare**
  - Create an account with a zone (domain) for the public assets and the controller.
  - Enable R2 and note the account ID → `R2_ACCOUNT_ID`.
  - Create a temporary token with **R2 Storage: Edit** for Terraform. Revoke it after step 3.
- [ ] **GitHub**
  - Confirm that GHCR packages `kerbside-cpu` and `kerbside-gpu` may be created under
    `patstallone1-prog`.
  - Make them public, or give the workers a pull token (Hetzner `docker login` / RunPod
    registry auth). Public is simpler. The images hold no secrets, only what the public repository already has, minus the restricted datasets (`.dockerignore`).
- [ ] **Secrets**
  - Generate `KERBSIDE_SECRET` with `openssl rand -hex 32`.
  - Generate `KERBSIDE_OPS_TOKEN` with `openssl rand -hex 24`.

## 2. Images

- [ ] Merge this branch so `.github/workflows/cloud.yml` builds both images on `main`.
- [ ] Check that both images were built, that the cloud tests and the full lifecycle passed
  inside them, and that they were pushed as `:main` and `:<sha>`.
- [ ] Optionally pin `image` in `cloud/config/kerbside-cloud.toml` to the `:<sha>` tag.

## 3. Infrastructure (spend: the controller, $6.49 a month)

- [ ] `cp cloud/infra/terraform/kerbside.tfvars.example cloud/infra/terraform/kerbside.tfvars`,
  then fill it in. `operator_cidrs` should be your IP addresses.
- [ ] `cd cloud/infra/terraform && terraform init && terraform plan -var-file=kerbside.tfvars`.
  Read the plan. It should list one server, two firewalls and two R2 buckets.
- [ ] `terraform apply -var-file=kerbside.tfvars`.
- [ ] Put Terraform's `workers_firewall_id` output into `[hetzner] firewall_ids` in
  `cloud/config/kerbside-cloud.toml`, then commit it. Workers then accept no inbound traffic.
- [ ] DNS: point `controller_domain` at the controller's IP (Terraform outputs it). Caddy then
  fetches its certificate.
- [ ] R2:
  - Attach `public_domain` as the custom domain of `kerbside-public`.
  - Apply `cloud/infra/r2-cors.json` to it.
  - Leave `kerbside-private` with **no** public access.
- [ ] R2 object tokens:
  - `kerbside-private` only, Object Read & Write → `R2_PRIVATE_*`.
  - `kerbside-public` only, Object Read & Write → `R2_PUBLIC_*`.
- [ ] Revoke the temporary Terraform R2 token.

## 4. The controller

- [ ] `cp cloud/config/controller.env.example cloud/config/controller.env`, then fill it in. Leave
  out `GITHUB_TOKEN`; it is not needed on the server.
- [ ] `cloud/deploy/push-secrets.sh <controller-ip>`.
- [ ] Open `https://<controller_domain>/healthz`. Then open `/` with the ops token: the dashboard
  should show no workers and $0.

## 5. First real use (spend: workers)

- [ ] **Upload the data once** from the Mac:

  ```
  smc-cloud migrate --private r2://kerbside-private --cells all --shared all --house-run "/Volumes/HP P700 1/Kerbside/frontage-run-2026-10-10"
  ```

  This uses `R2_PRIVATE_*` in the shell. It refuses restricted data and leaves out point
  clouds unless you pass `--with-points`. Add `--interiors --restaurants` to upload the interior
  engine's finished batches and the restaurants' rounds, so the cloud does not redo them.
- [ ] **Check the provider APIs with one cell.** Run `smc-cloud plan --cells <one gap cell>` and
  watch the dashboard:
  - one Hetzner server starts;
  - the cell's stages run;
  - the gate passes or holds the cell;
  - the server is deleted about 10 minutes after the work runs out.
- [ ] **Benchmark the GPU** with `smc-cloud plan --cells none --house-batches 1 --house-sample 200`.
  Check that the pod starts, fits and is deleted, and read the cost per fit (see `costs.md`).
- [ ] Turn on the watchdog:
  - Add the GitHub Actions secrets and variables from `secrets.md`.
  - Set the repository variable `KERBSIDE_CLOUD_ENABLED=true`.
  - Run the workflow once by hand.
- [ ] **Check the interior engine with one region.** Run `smc-cloud plan --cells none --interiors`
  and watch the batches run on the CPU pool and each region's `interiors:<region>:collect-N` finish.
- [ ] Run everything with `smc-cloud plan --cells all --house-batches 50 --interiors --restaurant-rounds 10`.

## 6. Putting cells on the site (each time)

- [ ] Review held cells in the dashboard, or with `smc-cloud review list`. Approve or reject
  each one with your name and a reason.
- [ ] In a checkout, run `smc-cloud promote` and look at the diff. Then run
  `smc-cloud promote --open-pr` (needs `GITHUB_TOKEN`). The PR merges and deploys when CI passes.
- [ ] Interiors: `smc-cloud promote --interiors` (needs `KERBSIDE_PRIVATE_STORE` and `R2_PRIVATE_*`)
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
