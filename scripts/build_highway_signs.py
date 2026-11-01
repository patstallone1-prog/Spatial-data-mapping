#!/usr/bin/env python3
"""Put the freeways' guide signs on the map: every exit's signs and the route markers after each
entrance, for the area every published region covers (smc.highways.signs says what is drawn and
on what evidence).

The freeways come from OpenStreetMap: its exit nodes, ramps and their destination tags, and sign
gantries. Overpass by default; or a Geofabrik extract (``--pbf``), read with pyosmium, where
Overpass will not answer this machine. The signs are written as the frontage fits and storefronts
are, at the site's root:

    highway-signs.manifest.json    each tile of signs by its area, with its hash
    highway-signs/<tile>.json      the signs over a 0.1 degree square
    highway-sign-renderer.mjs      smc/highways/renderer.mjs, which draws them

The page reads the manifest and only the tiles over its own area. Nothing a world payload holds
is touched. Run again when OpenStreetMap's freeways have changed.

    .venv/bin/python scripts/build_highway_signs.py
    .venv/bin/python scripts/build_highway_signs.py --pbf build/osm/norcal-latest.osm.pbf
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import shutil
import sys
import urllib.parse
import urllib.request
from importlib.resources import files
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from smc.highways.signs import LINKS, MAINLINE, Osm, from_overpass, infer_signs  # noqa: E402
from smc.net import use_certifi  # noqa: E402

DOCS = ROOT / "docs"
MANIFEST = DOCS / "highway-signs.manifest.json"
TILES = DOCS / "highway-signs"
RENDERER = DOCS / "highway-sign-renderer.mjs"
TILE_DEG = 0.1
#: The area round the regions: an exit's half-mile sign stands outside the region it serves.
PAD_DEG = 0.02
OVERPASS = ("https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter")
USER_AGENT = "Kerbside highway signs (https://spatial-data-mapping.vercel.app)"


def published_bbox() -> tuple[float, float, float, float]:
    """West, south, east, north round every region the site publishes (app-regions.json boxes
    are south, west, north, east)."""
    regions = json.loads((DOCS / "app-regions.json").read_text())
    regions = regions["regions"] if isinstance(regions, dict) else regions
    boxes = [r["bbox"] for r in regions if r.get("bbox")]
    return (min(b[1] for b in boxes) - PAD_DEG, min(b[0] for b in boxes) - PAD_DEG,
            max(b[3] for b in boxes) + PAD_DEG, max(b[2] for b in boxes) + PAD_DEG)


def from_overpass_api(bbox) -> Osm:
    w, s, e, n = bbox
    area = f"{s},{w},{n},{e}"
    query = (f'[out:json][timeout:900];(way["highway"~"^({"|".join(sorted(MAINLINE | LINKS))})$"]({area});'
             f'node["highway"="motorway_junction"]({area});node["man_made"="gantry"]({area});'
             f'way["man_made"="gantry"]({area}););out body geom;')
    last = None
    for mirror in OVERPASS:
        try:
            request = urllib.request.Request(mirror, data=urllib.parse.urlencode({"data": query}).encode(),
                                             headers={"User-Agent": USER_AGENT})
            answer = json.loads(urllib.request.urlopen(request, timeout=960).read())
            return from_overpass(answer.get("elements") or [])
        except Exception as exc:                     # the next mirror
            last = exc
            print(f"{mirror}: {exc}", file=sys.stderr)
    raise SystemExit(f"no Overpass mirror answered ({last}); pass --pbf with a Geofabrik extract")


def from_pbf(path: Path, bbox) -> Osm:
    """The same network from an extract: two passes, the ways first and then only their nodes."""
    import osmium

    w, s, e, n = bbox
    osm = Osm()
    wanted: set[int] = set()
    for obj in osmium.FileProcessor(str(path), osmium.osm.WAY):
        tags = dict(obj.tags)
        if tags.get("highway") in MAINLINE | LINKS or tags.get("man_made") == "gantry":
            nodes = [r.ref for r in obj.nodes]
            osm.ways[obj.id] = {"tags": tags, "nodes": nodes}
            wanted.update(nodes)
    for obj in osmium.FileProcessor(str(path), osmium.osm.NODE):
        tags = obj.tags
        junction = tags.get("highway") == "motorway_junction"
        gantry = tags.get("man_made") == "gantry"
        if obj.id not in wanted and not junction and not gantry:
            continue
        lon, lat = obj.location.lon, obj.location.lat
        osm.nodes[obj.id] = (lon, lat)
        inside = w <= lon <= e and s <= lat <= n
        if junction and inside:
            osm.junctions[obj.id] = dict(tags)
        if gantry and inside:
            osm.gantries.append((lon, lat))
    for wid in [k for k, v in osm.ways.items() if v["tags"].get("man_made") == "gantry"]:
        pts = [osm.nodes[x] for x in osm.ways.pop(wid)["nodes"] if x in osm.nodes]
        if pts:
            osm.gantries.append((sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)))
    # Only the ways that reach into the area: the rest of northern California stays out.
    for wid in list(osm.ways):
        if not any(w <= osm.nodes[x][0] <= e and s <= osm.nodes[x][1] <= n
                   for x in osm.ways[wid]["nodes"] if x in osm.nodes):
            del osm.ways[wid]
    return osm


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:16]


def tile_of(lon: float, lat: float) -> tuple[int, int]:
    return math.floor(lon / TILE_DEG), math.floor(lat / TILE_DEG)


def publish(signs: list[dict], bbox) -> dict:
    by_tile: dict[tuple[int, int], list[dict]] = {}
    w, s, e, n = bbox
    for sign in signs:
        lon, lat = sign["p"]
        if w <= lon <= e and s <= lat <= n:
            by_tile.setdefault(tile_of(lon, lat), []).append(sign)
    shutil.rmtree(TILES, ignore_errors=True)
    TILES.mkdir(parents=True)
    tiles = []
    for (i, j), rows in sorted(by_tile.items()):
        name = f"{'w' if i < 0 else 'e'}{abs(i)}-{'s' if j < 0 else 'n'}{abs(j)}.json"
        path = TILES / name
        path.write_text(json.dumps({"schema": "kerbside.highway_signs/1",
                                    "signs": sorted(rows, key=lambda r: r["id"])},
                                   separators=(",", ":")) + "\n")
        tiles.append({"path": f"highway-signs/{name}",
                      "bbox": [round(i * TILE_DEG, 6), round(j * TILE_DEG, 6),
                               round((i + 1) * TILE_DEG, 6), round((j + 1) * TILE_DEG, 6)],
                      "signs": len(rows), "bytes": path.stat().st_size, "sha256": sha256(path)})
    shutil.copyfile(str(files("smc.highways").joinpath("renderer.mjs")), RENDERER)
    kinds: dict[str, int] = {}
    for t in by_tile.values():
        for sign in t:
            kinds[sign["kind"]] = kinds.get(sign["kind"], 0) + 1
    manifest = {"schema": "kerbside.highway_sign_tiles/1", "renderer_sha256": sha256(RENDERER),
                "source": "OpenStreetMap contributors (ODbL): motorway_junction, ramp destination tags, gantries",
                "bbox": [round(v, 6) for v in bbox], "signs": sum(kinds.values()), "kinds": kinds,
                "tiles": tiles}
    MANIFEST.write_text(json.dumps(manifest, indent=1) + "\n")
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--pbf", type=Path, help="a Geofabrik .osm.pbf extract instead of Overpass")
    args = parser.parse_args()
    use_certifi()
    bbox = published_bbox()
    osm = from_pbf(args.pbf, bbox) if args.pbf else from_overpass_api(bbox)
    signs = infer_signs(osm)
    manifest = publish(signs, bbox)
    print(json.dumps({k: manifest[k] for k in ("bbox", "signs", "kinds")} | {"tiles": len(manifest["tiles"])}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
