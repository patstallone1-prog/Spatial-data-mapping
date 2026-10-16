import numpy as np
import pytest

from smc.curbmeasure.registration import fit_camera, nearest_segments


def test_straight_curb_cannot_separate_shift_from_scale():
    pts = np.column_stack((np.linspace(-8, 8, 100), np.full(100, 4.0)))
    result = fit_camera(pts, np.zeros(2), np.array([[[-20, 5], [20, 5]]]))
    assert result["status"] == "ambiguous"
    assert result["rank"] == 1
    assert not result["parameters_identified"]["scale"]
    assert not result["publishable"]


def test_two_parallel_curbs_identify_scale_but_not_along_street_shift():
    x = np.linspace(-8, 8, 60)
    pts = np.vstack(
        (np.column_stack((x, np.full(60, 4.0))), np.column_stack((x, np.full(60, -4.0))))
    )
    refs = np.array([[[-20, 5], [20, 5]], [[-20, -5], [20, -5]]])
    result = fit_camera(pts, np.zeros(2), refs)
    assert result["rank"] == 2
    assert result["parameters_identified"] == {"east": False, "north": True, "scale": True}
    assert result["candidate_scale"] == pytest.approx(1.25)


def test_three_sided_reference_recovers_known_shift_and_scale():
    x = np.linspace(-6, 6, 60)
    truth = np.vstack(
        (
            np.column_stack((x, np.full(60, 5.0))),
            np.column_stack((x, np.full(60, -5.0))),
            np.column_stack((np.full(60, 8.0), np.linspace(-3, 3, 60))),
        )
    )
    shift = np.array([0.7, -0.3])
    points = (truth - shift) / 1.12
    refs = np.array([[[-20, 5], [20, 5]], [[-20, -5], [20, -5]], [[8, -6], [8, 6]]])
    result = fit_camera(points, np.zeros(2), refs)
    assert result["status"] == "identified"
    assert result["candidate_shift_m"] == pytest.approx(shift)
    assert result["candidate_scale"] == pytest.approx(1.12)


def test_nearest_segment_does_not_extend_reference_to_infinite_line():
    _, d, t = nearest_segments(np.array([[4.0, 0.0]]), np.array([[[0.0, 0.0], [1.0, 0.0]]]))
    assert d[0] == 3
    assert t[0] == 4


def test_invalid_reference_rejected():
    with pytest.raises(ValueError, match="zero-length"):
        nearest_segments(np.zeros((1, 2)), np.zeros((1, 2, 2)))
