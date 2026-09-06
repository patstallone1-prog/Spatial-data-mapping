"""Pairing observations, where the wrong answer is a confident one.

Every failure here produces a number rather than an error. A pair scored on baseline alone
calls two cameras half a metre apart a good stereo pair. A pair that ignores heading calls two
cameras back to back a good stereo pair. Both are wrong in a way that only shows up much later,
as a depth map that will not converge.
"""

from __future__ import annotations

import math

import pytest

from smc.enrich.pairs import (
    DEFAULT_SUBJECT_DISTANCE_M,
    Frame,
    baseline_m,
    best_pairs,
    evaluate,
    parallax_deg,
    parallax_quality,
    subject_distance,
    view_overlap,
)


def _frame(uid="a", x=0.0, y=0.0, heading=0.0, when=0.0, spherical=False,
           provider="mapillary", station=0.0, distance=12.0):
    return Frame(uid=uid, provider=provider, x=x, y=y, heading_deg=heading,
                 captured_at=when, spherical=spherical, station_m=station,
                 subject_distance_m=distance)


class TestSubjectDistance:
    def test_the_facade_is_across_the_carriageway_and_the_footway(self):
        # A camera on the centreline of a 9 m road with 3 m footways: 4.5 + 3.
        assert subject_distance(0.0, 9.0, 3.0) == pytest.approx(7.5)

    def test_a_camera_off_the_centreline_is_nearer_the_kerb_it_stands_by(self):
        assert subject_distance(3.0, 9.0, 3.0) == pytest.approx(4.5)

    def test_an_unknown_street_falls_back_and_says_so(self):
        assert subject_distance(0.0, None, None) == DEFAULT_SUBJECT_DISTANCE_M

    def test_a_camera_beyond_the_facade_is_a_placement_error_not_a_close_building(self):
        # Twenty metres off the centreline of a nine-metre street is not inside a shop.
        assert subject_distance(20.0, 9.0, 3.0) == DEFAULT_SUBJECT_DISTANCE_M


class TestParallax:
    def test_the_angle_grows_with_the_baseline(self):
        assert parallax_deg(4.0, 12.0) > parallax_deg(1.0, 12.0)

    def test_the_angle_shrinks_with_distance(self):
        assert parallax_deg(2.0, 40.0) < parallax_deg(2.0, 8.0)

    def test_the_same_baseline_is_good_or_useless_depending_on_the_subject(self):
        # Two metres apart: fine for a shopfront, nothing at all for a distant tower.
        assert parallax_quality(parallax_deg(2.0, 10.0)) > 0.4
        assert parallax_quality(parallax_deg(2.0, 400.0)) == 0.0

    def test_too_close_together_scores_nothing(self):
        assert parallax_quality(parallax_deg(0.2, 12.0)) == 0.0

    def test_too_far_apart_scores_nothing(self):
        assert parallax_quality(parallax_deg(40.0, 12.0)) == 0.0

    def test_quality_peaks_in_the_middle_rather_than_rising_forever(self):
        angles = [6.0, 10.0, 14.0, 20.0, 28.0]
        scores = [parallax_quality(a) for a in angles]
        assert scores[2] == max(scores)
        assert scores[0] < scores[2] > scores[-1]


class TestViewOverlap:
    def test_two_cameras_pointing_the_same_way_overlap(self):
        assert view_overlap(_frame(heading=90.0), _frame(heading=95.0)) > 0.99

    def test_two_cameras_back_to_back_do_not(self):
        assert view_overlap(_frame(heading=0.0), _frame(heading=180.0)) == 0.0

    def test_a_right_angle_is_the_cut_off(self):
        assert view_overlap(_frame(heading=0.0), _frame(heading=90.0)) == 0.0

    def test_the_wrap_around_at_north_is_handled(self):
        assert view_overlap(_frame(heading=359.0), _frame(heading=1.0)) > 0.99

    def test_a_panorama_sees_every_direction(self):
        assert view_overlap(_frame(heading=0.0, spherical=True),
                            _frame(heading=180.0)) == 1.0

    def test_a_perspective_frame_with_no_heading_cannot_be_paired(self):
        assert view_overlap(_frame(heading=None), _frame(heading=0.0)) == 0.0


class TestEvaluate:
    def test_a_good_pair_scores(self):
        pair = evaluate(_frame(), _frame(uid="b", x=2.5))
        assert pair is not None and pair.geometry_score > 0.3
        assert pair.baseline_m == pytest.approx(2.5)

    def test_the_same_frame_twice_is_refused(self):
        assert evaluate(_frame(), _frame(uid="b", x=0.05)) is None

    def test_cameras_looking_away_from_each_other_are_refused(self):
        assert evaluate(_frame(heading=0.0), _frame(uid="b", x=2.0, heading=180.0)) is None

    def test_a_cross_provider_pair_is_marked(self):
        pair = evaluate(_frame(), _frame(uid="b", x=2.5, provider="kartaview"))
        assert pair is not None and pair.cross_provider

    def test_time_apart_is_measured_in_days(self):
        pair = evaluate(_frame(when=0.0), _frame(uid="b", x=2.5, when=86400.0 * 3))
        assert pair is not None and pair.days_apart == pytest.approx(3.0)

    def test_a_frame_with_no_time_has_no_gap_rather_than_a_zero_one(self):
        pair = evaluate(_frame(when=None), _frame(uid="b", x=2.5, when=100.0))
        assert pair is not None and pair.days_apart is None


class TestBestPairs:
    def test_geometry_prefers_a_usable_parallax_over_the_nearest_frame(self):
        subject = _frame()
        candidates = [_frame(uid="near", x=0.3), _frame(uid="good", x=3.0)]
        assert best_pairs(subject, candidates)["geometry_uid"] == "good"

    def test_geometry_prefers_a_usable_parallax_over_the_furthest_frame(self):
        subject = _frame()
        candidates = [_frame(uid="good", x=3.0), _frame(uid="far", x=60.0)]
        assert best_pairs(subject, candidates)["geometry_uid"] == "good"

    def test_corroboration_looks_for_a_different_provider(self):
        subject = _frame(provider="mapillary")
        candidates = [_frame(uid="same", x=3.0, provider="mapillary"),
                      _frame(uid="other", x=3.2, provider="kartaview")]
        found = best_pairs(subject, candidates)
        assert found["cross_provider_uid"] == "other"

    def test_change_wants_the_biggest_gap_in_time_from_the_same_place(self):
        subject = _frame(when=0.0)
        candidates = [_frame(uid="recent", x=2.0, when=86400.0),
                      _frame(uid="old", x=2.0, when=86400.0 * 2000)]
        assert best_pairs(subject, candidates)["temporal_uid"] == "old"

    def test_change_does_not_pair_across_the_whole_block(self):
        subject = _frame(when=0.0)
        # Years apart but forty metres away: a different building, not a change.
        candidates = [_frame(uid="far_old", x=40.0, when=86400.0 * 2000)]
        assert best_pairs(subject, candidates)["temporal_uid"] is None

    def test_a_frame_with_nobody_near_it_reports_nothing_rather_than_guessing(self):
        found = best_pairs(_frame(), [])
        assert found == {"n_candidates": 0}
        assert found.get("geometry_uid") is None

    def test_a_frame_whose_only_neighbours_face_away_has_no_partner(self):
        found = best_pairs(_frame(heading=0.0),
                           [_frame(uid="b", x=2.0, heading=180.0)])
        assert found["n_candidates"] == 0

    def test_the_one_to_three_metre_band_is_counted(self):
        subject = _frame()
        candidates = [_frame(uid="a", x=0.5), _frame(uid="b", x=2.0),
                      _frame(uid="c", x=2.8), _frame(uid="d", x=9.0)]
        assert best_pairs(subject, candidates)["n_baseline_1_to_3m"] == 2


class TestBaseline:
    def test_it_is_a_plain_distance(self):
        assert baseline_m(_frame(x=0.0, y=0.0), _frame(x=3.0, y=4.0)) == pytest.approx(5.0)
