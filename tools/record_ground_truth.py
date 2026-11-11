#!/usr/bin/env python3
"""Record the world's ground truth: the mapped world as built from its sources, kept apart from
everything players change in it.

The world players see is the mapped data (the payloads, the ground, the kerbs, the furniture --
what the build made from OpenStreetMap, the city's own data, lidar and imagery) with their edits
drawn over it: the exterior edits (this browser's, and what verified editors confirmed for
everyone: docs/sf-corridor-exterior-edits.json and the backend's), and in City mode the world's
own record of what was bought, built or broken (each browser's, or a party's). None of those is
written into the data; this records the data itself, so it can always be had back as it was:

  * the asset map as it stands (which immutable chunk each data path is) is copied into the
    bucket as ``ground-truth/asset-map-<version>.json``: the chunks it names are never rewritten,
    so the map is the whole of that world;
  * the data the site serves itself (not in the map: the corridor, the regions in git, the cells)
    is put in the bucket as chunks too, named by content, and listed;
  * docs/ground-truth.json says which, and when.

    set -a; source cloud/config/controller.env; set +a
    PYTHONPATH=src .venv/bin/python tools/record_ground_truth.py [--dry-run]

The page's Settings has "Ground truth only" (or ?truth=1): the world drawn without anyone's edits.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
MAP = DOCS / "asset-map.json"
OUT = DOCS / "ground-truth.json"
sys.path.insert(0, str(ROOT / "src"))

DATA_SUFFIXES = {".json", ".bin", ".glb", ".geojson", ".pbf"}
#: What players change, and where it is kept -- never in the data recorded here.
EDITS_KEPT_APART = {
    "exterior_edits": "this browser's localStorage (kerbside:exterior-edits:v1); verified editors' on the backend "
                      "(supabase/kerbside_exterior_edits.sql); published in docs/sf-corridor-exterior-edits.json",
    "city_world": "each browser's localStorage (kerbside:city:*), or the party host's state, sent peer to peer",
}
CONTENT_TYPES = {".json": "application/json", ".geojson": "application/geo+json", ".bin": "application/octet-stream",
                 ".glb": "model/gltf-binary", ".pbf": "application/x-protobuf"}


def world_files(mapped: dict[str, str]) -> list[Path]:
    """The world's data the site serves itself: the payloads and their layers, and their cells."""
    out = []
    for p in sorted(DOCS.rglob("*")):
        if not p.is_file() or p.suffix not in DATA_SUFFIXES:
            continue
        rel = str(p.relative_to(DOCS))
        if rel in mapped or rel in ("asset-map.json", "ground-truth.json"):
            continue
        if p.name.startswith(("sf-corridor", "app-")) or rel.startswith(("cells/", "regions/", "app-regions/")):
            out.append(p)
    return out


def chunk_name(path: Path) -> str:
    return f"chunks/{hashlib.sha256(path.read_bytes()).hexdigest()[:24]}{path.suffix}"


def answers(url: str) -> bool:
    try:
        req = urllib.request.Request(url, method="HEAD", headers={"Origin": "https://spatial-data-mapping.vercel.app"})
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status == 200
    except Exception:
        return False


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    record = json.loads(MAP.read_text())
    mapped, base = record["files"], record["origin"]
    files = world_files(mapped)
    plan = {str(p.relative_to(DOCS)): chunk_name(p) for p in files}
    total = sum(p.stat().st_size for p in files)
    print(f"{len(mapped)} mapped files (asset map {record['version']}); {len(files)} site-served data files, "
          f"{total / 1e6:.0f} MB, {len(set(plan.values()))} distinct chunks")
    if args.dry_run:
        return 0
    from smc.cloud.store import open_store

    store = open_store(os.environ["KERBSIDE_PUBLIC_STORE"], role="public")
    by_chunk = {}
    for p in files:
        by_chunk.setdefault(plan[str(p.relative_to(DOCS))], p)
    with ThreadPoolExecutor(16) as pool:
        missing = [n for n, ok in zip(by_chunk, pool.map(lambda n: answers(f"{base}/{n}"), by_chunk), strict=True) if not ok]
    print(f"sending {len(missing)} chunks not yet in the bucket", flush=True)

    def send(name: str) -> None:
        path = by_chunk[name]
        store.put_file(name, path, cache_control="public, max-age=31536000, immutable",
                       content_type=CONTENT_TYPES.get(path.suffix, "application/octet-stream"))

    with ThreadPoolExecutor(16) as pool:
        list(pool.map(send, missing))
    map_key = f"ground-truth/asset-map-{record['version']}.json"
    tmp = ROOT / ".ground-truth-map.tmp.json"
    tmp.write_text(MAP.read_text())
    store.put_file(map_key, tmp, cache_control="public, max-age=31536000, immutable", content_type="application/json")
    tmp.unlink()
    truth = {
        "schema": "kerbside.ground_truth/1",
        "recorded_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "basis": "the mapped world as built from its sources, before anyone's edits; the edits are kept apart (edits_kept_apart) and drawn over it",
        "store": base,
        "asset_map": {"version": record["version"], "copy": map_key, "files": len(mapped)},
        "site_files": plan,
        "edits_kept_apart": EDITS_KEPT_APART,
    }
    OUT.write_text(json.dumps(truth, indent=1, sort_keys=True) + "\n")
    print(f"ground truth recorded: {len(mapped)} mapped and {len(plan)} site files; {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
