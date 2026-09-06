"""Municipal coordinates into WGS84, explicitly rather than by assumption.

San Francisco's records are cast in the California State Plane Coordinate System, Zone III, on
NAD83, in US survey feet -- the CAD basemap says so on its own tin. The open-data tables mostly
serve WGS84 GeoJSON, but not all of them: the street acceptance table publishes State Plane
``x``/``y`` beside its latitude and longitude, and anything digitised off a drawing will arrive
in State Plane too.

So the conversion is written out rather than assumed, and it is checked against the city's own
numbers. That same acceptance table gives several thousand records where San Francisco has
published both coordinates for the same point, which is a control network anybody can re-run.

Vertical datum is deliberately *not* handled here. Elevations on city drawings are on
CCSF-VD13 or on older city datums, and treating those as interchangeable with NAVD88 or with an
ellipsoid height would put a curb somewhere between a few centimetres and a couple of metres
from where it is. Nothing in this codebase currently reads an official elevation; when
something does, it will need a datum conversion of its own and should not quietly borrow this
one.
"""

from __future__ import annotations

import math

#: EPSG:2227 -- NAD83 / California zone 3, US survey feet.
CA_STATE_PLANE_III = "EPSG:2227"
WGS84 = "EPSG:4326"

#: GRS80, which NAD83 uses.
_A = 6378137.0
_F = 1.0 / 298.257222101
_E = math.sqrt(2 * _F - _F * _F)

#: Zone III's defining parallels and origin.
_LAT_1 = math.radians(38.0 + 26.0 / 60.0)
_LAT_2 = math.radians(37.0 + 4.0 / 60.0)
_LAT_0 = math.radians(36.5)
_LON_0 = math.radians(-120.5)
_FALSE_E = 2_000_000.0
_FALSE_N = 500_000.0

_US_SURVEY_FOOT_M = 1200.0 / 3937.0


def _m(lat: float) -> float:
    return math.cos(lat) / math.sqrt(1.0 - _E * _E * math.sin(lat) ** 2)


def _t(lat: float) -> float:
    sin_lat = _E * math.sin(lat)
    return math.tan(math.pi / 4.0 - lat / 2.0) / ((1.0 - sin_lat) / (1.0 + sin_lat)) ** (_E / 2.0)


_M1, _M2 = _m(_LAT_1), _m(_LAT_2)
_T1, _T2, _T0 = _t(_LAT_1), _t(_LAT_2), _t(_LAT_0)
_N = (math.log(_M1) - math.log(_M2)) / (math.log(_T1) - math.log(_T2))
_BIG_F = _M1 / (_N * _T1**_N)
_RHO_0 = _A * _BIG_F * _T0**_N


def state_plane_to_wgs84(x_ft: float, y_ft: float) -> tuple[float, float]:
    """State Plane III easting/northing in US survey feet to ``(lon, lat)`` degrees."""
    east = x_ft * _US_SURVEY_FOOT_M - _FALSE_E
    north = y_ft * _US_SURVEY_FOOT_M - _FALSE_N

    rho = math.copysign(math.hypot(east, _RHO_0 - north), _N)
    theta = math.atan2(east, _RHO_0 - north)
    t = (rho / (_A * _BIG_F)) ** (1.0 / _N)

    lat = math.pi / 2.0 - 2.0 * math.atan(t)
    for _ in range(12):
        sin_lat = _E * math.sin(lat)
        updated = math.pi / 2.0 - 2.0 * math.atan(
            t * ((1.0 - sin_lat) / (1.0 + sin_lat)) ** (_E / 2.0)
        )
        if abs(updated - lat) < 1e-13:
            lat = updated
            break
        lat = updated
    return math.degrees(theta / _N + _LON_0), math.degrees(lat)


def wgs84_to_state_plane(lon: float, lat: float) -> tuple[float, float]:
    """``(lon, lat)`` degrees to State Plane III easting/northing in US survey feet."""
    lat_r, lon_r = math.radians(lat), math.radians(lon)
    rho = _A * _BIG_F * _t(lat_r) ** _N
    theta = _N * (lon_r - _LON_0)
    east = _FALSE_E + rho * math.sin(theta)
    north = _FALSE_N + _RHO_0 - rho * math.cos(theta)
    return east / _US_SURVEY_FOOT_M, north / _US_SURVEY_FOOT_M


#: Where San Francisco is, generously. A coordinate outside this is not a mistake to be
#: silently reprojected -- it is a sign that a longitude and a latitude have been swapped, or
#: that State Plane feet have been read as degrees, and it should stop the run.
SF_BOUNDS = (-122.55, 37.68, -122.32, 37.86)


def check_wgs84(lon: float, lat: float, *, what: str = "coordinate") -> tuple[float, float]:
    """Assert a coordinate is a plausible San Francisco lon/lat, in that order."""
    west, south, east, north = SF_BOUNDS
    if not (west <= lon <= east and south <= lat <= north):
        raise ValueError(
            f"{what} ({lon}, {lat}) is not in San Francisco -- lon/lat swapped, or not WGS84"
        )
    return lon, lat


def geojson_rings(geometry: dict) -> list[list[tuple[float, float]]]:
    """Each ring or line of a GeoJSON geometry, kept separate.

    :func:`geojson_points` flattens everything into one sequence, which is right for reading a
    centreline and wrong for measuring one. A right of way recorded as two polygons -- the two
    halves of a divided boulevard, say -- flattens into a single cloud whose principal axis is
    neither half's, and its measured width comes out somewhere between the truth and nonsense.
    """
    coordinates = (geometry or {}).get("coordinates")
    kind = (geometry or {}).get("type")
    if coordinates is None:
        return []
    if kind == "Point":
        return [[(float(coordinates[0]), float(coordinates[1]))]]

    rings: list[list[tuple[float, float]]] = []

    def walk(node) -> None:
        if not isinstance(node, (list, tuple)) or not node:
            return
        first = node[0]
        if (isinstance(first, (int, float))):
            return
        if (isinstance(first, (list, tuple)) and len(first) >= 2
                and all(isinstance(v, (int, float)) for v in first[:2])):
            rings.append([(float(p[0]), float(p[1])) for p in node
                          if isinstance(p, (list, tuple)) and len(p) >= 2])
            return
        for child in node:
            walk(child)

    walk(coordinates)
    return [r for r in rings if r]


def geojson_points(geometry: dict) -> list[tuple[float, float]]:
    """Every ``(lon, lat)`` in a GeoJSON geometry, flattened, in order.

    Socrata serves Point, LineString, MultiLineString, Polygon and MultiPolygon from these
    tables. Flattening loses ring structure, which is right for the things read here -- widths
    and centrelines -- and would be wrong for anything needing to know about holes.
    """
    kind = (geometry or {}).get("type")
    coordinates = (geometry or {}).get("coordinates")
    if coordinates is None:
        return []
    if kind == "Point":
        return [(float(coordinates[0]), float(coordinates[1]))]

    points: list[tuple[float, float]] = []

    def walk(node) -> None:
        if (isinstance(node, (list, tuple)) and len(node) >= 2
                and all(isinstance(v, (int, float)) for v in node[:2])):
            points.append((float(node[0]), float(node[1])))
            return
        for child in node:
            walk(child)

    walk(coordinates)
    return points
