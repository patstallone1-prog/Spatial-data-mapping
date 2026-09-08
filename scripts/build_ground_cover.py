#!/usr/bin/env python3
"""Work out what is on the ground where the model currently draws nothing.

A third of this corridor has no surface on it at all. Some of that is parks, which San
Francisco maps; most of it is the ground between a house and its property line, which the city
also maps, as parcels. Neither needed inventing.

Three things come out of this:

  parks   the Recreation and Parks polygons, which become grass
  yards   the parcels that still have bare ground in them once the building is drawn, which
          become garden with a fence along the boundaries that do not face a street
  trees   the street tree inventory, with the species and trunk diameter of each

The trees are the part that would otherwise have been invented. Scattering five procedural
variants at random would have looked like a city; twenty-seven thousand real positions with a
species and a trunk diameter each is the city, and it costs one query.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from smc.ground.cover import Lattice  # noqa: E402
from smc.ground.exclusion import RoadMask  # noqa: E402
from smc.official.crs import geojson_rings  # noqa: E402

PAGE = ROOT / "docs" / "sf-corridor-3d.json"
OUT = ROOT / "data" / "sf_public_works" / "ground_cover.json"
CACHE = ROOT / "build" / "ground_cover"
CORRIDOR = {"south": 37.786, "west": -122.4475, "north": 37.8095, "east": -122.392}

#: A parcel with less bare ground than this is already described by what stands on it.
MIN_YARD_CELLS = 12         # 48 square metres at the two-metre lattice
#: Ring simplification, in metres. Parcel boundaries are surveyed to the inch and nothing here
#: needs that; without it the payload carries forty thousand rings at full precision.
SIMPLIFY_M = 1.2


def fetch(dataset: str, where: str, columns: str, cache_name: str,
          progress) -> list[dict]:
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / f"{cache_name}.json"
    if path.exists():
        rows = json.loads(path.read_text())
        progress(f"{cache_name}: {len(rows)} rows from cache")
        return rows
    rows: list[dict] = []
    while True:
        params = {"$limit": 50000, "$offset": len(rows), "$where": where, "$select": columns}
        url = f"https://data.sfgov.org/resource/{dataset}.json?{urllib.parse.urlencode(params)}"
        request = urllib.request.Request(url, headers={"User-Agent": "kerbside/ground"})
        page = json.loads(urllib.request.urlopen(request, timeout=180).read())
        rows.extend(page)
        progress(f"{cache_name}: {len(rows)} rows")
        if len(page) < 50000:
            break
    path.write_text(json.dumps(rows, separators=(",", ":")))
    return rows


def simplify(ring: list, tolerance_m: float = SIMPLIFY_M) -> list:
    """Douglas-Peucker on a lon/lat ring, with the tolerance given in metres."""
    if len(ring) < 4:
        return ring
    scale_lon = 88_000.0
    scale_lat = 111_320.0
    keep = [False] * len(ring)
    keep[0] = keep[-1] = True
    stack = [(0, len(ring) - 1)]
    while stack:
        first, last = stack.pop()
        if last <= first + 1:
            continue
        ax, ay = ring[first][0] * scale_lon, ring[first][1] * scale_lat
        bx, by = ring[last][0] * scale_lon, ring[last][1] * scale_lat
        dx, dy = bx - ax, by - ay
        span = math.hypot(dx, dy)
        worst, worst_i = 0.0, -1
        for i in range(first + 1, last):
            px, py = ring[i][0] * scale_lon, ring[i][1] * scale_lat
            distance = (math.hypot(px - ax, py - ay) if span < 1e-9
                        else abs(dy * (px - ax) - dx * (py - ay)) / span)
            if distance > worst:
                worst, worst_i = distance, i
        if worst > tolerance_m and worst_i > 0:
            keep[worst_i] = True
            stack.append((first, worst_i))
            stack.append((worst_i, last))
    return [p for p, k in zip(ring, keep) if k]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--page", type=Path, default=PAGE)
    args = ap.parse_args()

    def progress(message: str) -> None:
        print(message, flush=True)

    payload = json.loads(args.page.read_text())
    bbox = payload["bbox"]

    # -- what is already described ------------------------------------------------------------
    lattice = Lattice(bbox)
    for way in payload["ways"]:
        points = way.get("points")
        if not points:
            continue
        kind = way.get("kind")
        if kind in ("building", "water"):
            lattice.stamp_polygon(points)
        elif kind == "street":
            width = way.get("road_m") or 8.0
            walk = way.get("walk_m") or way.get("walk_fallback_m") or 3.0
            lattice.stamp_polyline(points, width + 2 * walk)
        elif kind in ("sidewalk", "path"):
            lattice.stamp_polyline(points, 3.6)
    progress(f"described before ground cover: {lattice.grid.mean():.1%}")

    # One authority on where the roadway is. Everything below is tested against it before it is
    # written, so the file that ships cannot contain a tree in the carriageway or a garden over
    # the tarmac -- which is a different thing from the renderer refusing to draw one.
    road = RoadMask(payload["ways"], bbox)
    progress(f"road mask: {road.grid.mean():.1%} of the corridor is carriageway")

    box = (f"within_box(the_geom, {CORRIDOR['north']}, {CORRIDOR['west']}, "
           f"{CORRIDOR['south']}, {CORRIDOR['east']})")

    # -- parks ---------------------------------------------------------------------------------
    park_rows = fetch("3nje-yn2u", box, "map_park_n,the_geom,acres", "parks", progress)
    parks = []
    for row in park_rows:
        for ring in geojson_rings(row.get("the_geom") or {}):
            if len(ring) >= 4:
                parks.append({"n": row.get("map_park_n"),
                              "p": [[round(x, 6), round(y, 6)] for x, y in simplify(ring)]})
    progress(f"{len(parks)} park rings")
    for park in parks:
        lattice.stamp_polygon(park["p"])

    # -- yards ---------------------------------------------------------------------------------
    #
    # Every parcel, but only the ones that still have bare ground in them after everything else
    # is drawn. A parcel entirely under its own building adds nothing and would double the
    # payload for it.
    dropped_yards = 0
    parcel_rows = fetch("acdm-wktn", f"{box.replace('the_geom', 'shape')} AND active=true",
                        "mapblklot,shape", "parcels", progress)
    yards = []
    for row in parcel_rows:
        for ring in geojson_rings(row.get("shape") or {}):
            if len(ring) < 4:
                continue
            bare = count_bare(lattice, ring)
            if bare < MIN_YARD_CELLS:
                continue
            # A parcel ring that is mostly carriageway is not a garden. It is a parcel whose
            # boundary runs into the street, or one the road mask disagrees with, and either
            # way drawing it lays ground over the road.
            if road.share_inside(ring) > 0.35:
                dropped_yards += 1
                continue
            yards.append({"id": row.get("mapblklot"),
                          "p": [[round(x, 6), round(y, 6)] for x, y in simplify(ring)]})
    progress(f"{len(yards)} parcels with bare ground worth drawing "
             f"({dropped_yards} dropped for lying in the road)")
    for yard in yards:
        lattice.stamp_polygon(yard["p"])

    # -- trees ---------------------------------------------------------------------------------
    dropped_trees = moved_trees = 0
    tree_rows = fetch(
        "tkzw-k3nq",
        f"latitude between {CORRIDOR['south']} and {CORRIDOR['north']} "
        f"AND longitude between {CORRIDOR['west']} and {CORRIDOR['east']}",
        "treeid,qspecies,dbh,latitude,longitude,planttype", "trees", progress)
    trees = []
    for row in tree_rows:
        try:
            lon, lat = float(row["longitude"]), float(row["latitude"])
        except (KeyError, TypeError, ValueError):
            continue
        species = str(row.get("qspecies") or "")
        try:
            dbh = float(row.get("dbh") or 0)
        except (TypeError, ValueError):
            dbh = 0.0
        # A street tree stands in the footway. Where the recorded position lands in the
        # carriageway it is the width that is wrong rather than the tree, so it is pushed to
        # the nearest ground that is not road -- and dropped only when the nearest such ground
        # is further away than a placement error can explain.
        placed = road.clear_of_road(lon, lat)
        if placed is None:
            dropped_trees += 1
            continue
        if placed != (lon, lat):
            moved_trees += 1
        lon, lat = placed
        trees.append({"p": [round(lon, 6), round(lat, 6)],
                      "v": species_variant(species),
                      # Trunk diameter in inches drives the canopy: a 3 inch stem is a sapling
                      # and a 30 inch one is a street tree with a crown over the roadway.
                      "d": round(min(48.0, max(1.0, dbh)), 1)})
    progress(f"{len(trees)} street trees ({moved_trees} nudged clear of the roadway, "
             f"{dropped_trees} dropped)")

    OUT.write_text(json.dumps({"parks": parks, "yards": yards, "trees": trees},
                              separators=(",", ":")))
    progress(f"wrote {OUT.name}: described after ground cover {lattice.grid.mean():.1%}")
    return 0


def count_bare(lattice: Lattice, ring: list) -> int:
    """Cells inside a ring that nothing has claimed yet."""
    import numpy as np

    local = np.array([lattice.to_xy(lon, lat) for lon, lat in ring])
    min_row, min_col = lattice.to_cell(local[:, 0].min(), local[:, 1].min())
    max_row, max_col = lattice.to_cell(local[:, 0].max(), local[:, 1].max())
    min_row = max(0, min_row); min_col = max(0, min_col)
    max_row = min(lattice.height - 1, max_row + 1)
    max_col = min(lattice.width - 1, max_col + 1)
    if max_row < min_row or max_col < min_col:
        return 0
    window = lattice.grid[min_row:max_row + 1, min_col:max_col + 1]
    return int((~window).sum())


#: Five kinds of tree, because five shapes is enough to stop a street looking cloned and San
#: Francisco's inventory is dominated by a handful of genera anyway.
SPECIES_VARIANTS = (
    ("palm", ("palm", "phoenix", "washingtonia", "syagrus", "butia")),
    ("conifer", ("pine", "cypress", "sequoia", "cedar", "podocarpus", "araucaria")),
    ("columnar", ("ficus", "populus", "eucalyptus", "melaleuca", "callistemon")),
    ("broad", ("platanus", "quercus", "ulmus", "acer", "tilia", "magnolia", "ginkgo")),
)


def species_variant(species: str) -> str:
    name = species.lower()
    for variant, needles in SPECIES_VARIANTS:
        if any(needle in name for needle in needles):
            return variant
    return "street"


if __name__ == "__main__":
    raise SystemExit(main())
