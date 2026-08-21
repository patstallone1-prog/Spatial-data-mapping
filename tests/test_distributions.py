"""Tests for the right-of-way sampling model.

These assert the properties the simulation's usefulness depends on, not exact draws:
reproducibility across processes, block-level correlation, and the presence of a
non-compliant tail. A statistical assertion here uses a large sample and a wide band, so it
catches a broken model without failing on ordinary sampling noise.
"""

from __future__ import annotations

import numpy as np
import pytest

from smc import units
from smc.carla_gen import distributions as d
from smc.carla_gen.profile import DEFAULT_PROFILE, CurbProfile, audit

SEED = 20260820


class TestUnits:
    def test_inch_roundtrip(self) -> None:
        assert units.to_inches(units.inches(6.0)) == pytest.approx(6.0)

    def test_thresholds_match_the_standards(self) -> None:
        assert units.LEVEL_CHANGE_PASSABLE_M == pytest.approx(0.00635, abs=1e-9)
        assert units.RAMP_RUNNING_SLOPE_MAX == pytest.approx(0.0833, abs=1e-4)
        assert units.CROSS_SLOPE_MAX == pytest.approx(0.0208, abs=1e-4)

    def test_ratio_conversion(self) -> None:
        assert units.ratio_from_slope(units.RAMP_RUNNING_SLOPE_MAX) == pytest.approx(12.0)

    def test_zero_run_rejected(self) -> None:
        with pytest.raises(ValueError):
            units.slope_from_ratio(1.0, 0.0)


class TestDeterminism:
    """The corroboration claim is untestable if a repeat pass sees different geometry."""

    def test_same_identity_reproduces(self) -> None:
        assert d.sample_block_face(SEED, "b1") == d.sample_block_face(SEED, "b1")

    def test_identity_not_call_order(self) -> None:
        first = [d.sample_block_face(SEED, f"b{i}") for i in range(5)]
        second = [d.sample_block_face(SEED, f"b{i}") for i in reversed(range(5))]
        assert first == list(reversed(second))

    def test_different_seeds_diverge(self) -> None:
        assert d.sample_block_face(1, "b1") != d.sample_block_face(2, "b1")

    def test_ramps_reproduce(self) -> None:
        block = d.sample_block_face(SEED, "b1")
        assert d.sample_curb_ramp(SEED, block, "r1") == d.sample_curb_ramp(SEED, block, "r1")


class TestHierarchy:
    def test_segments_inherit_block_surface(self) -> None:
        block = d.sample_block_face(SEED, "b1")
        segments = [d.sample_sidewalk_segment(SEED, block, f"s{i}", 40.0) for i in range(6)]
        assert {s.surface for s in segments} == {block.surface}

    def test_ramps_inherit_block_curb_height(self) -> None:
        block = d.sample_block_face(SEED, "b1")
        ramp = d.sample_curb_ramp(SEED, block, "r1")
        assert ramp.curb_height_m == block.curb_height_m

    def test_quality_drives_compliance(self) -> None:
        """A high-quality block face must depart from the standard less often than a poor one."""
        good = d.BlockFace("g", 0.95, 2018, *_curb_fields())
        poor = d.BlockFace("p", 0.05, 1948, *_curb_fields())
        good_rate = _noncompliance_rate(good)
        poor_rate = _noncompliance_rate(poor)
        assert poor_rate > good_rate + 0.10, (poor_rate, good_rate)


class TestSlopeMixture:
    def test_tail_exists_and_body_is_compliant(self) -> None:
        rng = np.random.default_rng(0)
        draws = np.array(
            [
                d._sample_slope(
                    rng,
                    noncompliance_p=0.30,
                    compliant_mean=0.071,
                    compliant_sd=0.010,
                    excess_scale=0.022,
                    limit=units.RAMP_RUNNING_SLOPE_MAX,
                )
                for _ in range(20_000)
            ]
        )
        over = float(np.mean(draws > units.RAMP_RUNNING_SLOPE_MAX))
        assert 0.27 < over < 0.33, over
        assert draws.min() >= 0.0
        # The tail must reach far enough to be distinguishable, not just clip the limit.
        assert draws.max() > units.RAMP_RUNNING_SLOPE_MAX + 0.05

    def test_zero_noncompliance_never_exceeds_limit(self) -> None:
        rng = np.random.default_rng(0)
        draws = [
            d._sample_slope(
                rng,
                noncompliance_p=0.0,
                compliant_mean=0.07,
                compliant_sd=0.01,
                excess_scale=0.02,
                limit=units.RAMP_RUNNING_SLOPE_MAX,
            )
            for _ in range(5_000)
        ]
        assert max(draws) <= units.RAMP_RUNNING_SLOPE_MAX


class TestSidewalkSegment:
    def test_clear_width_never_exceeds_total(self) -> None:
        for i in range(300):
            block = d.sample_block_face(SEED, f"b{i}")
            seg = d.sample_sidewalk_segment(SEED, block, f"s{i}", 60.0)
            assert seg.min_clear_width_m <= seg.total_width_m
            assert seg.min_clear_width_m >= 0.0

    def test_level_changes_are_ordered_and_bounded(self) -> None:
        block = d.sample_block_face(SEED, "b1")
        seg = d.sample_sidewalk_segment(SEED, block, "s1", 120.0)
        positions = [lc.s_m for lc in seg.level_changes]
        assert positions == sorted(positions)
        assert all(0.0 <= p <= seg.length_m for p in positions)
        cap = DEFAULT_PROFILE.sidewalk.joint_displacement_max_m
        assert all(lc.height_m <= cap for lc in seg.level_changes)

    def test_trip_hazard_tail_is_present_but_uncommon(self) -> None:
        """Tier C exists because these are rare and small. Both properties are asserted."""
        heights = np.array(
            [
                lc.height_m
                for i in range(1_500)
                for lc in d.sample_sidewalk_segment(
                    SEED, d.sample_block_face(SEED, f"b{i}"), f"s{i}", 60.0
                ).level_changes
            ]
        )
        over_quarter = float(np.mean(heights > units.LEVEL_CHANGE_PASSABLE_M))
        over_half = float(np.mean(heights > units.LEVEL_CHANGE_RAMP_REQUIRED_M))
        assert 0.02 < over_quarter < 0.15, over_quarter
        assert 0.002 < over_half < 0.05, over_half

    def test_rejects_nonpositive_length(self) -> None:
        block = d.sample_block_face(SEED, "b1")
        with pytest.raises(ValueError):
            d.sample_sidewalk_segment(SEED, block, "s1", 0.0)


class TestCorners:
    def test_missing_ramps_occur(self) -> None:
        """Recall on 'no ramp here' is unmeasurable if the sim never omits one."""
        corners = [
            d.sample_corner(SEED, d.sample_block_face(SEED, f"b{i}"), f"c{i}")
            for i in range(2_000)
        ]
        empty = float(np.mean([len(c) == 0 for c in corners]))
        assert 0.10 < empty < 0.45, empty
        assert max(len(c) for c in corners) == 2


class TestProfileAudit:
    def test_unregistered_fields_default_to_estimate(self) -> None:
        result = audit(DEFAULT_PROFILE)
        assert result.estimate_fraction > 0.5
        assert "ramp.running_slope_noncompliance" in result.estimate

    def test_standards_are_registered(self) -> None:
        result = audit(DEFAULT_PROFILE)
        assert "curb.standard_mean_m" in result.standard

    def test_report_names_the_estimates(self) -> None:
        assert "estimated" in audit(DEFAULT_PROFILE).report()

    def test_unknown_override_rejected(self) -> None:
        with pytest.raises(AttributeError):
            CurbProfile.from_municipal_survey("nyc", not_a_field=1)


def _curb_fields() -> tuple[object, ...]:
    from smc.carla_gen.profile import CurbHeightClass, SurfaceClass

    return (CurbHeightClass.STANDARD, units.inches(6.0), SurfaceClass.CONCRETE)


def _noncompliance_rate(block: d.BlockFace) -> float:
    ramps = [d.sample_curb_ramp(SEED, block, f"{block.block_id}:r{i}") for i in range(2_000)]
    return float(np.mean([not r.running_slope_compliant for r in ramps]))
