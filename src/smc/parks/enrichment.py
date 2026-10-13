"""Compact park evidence for consumers; never rewrite the canonical source world."""

from __future__ import annotations

import hashlib
import json
from collections import Counter
from math import floor

from smc.geo import Origin

BUILDING_ROLES = {
    "Restroom": "public_restroom",
    "Maintenance Building": "maintenance_shed",
    "Cargo Container": "equipment_container",
}


def rings(geometry: dict | None) -> list[list[list[list[float]]]]:
    if not geometry:
        return []
    if geometry["type"] == "Polygon":
        return [geometry["coordinates"]]
    if geometry["type"] == "MultiPolygon":
        return geometry["coordinates"]
    raise ValueError("park geometry must be polygonal")


def box(points: list) -> tuple:
    return (
        min(p[0] for p in points),
        min(p[1] for p in points),
        max(p[0] for p in points),
        max(p[1] for p in points),
    )


def overlaps(a: tuple, b: tuple) -> bool:
    return a[0] <= b[2] and a[2] >= b[0] and a[1] <= b[3] and a[3] >= b[1]


def inside(p: tuple, ring: list) -> bool:
    x, y = p
    result = False
    for a, b in zip(ring, ring[1:] + ring[:1], strict=True):
        if (a[1] > y) != (b[1] > y) and x < ((b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]):
            result = not result
    return result


def area(points: list) -> float:
    origin = Origin(points[0][1], points[0][0])
    local = [
        (
            (p[0] - origin.lon) * origin.metres_per_degree_lon,
            (p[1] - origin.lat) * origin.metres_per_degree_lat,
        )
        for p in points
    ]
    return (
        abs(
            sum(
                a[0] * b[1] - b[0] * a[1] for a, b in zip(local, local[1:] + local[:1], strict=True)
            )
        )
        / 2
    )


def coverage(a: list, b: list) -> float:
    """Deterministic overlap screening, explicitly NOT a surveyed geometry measurement."""
    ax, ay, bx, by = box(a)
    samples = [
        ((ax + (bx - ax) * (i + 0.5) / 12), (ay + (by - ay) * (j + 0.5) / 12))
        for i in range(12)
        for j in range(12)
    ]
    samples = [p for p in samples if inside(p, a)]
    return sum(inside(p, b) for p in samples) / len(samples) if samples else 0


def canonical_hash(world: dict) -> str:
    # Appearance/annotations are outside this contract. Coordinates and heights are immutable.
    features = [
        {k: w[k] for k in ("kind", "osm_id", "points", "height_m", "height_points") if k in w}
        for w in world["ways"]
    ]
    encoded = json.dumps(features, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()


def build_enrichment(inventory: dict, world: dict, pages: dict | None = None) -> dict:
    bbox = world["bbox"]
    bounds = tuple(bbox[k] for k in ("west", "south", "east", "north"))
    buildings = [w for w in world["ways"] if w["kind"] == "building" and w.get("points")]
    grid: dict[tuple, list] = {}
    for w in buildings:
        b = box(w["points"])
        for ix in range(floor(b[0] * 1000), floor(b[2] * 1000) + 1):
            for iy in range(floor(b[1] * 1000), floor(b[3] * 1000) + 1):
                grid.setdefault((ix, iy), []).append(w)
    parks, objects, joins, review = [], [], {}, []
    park_ids = set()
    for park in inventory["parks"]:
        if not any(overlaps(box(p[0]), bounds) for p in rings(park.get("geometry"))):
            continue
        park_ids.add(park["id"])
        parks.append({k: park[k] for k in ("id", "name", "children", "geometry", "license")})
        parks[-1]["page_evidence"] = (pages or {}).get(park["id"], {})
    for obj in inventory["objects"]:
        if obj["park_id"] not in park_ids:
            continue
        for part in obj["parts"]:
            for index, polygon in enumerate(rings(part["geometry"])):
                if not overlaps(box(polygon[0]), bounds):
                    continue
                role = BUILDING_ROLES.get(obj["kind"])
                row = {
                    "id": f"{obj['id']}:part:{part['id']}:{index}",
                    "logical_id": obj["id"],
                    "park_id": obj["park_id"],
                    "kind": obj["kind"],
                    "role": role,
                    "name": obj["name"],
                    "polygon": polygon,
                    "p": polygon[0],
                    "license": obj["license"],
                    "geometry_basis": obj["geometry_basis"],
                    "geometry_confidence": obj["geometry_confidence"],
                    "semantic_confidence": obj["semantic_confidence"],
                    "surface_material": "unknown",
                    "accessibility": obj["accessibility"],
                    "provenance": part["provenance"],
                    "floor": part["attributes"].get("floor"),
                    "render": "semantic_only",
                }
                if not role or obj["semantic_confidence"] == 0:
                    objects.append(row)
                    continue
                b = box(polygon[0])
                candidates = {}
                for ix in range(floor(b[0] * 1000), floor(b[2] * 1000) + 1):
                    for iy in range(floor(b[1] * 1000), floor(b[3] * 1000) + 1):
                        for w in grid.get((ix, iy), []):
                            candidates[str(w["osm_id"])] = w
                matches = sorted(
                    (
                        (coverage(polygon[0], w["points"]), key, w)
                        for key, w in candidates.items()
                        if overlaps(b, box(w["points"]))
                    ),
                    reverse=True,
                    key=lambda v: v[0],
                )
                if matches and matches[0][0] >= 0.65:
                    score, key, w = matches[0]
                    row["canonical_building_id"] = key
                    row["canonical_points"] = w["points"]
                    row["canonical_height_m"] = w.get("height_m")
                    row["match_basis"] = "polygon_overlap_sample_screening"
                    row["overlap_screen_share"] = score
                    if len(matches) > 1 and matches[1][0] >= score - 0.15:
                        review.append({"id": row["id"], "reason": "ambiguous_building_overlap"})
                    elif len(polygon) > 1 or area(polygon[0]) < 0.5 * area(w["points"]):
                        # An indoor toilet room doesn't turn the whole rec center into a toilet.
                        row["render"] = "canonical_building_amenity"
                    else:
                        row["render"] = "canonical_building_style"
                        joins.setdefault(key, []).append(row["id"])
                elif any(v[0] > 0.1 for v in matches):
                    review.append({"id": row["id"], "reason": "partial_building_overlap"})
                elif row["floor"] not in (None, "", "0", "1", 0, 1, "Ground"):
                    review.append({"id": row["id"], "reason": "non_ground_inventory_polygon"})
                else:
                    row["render"] = "inventory_structure"
                    row["height_m"] = {
                        "public_restroom": 3.1,
                        "maintenance_shed": 3.2,
                        "equipment_container": 2.6,
                    }[role]
                    row["height_basis"] = "visual_type_prior_not_measured"
                objects.append(row)
    by_id = {o["id"]: o for o in objects}
    for key, ids in joins.items():
        roles = {by_id[i]["role"] for i in ids}
        if len(roles) != 1:
            for identity in ids:
                by_id[identity]["render"] = "canonical_building_amenity"
            review.append({"building_id": key, "reason": "conflicting_structure_roles"})
    return {
        "schema": "kerbside.park_evidence/1",
        "bbox": bbox,
        "canonical_geometry_sha256": canonical_hash(world),
        "geometry_modified": False,
        "parks": parks,
        "objects": objects,
        "review": review,
        "counts": dict(Counter(o["render"] for o in objects)),
    }
