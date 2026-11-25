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

A third reading outranks both: the storefront lab's Opus reader (smc.exteriors.wall_materials).
It read the wall itself apart from its windows and doors, so its background material and
colour stand for the whole shell, every side of it. Every building it read is logged to
``opus_wall_materials.json``. Restaurants and shops nobody read take the material their kind's
read walls most often are, never the glass or metal the whole-wall matcher reads off shop windows.
"""

from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from smc.exteriors.wall_materials import TYPE_PRIOR_KINDS, build_log, type_priors  # noqa: E402

LABELS = ROOT / "data/sf_public_works/material_labels.json"
PHOTO = ROOT / "data/sf_public_works/facade_photo_materials.json"
MODEL = ROOT / "docs/sf-corridor-3d.json"
OUT = ROOT / "docs/sf-corridor-materials.json"
OPUS_LOG = ROOT / "data/sf_public_works/opus_wall_materials.json"
MIN_CONFIDENCE = 0.70
#: How the wall material was arrived at, by code; ``walls`` rows are [class, confidence, code].
WALL_BASES = {"p": "photographed_texture", "s": "untextured_photo_smooth_render", "a": "archetype_prior",
              "o": "opus_read_background", "t": "business_type_prior_from_opus_reads"}
SMOOTH_WALL = "stucco_render"
SMOOTH_CONFIDENCE = 0.5
#: Kinds of building whose untextured walls are taken as render; an office tower's are not.
SMOOTH_ARCHETYPES = {"residential", "generic", "restaurant", "retail", "hotel"}
PRIOR_CAP = 0.4
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
        # A shop's photographed glass is its windows; the matcher fitted to whole walls says glass.
        if material and facade.get("m") in {"glass", "metal"} and facade.get("conf", 0) >= 0.6 \
                and material != "metal_panel" and way.get("archetype") not in TYPE_PRIOR_KINDS:
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
    log = build_log(ROOT)
    OPUS_LOG.write_text(json.dumps(log, indent=1, sort_keys=True) + "\n")
    opus = 0
    for osm_id, b in log["buildings"].items():
        if osm_id in ways and b["class"] in SUPPORTED:
            assigned[osm_id] = {"class": b["class"], "confidence": b["confidence"], "basis": "opus_wall_reading",
                                **({"colour": b["colour"]} if b.get("colour") else {})}
            opus += 1
    sources["opus_wall_reading"] = opus
    priors = type_priors(log)
    walls = wall_materials(ways, assigned, photo, labels, priors)
    payload = {"schema": "kerbside.material_assignments/4",
               "source": [str(LABELS.relative_to(ROOT)), str(PHOTO.relative_to(ROOT))],
               "min_confidence": MIN_CONFIDENCE,
               "assigned": assigned,
               "counts": dict(Counter(v["class"] for v in assigned.values() if "class" in v)),
               "colours": sum(1 for v in assigned.values() if "colour" in v),
               "sources": dict(sources), "skipped": dict(skipped),
               "wall_bases": WALL_BASES, "walls": walls, "type_priors": priors,
               "wall_counts": dict(Counter(f"{c}:{WALL_BASES[b]}" for c, _, b in walls.values()))}
    OUT.write_text(json.dumps(payload, separators=(",", ":")) + "\n")
    return payload


def wall_materials(ways: dict, assigned: dict, photo: dict, labels: dict, priors: dict | None = None) -> dict:
    """[class, confidence, basis code] for every building."""
    read: dict[str, Counter] = {}
    for osm_id, row in assigned.items():
        if "class" in row:
            read.setdefault(ways[osm_id].get("archetype") or "generic", Counter())[row["class"]] += 1
    everyone = sum(read.values(), Counter())
    walls = {}
    for osm_id, way in ways.items():
        row = assigned.get(osm_id, {})
        kind = way.get("archetype") or "generic"
        if "class" in row:
            walls[osm_id] = [row["class"], row["confidence"], "o" if row["basis"] == "opus_wall_reading" else "p"]
        elif kind in SMOOTH_ARCHETYPES and (osm_id in photo or osm_id in labels):
            agrees = (photo.get(osm_id) or {}).get("top") == SMOOTH_WALL
            walls[osm_id] = [SMOOTH_WALL, SMOOTH_CONFIDENCE + (0.1 if agrees else 0.0), "s"]
        elif kind in (priors or {}):
            walls[osm_id] = [priors[kind]["class"], priors[kind]["confidence"], "t"]
        else:
            counts = read.get(kind) if sum((read.get(kind) or Counter()).values()) >= 20 else everyone
            cls, n = counts.most_common(1)[0]
            walls[osm_id] = [cls, round(min(PRIOR_CAP, n / sum(counts.values())), 3), "a"]
    return walls


if __name__ == "__main__":
    result = build()
    print(result["counts"], "colours:", result["colours"])
    print(result["sources"], result["skipped"])
    print(result["wall_counts"])
