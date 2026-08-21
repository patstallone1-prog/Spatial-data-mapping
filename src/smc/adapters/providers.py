"""Concrete providers, and the switch between them.

Every class here is import-safe and constructs without network access. HTTP is deferred to the
call site so the selection logic can be tested exhaustively without mocking a transport.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from smc.adapters.base import (
    AdapterUnavailable,
    ImageRef,
    LocalizationResult,
    _require_env,
)

if TYPE_CHECKING:
    from collections.abc import Sequence


# --- Anchor imagery -----------------------------------------------------------------------


class MapillaryImagery:
    """Mapillary API v4 — the commercial-safe anchor source.

    Imagery is CC BY-SA 4.0. Derived *measurements* published as a Produced Work are fine;
    the imagery itself must not enter the product. See docs/01-dependency-stack.md 0.2.
    """

    name = "mapillary"
    commercial_safe = True
    BASE_URL = "https://graph.mapillary.com/images"

    def __init__(self) -> None:
        self._token = _require_env("MAPILLARY_ACCESS_TOKEN", "MapillaryImagery")

    def request_params(self, lat: float, lon: float, radius_m: float, limit: int) -> dict[str, str]:
        """The query this adapter would issue. Separated so it can be asserted in tests."""
        delta = radius_m / 111_320.0
        bbox = f"{lon - delta},{lat - delta},{lon + delta},{lat + delta}"
        return {
            "access_token": self._token,
            "fields": "id,geometry,compass_angle,captured_at,thumb_2048_url",
            "bbox": bbox,
            "limit": str(limit),
        }

    def nearby(
        self, lat: float, lon: float, radius_m: float, limit: int = 50
    ) -> Sequence[ImageRef]:  # pragma: no cover - network
        raise NotImplementedError(
            "wire an HTTP client to BASE_URL with request_params(); kept out of the adapter so "
            "the transport is chosen once, at the edge"
        )


class StreetViewImagery:
    """Google Street View Static API — internal build only.

    Maps Platform terms forbid caching Street View content, forbid using Maps Content to train
    or improve ML systems, and forbid creating content based on Maps Content. Panorama IDs are
    the sole caching exception. This adapter exists because the internal build is explicitly
    never shipped; it must not be selected for anything whose output is sold.
    """

    name = "street_view"
    commercial_safe = False
    BASE_URL = "https://maps.googleapis.com/maps/api/streetview"

    def __init__(self) -> None:
        self._key = _require_env("GOOGLE_MAPS_API_KEY", "StreetViewImagery")

    def request_params(self, lat: float, lon: float, heading_deg: float = 0.0) -> dict[str, str]:
        return {
            "key": self._key,
            "size": "640x640",
            "location": f"{lat},{lon}",
            "heading": str(heading_deg),
            "fov": "90",
            "pitch": "-10",
            "return_error_code": "true",
        }

    def nearby(
        self, lat: float, lon: float, radius_m: float, limit: int = 50
    ) -> Sequence[ImageRef]:  # pragma: no cover - network
        raise NotImplementedError("wire an HTTP client to BASE_URL with request_params()")


# --- Visual positioning -------------------------------------------------------------------


class ArCoreGeospatial:
    """ARCore Geospatial VPS — internal build only.

    Solves anchoring outright: sub-metre pose and heading from a camera frame, free, across 87+
    countries. It is also built on Street View and carries the ARCore term forbidding products
    that re-create the features of a Google service. Using it for the commercial build would
    put the entire sellable database downstream of Maps Content.

    Note this runs *on device* through the ARCore SDK, not as a server-side REST call; this
    class is the server-side stand-in that accepts results relayed from the client.
    """

    name = "arcore_geospatial"
    commercial_safe = False

    def __init__(self) -> None:
        self._key = _require_env("GOOGLE_ARCORE_API_KEY", "ArCoreGeospatial")

    def localize(
        self, image_bytes: bytes, lat: float, lon: float, sigma_m: float
    ) -> LocalizationResult | None:  # pragma: no cover - device SDK
        raise NotImplementedError(
            "ARCore Geospatial resolves on device; relay the client's Earth pose here"
        )


class OwnedAnchoring:
    """The commercial-safe anchoring stack: retrieval, matching, and pose against owned data.

    MegaLoc retrieval over an owned descriptor index, ALIKED + LightGlue matching, pose against
    Overture building footprints and previously anchored frames. This is the module the whole
    project stands or falls on, and it is deliberately not a thin wrapper around somebody
    else's service.
    """

    name = "owned_anchoring"
    commercial_safe = True

    def __init__(self, index_path: str | None = None) -> None:
        self._index_path = index_path

    def localize(
        self, image_bytes: bytes, lat: float, lon: float, sigma_m: float
    ) -> LocalizationResult | None:  # pragma: no cover - not yet built
        raise NotImplementedError(
            "anchoring stack not implemented; this is the critical-path module in "
            "docs/03-build-order.md"
        )


# --- Selection ----------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class ProviderChoice:
    anchor_imagery: str = "mapillary"
    visual_positioning: str = "owned_anchoring"


_ANCHOR_IMAGERY = {"mapillary": MapillaryImagery, "street_view": StreetViewImagery}
_VISUAL_POSITIONING = {"arcore_geospatial": ArCoreGeospatial, "owned_anchoring": OwnedAnchoring}


def build_anchor_imagery(choice: str, *, allow_internal_only: bool = False) -> object:
    """Construct an anchor-imagery provider.

    ``allow_internal_only`` must be passed explicitly to select a provider whose output cannot
    be sold. Making that an argument rather than a config string means the unsafe path is
    always visible at the call site.
    """
    cls = _ANCHOR_IMAGERY.get(choice)
    if cls is None:
        raise AdapterUnavailable(f"unknown anchor imagery provider: {choice}")
    if not cls.commercial_safe and not allow_internal_only:
        raise AdapterUnavailable(
            f"{choice} is not commercial-safe; pass allow_internal_only=True to use it in the "
            "internal build, and never in a pipeline whose output is sold"
        )
    return cls()


def build_visual_positioning(choice: str, *, allow_internal_only: bool = False) -> object:
    cls = _VISUAL_POSITIONING.get(choice)
    if cls is None:
        raise AdapterUnavailable(f"unknown visual positioning provider: {choice}")
    if not cls.commercial_safe and not allow_internal_only:
        raise AdapterUnavailable(
            f"{choice} is not commercial-safe; pass allow_internal_only=True to use it in the "
            "internal build, and never in a pipeline whose output is sold"
        )
    return cls()
