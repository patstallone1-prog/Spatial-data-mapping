#!/bin/bash
# A contact sheet of the built page, photographed headless: the visual proof a change is
# judged by before it is deployed.
#
#   tools/shots/shoot.sh docs/sf-corridor-3d.html spots.json out.png [sheet-height]
#   tools/shots/shoot.sh data/regions/oakland-downtown/site/sf-corridor-3d.html spots.json out.png
#
# spots.json is a list of {name, lon, lat, from, tilt, heading[, hide]} -- what kerbside.shoot()
# takes, plus a caption and a surface to hide. Serves the repository root on a port of its own
# (the page is loaded in an iframe beside it, so both must come from one origin), renders the
# sheet with headless Chrome, and writes the PNG.
set -e
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
PAGE=$1; SPOTS=$2; OUT=$3; H=${4:-1360}; PORT=${SHOTS_PORT:-8770}
CHROME=${CHROME:-"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}
PROFILE=${TMPDIR:-/tmp}/kerbside-shots-profile
if ! curl -s -o /dev/null "http://localhost:$PORT/tools/shots/index.html"; then
  (cd "$ROOT" && python3 -m http.server "$PORT" >/dev/null 2>&1 &)
  sleep 1
fi
ENCODED=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(open(sys.argv[1]).read()))" "$SPOTS")
rm -rf "$PROFILE"; rm -f "$OUT"
("$CHROME" --headless=new --hide-scrollbars --window-size=1920,"$H" --virtual-time-budget=900000 --timeout=900000 \
  --screenshot="$OUT" "http://localhost:$PORT/tools/shots/index.html?page=/$PAGE&spots=$ENCODED" \
  --user-data-dir="$PROFILE" --no-first-run >/dev/null 2>&1 &)
until [ -s "$OUT" ]; do sleep 5; done; sleep 3
pkill -f "Google Chrome.*headless" || true
echo "$OUT"
