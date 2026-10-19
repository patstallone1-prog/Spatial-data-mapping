# Secrets and what each one may do

No secret is in the repository. The controller's secrets live in `/etc/kerbside/controller.env`
on its server (mode 600). They are copied there by `cloud/deploy/push-secrets.sh` from a
gitignored `cloud/config/controller.env`, which is a filled-in
`cloud/config/controller.env.example`. Terraform's inputs live in a gitignored
`cloud/infra/terraform/kerbside.tfvars`.

## The controller

| variable | scope (least privilege) | used for |
|---|---|---|
| `KERBSIDE_SECRET` | random, 32+ bytes (`openssl rand -hex 32`) | Signs worker tokens: HMAC(secret, worker id). Rotating it logs every worker out. |
| `KERBSIDE_OPS_TOKEN` | random (`openssl rand -hex 24`) | The dashboard and operator commands (`smc-cloud status/plan/review/...`). |
| `KERBSIDE_CONTROLLER_URL` | not secret | The HTTPS name workers call back to. |
| `HCLOUD_TOKEN` | Hetzner **project** token, Read & Write, in a project holding only Kerbside | Creating and deleting worker servers. It can only touch servers in that project, and the scheduler only deletes servers labelled `kerbside=worker`. |
| `RUNPOD_API_KEY` | RunPod key with **restricted** permissions (pods read/write; no billing, no endpoints) and an account spend limit | Creating and deleting GPU pods. Only pods named `kw-…` are listed or deleted. |
| `R2_ACCOUNT_ID` | not secret | The R2 endpoint. |
| `R2_PRIVATE_ACCESS_KEY_ID` / `_SECRET_ACCESS_KEY` | R2 API token: **Object Read & Write, `kerbside-private` only** | Checkpoints, queue backups, logs. Also given to workers. |
| `R2_PUBLIC_ACCESS_KEY_ID` / `_SECRET_ACCESS_KEY` | R2 API token: **Object Read & Write, `kerbside-public` only** | Publishing. **The controller only.** Workers never receive it, so a compromised worker cannot change what the public sees. |
| `R2_PUBLIC_BASE` | not secret | The public bucket's custom domain, e.g. `https://assets.example.org`. |
| `MAPILLARY_ACCESS_TOKEN`, `MAPILLARY_TOKEN` | Mapillary client token (read) | The imagery stage and the house filter. |
| `HUGGINGFACE_TOKEN` | Hugging Face **read** token | Model downloads, if the uploaded weights are missing. |
| `GITHUB_TOKEN` | **Not on the controller.** Only for `smc-cloud promote --open-pr`, run by the owner: a fine-grained token on this repository, Contents + Pull requests read/write | Opening the site-promotion PR. |

## What a worker gets

A worker is created with only a **one-time boot token** in its user data. It trades that token
at `/api/bootstrap` for:

- its worker token
- the private bucket's key
- the Mapillary and Hugging Face tokens
- its pool settings

The boot token can't be used twice. A worker the controller has stopped is refused
afterwards. Workers never receive:

- the public bucket's key
- the Hetzner or RunPod key (a RunPod pod ends itself with `runpodctl`, using the pod's own
  scoped key)
- the Google Maps key (restricted Street View is never acquired in the cloud)
- the contributor or launcher tokens
- the GitHub token

## GitHub Actions

| name | kind | for |
|---|---|---|
| `KERBSIDE_CLOUD_ENABLED` | repository **variable** | `"true"` turns the watchdog on. Unset, it never runs. |
| `KERBSIDE_CONTROLLER_URL`, `R2_PUBLIC_BASE` | variables | The watchdog's health check. |
| `HCLOUD_TOKEN`, `RUNPOD_API_KEY` | secrets | The watchdog deletes stray instances. |
| `KERBSIDE_SECRET`, `KERBSIDE_OPS_TOKEN`, `R2_ACCOUNT_ID`, `R2_PRIVATE_*` | secrets | The watchdog loads the same config. It is never given a public-bucket key. |

The image workflow (`cloud.yml`) pushes to GHCR with the workflow's own `GITHUB_TOKEN`
(`packages: write`), and it does so only from `main`.

## Terraform (`kerbside.tfvars`)

| variable | scope |
|---|---|
| `hcloud_token` | The same Hetzner project token. |
| `cloudflare_api_token` | **Account → R2 Storage: Edit**, used only to create the two buckets. Revoke it afterwards; the object tokens above are separate. |
| `cloudflare_account_id`, `ssh_public_key`, `operator_cidrs`, `controller_domain`, `public_domain` | Not secret. `operator_cidrs` limits SSH to your addresses. |

## Rules that hold everywhere

- Logs and the dashboard never print a secret. Commands are logged without their environment.
- The private bucket is never public. The public bucket holds only cells that passed the gate
  or were approved by a reviewer, and none of the restricted classes in
  [inventory.md](inventory.md) (`migrate` refuses them).
- Rotate any token by editing `controller.env` and running `push-secrets.sh` again. Workers
  pick up the new values when they are next launched.
