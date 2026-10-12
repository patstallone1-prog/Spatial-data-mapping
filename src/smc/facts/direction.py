"""Road direction precedence; a nearest cross-street record is not permission."""
from __future__ import annotations

import math
from typing import Any


def oneway_direction(way: dict[str, Any]) -> int:
    value = str(way.get("osm_oneway") if way.get("osm_oneway") is not None
                else way.get("oneway") or "").lower()
    if value in ("no", "false", "0"):
        return 0
    if way.get("osm_oneway") is None and way.get("lanes_fwd", 0) > 0 and way.get("lanes_back", 0) > 0:
        return 0
    if value in ("-1", "reverse"):
        return -1
    if value in ("yes", "true", "1"):
        return 1
    cardinal = {"nb": (0, 1), "sb": (0, -1), "eb": (1, 0), "wb": (-1, 0)}.get(value)
    points = way.get("points") or []
    if cardinal and len(points) >= 2:
        a, b = points[0], points[-1]
        dx = (b[0]-a[0])*math.cos(math.radians((a[1]+b[1])/2))
        dy = b[1]-a[1]
        length = math.hypot(dx, dy)
        dot = dx*cardinal[0] + dy*cardinal[1]
        if length and abs(dot)/length >= math.sqrt(.5):
            return 1 if dot > 0 else -1
    return 0
