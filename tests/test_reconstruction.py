"""Synthetic invariants for visual fusion; no external imagery or model weights needed."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pytest

from smc.reconstruction.contracts import Coverage, load_rights, sha256_file, validate_cell_manifest
from smc.reconstruction.fusion import (
    SurfaceView,
    complete_surface,
    fuse_views,
    mask_temporary_objects,
)
from smc.reconstruction.geo import EnuFrame
from smc.reconstruction.materials import LabelledRegion, MaterialClassifier, check_building_disjoint
from smc.reconstruction.observations import benchmark_split
from smc.reconstruction.residual import ResidualSample, fit_facade_residual, verify_seam

ROOT = Path(__file__).resolve().parents[1]


def test_pilot_benchmark_holds_out_300_real_metadata_references_by_day():
    manifest = json.loads((ROOT / "data/reconstruction/pilot_benchmark.json").read_text())
    holdouts = manifest["held_out_observations"]
    assert len(holdouts) == len({row["observation_uid"] for row in holdouts}) == 300
    assert len({row["captured_at"][:10] for row in holdouts}) >= 2
    assert all(row["source_locator"] and len(row["metadata_sha256"]) == 64 for row in holdouts)
    assert all(row["image_sha256"] is None for row in holdouts)
    assert not manifest["promotion_ready"]


def test_benchmark_split_has_no_training_date_or_sequence_leak():
    rows = []
    for day in range(4):
        for frame in range(4):
            rows.append({"observation_uid": f"{day}:{frame}", "provider": "test",
                         "provider_sequence_id": f"sequence-{day}", "captured_at":
                         datetime(2026, 1, day + 1, tzinfo=UTC), "source_locator": "test://frame"})
    train, test = benchmark_split(rows, 4)
    assert len(test) == 4
    assert {r["captured_at"].date() for r in train}.isdisjoint(
        {r["captured_at"].date() for r in test})


def test_rights_gate_rejects_unprocured_oblique_images_and_google():
    rights = load_rights(ROOT / "data/reconstruction/source_rights.json")
    rights["mapillary"].require("cv_processing", "texture_baking", "commercial_use")
    with pytest.raises(ValueError, match="pending_contract"):
        rights["pilot_oblique_aerial"].require("texture_baking")
    assert "google" not in rights


def test_enu_origin_and_transform_are_metric_and_consistent():
    frame = EnuFrame(-122.407, 37.795, 0.0)
    assert np.linalg.norm(frame.to_enu(frame.lon, frame.lat, 0.0)) < 1e-6
    east, north, up = frame.to_enu(frame.lon + 0.0001, frame.lat, 0.0)
    assert 8.5 < east < 9.0 and abs(north) < 0.01 and abs(up) < 0.01
    transform = frame.enu_to_ecef()
    assert len(transform) == 16 and transform[-1] == 1.0


def _view(colour: int, observation: str, sequence: str, mask: np.ndarray) -> SurfaceView:
    image = np.full((*mask.shape, 3), colour, dtype=np.uint8)
    return SurfaceView(image, mask, 1.0, 40.0, observation, sequence)


def test_multiview_fusion_tracks_independent_support_and_sampling_limit():
    visible = np.ones((8, 8), dtype=bool)
    visible[2:4, 2:4] = False
    one = _view(80, "one", "drive-a", visible)
    two = _view(82, "two", "drive-a", visible)
    three = _view(90, "three", "drive-b", visible)
    fused = fuse_views([one, two, three], output_pixels_per_m=50)
    assert np.all(fused.coverage[visible] == Coverage.MULTIVIEW_OBSERVATION)
    assert np.all(fused.coverage[~visible] == Coverage.UNKNOWN)
    assert np.all(fused.support_count[visible] == 3)
    with pytest.raises(ValueError, match=r"1\.25x"):
        fuse_views([one], output_pixels_per_m=51)


def test_completion_is_visible_but_never_observed():
    visible = np.ones((12, 12), dtype=bool)
    visible[5:7, 5:7] = False
    visible[0:2, 0:2] = False
    fused = fuse_views([_view(100, "a", "s1", visible)], output_pixels_per_m=40)
    completed = complete_surface(fused, material="brick")
    assert completed.coverage[5, 5] == Coverage.SAME_SURFACE_COMPLETION
    assert completed.coverage[0, 0] == Coverage.PROCEDURAL_MATERIAL
    assert completed.support_count[5, 5] == 0


def test_privacy_mask_wins_over_permanent_object_override():
    face = np.zeros((20, 20), dtype=bool)
    face[10, 10] = True
    car = np.zeros_like(face)
    car[2, 2] = True
    permanent = np.ones_like(face)
    blocked = mask_temporary_objects({"face": face, "car": car}, 1.0,
                                     permanent_mask=permanent)
    assert blocked[10, 10]
    assert not blocked[2, 2]
    with pytest.raises(ValueError, match="segmentation"):
        mask_temporary_objects({}, 1.0)


def test_facade_residual_is_bounded_and_anchored_to_every_edge():
    samples = [ResidualSample(0.5, 0.5, 0.2, 1.0, f"pass-{i}") for i in range(3)]
    samples.append(ResidualSample(0.5, 0.5, 4.0, 1.0, "bad"))
    result = fit_facade_residual(samples)
    assert result.accepted_samples == 3 and result.rejected_samples == 1
    assert 0 < result.offset_m.max() <= 0.30
    verify_seam(result.offset_m)
    unsupported = fit_facade_residual(samples[:2])
    assert not unsupported.offset_m.any()


def test_material_classes_require_owned_labels_and_disjoint_blocks():
    embedding = np.array([1.0, 0.0], dtype=np.float32)
    labels = [LabelledRegion(str(i), f"building-{i}", f"block-{i}", "facade", "brick",
                             embedding, "owned-source") for i in range(150)]
    model = MaterialClassifier.fit(labels, "facade")
    assert model.predict(embedding).name == "brick"
    assert MaterialClassifier.fit(labels[:149], "facade").predict(embedding).name == "unknown"
    with pytest.raises(ValueError, match="block"):
        check_building_disjoint(labels[:-1], [LabelledRegion("other", "new", "block-0", "facade",
                                                           "brick", embedding, "owned-source")])


def test_cell_manifest_rejects_canonical_mutation(tmp_path: Path):
    canonical = tmp_path / "canonical.json"
    canonical.write_text("{}")
    manifest = {
        "schema_version": 1, "cell_id": "test", "bbox": [0, 0, 1, 1],
        "enu_origin_wgs84": [0, 0, 0], "enu_to_ecef": [0.0] * 16,
        "horizontal_datum": "WGS84", "vertical_datum": "unverified",
        "canonical_world_sha256": sha256_file(canonical), "run_id": "test",
        "source_time_range": [None, None], "attribution": [], "quality_state": "blocked",
        "lod_assets": {},
    }
    validate_cell_manifest(manifest, canonical)
    canonical.write_text('{"mutated":true}')
    with pytest.raises(ValueError, match="canonical world changed"):
        validate_cell_manifest(manifest, canonical)
