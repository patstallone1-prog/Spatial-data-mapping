import pytest

from smc.curbmeasure.width_validation import (
    cross_section,
    nearest_side,
    split_for,
    street_group,
    summarize,
)


def test_normal_width_not_oblique_length_and_holes_are_respected():
    rings = [[(-10, 5), (10, 5), (10, 8), (-10, 8)],
             [(-1, 6), (1, 6), (1, 7), (-1, 7)]]
    assert cross_section(rings, (0, 0), (2, 0)) == [(5, 6), (7, 8)]
    assert cross_section(rings[:1], (0, 0), (2, 0)) == [(5, 8)]
    assert nearest_side(cross_section(rings[:1], (0, 0), (2, 0)), 1) == (5, 8)
    assert nearest_side([(-8, -5)], -1) == (5, 8)


def test_overlapping_and_road_spanning_polygons_do_not_fabricate_width():
    assert nearest_side([(5, 8), (6, 9)], 1) is None
    assert nearest_side([(-5, 5)], 1) is None
    with pytest.raises(ValueError):
        cross_section([], (0, 0), (0, 0))


def test_all_segments_of_a_named_street_stay_together():
    assert street_group("  E. Santa Clara Street  ") == "E SANTA CLARA STREET"
    assert split_for("E. Santa Clara Street") == split_for("e santa clara street")
    assert summarize([])["street_macro_mae_m"] is None


def test_pixels_or_repeated_stations_cannot_inflate_independent_street_count():
    rows = [{"street": "A", "prediction_m": 4, "reference_m": 3}] * 100
    rows += [{"street": "B", "prediction_m": 4, "reference_m": 1}]
    report = summarize(rows)
    assert report["independent_street_groups"] == 2
    assert report["street_macro_mae_m"] == 2


def test_opposite_errors_on_one_street_do_not_cancel_in_mae():
    rows = [{"street": "A", "prediction_m": 4, "reference_m": 3},
            {"street": "A", "prediction_m": 2, "reference_m": 3}]
    assert summarize(rows)["street_macro_mae_m"] == 1
