"""Curb-to-curb measurement and the street-width record.

The failures available here are quiet ones. An island kerb paired against a block face gives a
plausible number that is the distance to the median. A sparse polyline read at a station gives
the vertex spacing rather than the kerb. A block keyed in the order one table happened to list
its cross streets does not match the same block in the other. None of these raise.
"""

from __future__ import annotations

import math

import numpy as np
import pytest

from smc.official.curbs import (
    Sample,
    curb_role,
    densify,
    offsets_along,
    summarise,
    width_profile,
)
from smc.official.extract import (
    _feet_inches,
    block_key,
    block_key_for_centreline,
    street_width_facts,
)
from smc.official.schema import DocumentStatus, OfficialDocument, OfficialFactClass

DOC = OfficialDocument(
    document_id="test:widths", record_type="street_width_record",
    source_url="https://example.invalid", sha256="0" * 64,
    retrieved_at="2026-01-01T00:00:00Z", status=DocumentStatus.RECORDED,
)

#: A street running due east for 100 m, at the origin.
CENTRELINE = np.array([[0.0, 0.0], [100.0, 0.0]])


def _face(offset: float, x0: float = 0.0, x1: float = 100.0, step: float = 5.0):
    return [(x, offset) for x in np.arange(x0, x1 + step, step)]


class TestCurbRole:
    def test_an_island_is_not_a_block_face(self):
        assert curb_role("ISL10") == "island"
        assert curb_role("ISL100") == "island"

    def test_a_block_face_is(self):
        assert curb_role("BLK10") == "block"
        assert curb_role("BLK11") == "block"

    def test_a_non_block_is_neither(self):
        assert curb_role("NBLK100") == "non_block"

    def test_an_unknown_code_is_not_quietly_treated_as_a_block(self):
        assert curb_role(None) == "other"
        assert curb_role("") == "other"


class TestDensify:
    def test_a_sparse_line_gains_vertices(self):
        # Five vertices over a thirty-metre block face is typical of the source.
        assert len(densify([(0.0, 0.0), (30.0, 0.0)], step_m=1.0)) >= 30

    def test_the_line_is_not_moved(self):
        out = densify([(0.0, 0.0), (10.0, 0.0), (10.0, 10.0)], step_m=2.0)
        assert out[0] == (0.0, 0.0)
        assert out[-1] == pytest.approx((10.0, 10.0))
        # Every point stays on one of the two legs.
        for x, y in out:
            assert (abs(y) < 1e-6 and -1e-6 <= x <= 10.0 + 1e-6) or \
                   (abs(x - 10.0) < 1e-6 and -1e-6 <= y <= 10.0 + 1e-6)

    def test_a_degenerate_line_survives(self):
        assert densify([(1.0, 1.0)]) == [(1.0, 1.0)]
        assert densify([]) == []


class TestOffsets:
    def test_north_of_an_eastward_street_is_a_positive_offset(self):
        out = offsets_along(CENTRELINE, [(50.0, 4.0)])
        assert out[0][0] == pytest.approx(50.0)
        assert out[0][1] == pytest.approx(4.0)

    def test_south_is_negative(self):
        assert offsets_along(CENTRELINE, [(50.0, -4.0)])[0][1] == pytest.approx(-4.0)

    def test_a_curb_belonging_to_another_street_is_dropped(self):
        assert offsets_along(CENTRELINE, [(50.0, 200.0)]) == []


class TestWidthProfile:
    def test_a_constant_street_measures_its_width(self):
        samples = width_profile(CENTRELINE, _face(5.0), _face(-6.0))
        widths = [s.width_m for s in samples if s.width_m is not None]
        assert widths
        assert all(w == pytest.approx(11.0, abs=0.01) for w in widths)

    def test_a_bulb_out_shows_up_as_variation(self):
        # The north kerb steps in by two metres for a twenty-metre stretch.
        left = [(x, 3.0 if 40.0 <= x <= 60.0 else 5.0) for x in np.arange(0.0, 101.0, 1.0)]
        samples = width_profile(CENTRELINE, left, _face(-5.0))
        summary = summarise(samples)
        assert summary["max_m"] - summary["min_m"] > 1.5
        assert summary["p10_m"] < summary["p90_m"]

    def test_one_face_alone_yields_no_width(self):
        samples = width_profile(CENTRELINE, _face(5.0), [])
        assert all(s.width_m is None for s in samples)
        assert summarise(samples) == {"n": 0}

    def test_two_faces_on_the_same_side_yield_no_width(self):
        # Both "faces" north of the centreline: this is one kerb found twice, not a street.
        samples = width_profile(CENTRELINE, _face(5.0), _face(6.0))
        assert all(s.width_m is None for s in samples)

    def test_an_implausible_width_is_refused(self):
        samples = width_profile(CENTRELINE, _face(0.5), _face(-0.5))
        assert all(s.width_m is None for s in samples), "a one-metre street was accepted"

    def test_the_profile_follows_the_street_not_the_vertices(self):
        # A face drawn with two vertices and one with fifty must measure the same street.
        sparse = width_profile(CENTRELINE, densify(_face(5.0, step=50.0)),
                               densify(_face(-5.0, step=50.0)))
        dense = width_profile(CENTRELINE, _face(5.0, step=1.0), _face(-5.0, step=1.0))
        assert summarise(sparse)["median_m"] == pytest.approx(
            summarise(dense)["median_m"], abs=0.05)


class TestSummarise:
    def test_percentiles_describe_the_spread(self):
        samples = [Sample(float(i), 5.0, 5.0 + (i % 5), 3, 3) for i in range(50)]
        summary = summarise(samples)
        assert summary["n"] == 50
        assert summary["min_m"] < summary["median_m"] < summary["max_m"]


class TestFeetAndInches:
    def test_sixty_six_feet_seven_inches(self):
        assert _feet_inches(66, 7) == pytest.approx(20.2946, abs=1e-3)

    def test_zero_is_a_blank_not_a_measurement(self):
        # The table leaves sidewalk width empty far more often than it fills it, and a
        # zero-foot sidewalk is not a thing San Francisco has.
        assert _feet_inches(0, 0) is None

    def test_inches_alone_still_count(self):
        assert _feet_inches(0, 6) == pytest.approx(0.1524, abs=1e-4)


class TestBlockKey:
    def test_the_same_block_keys_the_same_from_either_direction(self):
        forward = block_key({"STREETNAME": "CLAY", "STREETTYPE": "ST",
                             "FROMSTREET": "DRUMM ST", "TOSTREET": "DAVIS ST"})
        backward = block_key({"STREETNAME": "CLAY", "STREETTYPE": "ST",
                              "FROMSTREET": "DAVIS ST", "TOSTREET": "DRUMM ST"})
        assert forward == backward

    def test_the_width_table_and_the_centreline_network_agree(self):
        assert block_key({"STREETNAME": "CLAY", "STREETTYPE": "ST",
                          "FROMSTREET": "DRUMM ST", "TOSTREET": "DAVIS ST"}) == \
               block_key_for_centreline({"street": "clay", "st_type": "st",
                                         "f_st": "davis st", "t_st": "drumm st"})

    def test_a_block_with_no_second_cross_street_has_no_key(self):
        assert block_key_for_centreline({"street": "ANNIE", "st_type": "ST",
                                         "f_st": "MARKET ST", "t_st": "MID BLOCK"}) is None

    def test_different_blocks_of_one_street_are_different(self):
        assert block_key({"STREETNAME": "CLAY", "STREETTYPE": "ST",
                          "FROMSTREET": "DRUMM ST", "TOSTREET": "DAVIS ST"}) != \
               block_key({"STREETNAME": "CLAY", "STREETTYPE": "ST",
                          "FROMSTREET": "DAVIS ST", "TOSTREET": "FRONT ST"})


class TestStreetWidthFacts:
    def _row(self, **overrides):
        row = {"SWID": 3066.0, "CNN": None, "STREETNAME": "CLAY", "STREETTYPE": "ST",
               "FROMSTREET": "SPOFFORD LN", "TOSTREET": "STOCKTON ST",
               "SIDEWALKFEET": 10.0, "SIDEWALKINCHES": 0.0, "SIDE": "Both",
               "ROWFEET": 49.0, "ROWINCHES": 0.0, "OFFICIAL": "Official",
               "FILENAME": "c061.tif"}
        row.update(overrides)
        return [{"properties": row}]

    def test_a_right_of_way_becomes_a_fact_in_metres(self):
        facts = street_width_facts(self._row(), DOC)
        row = next(f for f in facts
                   if f.fact_class is OfficialFactClass.RIGHT_OF_WAY_WIDTH)
        assert row.value == pytest.approx(14.9352, abs=1e-3)
        assert row.source_value == pytest.approx(49.0)
        assert row.source_unit == "ft"

    def test_the_sheet_it_came_off_is_kept(self):
        facts = street_width_facts(self._row(), DOC)
        assert all(f.page_or_sheet == "c061.tif" for f in facts)

    def test_a_record_not_marked_official_keeps_its_value_and_loses_its_status(self):
        facts = street_width_facts(self._row(OFFICIAL="Unofficial"), DOC)
        row = next(f for f in facts
                   if f.fact_class is OfficialFactClass.RIGHT_OF_WAY_WIDTH)
        assert row.value is not None
        assert row.document_status is DocumentStatus.UNKNOWN
        assert "not_marked_official" in row.flags

    def test_a_blank_sidewalk_produces_no_sidewalk_fact(self):
        facts = street_width_facts(self._row(SIDEWALKFEET=0.0, SIDEWALKINCHES=0.0), DOC)
        assert not any(f.fact_class is OfficialFactClass.SIDEWALK_WIDTH for f in facts)

    def test_duplicate_rows_are_counted_once(self):
        rows = self._row() + self._row()
        assert len(street_width_facts(rows, DOC)) == len(street_width_facts(self._row(), DOC))

    def test_a_row_with_a_cnn_keys_by_cnn_and_says_so(self):
        facts = street_width_facts(self._row(CNN=4091000.0), DOC)
        row = next(f for f in facts
                   if f.fact_class is OfficialFactClass.RIGHT_OF_WAY_WIDTH)
        assert row.feature_id == "sfcnn:4091000"
        assert "keyed_by_block_not_cnn" not in row.flags

    def test_a_row_without_one_keys_by_block_and_says_so(self):
        facts = street_width_facts(self._row(), DOC)
        row = next(f for f in facts
                   if f.fact_class is OfficialFactClass.RIGHT_OF_WAY_WIDTH)
        assert row.feature_id.startswith("sfblock:")
        assert "keyed_by_block_not_cnn" in row.flags

    def test_the_record_claims_inch_precision_not_metre_precision(self):
        facts = street_width_facts(self._row(), DOC)
        row = next(f for f in facts
                   if f.fact_class is OfficialFactClass.RIGHT_OF_WAY_WIDTH)
        assert row.horizontal_sigma_m == pytest.approx(0.0254, abs=1e-3)
