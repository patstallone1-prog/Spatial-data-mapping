"""Tests for the capture trigger."""

from __future__ import annotations

import pytest

from smc.capture.trigger import (
    CaptureContext,
    CoverageCell,
    CoverageIndex,
    MotionState,
    Suppression,
    TriggerConfig,
    TriggerEngine,
    baseline_for_depth_tolerance_m,
    overlap_fraction,
    perceptual_distance,
    required_capture_hz,
)


def ctx(**kw: object) -> CaptureContext:
    base = dict(
        timestamp_s=0.0,
        motion_state=MotionState.WALKING,
        speed_mps=1.4,
        lat=38.9,
        lon=-77.0,
        position_sigma_m=5.0,
        cell_id="c1",
        cell_age_s=None,
        scene_distance=0.5,
    )
    base.update(kw)
    return CaptureContext(**base)  # type: ignore[arg-type]


def run(engine: TriggerEngine, *, speed: float, state: MotionState, ticks: int, dt: float = 0.05,
        novel: bool = True) -> int:
    for i in range(ticks):
        engine.evaluate(
            ctx(
                timestamp_s=i * dt,
                speed_mps=speed,
                motion_state=state,
                cell_id=f"c{i}" if novel else "c1",
                cell_age_s=None if novel else 10.0,
                scene_distance=0.5,
            )
        )
    return engine.captured_count


class TestSuppression:
    def test_wearer_riding_in_a_car_captures_nothing(self) -> None:
        """The premise of the shared trigger: a vehicle interior is not worth uploading."""
        engine = TriggerEngine()
        assert run(engine, speed=35.0, state=MotionState.VEHICLE, ticks=200) == 0
        assert engine.reason_histogram[Suppression.MOTION_STATE] == 200

    def test_standing_still_captures_nothing(self) -> None:
        engine = TriggerEngine()
        assert run(engine, speed=0.0, state=MotionState.STATIONARY, ticks=100) == 0

    def test_walking_but_barely_moving_is_too_slow(self) -> None:
        engine = TriggerEngine()
        engine.evaluate(ctx(speed_mps=0.1))
        assert engine.reason_histogram[Suppression.TOO_SLOW] == 1

    @pytest.mark.parametrize(
        ("field", "value", "reason"),
        [
            ("battery_fraction", 0.05, Suppression.POWER),
            ("device_temp_c", 50.0, Suppression.THERMAL),
            ("free_storage_mb", 10.0, Suppression.STORAGE),
            ("in_privacy_zone", True, Suppression.PRIVACY_ZONE),
            ("position_sigma_m", 100.0, Suppression.POOR_FIX),
        ],
    )
    def test_device_health_gates(self, field: str, value: object, reason: Suppression) -> None:
        engine = TriggerEngine()
        decision = engine.evaluate(ctx(**{field: value}))
        assert decision.suppressed
        assert decision.reason is reason

    def test_health_checks_run_before_sensor_work(self) -> None:
        """A flat battery must short-circuit before anything expensive is evaluated."""
        engine = TriggerEngine()
        decision = engine.evaluate(
            ctx(battery_fraction=0.01, motion_state=MotionState.VEHICLE, speed_mps=99.0)
        )
        assert decision.reason is Suppression.POWER

    def test_fresh_cell_with_static_scene_is_skipped(self) -> None:
        engine = TriggerEngine()
        engine.evaluate(ctx(cell_age_s=60.0, scene_distance=0.01))
        assert engine.reason_histogram[Suppression.SCENE_UNCHANGED] == 1


class TestBaselineTrigger:
    """The correction that clock-triggering got wrong."""

    def test_walking_is_throttled_by_geometry_not_the_clock(self) -> None:
        engine = TriggerEngine()
        captured = run(engine, speed=1.4, state=MotionState.WALKING, ticks=1200)
        effective_hz = captured / 60.0
        assert effective_hz < engine.config.capture_hz * 0.6
        assert Suppression.NO_BASELINE in engine.reason_histogram

    def test_baseline_is_stable_across_speeds(self) -> None:
        """The property triangulation needs: frame spacing should not swing with speed."""
        spacings = []
        for speed, state in [(1.4, MotionState.WALKING), (3.0, MotionState.WALKING)]:
            engine = TriggerEngine()
            captured = run(engine, speed=speed, state=state, ticks=1200)
            spacings.append(speed * 60.0 / captured)
        assert all(0.7 <= s <= 1.2 for s in spacings), spacings

    def test_rate_cap_binds_at_speed(self) -> None:
        engine = TriggerEngine()
        captured = run(engine, speed=8.0, state=MotionState.CYCLING, ticks=1200)
        assert captured == pytest.approx(240, abs=2)
        assert Suppression.RATE_LIMIT in engine.reason_histogram

    def test_rate_cap_and_baseline_ceiling_conflict_at_high_speed(self) -> None:
        """A real limit worth knowing: above ~16 m/s a 4 Hz cap cannot hold the 4 m ceiling."""
        config = TriggerConfig()
        spacing_at_cap = 16.0 / config.capture_hz
        assert spacing_at_cap >= config.max_baseline_m

    def test_first_capture_needs_no_baseline(self) -> None:
        engine = TriggerEngine()
        assert engine.evaluate(ctx()).capture

    def test_distance_uses_speed_not_noisy_fixes(self) -> None:
        """Position noise is metres; differencing fixes 0.05 s apart would be pure noise."""
        engine = TriggerEngine()
        engine.evaluate(ctx(timestamp_s=0.0, speed_mps=0.0, motion_state=MotionState.STATIONARY))
        for i in range(1, 60):
            engine.evaluate(
                ctx(
                    timestamp_s=i * 0.05,
                    speed_mps=0.0,
                    motion_state=MotionState.STATIONARY,
                    position_sigma_m=8.0,
                )
            )
        assert engine.captured_count == 0


class TestTriggerReasons:
    def test_novelty_outranks_scene_change(self) -> None:
        engine = TriggerEngine()
        decision = engine.evaluate(ctx(cell_age_s=None, scene_distance=0.0))
        assert decision.capture and decision.trigger == "novelty"

    def test_scene_change_fires_on_a_covered_cell(self) -> None:
        engine = TriggerEngine()
        engine.evaluate(ctx(timestamp_s=0.0))
        for i in range(1, 40):
            decision = engine.evaluate(
                ctx(timestamp_s=i * 0.5, cell_age_s=10.0, scene_distance=0.9)
            )
            if decision.capture:
                assert decision.trigger == "scene_change"
                return
        pytest.fail("scene change never fired")

    def test_burst_length_is_reported(self) -> None:
        engine = TriggerEngine(TriggerConfig(burst_length=5))
        assert engine.evaluate(ctx()).burst_length == 5


class TestCoverageIndex:
    def test_missing_cell_reads_as_uncovered(self) -> None:
        """Failing safe costs one upload; failing the other way costs weeks of coverage."""
        index = CoverageIndex()
        assert index.age_of("unknown", now_s=1000.0) is None
        assert index.priority_of("unknown") == 1.0

    def test_update_and_age(self) -> None:
        index = CoverageIndex()
        index.update(CoverageCell("c1", last_covered_s=100.0, observation_count=3, priority=2.5))
        assert index.age_of("c1", now_s=400.0) == pytest.approx(300.0)
        assert index.priority_of("c1") == 2.5
        assert len(index) == 1

    def test_never_covered_cell_has_no_age(self) -> None:
        cell = CoverageCell("c1", last_covered_s=None, observation_count=0)
        assert cell.age_at(now_s=999.0) is None


class TestGeometryHelpers:
    def test_overlap_falls_with_speed(self) -> None:
        fast = overlap_fraction(20.0, 4.0, 8.0)
        slow = overlap_fraction(2.0, 4.0, 8.0)
        assert slow > fast

    def test_required_rate_inverts_overlap(self) -> None:
        hz = required_capture_hz(8.0, 8.0, min_overlap=0.6)
        assert overlap_fraction(8.0, hz, 8.0) == pytest.approx(0.6, abs=1e-9)

    def test_baseline_requirement_grows_with_range_squared(self) -> None:
        near = baseline_for_depth_tolerance_m(5.0, 0.15)
        far = baseline_for_depth_tolerance_m(10.0, 0.15)
        assert far == pytest.approx(4.0 * near, rel=1e-9)

    def test_default_min_baseline_covers_kerb_range(self) -> None:
        """0.75 m must be enough for +/-0.15 m depth at 12 m, the far edge of kerb range."""
        assert baseline_for_depth_tolerance_m(12.0, 0.15) <= TriggerConfig().min_baseline_m

    def test_perceptual_distance_bounds(self) -> None:
        assert perceptual_distance(b"\x00" * 8, b"\x00" * 8) == 0.0
        assert perceptual_distance(b"\x00" * 8, b"\xff" * 8) == 1.0

    def test_perceptual_distance_rejects_mismatched_hashes(self) -> None:
        with pytest.raises(ValueError, match="lengths differ"):
            perceptual_distance(b"\x00" * 8, b"\x00" * 4)
        with pytest.raises(ValueError, match="empty"):
            perceptual_distance(b"", b"")

    def test_rejects_bad_parameters(self) -> None:
        with pytest.raises(ValueError):
            overlap_fraction(1.0, 0.0, 8.0)
        with pytest.raises(ValueError):
            required_capture_hz(1.0, 8.0, min_overlap=1.0)
        with pytest.raises(ValueError):
            baseline_for_depth_tolerance_m(0.0, 0.15)
