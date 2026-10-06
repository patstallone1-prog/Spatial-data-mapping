#!/usr/bin/env python3
"""Publish only high-confidence photo-inferred cladding classes (and wall colours) for visual use.

Two readings of the same photographs feed this:

* ``material_labels.json`` -- the fingerprint matcher (smc.facades.match), fitted to 39 walls,
  five classes; taken at confidence >= MIN_CONFIDENCE.
* ``facade_photo_materials.json`` -- CLIP read zero-shot over every photographed wall
  (scripts/build_facade_photo_materials.py), ten classes including clapboard and vinyl siding,
  painted brick, tile and metal; taken where it was confident and clear of its second guess.

Where both read a building, CLIP's wider vocabulary wins. A building the photographs give a
colour gets it here too (``colour``): the page uses it where the payload has no sampled colour.
"""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LABELS = ROOT / "data/sf_public_works/material_labels.json"
PHOTO = ROOT / "data/sf_public_works/facade_photo_materials.json"
MODEL = ROOT / "docs/sf-corridor-3d.json"
OUT = ROOT / "docs/sf-corridor-materials.json"
MIN_CONFIDENCE = 0.70
#: The classes the page has photographed materials for (scripts/build_material_library.py).
SUPPORTED = {"brick", "concrete", "stucco_render", "wood_siding", "stone", "vinyl_siding",
             "painted_brick", "ceramic_tile", "metal_panel"}


def build() -> dict:
    labels = json.loads(LABELS.read_text())["facades"]
    photo = json.loads(PHOTO.read_text())["buildings"] if PHOTO.exists() else {}
    ways = {str(way["osm_id"]): way for way in json.loads(MODEL.read_text())["ways"]
            if way.get("kind") == "building" and way.get("osm_id") is not None}
    assigned = {}
    skipped: Counter[str] = Counter()
    sources: Counter[str] = Counter()
    for osm_id in sorted(set(labels) | set(photo)):
        way = ways.get(osm_id)
        if way is None:
            skipped["missing_building"] += 1
            continue
        reading = photo.get(osm_id, {})
        material, confidence, basis = None, 0.0, None
        if reading.get("class") in SUPPORTED:
            material, confidence, basis = reading["class"], reading["p"], "image_clip_zero_shot"
        elif osm_id in labels:
            label, conf = labels[osm_id][:2]
            if label in SUPPORTED and float(conf) >= MIN_CONFIDENCE:
                material, confidence, basis = label, float(conf), "image_inferred_not_material_truth"
        facade = way.get("facade") or {}
        if material and facade.get("m") in {"glass", "metal"} and facade.get("conf", 0) >= 0.6 \
                and material != "metal_panel":
            skipped["glass_or_metal_conflict"] += 1
            material = None
        row = {}
        if material:
            row = {"class": material, "confidence": round(float(confidence), 3), "basis": basis}
            sources[basis] += 1
        elif osm_id in labels or reading:
            skipped["unknown_or_low_confidence"] += 1
        if reading.get("colour"):
            row["colour"] = reading["colour"]
        if row:
            assigned[osm_id] = row
    payload = {"schema": "kerbside.material_assignments/2",
               "source": [str(LABELS.relative_to(ROOT)), str(PHOTO.relative_to(ROOT))],
               "min_confidence": MIN_CONFIDENCE,
               "assigned": assigned,
               "counts": dict(Counter(v["class"] for v in assigned.values() if "class" in v)),
               "colours": sum(1 for v in assigned.values() if "colour" in v),
               "sources": dict(sources), "skipped": dict(skipped)}
    OUT.write_text(json.dumps(payload, separators=(",", ":")) + "\n")
    return payload


if __name__ == "__main__":
    result = build()
    print(result["counts"], "colours:", result["colours"])
    print(result["sources"], result["skipped"])
