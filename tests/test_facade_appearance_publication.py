"""Old source-image approvals must not silently approve a changed visual fitter."""

import json
import runpy
from pathlib import Path
from types import SimpleNamespace

import cv2
import numpy as np
import pytest

from smc.facades.version import IMPLEMENTATION_FILES, implementation_sha256

ROOT = Path(__file__).resolve().parents[1]


def test_publication_requires_current_implementation_and_independent_band_review(tmp_path):
    module = runpy.run_path(str(ROOT / "scripts/match_frontage_facades.py"))
    cycle = module["cycle"]
    cycle.__globals__["ROOT"] = tmp_path
    for name in IMPLEMENTATION_FILES:
        source = tmp_path / name
        source.parent.mkdir(parents=True, exist_ok=True)
        source.write_text((ROOT / name).read_text())
    docs = tmp_path / "docs"
    renderer = tmp_path / "scripts/build_sf_corridor_3d.py"
    renderer.write_text("fixture renderer")
    cycle.__globals__["LOADED_IMPLEMENTATION"] = implementation_sha256(tmp_path)
    docs.mkdir()
    (docs / "sf-corridor-3d.json").write_text(
        json.dumps(
            {
                "bbox": {"north": 38, "south": 37, "east": -122, "west": -123},
                "ways": [
                    {
                        "osm_id": 1,
                        "kind": "building",
                        "height_m": 6,
                        "levels": 2,
                        "height_source": "fixture",
                        "points": [[0, 0], [1, 0], [1, 1]],
                    }
                ],
            }
        )
    )
    review_root = tmp_path / "inputs/review"
    review_root.mkdir(parents=True)
    (review_root / "a.json").write_text(
        json.dumps(
            {
                "status": "verified",
                "building_id": "1",
                "region": "sf-corridor",
                "pixel_sha256": "abc",
                "candidate": {
                    "geometry_pass": True,
                    "angle_deg": 0,
                    "edge_angle_deg": 20,
                    "full_front_in_frame": True,
                    "wall": {"a": [0, 0], "b": [6, 0], "normal": [0, -1], "height_m": 6},
                    "rank": [1],
                    "observation": {
                        "observation_uid": "fixture",
                        "attribution": "synthetic",
                        "license_id": "synthetic",
                        "source_locator": "fixture",
                    },
                },
            }
        )
    )
    cv2.imwrite(str(review_root / "a.jpg"), np.full((100, 100, 3), 100, np.uint8))
    cv2.imwrite(str(review_root / "a.labels.png"), np.ones((100, 100), np.uint8))
    gates = {
        name: True
        for name in (
            "visual_alignment",
            "full_front_visible",
            "openings_correct",
            "material_checked",
            "metric_alignment",
            "source_rights_checked",
            "render_3d_verified",
            "higher_accuracy_than_baseline",
            "certainty_reviewed",
            "privacy_reviewed",
        )
    }
    gates.update(image_sha256="abc", reviewer="fixture", storeys_count=2)
    reviews = tmp_path / "reviews.json"
    args = SimpleNamespace(
        controls=None,
        detector=None,
        inputs=[review_root.parent],
        output=tmp_path / "output",
        publish_reviewed=["1"],
        reviews=reviews,
        watch_seconds=0,
    )
    reviews.write_text(json.dumps({"1": gates}))
    with pytest.raises(ValueError, match="missing image-bound visual review"):
        cycle(args)
    fit = json.loads((args.output / "latest.json").read_text())["buildings"]["1"]
    assert len(fit["appearance"]["bands"]) == 2
    gates["implementation_sha256"] = fit["implementation_sha256"]
    reviews.write_text(json.dumps({"1": gates}))
    with pytest.raises(ValueError, match="missing image-bound visual review"):
        cycle(args)
    gates["appearance_bands_verified"] = True
    reviews.write_text(json.dumps({"1": gates}))
    (docs / "sf-corridor-frontage-fits.json").write_text(
        json.dumps(
            {
                "schema": "kerbside.facade_fits/1",
                "buildings": {"other": {"historical": "unchanged"}},
            }
        )
    )
    cycle(args)
    published = json.loads((docs / "sf-corridor-frontage-fits.json").read_text())
    assert published["buildings"]["1"]["review_status"] == "reviewed_inferred_visual_parameters"
    assert published["buildings"]["other"] == {"historical": "unchanged"}
    # Long-lived worker functions cannot claim a new disk version while using old imports.
    (tmp_path / "src/smc/facades/architecture_logic.py").write_text("changed logic")
    with pytest.raises(RuntimeError, match="restart required"):
        cycle(args)
