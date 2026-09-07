#!/usr/bin/env python3
"""Build an interactive 3D SF corridor map from the metadata catalog."""

from __future__ import annotations

import argparse
import json
import math
import sys
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

import h3
import pyarrow.parquet as pq

from smc.imagery.region import SF_CORRIDOR, BBox

PRECISION = 6


def overpass_query(bbox: BBox) -> str:
    area = f"{bbox.south},{bbox.west},{bbox.north},{bbox.east}"
    return (
        "[out:json][timeout:60];("
        f'way["highway"~"^(primary|secondary|tertiary|residential|service|living_street|footway|pedestrian)$"]({area});'
        f'way["footway"~"^(sidewalk|crossing)$"]({area});'
        f'way["building"]({area});'
        ");out geom;"
    )


def _float_text(value: object) -> float | None:
    if value is None:
        return None
    text = str(value).strip().lower().replace(",", ".")
    if not text:
        return None
    if text.endswith("ft"):
        try:
            return float(text[:-2].strip()) * 0.3048
        except ValueError:
            return None
    if text.endswith("m"):
        text = text[:-1].strip()
    try:
        return float(text)
    except ValueError:
        return None


def _building_height(tags: dict[str, Any]) -> tuple[float, str]:
    height = _float_text(tags.get("height"))
    if height is not None and 2.0 <= height <= 300.0:
        return height, "osm_height"
    levels = _float_text(tags.get("building:levels"))
    if levels is not None and 1.0 <= levels <= 90.0:
        return max(3.2, levels * 3.2), "osm_levels"
    return 10.5, "inferred_default"


def _is_closed(points: list[list[float]]) -> bool:
    return len(points) >= 4 and points[0] == points[-1]


def _centroid(points: list[list[float]]) -> list[float]:
    ring = points[:-1] if _is_closed(points) else points
    lon = sum(point[0] for point in ring) / len(ring)
    lat = sum(point[1] for point in ring) / len(ring)
    return [round(lon, PRECISION), round(lat, PRECISION)]


def fetch_osm(bbox: BBox) -> list[dict[str, Any]]:
    url = "https://overpass-api.de/api/interpreter?" + urllib.parse.urlencode(
        {"data": overpass_query(bbox)}
    )
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "Kerbside/0.1 SF corridor 3D viewer"},
    )
    with urllib.request.urlopen(request, timeout=90) as response:
        data = json.loads(response.read().decode("utf-8"))
    ways = []
    for element in data.get("elements", []):
        geometry = element.get("geometry") or []
        tags = element.get("tags") or {}
        if not geometry:
            continue
        points = [
            [round(p["lon"], PRECISION), round(p["lat"], PRECISION)]
            for p in geometry
            if "lat" in p and "lon" in p
        ]
        if len(points) < 2:
            continue
        if tags.get("building") and _is_closed(points):
            height, height_source = _building_height(tags)
            ways.append(
                {
                    "kind": "building",
                    "name": tags.get("name"),
                    "height_m": round(height, 2),
                    "height_source": height_source,
                    "centroid": _centroid(points),
                    "points": points,
                }
            )
            continue
        kind = (
            "sidewalk"
            if tags.get("footway") == "sidewalk"
            else "crossing"
            if tags.get("footway") == "crossing"
            else "street"
        )
        ways.append(
            {
                "kind": kind,
                "name": tags.get("name"),
                "points": points,
            }
        )
    return ways


def street_intersections(ways: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Named street crossings, for searching by the way people actually describe a place.

    OpenStreetMap splits a way where another meets it, so two streets that cross share a node.
    Hashing the vertices and looking for coordinates used by more than one name finds the
    junctions without any geometric intersection test -- and without inventing crossings where
    a bridge merely passes over a road, which share no node and correctly do not appear.
    """
    at: dict[tuple[float, float], set[str]] = defaultdict(set)
    for way in ways:
        name = way.get("name")
        if way.get("kind") != "street" or not name:
            continue
        for lon, lat in way.get("points") or []:
            at[(round(float(lon), 6), round(float(lat), 6))].add(name)

    seen: set[tuple[str, str]] = set()
    out: list[dict[str, Any]] = []
    for (lon, lat), names in at.items():
        if len(names) < 2:
            continue
        ordered = sorted(names)
        for i, first in enumerate(ordered):
            for second in ordered[i + 1 :]:
                if (first, second) in seen:
                    continue
                seen.add((first, second))
                out.append({"a": first, "b": second, "lon": lon, "lat": lat})
    out.sort(key=lambda row: (row["a"], row["b"]))
    return out


def district_bands() -> list[dict[str, Any]]:
    south, north = SF_CORRIDOR.bbox.south, SF_CORRIDOR.bbox.north
    return [
        {"name": "Marina", "west": -122.4475, "east": -122.4310, "south": 37.7975, "north": north},
        {"name": "Cow Hollow", "west": -122.4475, "east": -122.4235, "south": south, "north": 37.7975},
        {"name": "Russian Hill", "west": -122.4235, "east": -122.4115, "south": south, "north": north},
        {"name": "North Beach", "west": -122.4115, "east": -122.4020, "south": 37.7960, "north": north},
        {"name": "Chinatown", "west": -122.4115, "east": -122.4020, "south": south, "north": 37.7960},
        {"name": "Financial District", "west": -122.4020, "east": -122.3920, "south": south, "north": north},
    ]


def h3_boundary(cell: str) -> list[list[float]]:
    return [[round(lon, PRECISION), round(lat, PRECISION)] for lat, lon in h3.cell_to_boundary(cell)]


def _cell_resolution(cells: set[str]) -> int:
    if not cells:
        return 10
    return h3.get_resolution(next(iter(cells)))


def _feature_is_covered(feature: dict[str, Any], cells: set[str], resolution: int) -> bool:
    if not cells:
        return False
    sample_points = list(feature.get("points") or [])
    centroid = feature.get("centroid")
    if centroid:
        sample_points.append(centroid)
    for lon, lat in sample_points[:: max(1, len(sample_points) // 8)]:
        if h3.latlng_to_cell(lat, lon, resolution) in cells:
            return True
    return False


def annotate_osm_features(
    ways: list[dict[str, Any]], coverage: list[dict[str, Any]]
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    covered_cells = {
        row["coverage_cell"]
        for row in coverage
        if row.get("eligible_observations", 0) > 0
    }
    resolution = _cell_resolution(covered_cells)
    annotated = []
    height_sources = Counter()
    for feature in ways:
        item = dict(feature)
        item["covered"] = _feature_is_covered(item, covered_cells, resolution)
        if item.get("kind") == "building":
            height_sources[item.get("height_source") or "unknown"] += 1
        annotated.append(item)
    counts = Counter(item.get("kind") for item in annotated)
    covered_counts = Counter(item.get("kind") for item in annotated if item.get("covered"))
    return annotated, {
        "features": dict(counts),
        "covered_features": dict(covered_counts),
        "building_height_sources": dict(height_sources),
    }


def build_payload(root: Path, ways: list[dict[str, Any]]) -> dict[str, Any]:
    observations = pq.read_table(root / "observations" / "external-000.parquet").to_pylist()
    coverage = pq.read_table(root / "coverage" / "h3.parquet").to_pylist()
    sequences = pq.read_table(root / "sequences" / "external.parquet").to_pylist()
    # A fallback, and only that. This used to be *the* kerb height: one median taken over every
    # measurement in the corridor and built into every kerb in the model, which is how nine
    # thousand lidar slices became a single number. Each way now carries its own measured height
    # where we have one (see annotate_official); this is what a way without one falls back to,
    # and it is deliberately still the measured median rather than the nominal six inches.
    measured = [
        row["curb_height_m"]
        for row in pq.read_table(root / "depth" / "surfaces" / "surface_measurements.parquet").to_pylist()
        if row.get("curb_height_m") and row.get("provenance") == "measured"
    ] if (root / "depth" / "surfaces" / "surface_measurements.parquet").exists() else []
    measured.sort()
    kerb_height_m = measured[len(measured) // 2] if measured else 0.126

    depth_summary_path = root / "depth" / "stats" / "summary.json"
    depth_summary = (
        json.loads(depth_summary_path.read_text(encoding="utf-8"))
        if depth_summary_path.exists()
        else {}
    )
    ways, osm_summary = annotate_osm_features(ways, coverage)
    official_summary = annotate_official(ways, {
        "south": SF_CORRIDOR.bbox.south, "west": SF_CORRIDOR.bbox.west,
        "north": SF_CORRIDOR.bbox.north, "east": SF_CORRIDOR.bbox.east,
    })
    obs_by_sequence: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for obs in observations:
        obs_by_sequence[obs["sequence_uid"]].append(obs)
    sequence_paths = []
    for sequence_uid, rows in obs_by_sequence.items():
        rows.sort(key=lambda r: (r["provider_sequence_index"] is None, r["provider_sequence_index"] or 0))
        eligible_rows = [r for r in rows if r["eligible"]]
        if len(eligible_rows) < 2:
            continue
        sequence_paths.append(
            {
                "id": sequence_uid,
                "provider": eligible_rows[0]["provider"],
                "points": [
                    [round(r["longitude"], PRECISION), round(r["latitude"], PRECISION)]
                    for r in eligible_rows[:: max(1, len(eligible_rows) // 90)]
                ],
            }
        )
    sample_observations = [
        {
            "id": row["observation_uid"],
            "provider": row["provider"],
            "lon": round(row["longitude"], PRECISION),
            "lat": round(row["latitude"], PRECISION),
            "heading": row["heading_deg"],
            "mp": row["original_megapixels"],
            "tier": row["resolution_tier"],
            "projection": row["projection_type"],
            "eligible": row["eligible"],
        }
        for row in observations[:: max(1, len(observations) // 4500)]
    ]
    return {
        "summary": {
            "observations": len(observations),
            "eligible": sum(1 for row in observations if row["eligible"]),
            "sequences": len(sequences),
            "coverage_cells": len(coverage),
            "providers": dict(Counter(row["provider"] for row in observations)),
            "osm": osm_summary,
            "cv_depth": depth_summary,
        },
        "bbox": {
            "south": SF_CORRIDOR.bbox.south,
            "west": SF_CORRIDOR.bbox.west,
            "north": SF_CORRIDOR.bbox.north,
            "east": SF_CORRIDOR.bbox.east,
        },
        "kerb_height_m": round(kerb_height_m, 4),
        "official": official_summary,
        "facades": photo_facades(),
        "intersections": street_intersections(ways),
        "districts": district_bands(),
        "ways": ways,
        "coverage": [
            {
                "cell": row["coverage_cell"],
                "lat": row["latitude"],
                "lon": row["longitude"],
                "score": row["coverage_score"],
                "eligible": row["eligible_observations"],
                "total": row["total_observations"],
                "providers": row["unique_providers"],
                "mp": row["median_source_megapixels"],
                "boundary": h3_boundary(row["coverage_cell"]),
            }
            for row in coverage
        ],
        # A gap is a mapped street or footway whose ground nobody has photographed. It is
        # computed from the same cells the coverage layer uses, so the two cannot disagree: a
        # way is a gap exactly when none of the cells it passes through holds an eligible
        # observation. This is the layer that says where to send someone next.
        "gaps": [
            {"points": way["points"], "kind": way.get("kind"), "name": way.get("name")}
            for way in ways
            if way.get("kind") in ("street", "sidewalk", "crossing") and not way.get("covered")
        ],
        "observations": sample_observations,
        "sequence_paths": sequence_paths[:260],
    }


FACADE_ROOT = Path(__file__).resolve().parents[1] / "docs" / "facades"


def photo_facades() -> dict:
    """The walls that are photographs rather than procedural texture.

    Each one carries its own two endpoints, its outward bearing and how far up the cameras
    actually saw, so the map can hang a panel on it without having to match it back to a
    building. That matters: the building list is rebuilt from OpenStreetMap on every run and
    its indices are not stable, while a wall's two corners are the wall.
    """
    grid_path = FACADE_ROOT.parent / "sf-corridor-chunks.json"
    grid = json.loads(grid_path.read_text()) if grid_path.exists() else {"chunks": []}
    chunks = []
    walls = []
    for manifest_path in sorted(FACADE_ROOT.glob("*/manifest.json")):
        manifest = json.loads(manifest_path.read_text())
        key = manifest["chunk"]
        chunks.append({
            "key": key,
            "bbox": manifest["bbox"],
            "buildings": manifest.get("buildings_in_chunk", 0),
            "attempted": manifest.get("walls_attempted", 0),
            "textured": manifest.get("walls_textured", 0),
            "licenses": manifest.get("licenses", {}),
        })
        for wall in manifest["walls"]:
            walls.append({
                "c": key,
                "t": wall["texture"],
                "a": wall["a"],
                "b": wall["b"],
                "h": wall["photo_height_m"],
                "n": wall.get("normal_deg", 0.0),
            })
    done = {c["key"] for c in chunks}
    return {
        "chunks": chunks,
        "walls": walls,
        # The whole grid, so the map can show what has been done against what has not. A chunk
        # with a high readiness and no textures is the next one worth running.
        "grid": [
            {"k": c["key"], "w": c["west"], "s": c["south"], "e": c["east"], "n": c["north"],
             "b": c["buildings"], "o": c["observations"], "r": c["readiness"],
             "d": 1 if c["key"] in done else 0}
            for c in grid["chunks"]
        ],
    }


OFFICIAL = Path(__file__).resolve().parents[1] / "data" / "sf_public_works"
#: How near an inventory point has to be to the middle of a crossing way to be that crossing.
#: Generous enough for the offset between where the city drops the point and where OSM draws
#: the way, tight enough not to reach the next arm of the intersection.
CROSSWALK_MATCH_M = 20.0
#: How far behind a dropped kerb the building it serves may stand. A footway and a small
#: setback; beyond this the cut serves a yard or a lot rather than a garage.
GARAGE_REACH_M = 22.0


def _outward_bearing(ring, a, b) -> float:
    """Compass bearing of the outward normal of the wall from ``a`` to ``b``.

    The side of a wall that faces the street is not something the pair of endpoints can settle
    on its own: it depends on which way round the footprint was wound. Getting it wrong turns a
    garage door to face into the building, and a plane seen edge-on from the street reads as a
    grey slab standing on the pavement -- which is exactly what it did.
    """
    total = 0.0
    for i in range(len(ring)):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % len(ring)]
        total += (x1 * y2 - x2 * y1)
    winding = 1.0 if total > 0 else -1.0
    dx = (b[0] - a[0]) * 88_000.0
    dy = (b[1] - a[1]) * 111_320.0
    length = math.hypot(dx, dy)
    if length < 1e-9:
        return 0.0
    nx, ny = (dy / length) * winding, (-dx / length) * winding
    return math.degrees(math.atan2(nx, ny)) % 360.0


def _project_fraction(a, b, point) -> float:
    """Where along a wall a point falls, 0 at ``a`` and 1 at ``b``."""
    ax = (b[0] - a[0]) * 88_000.0
    ay = (b[1] - a[1]) * 111_320.0
    length_squared = ax * ax + ay * ay
    if length_squared < 1e-9:
        return 0.5
    px = (point[0] - a[0]) * 88_000.0
    py = (point[1] - a[1]) * 111_320.0
    return max(0.0, min(1.0, (px * ax + py * ay) / length_squared))


def annotate_official(ways: list[dict[str, Any]], bbox: dict) -> dict[str, Any]:
    """Hang San Francisco's own recorded geometry on the ways we drew from OpenStreetMap.

    Everything the city publishes is keyed to a CNN, so each way is matched to the centreline
    it runs along and inherits that segment's recorded right of way, its surveyed footway width
    and -- from our own lidar rather than from any record, because no record carries one -- the
    curb height measured on that block.

    The last of those is the point of the exercise. The model used to take one median curb
    height, 126 mm, and build every kerb in San Francisco to it, which threw away nine thousand
    measurements to keep one number. A kerb outside a 1920s apartment block and a kerb at a
    rebuilt corner are not the same height and there was no way to tell from the model.
    """
    import sys

    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
    from smc.facades.geometry import LocalFrame
    from smc.official.join import CentrelineIndex

    segments_path = OFFICIAL / "segments.json"
    centrelines_path = OFFICIAL / "centrelines.json"
    if not (segments_path.exists() and centrelines_path.exists()):
        return {"available": False}

    segments = {row["feature_id"]: row for row in json.loads(segments_path.read_text())}
    # Carriageway measured across the city's own curb lines, and which streets are one-way.
    attributes_path = OFFICIAL / "street_attributes.json"
    attributes = json.loads(attributes_path.read_text()) if attributes_path.exists() else {}
    # The city's inventory of which crossings are continental. Everything else that is marked
    # is two transverse lines, and the model has been painting ladders on all of them.
    crosswalks_path = OFFICIAL / "crosswalks.json"
    crosswalks = json.loads(crosswalks_path.read_text()) if crosswalks_path.exists() else []
    cuts_path = OFFICIAL / "curb_cuts.json"
    curb_cuts = json.loads(cuts_path.read_text()) if cuts_path.exists() else []
    # Colours sampled off photographs of each building, keyed by its index among the covered
    # buildings -- which is how the sampler enumerated them.
    colours_path = OFFICIAL / "building_colours.json"
    colours = json.loads(colours_path.read_text()) if colours_path.exists() else {}
    crosswalk_cells: dict[tuple[int, int], list[dict]] = defaultdict(list)
    for crosswalk in crosswalks:
        lon, lat = crosswalk["p"]
        crosswalk_cells[(int(lon * 2000), int(lat * 2000))].append(crosswalk)
    frame = LocalFrame((bbox["south"] + bbox["north"]) / 2.0,
                       (bbox["west"] + bbox["east"]) / 2.0)
    index = CentrelineIndex.from_centrelines(json.loads(centrelines_path.read_text()), frame)

    counts = Counter()
    for way in ways:
        if way.get("kind") not in ("street", "sidewalk", "crossing"):
            continue
        placed = index.locate_way(way["points"])
        if placed is None:
            counts["unmatched"] += 1
            continue
        feature, side, distance = placed
        record = segments.get(feature)
        if record is None:
            counts["no record"] += 1
            continue
        way["cnn"] = feature
        way["cnn_name"] = record.get("name") or None
        counts["matched"] += 1

        if record.get("right_of_way_m"):
            way["row_m"] = record["right_of_way_m"]
            counts["with right of way"] += 1
        # The survey records a side where it knows one and "both" otherwise; a footway takes
        # the width for its own side of the street, never the other one's.
        walks = record.get("sidewalk_m") or {}
        width = walks.get(str(side)) or walks.get("0")
        if width:
            way["walk_m"] = width
            counts["with surveyed footway"] += 1
        if record.get("curb_height_m"):
            way["kerb_m"] = record["curb_height_m"]
            way["kerb_n"] = record.get("curb_height_n")
            way["kerb_sigma_m"] = record.get("curb_height_sigma_m")
            counts["with measured curb"] += 1
        if record.get("accepted_on"):
            way["accepted_on"] = record["accepted_on"]

        attribute = attributes.get(feature) or {}
        if attribute.get("oneway"):
            way["oneway"] = attribute["oneway"]
            counts["one-way"] += 1

        # The carriageway, in order of how directly it was measured.
        #
        # First choice is the distance between the city's two mapped curb faces, read every two
        # metres along the street. That is the width itself rather than an inference from it,
        # and it carries the bulb-outs and turning pockets that no single number can.
        #
        # Second choice is the right of way with both footways taken out of it. Where the survey
        # never measured the footway it is taken as a share of the right of way rather than a
        # fixed three metres: on a six-metre alley a fixed three would leave no roadway at all,
        # and clamping the roadway back up would make it wider than the right of way holding it.
        row_m = record.get("right_of_way_m")
        if attribute.get("record_row_m"):
            row_m = attribute["record_row_m"]
        if attribute.get("road_m"):
            way["road_m"] = attribute["road_m"]
            way["road_source"] = "curb_geometry"
            way["road_varies_m"] = round(attribute["road_p90_m"] - attribute["road_p10_m"], 2)
            counts["carriageway from curb lines"] += 1
        elif row_m:
            walk = way.get("walk_m") or min(3.0, row_m * 0.18)
            way["road_m"] = round(max(2.5, row_m - 2.0 * walk), 3)
            way["road_source"] = "row_minus_footways"
            counts["carriageway from right of way"] += 1
            if not way.get("walk_m"):
                way["walk_fallback_m"] = round(walk, 3)

    # -- which crossings are continental ----------------------------------------------------
    #
    # One inventory point marks one crossing, so the assignment has to be one to one. Matching
    # every crossing within reach of any point instead marked 2,383 of 2,517 as continental,
    # because a four-armed intersection with one ladder crossing has three other crossings
    # standing twenty metres from the same point.
    crossings = [w for w in ways if w.get("kind") == "crossing" and w.get("points")]
    crossing_cells: dict[tuple[int, int], list[int]] = defaultdict(list)
    for i, way in enumerate(crossings):
        centre = way["points"][len(way["points"]) // 2]
        crossing_cells[(int(centre[0] * 2000), int(centre[1] * 2000))].append(i)

    # Every plausible pairing, then the closest ones first. Walking the inventory in its own
    # order and giving each point its nearest free crossing let an early point take a crossing
    # that a later one was almost on top of, and 623 points ended up matching nothing.
    candidates = []
    for c, crosswalk in enumerate(crosswalks):
        lon, lat = crosswalk["p"]
        key = (int(lon * 2000), int(lat * 2000))
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for i in crossing_cells.get((key[0] + dx, key[1] + dy), ()):
                    centre = crossings[i]["points"][len(crossings[i]["points"]) // 2]
                    metres = math.hypot((centre[0] - lon) * 88_000.0,
                                        (centre[1] - lat) * 111_320.0)
                    if metres <= CROSSWALK_MATCH_M:
                        candidates.append((metres, c, i))
    candidates.sort()
    claimed: set[int] = set()
    used_points: set[int] = set()
    for _metres, c, i in candidates:
        if i in claimed or c in used_points:
            continue
        claimed.add(i)
        used_points.add(c)
        crossings[i]["continental"] = True
        if crosswalks[c].get("year"):
            crossings[i]["crosswalk_year"] = crosswalks[c]["year"]
    counts["crosswalk matched no crossing"] = len(crosswalks) - len(used_points)
    counts["continental crossing"] = len(claimed)
    counts["plain crossing"] = len(crossings) - len(claimed)

    # -- which sides of a street actually have room for a footway ---------------------------
    #
    # A footway derived from the centreline appears on both sides of every roadway, and on a
    # divided street OpenStreetMap draws each direction as its own way -- so the inner footway
    # of one carriageway lands in the middle of the other, and a boulevard came out with a
    # strip of pavement running down it where the centre line should be.
    #
    # A side is dropped when the ground it would occupy is inside some *other* street's
    # carriageway. Nothing else can tell the difference: the two ways are both roads, both
    # legitimate, and only their geometry says one of them is already paved.
    street_grid: dict[tuple[int, int], list[tuple]] = defaultdict(list)
    roadways = [w for w in ways if w.get("kind") == "street" and w.get("points")]
    for way in roadways:
        half = (way.get("road_m") or 8.0) / 2.0
        for lon, lat in way["points"]:
            street_grid[(int(lon * 2500), int(lat * 2500))].append((id(way), lon, lat, half))

    dropped_sides = 0
    for way in roadways:
        half = (way.get("road_m") or 8.0) / 2.0
        walk = way.get("walk_m") or way.get("walk_fallback_m") or 3.0
        offset = half + walk / 2.0
        keep = []
        points = way["points"]
        samples = points[:: max(1, len(points) // 4)] or points
        for side in (1, -1):
            blocked = 0
            for i, (lon, lat) in enumerate(samples):
                nxt = samples[min(i + 1, len(samples) - 1)]
                dx = (nxt[0] - lon) * 88_000.0
                dy = (nxt[1] - lat) * 111_320.0
                length = math.hypot(dx, dy)
                if length < 1e-6:
                    continue
                # A point out on the footway, in degrees.
                px = lon + side * (-dy / length) * offset / (88_000.0)
                py = lat + side * (dx / length) * offset / 111_320.0
                cell = (int(px * 2500), int(py * 2500))
                for ddx in (-1, 0, 1):
                    for ddy in (-1, 0, 1):
                        for other_id, olon, olat, ohalf in street_grid.get(
                                (cell[0] + ddx, cell[1] + ddy), ()):
                            if other_id == id(way):
                                continue
                            metres = math.hypot((olon - px) * 88_000.0,
                                                (olat - py) * 111_320.0)
                            if metres < ohalf + 1.0:
                                blocked += 1
                                break
                        else:
                            continue
                        break
            if blocked * 2 <= len(samples):
                keep.append(side)
            else:
                dropped_sides += 1
        if len(keep) < 2:
            way["walk_sides"] = keep
    counts["footway sides inside another roadway"] = dropped_sides

    # -- curb cuts, and the garages behind them ----------------------------------------------
    #
    # A dropped kerb exists because something drives across the footway there, and the thing it
    # drives into is the building on the other side. The model has been drawing those buildings
    # with a solid ground floor and an unbroken kerb in front of them.
    #
    # The width is the city's own: a 13 ft cut is one car and a 26 ft cut is a pair of doors,
    # so the opening is sized rather than assumed.
    covered_index = 0
    for way in ways:
        if way.get("kind") != "building" or not way.get("covered"):
            continue
        sampled = colours.get(str(covered_index))
        covered_index += 1
        if sampled:
            way["colour"] = sampled["c"]
            way["colour_views"] = sampled["n"]
            counts["colour from a photograph"] += 1
    counts["colour still invented"] = covered_index - counts["colour from a photograph"]

    walls_index: dict[tuple[int, int], list[tuple]] = defaultdict(list)
    for index, way in enumerate(ways):
        if way.get("kind") != "building" or not way.get("covered"):
            continue
        points = way["points"]
        for i in range(len(points) - 1):
            a, b = points[i], points[i + 1]
            mid = ((a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0)
            walls_index[(int(mid[0] * 3000), int(mid[1] * 3000))].append((index, a, b, mid))

    garages = 0
    unmatched_cuts = 0
    for cut in curb_cuts:
        points = cut["p"]
        centre = points[len(points) // 2]
        key = (int(centre[0] * 3000), int(centre[1] * 3000))
        needed = cut.get("m") or 3.5
        best = roomy = None
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for candidate in walls_index.get((key[0] + dx, key[1] + dy), ()):
                    _index, a, b, mid = candidate
                    metres = math.hypot((mid[0] - centre[0]) * 88_000.0,
                                        (mid[1] - centre[1]) * 111_320.0)
                    if metres > GARAGE_REACH_M:
                        continue
                    if best is None or metres < best[0]:
                        best = (metres, candidate)
                    # A frontage wide enough to hold the opening. Taking the nearest wall alone
                    # put doors on chamfered corners two metres long, which then clamped the
                    # opening down to something narrower than the kerb the city cut for it.
                    length = math.hypot((b[0] - a[0]) * 88_000.0, (b[1] - a[1]) * 111_320.0)
                    if length >= max(2.5, needed * 0.9) and (roomy is None or metres < roomy[0]):
                        roomy = (metres, candidate)
        chosen = roomy or best
        if chosen is None:
            unmatched_cuts += 1
            continue
        _metres, (index, a, b, mid) = chosen
        way = ways[index]
        # Placed at the point of the wall nearest the cut, and no wider than the wall it is in.
        length = math.hypot((b[0] - a[0]) * 88_000.0, (b[1] - a[1]) * 111_320.0)
        width = min(needed, max(2.0, length * 0.9))
        way.setdefault("garages", []).append({
            "a": [round(a[0], 7), round(a[1], 7)],
            "b": [round(b[0], 7), round(b[1], 7)],
            "t": round(_project_fraction(a, b, centre), 4),
            "w": round(width, 2),
            "n": round(_outward_bearing(way["points"], a, b), 1),
            # Where the kerb was actually cut, so the apron can be laid between there and the
            # door rather than guessed at from the door alone.
            "cp": [round(centre[0], 7), round(centre[1], 7)],
            # A seed so a building keeps the same door between reloads, and two garages on one
            # building do not both get the same one.
            "s": (index * 31 + int(centre[0] * 1e5)) % 100000,
        })
        garages += 1
    counts["garage openings"] = garages
    counts["curb cuts with no building"] = unmatched_cuts

    return {"available": True, "counts": dict(counts),
            "segments": len(segments),
            "curb_measured_segments": sum(1 for a in attributes.values() if "road_m" in a),
            "distinct_curb_heights": len({w["kerb_m"] for w in ways if w.get("kerb_m")})}


HTML = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Kerbside SF Corridor 3D</title>
<style>
:root { color-scheme: dark; --bg:#071013; --panel:#10191e; --line:#274048; --ink:#edf5f5; --muted:#8fa4a6; --pink:#ff4d8f; --green:#4fbe86; --amber:#e0a84e; --cyan:#54c8e8; }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--ink); font-family:Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; overflow:hidden; }
#scene { position:fixed; inset:0; display:block; width:100vw; height:100vh; }
.hud { position:fixed; top:14px; left:14px; bottom:14px; width:min(340px, calc(100vw - 28px)); display:flex; flex-direction:column; gap:10px; pointer-events:none; }
/* The panel takes the column it is given rather than shrinking to its contents, so the
   sections breathe instead of being packed against the title. */
.hud .panel { flex:1; overflow:auto; padding:16px; display:flex; flex-direction:column; gap:2px; }
.hud[data-open="false"] .panel { flex:0 0 auto; padding:12px 16px; }
#find { width:100%; padding:9px 10px; border-radius:7px; border:1px solid var(--line);
        background:rgba(7,16,19,.75); color:var(--ink); font:inherit; }
#find::placeholder { color:var(--muted); }
#hits { list-style:none; margin:6px 0 0; padding:0; max-height:190px; overflow:auto; }
#hits li { padding:7px 9px; border-radius:6px; cursor:pointer; font-size:13px; color:var(--muted); }
#hits li:hover, #hits li[aria-selected=true] { background:rgba(255,77,143,.16); color:var(--ink); }
/* Collapsing targets the sections themselves rather than one wrapper. The wrapper closes
   where the original panel did, which left the layer groups outside it and folding hid
   only the statistics. */
.hud[data-open="false"] .collapsible, .hud[data-open="false"] .group { display:none; }
.bar { pointer-events:auto; display:flex; align-items:center; gap:8px; }
.bar h1 { flex:1; margin:0; }
#fold { padding:6px 10px; line-height:1; }
.group { margin-top:12px; }
.group > h2 { margin:0 0 7px; font-size:11px; letter-spacing:.08em; text-transform:uppercase; color:var(--muted); font-weight:600; }
.panel { pointer-events:auto; background:rgba(16,25,30,.88); border:1px solid var(--line); border-radius:8px; padding:12px; backdrop-filter:blur(14px); box-shadow:0 12px 30px rgba(0,0,0,.22); }
h1 { margin:0 0 8px; font-size:18px; line-height:1.1; font-weight:700; letter-spacing:0; }
.meta { display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:8px; }
.stat { border:1px solid var(--line); border-radius:7px; padding:8px; min-width:0; }
.stat b { display:block; font-size:17px; font-variant-numeric:tabular-nums; }
.stat span { color:var(--muted); font-size:10px; text-transform:uppercase; }
.legend { display:flex; flex-wrap:wrap; gap:8px; margin-top:10px; color:var(--muted); font-size:12px; }
.key { display:inline-flex; align-items:center; gap:6px; white-space:nowrap; }
.sw { width:10px; height:10px; border-radius:50%; background:var(--pink); }
.toolbar { display:flex; flex-wrap:wrap; gap:7px; }
.toolbar button { padding:8px 10px; font-size:13px; }
button { color:var(--ink); background:rgba(16,25,30,.9); border:1px solid var(--line); border-radius:7px; padding:10px 12px; font:inherit; cursor:pointer; }
button[aria-pressed=true] { border-color:var(--pink); color:#fff; background:rgba(255,77,143,.20); }
/* Clear of the sidebar, which takes the whole left column when it is open. The tip used to
   start at the same 14px and simply print itself over the panel's lower half. */
#tip { position:fixed; left:368px; bottom:14px; width:min(520px, calc(100vw - 382px)); color:var(--muted); font-size:12px; }
@media (max-width: 760px) {
  .hud { width:calc(100vw - 28px); bottom:auto; max-height:70vh; }
  .meta { grid-template-columns:repeat(2, 1fr); }
  #tip { left:14px; width:calc(100vw - 28px); }
}
</style>
</head>
<body>
<canvas id="scene"></canvas>
<div class="hud" id="hud" data-open="true">
  <div class="panel">
    <div class="bar">
      <h1>Kerbside SF Corridor 3D</h1>
      <button id="fold" aria-expanded="true" aria-controls="hud" title="Collapse">&minus;</button>
    </div>
    <div class="collapsible">
    <div class="group" style="margin-top:4px">
      <h2>Go to a corner</h2>
      <input id="find" type="search" autocomplete="off" placeholder="Columbus &amp; Broadway" />
      <ul id="hits"></ul>
    </div>
    <div class="meta">
      <div class="stat"><b id="obs">0</b><span>observations</span></div>
      <div class="stat"><b id="eligible">0</b><span>eligible</span></div>
      <div class="stat"><b id="seq">0</b><span>sequences</span></div>
      <div class="stat"><b id="cells">0</b><span>H3 cells</span></div>
      <div class="stat"><b id="surfaces">0</b><span>surfaces</span></div>
      <div class="stat"><b id="measured">0</b><span>measured curb</span></div>
    </div>
<div class="legend">
<span class="key"><span class="sw" style="background:#d6e7ea"></span>OSM street map</span>
<span class="key"><span class="sw" style="background:#9fb4bb"></span>covered 3D buildings</span>
<span class="key"><span class="sw" style="background:#ff4d8f"></span>curb bands</span>
<span class="key"><span class="sw" style="background:#ffffff"></span>CV/depth backlog</span>
<span class="key"><span class="sw"></span>metadata observations</span>
<span class="key"><span class="sw" style="background:var(--green)"></span>high coverage cells</span>
<span class="key"><span class="sw" style="background:var(--amber)"></span>crossings</span>
      <span class="key"><span class="sw" style="background:var(--cyan)"></span>sequence paths</span>
    </div>
  </div>
    <div class="group">
      <h2>Layers</h2>
      <div class="toolbar">
        <button data-layer="streets" aria-pressed="true">Streets</button>
        <button data-layer="mapped3d" aria-pressed="true">3D Artifact</button>
        <button data-layer="coverage" aria-pressed="true">Coverage</button>
        <button data-layer="observations" aria-pressed="true">Photos</button>
        <button data-layer="sequences" aria-pressed="true">Sequences</button>
        <button data-layer="kerbs" aria-pressed="true">Measured kerbs</button>
        <button data-layer="facades" aria-pressed="true">Photo facades</button>
        <button data-layer="official" aria-pressed="false">Official geometry</button>
        <button data-layer="chunks" aria-pressed="false">Chunks</button>
        <button data-layer="districts" aria-pressed="true">Districts</button>
      </div>
    </div>
    <div class="group">
      <h2>Where coverage is missing</h2>
      <div class="toolbar">
        <button data-layer="gaps" aria-pressed="false">Show gaps</button>
        <button id="reset">Reset view</button>
      </div>
      <p id="gapnote" style="margin:8px 0 0;color:var(--muted);font-size:12px;line-height:1.45"></p>
      <p id="facadenote" style="margin:10px 0 0;color:var(--muted);font-size:11px;line-height:1.5"></p>
      <p id="officialnote" style="margin:10px 0 0;color:var(--muted);font-size:11px;line-height:1.5"></p>
    </div>
    </div>
  </div>
</div>
<div id="tip"><b>Click anywhere to go there</b> &mdash; the grey sphere is you, and arriving brings the camera down to street level. Arrow keys walk it at 15&nbsp;mph, relative to the way you are facing. Drag to orbit, wheel or pinch to zoom. The survey layers are off by default: turn them on for where photographs were taken, which blocks are covered, and which streets nobody has captured yet.</div>
<!-- The payload is fetched rather than inlined. At ten megabytes it dominated the repository:
     eight rebuilds cost 82 MB of history, because a rewritten binary never deduplicates against
     its previous version. Fetched, the page is a few kilobytes, the data changes independently,
     and browsers cache it between visits. -->
<script type="module">
import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";

const DATA = await fetch("sf-corridor-3d.json", { cache: "no-cache" }).then((r) => {
  if (!r.ok) throw new Error(`payload ${r.status}`);
  return r.json();
});
document.getElementById("obs").textContent = DATA.summary.observations.toLocaleString();
document.getElementById("eligible").textContent = DATA.summary.eligible.toLocaleString();
document.getElementById("seq").textContent = DATA.summary.sequences.toLocaleString();
document.getElementById("cells").textContent = DATA.summary.coverage_cells.toLocaleString();
document.getElementById("surfaces").textContent = (DATA.summary.cv_depth.surface_rows || 0).toLocaleString();
document.getElementById("measured").textContent = (DATA.summary.cv_depth.measured_curb_height_count || 0).toLocaleString();

const canvas = document.getElementById("scene");
// A logarithmic depth buffer, because this scene spans five orders of magnitude: a 126 mm kerb
// has to stay distinct from the road it sits on while a two-kilometre corridor is on screen. With
// the ordinary buffer, precision falls with the square of distance -- at a thousand metres it is
// about 0.6 m, and street markings separated by two centimetres flickered in and out as the
// depth test picked a different winner each frame.
const renderer = new THREE.WebGLRenderer({
  canvas, antialias: true, alpha: false, logarithmicDepthBuffer: true,
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
// Without tone mapping the renderer clips: anything the lights push past 1.0 lands on pure
// white and everything above that threshold flattens into the same colour. With a bright sky
// and a bright sun that was most of the ground, which is why making the carriageway texture
// darker changed almost nothing on screen -- the surface was already saturated and the extra
// darkness was being clipped away before it could be seen. Filmic tone mapping rolls the
// highlights off instead, so the difference between a near-black road and a mid-grey footway
// survives to the pixel.
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x071013);
scene.fog = new THREE.Fog(0x071013, 650, 1900);

// The near plane is the other half of the depth problem: precision scales with it, and 0.1 m
// bought nothing since the camera never comes closer than a few metres to anything.
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.5, 6000);
// The measured median kerb, in metres: 9,376 lidar slices, cross-checked against Waymo
// ground-level lidar to within 1 mm of median. The model is built to it rather than to nominal.
//: What a way falls back to when nothing has measured its kerb. Not a standard six inches --
//: the median of everything the lidar did measure in this corridor.
const KERB_FALLBACK = DATA.kerb_height_m || 0.126;

const root = new THREE.Group();
scene.add(root);
const groups = {
  streets: new THREE.Group(),
  mapped3d: new THREE.Group(),
  coverage: new THREE.Group(),
  observations: new THREE.Group(),
  sequences: new THREE.Group(),
  districts: new THREE.Group(),
  kerbs: new THREE.Group(),
  facades: new THREE.Group(),
  official: new THREE.Group(),
  chunks: new THREE.Group(),
  gaps: new THREE.Group(),
};
// What opens is the city: streets, buildings, districts. The survey layers -- where photographs
// were taken, which cells are covered, which sequences ran, which ways are missing -- are all
// about the state of the dataset rather than about the place, and starting with them lit turns
// a map of San Francisco into a progress chart. They are one click away and they stay.
for (const off of ["coverage", "observations", "sequences", "gaps", "kerbs", "chunks",
                   "official"]) {
  groups[off].visible = false;
}
Object.values(groups).forEach((g) => root.add(g));

const bbox = DATA.bbox;
const midLat = (bbox.south + bbox.north) / 2;
const midLon = (bbox.west + bbox.east) / 2;
const metersPerLat = 111320;
const metersPerLon = metersPerLat * Math.cos(midLat * Math.PI / 180);
function xy(lon, lat) { return [(lon - midLon) * metersPerLon, (lat - midLat) * metersPerLat]; }
function v3(lon, lat, z = 0) { const [x, y] = xy(lon, lat); return new THREE.Vector3(x, z, -y); }

// A procedural sky, generated once into an environment map. Without one, a metallic material
// reflects nothing and renders black -- which is why "make it look like glass" is really "give
// it something to be a mirror of".
function skyEnvironment(renderer) {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const sky = ctx.createLinearGradient(0, 0, 0, size);
  sky.addColorStop(0.0, "#0a1620");
  sky.addColorStop(0.45, "#38566a");
  sky.addColorStop(0.52, "#8fa9b8");
  sky.addColorStop(1.0, "#141c20");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromEquirectangular(texture).texture;
  pmrem.dispose();
  texture.dispose();
  return environment;
}

scene.environment = skyEnvironment(renderer);
// Turned down with the tone mapper in place: the old pair were set to be bright enough to read
// through the clipping, and left as they were they simply saturate a wider part of the scene.
const amb = new THREE.HemisphereLight(0xb7f5ff, 0x071013, 1.15);
scene.add(amb);
const sun = new THREE.DirectionalLight(0xfff4e2, 2.0);
sun.position.set(-420, 700, 300);
scene.add(sun);

const [westX, northY] = xy(bbox.west, bbox.north);
const [eastX, southY] = xy(bbox.east, bbox.south);
const width = eastX - westX;
const depth = northY - southY;
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(width, depth, 1, 1),
  new THREE.MeshStandardMaterial({ color: 0x0c171b, roughness: 0.96, metalness: 0.02 })
);
ground.rotation.x = -Math.PI / 2;
root.add(ground);

function line(points, color, opacity = 1, y = 2, widthHint = 1) {
  const geom = new THREE.BufferGeometry().setFromPoints(points.map((p) => v3(p[0], p[1], y)));
  const mat = new THREE.LineBasicMaterial({
    color, transparent: opacity < 1, opacity,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  });
  const obj = new THREE.Line(geom, mat);
  obj.userData.widthHint = widthHint;
  return obj;
}

const TILE_CACHE = new Map();
function tiledMap(base, name, repeatU, repeatV) {
  // A box's UVs run 0..1 per face, so one shared texture would stretch its pattern by however
  // long that stretch of road happens to be -- five-foot slabs on a short segment and ribbons
  // on a long one. Each distinct repeat gets a clone, bucketed to the nearest whole tile so a
  // few dozen textures cover thousands of segments. The clone shares the image; only the
  // repeat differs, so this costs almost nothing.
  const u = Math.max(1, Math.round(repeatU));
  const v = Math.max(1, Math.round(repeatV));
  const key = `${name}:${u}x${v}`;
  if (!TILE_CACHE.has(key)) {
    const map = base.clone();
    map.needsUpdate = true;
    map.repeat.set(u, v);
    TILE_CACHE.set(key, map);
  }
  return TILE_CACHE.get(key);
}

function surfaceMap(surface, length, width) {
  if (surface === "walk") return tiledMap(SIDEWALK, "walk", length / SLAB_M, width / SLAB_M);
  if (surface === "road") {
    // Bucketed coarsely: the grain has no structure, so all this decides is how fine it looks.
    return tiledMap(ROAD, "road", Math.round(length / 8), Math.round(width / 8));
  }
  if (surface === "crossing") {
    // The bars run the length of the crossing -- the way people walk -- so the pattern is
    // constant along the way and repeats across its width.
    return tiledMap(CROSSING, "crossing", 1, width / CROSSING_PERIOD_M);
  }
  // One pair of lines for the whole crossing, not one pair per metre.
  if (surface === "crossing_edges") return tiledMap(CROSSING_EDGES, "crossing_edges", 1, 1);
  return null;
}

function segmentRibbon(a, b, width, color, opacity, y, segmentHeight = 1.4, surface = null) {
  const [x1, yy1] = xy(a[0], a[1]);
  const [x2, yy2] = xy(b[0], b[1]);
  const z1 = -yy1;
  const z2 = -yy2;
  const dx = x2 - x1;
  const dz = z2 - z1;
  const length = Math.hypot(dx, dz);
  if (length < 0.8) return null;
  const map = surfaceMap(surface, length, width);
  // A crossing is paint on a road, not a slab: its texture carries its own transparency so the
  // carriageway shows between the bars, and it must not write depth or it hides the road it
  // is painted on.
  const painted = surface === "crossing" || surface === "crossing_edges";
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(length, segmentHeight, width),
    new THREE.MeshStandardMaterial({
      color, opacity, roughness: surface === "road" ? 0.86 : 0.94,
      metalness: 0.02,
      transparent: opacity < 1 || painted,
      alphaTest: painted ? 0.35 : 0,
      map,
    })
  );
  mesh.position.set((x1 + x2) / 2, y, (z1 + z2) / 2);
  mesh.rotation.y = Math.atan2(-dz, dx);
  return mesh;
}

function offsetWay(points, metres) {
  // The same polyline, shifted sideways. Positive is to the left of travel.
  //
  // The footway used to be drawn on whatever centreline OpenStreetMap gave its sidewalk ways,
  // which is not tied to the road at all. Once the carriageway came from the mapped kerbs it
  // was narrower than the right of way it had been derived from, and a strip of bare ground
  // opened between the two along most of the corridor -- black, where the pavement should be.
  // Deriving the footway from the kerb instead means there is nothing for a gap to open in.
  if (points.length < 2) return points;
  const out = [];
  for (let i = 0; i < points.length; i += 1) {
    const before = points[Math.max(0, i - 1)];
    const after = points[Math.min(points.length - 1, i + 1)];
    const [bx, by] = xy(before[0], before[1]);
    const [ax, ay] = xy(after[0], after[1]);
    const dx = ax - bx;
    const dy = ay - by;
    const length = Math.hypot(dx, dy);
    if (length < 1e-6) { out.push(points[i]); continue; }
    const nx = -dy / length;
    const ny = dx / length;
    // Back to degrees, at this latitude.
    out.push([
      points[i][0] + (nx * metres) / (111320 * Math.cos(points[i][1] * Math.PI / 180)),
      points[i][1] + (ny * metres) / 111320,
    ]);
  }
  return out;
}

function trimWay(points, metres) {
  // The same way with both ends pulled back.
  //
  // A footway derived from the centreline runs the full length of its street, intersections
  // included -- so at every crossroads four of them ran out over the carriageway and, sitting
  // a kerb's height above it, buried the road in pavement. Stopping short of the corner is
  // also what a real footway does: the kerb turns the corner rather than crossing it.
  if (points.length < 2) return points;
  let total = 0;
  const spans = [];
  for (let i = 1; i < points.length; i += 1) {
    const [x1, y1] = xy(points[i - 1][0], points[i - 1][1]);
    const [x2, y2] = xy(points[i][0], points[i][1]);
    const span = Math.hypot(x2 - x1, y2 - y1);
    spans.push(span);
    total += span;
  }
  const cut = Math.min(metres, total / 3);
  if (!(cut > 0.2)) return points;

  const walk = (from, direction) => {
    let remaining = cut;
    let i = from;
    while (i >= 0 && i < spans.length) {
      const span = spans[i];
      if (span >= remaining) {
        const t = direction > 0 ? remaining / span : 1 - remaining / span;
        const a = points[i];
        const b = points[i + 1];
        return [i + (direction > 0 ? 0 : 1),
                [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]];
      }
      remaining -= span;
      i += direction;
    }
    return null;
  };
  const head = walk(0, 1);
  const tail = walk(spans.length - 1, -1);
  if (!head || !tail || head[0] >= tail[0]) return points;
  return [head[1], ...points.slice(head[0] + 1, tail[0]), tail[1]];
}

function ribbon(points, width, color, opacity, y, segmentHeight = 1.4, surface = null) {
  const group = new THREE.Group();
  for (let i = 1; i < points.length; i += 1) {
    const segment = segmentRibbon(points[i - 1], points[i], width, color, opacity, y, segmentHeight, surface);
    if (segment) group.add(segment);
  }
  return group;
}

//: A broken centreline in the United States is a ten-foot stripe with a thirty-foot gap. The
//: numbers matter: at any other ratio it stops reading as a road marking and starts reading as
//: a dotted line somebody drew on a map.
const DASH_M = 3.05;
const GAP_M = 9.14;

function dashedLine(points, color, opacity, y) {
  const vertices = points.map((p) => v3(p[0], p[1], y));
  const geom = new THREE.BufferGeometry().setFromPoints(vertices);
  const mat = new THREE.LineDashedMaterial({
    color, transparent: opacity < 1, opacity,
    dashSize: DASH_M, gapSize: GAP_M,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  });
  const obj = new THREE.Line(geom, mat);
  // LineDashedMaterial dashes by distance along the line, and that distance is not computed
  // for you. Without this every dashed line renders solid, which is exactly what it looks like
  // when it silently fails.
  obj.computeLineDistances();
  return obj;
}

function labelSprite(text, color = "#edf5f5", scale = 90) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(7, 16, 19, 0.70)";
  ctx.strokeStyle = "rgba(214, 231, 234, 0.26)";
  ctx.lineWidth = 3;
  roundRect(ctx, 12, 22, 488, 76, 18);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.font = "600 42px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text.slice(0, 28), 256, 62, 450);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.scale.set(scale, scale * 0.25, 1);
  return sprite;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function labelAt(text, lon, lat, y, group, color = "#edf5f5", scale = 90) {
  const sprite = labelSprite(text, color, scale);
  const [x, yy] = xy(lon, lat);
  sprite.position.set(x, y, -yy);
  group.add(sprite);
}

function longestMidpoint(points) {
  let best = null;
  let bestLength = -1;
  for (let i = 1; i < points.length; i += 1) {
    const [x1, y1] = xy(points[i - 1][0], points[i - 1][1]);
    const [x2, y2] = xy(points[i][0], points[i][1]);
    const length = Math.hypot(x2 - x1, y2 - y1);
    if (length > bestLength) {
      bestLength = length;
      best = [(points[i - 1][0] + points[i][0]) / 2, (points[i - 1][1] + points[i][1]) / 2];
    }
  }
  return best;
}

// ---- materials ----
//
// Textures are drawn into a canvas rather than shipped as images: the page is served from a
// repository where every megabyte of binary is a megabyte in every future clone, and a facade
// that is a grid of windows costs a few lines of code and nothing on disk.

function noiseTexture(base, speck, size = 128, density = 0.28) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = speck;
  for (let i = 0; i < size * size * density; i += 1) {
    ctx.globalAlpha = 0.05 + Math.random() * 0.25;
    ctx.fillRect(Math.random() * size, Math.random() * size, 1, 1);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

// San Francisco's building stock, roughly. Wood-frame and stucco dominate the residential
// blocks, concrete the mid-century infill, brick the older commercial streets, and glass the
// downtown towers. These shares are approximate and are meant to make a street look inhabited
// rather than to describe any particular building -- nothing downstream measures them, and the
// provenance of a colour is "invented" wherever anyone asks.
// Every colour here is chosen to sit away from the ambient grey of the ground and the sky. A
// building painted the same value as the air around it reads as wireframe -- the eye takes it
// for the absence of a surface rather than the presence of one.
const MATERIALS = [
  { name: "stucco",   share: 0.40, grit: 0.10, rough: 0.92, metal: 0.02,
    colours: [0xe4d9c2, 0xd9c9a8, 0xcdbfa4, 0xe8dfd0, 0xc8b89c,
              0xb9c4a8,   // pale sage
              0xa8b5a0] },
  { name: "painted",  share: 0.16, grit: 0.14, rough: 0.85, metal: 0.03,
    colours: [0x3f5670,   // dark blue
              0x2f4858, 0x4a6b5a,   // green
              0x6b5744,   // brown
              0x7a4b42, 0x54606b] },
  { name: "concrete", share: 0.18, grit: 0.22, rough: 0.95, metal: 0.02,
    colours: [0xc6cac6, 0xaab0ae, 0x8d9694, 0xd2d6d1] },
  { name: "brick",    share: 0.14, grit: 0.26, rough: 0.94, metal: 0.02,
    colours: [0x9c5540, 0x8a4a38, 0xa9614a, 0x7d4433, 0xb06b52, 0x6f4a3c] },
  { name: "glass",    share: 0.07, grit: 0.03, rough: 0.06, metal: 0.85,
    colours: [0x8fb2c4, 0x7aa0b6, 0xa3c2d0, 0x6d93aa] },
  { name: "metal",    share: 0.05, grit: 0.06, rough: 0.24, metal: 0.95,
    colours: [0xb9c3c8, 0x9aa6ad, 0xc9d2d6, 0x8d989f] },
];

function pickMaterial(seed, height) {
  // Tall buildings are not stucco and short ones are not curtain wall, so the draw is nudged by
  // height before the shares are applied.
  const weights = MATERIALS.map((m) => {
    const modern = m.name === "glass" || m.name === "metal" || m.name === "concrete";
    if (height > 45) return modern ? m.share * 3.5 : m.share * 0.2;
    if (height < 12) return m.name === "glass" || m.name === "metal" ? m.share * 0.12 : m.share;
    return m.share;
  });
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = random(seed) * total;
  for (let i = 0; i < MATERIALS.length; i += 1) {
    roll -= weights[i];
    if (roll <= 0) return MATERIALS[i];
  }
  return MATERIALS[0];
}

// A stable pseudo-random from an integer, so a building keeps its colour between reloads. Math
// .random would repaint the city on every refresh, which reads as flicker rather than variety.
function random(seed) {
  let x = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

function facadeTexture() {
  // One storey tall and one bay wide, tiled. Windows are lit at random so a street of identical
  // extrusions stops reading as identical.
  const w = 64, h = 64;
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#8d9ea4";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "rgba(0,0,0,0.16)";
  ctx.fillRect(0, h - 6, w, 6);                      // the floor line between storeys
  for (const x of [10, 36]) {
    const lit = Math.random() < 0.22;
    ctx.fillStyle = lit ? "rgba(255,226,170,0.85)" : "rgba(24,38,44,0.9)";
    ctx.fillRect(x, 12, 18, 34);
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.strokeRect(x + 0.5, 12.5, 17, 33);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

// A window is not a dark rectangle. It is a recess with a frame, a sill catching light from
// above, and a pane darker at the top than the bottom -- sky reflected at a grazing angle,
// room seen at a steep one. Those three details are most of what makes a facade read.
function pane(ctx, x, y, w, h, lit, seed, options = {}) {
  ctx.fillStyle = "rgba(0,0,0,0.30)";
  ctx.fillRect(x - 2, y - 2, w + 4, h + 4);                  // the reveal
  const glass = ctx.createLinearGradient(0, y, 0, y + h);
  if (lit) {
    glass.addColorStop(0, "rgba(255,224,168,0.92)");
    glass.addColorStop(1, "rgba(214,168,96,0.80)");
  } else {
    glass.addColorStop(0, "rgba(120,150,168,0.85)");
    glass.addColorStop(0.5, "rgba(38,54,64,0.92)");
    glass.addColorStop(1, "rgba(20,30,36,0.95)");
  }
  ctx.fillStyle = glass;
  if (options.arched) {
    // A round head. Drawn as a rectangle capped with a half-disc rather than as a path, which
    // keeps it crisp at sixty-four pixels.
    ctx.fillRect(x, y + w / 2, w, h - w / 2);
    ctx.beginPath();
    ctx.arc(x + w / 2, y + w / 2, w / 2, Math.PI, 0);
    ctx.fill();
  } else {
    ctx.fillRect(x, y, w, h);
  }
  ctx.fillStyle = "rgba(255,255,255,0.30)";
  ctx.fillRect(x - 2, y + h, w + 4, 2);                      // the sill
  ctx.strokeStyle = "rgba(255,255,255,0.16)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  for (const bar of options.bars || []) {
    ctx.beginPath();
    if (bar.vertical) { ctx.moveTo(x + w * bar.at, y); ctx.lineTo(x + w * bar.at, y + h); }
    else { ctx.moveTo(x, y + h * bar.at); ctx.lineTo(x + w, y + h * bar.at); }
    ctx.stroke();
  }
}

//: A dozen ways a San Francisco facade arranges its openings. The city is bay windows, sash
//: pairs and the odd punched warehouse wall, and drawing every building with the same two
//: sash windows made a street of identical houses -- which is the one thing San Francisco's
//: streets are not.
const WINDOW_STYLES = [
  function pairSash(ctx, seed) {
    for (const x of [9, 35]) {
      pane(ctx, x, 12, 18, 32, random(seed + x) < 0.16, seed,
           { bars: [{ vertical: false, at: 0.5 }] });
    }
  },
  function singleWide(ctx, seed) {
    pane(ctx, 8, 14, 46, 28, random(seed + 3) < 0.18, seed,
         { bars: [{ vertical: true, at: 0.5 }] });
  },
  function triple(ctx, seed) {
    for (const x of [7, 25, 43]) pane(ctx, x, 14, 13, 30, random(seed + x) < 0.14, seed);
  },
  function bayWindow(ctx, seed) {
    // The city's signature. The returns either side are shaded, which is what gives it depth.
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.fillRect(6, 8, 50, 40);
    pane(ctx, 20, 12, 24, 32, random(seed + 5) < 0.2, seed);
    pane(ctx, 9, 14, 9, 28, random(seed + 9) < 0.12, seed);
    pane(ctx, 46, 14, 9, 28, random(seed + 13) < 0.12, seed);
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    ctx.fillRect(5, 47, 54, 3);                              // the bay's own sill course
  },
  function arched(ctx, seed) {
    for (const x of [10, 36]) {
      pane(ctx, x, 12, 18, 32, random(seed + x) < 0.15, seed, { arched: true });
    }
  },
  function tallNarrow(ctx, seed) {
    for (const x of [12, 38]) pane(ctx, x, 8, 14, 42, random(seed + x) < 0.16, seed);
  },
  function squarePair(ctx, seed) {
    for (const x of [12, 38]) pane(ctx, x, 16, 16, 16, random(seed + x) < 0.2, seed);
  },
  function frenchDoors(ctx, seed) {
    pane(ctx, 14, 8, 36, 40, random(seed + 7) < 0.22, seed,
         { bars: [{ vertical: true, at: 0.5 }, { vertical: false, at: 0.35 }] });
    ctx.strokeStyle = "rgba(255,255,255,0.34)";              // the balcony rail
    ctx.lineWidth = 1;
    for (let x = 12; x < 52; x += 4) {
      ctx.beginPath(); ctx.moveTo(x, 34); ctx.lineTo(x, 50); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(11, 34); ctx.lineTo(53, 34); ctx.stroke();
  },
  function gridFour(ctx, seed) {
    for (const x of [10, 36]) {
      for (const y of [10, 30]) pane(ctx, x, y, 18, 16, random(seed + x + y) < 0.14, seed);
    }
  },
  function punched(ctx, seed) {
    pane(ctx, 24, 18, 16, 18, random(seed + 11) < 0.1, seed);
  },
  function oriel(ctx, seed) {
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fillRect(8, 6, 48, 44);
    pane(ctx, 12, 12, 40, 30, random(seed + 17) < 0.2, seed,
         { bars: [{ vertical: true, at: 0.33 }, { vertical: true, at: 0.66 }] });
    ctx.fillStyle = "rgba(255,255,255,0.26)";
    ctx.fillRect(7, 5, 50, 3);                               // the cornice over it
  },
  function shuttered(ctx, seed) {
    for (const x of [11, 37]) {
      pane(ctx, x, 13, 16, 30, random(seed + x) < 0.13, seed);
      ctx.fillStyle = "rgba(0,0,0,0.24)";                    // shutters folded back
      ctx.fillRect(x - 5, 12, 4, 32);
      ctx.fillRect(x + 17, 12, 4, 32);
    }
  },
];

function facadeFor(material, seed, style) {
  // One canvas per material and window arrangement, not per building. A few hundred buildings
  // share a few dozen textures, and the rest of the variation comes from the tint.
  const w = 64, h = 64;
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);

  if (material.name === "brick") {
    // Courses, offset every other row. Coarse at this scale, but it is the pattern the eye
    // reads as brick from across a street.
    ctx.fillStyle = "rgba(0,0,0,0.16)";
    for (let y = 0; y < h; y += 4) {
      ctx.fillRect(0, y, w, 1);
      const offset = (y / 4) % 2 ? 4 : 0;
      for (let x = offset; x < w; x += 8) ctx.fillRect(x, y, 1, 4);
    }
  } else if (material.name === "glass") {
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    for (let x = 0; x < w; x += 8) ctx.fillRect(x, 0, 1, h);
    for (let y = 0; y < h; y += 16) ctx.fillRect(0, y, w, 2);
  }

  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.fillRect(0, h - 5, w, 5);                     // the line between storeys
  if (material.name !== "glass" && material.name !== "metal") {
    WINDOW_STYLES[style % WINDOW_STYLES.length](ctx, seed);
  }

  // Grit. Weathering, soot and patching, which is most of what separates a real wall from a
  // flat fill at this distance.
  for (let i = 0; i < w * h * material.grit; i += 1) {
    ctx.fillStyle = random(seed + i) < 0.5 ? "rgba(0,0,0,0.20)" : "rgba(255,255,255,0.13)";
    ctx.fillRect(random(seed + i * 3) * w, random(seed + i * 7) * h, 1, 1);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

const FACADE_CACHE = new Map();
function facadeTextureFor(material, seed) {
  // Twelve window arrangements times three lighting draws per material: enough that a terrace
  // of forty houses has no two the same next to each other, and few enough that the whole city
  // shares a few dozen canvases.
  const style = Math.floor(random(seed + 3) * WINDOW_STYLES.length);
  const variant = Math.floor(random(seed) * 3);
  const key = `${material.name}-${style}-${variant}`;
  if (!FACADE_CACHE.has(key)) {
    FACADE_CACHE.set(key, facadeFor(material, seed + variant * 977, style));
  }
  return FACADE_CACHE.get(key);
}

const FACADE_TEXTURE = facadeTexture();

function roadTexture() {
  // Asphalt, and nothing else.
  //
  // This used to carry saw-cut joints at a four-and-a-half metre grid with a pale lip along
  // each one, and made-good patches scattered through it. Both are real things a San Francisco
  // street has, and both were a mistake here: the joints tiled with the texture rather than
  // with the road, so every segment showed the same grid in the same place and the carriageway
  // read as a floor of grey squares with a lighter edge on each. A road seen from above is
  // near enough uniform, and uniform is what it should be.
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#101214";
  ctx.fillRect(0, 0, size, size);
  // Grain only, at a single pixel, so there is texture at walking distance and nothing that
  // resolves into a pattern from above.
  for (let i = 0; i < size * size * 0.55; i += 1) {
    const shade = random(i * 7);
    ctx.fillStyle = shade < 0.62 ? "rgba(0,0,0,0.30)"
      : shade < 0.94 ? "rgba(255,255,255,0.030)" : "rgba(140,150,155,0.055)";
    ctx.fillRect(random(i * 3) * size, random(i * 5) * size, 1, 1);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

const ROAD = roadTexture();
//: Spacing of the saw cuts, in metres. Four and a half is a common bay for a concrete street.
const ROAD_SLAB_M = 4.5;

function crossingTexture() {
  // Continental bars: the ladder pattern, painted parallel to the way people walk, which is
  // along the length of the crossing way. The paint is drawn on transparency so the road
  // surface shows between the bars rather than the crossing being one solid amber slab.
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, size, size);
  // The tile is one bar and one gap across v, which runs across the width of the crossing.
  // The bar itself. Thermoplastic goes down bright and stays brighter than the road for years,
  // so it is nearly white rather than the dull cream it was.
  ctx.fillStyle = "rgba(244, 245, 240, 0.97)";
  ctx.fillRect(0, 1, size, size * 0.5 - 2);
  // Wear, concentrated where tyres cross it rather than sprayed evenly over the paint. A bar
  // that is uniformly speckled reads as dirty card; a bar worn in two tracks reads as a road
  // marking that has had a year of traffic over it.
  for (const track of [0.22, 0.7]) {
    for (let i = 0; i < size * 6; i += 1) {
      const x = (track + (random(i * 11) - 0.5) * 0.20) * size;
      const y = 1 + random(i * 5) * (size * 0.5 - 2);
      ctx.fillStyle = random(i * 9) < 0.72 ? "rgba(24,26,28,0.30)" : "rgba(255,255,255,0.16)";
      ctx.fillRect(x, y, 1, 1);
    }
  }
  // Softened edges: paint sprayed against a screed does not end on a pixel.
  for (let i = 0; i < size * 2; i += 1) {
    ctx.fillStyle = "rgba(244,245,240,0.35)";
    ctx.fillRect(random(i * 3) * size, random(i * 7) < 0.5 ? 0 : size * 0.5 - 1, 1, 1);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function crossingEdgeTexture() {
  // A marked crossing that is not continental is two lines across the road and bare asphalt
  // between them. Painting ladder bars on those was inventing a marking the street does not
  // have -- and continental crossings are the minority: the city's inventory lists 1,415 of
  // them against 2,517 crossings in this corridor.
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, size, size);
  const bar = size * 0.085;
  ctx.fillStyle = "rgba(244, 245, 240, 0.96)";
  ctx.fillRect(0, 0, size, bar);
  ctx.fillRect(0, size - bar, size, bar);
  for (let i = 0; i < size * 4; i += 1) {
    const y = random(i * 5) < 0.5 ? random(i * 3) * bar : size - bar + random(i * 3) * bar;
    ctx.fillStyle = random(i * 9) < 0.7 ? "rgba(24,26,28,0.28)" : "rgba(255,255,255,0.14)";
    ctx.fillRect(random(i * 7) * size, y, 1, 1);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const CROSSING_EDGES = crossingEdgeTexture();

//: Six ways San Francisco closes a ground-floor garage. Drawn in the building's own colour --
//: a door is part of the house and is nearly always painted to match it -- with white banding
//: on the configurations that carry it.
const GARAGE_STYLES = 6;
//: A roller door's clear height. San Francisco's ground-floor garages sit just under three
//: metres; the city records the width of every cut but not its height.
const GARAGE_HEIGHT_M = 2.7;

function garageTexture(variant, base) {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  const shadow = "rgba(0,0,0,0.34)";
  const lip = "rgba(255,255,255,0.12)";
  const paint = "rgba(248,248,244,0.92)";

  if (variant === 0) {                                  // roller shutter
    for (let y = 0; y < size; y += 4) {
      ctx.fillStyle = shadow; ctx.fillRect(0, y, size, 1);
      ctx.fillStyle = lip; ctx.fillRect(0, y + 1, size, 1);
    }
  } else if (variant === 1 || variant === 2) {          // sectional panels, 2 x 4
    for (let row = 0; row < 4; row += 1) {
      for (let col = 0; col < 2; col += 1) {
        const x = 4 + col * 28, y = 3 + row * 15;
        ctx.fillStyle = shadow; ctx.fillRect(x, y, 24, 12);
        ctx.fillStyle = base; ctx.fillRect(x + 2, y + 2, 20, 8);
        ctx.fillStyle = lip; ctx.fillRect(x + 2, y + 2, 20, 1);
      }
    }
    if (variant === 2) {                                // banded
      ctx.fillStyle = paint;
      ctx.fillRect(0, 17, size, 3);
      ctx.fillRect(0, 47, size, 3);
    }
  } else if (variant === 3) {                           // flush, one broad stripe
    ctx.fillStyle = paint;
    ctx.fillRect(0, size * 0.42, size, size * 0.16);
    ctx.fillStyle = shadow;
    ctx.fillRect(0, size * 0.42 - 1, size, 1);
    ctx.fillRect(0, size * 0.58, size, 1);
  } else if (variant === 4) {                           // board and batten, vertical
    for (let x = 0; x < size; x += 6) {
      ctx.fillStyle = shadow; ctx.fillRect(x, 0, 1, size);
      ctx.fillStyle = lip; ctx.fillRect(x + 1, 0, 1, size);
    }
  } else {                                              // shutter with a light row
    for (let y = 0; y < size; y += 4) {
      ctx.fillStyle = shadow; ctx.fillRect(0, y, size, 1);
    }
    for (let x = 6; x < size - 6; x += 14) {
      ctx.fillStyle = "rgba(40,54,62,0.90)";
      ctx.fillRect(x, 8, 10, 7);
      ctx.fillStyle = lip;
      ctx.strokeStyle = lip; ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, 8.5, 9, 6);
    }
    ctx.fillStyle = paint;
    ctx.fillRect(0, 20, size, 2);
  }

  // The frame, and a handle-height rail. Both are what stop a door reading as a flat panel.
  ctx.strokeStyle = "rgba(0,0,0,0.45)";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, size - 2, size - 2);
  for (let i = 0; i < size * 6; i += 1) {
    ctx.fillStyle = random(i * 7) < 0.5 ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.06)";
    ctx.fillRect(random(i * 3) * size, random(i * 5) * size, 1, 1);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const GARAGE_CACHE = new Map();
function garageTextureFor(variant, tint) {
  // Keyed on the colour quantised to three levels a channel. A door painted the house's exact
  // shade and a door two per cent off it are the same door; twenty-seven buckets times six
  // designs is a few dozen canvases for fourteen thousand garages.
  const colour = new THREE.Color(tint);
  const bucket = [colour.r, colour.g, colour.b].map((v) => Math.round(v * 2) / 2);
  const key = `${variant}-${bucket.join(",")}`;
  if (!GARAGE_CACHE.has(key)) {
    const hex = "#" + bucket.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
    GARAGE_CACHE.set(key, garageTexture(variant, hex));
  }
  return GARAGE_CACHE.get(key);
}

//: How far the dropped kerb flares either side of the driveway itself. A cut is not a
//: rectangle taken out of the kerb: it runs down over a wing at each end, which is why a real
//: apron is wider at the gutter than at the back of the footway.
const APRON_FLARE_M = 0.85;

//: The top of the footway, which is where anything laid on the pavement has to sit.
function roadSurfaceTop() { return 0.06 + KERB_FALLBACK; }

function apronSlab(opening) {
  if (!opening.cp) return null;
  const [kx, ky] = xy(opening.cp[0], opening.cp[1]);
  const [ax, ay] = xy(opening.a[0], opening.a[1]);
  const [bx, by] = xy(opening.b[0], opening.b[1]);
  const wallX = (ax + bx) / 2;
  const wallY = (ay + by) / 2;
  // How far back from the kerb the apron runs. Bounded by the footway rather than by the
  // distance to the wall's midpoint, which on a long frontage is most of the block.
  const depth = Math.min(6.0, Math.max(1.5, Math.hypot(wallX - kx, wallY - ky)));
  if (depth > 12.0) return null;
  const width = Math.max(2.2, opening.w);

  // A trapezoid: the full cut plus its wings at the kerb, tapering to the driveway's own
  // width where it meets the property line.
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2 - APRON_FLARE_M, 0);
  shape.lineTo(width / 2 + APRON_FLARE_M, 0);
  shape.lineTo(width / 2, depth);
  shape.lineTo(-width / 2, depth);
  shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.rotateX(-Math.PI / 2);

  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    map: tiledMap(SIDEWALK, "apron", Math.max(1, Math.round(width / SLAB_M)),
                  Math.max(1, Math.round(depth / SLAB_M))),
    color: 0xf0f0f0, roughness: 0.94, metalness: 0.02,
    // The apron is poured against the footway rather than as part of it, so it sits a
    // millimetre proud and needs to win the depth test cleanly.
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6,
  }));
  // Laid from the kerb back toward the door. The outward bearing points at the street, so the
  // apron has to run the other way -- and rotating by minus the bearing sent it the way the
  // normal points instead, laying fourteen thousand slabs of pavement out across the
  // carriageway until the roads disappeared under them.
  const bearing = (opening.n || 0) * Math.PI / 180;
  // On top of the footway, not in it. At half a kerb height the slab sat inside the pavement
  // slab -- which spans from just above the road to the top of the kerb -- so every apron was
  // buried and the garages appeared to have no crossing at all.
  mesh.position.set(kx, roadSurfaceTop() + 0.012, -ky);
  mesh.rotation.y = Math.PI - bearing;
  return mesh;
}

function garagePanel(opening, tint) {
  const [ax, ay] = xy(opening.a[0], opening.a[1]);
  const [bx, by] = xy(opening.b[0], opening.b[1]);
  const length = Math.hypot(bx - ax, by - ay);
  if (!(length > 0.5)) return null;
  const width = Math.min(opening.w, length * 0.9);
  const dx = (bx - ax) / length;
  const dy = (by - ay) / length;
  // Where along the wall the dropped kerb points, kept far enough from either end that the
  // opening does not run off the corner of the building.
  const half = width / 2;
  const t = Math.min(Math.max(opening.t * length, half), Math.max(half, length - half));
  const cx = ax + dx * t;
  const cy = ay + dy * t;

  const bearing = (opening.n || 0) * Math.PI / 180;
  const nx = Math.sin(bearing);
  const nz = -Math.cos(bearing);
  const map = garageTextureFor(opening.s % GARAGE_STYLES, tint);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, GARAGE_HEIGHT_M),
    new THREE.MeshStandardMaterial({ map, color: 0xffffff, roughness: 0.66, metalness: 0.20 })
  );
  mesh.position.set(cx + nx * 0.07, GARAGE_HEIGHT_M / 2, -cy + nz * 0.07);
  // A plane faces +z, so pi minus the bearing turns it to face the way the wall does. It was
  // atan2(nx, ny) + pi/2, which is ninety degrees out: every door stood side-on to its own
  // building, and read from the street as a grey slab planted on the pavement.
  mesh.rotation.y = Math.PI - bearing;
  return mesh;
}

const CROSSING = crossingTexture();
//: One bar plus one gap, in metres. San Francisco's continental bars run about 430 mm with a
//: matching space, which over a crossing band gives four or five of them. At 1.2 m the band
//: held only three and they read as long lines across the road rather than as a ladder.
const CROSSING_PERIOD_M = 0.86;

function sidewalkTexture() {
  // Scored concrete, as San Francisco actually pours it: a mid grey rather than a pale one,
  // with exposed aggregate speckle at two scales, the fine parallel striations a broom leaves
  // across a fresh slab, and a scored joint every five feet. The joints are most of what tells
  // you at a glance that you are looking at a pavement and not at a grey strip; the grain is
  // what stops it looking like painted card.
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#696d65";
  ctx.fillRect(0, 0, size, size);

  // Coarse aggregate: the stones in the mix, a few pixels across.
  for (let i = 0; i < size * size * 0.02; i += 1) {
    const shade = random(i * 13);
    ctx.fillStyle = shade < 0.56 ? "rgba(44,46,42,0.34)" : "rgba(166,168,158,0.22)";
    const r = 1 + random(i * 17) * 1.8;
    ctx.beginPath();
    ctx.arc(random(i * 3) * size, random(i * 5) * size, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // Fine grain over the whole slab.
  for (let i = 0; i < size * size * 0.5; i += 1) {
    const shade = random(i * 7);
    ctx.fillStyle = shade < 0.5 ? "rgba(0,0,0,0.20)"
      : shade < 0.85 ? "rgba(255,255,255,0.075)" : "rgba(104,96,84,0.16)";
    ctx.fillRect(random(i * 3) * size, random(i * 5) * size, 1, 1);
  }
  // Broom finish: shallow parallel striations across the slab, which is what a finisher leaves
  // and what gives real pavement its direction under raking light.
  for (let y = 0; y < size; y += 2) {
    ctx.fillStyle = random(y * 29) < 0.5 ? "rgba(0,0,0,0.05)" : "rgba(255,255,255,0.04)";
    ctx.fillRect(0, y, size, 1);
  }
  // Staining along the joints, where water sits and dirt collects.
  ctx.fillStyle = "rgba(58,60,56,0.20)";
  ctx.fillRect(0, 0, size, 6);
  ctx.fillRect(0, 0, 6, size);
  // The score itself: a groove, so a dark line with a bright lip below it.
  ctx.strokeStyle = "rgba(38,40,38,0.62)";
  ctx.lineWidth = 3.0;
  ctx.strokeRect(1.5, 1.5, size - 3, size - 3);
  ctx.strokeStyle = "rgba(200,202,194,0.14)";
  ctx.lineWidth = 1.2;
  ctx.strokeRect(4.0, 4.0, size - 8, size - 8);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

const SIDEWALK = sidewalkTexture();
//: One scored square, in metres. Five feet is the usual San Francisco pour.
const SLAB_M = 1.52;

//: Storey height and bay width in metres, so one tile of the facade covers one real storey.
const STOREY_M = 3.2;
const BAY_M = 4.0;

// ExtrudeGeometry's default UVs come from the footprint's own coordinates, which stretches a
// facade by however large the building is in world space. This maps side walls to
// (distance along the wall, height) instead, so windows stay the same size on every building.
const FACADE_UV = {
  generateTopUV(geometry, vertices, a, b, c) {
    // Roofs carry no map, so these only need to exist and be finite.
    return [
      new THREE.Vector2(vertices[a * 3] / 20, vertices[a * 3 + 1] / 20),
      new THREE.Vector2(vertices[b * 3] / 20, vertices[b * 3 + 1] / 20),
      new THREE.Vector2(vertices[c * 3] / 20, vertices[c * 3 + 1] / 20),
    ];
  },
  generateSideWallUV(geometry, vertices, a, b, c, d) {
    const ax = vertices[a * 3], ay = vertices[a * 3 + 1], az = vertices[a * 3 + 2];
    const bx = vertices[b * 3], by = vertices[b * 3 + 1], bz = vertices[b * 3 + 2];
    const cz = vertices[c * 3 + 2], dz = vertices[d * 3 + 2];
    const run = Math.hypot(bx - ax, by - ay) / BAY_M;
    return [
      new THREE.Vector2(0, az / STOREY_M),
      new THREE.Vector2(run, bz / STOREY_M),
      new THREE.Vector2(run, cz / STOREY_M),
      new THREE.Vector2(0, dz / STOREY_M),
    ];
  },
};

function footprintShape(points) {
  if (!points || points.length < 4) return null;
  const shape = new THREE.Shape();
  points.forEach((point, index) => {
    const [x, y] = xy(point[0], point[1]);
    if (index === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  });
  return shape;
}

function footprintMesh(points, color, opacity, y) {
  const shape = footprintShape(points);
  if (!shape) return null;
  const geom = new THREE.ShapeGeometry(shape);
  geom.rotateX(-Math.PI / 2);
  // No depth writing: this is a flat translucent plate the size of a building footprint, and
  // with depth on it hid whatever stood behind it.
  const mat = new THREE.MeshStandardMaterial({
    color, transparent: opacity < 1, opacity, roughness: 0.95, metalness: 0.02,
    side: THREE.DoubleSide, depthWrite: opacity >= 1,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.y = y;
  return mesh;
}

function buildingMesh(feature) {
  const shape = footprintShape(feature.points);
  if (!shape) return null;
  // No exaggeration. This was multiplied by 1.8 to make massing read from a bird's eye, which
  // put every building eighty per cent taller than OpenStreetMap says it is -- fine as a
  // diagram, wrong the moment somebody walks down the street beside it.
  const height = Math.max(3, Math.min(260, feature.height_m || 10.5));
  const geom = new THREE.ExtrudeGeometry(shape, {
    depth: height, bevelEnabled: false, UVGenerator: FACADE_UV,
  });
  geom.rotateX(-Math.PI / 2);
  const measured = feature.height_source === "osm_height" || feature.height_source === "osm_levels";
  // Seeded from the footprint, so a building keeps its material and colour between reloads.
  const seed = Math.round((feature.points[0][0] * 1e5) + (feature.points[0][1] * 1e5) * 7919);
  const material = pickMaterial(seed, height);
  const palette = material.colours;
  // A colour taken off a photograph of this building, where one was. Otherwise the palette,
  // which is a statement about San Francisco's building stock and not about this building.
  let tint = feature.colour !== undefined
    ? new THREE.Color(feature.colour).getHex()
    : palette[Math.floor(random(seed + 11) * palette.length)];
  const sampled = feature.colour !== undefined;
  // Solid, both of them. Transparency was carrying a meaning -- an inferred height was drawn
  // see-through so it could not be mistaken for a measured one -- and it was paying far too much
  // for it. A translucent building shows the buildings behind it through its own roof, puts
  // itself in the depth-sorted transparent queue where it fights with everything else in there,
  // and reads as scaffolding rather than as a building.
  //
  // The distinction survives without it: a building whose height nobody has recorded is drawn
  // desaturated, so a street of assumptions is visibly greyer than a street of measurements
  // while both are things you cannot see through.
  const opacity = 1.0;
  // ExtrudeGeometry emits two material groups: the caps first, then the walls. Giving both the
  // facade map put a grid of windows across every rooftop -- which reads, from above, as though
  // the city were tiled in glass.
  // The roof takes the wall's colour, darkened. A fixed grey top on a coloured building looked
  // like a lid set on something else, and from above -- which is most of how this map is read --
  // the roof is the building.
  // Desaturation marks an inferred *height*, which is a separate question from where the
  // colour came from -- a sampled colour on a guessed height is still a guessed height.
  if (!measured) {
    const colour = new THREE.Color(tint);
    const hsl = {};
    colour.getHSL(hsl);
    colour.setHSL(hsl.h, hsl.s * 0.35, hsl.l * 0.92);
    tint = colour.getHex();
  }
  const roofTint = new THREE.Color(tint).multiplyScalar(0.68);
  const roof = new THREE.MeshStandardMaterial({
    color: roofTint, transparent: opacity < 1, opacity,
    roughness: 0.97, metalness: material.name === "metal" ? 0.5 : 0.03,
  });
  const walls = new THREE.MeshStandardMaterial({
    map: facadeTextureFor(material, seed),
    color: tint,
    transparent: opacity < 1,
    opacity,
    roughness: material.rough,
    metalness: material.metal,
    // Glass and metal are mirrors of the sky, so they need something to reflect. The tint alone
    // gives a flat blue rectangle; the environment map is what makes it read as a window.
    envMapIntensity: material.name === "glass" ? 1.6 : material.name === "metal" ? 1.1 : 0.35,
  });
  const mesh = new THREE.Mesh(geom, [roof, walls]);
  mesh.userData = feature;
  return mesh;
}

// ---- photographed facades ----
//
// One chunk of the city wears its own photographs. Every other building is dressed in a
// procedural texture -- a window grid drawn into a canvas, coloured from San Francisco's
// building stock by percentage -- which makes a street look inhabited and describes no
// particular building. These walls are the other thing: the frames that actually looked at
// them, rectified onto the plane of the wall and merged.
//
// A panel is hung rather than the building's own facade being replaced. The cameras stood in
// the street, so they saw the lower storeys and not the parapet, and a panel that stops where
// the photographs stopped is honest about that in a way that stretching one to the roofline
// would not be. It also means a wall that failed the agreement check simply keeps what it had.
const FACADES = DATA.facades || { chunks: [], walls: [] };
const facadeLoader = new THREE.TextureLoader();
//: Clear of the wall behind it. Coplanar with the extrusion, the two would fight for every
//: pixel and flicker, which is the same bug the kerb bands had.
const FACADE_STANDOFF_M = 0.06;

function facadePanel(wall) {
  const [ax, ay] = xy(wall.a[0], wall.a[1]);
  const [bx, by] = xy(wall.b[0], wall.b[1]);
  const length = Math.hypot(bx - ax, by - ay);
  if (!(length > 0.5) || !(wall.h > 0.5)) return null;

  const bearing = wall.n * Math.PI / 180;
  const nx = Math.sin(bearing);
  const nz = -Math.cos(bearing);

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.86, metalness: 0.03,
    // Until its photograph arrives the panel is invisible rather than white: a grid of blank
    // rectangles standing off the buildings is worse than the buildings alone.
    transparent: true, opacity: 0,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(length, wall.h), material);
  mesh.position.set((ax + bx) / 2 + nx * FACADE_STANDOFF_M, wall.h / 2,
                    -(ay + by) / 2 + nz * FACADE_STANDOFF_M);
  // A plane faces +z; rotating by pi minus the bearing turns it to face the way the wall does.
  mesh.rotation.y = Math.PI - bearing;
  mesh.userData.facade = wall;
  return mesh;
}

const facadePanels = [];
for (const wall of FACADES.walls) {
  const panel = facadePanel(wall);
  if (panel) {
    groups.facades.add(panel);
    facadePanels.push(panel);
  }
}

// Textures are fetched after the city is on screen and a few at a time. Two hundred and twenty
// JPEGs is several megabytes, and blocking the first frame on them would trade the whole map
// for one block of it.
async function loadFacadeTextures() {
  const queue = facadePanels.slice();
  const worker = async () => {
    while (queue.length) {
      const panel = queue.pop();
      const wall = panel.userData.facade;
      try {
        const texture = await facadeLoader.loadAsync(`facades/${wall.c}/${wall.t}`);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
        panel.material.map = texture;
        panel.material.opacity = 1;
        panel.material.needsUpdate = true;
      } catch (err) {
        panel.visible = false;
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
}
requestAnimationFrame(() => { loadFacadeTextures(); });

// ---- what the city recorded ----
//
// Curb lines and curb ramps as San Francisco holds them, drawn over the reconstruction so the
// two can be compared by eye. This is not a prettier version of the streets layer: it is a
// different claim about the same ground, from a different source, and where the two disagree
// that is worth being able to see.
(async () => {
  let official;
  try {
    official = await fetch("sf-corridor-official.json", { cache: "no-cache" }).then((r) => r.json());
  } catch (err) {
    return;
  }
  for (const line of official.curb_lines || []) {
    const points = line.p.map(([lon, lat]) => v3(lon, lat, 0.16));
    if (points.length < 2) continue;
    groups.official.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color: 0x7fd4ff, transparent: true, opacity: 0.9 })));
  }
  // Ramps the inventory has flagged are drawn apart from the rest. A ramp whose lip the city
  // has already recorded as too high is exactly where a measured kerb height is worth checking.
  const plain = [];
  const flagged = [];
  for (const ramp of official.curb_ramps || []) {
    (ramp.f && ramp.f.length ? flagged : plain).push(v3(ramp.p[0], ramp.p[1], 0.2));
  }
  for (const [points, colour, size] of [[plain, 0x7fd4ff, 1.6], [flagged, 0xffb454, 2.4]]) {
    if (!points.length) continue;
    groups.official.add(new THREE.Points(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.PointsMaterial({ color: colour, size, sizeAttenuation: true })));
  }
  const note = document.getElementById("officialnote");
  const summary = (official.summary || {}).by_class || {};
  const walk = summary.sidewalk_width;
  if (note) {
    const counts = (DATA.official || {}).counts || {};
    note.innerHTML =
      `<b>Official geometry</b> — ${(counts["with right of way"] || 0).toLocaleString()} ways ` +
      `carry San Francisco's recorded right of way and ` +
      `${(counts["with surveyed footway"] || 0).toLocaleString()} its 2014 footway survey. ` +
      `Curb heights are ours: no city record publishes one, so ` +
      `${(counts["with measured curb"] || 0).toLocaleString()} ways use the lidar measured on ` +
      `that block and the rest fall back to the corridor median. ` +
      (walk ? `Against the city survey our footway widths run ` +
              `${walk.bias_m >= 0 ? "+" : ""}${walk.bias_m.toFixed(2)} m on average ` +
              `(median ${walk.median_error_m >= 0 ? "+" : ""}${walk.median_error_m.toFixed(2)} m, ` +
              `n=${walk.n.toLocaleString()}). ` : "") +
      `The right-of-way layer is a 2014 analysis the city says is not at engineering accuracy.`;
  }
})();

// The grid the facade work is done in: 250 m squares, the one that has been photographed
// picked out from the ones that have not. A square with a lot of buildings and a lot of frames
// and no textures is simply the next one to run.
for (const chunk of FACADES.grid || []) {
  const corners = [[chunk.w, chunk.s], [chunk.e, chunk.s], [chunk.e, chunk.n],
                   [chunk.w, chunk.n], [chunk.w, chunk.s]];
  const done = chunk.d === 1;
  const material = new THREE.LineBasicMaterial({
    color: done ? 0x6ff0b4 : 0x4d6b78,
    transparent: true,
    // Readiness is how photographable the square is; the faint ones are the ones with nothing
    // standing in them or nobody driving through them.
    opacity: done ? 0.95 : Math.min(0.5, 0.10 + chunk.r / 900),
  });
  const points = corners.map(([lon, lat]) => v3(lon, lat, 3));
  groups.chunks.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material));
}

const streetNames = new Set();
let streetLabelCount = 0;
for (const way of DATA.ways) {
  if (way.kind === "building") {
    // On the ground, where a footprint is. At 1.8 m it was a plate floating at head height
    // through the middle of every building.
    const base = footprintMesh(way.points, way.covered ? 0x2b4148 : 0x1b2a2f,
                               way.covered ? 0.42 : 0.18, 0.04);
    if (base) groups.streets.add(base);
    if (way.covered) {
      const building = buildingMesh(way);
      if (building) groups.mapped3d.add(building);
      // A dropped kerb outside means a way in. The city records 14,130 of these against
      // buildings in this corridor, with the width of each.
      for (const opening of way.garages || []) {
        const panel = garagePanel(opening, way.colour !== undefined
          ? new THREE.Color(way.colour).getHex() : 0x9aa0a4);
        if (panel) groups.mapped3d.add(panel);
        const apron = apronSlab(opening);
        if (apron) groups.streets.add(apron);
      }
    }
    continue;
  }
  const isCrossing = way.kind === "crossing";
  const isSidewalk = way.kind === "sidewalk";
  // White for everything: the value now comes from the texture, and tinting a photograph of
  // concrete amber to say "this is a crossing" was a legend, not a street.
  const color = 0xffffff;
  // Widths from San Francisco's own records where it has them: the surveyed footway width for
  // this segment and side, and the carriageway left over after both footways are taken out of
  // the recorded right of way. Every street used to be eight metres wide and every footway
  // 3.6, which made Grant Avenue and Van Ness the same street.
  // A San Francisco crosswalk band is about twelve feet, not seventeen. The extra width made
  // the bars sparse and the whole marking read as a couple of stripes.
  const widthMeters = isCrossing ? 3.7
    : isSidewalk ? (way.walk_m || way.walk_fallback_m || 3.6)
    : (way.road_m || 8.0);
  // This kerb, not the city's median kerb. Four thousand nine hundred of these carry their own
  // measured height, spread from 60 to 445 mm; the fallback is the corridor median.
  const KERB = way.kerb_m || KERB_FALLBACK;
  // Opaque, because these are surfaces rather than overlays. Once the kerb was built at its
  // measured 126 mm the old 0.62 made the footway a faint film on dark ground and it read as
  // missing -- the geometry was right and the material was still drawn like a diagram.
  const opacity = 1.0;
  // Heights are metres of actual street. They used to be chosen for legibility from above --
  // a footway was a 1.4 m slab floating 4.5 m up, and the measured-kerb band was a 5.5 m slab
  // three storeys in the air. Read from a bird's eye that was merely stylised; walked at street
  // level it made every footway taller than the person on it.
  const roadTop = 0.06;
  groups.streets.add(ribbon(way.points, widthMeters, color, opacity,
    isCrossing ? roadTop + 0.02 : isSidewalk ? roadTop + KERB / 2 : roadTop / 2,
    isCrossing ? 0.02 : isSidewalk ? KERB : roadTop,
    // Continental unless we positively know otherwise. San Francisco has been converting its
    // marked crossings to ladders for years, and the inventory is demonstrably incomplete --
    // 598 of its points sit near no mapped crossing at all, which is the two datasets
    // disagreeing about where a crossing is rather than evidence that one is plain. The
    // ``continental`` flag still records the 817 the city confirms.
    isCrossing ? "crossing" : isSidewalk ? "walk" : "road"));
  // The footways, laid from the kerb outward on both sides. Drawn a centimetre below the
  // mapped sidewalk ways so that where OpenStreetMap has one the two do not fight, and so
  // that where it has none there is still pavement rather than a hole.
  if (!isSidewalk && !isCrossing) {
    const walk = way.walk_m || way.walk_fallback_m || 3.0;
    const inner = widthMeters / 2;
    // Both sides unless one of them is inside another street's carriageway, which happens
    // wherever a divided road is drawn as two ways.
    for (const side of (way.walk_sides !== undefined ? way.walk_sides : [1, -1])) {
      groups.streets.add(ribbon(
        trimWay(offsetWay(way.points, side * (inner + walk / 2)), inner + 1.5),
        walk, color, opacity, roadTop + KERB / 2 - 0.015, KERB, "walk"));
    }
  }
  // A centreline belongs on a roadway, not on a footway: drawn on everything it read as a
  // white thread stitched over the whole city, and on a 3.6 m pavement it was simply wrong.
  // It does not belong on a crossing either -- a crosswalk has bars painted across it and no
  // line down its middle, and the bars are now real paint rather than a coloured slab.
  // A yellow centreline separates opposing traffic, so a one-way street does not have one.
  // Drawing it on every roadway put the marking on 784 segments of this corridor that do not
  // carry it -- and a yellow line specifically tells a driver there is traffic coming the
  // other way.
  if (!isSidewalk && !isCrossing && !way.oneway) {
    // A double solid yellow, which is what San Francisco paints down the middle of a two-way
    // street. A broken line means overtaking is allowed and is the exception here, not the
    // rule -- and drawn as one dashed thread it read as a dotted line on a map rather than as
    // a road marking.
    for (const side of [1, -1]) {
      groups.streets.add(line(offsetWay(way.points, side * 0.18), 0xf0c33c, 0.95,
                              roadTop + 0.02));
    }
  }
  if (way.covered && (isCrossing || isSidewalk)) {
    // The measured kerb, marked. This sat at exactly the footway's own height and thickness --
    // two coplanar boxes occupying the same volume, which no depth buffer can order, so it
    // strobed pink against grey every frame. It now caps the kerb rather than sharing it.
    //
    // It is also survey data rather than street, so it belongs with the other layers that
    // describe the dataset and is off until asked for.
    groups.kerbs.add(ribbon(way.points, isCrossing ? 0.8 : 0.45, 0xff4d8f,
      0.95, roadTop + KERB + 0.03, 0.05));
  }
  if (!isCrossing && !isSidewalk && way.name && !streetNames.has(way.name) && streetLabelCount < 90) {
    const midpoint = longestMidpoint(way.points);
    if (midpoint) {
      streetNames.add(way.name);
      streetLabelCount += 1;
      labelAt(way.name, midpoint[0], midpoint[1], 28, groups.streets, "#d6e7ea", 78);
    }
  }
}

// Ground. Everything that is not a road, a footway or a building stands on something -- back
// yards, light wells, car parks, the middle of a block -- and none of it is mapped. Without a
// surface under them those became holes onto the background, which reads as black voids
// punched through the city. A dark neutral says "ground we have not described" rather than
// "nothing is here".
{
  const [x1, y1] = xy(bbox.west, bbox.north);
  const [x2, y2] = xy(bbox.east, bbox.south);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(Math.abs(x2 - x1) * 1.1, Math.abs(y1 - y2) * 1.1),
    new THREE.MeshStandardMaterial({ color: 0x23262a, roughness: 1.0, metalness: 0.0 })
  );
  ground.rotation.x = -Math.PI / 2;
  // Below the district tint, which is itself below the roadway.
  ground.position.set((x1 + x2) / 2, -0.14, -(y1 + y2) / 2);
  groups.streets.add(ground);
}

const districtColors = [0x1d4d58, 0x355038, 0x4a3e61, 0x5a4930, 0x533749, 0x29475f];
DATA.districts.forEach((d, i) => {
  const [x1, y1] = xy(d.west, d.north);
  const [x2, y2] = xy(d.east, d.south);
  // A district is a label for a part of the city, not a thing standing in it. This used to be
  // a six-metre-tall translucent box covering a whole neighbourhood, and it was eating the
  // bottoms of buildings: a transparent mesh still writes depth by default, and the transparent
  // queue is sorted by object rather than by fragment, so wherever a district sorted in front
  // of a building the building's lowest six metres failed the depth test and vanished. What was
  // left was the top of a tower hanging in the air with nothing under it -- which looked like a
  // geometry bug in the buildings and was nothing of the kind.
  //
  // It is now a tint on the ground, under the roadway, writing no depth at all.
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(Math.abs(x2 - x1), Math.abs(y1 - y2)),
    new THREE.MeshBasicMaterial({
      color: districtColors[i % districtColors.length],
      // Faint. As a six-metre box at 0.2 this was a tinted volume you looked through; as a
      // ground plane the same opacity is a sheet of colour over a dark background, and the
      // block interiors came out mint green.
      transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide,
    })
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set((x1 + x2) / 2, -0.08, -(y1 + y2) / 2);
  groups.districts.add(mesh);
  labelAt(d.name, (d.west + d.east) / 2, (d.south + d.north) / 2, 54, groups.districts, "#ffffff", 145);
});

for (const c of DATA.coverage) {
  const height = 10 + 92 * Math.min(1, c.score || 0);
  const radius = 9 + Math.min(26, c.eligible * 1.1);
  const color = c.score > 0.58 ? 0x4fbe86 : c.score > 0.34 ? 0xe0a84e : 0x355866;
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, height, 6, 1),
    new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.46, roughness: 0.64 })
  );
  const [x, y] = xy(c.lon, c.lat);
  mesh.position.set(x, height / 2, -y);
  mesh.userData = c;
  groups.coverage.add(mesh);
}

for (const o of DATA.observations) {
  const geom = new THREE.ConeGeometry(o.eligible ? 5 : 3.5, o.eligible ? 24 : 12, 8);
  const mat = new THREE.MeshStandardMaterial({ color: o.provider === "kartaview" ? 0xff4d8f : 0x54c8e8, transparent: true, opacity: o.eligible ? 0.85 : 0.35 });
  const cone = new THREE.Mesh(geom, mat);
  const [x, y] = xy(o.lon, o.lat);
  cone.position.set(x, 18, -y);
  cone.rotation.z = Math.PI;
  cone.rotation.y = ((o.heading || 0) * Math.PI) / 180;
  groups.observations.add(cone);
}

for (const s of DATA.sequence_paths) {
  groups.sequences.add(line(s.points, s.provider === "kartaview" ? 0xff4d8f : 0x54c8e8, 0.52, 32));
}

const state = { yaw: -0.45, pitch: 0.95, dist: 1180, target: new THREE.Vector3(0, 0, 0) };
function placeCamera() {
  const x = Math.sin(state.yaw) * Math.cos(state.pitch) * state.dist;
  const z = Math.cos(state.yaw) * Math.cos(state.pitch) * state.dist;
  const y = Math.sin(state.pitch) * state.dist;
  camera.position.copy(state.target).add(new THREE.Vector3(x, y, z));
  camera.lookAt(state.target);
}
placeCamera();

let dragging = false, last = [0, 0];
canvas.addEventListener("pointerdown", (e) => { dragging = true; last = [e.clientX, e.clientY]; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  const dx = e.clientX - last[0], dy = e.clientY - last[1];
  state.yaw -= dx * 0.006;
  state.pitch = Math.max(0.25, Math.min(1.28, state.pitch + dy * 0.004));
  last = [e.clientX, e.clientY];
  placeCamera();
});
canvas.addEventListener("pointerup", () => { dragging = false; });
canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  state.dist = Math.max(8, Math.min(2600, state.dist * Math.exp(e.deltaY * 0.001)));
  placeCamera();
}, { passive: false });
document.getElementById("reset").addEventListener("click", () => {
  Object.assign(state, { yaw: -0.45, pitch: 0.95, dist: 1180 });
  if (typeof avatar !== "undefined") {
    avatar.position.set(0, AVATAR_RADIUS, 0);
    state.target.copy(avatar.position);
  }
  placeCamera();
});

// ---- gaps: mapped ways nobody has photographed ----
{
  const material = new THREE.LineBasicMaterial({ color: 0xff5a3c, transparent: true, opacity: 0.85 });
  let metres = 0;
  for (const gap of DATA.gaps || []) {
    const points = gap.points.map(([lon, lat]) => v3(lon, lat, 1.5));
    if (points.length < 2) continue;
    for (let i = 1; i < points.length; i += 1) metres += points[i].distanceTo(points[i - 1]);
    groups.gaps.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material));
  }
  const note = document.getElementById("gapnote");
  if (note) {
    const total = (DATA.gaps || []).length;
    note.textContent = total
      ? `${total.toLocaleString()} mapped ways, about ${(metres / 1000).toFixed(1)} km, have no eligible photograph over them.`
      : "Every mapped way in the region has at least one eligible photograph over it.";
  }
}

// The facade credit. These walls are other people's photographs, taken under CC BY-SA 4.0,
// and that licence is a condition rather than a courtesy: it wants the source named wherever
// the work is shown. It also happens to be the honest caption for the layer -- one chunk of
// this city is photographs and the rest of it is a guess about what the buildings look like.
{
  const note = document.getElementById("facadenote");
  const chunk = (FACADES.chunks || [])[0];
  if (note && chunk) {
    const licences = Object.keys(chunk.licenses || {}).join(", ") || "CC BY-SA 4.0";
    note.innerHTML =
      `<b>Photo facades</b> — chunk ${chunk.key}, ${chunk.textured} of ${chunk.attempted} walls ` +
      `across ${chunk.buildings} buildings, rectified from street-level frames and merged. ` +
      `Every other building wears a procedural texture. Imagery by Mapillary and KartaView ` +
      `contributors, ${licences}. Turn on <b>Chunks</b> for the grid and which square is next.`;
  }
}

// ---- search by corner ----
//
// People say where they are by naming two streets, so that is what the field takes. Matching is
// per-word across both names, which lets "market 4th" and "4th & market" find the same corner
// without the searcher having to guess the order or the ampersand.
{
  const field = document.getElementById("find");
  const hits = document.getElementById("hits");
  const corners = DATA.intersections || [];
  let selected = -1;
  let showing = [];

  function search(query) {
    const words = query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    if (!words.length) return [];
    return corners
      .filter((c) => {
        const hay = `${c.a} ${c.b}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      })
      .slice(0, 8);
  }

  function paint() {
    hits.replaceChildren();
    showing.forEach((corner, index) => {
      const item = document.createElement("li");
      item.textContent = `${corner.a} & ${corner.b}`;
      item.setAttribute("aria-selected", String(index === selected));
      item.addEventListener("click", () => travelTo(corner));
      hits.append(item);
    });
  }

  function travelTo(corner) {
    const [x, y] = xy(corner.lon, corner.lat);
    // A named corner is a destination, so this behaves like the two-finger gesture: it moves
    // the sphere and closes the distance rather than only turning the camera.
    goTo(new THREE.Vector3(x, 0, -y), { travel: true });
    field.value = `${corner.a} & ${corner.b}`;
    showing = [];
    selected = -1;
    paint();
  }

  field.addEventListener("input", () => {
    showing = search(field.value);
    selected = showing.length ? 0 : -1;
    paint();
  });
  field.addEventListener("keydown", (e) => {
    if (!showing.length) return;
    if (e.key === "ArrowDown") { selected = (selected + 1) % showing.length; paint(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { selected = (selected - 1 + showing.length) % showing.length; paint(); e.preventDefault(); }
    else if (e.key === "Enter") { travelTo(showing[Math.max(selected, 0)]); e.preventDefault(); }
    // Arrow keys inside the field steer the list, not the sphere; the walker's handler is on
    // the window and would otherwise start it moving while somebody is choosing a corner.
    e.stopPropagation();
  });
}

// ---- the sidebar folds, because on a phone it otherwise covers the map it describes ----
{
  const hud = document.getElementById("hud");
  const fold = document.getElementById("fold");
  fold.addEventListener("click", () => {
    const open = hud.dataset.open !== "false";
    hud.dataset.open = String(!open);
    fold.setAttribute("aria-expanded", String(!open));
    fold.innerHTML = open ? "&plus;" : "&minus;";
    fold.title = open ? "Expand" : "Collapse";
  });
}

document.querySelectorAll("button[data-layer]").forEach((button) => {
  // The control reads its state from the scene rather than from the markup, so a layer's
  // default can be changed in one place without the buttons quietly disagreeing with it.
  button.setAttribute("aria-pressed", String(groups[button.dataset.layer].visible));
  button.addEventListener("click", () => {
    const layer = button.dataset.layer;
    groups[layer].visible = !groups[layer].visible;
    button.setAttribute("aria-pressed", String(groups[layer].visible));
  });
});

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize);
resize();
// ---- a body to move through the city with ----
//
// Orbiting a model tells you its shape; walking it tells you its scale. The sphere is the
// cheapest possible stand-in for a person -- no shadow, no model, no physics -- but it is
// street-sized and it moves at a speed you can feel, which is enough to make a kerb read as
// something you would step off rather than a pink line on a diagram.
const STREET_SPEED = 8.94;     // 20 mph in metres per second, at street level
// Above that the speed scales with how far the camera has pulled back, so the sphere always
// crosses the screen at the same rate. Walking a block at 20 mph is right when you are standing
// in it; from two thousand metres up the same 20 mph is a stationary dot, and crossing the
// corridor would take four minutes. What stays constant is the apparent speed, not the metric.
const SPEED_REFERENCE_DIST = 45;
const AVATAR_RADIUS = 0.9;     // 1.8 m across: a person, so everything else has a scale to read against
const ARRIVAL_DIST = 45;       // close enough that a 126 mm kerb is a step rather than a line
const avatar = new THREE.Mesh(
  new THREE.SphereGeometry(AVATAR_RADIUS, 24, 16),
  // Faintly self-lit. Grey on grey buildings disappears the moment it rolls into shade, and
  // losing the thing you are steering is worse than it being slightly unrealistic.
  new THREE.MeshStandardMaterial({
    color: 0x4fd18b, roughness: 0.45, metalness: 0.05, emissive: 0x12452c,
  })
);
avatar.position.set(0, AVATAR_RADIUS, 0);
root.add(avatar);
state.target.copy(avatar.position);
placeCamera();

const held = new Set();
const ARROWS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);
addEventListener("keydown", (e) => {
  if (!ARROWS.has(e.key)) return;
  // Typing in a field is not steering. Without this, choosing a corner walks the sphere away.
  if (e.target instanceof HTMLInputElement) return;
  held.add(e.key);
  e.preventDefault();   // otherwise the arrows scroll the page out from under the canvas
});
addEventListener("keyup", (e) => held.delete(e.key));
addEventListener("blur", () => held.clear());   // a key held while tabbing away would stick

// Click to go there. The ray is cast at the ground rather than at the geometry, so clicking a
// rooftop puts you on the street beneath it instead of on the roof.
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const ray = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let pressedAt = [0, 0];
canvas.addEventListener("pointerdown", (e) => { pressedAt = [e.clientX, e.clientY]; });

function groundAt(clientX, clientY) {
  pointer.set((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(pointer, camera);
  const landing = new THREE.Vector3();
  return ray.ray.intersectPlane(groundPlane, landing) ? landing : null;
}

// One finger looks, two fingers travel. Panning the focus without moving the sphere is how you
// survey a block you have not decided to walk to yet; committing to it should be the deliberate
// gesture, not the one you make by accident while orbiting.
function goTo(landing, { travel }) {
  if (!landing) return;
  if (travel) {
    avatar.position.set(landing.x, AVATAR_RADIUS, landing.z);
    state.dist = Math.min(state.dist, ARRIVAL_DIST);
  }
  state.target.set(landing.x, travel ? AVATAR_RADIUS : 0, landing.z);
  placeCamera();
}

canvas.addEventListener("pointerup", (e) => {
  // A drag is an orbit, not a destination. Only a press that barely moved counts as a click.
  if (Math.hypot(e.clientX - pressedAt[0], e.clientY - pressedAt[1]) > 5) return;
  if (e.button === 2) return;   // handled on contextmenu, which fires first on a two-finger tap
  goTo(groundAt(e.clientX, e.clientY), { travel: false });
});

canvas.addEventListener("contextmenu", (e) => {
  // A two-finger tap on a trackpad, or a right click. Both arrive here.
  e.preventDefault();
  goTo(groundAt(e.clientX, e.clientY), { travel: true });
});

let previous = performance.now();
function stepAvatar(now) {
  const dt = Math.min((now - previous) / 1000, 0.1);   // clamped: a backgrounded tab returns
  previous = now;                                       // with a huge delta and would teleport
  if (!held.size) return;
  // Forward is where the camera looks, so the arrows mean what they appear to mean however the
  // view has been orbited.
  const forward = new THREE.Vector3(Math.sin(state.yaw), 0, Math.cos(state.yaw)).negate();
  const rightward = new THREE.Vector3(forward.z, 0, -forward.x);
  const move = new THREE.Vector3();
  if (held.has("ArrowUp")) move.add(forward);
  if (held.has("ArrowDown")) move.sub(forward);
  if (held.has("ArrowRight")) move.add(rightward);
  if (held.has("ArrowLeft")) move.sub(rightward);
  if (!move.lengthSq()) return;
  const scaled = STREET_SPEED * Math.max(1, state.dist / SPEED_REFERENCE_DIST);
  move.normalize().multiplyScalar(scaled * dt);
  avatar.position.add(move);
  // Roll it the distance it travelled, about the axis across its direction of travel.
  const axis = new THREE.Vector3(move.z, 0, -move.x).normalize();
  avatar.rotateOnWorldAxis(axis, move.length() / AVATAR_RADIUS);
  state.target.copy(avatar.position);
  placeCamera();
}

function animate(now) {
  requestAnimationFrame(animate);
  stepAvatar(now || performance.now());
  renderer.render(scene, camera);
}
animate();
</script>
</body>
</html>
"""


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog", type=Path, default=Path("data/sf_corridor"))
    parser.add_argument("--out", type=Path, default=Path("docs/sf-corridor-3d.html"))
    parser.add_argument("--osm-cache", type=Path, default=Path("data/sf_corridor/stats/osm_ways.json"))
    parser.add_argument("--reuse-osm", action="store_true")
    args = parser.parse_args()

    if args.reuse_osm and args.osm_cache.exists():
        ways = json.loads(args.osm_cache.read_text(encoding="utf-8"))
    else:
        ways = fetch_osm(SF_CORRIDOR.bbox)
        args.osm_cache.parent.mkdir(parents=True, exist_ok=True)
        args.osm_cache.write_text(json.dumps(ways, indent=2) + "\n", encoding="utf-8")

    payload = build_payload(args.catalog, ways)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    # Data beside the page rather than inside it. The page is then a few kilobytes that rarely
    # change, and the payload is one file the browser caches -- where inlining rewrote ten
    # megabytes of undedupable HTML into the repository on every single build.
    data_path = args.out.with_suffix(".json")
    data_path.write_text(json.dumps(payload, separators=(",", ":"), default=str), encoding="utf-8")
    args.out.write_text(
        HTML,
        encoding="utf-8",
    )
    print(f"{args.out} -> {args.out.stat().st_size / 1e3:.1f} kB page")
    print(f"{data_path} -> {data_path.stat().st_size / 1e6:.2f} MB payload")
    print(json.dumps(payload["summary"], indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
