# Secrets and what each one may do

No secret is in the repository. The controller's secrets live in a gitignored
`cloud/config/controller.env` (a filled-in `cloud/config/controller.env.example`) on the
owner's Mac. `smc-cloud runpod-controller create` passes them to the controller's RunPod pod
as its environment; `plan` prints the same pod with every secret masked. To rotate one, edit
`controller.env`, then delete the `kerbside-controller` pod in RunPod and run `create` again.

The deployment is RunPod for every machine and AWS S3 for storage. The Hetzner provider and R2
store still work (`provider = "hetzner"`, `r2://bucket` with `R2_*`), but nothing is configured
for them.

## The controller

| variable | scope (least privilege) | used for |
|---|---|---|
| `KERBSIDE_SECRET` | random, 32+ bytes (`openssl rand -hex 32`) | Signs worker tokens: HMAC(secret, worker id). Rotating it logs every worker out. |
| `KERBSIDE_OPS_TOKEN` | random (`openssl rand -hex 24`) | The dashboard and operator commands (`smc-cloud status/plan/review/...`). |
| `KERBSIDE_CONTROLLER_URL` | not secret | Empty on RunPod: the controller finds its own address (`https://<pod id>-8080.proxy.runpod.net`) from `RUNPOD_POD_ID`. Set it in the operator's shell once `create` prints it. |
| `RUNPOD_API_KEY` | RunPod key, read/write; the account's prepaid balance is the final spend cap | Creating and deleting worker pods. Only pods named `kw-…` are listed or deleted; never `kerbside-controller` or the owner's own pods. |
| `AWS_REGION`, `S3_ENDPOINT_URL` (optional) | not secret | The buckets' region; the endpoint only for an S3-compatible store other than AWS. |
| `S3_PRIVATE_BUCKET`, `S3_PRIVATE_ACCESS_KEY_ID` / `_SECRET_ACCESS_KEY` | an IAM user for `kerbside` only: `cloud/infra/s3-iam-user-policy.json` with BUCKET = the private bucket | Checkpoints, queue backups, logs. Also given to workers. |
| `S3_PUBLIC_BUCKET`, `S3_PUBLIC_ACCESS_KEY_ID` / `_SECRET_ACCESS_KEY` | an IAM user for `kerbside-finished-map` only: the same policy with BUCKET = the public bucket | Publishing. **The controller only.** Workers never receive it, so a compromised worker cannot change what the public sees. |
| `S3_PUBLIC_BASE` | not secret | The public bucket's CloudFront address, e.g. `https://d1234.cloudfront.net`. |
| `MAPILLARY_ACCESS_TOKEN`, `MAPILLARY_TOKEN` | Mapillary client token (read) | The imagery stage and the house filter. |
| `HUGGINGFACE_TOKEN` | Hugging Face **read** token | Model downloads, if the uploaded weights are missing. |
| `GITHUB_TOKEN` | **Not on the controller.** Only for `smc-cloud promote --open-pr`, run by the owner: a fine-grained token on this repository, Contents + Pull requests read/write | Opening the site-promotion PR. |

## What a worker gets

A worker is created with only a **one-time boot token** in its environment. It trades that
token at `/api/bootstrap` for:

- its worker token
- the private bucket's key
- the Mapillary and Hugging Face tokens
- its pool settings

The boot token can't be used twice. A worker the controller has stopped is refused
afterwards. Workers never receive:

- the public bucket's key
- the RunPod key (a pod ends itself with `runpodctl`, using the pod's own scoped key)
- the Google Maps key (restricted Street View is never acquired in the cloud)
- the contributor or launcher tokens
- the GitHub token

## GitHub Actions

| name | kind | for |
|---|---|---|
| `KERBSIDE_CLOUD_ENABLED` | repository **variable** | `"true"` turns the watchdog on. Unset, it never runs. |
| `KERBSIDE_CONTROLLER_URL`, `AWS_REGION`, `S3_PUBLIC_BASE` | variables | The watchdog's health check and config. |
| `RUNPOD_API_KEY` | secret | The watchdog deletes stray worker pods. |
| `KERBSIDE_SECRET`, `KERBSIDE_OPS_TOKEN`, `S3_PRIVATE_ACCESS_KEY_ID`, `S3_PRIVATE_SECRET_ACCESS_KEY` | secrets | The watchdog loads the same config. It is never given a public-bucket key. |

`cloud/deploy/github-secrets.sh` sets all of these from `controller.env`.

The buckets are `kerbside` (private) and `kerbside-finished-map` (public). The watchdog uses
those names unless the repository variables `S3_PRIVATE_BUCKET` / `S3_PUBLIC_BUCKET` say otherwise.

The image workflow (`cloud.yml`) pushes to GHCR with the workflow's own `GITHUB_TOKEN`
(`packages: write`), and it does so only from `main`.

## Rules that hold everywhere

- Logs and the dashboard never print a secret. Commands are logged without their environment.
- The private bucket is never public (S3 Block Public Access on). The public bucket is read
  only through CloudFront, and holds only cells that passed the gate or were approved by a
  reviewer, and none of the restricted classes in [inventory.md](inventory.md) (`migrate`
  refuses them).
- A key pasted anywhere outside `controller.env` (a chat, an issue, a screenshot) is revoked
  and replaced.
