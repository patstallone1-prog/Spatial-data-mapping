"""Tests for measurement extraction, street overlay, gait, and the photo bank."""

from __future__ import annotations

import numpy as np
import pytest

from smc import geo, units
from smc.capture.gait import GaitConfig, GaitSimulator
from smc.capture.trigger import CaptureContext, MotionState, TriggerEngine
from smc.carla_gen.world import build_corridor
from smc.facts.schema import FactClass, Provenance, Tier
from smc.ingest.photobank import GlassesProfile, wearer_pose
from smc.measure.extract import MeasurementConfig, measure_cross_section, to_world_facts
from smc.measure.planes import (
    estimate_kerb_offset,
    fit_plane_ransac,
    perpendicular_extent,
    slope_uncertainty,
    split_kerb_planes,
)
from smc.overlay.street import StreetMap, StreetSegment, corridor_street_map

ORIGIN = geo.Origin(38.9072, -77.0369)
CROSS = np.array([0.0, 1.0, 0.0])


def kerb_cloud(
    *, kerb_m: float = 0.152, width_m: float = 1.6, cross_slope: float = 0.015,
    noise_m: float = 0.006, n: int = 900, seed: int = 0, kerb_at: float = 0.45,
) -> np.ndarray:
    """A synthetic road-plus-footway cross-section with known geometry."""
    rng = np.random.default_rng(seed)
    road = np.c_[rng.uniform(0, 20, n), rng.uniform(-8.0, kerb_at, n), np.zeros(n)]
    y = rng.uniform(kerb_at, kerb_at + width_m, n)
    walk = np.c_[rng.uniform(0, 20, n), y, kerb_m + (y - kerb_at) * cross_slope]
    return np.vstack([road, walk]) + rng.normal(0.0, noise_m, (2 * n, 3))


class TestPlaneFitting:
    def test_kerb_line_is_found(self) -> None:
        offset = estimate_kerb_offset(kerb_cloud(), CROSS)
        assert offset is not None
        assert abs(offset - 0.45) < 0.25

    def test_a_tilted_plane_cannot_bridge_both_surfaces(self) -> None:
        """The failure that made the naive version useless.

        The carriageway spans ten metres laterally while the kerb step is 0.15 m, so a plane
        tilted two percent reaches across both and wins on inlier count.
        """
        points = kerb_cloud()
        dominant = fit_plane_ransac(points, rng=np.random.default_rng(1))
        assert dominant is not None
        # The naive single fit really does span both surfaces...
        assert dominant.inlier_count > 1000
        # ...and splitting at the kerb line first recovers the truth anyway.
        planes = split_kerb_planes(points, cross_axis=CROSS, rng=np.random.default_rng(1))
        assert planes is not None
        assert abs(planes.step_m - 0.152) < 0.01

    def test_flush_kerb_reports_zero_not_failure(self) -> None:
        """A driveway apron is a kerb of zero height, not an absent measurement."""
        planes = split_kerb_planes(
            kerb_cloud(kerb_m=0.0), cross_axis=CROSS, kerb_offset_hint=0.45,
            rng=np.random.default_rng(2),
        )
        assert planes is not None
        assert planes.step_m < 0.02

    def test_map_hint_and_search_agree(self) -> None:
        points = kerb_cloud()
        searched = split_kerb_planes(points, cross_axis=CROSS, rng=np.random.default_rng(3))
        hinted = split_kerb_planes(
            points, cross_axis=CROSS, kerb_offset_hint=0.45, rng=np.random.default_rng(3)
        )
        assert searched is not None and hinted is not None
        assert abs(searched.step_m - hinted.step_m) < 0.01

    def test_plane_threshold_keeps_trip_hazards_as_outliers(self) -> None:
        """20 mm sits just above the quarter-inch hazard threshold, deliberately."""
        assert 0.02 > units.LEVEL_CHANGE_PASSABLE_M

    def test_extent_bias_is_corrected(self) -> None:
        rng = np.random.default_rng(0)
        y = rng.uniform(0.0, 2.0, 4000)
        points = np.c_[np.zeros(4000), y, np.zeros(4000)]
        span, _, _ = perpendicular_extent(points, CROSS)
        assert abs(span - 2.0) < 0.05

    def test_slope_uncertainty_falls_with_span(self) -> None:
        plane = fit_plane_ransac(kerb_cloud(), rng=np.random.default_rng(0))
        assert plane is not None
        assert slope_uncertainty(plane, 4.0) < slope_uncertainty(plane, 1.0)
        with pytest.raises(ValueError):
            slope_uncertainty(plane, 0.0)

    def test_too_few_points_returns_none(self) -> None:
        assert fit_plane_ransac(np.zeros((5, 3))) is None


class TestMeasurement:
    def test_kerb_height_is_accurate_to_millimetres(self) -> None:
        section = measure_cross_section(
            kerb_cloud(), 10.0, rng=np.random.default_rng(0), kerb_offset_hint=0.45
        )
        assert section.ok
        assert section.kerb is not None
        assert abs(section.kerb.height_m - 0.152) < 0.005
        assert str(section.kerb.bucket) == "standard"

    def test_width_meets_the_tier_b_target(self) -> None:
        section = measure_cross_section(
            kerb_cloud(width_m=1.6), 10.0, rng=np.random.default_rng(0), kerb_offset_hint=0.45
        )
        assert section.sidewalk is not None
        assert abs(section.sidewalk.width_m - 1.6) < 0.15

    @pytest.mark.parametrize(
        ("height_m", "expected"),
        [(0.0, "flush"), (units.inches(2.0), "low"), (units.inches(6.0), "standard")],
    )
    def test_buckets_track_the_measurement(self, height_m: float, expected: str) -> None:
        section = measure_cross_section(
            kerb_cloud(kerb_m=height_m), 10.0, rng=np.random.default_rng(0),
            kerb_offset_hint=0.45,
        )
        assert section.kerb is not None
        assert str(section.kerb.bucket) == expected

    def test_cross_slope_is_not_decidable_from_this_data(self) -> None:
        """The arithmetic behind Tier C: a 1.5% rise over 1.6 m is inside the fit noise."""
        section = measure_cross_section(
            kerb_cloud(), 10.0, rng=np.random.default_rng(0), kerb_offset_hint=0.45
        )
        assert section.sidewalk is not None
        assert not section.sidewalk.cross_slope_is_decidable
        assert "cross_slope_indecisive" in section.flags

    def test_scale_uncertainty_inflates_the_dimension_sigma(self) -> None:
        tight = measure_cross_section(
            kerb_cloud(), 10.0, config=MeasurementConfig(scale_relative_sigma=0.001),
            rng=np.random.default_rng(0), kerb_offset_hint=0.45,
        )
        loose = measure_cross_section(
            kerb_cloud(), 10.0, config=MeasurementConfig(scale_relative_sigma=0.10),
            rng=np.random.default_rng(0), kerb_offset_hint=0.45,
        )
        assert tight.sidewalk is not None and loose.sidewalk is not None
        assert loose.sidewalk.width_sigma_m > 5 * tight.sidewalk.width_sigma_m

    def test_sparse_input_is_refused(self) -> None:
        section = measure_cross_section(np.zeros((10, 3)), 0.0)
        assert not section.ok
        assert "too_few_points" in section.flags

    def test_implausible_width_is_rejected(self) -> None:
        section = measure_cross_section(
            kerb_cloud(width_m=30.0), 10.0,
            config=MeasurementConfig(max_plausible_width_m=12.0),
            rng=np.random.default_rng(0), kerb_offset_hint=0.45,
        )
        assert section.sidewalk is None
        assert "implausible_width" in section.flags


class TestFactEmission:
    def _facts(self):
        section = measure_cross_section(
            kerb_cloud(), 10.0, rng=np.random.default_rng(0), kerb_offset_hint=0.45
        )
        return to_world_facts(
            section, feature_id="way1:00035:L", lat=38.9, lon=-77.0,
            position_sigma_m=0.4, source_run_id="run1", corroboration_count=3, confidence=0.8,
        )

    def test_emits_the_expected_classes(self) -> None:
        classes = {f.fact_class for f in self._facts()}
        assert FactClass.CURB_HEIGHT in classes
        assert FactClass.SIDEWALK_WIDTH in classes

    def test_cross_slope_is_demoted_to_advisory(self) -> None:
        slope = next(f for f in self._facts() if f.fact_class is FactClass.SIDEWALK_CROSS_SLOPE)
        assert slope.tier is Tier.C
        assert slope.provenance is Provenance.INFERRED
        assert slope.confidence <= 0.45

    def test_geometry_facts_are_measured(self) -> None:
        height = next(f for f in self._facts() if f.fact_class is FactClass.CURB_HEIGHT)
        assert height.provenance is Provenance.MEASURED

    def test_failed_section_emits_nothing(self) -> None:
        section = measure_cross_section(np.zeros((5, 3)), 0.0)
        assert to_world_facts(
            section, feature_id="x", lat=0.0, lon=0.0, position_sigma_m=1.0,
            source_run_id="r", corroboration_count=1, confidence=0.5,
        ) == []


class TestStreetOverlay:
    def _map(self) -> StreetMap:
        return StreetMap(
            ORIGIN,
            [StreetSegment("way1", np.array([[0.0, 0.0], [100.0, 0.0], [140.0, 40.0]]))],
        )

    def test_snap_recovers_station_and_side(self) -> None:
        street = self._map()
        lat, lon = geo.enu_to_geodetic(ORIGIN, 40.0, 6.0)
        result = street.snap(lat, lon)
        assert result is not None
        assert abs(result.station_m - 40.0) < 0.5
        assert abs(abs(result.lateral_offset_m) - 6.0) < 0.5

    def test_opposite_sides_get_different_identities(self) -> None:
        """The two footways of a street are different features with different kerbs."""
        street = self._map()
        left = street.snap(*geo.enu_to_geodetic(ORIGIN, 40.0, 6.0))
        right = street.snap(*geo.enu_to_geodetic(ORIGIN, 40.0, -6.0))
        assert left is not None and right is not None
        assert left.side != right.side
        assert left.feature_id != right.feature_id

    def test_identity_is_stable_for_nearby_observers(self) -> None:
        street = self._map()
        a = street.snap(*geo.enu_to_geodetic(ORIGIN, 41.0, 6.0))
        b = street.snap(*geo.enu_to_geodetic(ORIGIN, 43.0, 6.5))
        assert a is not None and b is not None
        assert a.feature_id == b.feature_id

    def test_kerb_hint_is_a_property_of_the_street(self) -> None:
        street = self._map()
        near = street.snap(*geo.enu_to_geodetic(ORIGIN, 40.0, 1.0))
        far = street.snap(*geo.enu_to_geodetic(ORIGIN, 40.0, 8.0))
        assert near is not None and far is not None
        assert near.kerb_offset_hint_m == far.kerb_offset_hint_m

    def test_off_network_captures_are_refused(self) -> None:
        """A capture in a plaza has no kerb to attach measurements to."""
        assert self._map().snap(*geo.enu_to_geodetic(ORIGIN, 40.0, 300.0)) is None

    def test_map_frame_roundtrips(self) -> None:
        result = self._map().snap(*geo.enu_to_geodetic(ORIGIN, 40.0, 6.0))
        assert result is not None
        points = np.array([[10.0, 2.0, 0.15], [-4.0, 1.0, 0.0]])
        assert np.allclose(result.frame.to_enu(result.frame.to_local(points)), points, atol=1e-9)

    def test_bearing_follows_the_bend(self) -> None:
        street = self._map()
        straight = street.snap(*geo.enu_to_geodetic(ORIGIN, 40.0, 4.0))
        bend = street.snap(*geo.enu_to_geodetic(ORIGIN, 125.0, 30.0))
        assert straight is not None and bend is not None
        assert abs(straight.bearing_deg - bend.bearing_deg) > 20.0

    def test_segment_needs_two_vertices(self) -> None:
        with pytest.raises(ValueError, match="two vertices"):
            StreetSegment("x", np.array([[0.0, 0.0]]))

    def test_corridor_map_is_built(self) -> None:
        corridor = build_corridor("t", ORIGIN, 1, n_blocks=1)
        assert len(corridor_street_map(corridor)) == 1


class TestVaryingPace:
    """The property the whole distance-gate design exists for."""

    def _walk(self, *, varying: bool, seed: int, duration_s: float = 900.0) -> tuple:
        dt = 0.05
        gait = GaitSimulator(GaitConfig(), np.random.default_rng(seed))
        engine = TriggerEngine()
        distance = 0.0
        captures: list[float] = []
        speeds: list[float] = []
        for i in range(int(duration_s / dt)):
            speed = gait.step(dt) if varying else 1.35
            speeds.append(speed)
            decision = engine.evaluate(
                CaptureContext(
                    timestamp_s=i * dt,
                    motion_state=(
                        MotionState.STATIONARY if speed < 0.15 else MotionState.WALKING
                    ),
                    speed_mps=speed,
                    lat=38.9,
                    lon=-77.0,
                    position_sigma_m=6.0,
                    cell_id=f"c{int(distance // 20)}",
                    cell_age_s=None,
                    scene_distance=0.5,
                )
            )
            distance += speed * dt
            if decision.capture:
                captures.append(distance)
        return np.array(speeds), np.diff(np.array(captures)), engine

    def test_gait_actually_varies(self) -> None:
        speeds, _, _ = self._walk(varying=True, seed=11)
        moving = speeds[speeds > 0.15]
        assert moving.std() > 0.15, "the gait model is not varying enough to be a test"
        assert float(np.mean(speeds < 0.15)) > 0.02, "no stops in the trace"

    def test_frame_spacing_barely_moves_when_pace_swings(self) -> None:
        """38% variation in speed must not become 38% variation in baseline."""
        speeds, spacing, _ = self._walk(varying=True, seed=11)
        moving = speeds[speeds > 0.15]
        speed_cv = float(moving.std() / moving.mean())
        spacing_cv = float(spacing.std() / spacing.mean())
        assert speed_cv > 0.15
        assert spacing_cv < 0.10, (speed_cv, spacing_cv)
        assert spacing_cv < speed_cv / 3.0

    def test_spacing_stays_inside_the_geometry_bounds(self) -> None:
        _, spacing, engine = self._walk(varying=True, seed=7)
        assert spacing.min() >= engine.config.min_baseline_m - 1e-6
        assert spacing.max() <= engine.config.max_baseline_m

    def test_nothing_is_captured_while_stopped(self) -> None:
        from smc.capture.trigger import Suppression

        _, _, engine = self._walk(varying=True, seed=11)
        assert engine.reason_histogram.get(Suppression.MOTION_STATE, 0) > 0

    @pytest.mark.parametrize("seed", [1, 5, 9, 13])
    def test_holds_across_different_walks(self, seed: int) -> None:
        _, spacing, _ = self._walk(varying=True, seed=seed, duration_s=600.0)
        assert float(spacing.std() / spacing.mean()) < 0.12


class TestGlassesProfile:
    def test_delivered_resolution_is_far_below_the_sensor(self) -> None:
        """The toolkit caps photos at 1440x1080 and the stream at 720p, not 12 MP."""
        profile = GlassesProfile()
        assert profile.resolution() == (1440, 1080)
        assert profile.resolution(stream=True) == (1280, 720)
        assert profile.megapixels_sensor / profile.megapixels_delivered > 5.0

    def test_stream_focal_is_shorter_than_photo_focal(self) -> None:
        profile = GlassesProfile()
        assert profile.intrinsics(stream=True)[0, 0] < profile.intrinsics()[0, 0]

    def test_wearer_is_on_the_footway_not_in_the_road(self) -> None:
        profile = GlassesProfile()
        pose = wearer_pose(10.0, profile)
        assert pose.camera_centre[1] > 0.0
        assert abs(pose.camera_centre[2] - profile.eye_height_m) < 1e-9

    def test_head_yaw_changes_the_view(self) -> None:
        profile = GlassesProfile()
        straight = wearer_pose(10.0, profile, 0.0)
        turned = wearer_pose(10.0, profile, 25.0)
        assert straight.angular_distance_deg(turned) > 10.0
