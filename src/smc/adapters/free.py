"""Services that need no credential at all.

Everything here is wired end to end and works the moment there is a network connection: no key,
no account, no billing. That is the point of grouping them — each one moved off the list of
things somebody has to go and register for.

Each client separates *building* the request from *making* it. The builders are pure and fully
tested; only :func:`_get` touches the network, so the query logic is verifiable offline and
there is exactly one place where a timeout, a user agent, or a retry policy has to be right.

Rate limits are respected as a matter of course. Nominatim and Overpass are volunteer-run and
will block a client that hammers them; Nominatim additionally requires a genuine User-Agent
identifying the application, and sending a fake one is a good way to lose access for everybody.
"""

from __future__ import annotations

import json
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any, ClassVar

USER_AGENT = "spatial-mapping-crowdsource/0.1 (research; contact via repository)"
DEFAULT_TIMEOUT_S = 30.0


def _get(
    url: str, *, timeout_s: float = DEFAULT_TIMEOUT_S, headers: dict[str, str] | None = None
) -> Any:
    """Fetch and parse JSON. The single network entry point for this module."""
    request = urllib.request.Request(
        url, headers={"User-Agent": USER_AGENT, **(headers or {})}
    )
    if not url.startswith("https://"):
        raise ValueError(f"refusing to fetch a non-HTTPS URL: {url}")
    with urllib.request.urlopen(request, timeout=timeout_s) as response:
        return json.loads(response.read().decode("utf-8"))


@dataclass(frozen=True, slots=True)
class BoundingBox:
    south: float
    west: float
    north: float
    east: float

    def __post_init__(self) -> None:
        if self.south >= self.north or self.west >= self.east:
            raise ValueError("bounding box is empty or inverted")

    @classmethod
    def around(cls, lat: float, lon: float, radius_m: float) -> BoundingBox:
        import math

        d_lat = radius_m / 111_320.0
        d_lon = radius_m / (111_320.0 * max(math.cos(math.radians(lat)), 1e-6))
        return cls(lat - d_lat, lon - d_lon, lat + d_lat, lon + d_lon)


class OverpassClient:
    """OpenStreetMap Overpass API — sidewalk, crossing and kerb tags.

    Free, no key. **ODbL**: this is *reference* data. It informs anchoring and cross-checking
    and must never be merged into the served facts table, or the product becomes a Derivative
    Database and inherits share-alike. See docs/01-dependency-stack.md 0.2.

    Self-host for production. The public instance is a shared volunteer resource and is not a
    dependency any pipeline should rest on.
    """

    name = "overpass"
    commercial_safe = True
    PUBLIC_ENDPOINT = "https://overpass-api.de/api/interpreter"

    def __init__(self, endpoint: str | None = None, min_interval_s: float = 2.0) -> None:
        self._endpoint = endpoint or self.PUBLIC_ENDPOINT
        self._min_interval_s = min_interval_s
        self._last_call = 0.0

    def pedestrian_query(self, bbox: BoundingBox) -> str:
        """Overpass QL for pedestrian infrastructure in a bounding box."""
        area = f"{bbox.south},{bbox.west},{bbox.north},{bbox.east}"
        return (
            "[out:json][timeout:60];("
            f'way["footway"="sidewalk"]({area});'
            f'way["footway"="crossing"]({area});'
            f'way["highway"="footway"]({area});'
            f'node["kerb"]({area});'
            f'node["barrier"="kerb"]({area});'
            ");out geom;"
        )

    def request_url(self, bbox: BoundingBox) -> str:
        return f"{self._endpoint}?{urllib.parse.urlencode({'data': self.pedestrian_query(bbox)})}"

    def fetch(self, bbox: BoundingBox) -> dict[str, Any]:
        self._throttle()
        return _get(self.request_url(bbox))

    def _throttle(self) -> None:
        elapsed = time.monotonic() - self._last_call
        if elapsed < self._min_interval_s:
            time.sleep(self._min_interval_s - elapsed)
        self._last_call = time.monotonic()


class NominatimClient:
    """OpenStreetMap geocoding. Free, no key, ODbL, 1 request/second maximum.

    The rate limit is a hard condition of use, not a suggestion, so it is enforced in the client
    rather than left to the caller to remember.
    """

    name = "nominatim"
    commercial_safe = True
    PUBLIC_ENDPOINT = "https://nominatim.openstreetmap.org"

    def __init__(self, endpoint: str | None = None) -> None:
        self._endpoint = endpoint or self.PUBLIC_ENDPOINT
        self._last_call = 0.0

    def reverse_url(self, lat: float, lon: float) -> str:
        params = urllib.parse.urlencode(
            {"lat": lat, "lon": lon, "format": "jsonv2", "zoom": "17", "addressdetails": "1"}
        )
        return f"{self._endpoint}/reverse?{params}"

    def search_url(self, query: str, limit: int = 5) -> str:
        params = urllib.parse.urlencode({"q": query, "format": "jsonv2", "limit": limit})
        return f"{self._endpoint}/search?{params}"

    def reverse(self, lat: float, lon: float) -> dict[str, Any]:
        self._throttle()
        return _get(self.reverse_url(lat, lon))

    def _throttle(self) -> None:
        elapsed = time.monotonic() - self._last_call
        if elapsed < 1.0:
            time.sleep(1.0 - elapsed)
        self._last_call = time.monotonic()


class ProjectSidewalkClient:
    """Project Sidewalk — independent human accessibility labels. Free, no key.

    50+ cities, 3.4M+ contributor labels, served as GeoJSON. Used by the ground-truth checker
    as an *independent* opinion on Tier A presence facts: independent because these are human
    labels from a different project, so agreement means something that agreement between two of
    our own passes does not.

    Each city is its own deployment with its own base URL; there is no single global endpoint.
    """

    name = "project_sidewalk"
    commercial_safe = True
    DEPLOYMENTS: ClassVar[dict[str, str]] = {
        "dc": "https://sidewalk-dc.cs.washington.edu",
        "seattle": "https://sidewalk-sea.cs.washington.edu",
        "columbus": "https://sidewalk-columbus.cs.washington.edu",
        "chicago": "https://sidewalk-chicago.cs.washington.edu",
        "mexico-city": "https://sidewalk-cdmx.cs.washington.edu",
    }

    def __init__(self, city: str = "dc", base_url: str | None = None) -> None:
        if base_url is None and city not in self.DEPLOYMENTS:
            raise ValueError(
                f"unknown deployment {city!r}; known: {sorted(self.DEPLOYMENTS)} — "
                "or pass base_url for another city"
            )
        self._base = base_url or self.DEPLOYMENTS[city]

    def access_attributes_url(self, bbox: BoundingBox) -> str:
        params = urllib.parse.urlencode(
            {"lat1": bbox.south, "lng1": bbox.west, "lat2": bbox.north, "lng2": bbox.east}
        )
        return f"{self._base}/v2/access/attributes?{params}"

    def fetch_labels(self, bbox: BoundingBox) -> dict[str, Any]:
        return _get(self.access_attributes_url(bbox))


class OvertureClient:
    """Overture Maps — building footprints and road centrelines. Free, no key.

    Published as GeoParquet on AWS Open Data and readable directly by DuckDB over HTTPS, so no
    AWS account or credential is involved.

    Licence split matters: **places and divisions are CDLA-Permissive 2.0**, but **buildings and
    transportation are ODbL** because they derive from OSM. Building footprints are the anchor
    features for pose refinement, which puts the most useful theme on the share-alike side —
    reference only, never merged.
    """

    name = "overture"
    commercial_safe = True
    BASE = "s3://overturemaps-us-west-2/release"
    ODBL_THEMES = frozenset({"buildings", "transportation"})
    PERMISSIVE_THEMES = frozenset({"places", "divisions", "addresses", "base"})

    def __init__(self, release: str = "2026-07-23.0") -> None:
        self._release = release

    def theme_path(self, theme: str, type_name: str) -> str:
        if theme not in self.ODBL_THEMES | self.PERMISSIVE_THEMES:
            raise ValueError(f"unknown Overture theme: {theme}")
        return f"{self.BASE}/{self._release}/theme={theme}/type={type_name}/*"

    def is_share_alike(self, theme: str) -> bool:
        """Whether output derived from this theme carries ODbL obligations."""
        return theme in self.ODBL_THEMES

    def duckdb_query(self, theme: str, type_name: str, bbox: BoundingBox, limit: int = 5000) -> str:
        """A DuckDB SQL query reading the theme directly from open data."""
        return (
            "INSTALL spatial; LOAD spatial; INSTALL httpfs; LOAD httpfs;\n"
            "SET s3_region='us-west-2';\n"
            "SELECT id, names, geometry FROM read_parquet("
            f"'{self.theme_path(theme, type_name)}', hive_partitioning=1)\n"
            f"WHERE bbox.xmin BETWEEN {bbox.west} AND {bbox.east}\n"
            f"  AND bbox.ymin BETWEEN {bbox.south} AND {bbox.north}\n"
            f"LIMIT {limit};"
        )


class OpenFreeMapTiles:
    """Vector basemap tiles. Free, no key, unlimited, MIT, OSM data.

    Chosen over Protomaps, whose hosted commercial use asks for sponsorship, and over MapTiler,
    which needs a key. Attribution is added automatically by MapLibre.
    """

    name = "openfreemap"
    commercial_safe = True
    STYLES = ("positron", "bright", "liberty")

    def style_url(self, style: str = "positron") -> str:
        if style not in self.STYLES:
            raise ValueError(f"unknown style {style!r}; known: {self.STYLES}")
        return f"https://tiles.openfreemap.org/styles/{style}"


@dataclass(frozen=True, slots=True)
class NtripMountpoint:
    """An RTK correction stream on the RTK2go community caster. Free, no rover registration.

    Corrections are valid only near the base station: 35-50 km is the practical limit, and
    accuracy degrades with distance from it, so the mountpoint has to be chosen per operating
    area rather than configured once.
    """

    host: str = "rtk2go.com"
    port: int = 2101
    mountpoint: str = ""
    #: RTK2go asks for an email as the password, as a courtesy contact. No account is created.
    user: str = ""

    @property
    def url(self) -> str:
        if not self.mountpoint:
            raise ValueError(
                "no mountpoint set; browse rtk2go.com for a base within 35-50 km of the "
                "operating area and set RTK2GO_MOUNTPOINT"
            )
        return f"ntrip://{self.host}:{self.port}/{self.mountpoint}"

    @property
    def sourcetable_url(self) -> str:
        """The caster's list of available base stations."""
        return f"http://{self.host}:{self.port}/"


#: Everything above, for the credential report to cross-check against.
KEYLESS_SERVICES: tuple[str, ...] = (
    "overpass",
    "nominatim",
    "project_sidewalk",
    "overture",
    "openfreemap",
    "rtk2go",
)
