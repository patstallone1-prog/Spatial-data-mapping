#!/usr/bin/env bash
# Ingest every region in the registry, one after another, and keep only what is finished.
#
# Each region's lidar cache is several gigabytes and is only needed while its terrain is
# built; the observation images are only needed while its facades are read. After a region's
# stages have run, the caches go and the region keeps its capability vector, journal, audit
# baseline and site. The facade cache under build/facade-cache is the corridor's and is
# left alone while the corridor's own reader is running.
#
#   set -a; source .env.local; set +a; nohup scripts/ingest_all_regions.sh > build/ingest-all.log 2>&1 &
set -uo pipefail
cd "$(dirname "$0")/.."
PY=.venv/bin/python
regions=$($PY - <<'PYEOF'
import json
for r in json.load(open("data/regions/regions.json"))["regions"]:
    print(r["name"])
PYEOF
)
for name in $regions; do
  echo "=== $name  $(date -u +%FT%TZ)"
  # Another run of this region may be under way already (the first region was started by hand).
  while pgrep -f "ingest_region.py $name" >/dev/null; do sleep 60; done
  $PY scripts/ingest_region.py "$name" || echo "!!! $name did not finish every stage"
  # Finished artefacts stay; the caches go.
  rm -rf build/lidar-cache build/regions/"$name" 2>/dev/null
  rm -rf data/regions/"$name"/catalog/images 2>/dev/null
  df -h /System/Volumes/Data | tail -1
done
echo "=== all regions attempted $(date -u +%FT%TZ)"
