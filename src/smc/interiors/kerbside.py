"""Read the actual Kerbside shell; fitted template rectangles are never geometry inputs."""

from __future__ import annotations

import hashlib
import json
import math

from shapely.geometry import Polygon, mapping


def mapped_geometry(way, fitted=None, *, region="sf-corridor"):
    points = way.get("points") or []
    if len(points) < 4:
        raise ValueError("Kerbside building has no complete footprint")
    lon, lat = way.get("centroid") or points[0]
    p = Polygon(
        [((x - lon) * 111320 * math.cos(math.radians(lat)), (y - lat) * 111320) for x, y in points]
    )
    if not p.is_valid or p.is_empty or p.area <= 0:
        raise ValueError("invalid Kerbside footprint; cannot substitute a rectangle")
    entrance = None
    if fitted and len(fitted) > 13 and fitted[13]:
        edge, t, _, _ = fitted[13][0]
        ring = list(p.exterior.coords)
        if not 0 <= edge < len(ring) - 1 or not 0 <= t <= 1:
            raise ValueError("invalid Kerbside entrance edge")
        a, b = ring[edge : edge + 2]
        entrance = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
    # The fit's count and floor height come from Kerbside's canonical shell exporter.
    # They describe the shell, not the dimensions of its unrelated floorplan template.
    if fitted and len(fitted) > 10:
        count, floor_height = int(fitted[9]), float(fitted[10])
        height_source = "Kerbside canonical storeys and storey_m"
    else:
        shell_height = float(way.get("height_m") or 3.2)
        count = max(1, round(shell_height / 3.2))
        floor_height = shell_height / count
        height_source = "equal storeys inferred from Kerbside shell height"
    if count < 1 or not math.isfinite(floor_height) or floor_height <= 0:
        raise ValueError("invalid Kerbside storey data")
    evidence = {
        "building_id": str(way["osm_id"]),
        "region": region,
        "source": "Kerbside published building polygon, local tangent-plane metres",
        "source_geometry_sha256": hashlib.sha256(
            json.dumps(points, separators=(",", ":")).encode()
        ).hexdigest(),
        "footprint_area_m2": p.area,
        "footprint_area_sqft": p.area * 10.7639104167,
        "shell_floor_area_m2": p.area * count,
        "storeys": count,
        "storey_height_m": floor_height,
        "height_source": height_source,
        "shell_height_source": way.get("height_source", "unspecified"),
        "tenant_boundary": "full ground-floor tenancy is unverified",
        "measured": False,
        "confidence": 0.25,
        "freshness": None,
        "corroboration_count": 0,
    }
    return {
        "footprint": mapping(p),
        "origin_lon_lat": [lon, lat],
        "units": "metres",
        "height_m": floor_height,
        "entrance": entrance,
        "geometry_evidence": evidence,
    }
