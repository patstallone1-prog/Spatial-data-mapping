"""The official-records path, tested where it can silently lie.

None of these failures raise. A foot read as a metre builds a footway three times too wide; a
policy minimum read as a survey replaces a measurement with an aspiration; a proposed curb read
as an existing one describes a street that has not been built. Each of those produces a
plausible number and a wrong city.
"""

from __future__ import annotations

import math

import pytest

from smc.facades.geometry import LocalFrame
from smc.official.crs import (
    check_wgs84,
    geojson_points,
    geojson_rings,
    state_plane_to_wgs84,
    wgs84_to_state_plane,
)
from smc.official.extract import (
    _principal_width_m,
    right_of_way_facts,
    segment_id,
    sidewalk_facts,
)
from smc.official.join import CentrelineIndex, project_to_polyline
from smc.official.reconcile import compare_widths, is_conflict
from smc.official.schema import (
    DocumentStatus,
    OfficialDocument,
    OfficialFactClass,
    OfficialGeometryFact,
    feet_to_m,
    rank,
)

DOC = OfficialDocument(
    document_id="test:doc", record_type="sidewalk_survey", source_url="https://example.invalid",
    sha256="0" * 64, retrieved_at="2026-01-01T00:00:00Z", status=DocumentStatus.EXISTING_SURVEY,
)


class TestUnits:
    def test_a_survey_foot_is_not_an_international_foot(self):
        # Two parts per million: 6 mm over a city block, 3 m across California.
        assert feet_to_m(1.0) == pytest.approx(0.3048006096, abs=1e-10)
        assert feet_to_m(1.0) != 0.3048

    def test_ten_feet_of_pavement_is_about_three_metres(self):
        assert feet_to_m(10.0) == pytest.approx(3.048, abs=1e-3)


class TestCrs:
    #: Published by San Francisco with both coordinates for the same point.
    CONTROL = [
        (6008097.39399, 2118225.37507, -122.41601618666873, 37.79670009242535),
        (6004340.37920, 2110309.60630, -122.42845181562228, 37.77475342584647),
        (6000415.09472, 2086812.45140, -122.44034465879093, 37.710012908823536),
    ]

    def test_state_plane_matches_the_citys_own_conversion(self):
        for x, y, lon, lat in self.CONTROL:
            got_lon, got_lat = state_plane_to_wgs84(x, y)
            north = (got_lat - lat) * 111_320.0
            east = (got_lon - lon) * 111_320.0 * math.cos(math.radians(lat))
            assert math.hypot(north, east) < 0.01, "more than a centimetre from the city's value"

    def test_the_projection_round_trips(self):
        for _x, _y, lon, lat in self.CONTROL:
            back = state_plane_to_wgs84(*wgs84_to_state_plane(lon, lat))
            assert back[0] == pytest.approx(lon, abs=1e-9)
            assert back[1] == pytest.approx(lat, abs=1e-9)

    def test_a_swapped_pair_is_refused(self):
        with pytest.raises(ValueError):
            check_wgs84(37.79, -122.41)

    def test_state_plane_feet_read_as_degrees_are_refused(self):
        with pytest.raises(ValueError):
            check_wgs84(6008097.0, 2118225.0)

    def test_rings_are_kept_apart(self):
        multi = {"type": "MultiPolygon", "coordinates": [
            [[[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 0.0]]],
            [[[5.0, 5.0], [6.0, 5.0], [6.0, 6.0], [5.0, 5.0]]],
        ]}
        assert len(geojson_rings(multi)) == 2
        assert len(geojson_points(multi)) == 8


class TestSidewalkExtraction:
    def _rows(self, **overrides):
        row = {"cnn": "4088000", "sidewalk_f": "10", "width_min": "12", "width_reco": "15",
               "side": "Both", "class": "Neighborhood Commercial", "shape": None}
        row.update(overrides)
        return [row]

    def test_the_survey_becomes_an_observation(self):
        facts = sidewalk_facts(self._rows(), DOC)
        survey = [f for f in facts if f.is_observation]
        assert len(survey) == 1
        assert survey[0].value == pytest.approx(3.048, abs=1e-3)
        assert survey[0].source_value == 10.0 and survey[0].source_unit == "ft"

    def test_the_plan_minimum_is_never_an_observation(self):
        facts = sidewalk_facts(self._rows(), DOC)
        standards = [f for f in facts if f.document_status is DocumentStatus.DESIGN_STANDARD]
        assert len(standards) == 2
        assert not any(f.is_observation for f in standards)
        assert all("policy_not_observation" in f.flags for f in standards)

    def test_a_standard_never_stands_in_for_a_missing_survey(self):
        # The city knows the class, and so has a minimum and a recommendation, but never
        # measured this block. That must not produce a 3.7 m footway.
        facts = sidewalk_facts(self._rows(sidewalk_f="0"), DOC)
        assert [f for f in facts if f.is_observation] == []

    def test_a_varying_width_is_not_a_negative_width(self):
        facts = sidewalk_facts(self._rows(sidewalk_f="-3"), DOC)
        observed = [f for f in facts if f.is_observation]
        assert len(observed) == 1
        assert observed[0].value is None
        assert "width_varies" in observed[0].flags

    def test_sides_are_kept(self):
        left = sidewalk_facts(self._rows(side="Left"), DOC)[0]
        right = sidewalk_facts(self._rows(side="Right"), DOC)[0]
        assert left.side == 1 and right.side == -1

    def test_an_absurd_width_is_dropped(self):
        assert [f for f in sidewalk_facts(self._rows(sidewalk_f="900"), DOC)
                if f.is_observation] == []

    def test_the_segment_id_is_stable_across_number_formats(self):
        assert segment_id(4088000) == segment_id("4088000") == segment_id(4088000.0)


class TestRightOfWay:
    def _polygon(self, width_deg, length_deg):
        ring = [[-122.40, 37.79], [-122.40 + length_deg, 37.79],
                [-122.40 + length_deg, 37.79 + width_deg], [-122.40, 37.79 + width_deg],
                [-122.40, 37.79]]
        return {"type": "Polygon", "coordinates": [ring]}

    def test_width_is_measured_across_the_long_axis(self):
        # About 20 m across and 100 m along.
        got = _principal_width_m(geojson_points(self._polygon(20 / 111320.0, 100 / 88000.0)))
        assert got is not None
        width, length = got
        assert width == pytest.approx(20.0, rel=0.05)
        assert length == pytest.approx(100.0, rel=0.05)

    def test_a_block_yields_a_plausible_street(self):
        facts = right_of_way_facts(
            [{"cnn": "4088000", "the_geom": self._polygon(20 / 111320.0, 100 / 88000.0)}], DOC)
        assert len(facts) == 1
        assert facts[0].fact_class is OfficialFactClass.RIGHT_OF_WAY_WIDTH
        assert facts[0].value == pytest.approx(20.0, rel=0.05)

    def test_the_publishers_accuracy_caveat_is_carried(self):
        facts = right_of_way_facts(
            [{"cnn": "4088000", "the_geom": self._polygon(20 / 111320.0, 100 / 88000.0)}], DOC)
        assert "not_engineering_accuracy" in facts[0].flags
        assert facts[0].horizontal_sigma_m >= 1.0, "claimed more precision than the city does"

    def test_a_square_is_flagged_as_not_a_block(self):
        facts = right_of_way_facts(
            [{"cnn": "1", "the_geom": self._polygon(20 / 111320.0, 22 / 88000.0)}], DOC)
        assert "not_block_shaped" in facts[0].flags


class TestPrecedence:
    def test_our_own_measurement_outranks_every_record(self):
        assert rank("field_observation") == 0
        for status in DocumentStatus:
            assert rank("field_observation") < rank(status) or status is DocumentStatus.UNKNOWN

    def test_a_survey_of_what_exists_outranks_a_proposal(self):
        assert rank(DocumentStatus.EXISTING_SURVEY) < rank(DocumentStatus.APPROVED_PROPOSED)

    def test_a_proposal_outranks_a_standard_and_both_lose_to_a_survey(self):
        assert (rank(DocumentStatus.APPROVED_PROPOSED)
                < rank(DocumentStatus.DESIGN_STANDARD))
        assert rank(DocumentStatus.EXISTING_SURVEY) < rank(DocumentStatus.DESIGN_STANDARD)


class TestConflicts:
    def test_agreement_within_uncertainty_is_not_a_conflict(self):
        assert not is_conflict(0.152, 0.146, 0.026, 0.01)

    def test_a_real_disagreement_survives(self):
        # 121 mm measured against a 152 mm as-built, both confident.
        assert is_conflict(0.152, 0.121, 0.004, 0.004)

    def test_two_confident_sources_cannot_manufacture_a_conflict_from_a_millimetre(self):
        assert not is_conflict(0.150, 0.151, 0.0, 0.0)


class TestReconciliation:
    def _official(self, feature, value, side=0, status=DocumentStatus.EXISTING_SURVEY):
        return OfficialGeometryFact(
            feature_id=feature, fact_class=OfficialFactClass.SIDEWALK_WIDTH, value=value,
            unit="m", document_id="test:doc", document_status=status, side=side,
            horizontal_sigma_m=0.15,
        )

    def test_both_values_are_kept(self):
        result = compare_widths(
            [self._official("sfcnn:1", 3.05)],
            [{"lon": 0.0, "lat": 0.0, "sidewalk_width_m": 3.6, "sidewalk_width_sigma_m": 0.03}],
            locate=lambda lon, lat: ("sfcnn:1", 1),
            fact_class=OfficialFactClass.SIDEWALK_WIDTH,
            value_key="sidewalk_width_m", sigma_key="sidewalk_width_sigma_m",
        )
        assert len(result.comparisons) == 1
        row = result.comparisons[0]
        assert row.official_value == 3.05 and row.observed_value == 3.6
        assert row.difference == pytest.approx(0.55, abs=1e-6)
        assert row.conflict

    def test_a_design_standard_never_enters_the_comparison(self):
        result = compare_widths(
            [self._official("sfcnn:1", 3.7, status=DocumentStatus.DESIGN_STANDARD)],
            [{"lon": 0.0, "lat": 0.0, "sidewalk_width_m": 3.05}],
            locate=lambda lon, lat: ("sfcnn:1", 1),
            fact_class=OfficialFactClass.SIDEWALK_WIDTH, value_key="sidewalk_width_m",
        )
        assert result.comparisons == []

    def test_a_different_fact_class_is_not_differenced(self):
        # The bug this replaces reported a confident 17 m error by differencing a footway
        # measurement against a right-of-way width.
        row = OfficialGeometryFact(
            feature_id="sfcnn:1", fact_class=OfficialFactClass.RIGHT_OF_WAY_WIDTH, value=20.9,
            unit="m", document_id="test:doc", document_status=DocumentStatus.RECORDED,
        )
        result = compare_widths(
            [row], [{"lon": 0.0, "lat": 0.0, "sidewalk_width_m": 3.05}],
            locate=lambda lon, lat: ("sfcnn:1", 1),
            fact_class=OfficialFactClass.SIDEWALK_WIDTH, value_key="sidewalk_width_m",
        )
        assert result.comparisons == []

    def test_the_side_of_the_street_is_respected(self):
        result = compare_widths(
            [self._official("sfcnn:1", 2.0, side=1), self._official("sfcnn:1", 5.0, side=-1)],
            [{"lon": 0.0, "lat": 0.0, "sidewalk_width_m": 5.1}],
            locate=lambda lon, lat: ("sfcnn:1", -1),
            fact_class=OfficialFactClass.SIDEWALK_WIDTH, value_key="sidewalk_width_m",
        )
        assert result.comparisons[0].official_value == 5.0

    def test_the_summary_reports_error_not_a_corrected_value(self):
        result = compare_widths(
            [self._official("sfcnn:1", 3.0)],
            [{"lon": 0.0, "lat": 0.0, "sidewalk_width_m": v} for v in (3.2, 2.8, 3.4)],
            locate=lambda lon, lat: ("sfcnn:1", 0),
            fact_class=OfficialFactClass.SIDEWALK_WIDTH, value_key="sidewalk_width_m",
        )
        summary = result.summary()["by_class"]["sidewalk_width"]
        assert summary["n"] == 3
        assert summary["bias_m"] == pytest.approx(0.1333, abs=1e-3)
        assert summary["mae_m"] == pytest.approx(0.2667, abs=1e-3)


class TestJoin:
    def _index(self):
        frame = LocalFrame(37.79, -122.40)
        index = CentrelineIndex(frame)
        # A street running east for about 200 m.
        index.add("sfcnn:1", [(-122.40, 37.79), (-122.3977, 37.79)], "TEST ST")
        return index, frame

    def test_a_point_north_of_the_street_is_on_its_left(self):
        index, _ = self._index()
        # The centreline runs east, so north of it is to the left of travel.
        found = index.locate(-122.399, 37.7901)
        assert found == ("sfcnn:1", 1)

    def test_a_point_south_of_the_street_is_on_its_right(self):
        index, _ = self._index()
        assert index.locate(-122.399, 37.7899) == ("sfcnn:1", -1)

    def test_a_point_far_away_matches_nothing(self):
        index, _ = self._index()
        assert index.locate(-122.30, 37.70) is None

    def test_a_way_is_matched_on_more_than_its_midpoint(self):
        index, _ = self._index()
        way = [(-122.3995 + i * 0.0001, 37.79005) for i in range(6)]
        found = index.locate_way(way)
        assert found is not None and found[0] == "sfcnn:1" and found[1] == 1

    def test_station_grows_along_the_line(self):
        _, frame = self._index()
        import numpy as np
        vertices = np.array([[0.0, 0.0], [100.0, 0.0]])
        near = project_to_polyline(vertices, 10.0, 1.0)
        far = project_to_polyline(vertices, 90.0, 1.0)
        assert far[1] > near[1]
        assert near[2] == 1, "north of an eastward line is its left"


class TestStationDependentGeometry:
    def test_two_curb_heights_can_coexist_on_one_street(self):
        import numpy as np

        from smc.overlay.street import StreetGeometrySample, StreetSegment

        segment = StreetSegment(
            segment_id="sfcnn:1",
            vertices=np.array([[0.0, 0.0], [200.0, 0.0]]),
            profile=(
                StreetGeometrySample(station_m=10.0, roadway_width_m=15.0,
                                     curb_height_left_m=0.121),
                StreetGeometrySample(station_m=190.0, roadway_width_m=9.0,
                                     curb_height_left_m=0.152),
            ),
        )
        assert segment.curb_height_at(5.0, 1) == pytest.approx(0.121)
        assert segment.curb_height_at(195.0, 1) == pytest.approx(0.152)
        assert segment.roadway_width_at(5.0) == pytest.approx(15.0)
        assert segment.roadway_width_at(195.0) == pytest.approx(9.0)

    def test_the_kerb_offset_follows_the_width_at_that_station(self):
        import numpy as np

        from smc.overlay.street import StreetGeometrySample, StreetSegment

        segment = StreetSegment(
            segment_id="sfcnn:1", vertices=np.array([[0.0, 0.0], [200.0, 0.0]]),
            profile=(StreetGeometrySample(station_m=10.0, roadway_width_m=20.0),
                     StreetGeometrySample(station_m=190.0, roadway_width_m=8.0)),
        )
        assert segment.kerb_offset(1, 5.0) == pytest.approx(10.0)
        assert segment.kerb_offset(1, 195.0) == pytest.approx(4.0)

    def test_an_unmeasured_curb_says_so_rather_than_guessing_six_inches(self):
        import numpy as np

        from smc.overlay.street import StreetSegment

        segment = StreetSegment(segment_id="sfcnn:1", vertices=np.array([[0.0, 0.0], [50.0, 0.0]]))
        assert segment.curb_height_at(25.0, 1) is None

    def test_a_segment_without_a_profile_keeps_its_default_width(self):
        import numpy as np

        from smc.overlay.street import StreetSegment

        segment = StreetSegment(segment_id="sfcnn:1",
                                vertices=np.array([[0.0, 0.0], [50.0, 0.0]]))
        assert segment.roadway_width_at(25.0) == pytest.approx(9.0)
