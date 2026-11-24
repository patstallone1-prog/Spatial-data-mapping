"""Solar elevation and azimuth (NOAA approximation, ~0.5 deg), for daylight and glare."""

from __future__ import annotations

import math
from datetime import datetime, timezone


def position(when: datetime, lat: float, lon: float) -> tuple[float, float]:
    """(elevation_deg, azimuth_deg clockwise from north) of the sun."""
    t = when.astimezone(timezone.utc)
    doy = t.timetuple().tm_yday
    hour = t.hour + t.minute / 60 + t.second / 3600
    g = 2 * math.pi / 365 * (doy - 1 + (hour - 12) / 24)
    eqt = 229.18 * (0.000075 + 0.001868 * math.cos(g) - 0.032077 * math.sin(g)
                    - 0.014615 * math.cos(2 * g) - 0.040849 * math.sin(2 * g))
    decl = (0.006918 - 0.399912 * math.cos(g) + 0.070257 * math.sin(g)
            - 0.006758 * math.cos(2 * g) + 0.000907 * math.sin(2 * g)
            - 0.002697 * math.cos(3 * g) + 0.00148 * math.sin(3 * g))
    tst = hour * 60 + eqt + 4 * lon
    ha = math.radians(tst / 4 - 180)
    phi = math.radians(lat)
    cz = math.sin(phi) * math.sin(decl) + math.cos(phi) * math.cos(decl) * math.cos(ha)
    zen = math.acos(max(-1.0, min(1.0, cz)))
    elev = 90 - math.degrees(zen)
    az = math.degrees(math.atan2(math.sin(ha),
                                 math.cos(ha) * math.sin(phi) - math.tan(decl) * math.cos(phi)))
    return elev, (az + 180) % 360
