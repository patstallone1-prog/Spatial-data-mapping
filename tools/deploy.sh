#!/usr/bin/env bash
# Push the project to GitHub. Safe to run from any directory, and safe to re-run.
#
# Order matters: the secret scan runs before anything is pushed, because a credential that
# reaches a remote has to be treated as compromised even if the commit is deleted a minute
# later. Everything else here is recoverable; that is not.

set -uo pipefail

PROJECT="/Users/elialbukerk/Projects/Applications/spatial-mapping-crowdsource"
OWNER="${GITHUB_OWNER:-patstallone1}"
REPO="${GITHUB_REPO:-spatial-data-mapping}"

# Homebrew's bin is not on every shell's PATH, and a bare `gh: command not found` sends people
# reinstalling something they already have.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

cd "$PROJECT" 2>/dev/null || die "Project not found at $PROJECT"
say "Project: $(pwd)"

command -v git >/dev/null || die "git is not installed"
command -v gh  >/dev/null || die "gh is not installed. Run: brew install gh"

gh auth status >/dev/null 2>&1 || die "Not signed in to GitHub. Run: gh auth login"

say "Checking for credentials in every commit"
./tools/check_secrets.sh || die "Secrets found. Nothing pushed."

say "Committing any local changes"
if [ -n "$(git status --porcelain)" ]; then
  git add -A
  git commit -q -m "${1:-Update}" && echo "  committed: ${1:-Update}"
else
  echo "  nothing to commit"
fi

# A repository that does not exist yet is the normal first-run case, not an error.
if ! gh repo view "$OWNER/$REPO" >/dev/null 2>&1; then
  say "Creating $OWNER/$REPO (private)"
  gh repo create "$OWNER/$REPO" --private --source=. --remote=origin --push \
    || die "Could not create the repository. Check the name and your account."
  say "Done: https://github.com/$OWNER/$REPO"
  exit 0
fi

# Point the remote at the right place whether or not it was already set, so a stale or missing
# origin does not need a separate fix.
git remote remove origin >/dev/null 2>&1
git remote add origin "https://github.com/$OWNER/$REPO.git"
git branch -M main

say "Pushing to $OWNER/$REPO"
git push -u origin main || die "Push failed. If it mentions history, run: git push -u origin main --force-with-lease"

say "Done: https://github.com/$OWNER/$REPO"
git log --oneline -1 | sed 's/^/  latest: /'
