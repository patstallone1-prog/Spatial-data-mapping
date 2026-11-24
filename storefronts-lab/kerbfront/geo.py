"""Local metric frame, compass bearings and segment helpers.

District-scale work (a few km) uses a tangent-plane equirectangular frame: x east, y north,
metres. Its error over the Marina is a few centimetres, far below footprint accuracy.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

EARTH_R = 6378137.0


@dataclass(frozen=True)
class Frame:
    lat0: float
    lon0: float

    @property
    def _kx(self) -> float:
        return math.radians(1) * EARTH_R * math.cos(math.radians(self.lat0))

    @property
    def _ky(self) -> float:
        return math.radians(1) * EARTH_R

    def xy(self, lon: float, lat: float) -> tuple[float, float]:
        return (lon - self.lon0) * self._kx, (lat - self.lat0) * self._ky

    def lonlat(self, x: float, y: float) -> tuple[float, float]:
        return self.lon0 + x / self._kx, self.lat0 + y / self._ky


def bearing(dx: float, dy: float) -> float:
    """Compass bearing of a vector in the local frame: 0 north, 90 east."""
    return math.degrees(math.atan2(dx, dy)) % 360.0


def ang_diff(a: float, b: float) -> float:
    """Signed smallest difference a - b, in (-180, 180]."""
    d = (a - b + 180.0) % 360.0 - 180.0
    return 180.0 if d == -180.0 else d


def unit(dx: float, dy: float) -> tuple[float, float]:
    n = math.hypot(dx, dy)
    return (dx / n, dy / n) if n else (0.0, 0.0)


def signed_area(ring: list[tuple[float, float]]) -> float:
    a = 0.0
    for (x0, y0), (x1, y1) in zip(ring, ring[1:] + ring[:1]):
        a += x0 * y1 - x1 * y0
    return a / 2.0


def ccw(ring: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """The ring counter-clockwise without a closing repeat, so outward normals are (dy, -dx)."""
    pts = list(ring)
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts = pts[:-1]
    return pts if signed_area(pts) >= 0 else pts[::-1]


def seg_intersect(p: tuple[float, float], q: tuple[float, float],
                  a: tuple[float, float], b: tuple[float, float]) -> float | None:
    """Parameter t along p->q where it crosses segment a-b, or None."""
    rx, ry = q[0] - p[0], q[1] - p[1]
    sx, sy = b[0] - a[0], b[1] - a[1]
    den = rx * sy - ry * sx
    if abs(den) < 1e-12:
        return None
    t = ((a[0] - p[0]) * sy - (a[1] - p[1]) * sx) / den
    u = ((a[0] - p[0]) * ry - (a[1] - p[1]) * rx) / den
    return t if 0.0 <= t <= 1.0 and 0.0 <= u <= 1.0 else None


def point_seg_dist(p: tuple[float, float], a: tuple[float, float],
                   b: tuple[float, float]) -> tuple[float, float]:
    """(distance, t) from p to segment a-b; t is the clamped parameter of the foot."""
    dx, dy = b[0] - a[0], b[1] - a[1]
    L2 = dx * dx + dy * dy
    t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2))
    fx, fy = a[0] + t * dx, a[1] + t * dy
    return math.hypot(p[0] - fx, p[1] - fy), t
