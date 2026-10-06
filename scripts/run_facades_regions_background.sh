#!/bin/bash
# Photograph the walls of every built region beyond the corridor, chunk by chunk, in the
# background: build_facades.py --region R --chunk K for each chunk without a manifest, the
# best-covered first. Resumes where it left off when restarted (a chunk with a manifest is done).
# The textures land in data/regions/<R>/site/facades/, where the region's page build reads
# them; publishing a region's rebuilt page is a separate, checked step.
cd "$(dirname "$0")/.."
set -a; [ -f .env.local ] && . ./.env.local; set +a

REGIONS="${FACADE_REGIONS:-sf-mission sf-haight-castro sf-sunset oakland-downtown berkeley-downtown palo-alto-downtown san-jose-downtown}"
mkdir -p build
LOG="build/facades-regions.log"
STATUS="build/facades-regions.status.json"
PIDFILE="build/facades-regions.pid"
echo "$$" > "$PIDFILE"
echo "$(date -u +%FT%TZ) region facade runner started (PID $$): $REGIONS" >> "$LOG"

status() {
    .venv/bin/python - "$1" "$2" "$REGIONS" <<'PY' > "$STATUS.tmp" && mv "$STATUS.tmp" "$STATUS"
import json, sys, time
from pathlib import Path
state, current, regions = sys.argv[1], sys.argv[2], sys.argv[3].split()
rows = {}
for r in regions:
    site = Path(f"data/regions/{r}/site")
    layer = site / "sf-corridor-chunks.json"
    chunks = json.loads(layer.read_text())["chunks"] if layer.exists() else []
    manifests = [site / "facades" / c["key"] / "manifest.json" for c in chunks]
    done = [m for m in manifests if m.exists()]
    walls = sum(len(json.loads(m.read_text())["walls"]) for m in done)
    rows[r] = {"chunks_done": len(done), "chunks_total": len(chunks), "walls": walls}
print(json.dumps({"task": "facades (regions)", "state": state, "current": current or None,
                  "regions": rows, "updated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}))
PY
}

for region in $REGIONS; do
    if [ ! -f "data/regions/$region/site/sf-corridor-chunks.json" ]; then
        echo "$(date -u +%FT%TZ) $region: surveying" >> "$LOG"
        .venv/bin/python scripts/build_facades.py --region "$region" --survey >> "$LOG" 2>&1 \
            || { echo "$(date -u +%FT%TZ) $region: survey FAILED" >> "$LOG"; continue; }
    fi
    while true; do
        next=$(.venv/bin/python - "$region" <<'PY'
import json, sys
from pathlib import Path
site = Path(f"data/regions/{sys.argv[1]}/site")
chunks = json.load(open(site / "sf-corridor-chunks.json"))["chunks"]
chunks.sort(key=lambda c: (-c.get("readiness", 0), c["key"]))
failed = set((site / "facades" / ".failed").read_text().split()) if (site / "facades" / ".failed").exists() else set()
for c in chunks:
    if c.get("readiness", 0) <= 0 or c["key"] in failed:
        continue
    if not (site / "facades" / c["key"] / "manifest.json").exists():
        print(c["key"]); break
PY
)
        [ -z "$next" ] && { echo "$(date -u +%FT%TZ) $region: all chunks done" >> "$LOG"; break; }
        echo "$(date -u +%FT%TZ) $region: chunk $next" >> "$LOG"
        status running "$region/$next"
        if .venv/bin/python scripts/build_facades.py --region "$region" --chunk "$next" --workers 6 >> "$LOG" 2>&1; then
            echo "$(date -u +%FT%TZ) $region: chunk $next finished" >> "$LOG"
        else
            echo "$(date -u +%FT%TZ) $region: chunk $next FAILED, skipping it" >> "$LOG"
            mkdir -p "data/regions/$region/site/facades"; echo "$next" >> "data/regions/$region/site/facades/.failed"
        fi
        status running "$region/$next"
        sleep 3
    done
done
status complete ""
echo "$(date -u +%FT%TZ) region facade runner finished" >> "$LOG"
rm -f "$PIDFILE"
