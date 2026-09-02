#!/usr/bin/env bash
# Scan every commit for credential *values*, before anything is pushed.
#
# Matches shapes, not names: documentation that discusses "service_role" or writes
# "sb_secret_..." as a placeholder is not a leak, and a scanner that cannot tell the difference
# gets ignored within a week. The publishable Supabase key is expected and allowed -- it is
# designed to ship in client code, and the bucket it reaches is write-only.
set -uo pipefail

declare -a PATTERNS=(
  'sb_secret_[A-Za-z0-9_-]{20,}'                 # Supabase secret key
  'eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{40,}' # any JWT (service_role lives here)
  'hf_[A-Za-z0-9]{30,}'                          # Hugging Face token
  'gh[pousr]_[A-Za-z0-9]{30,}'                   # GitHub token
  'AIza[A-Za-z0-9_-]{30,}'                       # Google API key
  '-----BEGIN [A-Z ]*PRIVATE KEY-----'           # private keys
  '"private_key":'                               # GCP service-account JSON
)

status=0
revs=$(git rev-list --all)

# The working tree as well as history, including files not yet added. deploy.sh runs this before
# it commits, so scanning history alone would wave through the one case that actually matters: a
# credential written a minute ago, about to be pushed for the first time. Gitignored paths are
# left out -- .env.local is meant to hold keys and never leaves this machine.
worktree=()
while IFS= read -r -d '' f; do worktree+=("$f"); done \
  < <(git ls-files -coz --exclude-standard -- . ':!tools/check_secrets.sh')

for pattern in "${PATTERNS[@]}"; do
  # Exclude this file: it lists the patterns literally and would otherwise match itself on
  # every run, which is how a scanner teaches everyone to ignore its output.
  hits=$(git grep -nIE "$pattern" $revs -- . ':!tools/check_secrets.sh' 2>/dev/null | head -5)
  if [ -n "$hits" ]; then
    echo "LEAK in history: $pattern"
    echo "$hits" | sed 's/^/  /'
    status=1
  fi

  if [ ${#worktree[@]} -gt 0 ]; then
    hits=$(grep -nIE "$pattern" "${worktree[@]}" 2>/dev/null | head -5)
    if [ -n "$hits" ]; then
      echo "LEAK in working tree: $pattern"
      echo "$hits" | sed 's/^/  /'
      status=1
    fi
  fi
done

if git log --all --oneline -- .env.local .env 2>/dev/null | grep -q .; then
  echo "LEAK: .env was committed at some point"
  status=1
fi

[ $status -eq 0 ] && echo "clean: no credential values in history or the working tree"
exit $status
