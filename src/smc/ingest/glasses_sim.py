"""Degrading a phone photograph to what the glasses would actually deliver.

An iPhone shoots 4032x3024 through good optics. The Wearables Device Access Toolkit hands a
phone app **1440x1080** stills, or a **720p** stream capped at 30 fps over Bluetooth. Calibrating
feature matching on the iPhone file measures a camera the product does not have, and every
threshold tuned that way is tuned too optimistically.

Three of the four differences can be simulated faithfully. The fourth cannot, and it matters:

* **Resolution** — an eighth of the pixels. Simulated exactly.
* **Lossy re-encode** — the delivered frame has been through a codec. Simulated by re-encoding.
* **Optics** — a temple-mounted camera has a smaller sensor and a simpler lens than a phone, so
  it is softer and noisier. Approximated with a mild blur and sensor noise, and flagged as an
  estimate rather than a measurement, because Meta publishes nothing to calibrate it against.
* **Field of view — cannot be simulated, and the error runs the wrong way.** The glasses are
  ultrawide; an iPhone main camera at 26 mm equivalent is roughly 70 degrees horizontal against
  the glasses' ~100. Missing scene cannot be invented by cropping, so a degraded main-camera
  photo shows *less* of the street than the glasses would. Results from it are therefore
  pessimistic on coverage: real glasses see more wall per frame, and more wall means more
  features. Shooting on the phone's 0.5x ultrawide (~13 mm equivalent, ~106 degrees) is a much
  closer match, and is the better way to shoot a calibration set.
"""

from __future__ import annotations

import enum
import io
from dataclasses import dataclass

import numpy as np


class DeliveryMode(enum.StrEnum):
    """What the toolkit hands over."""

    PHOTO = "photo"
    STREAM = "stream"

    @property
    def resolution(self) -> tuple[int, int]:
        return (1440, 1080) if self is DeliveryMode.PHOTO else (1280, 720)

    @property
    def quality(self) -> int:
        """A still is encoded once; a stream frame comes out of a bitrate-limited codec."""
        return 82 if self is DeliveryMode.PHOTO else 64


@dataclass(frozen=True, slots=True)
class DegradationConfig:
    mode: DeliveryMode = DeliveryMode.PHOTO
    #: Simulate the softer optics. An estimate — see the module docstring.
    simulate_optics: bool = True
    #: Gaussian blur sigma in pixels, at the delivered resolution.
    optical_blur_px: float = 0.6
    #: Sensor noise standard deviation, in 8-bit levels.
    sensor_noise: float = 2.2
    #: Preserve aspect ratio by cropping rather than squashing.
    crop_to_aspect: bool = True
    seed: int = 0


@dataclass(frozen=True, slots=True)
class DegradationReport:
    source_size: tuple[int, int]
    delivered_size: tuple[int, int]
    source_megapixels: float
    delivered_megapixels: float
    encoded_bytes: int

    @property
    def pixel_ratio(self) -> float:
        return self.delivered_megapixels / max(self.source_megapixels, 1e-9)

    def describe(self) -> str:
        return (
            f"{self.source_size[0]}x{self.source_size[1]} "
            f"({self.source_megapixels:.1f} MP) -> "
            f"{self.delivered_size[0]}x{self.delivered_size[1]} "
            f"({self.delivered_megapixels:.2f} MP, {self.pixel_ratio:.0%} of source), "
            f"{self.encoded_bytes / 1000:.0f} kB encoded"
        )


def degrade(
    image: np.ndarray, config: DegradationConfig | None = None
) -> tuple[np.ndarray, DegradationReport]:
    """Turn a phone photograph into what the glasses would have delivered."""
    from PIL import Image, ImageFilter

    config = config or DegradationConfig()
    source = Image.fromarray(np.asarray(image, dtype=np.uint8))
    source_size = (source.width, source.height)
    target_w, target_h = config.mode.resolution

    # The delivered frame is 4:3 (or 16:9 for the stream). Squashing to fit would change every
    # angle in the image, which is the one thing feature geometry cannot tolerate.
    working = source
    if config.crop_to_aspect:
        target_aspect = target_w / target_h
        aspect = working.width / working.height
        if aspect > target_aspect:
            new_w = round(working.height * target_aspect)
            left = (working.width - new_w) // 2
            working = working.crop((left, 0, left + new_w, working.height))
        elif aspect < target_aspect:
            new_h = round(working.width / target_aspect)
            top = (working.height - new_h) // 2
            working = working.crop((0, top, working.width, top + new_h))

    working = working.resize((target_w, target_h), Image.LANCZOS)

    if config.simulate_optics:
        if config.optical_blur_px > 0:
            working = working.filter(ImageFilter.GaussianBlur(config.optical_blur_px))
        if config.sensor_noise > 0:
            rng = np.random.default_rng(config.seed)
            array = np.asarray(working, dtype=np.float64)
            array += rng.normal(0.0, config.sensor_noise, array.shape)
            working = Image.fromarray(np.clip(array, 0, 255).astype(np.uint8))

    # Round-trip through the codec so the result carries real compression artefacts rather than
    # a clean downscale, which is measurably easier to match on.
    buffer = io.BytesIO()
    working.convert("RGB").save(buffer, "JPEG", quality=config.mode.quality)
    encoded = buffer.getvalue()
    delivered = np.asarray(Image.open(io.BytesIO(encoded)).convert("RGB"))

    return delivered, DegradationReport(
        source_size=source_size,
        delivered_size=(target_w, target_h),
        source_megapixels=source_size[0] * source_size[1] / 1e6,
        delivered_megapixels=target_w * target_h / 1e6,
        encoded_bytes=len(encoded),
    )


def estimated_fov_deg(focal_35mm: float | None) -> float | None:
    """Horizontal field of view from a 35 mm-equivalent focal length."""
    import math

    if not focal_35mm or focal_35mm <= 0:
        return None
    return math.degrees(2.0 * math.atan(36.0 / (2.0 * focal_35mm)))


#: Estimated horizontal field of view of the delivered glasses frame. **[UNVERIFIED]** — Meta
#: does not publish it, and it materially affects how much scene each frame carries.
GLASSES_FOV_DEG = 100.0


def fov_gap(focal_35mm: float | None) -> str | None:
    """Describe how a source photo's field of view compares with the glasses.

    Reported rather than corrected, because it cannot be corrected: a narrower photo is missing
    scene that no transformation recovers.
    """
    fov = estimated_fov_deg(focal_35mm)
    if fov is None:
        return None
    if fov < GLASSES_FOV_DEG - 12:
        return (
            f"source is {fov:.0f} deg against the glasses' ~{GLASSES_FOV_DEG:.0f} deg: this set "
            "sees LESS street per frame than the glasses would, so feature counts here are "
            "pessimistic. Shoot on the 0.5x ultrawide for a closer match."
        )
    if fov > GLASSES_FOV_DEG + 12:
        return (
            f"source is {fov:.0f} deg against the glasses' ~{GLASSES_FOV_DEG:.0f} deg: this set "
            "sees MORE street per frame, so results here are optimistic."
        )
    return f"source is {fov:.0f} deg, close to the glasses' ~{GLASSES_FOV_DEG:.0f} deg"
