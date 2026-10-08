"""Cut each world's large files into 500 m cells, so a lighter page fetches only what is near.

A page on a phone or a small laptop builds the square round the walker (the page's
LIGHT_LEVEL), but it still had to download and parse each whole file first -- the payload's
thirty-three megabytes of ways, twenty-four of street furniture, twelve of ground -- and that
parse alone was a gigabyte and a half: enough, on its own, for the browser to kill the page.

This writes, beside each file, ``cells/<file stem>/``:

  manifest.json   the grid (origin, cell size in degrees), which cells exist, and the file's bbox
  base.json       the file with every positioned list emptied: everything else it carries
  <cx>_<cy>.json  ``{path: [[index, item], ...]}`` for the items with a position in that cell

An item is in every cell one of its positions falls in (a street crossing four cells is in all
four), keyed by its index in the original list, so the page puts the lists back together once
and in their first order. The page filters what it gathers to its square as before; the cells
only spare it what is nowhere near.

    .venv/bin/python tools/build_window_cells.py
"""
from __future__ import annotations

import json
import math
import shutil
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
CELL_M = 500.0
#: The files worth cutting: the large ones whose items stand somewhere.
FILES = ["sf-corridor-3d.json", "sf-corridor-furniture.json", "sf-corridor-ground.json",
         "app-sf-corridor-ground.json", "sf-corridor-world-objects.json", "sf-corridor-official.json"]
#: Where an item keeps its position, in the order the page looks (BUILD_WINDOW.near).
POSITION_KEYS = ("centroid", "p", "points", "c", "anchor", "lines", "position")


def positions(value, depth: int = 0):
    if depth > 5:
        return
    if isinstance(value, list):
        if len(value) >= 2 and all(isinstance(v, (int, float)) for v in value[:2]):
            lon, lat = value[0], value[1]
            if -180 <= lon <= 180 and -90 <= lat <= 90:
                yield lon, lat
            return
        for v in value:
            yield from positions(v, depth + 1)
    elif isinstance(value, dict):
        if isinstance(value.get("lon"), (int, float)) and isinstance(value.get("lat"), (int, float)):
            yield value["lon"], value["lat"]
            return
        for key in POSITION_KEYS:
            if key in value:
                yield from positions(value[key], depth + 1)


def splittable(items) -> bool:
    """A list of items, most of which stand somewhere."""
    if not isinstance(items, list) or len(items) < 50 or not isinstance(items[0], (dict, list)):
        return False
    sample = items[:: max(1, len(items) // 50)]
    return sum(1 for item in sample if next(positions(item), None) is not None) >= len(sample) * 0.5


def lists_of(document: dict) -> dict[str, list]:
    """The positioned lists in a document, by dotted path: top level, and one level down."""
    found = {}
    for key, value in document.items():
        if splittable(value):
            found[key] = value
        elif isinstance(value, dict):
            for inner, items in value.items():
                if splittable(items):
                    found[f"{key}.{inner}"] = items
    return found


def cut(path: Path) -> dict | None:
    document = json.loads(path.read_text())
    if not isinstance(document, dict):
        return None
    lists = lists_of(document)
    if not lists:
        return None
    lons, lats = [], []
    for items in lists.values():
        for item in items:
            for lon, lat in positions(item):
                lons.append(lon)
                lats.append(lat)
    origin = [min(lons), min(lats)]
    mid_lat = (min(lats) + max(lats)) / 2
    cell = [CELL_M / (111320.0 * math.cos(math.radians(mid_lat))), CELL_M / 111320.0]
    cells: dict[str, dict[str, list]] = defaultdict(lambda: defaultdict(list))
    for dotted, items in lists.items():
        for index, item in enumerate(items):
            seen = set()
            for lon, lat in positions(item):
                key = f"{int((lon - origin[0]) // cell[0])}_{int((lat - origin[1]) // cell[1])}"
                if key not in seen:
                    seen.add(key)
                    cells[key][dotted].append([index, item])
            if not seen:      # nowhere in particular: in every square
                cells["any"][dotted].append([index, item])
    out = path.parent / "cells" / path.stem
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    base = json.loads(path.read_text())
    for dotted in lists:
        head, _, tail = dotted.partition(".")
        if tail:
            base[head][tail] = []
        else:
            base[head] = []
    (out / "base.json").write_text(json.dumps(base, separators=(",", ":")))
    sizes = {}
    for key, content in cells.items():
        text = json.dumps(content, separators=(",", ":"))
        (out / f"{key}.json").write_text(text)
        sizes[key] = len(text)
    manifest = {"schema": "kerbside.window_cells/1", "source": path.name, "origin": origin, "cell": cell,
                "cell_m": CELL_M, "paths": sorted(lists), "cells": sizes, "bbox": document.get("bbox")}
    (out / "manifest.json").write_text(json.dumps(manifest, separators=(",", ":")))
    name = str(path.relative_to(ROOT)) if path.is_relative_to(ROOT) else str(path)
    return {"file": name, "cells": len(cells), "lists": len(lists),
            "bytes": sum(sizes.values())}


def fetched_files() -> list[Path]:
    """The large files the app's pages fetch, read from each page as it was built: its assets
    folder (kerbside-assets) and the payload and ground URLs it names (build_app_worlds)."""
    import re
    wanted: list[Path] = []
    pages = [DOCS / "app-model.html"] + sorted((DOCS / "app-regions").glob("*/app-model.html"))
    for page in pages:
        html = page.read_text()
        assets = re.search(r'<meta name="kerbside-assets" content="([^"]*)"', html)
        base = (page.parent / assets.group(1)).resolve() if assets and assets.group(1) else page.parent
        def url_of(name: str) -> Path:
            found = re.search(rf'const {name} = (asset\()?"([^"]+)"', html)
            if not found:
                return base / "missing.json"
            return (base if found.group(1) else page.parent) / found.group(2)
        wanted.append(url_of("PAYLOAD_URL"))
        wanted.append(url_of("GROUND_URL"))
        for other in ("sf-corridor-furniture.json", "sf-corridor-world-objects.json", "sf-corridor-official.json"):
            wanted.append(base / other)
    return sorted({path.resolve() for path in wanted if path.exists()})


def main() -> None:
    wanted = fetched_files()
    keep = set()
    for path in wanted:
        result = cut(path)
        if result:
            keep.add((path.parent / "cells" / path.stem).resolve())
            print(f"{result['file']}: {result['cells']} cells, {result['lists']} lists, "
                  f"{result['bytes'] / 1e6:.1f} MB")
    # Cells of a file no page fetches any more: gone.
    for folder in DOCS.rglob("cells"):
        if not folder.is_dir():
            continue
        for stale in folder.iterdir():
            if stale.is_dir() and stale.resolve() not in keep:
                shutil.rmtree(stale)
        if not any(folder.iterdir()):
            folder.rmdir()


if __name__ == "__main__":
    main()
