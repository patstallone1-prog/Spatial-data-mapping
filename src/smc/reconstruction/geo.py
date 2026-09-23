"""WGS84 to per-cell ENU transforms with metre-scale local coordinates."""

from __future__ import annotations

import math
from dataclasses import dataclass

WGS84_A = 6_378_137.0
WGS84_E2 = 6.69437999014e-3


def ecef(lon: float, lat: float, height_m: float) -> tuple[float, float, float]:
    longitude = math.radians(lon)
    latitude = math.radians(lat)
    sin_lat = math.sin(latitude)
    n = WGS84_A / math.sqrt(1.0 - WGS84_E2 * sin_lat * sin_lat)
    return (
        (n + height_m) * math.cos(latitude) * math.cos(longitude),
        (n + height_m) * math.cos(latitude) * math.sin(longitude),
        (n * (1.0 - WGS84_E2) + height_m) * sin_lat,
    )


@dataclass(frozen=True)
class EnuFrame:
    lon: float
    lat: float
    height_m: float

    def to_enu(self, lon: float, lat: float, height_m: float) -> tuple[float, float, float]:
        x, y, z = ecef(lon, lat, height_m)
        ox, oy, oz = ecef(self.lon, self.lat, self.height_m)
        dx, dy, dz = x - ox, y - oy, z - oz
        lo, la = math.radians(self.lon), math.radians(self.lat)
        east = -math.sin(lo) * dx + math.cos(lo) * dy
        north = (-math.sin(la) * math.cos(lo) * dx
                 - math.sin(la) * math.sin(lo) * dy + math.cos(la) * dz)
        up = (math.cos(la) * math.cos(lo) * dx
              + math.cos(la) * math.sin(lo) * dy + math.sin(la) * dz)
        return east, north, up

    def enu_to_ecef(self) -> list[float]:
        """Column-major 4x4 transform as used by glTF and 3D Tiles."""
        lo, la = math.radians(self.lon), math.radians(self.lat)
        east = (-math.sin(lo), math.cos(lo), 0.0)
        north = (-math.sin(la) * math.cos(lo), -math.sin(la) * math.sin(lo), math.cos(la))
        up = (math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la))
        origin = ecef(self.lon, self.lat, self.height_m)
        return [*east, 0.0, *north, 0.0, *up, 0.0, *origin, 1.0]


def within_halo(lon: float, lat: float, bbox: tuple[float, float, float, float],
                halo_m: float) -> bool:
    west, south, east, north = bbox
    centre_lat = (south + north) / 2.0
    lat_pad = halo_m / 111_320.0
    lon_pad = halo_m / (111_320.0 * math.cos(math.radians(centre_lat)))
    return west - lon_pad <= lon <= east + lon_pad and south - lat_pad <= lat <= north + lat_pad
