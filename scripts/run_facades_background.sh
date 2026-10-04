#!/bin/bash
# Run build_facades.py across chunks in the background, skipping chunks that already
# have a manifest. Resumes where it left off if restarted.
cd "$(dirname "$0")/.."
set -a; [ -f .env.local ] && . ./.env.local; set +a

mkdir -p build docs/facades
LOG="build/facades-background.log"
PIDFILE="build/facades-background.pid"
STATUS="build/facades-background.status.json"
# The journal tools/background_status.py reads: state, current chunk, chunks done of total.
status() {
    .venv/bin/python - "$1" "$2" <<'PY2' > "$STATUS.tmp" && mv "$STATUS.tmp" "$STATUS"
import json, sys, time
from pathlib import Path
chunks = json.load(open("docs/sf-corridor-chunks.json"))["chunks"]
done = sum(Path(f"docs/facades/{c['key']}/manifest.json").exists() for c in chunks)
print(json.dumps({"task": "facades", "state": sys.argv[1], "current": sys.argv[2] or None,
                  "chunks_done": done, "chunks_total": len(chunks),
                  "updated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}))
PY2
}

echo "$$" > "$PIDFILE"
echo "$(date -u +%FT%TZ) facade background runner started (PID $$)" >> "$LOG"

# Ensure we keep going even if a single chunk fails.
while true; do
    next=$(.venv/bin/python - <<'PY'
import json, sys
from pathlib import Path
chunks = json.load(open("docs/sf-corridor-chunks.json"))["chunks"]
chunks.sort(key=lambda c: (-c.get("readiness", 0), c["key"]))
for c in chunks:
    if not Path(f"docs/facades/{c['key']}/manifest.json").exists():
        print(c["key"])
        sys.exit(0)
print("")
PY
)
    if [ -z "$next" ]; then
        echo "$(date -u +%FT%TZ) all chunks textured; stopping" >> "$LOG"
        status complete ""
        rm -f "$PIDFILE"
        exit 0
    fi
    echo "$(date -u +%FT%TZ) processing chunk $next" >> "$LOG"
    status running "$next"
    if .venv/bin/python scripts/build_facades.py --chunk "$next" --workers 6 >> "$LOG" 2>&1; then
        echo "$(date -u +%FT%TZ) chunk $next finished" >> "$LOG"
    else
        echo "$(date -u +%FT%TZ) chunk $next FAILED (rc=$?), continuing" >> "$LOG"
    fi
    # Brief pause so the loop does not spin if something is wrong.
    sleep 5
done
