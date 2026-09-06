"""Where a wall stands, where a camera stood, and whether one can see the other.

Everything here works in a local east-north-up frame in metres, with the origin put at the
middle of whatever region is being processed. Over a few kilometres the difference between that
and a proper projection is well under the GPS error we are already carrying, and it keeps every
distance in this file a real distance rather than a degree.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

EARTH_RADIUS_M = 6_378_137.0

#: A camera closer to a wall than this is inside the building, or the GPS is wrong.
MIN_STANDOFF_M = 2.0
#: Beyond this the wall is a handful of pixels and the rectification is mush.
MAX_STANDOFF_M = 55.0
#: How far off square a view may be before the wall is more foreshortened than photographed.
#: Sixty degrees leaves roughly half the horizontal resolution, which is still usable.
MAX_OBLIQUITY_RAD = math.radians(60.0)
#: Where the camera sits above the road when the provider did not say. Vehicle roof racks and
#: cyclists' helmets both land near here; the error it costs is a couple of degrees of pitch.
DEFAULT_CAMERA_HEIGHT_M = 2.4


class LocalFrame:
    """Longitude/latitude to metres east and north of a fixed origin."""

    def __init__(self, lat0: float, lon0: float) -> None:
        self.lat0 = lat0
        self.lon0 = lon0
        self._m_per_deg_lat = math.pi * EARTH_RADIUS_M / 180.0
        self._m_per_deg_lon = self._m_per_deg_lat * math.cos(math.radians(lat0))

    def to_xy(self, lon: float, lat: float) -> tuple[float, float]:
        return ((lon - self.lon0) * self._m_per_deg_lon,
                (lat - self.lat0) * self._m_per_deg_lat)

    def to_lonlat(self, x: float, y: float) -> tuple[float, float]:
        return (self.lon0 + x / self._m_per_deg_lon,
                self.lat0 + y / self._m_per_deg_lat)


@dataclass(frozen=True)
class Wall:
    """One straight run of a building's outline, standing up.

    ``a`` and ``b`` are the ends in local metres, ordered so that ``normal`` points away from
    the building's interior -- which is the side a photograph has to have been taken from.
    """

    building_index: int
    wall_index: int
    a: tuple[float, float]
    b: tuple[float, float]
    normal: tuple[float, float]
    height_m: float

    @property
    def length_m(self) -> float:
        return math.hypot(self.b[0] - self.a[0], self.b[1] - self.a[1])

    @property
    def midpoint(self) -> tuple[float, float]:
        return ((self.a[0] + self.b[0]) / 2.0, (self.a[1] + self.b[1]) / 2.0)


def _signed_area(points: list[tuple[float, float]]) -> float:
    total = 0.0
    for i in range(len(points)):
        x1, y1 = points[i]
        x2, y2 = points[(i + 1) % len(points)]
        total += x1 * y2 - x2 * y1
    return total / 2.0


def walls_of(
    ring: list[tuple[float, float]],
    height_m: float,
    building_index: int = 0,
    *,
    min_length_m: float = 4.0,
) -> list[Wall]:
    """Split a footprint into outward-facing walls.

    The ring is expected in local metres. Runs shorter than ``min_length_m`` are dropped: they
    are chamfered corners and bay windows, and a photograph of one is a smear.
    """
    points = list(ring)
    if len(points) > 1 and points[0] == points[-1]:
        points = points[:-1]
    if len(points) < 3:
        return []
    # For a counter-clockwise ring the outward normal of the edge a->b is (dy, -dx); for a
    # clockwise one it is the other way about. Getting this backwards puts every camera inside
    # the building and yields nothing at all, silently.
    winding = 1.0 if _signed_area(points) > 0 else -1.0
    walls: list[Wall] = []
    for i in range(len(points)):
        a = points[i]
        b = points[(i + 1) % len(points)]
        dx, dy = b[0] - a[0], b[1] - a[1]
        length = math.hypot(dx, dy)
        if length < min_length_m:
            continue
        nx, ny = (dy / length) * winding, (-dx / length) * winding
        walls.append(Wall(building_index, i, a, b, (nx, ny), height_m))
    return walls


@dataclass(frozen=True)
class Camera:
    """A photograph's pose and lens, enough to say where a world point lands in it."""

    x: float
    y: float
    z: float
    yaw_rad: float
    width: int
    height: int
    spherical: bool
    hfov_rad: float | None = None

    @property
    def forward(self) -> tuple[float, float]:
        # Heading is degrees clockwise from north, so north is +y and east is +x.
        return (math.sin(self.yaw_rad), math.cos(self.yaw_rad))

    @property
    def right(self) -> tuple[float, float]:
        return (math.cos(self.yaw_rad), -math.sin(self.yaw_rad))


def project(camera: Camera, points: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """World points (N, 3) in local metres to pixel coordinates.

    Returns ``(u, v, valid)``. ``valid`` is false where the point is behind a perspective
    camera or outside the frame; a spherical camera sees in every direction, so only the frame
    test applies there.

    The spherical model assumes the equirectangular image is stored with its *centre column* on
    the reported compass heading, which is the convention Mapillary's and Panoramax's own
    viewers initialise to. If a provider ever stored column zero on north instead, walls would
    be sampled from a hundred and eighty degrees away -- so the extractor cross-checks the
    assumption against independent cameras rather than trusting it.
    """
    fx, fy = camera.forward
    rx, ry = camera.right
    d = points - np.array([camera.x, camera.y, camera.z], dtype=np.float64)
    df = d[:, 0] * fx + d[:, 1] * fy
    dr = d[:, 0] * rx + d[:, 1] * ry
    du = d[:, 2]

    if camera.spherical:
        azimuth = np.arctan2(dr, df)
        radius = np.sqrt(df * df + dr * dr + du * du)
        elevation = np.arcsin(np.clip(du / np.maximum(radius, 1e-9), -1.0, 1.0))
        u = (0.5 + azimuth / (2.0 * math.pi)) * camera.width
        v = (0.5 - elevation / math.pi) * camera.height
        # atan2 returns exactly pi for a point dead behind the camera, which lands one pixel
        # past the right edge and would be thrown away as out of frame. A sphere has no edge:
        # the column wraps.
        u = np.mod(u, camera.width)
        valid = radius > 1e-6
    else:
        if not camera.hfov_rad:
            raise ValueError("a perspective camera needs a horizontal field of view")
        focal = (camera.width / 2.0) / math.tan(camera.hfov_rad / 2.0)
        safe = np.where(df > 1e-6, df, 1e-6)
        u = camera.width / 2.0 + focal * dr / safe
        v = camera.height / 2.0 - focal * du / safe
        valid = df > 1e-6

    valid &= (u >= 0) & (u < camera.width) & (v >= 0) & (v < camera.height)
    return u, v, valid


def score_view(wall: Wall, camera: Camera) -> float | None:
    """How good a look this camera gets at this wall, or None if it gets none.

    Higher is better. The score rewards standing square to the wall and close enough for the
    wall to fill a decent share of the frame, which is the whole of what makes a rectified crop
    look like a building rather than like a smear of colour.
    """
    mx, my = wall.midpoint
    nx, ny = wall.normal
    to_camera = (camera.x - mx, camera.y - my)
    standoff = to_camera[0] * nx + to_camera[1] * ny
    if standoff < MIN_STANDOFF_M:
        return None                      # behind the wall: this is the back of the building
    distance = math.hypot(*to_camera)
    if distance > MAX_STANDOFF_M:
        return None
    obliquity = math.acos(max(-1.0, min(1.0, standoff / max(distance, 1e-9))))
    if obliquity > MAX_OBLIQUITY_RAD:
        return None

    # A perspective camera also has to be pointing at it; a spherical one always is.
    if not camera.spherical:
        fx, fy = camera.forward
        bearing = math.acos(max(-1.0, min(1.0,
            (-to_camera[0] * fx - to_camera[1] * fy) / max(distance, 1e-9))))
        half_fov = (camera.hfov_rad or math.radians(70.0)) / 2.0
        # Allow the wall to sit at the edge of frame; the rectifier drops what falls outside.
        if bearing > half_fov + math.atan2(wall.length_m / 2.0, max(distance, 1e-9)):
            return None

    squareness = math.cos(obliquity) ** 2
    # Pixels across the wall, near enough: angular width times the sensor's angular resolution.
    pixels_per_m = camera.width / (2.0 * math.pi) / max(distance, 1e-9) if camera.spherical \
        else (camera.width / 2.0) / math.tan((camera.hfov_rad or 1.2) / 2.0) / max(distance, 1e-9)
    return squareness * math.log1p(pixels_per_m)
