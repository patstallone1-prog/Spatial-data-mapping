#!/usr/bin/env python3
"""Group each published ground file's adjoining pitches into blocks of courts.

``build_ground_cover.py`` now writes ``court_complexes`` itself; this puts them into the ground
files already published, without rebuilding everything else the ground carries
(``smc.ground.courts.court_complexes``), and recuts their cells.

    .venv/bin/python tools/group_court_complexes.py
"""

from __future__ import annotations

import json
import math
import runpy
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from smc.ground.courts import court_complexes  # noqa: E402


def ground_files() -> list[Path]:
    # The website's corridor ground is frozen with its page; the app reads its own copy.
    files = [ROOT / "docs/app-sf-corridor-ground.json"]
    files += sorted((ROOT / "docs/regions").glob("*/sf-corridor-ground.json"))
    files += sorted((ROOT / "docs/app-regions").glob("*/sf-corridor-ground.json"))
    return [p for p in files if p.exists()]


def main() -> int:
    cut = runpy.run_path(str(ROOT / "tools/build_window_cells.py"))["cut"]
    for path in ground_files():
        ground = json.loads(path.read_text())
        pitches = ground.get("pitches") or []
        if not pitches:
            continue
        lat0 = sum(p["p"][0][1] for p in pitches) / len(pitches)
        kx, ky = 111_320.0 * math.cos(math.radians(lat0)), 110_540.0
        lon0 = pitches[0]["p"][0][0]
        complexes = court_complexes(
            pitches, lambda lon, lat, o=(lon0, lat0, kx, ky): ((lon - o[0]) * o[2], (lat - o[1]) * o[3]),
            lambda x, y, o=(lon0, lat0, kx, ky): (o[0] + x / o[2], o[1] + y / o[3]))
        ground["court_complexes"] = complexes
        path.write_text(json.dumps(ground, separators=(",", ":")))
        if (path.parent / "cells" / path.stem).exists():
            cut(path)
        grouped = sum(1 for p in pitches if "k" in p)
        print(f"{path.relative_to(ROOT)}: {len(complexes)} blocks from {grouped} of {len(pitches)} pitches")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
