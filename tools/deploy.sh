#!/usr/bin/env bash
# Push the project to GitHub. Safe to run from any directory, and safe to re-run.
#
# Order matters: the secret scan runs before anything is pushed, because a credential that
# reaches a remote has to be treated as compromised even if the commit is deleted a minute
# later. Everything else here is recoverable; that is not.

set -uo pipefail

PROJECT="/Users/elialbukerk/Projects/Applications/spatial-mapping-crowdsource"
OWNER="${GITHUB_OWNER:-patstallone1-prog}"
REPO="${GITHUB_REPO:-Spatial-data-mapping}"

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

say "Building the site"
./tools/build_all.sh || die "Build failed. Nothing pushed."

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

# Pages is what makes the download a download. Without it the install buttons point at a 404,
# so this is part of deploying rather than a separate setup step somebody has to remember.
say "Publishing docs/ to GitHub Pages"
if gh api "repos/$OWNER/$REPO/pages" >/dev/null 2>&1; then
  gh api -X PUT "repos/$OWNER/$REPO/pages" \
    -f 'source[branch]=main' -f 'source[path]=/docs' >/dev/null \
    && echo "  source set to main /docs"
else
  gh api -X POST "repos/$OWNER/$REPO/pages" \
    -f 'source[branch]=main' -f 'source[path]=/docs' >/dev/null \
    && echo "  Pages enabled on main /docs" \
    || echo "  Could not enable Pages. A private repository needs a paid plan for it."
fi

SITE="https://$(echo "$OWNER" | tr '[:upper:]' '[:lower:]').github.io/$REPO/"
say "Done"
echo "  repository  https://github.com/$OWNER/$REPO"
echo "  site        $SITE"
echo "  app         ${SITE}app.html"
git log --oneline -1 | sed 's/^/  latest:     /'
echo
echo "  The first build takes a minute or two. Until it finishes the address returns 404."
