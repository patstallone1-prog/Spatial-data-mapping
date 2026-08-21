"""Tests for pose geometry, retrieval, and the anchoring pipeline.

Pose recovery is tested by construction: generate a known pose, project points through it, add
noise and outliers, and require the solver to get the pose back. That is the only honest test
of a geometry solver — a fixture of expected numbers would just enshrine whatever it did first.
"""

from __future__ import annotations

import math

import numpy as np
import pytest

from smc import geo
from smc.adapters.free import (
    KEYLESS_SERVICES,
    BoundingBox,
    NominatimClient,
    NtripMountpoint,
    OpenFreeMapTiles,
    OverpassClient,
    OvertureClient,
    ProjectSidewalkClient,
)
from smc.mapping.anchoring import AnchoringConfig, AnchoringPipeline
from smc.mapping.pose import (
    Pose,
    intrinsics,
    pose_covariance,
    position_sigma_m,
    project,
    ransac_pnp,
    reprojection_errors,
    rotation_from_rotvec,
    rotvec_from_rotation,
    solve_pnp_dlt,
)
from smc.mapping.retrieval import DescriptorIndex, ReferenceFrame

ORIGIN = geo.Origin(38.9072, -77.0369)
K = intrinsics(960.0, 960.0, 600.0)


def scene(rng: np.random.Generator, n: int = 150) -> np.ndarray:
    return rng.uniform([-8, -4, -5], [8, 4, 5], size=(n, 3))


TRUTH = Pose.from_rotvec([0.05, -0.12, 0.02], [0.4, -0.2, 9.0])


class TestRotation:
    def test_rotvec_roundtrip(self) -> None:
        rng = np.random.default_rng(0)
        for _ in range(50):
            rotvec = rng.normal(size=3) * rng.uniform(0.0, 3.0)
            recovered = rotvec_from_rotation(rotation_from_rotvec(rotvec))
            assert np.allclose(rotation_from_rotvec(recovered), rotation_from_rotvec(rotvec))

    def test_zero_gives_identity(self) -> None:
        assert np.allclose(rotation_from_rotvec(np.zeros(3)), np.eye(3))

    def test_stable_near_pi(self) -> None:
        rotvec = np.array([0.0, 0.0, math.pi - 1e-9])
        assert np.allclose(
            rotation_from_rotvec(rotvec_from_rotation(rotation_from_rotvec(rotvec))),
            rotation_from_rotvec(rotvec),
            atol=1e-6,
        )


class TestPose:
    def test_camera_centre_is_not_translation(self) -> None:
        """The single easiest thing to get backwards in this whole module."""
        assert not np.allclose(TRUTH.camera_centre, TRUTH.translation)
        assert np.allclose(TRUTH.transform(TRUTH.camera_centre[None, :]), 0.0, atol=1e-9)

    def test_inverse_roundtrips(self) -> None:
        points = np.array([[1.0, 2.0, 3.0], [-4.0, 0.5, 2.0]])
        assert np.allclose(TRUTH.inverse().transform(TRUTH.transform(points)), points)

    def test_rejects_a_reflection(self) -> None:
        with pytest.raises(ValueError, match="determinant"):
            Pose(np.diag([1.0, 1.0, -1.0]), np.zeros(3))

    def test_rejects_non_orthonormal(self) -> None:
        with pytest.raises(ValueError, match="orthonormal"):
            Pose(np.array([[2.0, 0, 0], [0, 1.0, 0], [0, 0, 1.0]]), np.zeros(3))

    def test_distance_helpers(self) -> None:
        other = Pose.from_rotvec(TRUTH.rotvec, TRUTH.translation + np.array([1.0, 0.0, 0.0]))
        assert TRUTH.angular_distance_deg(other) == pytest.approx(0.0, abs=1e-9)
        assert TRUTH.centre_distance_m(other) == pytest.approx(1.0, abs=1e-9)


class TestProjection:
    def test_points_behind_the_camera_are_nan(self) -> None:
        """Not a wrapped coordinate — a mirrored solution is how pose solvers go wrong."""
        behind = np.array([[0.0, 0.0, -20.0]])
        assert np.all(np.isnan(project(behind, TRUTH, K)))

    def test_reprojection_error_of_the_truth_is_zero(self) -> None:
        rng = np.random.default_rng(1)
        points = scene(rng)
        uv = project(points, TRUTH, K)
        ok = ~np.isnan(uv[:, 0])
        assert np.allclose(reprojection_errors(points[ok], uv[ok], TRUTH, K), 0.0, atol=1e-9)


class TestPnp:
    def _correspondences(
        self, rng: np.random.Generator, noise_px: float = 0.0
    ) -> tuple[np.ndarray, np.ndarray]:
        points = scene(rng)
        uv = project(points, TRUTH, K)
        ok = ~np.isnan(uv[:, 0])
        points, uv = points[ok], uv[ok]
        if noise_px:
            uv = uv + rng.normal(0.0, noise_px, uv.shape)
        return points, uv

    def test_dlt_recovers_an_exact_pose(self) -> None:
        rng = np.random.default_rng(2)
        points, uv = self._correspondences(rng)
        recovered = solve_pnp_dlt(points, uv, K)
        assert recovered.centre_distance_m(TRUTH) < 1e-6
        assert recovered.angular_distance_deg(TRUTH) < 1e-6

    def test_dlt_needs_six_points(self) -> None:
        rng = np.random.default_rng(2)
        points, uv = self._correspondences(rng)
        with pytest.raises(ValueError, match="at least 6"):
            solve_pnp_dlt(points[:5], uv[:5], K)

    def test_dlt_rejects_mismatched_lengths(self) -> None:
        rng = np.random.default_rng(2)
        points, uv = self._correspondences(rng)
        with pytest.raises(ValueError, match="same length"):
            solve_pnp_dlt(points, uv[:-1], K)

    def test_ransac_survives_heavy_outlier_contamination(self) -> None:
        rng = np.random.default_rng(7)
        points, uv = self._correspondences(rng, noise_px=0.5)
        n_out = int(0.35 * len(uv))
        idx = rng.choice(len(uv), n_out, replace=False)
        uv[idx] += rng.uniform(-200, 200, (n_out, 2))

        result = ransac_pnp(points, uv, K, rng=rng)
        assert result is not None
        assert result.pose.centre_distance_m(TRUTH) < 0.05
        assert result.pose.angular_distance_deg(TRUTH) < 0.1
        assert result.inlier_ratio > 0.55

    def test_ransac_refuses_rather_than_guessing(self) -> None:
        """A refusal costs one unanchored frame; a wrong pose corrupts every fact from it."""
        rng = np.random.default_rng(3)
        points = scene(rng)
        garbage = rng.uniform(0, 1200, (len(points), 2))
        assert ransac_pnp(points, garbage, K, rng=rng) is None

    def test_ransac_needs_enough_points(self) -> None:
        rng = np.random.default_rng(3)
        assert ransac_pnp(scene(rng, 4), rng.uniform(0, 1200, (4, 2)), K) is None


class TestPoseUncertainty:
    def test_more_points_lower_the_uncertainty(self) -> None:
        rng = np.random.default_rng(5)
        sigmas = []
        for n in (12, 200):
            points = scene(rng, n)
            uv = project(points, TRUTH, K)
            ok = ~np.isnan(uv[:, 0])
            cov = pose_covariance(points[ok], uv[ok], K, TRUTH)
            sigmas.append(position_sigma_m(cov))
        assert sigmas[1] < sigmas[0]

    def test_degenerate_configuration_reports_infinite(self) -> None:
        collinear = np.c_[np.linspace(-1, 1, 8), np.zeros(8), np.full(8, 10.0)]
        uv = project(collinear, TRUTH, K)
        sigma = position_sigma_m(pose_covariance(collinear, uv, K, TRUTH))
        assert sigma > 1.0 or math.isinf(sigma)


class TestRetrieval:
    def _index(self, n: int = 40) -> DescriptorIndex:
        frames = []
        for i in range(n):
            rng = np.random.default_rng(i)
            frames.append(
                ReferenceFrame(
                    f"f{i}",
                    38.9072 + i * 1e-4,
                    -77.0369,
                    rng.normal(size=128),
                    rng.uniform(-5, 5, (30, 3)),
                    rng.uniform(0, 1000, (30, 2)),
                )
            )
        return DescriptorIndex(frames)

    def test_correct_frame_ranks_first_with_a_margin(self) -> None:
        index = self._index()
        rng = np.random.default_rng(9)
        target = index.search(
            np.random.default_rng(7).normal(size=128), 38.9072 + 7e-4, -77.0369,
            radius_m=5.0, min_similarity=-1.0,
        )
        assert target and target[0].frame.frame_id == "f7"
        noisy = target[0].frame.descriptor + rng.normal(0, 0.02, 128)
        hits = index.search(noisy, 38.9072 + 7e-4, -77.0369, radius_m=60.0, min_similarity=-1.0)
        assert hits[0].frame.frame_id == "f7"
        assert hits[0].similarity - hits[1].similarity > 0.5

    def test_geographic_prefilter_excludes_the_rest_of_the_city(self) -> None:
        index = self._index()
        rng = np.random.default_rng(0)
        near = index.search(
            rng.normal(size=128), 38.9072 + 7e-4, -77.0369, radius_m=60.0,
            top_k=99, min_similarity=-1.0,
        )
        assert 0 < len(near) < len(index)
        assert index.search(rng.normal(size=128), 39.5, -77.0369) == []

    def test_radius_follows_position_uncertainty(self) -> None:
        index = self._index(2)
        assert index.radius_for_sigma(5.5) > index.radius_for_sigma(0.5)
        assert index.radius_for_sigma(0.0) >= 15.0
        with pytest.raises(ValueError):
            index.radius_for_sigma(-1.0)

    def test_rejects_degenerate_descriptors(self) -> None:
        rng = np.random.default_rng(0)
        with pytest.raises(ValueError, match="zero norm"):
            ReferenceFrame("f", 0.0, 0.0, np.zeros(8), rng.uniform(size=(3, 3)),
                           rng.uniform(size=(3, 2)))
        with pytest.raises(ValueError, match="same length"):
            ReferenceFrame("f", 0.0, 0.0, rng.normal(size=8), rng.uniform(size=(3, 3)),
                           rng.uniform(size=(2, 2)))

    def test_dimension_mismatch_is_loud(self) -> None:
        index = self._index(2)
        with pytest.raises(ValueError, match="dimension mismatch"):
            index.search(np.ones(64), 38.9072, -77.0369, radius_m=1000.0)


class _IdentityMatcher:
    name = "identity"

    def match(self, query_keypoints: np.ndarray, reference: ReferenceFrame):
        n = min(len(query_keypoints), len(reference.points_world))
        return np.arange(n), np.arange(n)


class TestAnchoringPipeline:
    def _pipeline(self, config: AnchoringConfig | None = None):
        rng = np.random.default_rng(11)
        world = rng.uniform([-15, 4, -2], [15, 12, 6], size=(400, 3))
        frames = []
        for i in range(6):
            sel = rng.choice(len(world), 60, replace=False)
            pose = Pose.from_rotvec([0.01 * i, -0.04, 0.0], [float(i) * 2 - 5, -1.4, 0.0])
            uv = project(world[sel], pose, K)
            ok = ~np.isnan(uv[:, 0])
            lat, lon = geo.enu_to_geodetic(
                ORIGIN, float(pose.camera_centre[0]), float(pose.camera_centre[1])
            )
            frames.append(
                ReferenceFrame(f"r{i}", lat, lon, rng.normal(size=128), world[sel][ok], uv[ok],
                               position_sigma_m=0.30)
            )
        index = DescriptorIndex(frames)
        return AnchoringPipeline(index, _IdentityMatcher(), K, ORIGIN, config), frames

    def test_corrects_a_metres_wrong_prior(self) -> None:
        pipeline, frames = self._pipeline()
        rng = np.random.default_rng(4)
        target = frames[2]
        query_desc = target.descriptor + rng.normal(0, 0.02, 128)
        query_kp = target.points_2d + rng.normal(0, 0.4, target.points_2d.shape)
        east, north = geo.geodetic_to_enu(ORIGIN, target.lat, target.lon)
        prior_lat, prior_lon = geo.enu_to_geodetic(ORIGIN, east + 6.0, north - 5.0)

        result = pipeline.anchor(query_desc, query_kp, prior_lat, prior_lon, 8.0, rng=rng)
        assert result is not None
        assert geo.distance_m(prior_lat, prior_lon, target.lat, target.lon) > 5.0
        assert geo.distance_m(result.lat, result.lon, target.lat, target.lon) < 0.5
        assert result.is_submetre

    def test_reference_uncertainty_propagates(self) -> None:
        """A query cannot be better anchored than the references it stood on."""
        pipeline, frames = self._pipeline()
        rng = np.random.default_rng(4)
        target = frames[2]
        result = pipeline.anchor(
            target.descriptor, target.points_2d, target.lat, target.lon, 8.0, rng=rng
        )
        assert result is not None
        assert result.position_sigma_m >= 0.9 * min(f.position_sigma_m for f in frames)

    def test_returns_none_when_nothing_retrieves(self) -> None:
        pipeline, _ = self._pipeline()
        rng = np.random.default_rng(4)
        assert pipeline.anchor(rng.normal(size=128), rng.uniform(0, 1000, (60, 2)),
                               45.0, -93.0, 8.0, rng=rng) is None

    def test_rejects_a_pose_that_teleports_from_the_prior(self) -> None:
        """Perceptual aliasing in repetitive streetscapes is the normal cause."""
        pipeline, frames = self._pipeline(AnchoringConfig(max_prior_displacement_m=0.5))
        rng = np.random.default_rng(4)
        target = frames[2]
        east, north = geo.geodetic_to_enu(ORIGIN, target.lat, target.lon)
        prior_lat, prior_lon = geo.enu_to_geodetic(ORIGIN, east + 20.0, north)
        assert pipeline.anchor(
            target.descriptor, target.points_2d, prior_lat, prior_lon, 8.0, rng=rng
        ) is None

    def test_heading_is_recovered(self) -> None:
        pipeline, frames = self._pipeline()
        rng = np.random.default_rng(4)
        target = frames[2]
        result = pipeline.anchor(
            target.descriptor, target.points_2d, target.lat, target.lon, 8.0, rng=rng
        )
        assert result is not None
        assert 0.0 <= result.heading_deg < 360.0


class TestKeylessAdapters:
    def test_every_keyless_service_is_listed(self) -> None:
        assert len(KEYLESS_SERVICES) == 6

    def test_bounding_box_brackets_the_centre(self) -> None:
        bbox = BoundingBox.around(38.9072, -77.0369, 120.0)
        assert bbox.south < 38.9072 < bbox.north
        assert bbox.west < -77.0369 < bbox.east

    def test_bounding_box_rejects_inversion(self) -> None:
        with pytest.raises(ValueError, match="inverted"):
            BoundingBox(10.0, 0.0, 5.0, 1.0)

    def test_overpass_query_covers_pedestrian_tags(self) -> None:
        query = OverpassClient().pedestrian_query(BoundingBox.around(38.9072, -77.0369, 100.0))
        for tag in ("sidewalk", "crossing", "kerb", "out:json"):
            assert tag in query

    def test_nominatim_urls_are_https(self) -> None:
        client = NominatimClient()
        assert client.reverse_url(38.9, -77.0).startswith("https://")
        assert client.search_url("14th St NW").startswith("https://")

    def test_project_sidewalk_rejects_unknown_city(self) -> None:
        with pytest.raises(ValueError, match="unknown deployment"):
            ProjectSidewalkClient("atlantis")
        assert ProjectSidewalkClient(city="atlantis", base_url="https://x").access_attributes_url(
            BoundingBox.around(0.1, 0.1, 50.0)
        ).startswith("https://x")

    def test_overture_licence_split_is_encoded(self) -> None:
        """Buildings are the useful anchor theme and the share-alike one. Easy to forget."""
        client = OvertureClient()
        assert client.is_share_alike("buildings")
        assert client.is_share_alike("transportation")
        assert not client.is_share_alike("places")
        with pytest.raises(ValueError, match="unknown Overture theme"):
            client.theme_path("weather", "x")

    def test_overture_query_is_bounded(self) -> None:
        bbox = BoundingBox.around(38.9072, -77.0369, 100.0)
        sql = OvertureClient().duckdb_query("buildings", "building", bbox, limit=10)
        assert "LIMIT 10" in sql and "read_parquet" in sql

    def test_tile_style_validated(self) -> None:
        assert OpenFreeMapTiles().style_url("positron").startswith("https://")
        with pytest.raises(ValueError, match="unknown style"):
            OpenFreeMapTiles().style_url("neon")

    def test_ntrip_requires_a_chosen_base_station(self) -> None:
        with pytest.raises(ValueError, match="35-50 km"):
            _ = NtripMountpoint().url
        assert NtripMountpoint(mountpoint="DCBASE1").url.endswith("DCBASE1")
