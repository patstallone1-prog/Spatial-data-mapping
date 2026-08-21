"""Simulated capture runs.

Two kinds of pass, mirroring the two hardware tiers:

* :func:`survey_pass` — the RTK vehicle rig. Centimetre poses, metric stereo. Its output seeds
  the reference index.
* :func:`contributor_pass` — an ordinary monocular contributor with phone-grade GNSS, running
  the real capture trigger. Its output is what the fusion engine has to make sense of.

The split is the whole architecture in miniature: one surveyed pass makes many unsurveyed
passes usable.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import numpy as np

from smc import geo
from smc.capture.trigger import CaptureContext, MotionState, TriggerEngine
from smc.carla_gen.gnss import PRESETS, Environment, GnssSimulator
from smc.ingest.store import FrameRecord, LocalFrameStore, content_id
from smc.mapping.pose import Pose, intrinsics
from smc.render.png import encode_png
from smc.render.raster import RenderResult, corridor_triangles, render_meshes


@dataclass(frozen=True, slots=True)
class RigConfig:
    """Camera and driving parameters for a pass."""

    width: int = 640
    height: int = 400
    focal_px: float = 480.0
    #: Lateral offset from the kerb line. Negative is out in the roadway.
    lateral_m: float = -4.2
    height_m: float = 1.30
    #: How far ahead the camera looks, and how far toward the kerb.
    look_ahead_m: float = 40.0
    look_lateral_m: float = 1.0
    speed_mps: float = 8.0
    spacing_m: float = 2.0

    @property
    def intrinsics(self) -> np.ndarray:
        return intrinsics(self.focal_px, self.width / 2.0, self.height / 2.0)


def pose_at_station(station_m: float, config: RigConfig) -> Pose:
    """The camera pose at a station along the corridor."""
    eye = np.array([station_m, config.lateral_m, config.height_m])
    target = np.array(
        [station_m + config.look_ahead_m, config.look_lateral_m, config.height_m * 0.8]
    )
    return Pose.look_at(eye, target)


def _render_stations(
    corridor: object, stations: list[float], config: RigConfig
) -> list[tuple[float, Pose, RenderResult]]:
    """Render once per station, reusing the flattened scene across the whole pass."""
    triangles, colours = corridor_triangles(corridor)
    out: list[tuple[float, Pose, RenderResult]] = []
    for station in stations:
        pose = pose_at_station(station, config)
        render = render_meshes(
            triangles, colours, pose, config.intrinsics, config.width, config.height
        )
        out.append((station, pose, render))
    return out


def survey_pass(
    corridor: object, config: RigConfig | None = None
) -> list[tuple[str, RenderResult, Pose]]:
    """Drive the RTK rig down the corridor at fixed spacing.

    Fixed spacing rather than the capture trigger: a survey pass is not opportunistic. It is
    driven deliberately, once, to produce even coverage, and it is the one pass that is worth
    spending time and fuel on.
    """
    config = config or RigConfig()
    length = float(getattr(corridor, "length_m", 100.0))
    stations = [float(s) for s in np.arange(0.0, max(length - config.look_ahead_m, 1.0),
                                            config.spacing_m)]
    return [
        (f"survey-{i:05d}", render, pose)
        for i, (_, pose, render) in enumerate(_render_stations(corridor, stations, config))
    ]


@dataclass(frozen=True, slots=True)
class ContributorFrame:
    """One stored contributor capture, with the truth kept separate for scoring."""

    record: FrameRecord
    render: RenderResult
    true_pose: Pose
    true_lat: float
    true_lon: float
    gnss_error_m: float


def contributor_pass(
    corridor: object,
    store: LocalFrameStore,
    *,
    contributor_id: str,
    config: RigConfig | None = None,
    environment: Environment = Environment.URBAN_CANYON,
    started_at: datetime | None = None,
    seed: int = 0,
) -> list[ContributorFrame]:
    """Drive a monocular contributor down the corridor, through the real capture trigger.

    Frames the trigger rejects are never rendered or stored — the same asymmetry as on device,
    where evaluation must be nearly free and only survivors cost anything.
    """
    config = config or RigConfig()
    origin: geo.Origin = corridor.origin  # type: ignore[attr-defined]
    started_at = started_at or datetime.now(UTC)
    gnss = GnssSimulator(PRESETS[environment], np.random.default_rng(seed))
    trigger = TriggerEngine()

    length = float(getattr(corridor, "length_m", 100.0))
    step_s = 0.05
    accepted_stations: list[tuple[float, float]] = []
    station = 0.0
    elapsed = 0.0

    while station < max(length - config.look_ahead_m, 1.0):
        error = gnss.step(step_s)
        lat, lon = corridor.position_at(station, lateral_m=config.lateral_m)  # type: ignore[attr-defined]
        decision = trigger.evaluate(
            CaptureContext(
                timestamp_s=elapsed,
                motion_state=MotionState.CYCLING,
                speed_mps=config.speed_mps,
                lat=lat,
                lon=lon,
                position_sigma_m=float(np.hypot(error[0], error[1])),
                cell_id=f"cell-{int(station // 25)}",
                cell_age_s=None,
                scene_distance=0.5,
            )
        )
        if decision.capture:
            accepted_stations.append((station, float(np.hypot(error[0], error[1]))))
        station += config.speed_mps * step_s
        elapsed += step_s

    rendered = _render_stations(corridor, [s for s, _ in accepted_stations], config)
    frames: list[ContributorFrame] = []

    for i, ((station, sigma), (_, pose, render)) in enumerate(
        zip(accepted_stations, rendered, strict=True)
    ):
        payload = encode_png(render.image)
        frame_id = content_id(payload)
        true_lat, true_lon = corridor.position_at(station, lateral_m=config.lateral_m)  # type: ignore[attr-defined]
        # What the device reports: the truth displaced by its own GNSS error.
        east, north = geo.geodetic_to_enu(origin, true_lat, true_lon)
        offset = np.random.default_rng(seed + i).normal(0.0, sigma / np.sqrt(2.0), 2)
        reported_lat, reported_lon = geo.enu_to_geodetic(
            origin, east + offset[0], north + offset[1]
        )

        record = FrameRecord(
            frame_id=frame_id,
            contributor_id=contributor_id,
            captured_at=started_at + timedelta(seconds=i * config.spacing_m / config.speed_mps),
            lat=reported_lat,
            lon=reported_lon,
            position_sigma_m=sigma,
            camera="cam_mono",
            focal_px=config.focal_px,
            width=config.width,
            height=config.height,
            size_bytes=len(payload),
            cell_id=f"cell-{int(station // 25)}",
            trigger=decision.trigger or "novelty",
            redacted=True,
        )
        store.put(payload, record)
        frames.append(
            ContributorFrame(
                record=record,
                render=render,
                true_pose=pose,
                true_lat=true_lat,
                true_lon=true_lon,
                gnss_error_m=geo.distance_m(reported_lat, reported_lon, true_lat, true_lon),
            )
        )

    return frames
