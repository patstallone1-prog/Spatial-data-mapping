#!/usr/bin/env python3
"""Fetch the 3D shape OpenStreetMap records for a region's buildings: parts, setbacks, roofs.

The page extrudes every building's outline straight up to one height. Downtown that is wrong
in a way you can see from the street: the Transamerica Pyramid is a pyramid, a tower steps back
from its podium, an upper storey overhangs a plaza on columns, a block has a courtyard cut out
of the middle. OpenStreetMap maps all of these, with the Simple 3D Buildings tags:

* ``building:part`` ways inside an outline, each with its own ``height`` and ``min_height``
  (or ``building:levels`` / ``building:min_level``), so a podium, a shaft and a crown are three
  parts and a cut-out under an overhang is a part that starts above the ground;
* ``roof:shape`` (flat, skillion, gabled, hipped, pyramidal, dome, ...) and ``roof:height``;
* multipolygon buildings, whose inner rings are courtyards.

The payload's buildings keep their outline and their measured height; this writes a sidecar,
``sf-corridor-building-shapes.json``, keyed by the outline's way id, that the page uses to draw
the outline as its parts. Only buildings with something the flat extrusion cannot draw are in
it. Data (c) OpenStreetMap contributors, ODbL.

    python scripts/fetch_building_shapes.py --region sf-corridor
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
SCHEMA = "kerbside.building_shapes/1"
MIRRORS = ("https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter",
           "https://maps.mail.ru/osm/tools/overpass/api/interpreter")
#: OpenStreetMap's own default storey for building:levels when nothing else is given.
LEVEL_M = 3.0
ROOF_SHAPES = {"flat", "skillion", "gabled", "hipped", "half-hipped", "pyramidal", "dome", "onion",
               "mansard", "gambrel", "round", "saltbox", "cone"}


def folder(region: str) -> Path:
    return ROOT / "docs" if region == "sf-corridor" else ROOT / "docs/regions" / region


def query(bbox: dict[str, float]) -> str:
    area = f"{bbox['south']},{bbox['west']},{bbox['north']},{bbox['east']}"
    return (f"[out:json][timeout:180];("
            f'way["building:part"]({area});'
            f'relation["building:part"]({area});'
            f'relation["building"]({area});'
            f'relation["type"="building"]({area});'
            f'way["building"]["roof:shape"]({area});'
            f'way["building"]["min_height"]({area});'
            f'way["building"]["building:min_level"]({area});'
            f");out geom;")


def fetch(bbox: dict[str, float], *, attempts: int = 3) -> list[dict[str, Any]]:
    body = urllib.parse.urlencode({"data": query(bbox)}).encode()
    last: Exception | None = None
    for attempt in range(attempts):
        for url in MIRRORS:
            try:
                # Overpass answers 406 to a request without a User-Agent.
                request = urllib.request.Request(url, data=body, headers={"User-Agent": "Kerbside/0.1 building shapes"})
                with urllib.request.urlopen(request, timeout=240) as response:
                    return json.loads(response.read())["elements"]
            except Exception as error:  # noqa: BLE001 -- the next mirror is the handling
                last = error
        time.sleep(15 * (attempt + 1))
    raise RuntimeError(f"Overpass refused every mirror: {last}")


def metres(value: Any) -> float | None:
    """A length tag in metres: "45", "45 m", "12.5m", "150 ft"; else None."""
    if value is None:
        return None
    match = re.match(r"^\s*(-?\d+(?:\.\d+)?)\s*(m|ft|')?\s*$", str(value).replace(",", "."))
    if not match:
        return None
    number = float(match.group(1))
    return round(number * 0.3048, 2) if match.group(2) in ("ft", "'") else number


def levels(value: Any) -> float | None:
    try:
        return float(str(value).split(";")[0])
    except (TypeError, ValueError):
        return None


def vertical(tags: dict[str, str]) -> dict[str, Any]:
    """Where a part starts and stops, and its roof. Explicit metres win over storeys."""
    roof_shape = tags.get("roof:shape", "flat").strip().lower()
    roof_shape = roof_shape if roof_shape in ROOF_SHAPES else "flat"
    height = metres(tags.get("height"))
    if height is None and levels(tags.get("building:levels")) is not None:
        height = levels(tags["building:levels"]) * LEVEL_M + (levels(tags.get("roof:levels")) or 0) * LEVEL_M
    bottom = metres(tags.get("min_height"))
    if bottom is None and levels(tags.get("building:min_level")) is not None:
        bottom = levels(tags["building:min_level"]) * LEVEL_M
    roof_height = metres(tags.get("roof:height"))
    if roof_height is None and levels(tags.get("roof:levels")) is not None and roof_shape != "flat":
        roof_height = levels(tags["roof:levels"]) * LEVEL_M
    out: dict[str, Any] = {"roof": roof_shape}
    if height is not None:
        out["height_m"] = round(height, 2)
    if bottom:
        out["min_height_m"] = round(bottom, 2)
    if roof_height is not None and roof_shape != "flat":
        out["roof_height_m"] = round(roof_height, 2)
    if tags.get("roof:direction"):
        out["roof_direction"] = tags["roof:direction"]
    if tags.get("roof:orientation"):
        out["roof_orientation"] = tags["roof:orientation"]
    for key, name in (("building:colour", "colour"), ("roof:colour", "roof_colour"),
                      ("building:material", "material"), ("roof:material", "roof_material")):
        if tags.get(key):
            out[name] = tags[key]
    return out


def ring(geometry: list[dict[str, float]]) -> list[list[float]]:
    return [[round(p["lon"], 7), round(p["lat"], 7)] for p in geometry]


def join_rings(segments: list[list[list[float]]]) -> list[list[list[float]]]:
    """Members of a multipolygon are often split ways; stitch them end to end into closed rings."""
    open_ = [s[:] for s in segments if s]
    rings: list[list[list[float]]] = []
    while open_:
        current = open_.pop(0)
        changed = True
        while current[0] != current[-1] and changed:
            changed = False
            for i, other in enumerate(open_):
                if other[0] == current[-1]:
                    current += other[1:]
                elif other[-1] == current[-1]:
                    current += other[::-1][1:]
                elif other[-1] == current[0]:
                    current = other[:-1] + current
                elif other[0] == current[0]:
                    current = other[::-1][:-1] + current
                else:
                    continue
                open_.pop(i)
                changed = True
                break
        if current[0] == current[-1] and len(current) >= 4:
            rings.append(current)
    return rings


def polygons(element: dict[str, Any]) -> tuple[list[list[list[float]]], list[list[list[float]]]]:
    """(outer rings, inner rings) of a way or a multipolygon relation."""
    if element["type"] == "way":
        points = ring(element.get("geometry", []))
        return ([points] if len(points) >= 4 and points[0] == points[-1] else []), []
    outers = [ring(m["geometry"]) for m in element.get("members", [])
              if m.get("type") == "way" and m.get("role") in ("outer", "") and m.get("geometry")]
    inners = [ring(m["geometry"]) for m in element.get("members", [])
              if m.get("type") == "way" and m.get("role") == "inner" and m.get("geometry")]
    return join_rings(outers), join_rings(inners)


def contains(polygon: list[list[float]], point: tuple[float, float]) -> bool:
    x, y = point
    inside = False
    for (x1, y1), (x2, y2) in zip(polygon, polygon[1:]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


def area_m2(polygon: list[list[float]]) -> float:
    lat0 = math.radians(polygon[0][1])
    kx, ky = 111_320 * math.cos(lat0), 110_540
    return abs(sum((a[0] * kx) * (b[1] * ky) - (b[0] * kx) * (a[1] * ky)
                   for a, b in zip(polygon, polygon[1:]))) / 2


def inside_point(polygon: list[list[float]]) -> tuple[float, float]:
    """A point inside the ring: the centroid when it is in, else a midpoint of a chord that is."""
    n = len(polygon) - 1
    cx, cy = sum(p[0] for p in polygon[:-1]) / n, sum(p[1] for p in polygon[:-1]) / n
    if contains(polygon, (cx, cy)):
        return cx, cy
    for i in range(n):
        for j in range(i + 2, n):
            mx, my = (polygon[i][0] + polygon[j][0]) / 2, (polygon[i][1] + polygon[j][1]) / 2
            if contains(polygon, (mx, my)):
                return mx, my
    return cx, cy


def extra_building(element: dict[str, Any], index: int, outer: list[list[float]]) -> dict[str, Any]:
    """A building the payload never had: a multipolygon outline whose outer ways carry no building
    tag, so the way query that builds the payload passed it by. Downtown these are the big
    ones -- the Palace Hotel, the Fairmont, the Marriott Marquis -- left as gaps in the blocks."""
    from smc.buildings.enrichment import archetype_for
    tags = element.get("tags", {})
    shape = vertical(tags)
    rid = int(element["id"])
    xs, ys = [p[0] for p in outer[:-1]], [p[1] for p in outer[:-1]]
    feature: dict[str, Any] = {
        "kind": "building", "covered": True,
        # Negative, so it never meets a way's id; a second outer of the same relation is offset.
        "osm_id": -(rid if index == 0 else rid * 1000 + index), "osm_ref": f"relation/{rid}",
        "points": outer, "centroid": [round(sum(xs) / len(xs), 7), round(sum(ys) / len(ys), 7)],
        "tags": {k: v for k, v in tags.items() if k.startswith(("building", "roof", "height", "min_height", "name", "addr:"))},
        "archetype": archetype_for(building=tags.get("building"), name=tags.get("name")),
    }
    if tags.get("name"):
        feature["name"] = tags["name"]
    if "height_m" in shape:
        feature["height_m"] = shape["height_m"]
        feature["height_source"] = "osm_height" if metres(tags.get("height")) is not None else "osm_levels"
    return feature


def build(elements: list[dict[str, Any]], buildings: list[dict[str, Any]], bbox: dict[str, float]) -> dict[str, Any]:
    """Assign every part, roof and courtyard to the building whose outline holds it."""
    outlines: list[tuple[dict[str, Any], list[list[float]], tuple[float, float, float, float], float]] = []

    def add_outline(b: dict[str, Any]) -> None:
        points = b.get("points") or []
        if len(points) >= 4:
            closed = points if points[0] == points[-1] else [*points, points[0]]
            xs, ys = [p[0] for p in closed], [p[1] for p in closed]
            outlines.append((b, closed, (min(xs), min(ys), max(xs), max(ys)), area_m2(closed)))

    for b in buildings:
        add_outline(b)
    by_id = {str(b["osm_id"]): b for b, _, _, _ in outlines}

    def owner(point: tuple[float, float]) -> dict[str, Any] | None:
        # The smallest outline holding the point: a tower's own outline, not the block's.
        best = None
        for b, closed, (x0, y0, x1, y1), area in outlines:
            if x0 <= point[0] <= x1 and y0 <= point[1] <= y1 and contains(closed, point):
                if best is None or area < best[1]:
                    best = (b, area)
        return best[0] if best else None

    shapes: dict[str, dict[str, Any]] = {}
    extras: list[dict[str, Any]] = []
    counts = {"parts": 0, "parts_unowned": 0, "roofs": 0, "courtyards": 0, "added_buildings": 0,
              "added_over_existing": 0}

    def entry(b: dict[str, Any]) -> dict[str, Any]:
        key = str(b["osm_id"])
        if key not in shapes:
            # A stale sidecar must not reshape a building whose outline has since changed.
            shapes[key] = {"guard": {"n": len(b["points"]), "first": b["points"][0]}, "parts": []}
        return shapes[key]

    # Outlines first, so a part inside a building the payload lacked still finds its building.
    payload_points = [(b, inside_point(c)) for b, c, _, _ in outlines]
    for element in elements:
        tags = element.get("tags", {})
        if element["type"] != "relation" or "building" not in tags or "building:part" in tags:
            continue
        outers, inners = polygons(element)
        for index, outer in enumerate(outers):
            holes = [h for h in inners if contains(outer, inside_point(h))]
            if owner(inside_point(outer)) is not None:
                b = owner(inside_point(outer))
                if holes:
                    e = entry(b)
                    e.setdefault("holes", []).extend(holes)
                    e.setdefault("self", vertical(tags))
                    counts["courtyards"] += len(holes)
                continue
            # A relation drawn round buildings the payload already has would stand over them.
            covered = [b for b, p in payload_points if contains(outer, p) and not any(contains(h, p) for h in holes)]
            if covered:
                counts["added_over_existing"] += 1
                continue
            feature = extra_building(element, index, outer)
            extras.append(feature)
            add_outline(feature)
            counts["added_buildings"] += 1
            if holes:
                e = entry(feature)
                e["holes"] = holes
                e["self"] = vertical(tags)
                counts["courtyards"] += len(holes)
            elif vertical(tags)["roof"] != "flat":
                entry(feature)["self"] = vertical(tags)

    for element in elements:
        tags = element.get("tags", {})
        outers, inners = polygons(element)
        if not outers:
            continue
        if "building:part" in tags and tags["building:part"] != "no":
            for outer in outers:
                b = owner(inside_point(outer))
                if b is None:
                    counts["parts_unowned"] += 1
                    continue
                holes = [h for h in inners if contains(outer, inside_point(h))]
                part = {"osm": f"{element['type'][0]}{element['id']}", "outer": outer, **vertical(tags)}
                if holes:
                    part["holes"] = holes
                entry(b)["parts"].append(part)
                counts["parts"] += 1
        elif "building" in tags and element["type"] == "way" and str(element["id"]) in by_id:
            shape = vertical(tags)
            if shape["roof"] != "flat" or "min_height_m" in shape:
                entry(by_id[str(element["id"])])["self"] = shape
                counts["roofs"] += 1
    for e in shapes.values():
        e["parts"].sort(key=lambda p: (p.get("min_height_m", 0), p.get("height_m", 0)))
    return {"schema": SCHEMA, "source": "OpenStreetMap contributors, ODbL (Simple 3D Buildings tags)",
            "fetched": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "bbox": bbox,
            "counts": {**counts, "buildings": len(shapes)}, "buildings": shapes, "extra": extras}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--region", action="append", required=True)
    parser.add_argument("--elements", type=Path, help="reuse an Overpass answer saved earlier")
    parser.add_argument("--save-elements", type=Path)
    args = parser.parse_args()
    for region in args.region:
        out_dir = folder(region)
        payload = json.loads((out_dir / "sf-corridor-3d.json").read_text())
        bbox = payload["bbox"]
        elements = json.loads(args.elements.read_text()) if args.elements else fetch(bbox)
        if args.save_elements:
            args.save_elements.write_text(json.dumps(elements))
        buildings = [w for w in payload["ways"] if w.get("kind") == "building" and w.get("points")]
        result = build(elements, buildings, bbox)
        text = json.dumps(result, separators=(",", ":"))
        targets = [out_dir]
        app = ROOT / "docs/app-regions" / region
        if region != "sf-corridor" and (app / "sf-corridor-3d.json").exists():
            targets.append(app)
        for target in targets:
            (target / "sf-corridor-building-shapes.json").write_text(text)
        print(region, result["counts"], f"{len(text) / 1e6:.2f} MB", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
