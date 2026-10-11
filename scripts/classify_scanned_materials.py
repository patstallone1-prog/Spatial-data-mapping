#!/usr/bin/env python3
"""Read every reconstructed house's photographs for what it is clad in.

The corridor's materials were read off the facade survey's pictures (build_facade_photo_materials,
CLIP zero-shot against a sentence per cladding class): 3,687 buildings, all in the corridor, and
136 of the reconstructed houses. This reads the photographs the frontage run kept instead -- every
view of every reconstructed house, in every region -- with the same model and the same sentences:

  the wall only   each view is cut to the assigned house (house_extent: the neighbour put aside)
                  and to the pixels the segmentation calls wall; glass, sky, cars and trees are
                  greyed out before CLIP reads it
  every view      the views of one house are pooled, weighted by how much wall each showed
  only if clear   a class is kept where the pooled probability is at least MIN_CONFIDENCE and
                  MIN_MARGIN ahead of the next (the corridor pass's thresholds)

Output: ``<matcher output>/materials.json`` -- per house its class, probability, margin and the
views read -- which the matcher lays over the published fits (appearance.material). Resumable:
each view's reading is journalled by image hash and never read twice. With --watch-seconds it
keeps reading houses as they are reconstructed.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import runpy
import sys
import time
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from smc.facades.house_extent import assigned_house, isolate  # noqa: E402

_CORRIDOR = runpy.run_path(str(ROOT / "scripts/build_facade_photo_materials.py"))
MODEL, PROMPTS = _CORRIDOR["MODEL"], _CORRIDOR["PROMPTS"]
MIN_CONFIDENCE, MIN_MARGIN = _CORRIDOR["MIN_CONFIDENCE"], _CORRIDOR["MIN_MARGIN"]
#: A house is not a glass curtain wall: that sentence stays in the vocabulary so CLIP has
#: somewhere to put an office front, but it is never a house's class.
HOUSE_CLASSES = [c for c in PROMPTS if c != "glass_curtain_wall"]
WALL_CLASSES = (0, 1, 25)
MIN_WALL_SHARE = 0.15


def wall_width(view: Path) -> float | None:
    try:
        wall = json.loads(view.read_text())["candidate"]["wall"]
        return float(np.hypot(wall["b"][0] - wall["a"][0], wall["b"][1] - wall["a"][1]))
    except (OSError, ValueError, KeyError, TypeError):
        return None


def wall_view(image: np.ndarray, labels: np.ndarray, width_m: float) -> tuple[np.ndarray, float] | None:
    """The assigned house's wall, everything else grey, and the share of the frame it is."""
    house = assigned_house(image, labels, width_m)
    image, labels, _, _ = isolate(image, labels, width_m, None, house)
    wall = np.isin(labels, WALL_CLASSES)
    share = float(wall.mean())
    if share < MIN_WALL_SHARE:
        return None
    out = np.where(wall[..., None], image, 128).astype(np.uint8)
    ys, xs = np.nonzero(wall)
    return out[ys.min():ys.max() + 1, xs.min():xs.max() + 1], share


class Reader:
    def __init__(self, device: str):
        import torch
        from transformers import CLIPModel, CLIPProcessor

        self.torch = torch
        self.device = device
        self.model = CLIPModel.from_pretrained(MODEL).to(device).eval()
        self.processor = CLIPProcessor.from_pretrained(MODEL)
        self.classes = list(PROMPTS)
        sentences = [s for c in self.classes for s in PROMPTS[c]]
        self.owner = np.array([self.classes.index(c) for c in self.classes for _ in PROMPTS[c]])
        with torch.no_grad():
            text = self.processor(text=sentences, return_tensors="pt", padding=True).to(device)
            t = self.model.text_projection(self.model.text_model(**text).pooler_output)
            self.text = t / t.norm(dim=-1, keepdim=True)

    def read(self, pictures: list[np.ndarray]) -> list[dict[str, float]]:
        torch = self.torch
        rgb = [cv2.cvtColor(p, cv2.COLOR_BGR2RGB) for p in pictures]
        with torch.no_grad():
            pixels = self.processor(images=rgb, return_tensors="pt").to(self.device)
            v = self.model.visual_projection(self.model.vision_model(pixel_values=pixels["pixel_values"]).pooler_output)
            v = v / v.norm(dim=-1, keepdim=True)
            logits = (100.0 * v @ self.text.T).cpu().numpy()
        out = []
        for row in logits:
            # A class's score is its best sentence; softmax across classes.
            per_class = np.array([row[self.owner == i].max() for i in range(len(self.classes))])
            p = np.exp(per_class - per_class.max())
            p /= p.sum()
            out.append({c: float(x) for c, x in zip(self.classes, p, strict=True)})
        return out


def house_views(review_roots: list[Path], region: str, building_id: str) -> list[Path]:
    views = []
    for root in review_roots:
        for path in sorted((root / "review").glob(f"{region}-{building_id}-*.json")):
            if path.with_suffix(".jpg").is_file() and path.with_suffix(".labels.png").is_file():
                views.append(path)
    return views


def decide(readings: list[tuple[dict, float]]) -> dict | None:
    if not readings:
        return None
    total = sum(w for _, w in readings)
    pooled = {c: sum(r[c] * w for r, w in readings) / total for c in HOUSE_CLASSES}
    ranked = sorted(pooled.items(), key=lambda kv: -kv[1])
    (best, p), (_, second) = ranked[0], ranked[1]
    if p < MIN_CONFIDENCE or p - second < MIN_MARGIN:
        return {"class": None, "p": round(p, 3), "margin": round(p - second, 3), "views": len(readings),
                "reason": "not_clear_enough"}
    return {"class": best, "p": round(p, 3), "margin": round(p - second, 3), "views": len(readings),
            "basis": "image_clip_zero_shot_scanned_views", "model": MODEL}


def one_pass(args, reader: Reader) -> dict:
    out_path = args.matcher_output / "materials.json"
    journal_path = args.matcher_output / "materials-journal.jsonl"
    journal = {}
    if journal_path.exists():
        for line in journal_path.open():
            try:
                row = json.loads(line)
                journal[row["image"]] = row
            except (ValueError, KeyError):
                continue
    houses = sorted((args.matcher_output / "houses").glob("*/*.json"))
    result, read_now = {}, 0
    queue: list[tuple[str, Path, str]] = []
    plan: dict[str, list[tuple[str, Path]]] = {}
    for house in houses:
        region, building_id = house.parent.name, house.stem
        key = f"{region}:{building_id}"
        for view in house_views(args.reviews, region, building_id):
            digest = hashlib.sha256(view.with_suffix(".jpg").read_bytes()).hexdigest()
            plan.setdefault(key, []).append((digest, view))
            if digest not in journal:
                queue.append((digest, view, key))
    with journal_path.open("a") as log:
        for start in range(0, len(queue), args.batch):
            chunk = queue[start:start + args.batch]
            pictures, kept = [], []
            for digest, view, _ in chunk:
                image = cv2.imread(str(view.with_suffix(".jpg")))
                labels = cv2.imread(str(view.with_suffix(".labels.png")), cv2.IMREAD_GRAYSCALE)
                width_m = wall_width(view)
                cut = (wall_view(image, labels, width_m)
                       if image is not None and labels is not None and width_m else None)
                if cut is None:
                    journal[digest] = {"image": digest, "reading": None, "weight": 0}
                    log.write(json.dumps(journal[digest]) + "\n")
                    continue
                pictures.append(cut[0])
                kept.append((digest, cut[1]))
            for (digest, weight), reading in zip(kept, reader.read(pictures) if pictures else [], strict=True):
                journal[digest] = {"image": digest, "reading": reading, "weight": weight}
                log.write(json.dumps(journal[digest]) + "\n")
                read_now += 1
            log.flush()
    for key, views in plan.items():
        readings = [(journal[d]["reading"], journal[d]["weight"]) for d, _ in views
                    if journal.get(d, {}).get("reading")]
        decided = decide(readings)
        if decided:
            result[key] = decided
    classes: dict[str, int] = {}
    for r in result.values():
        if r.get("class"):
            classes[r["class"]] = classes.get(r["class"], 0) + 1
    payload = {"schema": "kerbside.scanned_house_materials/1", "model": MODEL, "houses": result,
               "summary": {"houses_read": len(result), "classified": sum(classes.values()), "classes": classes}}
    tmp = out_path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, indent=1))
    os.replace(tmp, out_path)
    return {"read_now": read_now, **payload["summary"]}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--matcher-output", type=Path, default=ROOT / "build/facade-match")
    ap.add_argument("--reviews", type=Path, nargs="+",
                    default=[ROOT / "build/frontage-live", ROOT / "build/frontage-pilot-v2"])
    ap.add_argument("--device", default="mps")
    ap.add_argument("--batch", type=int, default=32)
    ap.add_argument("--watch-seconds", type=int, default=0)
    args = ap.parse_args()
    reader = Reader(args.device)
    while True:
        print(json.dumps(one_pass(args, reader)), flush=True)
        if not args.watch_seconds:
            return 0
        time.sleep(args.watch_seconds)


if __name__ == "__main__":
    raise SystemExit(main())
