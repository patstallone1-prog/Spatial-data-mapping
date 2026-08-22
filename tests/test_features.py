"""Tests for real feature detection and matching."""

from __future__ import annotations

import numpy as np
import pytest

from smc import geo
from smc.calibrate import PairResult, discover, summarise
from smc.carla_gen.world import build_corridor
from smc.ingest.capture import RigConfig, pose_at_station
from smc.mapping.features import (
    Detector,
    FeatureConfig,
    OpenCVMatcher,
    detect,
    match_features,
)
from smc.mapping.retrieval import ReferenceFrame
from smc.render.raster import corridor_triangles, render_meshes

ORIGIN = geo.Origin(38.9072, -77.0369)
CONFIG = FeatureConfig(max_features=4000, contrast_threshold=0.008)


@pytest.fixture(scope="module")
def views() -> dict[float, np.ndarray]:
    corridor = build_corridor("f", ORIGIN, 20260820, n_blocks=1)
    triangles, colours = corridor_triangles(corridor)
    rig = RigConfig(width=480, height=360, focal_px=360.0)
    return {
        station: render_meshes(
            triangles, colours, pose_at_station(station, rig), rig.intrinsics, 480, 360
        ).image
        for station in (20.0, 22.0, 26.0, 32.0)
    }


class TestDetection:
    def test_finds_features_on_a_street_scene(self, views: dict) -> None:
        assert len(detect(views[20.0], CONFIG)) > 100

    def test_descriptor_shape_matches_detector(self, views: dict) -> None:
        sift = detect(views[20.0], FeatureConfig(detector=Detector.SIFT))
        orb = detect(views[20.0], FeatureConfig(detector=Detector.ORB))
        assert sift.descriptors.shape[1] == 128
        assert orb.descriptors.shape[1] == 32
        assert orb.is_binary and not sift.is_binary

    def test_blank_image_yields_nothing_rather_than_noise(self) -> None:
        blank = np.full((200, 300, 3), 128, dtype=np.uint8)
        assert len(detect(blank, CONFIG)) < 10

    def test_detection_is_deterministic(self, views: dict) -> None:
        a = detect(views[20.0], CONFIG)
        b = detect(views[20.0], CONFIG)
        assert np.allclose(a.keypoints, b.keypoints)


class TestMatching:
    def test_matches_fall_off_with_baseline(self, views: dict) -> None:
        base = detect(views[20.0], CONFIG)
        counts = [
            len(match_features(base, detect(views[s], CONFIG), CONFIG)[0])
            for s in (22.0, 26.0, 32.0)
        ]
        assert counts[0] > counts[-1], counts
        assert counts[0] > 10

    def test_unrelated_images_barely_match(self, views: dict) -> None:
        rng = np.random.default_rng(0)
        noise = rng.integers(0, 255, (360, 480, 3), dtype=np.uint8)
        query, _ = match_features(
            detect(views[20.0], CONFIG), detect(noise, CONFIG), CONFIG
        )
        assert len(query) < 10

    def test_geometric_verification_prunes(self, views: dict) -> None:
        a, b = detect(views[20.0], CONFIG), detect(views[26.0], CONFIG)
        loose = FeatureConfig(
            max_features=4000, contrast_threshold=0.008, geometric_threshold_px=None
        )
        assert len(match_features(a, b, CONFIG)[0]) <= len(match_features(a, b, loose)[0])

    def test_mutual_check_is_stricter(self, views: dict) -> None:
        a, b = detect(views[20.0], CONFIG), detect(views[26.0], CONFIG)
        one_way = FeatureConfig(
            max_features=4000, contrast_threshold=0.008, mutual=False,
            geometric_threshold_px=None,
        )
        both = FeatureConfig(
            max_features=4000, contrast_threshold=0.008, mutual=True,
            geometric_threshold_px=None,
        )
        assert len(match_features(a, b, both)[0]) <= len(match_features(a, b, one_way)[0])

    def test_mismatched_detectors_are_refused(self, views: dict) -> None:
        sift = detect(views[20.0], FeatureConfig(detector=Detector.SIFT))
        orb = detect(views[20.0], FeatureConfig(detector=Detector.ORB))
        with pytest.raises(ValueError, match="cannot match"):
            match_features(sift, orb)

    def test_empty_side_returns_nothing(self, views: dict) -> None:
        empty = detect(np.full((200, 300, 3), 128, dtype=np.uint8), CONFIG)
        query, ref = match_features(detect(views[20.0], CONFIG), empty, CONFIG)
        assert len(query) == len(ref) == 0


class TestOpenCVMatcher:
    def test_skips_references_seeded_without_descriptors(self, views: dict) -> None:
        """An oracle-seeded frame cannot be matched against; skipping beats a silent zero."""
        rng = np.random.default_rng(0)
        frame = ReferenceFrame(
            "r1", 38.9, -77.0, rng.normal(size=64),
            rng.uniform(-5, 5, (30, 3)), rng.uniform(0, 400, (30, 2)),
        )
        matcher = OpenCVMatcher(views[20.0], CONFIG)
        assert len(matcher.match(matcher.keypoints(), frame)[0]) == 0

    def test_descriptor_count_must_align_with_keypoints(self) -> None:
        rng = np.random.default_rng(0)
        with pytest.raises(ValueError, match="must align"):
            ReferenceFrame(
                "r1", 38.9, -77.0, rng.normal(size=64),
                rng.uniform(-5, 5, (30, 3)), rng.uniform(0, 400, (30, 2)),
                local_descriptors=rng.normal(size=(12, 128)),
            )

    def test_matcher_exposes_its_keypoints(self, views: dict) -> None:
        matcher = OpenCVMatcher(views[20.0], CONFIG)
        assert matcher.keypoints().shape[1] == 2
        assert len(matcher.keypoints()) == len(matcher.features)


class TestCalibrationHarness:
    def test_groups_by_filename_stem(self, tmp_path) -> None:
        for name in ("corner01_a.jpg", "corner01_b.jpg", "corner02_a.jpg", "notes.txt"):
            (tmp_path / name).write_bytes(b"x")
        groups = discover(tmp_path)
        assert set(groups) == {"corner01", "corner02"}
        assert len(groups["corner01"]) == 2

    def test_usable_threshold_matches_the_pipeline_floor(self) -> None:
        below = PairResult("g", "a", "b", 400, 400, 40, 11, 0.27)
        at = PairResult("g", "a", "b", 400, 400, 40, 12, 0.30)
        assert not below.usable
        assert at.usable

    def test_summary_of_nothing_is_empty(self) -> None:
        assert summarise([]) == {}
