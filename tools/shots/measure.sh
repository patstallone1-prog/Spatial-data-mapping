#!/bin/bash
# tools/shots/measure.sh <page> <spec.json>   -- prints the measurement as JSON.
set -e
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
PAGE=$1; SPEC=$2; PORT=${SHOTS_PORT:-8770}
CHROME=${CHROME:-"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}
PROFILE=${TMPDIR:-/tmp}/kerbside-measure-profile
OUT=$(mktemp -t kerbside-measure).txt
if ! curl -s -o /dev/null "http://localhost:$PORT/tools/shots/measure.html"; then
  (cd "$ROOT" && python3 -m http.server "$PORT" >/dev/null 2>&1 &)
  sleep 1
fi
ENCODED=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(open(sys.argv[1]).read()))" "$SPEC")
rm -rf "$PROFILE"
"$CHROME" --headless=new --hide-scrollbars --window-size=1400,900 --virtual-time-budget=900000 \
  --timeout=900000 --dump-dom --user-data-dir="$PROFILE" --no-first-run \
  "http://localhost:$PORT/tools/shots/measure.html?page=/$PAGE&spec=$ENCODED" > "$OUT" 2>/dev/null
python3 - "$OUT" <<'PY'
import re, sys
text = open(sys.argv[1], encoding="utf-8", errors="replace").read()
m = re.search(r"RESULT (\{.*?\})</pre>", text, re.S)
print(m.group(1) if m else "no result; the page did not finish")
PY
