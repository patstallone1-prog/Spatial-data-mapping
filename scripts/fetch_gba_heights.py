#!/usr/bin/env python3
"""Cut the GlobalBuildingAtlas's LoD1 heights down to the regions this project draws.

    python scripts/fetch_gba_heights.py            # every region in docs/regions.json

GlobalBuildingAtlas (Zhu et al. 2025, ESSD 17:6647; github.com/zhu-xlab/GlobalBuildingAtlas)
is a global LoD1 model: building polygons with a height each, estimated by a network from
PlanetScope images at 3 m. It is the height fill's last resort (smc.buildings.height_fill):
lidar-measured heights -- the region's own, City3D's, 3dfier's -- always come first. Its
reported height error is 1.5-8.9 m RMSE by continent.

It comes in two parts, under different licences:

  GBA.ODbLPolygon  the polygons taken from OpenStreetMap and Microsoft's footprints (ODbL),
                   in 5 x 5 degree GeoJSON tiles, EPSG:3857
  GBA.LoD1         the heights, a JSON object keyed by source + id + region, e.g.
                   "osm22916723USA" (CC BY-NC 4.0 -- non-commercial)

Every region here is inside one tile, w125_n40_w120_n35 (3.2 GB of polygons, 428 MB of
heights). Both are streamed and filtered, never stored whole: what is kept is every building
whose polygon touches a region's box (padded by PAD_M), with its height, its spread ("var")
and its polygon in lon/lat, gzipped under data/gba/ (gitignored).
"""

from __future__ import annotations

import argparse
import gzip
import json
import math
import sys
import time
from pathlib import Path

import urllib3

ROOT = Path(__file__).resolve().parents[1]
HF = "https://huggingface.co/datasets/zhu-xlab"
TILE = "w125_n40_w120_n35"
POLYGONS = f"{HF}/GBA.ODbLPolygon/resolve/main/northamerica/{TILE}.geojson"
HEIGHTS = f"{HF}/GBA.LoD1/resolve/main/LoD1/northamerica/{TILE}.json"
OUT = ROOT / "data" / "gba" / f"{TILE}-regions.json.gz"
SCHEMA = "kerbside.gba_lod1/1"
PAD_M = 150.0
R_EARTH = 6378137.0
LICENCE = {
    "heights": "CC BY-NC 4.0 (GBA.LoD1): non-commercial use only",
    "polygons": "ODbL 1.0 (GBA.ODbLPolygon: OpenStreetMap and Microsoft footprints)",
    "cite": "Zhu et al. 2025, GlobalBuildingAtlas, Earth System Science Data 17:6647",
}


def lonlat(x: float, y: float) -> tuple[float, float]:
    """EPSG:3857 metres to degrees."""
    return math.degrees(x / R_EARTH), math.degrees(2.0 * math.atan(math.exp(y / R_EARTH)) - math.pi / 2.0)


def region_boxes() -> list[tuple[float, float, float, float]]:
    """(west, south, east, north) of every region, padded."""
    regions = json.loads((ROOT / "docs" / "regions.json").read_text())["regions"]
    out = []
    for r in regions:
        s, w, n, e = r["bbox"]
        dy = PAD_M / 111_320.0
        dx = dy / math.cos(math.radians((s + n) / 2))
        out.append((w - dx, s - dy, e + dx, n + dy))
    return out


class Boxes:
    """A coarse grid over the region boxes: is a point in any of them?"""

    CELL = 0.02

    def __init__(self, boxes):
        self.grid: dict[tuple[int, int], list] = {}
        for b in boxes:
            for i in range(int(b[0] // self.CELL), int(b[2] // self.CELL) + 1):
                for j in range(int(b[1] // self.CELL), int(b[3] // self.CELL) + 1):
                    self.grid.setdefault((i, j), []).append(b)

    def has(self, lon: float, lat: float) -> bool:
        for b in self.grid.get((int(lon // self.CELL), int(lat // self.CELL)), ()):
            if b[0] <= lon <= b[2] and b[1] <= lat <= b[3]:
                return True
        return False


class Stream:
    """A file-like object over an HTTP body, for ijson, counting bytes as it goes."""

    def __init__(self, url: str):
        self.http = urllib3.PoolManager(retries=urllib3.Retry(total=5, backoff_factor=2))
        self.r = self.http.request("GET", url, preload_content=False, timeout=urllib3.Timeout(connect=30, read=300))
        if self.r.status != 200:
            raise RuntimeError(f"{url}: HTTP {self.r.status}")
        self.total = int(self.r.headers.get("Content-Length") or 0)
        self.done = 0
        self.t0 = self.last = time.time()
        self.name = url.rsplit("/", 1)[-1]

    def read(self, n: int = 1 << 20) -> bytes:
        b = self.r.read(n)
        self.done += len(b)
        if time.time() - self.last > 30:
            self.last = time.time()
            pct = 100 * self.done / self.total if self.total else 0
            print(f"  {self.name}: {self.done / 1e6:.0f} MB ({pct:.0f}%), {time.time() - self.t0:.0f} s", flush=True)
        return b


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--out", type=Path, default=OUT)
    args = ap.parse_args()
    boxes = Boxes(region_boxes())
    kept: dict[str, dict] = {}
    print(f"polygons: {POLYGONS}", flush=True)
    seen = 0
    import ijson  # only the fetch needs it (uv pip install ijson)

    for f in ijson.items(Stream(POLYGONS), "features.item", use_float=True):
        seen += 1
        ring = (f.get("geometry") or {}).get("coordinates", [[]])[0]
        if f["geometry"].get("type") == "MultiPolygon":
            ring = f["geometry"]["coordinates"][0][0]
        if len(ring) < 4:
            continue
        pts = [lonlat(x, y) for x, y in ring]
        if not any(boxes.has(lon, lat) for lon, lat in (pts[0], pts[len(pts) // 2])):
            continue
        p = f["properties"]
        key = f"{p.get('source', '')}{p.get('id', '')}{p.get('region', '')}"
        kept[key] = {"src": p.get("source"), "id": str(p.get("id")), "p": [[round(a, 7), round(b, 7)] for a, b in pts]}
    print(f"  {seen} polygons read, {len(kept)} inside the regions", flush=True)
    print(f"heights: {HEIGHTS}", flush=True)
    with_h = 0
    for key, v in ijson.kvitems(Stream(HEIGHTS), "", use_float=True):
        row = kept.get(key)
        if row is None or v.get("height") is None:
            continue
        row["h"] = round(float(v["height"]), 2)
        row["var"] = round(float(v.get("var") or 0), 2)
        with_h += 1
    rows = [dict(k=k, **v) for k, v in kept.items() if "h" in v]
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(args.out, "wt", encoding="utf-8") as fh:
        json.dump({"schema": SCHEMA, "tile": TILE, "licence": LICENCE, "pad_m": PAD_M,
                   "sources": {"polygons": POLYGONS, "heights": HEIGHTS},
                   "fetched": time.strftime("%Y-%m-%d"), "buildings": rows}, fh, separators=(",", ":"))
    print(f"{args.out.relative_to(ROOT)}: {len(rows)} buildings with a height ({with_h} matched), "
          f"{args.out.stat().st_size / 1e6:.1f} MB", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
