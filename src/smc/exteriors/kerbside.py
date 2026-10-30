"""Read canonical Kerbside geometry and bind facade observations without changing it."""

from __future__ import annotations

import copy
import math
from itertools import pairwise

from shapely.geometry import LineString, Point
from shapely.ops import nearest_points

from smc.exteriors.model import ExteriorInput
from smc.interiors.kerbside import mapped_geometry


def from_kerbside(way, streets=(), fit=None, *, region="sf-corridor"):
    shell = mapped_geometry(way, region=region)
    lon, lat = shell["origin_lon_lat"]
    scale = 111320 * math.cos(math.radians(lat))

    def local(q):
        return ((q[0] - lon) * scale, (q[1] - lat) * 111320)

    from shapely.geometry import shape

    polygon = shape(shell["footprint"])
    ring = list(polygon.exterior.coords)
    roads = [
        LineString([local(q) for q in row["points"]])
        for row in streets
        if row.get("kind") == "street" and len(row.get("points", [])) >= 2
    ]
    ranks = []
    for i, (a, b) in enumerate(pairwise(ring)):
        line = LineString([a, b])
        if line.length < 1.2:
            continue
        dx, dy = (b[0] - a[0]) / line.length, (b[1] - a[1]) / line.length
        nx, ny = (dy, -dx) if polygon.exterior.is_ccw else (-dy, dx)
        mid = line.interpolate(0.5, normalized=True)
        distances = []
        for road in roads:
            near = nearest_points(mid, road)[1]
            if (near.x - mid.x) * nx + (near.y - mid.y) * ny > 0.2:
                distances.append(mid.distance(near))
        distance = min(distances, default=math.inf)
        ranks.append((distance, -line.length, i))
    ranks.sort()
    if not ranks:
        raise ValueError("no usable canonical frontage edge")
    shops = way.get("shops") or []
    if not shops and way.get("name"):
        shops = [{"n": way["name"], "t": way.get("archetype", "shop"), "tags": way.get("tags", {})}]
    if not shops:
        raise ValueError("canonical building has no storefront identity")
    tenants = [
        dict(
            id=str(i),
            name=s["n"],
            category=s.get("category", s.get("t", "shop")),
            tags=s.get("tags", way.get("tags", {}) if len(shops) == 1 else {}),
            **{
                key: s[key]
                for key in (
                    "brand",
                    "fitout_tier",
                    "average_spend_per_person",
                    "currency",
                    "price_level",
                )
                if key in s
            },
        )
        for i, s in enumerate(shops)
    ]
    edge = ranks[0][2]
    binding = None
    if fit:
        if fit.get("canonical_footprint") != way["points"] or fit.get("height_m") != way.get(
            "height_m"
        ):
            raise ValueError("stale facade fit does not match canonical shell")
        if fit.get("canonical_geometry_modified") or fit.get("conflicts"):
            raise ValueError(
                "facade observation conflicts need resolution before exterior inference"
            )
        if fit.get("review_status") not in {
            "reviewed_inferred_visual_parameters",
            "auto_accepted_visual_parameters",
        }:
            raise ValueError("unreviewed facade evidence cannot become a storefront")
        a, b = local(fit["a"]), local(fit["b"])
        candidates = []
        for i, (c, d) in enumerate(pairwise(ring)):
            line = LineString([c, d])
            if line.buffer(0.05, cap_style=2).covers(LineString([a, b])):
                candidates.append((i, line))
        if len(candidates) != 1:
            raise ValueError("facade observation is not on one canonical edge")
        edge, line = candidates[0]
        binding = (line, a, b)
        if len(tenants) > 1:
            raise ValueError("observed multi-tenant frontage needs explicit tenant spans")
    length = math.dist(ring[edge], ring[edge + 1])
    faces = [
        dict(
            edge=edge,
            u0=length * i / len(tenants),
            u1=length * (i + 1) / len(tenants),
            tenant_id=t["id"],
            role="public",
            basis="inferred tenant span on street-facing source edge"
            if math.isfinite(ranks[0][0])
            else "inferred tenant span; street orientation unknown",
        )
        for i, t in enumerate(tenants)
    ]
    if binding:
        line, a, b = binding
        ua, ub = line.project(Point(a)), line.project(Point(b))
        direction = 1 if ub > ua else -1
        for o in fit.get("openings", []):
            if o.get("kind") not in {
                "window",
                "door",
                "storefront",
                "garage_candidate",
                "garage",
                "entrance",
            }:
                continue
            start = ua + direction * o["u"]
            end = ua + direction * (o["u"] + o["w"])
            row = copy.deepcopy(o)
            row.update(
                u=min(start, end), w=abs(end - start), kerbside_source_record=copy.deepcopy(o)
            )
            faces[0].setdefault("openings", []).append(row)
        faces[0]["basis"] = "geometry-bound reviewed facade plane; tenant extent remains inferred"
        faces[0]["openings_complete"] = bool(fit.get("openings_complete", False))
        faces[0]["bands"] = copy.deepcopy(fit.get("appearance", {}).get("bands", []))
        color = fit.get("appearance", {}).get("colour")
        if isinstance(color, str):
            faces[0]["wall_colour"] = color
        elif isinstance(color, int):
            faces[0]["wall_colour"] = f"#{color:06x}"
        for detail in fit.get("details", []):
            if detail.get("render") and detail.get("kind") in {"balcony", "fire_escape"}:
                for y in detail.get("platform_heights_m", []):
                    faces[0].setdefault("protected_rectangles", []).append(
                        dict(
                            u=ua + direction * detail["u"] - (detail["w"] if direction < 0 else 0),
                            w=detail["w"],
                            v=max(0, y - 0.2),
                            h=1.35,
                            source_record=copy.deepcopy(detail),
                        )
                    )
    # A second street side belongs to one tenant, never a repeated row of shops.
    if len(tenants) == 1 and not binding and math.isfinite(ranks[0][0]):
        first = LineString([ring[edge], ring[edge + 1]])
        for dist, _, other in ranks[1:]:
            second = LineString([ring[other], ring[other + 1]])
            if dist > 18 or first.distance(second) > 0.05:
                continue
            faces.append(
                dict(
                    edge=other,
                    tenant_id=tenants[0]["id"],
                    role="secondary",
                    basis="inferred second public street frontage",
                )
            )
            break
    height = float(way.get("height_m") or 3.2)
    ground = way.get("storey_m")
    if not ground:
        ground = (
            height
            if height <= 6.5 or str(way.get("tags", {}).get("building:levels")) == "1"
            else 3.9
        )
    return ExteriorInput.from_json(
        {
            "id": str(way["osm_id"]),
            "footprint": shell["footprint"],
            "height_m": height,
            "ground_height_m": min(height, float(ground)),
            "tenants": tenants,
            "frontages": faces,
            "origin_lon_lat": shell["origin_lon_lat"],
            "canonical_points": way["points"],
            "geometry_evidence": shell["geometry_evidence"],
        }
    )
