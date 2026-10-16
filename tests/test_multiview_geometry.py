"""Analytic cameras/landmarks: regression evidence, not claimed field accuracy."""

import json
from dataclasses import replace

import cv2
import numpy as np
import pytest

from scripts.curbmeasure.refine_multiview import prepare, run
from smc.curbmeasure.geometry import Camera, triangulate
from smc.reconstruction.colmap_runner import _write_pairs, require_metric_alignment_support
from smc.reconstruction.contracts import load_rights, sha256_file
from smc.reconstruction.geo import EnuFrame
from smc.reconstruction.matching import (
    Frame,
    Track,
    candidate_pairs,
    cycle_tracks,
    match_frames,
    mutual_matches,
    overlap_groups,
)
from smc.reconstruction.matching_benchmark import (
    assert_holdout_disjoint,
    evaluate,
    validate_benchmark,
)
from smc.reconstruction.multiview import Control, Relation, refine
from smc.reconstruction.pixel_store import CanonicalPixels


def scene(seed=7, baseline=2.0, noise_px=0.15):
    rng = np.random.default_rng(seed)
    cameras = [
        Camera(
            str(i), np.array([x, 0.0, 0.0]), np.eye(3), 800.0, (400.0, 300.0), 0.0, 0.0, 800, 600
        )
        for i, x in enumerate([-baseline, 0, baseline])
    ]
    points = rng.uniform([-2.0, -2.0, 10.0], [2.0, 2.0, 20.0], (16, 3))
    tracks = [
        Track(str(i), {c.image_id: c.project(p)[0] + rng.normal(0, noise_px, 2) for c in cameras})
        for i, p in enumerate(points)
    ]
    controls = [
        Control(str(i), p.copy(), 0.01, f"fit-survey-{i}") for i, p in enumerate(points[:3])
    ]
    return cameras, points, tracks, controls


def benchmark(cases):
    return {
        "benchmark_id": "analytic-not-field-truth",
        "purpose": "synthetic_regression_only",
        "coordinate_frame": "local_ENU_m",
        "threshold_m": 0.15,
        "cases": cases,
        "enu_origin_wgs84": [0, 0, 0],
    }


def checkpoint(track_id, xyz):
    return {
        "track_id": track_id,
        "xyz": list(xyz),
        "source_id": "heldout-survey",
        "method": "analytic",
        "correspondence": "analytic_id",
        "independent": True,
        "evidence_sha256": "a" * 64,
    }


def test_well_spaced_rays_recover_known_point():
    cameras, points, _, _ = scene(noise_px=0)
    p = points[0]
    assert triangulate(cameras, [c.project(p)[0] for c in cameras]) == pytest.approx(p)


def test_tiny_baseline_refused_even_with_perfect_residual():
    cameras, points, _, _ = scene(baseline=1e-5, noise_px=0)
    assert np.isnan(triangulate(cameras, [c.project(points[0])[0] for c in cameras])).all()


def test_triangulation_rejects_mismatched_lengths_and_negative_depth():
    cameras, _, _, _ = scene()
    with pytest.raises(ValueError, match="equal camera"):
        triangulate(cameras, [np.zeros(2)])
    # These rays meet behind the cameras, even though the linear system has full rank.
    pixels = [np.array([400 + c.centre[0] * 80, 300.0]) for c in cameras]
    assert np.isnan(triangulate(cameras, pixels)).all()


def test_joint_camera_refinement_improves_heldout_points_without_using_them():
    cameras, points, tracks, controls = scene()
    rng = np.random.default_rng(25)
    noisy = [replace(c, centre=c.centre + rng.normal(0, 0.04, 3)) for c in cameras]
    before = [
        np.linalg.norm(triangulate(noisy, [t.pixels[c.image_id] for c in noisy]) - p)
        for t, p in zip(tracks[3:], points[3:], strict=True)
    ]
    result = refine(noisy, tracks, controls)
    assert result["status"] == "reconstructed"
    after = [
        np.linalg.norm(np.array(result["points"][str(i)]) - p)
        for i, p in enumerate(points)
        if i >= 3
    ]
    assert np.median(after) < np.median(before) / 3
    assert np.percentile(after, 90) < 0.15
    assert not result["publishable"]


def test_absolute_gauge_rejected_before_optimization(monkeypatch):
    def forbidden(*args, **kwargs):
        pytest.fail("unanchored geometry reached optimizer")

    monkeypatch.setattr("smc.reconstruction.multiview.least_squares", forbidden)
    cameras, _, tracks, _ = scene()
    result = refine(cameras, tracks, [])
    assert result["status"] == "unobservable"
    assert result["visual_observability"]["nullity"] == 4
    assert not result["optimization_attempted"]


def test_identical_viewpoints_refused_before_optimization(monkeypatch):
    monkeypatch.setattr(
        "smc.reconstruction.multiview.least_squares",
        lambda *a, **k: pytest.fail("near-identical views optimized"),
    )
    cameras, _, tracks, controls = scene(baseline=0.00001, noise_px=0)
    result = refine(cameras, tracks, controls)
    assert result["status"] == "insufficient_observable_tracks"
    assert result["attempted_tracks"] == 16
    assert len(result["rejected_tracks"]) == 16


def test_spatial_relation_conflict_does_not_warp_street():
    cameras, points, tracks, controls = scene()
    relation = Relation("4", "5", 50.0, 0.2, "other-block", "street_width", "this-block", 0.5)
    result = refine(cameras, tracks, controls, [relation])
    assert result["status"] == "reconstructed"
    assert result["spatial_relations_used"] == 0
    assert result["spatial_relation_conflicts"][0]["source_id"] == "other-block"
    assert np.linalg.norm(np.array(result["points"]["4"]) - points[4]) < 0.15


def test_compatible_setback_is_used_with_declared_uncertainty():
    cameras, points, tracks, controls = scene()
    distance = float(np.linalg.norm((points[4] - points[5])[:2]))
    r = Relation("4", "5", distance, 0.02, "independent-setback", "curb_building_setback", "block")
    result = refine(cameras, tracks, controls, [r])
    assert result["status"] == "reconstructed"
    assert result["spatial_relations_used"] == 1
    assert result["relation_sources"] == ["independent-setback"]


def test_transferred_relation_requires_uncertainty():
    cameras, _, tracks, controls = scene()
    r = Relation("4", "5", 2.0, 0.1, "width", "street_width", "block-b", source_scope_id="block-a")
    with pytest.raises(ValueError, match="transfer uncertainty"):
        refine(cameras, tracks, controls, [r])


def test_candidate_graph_preserves_sequences_but_excludes_aliases_and_unaligned_components():
    cameras, _, _, _ = scene()
    frames = [Frame(c, "sequence", "aligned-a", str(i)) for i, c in enumerate(cameras)]
    assert len(candidate_pairs(frames)) == 3
    assert candidate_pairs([frames[0], replace(frames[1], pixel_sha256="0")]) == []
    assert candidate_pairs([frames[0], replace(frames[1], component_id="unaligned-b")]) == []


def test_tracks_require_cycle_and_refuse_two_features_in_one_view():
    points = [np.zeros((2, 2)) for _ in range(3)]
    chain = [(0, 0, 1, 0), (1, 0, 2, 0)]
    assert cycle_tracks(points, chain, ["a", "b", "c"]) == []
    cycle = [*chain, (2, 0, 0, 0)]
    assert len(cycle_tracks(points, cycle, ["a", "b", "c"])) == 1
    assert cycle_tracks(points, [*cycle, (2, 0, 0, 1)], ["a", "b", "c"]) == []


def test_mutual_matching_handles_missing_and_single_descriptors():
    assert mutual_matches(None, np.zeros((4, 128), np.float32)) == []
    assert mutual_matches(np.zeros((1, 128), np.float32), np.zeros((4, 128), np.float32)) == []


def test_real_feature_extractor_tracks_masked_synthetic_multidepth_images():
    # Actual SIFT descriptors / epipolar RANSAC, not supplied correspondences.
    cameras, _, _, _ = scene()
    rng = np.random.default_rng(90)
    images = [np.full((600, 800), 110, np.uint8) for _ in cameras]
    for row in range(4):
        for col in range(5):
            depth = float(rng.uniform(16, 28))
            p = np.array([(col - 2) * 2.5, (row - 1.5) * 2.5, depth])
            patch = rng.integers(0, 255, (48, 48), dtype=np.uint8)
            for c, image in zip(cameras, images, strict=True):
                x, y = np.round(c.project(p)[0]).astype(int)
                image[y - 24 : y + 24, x - 24 : x + 24] = patch
    frames = [Frame(c, "drive", "aligned", str(i)) for i, c in enumerate(cameras)]
    masks = [np.zeros((600, 800), bool) for _ in cameras]
    cv2.setRNGSeed(42)
    tracks, report = match_frames(frames, images, masks)
    assert report["candidate_pairs"] == len(report["verified_pairs"]) == 3
    assert len(tracks) >= 8
    assert all(len(t.pixels) == 3 for t in tracks)
    blocked = [np.ones((600, 800), bool) for _ in cameras]
    assert match_frames(frames, images, blocked)[0] == []


def test_failed_and_untouched_cases_stay_in_denominator():
    manifest = benchmark(
        [{"case_id": str(i), "checkpoints": [checkpoint("p", [0, 0, 0])]} for i in range(4)]
    )
    result = evaluate(
        manifest,
        {
            "0": {"status": "reconstructed", "points": {"p": [0.01, 0, 0]}},
            "1": {"status": "unobservable"},
            "2": {"status": "missing_pixels"},
        },
        {},
    )
    assert result["successful_reconstruction_rate"] == 0.25
    assert result["planned_checkpoints"] == 4
    assert result["within_threshold_all_checkpoints"] == 0.25
    assert result["conditional_finite_median_m"] == 0.01
    assert result["all_attempts_p90_m"] is None
    assert result["outcomes"]["not_attempted"] == 1


@pytest.mark.parametrize("leak", ["id", "source"])
def test_benchmark_truth_cannot_be_used_as_fitting_control(leak):
    point = checkpoint("test", [0, 0, 0])
    manifest = benchmark([{"case_id": "a", "checkpoints": [point]}])
    fitting = {
        "a": {
            "controls": [
                {
                    "track_id": "test" if leak == "id" else "other",
                    "source_id": "heldout-survey" if leak == "source" else "fit",
                }
            ]
        }
    }
    with pytest.raises(ValueError, match="held-out checkpoint used"):
        validate_benchmark(manifest, fitting)


def test_nearest_curb_match_is_not_independent_correspondence():
    point = {**checkpoint("p", [0, 0, 0]), "correspondence": "nearest_segment_after_fit"}
    with pytest.raises(ValueError, match="reviewed ID"):
        evaluate(benchmark([{"case_id": "a", "checkpoints": [point]}]), {}, {})


@pytest.mark.parametrize(
    "key,value",
    [
        ("image_sha256", "a" * 64),
        ("pixel_sha256", "b" * 64),
        ("sequence_id", "seq"),
        ("captured_at", "2025-01-01T12:00:00Z"),
    ],
)
def test_heldout_alias_sequence_and_date_leakage(key, value):
    with pytest.raises(ValueError, match="leakage"):
        assert_holdout_disjoint([{key: value}], [{key: value}])


def test_disconnected_dense_groups_do_not_qualify_as_connected_camera_graph(tmp_path):
    frame = EnuFrame(0, 0, 0)
    positions = {f"a{i}": (i * 0.00001, 0.0, 0.0) for i in range(4)}
    positions.update({f"b{i}": (0.1 + i * 0.00001, 0.0, 0.0) for i in range(4)})
    with pytest.raises(ValueError, match="disconnected"):
        _write_pairs(list(positions), frame, positions, tmp_path / "pairs.txt")


def test_no_truth_cases_report_unscored_not_success():
    result = evaluate(
        benchmark([{"case_id": "a", "checkpoints": []}]), {"a": {"status": "reconstructed"}}, {}
    )
    assert result["successful_reconstruction_rate"] == 0
    assert result["cases"][0]["unscored_missing_truth"]


def test_frozen_batch_keeps_cases_missing_prepared_tracks():
    manifest = benchmark([{"case_id": "a", "checkpoints": []}, {"case_id": "b", "checkpoints": []}])
    result = run(
        {
            "coordinate_frame": "local_ENU_m",
            "enu_origin_wgs84": [0, 0, 0],
            "cases": [{"case_id": "a"}],
        },
        manifest,
    )
    assert result["benchmark"]["attempted_cases"] == 2
    assert result["benchmark"]["outcomes"] == {"missing_prepared_tracks": 1, "not_attempted": 1}


def test_verified_sequence_groups_retain_isolated_frames():
    assert overlap_groups(["a", "b", "c", "d"], [("a", "b"), ("b", "c")]) == [
        ["a", "b", "c"],
        ["d"],
    ]


def test_metric_alignment_refuses_collinear_camera_trajectory():
    with pytest.raises(ValueError, match="unobservable metric alignment"):
        require_metric_alignment_support(np.column_stack((np.arange(20), np.zeros((20, 2)))))
    # A street corner supplies the missing rotation information; a flat plane is fine.
    require_metric_alignment_support(np.array([[x, y, 0] for x in range(3) for y in range(3)]))


def test_benchmark_refuses_fabricated_truth_from_nearest_segment():
    point = {
        **checkpoint("p", [0, 0, 0]),
        "method": "survey",
        "correspondence": "nearest_segment_after_fit",
    }
    manifest = {
        **benchmark([{"case_id": "a", "checkpoints": [point]}]),
        "purpose": "independent_metric_benchmark",
    }
    with pytest.raises(ValueError, match="reviewed ID"):
        evaluate(manifest, {}, {})


def test_many_good_points_cannot_hide_failed_cases_without_truth():
    checkpoints = [checkpoint(str(i), [0, 0, 0]) for i in range(100)]
    manifest = benchmark(
        [
            {"case_id": "good", "checkpoints": checkpoints},
            *[{"case_id": str(i), "checkpoints": []} for i in range(3)],
        ]
    )
    result = evaluate(
        manifest,
        {"good": {"status": "reconstructed", "points": {str(i): [0, 0, 0] for i in range(100)}}},
        {},
    )
    assert result["successful_reconstruction_rate"] == 0.25
    assert result["conditional_finite_median_m"] == 0
    assert result["all_attempts_median_m"] is None


def test_preparation_enforces_pixel_identity_and_keeps_singleton(tmp_path):
    image = tmp_path / "frame.png"
    masks = tmp_path / "masks.npz"
    cv2.imwrite(str(image), np.full((80, 80, 3), 100, np.uint8))
    np.savez(
        masks,
        **{k: np.zeros((80, 80), bool) for k in ("person", "face", "license_plate", "car", "sky")},
    )
    rights_path = tmp_path / "rights.json"
    rights_path.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "sources": [
                    {
                        "source_id": "owned-test",
                        "license_id": "owned",
                        "attribution": "test",
                        "status": "approved",
                        "allowed_uses": ["cv_processing"],
                    }
                ],
            }
        )
    )
    rights = load_rights(rights_path)
    row = {
        "source_id": "owned-test",
        "license_id": "owned",
        "attribution": "test",
        "image_path": str(image),
        "image_sha256": sha256_file(image),
        "pixel_sha256": CanonicalPixels.from_image(image).sha256,
        "masks_npz": str(masks),
        "masks_sha256": sha256_file(masks),
        "sequence_id": "drive",
        "component_id": "aligned",
        "reprojection_sigma_px": 1,
        "camera": {
            "image_id": 123,
            "centre": [0, 0, 0],
            "rotation": np.eye(3).tolist(),
            "focal_px": 80,
            "principal": [40, 40],
            "width": 80,
            "height": 80,
            "k1": 0,
            "k2": 0,
        },
    }
    prepared = prepare({"case_id": "test", "images": [row]}, rights)
    assert len(prepared) == 1 and len(prepared[0]["images"]) == 1
    assert prepared[0]["tracks"] == []
    bad = {**row, "pixel_sha256": "0" * 64}
    with pytest.raises(ValueError, match="pixel checksum"):
        prepare({"case_id": "test", "images": [bad]}, rights)


def test_batch_refines_without_passing_checkpoint_coordinates_to_solver():
    cameras, points, tracks, controls = scene()
    config = {
        "case_id": "test",
        "images": [
            {
                "camera": {
                    "image_id": c.image_id,
                    "centre": c.centre.tolist(),
                    "rotation": c.rotation.tolist(),
                    "focal_px": c.focal_px,
                    "principal": list(c.principal),
                    "k1": c.k1,
                    "k2": c.k2,
                    "width": c.width,
                    "height": c.height,
                }
            }
            for c in cameras
        ],
        "tracks": [
            {"track_id": t.track_id, "pixels": {k: px.tolist() for k, px in t.pixels.items()}}
            for t in tracks
        ],
        "controls": [
            {
                "track_id": c.track_id,
                "xyz": c.xyz.tolist(),
                "sigma_m": c.sigma_m,
                "source_id": c.source_id,
            }
            for c in controls
        ],
    }
    document = {"coordinate_frame": "local_ENU_m", "enu_origin_wgs84": [0, 0, 0], "cases": [config]}
    truth = benchmark(
        [
            {
                "case_id": "test",
                "checkpoints": [checkpoint(str(i), p) for i, p in enumerate(points) if i >= 3],
            }
        ]
    )
    result = run(document, truth)
    assert result["benchmark"]["successful_reconstruction_rate"] == 1
    # Changing held-out coordinates changes only the score, never the reconstruction.
    changed = json.loads(json.dumps(truth))
    changed["cases"][0]["checkpoints"][0]["xyz"][0] += 2
    again = run(document, changed)
    assert again["predictions"] == result["predictions"]
    assert again["benchmark"]["successful_reconstruction_rate"] == 0
