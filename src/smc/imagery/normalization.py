"""Ephemeral image normalization for external imagery."""

from __future__ import annotations

import io
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageOps

from smc.imagery.base import ImageAsset, ImageryProvider
from smc.imagery.schema import Observation

TARGET_PIXEL_BUDGET = 12_192_768


@dataclass(frozen=True, slots=True)
class NormalizedAsset:
    bytes: bytes
    width: int
    height: int
    source_width: int
    source_height: int
    downscaled: bool


def normalize_image(
    payload: bytes,
    *,
    target_pixel_budget: int = TARGET_PIXEL_BUDGET,
    quality: int = 82,
) -> NormalizedAsset:
    """Correct orientation and downsample only when source exceeds the pixel budget."""

    image = ImageOps.exif_transpose(Image.open(io.BytesIO(payload))).convert("RGB")
    source_width, source_height = image.size
    pixels = source_width * source_height
    downscaled = pixels > target_pixel_budget
    if downscaled:
        scale = (target_pixel_budget / pixels) ** 0.5
        image = image.resize(
            (max(1, round(source_width * scale)), max(1, round(source_height * scale))),
            Image.Resampling.LANCZOS,
        )
    out = io.BytesIO()
    image.save(out, "JPEG", quality=quality, optimize=True)
    width, height = image.size
    return NormalizedAsset(out.getvalue(), width, height, source_width, source_height, downscaled)


def fetch_normalized(
    provider: ImageryProvider,
    observation: Observation,
    cache_dir: Path | None = None,
    *,
    keep_cache: bool = False,
) -> NormalizedAsset:
    """Resolve, download, normalize, and discard source bytes by default."""

    import urllib.request

    asset: ImageAsset = provider.resolve_image(observation)
    request = urllib.request.Request(asset.url, headers={"User-Agent": "Kerbside/0.1"})
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = response.read()
    normalized = normalize_image(payload)
    if keep_cache and cache_dir is not None:
        cache_dir.mkdir(parents=True, exist_ok=True)
        (cache_dir / f"{observation.observation_uid}.jpg").write_bytes(normalized.bytes)
    return normalized
