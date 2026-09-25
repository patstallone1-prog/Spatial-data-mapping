"""Publication and reconstruction preflight fail closed on unsupported evidence."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np
import pyarrow.parquet as pq
import pytest

from smc.reconstruction.colmap_runner import preflight_inputs
from smc.reconstruction.contracts import Coverage, sha256_file
from smc.reconstruction.glb import inspect_glb, write_visual_glb
from smc.reconstruction.quality import evaluate_metrics, evaluate_promotion
from smc.reconstruction.rectified import fuse_rectified_manifest

ROOT = Path(__file__).resolve().parents[1]


def test_visual_glb_has_valid_header_and_is_not_collision(tmp_path: Path):
    path = tmp_path / "visual-lod0.glb"
    vertices = np.array([[0, 0, 0], [1, 0, 0], [0, 1, 0]], dtype=np.float32)
    normals = np.tile([0, 0, 1], (3, 1)).astype(np.float32)
    faces = np.array([[0, 1, 2]], dtype=np.uint32)
    write_visual_glb(path, vertices, normals, faces, cell_id="test-cell")
    glb = inspect_glb(path)
    assert glb["asset"]["version"] == "2.0"
    assert path.stat().st_size < 500_000
    with path.open("r+b") as file:
        file.write(b"bad!")
    with pytest.raises(ValueError, match="GLB"):
        inspect_glb(path)


def test_missing_truth_never_promotes(tmp_path: Path):
    failures = evaluate_metrics({})
    assert any("held_out_edge_error_px" in failure for failure in failures)
    assert any("all_texels_provenanced" in failure or "texel" in failure for failure in failures)
    failures = evaluate_promotion(
        tmp_path,
        ROOT / "data/reconstruction/pilot_benchmark.json",
        tmp_path / "quality_metrics.json",
    )
    assert any("image-byte hashes" in failure for failure in failures)
    assert any("missing cell manifest" in failure for failure in failures)


def test_unlicensed_oblique_rejected_before_reconstruction(tmp_path: Path):
    images = []
    for index in range(20):
        images.append({
            "observation_uid": f"test-{index}",
            "source_id": "pilot_oblique_aerial",
            "license_id": "unprocured",
            "attribution": "test",
            "image_path": str(tmp_path / "missing.jpg"),
            "image_sha256": "0" * 64,
            "masks_npz": str(tmp_path / "missing.npz"),
            "sequence_id": f"sequence-{index % 3}",
            "camera_group": "pilot",
            "lon": -122.407,
            "lat": 37.795,
            "altitude_m_ellipsoid": 40.0,
            "reprojection_sigma_px": 1.0,
        })
    manifest = tmp_path / "inputs.json"
    manifest.write_text(json.dumps({
        "vertical_datum": "WGS84_ellipsoid",
        "enu_origin_wgs84": [-122.407, 37.795, 0],
        "images": images,
    }))
    with pytest.raises(ValueError, match="pending_contract"):
        preflight_inputs(
            manifest,
            ROOT / "data/reconstruction/source_rights.json",
            ROOT / "data/reconstruction/pilot_benchmark.json",
        )


def test_publishing_without_pilot_is_safe_but_incomplete_pilot_is_rejected(tmp_path: Path):
    target = tmp_path / "pilot"
    command = [sys.executable, str(ROOT / "scripts/publish_visual_pilot.py"),
               "--destination", str(target)]
    absent = subprocess.run(command, cwd=ROOT, capture_output=True, text=True)
    assert absent.returncode == 0
    target.mkdir()
    incomplete = subprocess.run(command, cwd=ROOT, capture_output=True, text=True)
    assert incomplete.returncode != 0


def test_rectified_fusion_preserves_per_texel_sources_and_canonical_ids(tmp_path: Path):
    rights = tmp_path / "rights.json"
    rights.write_text(json.dumps({"schema_version": 1, "sources": [{
        "source_id": "licensed", "license_id": "test-license", "attribution": "test",
        "status": "approved", "allowed_uses": [
            "cv_processing", "texture_baking", "persistent_hosting",
            "redistribution", "commercial_use",
        ],
    }]}))
    views = []
    for index in range(2):
        image = tmp_path / f"image-{index}.png"
        mask = tmp_path / f"mask-{index}.png"
        cv2.imwrite(str(image), np.full((8, 8, 3), 80 + index, dtype=np.uint8))
        visible = np.full((8, 8), 255, dtype=np.uint8)
        visible[3, 3] = 0
        cv2.imwrite(str(mask), visible)
        views.append({
            "observation_uid": f"training-{index}", "source_id": "licensed",
            "license_id": "test-license", "privacy_reviewed": True,
            "image_path": str(image), "image_sha256": sha256_file(image),
            "visibility_mask_path": str(mask),
            "visibility_mask_sha256": sha256_file(mask),
            "weight": 1.0, "pixels_per_m": 10, "sequence_id": f"seq-{index}",
            "captured_at": "2026-01-01T00:00:00Z",
        })
    manifest = tmp_path / "surfaces.json"
    manifest.write_text(json.dumps({
        "schema_version": 1, "cell_id": "c13r03", "run_id": "test-run", "surfaces": [{
            "canonical_feature_id": "building-1", "canonical_face_id": "wall-2",
            "semantic_class": "facade", "material": "brick",
            "pixels_per_m": 10, "views": views,
        }],
    }))
    output = tmp_path / "output"
    table = pq.read_table(fuse_rectified_manifest(manifest, rights, output))
    assert table.num_rows == 1
    row = table.to_pylist()[0]
    assert row["canonical_feature_id"] == "building-1"
    assert row["multiview_fraction"] > 0.9
    arrays = np.load(output / f"{row['surface_id']}-coverage.npz")
    assert arrays["classes"][0, 0] == Coverage.MULTIVIEW_OBSERVATION
    assert arrays["source_bits"][0, 0, 0] == 0b11000000
    assert arrays["source_bits"][3, 3, 0] == 0
    views[0]["privacy_reviewed"] = False
    manifest.write_text(json.dumps({
        "schema_version": 1, "cell_id": "c13r03", "run_id": "test-run", "surfaces": [{
            "canonical_feature_id": "building-1", "canonical_face_id": "wall-2",
            "semantic_class": "facade", "pixels_per_m": 10, "views": views,
        }],
    }))
    with pytest.raises(ValueError, match="unreviewed privacy mask"):
        fuse_rectified_manifest(manifest, rights, tmp_path / "rejected")
