"""Sensor rig definitions.

The rig mirrors the physical Tier 2 vehicle rig in docs/04-capture-rig-and-simulation.md, not
some idealised sensor: same resolution, same field of view, same stereo baseline, same mount
height. If the simulated camera is more capable than the one being built, every gate passed in
simulation is worthless.

One honest limitation: CARLA renders each frame instantaneously, so it cannot reproduce rolling
shutter. The simulator therefore cannot demonstrate why global shutter was chosen — that
argument has to be settled on real hardware. What the sim *can* do is verify that the pipeline
is correct given clean frames, which is a different and smaller claim.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class CameraSpec:
    """Intrinsics and mounting for one camera, matching Arducam AR0234 on the vehicle rig."""

    name: str
    width: int = 1920
    height: int = 1200
    fov_deg: float = 90.0
    #: Mount offsets in the vehicle frame, metres: +x forward, +y right, +z up.
    x_m: float = 0.9
    y_m: float = 0.0
    z_m: float = 1.30
    pitch_deg: float = -8.0
    yaw_deg: float = 0.0
    roll_deg: float = 0.0

    @property
    def focal_px(self) -> float:
        """Pinhole focal length in pixels — needed by every metric-depth conversion."""
        import math

        return self.width / (2.0 * math.tan(math.radians(self.fov_deg) / 2.0))

    @property
    def principal_point(self) -> tuple[float, float]:
        return (self.width / 2.0, self.height / 2.0)


@dataclass(frozen=True, slots=True)
class StereoRig:
    """A synchronised pair on a rigid baseline — the rig's source of metric scale.

    Depth resolution degrades with the square of range: at range Z the depth uncertainty for a
    disparity error of one pixel is Z^2 / (focal_px * baseline). :meth:`depth_uncertainty_m`
    makes that explicit so a claimed Tier B tolerance can be checked against the geometry
    rather than assumed.
    """

    left: CameraSpec
    right: CameraSpec
    baseline_m: float = 0.20

    def depth_uncertainty_m(self, range_m: float, disparity_error_px: float = 0.5) -> float:
        if range_m <= 0:
            raise ValueError("range_m must be positive")
        return (range_m**2 * disparity_error_px) / (self.left.focal_px * self.baseline_m)

    def max_range_for_tolerance_m(
        self, tolerance_m: float, disparity_error_px: float = 0.5
    ) -> float:
        """Range beyond which stereo can no longer meet a depth tolerance."""
        if tolerance_m <= 0:
            raise ValueError("tolerance_m must be positive")
        return (tolerance_m * self.left.focal_px * self.baseline_m / disparity_error_px) ** 0.5


def default_rig() -> StereoRig:
    return StereoRig(
        left=CameraSpec(name="cam_left", y_m=-0.10),
        right=CameraSpec(name="cam_right", y_m=0.10),
        baseline_m=0.20,
    )


@dataclass(frozen=True, slots=True)
class CaptureSettings:
    """Simulation timing. Matches the capture rate the re-spec targets (3-5 fps bursts)."""

    fixed_delta_seconds: float = 0.05  # 20 Hz simulation
    capture_hz: float = 4.0
    #: Suppress capture outside this speed band, mirroring the Layer A motion trigger.
    min_speed_mps: float = 1.0
    max_speed_mps: float = 22.0

    @property
    def capture_every_n_ticks(self) -> int:
        return max(1, round(1.0 / (self.capture_hz * self.fixed_delta_seconds)))
