"""Tests for metric scale and the confidence model."""

from __future__ import annotations

import math
from datetime import UTC, datetime, timedelta

import pytest

from smc.facts.schema import Provenance, Tier
from smc.mapping.confidence import ConfidenceModel, Observation, disagreement_flag
from smc.mapping.scale import (
    ScaleEstimator,
    ScaleObservation,
    ScaleSource,
    from_camera_height,
    from_gnss_baseline,
    from_known_object,
    from_metric_depth,
    from_stereo_baseline,
)

NOW = datetime(2026, 8, 20, tzinfo=UTC)


class TestScaleObservation:
    @pytest.mark.parametrize(("scale", "sigma"), [(0.0, 0.1), (-1.0, 0.1), (1.0, 0.0), (1.0, -1.0)])
    def test_rejects_impossible_values(self, scale: float, sigma: float) -> None:
        with pytest.raises(ValueError):
            ScaleObservation(ScaleSource.METRIC_DEPTH, scale, sigma)

    def test_rejects_non_finite(self) -> None:
        with pytest.raises(ValueError):
            ScaleObservation(ScaleSource.METRIC_DEPTH, math.nan, 0.1)


class TestScaleFusion:
    def test_fusion_beats_every_input(self) -> None:
        est = ScaleEstimator()
        inputs = [
            from_stereo_baseline(0.201, 0.20, 0.002),
            from_metric_depth(8.1, 8.0),
            from_known_object(0.1495, 0.1524, 0.006, "curb"),
        ]
        result = est.fuse(inputs)
        assert result.sigma < min(o.sigma for o in inputs)

    def test_weighting_favours_the_precise_source(self) -> None:
        est = ScaleEstimator(require_independent_anchor=False)
        precise = ScaleObservation(ScaleSource.STEREO_BASELINE, 1.00, 0.001)
        vague = ScaleObservation(ScaleSource.GNSS_BASELINE, 2.00, 1.0)
        assert est.fuse([precise, vague]).scale == pytest.approx(1.00, abs=0.01)

    def test_rejects_a_misidentified_object(self) -> None:
        est = ScaleEstimator()
        result = est.fuse(
            [
                from_stereo_baseline(0.201, 0.20, 0.002),
                from_metric_depth(8.1, 8.0),
                from_camera_height(1.30, 1.30, 0.03),
                from_known_object(0.30, 0.1524, 0.006, "misread"),
            ]
        )
        assert len(result.rejected) == 1
        assert result.rejected[0].source is ScaleSource.KNOWN_OBJECT
        assert result.scale == pytest.approx(1.0, abs=0.02)

    def test_genuine_disagreement_is_flagged_not_averaged(self) -> None:
        """Two confident sources that contradict each other mean one is wrong."""
        est = ScaleEstimator()
        result = est.fuse(
            [from_stereo_baseline(0.201, 0.20, 0.001), from_camera_height(1.30, 1.60, 0.02)]
        )
        assert not result.consistent
        assert "scale_disagreement" in result.flags

    def test_disagreement_inflates_the_uncertainty(self) -> None:
        est = ScaleEstimator()
        agreeing = est.fuse(
            [
                ScaleObservation(ScaleSource.STEREO_BASELINE, 1.000, 0.001),
                ScaleObservation(ScaleSource.CAMERA_HEIGHT, 1.001, 0.001),
            ]
        )
        conflicting = est.fuse(
            [
                ScaleObservation(ScaleSource.STEREO_BASELINE, 1.000, 0.001),
                ScaleObservation(ScaleSource.CAMERA_HEIGHT, 1.200, 0.001),
            ]
        )
        assert conflicting.sigma > 10 * agreeing.sigma

    def test_outlier_rejection_needs_a_quorum(self) -> None:
        """With two observations there is no consensus to reject against."""
        est = ScaleEstimator()
        result = est.fuse(
            [
                ScaleObservation(ScaleSource.STEREO_BASELINE, 1.0, 0.01),
                ScaleObservation(ScaleSource.KNOWN_OBJECT, 2.0, 0.01),
            ]
        )
        assert result.rejected == ()
        assert not result.consistent

    def test_missing_independent_anchor_is_flagged(self) -> None:
        est = ScaleEstimator()
        result = est.fuse([from_camera_height(1.62, 1.60, 0.04), from_metric_depth(8.4, 8.0)])
        assert "no_independent_scale_anchor" in result.flags
        assert not result.has_independent_anchor

    def test_empty_input_rejected(self) -> None:
        with pytest.raises(ValueError):
            ScaleEstimator().fuse([])


class TestScaleReach:
    """Scale error is multiplicative, so it decides how far Tier B can reach."""

    def test_vehicle_rig_covers_kerb_range(self) -> None:
        result = ScaleEstimator().fuse(
            [
                from_stereo_baseline(0.201, 0.20, 0.002),
                from_metric_depth(8.1, 8.0),
                from_known_object(0.1495, 0.1524, 0.006, "curb"),
            ]
        )
        assert result.max_range_for_tolerance(0.15) > 12.0

    def test_camera_height_alone_does_not_reach_across_a_lane(self) -> None:
        """Quantifies why the vehicle rig carries an independent anchor and glasses do not."""
        result = ScaleEstimator().fuse(
            [from_camera_height(1.62, 1.60, 0.04), from_metric_depth(8.4, 8.0)]
        )
        assert result.max_range_for_tolerance(0.15) < 9.0
        # It is fine for what a wearer on the footway actually sees, 1-3 m away.
        assert result.max_range_for_tolerance(0.15) > 3.0

    def test_error_grows_linearly_with_range(self) -> None:
        result = ScaleEstimator().fuse([from_stereo_baseline(0.201, 0.20, 0.002)])
        assert result.depth_tolerance_at(12.0) == pytest.approx(
            4.0 * result.depth_tolerance_at(3.0), rel=1e-9
        )

    def test_rejects_bad_tolerance(self) -> None:
        result = ScaleEstimator().fuse([from_stereo_baseline(0.201, 0.20, 0.002)])
        with pytest.raises(ValueError):
            result.max_range_for_tolerance(0.0)


class TestScaleSources:
    def test_gnss_baseline_is_useless_over_short_runs(self) -> None:
        short = from_gnss_baseline(2.0, 2.0, 5.0)
        long = from_gnss_baseline(200.0, 200.0, 5.0)
        assert short.sigma > 20 * long.sigma

    def test_constructors_reject_nonpositive_measurements(self) -> None:
        for call in (
            lambda: from_stereo_baseline(0.0, 0.2, 0.002),
            lambda: from_camera_height(0.0, 1.6, 0.04),
            lambda: from_known_object(0.0, 0.15, 0.006, "x"),
            lambda: from_metric_depth(0.0, 8.0),
            lambda: from_gnss_baseline(1.0, 0.0, 5.0),
        ):
            with pytest.raises(ValueError):
                call()


class TestConfidence:
    def _obs(self, n: int, contributors: int, **kw: object) -> list[Observation]:
        base = dict(sigma=0.02, observed_at=NOW, residual_px=0.5, scale_relative_sigma=0.01)
        base.update(kw)
        return [
            Observation(contributor_id=f"u{i % contributors}", value=0.152, **base)  # type: ignore[arg-type]
            for i in range(n)
        ]

    def test_one_contributor_cannot_manufacture_corroboration(self) -> None:
        """40 frames from one wearer is one observer, not 40."""
        model = ConfidenceModel()
        single = model.fuse(self._obs(40, 1), tier=Tier.B, now=NOW)
        many = model.fuse(self._obs(6, 6), tier=Tier.B, now=NOW)
        assert single.provenance is Provenance.INFERRED
        assert many.provenance is Provenance.MEASURED
        assert many.confidence > single.confidence

    def test_repeat_views_still_add_something(self) -> None:
        model = ConfidenceModel()
        few = model.fuse(self._obs(2, 1), tier=Tier.B, now=NOW)
        lots = model.fuse(self._obs(20, 1), tier=Tier.B, now=NOW)
        assert lots.sigma < few.sigma

    def test_tier_c_is_always_advisory(self) -> None:
        model = ConfidenceModel()
        result = model.fuse(self._obs(30, 10), tier=Tier.C, now=NOW)
        assert result.provenance is Provenance.INFERRED
        assert result.confidence <= 0.45
        assert "advisory_verify_on_vehicle" in result.flags

    def test_uncertain_scale_blocks_promotion(self) -> None:
        model = ConfidenceModel()
        result = model.fuse(
            self._obs(10, 10, scale_relative_sigma=0.20), tier=Tier.B, now=NOW
        )
        assert result.provenance is Provenance.INFERRED
        assert "scale_uncertain" in result.flags

    def test_poor_geometry_lowers_confidence(self) -> None:
        model = ConfidenceModel()
        clean = model.fuse(self._obs(6, 6, residual_px=0.2), tier=Tier.B, now=NOW)
        noisy = model.fuse(self._obs(6, 6, residual_px=8.0), tier=Tier.B, now=NOW)
        assert noisy.confidence < clean.confidence / 2

    def test_confidence_decays_with_age(self) -> None:
        model = ConfidenceModel()
        fresh = model.fuse(self._obs(6, 6), tier=Tier.B, now=NOW)
        stale = model.fuse(self._obs(6, 6), tier=Tier.B, now=NOW + timedelta(days=180))
        assert stale.confidence < 0.2 * fresh.confidence
        assert "withhold" in stale.flags

    def test_corroboration_saturates(self) -> None:
        model = ConfidenceModel()
        gain_early = (
            model.fuse(self._obs(4, 4), tier=Tier.B, now=NOW).confidence
            - model.fuse(self._obs(2, 2), tier=Tier.B, now=NOW).confidence
        )
        gain_late = (
            model.fuse(self._obs(22, 22), tier=Tier.B, now=NOW).confidence
            - model.fuse(self._obs(20, 20), tier=Tier.B, now=NOW).confidence
        )
        assert gain_early > gain_late

    def test_rejects_naive_datetime(self) -> None:
        with pytest.raises(ValueError, match="timezone-aware"):
            Observation("u1", 0.1, 0.01, datetime(2026, 8, 20))

    def test_rejects_empty_observations(self) -> None:
        with pytest.raises(ValueError):
            ConfidenceModel().fuse([], tier=Tier.B)


class TestDisagreement:
    def test_agreement_produces_no_flag(self) -> None:
        assert disagreement_flag(0.152, 0.1524, 0.01, "code") is None

    def test_conflict_records_both_values(self) -> None:
        flag = disagreement_flag(0.0, 0.1524, 0.01, "osm_curb")
        assert flag is not None
        assert "measured=0.0000" in flag and "reference=0.1524" in flag
