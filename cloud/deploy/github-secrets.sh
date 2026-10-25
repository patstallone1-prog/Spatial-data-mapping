#!/usr/bin/env bash
# Give the cloud-watchdog workflow what it needs, from the controller's settings. Run from the
# repository root on the operator's machine (needs `gh auth login`), once after
# `smc-cloud runpod-controller create`, and again after rotating a key.
#
#   cloud/deploy/github-secrets.sh [env-file]
#
# Secrets go to GitHub on stdin and are never printed. The watchdog only turns on
# (KERBSIDE_CLOUD_ENABLED=true) once KERBSIDE_CONTROLLER_URL is set, so it never alarms about a
# controller that does not exist yet. The public bucket's key is never sent: the watchdog does
# not publish.
set -euo pipefail
env_file="${1:-cloud/config/controller.env}"
[ -f "$env_file" ] || { echo "no $env_file (copy cloud/config/controller.env.example)"; exit 2; }
set -a; source "$env_file"; set +a
for name in KERBSIDE_SECRET KERBSIDE_OPS_TOKEN RUNPOD_API_KEY S3_PRIVATE_ACCESS_KEY_ID S3_PRIVATE_SECRET_ACCESS_KEY; do
  [ -n "${!name:-}" ] || { echo "$name is empty in $env_file"; exit 2; }
  printf '%s' "${!name}" | gh secret set "$name"
done
for name in AWS_REGION S3_PRIVATE_BUCKET S3_PUBLIC_BUCKET S3_PUBLIC_BASE; do
  [ -n "${!name:-}" ] && gh variable set "$name" --body "${!name}"
done
if [ -n "${KERBSIDE_CONTROLLER_URL:-}" ]; then
  gh variable set KERBSIDE_CONTROLLER_URL --body "$KERBSIDE_CONTROLLER_URL"
  gh variable set KERBSIDE_CLOUD_ENABLED --body true
  echo "watchdog on; run it once: gh workflow run cloud-watchdog.yml"
else
  echo "secrets set; the watchdog stays off until KERBSIDE_CONTROLLER_URL is in $env_file"
fi
