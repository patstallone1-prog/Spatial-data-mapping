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
PAGE=$1; SPOTS=$2; OUT=$3; H=${4:-1360}
PORT=${SHOTS_PORT:-$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')}
CHROME=${CHROME:-"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}
PROFILE=$(mktemp -d "${TMPDIR:-/tmp}/kerbside-shots.XXXXXX")
CHROME_PID=""
SERVER_PID=""
cleanup() {
  if [ -n "$CHROME_PID" ]; then kill "$CHROME_PID" 2>/dev/null || true; fi
  if [ -n "$SERVER_PID" ]; then kill "$SERVER_PID" 2>/dev/null || true; fi
  rm -rf "$PROFILE"
}
trap cleanup EXIT
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "benchmark port $PORT is already in use" >&2
  exit 1
fi
python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$ROOT" >/dev/null 2>&1 &
SERVER_PID=$!
sleep 1
curl -fsS -o /dev/null "http://127.0.0.1:$PORT/tools/shots/index.html"
ENCODED=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(open(sys.argv[1]).read()))" "$SPOTS")
rm -f "$OUT"
"$CHROME" --headless=new --hide-scrollbars --window-size=1920,"$H" --virtual-time-budget=900000 --timeout=900000 \
  --screenshot="$OUT" "http://127.0.0.1:$PORT/tools/shots/index.html?page=/$PAGE&spots=$ENCODED" \
  --user-data-dir="$PROFILE" --no-first-run >/dev/null 2>&1 &
CHROME_PID=$!
for ((attempt=0; attempt<180; attempt++)); do
  if [ -s "$OUT" ]; then break; fi
  if ! kill -0 "$CHROME_PID" 2>/dev/null; then break; fi
  sleep 5
done
test -s "$OUT" || { echo "benchmark renderer did not produce $OUT" >&2; exit 1; }
sleep 1
# Chrome may retain a live WebGL iframe after its screenshot has been written.
kill "$CHROME_PID" 2>/dev/null || true
wait "$CHROME_PID" 2>/dev/null || true
CHROME_PID=""
echo "$OUT"
