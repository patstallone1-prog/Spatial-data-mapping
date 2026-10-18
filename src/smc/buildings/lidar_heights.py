"""Which height a building is drawn at, when the region's lidar has measured its roof.

The lidar pass (scripts/measure_region_lidar.py) reads a roof height for nearly every footprint.
Over a default or a storey count it is simply better. Over a height a mapper wrote down it is
not obviously so: on a forty square metre footprint in a dense block the roof cells can be the
building next door's, or a tree's. But in San Francisco the mapped heights are the city's own
2010 lidar import, and they agree with the region's lidar to a median of half a metre -- two
measurements of one roof. Where they agree within ``AGREE_M`` the lidar's is drawn and the
mapper's kept beside it (``height_osm_m``), so the page still treats the height as one a mapper
stated; where they disagree the mapper's stands and the lidar's is kept for review
(``height_lidar_m``). The Marina's heights are the city's lidar medians for the same reason.
"""

from __future__ import annotations

from typing import Any

#: Two heights within this of each other are one roof measured twice.
AGREE_M = 3.0
WEAK_SOURCES = {None, "inferred_default", "osm_levels"}


def adopt_lidar_height(way: dict[str, Any], found: dict[str, Any]) -> str:
    """Set ``way``'s height from a lidar roof where the policy allows; say what happened."""
    source = way.get("height_source")
    if source == "lidar_region":
        return "already"
    lidar = float(found["height_m"])
    if source == "osm_height":
        stated = way.get("height_m")
        if stated is None or abs(lidar - float(stated)) > AGREE_M:
            way["height_lidar_m"] = round(lidar, 2)
            return "disagrees"
        way["height_osm_m"] = stated
    elif source not in WEAK_SOURCES:
        return "measured_elsewhere"
    way["height_m"] = found["height_m"]
    way["height_source"] = "lidar_region"
    way["height_points"] = found.get("roof_points")
    return "confirmed" if source == "osm_height" else "adopted"
