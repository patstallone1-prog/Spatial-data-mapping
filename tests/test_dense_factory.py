"""Synthetic adapter and refusal tests, not evidence of a real CUDA/city pilot."""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import cv2
import numpy as np
import pytest

from smc.geometry.base import GeometryFamily, TriMesh
from smc.geometry.freeform import FreeformMesh
from smc.reconstruction.colmap_runner import preflight_inputs
from smc.reconstruction.contracts import SourceRights, sha256_file
from smc.reconstruction.dense_backends import fvdb_preflight, reconstruct_fvdb
from smc.reconstruction.geo import EnuFrame
from smc.reconstruction.geometry_fit import FitOutcome
from smc.reconstruction.quality import evaluate_metrics
from smc.reconstruction.semantic_objects import (
    DenseSegment,
    decide_dense,
    fit_dense_segment,
    promotion_failures,
    split_dense_mesh,
)
from smc.world.coverage import coverage_report
from smc.world.object import Detail, Evidence, EvidenceRef, GeometryBasis, WorldObject

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("dense_factory", ROOT / "scripts/build_reconstruction_objects.py")
factory = importlib.util.module_from_spec(spec)
spec.loader.exec_module(factory)


def triangle() -> TriMesh:
    return TriMesh(np.array([[0, 0, 0], [1, 0, 0], [0, 1, 0]]), np.array([[0, 1, 2]]))


def approved_audit() -> dict:
    return {"canonical_sha256_before": "a" * 64, "canonical_sha256_after": "a" * 64,
            "candidate_sha256": "b" * 64, "object_id": "bench:1", "canonical_id": "bench:1",
            "source_provenance_valid": True, "license_valid": True,
            "privacy_review_passed": True, "collision_sanity_passed": True,
            "surface_continuity_passed": True, "performance_budget_passed": True,
            "semantic_review_passed": True, "validator_run_id": "test-only",
            "validation_source_locators": ["fixture://independent-checks"],
            "lidar_error_m": [0.01] * 20, "geometry_residual_m": [0.01] * 20,
            "maximum_seam_gap_m": 0.001, "independent_view_count": 3,
            "observed_surface_fraction": 0.9}


def prior_and_outcome():
    frame = EnuFrame(-122.407, 37.795, 0)
    geometry = FreeformMesh(triangle())
    prior = WorldObject("bench:1", "bench", geometry, GeometryBasis.PRIOR, 0.2,
                        Evidence((EvidenceRef("existing_geometry", "test-prior",
                                               "fixture://prior", "test-license"),)),
                        (frame.lon, frame.lat, frame.height_m),
                        detail=Detail.FULL)
    refs = (EvidenceRef("photogrammetry", "test", "fixture://mesh", "test-license"),)
    outcome = FitOutcome("bench", geometry, Evidence(refs, "image", 1000, 3,
                                                   coverage=0.9),
                         GeometryFamily.FREEFORM_MESH, "test-only dense partition", frame)
    rights = {"test": SourceRights("test", "test-license", "fixture", frozenset({
        "cv_processing", "texture_baking", "derived_mesh", "persistent_hosting", "redistribution",
        "commercial_use"}), "approved")}
    return prior, outcome, rights


def test_split_preserves_faces_unknowns_and_exact_coordinates():
    mesh = TriMesh(np.array([[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0]]),
                   np.array([[0, 1, 2], [1, 3, 2]]))
    parts, unknown = split_dense_mesh(mesh, np.array([0, -1]), {
        0: {"object_id": "roof:1", "canonical_id": "building:1", "semantic_type": "roof"}})
    assert len(parts) == 1 and len(unknown.faces) == 1
    assert np.array_equal(parts[0].mesh.vertices, mesh.vertices[:3])
    assert sum(len(part.mesh.faces) for part in parts) + len(unknown.faces) == len(mesh.faces)
    with pytest.raises(ValueError, match="dynamic"):
        split_dense_mesh(triangle(), np.array([0]), {
            0: {"object_id": "car", "canonical_id": "car", "semantic_type": "car"}})
    with pytest.raises(ValueError, match="integer"):
        split_dense_mesh(triangle(), np.array([0.5]), {})


def test_freeform_does_not_reconstruct_or_invent_closure():
    prior, outcome, _ = prior_and_outcome()
    segment = DenseSegment("bench:1", prior.id, "freeform", triangle())
    fitted = fit_dense_segment(segment, outcome.frame, outcome.evidence.refs,
                               independent_views=3)
    assert np.array_equal(fitted[0].geometry.mesh.vertices, segment.mesh.vertices)
    assert np.array_equal(fitted[0].geometry.mesh.faces, segment.mesh.faces)
    assert fitted[0].evidence.fit_rms_m is None
    with pytest.raises(ValueError, match="prior"):
        fit_dense_segment(DenseSegment("facade", prior.id, "facade", triangle()),
                          outcome.frame, outcome.evidence.refs, independent_views=3)


@pytest.mark.parametrize("gate", ["license_valid", "privacy_review_passed",
    "collision_sanity_passed", "performance_budget_passed", "semantic_review_passed",
    "source_provenance_valid", "surface_continuity_passed"])
def test_each_missing_gate_retains_identical_prior(gate):
    prior, outcome, rights = prior_and_outcome()
    audit = approved_audit()
    del audit[gate]
    decision = decide_dense(outcome, object_id=prior.id, existing=prior, audit=audit,
                            canonical_hash="a" * 64, candidate_hash="b" * 64, rights=rights)
    assert decision.outcome == "kept_existing" and decision.object is prior


@pytest.mark.parametrize("metric", ["lidar_error_m", "geometry_residual_m", "maximum_seam_gap_m"])
def test_nonfinite_truth_cannot_pass(metric):
    audit = approved_audit()
    audit[metric] = [float("nan")] * 20 if metric.endswith("error_m") or metric.endswith("residual_m") else float("nan")
    assert promotion_failures(audit, canonical_hash="a" * 64, candidate_hash="b" * 64)


def test_good_gates_still_need_confidence_and_rights():
    prior, outcome, rights = prior_and_outcome()
    decision = decide_dense(outcome, object_id=prior.id, existing=prior, audit=approved_audit(),
                            canonical_hash="a" * 64, candidate_hash="b" * 64, rights=rights)
    assert decision.outcome == "accepted_full"
    assert "reconstruction_promoted" in decision.object.flags
    assert decision.object.fit.parameters["promotion_audit"]["candidate_sha256"] == "b" * 64
    denied = decide_dense(outcome, object_id=prior.id, existing=prior, audit=approved_audit(),
                          canonical_hash="a" * 64, candidate_hash="b" * 64, rights={})
    assert denied.object is prior
    audit = approved_audit()
    audit["candidate_sha256"] = "wrong"
    assert promotion_failures(audit, canonical_hash="a" * 64, candidate_hash="b" * 64)


@pytest.mark.parametrize("metric", ["maximum_seam_gap_m", "material_macro_f1",
    "visible_facade_observed_fraction", "desktop_fps", "mobile_fps", "desktop_decoded_mb"])
def test_global_gate_nan_regression(metric):
    assert any(metric in failure for failure in evaluate_metrics({metric: float("nan")}))


def test_coverage_keeps_fallback_in_denominator_and_library_separate():
    rows = [{"id": "a", "category": "building", "geometry": "prior",
             "appearance": "library_photo_material"},
            {"id": "b", "category": "building", "geometry": "procedural",
             "appearance": "procedural"}]
    report = coverage_report(rows)["categories"]["building"]
    assert report["total"] == 2
    assert report["appearance"]["shares"]["library_photo_material"] == 0.5
    assert "rectified_photo_material" not in report["appearance"]["counts"]
    with pytest.raises(ValueError, match="unique"):
        coverage_report(rows + rows[:1])


def input_fixture(tmp_path):
    image, masks = tmp_path / "image.png", tmp_path / "masks.npz"
    cv2.imwrite(str(image), np.zeros((8, 8, 3), dtype=np.uint8))
    np.savez(masks, **{key: np.zeros((8, 8), dtype=bool)
                      for key in ("person", "face", "license_plate", "car", "sky")})
    images = [{"observation_uid": f"test-{i}", "source_id": "test", "license_id": "test",
               "attribution": "test", "image_path": str(image), "image_sha256": sha256_file(image),
               "masks_npz": str(masks), "masks_sha256": sha256_file(masks),
               "privacy_review_id": "fixture-only", "sequence_id": f"seq-{i % 3}",
               "camera_group": "camera", "lon": -122.407, "lat": 37.795,
               "altitude_m_ellipsoid": 0, "reprojection_sigma_px": 1,
               "captured_at": "2026-01-01T00:00:00+00:00"} for i in range(20)]
    for index, row in enumerate(images):
        target = tmp_path / f"image-{index}.png"
        cv2.imwrite(str(target), np.full((8, 8, 3), index, dtype=np.uint8))
        row.update(image_path=str(target), image_sha256=sha256_file(target))
    inputs, rights, benchmark = (tmp_path / name for name in ("inputs.json", "rights.json", "benchmark.json"))
    inputs.write_text(json.dumps({"vertical_datum": "WGS84_ellipsoid",
                                 "enu_origin_wgs84": [-122.407, 37.795, 0], "images": images}))
    rights.write_text(json.dumps({"sources": [{"source_id": "test", "license_id": "test",
        "attribution": "fixture", "status": "approved", "allowed_uses": [
            "cv_processing", "texture_baking", "derived_mesh", "persistent_hosting",
            "redistribution", "commercial_use"]}]}))
    benchmark.write_text(json.dumps({"held_out_observations": []}))
    return inputs, rights, benchmark


def test_preflight_requires_reviewed_hashed_masks_and_safe_ids(tmp_path):
    inputs, rights, benchmark = input_fixture(tmp_path)
    assert len(preflight_inputs(inputs, rights, benchmark)[0]) == 20
    document = json.loads(inputs.read_text())
    document["images"][0]["observation_uid"] = "../../escape"
    inputs.write_text(json.dumps(document))
    with pytest.raises(ValueError, match="safe path"):
        preflight_inputs(inputs, rights, benchmark)
    document["images"][0]["observation_uid"] = "test-0"
    document["images"][0]["privacy_review_id"] = ""
    inputs.write_text(json.dumps(document))
    with pytest.raises(ValueError, match="privacy review"):
        preflight_inputs(inputs, rights, benchmark)


def test_factory_failed_audit_keeps_prior_and_unknown_faces(tmp_path):
    inputs, rights, benchmark = input_fixture(tmp_path)
    prior, _, _ = prior_and_outcome()
    existing, canonical, dense = (tmp_path / name for name in ("existing.jsonl", "canonical.json", "dense.npz"))
    existing.write_text(json.dumps(prior.to_json()) + "\n")
    canonical.write_text("{}")
    mesh = triangle()
    np.savez(dense, vertices=mesh.vertices, faces=mesh.faces, face_labels=np.array([0]))
    bundle = tmp_path / "bundle.json"
    bundle.write_text(json.dumps({"schema": "kerbside.dense_instances/1",
        "coordinate_frame": "ENU_m_WGS84_ellipsoid", "enu_origin_wgs84": [-122.407, 37.795, 0],
        "canonical_sha256": sha256_file(canonical), "inputs": str(inputs),
        "inputs_sha256": sha256_file(inputs), "dense_npz": str(dense),
        "dense_npz_sha256": sha256_file(dense), "existing_sha256": sha256_file(existing),
        "instances": {"0": {"object_id": prior.id, "canonical_id": prior.id,
            "semantic_type": "freeform", "observation_uids": ["test-0", "test-1", "test-2"],
            "audit": {"independent_view_count": 3}}}}))
    output = tmp_path / "candidate"
    summary = factory.build(bundle, canonical, existing, rights, benchmark, output)
    assert summary["attempts"] == 1 and summary["accepted"] == 0
    assert json.loads((output / "world_objects.jsonl").read_text()) == prior.to_json()
    assert not list(output.glob("*.glb"))
    with pytest.raises(FileExistsError):
        factory.build(bundle, canonical, existing, rights, benchmark, output)


def test_fvdb_on_mac_refuses_before_importing_gpu_modules(monkeypatch, tmp_path):
    import smc.reconstruction.dense_backends as backend

    monkeypatch.setattr(backend.platform, "system", lambda: "Darwin")
    assert any("Linux" in failure for failure in fvdb_preflight())
    with pytest.raises(RuntimeError, match="Linux"):
        reconstruct_fvdb(tmp_path, tmp_path / "never.ply")
    assert not (tmp_path / "never.ply").exists()


def test_colmap_hloc_path_contract_and_no_stale_cache(monkeypatch, tmp_path):
    """Execute runner control flow with fake upstream modules (not reconstruction)."""
    import smc.reconstruction.colmap_runner as runner

    inputs, rights, benchmark = input_fixture(tmp_path)
    work = tmp_path / "run"
    features = work / "features.h5"
    called = []

    def match_main(conf, pairs, feature_path, *, matches):
        assert feature_path == features and matches == work / "matches-aliked-lightglue.h5"
        called.append(matches)
        return matches

    class Model:
        def num_reg_images(self):
            return 20

        def transform(self, transform):
            assert transform == "aligned"

        def write(self, directory):
            (directory / "model.fixture").write_text("not a real COLMAP model")

    monkeypatch.setitem(sys.modules, "pycolmap", SimpleNamespace(
        CameraMode=SimpleNamespace(PER_FOLDER="per_folder"), RANSACOptions=dict,
        align_reconstruction_to_locations=lambda *a, **kw: "aligned"))
    monkeypatch.setitem(sys.modules, "hloc", SimpleNamespace(
        extract_features=SimpleNamespace(confs={"aliked-n16": {}}, main=lambda *a, **kw: features),
        match_features=SimpleNamespace(confs={"aliked+lightglue": {}}, main=match_main),
        reconstruction=SimpleNamespace(main=lambda *a, **kw: Model())))
    monkeypatch.setattr(runner.shutil, "which", lambda _: "/fixture/colmap")

    def fake_command(args):
        if args[1] == "stereo_fusion":
            (work / "dense").mkdir()
            (work / "dense/fused.ply").write_bytes(b"fixture, not real geometry\n" * 100)

    monkeypatch.setattr(runner, "_run", fake_command)
    result = runner.reconstruct_cell(inputs, rights, benchmark, work)
    assert called and result["promotion_state"] == "unvalidated"
    with pytest.raises(FileExistsError, match="immutable"):
        runner.reconstruct_cell(inputs, rights, benchmark, work)


def test_roof_cannot_replace_whole_building():
    from dataclasses import replace

    prior, outcome, rights = prior_and_outcome()
    decision = decide_dense(replace(outcome, semantic_type="roof"), object_id=prior.id,
                            existing=prior, audit=approved_audit(), canonical_hash="a" * 64,
                            candidate_hash="b" * 64, rights=rights)
    assert decision.object is prior
    assert "different semantic object" in decision.reason


def test_fvdb_adapter_calls_pinned_upstream_api_without_frame_normalization(monkeypatch, tmp_path):
    import smc.reconstruction.dense_backends as backend

    calls = {}

    class Tensor:
        def __init__(self, value):
            self.value = np.asarray(value)

        def detach(self):
            return self

        def cpu(self):
            return self

        def numpy(self):
            return self.value

    scene = SimpleNamespace(camera_to_world_matrices="poses", projection_matrices="K",
                            image_sizes="size")

    def config(**kwargs):
        calls["config"] = kwargs
        return kwargs

    def load_scene(workspace):
        calls["workspace"] = workspace
        return scene

    def create_runner(sfm, *, config, writer):
        assert sfm is scene and config["optimize_camera_poses"] is False
        return SimpleNamespace(model="model", optimize=lambda: calls.update(optimized=True))

    def mesh_from_splats(model, poses, intrinsics, sizes, margin, *, dtype):
        assert (model, poses, intrinsics, sizes) == ("model", "poses", "K", "size")
        calls.update(margin=margin, dtype=dtype)
        mesh = triangle()
        return Tensor(mesh.vertices), Tensor(mesh.faces), Tensor(np.ones((3, 3)))

    monkeypatch.setattr(backend, "fvdb_preflight", list)
    monkeypatch.setitem(sys.modules, "fvdb_reality_capture", SimpleNamespace(
        sfm_scene=SimpleNamespace(SfmScene=SimpleNamespace(from_colmap=load_scene)),
        radiance_fields=SimpleNamespace(GaussianSplatReconstruction=SimpleNamespace(
            from_sfm_scene=create_runner))))
    monkeypatch.setitem(sys.modules, "fvdb_reality_capture.radiance_fields.gaussian_splat_reconstruction",
                        SimpleNamespace(GaussianSplatReconstructionConfig=config))
    monkeypatch.setitem(sys.modules, "fvdb_reality_capture.radiance_fields.gaussian_splat_reconstruction_writer",
                        SimpleNamespace(GaussianSplatReconstructionWriter=lambda *a: "writer"))
    monkeypatch.setitem(sys.modules, "fvdb_reality_capture.tools", SimpleNamespace(
        mesh_from_splats=mesh_from_splats))
    monkeypatch.setitem(sys.modules, "torch", SimpleNamespace(float32="float32"))
    monkeypatch.setitem(sys.modules, "point_cloud_utils", SimpleNamespace(
        save_mesh_vfc=lambda path, *a: Path(path).write_text("fixture-only PLY")))
    result = reconstruct_fvdb(tmp_path / "colmap", tmp_path / "mesh.ply")
    assert calls["optimized"] and calls["dtype"] == "float32"
    assert calls["config"]["seed"] == 42 and result["promotion_state"] == "unvalidated"
    assert result["dense_mesh_sha256"] == sha256_file(tmp_path / "mesh.ply")
