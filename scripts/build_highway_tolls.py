#!/usr/bin/env python3
"""Put the Bay's toll plazas and toll gantries on the map (smc.highways.tolls says what is drawn
and on what evidence), for the area every published region covers.

Read from a Geofabrik OpenStreetMap extract with pyosmium (Overpass does not answer this
machine). Written at the site's root, beside the freeway signs:

    highway-tolls.json             every toll gantry, booth and plaza canopy, with its area
    highway-toll-renderer.mjs      smc/highways/toll_renderer.mjs, which draws them

The page reads the file once and draws the records over its own area. Run again when
OpenStreetMap's tolls have changed.

    .venv/bin/python scripts/build_highway_tolls.py --pbf build/osm/norcal-latest.osm.pbf
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
from importlib.resources import files
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "scripts"))

from build_highway_signs import published_bbox  # noqa: E402

from smc.highways.tolls import ROADS, TollOsm, infer_tolls  # noqa: E402

DOCS = ROOT / "docs"
OUT = DOCS / "highway-tolls.json"
RENDERER = DOCS / "highway-toll-renderer.mjs"
#: Roads further than this from every toll are not read: they cannot orient one.
ROAD_REACH_DEG = 0.01


def from_pbf(path: Path, bbox) -> TollOsm:
    import osmium

    w, s, e, n = bbox
    inside = lambda lon, lat: w <= lon <= e and s <= lat <= n  # noqa: E731
    osm = TollOsm()
    roads: dict[int, dict] = {}
    booth_ways: dict[int, dict] = {}
    for obj in osmium.FileProcessor(str(path), osmium.osm.WAY):
        tags = dict(obj.tags)
        if tags.get("barrier") == "toll_booth":
            booth_ways[obj.id] = {"tags": tags, "nodes": [r.ref for r in obj.nodes]}
        elif tags.get("highway") in ROADS:
            roads[obj.id] = {"tags": tags, "nodes": [r.ref for r in obj.nodes]}
    wanted = {r for way in booth_ways.values() for r in way["nodes"]} | {r for way in roads.values() for r in way["nodes"]}
    for obj in osmium.FileProcessor(str(path), osmium.osm.NODE):
        tags = obj.tags
        gantry = tags.get("highway") == "toll_gantry"
        booth = tags.get("barrier") == "toll_booth"
        if obj.id not in wanted and not gantry and not booth:
            continue
        p = (obj.location.lon, obj.location.lat)
        if obj.id in wanted:
            osm.nodes[obj.id] = p
        if (gantry or booth) and inside(*p):
            (osm.gantries if gantry else osm.booths).append({"id": obj.id, "p": p, "tags": dict(tags)})
    for wid, way in booth_ways.items():
        pts = [osm.nodes[r] for r in way["nodes"] if r in osm.nodes]
        if pts and inside(*pts[0]):
            osm.booth_ways.append({"id": wid, "points": pts, "tags": way["tags"]})
    spots = [g["p"] for g in osm.gantries] + [b["p"] for b in osm.booths] + [bw["points"][0] for bw in osm.booth_ways]
    cell = lambda p: (int(p[0] // ROAD_REACH_DEG), int(p[1] // ROAD_REACH_DEG))  # noqa: E731
    near = {(cx + dx, cy + dy) for cx, cy in map(cell, spots) for dx in (-1, 0, 1) for dy in (-1, 0, 1)}
    for wid, way in roads.items():
        if any(r in osm.nodes and cell(osm.nodes[r]) in near for r in way["nodes"]):
            osm.roads[wid] = way
    return osm


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:16]


def publish(records: list[dict], bbox) -> dict:
    shutil.copyfile(str(files("smc.highways").joinpath("toll_renderer.mjs")), RENDERER)
    kinds: dict[str, int] = {}
    for r in records:
        kinds[r["kind"]] = kinds.get(r["kind"], 0) + 1
    body = {"schema": "kerbside.highway_tolls/1", "renderer_sha256": sha256(RENDERER),
            "source": "OpenStreetMap contributors (ODbL): highway=toll_gantry, barrier=toll_booth",
            "bbox": [round(v, 6) for v in bbox], "kinds": kinds, "tolls": records}
    OUT.write_text(json.dumps(body, separators=(",", ":")) + "\n")
    return body


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--pbf", type=Path, required=True, help="a Geofabrik .osm.pbf extract")
    args = parser.parse_args()
    bbox = published_bbox()
    records = infer_tolls(from_pbf(args.pbf, bbox))
    body = publish(records, bbox)
    print(json.dumps({"bbox": body["bbox"], "kinds": body["kinds"], "bytes": OUT.stat().st_size}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
