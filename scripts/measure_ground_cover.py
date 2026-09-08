#!/usr/bin/env python3
"""How much of the corridor's ground the model actually describes.

Stamps every drawn surface into a two-metre lattice and counts what is left over. The number
that comes out is the honest version of "there are black patches": the share of ground inside
the region with nothing on it at all.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from smc.ground.cover import Lattice  # noqa: E402

PAGE = ROOT / "docs" / "sf-corridor-3d.json"
GROUND = ROOT / "docs" / "sf-corridor-ground.json"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--page", type=Path, default=PAGE)
    ap.add_argument("--label", default="current")
    ap.add_argument("--no-ground", action="store_true",
                    help="measure as though parks and yards were not drawn")
    args = ap.parse_args()

    payload = json.loads(args.page.read_text())
    lattice = Lattice(payload["bbox"])
    by_layer: dict[str, int] = {}

    def note(name: str, cells: int) -> None:
        by_layer[name] = by_layer.get(name, 0) + cells

    for way in payload["ways"]:
        kind = way.get("kind")
        points = way.get("points")
        if not points:
            continue
        if kind == "building":
            note("buildings", lattice.stamp_polygon(points))
        elif kind == "water":
            note("water", lattice.stamp_polygon(points))
        elif kind == "park":
            note("parks", lattice.stamp_polygon(points))
        elif kind == "yard":
            note("yards", lattice.stamp_polygon(points))
        elif kind == "street":
            width = way.get("road_m") or 8.0
            note("carriageway", lattice.stamp_polyline(points, width))
            # The footways either side, where the model draws them.
            walk = way.get("walk_m") or way.get("walk_fallback_m") or 3.0
            sides = way.get("walk_sides")
            count = 2 if sides is None else len(sides)
            if count:
                note("footway", lattice.stamp_polyline(points, width + 2 * walk) if count == 2
                     else lattice.stamp_polyline(points, width + walk))
        elif kind in ("sidewalk", "path"):
            note("footway", lattice.stamp_polyline(points, 3.6))
        elif kind == "crossing":
            note("crossings", lattice.stamp_polyline(points, 3.7))

    # Parks and yards live in their own file beside the page, because thirty-three thousand
    # rings should not be in the payload the map waits on to draw a street.
    if not args.no_ground and GROUND.exists():
        ground = json.loads(GROUND.read_text())
        for park in ground.get("parks", []):
            note("parks", lattice.stamp_polygon(park["p"]))
        for yard in ground.get("yards", []):
            note("yards", lattice.stamp_polygon(yard["p"]))

    covered = int(lattice.grid.sum())
    total = lattice.total
    report = {
        "label": args.label,
        "cell_m": lattice.cell_m,
        "cells": total,
        "described_cells": covered,
        "described_share": round(covered / total, 4),
        "undefined_share": round(1 - covered / total, 4),
        "km2_total": round(total * lattice.cell_m ** 2 / 1e6, 2),
        "km2_undefined": round((total - covered) * lattice.cell_m ** 2 / 1e6, 2),
        "first_claim_by_layer": {k: v for k, v in sorted(by_layer.items(), key=lambda x: -x[1])},
    }
    print(json.dumps(report, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
