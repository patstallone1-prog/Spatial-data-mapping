"""Footway bounds, camera calibration, lidar projection and pose correction.

The shared property of these four is that a wrong answer is a number rather than an exception:
a footway widened instead of clipped, a camera rolled ninety degrees by an axis convention, a
point cloud projected through the camera instead of into it, a position pulled to the middle of
a street it was merely near.
"""

from __future__ import annotations

import math

import numpy as np
import pytest

from smc.enrich.depth import depth_image, project_points_to_image
from smc.enrich.pose import (
    bearing_delta_deg,
    clamp_to_right_of_way,
    refine_sequence,
    sequence_follows_street,
    smooth_lateral,
)
from smc.imagery.calibration import (
    SensorCalibration,
    camera_angles,
    quaternion_to_matrix,
)
from smc.official.footway import bound_footway


class TestFootwayBound:
    #: Clay Street in Chinatown: 49 ft of right of way, kerb 4.47 m off the centreline.
    ROW, CURB = 14.9352, 4.47

    def test_a_measurement_that_ran_into_a_plaza_is_clipped(self):
        out = bound_footway(6.46, right_of_way_m=self.ROW, curb_offset_m=self.CURB)
        assert out.clipped and out.bounded_m < 6.46

    def test_a_measurement_inside_the_bound_is_left_alone(self):
        out = bound_footway(3.05, right_of_way_m=self.ROW, curb_offset_m=self.CURB)
        assert not out.clipped and out.bounded_m == 3.05

    def test_a_narrow_footway_is_never_widened_to_the_bound(self):
        # A footway measuring less than the law allows is ordinary -- a planting strip, a kerb
        # rebuilt inboard. Widening it to meet the bound would invent pavement.
        out = bound_footway(1.2, right_of_way_m=self.ROW, curb_offset_m=self.CURB)
        assert out.bounded_m == 1.2

    def test_with_no_right_of_way_nothing_is_bounded(self):
        out = bound_footway(6.46, right_of_way_m=None, curb_offset_m=self.CURB)
        assert out.bound_m is None and out.bounded_m == 6.46

    def test_with_no_kerb_position_nothing_is_bounded(self):
        out = bound_footway(6.46, right_of_way_m=self.ROW, curb_offset_m=None)
        assert out.bound_m is None and out.bounded_m == 6.46

    def test_a_kerb_at_the_property_line_refuses_to_bound_rather_than_clipping_to_nothing(self):
        # The two records disagree about this block; neither can police the other.
        out = bound_footway(3.0, right_of_way_m=9.0, curb_offset_m=4.4)
        assert not out.clipped and out.bounded_m == 3.0
        assert out.reason == "kerb at or past the row edge"


class TestCameraAngles:
    #: A real PandaSet front camera: level, facing north-east.
    QUATERNION = (0.6547141728904644, -0.6609508258934794,
                  -0.25921186551431247, 0.25942738163823914)

    def test_a_level_camera_reads_level(self):
        heading, pitch, roll = camera_angles(quaternion_to_matrix(*self.QUATERNION))
        assert abs(pitch) < 2.0, "a roof-mounted camera came out pitched"
        assert abs(roll) < 2.0, "the axis convention leaked into the roll"

    def test_the_heading_matches_what_the_provider_reports(self):
        heading, _pitch, _roll = camera_angles(quaternion_to_matrix(*self.QUATERNION))
        assert heading == pytest.approx(46.97, abs=0.05)

    def test_a_camera_pitched_up_reads_positive(self):
        # Rotate the forward axis (x) up towards +z by 20 degrees.
        angle = math.radians(20.0)
        rotation = np.array([[math.cos(angle), 0.0, 0.0],
                             [0.0, 1.0, 0.0],
                             [math.sin(angle), 0.0, 0.0]])
        rotation[:, 1] = [0.0, 1.0, 0.0]
        rotation[:, 2] = np.cross(rotation[:, 0], rotation[:, 1])
        _heading, pitch, _roll = camera_angles(rotation)
        assert pitch == pytest.approx(20.0, abs=0.5)

    def test_an_identity_pose_faces_east_and_is_level(self):
        heading, pitch, roll = camera_angles(np.eye(3))
        assert heading == pytest.approx(90.0)
        assert pitch == pytest.approx(0.0, abs=1e-6)

    def test_a_degenerate_quaternion_does_not_explode(self):
        assert np.allclose(quaternion_to_matrix(0.0, 0.0, 0.0, 0.0), np.eye(3))


class TestProjection:
    def _calibration(self):
        return SensorCalibration(
            observation_uid="u", provider="pandaset", fx=1970.0, fy=1970.0,
            cx=960.0, cy=540.0, position_x=0.0, position_y=0.0, position_z=0.0,
            quaternion_w=1.0, quaternion_x=0.0, quaternion_y=0.0, quaternion_z=0.0)

    def test_a_point_down_the_optical_axis_lands_in_the_centre(self):
        u, v, depth, valid = project_points_to_image(
            np.array([[10.0, 0.0, 0.0]]), self._calibration(), 1920, 1080)
        assert valid[0]
        assert u[0] == pytest.approx(960.0) and v[0] == pytest.approx(540.0)
        assert depth[0] == pytest.approx(10.0)

    def test_a_point_to_the_left_lands_left_of_centre(self):
        # PandaSet's camera z axis points left, so a positive z is to the camera's left.
        u, _v, _d, valid = project_points_to_image(
            np.array([[10.0, 0.0, 1.0]]), self._calibration(), 1920, 1080)
        assert valid[0] and u[0] < 960.0

    def test_a_point_below_lands_below_centre(self):
        # y is down.
        _u, v, _d, valid = project_points_to_image(
            np.array([[10.0, 1.0, 0.0]]), self._calibration(), 1920, 1080)
        assert valid[0] and v[0] > 540.0

    def test_a_point_behind_the_camera_is_invalid(self):
        _u, _v, _d, valid = project_points_to_image(
            np.array([[-10.0, 0.0, 0.0]]), self._calibration(), 1920, 1080)
        assert not valid[0]

    def test_a_return_off_the_vehicle_itself_is_dropped(self):
        _u, _v, _d, valid = project_points_to_image(
            np.array([[0.4, 0.0, 0.0]]), self._calibration(), 1920, 1080)
        assert not valid[0]

    def test_the_camera_pose_is_applied_not_its_inverse(self):
        # Move the camera ten metres along +x; a point at twenty is now ten away, not thirty.
        calibration = SensorCalibration(
            observation_uid="u", provider="pandaset", fx=1970.0, fy=1970.0,
            cx=960.0, cy=540.0, position_x=10.0, position_y=0.0, position_z=0.0,
            quaternion_w=1.0, quaternion_x=0.0, quaternion_y=0.0, quaternion_z=0.0)
        _u, _v, depth, _valid = project_points_to_image(
            np.array([[20.0, 0.0, 0.0]]), calibration, 1920, 1080)
        assert depth[0] == pytest.approx(10.0)

    def test_intrinsics_are_required(self):
        bare = SensorCalibration(observation_uid="u", provider="x")
        with pytest.raises(ValueError):
            project_points_to_image(np.array([[1.0, 0.0, 0.0]]), bare, 100, 100)

    def test_the_depth_map_keeps_the_nearer_return(self):
        points = np.array([[30.0, 0.0, 0.0], [8.0, 0.0, 0.0]])
        out = depth_image(points, self._calibration(), 1920, 1080, downsample=4)
        assert out[540 // 4, 960 // 4] == pytest.approx(8.0)

    def test_an_empty_sweep_gives_an_empty_map(self):
        out = depth_image(np.zeros((0, 3)), self._calibration(), 1920, 1080)
        assert out.max() == 0.0


class TestPoseCorrection:
    def test_a_camera_inside_the_right_of_way_is_not_moved(self):
        assert clamp_to_right_of_way(3.0, 15.0) == (3.0, None)

    def test_a_camera_outside_it_is_pulled_to_the_boundary_not_the_middle(self):
        corrected, reason = clamp_to_right_of_way(11.0, 15.0)
        assert reason == "outside the right of way"
        # Pulled to the edge, which is the only claim the bound supports.
        assert corrected == pytest.approx(15.0 / 2.0 + 1.0)

    def test_a_camera_on_another_street_is_left_where_it_is(self):
        corrected, reason = clamp_to_right_of_way(40.0, 15.0)
        assert corrected == 40.0
        assert reason == "outside by more than a correction can explain"

    def test_the_sign_of_the_side_survives_the_clamp(self):
        assert clamp_to_right_of_way(-11.0, 15.0)[0] < 0

    def test_smoothing_outvotes_a_single_bad_fix(self):
        assert smooth_lateral([3.0, 3.0, 9.0, 3.0, 3.0])[2] == pytest.approx(3.0)

    def test_smoothing_follows_a_real_drift(self):
        drift = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0]
        assert smooth_lateral(drift)[3] == pytest.approx(4.0)

    def test_a_run_too_short_to_have_neighbours_is_left_alone(self):
        assert smooth_lateral([5.0, 1.0]) == [5.0, 1.0]

    def test_a_driven_sequence_is_recognised(self):
        assert sequence_follows_street([90.0, 92.0, 271.0, 88.0], 90.0)

    def test_a_walking_survey_facing_the_shops_is_not_straightened(self):
        assert not sequence_follows_street([0.0, 2.0, 358.0, 1.0], 90.0)

    def test_bearings_wrap(self):
        assert bearing_delta_deg(359.0, 1.0) == pytest.approx(2.0)

    def test_a_correction_carries_its_own_uncertainty(self):
        fixes = refine_sequence([11.0], [15.0], smooth=False)
        # A position that had to be moved two metres is not known to a centimetre afterwards.
        assert fixes[0].sigma_m >= fixes[0].moved_m

    def test_bounds_are_applied_before_smoothing(self):
        # The outlier is pulled inside first, so it does not drag its neighbours' median out.
        fixes = refine_sequence([3.0, 3.0, 30.0, 3.0, 3.0], [15.0] * 5, smooth=True)
        assert all(abs(f.corrected_m) <= 8.5 + 1e-6 for f in fixes)
