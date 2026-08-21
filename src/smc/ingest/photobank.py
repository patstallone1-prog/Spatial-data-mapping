"""A photo bank matching what a phone app actually receives from Meta glasses.

The conventions here are the delivered ones, not the sensor's, and the gap is large enough to
change what the product can claim:

* The Ray-Ban Meta camera is a 12 MP ultrawide that shoots 3024x4032 stills. **Developers do not
  get that.** Through the Wearables Device Access Toolkit the video stream is capped at
  **720p / 30 fps**, a limit attributed to Bluetooth, and photo capture during streaming is
  limited to **1440x1080**.
* So the working resolution is roughly a *twelfth* of the sensor's pixel count, in 4:3.

That ratio propagates straight into measurement accuracy. Angular resolution sets how finely a
kerb edge can be localised at range, and generating a photo bank at sensor resolution would
quietly overstate every downstream number. Everything here is generated at delivered resolution
for that reason.

The wearer viewpoint differs from the vehicle rig in two ways that matter as much as the
resolution: eye height rather than dash height, and *on the footway* rather than out in the
carriageway. A wearer is one to three metres from the kerb, not eight to twelve — which is why
camera-height scale calibration is sufficient for them and not for the rig.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

import numpy as np

from smc import geo
from smc.capture.gait import GaitConfig, GaitSimulator
from smc.capture.trigger import CaptureContext, MotionState, TriggerEngine
from smc.carla_gen.gnss import PRESETS, Environment, GnssSimulator
from smc.ingest.store import FrameRecord, LocalFrameStore, content_id
from smc.mapping.pose import Pose, intrinsics
from smc.render.png import encode_png
from smc.render.raster import RenderResult, corridor_triangles, render_meshes


@dataclass(frozen=True, slots=True)
class GlassesProfile:
    """Delivered camera characteristics for Meta AI glasses via the DAT.

    ``fov_deg`` is **[UNVERIFIED]**. The camera is described as ultrawide but Meta does not
    publish the field of view of the delivered 4:3 crop, and the number materially affects
    scale and depth. Measure it against a real device with a known target before any accuracy
    figure derived from this bank is quoted.
    """

    name: str = "ray-ban-meta-gen2"
    #: Photo capture during streaming, per the toolkit's documented limit.
    photo_width: int = 1440
    photo_height: int = 1080
    #: Video stream ceiling: 720p at 30 fps, attributed to the Bluetooth link.
    stream_width: int = 1280
    stream_height: int = 720
    stream_fps: float = 30.0
    fov_deg: float = 100.0
    #: Wearer eye height. Calibrate per contributor; a population mean is the fallback.
    eye_height_m: float = 1.60
    #: Lateral position on the footway, measured from the kerb line.
    footway_offset_m: float = 1.10

    def intrinsics(self, *, stream: bool = False) -> np.ndarray:
        width = self.stream_width if stream else self.photo_width
        height = self.stream_height if stream else self.photo_height
        focal = width / (2.0 * np.tan(np.radians(self.fov_deg) / 2.0))
        return intrinsics(float(focal), width / 2.0, height / 2.0)

    def resolution(self, *, stream: bool = False) -> tuple[int, int]:
        return (
            (self.stream_width, self.stream_height)
            if stream
            else (self.photo_width, self.photo_height)
        )

    @property
    def megapixels_delivered(self) -> float:
        return self.photo_width * self.photo_height / 1e6

    @property
    def megapixels_sensor(self) -> float:
        """What the hardware captures, for the ratio that matters."""
        return 3024 * 4032 / 1e6


@dataclass(frozen=True, slots=True)
class BankFrame:
    """A banked capture.

    ``render`` and the ``true_*`` fields are simulation-only and must never reach the engine;
    they exist so the checker can score what was inferred. Only ``record`` is engine-visible.
    """

    record: FrameRecord
    render: RenderResult
    true_pose: Pose
    true_lat: float
    true_lon: float
    speed_mps: float
    trigger: str


def wearer_pose(station_m: float, profile: GlassesProfile, heading_jitter_deg: float = 0.0) -> Pose:
    """Where a walking wearer's camera is, and where it points.

    A wearer looks roughly along the footway with the head yawing constantly. The jitter is not
    decoration: a fixed gaze would give every frame near-identical geometry, and the retrieval
    and matching stages would look far more reliable than they are.
    """
    eye = np.array([station_m, profile.footway_offset_m, profile.eye_height_m])
    yaw = np.radians(heading_jitter_deg)
    ahead = 12.0
    # Gaze is roughly along the footway and slightly down, which is how people walk. It is not
    # aimed at the kerb: a wearer is not a survey instrument, and a large fraction of every
    # frame is sky and shopfront. That is a genuine limitation of the wearer vantage against a
    # purpose-aimed rig, so the bank reproduces it rather than framing it away.
    target = np.array(
        [
            station_m + ahead * np.cos(yaw),
            profile.footway_offset_m + ahead * np.sin(yaw) - 0.4,
            profile.eye_height_m * 0.45,
        ]
    )
    return Pose.look_at(eye, target)


def build_photo_bank(
    corridor: object,
    store: LocalFrameStore,
    *,
    contributor_id: str,
    profile: GlassesProfile | None = None,
    stream: bool = False,
    environment: Environment = Environment.URBAN_CANYON,
    gait: GaitConfig | None = None,
    seed: int = 0,
    max_frames: int = 400,
    started_at: datetime | None = None,
) -> list[BankFrame]:
    """Walk a contributor down the corridor and bank what the glasses would deliver.

    Pace varies (see :mod:`smc.capture.gait`) and the real capture trigger decides every frame,
    so the bank has the *distribution* a real contributor produces — including the gaps where
    they stopped at a crossing — rather than an evenly spaced ideal.
    """
    profile = profile or GlassesProfile()
    started_at = started_at or datetime.now(UTC)
    width, height = profile.resolution(stream=stream)
    k = profile.intrinsics(stream=stream)

    gait_sim = GaitSimulator(gait or GaitConfig(), np.random.default_rng(seed))
    gnss = GnssSimulator(PRESETS[environment], np.random.default_rng(seed + 1))
    trigger = TriggerEngine()
    rng = np.random.default_rng(seed + 2)

    triangles, colours = corridor_triangles(corridor)
    length = float(getattr(corridor, "length_m", 100.0))
    origin: geo.Origin = corridor.origin  # type: ignore[attr-defined]

    dt = 0.05
    station = 0.0
    elapsed = 0.0
    accepted: list[tuple[float, float, float, str]] = []

    while station < length - 15.0 and len(accepted) < max_frames:
        speed = gait_sim.step(dt)
        error = gnss.step(dt)
        sigma = float(np.hypot(error[0], error[1]))
        lat, lon = corridor.position_at(station, lateral_m=profile.footway_offset_m)  # type: ignore[attr-defined]
        decision = trigger.evaluate(
            CaptureContext(
                timestamp_s=elapsed,
                motion_state=MotionState.STATIONARY if speed < 0.15 else MotionState.WALKING,
                speed_mps=speed,
                lat=lat,
                lon=lon,
                position_sigma_m=sigma,
                cell_id=f"cell-{int(station // 25)}",
                cell_age_s=None,
                scene_distance=0.5,
            )
        )
        if decision.capture:
            accepted.append((station, sigma, speed, decision.trigger or "novelty"))
        station += speed * dt
        elapsed += dt

    frames: list[BankFrame] = []
    for i, (at_station, sigma, speed, trigger_reason) in enumerate(accepted):
        pose = wearer_pose(at_station, profile, float(rng.normal(0.0, 12.0)))
        render = render_meshes(triangles, colours, pose, k, width, height)
        payload = encode_png(render.image)
        frame_id = content_id(payload)

        true_lat, true_lon = corridor.position_at(  # type: ignore[attr-defined]
            at_station, lateral_m=profile.footway_offset_m
        )
        east, north = geo.geodetic_to_enu(origin, true_lat, true_lon)
        offset = np.random.default_rng(seed + 1000 + i).normal(0.0, sigma / np.sqrt(2.0), 2)
        reported_lat, reported_lon = geo.enu_to_geodetic(
            origin, east + offset[0], north + offset[1]
        )

        record = FrameRecord(
            frame_id=frame_id,
            contributor_id=contributor_id,
            captured_at=started_at + timedelta(seconds=i * 0.6),
            lat=reported_lat,
            lon=reported_lon,
            position_sigma_m=sigma,
            camera=f"{profile.name}:{'stream' if stream else 'photo'}",
            focal_px=float(k[0, 0]),
            width=width,
            height=height,
            size_bytes=len(payload),
            cell_id=f"cell-{int(at_station // 25)}",
            trigger=trigger_reason,
            redacted=True,
        )
        store.put(payload, record)
        frames.append(
            BankFrame(
                record=record,
                render=render,
                true_pose=pose,
                true_lat=true_lat,
                true_lon=true_lon,
                speed_mps=speed,
                trigger=trigger_reason,
            )
        )

    return frames


def bank_summary(frames: list[BankFrame], store: LocalFrameStore) -> dict[str, object]:
    speeds = np.array([f.speed_mps for f in frames])
    return {
        "frames": len(frames),
        "megabytes": round(store.total_bytes() / 1e6, 2),
        "resolution": f"{frames[0].record.width}x{frames[0].record.height}" if frames else "-",
        "speed_mean_mps": round(float(speeds.mean()), 3) if len(speeds) else 0.0,
        "speed_sd_mps": round(float(speeds.std()), 3) if len(speeds) else 0.0,
        "unique_frames": len({f.record.frame_id for f in frames}),
    }


def export_contact_sheet(frames: list[BankFrame], store: LocalFrameStore, path: Path) -> Path:
    """Tile a sample of the bank into one image, for eyeballing what was captured."""
    import zlib  # noqa: F401 - keeps the PNG dependency explicit at the call site

    from smc.render.png import write_png

    sample = frames[:: max(1, len(frames) // 12)][:12]
    if not sample:
        raise ValueError("no frames to tile")
    tile_w, tile_h = 240, 180
    sheet = np.full((tile_h * 3, tile_w * 4, 3), 24, dtype=np.uint8)
    for i, frame in enumerate(sample):
        raw = store.get(frame.record.frame_id)
        image = _decode_png(raw)
        step_y = max(1, image.shape[0] // tile_h)
        step_x = max(1, image.shape[1] // tile_w)
        thumb = image[::step_y, ::step_x][:tile_h, :tile_w]
        row, col = divmod(i, 4)
        sheet[
            row * tile_h : row * tile_h + thumb.shape[0],
            col * tile_w : col * tile_w + thumb.shape[1],
        ] = thumb
    return write_png(sheet, path)


def _decode_png(payload: bytes) -> np.ndarray:
    """Minimal decoder for the images this project writes (filter 0, 8-bit RGB)."""
    import struct
    import zlib

    width, height = struct.unpack(">II", payload[16:24])
    idat = b""
    cursor = 8
    while cursor < len(payload):
        length = struct.unpack(">I", payload[cursor : cursor + 4])[0]
        tag = payload[cursor + 4 : cursor + 8]
        if tag == b"IDAT":
            idat += payload[cursor + 8 : cursor + 8 + length]
        cursor += 12 + length
    raw = zlib.decompress(idat)
    stride = width * 3 + 1
    rows = [raw[i * stride + 1 : (i + 1) * stride] for i in range(height)]
    return np.frombuffer(b"".join(rows), dtype=np.uint8).reshape(height, width, 3)
