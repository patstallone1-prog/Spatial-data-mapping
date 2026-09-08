#!/usr/bin/env python3
"""Work out what is on the ground where the model currently draws nothing.

A third of this corridor has no surface on it at all. Some of that is parks, which San
Francisco maps; most of it is the ground between a house and its property line, which the city
also maps, as parcels. Neither needed inventing.

Five things come out of this:

  parks    the Recreation and Parks polygons plus OpenStreetMap's green space, which become
           grass -- the second of those is how Fort Mason gets drawn, since it is federal land
           and so appears in no San Francisco dataset
  yards    the parcels that still have bare ground in them once the building is drawn
  fences   the parcel boundaries that are actually fences: not the street frontage, not the
           ones running along a wall, and one per shared boundary rather than one each
  courts   the sports pitches, with the number of courts in each measured from the polygon
  trees    the street tree inventory, with the species and trunk diameter of each

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
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from smc.ground.courts import layout_courts, oriented_rect, resolve_sport  # noqa: E402
from smc.ground.cover import Lattice  # noqa: E402
from smc.ground.exclusion import RoadMask  # noqa: E402
from smc.official.crs import geojson_rings  # noqa: E402

PAGE = ROOT / "docs" / "sf-corridor-3d.json"
OUT = ROOT / "data" / "sf_public_works" / "ground_cover.json"
CACHE = ROOT / "build" / "ground_cover"
CORRIDOR = {"south": 37.786, "west": -122.4475, "north": 37.8095, "east": -122.392}

#: A parcel with less bare ground than this is already described by what stands on it.
MIN_YARD_CELLS = 12         # 48 square metres at the two-metre lattice
#: A sliver smaller than this gets left to the base ground plane. It is usually a survey
#: mismatch or a light well too small to read, and drawing it as a distinct thing creates noise.
MIN_SERVICE_YARD_CELLS = 4  # 16 square metres
#: Below this building-to-street setback, the space reads as paved frontage/stoop rather than
#: a lawn. It is intentionally forgiving so real front gardens survive.
MIN_FRONT_LAWN_DEPTH_M = 2.4
#: A large parcel remainder gets the fenced-backyard treatment. Smaller street-facing
#: remainders are front lawns or paved frontages.
MIN_BACKYARD_CELLS = 28     # 112 square metres
#: The garden fences San Francisco actually has, weighted the way the city is: mostly
#: redwood board, a good share of chainlink, some picket and the occasional low stucco wall.
#: One is chosen per block, so that a block's back fences match each other rather than forming a
#: patchwork no builder ever put up.
FENCE_KINDS = (
    ("board", 1.83), ("board", 1.83), ("board", 1.83), ("board", 1.83),
    ("board", 1.83), ("board", 1.83), ("board", 1.83), ("board", 1.83),
    ("board_tall", 2.13), ("board_tall", 2.13), ("board_tall", 2.13),
    ("picket", 1.07), ("picket", 1.07), ("picket", 1.07),
    ("chainlink", 1.52), ("chainlink", 1.52), ("chainlink", 1.52), ("chainlink", 1.52),
    ("wall", 1.22), ("wall", 1.22),
)

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


#: San Francisco's Recreation and Parks dataset is the definitive record of the parks San
#: Francisco owns, and only those. Fort Mason is the Golden Gate National Recreation Area, which
#: is federal, so it is not in the city's file and rendered as a hole -- the largest green space
#: in the corridor, missing because of who owns it. OpenStreetMap does not care who owns it.
OSM_GREEN = (
    'way["leisure"~"^(park|garden|recreation_ground|dog_park|golf_course|common)$"]',
    'relation["leisure"~"^(park|garden|recreation_ground|common)$"]',
    'way["landuse"~"^(grass|village_green|recreation_ground|forest|cemetery|meadow)$"]',
    'way["natural"~"^(wood|scrub|grassland|heath)$"]',
)
#: The courts and the fields. Every one of these is a real court somebody plays on; the count and
#: the bearing come out of the polygon rather than out of a guess.
OSM_PITCHES = (
    'way["leisure"="pitch"]',
    'way["leisure"="track"]["sport"]',
)

OVERPASS_MIRRORS = (
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.osm.ch/api/interpreter",
)


def fetch_overpass(selectors: tuple[str, ...], cache_name: str, progress) -> list[dict]:
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / f"{cache_name}.json"
    if path.exists():
        rows = json.loads(path.read_text())
        progress(f"{cache_name}: {len(rows)} elements from cache")
        return rows
    area = (f"{CORRIDOR['south']},{CORRIDOR['west']},"
            f"{CORRIDOR['north']},{CORRIDOR['east']}")
    body = "".join(f"{selector}({area});" for selector in selectors)
    query = f"[out:json][timeout:120];({body});out geom;"
    last: Exception | None = None
    for mirror in OVERPASS_MIRRORS:
        url = mirror + "?" + urllib.parse.urlencode({"data": query})
        request = urllib.request.Request(
            url, headers={"User-Agent": "Kerbside/0.1 ground cover"})
        try:
            with urllib.request.urlopen(request, timeout=240) as response:
                elements = json.loads(response.read().decode("utf-8")).get("elements", [])
            path.write_text(json.dumps(elements, separators=(",", ":")))
            progress(f"{cache_name}: {len(elements)} elements")
            return elements
        except Exception as exc:  # noqa: BLE001 - any failure means try the next mirror
            last = exc
            print(f"  overpass {mirror.split('/')[2]}: {exc}", file=sys.stderr)
    progress(f"{cache_name}: every Overpass mirror refused ({last}); continuing without it")
    return []


def osm_rings(element: dict) -> list[list]:
    """Closed rings from an Overpass element, ways and multipolygon relations alike."""
    geometry = element.get("geometry")
    if geometry:
        ring = [[p["lon"], p["lat"]] for p in geometry if "lon" in p and "lat" in p]
        return [ring] if len(ring) >= 4 else []
    rings = []
    for member in element.get("members") or []:
        if member.get("role") not in ("outer", "", None):
            continue
        geom = member.get("geometry") or []
        ring = [[p["lon"], p["lat"]] for p in geom if "lon" in p and "lat" in p]
        if len(ring) >= 4:
            rings.append(ring)
    return rings


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

    # The same flat local frame the viewer lays the world out in, so a bearing measured here is
    # the bearing drawn there. Over three kilometres of San Francisco the error in treating
    # latitude as flat is centimetres, and a court is squared to its own polygon either way.
    mid_lat = (bbox["south"] + bbox["north"]) / 2
    mid_lon = (bbox["west"] + bbox["east"]) / 2
    m_per_lat = 111_320.0
    m_per_lon = m_per_lat * math.cos(math.radians(mid_lat))

    def to_metres(lon: float, lat: float) -> tuple[float, float]:
        return (lon - mid_lon) * m_per_lon, (lat - mid_lat) * m_per_lat

    def to_lonlat(x: float, y: float) -> tuple[float, float]:
        return mid_lon + x / m_per_lon, mid_lat + y / m_per_lat

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
    progress(f"{len(parks)} park rings from Recreation and Parks")
    for park in parks:
        lattice.stamp_polygon(park["p"])

    # -- the parks the city does not own -------------------------------------------------------
    #
    # Anything still bare after the city's own parks are drawn. Fort Mason is the case that
    # forced this: it is the biggest green space in the corridor and it was a black rectangle,
    # because it belongs to the National Park Service and so appears in no San Francisco dataset.
    # The bare-ground test is what keeps this from double-drawing the parks already placed.
    osm_green = 0
    for element in fetch_overpass(OSM_GREEN, "osm_green", progress):
        name = (element.get("tags") or {}).get("name")
        for ring in osm_rings(element):
            if count_bare(lattice, ring) < MIN_YARD_CELLS * 4:
                continue
            if road.share_inside(ring) > 0.35:
                continue
            simplified = [[round(x, 6), round(y, 6)] for x, y in simplify(ring)]
            parks.append({"n": name, "p": simplified})
            lattice.stamp_polygon(simplified)
            osm_green += 1
    progress(f"{osm_green} further green rings from OpenStreetMap "
             f"({len(parks)} parks in total)")

    # -- courts and fields ---------------------------------------------------------------------
    courts, pitches = [], []
    by_sport: dict[str, int] = {}
    for element in fetch_overpass(OSM_PITCHES, "osm_pitches", progress):
        tags = element.get("tags") or {}
        sport = resolve_sport(tags.get("sport"))
        if sport is None:
            continue
        for ring in osm_rings(element):
            metric = [to_metres(lon, lat) for lon, lat in ring]
            rect = oriented_rect(metric)
            if rect is None:
                continue
            placed = layout_courts(sport, rect)
            if not placed:
                continue
            for kind, court in placed:
                lon, lat = to_lonlat(court.cx, court.cy)
                courts.append({"s": kind, "c": [round(lon, 6), round(lat, 6)],
                               # Bearing of the court's long axis, measured in the same local
                               # metric frame the renderer lays the world out in.
                               "a": round(court.angle, 5),
                               "l": round(court.length, 2), "w": round(court.width, 2)})
            pitches.append({"s": placed[0][0], "n": tags.get("name"),
                            "p": [[round(x, 6), round(y, 6)] for x, y in ring]})
            lattice.stamp_polygon(ring)
            for kind, _ in placed:
                by_sport[kind] = by_sport.get(kind, 0) + 1
    progress(f"{len(courts)} courts across {len(pitches)} pitches: "
             + ", ".join(f"{n} {s}" for s, n in sorted(by_sport.items())))

    street_band = Lattice(bbox, cell_m=1.0)
    footprints = Lattice(bbox, cell_m=1.0)
    for way in payload["ways"]:
        points = way.get("points")
        if not points:
            continue
        kind = way.get("kind")
        if kind == "street":
            width = way.get("road_m") or 8.0
            walk = way.get("walk_m") or way.get("walk_fallback_m") or 3.0
            street_band.stamp_polyline(points, width + 2 * walk)
        elif kind in ("sidewalk", "path", "crossing"):
            street_band.stamp_polyline(points, 3.6)
        elif kind == "building":
            footprints.stamp_polygon(points)

    def hit(grid: Lattice, x: float, y: float) -> bool:
        row, col = grid.to_cell(x, y)
        if 0 <= row < grid.height and 0 <= col < grid.width:
            return bool(grid.grid[row, col])
        return False

    def front_setback_depth(ring: list) -> float | None:
        """Smallest street-facing parcel edge to building distance, in metres."""
        metric = [to_metres(lon, lat) for lon, lat in ring]
        if len(metric) < 3:
            return None
        area = sum(metric[i][0] * metric[(i + 1) % len(metric)][1]
                   - metric[(i + 1) % len(metric)][0] * metric[i][1]
                   for i in range(len(metric)))
        turn = 1.0 if area > 0 else -1.0
        depths = []
        for i in range(len(ring) - 1):
            (ax, ay), (bx, by) = metric[i], metric[i + 1]
            span = math.hypot(bx - ax, by - ay)
            if span < 2.0:
                continue
            nx, ny = turn * (by - ay) / span, turn * -(bx - ax) / span
            samples = [(ax + (bx - ax) * t, ay + (by - ay) * t) for t in (0.33, 0.5, 0.67)]
            faces_street = sum(hit(street_band, x + nx * 1.0, y + ny * 1.0)
                               or hit(street_band, x + nx * 3.0, y + ny * 3.0)
                               or hit(street_band, x + nx * 5.0, y + ny * 5.0)
                               for x, y in samples) >= 2
            if not faces_street:
                continue
            for x, y in samples:
                for depth in (1.0, 1.5, 2.0, 2.5, 3.0, 4.0, 5.5, 7.0, 9.0, 12.0):
                    if hit(footprints, x - nx * depth, y - ny * depth):
                        depths.append(depth)
                        break
        return min(depths) if depths else None

    # -- yards ---------------------------------------------------------------------------------
    #
    # Every parcel, but only the ones that still have bare ground in them after everything else
    # is drawn. A parcel entirely under its own building adds nothing and would double the
    # payload for it.
    dropped_yards = 0
    parcel_rows = fetch("acdm-wktn", f"{box.replace('the_geom', 'shape')} AND active=true",
                        "mapblklot,shape", "parcels", progress)
    yards = []
    lawns = []
    front_walks = []
    service_yards = []
    backyards = []
    kept_rings: list[tuple[str, list]] = []
    # One row per lot, not one per unit. A condominium building is a row in this file for every
    # unit in it, and every one of those rows carries the same lot polygon -- 37,244 rows over
    # 14,920 lots. Left alone that drew one parcel forty times, and made every edge of it look
    # like a boundary the neighbour had already fenced.
    seen_lots: set[str] = set()
    for row in parcel_rows:
        lot = str(row.get("mapblklot") or "")
        if lot in seen_lots:
            continue
        seen_lots.add(lot)
        for ring in geojson_rings(row.get("shape") or {}):
            if len(ring) < 4:
                continue
            bare = count_bare(lattice, ring)
            if bare < MIN_SERVICE_YARD_CELLS:
                continue
            # A parcel ring that is mostly carriageway is not a garden. It is a parcel whose
            # boundary runs into the street, or one the road mask disagrees with, and either
            # way drawing it lays ground over the road.
            if road.share_inside(ring) > 0.35:
                dropped_yards += 1
                continue
            blklot = str(row.get("mapblklot") or "")
            simplified = [[round(x, 6), round(y, 6)] for x, y in simplify(ring)]
            item = {"id": blklot, "p": simplified}
            setback = front_setback_depth(ring)
            if setback is not None and setback < MIN_FRONT_LAWN_DEPTH_M:
                front_walks.append(item)
            elif bare < MIN_YARD_CELLS:
                service_yards.append(item)
            elif setback is not None and bare < MIN_BACKYARD_CELLS:
                lawns.append(item)
                yards.append(item)
            else:
                backyards.append(item)
                yards.append(item)
                # The fence is worked out from the surveyed ring, not the simplified one. Two
                # neighbours share a boundary to the inch in the city's file and to nothing at all
                # once each has been thinned independently, and a shared boundary that no longer
                # matches is a boundary that gets fenced twice.
                kept_rings.append((blklot, ring))
    progress(f"{len(yards)} grass parcel remainders, {len(front_walks)} shallow frontages, "
             f"{len(service_yards)} neutral slivers ({dropped_yards} dropped for lying in the road)")
    for yard in [*yards, *front_walks, *service_yards]:
        lattice.stamp_polygon(yard["p"])

    # -- fences ---------------------------------------------------------------------------------
    #
    # A property line is not a fence. Three quarters of one is: the part that faces the street is
    # open, the part that runs along a wall is the wall, and the part between two neighbours is
    # one fence rather than two. So each surveyed edge is classified before anything is drawn.
    #
    #   street facing   a point stepped out from the edge lands in the roadway or its footway
    #   along a wall    a building footprint sits against the edge, on either side of it
    #   shared          the neighbour's ring carries the same two endpoints, so it is already done
    #
    # The kind of fence is chosen per block rather than per lot. A block was laid out at one time
    # by one builder and its back fences match; picking per lot gives a patchwork nobody built.
    fences: dict[str, list[float]] = {}
    seen_edges: set[tuple] = set()
    counts = {"street": 0, "wall": 0, "shared": 0, "drawn": 0}
    for blklot, ring in kept_rings:
        kind, height = FENCE_KINDS[zlib.crc32(blklot[:4].encode()) % len(FENCE_KINDS)]
        metric = [to_metres(lon, lat) for lon, lat in ring]
        # Which way is out. The sign of the ring's area says whether its interior lies left or
        # right of the direction of travel, and the outward normal follows from that.
        area = sum(metric[i][0] * metric[(i + 1) % len(metric)][1]
                   - metric[(i + 1) % len(metric)][0] * metric[i][1]
                   for i in range(len(metric)))
        # Shoelace positive is counter-clockwise, and a counter-clockwise ring keeps its
        # interior on the left, so the outward normal is the right-hand one. Getting this
        # backwards points every probe into the lot instead of out of it, and the street test
        # then finds a street almost nowhere.
        turn = 1.0 if area > 0 else -1.0
        for i in range(len(ring) - 1):
            a, b = ring[i], ring[i + 1]
            key = tuple(sorted(((round(a[0], 6), round(a[1], 6)),
                                (round(b[0], 6), round(b[1], 6)))))
            if key in seen_edges:
                counts["shared"] += 1
                continue
            seen_edges.add(key)
            (ax, ay), (bx, by) = metric[i], metric[i + 1]
            span = math.hypot(bx - ax, by - ay)
            # A garden fence does not run further than a block face. Anything longer is an
            # institutional lot -- a pier, a school, a park boundary -- where the property line
            # is real but a redwood back fence along it is not. Sixty-two edges, and one of them
            # was four hundred metres of it.
            if span < 0.6 or span > 80.0:
                continue
            nx, ny = turn * (by - ay) / span, turn * -(bx - ax) / span
            samples = [(ax + (bx - ax) * t, ay + (by - ay) * t) for t in (0.25, 0.5, 0.75)]
            if sum(hit(street_band, x + nx * 1.0, y + ny * 1.0)
                   or hit(street_band, x + nx * 2.5, y + ny * 2.5) for x, y in samples) >= 2:
                counts["street"] += 1
                continue
            if sum(hit(footprints, x + nx * 0.8, y + ny * 0.8)
                   or hit(footprints, x - nx * 0.8, y - ny * 0.8) for x, y in samples) >= 2:
                counts["wall"] += 1
                continue
            fences.setdefault(kind, []).extend(
                (round(ax, 2), round(ay, 2), round(bx, 2), round(by, 2)))
            counts["drawn"] += 1
    progress(f"{counts['drawn']} fence runs on inner property lines "
             f"({counts['street']} street frontages, {counts['wall']} along a wall, "
             f"{counts['shared']} already fenced by the neighbour); "
             + ", ".join(f"{k} {len(v) // 4}" for k, v in sorted(fences.items())))

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

    OUT.write_text(json.dumps({"parks": parks, "yards": yards, "lawns": lawns,
                               "front_walks": front_walks, "service_yards": service_yards,
                               "backyards": backyards, "trees": trees,
                               "courts": courts, "pitches": pitches, "fences": fences},
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
    rows = np.arange(min_row, max_row + 1)
    cols = np.arange(min_col, max_col + 1)
    ys = lattice.origin[1] + (rows + 0.5) * lattice.cell_m
    xs = lattice.origin[0] + (cols + 0.5) * lattice.cell_m
    gx, gy = np.meshgrid(xs, ys)

    inside = np.zeros(gx.shape, dtype=bool)
    n = len(local)
    for i in range(n):
        x1, y1 = local[i]
        x2, y2 = local[(i + 1) % n]
        if y1 == y2:
            continue
        crosses = (y1 > gy) != (y2 > gy)
        with np.errstate(divide="ignore", invalid="ignore"):
            cut = x1 + (gy - y1) * (x2 - x1) / (y2 - y1)
        inside ^= crosses & (cut > gx)
    window = lattice.grid[min_row:max_row + 1, min_col:max_col + 1]
    return int((inside & ~window).sum())


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
