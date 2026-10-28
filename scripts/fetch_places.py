#!/usr/bin/env python3
"""Every store, restaurant and business in the Bay Area: its name, what kind it is, and where.

The source is Overture Maps' places theme -- Meta, Microsoft and Foursquare's place data with
AllThePlaces' brand-store scrapes, conflated and released monthly on a public bucket under
CDLA-Permissive-2.0 (each row names its own sources and their licences). It is the broadest
open set there is: names, a category taxonomy, a brand with its Wikidata id, an address, phone
and website, whether the place is still open, and a confidence. Google Places is better still
but may not be kept; this may be kept, which is the point.

What this writes (``data/places/``, private; nothing reaches the site):

* ``overture-<release>-bay-area.parquet`` -- every place in the box, the fields above, as
  Overture published them.
* ``<region>.json`` -- for each built region, the places inside it, each tied to the building
  whose footprint holds it (or the nearest within 15 m) and checked against OpenStreetMap's own
  shop/amenity/office/craft/tourism points: a place OSM also names within 40 m is
  ``corroborated``. ``reliable`` is open, confident (>= 0.6) or corroborated, and has a name.

    python scripts/fetch_places.py                 # newest release, every built region
    python scripts/fetch_places.py --region sf-corridor --skip-download
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "places"
BUCKET = "https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com"
#: The nine Bay Area counties and a margin: west, south, east, north.
BAY_AREA = (-123.65, 36.85, -121.20, 38.87)
SCHEMA = "kerbside.places/1"
OVERPASS = ("https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter")
GENERIC = {"the", "and", "of", "inc", "llc", "co", "company", "store", "shop", "cafe", "restaurant",
           "bar", "san", "francisco", "sf", "&"}


def latest_release() -> str:
    """The newest folder under release/ in Overture's public bucket."""
    query = urllib.parse.urlencode({"list-type": 2, "prefix": "release/", "delimiter": "/"})
    with urllib.request.urlopen(f"{BUCKET}/?{query}", timeout=60) as response:
        text = response.read().decode()
    releases = sorted(re.findall(r"<Prefix>release/(\d{4}-\d{2}-\d{2}\.\d+)/</Prefix>", text))
    if not releases:
        raise RuntimeError("no Overture release listed")
    return releases[-1]


def download(release: str, target: Path) -> int:
    import duckdb

    west, south, east, north = BAY_AREA
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial; SET s3_region='us-west-2';")
    tmp = target.with_suffix(".part")
    con.execute(f"""
        COPY (
          SELECT id,
                 names."primary" AS name,
                 basic_category,
                 taxonomy."primary" AS category,
                 taxonomy.hierarchy AS category_path,
                 taxonomy.alternates AS category_alternates,
                 confidence,
                 operating_status,
                 brand.names."primary" AS brand,
                 brand.wikidata AS brand_wikidata,
                 websites, phones, socials,
                 addresses[1].freeform AS address,
                 addresses[1].locality AS locality,
                 addresses[1].postcode AS postcode,
                 list_distinct(list_transform(sources, s -> s.dataset)) AS datasets,
                 list_distinct(list_transform(sources, s -> s.license)) AS licenses,
                 list_max(list_transform(sources, s -> s.update_time)) AS updated,
                 ST_X(geometry) AS lon, ST_Y(geometry) AS lat
          FROM read_parquet('s3://overturemaps-us-west-2/release/{release}/theme=places/type=place/*',
                            hive_partitioning=1)
          WHERE bbox.xmin <= {east} AND bbox.xmax >= {west} AND bbox.ymin <= {north} AND bbox.ymax >= {south}
        ) TO '{tmp}' (FORMAT parquet, COMPRESSION zstd)
    """)
    tmp.replace(target)
    return con.execute(f"SELECT count(*) FROM read_parquet('{target}')").fetchone()[0]


def tokens(name: str | None) -> set[str]:
    if not name:
        return set()
    text = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    text = text.replace("'s", "s").replace("&", " and ")
    return {t for t in re.findall(r"[a-z0-9]+", text) if t not in GENERIC and len(t) > 1}


def same_name(a: str | None, b: str | None) -> bool:
    ta, tb = tokens(a), tokens(b)
    if not ta or not tb:
        return False
    return len(ta & tb) / min(len(ta), len(tb)) >= 0.6


def osm_points(bbox: dict[str, float]) -> list[dict[str, Any]]:
    """OpenStreetMap's named businesses in the box, as points (a way by its centre)."""
    area = f"{bbox['south']},{bbox['west']},{bbox['north']},{bbox['east']}"
    q = (f"[out:json][timeout:180];(nwr[\"name\"][\"shop\"]({area});nwr[\"name\"][\"amenity\"]({area});"
         f"nwr[\"name\"][\"office\"]({area});nwr[\"name\"][\"craft\"]({area});nwr[\"name\"][\"tourism\"]({area});"
         f"nwr[\"name\"][\"leisure\"=\"fitness_centre\"]({area}););out center tags;")
    body = urllib.parse.urlencode({"data": q}).encode()
    last: Exception | None = None
    for attempt in range(3):
        for url in OVERPASS:
            try:
                request = urllib.request.Request(url, data=body, headers={"User-Agent": "Kerbside/0.1 places check"})
                with urllib.request.urlopen(request, timeout=240) as response:
                    elements = json.loads(response.read())["elements"]
                out = []
                for e in elements:
                    lon, lat = (e.get("lon"), e.get("lat")) if e["type"] == "node" else (
                        e.get("center", {}).get("lon"), e.get("center", {}).get("lat"))
                    if lon is None:
                        continue
                    tags = e.get("tags", {})
                    kind = next((f"{k}={tags[k]}" for k in ("shop", "amenity", "office", "craft", "tourism", "leisure") if k in tags), "")
                    out.append({"id": f"{e['type']}/{e['id']}", "name": tags.get("name"), "kind": kind, "lon": lon, "lat": lat})
                return out
            except Exception as error:  # noqa: BLE001 -- the next mirror is the handling
                last = error
        time.sleep(20 * (attempt + 1))
    raise RuntimeError(f"Overpass refused: {last}")


class Grid:
    """Points or footprints bucketed by ~50 m cells, for near lookups."""

    def __init__(self, lat0: float, cell_m: float = 50):
        self.kx, self.ky = 111_320 * math.cos(math.radians(lat0)), 110_540
        self.cell = cell_m
        self.cells: dict[tuple[int, int], list[Any]] = defaultdict(list)

    def key(self, lon: float, lat: float) -> tuple[int, int]:
        return int(lon * self.kx // self.cell), int(lat * self.ky // self.cell)

    def add(self, lon: float, lat: float, item: Any) -> None:
        self.cells[self.key(lon, lat)].append(item)

    def near(self, lon: float, lat: float, reach: int = 1):
        cx, cy = self.key(lon, lat)
        for dx in range(-reach, reach + 1):
            for dy in range(-reach, reach + 1):
                yield from self.cells.get((cx + dx, cy + dy), ())

    def metres(self, a: tuple[float, float], b: tuple[float, float]) -> float:
        return math.hypot((a[0] - b[0]) * self.kx, (a[1] - b[1]) * self.ky)


def contains(polygon: list[list[float]], lon: float, lat: float) -> bool:
    inside = False
    for (x1, y1), (x2, y2) in zip(polygon, polygon[1:]):
        if (y1 > lat) != (y2 > lat) and lon < (x2 - x1) * (lat - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


def edge_distance(grid: Grid, polygon: list[list[float]], lon: float, lat: float) -> float:
    best = math.inf
    px, py = lon * grid.kx, lat * grid.ky
    for (x1, y1), (x2, y2) in zip(polygon, polygon[1:]):
        ax, ay, bx, by = x1 * grid.kx, y1 * grid.ky, x2 * grid.kx, y2 * grid.ky
        dx, dy = bx - ax, by - ay
        t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy or 1)))
        best = min(best, math.hypot(px - ax - t * dx, py - ay - t * dy))
    return best


def region_places(parquet: Path, region: str, payload: dict[str, Any], osm: list[dict[str, Any]],
                  release: str) -> dict[str, Any]:
    import duckdb

    bbox = payload["bbox"]
    cursor = duckdb.connect().execute(
        f"SELECT * FROM read_parquet('{parquet}') WHERE lon BETWEEN ? AND ? AND lat BETWEEN ? AND ?",
        [bbox["west"], bbox["east"], bbox["south"], bbox["north"]])
    columns = [c[0] for c in cursor.description]
    rows = [dict(zip(columns, row)) for row in cursor.fetchall()]
    grid = Grid((bbox["south"] + bbox["north"]) / 2)
    pad_lon, pad_lat = 15 / grid.kx, 15 / grid.ky
    for way in payload["ways"]:
        if way.get("kind") == "building" and len(way.get("points") or []) >= 4:
            xs, ys = [p[0] for p in way["points"]], [p[1] for p in way["points"]]
            # Its box, and the box 15 m out: nothing outside that is near enough to test.
            box = (min(xs), min(ys), max(xs), max(ys))
            grid.add(sum(xs) / len(xs), sum(ys) / len(ys),
                     (way, box, (box[0] - pad_lon, box[1] - pad_lat, box[2] + pad_lon, box[3] + pad_lat)))
    osm_grid = Grid((bbox["south"] + bbox["north"]) / 2)
    for point in osm:
        osm_grid.add(point["lon"], point["lat"], point)
    places = []
    counts: dict[str, int] = defaultdict(int)
    for row in rows:
        lon, lat = float(row["lon"]), float(row["lat"])
        building, gap = None, math.inf
        for way, box, near in grid.near(lon, lat, reach=3):
            if not (near[0] <= lon <= near[2] and near[1] <= lat <= near[3]):
                continue
            if box[0] <= lon <= box[2] and box[1] <= lat <= box[3] and contains(way["points"], lon, lat):
                building, gap = way, 0.0
                break
            d = edge_distance(grid, way["points"], lon, lat)
            if d < gap and d <= 15:
                building, gap = way, d
        match = next((p for p in osm_grid.near(lon, lat)
                      if grid.metres((lon, lat), (p["lon"], p["lat"])) <= 40 and same_name(row["name"], p["name"])), None)
        status = row.get("operating_status") or "unknown"
        confidence = float(row["confidence"]) if row.get("confidence") is not None else 0.0
        reliable = bool(row.get("name")) and status in ("open", "unknown") and (confidence >= 0.6 or match is not None)
        place = {
            "id": row["id"], "name": row.get("name"), "basic_category": row.get("basic_category"),
            "category": row.get("category"), "category_path": list(row.get("category_path") or []),
            "brand": row.get("brand"), "brand_wikidata": row.get("brand_wikidata"),
            "confidence": round(confidence, 3), "operating_status": status,
            "address": row.get("address"), "postcode": row.get("postcode"),
            "website": (list(row.get("websites") or []) or [None])[0], "phone": (list(row.get("phones") or []) or [None])[0],
            "datasets": list(row.get("datasets") or []), "updated": row.get("updated"),
            "lon": round(lon, 7), "lat": round(lat, 7),
            "building_osm_id": building.get("osm_id") if building else None,
            "building_fit": None if building is None else ("inside" if gap == 0 else f"{gap:.1f} m"),
            "osm": {"id": match["id"], "name": match["name"], "kind": match["kind"]} if match else None,
            "corroborated": match is not None, "reliable": reliable,
        }
        places.append(place)
        counts["places"] += 1
        counts["reliable"] += reliable
        counts["corroborated"] += match is not None
        counts["in_a_building"] += building is not None
        counts["closed"] += status not in ("open", "unknown")
    return {"schema": SCHEMA, "region": region, "bbox": bbox,
            "source": f"Overture Maps places {release} (CDLA-Permissive-2.0; per-row datasets)",
            "checked_against": "OpenStreetMap named shop/amenity/office/craft/tourism points (ODbL)",
            "built": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "counts": dict(counts), "places": places}


def regions() -> list[tuple[str, Path]]:
    found = [("sf-corridor", ROOT / "docs/sf-corridor-3d.json")]
    found += [(p.parent.name, p) for p in sorted((ROOT / "docs/regions").glob("*/sf-corridor-3d.json"))]
    return [(name, path) for name, path in found if path.exists()]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--release", help="an Overture release; default the newest")
    parser.add_argument("--region", action="append", help="default every built region")
    parser.add_argument("--skip-download", action="store_true", help="reuse the newest parquet already here")
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    if args.skip_download:
        parquet = sorted(OUT.glob("overture-*-bay-area.parquet"))[-1]
        release = parquet.name.split("-bay-area")[0].removeprefix("overture-")
    else:
        release = args.release or latest_release()
        parquet = OUT / f"overture-{release}-bay-area.parquet"
        if not parquet.exists():
            print(f"Overture {release}: {download(release, parquet)} places in the Bay Area", file=sys.stderr)
    wanted = set(args.region or [])
    for name, path in regions():
        if wanted and name not in wanted:
            continue
        payload = json.loads(path.read_text())
        result = region_places(parquet, name, payload, osm_points(payload["bbox"]), release)
        (OUT / f"{name}.json").write_text(json.dumps(result, separators=(",", ":"), default=str))
        print(name, result["counts"], file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
