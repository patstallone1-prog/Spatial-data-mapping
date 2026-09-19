#!/usr/bin/env bash
# Publish the corridor's data files -- the payload, the official geometry, the detail shards,
# the furniture and ground sidecars and the facade photographs -- to an S3-compatible bucket
# (Cloudflare R2 is the intended one: free egress, ~$0.015/GB-month), so the page in git stays
# a page and the data lives where a city's worth of it can.
#
# Credentials are never in the repository: set them in .env.local (gitignored) and source it.
#   R2_ENDPOINT   https://<account>.r2.cloudflarestorage.com
#   R2_BUCKET     kerbside-assets
#   R2_PUBLIC     https://assets.example.org         (the bucket's public origin)
#   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY        (an R2 API token with object write)
# Then:
#   ./tools/publish_assets.sh
#   .venv/bin/python tools/build_pages.py --map-only --out ../Curb-measurements/docs --assets-base "$R2_PUBLIC"
set -euo pipefail
: "${R2_ENDPOINT:?set R2_ENDPOINT}" "${R2_BUCKET:?set R2_BUCKET}"
command -v aws >/dev/null || { echo "aws cli is needed (brew install awscli)"; exit 2; }
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/docs"
# JSON is gzipped in transit by the bucket's CDN; content types matter for fetch().
for f in sf-corridor-*.json; do
  aws --endpoint-url "$R2_ENDPOINT" s3 cp "$f" "s3://$R2_BUCKET/$f" \
    --content-type application/json --cache-control "public, max-age=300" --only-show-errors
done
if [ -d facades ]; then
  aws --endpoint-url "$R2_ENDPOINT" s3 sync facades "s3://$R2_BUCKET/facades" \
    --cache-control "public, max-age=86400" --only-show-errors
fi
echo "published to s3://$R2_BUCKET (${R2_PUBLIC:-no public origin set})"
