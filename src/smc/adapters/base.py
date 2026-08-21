"""Provider-agnostic interfaces.

Each capability is a Protocol with at least two implementations: the Google one, which is free
and powerful and may not touch the commercial build, and a commercial-safe one. Selection is
configuration. That is the whole point — the internal build can use Street View and ARCore VPS
today, and the commercial build swaps to Mapillary and an owned anchoring stack by changing a
provider name, not by rewriting the fusion engine.

Nothing here performs I/O at import time, and every implementation raises a clear
:class:`AdapterUnavailable` when its credential is absent rather than failing deep inside a
request.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import TYPE_CHECKING, Protocol, runtime_checkable

if TYPE_CHECKING:
    from collections.abc import Sequence


class AdapterUnavailable(RuntimeError):
    """Raised when an adapter is selected but its credential or dependency is missing."""


@dataclass(frozen=True, slots=True)
class ImageRef:
    """A street-level image available for anchoring."""

    image_id: str
    lat: float
    lon: float
    #: Compass heading of the camera, degrees clockwise from north, if known.
    heading_deg: float | None
    captured_at_s: float | None
    url: str
    provider: str
    #: Whether this image's derivatives may enter a commercial database.
    commercial_safe: bool


@dataclass(frozen=True, slots=True)
class LocalizationResult:
    """A refined camera pose from a visual positioning service."""

    lat: float
    lon: float
    altitude_m: float | None
    heading_deg: float
    horizontal_sigma_m: float
    heading_sigma_deg: float
    provider: str
    commercial_safe: bool


@runtime_checkable
class AnchorImagerySource(Protocol):
    """Street-level imagery to anchor captures against."""

    name: str
    commercial_safe: bool

    def nearby(self, lat: float, lon: float, radius_m: float, limit: int) -> Sequence[ImageRef]:
        ...


@runtime_checkable
class VisualPositioningSource(Protocol):
    """Refines a rough position using a camera frame. The load-bearing accuracy step."""

    name: str
    commercial_safe: bool

    def localize(
        self, image_bytes: bytes, lat: float, lon: float, sigma_m: float
    ) -> LocalizationResult | None:
        ...


@runtime_checkable
class MetricDepthSource(Protocol):
    """Per-pixel metric depth. Feeds the scale estimator."""

    name: str
    commercial_safe: bool

    def depth(self, image_bytes: bytes, focal_px: float) -> object:
        ...


def _require_env(var: str, adapter: str) -> str:
    value = os.environ.get(var)
    if not value:
        raise AdapterUnavailable(
            f"{adapter} needs {var}; run `python -m smc.adapters check` for how to set it"
        )
    return value
