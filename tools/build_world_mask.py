#!/usr/bin/env python3
"""The world's land and water, for the globe the view zooms out to (docs/globe.mjs).

Natural Earth's 1:50m land with its lakes cut out (public domain, naturalearthdata.com),
rasterised to an equirectangular grey mask: 255 land, 0 water, antialiased at the coast.
Nothing in it is drawn at street scale -- the Bay's own atlas covers the region itself.

    .venv/bin/python tools/build_world_mask.py "/Volumes/HP P700 1/Kerbside/natural-earth"
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
WIDTH, HEIGHT, SUPER = 8192, 4096, 2


def rings(geometry):
    polygons = geometry["coordinates"] if geometry["type"] == "MultiPolygon" else [geometry["coordinates"]]
    for polygon in polygons:
        yield polygon[0], polygon[1:]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("source", type=Path, help="folder holding ne_50m_land.geojson and ne_50m_lakes.geojson")
    parser.add_argument("--out", type=Path, default=ROOT / "docs/world/land-mask.png")
    args = parser.parse_args()
    w, h = WIDTH * SUPER, HEIGHT * SUPER
    image = Image.new("L", (w, h), 0)
    draw = ImageDraw.Draw(image)

    def px(ring):
        return [((lon + 180) / 360 * w, (90 - lat) / 180 * h) for lon, lat in ring]

    for name, fill in (("ne_50m_land", 255), ("ne_50m_lakes", 0)):
        data = json.loads((args.source / f"{name}.geojson").read_text())
        for feature in data["features"]:
            for outer, holes in rings(feature["geometry"]):
                draw.polygon(px(outer), fill=fill)
                for hole in holes:
                    draw.polygon(px(hole), fill=255 - fill)
    image = image.resize((WIDTH, HEIGHT), Image.Resampling.BOX)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    image.save(args.out, optimize=True)
    digest = hashlib.sha256(args.out.read_bytes()).hexdigest()
    (args.out.with_suffix(".json")).write_text(json.dumps({
        "schema": 1, "file": args.out.name, "sha256": digest, "width": WIDTH, "height": HEIGHT,
        "projection": "equirectangular, lon -180..180 left to right, lat 90..-90 top to bottom",
        "values": "255 land, 0 water (lakes cut out), antialiased",
        "source": "Natural Earth 1:50m land and lakes (ne_50m_land, ne_50m_lakes)",
        "license": "public domain (naturalearthdata.com/about/terms-of-use)"}, indent=1) + "\n")
    print(args.out, args.out.stat().st_size, digest[:12])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
