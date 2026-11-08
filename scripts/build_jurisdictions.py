"""The Bay Area's counties and incorporated cities as outlines, for the living city's
"where am I" (docs/city/jurisdictions.json).

The city's rules held the cities as rough boxes and called anywhere outside one "San Francisco
County": the Marin Headlands were San Francisco (its box ran to 37.84 N) and Mill Valley was in
San Francisco County. These are OpenStreetMap's administrative boundaries -- counties
(admin_level 6) and cities and towns (admin_level 8) -- simplified to about 30 m.

    PYTHONPATH=src .venv/bin/python scripts/build_jurisdictions.py --pbf norcal-latest.osm.pbf
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
#: The Bay Area: [west, south, east, north].
BBOX = (-123.2, 36.9, -121.2, 38.6)
TOLERANCE_DEG = 0.0003  # about 30 m


def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def simplify(ring: list[tuple[float, float]], tol: float) -> list[tuple[float, float]]:
    """Douglas-Peucker on an open polyline (the ring's closing point repeated at the end)."""
    if len(ring) < 4:
        return ring
    keep = [False] * len(ring)
    keep[0] = keep[-1] = True
    stack = [(0, len(ring) - 1)]
    while stack:
        a, b = stack.pop()
        (ax, ay), (bx, by) = ring[a], ring[b]
        dx, dy = bx - ax, by - ay
        length = (dx * dx + dy * dy) ** 0.5
        worst, at = 0.0, -1
        for i in range(a + 1, b):
            px, py = ring[i]
            d = abs(dy * (px - ax) - dx * (py - ay)) / length if length else ((px - ax) ** 2 + (py - ay) ** 2) ** 0.5
            if d > worst:
                worst, at = d, i
        if worst > tol and at > 0:
            keep[at] = True
            stack += [(a, at), (at, b)]
    return [p for p, k in zip(ring, keep, strict=True) if k]


def extract(pbf: Path) -> list[dict]:
    import osmium

    found: list[dict] = []

    class Boundaries(osmium.SimpleHandler):
        def area(self, a):  # noqa: D401 - osmium callback
            tags = a.tags
            if tags.get("boundary") != "administrative" or tags.get("admin_level") not in ("6", "8") or not tags.get("name"):
                return
            rings = []
            try:
                for outer in a.outer_rings():
                    pts = [(round(n.lon, 5), round(n.lat, 5)) for n in outer]
                    rings.append(simplify(pts, TOLERANCE_DEG))
            except osmium.InvalidLocationError:
                return
            if not rings:
                return
            xs = [p[0] for r in rings for p in r]
            ys = [p[1] for r in rings for p in r]
            box = [min(xs), min(ys), max(xs), max(ys)]
            if box[2] < BBOX[0] or box[0] > BBOX[2] or box[3] < BBOX[1] or box[1] > BBOX[3]:
                return
            found.append({"level": int(tags["admin_level"]), "name": tags["name"], "box": box, "rings": rings,
                          "osm": f"{'relation' if a.from_way() is False else 'way'}/{a.orig_id()}"})

    Boundaries().apply_file(str(pbf), locations=True, idx="flex_mem")
    return found


def assemble(found: list[dict]) -> dict:
    # A county by its level (San Francisco's is "San Francisco": a city and county in one).
    counties = [f for f in found if f["level"] == 6]
    cities = [f for f in found if f["level"] == 8]

    def inside(x: float, y: float, rings: list) -> bool:
        hit = False
        for ring in rings:
            for i in range(len(ring)):
                (ax, ay), (bx, by) = ring[i], ring[i - 1]
                if (ay > y) != (by > y) and x < (bx - ax) * (y - ay) / (by - ay) + ax:
                    hit = not hit
        return hit

    out_counties = [{"id": f"county:{slug(c['name'].removesuffix(' County'))}", "name": c["name"].removesuffix(" County"),
                     "box": c["box"], "rings": c["rings"]} for c in sorted(counties, key=lambda c: c["name"])]
    out_cities = []
    for c in sorted(cities, key=lambda c: c["name"]):
        # The county a city is in: the one holding the middle of its box (else its first corner).
        cx, cy = (c["box"][0] + c["box"][2]) / 2, (c["box"][1] + c["box"][3]) / 2
        county = next((k["id"] for k in out_counties if inside(cx, cy, k["rings"])), None)
        county = county or next((k["id"] for k in out_counties if inside(*c["rings"][0][0], k["rings"])), None)
        out_cities.append({"id": f"city:{slug(c['name'])}", "name": c["name"], "county": county, "box": c["box"], "rings": c["rings"]})
    return {"counties": out_counties, "cities": out_cities}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--pbf", type=Path, required=True)
    parser.add_argument("--out", type=Path, default=ROOT / "docs/city/jurisdictions.json")
    args = parser.parse_args()
    data = assemble(extract(args.pbf))
    data = {"schema": 1, "basis": "OpenStreetMap administrative boundaries: counties (admin_level 6) and incorporated cities and towns "
            "(admin_level 8), outer rings simplified to about 30 m; unincorporated land is its county's",
            "attribution": "© OpenStreetMap contributors", "license": "ODbL-1.0",
            "extract_sha256": hashlib.sha256(args.pbf.read_bytes()).hexdigest(), **data}
    args.out.write_text(json.dumps(data, separators=(",", ":")) + "\n")
    print(f"{len(data['counties'])} counties, {len(data['cities'])} cities -> {args.out} ({args.out.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
