"""Accuracy plumbing invariants; downloaded real results are separate artifacts."""

import hashlib
import json
import tomllib
import urllib.error
from dataclasses import replace
from pathlib import Path

import cv2
import numpy as np
import pytest
from scipy.spatial.transform import Rotation

from smc.curbmeasure.geometry import Camera
from smc.lidar.ept import EptReader
from smc.reconstruction.lidar_reference import LidarReference
from smc.reconstruction.matching import Track, refine_tracks_subpixel
from smc.reconstruction.matching_benchmark import evaluate
from smc.reconstruction.multiview import Control, refine


def test_optional_matcher_can_be_packaged_without_losing_source_pin():
    root = Path(__file__).resolve().parents[1]
    config = tomllib.loads((root / "pyproject.toml").read_text())
    assert config["tool"]["hatch"]["metadata"]["allow-direct-references"]
    assert (
        "lightglue @ git+https://github.com/cvg/LightGlue.git@"
        "eb42fee2d71449efb0aa5c10549752b5d75384d8"
    ) in config["project"]["optional-dependencies"]["photo-matching"]


def camera(i="a", x=0):
    return Camera(
        i, np.array([x, 0.0, 0.0]), np.eye(3), 800.0, (400.0, 300.0), 0.0, 0.0, 800, 600, 600.0
    )


def test_non_square_intrinsics_preserved_in_projection_and_ray():
    c = camera()
    point = np.array([1.0, 2.0, 10.0])
    assert c.project(point)[0] == pytest.approx([480.0, 420.0])
    assert c.ray(c.project(point))[0] == pytest.approx(point / np.linalg.norm(point))


def test_lidar_reference_selected_by_fixed_pixel_not_reconstructed_point():
    c = camera()
    x, y = np.meshgrid(np.arange(-1, 1.01, 0.02), np.arange(-1, 1.01, 0.02))
    xyz = np.column_stack((x.ravel(), y.ravel(), np.full(x.size, 10.0)))
    reference = LidarReference(c, xyz, np.full(len(xyz), 41))
    point = reference.at_pixel(np.array([400.0, 300.0]))
    assert point is not None
    assert point["xyz"] == pytest.approx([0, 0, 10])
    assert point["plane_rms_m"] < 1e-10
    assert reference.at_pixel(np.array([10.0, 10.0])) is None


def test_nearest_dynamic_return_blocks_static_surface_behind_it():
    c = camera()
    xyz = np.array([[0.0, 0.0, 10.0], [0.0, 0.0, 5.0]])
    reference = LidarReference(c, xyz, np.array([41, 13]))
    assert reference.exclusion_mask()[300, 400]


def test_subpixel_refinement_preserves_ids_and_reduces_fractional_shift_error():
    rng = np.random.default_rng(19)
    a = rng.integers(0, 255, (128, 128), np.uint8)
    a = cv2.GaussianBlur(a, (5, 5), 0.8)
    b = cv2.warpAffine(a, np.float32([[1, 0, 2.3], [0, 1, 1.7]]), (128, 128))
    tracks = [Track("stable", {"a": np.array([60.0, 60.0]), "b": np.array([63.0, 62.0])})]
    improved, report = refine_tracks_subpixel(
        tracks, {"a": a, "b": b}, {"a": np.zeros_like(a, bool), "b": np.zeros_like(a, bool)}
    )
    assert improved[0].track_id == "stable"
    assert report["refined_observations"] == 1
    assert np.linalg.norm(improved[0].pixels["b"] - [62.3, 61.7]) < 0.15
    unchanged, _ = refine_tracks_subpixel(
        tracks, {"a": a, "b": b}, {"a": np.ones_like(a, bool), "b": np.ones_like(a, bool)}
    )
    assert unchanged[0].pixels["b"] == pytest.approx([63, 62])


def test_full_pose_refinement_uses_independent_controls_not_rotation_priors():
    rng = np.random.default_rng(174)
    cams = [camera(str(i), x) for i, x in enumerate([-2, 0, 2])]
    points = rng.uniform([-2.0, -2.0, 10.0], [2.0, 2.0, 20.0], (16, 3))
    tracks = [
        Track(str(i), {c.image_id: c.project(p)[0] for c in cams}) for i, p in enumerate(points)
    ]
    controls = [Control(str(i), p, 0.01, "fitting-survey") for i, p in enumerate(points[:4])]
    noisy = [
        replace(c, rotation=Rotation.from_rotvec(rng.normal(0, 0.001, 3)).as_matrix() @ c.rotation)
        for c in cams
    ]
    result = refine(noisy, tracks, controls, optimize_rotations=True)
    assert result["status"] == "reconstructed"
    assert not result["fixed_intrinsics_and_rotations"]
    assert all(
        np.linalg.norm(result["points"][str(i)] - p) < 0.05 for i, p in enumerate(points) if i >= 4
    )
    unanchored = refine(cams, tracks, [], optimize_rotations=True)
    assert unanchored["status"] == "unobservable"
    assert unanchored["visual_observability"]["nullity"] == 7
    assert not unanchored["optimization_attempted"]


def test_missing_planned_truth_cannot_make_partial_case_successful():
    manifest = {
        "benchmark_id": "partial",
        "purpose": "synthetic_regression_only",
        "coordinate_frame": "local_ENU_m",
        "threshold_m": 0.05,
        "checkpoint_count": 8,
        "cases": [
            {
                "case_id": "a",
                "checkpoints": [
                    {
                        "track_id": "p",
                        "xyz": [0, 0, 0],
                        "source_id": "truth",
                        "method": "analytic",
                        "independent": True,
                        "correspondence": "analytic_id",
                        "evidence_sha256": "a" * 64,
                    }
                ],
            }
        ],
    }
    result = evaluate(manifest, {"a": {"status": "reconstructed", "points": {"p": [0, 0, 0]}}}, {})
    assert result["successful_reconstruction_rate"] == 0
    assert result["planned_checkpoints"] == 8
    assert result["reference_available_checkpoints"] == 1
    assert result["within_threshold_all_checkpoints"] == 1 / 8
    assert result["all_attempts_median_m"] is None


def test_strict_lidar_reader_does_not_silently_skip_missing_tiles(tmp_path, monkeypatch):
    reader = EptReader(cache_dir=tmp_path, strict=True)
    reader._info = {"bounds": [-1, -1, -1, 1, 1, 1], "span": 128}
    monkeypatch.setattr(reader, "_nodes", lambda *args: ["0-0-0-0"])

    def fail(*args, **kwargs):
        raise urllib.error.HTTPError("https://example.test", 503, "missing", {}, None)

    monkeypatch.setattr(reader, "_get", fail)
    with pytest.raises(urllib.error.HTTPError):
        reader.around(0, 0, 1)


@pytest.mark.parametrize(
    "version,report_file",
    [("v2", "photo-lidar-accuracy.json"), ("v3", "photo-lidar-untouched.json")],
)
def test_committed_real_reports_keep_every_attempt_and_freeze_truth(version, report_file):
    root = Path(__file__).resolve().parents[1]
    path = root / f"data/benchmarks/real-photo-lidar-{version}-frozen.json"
    frozen = json.loads(path.read_text())
    public = json.loads((root / "docs/audits" / report_file).read_text())
    assert public["frozen_manifest_sha256"] == hashlib.sha256(path.read_bytes()).hexdigest()
    assert not public["absolute_5cm_accuracy_proven"]
    assert not public["geometry_promoted"]
    assert not public["raw_images_published"]
    for report in public["reports"].values():
        assert report["attempted_cases"] == len(frozen["cases"])
        assert report["threshold_m"] == 0.05
        assert report["planned_checkpoints"] == len(frozen["cases"]) * frozen["checkpoint_count"]
        assert sum(report["outcomes"].values()) == report["attempted_cases"]
        assert (
            report["manifest_sha256"]
            == hashlib.sha256(json.dumps(frozen, sort_keys=True).encode()).hexdigest()
        )
        expected = sum(row["within_threshold"] for row in report["cases"])
        assert report["successful_reconstruction_rate"] == expected / len(frozen["cases"])


def test_synthetic_5cm_is_explicitly_not_field_accuracy():
    root = Path(__file__).resolve().parents[1]
    synthetic = json.loads((root / "docs/audits/photo-lidar-synthetic-5cm.json").read_text())
    assert synthetic["manifest"]["purpose"] == "synthetic_regression_only"
    for report in synthetic["reports"].values():
        assert report["threshold_m"] == 0.05
        assert report["attempted_cases"] == 8
        assert not report["field_accuracy_claim"]
        assert not report["has_independent_metric_truth"]
