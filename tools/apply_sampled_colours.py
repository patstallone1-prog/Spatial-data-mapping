#!/usr/bin/env python3
"""Paint each app region's buildings with the colours sampled off photographs of them since it
was built.

``scripts/build_building_colours.py --region <r>`` writes
``data/regions/<r>/official/building_colours.json``; the builder reads it on the next full
rebuild (``annotate_region_colours``). This puts the colours into the app's published regional
payloads now, with the builder's own test of a believable sample, and recuts their cells. A
building that already has a colour -- sampled, or a reviewer's -- keeps it. The website's frozen
regional pages are left as they are.

    .venv/bin/python tools/apply_sampled_colours.py
"""

from __future__ import annotations

import json
import runpy
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from smc.facades.colour import believable  # noqa: E402


def apply(payload: dict, colours: dict) -> int:
    painted = 0
    for way in payload.get("ways", []):
        if way.get("kind") != "building" or way.get("colour"):
            continue
        sampled = colours.get(str(way.get("osm_id") or ""))
        if sampled and believable(sampled.get("c")):
            way["colour"] = sampled["c"]
            way["colour_views"] = sampled["n"]
            painted += 1
    return painted


def main() -> int:
    cut = runpy.run_path(str(ROOT / "tools/build_window_cells.py"))["cut"]
    for path in sorted((ROOT / "docs/app-regions").glob("*/sf-corridor-3d.json")):
        region = path.parent.name
        source = ROOT / "data/regions" / region / "official" / "building_colours.json"
        if not source.exists():
            continue
        table = json.loads(source.read_text())
        if table.get("keyed_by") != "osm_id":
            raise SystemExit(f"{source} is not keyed by osm_id")
        payload = json.loads(path.read_text())
        painted = apply(payload, table.get("buildings", {}))
        if painted:
            path.write_text(json.dumps(payload, separators=(",", ":")))
            if (path.parent / "cells" / path.stem).exists():
                cut(path)
        buildings = [w for w in payload["ways"] if w.get("kind") == "building"]
        share = sum(bool(w.get("colour")) for w in buildings) / max(1, len(buildings))
        print(f"{region}: {painted} newly painted, {share:.0%} of buildings sampled")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
