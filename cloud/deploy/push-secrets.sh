#!/usr/bin/env bash
# Copy the controller's secrets to its server and (re)start it. Run from the operator's machine
# once after `terraform apply`, and again whenever a secret is rotated.
#
#   cloud/deploy/push-secrets.sh <controller-ip> [env-file]
#
# The env file (default cloud/config/controller.env, gitignored) is cloud/config/controller.env.example
# filled in. It is copied with mode 600 to /etc/kerbside/controller.env and never logged.
set -euo pipefail
host="${1:?controller address}"
env_file="${2:-cloud/config/controller.env}"
[ -f "$env_file" ] || { echo "no $env_file (copy cloud/config/controller.env.example)"; exit 2; }
grep -q '^KERBSIDE_SECRET=..' "$env_file" || { echo "KERBSIDE_SECRET is empty in $env_file"; exit 2; }
scp -q "$env_file" "root@$host:/etc/kerbside/controller.env.new"
ssh "root@$host" 'install -m 600 /etc/kerbside/controller.env.new /etc/kerbside/controller.env && rm /etc/kerbside/controller.env.new && systemctl restart kerbside-controller'
echo "controller on $host restarted with new secrets"
