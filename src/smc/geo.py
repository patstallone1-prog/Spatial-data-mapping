"""Local tangent-plane geodesy.

The simulator works in metres on a flat local frame; facts are served in latitude and
longitude. Over a pilot corridor — a few kilometres — a local ENU tangent plane is accurate to
well under a centimetre, far inside every tolerance this project claims, so a full projection
library would add a dependency and no accuracy. The approximation's validity is bounded and
:func:`enu_to_geodetic` raises rather than silently degrading outside it.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

#: WGS-84 semi-major axis and first-eccentricity squared.
_A = 6378137.0
_E2 = 6.69437999014e-3

#: Beyond this the flat-plane approximation starts to matter at the centimetre level.
MAX_LOCAL_RANGE_M = 25_000.0


@dataclass(frozen=True, slots=True)
class Origin:
    """The tangent point of a local ENU frame."""

    lat: float
    lon: float

    def __post_init__(self) -> None:
        if not -90.0 <= self.lat <= 90.0:
            raise ValueError(f"latitude out of range: {self.lat}")
        if not -180.0 <= self.lon <= 180.0:
            raise ValueError(f"longitude out of range: {self.lon}")

    @property
    def metres_per_degree_lat(self) -> float:
        phi = math.radians(self.lat)
        w = math.sqrt(1.0 - _E2 * math.sin(phi) ** 2)
        meridian_radius = _A * (1.0 - _E2) / w**3
        return math.pi * meridian_radius / 180.0

    @property
    def metres_per_degree_lon(self) -> float:
        phi = math.radians(self.lat)
        w = math.sqrt(1.0 - _E2 * math.sin(phi) ** 2)
        normal_radius = _A / w
        return math.pi * normal_radius * math.cos(phi) / 180.0


def enu_to_geodetic(origin: Origin, east_m: float, north_m: float) -> tuple[float, float]:
    """Local east/north offsets to (lat, lon)."""
    if math.hypot(east_m, north_m) > MAX_LOCAL_RANGE_M:
        raise ValueError(
            f"offset {math.hypot(east_m, north_m):.0f} m exceeds the {MAX_LOCAL_RANGE_M:.0f} m "
            "validity of the local tangent plane; use a projected CRS"
        )
    return (
        origin.lat + north_m / origin.metres_per_degree_lat,
        origin.lon + east_m / origin.metres_per_degree_lon,
    )


def geodetic_to_enu(origin: Origin, lat: float, lon: float) -> tuple[float, float]:
    """(lat, lon) to local east/north offsets."""
    return (
        (lon - origin.lon) * origin.metres_per_degree_lon,
        (lat - origin.lat) * origin.metres_per_degree_lat,
    )


def gaussian_radius_m(lat: float) -> float:
    """Gaussian radius of curvature at a latitude: sqrt(M*N).

    The sphere radius that best approximates the ellipsoid locally. Using the equatorial axis
    instead would put a 0.1% scale error between this function and :func:`enu_to_geodetic`,
    and the two are used to score the same measurements against each other.
    """
    phi = math.radians(lat)
    w = math.sqrt(1.0 - _E2 * math.sin(phi) ** 2)
    meridian = _A * (1.0 - _E2) / w**3
    normal = _A / w
    return math.sqrt(meridian * normal)


def distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Distance between two nearby points, in the local tangent plane at their midpoint.

    **This is the metric the ground-truth checker must use**, not :func:`haversine_m`. A
    spherical formula cannot agree with an ellipsoidal ENU frame better than about 2e-3, and
    that disagreement is *direction-dependent* — north distances come out long and east
    distances short, because the meridian and normal radii of curvature differ. A scoring
    metric with a directional bias would quietly favour features positioned along one axis.

    Projecting both points into a common local frame removes the directional bias. A residual
    of roughly 9 ppm remains, because the frame is centred on the pair's midpoint rather than
    on the origin the truth was written against: 0.45 um at 5 m separation, 4.5 mm at 500 m.
    The checker compares positions metres apart, where that is six orders of magnitude below
    the tolerance being scored.
    """
    midpoint = Origin((lat1 + lat2) / 2.0, (lon1 + lon2) / 2.0)
    e1, n1 = geodetic_to_enu(midpoint, lat1, lon1)
    e2, n2 = geodetic_to_enu(midpoint, lat2, lon2)
    return math.hypot(e2 - e1, n2 - n1)


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance over long ranges.

    Retained for distances where earth curvature actually matters. Do **not** use it to score
    position error — see :func:`distance_m` for why.
    """
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    radius = gaussian_radius_m((lat1 + lat2) / 2.0)
    return 2.0 * radius * math.asin(math.sqrt(h))
