"""Panoramax — the default anchor-imagery source.

Panoramax is street-level imagery run by IGN (the French national mapping agency) and
OpenStreetMap France. It is worth being precise about what is and is not better than Mapillary
here, because one of the two things people expect is not true:

* **The imagery is CC BY-SA 4.0 — the same share-alike licence as Mapillary.** Panoramax is not
  more permissive on imagery. The Produced Work boundary in docs/01-dependency-stack.md 0.2
  applies identically: measurements published as a Produced Work are fine, the imagery itself
  must never enter the facts table.
* **Everything else is better.** No account and no token for reads, so it removes a credential
  rather than adding one. The server is MIT-licensed and federated, so a corridor that matters
  can be self-hosted instead of depending on somebody's uptime. It is a standard STAC API rather
  than a proprietary graph. And it is not operated by a company that also sells wearable cameras.

The API returns two fields Mapillary does not, and both are directly useful:

* ``quality:horizontal_accuracy`` — the capture's own GPS sigma, in metres. The anchoring
  pipeline takes a prior sigma and sizes its search radius from it; having the real number
  rather than a guessed one is worth more than it sounds.
* ``pers:interior_orientation`` — camera model and sensor dimensions, which gives focal length
  without a calibration target.
"""

from __future__ import annotations

import json
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from smc.adapters.base import ImageRef
from smc.adapters.free import USER_AGENT

#: The main public instance. Panoramax is federated; point this at your own to self-host.
DEFAULT_ENDPOINT = "https://api.panoramax.xyz/api"

#: Sensor width when the API does not report one, in millimetres. A phone-class sensor.
_FALLBACK_SENSOR_WIDTH_MM = 6.4


@dataclass(frozen=True, slots=True)
class PanoramaxImage:
    """One capture, with everything the anchoring stack can use."""

    image_id: str
    lat: float
    lon: float
    heading_deg: float | None
    captured_at: datetime | None
    #: The capture's own reported GPS accuracy, metres. ``None`` when unreported.
    horizontal_accuracy_m: float | None
    camera_model: str
    #: Full-resolution image URL.
    hd_url: str
    #: Downscaled URL — usually the right one, since the pipeline works at 1440 px anyway.
    sd_url: str
    license: str

    def to_ref(self) -> ImageRef:
        return ImageRef(
            image_id=self.image_id,
            lat=self.lat,
            lon=self.lon,
            heading_deg=self.heading_deg,
            captured_at_s=self.captured_at.timestamp() if self.captured_at else None,
            url=self.sd_url or self.hd_url,
            provider="panoramax",
            commercial_safe=True,
        )

    @property
    def is_share_alike(self) -> bool:
        """CC BY-SA. True for essentially everything on the public instance."""
        return "SA" in self.license.upper()


class PanoramaxImagery:
    """STAC client for Panoramax. No credential required."""

    name = "panoramax"
    commercial_safe = True
    requires_credential = False

    def __init__(self, endpoint: str | None = None, *, timeout_s: float = 30.0) -> None:
        self._endpoint = (endpoint or DEFAULT_ENDPOINT).rstrip("/")
        self._timeout_s = timeout_s

    @property
    def endpoint(self) -> str:
        return self._endpoint

    def search_url(
        self, lat: float, lon: float, radius_m: float, limit: int = 50,
        *, since: datetime | None = None,
    ) -> str:
        """Build a STAC item-search URL.

        Separated from the request so the query is testable without a network.
        """
        import math

        d_lat = radius_m / 111_320.0
        d_lon = radius_m / (111_320.0 * max(math.cos(math.radians(lat)), 1e-6))
        params: dict[str, str] = {
            "bbox": f"{lon - d_lon},{lat - d_lat},{lon + d_lon},{lat + d_lat}",
            "limit": str(limit),
        }
        if since is not None:
            params["datetime"] = f"{since.isoformat()}/.."
        return f"{self._endpoint}/search?{urllib.parse.urlencode(params)}"

    def nearby(
        self, lat: float, lon: float, radius_m: float, limit: int = 50,
        *, since: datetime | None = None,
    ) -> list[PanoramaxImage]:
        """Captures near a point, freshest-first."""
        payload = self._get(self.search_url(lat, lon, radius_m, limit, since=since))
        images = [
            parsed
            for feature in payload.get("features", [])
            if (parsed := _parse_feature(feature)) is not None
        ]
        images.sort(key=lambda i: i.captured_at or datetime.min, reverse=True)
        return images

    def fetch_image(self, image: PanoramaxImage, *, full_resolution: bool = False) -> bytes:
        """Download one capture. Transient: used for anchoring, then discarded."""
        url = image.hd_url if full_resolution else (image.sd_url or image.hd_url)
        if not url.startswith("https://"):
            raise ValueError(f"refusing a non-HTTPS image URL: {url!r}")
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(request, timeout=self._timeout_s) as response:
            return response.read()

    def check_access(self) -> tuple[bool, str]:
        try:
            payload = self._get(f"{self._endpoint}/collections?limit=1")
        except Exception as exc:
            return False, f"{type(exc).__name__}: {exc}"
        count = len(payload.get("collections", []))
        return True, f"{self._endpoint} reachable ({count}+ collections, no credential needed)"

    def _get(self, url: str) -> dict[str, Any]:
        if not url.startswith("https://"):
            raise ValueError(f"refusing a non-HTTPS URL: {url!r}")
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(request, timeout=self._timeout_s) as response:
            return json.loads(response.read().decode("utf-8"))


def _parse_feature(feature: dict[str, Any]) -> PanoramaxImage | None:
    """Parse one STAC feature. Returns ``None`` for anything unusable."""
    geometry = feature.get("geometry") or {}
    coordinates = geometry.get("coordinates")
    if not coordinates or len(coordinates) < 2:
        return None
    properties = feature.get("properties") or {}
    assets = feature.get("assets") or {}

    captured: datetime | None = None
    if raw := properties.get("datetime"):
        try:
            captured = datetime.fromisoformat(str(raw))
        except ValueError:
            captured = None

    azimuth = properties.get("view:azimuth")
    accuracy = properties.get("quality:horizontal_accuracy")
    interior = properties.get("pers:interior_orientation") or {}

    return PanoramaxImage(
        image_id=str(feature.get("id", "")),
        lat=float(coordinates[1]),
        lon=float(coordinates[0]),
        heading_deg=float(azimuth) if azimuth is not None else None,
        captured_at=captured,
        horizontal_accuracy_m=float(accuracy) if accuracy is not None else None,
        camera_model=str(interior.get("camera_model", "")),
        hd_url=str((assets.get("hd") or {}).get("href", "")),
        sd_url=str((assets.get("sd") or {}).get("href", "")),
        license=str(properties.get("license", "")),
    )


def focal_px_from_interior(interior: dict[str, Any], image_width_px: int) -> float | None:
    """Focal length in pixels from the STAC interior-orientation block.

    ``focal_px = image_width * focal_mm / sensor_width_mm``. Falls back to a phone-class sensor
    width when the API does not report one — an estimate, and far better than nothing, but it
    should not be mistaken for a calibration.
    """
    focal_mm = interior.get("focal_length")
    if focal_mm in (None, 0):
        return None
    dimensions = interior.get("sensor_array_dimensions") or []
    sensor_width_mm = (
        float(dimensions[0]) if dimensions and float(dimensions[0]) > 0
        else _FALLBACK_SENSOR_WIDTH_MM
    )
    return float(image_width_px) * float(focal_mm) / sensor_width_mm
