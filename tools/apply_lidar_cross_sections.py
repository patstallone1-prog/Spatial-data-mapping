#!/usr/bin/env python3
"""Lay each app region's street cross-sections on the kerbs its lidar measured.

The region lidar pass (scripts/measure_region_lidar.py) reads the kerb offsets either side of
every street every 4 m into ``data/regions/<r>/official/curb_profiles_lidar.json``, and the
builder lays the stations on them (``annotate_cross_sections``). But the app's regional
payloads were cut before the pass had run in most regions, so every station of the Mission's,
the Sunset's, San Jose's, Berkeley's and Palo Alto's streets was a kerb implied by the mapped
width (grade ``N``), with the measurement on disk beside it. This runs the same step
(``smc.facts.build_cross_sections``) on the published payloads with the region's lidar
profiles, and recuts their cells. A region with the city's own curb-line profile is left to
the builder, which ranks that above the lidar. The website's frozen regional pages are left as
they are.

    .venv/bin/python tools/apply_lidar_cross_sections.py [region ...]
"""

from __future__ import annotations

import json
import runpy
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from smc.facades.geometry import LocalFrame  # noqa: E402
from smc.facts.build_cross_sections import build_cross_sections  # noqa: E402
from smc.facts.cross_section import SourceGrade  # noqa: E402


def profiles_of(path: Path) -> dict:
    try:
        return json.loads(path.read_text()).get("profiles") or {} if path.exists() else {}
    except ValueError:
        return {}


def street_ids(region: str) -> dict[str, int]:
    """OpenStreetMap ids of the region's streets by their geometry. The app's payloads leave a
    street's id out; the website's has it, for the same ways."""
    for path in (ROOT / "docs/regions" / region / "sf-corridor-3d.json",
                 ROOT / "data/regions" / region / "site" / "sf-corridor-3d.json"):
        if path.exists():
            return {json.dumps(w["points"]): w["osm_id"] for w in json.loads(path.read_text())["ways"]
                    if w.get("kind") == "street" and w.get("osm_id") is not None}
    return {}


def apply(payload: dict, official: Path, ids: dict[str, int] | None = None) -> Counter | None:
    if profiles_of(official / "curb_profiles_corridor.json"):
        return None
    table = json.loads((official / "curb_profiles_lidar.json").read_text())
    if table.get("grade") != "lidar" or not table.get("profiles"):
        return None
    centrelines = json.loads((official / "centrelines_osm.json").read_text())
    bbox = payload["bbox"]
    frame = LocalFrame((bbox["south"] + bbox["north"]) / 2.0, (bbox["west"] + bbox["east"]) / 2.0)
    ways = payload["ways"]
    # A lidar profile is keyed by the way's own id; the way is its own centreline. The key is
    # what the builder sets too, and is put back afterwards where the way had none.
    had = {id(w): w.get("cnn") for w in ways if w.get("kind") == "street"}
    for way in ways:
        if way.get("kind") != "street" or way.get("cnn"):
            continue
        osm_id = way.get("osm_id")
        if osm_id is None and ids:
            osm_id = ids.get(json.dumps(way["points"]))
        if osm_id is not None:
            way["cnn"] = f"osm:{osm_id}"
    bands_path = official / "parking_bands.json"
    measured = json.loads(bands_path.read_text()).get("bands", {}) if bands_path.exists() else {}
    counts = Counter(build_cross_sections(ways, centrelines, table["profiles"], frame=frame,
                                          measured_parking=measured, profile_grade=SourceGrade.LIDAR))
    for way in ways:
        if id(way) in had and had[id(way)] is None:
            way.pop("cnn", None)
    return counts


def main() -> int:
    wanted = set(sys.argv[1:])
    cut = runpy.run_path(str(ROOT / "tools/build_window_cells.py"))["cut"]
    for path in sorted((ROOT / "docs/app-regions").glob("*/sf-corridor-3d.json")):
        region = path.parent.name
        if wanted and region not in wanted:
            continue
        official = ROOT / "data/regions" / region / "official"
        if not (official / "curb_profiles_lidar.json").exists():
            continue
        payload = json.loads(path.read_text())
        counts = apply(payload, official, street_ids(region))
        if counts is None:
            print(f"{region}: left to the builder (city curb profile, or no lidar profile)")
            continue
        grades = Counter(row[3] for w in payload["ways"] if w.get("kind") == "street"
                         for row in w.get("xs", []) if len(row) >= 4)
        path.write_text(json.dumps(payload, separators=(",", ":")))
        if (path.parent / "cells" / path.stem).exists():
            cut(path)
        total = sum(grades.values()) or 1
        print(f"{region}: stations {dict(grades)}; lidar-measured {grades['L'] / total:.0%}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
