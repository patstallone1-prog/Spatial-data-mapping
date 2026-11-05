"""What OpenStreetMap says about water in the mapped area, read from a Geofabrik extract.

* **streams**: ``waterway`` lines (river, stream, canal, ditch, drain, tidal channel) with their
  width where tagged. A piece tagged ``tunnel`` (culvert, pipe) runs under the ground: it is kept,
  marked ``under``, so the drainage can route into it, and is not drawn.
* **tanks**: ``man_made`` storage tanks, water towers and covered reservoirs, with height,
  diameter, content and whether it is underground.
* **plants**: ``man_made=wastewater_plant`` and ``water_works`` areas, and the open basins
  (``water=wastewater``) inside them.
* **manholes**: ``manhole=*`` / ``man_made=manhole`` points (OSM's lids: drain, sewer, water...).
* **junctions**: nodes two or more streets share -- where a sewer nobody publishes has its lids.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

WATERWAYS = {"river", "stream", "canal", "ditch", "drain", "brook", "tidal_channel"}
#: A width where none is tagged, in metres: what each kind of waterway generally is here.
DEFAULT_WIDTH_M = {"river": 12.0, "canal": 6.0, "tidal_channel": 5.0, "stream": 2.0, "brook": 1.5,
                   "ditch": 1.2, "drain": 1.2}
TANKS = {"storage_tank", "water_tower", "reservoir_covered", "tank", "water_tank"}
PLANTS = {"wastewater_plant", "water_works"}
#: Streets that carry a sewer down their middle (not footways, service lanes or freeways).
SEWERED_STREETS = {"primary", "secondary", "tertiary", "residential", "unclassified", "living_street",
                   "primary_link", "secondary_link", "tertiary_link"}


@dataclass
class OsmWater:
    streams: list[dict] = field(default_factory=list)
    tanks: list[dict] = field(default_factory=list)
    plants: list[dict] = field(default_factory=list)
    basins: list[dict] = field(default_factory=list)
    manholes: list[dict] = field(default_factory=list)
    drains: list[dict] = field(default_factory=list)
    junctions: list[list[float]] = field(default_factory=list)


def _num(text) -> float | None:
    """A tagged size in metres: '12', '12 m', '40 ft', '3.5;4' -> the first number."""
    if text is None:
        return None
    raw = str(text).split(";")[0].strip().lower()
    scale = 0.3048 if raw.endswith(("ft", "'")) else 1.0
    digits = "".join(c for c in raw if c.isdigit() or c == ".")
    try:
        value = float(digits) * scale
    except ValueError:
        return None
    return value if math.isfinite(value) and value > 0 else None


def ring_area_m2(ring: list[list[float]]) -> float:
    if len(ring) < 3:
        return 0.0
    lat0 = sum(p[1] for p in ring) / len(ring)
    kx, ky = 111320.0 * math.cos(math.radians(lat0)), 110540.0
    s = 0.0
    for (x1, y1), (x2, y2) in zip(ring, [*ring[1:], *ring[:1]], strict=True):
        s += (x1 * kx) * (y2 * ky) - (x2 * kx) * (y1 * ky)
    return abs(s) / 2


def centroid(ring: list[list[float]]) -> list[float]:
    return [round(sum(p[0] for p in ring) / len(ring), 7), round(sum(p[1] for p in ring) / len(ring), 7)]


def _closed(coords) -> bool:
    return len(coords) >= 4 and coords[0] == coords[-1]


def _tank(oid: str, tags: dict, ring: list | None, point: list | None) -> dict:
    kind = tags.get("man_made")
    under = tags.get("location") in {"underground", "underwater"} or kind == "reservoir_covered"
    tank = {"id": oid, "kind": "tower" if kind == "water_tower" else "reservoir" if kind == "reservoir_covered"
            else "tank", "content": tags.get("content") or ("water" if kind in {"water_tower", "reservoir_covered"}
                                                             else None)}
    if ring:
        tank["c"] = [[round(x, 7), round(y, 7)] for x, y in ring[:-1]]
        tank["p"] = centroid(tank["c"])
        area = ring_area_m2(tank["c"])
        tank["diameter_m"] = round(2 * math.sqrt(area / math.pi), 2)
    else:
        tank["p"] = [round(point[0], 7), round(point[1], 7)]
    for ours, theirs in (("height_m", "height"), ("diameter_m", "diameter"), ("capacity", "capacity")):
        v = _num(tags.get(theirs)) if ours != "capacity" else tags.get(theirs)
        if v:
            tank[ours] = v
    if tags.get("name"):
        tank["name"] = tags["name"]
    if tags.get("operator"):
        tank["operator"] = tags["operator"]
    if tags.get("building"):
        tank["building"] = True        # the buildings layer already draws its walls
    tank["under"] = under
    return tank


def read_pbf(path, inside) -> OsmWater:
    """Everything above from an extract. ``inside(lon, lat)`` says whether a point is in the
    mapped area; a way is kept if any of its nodes is."""
    import osmium

    out = OsmWater()
    ways: dict[int, dict] = {}
    street_nodes: dict[int, set[int]] = {}
    need: set[int] = set()
    for obj in osmium.FileProcessor(str(path), osmium.osm.WAY):
        tags = dict(obj.tags)
        nodes = [r.ref for r in obj.nodes]
        if (tags.get("waterway") in WATERWAYS or tags.get("man_made") in TANKS | PLANTS
                or tags.get("water") == "wastewater"):
            ways[obj.id] = {"tags": tags, "nodes": nodes}
            need.update(nodes)
        elif tags.get("highway") in SEWERED_STREETS and tags.get("tunnel") is None and tags.get("bridge") is None:
            for n in nodes:
                street_nodes.setdefault(n, set()).add(obj.id)
    shared = {n for n, ws in street_nodes.items() if len(ws) >= 2}
    need |= shared
    loc: dict[int, tuple[float, float]] = {}
    for obj in osmium.FileProcessor(str(path), osmium.osm.NODE):
        if obj.id in need:
            loc[obj.id] = (obj.location.lon, obj.location.lat)
        tags = obj.tags
        man = tags.get("man_made")
        lid = "manhole" in tags or man == "manhole"
        drain = man == "storm_drain" or tags.get("highway") == "storm_drain"
        if not (lid or drain or man in TANKS):
            continue
        lon, lat = obj.location.lon, obj.location.lat
        if not inside(lon, lat):
            continue
        oid = f"osm:n{obj.id}"
        if lid:
            out.manholes.append({"id": oid, "p": [round(lon, 7), round(lat, 7)],
                                 "use": tags.get("manhole") or tags.get("utility") or "unknown",
                                 "source": "OpenStreetMap"})
        elif drain:
            out.drains.append({"id": oid, "p": [round(lon, 7), round(lat, 7)], "kind": "inlet",
                               "type": tags.get("storm_drain") or "", "system": "storm",
                               "source": "OpenStreetMap"})
        else:
            out.tanks.append(_tank(oid, dict(tags), None, [lon, lat]))
    out.junctions = [[round(loc[n][0], 7), round(loc[n][1], 7)] for n in sorted(shared)
                     if n in loc and inside(*loc[n])]
    for wid, way in ways.items():
        coords = [list(loc[n]) for n in way["nodes"] if n in loc]
        if len(coords) < 2 or not any(inside(x, y) for x, y in coords):
            continue
        tags, oid = way["tags"], f"osm:w{wid}"
        if tags.get("waterway") in WATERWAYS:
            kind = "stream" if tags["waterway"] == "brook" else tags["waterway"]
            stream = {"id": oid, "kind": kind,
                      "width_m": round(_num(tags.get("width")) or DEFAULT_WIDTH_M[kind], 2),
                      "c": [[round(x, 7), round(y, 7)] for x, y in coords],
                      "under": tags.get("tunnel") not in (None, "no") or tags.get("location") == "underground"}
            if tags.get("name"):
                stream["name"] = tags["name"]
            if tags.get("intermittent") == "yes" or tags.get("seasonal") == "yes":
                stream["intermittent"] = True
            out.streams.append(stream)
        elif not _closed(coords):
            continue
        elif tags.get("man_made") in PLANTS:
            ring = [[round(x, 7), round(y, 7)] for x, y in coords[:-1]]
            out.plants.append({"id": oid, "kind": "wastewater" if tags["man_made"] == "wastewater_plant" else "water",
                               "name": tags.get("name") or "", "operator": tags.get("operator") or "",
                               "c": ring, "p": centroid(ring), "area_m2": round(ring_area_m2(ring))})
        elif tags.get("man_made") in TANKS:
            out.tanks.append(_tank(oid, tags, coords, None))
        elif tags.get("water") == "wastewater":
            ring = [[round(x, 7), round(y, 7)] for x, y in coords[:-1]]
            out.basins.append({"id": oid, "kind": "wastewater", "c": ring, "p": centroid(ring),
                               "area_m2": round(ring_area_m2(ring))})
    return out


def point_in_ring(p, ring) -> bool:
    x, y = p
    hit = False
    for (x1, y1), (x2, y2) in zip(ring, [*ring[1:], *ring[:1]], strict=True):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            hit = not hit
    return hit


def assign_to_plants(water: OsmWater) -> None:
    """Each tank and basin inside a treatment plant is that plant's, and a round tank there is
    what a plant's round tanks are: a clarifier (wide, low, open) or a digester (closed)."""
    for item in water.tanks + water.basins:
        for plant in water.plants:
            if point_in_ring(item["p"], plant["c"]):
                item["plant"] = plant["id"]
                break
    for tank in water.tanks:
        if not tank.get("plant") or tank["under"]:
            continue
        plant = next(p for p in water.plants if p["id"] == tank["plant"])
        wide = (tank.get("diameter_m") or 0) >= 18 and (tank.get("height_m") or 0) <= 7
        # Mapped as a building, it has a roof: a digester (EBMUD's eleven by the toll plaza),
        # not an open clarifier, whatever its size.
        if plant["kind"] == "wastewater" and wide and not tank.get("building"):
            tank["kind"] = "clarifier"
        elif plant["kind"] == "wastewater" and tank.get("content") in (None, "sewage", "wastewater", "sludge"):
            tank["kind"] = "digester"
