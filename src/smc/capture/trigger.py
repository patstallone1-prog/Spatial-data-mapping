"""The capture trigger.

Never stream. Open the shutter only when a frame is likely to be worth its upload, its battery,
and its privacy cost. Three signals gate it, and the same logic runs on the vehicle rig and on
the glasses — the hardware differs, the question does not.

The speed band is the clearest case of that shared logic. A wearer at 35 m/s is in a vehicle and
is filming a dashboard; a rig at 35 m/s is filming a motion-blurred smear. Both are worthless,
for different reasons, and both are excluded by one rule. Below the band the wearer is standing
still and re-photographing a scene already captured.

Every decision carries the reason it was made. A trigger that silently declines is
undebuggable in the field, and the reason distribution over a drive is itself the diagnostic
that says whether the capture policy is working.
"""

from __future__ import annotations

import enum
import math
from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Mapping


class MotionState(enum.StrEnum):
    """Straight from the OS activity classifier — not reimplemented.

    iOS ``CMMotionActivityManager`` and Android's Activity Recognition Transition API both
    supply this, tuned and power-optimised by the platform. Writing a classifier here would be
    strictly worse and would run the accelerometer hot.
    """

    STATIONARY = "stationary"
    WALKING = "walking"
    RUNNING = "running"
    CYCLING = "cycling"
    VEHICLE = "vehicle"
    UNKNOWN = "unknown"


class Suppression(enum.StrEnum):
    """Why a frame was not taken. Ordered by how early the check runs."""

    NONE = "none"
    POWER = "power"
    THERMAL = "thermal"
    STORAGE = "storage"
    MOTION_STATE = "motion_state"
    TOO_SLOW = "too_slow"
    TOO_FAST = "too_fast"
    RATE_LIMIT = "rate_limit"
    NO_BASELINE = "no_baseline"
    NO_NOVELTY = "no_novelty"
    SCENE_UNCHANGED = "scene_unchanged"
    POOR_FIX = "poor_fix"
    PRIVACY_ZONE = "privacy_zone"


@dataclass(frozen=True, slots=True)
class TriggerConfig:
    """Thresholds. Deliberately explicit — every one of these is a battery/coverage trade."""

    #: Ceiling on capture rate, set by battery and thermal budget rather than by geometry.
    capture_hz: float = 4.0
    #: Minimum distance travelled since the last capture.
    #:
    #: This, not the clock, is what triangulation actually needs. A clock-triggered wearer at
    #: 1.4 m/s and 4 Hz puts consecutive frames 0.35 m apart: 98% overlap, and a baseline far
    #: too short to recover depth at kerb range. A distance trigger holds the baseline constant
    #: across walking, cycling, and driving, which is the property multi-view depends on — and
    #: it saves the battery precisely when the wearer is slow and the frames are redundant.
    min_baseline_m: float = 0.75
    #: Above this, viewpoint change starts to break feature matching. Forces a capture.
    max_baseline_m: float = 4.0
    #: Speed band. Below: redundant frames. Above: a vehicle interior, or motion blur.
    min_speed_mps: float = 0.4
    max_speed_mps: float = 22.0
    #: Motion states that may ever trigger capture.
    allowed_states: frozenset[MotionState] = frozenset(
        {MotionState.WALKING, MotionState.RUNNING, MotionState.CYCLING}
    )
    #: Cell staleness beyond which a cell is worth re-shooting, in seconds.
    stale_after_s: float = 30 * 24 * 3600.0
    #: Perceptual distance from the last capture below which the scene counts as unchanged.
    scene_change_threshold: float = 0.18
    #: A fix worse than this cannot be anchored usefully even after refinement.
    max_position_sigma_m: float = 25.0
    min_battery_fraction: float = 0.20
    max_device_temp_c: float = 42.0
    min_free_storage_mb: float = 250.0
    #: Frames captured back-to-back within a burst, once a trigger fires.
    burst_length: int = 3


@dataclass(frozen=True, slots=True)
class CaptureContext:
    """Everything the trigger sees at one instant."""

    timestamp_s: float
    motion_state: MotionState
    speed_mps: float
    lat: float
    lon: float
    position_sigma_m: float
    #: H3 cell at the working resolution; supplied by the platform layer.
    cell_id: str
    #: Seconds since this cell was last covered, or ``None`` if never.
    cell_age_s: float | None
    #: Perceptual distance from the last captured frame, 0 (identical) to 1 (unrelated).
    scene_distance: float
    battery_fraction: float = 1.0
    device_temp_c: float = 25.0
    free_storage_mb: float = 10_000.0
    in_privacy_zone: bool = False


@dataclass(frozen=True, slots=True)
class CaptureDecision:
    capture: bool
    reason: Suppression
    burst_length: int = 0
    #: Why it fired, for coverage accounting: "novelty" | "scene_change".
    trigger: str | None = None

    @property
    def suppressed(self) -> bool:
        return not self.capture


class TriggerEngine:
    """Stateful evaluator. One per capture session.

    Ordering is load-bearing. Device-health checks run before anything that costs sensor work,
    the speed band before novelty (a cheap scalar before a cell lookup), and the rate limit
    before scene comparison (which needs the previous frame's embedding).
    """

    def __init__(self, config: TriggerConfig | None = None) -> None:
        self._config = config or TriggerConfig()
        self._last_capture_s: float | None = None
        self._distance_since_capture_m: float = 0.0
        self._last_seen_s: float | None = None
        self._reasons: dict[Suppression, int] = {}
        self._captured = 0

    @property
    def config(self) -> TriggerConfig:
        return self._config

    @property
    def captured_count(self) -> int:
        return self._captured

    @property
    def reason_histogram(self) -> Mapping[Suppression, int]:
        """Why frames were skipped, over the session. The field diagnostic."""
        return dict(self._reasons)

    def evaluate(self, ctx: CaptureContext) -> CaptureDecision:
        self._accumulate_distance(ctx)
        decision = self._evaluate(ctx)
        if decision.capture:
            self._last_capture_s = ctx.timestamp_s
            self._distance_since_capture_m = 0.0
            self._captured += 1
        else:
            self._reasons[decision.reason] = self._reasons.get(decision.reason, 0) + 1
        return decision

    def _accumulate_distance(self, ctx: CaptureContext) -> None:
        """Dead-reckon distance from speed.

        Speed is used rather than successive GNSS positions on purpose: at 5 m of position
        noise, differencing two fixes 0.25 s apart yields a distance estimate dominated
        entirely by noise, and would fire the baseline trigger at random while standing still.
        """
        if self._last_seen_s is not None:
            dt = ctx.timestamp_s - self._last_seen_s
            if 0.0 < dt < 5.0:
                self._distance_since_capture_m += ctx.speed_mps * dt
        self._last_seen_s = ctx.timestamp_s

    def _evaluate(self, ctx: CaptureContext) -> CaptureDecision:
        cfg = self._config

        if ctx.in_privacy_zone:
            return CaptureDecision(False, Suppression.PRIVACY_ZONE)
        if ctx.battery_fraction < cfg.min_battery_fraction:
            return CaptureDecision(False, Suppression.POWER)
        if ctx.device_temp_c > cfg.max_device_temp_c:
            return CaptureDecision(False, Suppression.THERMAL)
        if ctx.free_storage_mb < cfg.min_free_storage_mb:
            return CaptureDecision(False, Suppression.STORAGE)

        if ctx.motion_state not in cfg.allowed_states:
            return CaptureDecision(False, Suppression.MOTION_STATE)
        if ctx.speed_mps < cfg.min_speed_mps:
            return CaptureDecision(False, Suppression.TOO_SLOW)
        if ctx.speed_mps > cfg.max_speed_mps:
            return CaptureDecision(False, Suppression.TOO_FAST)

        if ctx.position_sigma_m > cfg.max_position_sigma_m:
            return CaptureDecision(False, Suppression.POOR_FIX)

        first_capture = self._last_capture_s is None
        if not first_capture:
            elapsed = ctx.timestamp_s - self._last_capture_s  # type: ignore[operator]
            if elapsed < (1.0 / cfg.capture_hz) - 1e-9:
                return CaptureDecision(False, Suppression.RATE_LIMIT)

        # Once the viewpoint has moved far enough that matching would start to fail, take the
        # frame regardless of novelty or scene change — a gap here breaks the whole sequence.
        if not first_capture and self._distance_since_capture_m >= cfg.max_baseline_m:
            return CaptureDecision(True, Suppression.NONE, cfg.burst_length, "max_baseline")

        if not first_capture and self._distance_since_capture_m < cfg.min_baseline_m:
            return CaptureDecision(False, Suppression.NO_BASELINE)

        # Novelty is the highest-value trigger: an uncovered or stale cell is worth a frame
        # even if the view looks like the last one.
        novel = ctx.cell_age_s is None or ctx.cell_age_s > cfg.stale_after_s
        if novel:
            return CaptureDecision(True, Suppression.NONE, cfg.burst_length, "novelty")

        if ctx.scene_distance >= cfg.scene_change_threshold:
            return CaptureDecision(True, Suppression.NONE, cfg.burst_length, "scene_change")

        return CaptureDecision(False, Suppression.SCENE_UNCHANGED)


@dataclass(frozen=True, slots=True)
class CoverageCell:
    """Server-pushed coverage state for one H3 cell.

    The novelty trigger cannot be evaluated on-device without this: a wearer has no way to know
    a cell is stale. It is the feedback loop from the fusion engine back to capture, and it is
    what lets coverage be steered toward the corridors that are worth money.
    """

    cell_id: str
    last_covered_s: float | None
    observation_count: int
    #: Set by the server for corridors a partner is paying for.
    priority: float = 1.0

    def age_at(self, now_s: float) -> float | None:
        return None if self.last_covered_s is None else now_s - self.last_covered_s


class CoverageIndex:
    """Local mirror of the server's coverage bitmap.

    Small enough to hold a city at working resolution and to refresh over a metered link. A
    miss is treated as *uncovered*, not as an error: capturing a frame that turns out to be
    redundant costs one upload, while skipping a genuinely uncovered cell costs coverage that
    may not come round again for weeks.
    """

    def __init__(self, cells: Mapping[str, CoverageCell] | None = None) -> None:
        self._cells: dict[str, CoverageCell] = dict(cells or {})

    def __len__(self) -> int:
        return len(self._cells)

    def update(self, cell: CoverageCell) -> None:
        self._cells[cell.cell_id] = cell

    def age_of(self, cell_id: str, now_s: float) -> float | None:
        cell = self._cells.get(cell_id)
        return None if cell is None else cell.age_at(now_s)

    def priority_of(self, cell_id: str) -> float:
        cell = self._cells.get(cell_id)
        return cell.priority if cell else 1.0


def perceptual_distance(a: bytes, b: bytes) -> float:
    """Normalised Hamming distance between two perceptual hashes.

    A hash rather than a learned embedding on purpose: this runs on every frame the camera
    produces, including the ones that will be discarded, so it has to be nearly free. The
    embedding comparison that matters happens in the cloud, on frames that survived.
    """
    if len(a) != len(b):
        raise ValueError(f"hash lengths differ: {len(a)} vs {len(b)}")
    if not a:
        raise ValueError("empty hash")
    bits = sum(bin(x ^ y).count("1") for x, y in zip(a, b, strict=True))
    return bits / (len(a) * 8)


def overlap_fraction(
    speed_mps: float, capture_hz: float, range_m: float, fov_deg: float = 90.0
) -> float:
    """Fraction of the frame footprint shared by consecutive captures.

    Multi-view triangulation needs a feature in two or three overlapping views, so the capture
    rate is not a free parameter — it is set by how fast the wearer moves and how far away the
    subject is. Below roughly 0.5 the sequence stops being a stereo sequence at all.
    """
    if capture_hz <= 0 or range_m <= 0:
        raise ValueError("capture_hz and range_m must be positive")
    footprint_m = 2.0 * range_m * math.tan(math.radians(fov_deg) / 2.0)
    advance_m = speed_mps / capture_hz
    return max(0.0, 1.0 - advance_m / footprint_m)


def baseline_for_depth_tolerance_m(
    range_m: float, tolerance_m: float, focal_px: float = 960.0, match_error_px: float = 0.5
) -> float:
    """Baseline needed to resolve depth at ``range_m`` to ``tolerance_m``.

    The same Z^2 * sigma / (f * b) relation that governs the vehicle rig's rigid stereo, applied
    to the motion baseline. It is what sets :attr:`TriggerConfig.min_baseline_m`.
    """
    if range_m <= 0 or tolerance_m <= 0:
        raise ValueError("range_m and tolerance_m must be positive")
    return (range_m**2 * match_error_px) / (focal_px * tolerance_m)


def required_capture_hz(
    speed_mps: float, range_m: float, min_overlap: float = 0.6, fov_deg: float = 90.0
) -> float:
    """Capture rate needed to hold a minimum overlap. The inverse of :func:`overlap_fraction`."""
    if not 0.0 <= min_overlap < 1.0:
        raise ValueError("min_overlap must be in [0, 1)")
    footprint_m = 2.0 * range_m * math.tan(math.radians(fov_deg) / 2.0)
    return speed_mps / (footprint_m * (1.0 - min_overlap))
