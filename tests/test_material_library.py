"""Material imagery is licensed, varied, and never silently treated as truth."""

from __future__ import annotations

import hashlib
import json
from collections import Counter

from PIL import Image

from scripts import build_material_assignments as assignments
from scripts import build_material_library as library


def test_wall_library_has_three_verified_high_resolution_cc0_sources_per_class():
    manifest = json.loads((library.OUT / "manifest.json").read_text())
    assert manifest["schema"] == "kerbside.material_library/1"
    assert Counter(row["material_class"] for row in manifest["assets"]) == {
        material: 3 for material in library.ASSETS
    }
    for row in manifest["assets"]:
        path = library.OUT / row["file"]
        assert row["license"] == "CC0-1.0"
        assert row["role"] == "visual_material_reference_only"
        assert row["source_url"].startswith("https://dl.polyhaven.org/")
        assert hashlib.sha256(path.read_bytes()).hexdigest() == row["sha256"]
        with Image.open(path) as image:
            assert min(image.size) >= 2000


def test_only_confident_nonglass_assignments_are_served():
    payload = assignments.build()
    assert sum(payload["counts"].values()) > 2000
    assert payload["skipped"]["unknown_or_low_confidence"] > 0
    model = json.loads(assignments.MODEL.read_text())
    ways = {str(way["osm_id"]): way for way in model["ways"]
            if way.get("kind") == "building" and way.get("osm_id") is not None}
    for osm_id, row in payload["assigned"].items():
        assert row["class"] in assignments.SUPPORTED
        assert row["confidence"] >= assignments.MIN_CONFIDENCE
        facade = ways[osm_id].get("facade") or {}
        assert not (facade.get("m") in {"glass", "metal"} and facade.get("conf", 0) >= 0.6)
