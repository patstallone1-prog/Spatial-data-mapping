#!/usr/bin/env python3
"""The visual tile tree over the Bay Area: one quadtree, coarse at the root, built from the
regions that have been built.

    python scripts/build_tiles.py

Rooted on the atlas's box (scripts/build_perimeter.py), which already reaches five miles past
every region and takes in the bridges. Every built region's payload is cut into the tiles it
touches at each depth and generalised to that depth's geometric error (smc.tiles), so a tile
is a complete picture of its square at its own error and refining replaces rather than adds.
The index names every tile, its error, its children and what each of its layers costs, so the
viewer knows the price of a child before it asks for it.

Written to docs/tiles/ and copied beside every built region's page, so each site is whole.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import time
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from smc.imagery.region import SF_CORRIDOR, load_regions  # noqa: E402
from smc.tiles.compile import assets_for, way_in_box  # noqa: E402
from smc.tiles.tree import (  # noqa: E402
    DEEPEST_BUILT,
    Frame,
    Tile,
    TileId,
    error_at,
    refine_distance_m,
    tile_box,
    tiles_covering,
)

#: The kinds worth carrying into the distance. Everything else -- the paint, the pads, the
#: points of interest -- is the street renderer's, and is never seen from far enough away for
#: a tile to be the thing drawing it.
CARRIED = ("building", "street", "cycleway", "beach", "water")


def site_of(name: str) -> Path:
    return ROOT / "docs" if name == SF_CORRIDOR.name else ROOT / "data" / "regions" / name / "site"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, default=ROOT / "docs" / "tiles")
    args = ap.parse_args()

    atlas_path = ROOT / "docs" / "sf-corridor-perimeter.json"
    if not atlas_path.exists():
        print("no atlas at docs/sf-corridor-perimeter.json; run scripts/build_perimeter.py first", file=sys.stderr)
        return 1
    atlas = json.loads(atlas_path.read_text())
    b = atlas["frame"]["bbox"]
    root = Frame(b["west"], b["south"], b["east"], b["north"]).squared()
    print(f"root {root.span_m / 1000:.1f} km square, depths 1..{DEEPEST_BUILT}", flush=True)

    regions = load_regions()
    built = {name: site_of(name) for name in regions if (site_of(name) / "sf-corridor-3d.json").exists()}
    if not built:
        print("no region has been built; nothing to tile", file=sys.stderr)
        return 1

    # The ways of every built region, gathered per tile. A coarse tile takes several regions;
    # a fine one takes part of one.
    per_tile: dict[TileId, list[dict]] = defaultdict(list)
    boxes: dict[str, list[float]] = {}
    for name, site in built.items():
        payload = json.loads((site / "sf-corridor-3d.json").read_text())
        ways = [w for w in payload.get("ways", []) if w.get("kind") in CARRIED and w.get("points")]
        box = payload.get("bbox") or {}
        boxes[name] = [box["west"], box["south"], box["east"], box["north"]]
        for depth in range(1, DEEPEST_BUILT + 1):
            for tile in tiles_covering(root, depth, box):
                square = tile_box(root, tile)
                per_tile[tile].extend(w for w in ways if way_in_box(w, square))
        print(f"  {name}: {len(ways)} ways carried", flush=True)

    # Compile each tile, then keep only the ones with something in them.
    tiles: dict[TileId, Tile] = {}
    out_dir = args.out
    if out_dir.exists():
        shutil.rmtree(out_dir)
    for tile_id in sorted(per_tile, key=lambda t: (t.depth, t.x, t.y)):
        square = tile_box(root, tile_id)
        assets = assets_for(per_tile[tile_id], square, tile_id.depth)
        if not assets:
            continue
        tile = Tile(id=tile_id, box=square)
        for layer, rows in assets.items():
            body = json.dumps(rows, separators=(",", ":"))
            path = out_dir / str(tile_id.depth) / str(tile_id.x) / str(tile_id.y) / f"{layer}.json"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(body)
            tile.assets[layer] = {"bytes": len(body), "rows": len(rows),
                                  "url": f"{tile_id.depth}/{tile_id.x}/{tile_id.y}/{layer}.json"}
        tiles[tile_id] = tile

    # The root exists whatever is under it: it is the Bay Area, and the atlas draws it.
    root_id = TileId(0, 0, 0)
    tiles.setdefault(root_id, Tile(id=root_id, box=tile_box(root, root_id)))
    # Children, and the parents that have to exist for a child to be reachable.
    for tile_id in sorted(tiles, key=lambda t: -t.depth):
        parent = tile_id.parent
        while parent is not None and parent not in tiles:
            tiles[parent] = Tile(id=parent, box=tile_box(root, parent))
            parent = parent.parent
    for tile_id, tile in tiles.items():
        tile.children = [c for c in tile_id.children if c in tiles]

    index = {
        "source": (f"Kerbside visual tile tree, {time.strftime('%Y-%m-%d')}: the built regions' own "
                   f"geometry, generalised per depth. Nothing here is measured that was not measured "
                   f"in the region it came from."),
        "note": ("A quadtree over the Bay Area. Each tile is a complete picture of its square at its "
                 "own geometric error, so showing a tile's children hides the tile. The viewer refines "
                 "by screen error, never by zoom: error * focal / distance, in pixels. Depth 0 is the "
                 "atlas (land, water, bridges), which every page already holds; inside a built region "
                 "the page's own street renderer draws everything from the kerbs in."),
        "root": root.to_json(),
        "max_depth": DEEPEST_BUILT,
        "regions": boxes,
        "error_at_depth": {str(d): round(error_at(d), 4) for d in range(DEEPEST_BUILT + 1)},
        "shown_from_m": {str(d): round(refine_distance_m(d, 3.0, 900, 50)) for d in range(DEEPEST_BUILT + 1)},
        "tiles": [tiles[t].to_json() for t in sorted(tiles, key=lambda t: (t.depth, t.x, t.y))],
    }
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "index.json").write_text(json.dumps(index, separators=(",", ":")))

    total = sum(t.bytes for t in tiles.values())
    by_depth: dict[int, list[int]] = defaultdict(list)
    for tile in tiles.values():
        by_depth[tile.id.depth].append(tile.bytes)
    for depth in sorted(by_depth):
        sizes = by_depth[depth]
        print(f"  depth {depth}: {len(sizes):4d} tiles, {sum(sizes) / 1e6:6.2f} MB, "
              f"largest {max(sizes) / 1e3:6.0f} kB, error {error_at(depth):5.2f} m, "
              f"shown from {refine_distance_m(depth, 3.0, 900, 50):.0f} m out")
    print(f"{len(tiles)} tiles, {total / 1e6:.2f} MB -> {out_dir.relative_to(ROOT)} "
          f"(index {(out_dir / 'index.json').stat().st_size / 1e3:.0f} kB)")

    # One tree a site, not one a page: every region's page reaches up to the site root for it
    # (TILE_BASE). Copied beside each region it was 15 MB times eight, and the same bytes.
    for site in built.values():
        stale = site / "tiles"
        if stale.exists() and stale != out_dir:
            shutil.rmtree(stale)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
