"""Overture Maps in the shape of an Overpass answer: a cell's map when Overpass cannot be had.

Overpass is the builder's source, and from the cloud's pods it has failed whole cells: its two
global mirrors answering 502 and 504 together, or the pod unable to reach them at all ("[Errno
99] Cannot assign requested address"), seventeen cells quarantined at their map stage on
2026-10-29. Overture publishes the same streets and buildings as open GeoParquet on AWS --
built from OpenStreetMap, with machine-traced footprints where OSM has none -- and DuckDB reads
just the cell's rows of it over HTTPS, with no account.

The features are turned into the elements Overpass would have sent (ways with ``tags`` and a
``geometry`` of lat/lon points), so they go through the builder's own reading of a map,
coastline and divider rules included (``osm_ways_from`` in scripts/build_sf_corridor_3d.py).
Only what the builder's query asks for and Overture can say is made: streets and paths with
their class, buildings with their heights, and water. Kerb nodes, signs, lamps and shops are
not in Overture's transportation and buildings themes; their stages say so themselves.

Licence: transportation and buildings are ODbL, as OpenStreetMap is; water (base) is ODbL as
well. The attribution travels with the cell (``SOURCE``).
"""

from __future__ import annotations

import json
from typing import Any

RELEASE = "2026-10-21.0"
BASE = "s3://overturemaps-us-west-2/release"
SOURCE = {"source": "overture", "release": RELEASE, "licence": "ODbL-1.0",
          "attribution": "© OpenStreetMap contributors, Overture Maps Foundation"}

#: Overture's road classes the builder's Overpass query asks for, as OSM's highway values.
#: ``track`` and ``bridleway`` are not asked for there and are left out here too.
ROAD_CLASSES = {
    "motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential",
    "living_street", "service", "pedestrian", "footway", "steps", "path", "cycleway",
}
LINKED = {"motorway", "trunk", "primary", "secondary", "tertiary"}
SERVICE_KINDS = {"parking_aisle", "driveway", "alley"}
#: Water that is a surface (a pool is a building's, and a stream is a line, not an area).
NOT_WATER = {"swimming_pool", "fountain"}
#: Water is clipped to the cell and this margin, in degrees: the bay is one polygon of
#: thousands of points, and only its edge near the cell matters.
CLIP_MARGIN_DEG = 0.002


def _geometry(points: list[list[float]]) -> list[dict[str, float]]:
    return [{"lat": float(lat), "lon": float(lon)} for lon, lat, *_ in points]


def rings(geojson: dict) -> list[list[list[float]]]:
    """The outer rings of a Polygon or MultiPolygon (holes are courtyards, not separate ways)."""
    kind, coords = geojson.get("type"), geojson.get("coordinates") or []
    if kind == "Polygon":
        return [coords[0]] if coords else []
    if kind == "MultiPolygon":
        return [poly[0] for poly in coords if poly]
    return []


def lines(geojson: dict) -> list[list[list[float]]]:
    kind, coords = geojson.get("type"), geojson.get("coordinates") or []
    if kind == "LineString":
        return [coords]
    if kind == "MultiLineString":
        return list(coords)
    return []


def road_tags(cls: str | None, subclass: str | None, name: str | None,
              flags: list[dict] | None = None) -> dict[str, str] | None:
    """OSM tags for an Overture road segment, or None for a class the builder does not draw."""
    if cls == "unknown":
        cls = "road"
    elif cls not in ROAD_CLASSES:
        return None
    tags = {"highway": f"{cls}_link" if subclass == "link" and cls in LINKED else cls}
    if subclass == "sidewalk":
        tags["footway"] = "sidewalk"
    elif subclass == "crosswalk":
        tags["footway"] = "crossing"
    elif subclass in SERVICE_KINDS:
        tags["service"] = subclass
    if name:
        tags["name"] = name
    for flag in flags or []:
        if flag.get("between"):  # true of part of the segment only
            continue
        values = set(flag.get("values") or [])
        if "is_bridge" in values:
            tags["bridge"] = "yes"
        if "is_tunnel" in values:
            tags["tunnel"] = "yes"
    return tags


def building_tags(cls: str | None, height: float | None, floors: int | None,
                  min_height: float | None, roof_shape: str | None, name: str | None) -> dict[str, str]:
    tags = {"building": cls or "yes"}
    if height:
        tags["height"] = f"{height:.2f}"
    if floors:
        tags["building:levels"] = str(int(floors))
    if min_height:
        tags["min_height"] = f"{min_height:.2f}"
    if roof_shape:
        tags["roof:shape"] = roof_shape
    if name:
        tags["name"] = name
    return tags


def water_tags(subtype: str | None, cls: str | None, name: str | None) -> dict[str, str] | None:
    if cls in NOT_WATER:
        return None
    tags = {"natural": "water"}
    if name:
        tags["name"] = name
    return tags


def _query(con, theme: str, kind: str, columns: str, bbox, *, release: str, geometry: str = "geometry"):
    w, s, e, n = bbox.west, bbox.south, bbox.east, bbox.north
    return con.execute(
        f"SELECT {columns}, ST_AsGeoJSON({geometry}) FROM read_parquet("
        f"'{BASE}/{release}/theme={theme}/type={kind}/*', hive_partitioning=1) "
        f"WHERE bbox.xmin <= {e} AND bbox.xmax >= {w} AND bbox.ymin <= {n} AND bbox.ymax >= {s}"
    ).fetchall()


def connect():
    import duckdb

    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial; SET s3_region='us-west-2';")
    return con


def elements(bbox, *, release: str = RELEASE, con=None) -> list[dict[str, Any]]:
    """The cell's streets, buildings and water as Overpass elements (ways with geometry)."""
    con = con or connect()
    out: list[dict[str, Any]] = []

    def way(ident: str, tags: dict, points: list[list[float]]) -> None:
        if len(points) >= 2:
            out.append({"type": "way", "id": ident, "tags": tags, "geometry": _geometry(points)})

    for ident, cls, subclass, name, flags, shape in _query(
            con, "transportation", "segment", 'id, class, subclass, names."primary", road_flags',
            bbox, release=release):
        tags = road_tags(cls, subclass, name, flags)
        if tags:
            for n, line in enumerate(lines(json.loads(shape))):
                way(f"overture:{ident}:{n}", tags, line)
    for ident, cls, height, floors, min_height, roof, name, shape in _query(
            con, "buildings", "building",
            'id, class, height, num_floors, min_height, roof_shape, names."primary"', bbox, release=release):
        tags = building_tags(cls, height, floors, min_height, roof, name)
        for n, ring in enumerate(rings(json.loads(shape))):
            way(f"overture:{ident}:{n}", tags, ring)
    m = CLIP_MARGIN_DEG
    clip = (f"ST_Intersection(geometry, ST_MakeEnvelope({bbox.west - m}, {bbox.south - m}, "
            f"{bbox.east + m}, {bbox.north + m}))")
    for ident, subtype, cls, name, shape in _query(
            con, "base", "water", 'id, subtype, class, names."primary"', bbox, release=release, geometry=clip):
        tags = water_tags(subtype, cls, name)
        if tags:
            for n, ring in enumerate(rings(json.loads(shape))):
                way(f"overture:{ident}:{n}", tags, ring)
    return out


def summary(found: list[dict[str, Any]]) -> dict[str, int]:
    """How many streets, buildings and water areas: what decides whether a cell has a map."""
    counts = {"streets": 0, "buildings": 0, "water": 0}
    for e in found:
        tags = e.get("tags") or {}
        if "highway" in tags:
            counts["streets"] += 1
        elif "building" in tags:
            counts["buildings"] += 1
        elif tags.get("natural") == "water":
            counts["water"] += 1
    return counts
