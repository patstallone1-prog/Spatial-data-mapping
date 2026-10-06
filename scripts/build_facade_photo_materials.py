#!/usr/bin/env python3
"""Read each photographed wall for what it is clad in and what colour it is painted.

The facade survey (scripts/build_facades.py) hangs a rectified photograph on every wall a camera
saw squarely: 13,567 of them in the corridor. This reads each of those pictures twice:

* **cladding** -- CLIP (openai/clip-vit-base-patch32), zero-shot, against a sentence per class
  in the renderer's material vocabulary (stucco, clapboard and vinyl siding, brick, painted
  brick, stone, concrete, tile, metal). The matcher behind material_labels.json was fitted to 39
  walls and knows five classes, none of them wood; this is a second, independent reading with a
  far wider vocabulary. Grade ``image_clip_zero_shot``: a model's reading of a photograph, not a
  survey of the wall.
* **colour** -- the median of the wall pixels that are neither glass (dark), sky or glare
  (bright and grey) nor the black fill of a wall the cameras did not see.

Per building, the walls' readings are pooled (weighted by how much of each wall was seen and how
well its views agreed). A building whose pooled reading is confident gets a class; a building
with walls read gets a colour.

Resumable: every wall read is appended to a journal (build/facade-photo-materials/<region>.jsonl,
flushed per wall) and a restart skips walls already in it. Output beside the region's other
official records: ``facade_photo_materials.json``.

    nohup .venv/bin/python scripts/build_facade_photo_materials.py --region sf-corridor \\
        > build/facade-photo-materials.log 2>&1 &
"""

from __future__ import annotations

import argparse
import itertools
import json
import math
import sys
import time
from collections import defaultdict
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from smc.regions.paths import region_paths  # noqa: E402

MODEL = "openai/clip-vit-base-patch32"
#: The renderer's photographed classes, each as a sentence CLIP reads a picture against.
PROMPTS = {
    "stucco_render": ["a photo of a house wall of smooth painted stucco",
                      "a photo of a plastered render facade"],
    "wood_siding": ["a photo of a house wall of horizontal wooden clapboard siding",
                    "a photo of a painted wooden siding facade"],
    "vinyl_siding": ["a photo of a house wall with vinyl siding",
                     "a photo of a facade clad in plastic lap siding"],
    "brick": ["a photo of a red brick wall", "a photo of an exposed brick facade"],
    "painted_brick": ["a photo of a painted brick wall", "a photo of a facade of brick painted over"],
    "stone": ["a photo of a stone masonry wall", "a photo of a facade of cut stone blocks"],
    "concrete": ["a photo of a bare concrete wall", "a photo of a concrete facade"],
    "ceramic_tile": ["a photo of a facade covered in ceramic tiles"],
    "metal_panel": ["a photo of a facade clad in metal panels"],
    "glass_curtain_wall": ["a photo of a glass curtain wall office facade"],
}
#: A building is given a class when its pooled probability is at least this, and at least
#: MIN_MARGIN ahead of the next class.
MIN_CONFIDENCE = 0.45
MIN_MARGIN = 0.12
#: Wall pixels: the rectified photograph's unseen parts are filled black; glass reads dark;
#: sky and glare read bright and grey. Thresholds on 0-255 values.
UNSEEN_MAX = 12
GLASS_MAX_LUMA = 55
GLARE_MIN_LUMA = 235
MIN_WALL_PIXELS = 1500


def wall_colour(image: Image.Image) -> tuple[list[int], float] | None:
    """The median colour of the pixels that are wall, and the share of the picture they are."""
    px = np.asarray(image.convert("RGB"), dtype=np.float32)
    luma = px @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    seen = px.max(axis=2) > UNSEEN_MAX
    spread = px.max(axis=2) - px.min(axis=2)
    wall = seen & (luma > GLASS_MAX_LUMA) & ~((luma > GLARE_MIN_LUMA) & (spread < 18))
    if wall.sum() < MIN_WALL_PIXELS:
        return None
    median = np.median(px[wall], axis=0)
    return [round(float(v)) for v in median], float(wall.sum() / max(1, seen.sum()))


def building_edges(page: Path) -> dict[tuple[int, int], list[tuple]]:
    """Every building edge, indexed by its endpoints on a 2 m grid, to put walls back on the
    buildings they are of (the manifest's building index is the payload order at the time the
    chunk was textured, which has moved since)."""
    ways = json.loads(page.read_text())["ways"]
    mid_lat = sum(w["centroid"][1] for w in ways if w.get("centroid")) / max(1, sum(1 for w in ways if w.get("centroid")))
    kx = 111320.0 * math.cos(math.radians(mid_lat))
    index: dict[tuple[int, int], list[tuple]] = defaultdict(list)
    for way in ways:
        if way.get("kind") != "building" or way.get("osm_id") is None or not way.get("points"):
            continue
        pts = [(lon * kx, lat * 111320.0) for lon, lat in way["points"]]
        for (ax, ay), (bx, by) in itertools.pairwise(pts):
            cell = (int(ax // 2), int(ay // 2))
            index[cell].append((ax, ay, bx, by, str(way["osm_id"])))
    index["_k"] = [(kx,)]
    return index


def match_building(index: dict, a: list[float], b: list[float]) -> str | None:
    kx = index["_k"][0][0]
    ax, ay, bx, by = a[0] * kx, a[1] * 111320.0, b[0] * kx, b[1] * 111320.0
    best = None
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for ex, ey, fx, fy, osm_id in index.get((int(ax // 2) + dx, int(ay // 2) + dy), []):
                forward = max(math.hypot(ax - ex, ay - ey), math.hypot(bx - fx, by - fy))
                reverse = max(math.hypot(ax - fx, ay - fy), math.hypot(bx - ex, by - ey))
                error = min(forward, reverse)
                if error < 1.0 and (best is None or error < best[0]):
                    best = (error, osm_id)
    return best[1] if best else None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--region", default="sf-corridor")
    ap.add_argument("--batch", type=int, default=32)
    ap.add_argument("--limit", type=int, default=None)
    args = ap.parse_args()
    paths = region_paths(args.region)
    facade_root = paths.site / "facades"
    journal_path = ROOT / "build" / "facade-photo-materials" / f"{args.region}.jsonl"
    journal_path.parent.mkdir(parents=True, exist_ok=True)
    out_path = paths.official / "facade_photo_materials.json"

    done: dict[str, dict] = {}
    if journal_path.exists():
        for line in journal_path.read_text().splitlines():
            row = json.loads(line)
            done[row["texture"]] = row
    walls = []
    for manifest in sorted(facade_root.glob("*/manifest.json")):
        chunk = manifest.parent.name
        for wall in json.loads(manifest.read_text())["walls"]:
            walls.append((f"{chunk}/{wall['texture']}", wall))
    todo = [(key, wall) for key, wall in walls if key not in done]
    if args.limit:
        todo = todo[: args.limit]
    print(f"{args.region}: {len(walls)} photographed walls, {len(done)} read, {len(todo)} to read", flush=True)

    if todo:
        import torch
        from transformers import CLIPModel, CLIPProcessor

        device = "mps" if torch.backends.mps.is_available() else "cpu"
        model = CLIPModel.from_pretrained(MODEL).to(device).eval()
        processor = CLIPProcessor.from_pretrained(MODEL)
        classes = list(PROMPTS)
        sentences = [s for c in classes for s in PROMPTS[c]]
        owner = [c for c in classes for _ in PROMPTS[c]]
        with torch.no_grad():
            text = processor(text=sentences, return_tensors="pt", padding=True).to(device)
            # CLIP's own projection of its pooled outputs (what get_*_features returns, spelled
            # out: the helper's return type changed between transformers releases).
            t = model.text_projection(model.text_model(**text).pooler_output)
            t = t / t.norm(dim=-1, keepdim=True)
            # One embedding per class: its sentences averaged.
            class_text = torch.stack([t[[i for i, o in enumerate(owner) if o == c]].mean(0) for c in classes])
            class_text = class_text / class_text.norm(dim=-1, keepdim=True)
        index = building_edges(paths.page)
        started = time.time()
        with journal_path.open("a") as journal:
            for start in range(0, len(todo), args.batch):
                rows = todo[start: start + args.batch]
                images, keep = [], []
                for key, wall in rows:
                    try:
                        image = Image.open(facade_root / key).convert("RGB")
                    except OSError:
                        continue
                    images.append(image)
                    keep.append((key, wall, image))
                if not images:
                    continue
                with torch.no_grad():
                    pixels = processor(images=images, return_tensors="pt").to(device)
                    v = model.visual_projection(model.vision_model(pixel_values=pixels["pixel_values"]).pooler_output)
                    v = v / v.norm(dim=-1, keepdim=True)
                    probs = (100.0 * v @ class_text.T).softmax(dim=-1).cpu().numpy()
                for (key, wall, image), p in zip(keep, probs, strict=True):
                    colour = wall_colour(image)
                    row = {"texture": key, "building": match_building(index, wall["a"], wall["b"]),
                           "weight": round(float(wall.get("coverage", 1.0)) * float(wall.get("agreement", 0.75)), 3),
                           "probs": {c: round(float(x), 4) for c, x in zip(classes, p, strict=True)},
                           "colour": colour[0] if colour else None,
                           "wall_share": round(colour[1], 3) if colour else None}
                    journal.write(json.dumps(row) + "\n")
                    journal.flush()
                    done[key] = row
                n = start + len(rows)
                if n % (args.batch * 20) < args.batch:
                    rate = n / max(1e-6, time.time() - started)
                    print(f"  {n}/{len(todo)} walls read ({rate:.1f}/s)", flush=True)

    # Pool per building.
    pooled: dict[str, dict] = defaultdict(lambda: {"w": 0.0, "probs": defaultdict(float), "colours": [], "walls": 0})
    for row in done.values():
        if not row.get("building"):
            continue
        b = pooled[row["building"]]
        w = max(0.05, row["weight"])
        b["w"] += w
        b["walls"] += 1
        for c, x in row["probs"].items():
            b["probs"][c] += w * x
        if row.get("colour"):
            b["colours"].append(row["colour"])
    buildings = {}
    for osm_id, b in pooled.items():
        probs = sorted(((x / b["w"], c) for c, x in b["probs"].items()), reverse=True)
        (top, cls), (second, _) = probs[0], probs[1]
        record = {"walls": b["walls"], "top": cls, "p": round(top, 3), "margin": round(top - second, 3)}
        if top >= MIN_CONFIDENCE and top - second >= MIN_MARGIN:
            record["class"] = cls
        if b["colours"]:
            median = np.median(np.array(b["colours"], dtype=np.float32), axis=0)
            record["colour"] = "#{:02x}{:02x}{:02x}".format(*(round(float(v)) for v in median))
        buildings[osm_id] = record
    payload = {"schema": "kerbside.facade_photo_materials/1", "region": args.region,
               "model": MODEL, "grade": "image_clip_zero_shot",
               "min_confidence": MIN_CONFIDENCE, "min_margin": MIN_MARGIN,
               "walls_read": len(done), "walls_total": len(walls),
               "buildings": buildings}
    out_path.write_text(json.dumps(payload, separators=(",", ":")) + "\n")
    classes_given = defaultdict(int)
    for r in buildings.values():
        classes_given[r.get("class", "unclassified")] += 1
    print(f"{args.region}: {len(buildings)} buildings read; classes {dict(classes_given)}; "
          f"{sum(1 for r in buildings.values() if r.get('colour'))} with a colour", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
