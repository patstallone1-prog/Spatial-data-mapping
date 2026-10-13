"""Join material evidence to immutable pedestrian ways, preserving evidenced transitions."""

from __future__ import annotations

from dataclasses import fields
from itertools import pairwise
from math import hypot, isfinite

from smc.geo import Origin
from smc.parks.enrichment import inside, rings
from smc.parks.surfaces import (
    SurfaceEvidence,
    contextual_surface,
    osm_surface,
    resolve_surface,
    split_path_surfaces,
)

OFFICIAL_MATERIALS = {
    "Asphalt": "asphalt", "Concrete": "concrete", "Dirt": "dirt",
    "Decomposed Granite": "decomposed_granite",
}
#: An official path polygon may be a few metres off the OSM centreline; this much slack.
OFFICIAL_SLACK_M = 1.5
#: Official runs shorter than this are a corner clipped by a neighbouring polygon, not a change.
MIN_RUN_M = 4.0


def official_paths(inventory: dict) -> list[dict]:
    """RPD functional areas of type Path with a recorded material: current inventory evidence."""
    out = []
    for obj in inventory.get("objects", []):
        if obj.get("kind") != "Path" or obj.get("semantic_confidence", 0) == 0:
            continue
        material = OFFICIAL_MATERIALS.get(obj.get("subtype") or "")
        if not material:
            continue
        for part in obj["parts"]:
            for polygon in rings(part["geometry"]):
                out.append({"id": f"{obj['id']}:part:{part['id']}", "material": material,
                            "ring": polygon[0], "holes": polygon[1:],
                            "observed_at": part["provenance"].get("edited_at")
                            or part["provenance"].get("data_as_of"),
                            "source_url": part["provenance"].get("source_url")})
    return out


def official_intervals(local: list, origin, polygons: list[dict], length: float) -> list:
    """Stations along the way inside each official material polygon, as evidence intervals."""
    if not polygons:
        return []
    prepared = []
    for poly in polygons:
        ring = [((p[0] - origin.lon) * origin.metres_per_degree_lon,
                 (p[1] - origin.lat) * origin.metres_per_degree_lat) for p in poly["ring"]]
        prepared.append((poly, ring))
    stations, chain = [], 0.0
    steps = max(2, int(length) + 1)
    pieces = [(a, b, hypot(b[0] - a[0], b[1] - a[1])) for a, b in pairwise(local)]
    for k in range(steps + 1):
        target, walked = min(length, k * length / steps), 0.0
        point = local[-1]
        for a, b, span in pieces:
            if walked + span >= target and span > 0:
                t = (target - walked) / span
                point = (a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]))
                break
            walked += span
        hit = None
        for poly, ring in prepared:
            if inside(point[:2], ring) or min(
                    _distance(point, a, b) for a, b in pairwise(ring)) <= OFFICIAL_SLACK_M:
                hit = poly
                break
        stations.append((target, hit))
        chain = target
    del chain
    runs, start = [], 0
    for i in range(1, len(stations) + 1):
        if i == len(stations) or stations[i][1] is not stations[start][1]:
            lo, hi = stations[start][0], stations[i - 1][0]
            if i < len(stations):
                hi = (stations[i - 1][0] + stations[i][0]) / 2
            if start > 0:
                lo = (stations[start - 1][0] + stations[start][0]) / 2
            if stations[start][1] is not None and hi - lo >= MIN_RUN_M:
                poly = stations[start][1]
                runs.append((max(0.0, lo), min(length, hi), SurfaceEvidence(
                    poly["material"], "official_rpd", poly["id"], 0.95,
                    source_url=poly["source_url"], observed_at=poly["observed_at"],
                    project_state="existing")))
            start = i
    return runs


def annotate_paths(
    world: dict, parks: list[dict], source: dict | None = None, reviews: dict | None = None,
    official: list[dict] | None = None, natural_areas: list[list] | None = None,
    imagery: dict | None = None,
) -> tuple[dict, list]:
    result, rejected = {}, []
    source = source or {}
    # A separate immutable evidence source. It may update attributes, never the geometry.
    source_ways = source.get("ways", {})
    contexts = source.get("contexts", [])
    for way in world["ways"]:
        if way["kind"] not in {"path", "sidewalk"} or len(way.get("points", [])) < 2:
            continue
        points, identity = way["points"], str(way["osm_id"])
        origin = Origin(points[0][1], points[0][0])
        local = [
            [
                (p[0] - origin.lon) * origin.metres_per_degree_lon,
                (p[1] - origin.lat) * origin.metres_per_degree_lat,
                *p[2:],
            ]
            for p in points
        ]
        # Same sequential accumulation as the transition splitter. Python's compensated
        # sum can differ by a few ulps and put a whole-way interval past its own endpoint.
        length = 0.0
        for a, b in pairwise(local):
            length += hypot(b[0] - a[0], b[1] - a[1])
        if length == 0:
            rejected.append({"id": identity, "reason": "zero_length_path"})
            continue
        matches = [
            p["id"]
            for p in parks
            if any(
                sum(
                    inside(tuple(q[:2]), polygon[0])
                    and not any(inside(tuple(q[:2]), h) for h in polygon[1:])
                    for q in points
                )
                / len(points)
                > 0.5
                for polygon in rings(p.get("geometry"))
            )
        ]
        lons = [p[0] for p in points]
        lats = [p[1] for p in points]
        nearby = [o for o in (official or [])
                  if min(q[0] for q in o["ring"]) <= max(lons) + 0.0001
                  and max(q[0] for q in o["ring"]) >= min(lons) - 0.0001
                  and min(q[1] for q in o["ring"]) <= max(lats) + 0.0001
                  and max(q[1] for q in o["ring"]) >= min(lats) - 0.0001]
        entry = source_ways.get(identity, {})
        tags = entry.get("tags", {}) or way.get("tags", {})
        material = tags.get("surface") or way.get("surface")
        base = []
        if material:
            evidence = osm_surface(
                {"surface": material}, f"osm:way:{identity}", entry.get("timestamp")
            )
            base.append(evidence)
        # Landscape context, weak and only for park/natural paths, never a sidewalk.
        # A trail type (path/track/bridleway) can take any context; a footway only woodland or
        # beach context and only inside a park; steps, sidewalks and promenades never.
        trail = tags.get("highway") in {"path", "track", "bridleway"}
        if way["kind"] == "path" and tags.get("footway") != "sidewalk" and (
                trail or (matches and tags.get("highway") in {"footway", None})):
            beach_distance, forest, riverbed = None, False, False
            stream_distance, wetland, sandy = None, False, False
            for context in contexts:
                geometry = [
                    [
                        (p["lon"] - origin.lon) * origin.metres_per_degree_lon,
                        (p["lat"] - origin.lat) * origin.metres_per_degree_lat,
                    ]
                    for p in context.get("geometry", [])
                ]
                tag = context.get("tags", {})
                if tag.get("waterway") in {"stream", "river", "ditch", "drain"} and len(geometry) >= 2:
                    near = min(_distance(point, a, b) for point in local for a, b in pairwise(geometry))
                    stream_distance = near if stream_distance is None else min(stream_distance, near)
                    continue
                if tag.get("natural") == "beach":
                    distances = []
                    for point in local:
                        if inside(tuple(point[:2]), geometry):
                            distances.append(0)
                            continue
                        distances.append(min(_distance(point, a, b) for a, b in pairwise(geometry)))
                    distance = max(distances)
                    beach_distance = (
                        min(beach_distance, distance) if beach_distance is not None else distance
                    )
                contained = all(inside(tuple(p[:2]), geometry) for p in local)
                forest |= contained and (
                    tag.get("natural") == "wood" or tag.get("landuse") == "forest"
                )
                forest |= contained and tag.get("natural") in {"scrub", "heath"}
                wetland |= contained and tag.get("natural") == "wetland"
                sandy |= contained and tag.get("natural") == "sand"
                riverbed |= (
                    contained
                    and tag.get("waterway") == "riverbank"
                    and tag.get("intermittent") == "yes"
                )
            for ring in natural_areas or []:
                ring_xy = [((p[0] - origin.lon) * origin.metres_per_degree_lon,
                            (p[1] - origin.lat) * origin.metres_per_degree_lat) for p in ring]
                if all(inside(tuple(p[:2]), ring_xy) for p in local):
                    forest = True
            # A beach or sand nearby suggests sand only for a park path or an unpaved-tagged
            # track; a promenade beside the beach is still whatever it was laid as.
            if not trail:
                # Water nearby says nothing about a laid footway; only a trail turns to mud.
                stream_distance, wetland, riverbed = None, False, False
            context = contextual_surface(
                source_id=f"osm_context:{source.get('source_sha256', 'unknown')}",
                beach_distance_m=0 if sandy else beach_distance,
                forest=forest,
                riverbed=riverbed or wetland
                or (stream_distance is not None and stream_distance <= 10),
            )
            if context:
                base.append(context)
        intervals = [(0, length, e) for e in base]
        intervals += official_intervals(local, origin, nearby, length)
        for lo, hi, record in (imagery or {}).get(identity, []):
            if 0 <= lo < hi <= length + 1e-6:
                intervals.append((lo, min(hi, length), record))
        for review in (reviews or {}).get(identity, []):
            if review.get("canonical_points") != points:
                rejected.append({"id": identity, "reason": "review_geometry_version_mismatch"})
                continue
            keys = {f.name for f in fields(SurfaceEvidence)}
            record = SurfaceEvidence(**{k: v for k, v in review["evidence"].items() if k in keys})
            lo, hi = review["range_m"]
            intervals.append((lo, hi, record))
        runs = split_path_surfaces(
            local, intervals, canonical_id=f"osm:way:{identity}", highway=tags.get("highway")
        )
        for run in runs:
            run["resolved"] = {
                k: v for k, v in run.items() if k not in {"points", "range_m", "canonical_id", "id"}
            }
            run["points"] = [
                [
                    origin.lon + p[0] / origin.metres_per_degree_lon,
                    origin.lat + p[1] / origin.metres_per_degree_lat,
                    *p[2:],
                ]
                for p in run["points"]
            ]
            # Endpoints stay byte-identical rather than roundtripping through ENU.
            if run["range_m"][0] == 0:
                run["points"][0] = points[0]
            if run["range_m"][1] == length:
                run["points"][-1] = points[-1]
        result[identity] = {
            "points": points,
            "park_id": matches[0] if len(matches) == 1 else None,
            "park_candidates": matches,
            "runs": runs,
            "resolved": max(runs, key=lambda r: r["range_m"][1] - r["range_m"][0])["resolved"]
            if runs else resolve_surface(base, highway=tags.get("highway")),
        }
        try:
            width = float(str(tags.get("width", "")).removesuffix("m").strip())
            if isfinite(width) and 0.3 <= width <= 20:
                result[identity]["width_m"] = width
        except ValueError:
            pass
    return result, rejected


def _distance(p: list, a: list, b: list) -> float:
    dx, dy = b[0] - a[0], b[1] - a[1]
    t = max(0, min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy or 1)))
    return hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)
