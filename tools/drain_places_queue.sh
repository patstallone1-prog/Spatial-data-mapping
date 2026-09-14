#!/bin/zsh
# Ask Google Places about the next hundred unnamed shopfronts, then stop.
#
# The project's Places quota is a hundred SearchNearby requests a day, and the queue is 3,235
# buildings long, so the pass drains at that rate: run this once a day (a crontab line is at
# the bottom) until the summary's google_places_queue reaches zero, or raise the quota in the
# Google Cloud console (APIs & Services > Places API (New) > Quotas > SearchNearbyRequest per
# day) and pass a larger limit. Answers already paid for are carried over between runs.
#
# Overture's places are pulled in full already (21,206 in the corridor; 3,252 buildings named)
# and need no repeat.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env.local; set +a
.venv/bin/python scripts/build_building_enrichment.py --google-limit "${1:-100}"
python3 - <<'PY'
import json
s = json.load(open("data/sf_building_enrichment/summary.json"))
print("google places: requests", s["google_places_requests"], "queue left", s["google_places_queue"],
      "errors", len(s["google_places_errors"]))
PY
# crontab -e:
# 15 3 * * * /Users/elialbukerk/Projects/Applications/spatial-mapping-crowdsource/tools/drain_places_queue.sh >> /tmp/places_queue.log 2>&1
