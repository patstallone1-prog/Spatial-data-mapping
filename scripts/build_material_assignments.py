#!/usr/bin/env python3
"""Publish only high-confidence photo-inferred cladding classes for visual use."""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LABELS = ROOT / "data/sf_public_works/material_labels.json"
MODEL = ROOT / "docs/sf-corridor-3d.json"
OUT = ROOT / "docs/sf-corridor-materials.json"
MIN_CONFIDENCE = 0.70
SUPPORTED = {"brick", "concrete", "stucco_render", "wood_siding", "stone"}


def build() -> dict:
    labels = json.loads(LABELS.read_text())["facades"]
    ways = {str(way["osm_id"]): way for way in json.loads(MODEL.read_text())["ways"]
            if way.get("kind") == "building" and way.get("osm_id") is not None}
    assigned = {}
    skipped: Counter[str] = Counter()
    for osm_id, label in labels.items():
        material, confidence = label[:2]
        way = ways.get(osm_id)
        if way is None:
            skipped["missing_building"] += 1
            continue
        if material not in SUPPORTED or float(confidence) < MIN_CONFIDENCE:
            skipped["unknown_or_low_confidence"] += 1
            continue
        facade = way.get("facade") or {}
        if facade.get("m") in {"glass", "metal"} and facade.get("conf", 0) >= 0.6:
            skipped["glass_or_metal_conflict"] += 1
            continue
        assigned[osm_id] = {"class": material, "confidence": round(float(confidence), 3),
                            "basis": "image_inferred_not_material_truth"}
    payload = {"schema": "kerbside.material_assignments/1",
               "source": "data/sf_public_works/material_labels.json",
               "min_confidence": MIN_CONFIDENCE,
               "assigned": assigned, "counts": dict(Counter(v["class"] for v in assigned.values())),
               "skipped": dict(skipped)}
    OUT.write_text(json.dumps(payload, separators=(",", ":")) + "\n")
    return payload


if __name__ == "__main__":
    result = build()
    print(result["counts"])
    print(result["skipped"])
