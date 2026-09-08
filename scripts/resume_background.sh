#!/bin/bash
# Restart the two long background runs. Both resume from their own checkpoints, so this is
# safe to run at any time and safe to run twice -- a second copy would only re-read the parts
# and find nothing left to do.
cd "$(dirname "$0")/.."
set -a; [ -f .env.local ] && . ./.env.local; set +a

# torch and transformers are installed ad hoc rather than via pyproject, so a `uv sync` prunes
# them and the semantic pass dies on import. Put them back before starting it.
.venv/bin/python -c "import torch, transformers" 2>/dev/null || \
  uv pip install --python .venv/bin/python -q torch torchvision transformers

running() { pgrep -f "$1" >/dev/null; }

if running build_semantic_fractions; then
  echo "semantics: already running"
else
  nohup .venv/bin/python scripts/build_semantic_fractions.py \
    --sample 0 --workers 14 --checkpoint 250 >> build/semantics-full.log 2>&1 &
  echo "semantics: started $!"
fi

if running build_lidar_depth; then
  echo "lidar: already running"
else
  nohup .venv/bin/python scripts/build_lidar_depth.py > build/lidar-depth.log 2>&1 &
  echo "lidar: started $!"
fi

# Keep the machine awake for as long as either is alive.
for pid in $(pgrep -f "build_semantic_fractions|build_lidar_depth"); do
  nohup caffeinate -dimsu -w "$pid" >/dev/null 2>&1 &
done
echo "caffeinate attached"
