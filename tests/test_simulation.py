"""Tests for geodesy, GNSS error, the sensor rig, and drive planning."""

from __future__ import annotations

import json

import numpy as np
import pytest
from pydantic import ValidationError

from smc import geo
from smc.carla_gen.gnss import (
    CROWDSOURCED_MIX,
    PRESETS,
    Environment,
    GnssSimulator,
    mean_horizontal_deviation,
    mix_mean_deviation,
)
from smc.carla_gen.scenario import (
    DriveConfig,
    baseline_between_frames_m,
    carla_available,
    plan_capture_stations,
    simulate_drive,
    write_manifest,
)
from smc.carla_gen.sensors import CameraSpec, CaptureSettings, StereoRig, default_rig
from smc.carla_gen.world import build_corridor
from smc.facts.schema import FactClass, Provenance, Tier, WorldFact, utcnow
from smc.facts.truth import GroundTruthFact

ORIGIN = geo.Origin(38.9072, -77.0369)
SEED = 20260820


class TestGeo:
    def test_enu_roundtrip(self) -> None:
        for east, north in [(0.0, 0.0), (500.0, -300.0), (-1200.0, 900.0)]:
            lat, lon = geo.enu_to_geodetic(ORIGIN, east, north)
            back_e, back_n = geo.geodetic_to_enu(ORIGIN, lat, lon)
            assert back_e == pytest.approx(east, abs=1e-6)
            assert back_n == pytest.approx(north, abs=1e-6)

    def test_local_distance_is_exact_at_scoring_range(self) -> None:
        """The checker compares positions metres apart. There the metric must be exact."""
        for east, north in [(3.0, 4.0), (0.6, 0.8), (12.0, 5.0)]:
            lat, lon = geo.enu_to_geodetic(ORIGIN, east, north)
            expected = float(np.hypot(east, north))
            assert geo.distance_m(ORIGIN.lat, ORIGIN.lon, lat, lon) == pytest.approx(
                expected, rel=1e-6
            )

    def test_local_distance_holds_to_ppm_across_a_corridor(self) -> None:
        for east, north in [(300.0, 400.0), (0.0, 500.0), (500.0, 0.0)]:
            lat, lon = geo.enu_to_geodetic(ORIGIN, east, north)
            expected = float(np.hypot(east, north))
            assert geo.distance_m(ORIGIN.lat, ORIGIN.lon, lat, lon) == pytest.approx(
                expected, rel=1e-5
            )

    def test_haversine_carries_a_directional_bias_and_is_not_the_local_metric(self) -> None:
        """Documents why distance_m exists, so nobody 'simplifies' it back to haversine."""
        north_lat, north_lon = geo.enu_to_geodetic(ORIGIN, 0.0, 500.0)
        east_lat, east_lon = geo.enu_to_geodetic(ORIGIN, 500.0, 0.0)
        north_err = geo.haversine_m(ORIGIN.lat, ORIGIN.lon, north_lat, north_lon) - 500.0
        east_err = geo.haversine_m(ORIGIN.lat, ORIGIN.lon, east_lat, east_lon) - 500.0
        assert north_err > 0.5 and east_err < -0.5

    def test_refuses_to_extrapolate_past_validity(self) -> None:
        with pytest.raises(ValueError, match="tangent plane"):
            geo.enu_to_geodetic(ORIGIN, 40_000.0, 0.0)

    def test_rejects_impossible_origin(self) -> None:
        with pytest.raises(ValueError):
            geo.Origin(120.0, 0.0)


class TestGnss:
    def test_presets_are_ordered_by_severity(self) -> None:
        values = {
            env: mean_horizontal_deviation(PRESETS[env], samples=6000) for env in Environment
        }
        assert (
            values[Environment.RTK_FIXED]
            < values[Environment.OPEN_SKY]
            < values[Environment.SUBURBAN]
            < values[Environment.URBAN_CANYON]
        )

    def test_rtk_reaches_centimetres(self) -> None:
        """The truth rig's whole purpose. ZED-F9P is 0.01 m + 1 ppm CEP."""
        assert mean_horizontal_deviation(PRESETS[Environment.RTK_FIXED], samples=6000) < 0.05

    def test_crowdsourced_mix_matches_published_deviation(self) -> None:
        """Calibration target: ~5.5 m mean deviation for crowdsourced camera positions."""
        assert 4.0 < mix_mean_deviation() < 7.0

    def test_mix_weights_are_a_distribution(self) -> None:
        assert sum(CROWDSOURCED_MIX.values()) == pytest.approx(1.0)

    def test_error_is_correlated_across_a_pass(self) -> None:
        """Independent per-frame noise would let averaging manufacture accuracy that is not
        there. Averaging a whole pass must barely dent the error."""
        sim = GnssSimulator(PRESETS[Environment.URBAN_CANYON], np.random.default_rng(3))
        errors = np.array([sim.step(0.25)[:2] for _ in range(120)])
        per_frame = float(np.mean(np.hypot(errors[:, 0], errors[:, 1])))
        averaged = float(np.hypot(*errors.mean(axis=0)))
        assert averaged > 0.5 * per_frame, (averaged, per_frame)

    def test_multipath_produces_a_heavy_tail(self) -> None:
        sim = GnssSimulator(PRESETS[Environment.URBAN_CANYON], np.random.default_rng(11))
        draws = np.array([sim.horizontal_error(1.0) for _ in range(20_000)])
        assert np.percentile(draws, 99.5) > 3.0 * np.median(draws)

    def test_rejects_negative_timestep(self) -> None:
        sim = GnssSimulator(PRESETS[Environment.SUBURBAN], np.random.default_rng(0))
        with pytest.raises(ValueError):
            sim.step(-1.0)


class TestSensorRig:
    def test_focal_length_matches_the_field_of_view(self) -> None:
        cam = CameraSpec(name="c", width=1920, fov_deg=90.0)
        assert cam.focal_px == pytest.approx(960.0)
        assert cam.principal_point == (960.0, 600.0)

    def test_depth_uncertainty_grows_quadratically(self) -> None:
        rig = default_rig()
        near = rig.depth_uncertainty_m(5.0)
        far = rig.depth_uncertainty_m(10.0)
        assert far == pytest.approx(4.0 * near, rel=1e-9)

    def test_the_20cm_baseline_cannot_reach_the_curb_at_tier_b(self) -> None:
        """Documents a real hardware limit, not an aspiration.

        The kerb sits 5-12 m from a traffic lane. A 0.20 m baseline meets the revised +/-0.15 m
        Tier B width tolerance only to about 7.6 m, so rigid stereo alone cannot carry Tier B
        across a full lane offset; the motion baseline has to. See docs/05-carla-harness.md.
        """
        rig = default_rig()
        assert rig.max_range_for_tolerance_m(0.15) < 9.0
        wider = StereoRig(left=rig.left, right=rig.right, baseline_m=0.50)
        assert wider.max_range_for_tolerance_m(0.15) > 11.0

    def test_rejects_nonsense_ranges(self) -> None:
        rig = default_rig()
        with pytest.raises(ValueError):
            rig.depth_uncertainty_m(0.0)
        with pytest.raises(ValueError):
            rig.max_range_for_tolerance_m(0.0)

    def test_capture_cadence(self) -> None:
        settings = CaptureSettings(fixed_delta_seconds=0.05, capture_hz=4.0)
        assert settings.capture_every_n_ticks == 5


class TestDrivePlanning:
    def _config(self, **kw: object) -> DriveConfig:
        corridor = build_corridor("t", ORIGIN, SEED, n_blocks=4)
        return DriveConfig(corridor=corridor, output_dir=None, **kw)  # type: ignore[arg-type]

    def test_motion_baseline_dwarfs_the_rigid_one(self) -> None:
        """Why rigid stereo is for scale and motion stereo is for precision."""
        config = self._config(target_speed_mps=8.0)
        assert baseline_between_frames_m(config) == pytest.approx(2.0)
        assert baseline_between_frames_m(config) > 5.0 * config.rig.baseline_m

    def test_capture_stations_cover_the_corridor(self) -> None:
        config = self._config()
        stations = plan_capture_stations(config)
        assert stations[0] == 0.0
        assert stations[-1] <= config.corridor.length_m

    def test_repeat_passes_produce_independent_errors(self) -> None:
        """Corroboration is only meaningful if passes are not correlated by construction."""
        config = self._config(passes=3, seed=5)
        frames = simulate_drive(config)
        by_pass = {}
        for f in frames:
            by_pass.setdefault(int(f.timestamp_s // 1e4), []).append(f.gnss_error_m)
        means = [float(np.mean(v)) for v in by_pass.values()]
        assert len(means) == 3
        assert len(set(round(m, 6) for m in means)) == 3

    def test_ingest_record_excludes_truth(self) -> None:
        """The engine must never be handed the answer."""
        frames = simulate_drive(self._config())
        record = frames[0].to_ingest_record()
        assert "true_lat" not in record
        assert "true_lon" not in record
        assert "gnss_error_m" not in record

    def test_manifest_separates_truth_into_its_own_file(self, tmp_path: object) -> None:
        from pathlib import Path

        assert isinstance(tmp_path, Path)
        frames = simulate_drive(self._config())
        manifest = write_manifest(frames, tmp_path / "frames.json")
        payload = json.loads(manifest.read_text())
        assert all("true_lat" not in row for row in payload)
        truth = json.loads((tmp_path / "frames.truth.json").read_text())
        assert all("true_lat" in row for row in truth)

    def test_rejects_zero_passes(self) -> None:
        with pytest.raises(ValueError):
            self._config(passes=0)

    def test_carla_absence_is_reported_not_raised(self) -> None:
        assert isinstance(carla_available(), bool)


class TestFactsAndTruthAreDistinct:
    def _fact(self, **kw: object) -> WorldFact:
        base = dict(
            fact_id="f1",
            feature_id="x",
            fact_class=FactClass.CURB_HEIGHT,
            tier=Tier.B,
            provenance=Provenance.MEASURED,
            confidence=0.9,
            value=0.152,
            unit="m",
            lat=38.9,
            lon=-77.0,
            position_sigma_m=0.4,
            observed_at=utcnow(),
            corroboration_count=3,
            source_run_id="r1",
        )
        base.update(kw)
        return WorldFact(**base)  # type: ignore[arg-type]

    def test_tier_c_cannot_be_measured(self) -> None:
        with pytest.raises(ValidationError, match="beyond reliable crowdsourced RGB"):
            self._fact(
                fact_class=FactClass.LEVEL_CHANGE_HEIGHT,
                tier=Tier.C,
                provenance=Provenance.MEASURED,
                confidence=0.3,
            )

    def test_tier_c_confidence_is_capped(self) -> None:
        with pytest.raises(ValidationError, match="advisory ceiling"):
            self._fact(
                fact_class=FactClass.LEVEL_CHANGE_HEIGHT,
                tier=Tier.C,
                provenance=Provenance.INFERRED,
                confidence=0.9,
            )

    def test_tier_must_match_the_class(self) -> None:
        with pytest.raises(ValidationError, match="belongs to tier"):
            self._fact(tier=Tier.A)

    def test_measured_requires_an_observation(self) -> None:
        with pytest.raises(ValidationError, match="at least one contributing observation"):
            self._fact(corroboration_count=0)

    def test_conflict_preserves_the_measurement(self) -> None:
        fact = self._fact()
        flagged = fact.with_conflict("osm_says_no_curb")
        assert flagged.value == fact.value
        assert "conflict:osm_says_no_curb" in flagged.flags

    def test_truth_has_no_confidence_field(self) -> None:
        """Truth is a different type on purpose; it must not be confusable with a served fact."""
        assert not hasattr(GroundTruthFact, "confidence")
        assert not hasattr(GroundTruthFact, "provenance")

    def test_truth_scores_numeric_and_categorical_differently(self) -> None:
        numeric = GroundTruthFact("x", FactClass.CURB_HEIGHT, 0.152, "m", 0.0, 0.0, "tape")
        assert numeric.error_against(0.160) == pytest.approx(0.008)
        with pytest.raises(TypeError):
            numeric.matches(0.160)

        categorical = GroundTruthFact(
            "x", FactClass.SURFACE_CLASS, "concrete", None, 0.0, 0.0, "tape"
        )
        assert categorical.matches("concrete")
        assert categorical.error_against("asphalt") is None
