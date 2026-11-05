#!/usr/bin/env python3
"""Put the water above and below the street on the map, for every published region: streams,
storm drains and sewer lids (each drain with where its water goes), treatment plants and water
storage tanks (smc.waterworks says what is drawn, from what, and what is kept as data only).

OpenStreetMap comes from a Geofabrik extract (``--pbf``; Overpass refuses this machine); the
storm and sewer records from each city's own service (smc.infrastructure.drainage). Written as
the freeway signs are, at the site's root:

    waterworks.manifest.json    each tile by its area, with its hash
    waterworks/<tile>.json      what is in a 0.1 degree square
    waterworks-renderer.mjs     smc/waterworks/renderer.mjs, which draws them

and, kept off the site, each city's network as read (``build/waterworks/<city>.json.gz``).

    .venv/bin/python scripts/build_waterworks.py --pbf build/nature/norcal-latest.osm.pbf
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import math
import shutil
import sys
from importlib.resources import files
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from smc.infrastructure.drainage import LAYERS, build_network  # noqa: E402
from smc.net import use_certifi  # noqa: E402
from smc.waterworks import MANIFEST_SCHEMA, SCHEMA  # noqa: E402
from smc.waterworks.drains import (  # noqa: E402
    PointGrid,
    drain_form,
    entry_node,
    follow_published,
    receiving_water,
    sf_route,
    sf_watershed,
    stream_points,
    toward_outfalls,
)
from smc.waterworks.osm import assign_to_plants, read_pbf  # noqa: E402

DOCS = ROOT / "docs"
MANIFEST = DOCS / "waterworks.manifest.json"
TILES = DOCS / "waterworks"
RENDERER = DOCS / "waterworks-renderer.mjs"
KEPT = ROOT / "build" / "waterworks"
TILE_DEG = 0.1
PAD_DEG = 0.004
#: A junction lid this close to a lid a city or OpenStreetMap already has is that lid.
LID_DEDUP_M = 15.0
#: San Francisco's streets: its combined sewer runs under them, with a lid at each junction.
SF_BOX = (-122.52, 37.70, -122.35, 37.84)
#: A stream is cut into pieces of this many points, each filed under the tile its middle is in.
STREAM_PIECE = 48


def region_boxes() -> list[tuple[float, float, float, float]]:
    regions = json.loads((DOCS / "app-regions.json").read_text())
    regions = regions["regions"] if isinstance(regions, dict) else regions
    return [(r["bbox"][1] - PAD_DEG, r["bbox"][0] - PAD_DEG, r["bbox"][3] + PAD_DEG, r["bbox"][2] + PAD_DEG)
            for r in regions if r.get("bbox")]


class Area:
    """Whether a point is in any published region (a grid of the boxes, for speed)."""

    def __init__(self, boxes):
        self.boxes = boxes
        self.cells: dict[tuple[int, int], list] = {}
        for b in boxes:
            for i in range(math.floor(b[0] / 0.05), math.floor(b[2] / 0.05) + 1):
                for j in range(math.floor(b[1] / 0.05), math.floor(b[3] / 0.05) + 1):
                    self.cells.setdefault((i, j), []).append(b)

    def __call__(self, lon: float, lat: float) -> bool:
        return any(b[0] <= lon <= b[2] and b[1] <= lat <= b[3]
                   for b in self.cells.get((math.floor(lon / 0.05), math.floor(lat / 0.05)), ()))


def city_networks(boxes, say) -> dict[str, dict]:
    """Each city's published drainage over the union of the regions it reaches, read once."""
    out = {}
    for city in sorted({ln.city for ln in LAYERS}):
        cov = next(ln.coverage for ln in LAYERS if ln.city == city)
        hits = [b for b in boxes if b[0] <= cov[2] and b[2] >= cov[0] and b[1] <= cov[3] and b[3] >= cov[1]]
        if not hits:
            continue
        bbox = {"west": max(cov[0], min(b[0] for b in hits)), "south": max(cov[1], min(b[1] for b in hits)),
                "east": min(cov[2], max(b[2] for b in hits)), "north": min(cov[3], max(b[3] for b in hits))}
        say(f"{city}: reading its drainage over {len(hits)} regions")
        net = build_network(city, bbox, progress=say)
        # Only this city's own layers (a neighbour's coverage can reach into the box).
        net["nodes"] = [n for n in net["nodes"] if n["id"].startswith(city + ":") or n["kind"] == "junction"]
        out[city] = net
    return out


class Routes:
    """One table of route descriptions per tile; a drain names its route by index."""

    def __init__(self):
        self.rows: list[dict] = []
        self.index: dict[str, int] = {}

    def add(self, route: dict) -> int:
        key = json.dumps(route, sort_keys=True)
        if key not in self.index:
            self.index[key] = len(self.rows)
            self.rows.append(route)
        return self.index[key]


def route_for(node: dict, city: str | None, nets: dict, outfall_next: dict, water_grid) -> dict:
    p = node["p"]
    if city == "san-francisco":
        return sf_route(sf_watershed(node.get("area"), p[1]))
    if city == "san-jose":
        start = entry_node(nets["san-jose"], node, outfall_next["san-jose-grid"])
        path = follow_published(nets["san-jose"], start) if start else None
        if path:
            end = path.pop("end_p") or p
            return {"to": "storm outfall" if path["end_kind"] == "outfall" else "end of the published mains",
                    "system": "storm", "basis": "published network", **path,
                    **receiving_water(end, water_grid)}
    if city == "palo-alto":
        nxt = outfall_next.get("palo-alto", {})
        if node["id"] in nxt:
            return {"to": "storm outfall", "system": "storm", "basis": "published pipes, direction inferred",
                    "length_m": round(nxt[node["id"]][1]), **receiving_water(p, water_grid)}
    route = {"to": "storm drain main", "system": node.get("system") or "storm",
             "basis": "nearest receiving water", **receiving_water(p, water_grid)}
    return route


def city_of(node_id: str) -> str | None:
    head = node_id.split(":", 1)[0]
    return head if head in {"san-jose", "palo-alto", "berkeley", "san-francisco"} else None


def _compact(row: dict) -> dict:
    """Coordinates to a tenth of a metre (six places): the seventh is a centimetre nobody drew."""
    out = dict(row)
    for key in ("p", "c"):
        if key in out:
            v = out[key]
            out[key] = ([round(v[0], 6), round(v[1], 6)] if v and not isinstance(v[0], list)
                        else [[round(x, 6), round(y, 6)] for x, y in v])
    return out


def tile_of(lon: float, lat: float) -> tuple[int, int]:
    return math.floor(lon / TILE_DEG), math.floor(lat / TILE_DEG)


def build(pbf: Path, say, reuse: bool = False) -> dict:
    boxes = region_boxes()
    inside = Area(boxes)
    say("reading OpenStreetMap")
    water = read_pbf(pbf, inside)
    assign_to_plants(water)
    if reuse and any(KEPT.glob("*.json.gz")):
        nets = {}
        for path in sorted(KEPT.glob("*.json.gz")):
            with gzip.open(path, "rt") as fh:
                nets[path.name.removesuffix(".json.gz")] = json.load(fh)
    else:
        nets = city_networks(boxes, say)
        KEPT.mkdir(parents=True, exist_ok=True)
        for city, net in nets.items():
            with gzip.open(KEPT / f"{city}.json.gz", "wt") as fh:
                json.dump(net, fh, separators=(",", ":"))
    outfall_next = {"palo-alto": toward_outfalls(nets["palo-alto"])} if "palo-alto" in nets else {}
    if "san-jose" in nets:
        outfall_next["san-jose-grid"] = PointGrid(nets["san-jose"]["nodes"], cell_deg=0.001)
    water_grid = PointGrid(stream_points(water.streams), cell_deg=0.005)

    tiles: dict[tuple[int, int], dict] = {}
    routes: dict[tuple[int, int], Routes] = {}

    def put(kind: str, p, item: dict):
        key = tile_of(*p)
        tiles.setdefault(key, {k: [] for k in ("streams", "drains", "lids", "tanks", "basins", "plants",
                                               "underground")})[kind].append(item)

    def route_index(p, route) -> int:
        return routes.setdefault(tile_of(*p), Routes()).add(route)

    # Drains and lids the cities publish, then OpenStreetMap's.
    counts = {"forms": {}, "skipped_types": 0, "lids_inferred": 0}
    lids_seen = []
    for city, net in nets.items():
        for node in net["nodes"]:
            if node["kind"] not in ("inlet", "catch_basin", "manhole") or not inside(*node["p"]):
                continue
            form = drain_form(node)
            if form is None:
                counts["skipped_types"] += 1
                continue
            route = route_for(node, city, nets, outfall_next, water_grid)
            row = {"id": node["id"], "p": node["p"], "f": form, "s": node.get("system", "storm"),
                   "r": route_index(node["p"], route)}
            for k in ("type", "rim_m", "invert_m", "depth_m"):
                if node.get(k) is not None and not (k == "type" and node[k] == "Catch Basin Drain"):
                    row[k] = node[k]
            counts["forms"][form] = counts["forms"].get(form, 0) + 1
            if form == "lid":
                lids_seen.append(row)
                put("lids", node["p"], row)
            else:
                put("drains", node["p"], row)
    for d in water.drains:
        form = drain_form(d) or "grate"
        row = {"id": d["id"], "p": d["p"], "f": form, "s": "storm", "src": "osm",
               "r": route_index(d["p"], route_for(d, None, nets, outfall_next, water_grid))}
        counts["forms"][form] = counts["forms"].get(form, 0) + 1
        put("drains", d["p"], row)
    lid_grid = PointGrid(lids_seen, cell_deg=0.002)
    for m in water.manholes:
        if lid_grid.nearest(m["p"], 2.0):
            continue
        system = {"drain": "storm", "rainwater": "storm", "sewer": "sanitary", "water": "water"}.get(m["use"], m["use"])
        row = {"id": m["id"], "p": m["p"], "f": "lid", "s": system, "src": "osm"}
        if system in ("storm", "sanitary", "combined"):
            sf = SF_BOX[0] <= m["p"][0] <= SF_BOX[2] and SF_BOX[1] <= m["p"][1] <= SF_BOX[3]
            route = sf_route(sf_watershed(None, m["p"][1])) if sf else route_for(
                {"p": m["p"], "id": m["id"], "system": system}, None, nets, outfall_next, water_grid)
            row["r"] = route_index(m["p"], route)
        lids_seen.append(row)
        put("lids", m["p"], row)
    # San Francisco's combined sewer: the SFPUC publishes no manholes, but its mains run under the
    # streets with a manhole at each junction. A lid there, marked inferred, unless one is known.
    lid_grid = PointGrid(lids_seen, cell_deg=0.002)
    sf_drains = PointGrid([n for n in nets.get("san-francisco", {}).get("nodes", [])
                           if n["kind"] in ("catch_basin", "inlet")], cell_deg=0.002)
    for j, p in enumerate(water.junctions):
        if not (SF_BOX[0] <= p[0] <= SF_BOX[2] and SF_BOX[1] <= p[1] <= SF_BOX[3]):
            continue
        if lid_grid.nearest(p, LID_DEDUP_M):
            continue
        near = sf_drains.nearest(p, 120.0)
        route = sf_route(sf_watershed(near.get("area") if near else None, p[1]))
        put("lids", p, {"id": f"sf-junction:{j}", "p": p, "f": "lid", "s": "combined", "inferred": True,
                        "r": route_index(p, route)})
        counts["lids_inferred"] += 1

    # Streams, cut into pieces each filed by its middle.
    for s in water.streams:
        c = s["c"]
        for k in range(0, len(c) - 1, STREAM_PIECE - 1):
            piece = c[k:k + STREAM_PIECE]
            if len(piece) < 2 or not any(inside(x, y) for x, y in piece):
                continue
            mid = piece[len(piece) // 2]
            row = {"id": f"{s['id']}/{k}", "k": s["kind"], "w": s["width_m"], "c": piece}
            for key in ("name", "intermittent", "under"):
                if s.get(key):
                    row[key] = s[key]
            put("streams", mid, row)
    for t in water.tanks:
        if t["under"]:
            put("underground", t["p"], {k: v for k, v in t.items() if k not in ("c", "under")})
        elif t.get("content") in (None, "water", "sewage", "wastewater", "sludge", "rainwater") or t.get("plant"):
            put("tanks", t["p"], t)
    for b in water.basins:
        put("basins", b["p"], b)
    for p in water.plants:
        put("plants", p["p"], p)

    shutil.rmtree(TILES, ignore_errors=True)
    TILES.mkdir(parents=True)
    listed = []
    totals: dict[str, int] = {}
    for (i, j), body in sorted(tiles.items()):
        name = f"{'w' if i < 0 else 'e'}{abs(i)}-{'s' if j < 0 else 'n'}{abs(j)}.json"
        doc = {"schema": SCHEMA, **{k: [_compact(r) for r in sorted(v, key=lambda r: r["id"])] for k, v in body.items()},
               "routes": routes.get((i, j), Routes()).rows}
        path = TILES / name
        path.write_text(json.dumps(doc, separators=(",", ":")) + "\n")
        for k, v in body.items():
            totals[k] = totals.get(k, 0) + len(v)
        listed.append({"path": f"waterworks/{name}",
                       "bbox": [round(i * TILE_DEG, 6), round(j * TILE_DEG, 6),
                                round((i + 1) * TILE_DEG, 6), round((j + 1) * TILE_DEG, 6)],
                       "bytes": path.stat().st_size, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()[:16],
                       **{k: len(v) for k, v in body.items() if v}})
    shutil.copyfile(str(files("smc.waterworks").joinpath("renderer.mjs")), RENDERER)
    manifest = {"schema": MANIFEST_SCHEMA,
                "renderer_sha256": hashlib.sha256(RENDERER.read_bytes()).hexdigest()[:16],
                "sources": ["OpenStreetMap contributors (ODbL): waterways, storage tanks, water towers, covered "
                            "reservoirs, treatment plants, manholes, street junctions",
                            *sorted({f"{s['title']} ({s['city']}; {s['license']})" for net in nets.values()
                                     for s in net["sources"] if s["features"]})],
                "totals": totals, "forms": counts["forms"], "lids_inferred": counts["lids_inferred"],
                "skipped_types": counts["skipped_types"],
                "gaps": sorted({g for net in nets.values() for g in net["gaps"]}),
                "tiles": listed}
    MANIFEST.write_text(json.dumps(manifest, indent=1) + "\n")
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--pbf", type=Path, required=True, help="a Geofabrik .osm.pbf extract")
    parser.add_argument("--reuse", action="store_true", help="the cities' networks as last read (build/waterworks)")
    args = parser.parse_args()
    use_certifi()
    manifest = build(args.pbf, lambda m: print(m, file=sys.stderr), reuse=args.reuse)
    print(json.dumps({k: manifest[k] for k in ("totals", "forms", "lids_inferred", "skipped_types", "gaps")}
                     | {"tiles": len(manifest["tiles"])}, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
