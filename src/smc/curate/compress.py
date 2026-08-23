"""Compression policy for the daily batch.

No codec is written here and none should be. Both platforms ship hardware HEIC and AVIF
encoders that run on dedicated silicon at a fraction of the energy any software path costs, and
on a device that is trying to survive a day of capture that difference is the whole argument.
What this module decides is *what to ask the hardware for*.

Three choices set the size of the daily upload, and each has a cost that is not obvious:

* **Resolution.** The pipeline cannot use more than the glasses deliver, so 1440 px wide is the
  ceiling regardless of what the source was. An iPhone frame at 4032 px carries eight times the
  pixels and no additional usable information — but it is worth keeping *some* headroom above
  the working resolution, because downscaling is lossy and irreversible on device.
* **Quality.** Feature detection is surprisingly robust to JPEG-scale artefacts and quite
  sensitive to the ringing that appears below roughly q60. The default sits above that with
  margin, because a frame compressed into uselessness has consumed upload bandwidth for nothing
  — the worst possible outcome.
* **Format.** AVIF is roughly half the size of JPEG at matched quality and is supported on both
  platforms now. HEIC is the iPhone-native fallback.

The estimates here are deliberately conservative. Promising a smaller batch than the encoder
delivers means a device that silently exceeds its daily budget on a metered connection.
"""

from __future__ import annotations

import enum
from dataclasses import dataclass


class ImageFormat(enum.StrEnum):
    AVIF = "avif"
    HEIC = "heic"
    JPEG = "jpeg"

    @property
    def bytes_per_megapixel(self) -> float:
        """Rough encoded size at the default quality. Conservative on purpose."""
        return {"avif": 95_000.0, "heic": 120_000.0, "jpeg": 210_000.0}[str(self)]


@dataclass(frozen=True, slots=True)
class CompressionProfile:
    """What to ask the platform encoder for."""

    format: ImageFormat = ImageFormat.AVIF
    #: Long-edge ceiling. 1440 matches the toolkit's delivered still width.
    max_edge_px: int = 1440
    quality: int = 72
    #: Strip everything except what the pipeline reads. EXIF carries a lot that should never
    #: leave the device, and orientation must be baked into the pixels before it goes.
    strip_metadata: bool = True
    fallback: ImageFormat = ImageFormat.HEIC

    def __post_init__(self) -> None:
        if not 1 <= self.quality <= 100:
            raise ValueError("quality must be between 1 and 100")
        if self.max_edge_px < 320:
            raise ValueError("max_edge_px below 320 is not usable for feature matching")


@dataclass(frozen=True, slots=True)
class CompressionPlan:
    """What a batch will cost to send."""

    frame_count: int
    source_megapixels: float
    target_megapixels: float
    estimated_bytes: int
    profile: CompressionProfile

    @property
    def estimated_megabytes(self) -> float:
        return self.estimated_bytes / 1e6

    @property
    def bytes_per_frame(self) -> int:
        return self.estimated_bytes // max(self.frame_count, 1)

    @property
    def pixel_reduction(self) -> float:
        if self.source_megapixels <= 0:
            return 1.0
        return self.target_megapixels / self.source_megapixels

    def describe(self) -> str:
        return (
            f"{self.frame_count} frames, {self.profile.format} q{self.profile.quality} "
            f"at {self.profile.max_edge_px}px: "
            f"{self.estimated_megabytes:.1f} MB "
            f"({self.bytes_per_frame / 1000:.0f} kB/frame, "
            f"{self.pixel_reduction:.0%} of source pixels)"
        )


def plan_compression(
    frame_count: int,
    source_width: int,
    source_height: int,
    profile: CompressionProfile | None = None,
) -> CompressionPlan:
    """Estimate the daily batch size before encoding any of it.

    Worth knowing in advance: a phone on a metered plan should be able to refuse a batch, or
    defer it to Wi-Fi, without first spending the battery to encode it.
    """
    if frame_count < 0:
        raise ValueError("frame_count must be non-negative")
    if source_width <= 0 or source_height <= 0:
        raise ValueError("source dimensions must be positive")
    profile = profile or CompressionProfile()

    scale = min(1.0, profile.max_edge_px / max(source_width, source_height))
    target_w = source_width * scale
    target_h = source_height * scale
    target_mp = target_w * target_h / 1e6

    # Quality scales the size roughly linearly around the reference point.
    quality_factor = profile.quality / 72.0
    per_frame = target_mp * profile.format.bytes_per_megapixel * quality_factor

    return CompressionPlan(
        frame_count=frame_count,
        source_megapixels=source_width * source_height / 1e6,
        target_megapixels=target_mp,
        estimated_bytes=int(per_frame * frame_count),
        profile=profile,
    )


def fits_budget(plan: CompressionPlan, budget_megabytes: float) -> bool:
    return plan.estimated_megabytes <= budget_megabytes


def frames_within_budget(
    budget_megabytes: float,
    source_width: int,
    source_height: int,
    profile: CompressionProfile | None = None,
) -> int:
    """How many frames fit in a budget. Sets the curator's daily cap on a metered plan."""
    single = plan_compression(1, source_width, source_height, profile)
    if single.estimated_bytes <= 0:
        return 0
    return int(budget_megabytes * 1e6 // single.estimated_bytes)
