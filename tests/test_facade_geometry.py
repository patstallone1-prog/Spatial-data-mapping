"""The facade extractor's geometry, which is the part that fails silently when it is wrong.

A backwards outward normal, or an azimuth measured from the wrong axis, does not raise: it
quietly samples the inside of the building, or the shop across the road, and the result still
looks like a photograph of something. These tests pin the conventions down.
"""

from __future__ import annotations

import math

import numpy as np
import pytest

from smc.facades.geometry import (
    Camera,
    LocalFrame,
    project,
    score_view,
    walls_of,
)

SQUARE_CCW = [(0.0, 0.0), (20.0, 0.0), (20.0, 20.0), (0.0, 20.0)]
SQUARE_CW = list(reversed(SQUARE_CCW))


def _camera(x, y, heading_deg, *, spherical=False, hfov_deg=70.0, z=2.4):
    return Camera(x=x, y=y, z=z, yaw_rad=math.radians(heading_deg),
                  width=2048, height=1024 if spherical else 1536,
                  spherical=spherical,
                  hfov_rad=None if spherical else math.radians(hfov_deg))


class TestWalls:
    def test_normals_point_away_from_the_building(self):
        for ring in (SQUARE_CCW, SQUARE_CW):
            for wall in walls_of(ring, 12.0):
                mx, my = wall.midpoint
                # The centre of that square is (10, 10); stepping along the normal must
                # increase the distance from it.
                before = math.hypot(mx - 10.0, my - 10.0)
                after = math.hypot(mx + wall.normal[0] - 10.0, my + wall.normal[1] - 10.0)
                assert after > before

    def test_winding_does_not_change_the_walls(self):
        assert len(walls_of(SQUARE_CCW, 12.0)) == len(walls_of(SQUARE_CW, 12.0)) == 4

    def test_chamfers_are_dropped(self):
        ring = [(0.0, 0.0), (20.0, 0.0), (21.0, 1.0), (21.0, 20.0), (0.0, 20.0)]
        lengths = [round(w.length_m) for w in walls_of(ring, 12.0, min_length_m=4.0)]
        assert 1 not in lengths

    def test_a_closed_ring_does_not_grow_a_zero_length_wall(self):
        closed = SQUARE_CCW + [SQUARE_CCW[0]]
        assert len(walls_of(closed, 12.0)) == 4

    def test_a_degenerate_ring_yields_nothing(self):
        assert walls_of([(0.0, 0.0), (1.0, 1.0)], 12.0) == []


class TestProjection:
    def test_a_point_dead_ahead_lands_in_the_centre(self):
        camera = _camera(0.0, 0.0, 0.0)                      # facing north
        u, v, valid = project(camera, np.array([[0.0, 30.0, 2.4]]))
        assert valid[0]
        assert u[0] == pytest.approx(camera.width / 2.0)
        assert v[0] == pytest.approx(camera.height / 2.0)

    def test_east_of_a_northward_camera_lands_right_of_centre(self):
        camera = _camera(0.0, 0.0, 0.0)
        u, _, valid = project(camera, np.array([[10.0, 30.0, 2.4]]))
        assert valid[0] and u[0] > camera.width / 2.0

    def test_above_the_camera_lands_above_the_centre(self):
        camera = _camera(0.0, 0.0, 0.0)
        _, v, valid = project(camera, np.array([[0.0, 30.0, 10.0]]))
        assert valid[0] and v[0] < camera.height / 2.0

    def test_behind_a_perspective_camera_is_invalid(self):
        camera = _camera(0.0, 0.0, 0.0)
        _, _, valid = project(camera, np.array([[0.0, -30.0, 2.4]]))
        assert not valid[0]

    def test_a_sphere_sees_behind_itself(self):
        camera = _camera(0.0, 0.0, 0.0, spherical=True)
        u, _, valid = project(camera, np.array([[0.0, -30.0, 2.4]]))
        assert valid[0]
        # Directly behind is half a turn from the centre column, at either edge.
        assert min(u[0], camera.width - u[0]) == pytest.approx(0.0, abs=1.0)

    def test_a_sphere_puts_the_heading_at_the_centre_column(self):
        camera = _camera(0.0, 0.0, 90.0, spherical=True)     # facing east
        u, _, _ = project(camera, np.array([[30.0, 0.0, 2.4]]))
        assert u[0] == pytest.approx(camera.width / 2.0, abs=1.0)

    def test_a_perspective_camera_needs_a_lens(self):
        camera = Camera(0.0, 0.0, 2.4, 0.0, 2048, 1536, spherical=False, hfov_rad=None)
        with pytest.raises(ValueError):
            project(camera, np.array([[0.0, 30.0, 2.4]]))


class TestScoring:
    def _south_wall(self):
        # The y = 0 edge of the square, whose outward normal points south.
        return next(w for w in walls_of(SQUARE_CCW, 12.0) if w.midpoint[1] == 0.0)

    def test_square_on_beats_oblique(self):
        wall = self._south_wall()
        square = score_view(wall, _camera(10.0, -15.0, 0.0))
        oblique = score_view(wall, _camera(-8.0, -13.0, 40.0))
        assert square is not None and oblique is not None and square > oblique

    def test_near_beats_far(self):
        wall = self._south_wall()
        near = score_view(wall, _camera(10.0, -12.0, 0.0))
        far = score_view(wall, _camera(10.0, -45.0, 0.0))
        assert near is not None and far is not None and near > far

    def test_a_camera_on_the_wrong_side_is_refused(self):
        # Inside the building, looking at the back of the south wall.
        assert score_view(self._south_wall(), _camera(10.0, 10.0, 180.0)) is None

    def test_a_camera_too_far_away_is_refused(self):
        assert score_view(self._south_wall(), _camera(10.0, -400.0, 0.0)) is None

    def test_a_camera_pressed_against_the_wall_is_refused(self):
        assert score_view(self._south_wall(), _camera(10.0, -0.5, 0.0)) is None

    def test_a_perspective_camera_looking_away_is_refused(self):
        assert score_view(self._south_wall(), _camera(10.0, -15.0, 180.0)) is None

    def test_a_sphere_looking_away_still_sees_it(self):
        assert score_view(self._south_wall(),
                          _camera(10.0, -15.0, 180.0, spherical=True)) is not None


class TestLocalFrame:
    def test_metres_round_trip(self):
        frame = LocalFrame(37.7975, -122.4194)
        lon, lat = frame.to_lonlat(*frame.to_xy(-122.41, 37.80))
        assert lon == pytest.approx(-122.41, abs=1e-9)
        assert lat == pytest.approx(37.80, abs=1e-9)

    def test_a_degree_of_longitude_is_shorter_than_one_of_latitude_here(self):
        frame = LocalFrame(37.7975, -122.4194)
        east, _ = frame.to_xy(-122.4194 + 1.0, 37.7975)
        _, north = frame.to_xy(-122.4194, 37.7975 + 1.0)
        assert east < north
        assert east / north == pytest.approx(math.cos(math.radians(37.7975)), rel=1e-6)
