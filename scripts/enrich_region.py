#!/usr/bin/env python3
"""The two enrichment stages that are more than one command: a region's lidar trees and its
facade textures (``scripts/ingest_region.py`` stages ``trees`` and ``facades``).

    python scripts/enrich_region.py facades <region>   # rank the chunks, texture every ready one
    python scripts/enrich_region.py trees <region>     # plant the lidar's trees on its ground

``facades`` is ``scripts/run_facades_regions_background.sh`` for one region, without the loop
forever: the chunks are surveyed once, then each chunk with anything to read is textured; a
chunk that fails is listed in ``site/facades/.failed`` and passed over, as the runner did.

``trees`` plants only where the ground cover has no tree from a city inventory: San Francisco's
twenty-seven thousand street trees are the city's own and complete at the kerb, so a cell there
is not read from the lidar a second time for them. Elsewhere the region's lidar is read cell by
cell and its crowns found as it is read (``find_lidar_trees.py``: the points the point-cell store
would keep, without storing them), then planted on the ground the page serves
(``tools/plant_lidar_trees.py``). A region whose lidar finds no crown is answered, not
failed: the parity gate weighs a cell with no trees.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PY = sys.executable
#: Where the trees stage keeps its point cells while it reads them; removed when it is done.
POINTS_SCRATCH = ROOT / "build" / "point-scratch"


def run(*argv: str, env: dict | None = None) -> int:
    print("$", " ".join(argv[1:]), flush=True)
    return subprocess.call([PY, *argv], cwd=ROOT, env={**os.environ, **(env or {})})


def facades(region: str) -> int:
    site = ROOT / "data" / "regions" / region / "site"
    layer = site / "sf-corridor-chunks.json"
    if not layer.exists() and run("scripts/build_facades.py", "--region", region, "--survey"):
        return 1
    chunks = json.loads(layer.read_text())["chunks"]
    chunks.sort(key=lambda c: (-c.get("readiness", 0), c["key"]))
    failed_file = site / "facades" / ".failed"
    failed = set(failed_file.read_text().split()) if failed_file.exists() else set()
    done = textured = 0
    for chunk in chunks:
        key = chunk["key"]
        if chunk.get("readiness", 0) <= 0 or key in failed:
            continue
        if (site / "facades" / key / "manifest.json").exists():
            done += 1
            continue
        if run("scripts/build_facades.py", "--region", region, "--chunk", key, "--workers", "6"):
            print(f"{region}: chunk {key} failed; passed over", flush=True)
            failed_file.parent.mkdir(parents=True, exist_ok=True)
            with failed_file.open("a") as fh:
                fh.write(key + "\n")
            failed.add(key)
        else:
            textured += 1
    print(json.dumps({"region": region, "chunks": len(chunks), "textured_now": textured,
                      "textured_before": done, "failed": len(failed)}), flush=True)
    return 0


def inventory_trees(region: str) -> int:
    ground = ROOT / "data" / "regions" / region / "official" / "ground_cover.json"
    try:
        return len(json.loads(ground.read_text()).get("trees") or [])
    except (OSError, ValueError):
        return 0


def trees(region: str) -> int:
    have = inventory_trees(region)
    if have:
        print(f"{region}: {have} trees from the city's inventory already; the lidar is not read "
              "again for them", flush=True)
        return 0
    scratch = POINTS_SCRATCH
    env = {"SMC_POINTS_ROOT": str(scratch)}
    try:
        code = run("scripts/find_lidar_trees.py", region, env=env)
        if code == 3:
            print(f"{region}: no crowns found in its lidar", flush=True)
            return 0
        if code:
            return 1
        found = scratch / region / "points" / "trees.jsonl"
        kept = ROOT / "data" / "regions" / region / "points" / "trees.jsonl"
        kept.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(found, kept)
        return run("tools/plant_lidar_trees.py", region)
    finally:
        shutil.rmtree(scratch / region, ignore_errors=True)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("step", choices=["facades", "trees"])
    ap.add_argument("region")
    args = ap.parse_args()
    return facades(args.region) if args.step == "facades" else trees(args.region)


if __name__ == "__main__":
    raise SystemExit(main())
