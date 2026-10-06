#!/usr/bin/env python3
"""Fetch rights-clear 2K photographed wall materials with immutable provenance.

Poly Haven publishes these assets under CC0. They are appearance references, not
photographs of a particular San Francisco building and never evidence of its class.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import urllib.request
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs/materials"
API = "https://api.polyhaven.com"
ASSETS = {
    "brick": ("brick_wall_001", "brick_wall_003", "brick_wall_005", "red_brick", "brick_wall_10"),
    "concrete": ("concrete_wall_001", "concrete_wall_004", "concrete_wall_007", "painted_concrete",
                 "concrete_panels"),
    "stucco_render": ("plastered_wall_02", "plastered_wall_04", "rough_plaster_03", "white_stucco",
                      "white_rough_plaster"),
    "wood_siding": ("wood_plank_wall", "wood_planks_grey", "wooden_rough_planks",
                    "weathered_plank_siding", "white_planks_clean"),
    "stone": ("stone_wall", "stone_wall_03", "sandstone_brick_wall_01", "stacked_stone_wall",
              "granite_wall"),
    # Classes the facade photographs are now read for (scripts/build_facade_photo_materials.py).
    "vinyl_siding": ("exterior_wall_cladding", "exterior_wall_cladding_02", "exterior_wall_cladding_03"),
    "painted_brick": ("painted_brick", "whitewashed_brick", "painted_worn_brick"),
    "ceramic_tile": ("rectangular_facade_tiles", "rectangular_facade_tiles_02", "square_tiled_wall"),
    "metal_panel": ("box_profile_metal_sheet", "metal_plate", "blue_metal_plate"),
}
#: The page paints a material onto a 256-pixel canvas; a 2K picture is eight times what it can
#: show. New images are kept at this size (the 2K source is still what is checksummed).
STORED_PX = 1024


def _get(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "Kerbside material library"})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


def build(classes: set[str] | None = None) -> dict:
    OUT.mkdir(parents=True, exist_ok=True)
    old_path = OUT / "manifest.json"
    old = json.loads(old_path.read_text()) if old_path.exists() else {"assets": []}
    by_id = {row["id"]: row for row in old["assets"]}
    for material, names in ASSETS.items():
        if classes is not None and material not in classes:
            continue
        for name in names:
            info = json.loads(_get(f"{API}/info/{name}"))
            files = json.loads(_get(f"{API}/files/{name}"))
            source = files["Diffuse"]["2k"]["jpg"]
            target = OUT / f"{name}.jpg"
            known = by_id.get(name)
            if target.exists() and hashlib.md5(target.read_bytes()).hexdigest() == source["md5"]:
                print(f"verified {target.name}", flush=True)
            elif (target.exists() and known and known.get("source_md5") == source["md5"]
                  and known.get("sha256") == hashlib.sha256(target.read_bytes()).hexdigest()):
                print(f"verified {target.name} (stored at {STORED_PX} px)", flush=True)
            else:
                raw = _get(source["url"])
                if hashlib.md5(raw).hexdigest() != source["md5"]:
                    raise ValueError(f"Poly Haven checksum mismatch: {name}")
                staged = target.with_suffix(".src.jpg")
                staged.write_bytes(raw)
                with Image.open(staged) as image:
                    if min(image.size) < 2000:
                        raise ValueError(f"{name}: not a 2K wall texture")
                    image.convert("RGB").resize((STORED_PX, STORED_PX), Image.LANCZOS).save(
                        target.with_suffix(".jpg.tmp"), "JPEG", quality=88, optimize=True)
                staged.unlink()
                target.with_suffix(".jpg.tmp").replace(target)
                print(f"downloaded {name}: {len(raw):,} bytes, stored at {STORED_PX} px", flush=True)
            with Image.open(target) as image:
                dimensions = list(image.size)
            by_id[name] = {
                "id": name, "material_class": material, "file": target.name,
                "pixels": dimensions, "physical_scale": info.get("scale"),
                "sha256": hashlib.sha256(target.read_bytes()).hexdigest(),
                "source_url": source["url"], "source_md5": source["md5"],
                "source_info_url": f"{API}/info/{name}",
                "source_authors": info.get("authors", {}),
                "license": "CC0-1.0", "role": "visual_material_reference_only",
            }
            payload = {"schema": "kerbside.material_library/1", "source": "Poly Haven",
                       "license": "CC0-1.0", "assets": sorted(by_id.values(), key=lambda a: a["id"])}
            # Each asset becomes durable as soon as its pixels and provenance verify.
            staged = old_path.with_suffix(".json.tmp")
            staged.write_text(json.dumps(payload, indent=2) + "\n")
            staged.replace(old_path)
    return json.loads(old_path.read_text())


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--class", dest="classes", action="append", choices=ASSETS)
    args = parser.parse_args()
    result = build(set(args.classes) if args.classes else None)
    print(f"{len(result['assets'])} verified material images", flush=True)


if __name__ == "__main__":
    main()
