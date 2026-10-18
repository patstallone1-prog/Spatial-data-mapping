#!/usr/bin/env python3
"""Bind each region's storefront-name sidecar to its payload again after a measured change.

A sidecar (``tools/build_storefront_names.py``) is bound to the exact bytes of the payload it was
matched against, and to each named building's footprint and height, so that a rebuilt world can
never carry names over to buildings they were not matched to. A pass that only measures what is
already there -- a lidar height adopted, a kerb laid on the lidar's line, a sampled colour --
changes those bytes, and the search index then refuses every name in the region. This re-binds:
a building with the same id and the same footprint keeps its names, with the height it now has;
one whose footprint changed loses them until the storefront audit is run again.

    .venv/bin/python tools/rebind_storefront_names.py
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"


def rebind(sidecar: dict, payload: dict, raw_sha256: str) -> tuple[dict, int, int]:
    ways = {str(w.get("osm_id")): w for w in payload.get("ways", []) if w.get("kind") == "building"}
    kept, dropped = {}, 0
    for key, entry in sidecar.get("buildings", {}).items():
        way = ways.get(key)
        if not way or way["points"] != entry["points"]:
            dropped += 1
            continue
        kept[key] = {**entry, "height_m": way.get("height_m")}
    return ({**sidecar, "source_world_sha256": raw_sha256, "bbox": payload["bbox"], "buildings": kept},
            len(kept), dropped)


def main() -> int:
    pairs = [(DOCS / "sf-corridor-storefront-names.json", DOCS / "sf-corridor-3d.json")]
    pairs += [(p, p.parent / "sf-corridor-3d.json")
              for p in sorted(DOCS.glob("app-regions/*/sf-corridor-storefront-names.json"))]
    for names, world in pairs:
        if not (names.exists() and world.exists()):
            continue
        raw = world.read_bytes()
        sha = hashlib.sha256(raw).hexdigest()
        sidecar = json.loads(names.read_text())
        if sidecar.get("source_world_sha256") == sha:
            continue
        bound, kept, dropped = rebind(sidecar, json.loads(raw), sha)
        names.write_text(json.dumps(bound, separators=(",", ":")))
        print(f"{names.relative_to(DOCS)}: {kept} kept, {dropped} dropped (footprint changed)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
