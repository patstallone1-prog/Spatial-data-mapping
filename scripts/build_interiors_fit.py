#!/usr/bin/env python3
"""Fit a generic interior and doors to every building of every built region.

Reads the layout templates (scripts/ingest_interiors.py), each region's page payload, its
storeys (scripts/build_storeys.py) and facade survey (scripts/build_facade_survey.py), and the
entrances mappers have put on outlines in OpenStreetMap. Writes, beside each region's page:

  sf-corridor-interiors.json
      library    the templates used, ground storey only, in their own rectangle's frame:
                 rooms as [kind, flat cm coords], doors as [x, y, width, angle]
      buildings  osm id -> [template, rotated, nx, ny, centre lon, centre lat, yaw deg,
                 L, W, storeys, storey m, sx, sy, doors]; doors are [edge, t, width, source]
                 against the page's own outline (source 0 osm, 1 photographed, 2 inferred)

The page loads it the first time a door is opened (see the renderer). How well each building's
proportions were met is in the record (sx, sy: 1.0 is unstretched); the counts and the spread
of stretch are printed and written in ``summary``.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
from collections import Counter
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from smc.interiors import fit  # noqa: E402
from smc.net import overpass  # noqa: E402
from smc.regions.paths import region_paths  # noqa: E402

INTERIORS = ROOT / "data" / "interiors"
REGIONS = ["sf-corridor", "sf-mission", "sf-sunset", "sf-haight-castro", "oakland-downtown",
           "berkeley-downtown", "palo-alto-downtown", "san-jose-downtown"]
OUTPUT = "sf-corridor-interiors.json"


def entrances(region: str) -> list[tuple[float, float, str]]:
    """OSM ``entrance=*`` nodes in the region's box (lon, lat, kind), cached."""
    paths = region_paths(region)
    cache = paths.official / "osm_entrances.json"
    if cache.exists():
        return [tuple(e) for e in json.loads(cache.read_text())["entrances"]]
    box = json.loads(paths.page.read_text())["bbox"]
    query = (f'[out:json][timeout:150];node["entrance"]'
             f'({box["south"]},{box["west"]},{box["north"]},{box["east"]});out;')
    found = [(e["lon"], e["lat"], e.get("tags", {}).get("entrance", "yes"))
             for e in overpass(query, "building entrances")["elements"]]
    cache.write_text(json.dumps({"source": "OpenStreetMap entrance=* via Overpass (ODbL)",
                                 "entrances": found}, separators=(",", ":")))
    return found


def library() -> tuple[list[fit.Template], np.ndarray, np.ndarray, dict]:
    houses = fit.pool(fit.read_templates(INTERIORS / "resplan" / "templates.jsonl.gz"))
    blocks = fit.pool(fit.read_templates(INTERIORS / "swiss_dwellings" / "templates.jsonl.gz"))
    lib = houses + blocks
    sources = {t.source: {"license": t.license, "attribution": t.attribution} for t in lib}
    return lib, np.arange(len(houses)), np.arange(len(houses), len(lib)), sources


def build(region: str, lib: list[fit.Template], house_ix: np.ndarray, block_ix: np.ndarray,
          sources: dict) -> dict:
    paths = region_paths(region)
    page = json.loads(paths.page.read_text())
    box = page["bbox"]
    mid_lat = (box["south"] + box["north"]) / 2.0
    mid_lon = (box["west"] + box["east"]) / 2.0
    kx = 111_320.0 * math.cos(math.radians(mid_lat))
    ky = 111_320.0

    def local(points) -> np.ndarray:
        p = np.asarray(points, float)
        return np.column_stack([(p[:, 0] - mid_lon) * kx, (p[:, 1] - mid_lat) * ky])

    storeys = {}
    if (paths.official / "building_storeys.json").exists():
        storeys = json.loads((paths.official / "building_storeys.json").read_text())["buildings"]
    survey = {}
    if (paths.official / "facade_survey.json").exists():
        survey = json.loads((paths.official / "facade_survey.json").read_text())["buildings"]
    streets = [local(w["points"]) for w in page["ways"]
               if w.get("kind") == "street" and len(w.get("points") or []) >= 2]
    street_points = np.vstack([np.vstack([np.linspace(s[i], s[i + 1], max(2, int(
        np.hypot(*(s[i + 1] - s[i])) / 4) + 1)) for i in range(len(s) - 1)])
        for s in streets]) if streets else np.zeros((0, 2))
    street_cells: dict[tuple[int, int], np.ndarray] = {}
    if len(street_points):
        keys = np.floor(street_points / 50.0).astype(int)
        order = np.lexsort((keys[:, 1], keys[:, 0]))
        keys, pts = keys[order], street_points[order]
        cut = np.flatnonzero(np.any(np.diff(keys, axis=0) != 0, axis=1)) + 1
        for k, p in zip(np.split(keys, cut), np.split(pts, cut), strict=True):
            street_cells[(int(k[0, 0]), int(k[0, 1]))] = p
    ent = [(local([[lon, lat]])[0], kind) for lon, lat, kind in entrances(region)]
    ent_cells: dict[tuple[int, int], list] = {}
    for p, kind in ent:
        ent_cells.setdefault((int(p[0] // 50), int(p[1] // 50)), []).append((p, kind))

    def near(cells: dict, centre: np.ndarray, reach: int = 1):
        cx, cy = int(centre[0] // 50), int(centre[1] // 50)
        for dx in range(-reach, reach + 1):
            for dy in range(-reach, reach + 1):
                yield cells.get((cx + dx, cy + dy))

    # Every footprint, so a door can be checked to open onto open ground: a door whose outside
    # is another building is a party wall, wherever the evidence for it came from.
    rings: dict[str, np.ndarray] = {}
    ring_cells: dict[tuple[int, int], list[str]] = {}
    for way in page["ways"]:
        if way.get("kind") == "building" and way.get("osm_id") is not None \
                and len(way.get("points") or []) >= 4:
            r = local(way["points"])
            rings[str(way["osm_id"])] = r
            lo, hi = r.min(axis=0) // 50, r.max(axis=0) // 50
            for cx in range(int(lo[0]), int(hi[0]) + 1):
                for cy in range(int(lo[1]), int(hi[1]) + 1):
                    ring_cells.setdefault((cx, cy), []).append(str(way["osm_id"]))

    def open_ground(point: np.ndarray) -> bool:
        for key in ring_cells.get((int(point[0] // 50), int(point[1] // 50)), ()):
            r = rings[key]
            lo, hi = r.min(axis=0), r.max(axis=0)
            if lo[0] <= point[0] <= hi[0] and lo[1] <= point[1] <= hi[1] \
                    and fit.point_in_ring(r, point[0], point[1]):
                return False
        return True

    out: dict[str, list] = {}
    used: dict[int, int] = {}
    stretch, door_sources, sizes = [], Counter(), Counter()
    for way in page["ways"]:
        if way.get("kind") != "building" or way.get("osm_id") is None \
                or len(way.get("points") or []) < 4:
            continue
        key = str(way["osm_id"])
        ring = local(way["points"])
        if not np.allclose(ring[0], ring[-1]):
            ring = np.vstack([ring, ring[:1]])
        centre, yaw, length, width = fit.footprint_rectangle(ring[:-1])
        if width < fit.MIN_EDGE_M:
            continue
        info = storeys.get(key) or {}
        n_storeys = int(info.get("storeys") or 1)
        storey_m = float(info.get("storey_m") or 3.2)
        area = fit.ring_area(ring)
        house = area <= fit.HOUSE_MAX_AREA_M2 and n_storeys <= fit.HOUSE_MAX_STOREYS
        f = fit.best_fit(length, width, n_storeys, lib, house_ix if house else block_ix)
        sizes["house" if house else "block"] += 1
        stretch.append(max(abs(math.log(f.sx)), abs(math.log(f.sy))))
        # Doors: mapped, then photographed, then inferred.
        doors = []
        for bucket in near(ent_cells, centre, 2):
            for p, _kind in bucket or ():
                i, t, d = fit.nearest_edge(ring, p)
                if d <= fit.ENTRANCE_SNAP_M:
                    doors.append([i, round(t, 3), fit.DOOR_WIDTH_M, fit.SOURCE_CODES["osm"]])
        if not doors:
            for wall in (survey.get(key) or {}).get("walls", []):
                a, b = local([wall["a"]])[0], local([wall["b"]])[0]
                span = np.hypot(*(b - a))
                if span < 1e-6:
                    continue
                for kind, u, _v, w, _h, _conf in wall.get("openings", []):
                    if kind not in ("door", "storefront"):
                        continue
                    point = a + (b - a) * min(1.0, (u + w / 2) / span)
                    i, t, d = fit.nearest_edge(ring, point)
                    if d <= 1.0:
                        doors.append([i, round(t, 3), round(min(w, 2.0), 2),
                                      fit.SOURCE_CODES["photo"]])
        party = [d for d in doors if not open_ground(fit.outside_point(ring, d[0], d[1]))]
        door_sources["party wall"] += len(party)
        doors = [d for d in doors if d not in party]
        if not doors:
            local_streets = [c for c in near(street_cells, centre, 2) if c is not None]
            for edge in fit.door_edges(ring, np.vstack(local_streets) if local_streets
                                       else street_points):
                if open_ground(fit.outside_point(ring, edge, 0.5)):
                    doors.append([edge, 0.5, fit.DOOR_WIDTH_M, fit.SOURCE_CODES["inferred"]])
                    break
            else:
                door_sources["no open wall"] += 1
        for d in doors:
            door_sources[d[3]] += 1
        doors = [[int(d[0]), d[1], d[2], d[3]] for d in doors]
        index = used.setdefault(f.template, len(used))
        lon = mid_lon + centre[0] / kx
        lat = mid_lat + centre[1] / ky
        out[key] = [index, int(f.rotated), f.nx, f.ny, round(lon, 7), round(lat, 7),
                    round(math.degrees(yaw), 2), round(length, 2), round(width, 2), n_storeys,
                    round(storey_m, 2), round(f.sx, 3), round(f.sy, 3), doors]
    order = sorted(used, key=used.get)
    stretch_arr = np.array(stretch) if stretch else np.zeros(1)
    summary = {
        "buildings": len(out), "houses": sizes["house"], "blocks": sizes["block"],
        "templates_used": len(order),
        "stretch": {"median": round(float(np.exp(np.median(stretch_arr))), 3),
                    "p90": round(float(np.exp(np.percentile(stretch_arr, 90))), 3),
                    "within_10pct": int((stretch_arr <= math.log(1.10)).sum()),
                    "within_25pct": int((stretch_arr <= math.log(1.25)).sum())},
        "doors": {"osm": door_sources[0], "photographed": door_sources[1],
                  "inferred": door_sources[2],
                  "dropped_onto_another_building": door_sources["party wall"],
                  "buildings_with_no_open_wall": door_sources["no open wall"]},
    }
    payload = {
        "schema": "kerbside.interiors/1", "region": region,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "grade": "inferred",
        "note": ("A generic plan of somewhere else chosen for this building's proportions -- "
                 "not this building's interior. Doors: mapped (OpenStreetMap), photographed "
                 "(facade survey), else inferred on the wall nearest a street."),
        "kinds": list(fit.KINDS), "sources": sources, "summary": summary,
        "library": [lib[i].to_json() for i in order], "buildings": out,
    }
    (paths.site / OUTPUT).write_text(json.dumps(payload, separators=(",", ":")))
    return {"region": region, **summary,
            "bytes": (paths.site / OUTPUT).stat().st_size}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("regions", nargs="*")
    args = ap.parse_args()
    started = time.time()
    lib, house_ix, block_ix, sources = library()
    print(f"library: {len(house_ix)} dwellings, {len(block_ix)} buildings "
          f"({time.time() - started:.0f} s)", flush=True)
    for region in args.regions or REGIONS:
        if not region_paths(region).page.exists():
            continue
        print(json.dumps(build(region, lib, house_ix, block_ix, sources)), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
