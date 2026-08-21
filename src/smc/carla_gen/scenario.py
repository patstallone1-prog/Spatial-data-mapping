"""CARLA runtime.

``carla`` is imported lazily and the module is usable without it, because everything worth
testing here — rig geometry, capture cadence, GNSS error, ground truth — is independent of the
simulator, and requiring a 20 GB Unreal build to run the unit tests would mean they stop being
run. :func:`carla_available` reports the truth rather than letting an ImportError surface from
somewhere confusing.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any

import numpy as np

from smc.carla_gen.gnss import PRESETS, Environment, GnssSimulator
from smc.carla_gen.sensors import CaptureSettings, StereoRig, default_rig

if TYPE_CHECKING:
    from smc.carla_gen.world import Corridor


def carla_available() -> bool:
    """Whether the CARLA Python API can be imported in this interpreter."""
    try:
        import carla  # noqa: F401
    except ImportError:
        return False
    return True


@dataclass(frozen=True, slots=True)
class CaptureFrame:
    """One captured frame and everything the ingest pipeline receives with it.

    Deliberately mirrors what the real client uploads: an image, a *noisy* position, a motion
    state, and a timestamp. The true pose is carried separately and must never be handed to the
    fusion engine — it exists only so the checker can score what the engine inferred.
    """

    frame_index: int
    timestamp_s: float
    camera_name: str
    image_path: str
    #: What the device reports — true position plus simulated GNSS error.
    reported_lat: float
    reported_lon: float
    #: What was actually true. Scoring only.
    true_lat: float
    true_lon: float
    true_heading_deg: float
    speed_mps: float
    gnss_error_m: float

    def to_ingest_record(self) -> dict[str, Any]:
        """The subset the engine is allowed to see."""
        return {
            "frame_index": self.frame_index,
            "timestamp_s": self.timestamp_s,
            "camera": self.camera_name,
            "image": self.image_path,
            "lat": self.reported_lat,
            "lon": self.reported_lon,
            "speed_mps": self.speed_mps,
        }


@dataclass(frozen=True, slots=True)
class DriveConfig:
    corridor: Corridor
    output_dir: Path
    rig: StereoRig = None  # type: ignore[assignment]
    capture: CaptureSettings = None  # type: ignore[assignment]
    environment: Environment = Environment.URBAN_CANYON
    target_speed_mps: float = 8.0
    #: Repeat passes over the same corridor. The corroboration claim needs more than one.
    passes: int = 1
    seed: int = 0

    def __post_init__(self) -> None:
        if self.rig is None:
            object.__setattr__(self, "rig", default_rig())
        if self.capture is None:
            object.__setattr__(self, "capture", CaptureSettings())
        if self.passes < 1:
            raise ValueError("passes must be at least 1")


def plan_capture_stations(config: DriveConfig) -> list[float]:
    """Stations at which frames will be captured, given speed and capture rate.

    Pure geometry, so the capture plan can be checked — including whether consecutive frames
    overlap enough for triangulation — without launching a simulator.
    """
    interval_s = 1.0 / config.capture.capture_hz
    step_m = config.target_speed_mps * interval_s
    if step_m <= 0:
        raise ValueError("target speed and capture rate must be positive")
    length = config.corridor.length_m
    return [float(s) for s in np.arange(0.0, length, step_m)]


def baseline_between_frames_m(config: DriveConfig) -> float:
    """Forward distance between consecutive captures — the multi-view triangulation baseline."""
    return config.target_speed_mps / config.capture.capture_hz


def simulate_drive(config: DriveConfig) -> list[CaptureFrame]:
    """Generate the capture record for a drive without rendering.

    Produces exactly the frame metadata a real drive would, including realistic GNSS error, so
    association, anchoring, and fusion logic can be exercised end to end while the renderer is
    still being set up. Image paths are populated only when :func:`render_drive` has run.
    """
    stations = plan_capture_stations(config)
    frames: list[CaptureFrame] = []
    interval_s = 1.0 / config.capture.capture_hz

    for pass_index in range(config.passes):
        gnss = GnssSimulator(
            PRESETS[config.environment],
            np.random.default_rng(config.seed + 1000 * pass_index),
        )
        for i, station in enumerate(stations):
            error = gnss.step(interval_s)
            true_lat, true_lon = config.corridor.position_at(station, lateral_m=-6.0)
            reported_lat, reported_lon = config.corridor.position_at(
                station + error[1], lateral_m=-6.0 + error[0]
            )
            for camera in (config.rig.left, config.rig.right):
                frames.append(
                    CaptureFrame(
                        frame_index=len(frames),
                        timestamp_s=pass_index * 1e4 + i * interval_s,
                        camera_name=camera.name,
                        image_path="",
                        reported_lat=reported_lat,
                        reported_lon=reported_lon,
                        true_lat=true_lat,
                        true_lon=true_lon,
                        true_heading_deg=90.0,
                        speed_mps=config.target_speed_mps,
                        gnss_error_m=float(np.hypot(error[0], error[1])),
                    )
                )
    return frames


def write_manifest(frames: list[CaptureFrame], path: Path) -> Path:
    """Write the ingest manifest — engine-visible fields only.

    The true pose is written to a sibling file, not this one. Keeping them in separate files is
    the cheapest possible guard against truth leaking into the pipeline through a careless
    ``**record``.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps([f.to_ingest_record() for f in frames], indent=2) + "\n"
    )
    truth_path = path.with_name(path.stem + ".truth.json")
    truth_path.write_text(
        json.dumps(
            [
                {
                    "frame_index": f.frame_index,
                    "true_lat": f.true_lat,
                    "true_lon": f.true_lon,
                    "true_heading_deg": f.true_heading_deg,
                    "gnss_error_m": f.gnss_error_m,
                }
                for f in frames
            ],
            indent=2,
        )
        + "\n"
    )
    return path


def render_drive(config: DriveConfig) -> list[CaptureFrame]:  # pragma: no cover - needs CARLA
    """Run the drive in CARLA and write images.

    Requires a running CARLA server and the corridor's props imported into the map; see
    docs/05-carla-harness.md for the asset pipeline, which is not optional because CARLA
    hard-codes sidewalk height in OpenDRIVE standalone mode.
    """
    if not carla_available():
        raise RuntimeError(
            "the CARLA Python API is not importable; install the matching client with "
            "`pip install carla` or use simulate_drive() for a render-free capture record"
        )
    raise NotImplementedError(
        "render_drive requires the corridor prop package; see docs/05-carla-harness.md"
    )
